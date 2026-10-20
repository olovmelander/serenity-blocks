/**
 * Cosmic Noir — post stack: the print (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT, no MSAA: the scene is grey light in scene-linear HDR, and the cage is
 * anti-aliased analytically) and ONE full-screen pass. A bloom chain can be built (POST_LOOK says
 * why no tier does):
 *
 *   calm zones (what shows through the translucent board card and HUD is soft-clipped) → [the
 *   bloom, when built] → luminance only (this is a black-and-white film) → exposure → a soft black
 *   point → the film's characteristic curve (a deep toe, a long shoulder) → the flashbulb's negative →
 *   the stock's toning (shadows and highlights each tinted, luminance kept, the paper's own base
 *   under the deepest blacks) → vignette → sRGB → the reel change's cue mark → grain (strongest in
 *   the mid-tones, where film shows it) → dust on the print → triangular dither.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
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
import {
    FILM_STOCKS, STOCK_HOME, cnHash21, cnLuma, cnMax3,
} from './cosmic-noir-tsl.js';
import { flashScale } from '../../core/photosensitivity.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (the halation goes with it).
 *
 * No tier blooms: measured in the game on the RTX 3070 (2026-10-20), the bloom's eleven passes cost
 * about 3.4 ms of CPU a frame to encode (0.27 ms each) and drew almost nothing the lens doesn't
 * already draw (its halo, spikes and glare are analytic, in the backdrop; the smoke is soft by
 * nature). The strengths stay for the playground's `bloom=1`, an A/B of exactly that.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: false, bloomStrength: 0.55, bloomResolution: 0.5, dust: true,
    },
    Ultra: {
        bloom: false, bloomStrength: 0.55, bloomResolution: 0.45, dust: true,
    },
    High: {
        bloom: false, bloomStrength: 0.52, bloomResolution: 0.4, dust: true,
    },
    Medium: {
        bloom: false, bloomStrength: 0.48, bloomResolution: 0.3, dust: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, dust: true,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, dust: false,
    },
});

export const BLOOM_THRESHOLD = 0.9;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.7;
export const EXPOSURE = 1.0;
/** Below this (scene luminance) the print crushes to black: noir's deep shadows. */
const BLACK_POINT = 0.02;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'cn_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * The film's characteristic curve on luminance (a fitted filmic S: a deep toe, so blacks are
 * black, and a long shoulder, so a blaze rolls into paper white instead of clipping).
 */
const filmCurve = /* @__PURE__ */ Fn(([xIn]) => {
    const x = max(xIn, 0.0);
    return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
}).setLayout({ name: 'cn_filmCurve', type: 'float', inputs: [{ name: 'xIn', type: 'float' }] });

const home = FILM_STOCKS[STOCK_HOME];

export class CosmicNoirPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {boolean} [params.falseColor=false]
     * @param {boolean} [params.grain=true]  false in deterministic captures of the grade
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
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // a clear's lift of the whole print, 0..1
        this.uNegative = uniform(0); // the flashbulb: 1 = the print is its own negative
        this.uCue = uniform(0); // the reel change's cue mark, 0..1
        this.uCuePos = uniform(new THREE.Vector2(0.9, 0.16));
        this.uBloomBoost = uniform(0);
        this.uShadow = uniform(new THREE.Vector3(...home.shadow));
        this.uHigh = uniform(new THREE.Vector3(...home.high));
        this.uPaper = uniform(new THREE.Vector3(...home.paper));
        this.uGrain = uniform(params.grain === false ? 0 : home.grain);
        this.grainOn = params.grain !== false;

        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.uCalmStrength = uniform(0);

        // ── Halation: a max-channel soft knee over a 4-tap box ──
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
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(8.0).div(max(cnMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = cnMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const dust = look.dust === true;

        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);

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
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(cnMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.14).add(m.mul(0.08)), 0.45)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Halation ──
            const glow = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(st).rgb);
                glow.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.6))).mul(float(1.0).sub(calm.mul(0.86))));
            }

            // ── A black-and-white film: luminance, exposure, the characteristic curve ──
            const fromCentre = st.sub(0.5);
            const L0 = cnLuma(S.add(glow)).mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.4)));
            // A soft black point: the thinnest haze sinks into the black (≈ L − k above it, no kink).
            const L = L0.mul(L0).div(L0.add(BLACK_POINT));
            const y = filmCurve(L).toVar();
            // The flashbulb: the print turns to its negative (the card stays itself).
            y.assign(mix(y, float(1.0).sub(y), this.uNegative.mul(float(1.0).sub(calm))));
            // ── The stock's toning: shadows and highlights tinted, luminance kept ──
            const tone = mix(this.uShadow, this.uHigh, smoothstep(0.02, 0.75, y));
            const toned = vec3(y).mul(tone).toVar();
            toned.addAssign(this.uPaper.mul(float(1.0).sub(smoothstep(0.0, 0.08, y))));
            // ── Vignette: a print's corners fall away ──
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.3, 1.05, length(cv.mul(1.45)));
            toned.mulAssign(float(1.0).sub(vig.mul(0.55)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(toned, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();

            // The reel change's cue mark: a white disc with a dark ring, top right of the picture.
            const toCue = st.sub(this.uCuePos).mul(vec2(this.uAspect, 1.0));
            const rr = length(toCue);
            const radius = float(0.019);
            const aa = float(1.5).div(this.uViewport.y);
            const disc = float(1.0).sub(smoothstep(radius.sub(aa), radius.add(aa), rr));
            const ring = smoothstep(radius.sub(aa), radius, rr).mul(float(1.0).sub(smoothstep(radius.add(0.004), radius.add(0.004).add(aa), rr)));
            const cue = this.uCue.mul(float(1.0).sub(calm));
            D.assign(mix(D, vec3(0.93, 0.91, 0.86), disc.mul(cue)));
            D.assign(mix(D, vec3(0.02), ring.mul(cue).mul(0.85)));

            // ── Grain: animated at 24 frames a second, strongest in the mid-tones ──
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const yD = cnLuma(D);
            const g1 = cnHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            const g2 = cnHash21(floor(pxi.mul(0.5)).add(vec2(frame.mul(-0.9), frame.mul(1.3)).add(41.0))).sub(0.5);
            const mid = yD.mul(float(1.0).sub(yD)).mul(4.0).mul(0.75).add(0.25);
            D.addAssign(g1.mul(0.6).add(g2.mul(0.4)).mul(0.055).mul(mid)
                .mul(this.uGrain)
                .mul(float(1.0).sub(calm.mul(0.7))));

            if (dust) {
                // ── Dust on the print: a few specks a frame, white (dust on the negative) ──
                const cellPx = float(46.0).mul(hScale);
                const cell = floor(px.div(cellPx));
                const h = cnHash21(cell.add(vec2(frame.mul(3.1), frame.mul(-7.7))));
                const pos = vec2(cnHash21(cell.add(vec2(frame, 5.0))), cnHash21(cell.add(vec2(9.0, frame))));
                const local = fract(px.div(cellPx)).sub(pos).mul(cellPx);
                const size = h.mul(1.6).add(0.7).mul(hScale);
                const speck = exp(dot(local, local).div(size.mul(size)).negate()).mul(step(0.9984, h));
                D.assign(mix(D, vec3(0.9, 0.89, 0.86), speck.mul(0.55).mul(min(this.uGrain, 1.0)).mul(float(1.0).sub(calm))));
            }
            const dth = cnHash21(pxi).add(cnHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = cnMax3(S.add(glow));
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
        flash, negative, cue, bloomBoost, exposure, time, stock, cuePos,
    } = {}) {
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (negative !== undefined) this.uNegative.value = negative;
        if (cue !== undefined) this.uCue.value = cue;
        if (cuePos) this.uCuePos.value.set(cuePos.x, cuePos.y);
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (time !== undefined) this.uTime.value = time;
        if (stock) {
            this.uShadow.value.set(stock.shadow[0], stock.shadow[1], stock.shadow[2]);
            this.uHigh.value.set(stock.high[0], stock.high[1], stock.high[2]);
            this.uPaper.value.set(stock.paper[0], stock.paper[1], stock.paper[2]);
            if (this.grainOn) this.uGrain.value = stock.grain;
        }
    }

    /** Grain off in deterministic captures of the grade (or back on). */
    setGrainEnabled(enabled) {
        this.grainOn = enabled !== false;
        if (!this.grainOn) this.uGrain.value = 0;
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
        setGrainEnabled() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}
