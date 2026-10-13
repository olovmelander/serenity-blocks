/**
 * Thermal Bloom — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT: the scene is authored in scene-linear HDR, so a max-channel knee
 * selects what blooms; MSAA only on Ultra and Extreme, because steam overdraw under MSAA is
 * bandwidth-heavy), one bloom chain (Medium and up) with a HIGH knee, so only spray glints, the
 * bow's core and wet sun-glints bloom while the bright sky and the steam never veil, and ONE
 * output pass:
 *
 *   heat shimmer (Medium and up: a small wobble inside the projected Iris and the Chalice's
 *   vent) → calm zones (what shows through the translucent board card and HUD is quietened and
 *   soft-clipped, and its bloom and grain attenuated) → bloom → exposure (fixed; no event ever
 *   changes it) → the mineral filmic (hue preserving: the mats keep their colour, lit steam
 *   lands near 0.86, never a flat white) → grade (clear cool shadows, faint warm highlights) →
 *   vivid (the saturation lift of eruptions and the perfect clear, capped at 1.25) → a light
 *   vignette → sRGB → grain and dither → FXAA on Medium and High.
 *
 * No rush, zoom blur, lens ripple or flash. Tone mapping happens exactly once:
 * renderer.toneMapping = NoToneMapping and the pipeline's outputColorTransform is off (the output
 * node encodes sRGB itself).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
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
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import {
    tbFilmic, tbHash21, tbLuma, tbMax3, tbRoundBoxSdf,
} from './thermal-bloom-tsl.js';
import { createVapourMarch, upsampleVapour } from './thermal-bloom-vapour.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode; `msaa` = four samples in the scene pass;
 * `fxaa` wraps the output pass; `shimmer` builds the heat-shimmer taps. Features off are not
 * built (gated here in JavaScript, never by a zero in the shader).
 */
export const POST_LOOK = Object.freeze({
    Minimal: Object.freeze({
        msaa: false,
        fxaa: false,
        bloom: false,
        bloomStrength: 0,
        bloomResolution: 0.25,
        shimmer: false,
        vapour: Object.freeze({
            steps: 8, scale: 0.25, detail: false, mistSteps: 0,
        }),
    }),
    Low: Object.freeze({
        msaa: false,
        fxaa: false,
        bloom: false,
        bloomStrength: 0,
        bloomResolution: 0.25,
        shimmer: false,
        vapour: Object.freeze({
            steps: 10, scale: 0.33, detail: false, mistSteps: 4,
        }),
    }),
    Medium: Object.freeze({
        msaa: false,
        fxaa: true,
        bloom: true,
        bloomStrength: 0.4,
        bloomResolution: 0.33,
        shimmer: true,
        vapour: Object.freeze({
            steps: 14, scale: 0.4, detail: false, mistSteps: 6,
        }),
    }),
    High: Object.freeze({
        msaa: false,
        fxaa: true,
        bloom: true,
        bloomStrength: 0.45,
        bloomResolution: 0.45,
        shimmer: true,
        vapour: Object.freeze({
            steps: 18, scale: 0.5, detail: true, mistSteps: 8,
        }),
    }),
    Ultra: Object.freeze({
        msaa: true,
        fxaa: false,
        bloom: true,
        bloomStrength: 0.5,
        bloomResolution: 0.5,
        shimmer: true,
        vapour: Object.freeze({
            steps: 22, scale: 0.5, detail: true, mistSteps: 10,
        }),
    }),
    Extreme: Object.freeze({
        msaa: true,
        fxaa: false,
        bloom: true,
        bloomStrength: 0.5,
        bloomResolution: 0.5,
        shimmer: true,
        vapour: Object.freeze({
            steps: 28, scale: 0.6, detail: true, mistSteps: 12,
        }),
    }),
});

/** The knee is divided by the exposure (times the iris): it follows what the eye adapts to. */
export const BLOOM_THRESHOLD = 1.6;
export const BLOOM_KNEE = 0.45;
export const BLOOM_RADIUS = 0.55;
export const EXPOSURE = 1.0;
/** The vivid lift's cap (photosensitivity: colour, never luminance). */
export const VIVID_MAX = 1.25;
/**
 * The toe under the filmic shoulder (the favourites' contrast): luma L goes toward
 * L²(1 + TOE)/(L + TOE) by TOE_MIX, hue kept, so the eye's cobalt, the wet channels and the plume
 * shadows carry real darks while the cream rim and lit steam (0.8–0.86) barely move.
 */
export const TOE = 0.25;
export const TOE_MIX = 0.72;
/** A base saturation lift under the season's and the eruptions' (colour, never luminance). */
export const BASE_SAT = 1.1;
/** The grain's strength, and the vignette's. */
const GRAIN = 0.009;
const VIGNETTE = 0.26;
/** How much darker the frame's foot is than its top (a natural graduated vignette: the near
 * ground under the lens falls into shade, the sky and the far basin keep their light). */
const FOOT_SHADE = 0.22;
/** Heat-shimmer amplitude in pixels at 1080p. */
const SHIMMER_PX = 0.6;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;
/** Shimmer ellipses (the Iris's and the Chalice vent's, projected). */
export const SHIMMER_MAX = 2;

export class ThermalBloomPost {
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
        this.scenePass = pass(scene, camera, { samples: look.msaa ? 4 : 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uIris = uniform(1);
        this.uSat = uniform(1);
        this.uVivid = uniform(1);
        this.uBloomBoost = uniform(0);
        // The season's grade (linear rgb), written by the world each frame.
        this.uGradeShadow = uniform(new THREE.Vector3(0.012, 0.03, 0.06));
        this.uGradeLight = uniform(new THREE.Vector3(1.0, 0.93, 0.84));

        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.uCalmStrength = uniform(0);
        // Shimmer ellipses: centre (x, y) and radii (rx, ry), screen fractions; zero radii = off.
        this.shimmerRects = Array.from({ length: SHIMMER_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uShimmer = this.shimmerRects.map((v) => uniform(v));

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
                // saturated mat toward white.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(7.0).div(max(tbMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = tbMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;

        // ── The vapour: the near steam, marched through the scene's depth on a reduced target ──
        // (the scene camera's own matrices: inside a pipeline pass the camera nodes are the quad's)
        const { world } = params;
        this.vapour = null;
        if (world?.u?.vapour && world.tex?.vapour && look.vapour) {
            this.uProjInv = uniform(camera.projectionMatrixInverse);
            this.uCamWorld = uniform(camera.matrixWorld);
            const depth = this.scenePass.getTextureNode('depth');
            const target = createVapourMarch({
                u: world.u,
                noise: world.tex.vapour,
                depth,
                projInv: this.uProjInv,
                camWorld: this.uCamWorld,
                look: look.vapour,
            });
            this.vapour = {
                target, depth, projInv: this.uProjInv, viewport: this.uViewport, scale: look.vapour.scale,
            };
            this.vapourOn = world.u.vapourOn;
            this.vapourOn.value = 1;
        }

        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);

            // ── Calm zones (board cards + HUD) ──
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i++) {
                const r = this.uCalm[i];
                const sdf = tbRoundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            // ── Heat shimmer: a sub-pixel wobble inside the projected vents, never over a card ──
            const st = screenUV.toVar();
            if (look.shimmer) {
                const wob = float(0.0).toVar();
                for (let i = 0; i < SHIMMER_MAX; i++) {
                    const e = this.uShimmer[i];
                    const d = st.sub(e.xy).div(max(e.zw, vec2(1e-4)));
                    const inside = float(1.0).sub(smoothstep(0.55, 1.0, length(d))).mul(step(1e-4, e.z));
                    wob.assign(max(wob, inside));
                }
                const t = this.uTime.mul(6.2832 * 1.2);
                const phase = st.y.mul(this.uViewport.y).mul(0.11);
                const amp = wob.mul(float(1.0).sub(calm)).mul(hScale.mul(SHIMMER_PX));
                st.addAssign(vec2(sin(t.add(phase)), sin(t.mul(0.83).add(phase.mul(1.7)).add(1.3)).mul(0.5))
                    .mul(amp).div(this.uViewport));
            }

            const fromCentre = screenUV.sub(0.5);
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            if (this.vapour) {
                // The steam over the scene: what lies behind dimmed by it, then its own light. Over
                // the card and the HUD it thins to a quarter (they stay readable through it).
                const air = upsampleVapour(this.vapour, screenUV).toVar();
                const keep = calm.mul(0.75);
                S.assign(S.mul(mix(air.a, float(1.0), keep)).add(air.rgb.mul(float(1.0).sub(keep))));
            }
            // What shows through the card is quietened toward its luma and soft-clipped
            // (hue-preserving on the max channel): a bright basin must not glare through.
            const quiet = mix(S, vec3(tbLuma(S)), 0.35).toVar();
            const m = max(tbMax3(quiet), 1e-5);
            const clipped = quiet.mul(min(m, float(0.22).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(st).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.5))).mul(float(1.0).sub(calm.mul(0.85))));
            }
            const H = S.add(glare);

            // ── Exposure, tone map, grade, vivid ──
            const X = H.mul(this.uExposure.mul(this.uIris)).toVar();
            const T = tbFilmic(X).toVar();
            const L0 = max(tbLuma(T), 1e-5);
            const Lt = mix(L0, L0.mul(L0).mul(1.0 + TOE).div(L0.add(TOE)), TOE_MIX);
            T.mulAssign(Lt.div(L0));
            const L = clamp(tbLuma(T), 0.0, 1.0).toVar();
            const dark = float(1.0).sub(L);
            T.assign(mix(T, this.uGradeShadow, dark.mul(dark).mul(0.1)));
            T.assign(mix(T, T.mul(this.uGradeLight), L.mul(L).mul(0.25)));
            // Saturation (the season's) times vivid (the eruptions'), never an exposure change.
            const satAmount = this.uSat.mul(min(this.uVivid, float(VIVID_MAX))).mul(BASE_SAT);
            T.assign(max(mix(vec3(tbLuma(T)), T, satAmount), vec3(0.0)));
            // Vignette, measured from the frame; light, for a high-key world.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.5, 1.15, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(VIGNETTE)));
            T.mulAssign(float(1.0).sub(smoothstep(0.55, 1.0, screenUV.y).mul(FOOT_SHADE).mul(float(1.0).sub(calm))));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = tbHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(GRAIN).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = tbHash21(pxi).add(tbHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                // Bands of the exposed, pre-tone-map max channel: what reaches the bloom's knee.
                const mx = tbMax3(X);
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
        this.pipeline.outputNode = look.fxaa && !falseColor ? fxaa(outputFn()) : outputFn();
        this.pipeline.needsUpdate = true;
    }

    /** Per-frame values (all optional). `gradeShadow` and `gradeLight` are linear rgb triples. */
    update({
        exposure, iris, sat, vivid, bloomBoost, time, gradeShadow, gradeLight, shimmer,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (iris !== undefined) this.uIris.value = iris;
        if (exposure !== undefined || iris !== undefined) {
            // The bloom's knee follows the iris: a brighter frame must not bloom into a veil.
            const seen = this.uExposure.value * this.uIris.value;
            if (this.bloomNode) this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, seen);
        }
        if (sat !== undefined) this.uSat.value = sat;
        if (vivid !== undefined) this.uVivid.value = Math.max(1, Math.min(VIVID_MAX, vivid));
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (time !== undefined) this.uTime.value = time;
        if (gradeShadow) this.uGradeShadow.value.set(gradeShadow[0], gradeShadow[1], gradeShadow[2]);
        if (gradeLight) this.uGradeLight.value.set(gradeLight[0], gradeLight[1], gradeLight[2]);
        if (shimmer) {
            for (let i = 0; i < SHIMMER_MAX; i++) {
                const e = shimmer[i];
                if (e) this.shimmerRects[i].set(e[0], e[1], e[2], e[3]);
                else this.shimmerRects[i].set(0, 0, 0, 0);
            }
        }
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
        this.vapour?.target?.dispose();
        if (this.vapourOn) this.vapourOn.value = 0;
        this.vapourOn = null;
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.vapour = null;
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
