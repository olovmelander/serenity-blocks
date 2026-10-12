/**
 * Painted Ages — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the scene is authored in scene-linear HDR, so a max-channel knee
 * selects what blooms; MSAA on the tiers that can afford it, for the ridges’ silhouettes), one
 * bloom chain (Medium and up: wet glints and the sunlit edges of distant rain) and ONE output pass:
 *
 *   calm zones (what shows through the translucent board card and HUD is desaturated toward its
 *   luma and soft-clipped, and its bloom and grain attenuated) → bloom → exposure and the iris
 *   → the house filmic (hue preserving, so the rock keeps its colour and only the sun's glints
 *   burn clean) → grade (shadows toward lavender, highlights toward its light, the
 *   zone's saturation) → vignette → sRGB → grain and dither → FXAA on the tiers without MSAA.
 *
 * No shafts, rush, fringe or heat distortion. Tone mapping happens exactly once:
 * renderer.toneMapping = NoToneMapping and the pipeline's outputColorTransform is off (the output
 * node encodes sRGB itself).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    dot,
    exp,
    fract,
    sin,
    clamp,
    float,
    floor,
    length,
    max,
    min,
    mix,
    pass,
    renderOutput,
    screenCoordinate,
    screenUV,
    select,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

const paPostMax3 = Fn(([c]) => max(c.r, max(c.g, c.b))).setLayout({
    name: 'paPost_max3', type: 'float', inputs: [{ name: 'c', type: 'vec3' }],
});
const paPostLuma = Fn(([c]) => dot(c, vec3(0.2126, 0.7152, 0.0722))).setLayout({
    name: 'paPost_luma', type: 'float', inputs: [{ name: 'c', type: 'vec3' }],
});
const paPostHash21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453))).setLayout({
    name: 'paPost_hash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }],
});
const paPostRoundBoxSdf = Fn(([p, rect, radius]) => {
    const q = abs(p.sub(rect.xy.add(rect.zw).mul(0.5))).sub(rect.zw.sub(rect.xy).mul(0.5)).add(radius);
    return length(max(q, vec2(0))).add(min(max(q.x, q.y), 0)).sub(radius);
}).setLayout({
    name: 'paPost_roundBoxSdf',
    type: 'float',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' },
    ],
});
/** Daylight shoulder keeps the mineral hue and only whitens the strongest water glints. */
const paPostFilmic = Fn(([cIn]) => {
    const c = max(cIn, vec3(0));
    const peak = max(paPostMax3(c), 0.00001);
    const shoulder = float(0.55).add(float(0.45).mul(float(1).sub(exp(max(peak.sub(0.55), 0).div(-0.45)))));
    const mapped = select(peak.greaterThan(0.55), shoulder, peak);
    // A single-argument vec3(SelectNode) can fold back to a scalar in r186's WGSL builder.
    return mix(c.mul(mapped.div(peak)), vec3(mapped, mapped, mapped), smoothstep(2.5, 10, peak).mul(0.18));
}).setLayout({ name: 'paPost_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

/**
 * Per-tier look. `bloom: false` builds no BloomNode; `msaa` = four samples in the scene pass;
 * `fxaa` wraps the output pass where there is no MSAA to smooth the ridges’ edges.
 */
export const POST_LOOK = Object.freeze({
    Minimal: Object.freeze({
        msaa: false, fxaa: false, bloom: false, bloomStrength: 0, bloomResolution: 0.25,
    }),
    Low: Object.freeze({
        msaa: false, fxaa: true, bloom: false, bloomStrength: 0, bloomResolution: 0.25,
    }),
    Medium: Object.freeze({
        msaa: false, fxaa: true, bloom: true, bloomStrength: 0.45, bloomResolution: 0.33,
    }),
    High: Object.freeze({
        msaa: true, fxaa: false, bloom: true, bloomStrength: 0.5, bloomResolution: 0.45,
    }),
    Ultra: Object.freeze({
        msaa: true, fxaa: false, bloom: true, bloomStrength: 0.55, bloomResolution: 0.5,
    }),
    Extreme: Object.freeze({
        msaa: true, fxaa: false, bloom: true, bloomStrength: 0.55, bloomResolution: 0.5,
    }),
});

/** The knee is divided by the exposure (times the iris): it follows what the eye adapts to. */
export const BLOOM_THRESHOLD = 1.55;
export const BLOOM_KNEE = 0.35;
export const BLOOM_RADIUS = 0.55;
export const EXPOSURE = 1.0;
/** The grain's strength, and the vignette's. */
const GRAIN = 0.004;
const VIGNETTE = 0.13;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

export class PaintedAgesPost {
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
        this.scenePass = pass(scene, camera, { samples: look.msaa ? 4 : 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uIris = uniform(1);
        this.uSat = uniform(1.06);
        this.uBloomBoost = uniform(0);
        // The morning grade (linear rgb), written by the world each frame.
        this.uGradeShadow = uniform(new THREE.Vector3(0.055, 0.042, 0.093));
        this.uGradeLight = uniform(new THREE.Vector3(1.0, 0.95, 0.86));

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
                // Hue-preserving clamp on the max channel: a per-channel clamp would turn a
                // saturated mineral band toward white.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(paPostMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = paPostMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;

        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);

            // ── Calm zones (board cards + HUD) ──
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i++) {
                const r = this.uCalm[i];
                const sdf = paPostRoundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            const st = screenUV;
            const fromCentre = st.sub(0.5);
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            // What shows through the card is desaturated toward its luma and soft-clipped
            // (hue-preserving on the max channel).
            const quiet = mix(S, vec3(paPostLuma(S)), 0.4).toVar();
            const m = max(paPostMax3(quiet), 1e-5);
            const clipped = quiet.mul(min(m, float(0.3).add(m.mul(0.12))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.85)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))).mul(float(1.0).sub(calm.mul(0.85))));
            }
            const H = S.add(glare);

            // ── Exposure, iris, tone map, grade ──
            const X = H.mul(this.uExposure.mul(this.uIris)).toVar();
            const T = paPostFilmic(X).toVar();
            const L = clamp(paPostLuma(T), 0.0, 1.0).toVar();
            const dark = float(1.0).sub(L);
            T.assign(mix(T, this.uGradeShadow, dark.mul(dark).mul(0.07)));
            T.assign(mix(T, this.uGradeLight, L.mul(L).mul(0.035)));
            T.assign(mix(vec3(paPostLuma(T)), T, this.uSat));
            // Vignette, measured from the frame; light, for a high-key world.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.5, 1.1, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(VIGNETTE)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = paPostHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(GRAIN).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = paPostHash21(pxi).add(paPostHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                // Bands of the exposed, pre-tone-map max channel: what reaches the bloom's knee.
                const mx = paPostMax3(X);
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

    /** Per-frame values (all optional). `gradeShadow` and `gradeLight` are linear rgb triples. */
    update({
        exposure, iris, sat, bloomBoost, time, gradeShadow, gradeLight,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (iris !== undefined) this.uIris.value = iris;
        if (exposure !== undefined || iris !== undefined) {
            // The bloom's knee follows the iris: a brighter frame must not bloom into a veil.
            const seen = this.uExposure.value * this.uIris.value;
            if (this.bloomNode) this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, seen);
        }
        if (sat !== undefined) this.uSat.value = sat;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (time !== undefined) this.uTime.value = time;
        if (gradeShadow) this.uGradeShadow.value.set(gradeShadow[0], gradeShadow[1], gradeShadow[2]);
        if (gradeLight) this.uGradeLight.value.set(gradeLight[0], gradeLight[1], gradeLight[2]);
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
