/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — the lens (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the shore, the sky and the glows are authored in scene-linear HDR, so a
 * max-channel knee picks what blooms: the sea's light, the far coast's lamps), one bloom chain
 * (Medium and up) and one full-screen pass:
 *
 *   calm zones (what shows through the translucent board card and HUD is soft-clipped and its
 *   glare attenuated) → bloom (the sea's fire haloed in the night air, wider on a misty night) →
 *   the night's exposure and the event lift → a hue-preserving filmic curve (an electric-blue
 *   spark stays blue; only the hottest cores roll toward white) → the night's grade → vignette →
 *   sRGB → grain and dither → FXAA.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, clamp, dot, exp, float, floor, fract, length, max, min, mix, pass, renderOutput, screenCoordinate, screenUV,
    select, sin, smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { flashScale } from '../../core/photosensitivity.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode; `fxaa` smooths the single-sample pass.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.62, bloomResolution: 0.5, fxaa: true,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.6, bloomResolution: 0.5, fxaa: true,
    },
    High: {
        bloom: true, bloomStrength: 0.58, bloomResolution: 0.45, fxaa: true,
    },
    Medium: {
        bloom: true, bloomStrength: 0.54, bloomResolution: 0.33, fxaa: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, fxaa: false,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, fxaa: false,
    },
});

export const BLOOM_THRESHOLD = 0.9;
export const BLOOM_KNEE = 0.55;
export const BLOOM_RADIUS = 0.7;
export const EXPOSURE = 1.0;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

const max3 = (c) => max(c.r, max(c.g, c.b));
const luma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
const hash21 = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'lt_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * A hue-preserving shoulder on the max channel (identity below `k`), then a path to white for the
 * hottest values only (the cores of the brightest sparks).
 */
const tidesFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max3(c), 1e-5);
    const k = float(0.5);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(3.0, 16.0, peak).mul(0.6));
}).setLayout({ name: 'lt_tidesFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class LuminousTidesPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {boolean} [params.falseColor=false]
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event lift, 0..1
        this.uBloomBoost = uniform(0);
        /** What the night leans the darks and the lights of the picture toward. */
        this.uGradeShadow = uniform(new THREE.Vector3(0.94, 1.0, 1.1));
        this.uGradeLight = uniform(new THREE.Vector3(1.0, 1.0, 1.0));
        /** 0..1: rain on the lens air: the picture softens and cools a little. */
        this.uRain = uniform(0);

        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.uCalmStrength = uniform(0);

        // ── Bloom: max-channel soft knee over a 4-tap box ──
        this.bloomNode = null;
        if (look.bloom) {
            this.bloomNode = bloom(sceneColor, look.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
            this.bloomNode.threshold.value = BLOOM_THRESHOLD;
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
            // BloomNode's documented hook, read once at setup. Inline (no setLayout): `input` must
            // stay the raw scene TextureNode for .sample().
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                // Hue-preserving clamp on the max channel: a per-channel clamp would turn the
                // electric blue toward white and the lamps toward yellow.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(8.0).div(max(max3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = max3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;

        const outputFn = Fn(() => {
            const st = screenUV;
            const px = st.mul(this.uViewport);
            const fromCentre = st.sub(0.5);

            // ── Calm zones (board cards + HUD) ──
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i++) {
                const r = this.uCalm[i];
                const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            const S = vec3(sceneColor.sample(st).rgb).toVar();
            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(max3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.16).add(m.mul(0.18))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const glow = this.bloomNode.getTextureNode();
                const B = vec3(glow.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.7))));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = tidesFilmic(X).toVar();
            const L = luma(T);
            const lo = float(1.0).sub(smoothstep(0.0, 0.3, L));
            T.assign(mix(T, T.mul(this.uGradeShadow).add(this.uGradeShadow.sub(0.9).mul(0.004)), lo.mul(0.6)));
            const hi = smoothstep(0.45, 1.0, L);
            T.mulAssign(mix(vec3(1.0), this.uGradeLight, hi.mul(0.5)));
            // A little more saturation; rain cools and softens it.
            T.assign(mix(vec3(luma(T)), T, float(1.1).sub(this.uRain.mul(0.12))));
            T.mulAssign(mix(vec3(1.0), vec3(0.95, 0.98, 1.04), this.uRain.mul(0.6)));
            // Vignette, measured from the frame.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.2, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.4)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = hash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.014).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = hash21(pxi).add(hash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = max3(H);
                const fc = select(
                    mx.lessThan(0.1),
                    vec3(0.05, 0.1, 0.6),
                    select(mx.lessThan(0.6), vec3(0.1, 0.55, 0.15), select(
                        mx.lessThan(1.0),
                        vec3(0.85, 0.8, 0.1),
                        select(mx.lessThan(2.5), vec3(1.0, 0.45, 0.05), vec3(0.95, 0.05, 0.05)),
                    )),
                );
                out = vec4(fc, 1.0);
            }
            return out;
        });

        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = look.fxaa && !falseColor ? fxaa(outputFn()) : outputFn();
        this.pipeline.needsUpdate = true;
    }

    /** Per-frame values (all optional). */
    update({
        flash, bloomBoost, exposure, time, gradeShadow, gradeLight, rain,
    } = {}) {
        if (gradeShadow) this.uGradeShadow.value.set(gradeShadow[0], gradeShadow[1], gradeShadow[2]);
        if (gradeLight) this.uGradeLight.value.set(gradeLight[0], gradeLight[1], gradeLight[2]);
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (time !== undefined) this.uTime.value = time;
        if (rain !== undefined) this.uRain.value = rain;
    }

    /**
     * Calm rects in screen fractions (x0, y0, x1, y1; y down), at most CALM_RECTS_MAX, and the
     * eased strength (0 = off).
     */
    setCalmRects(rects, strength) {
        for (let i = 0; i < CALM_RECTS_MAX; i++) {
            const r = rects?.[i];
            if (r) this.calmRects[i].set(r.x0, r.y0, r.x1, r.y1);
            else this.calmRects[i].set(0, 0, 0, 0);
        }
        this.uCalmStrength.value = strength;
    }

    setSize(width, height, bufferWidth = width, bufferHeight = height) {
        if (width > 0 && height > 0) this.uAspect.value = width / height;
        if (bufferWidth > 0 && bufferHeight > 0) {
            this.uSrcTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
            this.uViewport.value.set(bufferWidth, bufferHeight);
        }
    }

    render() {
        this.pipeline.render();
    }

    dispose() {
        this.scenePass?.dispose();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.pipeline = null;
    }
}

/** A render pipeline that only encodes the scene (the fallback path if the post fails to build). */
export function createPassThroughPipeline(renderer, scene, camera) {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    pipeline.outputNode = scenePass;
    return {
        render: () => pipeline.render(),
        update() {},
        setCalmRects() {},
        setSize() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}
