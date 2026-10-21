/**
 * Pyrestorm — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT; 4× MSAA from High up, shared/scene-antialias.js), one bloom chain
 * (Medium and up) and ONE full-screen output pass:
 *
 *   heat shimmer (the scene read through a small wobble wherever the bloom says something burns
 *   below, so the air over the lava trembles; tiers with bloom) → calm zones (what shows through
 *   the translucent board card and HUD is soft-clipped and its bloom held back) → bloom →
 *   exposure → the four-line / perfect flash (one, eased, small) → filmic (a hue-preserving
 *   shoulder on the max channel; only the hottest values roll toward white) → grade (shadows
 *   lean to the night's violet, the fire stays warm) → vignette → sRGB → grain and dither.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    cos,
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
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { pyHash21, pyLuma, pyMax3 } from './pyrestorm-tsl.js';
import { flashScale } from '../../utils/photosensitivity.js';

export { sceneSamples } from '../shared/scene-antialias.js';

/** Per-tier look. `bloom: false` builds no BloomNode (and so no shimmer, which reads it). */
export const POST_LOOK = Object.freeze({
    Extreme: { bloom: true, bloomStrength: 0.42, bloomResolution: 0.5 },
    Ultra: { bloom: true, bloomStrength: 0.42, bloomResolution: 0.5 },
    High: { bloom: true, bloomStrength: 0.4, bloomResolution: 0.45 },
    Medium: { bloom: true, bloomStrength: 0.38, bloomResolution: 0.33 },
    Low: { bloom: false, bloomStrength: 0, bloomResolution: 0.25 },
    Minimal: { bloom: false, bloomStrength: 0, bloomResolution: 0.25 },
});

export const BLOOM_THRESHOLD = 0.9;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.6;
/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'py_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Filmic: identity below the knee, a hue-preserving exponential shoulder above it, and a path to
 * white only for the hottest values (a fountain's heart, a bolt's core), so lava stays orange.
 */
const pyFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max(c.x, max(c.y, c.z)), 1e-5);
    const k = float(0.6);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const w = smoothstep(2.6, 11.0, peak).mul(0.85);
    return mix(toned, vec3(mapped, mapped, mapped), w);
}).setLayout({ name: 'py_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class PyrestormPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {boolean} [params.falseColor=false]
     * @param {number} [params.samples=0]  the scene pass's MSAA (sceneSamples(quality, antialias))
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.pipeline = new THREE.RenderPipeline(renderer);
        // Thin lava threads, bomb arcs and bolts step in single pixels without samples of their own.
        this.scenePass = pass(scene, camera, { samples: Math.max(0, Math.round(params.samples || 0)) });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(1);
        this.uBloomBoost = uniform(0);
        /** A flash over the whole frame (four lines, perfect clear), 0..1. */
        this.uFlash = uniform(0);
        this.uFlashColour = uniform(new THREE.Vector3(1, 0.7, 0.45));
        /** The air's shimmer over the lava (0 still … 1). */
        this.uHeat = uniform(1);
        this.uSaturation = uniform(1.05);

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
                // Hue-preserving clamp on the max channel: a per-channel clamp turns lava yellow.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(pyMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = pyMax3(c);
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

            // ── Heat shimmer: where the bloom (just below this pixel) says something burns ──
            const st = screenUV.toVar();
            if (this.bloomNode) {
                const B0 = vec3(this.bloomNode.getTextureNode().sample(screenUV.add(vec2(0.0, 0.012))).rgb);
                // Only the air low in the frame shimmers (over the near lava): a thin bright thing
                // in the sky (a bomb's arc, a bolt) wobbled by a regular wave reads as a wavy line.
                const low = smoothstep(0.42, 0.7, screenUV.y);
                const hot = smoothstep(0.03, 0.4, pyMax3(B0)).mul(this.uHeat).mul(float(1.0).sub(calm)).mul(low);
                const t = this.uTime;
                // Two incommensurate waves, each bent by a third, so no single period shows.
                const wob = vec2(
                    sin(screenUV.y.mul(310.0).sub(t.mul(7.0)).add(sin(screenUV.x.mul(120.0).add(t.mul(1.3))).mul(1.6)))
                        .add(sin(screenUV.y.mul(173.0).add(screenUV.x.mul(61.0)).sub(t.mul(4.3))).mul(0.7)),
                    cos(screenUV.x.mul(260.0).add(t.mul(5.0)).add(sin(screenUV.y.mul(170.0).sub(t.mul(2.1))).mul(1.4))).mul(0.5),
                );
                st.addAssign(wob.mul(this.uSrcTexel).mul(hot.mul(0.9)));
            }
            const S = vec3(sceneColor.sample(st).rgb).toVar();

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(pyMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.18).add(m.mul(0.08)), 0.5)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.88)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.7))));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.85)));
            const H = S.add(glare);

            // ── Exposure, flash, tone map, grade ──
            const flash = this.uFlashColour.mul(this.uFlash.mul(0.22)).mul(float(1.0).sub(calm.mul(0.85)));
            const X = H.mul(this.uExposure).add(flash);
            const T = pyFilmic(X).toVar();
            const L = pyLuma(T);
            // Shadows lean to the night's violet-blue; the fire keeps its warmth.
            const lo = float(1.0).sub(smoothstep(0.0, 0.22, L));
            T.assign(mix(T, T.mul(vec3(0.9, 0.94, 1.14)).add(vec3(0.0035, 0.003, 0.009)), lo.mul(0.7)));
            const hi = smoothstep(0.35, 0.95, L);
            T.assign(mix(T, T.mul(vec3(1.05, 0.99, 0.92)), hi.mul(0.45)));
            T.assign(max(mix(vec3(pyLuma(T)), T, this.uSaturation), vec3(0.0)));
            // A gentle contrast curve (clamped first: a polynomial folds values above 1 back down).
            const C = clamp(T, 0.0, 1.0);
            T.assign(mix(C, C.mul(C).mul(float(3.0).sub(C.mul(2.0))), 0.22));
            // Vignette, measured from the frame.
            const cv = screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.42, 1.15, length(cv.mul(1.45)));
            T.mulAssign(float(1.0).sub(vig.mul(0.42)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = pyHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.014).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = pyHash21(pxi).add(pyHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = pyMax3(H.mul(this.uExposure));
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
        this.pipeline.outputNode = outputFn();
        this.pipeline.needsUpdate = true;
    }

    /** Per-frame values (all optional). */
    update({
        exposure, bloomBoost, flash, flashColour, heat, saturation, time,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (flashColour) this.uFlashColour.value.set(flashColour[0], flashColour[1], flashColour[2]);
        if (heat !== undefined) this.uHeat.value = heat;
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
