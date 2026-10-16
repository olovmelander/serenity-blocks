/**
 * First Light — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the world is authored scene-linear, so a max-channel knee selects
 * what blooms), one bloom chain on the tiers that afford it, and ONE full-screen pass:
 *
 *   the exhale waves (a ring of light that leaves the logo as the world opens, and leaves the
 *   title when the player begins: the picture bends a little as it passes) → calm zones (behind
 *   the menu's navigation and card the light is soft-clipped and its bloom held back; behind
 *   the title the frame dims a touch so the wordmark stands clear) → bloom → exposure →
 *   hue-preserving filmic → grade (by scaling only: an added constant turns blacks to haze)
 *   → vignette → sRGB → grain and dither.
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
    normalize,
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
import { disposeBloomNodeDeep } from '../../themes/shared/bloom-dispose.js';
import { flHash21, flLuma, flMax3 } from './intro-world-tsl.js';

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.35;
export const BLOOM_RADIUS = 0.45;
/** Calm rects the output pass evaluates (menu navigation, card, header, title…). */
export const CALM_RECTS_MAX = 4;
/** Waves alive at once: the opening's exhale, the begin wave, a stack's lock. */
export const WAVES_MAX = 3;

const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'fl_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/** Hue-preserving shoulder on the max channel, a path to white only for the brightest. */
const flFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(flMax3(c), 1e-5);
    const k = float(0.5);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.6, 7.0, peak).mul(0.7));
}).setLayout({ name: 'fl_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

/** Per-tier look. */
export const POST_LOOK = Object.freeze({
    High: {
        msaa: true, bloom: true, bloomStrength: 0.52, bloomResolution: 0.5, fringe: true,
    },
    Medium: {
        msaa: false, bloom: true, bloomStrength: 0.48, bloomResolution: 0.33, fringe: false,
    },
    Low: {
        msaa: false, bloom: false, bloomStrength: 0, bloomResolution: 0.25, fringe: false,
    },
});

export class IntroWorldPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {{ look?: object }} [params]
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: look.msaa ? 4 : 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(1);
        this.uVignette = uniform(0.5);
        this.waves = Array.from({ length: WAVES_MAX }, () => new THREE.Vector4(0.5, 0.5, 0, 0));
        this.uWaves = this.waves.map((w) => uniform(w));
        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.calmLevels = Array.from({ length: CALM_RECTS_MAX }, () => uniform(0));

        this.bloomNode = null;
        if (look.bloom) {
            this.bloomNode = bloom(sceneColor, look.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
            this.bloomNode.threshold.value = BLOOM_THRESHOLD;
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
            // BloomNode's documented hook. Inline (no setLayout): `input` must stay the raw
            // scene TextureNode for .sample().
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    // Hue-preserving clamp on the max channel (a per-channel one whitens colour).
                    return c.mul(min(float(1.0), float(6.0).div(max(flMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = flMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const outputFn = Fn(() => {
            const st = screenUV.toVar();
            const px = st.mul(this.uViewport);
            const aspect = vec2(this.uAspect, 1.0);

            // ── Calm zones ──
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i++) {
                const r = this.uCalm[i];
                const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(18.0));
                const inside = float(1.0).sub(smoothstep(-40.0, 30.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside.mul(this.calmLevels[i])));
            }

            // ── The exhale waves: a ring of light, and the picture bent where it passes ──
            const bend = vec2(0.0).toVar();
            const waveLight = float(0.0).toVar();
            for (let i = 0; i < WAVES_MAX; i++) {
                const w = this.uWaves[i];
                const rel = st.sub(w.xy).mul(aspect).toVar();
                const d = length(rel);
                // A thin front that bends the picture as it passes, its light only a hairline.
                const x = d.sub(w.z).div(0.045);
                const ring = exp(x.mul(x).negate()).mul(w.w);
                const lead = exp(d.sub(w.z).div(0.009).pow2().negate()).mul(w.w);
                bend.addAssign(normalize(rel.add(vec2(1e-5, 0.0))).div(aspect).mul(ring.mul(x).mul(-0.012)));
                waveLight.addAssign(lead.mul(0.12).add(ring.mul(0.012)));
            }
            const sst = st.sub(bend).toVar();
            const S = vec3(sceneColor.sample(sst).rgb).toVar();
            if (look.fringe) {
                const fromCentre = sst.sub(0.5);
                const r2 = fromCentre.dot(fromCentre);
                const spread = fromCentre.mul(r2.mul(0.0024).add(length(bend).mul(0.6)));
                If(length(spread).greaterThan(1e-4), () => {
                    S.assign(vec3(
                        sceneColor.sample(sst.sub(spread)).level(0).r,
                        S.g,
                        sceneColor.sample(sst.add(spread)).level(0).b,
                    ));
                });
            }
            // What shows behind the interface is soft-clipped (hue-preserving) and dimmed.
            const m = max(flMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.14).add(m.mul(0.1)), 0.42)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.85)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(sst).rgb);
                glare.assign(B.mul(float(1.0).sub(calm.mul(0.75))));
            }
            const waveCol = vec3(0.72, 0.9, 1.0);
            const H = S.add(glare).add(waveCol.mul(waveLight));

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure);
            const T = flFilmic(X).toVar();
            const L = flLuma(T);
            // Cool, deep shadows by scaling only; the lights keep their hues.
            const lo = float(1.0).sub(smoothstep(0.0, 0.22, L));
            T.assign(mix(T, T.mul(vec3(0.9, 0.95, 1.12)), lo.mul(0.6)));
            T.assign(max(mix(vec3(flLuma(T)), T, 1.08), vec3(0.0)));
            // Vignette, measured from the frame.
            const fromC = st.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.42, 1.1, length(fromC.mul(1.55)));
            T.mulAssign(float(1.0).sub(vig.mul(this.uVignette)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = flHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.011).mul(float(1.0).sub(calm.mul(0.6))));
            const dth = flHash21(pxi).add(flHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));
            return vec4(clamp(D, 0.0, 1.0), 1.0);
        });

        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = outputFn();
        this.pipeline.needsUpdate = true;
    }

    /** Per-frame values. */
    update({ exposure, time, vignette } = {}) {
        if (exposure !== undefined) {
            this.uExposure.value = exposure;
            // The knee follows the iris, so a darker frame does not bloom more.
            if (this.bloomNode) this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.25, exposure);
        }
        if (time !== undefined) this.uTime.value = time;
        if (vignette !== undefined) this.uVignette.value = vignette;
    }

    /** Wave i: centre (screen fraction, y down), radius (frame heights), strength 0..1. */
    setWave(i, x, y, radius, strength) {
        const w = this.waves[i];
        if (w) w.set(x, y, radius, strength);
    }

    /** Calm rects in screen fractions (x0, y0, x1, y1; y down) with a level each (0..1). */
    setCalmRects(rects) {
        for (let i = 0; i < CALM_RECTS_MAX; i++) {
            const r = rects?.[i];
            if (r) {
                this.calmRects[i].set(r.x0, r.y0, r.x1, r.y1);
                this.calmLevels[i].value = r.level ?? 1;
            } else {
                this.calmRects[i].set(0, 0, 0, 0);
                this.calmLevels[i].value = 0;
            }
        }
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
