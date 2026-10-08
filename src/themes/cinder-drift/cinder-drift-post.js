/**
 * Cinder Drift — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the chamber is authored in scene-linear HDR, so a max-channel knee
 * selects what blooms), one bloom chain (Medium and up) and ONE full-screen pass:
 *
 *   heat haze (the air over the lake bends what is seen through it; one noise fetch, no extra
 *   scene taps) → lens fringe (a radial chromatic split that widens toward the corners and jumps
 *   on an impact) → calm zones (what shows through the translucent board card and HUD is
 *   soft-clipped and its bloom attenuated) → bloom → fall shafts (the bloom dragged radially out
 *   of the great fall: its light streaming through the smoke; a clear floods them) → exposure
 *   and event flash → "forge filmic" tone map (hue preserving, the hottest cores roll to white)
 *   → grade (cool, slightly lifted shadows under warm lights) → vignette → sRGB → grain and
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
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { cdHash21, cdLuma, cdMax3 } from './cinder-drift-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (and so no shafts). `shafts` is a tap count
 * (0 = off); `fringe` = the chromatic split (two more scene taps); `haze` = the heat haze;
 * `msaa` = scene-pass samples.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.6, bloomResolution: 0.5, shafts: 14, fringe: true, haze: true, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.6, bloomResolution: 0.5, shafts: 12, fringe: true, haze: true, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.58, bloomResolution: 0.45, shafts: 10, fringe: true, haze: true, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.54, bloomResolution: 0.33, shafts: 6, fringe: false, haze: true, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, fringe: false, haze: true, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, fringe: false, haze: false, msaa: 0,
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
    name: 'cd_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Forge filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path
 * to white for the hottest values, so lava stays the colour of lava and only its heart burns
 * clean.
 */
const forgeFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(cdMax3(c), 1e-5);
    const k = float(0.5);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(2.2, 11.0, peak).mul(0.7));
}).setLayout({ name: 'cd_forgeFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class CinderDriftPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {THREE.Texture} [params.noise]  the world's noise texture (the heat haze reads it)
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
        /** The great fall on screen, UV (y down): where the shafts come from. */
        this.uHeart = uniform(new THREE.Vector2(0.2, 0.4));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uShafts = uniform(0.3); // fall shafts, 0..1.5
        this.uBloomBoost = uniform(0);
        /** Heat haze strength (1 at rest) and the lake's far edge on screen (UV y, down). */
        this.uHaze = uniform(1);
        this.uHorizon = uniform(0.56);

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
                // lava's orange yellow and its glare olive.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(cdMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = cdMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const shaftTaps = this.bloomNode ? look.shafts : 0;
        const noiseTex = look.haze ? params.noise || null : null;

        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);
            const fromCentre = screenUV.sub(0.5);

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

            // ── Heat haze: the air over the lake bends what is seen through it ──
            const st = vec2(screenUV).toVar();
            if (noiseTex) {
                // Strongest just over the lava, thinning up the frame; none on the card.
                const rise = smoothstep(this.uHorizon.sub(0.42), this.uHorizon.add(0.04), screenUV.y);
                // (A blurred level of the noise: the air shimmers, it does not saw.)
                const wobble = texture(noiseTex, vec2(
                    screenUV.x.mul(this.uAspect).mul(0.9),
                    screenUV.y.mul(1.3).add(this.uTime.mul(0.12)),
                )).level(2.0).rg.sub(0.5);
                st.addAssign(wobble.mul(vec2(0.0026, 0.0038)).mul(rise.mul(rise)).mul(min(this.uHaze, 2.0)).mul(float(1.0).sub(calm)));
            }

            // ── Lens fringe: wider toward the corners, and on an impact ──
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            if (look.fringe) {
                const r2 = fromCentre.dot(fromCentre);
                const fringe = r2.mul(0.004).add(this.uKick.mul(0.005)).mul(float(1.0).sub(calm));
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
            const m = max(cdMax3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.22).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom and fall shafts ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const B = vec3(bt.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                if (shaftTaps > 0) {
                    // The bloom dragged out of the great fall: its light, streaming.
                    const toHeart = this.uHeart.sub(st);
                    const jitter = cdHash21(floor(screenCoordinate).add(vec2(3.0, 71.0)));
                    const shafts = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 0; i < shaftTaps; i++) {
                        const w = 1 - (i / shaftTaps) * 0.8;
                        total += w;
                        const f = jitter.add(i).div(shaftTaps).mul(0.7);
                        shafts.addAssign(bt.sample(st.add(toHeart.mul(f))).rgb.mul(w));
                    }
                    const reach = float(1.0).sub(smoothstep(0.0, 1.1, length(toHeart.mul(vec2(this.uAspect, 1.0)))));
                    glare.addAssign(shafts.mul(1 / total).mul(this.uShafts).mul(reach.mul(0.8).add(0.2)));
                }
                glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            }
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = forgeFilmic(X).toVar();
            const L = cdLuma(T);
            // Cool, slightly lifted shadows (smoke in the lens); the fires keep their hues.
            const lo = float(1.0).sub(smoothstep(0.0, 0.26, L));
            T.assign(mix(T, T.mul(vec3(0.94, 0.98, 1.12)).add(vec3(0.0012, 0.0011, 0.0024)), lo.mul(0.5)));
            T.assign(mix(vec3(cdLuma(T)), T, 1.1));
            // Vignette, measured from the frame, a touch heavier in the corners.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.08, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.4)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = cdHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.016).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = cdHash21(pxi).add(cdHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = cdMax3(H);
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
        heart, flash, kick, bloomBoost, exposure, shafts, haze, horizon, time,
    } = {}) {
        if (heart) this.uHeart.value.set(heart.x, heart.y);
        if (flash !== undefined) this.uFlash.value = flash;
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (shafts !== undefined) this.uShafts.value = shafts;
        if (haze !== undefined) this.uHaze.value = haze;
        if (horizon !== undefined) this.uHorizon.value = horizon;
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
