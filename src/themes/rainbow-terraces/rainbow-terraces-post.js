/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Rainbow Terraces — the lens (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (MSAA from High up for the stone's hard edges; no MRT: the world is authored in
 * scene-linear HDR, so a max-channel knee picks what blooms), one bloom chain (Medium and up) and
 * one full-screen pass:
 *
 *   calm zones (what shows through the translucent card and HUD is soft-clipped, its glare
 *   attenuated) → bloom with PRISMATIC HALATION (the bloom read at three radii, one per channel: a
 *   spectral fringe on the brightest water, the lens's own small rainbow) → the flare lift (an
 *   analytic glow at an event's point, so events read with bloom off) → exposure × iris × flash →
 *   a hue-preserving filmic curve (a red bow stays red) → the hour's Parrish split-tone (darks lean
 *   cobalt-violet, lights warm gold) → vignette → sRGB → grain and dither → FXAA (Low, Medium).
 *
 * No crepuscular blur, no anamorphic streak, no lens star: the sun is behind us.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, clamp, dot, exp, float, floor, fract, length, max, min, mix, pass, renderOutput, screenCoordinate,
    screenUV, select, sin, smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { flashScale } from '../../utils/photosensitivity.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (the flare lift still carries the events);
 * `msaa` is the scene pass's sample count; `fxaa` smooths a single-sample pass.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.28, bloomResolution: 0.5, halation: true, msaa: 4, fxaa: false,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.27, bloomResolution: 0.5, halation: true, msaa: 4, fxaa: false,
    },
    High: {
        bloom: true, bloomStrength: 0.25, bloomResolution: 0.45, halation: true, msaa: 4, fxaa: false,
    },
    Medium: {
        bloom: true, bloomStrength: 0.22, bloomResolution: 0.33, halation: true, msaa: 0, fxaa: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, halation: false, msaa: 0, fxaa: true,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, halation: false, msaa: 0, fxaa: false,
    },
});

// A lower knee, so the front-lit HDR of the falls, the cloud caps and the sea's crests glows a
// little (wider, softer) instead of the bloom almost never firing.
export const BLOOM_THRESHOLD = 1.3;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.72;
export const EXPOSURE = 1.0;
/** How far apart the halation reads the bloom per channel (a fraction of the distance to the centre). */
export const HALATION = 0.006;

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
    name: 'sc_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * A hue-preserving shoulder on the max channel (identity below `k`), then a path to white for the
 * hottest values only (the Mother Fall's core, a flare).
 */
const scFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max3(c), 1e-5);
    const k = float(0.6);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(3.0, 24.0, peak).mul(0.7));
}).setLayout({ name: 'sc_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class RainbowTerracesPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {boolean} [params.falseColor=false]   band the pre-tone-map max channel
     * @param {boolean} [params.values=false]       the value study: five grey bands of lightness
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: look.msaa || 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        /** Event flash (a lift), 0..1, already governed by the world. */
        this.uFlash = uniform(0);
        /** The iris: closes on surges so colours survive them (1 = open). */
        this.uIris = uniform(1);
        this.uBloomBoost = uniform(0);
        /** The hour's own glow (Gilded most): the knee opens and the glare lifts; never an event's. */
        this.uGlow = uniform(0);
        /** The flare lift: (x, y) on screen (fractions, y down), radius (frame heights), strength. */
        this.uFlare = uniform(new THREE.Vector4(0.5, 0.5, 0.2, 0));
        this.uFlareTint = uniform(new THREE.Vector3(1.0, 0.95, 0.85));
        /** The hour's split-tone. */
        this.uGradeShadow = uniform(new THREE.Vector3(0.93, 0.98, 1.09));
        this.uGradeLight = uniform(new THREE.Vector3(1.05, 1.01, 0.94));
        /** The hush: every light sinks for a breath (0..1). */
        this.uHush = uniform(0);

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
                // Hue-preserving clamp on the max channel (a per-channel clamp turns colour olive).
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

        const falseColor = params.falseColor === true;
        const values = params.values === true;

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
            const m = max(max3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.22).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom, with prismatic halation ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const glow = this.bloomNode.getTextureNode();
                if (look.halation) {
                    const k = fromCentre.mul(vec2(1.0, float(1.0).div(this.uAspect))).mul(HALATION);
                    const { r } = glow.sample(st);
                    const { g } = glow.sample(st.add(k.mul(0.5)));
                    const { b } = glow.sample(st.add(k));
                    glare.assign(vec3(r, g, b));
                } else {
                    glare.assign(vec3(glow.sample(st).rgb));
                }
                glare.mulAssign(float(1.0).add(this.uBloomBoost.add(this.uGlow).mul(0.6)));
            }
            // The flare lift: an analytic glow where an event flares.
            const fo = st.sub(this.uFlare.xy).mul(vec2(this.uAspect, 1.0));
            const fr = max(this.uFlare.z, 0.02);
            const lift = exp(dot(fo, fo).div(fr.mul(fr)).negate()).mul(this.uFlare.w);
            glare.addAssign(this.uFlareTint.mul(lift));
            glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            const H = S.add(glare).toVar();

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(this.uIris).mul(float(1.0).add(this.uFlash.mul(0.3)))
                .mul(float(1.0).sub(this.uHush.mul(0.3)));
            const T = scFilmic(X).toVar();
            const L = luma(T);
            // The hour's grade: darks and lights each lean their own way (Parrish).
            const lo = float(1.0).sub(smoothstep(0.0, 0.32, L));
            T.assign(mix(T, T.mul(this.uGradeShadow).add(this.uGradeShadow.sub(0.9).mul(0.004)), lo.mul(0.6)));
            const hi = smoothstep(0.45, 1.0, L);
            T.mulAssign(mix(vec3(1.0), this.uGradeLight, hi.mul(0.6)));
            // A touch of saturation the front light needs (no contre-jour haze to carry it).
            T.assign(mix(vec3(luma(T)), T, 1.08));
            // Vignette, measured from the frame.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.5, 1.2, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.28)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = hash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.011).mul(float(1.0).sub(calm.mul(0.7))));
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
            } else if (values) {
                // The value study: L* in five bands (deep < 30, 30–50, 50–70, light > 70, > 90).
                const Y = dot(clamp(T, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
                const Ls = select(Y.greaterThan(0.008856), Y.pow(1 / 3).mul(116.0).sub(16.0), Y.mul(903.3));
                const band = select(Ls.lessThan(30.0), float(0.08), select(
                    Ls.lessThan(50.0),
                    float(0.3),
                    select(Ls.lessThan(70.0), float(0.55), select(Ls.lessThan(90.0), float(0.8), float(1.0))),
                ));
                out = vec4(vec3(band), 1.0);
            }
            return out;
        });

        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = look.fxaa && !falseColor && !values ? fxaa(outputFn()) : outputFn();
        this.pipeline.needsUpdate = true;
    }

    /** Per-frame values (all optional). */
    update({
        flash, iris, bloomBoost, glow, exposure, time, gradeShadow, gradeLight, flare, flareTint, hush,
    } = {}) {
        if (glow !== undefined) {
            this.uGlow.value = glow;
            if (this.bloomNode) this.bloomNode.threshold.value = BLOOM_THRESHOLD - 0.2 * glow;
        }
        if (gradeShadow) this.uGradeShadow.value.set(gradeShadow[0], gradeShadow[1], gradeShadow[2]);
        if (gradeLight) this.uGradeLight.value.set(gradeLight[0], gradeLight[1], gradeLight[2]);
        if (flare) this.uFlare.value.set(flare[0], flare[1], flare[2], flare[3]);
        if (flareTint) this.uFlareTint.value.set(flareTint[0], flareTint[1], flareTint[2]);
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (iris !== undefined) this.uIris.value = iris;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (time !== undefined) this.uTime.value = time;
        if (hush !== undefined) this.uHush.value = hush;
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
