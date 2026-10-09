/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the lens (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the wave is authored in scene-linear HDR, so a max-channel knee picks
 * what blooms), one bloom chain (Medium and up) and one full-screen pass:
 *
 *   calm zones (what shows through the translucent board card and HUD is soft-clipped and its
 *   glare attenuated) → bloom → shafts (the sky marched toward the sun on a half-size target:
 *   light standing in the spray of the tube, cut by the lip's torn edge, in the hour's colour)
 *   → the hour's exposure and event flash → a hue-preserving filmic curve (emerald
 *   stays emerald; only the sun and its sparks roll to white) → grade → vignette → sRGB →
 *   grain and dither → FXAA.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, clamp, dot, exp, float, floor, fract, length, max, min, mix, pass, renderOutput, rtt,
    screenCoordinate, screenUV, select, sin, smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode; `shafts` is the number of steps of the
 * shaft march (0 = no shaft targets) and `shaftScale` the size of its targets; `fxaa` smooths
 * the single-sample pass.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.34, bloomResolution: 0.5, shafts: 28, shaftScale: 0.5, fxaa: true,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.34, bloomResolution: 0.5, shafts: 24, shaftScale: 0.5, fxaa: true,
    },
    High: {
        bloom: true, bloomStrength: 0.32, bloomResolution: 0.45, shafts: 20, shaftScale: 0.5, fxaa: true,
    },
    Medium: {
        bloom: true, bloomStrength: 0.3, bloomResolution: 0.33, shafts: 14, shaftScale: 0.34, fxaa: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, shaftScale: 0.34, fxaa: false,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, shaftScale: 0.34, fxaa: false,
    },
});

export const BLOOM_THRESHOLD = 1.05;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.66;
export const EXPOSURE = 1.0;

/**
 * The shafts: what glows within SHAFT_RADIUS (screen heights) of the sun and above the
 * threshold streaks; the march covers SHAFT_LENGTH of the way to the sun and its light falls
 * off by SHAFT_DECAY a step (of a 32-step march).
 */
export const SHAFT_THRESHOLD = 0.85;
export const SHAFT_RADIUS = 0.34;
export const SHAFT_LENGTH = 0.78;
export const SHAFT_DECAY = 0.962;

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
    name: 'waves_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Sea filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path to
 * white for the hottest values (the sun, its sparks on the water).
 */
const seaFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max3(c), 1e-5);
    const k = float(0.42);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.4, 9.0, peak).mul(0.86));
}).setLayout({ name: 'waves_seaFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class WavesPost {
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
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uBloomBoost = uniform(0);
        /** 0..1: a chain of clears warms the picture toward gold. */
        this.uWarm = uniform(0);
        /** The sun on screen (fractions, y down) and how strongly its shafts stand in the air. */
        this.uSun = uniform(new THREE.Vector2(0.25, 0.42));
        this.uShafts = uniform(0.6);
        /** The colour the shafts are given: the hour's (gold at golden hour, silver under the moon). */
        this.uShaftTint = uniform(new THREE.Vector3(1.2, 1.0, 0.76));

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
            // BloomNode's documented hook, read once at setup. Inline (no setLayout): `input`
            // must stay the raw scene TextureNode for .sample().
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                // Hue-preserving clamp on the max channel: a per-channel clamp would turn the
                // low sun yellow and its glare olive.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(9.0).div(max(max3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = max3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        // ── Shafts ──
        this.shaftsFirst = null;
        this.shaftsNode = look.shafts > 0 ? this.createShafts(sceneColor, look.shafts, look.shaftScale) : null;

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
            const clipped = S.mul(min(m, float(0.22).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom, and the sun's shafts standing in the spray ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const glow = this.bloomNode.getTextureNode();
                const B = vec3(glow.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.6))));
            }
            if (this.shaftsNode) {
                const rays = vec3(this.shaftsNode.sample(st).rgb);
                glare.addAssign(rays.mul(this.uShafts).mul(this.uShaftTint).mul(0.85));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.3)));
            const T = seaFilmic(X).toVar();
            const L = luma(T);
            // The shadows lean to deep sea green; the lights keep their gold.
            const lo = float(1.0).sub(smoothstep(0.0, 0.32, L));
            T.assign(mix(T, T.mul(vec3(0.9, 1.03, 1.05)).add(vec3(0.0006, 0.0028, 0.0032)), lo.mul(0.55)));
            const hi = smoothstep(0.5, 1.0, L);
            T.mulAssign(mix(vec3(1.0), vec3(1.04, 1.0, 0.94), hi.mul(0.5)));
            // A chain of clears warms the whole picture a little.
            T.mulAssign(mix(vec3(1.0), vec3(1.07, 1.0, 0.9), this.uWarm));
            T.assign(mix(vec3(luma(T)), T, 1.1));
            // Vignette, measured from the frame.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.5, 1.2, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.34)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = hash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.012).mul(float(1.0).sub(calm.mul(0.7))));
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

    /**
     * The shafts, in two short marches instead of one long one. The first walks each pixel toward
     * the sun and gathers what glows on the way; the second walks the first's result over one of
     * its steps, filling the gaps between its samples: N + M taps give the smoothness of N x M,
     * with no jitter and so no grain. Dark water between a pixel and the sun cuts its beam, so the
     * lip's torn edge rules the light into rays.
     */
    createShafts(sceneColor, steps, scale) {
        const refine = 5;
        const decay = SHAFT_DECAY ** (32 / steps);
        const gather = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uSun.sub(coord).mul(SHAFT_LENGTH / steps).toVar();
            const at = coord.toVar();
            const sum = vec3(0.0).toVar();
            const weight = float(1.0).toVar();
            Loop(steps, ({ i }) => {
                at.addAssign(stride);
                const c = max(vec3(sceneColor.sample(at).rgb), vec3(0.0)).toVar();
                const peak = max3(c);
                const off = at.sub(this.uSun).mul(vec2(this.uAspect, 1.0)).toVar();
                const source = smoothstep(SHAFT_THRESHOLD, SHAFT_THRESHOLD + 0.7, peak)
                    .mul(exp(dot(off, off).div(SHAFT_RADIUS * SHAFT_RADIUS).negate()));
                // The last steps fade out, so no pixel switches on at a hard radius from the sun.
                const taper = float(1.0).sub(smoothstep(steps * 0.7, steps, float(i).add(1.0)));
                // Hue-preserving clamp: the disc must not turn the rays white.
                const kept = c.mul(min(float(1.0), float(4.0).div(max(peak, 1e-4))));
                sum.addAssign(kept.mul(source).mul(weight).mul(taper));
                weight.mulAssign(decay);
            });
            return vec4(sum.div(steps), 1.0);
        })();
        const first = rtt(gather, null, null, { resolutionScale: scale });
        const fill = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uSun.sub(coord).mul(SHAFT_LENGTH / (steps * refine)).toVar();
            const at = coord.toVar();
            const sum = vec3(0.0).toVar();
            Loop(refine, () => {
                sum.addAssign(first.sample(at).rgb);
                at.addAssign(stride);
            });
            return vec4(sum.div(refine), 1.0);
        })();
        this.shaftsFirst = first;
        return rtt(fill, null, null, { resolutionScale: scale });
    }

    /** Per-frame values (all optional). */
    update({
        flash, bloomBoost, exposure, warm, time, sunX, sunY, shafts, shaftTint,
    } = {}) {
        if (shaftTint) this.uShaftTint.value.set(shaftTint[0], shaftTint[1], shaftTint[2]);
        if (flash !== undefined) this.uFlash.value = flash;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (warm !== undefined) this.uWarm.value = warm;
        if (time !== undefined) this.uTime.value = time;
        if (sunX !== undefined && sunY !== undefined) this.uSun.value.set(sunX, sunY);
        if (shafts !== undefined) this.uShafts.value = shafts;
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
        this.shaftsFirst?.dispose();
        this.shaftsNode?.dispose();
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.shaftsFirst = null;
        this.shaftsNode = null;
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
