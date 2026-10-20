/**
 * High Coast — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT; 4× MSAA from High up, `params.samples` from shared/scene-antialias.js,
 * so the islands, the tree lines and the pine's needles step smoothly against the bright sea and
 * sky), one bloom chain (Medium and up), sun shafts (High and up: a short double march toward the
 * sun's place on screen over the sky the land has not covered), and ONE full-screen output pass:
 *
 *   calm zones (what shows through the translucent board card and HUD is soft-clipped and its
 *   bloom held back) → bloom + shafts → exposure (the hour's) → filmic (a hue-preserving shoulder
 *   on the max channel; only the hottest values roll toward white) → grade (warm lights, cool
 *   shadows, a touch of saturation) → vignette → sRGB → grain and dither → FXAA (Low, Medium:
 *   the single-sampled tiers).
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    clamp,
    exp,
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
import { sceneSamples } from '../shared/scene-antialias.js';
import { hcHash21, hcLuma, hcMax3 } from './high-coast-tsl.js';
import { flashScale } from '../../utils/photosensitivity.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode; `shafts` the sun's shafts; `msaa` the scene
 * pass's samples with the game's antialiasing on (the shared table); `fxaa` smooths a
 * single-sampled pass (the MSAA tiers need none).
 */
const LOOKS = {
    Extreme: {
        bloom: true, bloomStrength: 0.34, bloomResolution: 0.5, shafts: true, fxaa: false,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.34, bloomResolution: 0.5, shafts: true, fxaa: false,
    },
    High: {
        bloom: true, bloomStrength: 0.32, bloomResolution: 0.45, shafts: true, fxaa: false,
    },
    Medium: {
        bloom: true, bloomStrength: 0.3, bloomResolution: 0.33, shafts: false, fxaa: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: false, fxaa: true,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: false, fxaa: false,
    },
};
export const POST_LOOK = Object.freeze(Object.fromEntries(Object.entries(LOOKS)
    .map(([tier, look]) => [tier, { ...look, msaa: sceneSamples(tier) }])));

export const BLOOM_THRESHOLD = 1.05;
export const BLOOM_KNEE = 0.45;
export const BLOOM_RADIUS = 0.55;
/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'hc_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Filmic: identity below the knee, a hue-preserving exponential shoulder above it, and a path to
 * white only for the hottest values (the sun's disc, a flash), so a sunlit red face stays red.
 */
const hcFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max(c.x, max(c.y, c.z)), 1e-5);
    const k = float(0.62);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const w = smoothstep(2.2, 9.0, peak).mul(0.9);
    return mix(toned, vec3(mapped, mapped, mapped), w);
}).setLayout({ name: 'hc_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class HighCoastPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {number} [params.samples=0] the scene pass's MSAA samples (shared/scene-antialias.js)
     * @param {boolean} [params.antialias=true] the game's antialiasing setting (off: no FXAA either)
     * @param {boolean} [params.falseColor=false]
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.samples = params.samples ?? 0;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = look.shafts ? this.scenePass.getTextureNode('depth') : null;

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(1);
        this.uBloomBoost = uniform(0);
        /** The sun on screen: (x, y in UV, on-screen 0..1, strength). */
        this.uSun = uniform(new THREE.Vector4(0.2, 0.3, 0, 0));
        this.uShaftColour = uniform(new THREE.Vector3(1, 0.8, 0.6));
        /** A flash of light over the whole frame (four lines, perfect clear), 0..1. */
        this.uFlash = uniform(0);
        this.uFlashColour = uniform(new THREE.Vector3(1, 0.9, 0.75));
        /** Saturation of the grade (rain deepens it). */
        this.uSaturation = uniform(1.06);

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
                // Hue-preserving clamp on the max channel: a per-channel clamp turns a red sun yellow.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(6.0).div(max(hcMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = hcMax3(c);
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
            for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
                const r = this.uCalm[i];
                const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            const S = vec3(sceneColor.sample(screenUV).rgb).toVar();

            // ── Sun shafts: two short marches toward the sun over the open sky ──
            const shafts = vec3(0.0).toVar();
            if (sceneDepth) {
                If(this.uSun.w.greaterThan(0.01), () => {
                    const toSun = this.uSun.xy.sub(screenUV);
                    const reach = length(toSun.mul(vec2(this.uAspect, 1.0)));
                    const sum = float(0.0).toVar();
                    const N = 14;
                    Loop(N, ({ i }) => {
                        const f = float(i).add(hcHash21(screenCoordinate.xy).mul(0.9)).div(N).mul(0.72);
                        const at = screenUV.add(toSun.mul(f));
                        const d = sceneDepth.sample(at).r;
                        const open = step(0.99999, d);
                        const bright = hcMax3(vec3(sceneColor.sample(at).rgb));
                        // Only the sun's neighbourhood emits.
                        const near = exp(length(this.uSun.xy.sub(at).mul(vec2(this.uAspect, 1.0))).mul(-5.5));
                        sum.addAssign(open.mul(min(bright, 6.0)).mul(near).mul(float(1.0).sub(float(i).div(N).mul(0.6))));
                    });
                    const fall = exp(reach.mul(-1.6));
                    shafts.assign(this.uShaftColour.mul(sum.div(N)).mul(this.uSun.w).mul(fall).mul(0.32));
                });
            }

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(hcMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.18).add(m.mul(0.08)), 0.5)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.88)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.8))));
            }
            glare.addAssign(shafts);
            glare.mulAssign(float(1.0).sub(calm.mul(0.85)));
            const H = S.add(glare);

            // ── Exposure, flash, tone map, grade ──
            const flash = this.uFlashColour.mul(this.uFlash.mul(0.35)).mul(float(1.0).sub(calm.mul(0.8)));
            const X = H.mul(this.uExposure).add(flash);
            const T = hcFilmic(X).toVar();
            const L = hcLuma(T);
            // Shadows lean cool, lights warm: the northern summer's light.
            const lo = float(1.0).sub(smoothstep(0.0, 0.3, L));
            T.assign(mix(T, T.mul(vec3(0.92, 0.97, 1.1)).add(vec3(0.004, 0.006, 0.012)), lo.mul(0.65)));
            const hi = smoothstep(0.45, 0.95, L);
            T.assign(mix(T, T.mul(vec3(1.04, 1.0, 0.95)), hi.mul(0.5)));
            T.assign(max(mix(vec3(hcLuma(T)), T, this.uSaturation), vec3(0.0)));
            // A gentle contrast curve (clamped first: a polynomial folds values above 1 back down).
            const C = clamp(T, 0.0, 1.0);
            T.assign(mix(C, C.mul(C).mul(float(3.0).sub(C.mul(2.0))), 0.42));
            // Vignette, measured from the frame.
            const cv = screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.15, length(cv.mul(1.45)));
            T.mulAssign(float(1.0).sub(vig.mul(0.38)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = hcHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.012).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = hcHash21(pxi).add(hcHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = hcMax3(H.mul(this.uExposure));
                const fc = select(
                    mx.lessThan(0.1),
                    vec3(0.05, 0.1, 0.6),
                    select(mx.lessThan(0.62), vec3(0.1, 0.55, 0.15), select(
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
        // FXAA only over a single-sampled pass, and never over the false-colour view.
        const smooth = look.fxaa && this.samples === 0 && params.antialias !== false && !falseColor;
        this.fxaaNode = smooth ? fxaa(outputFn()) : null;
        this.pipeline.outputNode = this.fxaaNode || outputFn();
        this.pipeline.needsUpdate = true;
    }

    /** Per-frame values (all optional). */
    update({
        exposure, bloomBoost, sun, shaftColour, flash, flashColour, saturation, time,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (sun) this.uSun.value.set(sun.x, sun.y, sun.onScreen, sun.strength);
        if (shaftColour) this.uShaftColour.value.set(shaftColour[0], shaftColour[1], shaftColour[2]);
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (flashColour) this.uFlashColour.value.set(flashColour[0], flashColour[1], flashColour[2]);
        if (saturation !== undefined) this.uSaturation.value = saturation;
        if (time !== undefined) this.uTime.value = time;
        if (this.bloomNode && exposure !== undefined) {
            // The knee follows the iris: bloom selects what is bright AFTER exposure.
            this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, exposure);
        }
    }

    /**
     * Calm rects in screen fractions (x0, y0, x1, y1; y down), at most CALM_RECTS_MAX, and the
     * eased strength (0 = off).
     */
    setCalmRects(rects, strength) {
        for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
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
        // FXAA reads the graded picture through a render target of its own.
        this.fxaaNode?.textureNode?.dispose?.();
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.fxaaNode = null;
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
