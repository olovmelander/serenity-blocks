/**
 * Stellar Velocity — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the scene is authored in scene-linear HDR, so a max-channel knee
 * selects what blooms; no MSAA: nothing in it has a hard edge), one bloom chain (Medium and up)
 * and ONE full-screen pass:
 *
 *   the rush (the picture drawn out along the lines that run from the sun, more the faster we
 *   go: a zoom's motion blur) → lens fringe (a radial chromatic split that widens toward the
 *   corners, at speed and on a kick) → calm zones (what shows through the translucent board
 *   card and HUD is soft-clipped and its bloom attenuated) → bloom → sun shafts (the bloom
 *   dragged out of the sun, so its light comes down the canyon between the clouds) → exposure
 *   and the event flash, in the colour of what made it → "starlight filmic" tone map (hue
 *   preserving, so a hoop keeps its colour and only the sun's heart burns clean) → grade →
 *   vignette → sRGB → grain and triangular dither.
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
import { svHash21, svLuma, svMax3 } from './stellar-velocity-tsl.js';
import { flashScale } from '../../utils/photosensitivity.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (and so no shafts). `rays` and `rush` are
 * tap counts (0 = off); `fringe` = the chromatic split (two more scene taps).
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.6, bloomResolution: 0.5, rays: 14, rush: 10, fringe: true,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.6, bloomResolution: 0.5, rays: 12, rush: 8, fringe: true,
    },
    High: {
        bloom: true, bloomStrength: 0.58, bloomResolution: 0.45, rays: 10, rush: 7, fringe: true,
    },
    Medium: {
        bloom: true, bloomStrength: 0.54, bloomResolution: 0.33, rays: 6, rush: 5, fringe: false,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, rush: 4, fringe: false,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, rush: 0, fringe: false,
    },
});

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.62;
export const EXPOSURE = 1.0;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'sv_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Starlight filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a
 * path to white for the brightest values only, so a hoop stays its colour, the starbow keeps its
 * bands, and just the sun's heart burns clean.
 */
const starlightFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(svMax3(c), 1e-5);
    const k = float(0.42);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.8, 9.0, peak).mul(0.78));
}).setLayout({ name: 'sv_starlightFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class StellarVelocityPost {
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
        /** The sun on screen, UV (y down). */
        this.uHeart = uniform(new THREE.Vector2(0.23, 0.45));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uFlashTint = uniform(new THREE.Vector3(1, 1, 1));
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uRays = uniform(0.12); // sun shafts, 0..1
        this.uRush = uniform(0); // the zoom's blur, 0..1
        this.uBloomBoost = uniform(0);

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
                // saturated hoop toward white.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(svMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = svMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const rayTaps = this.bloomNode ? look.rays : 0;
        const rushTaps = look.rush;

        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);
            const aspect = vec2(this.uAspect, 1.0);

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

            const st = screenUV;
            const toHeart = this.uHeart.sub(st).toVar();
            const dist = length(toHeart.mul(aspect)).toVar();
            const jitter = svHash21(floor(screenCoordinate).add(vec2(3.0, 71.0))).toVar();
            const fromCentre = st.sub(0.5);

            // ── The rush: the picture drawn out along the lines from the sun ──
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            if (rushTaps > 0) {
                const rush = this.uRush.mul(float(1.0).sub(calm.mul(0.85))).toVar();
                If(rush.greaterThan(0.004), () => {
                    // Nothing moves at the sun itself; out at the edge a point covers a tenth
                    // of its way to it in a shutter's time.
                    const reach = rush.mul(0.1).mul(smoothstep(0.0, 0.5, dist));
                    const sum = vec3(S).toVar();
                    let total = 1;
                    for (let i = 0; i < rushTaps; i++) {
                        const w = 1 - (i / rushTaps) * 0.6;
                        total += w;
                        const f = jitter.add(i).div(rushTaps).mul(reach);
                        sum.addAssign(sceneColor.sample(st.add(toHeart.mul(f))).level(0).rgb.mul(w));
                    }
                    S.assign(sum.mul(1 / total));
                });
            }

            // ── Lens fringe: wider toward the corners, at speed, on a kick ──
            if (look.fringe) {
                const r2 = fromCentre.dot(fromCentre);
                const fringe = r2.mul(float(0.0035).add(this.uRush.mul(0.008))).add(this.uKick.mul(0.004))
                    .mul(float(1.0).sub(calm));
                If(fringe.greaterThan(2e-4), () => {
                    const spread = fromCentre.mul(fringe);
                    S.assign(vec3(
                        sceneColor.sample(st.sub(spread)).level(0).r,
                        S.g,
                        sceneColor.sample(st.add(spread)).level(0).b,
                    ));
                });
            }

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(svMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.16).add(m.mul(0.08)), 0.5)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom and the sun's shafts ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const B = vec3(bt.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                if (rayTaps > 0) {
                    // The bloom dragged out of the sun: where a cloud stands in its way there is
                    // a shadow down the canyon, and light between.
                    const rays = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 0; i < rayTaps; i++) {
                        const w = 1 - (i / rayTaps) * 0.75;
                        total += w;
                        const f = jitter.add(i).div(rayTaps).mul(0.72);
                        rays.addAssign(bt.sample(st.add(toHeart.mul(f))).rgb.mul(w));
                    }
                    const reach = float(1.0).sub(smoothstep(0.0, 1.25, dist));
                    glare.addAssign(rays.mul(1 / total).mul(this.uRays).mul(reach).mul(1.6));
                }
                glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            }
            const H = S.add(glare);

            // ── Tone map + grade ──
            const lift = this.uFlashTint.mul(this.uFlash.mul(0.5)).mul(float(1.0).sub(calm.mul(0.7)));
            // A flash lifts the whole frame a little and lays its colour on the edges, where a
            // hoop has just gone past.
            const edge = smoothstep(0.15, 0.75, length(fromCentre.mul(aspect).mul(vec2(0.62, 1.0))));
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.3)))
                .add(lift.mul(edge.mul(0.5).add(0.04)));
            const T = starlightFilmic(X).toVar();
            const L = svLuma(T);
            // Cool, slightly lifted shadows (space is never a flat black); the lights keep their hues.
            const lo = float(1.0).sub(smoothstep(0.0, 0.24, L));
            T.assign(mix(T, T.mul(vec3(0.94, 0.97, 1.1)).add(vec3(0.0008, 0.0009, 0.0026)), lo.mul(0.5)));
            T.assign(mix(vec3(svLuma(T)), T, 1.12));
            // Vignette, measured from the frame, a touch heavier in the corners.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.08, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.36)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = svHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.014).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = svHash21(pxi).add(svHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = svMax3(H);
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
        heart, flash, flashTint, kick, bloomBoost, exposure, rays, blur, time,
    } = {}) {
        if (heart) this.uHeart.value.set(heart.x, heart.y);
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (flashTint) this.uFlashTint.value.set(flashTint[0], flashTint[1], flashTint[2]);
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) {
            this.uExposure.value = exposure;
            // The bloom's knee follows the iris: at speed the sky must not bloom into a veil.
            if (this.bloomNode) this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, exposure);
        }
        if (rays !== undefined) this.uRays.value = rays;
        if (blur !== undefined) this.uRush.value = blur;
        if (time !== undefined) this.uTime.value = time;
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
