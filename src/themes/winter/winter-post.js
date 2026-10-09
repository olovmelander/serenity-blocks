/**
 * Winter — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the world is authored in scene-linear HDR, so a max-channel
 * knee selects what blooms), one bloom chain (Medium and up) and ONE full-screen pass:
 *
 *   lens fringe (a radial chromatic split that widens toward the corners and jumps on an impact)
 *   → calm zones (what shows through the translucent board card and HUD is soft-clipped and its
 *   bloom attenuated) → bloom → moon shafts (the bloom dragged radially out of the moon: its
 *   light in the ice haze, faint, a little stronger after four lines) → the lens's own answer
 *   to the moon (a veil round it) → exposure and event flash →
 *   "polar filmic" tone map (hue preserving, the hottest cores roll to white) → grade (cold
 *   blue shadows, a saturation lift) → vignette → sRGB → grain and triangular dither.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
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
import { wHash21, wLuma, wMax3 } from './winter-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (and so no shafts). `shafts` is a tap count
 * (0 = off); `fringe` = the chromatic split (two more scene taps); `msaa` = scene-pass samples.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.42, bloomResolution: 0.5, shafts: 14, fringe: true, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.42, bloomResolution: 0.5, shafts: 12, fringe: true, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.4, bloomResolution: 0.45, shafts: 10, fringe: true, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.38, bloomResolution: 0.33, shafts: 6, fringe: false, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, fringe: false, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, fringe: false, msaa: 0,
    },
});

export const BLOOM_THRESHOLD = 1.7;
export const BLOOM_KNEE = 0.55;
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
    name: 'w_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Polar filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path
 * to white for only the hottest values, so the fires stay green and violet and the twilight
 * stays rose; a glint on the snow or the heart of a spark may burn clean.
 */
const polarFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(wMax3(c), 1e-5);
    const k = float(0.5);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(3.6, 12.0, peak).mul(0.8));
}).setLayout({ name: 'w_polarFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class WinterPost {
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
        /** The moon on screen, UV (y down): where the shafts come from. */
        this.uHeart = uniform(new THREE.Vector2(0.86, 0.42));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uShafts = uniform(0.1); // moon shafts, 0..1.5
        this.uBloomBoost = uniform(0);
        /** How strongly the lens answers the moon (0..1), and in what colour. */
        this.uGlare = uniform(0);
        this.uGlareColor = uniform(new THREE.Vector3(1, 0.8, 0.6));

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
                // rose of the twilight orange and the aurora's green yellow.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(wMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = wMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const shaftTaps = this.bloomNode ? look.shafts : 0;

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
                const fringe = r2.mul(0.0012).add(this.uKick.mul(0.0015)).mul(float(1.0).sub(calm));
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
            const m = max(wMax3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.22).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom and moon shafts ──
            const toHeart = this.uHeart.sub(st);
            const span = length(toHeart.mul(vec2(this.uAspect, 1.0)));
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const B = vec3(bt.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                if (shaftTaps > 0) {
                    // The bloom dragged out of the moon: its light in the ice haze.
                    const jitter = wHash21(floor(screenCoordinate).add(vec2(3.0, 71.0)));
                    const shafts = vec3(0.0).toVar();
                    let total = 0;
                    for (let i = 0; i < shaftTaps; i++) {
                        const w = 1 - (i / shaftTaps) * 0.8;
                        total += w;
                        const f = jitter.add(i).div(shaftTaps).mul(0.7);
                        shafts.addAssign(bt.sample(st.add(toHeart.mul(f))).rgb.mul(w));
                    }
                    const reach = float(1.0).sub(smoothstep(0.0, 1.15, span));
                    glare.addAssign(shafts.mul(1 / total).mul(this.uShafts).mul(reach.mul(0.8).add(0.2)));
                }
                glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            }
            // The lens itself: a veil round the moon, and the faintest level streak and star.
            const veil = exp(span.mul(-3.6)).mul(0.035).add(exp(span.mul(-12.0)).mul(0.16));
            const across = toHeart.y.mul(this.uViewport.y.div(1080.0)).mul(520.0);
            const streak = exp(across.mul(across).negate()).mul(exp(abs(toHeart.x).mul(this.uAspect).mul(-3.4))).mul(0.22);
            // The iris's blades make a star of a point of light: six rays, alternately long.
            const bearing = atan(toHeart.y, toHeart.x.mul(this.uAspect));
            const blades = abs(sin(bearing.mul(3.0).add(0.5)));
            const rays = blades.mul(blades).mul(blades).mul(blades);
            const star = rays.mul(rays).mul(rays).mul(exp(span.mul(-7.5))).mul(0.5)
                .add(rays.mul(rays).mul(exp(span.mul(-22.0))).mul(0.5));
            const lens = this.uGlareColor.mul(veil.add(streak.mul(0.3)).add(star.mul(0.22))).mul(this.uGlare).mul(float(1.0).sub(calm.mul(0.9)));
            const H = S.add(glare).add(lens);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = polarFilmic(X).toVar();
            const L = wLuma(T);
            // Cold, slightly lifted shadows (thin air); the lights keep their hues.
            const lo = float(1.0).sub(smoothstep(0.0, 0.3, L));
            T.assign(mix(T, T.mul(vec3(0.9, 0.96, 1.14)).add(vec3(0.0008, 0.0012, 0.004)), lo.mul(0.5)));
            T.assign(clamp(mix(vec3(wLuma(T)), T, 1.12), 0.0, 1.0));
            // A little more bite through the middle: moonlit snow must keep its drifts.
            T.assign(mix(T, T.mul(T).mul(vec3(3.0).sub(T.mul(2.0))), 0.22));
            // Vignette, measured from the frame, a touch heavier in the corners.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.08, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.36)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = wHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.014).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = wHash21(pxi).add(wHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = wMax3(H);
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
        heart, flash, kick, bloomBoost, exposure, shafts, glare, glareColor, time,
    } = {}) {
        if (heart) this.uHeart.value.set(heart.x, heart.y);
        if (flash !== undefined) this.uFlash.value = flash;
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (shafts !== undefined) this.uShafts.value = shafts;
        if (glare !== undefined) this.uGlare.value = glare;
        if (glareColor) this.uGlareColor.value.set(glareColor[0], glareColor[1], glareColor[2]);
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
