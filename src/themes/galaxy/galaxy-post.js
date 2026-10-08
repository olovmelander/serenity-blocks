/**
 * Galaxy — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the galaxy is authored in scene-linear HDR, so a max-channel knee
 * selects what blooms; no MSAA: nothing in it has a hard edge), one bloom chain (Medium and up)
 * and ONE full-screen pass:
 *
 *   space ripple (a four-line clear sends a ring out from the nucleus that bends the picture as
 *   it passes, like a lens sliding across it) → lens fringe (a radial chromatic split that widens
 *   toward the corners, on an impact and along the ripple's front) → calm zones (what shows
 *   through the translucent board card and HUD is soft-clipped and its bloom attenuated) → bloom
 *   → core rays (the bloom dragged radially out of the nucleus when it is charged) → exposure and
 *   event flash → "star filmic" tone map (hue preserving, the hottest cores roll to white) →
 *   grade (cool, slightly lifted shadows, a saturation lift) → vignette → sRGB → grain and
 *   triangular dither.
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
import { gxHash21, gxLuma, gxMax3 } from './galaxy-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (and so no rays). `rays` is a tap count
 * (0 = off); `fringe` = the chromatic split (two more scene taps); `ripple` = the space ripple.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.7, bloomResolution: 0.5, rays: 12, fringe: true, ripple: true, msaa: 0,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.7, bloomResolution: 0.5, rays: 10, fringe: true, ripple: true, msaa: 0,
    },
    High: {
        bloom: true, bloomStrength: 0.68, bloomResolution: 0.45, rays: 8, fringe: true, ripple: true, msaa: 0,
    },
    Medium: {
        bloom: true, bloomStrength: 0.62, bloomResolution: 0.33, rays: 5, fringe: false, ripple: true, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, fringe: false, ripple: true, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, fringe: false, ripple: false, msaa: 0,
    },
});

export const BLOOM_THRESHOLD = 1.05;
export const BLOOM_KNEE = 0.4;
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
    name: 'gx_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Star filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path to
 * white for the hottest values, so a magenta nova stays magenta and only its heart burns clean.
 */
const starFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(gxMax3(c), 1e-5);
    const k = float(0.5);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.8, 9.0, peak).mul(0.78));
}).setLayout({ name: 'gx_starFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class GalaxyPost {
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
        this.scenePass = pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        /** The nucleus on screen, UV (y down): where the rays and the ripple come from. */
        this.uHeart = uniform(new THREE.Vector2(0.28, 0.45));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uRays = uniform(0.1); // core rays, 0..1.5
        this.uBloomBoost = uniform(0);
        /** The space ripple: (radius in screen heights, strength 0..1). */
        this.uRipple = uniform(new THREE.Vector2(0, 0));

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
                // magenta nova white and a gold one yellow-green.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(gxMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = gxMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const rayTaps = this.bloomNode ? look.rays : 0;

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

            // ── Space ripple: the picture bends as the ring passes ──
            const st = vec2(screenUV).toVar();
            const bend = float(0.0).toVar();
            if (look.ripple) {
                If(this.uRipple.y.greaterThan(0.002), () => {
                    const away = screenUV.sub(this.uHeart).mul(aspect).toVar();
                    const dist = max(length(away), 1e-4).toVar();
                    const k = dist.sub(this.uRipple.x).div(0.055).toVar();
                    // Pushed out ahead of the ring, pulled in behind it.
                    const profile = k.mul(exp(k.mul(k).mul(-1.6))).toVar();
                    const push = profile.mul(this.uRipple.y).mul(0.028).mul(float(1.0).sub(calm.mul(0.8)));
                    st.subAssign(away.div(dist).mul(push).div(aspect));
                    bend.assign(abs(profile).mul(this.uRipple.y));
                });
            }
            const fromCentre = st.sub(0.5);

            // ── Lens fringe: wider toward the corners, on an impact, along the ripple ──
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            if (look.fringe) {
                const r2 = fromCentre.dot(fromCentre);
                const fringe = r2.mul(0.0045).add(this.uKick.mul(0.0045)).add(bend.mul(0.006))
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
            const m = max(gxMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.16).add(m.mul(0.08)), 0.5)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom and core rays ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const B = vec3(bt.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                if (rayTaps > 0) {
                    // The bloom dragged out of the nucleus: its light, streaming.
                    const toHeart = this.uHeart.sub(st);
                    const jitter = gxHash21(floor(screenCoordinate).add(vec2(3.0, 71.0)));
                    const rays = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 0; i < rayTaps; i++) {
                        const w = 1 - (i / rayTaps) * 0.8;
                        total += w;
                        const f = jitter.add(i).div(rayTaps).mul(0.62);
                        rays.addAssign(bt.sample(st.add(toHeart.mul(f))).rgb.mul(w));
                    }
                    const reach = float(1.0).sub(smoothstep(0.0, 0.9, length(toHeart.mul(aspect))));
                    glare.addAssign(rays.mul(1 / total).mul(this.uRays).mul(reach));
                }
                glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            }
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = starFilmic(X).toVar();
            const L = gxLuma(T);
            // Cool, slightly lifted shadows (the void is never a flat black); the lights keep their hues.
            const lo = float(1.0).sub(smoothstep(0.0, 0.28, L));
            T.assign(mix(T, T.mul(vec3(0.94, 0.95, 1.12)).add(vec3(0.0012, 0.0007, 0.0034)), lo.mul(0.5)));
            T.assign(mix(vec3(gxLuma(T)), T, 1.12));
            // Vignette, measured from the frame, a touch heavier in the corners.
            const cv = screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.08, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.38)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = gxHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.016).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = gxHash21(pxi).add(gxHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = gxMax3(H);
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
        heart, flash, kick, bloomBoost, exposure, rays, ripple, time,
    } = {}) {
        if (heart) this.uHeart.value.set(heart.x, heart.y);
        if (flash !== undefined) this.uFlash.value = flash;
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (rays !== undefined) this.uRays.value = rays;
        if (ripple) this.uRipple.value.set(ripple.radius, ripple.strength);
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
