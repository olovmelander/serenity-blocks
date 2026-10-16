/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the lens (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (MSAA on High and up: the iron and the leaves are fine edges; no MRT: the scene
 * is authored in scene-linear HDR, so a max-channel knee picks what blooms), one bloom chain
 * (Medium and up), one march through the air on a reduced target and one full-screen pass:
 *
 *   the air: every pixel walks its view ray through the house's mist, from the eye to what it
 *   sees (the scene pass's depth), and gathers the moonlight that the glazing lets through at
 *   each step (mgMoonlight, the same function the floor and the leaves are lit by), scattered
 *   toward the eye most strongly when it looks toward the moon. So the beams stand in the air
 *   ruled by the shadows of the ribs and the glazing bars, each landing on its own lattice on
 *   the floor, and the leaves and the iron cut them. The lanterns and the open blooms glow in
 *   the same mist. Low over the canal the mist thickens.
 *   → the air laid over the scene (extinction by distance, then its light)
 *   → calm zones (what shows through the translucent card and HUD is soft-clipped, its glare
 *   attenuated) → bloom → the night's exposure, the event flash → a hue-preserving filmic curve
 *   → the night's grade → vignette → sRGB → grain and dither → FXAA (every tier but Minimal: on
 *   Medium and Low it smooths a single-sampled pass; from High up it follows the MSAA, for the
 *   leaves' and the lattice's cut-out edges, which a discard draws whole-pixel and coverage
 *   cannot smooth here without a stipple, see moonlit-greenhouse-flora.js).
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, clamp, dot, exp, float, floor, fract, getViewPosition, int, interleavedGradientNoise, length, max,
    min, mix, normalize, pass, renderOutput, rtt, screenCoordinate, screenUV, select, sin, smoothstep, step, texture,
    uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { mgCanopy, mgMoonlightBay } from './moonlit-greenhouse-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode; `march` is the number of steps each pixel
 * walks through the air and `marchScale` the size of its target; `msaa` the scene pass's
 * samples; `fxaa` smooths the cut-out edges (and, on a single-sample pass, every edge).
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        msaa: true, bloom: true, bloomStrength: 0.42, bloomResolution: 0.5, march: 36, marchScale: 0.5, fxaa: true,
    },
    Ultra: {
        msaa: true, bloom: true, bloomStrength: 0.42, bloomResolution: 0.5, march: 30, marchScale: 0.5, fxaa: true,
    },
    High: {
        msaa: true, bloom: true, bloomStrength: 0.4, bloomResolution: 0.45, march: 24, marchScale: 0.5, fxaa: true,
    },
    Medium: {
        msaa: false, bloom: true, bloomStrength: 0.38, bloomResolution: 0.33, march: 18, marchScale: 0.4, fxaa: true,
    },
    Low: {
        msaa: false, bloom: false, bloomStrength: 0, bloomResolution: 0.25, march: 13, marchScale: 0.33, fxaa: true,
    },
    Minimal: {
        msaa: false, bloom: false, bloomStrength: 0, bloomResolution: 0.25, march: 9, marchScale: 0.25, fxaa: false,
    },
});

export const BLOOM_THRESHOLD = 1.25;
export const BLOOM_KNEE = 0.55;
export const BLOOM_RADIUS = 0.6;
export const EXPOSURE = 1.0;

/**
 * The air: how far a view ray is walked (metres), the mist's density everywhere and low over the
 * water (per metre), how fast the low mist thins with height, how strongly the beams scatter
 * toward the eye (Henyey–Greenstein g), and how much the mist dims what lies behind it.
 */
export const AIR = Object.freeze({
    reach: 36,
    haze: 0.005,
    low: 0.04,
    lowFall: 1.3,
    forward: 0.62,
    beam: 0.1,
    extinction: 0.38,
});

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;

const max3 = (c) => max(c.r, max(c.g, c.b));
const luma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
const hash21 = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'mg_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Greenhouse filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a
 * path to white only for the hottest values (the moon's disc, the Queen's heart).
 */
const mgFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max3(c), 1e-5);
    const k = float(0.5);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(2.5, 14.0, peak).mul(0.8));
}).setLayout({ name: 'mg_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

/** Henyey–Greenstein phase (per steradian, up to a constant) for g and the angle's cosine. */
const mgPhase = /* @__PURE__ */ Fn(([g, c]) => {
    const g2 = g.mul(g);
    const denom = max(float(1.0).add(g2).sub(g.mul(c).mul(2.0)), 1e-4);
    return float(1.0).sub(g2).div(denom.mul(denom.sqrt()));
}).setLayout({ name: 'mg_phase', type: 'float', inputs: [{ name: 'g', type: 'float' }, { name: 'c', type: 'float' }] });

export class MoonlitGreenhousePost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {boolean} [params.antialias=true] the game's antialiasing setting (off: no FXAA)
     * @param {boolean} [params.falseColor=false]
     * @param {object} [params.U]         the world's uniforms (the moon, the night, the lights)
     * @param {THREE.Texture} [params.noise]  the world's noise (the mist's billows)
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.camera = camera;
        const { U, noise } = params;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: look.msaa ? 4 : 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0);
        this.uBloomBoost = uniform(0);
        /** How strongly the moon's beams stand in the air (the world's moonlight, 0 in the hush). */
        this.uShafts = uniform(1);
        this.uGradeShadow = uniform(new THREE.Vector3(0, 0.01, 0.02));
        this.uGradeLight = uniform(new THREE.Vector3(1, 1, 1));
        // The scene camera's matrices (a post pass's own camera nodes are the quad's).
        this.uProjInv = uniform(camera.projectionMatrixInverse);
        this.uCamWorld = uniform(camera.matrixWorld);
        this.uCamPos = uniform(new THREE.Vector3());

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
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(max3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = max3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        // ── The air ──
        this.depthNode = this.scenePass.getTextureNode('depth');
        this.airNode = U ? this.createAir(this.depthNode, U, noise, look) : null;

        const falseColor = params.falseColor === true;

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

            const S = vec3(sceneColor.sample(st).rgb).toVar();
            // ── The air over the scene: dimmed by the mist, then the mist's own light ──
            if (this.airNode) {
                const air = this.upsampleAir(st, look.marchScale);
                S.assign(S.mul(air.a).add(air.rgb));
            }
            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(max3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.2).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const glow = this.bloomNode.getTextureNode();
                glare.assign(vec3(glow.sample(st).rgb).mul(float(1.0).add(this.uBloomBoost.mul(0.6))));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = mgFilmic(X).toVar();
            const L = luma(T);
            // The night's grade: a cool lift in the darks (never flat black), its tint in the lights.
            const lo = float(1.0).sub(smoothstep(0.0, 0.28, L));
            T.assign(T.add(this.uGradeShadow.mul(lo).mul(0.3)));
            const hi = smoothstep(0.4, 1.0, L);
            T.mulAssign(mix(vec3(1.0), this.uGradeLight, hi.mul(0.7)));
            T.assign(mix(vec3(luma(T)), T, 1.1));
            // Vignette, measured from the frame.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.15, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.4)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = hash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.014).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = hash21(pxi).add(hash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = max3(H);
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
        // FXAA renders its input to a hidden target of its own: kept, so dispose() can free it.
        this.fxaaNode = look.fxaa && params.antialias !== false && !falseColor ? fxaa(outputFn()) : null;
        this.pipeline.outputNode = this.fxaaNode || outputFn();
        this.pipeline.needsUpdate = true;
    }

    /**
     * The air at full resolution: a joint bilateral upsample of the reduced target. Each pixel
     * blends the 3 × 3 texels round it (2 × 2 on the lowest tiers), weighted by distance (a tent
     * 1.5 texels wide, which also hides the march's jittered start) and by how near each texel's
     * depth is to its own, so the mist of the sky beyond never bleeds onto a frond's edge.
     */
    upsampleAir(st, scale) {
        const depthTex = this.depthNode;
        const viewZ = (q) => getViewPosition(q, depthTex.sample(q).x, this.uProjInv).z;
        // The reduced target is floor(buffer × scale) texels (RTTNode), not a fraction of one.
        const low = floor(this.uViewport.mul(scale));
        const f = st.mul(low).sub(0.5);
        const zHere = viewZ(st);
        const zScale = float(1.0).div(max(abs(zHere), 0.1));
        const sum = vec4(0.0).toVar();
        const weight = float(0.0).toVar();
        const tap = (cell, near) => {
            const q = cell.add(0.5).div(low);
            const rel = viewZ(q).sub(zHere).mul(zScale);
            const w = near.mul(exp(rel.mul(rel).mul(-300.0)).add(1e-4));
            sum.addAssign(this.airNode.sample(q).mul(w));
            weight.addAssign(w);
        };
        if (scale <= 0.34) {
            // The lowest tiers march fewer, coarser texels: the 2 × 2 round the pixel, weighted
            // bilinearly and by depth, costs less than the march it resamples.
            const base = floor(f);
            const t = f.sub(base);
            for (let dy = 0; dy <= 1; dy += 1) {
                for (let dx = 0; dx <= 1; dx += 1) {
                    const near = (dx ? t.x : float(1.0).sub(t.x)).mul(dy ? t.y : float(1.0).sub(t.y));
                    tap(base.add(vec2(dx, dy)), near);
                }
            }
        } else {
            const base = floor(f.add(0.5));
            for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    const cell = base.add(vec2(dx, dy));
                    const off = abs(f.sub(cell));
                    tap(cell, max(float(1.5).sub(off.x), 0.0).mul(max(float(1.5).sub(off.y), 0.0)));
                }
            }
        }
        return sum.div(max(weight, 1e-6));
    }

    /**
     * The march through the air, on a reduced target: rgb is the light the mist sends toward the
     * eye along the pixel's ray, a the share of what lies behind that comes through.
     */
    createAir(depthTexture, U, noise, look) {
        const steps = look.march;
        const { night } = U;
        const march = Fn(() => {
            const st = uv();
            const depth = depthTexture.sample(st).x;
            const view = getViewPosition(st, depth, this.uProjInv);
            const world = this.uCamWorld.mul(vec4(view, 1.0)).xyz;
            const eye = this.uCamPos;
            const toward = world.sub(eye);
            const far = min(length(toward), float(AIR.reach));
            const dir = normalize(toward).toVar();
            const stepLen = far.div(steps);
            // A fixed per-pixel jitter of the start: the reduced target's bilinear upscale and the
            // grain hide what is left of it.
            const jitter = interleavedGradientNoise(screenCoordinate.xy);
            const t = stepLen.mul(jitter.mul(0.85).add(0.075)).toVar();
            const light = vec3(0.0).toVar();
            const through = float(1.0).toVar();
            const cosMoon = dot(dir, U.moon);
            const phase = mgPhase(float(AIR.forward), cosMoon).mul(0.85).add(0.15).mul(AIR.beam);
            // Pinned before the loop: the phase is the same at every step of the ray.
            const moonCol = night.moonlight.mul(U.moonLight).mul(phase).mul(this.uShafts).toVar();
            Loop(steps, () => {
                const p = eye.add(dir.mul(t)).toVar();
                const drift = vec2(U.time.mul(0.004), U.time.mul(-0.002));
                const billow = texture(noise, p.xz.mul(0.045).add(drift)).level(1.0).x;
                // The low mist lies over the canal and thins out over the beds.
                const overWater = float(1.0).sub(smoothstep(2.2, 4.2, abs(p.x))).mul(0.8).add(0.2);
                const low = exp(max(p.y.sub(0.1), 0.0).negate().div(AIR.lowFall))
                    .mul(billow.mul(1.4).add(0.3)).mul(overWater);
                const density = float(AIR.haze).add(low.mul(AIR.low));
                const lit = mgMoonlightBay(p, U.moon, stepLen.mul(0.25), U.moonBay).mul(mgCanopy(p, U.moon, U));
                // The lanterns' glow in the mist.
                const warm = vec3(0.0).toVar();
                Loop({
                    start: int(0), end: int(U.lanternCount), type: 'int', condition: '<', name: 'lamp',
                }, ({ lamp }) => {
                    const row = U.lanternRows.element(lamp);
                    const d = p.sub(row.xyz);
                    warm.addAssign(vec3(row.w.div(dot(d, d).mul(2.2).add(0.25))));
                });
                const glow = vec3(0.0).toVar();
                Loop({
                    start: int(0), end: int(U.bloomLightCount), type: 'int', condition: '<', name: 'flower',
                }, ({ flower }) => {
                    const a = U.bloomLights.element(flower.mul(2));
                    const b = U.bloomLights.element(flower.mul(2).add(1));
                    const d = p.sub(a.xyz);
                    glow.addAssign(b.xyz.mul(a.w.div(dot(d, d).mul(3.0).add(0.3))));
                });
                const local = moonCol.mul(lit)
                    .add(night.mist.mul(0.008))
                    .add(night.lantern.mul(warm).mul(U.lanternGain).mul(0.12))
                    .add(glow.mul(0.06));
                const absorb = density.mul(stepLen);
                light.addAssign(local.mul(absorb).mul(through));
                through.mulAssign(exp(absorb.mul(-AIR.extinction)));
                t.addAssign(stepLen);
            });
            return vec4(light, through);
        })();
        return rtt(march, null, null, { resolutionScale: look.marchScale, type: THREE.HalfFloatType });
    }

    /** Per-frame values (all optional). */
    update({
        flash, bloomBoost, exposure, time, shafts, gradeShadow, gradeLight,
    } = {}) {
        if (gradeShadow) this.uGradeShadow.value.set(gradeShadow[0], gradeShadow[1], gradeShadow[2]);
        if (gradeLight) this.uGradeLight.value.set(gradeLight[0], gradeLight[1], gradeLight[2]);
        if (flash !== undefined) this.uFlash.value = flash;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) {
            this.uExposure.value = exposure;
            if (this.bloomNode) this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, exposure);
        }
        if (time !== undefined) this.uTime.value = time;
        if (shafts !== undefined) this.uShafts.value = shafts;
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
        this.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
        this.pipeline.render();
    }

    dispose() {
        this.scenePass?.dispose();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.airNode?.dispose();
        this.fxaaNode?.textureNode?.dispose?.();
        this.fxaaNode = null;
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.airNode = null;
        this.depthNode = null;
        this.pipeline = null;
        this.camera = null;
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
