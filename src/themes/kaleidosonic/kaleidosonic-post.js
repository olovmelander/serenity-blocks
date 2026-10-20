/**
 * Kaleidosonic — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT, no MSAA: the temple is one full-screen march), one bloom chain (Medium
 * and up) and ONE full-screen output pass:
 *
 *   chromatic fringe (the temple resonating splits its light a few pixels outward from the
 *   lens's axis; held back inside the calm zones) → calm zones (what shows through the
 *   translucent board card and HUD is soft-clipped and its bloom held back) → bloom → exposure
 *   (the mood's) → filmic (a hue-preserving shoulder on the max channel; only the hottest values
 *   roll toward white) → grade (violet shadows, warm lights, the trance's saturation) →
 *   vignette → sRGB → grain and dither.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
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
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { ksHash21, ksLuma, ksMax3 } from './kaleidosonic-tsl.js';
import { flashScale } from '../../utils/photosensitivity.js';

/** Per-tier look. `bloom: false` builds no BloomNode; `fringe` the resonance's colour split. */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.42, bloomResolution: 0.5, fringe: true,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.42, bloomResolution: 0.5, fringe: true,
    },
    High: {
        bloom: true, bloomStrength: 0.4, bloomResolution: 0.45, fringe: true,
    },
    Medium: {
        bloom: true, bloomStrength: 0.36, bloomResolution: 0.33, fringe: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, fringe: false,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, fringe: false,
    },
});

export const BLOOM_THRESHOLD = 0.9;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.62;
/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'ks_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Filmic: identity below the knee, a hue-preserving exponential shoulder above it, and a path to
 * white only for the hottest values (the core's heart, a flash), so a magenta glow stays magenta.
 */
const ksFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max(c.x, max(c.y, c.z)), 1e-5);
    const k = float(0.62);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const w = smoothstep(2.2, 9.0, peak).mul(0.9);
    return mix(toned, vec3(mapped, mapped, mapped), w);
}).setLayout({ name: 'ks_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class KaleidosonicPost {
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
        this.uExposure = uniform(1);
        this.uBloomBoost = uniform(0);
        /** The chromatic fringe, in pixels at the frame's corner (0 = none). */
        this.uFringe = uniform(0);
        /** A flash of light over the whole frame (four lines, perfect clear), 0..1. */
        this.uFlash = uniform(0);
        this.uFlashColour = uniform(new THREE.Vector3(1, 0.9, 0.75));
        /** Saturation of the grade (the trance deepens it). */
        this.uSaturation = uniform(1.1);

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
                // Hue-preserving clamp on the max channel: a per-channel clamp turns a rose core white-yellow.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(6.0).div(max(ksMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = ksMax3(c);
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
            if (look.fringe) {
                // The resonance splits the light outward from the lens's axis (the frame's centre).
                const off = screenUV.sub(0.5).mul(this.uSrcTexel.mul(this.uFringe).mul(2.0))
                    .mul(float(1.0).sub(calm.mul(0.9)));
                If(this.uFringe.greaterThan(0.05), () => {
                    S.assign(vec3(
                        sceneColor.sample(screenUV.add(off)).r,
                        S.y,
                        sceneColor.sample(screenUV.sub(off)).b,
                    ));
                });
            }

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(ksMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.18).add(m.mul(0.08)), 0.5)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.88)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.8))));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.85)));
            const H = S.add(glare);

            // ── Exposure, flash, tone map, grade ──
            const flash = this.uFlashColour.mul(this.uFlash.mul(0.1)).mul(float(1.0).sub(calm.mul(0.8)));
            const X = H.mul(this.uExposure).add(flash);
            const T = ksFilmic(X).toVar();
            const L = ksLuma(T);
            // Shadows lean a touch cool, lights warm; nothing is ADDED to the blacks (a black-light
            // poster's darks stay black, each mood's own fog gives them their colour).
            const lo = float(1.0).sub(smoothstep(0.0, 0.3, L));
            T.assign(mix(T, T.mul(vec3(0.97, 0.94, 1.05)), lo.mul(0.5)));
            const hi = smoothstep(0.45, 0.95, L);
            T.assign(mix(T, T.mul(vec3(1.04, 1.0, 0.95)), hi.mul(0.5)));
            T.assign(max(mix(vec3(ksLuma(T)), T, this.uSaturation), vec3(0.0)));
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
            const grain = ksHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.012).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = ksHash21(pxi).add(ksHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = ksMax3(H.mul(this.uExposure));
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
        this.pipeline.outputNode = outputFn();
        this.pipeline.needsUpdate = true;
    }

    /** Per-frame values (all optional). */
    update({
        exposure, bloomBoost, fringe, flash, flashColour, saturation, time,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (fringe !== undefined) this.uFringe.value = fringe;
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
