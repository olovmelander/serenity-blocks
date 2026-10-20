/**
 * Bioluminescence — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the grotto is authored in scene-linear HDR, so a max-channel knee
 * selects what blooms), one bloom chain (Medium and up) and ONE full-screen pass:
 *
 *   lens fringe (a radial chromatic split that widens toward the corners and jumps on an impact)
 *   → calm zones (what shows through the translucent board card and HUD is soft-clipped and its
 *   bloom attenuated) → bloom → spore shafts (the bloom dragged radially out of the elder's cap:
 *   its light streaming down the cave; the Great Bloom floods them) → exposure and event flash →
 *   "grotto filmic" tone map (hue preserving, the hottest cores roll to white) → grade (deep
 *   teal shadows, a saturation lift) → vignette → sRGB → grain and triangular dither.
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
    atan,
    clamp,
    dot,
    exp,
    float,
    floor,
    getViewPosition,
    int,
    length,
    max,
    min,
    mix,
    pass,
    renderOutput,
    sin,
    sqrt,
    screenCoordinate,
    screenUV,
    select,
    smoothstep,
    step,
    uniform,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { blHash21, blLuma, blMax3 } from './bioluminescence-tsl.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { EMITTER_MAX } from './bioluminescence-core.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (and so no shafts). `shafts` is a tap count
 * (0 = off); `fringe` = the chromatic split (two more scene taps); `msaa` = scene-pass samples.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.8, bloomResolution: 0.5, shafts: 14, fringe: true, msaa: 4, capLight: true,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.8, bloomResolution: 0.5, shafts: 12, fringe: true, msaa: 4, capLight: true,
    },
    High: {
        bloom: true, bloomStrength: 0.78, bloomResolution: 0.45, shafts: 10, fringe: true, msaa: 4, capLight: true,
    },
    Medium: {
        bloom: true, bloomStrength: 0.72, bloomResolution: 0.33, shafts: 6, fringe: false, msaa: 0, capLight: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, fringe: false, msaa: 0, capLight: false,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 0, fringe: false, msaa: 0, capLight: false,
    },
});

export const BLOOM_THRESHOLD = 0.9;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.72;
export const EXPOSURE = 1.0;

/** Light falling from the great caps: the strength per unit of a lamp's colour × gain × metre. */
export const CAP_LIGHT_GAIN = 0.0011;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'bl_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Grotto filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path
 * to white for the hottest values, so a teal bloom stays teal and only its core burns clean.
 */
const grottoFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(blMax3(c), 1e-5);
    const k = float(0.5);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.8, 8.0, peak).mul(0.75));
}).setLayout({ name: 'bl_grottoFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class BioluminescencePost {
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
        /** The elder's cap on screen, UV (y down): where the shafts come from. */
        this.uHeart = uniform(new THREE.Vector2(0.5, 0.2));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uShafts = uniform(0.2); // spore shafts, 0..1.5
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
                // Hue-preserving clamp on the max channel: a per-channel clamp would turn a teal
                // bloom white and a violet one blue.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(blMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = blMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const shaftTaps = this.bloomNode ? look.shafts : 0;

        // ── Light falling from the great caps ──
        // Each cap's lamp row carries the width of the light it lets fall (0: none, as for the
        // elder and the crystals). Along the view ray that light is a soft column under the cap,
        // widening and fading toward the water and streaked by falling spores; the scene's depth
        // cuts it wherever something stands in front.
        this.camera = camera;
        this.capRows = Array.from({ length: EMITTER_MAX * 2 }, () => new THREE.Vector4(0, -1000, 0, 1));
        this.uCapRows = uniformArray(this.capRows, 'vec4');
        this.uCapCount = uniform(0, 'int');
        this.uEye = uniform(new THREE.Vector3());
        this.uProjInv = uniform(camera.projectionMatrixInverse);
        this.uCamWorld = uniform(camera.matrixWorld);
        const sceneDepth = look.capLight ? this.scenePass.getTextureNode('depth') : null;
        const capLight = (st) => {
            const depth = sceneDepth.sample(st).r;
            const view = getViewPosition(st, depth, this.uProjInv);
            const ray = this.uCamWorld.mul(vec4(view, 1.0)).xyz.sub(this.uEye);
            const dist = length(ray).toVar();
            const dir = ray.div(max(dist, 1e-4)).toVar();
            const sum = vec3(0.0).toVar();
            Loop({
                start: int(0), end: this.uCapCount, type: 'int', condition: '<', name: 'cap',
            }, ({ cap }) => {
                const a = this.uCapRows.element(cap.mul(2));
                const c = this.uCapRows.element(cap.mul(2).add(1));
                If(c.w.greaterThan(0.0), () => {
                    const top = a.y.toVar();
                    const off = this.uEye.xz.sub(vec2(a.x, a.z)).toVar();
                    const dxz = dir.xz.toVar();
                    const dd = max(dot(dxz, dxz), 1e-4).toVar();
                    // Where the ray passes closest to the column's axis.
                    const tRaw = dot(off, dxz).negate().div(dd).toVar();
                    const tc = max(tRaw, 0.0).toVar();
                    const yc = this.uEye.y.add(dir.y.mul(tc)).toVar();
                    const below = max(top.sub(yc), 0.0).toVar();
                    const w = c.w.mul(below.div(max(top, 1.0)).mul(0.45).add(1.0)).toVar();
                    const at = off.add(dxz.mul(tc)).toVar();
                    const across = exp(dot(at, at).div(w.mul(w)).negate());
                    const inY = smoothstep(0.0, 1.0, top.sub(yc)).mul(smoothstep(-0.1, 1.2, yc))
                        .mul(exp(below.div(max(top, 1.0)).mul(-0.9)));
                    const path = min(w.mul(1.77).div(sqrt(dd)), w.mul(6.0));
                    // Only the air in front of what the pixel shows: a stem inside the light is not lit by it.
                    const span = w.div(sqrt(dd)).mul(1.2);
                    const front = clamp(dist.sub(tRaw.sub(span)).div(span.mul(2.0)), 0.0, 1.0);
                    // The gills' lines fall as striations, and the light sinks in slow pulses of spores.
                    const around = atan(at.y, at.x);
                    const lines = sin(around.mul(14.0).add(float(cap).mul(1.7))).mul(0.5).add(0.5);
                    const striae = lines.mul(lines).mul(lines);
                    const sink = sin(yc.mul(0.9).add(this.uTime.mul(1.1)).add(around.mul(1.3))).mul(0.5).add(0.5);
                    const grain = striae.mul(0.6).add(sink.mul(0.4)).mul(0.75).add(0.25);
                    sum.addAssign(c.rgb.mul(across.mul(inY).mul(path).mul(front).mul(grain)));
                });
            });
            return sum.mul(CAP_LIGHT_GAIN);
        };

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
                const fringe = r2.mul(0.005).add(this.uKick.mul(0.005)).mul(float(1.0).sub(calm));
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
            const m = max(blMax3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.22).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom and spore shafts ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const B = vec3(bt.sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                if (shaftTaps > 0) {
                    // The bloom dragged out of the elder's cap: its light, streaming.
                    const toHeart = this.uHeart.sub(st);
                    const jitter = blHash21(floor(screenCoordinate).add(vec2(3.0, 71.0)));
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
            if (sceneDepth) glare.addAssign(capLight(st).mul(float(1.0).sub(calm.mul(0.86))));
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = grottoFilmic(X).toVar();
            const L = blLuma(T);
            // Deep teal, slightly lifted shadows (damp air in the lens); the lights keep their hues.
            const lo = float(1.0).sub(smoothstep(0.0, 0.3, L));
            T.assign(mix(T, T.mul(vec3(0.84, 1.0, 1.08)).add(vec3(0.0002, 0.0011, 0.0015)), lo.mul(0.6)));
            T.assign(mix(vec3(blLuma(T)), T, 1.12));
            // Vignette, measured from the frame, a touch heavier in the corners.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.08, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.5)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = blHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.018).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = blHash21(pxi).add(blHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = blMax3(H);
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
        heart, flash, kick, bloomBoost, exposure, shafts, time, lamps,
    } = {}) {
        if (heart) this.uHeart.value.set(heart.x, heart.y);
        if (lamps) {
            const n = Math.min(lamps.length, this.capRows.length);
            for (let i = 0; i < n; i++) this.capRows[i].copy(lamps[i]);
            this.uCapCount.value = n >> 1;
        }
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (shafts !== undefined) this.uShafts.value = shafts;
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
        this.uEye.value.setFromMatrixPosition(this.camera.matrixWorld);
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
