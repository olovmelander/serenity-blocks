/**
 * Shifting Sands — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT; MSAA only on the showcase tiers), one bloom chain (Medium and up) and
 * ONE full-screen output pass:
 *
 *   heat haze (a shimmer band just above the far erg, strongest toward the suns; one noise fetch,
 *   and the scene is still sampled once) → calm zones (what shows through the translucent board
 *   card and HUD is soft-clipped and its bloom attenuated) → bloom (max-channel soft knee, so the
 *   gold, the ember and the white all bloom alike) → sun shafts (a few taps of the already-blurred
 *   bloom texture marched toward the primary sun: silhouettes — crests, the worm, the butte —
 *   cut dark shafts through the glow) → an analytic sun flare (a soft horizontal streak, gated by
 *   how much of the sun is actually visible) → exposure → "desert filmic" tone map (hue
 *   preserving; cores roll to warm white) → grade (warm/cool split tone, gentle saturation, event
 *   flash) → vignette → sRGB → grain on the dark floor → triangular dither.
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
    pow,
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
    ssHash21, ssLuma, ssMax3, ssTexNoise,
} from './shifting-sands-tsl.js';

/** Per-tier look. `bloom: false` builds no BloomNode; `rays` = shaft taps (0 = none). */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.48, bloomResolution: 0.4, rays: 10, grain: true, msaa: 4, haze: true,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.46, bloomResolution: 0.375, rays: 8, grain: true, msaa: 4, haze: true,
    },
    High: {
        bloom: true, bloomStrength: 0.45, bloomResolution: 0.33, rays: 8, grain: true, msaa: 0, haze: true,
    },
    Medium: {
        bloom: true, bloomStrength: 0.42, bloomResolution: 0.25, rays: 5, grain: false, msaa: 0, haze: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, grain: false, msaa: 0, haze: false,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, grain: false, msaa: 0, haze: false,
    },
});

export const BLOOM_THRESHOLD = 2.1;
export const BLOOM_KNEE = 0.7;
export const BLOOM_RADIUS = 0.3;
export const BLOOM_MIPS = 4;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 4;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'ss_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Desert filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a
 * gentle path to warm white for the hottest values (the sun cores), so the gold of the sand never
 * skews yellow and the suns never clip to a flat hue.
 */
const desertFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(ssMax3(c), 1e-5);
    const k = float(0.62);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const white = vec3(1.0, 0.97, 0.9).mul(mapped);
    return mix(toned, white, smoothstep(1.6, 9.0, peak).mul(0.75));
}).setLayout({ name: 'ss_desertFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class ShiftingSandsPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {object} params.shared      world shared uniforms (uTime, uDusk, noiseTex)
     * @param {number} [params.samples]
     * @param {boolean} [params.grain=true]
     * @param {boolean} [params.falseColor=false]
     */
    constructor(renderer, scene, camera, params) {
        const look = params.look || POST_LOOK.High;
        const { shared } = params;
        this.look = look;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneViewZ = this.scenePass.getViewZNode();

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uSunUV = uniform(new THREE.Vector2(0.25, 0.3)); // primary sun, screen UV (y down)
        this.uSunVis = uniform(1); // 0..1: the sun is on screen and not hidden
        this.uHorizonY = uniform(0.42); // screen-UV y of the far horizon (y down)
        this.uExposure = uniform(1.0);
        this.uFlash = uniform(0); // event flash (warm lift), 0..1
        this.uHaze = uniform(look.haze ? 1 : 0);
        this.grainEnabled = params.grain !== false && look.grain === true;
        this.uGrain = uniform(this.grainEnabled ? 2.5 / 255 : 0);
        this.uGrainPhase = uniform(0);
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
            // Version-pinned BloomNode private field (the lever parhelion-post.js also pulls): four mips
            // keep the suns' glare tight, so the worm stays a silhouette when it crosses them.
            this.bloomNode._nMips = BLOOM_MIPS;
            const { uSrcTexel } = this;
            // BloomNode's documented hook, read once at setup. Inline (no setLayout): `input`
            // must stay the raw scene TextureNode for .sample().
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                // Hue-preserving clamp on the max channel: a per-channel clamp turns the ember sun
                // (≈20, 6.6, 1.2) into yellow (4, 4, 1.2) and the glare goes olive over dark silhouettes.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(4.0).div(max(ssMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = ssMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const { noiseTex, uTime } = shared;
        const rayTaps = this.bloomNode ? (look.rays | 0) : 0;
        let rayNorm = 0;
        for (let k = 1; k <= rayTaps; k++) rayNorm += (1 - k / (rayTaps + 1)) * 0.9 + 0.1;
        rayNorm = rayNorm > 0 ? 1 / rayNorm : 0;

        const outputFn = Fn(() => {
            const st = screenUV;
            const px = st.mul(this.uViewport);

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

            // ── Heat haze: a shimmer band hugging the far erg ──
            const band = float(1.0).sub(smoothstep(0.0, 0.09, abs(st.y.sub(this.uHorizonY).sub(0.01)))).mul(this.uHaze);
            const sunSide = mix(0.45, 1.0, float(1.0).sub(smoothstep(0.0, 0.75, abs(st.x.sub(this.uSunUV.x)))));
            const amp = band.mul(sunSide).mul(float(1.0).sub(calm)).mul(0.0016);
            const hst = vec2(st).toVar();
            // Only the band pays for the noise fetch (explicit LOD inside the branch).
            If(amp.greaterThan(1e-5), () => {
                const hz = ssTexNoise(noiseTex, vec2(
                    st.x.mul(this.uAspect).mul(55.0),
                    st.y.mul(160.0).add(uTime.mul(2.4)),
                ));
                hst.addAssign(vec2(hz.x.sub(0.5).mul(amp), hz.y.sub(0.5).mul(amp.mul(1.6))));
            });
            const S = vec3(sceneColor.sample(hst).rgb).toVar();

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(ssMax3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.22).add(m.mul(0.25))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.85)));

            // ── Bloom + shafts ──
            let B = vec3(0.0);
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                const bl = vec3(bt.sample(st).rgb).toVar();
                if (rayTaps > 0) {
                    // Crepuscular shafts: march the SHARP scene toward the primary sun and gather
                    // only the over-bright sky, so every silhouette in between — crests, the
                    // worm, the butte — cuts a dark shaft. Pixels far from the sun skip the march.
                    const toSun = this.uSunUV.sub(st);
                    // Shafts live within ~0.6 screen heights of the sun; everything beyond skips the march
                    // (the cutoff is where the falloff is already below 4 %).
                    const reach = exp(length(toSun.mul(vec2(this.uAspect, 1.0))).mul(-3.0)).mul(this.uSunVis);
                    const shafts = vec3(0.0).toVar();
                    // Per-pixel jitter of the tap positions turns step banding into fine grain.
                    const jitter = ssHash21(floor(screenCoordinate.xy)).sub(0.5).div(rayTaps + 1);
                    If(reach.greaterThan(0.04), () => {
                        for (let k = 1; k <= rayTaps; k++) {
                            const f = k / (rayTaps + 1);
                            const w = (1 - f) * 0.9 + 0.1;
                            // Explicit LOD: implicit derivatives are undefined in a divergent branch.
                            const c = vec3(sceneColor.sample(st.add(toSun.mul(jitter.add(f * 0.92)))).level(0).rgb);
                            shafts.addAssign(clamp(c.sub(1.15), 0.0, 1.6).mul(w));
                        }
                    });
                    // In-scatter grows with the lit air in front of the pixel: the sky gets the full
                    // shaft, a worm a kilometre out a third of it, the near dunes almost none.
                    const path = float(1.0).sub(exp(sceneViewZ.mul(1.0 / 2500.0)));
                    bl.addAssign(shafts.mul(rayNorm * 0.3).mul(reach).mul(path));
                }
                bl.mulAssign(float(1.0).add(this.uBloomBoost.mul(0.35)));
                B = bl.mul(float(1.0).sub(calm.mul(0.85)));
            }
            const H = S.add(B).toVar();

            // ── Sun flare: a soft anamorphic streak + a warm veil, gated by visibility ──
            const d = st.sub(this.uSunUV).mul(vec2(this.uAspect, 1.0));
            const streak = exp(abs(d.y).mul(-260.0)).mul(exp(abs(d.x).mul(-3.2)));
            const veil = exp(length(d).mul(-5.5));
            const flare = streak.mul(0.22).add(veil.mul(0.05)).mul(this.uSunVis).mul(float(1.0).sub(calm));
            H.addAssign(vec3(1.0, 0.62, 0.32).mul(flare));

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.18)));
            const T = desertFilmic(X).toVar();
            const L = ssLuma(T);
            // Split tone: violet-teal shadows, warm amber highlights.
            const lo = float(1.0).sub(smoothstep(0.0, 0.35, L));
            const hi = smoothstep(0.35, 0.95, L);
            T.assign(mix(T, T.mul(vec3(0.86, 0.93, 1.12)), lo.mul(0.35)));
            T.assign(mix(T, T.mul(vec3(1.06, 1.0, 0.9)), hi.mul(0.3)));
            // Gentle saturation and mid contrast.
            T.assign(mix(vec3(ssLuma(T)), T, 1.08));
            T.assign(T.mul(pow(max(ssLuma(T), 1e-4).div(0.22), 0.06)));
            // Vignette, heavier in the bottom corners.
            const cv = st.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.0, length(cv.mul(vec2(1.0, 1.15)).mul(1.6)));
            T.mulAssign(float(1.0).sub(vig.mul(0.32)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const gp = this.uGrainPhase;
            const gn = ssHash21(pxi.add(vec2(gp.mul(113.1), gp.mul(71.7)))).sub(0.5);
            D.addAssign(gn.mul(this.uGrain).mul(float(1.0).sub(smoothstep(0.03, 0.4, ssMax3(D)).mul(0.6))));
            const dth = ssHash21(pxi).add(ssHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = ssMax3(S.add(B));
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
        time, sunUV, sunVis, horizonY, flash, bloomBoost, exposure,
    } = {}) {
        if (time !== undefined) this.uGrainPhase.value = Math.floor(time * 24) % 256;
        if (sunUV) this.uSunUV.value.set(sunUV.x, sunUV.y);
        if (sunVis !== undefined) this.uSunVis.value = sunVis;
        if (horizonY !== undefined) this.uHorizonY.value = horizonY;
        if (flash !== undefined) this.uFlash.value = flash;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
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

    setGrainEnabled(enabled) {
        this.uGrain.value = enabled && this.look.grain === true ? 2.5 / 255 : 0;
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

/** A render pipeline that only encodes the scene (the no-post / fallback path). */
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
