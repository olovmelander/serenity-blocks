/**
 * Grainfields — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT; 4× MSAA from High up, shared/scene-antialias.js), the light in the air
 * (High and up at half resolution, Medium at a third: see QUALITY.air), one bloom chain (Medium
 * and up), and ONE full-screen output pass:
 *
 *   calm zones (what shows through the translucent board card and HUD is soft-clipped and its
 *   bloom held back) → bloom + the air's light → exposure (the hour's) → filmic (a hue-preserving
 *   shoulder on the max channel; only the hottest values roll toward white) → grade (a touch of
 *   vibrance for the grain, cool shadows by scaling only) → vignette → sRGB → grain and dither →
 *   FXAA (Low, Medium: the single-sampled tiers).
 *
 * The light in the air is a march along each pixel's line of sight that asks the storm deck, at
 * every step, whether the sun reaches that point (grainfields-tsl deckCover, the cover the sky
 * draws and the land's shadows read). Where it does the haze glows, and the vale's mist far more,
 * so every gap in the deck stands in the air as a shaft: against the fells, the sky and the
 * fields alike, from any direction the sun stands in.
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
    clamp,
    dot,
    exp,
    float,
    floor,
    interleavedGradientNoise,
    length,
    max,
    min,
    mix,
    normalize,
    pass,
    perspectiveDepthToViewZ,
    renderOutput,
    rtt,
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
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { sceneSamples } from '../shared/scene-antialias.js';
import { DECK } from './grainfields-core.js';
import {
    coreCover, deckCover, deckPointAbove, gfHash21, gfLuma, gfMax3,
} from './grainfields-tsl.js';
import { HAZE_HEIGHT, MIST_HEIGHT, MIST_FLOOR } from './grainfields-light.js';
import { flashScale } from '../../utils/photosensitivity.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode; `air` the march's steps (0: none) and
 * `airScale` its resolution; `msaa` the scene pass's samples with the game's antialiasing on
 * (the shared table); `fxaa` smooths a single-sampled pass (the MSAA tiers need none).
 */
const LOOKS = {
    Extreme: {
        bloom: true, bloomStrength: 0.3, bloomResolution: 0.5, air: 26, airScale: 0.5, fxaa: false,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.3, bloomResolution: 0.5, air: 24, airScale: 0.5, fxaa: false,
    },
    High: {
        bloom: true, bloomStrength: 0.28, bloomResolution: 0.45, air: 20, airScale: 0.5, fxaa: false,
    },
    Medium: {
        bloom: true, bloomStrength: 0.26, bloomResolution: 0.33, air: 14, airScale: 0.34, fxaa: true,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, air: 0, airScale: 0.25, fxaa: true,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, air: 0, airScale: 0.25, fxaa: false,
    },
};
export const POST_LOOK = Object.freeze(Object.fromEntries(Object.entries(LOOKS)
    .map(([tier, look]) => [tier, { ...look, msaa: sceneSamples(tier) }])));

export const BLOOM_THRESHOLD = 1.1;
export const BLOOM_KNEE = 0.45;
export const BLOOM_RADIUS = 0.55;
/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;
/** How far the march looks along a line of sight (metres): past the vale and the foothills. */
export const AIR_RANGE = 24000;

/**
 * The storm's rain, in the march: curtains `size`/16 metres across (the share of the core they
 * fill from `part`), fibrous at `fibre` of that size, raked by `rake` metres a metre fallen,
 * `density` its extinction per metre in
 * a curtain's heart, thinning to half by `fade` metres over the ground; none within `near` metres
 * of the eye (it falls kilometres away); `shine` how much brighter than haze it scatters the sun
 * where a gap lets it in.
 */
export const RAIN = Object.freeze({
    size: 30000, part: Object.freeze([0.55, 0.74]), fibre: 0.14, rake: 0.22, density: 0.00062, fade: 1500, near: 2500, shine: 0.45,
});

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'gf_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Filmic: identity below the knee, a hue-preserving shoulder above it, and a path to white only
 * for the hottest values (the sun's disc, a flash), so sunlit gold stays gold.
 *
 * The shoulder is rational (z / (1 + z)), not exponential: both leave the knee at slope 1, but the
 * exponential had all but reached white by 1.6, so a sunlit field (1–2.5 at the storm break and in
 * the golden hour) went to one flat gold and every gust, patch of ripeness and depth in the stand
 * with it. The rational one spreads 1–4 over the top of the range.
 */
export const FILMIC_KNEE = 0.6;
const gfFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(max(c.x, max(c.y, c.z)), 1e-5);
    const k = float(FILMIC_KNEE);
    const z = peak.sub(k).div(float(1.0).sub(k)).max(0.0);
    const shoulder = k.add(float(1.0).sub(k).mul(z.div(z.add(1.0))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const w = smoothstep(2.4, 9.0, peak).mul(0.9);
    return mix(toned, vec3(mapped, mapped, mapped), w);
}).setLayout({ name: 'gf_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class GrainfieldsPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {object} [params.u]         the world's uniforms (the march reads the deck through them)
     * @param {object} [params.t]         the world's textures ({ noise })
     * @param {number} [params.samples=0] the scene pass's MSAA samples
     * @param {boolean} [params.antialias=true] the game's antialiasing setting (off: no FXAA either)
     * @param {boolean} [params.falseColor=false]
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.renderer = renderer;
        this.camera = camera;
        this.look = look;
        this.samples = params.samples ?? 0;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');
        const { u, t } = params;
        const marches = Boolean(look.air > 0 && u && t);
        this.marches = marches;
        const sceneDepth = marches ? this.scenePass.getTextureNode('depth') : null;

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(1);
        this.uBloomBoost = uniform(0);
        /** The air's light: its gain (a chain lifts it). */
        this.uAir = uniform(1);
        /** A flash of light over the whole frame (four lines, perfect clear), 0..1. */
        this.uFlash = uniform(0);
        this.uFlashColour = uniform(new THREE.Vector3(1, 0.92, 0.75));
        this.uSaturation = uniform(1.1);
        // The scene camera's basis for the march (the pass's own camera is the quad's).
        this.uEye = uniform(new THREE.Vector3());
        this.uForward = uniform(new THREE.Vector3(0, 0, -1));
        this.uRight = uniform(new THREE.Vector3(1, 0, 0));
        this.uUp = uniform(new THREE.Vector3(0, 1, 0));
        this.uNear = uniform(0.5);
        this.uFar = uniform(90000);
        this.uAirTexel = uniform(new THREE.Vector2(1 / 960, 1 / 540));
        this.drawing = new THREE.Vector2();

        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.uCalmStrength = uniform(0);

        // ── The light in the air ──
        let air = null;
        this.airNode = null;
        if (marches) {
            this.airNode = rtt(this.buildAir(u, t, sceneDepth, look.air), null, null, { resolutionScale: look.airScale });
            this.airNode.renderTarget.texture.name = 'Grainfields — light in the air';
            // A 3 × 3 tent a texel apart over bilinear taps: it takes the march's jitter out.
            const tap = (x, y) => this.airNode.sample(screenUV.add(this.uAirTexel.mul(vec2(x, y))));
            air = tap(0, 0).mul(4.0)
                .add(tap(-1, 0).add(tap(1, 0)).add(tap(0, -1)).add(tap(0, 1))
                    .mul(2.0))
                .add(tap(-1, -1).add(tap(1, -1)).add(tap(-1, 1)).add(tap(1, 1)))
                .mul(1 / 16);
        }

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
                // Hue-preserving clamp on the max channel: a per-channel clamp turns gold white.
                const tapB = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(3.0).div(max(gfMax3(c), 1e-4))));
                };
                const c = tapB(1, 1).add(tapB(-1, 1)).add(tapB(1, -1)).add(tapB(-1, -1))
                    .mul(0.25);
                const br = gfMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;

        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);

            // ── Calm zones (board cards + HUD) ──
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
                const r = this.uCalm[i];
                const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            const S = vec3(sceneColor.sample(screenUV).rgb).toVar();
            if (air) {
                // The rain's veil: the storm's own grey (the diffuse light under the deck) over what
                // lies behind a curtain; lighter than the fells' dark faces, darker than the bright
                // band low on the horizon.
                const veil = clamp(air.a, 0.0, 1.0);
                const rainGrey = u.haze.mul(0.85).add(u.fill.mul(0.5)).add(u.horizon.mul(0.1));
                S.assign(mix(rainGrey, S, veil));
                S.addAssign(vec3(air.rgb).mul(this.uAir));
            }

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(gfMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.18).add(m.mul(0.08)), 0.5)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.88)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.8))));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.85)));
            const H = S.add(glare);

            // ── Exposure, flash, tone map, grade ──
            const flash = this.uFlashColour.mul(this.uFlash.mul(0.3)).mul(float(1.0).sub(calm.mul(0.8)));
            const X = H.mul(this.uExposure).add(flash);
            const T = gfFilmic(X).toVar();
            const L = gfLuma(T);
            // Shadows lean a little cool (scaled, never lifted: an added constant veils the blacks).
            const lo = float(1.0).sub(smoothstep(0.0, 0.3, L));
            T.assign(mix(T, T.mul(vec3(0.93, 0.97, 1.08)), lo.mul(0.6)));
            // Vibrance: colourful things a little more so, the grey sky left alone.
            const sat = max(gfMax3(T).sub(min(T.x, min(T.y, T.z))), 0.0).div(max(gfMax3(T), 1e-4));
            const vib = mix(this.uSaturation, float(1.0), sat);
            T.assign(max(mix(vec3(gfLuma(T)), T, vib), vec3(0.0)));
            // A gentle contrast curve (clamped first: a polynomial folds values above 1 back down).
            const C = clamp(T, 0.0, 1.0);
            T.assign(mix(C, C.mul(C).mul(float(3.0).sub(C.mul(2.0))), 0.38));
            // Vignette, measured from the frame.
            const cv = screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.15, length(cv.mul(1.45)));
            T.mulAssign(float(1.0).sub(vig.mul(0.34)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = gfHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.011).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = gfHash21(pxi).add(gfHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = gfMax3(H.mul(this.uExposure));
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
        // FXAA only over a single-sampled pass, and never over the false-colour view.
        const smoothPass = look.fxaa && this.samples === 0 && params.antialias !== false && !falseColor;
        this.fxaaNode = smoothPass ? fxaa(outputFn()) : null;
        this.pipeline.outputNode = this.fxaaNode || outputFn();
        this.pipeline.needsUpdate = true;
    }

    /**
     * The sunlit air along each pixel's line of sight, to the land it meets (or the deck's base, or
     * AIR_RANGE). Haze thins with height; the vale's mist lies low and patchy; each step asks the
     * deck above it whether the sun gets through.
     */
    buildAir(u, t, sceneDepth, steps) {
        return Fn(() => {
            const st = uv();
            const depth = sceneDepth.sample(st).r;
            const viewZ = perspectiveDepthToViewZ(depth, this.uNear, this.uFar);
            const ray = this.uForward.add(this.uRight.mul(st.x.mul(2).sub(1)))
                .add(this.uUp.mul(float(1).sub(st.y.mul(2)))).toVar();
            const dir = normalize(ray).toVar();
            // To the land, or up to the deck's base (the sky behind is the dome's), or the range.
            const toDeck = select(dir.y.greaterThan(0.002), float(DECK.base).sub(this.uEye.y).div(dir.y), float(1e6));
            const toLand = select(depth.lessThan(0.99999), length(ray).mul(viewZ.negate()), float(1e6));
            const reach = min(min(toLand, toDeck), float(AIR_RANGE)).toVar();
            // Steps crowd near the eye (the shafts close by are the sharpest): t = reach · (i/N)^1.6.
            const jitter = interleavedGradientNoise(screenCoordinate.xy).toVar();
            const sum = float(0.0).toVar();
            const tau = float(0.0).toVar();
            const tauRain = float(0.0).toVar();
            const prevT = float(0.0).toVar();
            const hazeA = u.hazeDensity.mul(1.0 / 15000);
            const mistA = u.mistDensity.mul(1.0 / 900);
            const R = RAIN;
            // Rain under the storm's core: curtains hanging from the deck's base, raked a little by
            // the wind below it, drifting with the deck, thinning toward the ground they fall on.
            const rainAt = (X, along) => {
                const below = max(float(DECK.base).sub(X.y), 0.0);
                const at = X.xz.add(u.windDir.mul(below.mul(R.rake))).add(u.drift.mul(0.8));
                // A curtain is fibrous: finer shafts of heavier rain in it, so it reads as falling.
                const fibres = texture(t.noise, at.div(R.size * R.fibre).add(vec2(0.43, 0.17))).b;
                const curtain = smoothstep(R.part[0], R.part[1], texture(t.noise, at.div(R.size)).g)
                    .mul(fibres.mul(1.1).add(0.45));
                const falls = smoothstep(0.0, 400.0, below).mul(float(1.0).sub(smoothstep(0.0, R.fade, X.y).mul(0.45)));
                const core = coreCover(u, X.xz);
                return core.mul(core).mul(curtain).mul(falls).mul(u.rain)
                    .mul(R.density)
                    .mul(smoothstep(R.near * 0.5, R.near, along));
            };
            Loop(steps, ({ i }) => {
                const f = float(i).add(jitter).div(steps);
                // Pinned as vars BEFORE prevT moves: an expression node is emitted where it is used,
                // and used after the assignment it would read the new prevT (ds = 0).
                const tt = reach.mul(f.mul(f).mul(0.4).add(f.mul(0.6))).toVar();
                const ds = tt.sub(prevT).toVar();
                prevT.assign(tt);
                const X = this.uEye.add(dir.mul(tt)).toVar();
                const haze = hazeA.mul(exp(X.y.div(-HAZE_HEIGHT)));
                // The vale's mist: low, in banks that drift.
                const bank = texture(t.noise, X.xz.add(u.drift.mul(0.05)).div(2600.0)).g;
                const mist = mistA.mul(exp(max(X.y.sub(MIST_FLOOR), 0.0).div(-MIST_HEIGHT))).mul(bank.mul(1.6).add(0.2));
                const rainSigma = rainAt(X, tt);
                const sigma = haze.add(mist);
                // Under thick cloud the air gets no direct sun at all (the sky's diffuse light in the
                // haze is the land's aerial term): only the gaps light it, so the shafts stand alone.
                const open = float(1.0).sub(deckCover(u, t.noise, deckPointAbove(u, X), { locks: false }));
                // The eye's own shaft (it stands in the sun's gap) is left out near it, so the air
                // toward the sun is not one glare and the shafts before the fells stand alone.
                const sunVis = open.mul(open).mul(smoothstep(500.0, 3200.0, tt));
                // Rain the sun reaches through a gap shines (the drops scatter much of it forward).
                sum.addAssign(sunVis.mul(sigma.add(rainSigma.mul(R.shine))).mul(exp(tau.negate())).mul(ds));
                tau.addAssign(sigma.add(rainSigma).mul(ds));
            });
            // The rain's veil, on its own finer steps: the curtains are a kilometre or two across and
            // the march's steps nearly as long, which dithered them into a mesh. Texture reads only.
            If(u.rain.greaterThan(0.001), () => {
                const from = float(R.near * 0.5);
                const span = max(reach.sub(from), 0.0).toVar();
                const rainSteps = steps * 2;
                Loop(rainSteps, ({ i }) => {
                    const tt = from.add(span.mul(float(i).add(jitter).div(rainSteps))).toVar();
                    tauRain.addAssign(rainAt(this.uEye.add(dir.mul(tt)), tt).mul(span.div(rainSteps)));
                });
            });
            const mu = clamp(dot(dir, u.sunDir), 0.0, 1.0);
            const mu2 = mu.mul(mu);
            const mu4 = mu2.mul(mu2);
            const phase = mu4.mul(mu4).mul(1.4).add(mu4.mul(0.6)).add(mu2.mul(0.2))
                .add(0.05);
            const lit = u.sun.mul(u.sunUp).mul(sum).mul(phase).mul(0.95);
            // The rain's veil over what lies behind it (its own grey is laid in by the output).
            return vec4(lit, exp(tauRain.negate()));
        })();
    }

    /** Per-frame values (all optional). */
    update({
        exposure, bloomBoost, air, flash, flashColour, saturation, time,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (air !== undefined) this.uAir.value = air;
        if (flash !== undefined) this.uFlash.value = flash * flashScale();
        if (flashColour) this.uFlashColour.value.set(flashColour[0], flashColour[1], flashColour[2]);
        if (saturation !== undefined) this.uSaturation.value = saturation;
        if (time !== undefined) this.uTime.value = time;
        if (this.bloomNode && exposure !== undefined) {
            // The knee follows the iris: bloom selects what is bright AFTER exposure.
            this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, exposure);
        }
    }

    /** Hand this frame's camera to the march. */
    aim() {
        const { camera, renderer } = this;
        if (!camera?.isPerspectiveCamera) return;
        camera.updateMatrixWorld();
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
        this.uEye.value.setFromMatrixPosition(camera.matrixWorld);
        this.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(tanV * camera.aspect);
        this.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize().multiplyScalar(tanV);
        this.uForward.value.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
        this.uNear.value = camera.near;
        this.uFar.value = camera.far;
        if (this.airNode) {
            const drawing = renderer.getDrawingBufferSize(this.drawing);
            const scale = this.look.airScale;
            this.uAirTexel.value.set(
                1 / Math.max(1, Math.floor(drawing.x * scale)),
                1 / Math.max(1, Math.floor(drawing.y * scale)),
            );
        }
    }

    /**
     * Calm rects in screen fractions (x0, y0, x1, y1; y down), at most CALM_RECTS_MAX, and the
     * eased strength (0 = off).
     */
    setCalmRects(rects, strength) {
        for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
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
        this.aim();
        this.pipeline.render();
    }

    dispose() {
        this.scenePass?.dispose();
        this.airNode?.dispose?.();
        this.airNode?.renderTarget?.dispose?.();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        // FXAA reads the graded picture through a render target of its own.
        this.fxaaNode?.textureNode?.dispose?.();
        this.pipeline?.dispose();
        this.scenePass = null;
        this.airNode = null;
        this.bloomNode = null;
        this.fxaaNode = null;
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
