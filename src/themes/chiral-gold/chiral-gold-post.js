/**
 * Chiral Gold — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the hall is authored in scene-linear HDR, so a max-channel knee selects
 * what blooms), one bloom chain (Medium and up) and ONE full-screen pass:
 *
 *   lens fringe (a radial chromatic split that widens toward the corners and jumps on an impact)
 *   → calm zones (what shows through the translucent board card and HUD is soft-clipped and its
 *   bloom attenuated) → bloom → star glints (the bloom dragged along both axes: every hot
 *   highlight on the gold throws a small four-pointed star, as a jeweller's lens does) → rays
 *   (the bloom dragged radially out from behind the board: the four-line strike floods them) →
 *   exposure and event flash → "gold filmic" tone map (hue preserving: amber stays amber and only
 *   the hottest cores roll to ivory) → grade → vignette → sRGB → grain and triangular dither.
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
import { cgHash21, cgLuma, cgMax3 } from './chiral-gold-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (and so no stars or rays). `stars` and `rays`
 * are tap counts (0 = off); `fringe` = the chromatic split (two more scene taps); `msaa` = the
 * scene pass's samples.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.46, bloomResolution: 0.5, stars: 6, rays: 12, fringe: true, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.46, bloomResolution: 0.5, stars: 6, rays: 12, fringe: true, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.44, bloomResolution: 0.45, stars: 5, rays: 10, fringe: true, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.42, bloomResolution: 0.33, stars: 3, rays: 6, fringe: false, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, stars: 0, rays: 0, fringe: false, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, stars: 0, rays: 0, fringe: false, msaa: 0,
    },
});

export const BLOOM_THRESHOLD = 1.6;
export const BLOOM_KNEE = 0.7;
export const BLOOM_RADIUS = 0.26;
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
    name: 'cg_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Gold filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path to
 * ivory for the hottest values, so deep amber stays amber and a glint burns clean.
 */
const goldFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(cgMax3(c), 1e-5);
    const k = float(0.48);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(1.0, 0.975, 0.93).mul(mapped), smoothstep(3.0, 26.0, peak).mul(0.8));
}).setLayout({ name: 'cg_goldFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class ChiralGoldPost {
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
        /** Where the rays come from: the middle of the board, screen UV (y down). */
        this.uHeart = uniform(new THREE.Vector2(0.5, 0.5));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uRays = uniform(0); // 0..1.5
        this.uStreak = uniform(1.0);
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
                // Hue-preserving clamp on the max channel: a per-channel clamp would turn amber
                // yellow and a deep glint olive.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(24.0).div(max(cgMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = cgMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const starTaps = this.bloomNode ? look.stars : 0;
        const rayTaps = this.bloomNode ? look.rays : 0;

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

            // ── Lens fringe: wider toward the corners, and on an impact ──
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            if (look.fringe) {
                const r2 = fromCentre.dot(fromCentre);
                const fringe = r2.mul(0.004).add(this.uKick.mul(0.0022)).mul(float(1.0).sub(calm));
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
            const m = max(cgMax3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.2).add(m.mul(0.18))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom, stars, rays ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const B = vec3(bt.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                if (starTaps > 0) {
                    // The bloom dragged along both axes: a small four-pointed star on every glint.
                    const star = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 1; i <= starTaps; i++) {
                        const o = (i / starTaps) ** 1.6 * 0.085;
                        const w = Math.exp(-3.0 * (i / starTaps));
                        total += 4 * w;
                        star.addAssign(bt.sample(st.add(vec2(o, 0.0))).rgb.mul(w));
                        star.addAssign(bt.sample(st.sub(vec2(o, 0.0))).rgb.mul(w));
                        const oy = this.uAspect.mul(o * 0.8);
                        star.addAssign(bt.sample(st.add(vec2(0.0, oy))).rgb.mul(w));
                        star.addAssign(bt.sample(st.sub(vec2(0.0, oy))).rgb.mul(w));
                    }
                    glare.addAssign(star.mul(1 / total).mul(vec3(1.0, 0.9, 0.72)).mul(this.uStreak).mul(1.1));
                }
                if (rayTaps > 0) {
                    // The bloom dragged out from behind the board: light streaming past its edges.
                    const toHeart = this.uHeart.sub(st);
                    const jitter = cgHash21(floor(screenCoordinate).add(vec2(3.0, 71.0)));
                    const rays = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 0; i < rayTaps; i++) {
                        const w = 1 - (i / rayTaps) * 0.75;
                        total += w;
                        const f = jitter.add(i).div(rayTaps).mul(0.8);
                        rays.addAssign(bt.sample(st.add(toHeart.mul(f))).rgb.mul(w));
                    }
                    glare.addAssign(rays.mul(1 / total).mul(this.uRays));
                }
                glare.mulAssign(float(1.0).sub(calm.mul(0.88)));
            }
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.3)));
            const T = goldFilmic(X).toVar();
            const L = cgLuma(T);
            // The dark is not grey: what little light there is in the shadows is amber.
            const lo = float(1.0).sub(smoothstep(0.0, 0.28, L));
            T.assign(mix(T, T.mul(vec3(1.1, 0.98, 0.84)).add(vec3(0.0016, 0.0009, 0.0003)), lo.mul(0.55)));
            T.assign(mix(vec3(cgLuma(T)), T, 1.08));
            // Vignette, measured from the frame.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.08, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.36)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = cgHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.014).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = cgHash21(pxi).add(cgHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = cgMax3(H);
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
        heart, flash, kick, bloomBoost, exposure, rays, streak, time,
    } = {}) {
        if (heart) this.uHeart.value.set(heart.x, heart.y);
        if (flash !== undefined) this.uFlash.value = flash;
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (rays !== undefined) this.uRays.value = rays;
        if (streak !== undefined) this.uStreak.value = streak;
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
