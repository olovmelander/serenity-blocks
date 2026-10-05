/**
 * Ice Temple — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the temple is authored in scene-linear HDR, so a max-channel knee
 * selects what blooms), one bloom chain (Medium and up) and ONE full-screen pass:
 *
 *   frost on the lens (ferns of rime grow in from the corners of the frame as a combo builds,
 *   and bend what is seen through them) → lens fringe (a radial chromatic split that widens on
 *   an impact) → calm zones (what shows through the translucent board card and HUD is
 *   soft-clipped and its bloom attenuated) → bloom → heart rays (the bloom dragged radially out
 *   of the Great Crystal behind the board: its light streaming down the nave through the diamond
 *   dust; a line clear floods them) → a cold anamorphic streak → exposure and event flash →
 *   "glacier filmic" tone map (hue preserving, hot cores roll to white) → grade (deep blue
 *   shadows, a clean cold white) → vignette → sRGB → grain and triangular dither.
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
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import {
    itHash21, itLuma, itMax3, itVoronoi,
} from './ice-temple-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (and so no streak or rays). `streak` and
 * `rays` are tap counts (0 = off); `fringe` = the chromatic split (two more scene taps);
 * `frost` = rime on the lens; `msaa` = scene-pass samples.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.5, bloomResolution: 0.5, streak: 6, rays: 14, fringe: true, frost: true, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.5, bloomResolution: 0.5, streak: 6, rays: 14, fringe: true, frost: true, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.5, bloomResolution: 0.45, streak: 4, rays: 10, fringe: true, frost: true, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.48, bloomResolution: 0.33, streak: 0, rays: 6, fringe: false, frost: true, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, streak: 0, rays: 0, fringe: false, frost: true, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, streak: 0, rays: 0, fringe: false, frost: false, msaa: 0,
    },
});

export const BLOOM_THRESHOLD = 0.92;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.55;
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
    name: 'it_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Glacier filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path
 * to white for the hottest values, so a teal crack stays teal and only its core burns clean.
 */
const glacierFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(itMax3(c), 1e-5);
    const k = float(0.46);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.4, 6.5, peak).mul(0.85));
}).setLayout({ name: 'it_glacierFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class IceTemplePost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look             POST_LOOK entry
     * @param {THREE.Texture} [params.noise]   the temple's baked noise (rime on the lens)
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
        /** The Great Crystal on screen (UV, y down): where the rays come from. */
        this.uHeart = uniform(new THREE.Vector2(0.5, 0.5));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uRays = uniform(0.35); // heart rays, 0..1.5
        this.uStreak = uniform(1.0);
        this.uBloomBoost = uniform(0);
        this.uFrost = uniform(0); // rime on the lens, 0..1
        this.uFrostTint = uniform(new THREE.Vector3(0.7, 0.9, 1.0));

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
                // aurora's green yellow and a teal crack white.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(itMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = itMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const streakTaps = this.bloomNode ? look.streak : 0;
        const rayTaps = this.bloomNode ? look.rays : 0;
        const noiseTex = look.frost ? params.noise || null : null;

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

            // ── Rime on the lens: crystals grow in from the frame's edge, corners first. Each
            // crystal is a facet: it shifts what is seen through it a little, its own way ──
            const rime = float(0.0).toVar();
            const bend = vec2(0.0).toVar();
            if (noiseTex) {
                If(this.uFrost.greaterThan(0.004), () => {
                    const cv = fromCentre.mul(vec2(this.uAspect, 1.0));
                    const n = texture(noiseTex, cv.mul(1.3).add(vec2(0.37, 0.11)));
                    // How far in from the frame: 0 on the edge; the corners count as nearer.
                    const fromEdge = float(1.0).sub(max(abs(fromCentre.x), abs(fromCentre.y)).mul(2.0));
                    const fromCorner = float(1.0).sub(length(fromCentre).mul(1.414)).mul(2.4);
                    const depth = min(fromEdge, fromCorner);
                    const reach = this.uFrost.mul(n.r.mul(0.16).add(0.1));
                    const grown = float(1.0).sub(smoothstep(reach.mul(0.35), reach, depth));
                    If(grown.greaterThan(0.002), () => {
                        const big = itVoronoi(cv.mul(21.0).add(n.gb.mul(1.6)));
                        const small = itVoronoi(cv.mul(58.0).add(n.rg.mul(2.0)));
                        const lines = float(1.0).sub(smoothstep(0.02, 0.09, big.w.sub(big.z)));
                        const hairs = float(1.0).sub(smoothstep(0.02, 0.12, small.w.sub(small.z)));
                        const facet = itHash21(floor(big.xy.mul(3.0)));
                        const keep = float(1.0).sub(calm);
                        rime.assign(grown.mul(lines.mul(0.6).add(hairs.mul(0.3)).add(facet.mul(0.3)).add(0.1)).mul(keep));
                        bend.assign(vec2(facet.sub(0.5), itHash21(floor(big.xy.mul(3.0)).add(9.0)).sub(0.5))
                            .mul(grown)
                            .mul(0.008)
                            .mul(keep));
                    });
                });
            }
            const view = st.add(bend).toVar();

            // ── Lens fringe: wider toward the corners, and on an impact ──
            const S = vec3(sceneColor.sample(view).rgb).toVar();
            if (look.fringe) {
                const r2 = fromCentre.dot(fromCentre);
                const fringe = r2.mul(0.005).add(this.uKick.mul(0.007)).add(rime.mul(0.004)).mul(float(1.0).sub(calm));
                If(fringe.greaterThan(2e-4), () => {
                    const spread = fromCentre.mul(fringe);
                    S.assign(vec3(
                        sceneColor.sample(view.sub(spread)).level(0).r,
                        S.g,
                        sceneColor.sample(view.add(spread)).level(0).b,
                    ));
                });
            }

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(itMax3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.2).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom, rays, streak ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const B = vec3(bt.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                if (rayTaps > 0) {
                    // The bloom dragged out of the Great Crystal: its light, streaming down the nave.
                    const toHeart = this.uHeart.sub(st);
                    const jitter = itHash21(floor(screenCoordinate).add(vec2(3.0, 71.0)));
                    const rays = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 0; i < rayTaps; i++) {
                        const w = 1 - (i / rayTaps) * 0.7;
                        total += w;
                        const f = jitter.add(i).div(rayTaps).mul(0.86);
                        rays.addAssign(bt.sample(st.add(toHeart.mul(f))).rgb.mul(w));
                    }
                    const reach = float(1.0).sub(smoothstep(0.0, 1.05, length(toHeart.mul(vec2(this.uAspect, 1.0)))));
                    glare.addAssign(rays.mul(1 / total).mul(this.uRays).mul(reach.mul(0.75).add(0.25)));
                }
                if (streakTaps > 0) {
                    // A thin cold flare through every hot light, as a cinema lens gives.
                    const streak = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 1; i <= streakTaps; i++) {
                        const o = (i / streakTaps) ** 1.5 * 0.16;
                        const w = Math.exp(-3.2 * (i / streakTaps));
                        total += 2 * w;
                        streak.addAssign(bt.sample(st.add(vec2(o, 0.0))).rgb.mul(w));
                        streak.addAssign(bt.sample(st.sub(vec2(o, 0.0))).rgb.mul(w));
                    }
                    glare.addAssign(streak.mul(1 / total).mul(vec3(0.6, 0.85, 1.2)).mul(this.uStreak).mul(0.45));
                }
                glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            }
            const H = S.add(glare).toVar();
            // The rime scatters what is behind it into a pale veil.
            H.assign(mix(H, H.mul(0.6).add(this.uFrostTint.mul(itLuma(H).mul(0.9).add(0.03))), rime.mul(0.85)));

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = glacierFilmic(X).toVar();
            const L = itLuma(T);
            // Deep blue shadows, lifted a hair (cold air in the lens); the lights keep their hues.
            const lo = float(1.0).sub(smoothstep(0.0, 0.3, L));
            T.assign(mix(T, T.mul(vec3(0.82, 0.96, 1.18)).add(vec3(0.0004, 0.0012, 0.0034)), lo.mul(0.55)));
            T.assign(mix(vec3(itLuma(T)), T, 1.1));
            // Vignette, measured from the frame.
            const cvv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.42, 1.05, length(cvv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.42)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = itHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.018).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = itHash21(pxi).add(itHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = itMax3(H);
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
        heart, flash, kick, bloomBoost, exposure, rays, streak, time, frost, frostTint,
    } = {}) {
        if (heart) this.uHeart.value.set(heart.x, heart.y);
        if (flash !== undefined) this.uFlash.value = flash;
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (rays !== undefined) this.uRays.value = rays;
        if (streak !== undefined) this.uStreak.value = streak;
        if (time !== undefined) this.uTime.value = time;
        if (frost !== undefined) this.uFrost.value = frost;
        if (frostTint) this.uFrostTint.value.set(frostTint[0], frostTint[1], frostTint[2]);
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
