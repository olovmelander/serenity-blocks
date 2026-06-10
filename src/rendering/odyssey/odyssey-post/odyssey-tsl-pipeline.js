/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, camelcase */
/**
 * @fileoverview Odyssey TSL post-processing pipeline (WebGPU).
 *
 * Part of the Odyssey AAA WebGPU migration (P-post). See docs/ODYSSEY_AAA_MASTER_PLAN.md §3.5.
 * The cinematic post stack for the converted board, modeled on the shipped
 * winter/electric-dreams TSL pipelines (THREE.PostProcessing node graph). Replaces the
 * legacy EffectComposer + UnrealBloomPass + GLSL ShaderPass chain (which WebGPURenderer
 * cannot run).
 *
 * Stack (in order): scene HDR → edge CA → bloom add → exposure → ACES tonemap →
 * MASTER GRADE → per-chapter grade → vignette → grain/dither → output. The single
 * global exposure (uExposure) + one ACES curve expose every chapter (dark cosmic ↔
 * bright mountains) correctly; tonemap runs AFTER bloom and BEFORE the grade so bright
 * emitters keep their hue instead of clipping to white, and so the grade never causes a
 * white blowout (it sits entirely in display range). Detail:
 *   1. Chromatic aberration (radial, ~0 at centre, concentrated at the frame EDGES) —
 *      resamples the HDR scene. Globally subtle for a lens feel; the director intensifies
 *      it briefly at the Black Hole (ch7) as a gravitational-lensing accent (uChroma).
 *   2. Bloom — threshold bloom on the scene output (bright additive path/nodes/breaches/
 *      lava/neon/accretion/god-rays bloom; dark sky backstops stay below threshold).
 *      A `useMRT` option switches to true selective bloom from the emissive MRT channel
 *      once every bloom-eligible material sets an emissiveNode (the emitsBloom tags).
 *   3. Exposure (single global uniform) then ACES filmic tonemap (manual; renderer must
 *      use NoToneMapping). HDR → display range under one curve.
 *   4. MASTER GRADE (display space) — ONE film stock for all 8 chapters: a tinted toe
 *      (lift+tint deep shadows toward a cool teal/indigo, then gently crush blacks), a
 *      soft highlight shoulder roll-off, a gentle S-curve contrast, a slight global
 *      temperature/tint bias, and a subtle saturation lift. Then a small PER-CHAPTER
 *      grade shift on top (signature tint + temp + contrast nudge), director-driven so a
 *      seam cross-fades the chapter signature while every chapter shares the master curve.
 *   5. Arc-modulated vignette (display-space, post-tonemap) — focuses the eye on the
 *      path/node; STRONGER in the introspective beats (Deep Ocean ch2, Black Hole ch7),
 *      LIGHTER in the open beats (Mountains ch4, Sky ch5). Director-driven (uVignette).
 *   6. Film grain + dither (anti-banding) — always last.
 *
 * All strengths are uniforms; update()/updateDynamic() are fed per-frame from the
 * OdysseyDirector (exposure / bloom / grade tint / chroma / vignette) so the post breathes
 * with the climb. The director-modulated amounts (chroma, vignette, per-chapter tint /
 * contrast) are SMOOTHED frame-to-frame so seams and beats never pop.
 */

import * as THREE from 'three/webgpu';
import {
    clamp,
    dot,
    emissive,
    float,
    fract,
    length,
    max,
    min,
    mix,
    mrt,
    output,
    pass,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// A6: seam-bloom accent multiplier. Was effectively 0.5 (a white flash hiding the old hard
// portal cut). Cut to a fraction of that so the ecotone blend reads instead of blowing out.
const SEAM_BLOOM_BOOST = 0.1;

// ── Master film stock (constant across all 8 chapters) ──────────────────────────
// The single look every chapter shares. Tasteful, display-space, post-ACES — these are
// the "one film stock" knobs; the per-chapter table below only NUDGES on top of these.
const MASTER = Object.freeze({
    // Tinted toe: deep shadows lifted+tinted toward a cool teal/indigo, then blacks
    // gently crushed. Cool toe + warm-ish highlights is the classic teal/amber film look.
    toeTint: new THREE.Color(0.06, 0.10, 0.16), // cool teal-indigo cast in the shadows
    toeLift: 0.012, // how far the deep shadows are lifted toward toeTint
    blackCrush: 0.018, // gentle black point raise (subtractive floor) for contrast
    shoulder: 0.86, // highlight shoulder roll-off knee (lower = earlier, softer rolloff)
    contrast: 1.07, // gentle global S-curve contrast around mid-grey
    saturation: 1.06, // subtle global saturation lift
    // Slight global temperature/tint bias (per-channel multiply, ~1.0). Warm reds,
    // cool-ish blues = a hair of teal/amber separation baked into the stock.
    tempBias: new THREE.Color(1.015, 1.0, 0.985),
});

// ── Per-chapter grade SIGNATURE (1-indexed → table index chapter-1) ─────────────
// A small grade SHIFT layered on top of the master curve so each world keeps a tint
// fingerprint while sharing the film stock. These are deliberately gentle (grade, don't
// recolor): tint is a colour the chapter biases toward, tempBias is a subtle per-channel
// multiply, contrast a tiny nudge. vignette/chroma are the per-arc modulation WEIGHTS
// (multipliers on the base vignette / CA) consumed in update() — stronger vignette in the
// introspective beats (ch2 Deep Ocean, ch7 Black Hole), lighter in the open beats (ch4
// Mountains, ch5 Sky); CA spikes at ch7 (gravitational lensing).
//
// B4 (global grade) added two NEW per-chapter columns that follow the SAME seam-lerp +
// smoothing path as tint/contrast (see _resolveChapterSignature):
//   • sat          — per-chapter saturation (anchor ~1.06). Applied in the per-chapter
//                    grade shift. HOT chapters (Earth Core / Urban) drop toward 0.96–1.0
//                    so lava/neon do not over-saturate into clipping.
//   • shoulderKnee — per-chapter highlight shoulder-knee bias driven into the MASTER
//                    shoulder roll-off. HOT chapters (Earth Core ~0.78 / Urban ~0.80)
//                    roll off EARLIER so lava/neon compress before they clip; the
//                    reference chapters (Mtn ch4 / Space ch6) sit at the master 0.86.
// Values are calibrated to §2's signature table. PRESERVE the magenta ch7 tint + the
// hot-chapter knees; the env batches depend on this look.
const CHAPTER_SIGNATURES = Object.freeze([
    // 1 Earth Core — molten amber warmth; early knee + lower sat so lava never clips.
    {
        tint: [1.05, 0.95, 0.87], contrast: 1.00, vignette: 1.0, chroma: 1.0, sat: 0.96, shoulderKnee: 0.78,
    },
    // 2 Deep Ocean — cool teal toe, deep introspective vignette, raised contrast.
    {
        tint: [0.86, 0.98, 1.10], contrast: 1.12, vignette: 1.28, chroma: 1.0, sat: 1.06, shoulderKnee: 0.86,
    },
    // 3 Surface World — fresh green-gold daylight, light vignette.
    {
        tint: [0.97, 1.04, 0.95], contrast: 1.0, vignette: 0.90, chroma: 1.0, sat: 1.06, shoulderKnee: 0.86,
    },
    // 4 Mountains — open, airy, light vignette (REFERENCE stock).
    {
        tint: [1.02, 1.00, 1.06], contrast: 1.03, vignette: 0.74, chroma: 1.0, sat: 1.06, shoulderKnee: 0.86,
    },
    // 5 Sky & Drift — warm violet haze, open frame.
    {
        tint: [1.05, 0.96, 1.07], contrast: 0.98, vignette: 0.70, chroma: 1.0, sat: 1.06, shoulderKnee: 0.86,
    },
    // 6 Space — cool indigo, slightly closer frame (REFERENCE stock).
    {
        tint: [0.94, 0.96, 1.10], contrast: 1.02, vignette: 1.05, chroma: 1.05, sat: 1.06, shoulderKnee: 0.86,
    },
    // 7 Black Hole — magenta, value-aware vignette eased to 1.05 + CA spike (lensing).
    {
        tint: [1.08, 0.90, 1.04], contrast: 1.05, vignette: 1.05, chroma: 1.9, sat: 1.06, shoulderKnee: 0.86,
    },
    // 8 Urban Encore — neon cyan/magenta kinetic; early knee + sat 1.0 so neon never clips.
    {
        tint: [0.96, 1.02, 1.08], contrast: 1.03, vignette: 1.12, chroma: 1.1, sat: 1.0, shoulderKnee: 0.80,
    },
]);

const CHAPTER_COUNT = CHAPTER_SIGNATURES.length;

// Neutral tint target reused when relaxing the per-chapter grade with no director.
const NEUTRAL_TINT = new THREE.Color(1, 1, 1);

function clampChapter(n) {
    if (!Number.isFinite(n)) return 1;
    return Math.min(CHAPTER_COUNT, Math.max(1, Math.round(n)));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

export class OdysseyTslPipeline {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.useMRT = params.useMRT ?? false; // threshold bloom by default; MRT once emissiveNodes land
        // Batch6: bloom is a low-frequency effect — quarter-res working buffers are visually
        // indistinguishable from half-res while halving bloom bandwidth/fill. Default 0.25
        // (was 0.5); callers can still override. The board controller (Wave 2 adaptive quality)
        // may raise this back toward 0.5 on high tiers via setBloomScale().
        this.bloomScale = params.bloomScale ?? 0.25;
        // QW14: honor the preset's enableBloom flag. The Minimal tier (and any caller) can set
        // enableBloom:false to drop the entire bloom node — no high-pass, no 6 blur passes, no
        // composite — for ~12 fewer full-screen post passes/frame. Defaults true (unchanged
        // behaviour for existing callers, which never passed this flag).
        this.enableBloom = params.enableBloom !== false;
        this.size = { width: 0, height: 0 };

        // Drop-in compatibility with the legacy PostProcessingStack the board controller
        // used: same `composer`/`update`/`resize`/`triggerChapterSeam`/`setChapterSeamState`
        // surface so OdysseyBoardController can swap this in with a one-line change.
        this.composer = null;
        this.passes = {};
        this._seamBoost = 0; // transient bloom punch on chapter-seam crossings (frame-decayed)

        // ── Smoothed director-driven modulation state (no per-frame allocs) ──
        // The chapter signature is resolved (source→target by seamProgress) every frame,
        // then exponentially smoothed into these so seams/beats glide instead of popping.
        this._smChroma = params.chroma ?? 0.0015; // edge-CA base amount (radial)
        this._smVignette = params.vignette ?? 0.42; // vignette strength
        this._smChapterContrast = 1.0; // per-chapter contrast nudge
        this._smChapterTint = new THREE.Color(1, 1, 1); // per-chapter signature tint
        this._scratchTint = new THREE.Color(); // resolve target (reused)
        // B4 new smoothed signature columns (same seam-lerp + smoothing path as above).
        this._smChapterSat = MASTER.saturation; // per-chapter saturation (anchor ~1.06)
        this._smShoulderKnee = MASTER.shoulder; // per-chapter shoulder-knee bias

        // ── B4: Black Hole (ch7) screen-space lensing state (no per-frame allocs) ──
        // setLensTarget(worldVec3) projects the BH env's group.userData.lensWorldPos to NDC
        // each frame; the centre is smoothed on enter/exit so the lens glides in. uLensStrength
        // ramps with the ch7 seam/energy (0 elsewhere) and peaks late; uLensRadius is the black
        // event-horizon core radius in NDC. Reuse one Vector2 (smoothed centre) + scratch V3/V2.
        this._smLensCenter = new THREE.Vector2(0.5, 0.5); // smoothed NDC centre
        this._smLensStrength = 0; // smoothed deflection strength (0 outside ch7)
        this._lensActive = false; // whether a valid lens target was set this frame
        this._scratchLensV3 = new THREE.Vector3(); // project-to-NDC scratch (world)
        this._scratchLensV2 = new THREE.Vector2(); // project-to-NDC scratch (ndc)
        // B4: ch8 ignition exposure/bloom swell state (last ~18% of ch8; smoothed).
        this._smIgnition = 0; // 0 idle → 1 fully ignited spire (smoothed)

        // ── Wave 2 (OdysseyAdaptiveQuality) post-quality knobs ───────────────────────────
        // The adaptive controller softens the cheapest post terms under sustained GPU
        // pressure (Tier 2). update() resolves uChroma/uGrain from director state every
        // frame, so a controller that poked those uniforms directly would be overwritten
        // next frame. Instead we hold MULTIPLIERS here that update() applies AFTER its own
        // resolution — so the controller's choice survives the per-frame smoother. Both
        // default to 1 (full quality / no behaviour change for existing callers).
        this._postChromaScale = 1; // edge-CA (uChroma) multiplier (1 full → 0 disabled)
        this._postGrainScale = 1; // film-grain (uGrain) multiplier (1 full → 0 disabled)
        // Tier-1 bloom gate: when false the controller has shut bloom off regardless of the
        // director's bloom weight (the LEAN no-bloom variant is forced in update()). Honors
        // the constructor enableBloom (no node ⇒ never allowed). No-op for existing callers.
        this._bloomAllowed = this.enableBloom;
        this._baseGrain = params.grain ?? 0.022; // grain anchor the scale multiplies

        this.postProcessing = new THREE.PostProcessing(renderer);
        const scenePass = pass(scene, camera);
        this.scenePass = scenePass;

        const sceneColor = scenePass.getTextureNode('output');

        // QW14: when bloom is disabled for this tier, skip building the bloom node entirely.
        // No high-pass / blur / composite passes are created or rendered. _baseBloom stays 0
        // so update()'s strength math is a no-op and the bloom-active gate (below) never picks
        // a with-bloom output variant.
        this.bloomNode = null;
        this._baseBloom = 0;
        if (this.enableBloom) {
            let bloomSource;
            if (this.useMRT) {
                scenePass.setMRT(mrt({ output, emissive }));
                bloomSource = scenePass.getTextureNode('emissive');
            } else {
                bloomSource = scenePass.getTextureNode('output');
            }

            // Threshold-disciplined defaults: only genuinely bright emitters bloom (no white
            // blowout). The board controller passes 0.32 / 0.85 explicitly; these defaults
            // match that level for any other construction path. The MRT branch uses a low
            // threshold because selective bloom is driven by the dedicated emissive channel.
            this.bloomNode = bloom(
                bloomSource,
                params.bloomStrength ?? 0.32,
                params.bloomRadius ?? (this.useMRT ? 0.85 : 0.7),
                params.bloomThreshold ?? (this.useMRT ? 0.0 : 0.85),
            );

            // QW13: 5 → 3 blur mips. The glow radius here is small (0.7), so the two widest
            // mips contribute almost nothing visible while costing 4 full-screen passes (2 mips
            // × horizontal+vertical) + their render targets every frame. Set BEFORE first
            // setup()/render so the blur-material loop, the per-frame blur loop, and setSize all
            // run at 3 mips. The internal composite still references the 5 fixed blur texture
            // nodes, but mips 3–4 stay at their 1×1 cleared (black) targets and add nothing —
            // a couple of cheap 1×1 fetches vs. 4 full-screen blur passes saved.
            this.bloomNode._nMips = 3;

            // Batch6: actually DROP the bloom working resolution to bloomScale (default 0.25).
            // BloomNode.updateBefore() re-derives its own size from the FULL drawing buffer each
            // frame (`this.setSize(fullW, fullH)`), which would override any external resize and
            // pin bloom at half-res. Wrap the instance setSize so every call — internal or ours —
            // is pre-scaled by bloomScale. Bloom is a low-frequency effect, so quarter-res is
            // visually indistinguishable from half-res while ~quartering its blur bandwidth/fill.
            // (Internally BloomNode still halves again per mip, as before.)
            const baseBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
            this.bloomNode.setSize = (width, height) => {
                const s = this.bloomScale;
                baseBloomSetSize(
                    Math.max(1, Math.round(width * s)),
                    Math.max(1, Math.round(height * s)),
                );
            };

            this._baseBloom = this.bloomNode.strength.value;
        }

        // ── Runtime uniforms (director-driven) ──
        this.uTime = uniform(0);
        this.uExposure = uniform(params.exposure ?? 1.0);
        this.uContrast = uniform(params.contrast ?? 1.06);
        this.uSaturation = uniform(params.saturation ?? 1.08);
        this.uVignette = uniform(params.vignette ?? 0.42);
        this.uChroma = uniform(params.chroma ?? 0.0015);
        this.uGrain = uniform(params.grain ?? 0.022);
        this.uGradeTint = uniform(params.gradeTint ?? new THREE.Color(1, 1, 1));
        this.uGradeStrength = uniform(params.gradeStrength ?? 0.18);

        // ── Master-grade uniforms (the shared film stock; rarely change at runtime) ──
        this.uToeTint = uniform(MASTER.toeTint.clone());
        this.uToeLift = uniform(params.toeLift ?? MASTER.toeLift);
        this.uBlackCrush = uniform(params.blackCrush ?? MASTER.blackCrush);
        this.uShoulder = uniform(params.shoulder ?? MASTER.shoulder);
        this.uMasterContrast = uniform(params.masterContrast ?? MASTER.contrast);
        this.uMasterSaturation = uniform(params.masterSaturation ?? MASTER.saturation);
        this.uTempBias = uniform(MASTER.tempBias.clone());

        // ── Per-chapter signature uniforms (smoothed; set in update()) ──
        this.uChapterTint = uniform(this._smChapterTint.clone());
        this.uChapterContrast = uniform(this._smChapterContrast);
        // B4: per-chapter saturation + shoulder-knee (smoothed; same seam-lerp path).
        this.uChapterSat = uniform(this._smChapterSat);
        this.uShoulderKnee = uniform(this._smShoulderKnee);

        // B4: ch8 ignition swell — global exposure multiplier + bloom contribution + a
        // lifted (deep-indigo, not crushed) shadow floor over the last ~18% of ch8.
        this.uIgnition = uniform(0); // 0 idle → 1 ignited (smoothed in update())

        // B4: per-chapter black-crush scale (1.0 default; eased toward ~0.35 in ch7 so the
        // structured violet void survives tonemap instead of crushing back to RGB-black).
        this.uCrushScale = uniform(1.0);
        // B4: ch8 shadow-floor lift — blend the deepest shadows toward a DEEP INDIGO film
        // floor (not pure black) as the ignition ramps. Amount is driven by uIgnition.
        this.uShadowFloorTint = uniform(new THREE.Color(0.05, 0.035, 0.11)); // deep indigo
        this.uShadowFloorLift = uniform(0); // 0 idle → ~0.5 at full ch8 ignition

        // ── B4: Black Hole (ch7) screen-space gravitational-lensing uniforms ──
        // Default centred + zero strength so the warp is an exact no-op outside ch7.
        this.uLensCenter = uniform(new THREE.Vector2(0.5, 0.5)); // NDC centre of the hero
        this.uLensStrength = uniform(0); // radial deflection gain (0 outside ch7)
        this.uLensRadius = uniform(params.lensRadius ?? 0.12); // black-core radius in NDC

        // Scene source kept as a member so the (lazily built) output-node variants can all
        // sample it without re-resolving the pass texture node.
        this._sceneColor = sceneColor;

        // ── Batch5: TWO (×2) output-node variants, built lazily & cached ──────────────
        // The ch7 gravitational-lensing UV-warp + hero-CA recentre is a NO-OP everywhere
        // except Black Hole, yet the old single graph still ran all of its ALU (extra
        // length/normalize/smoothstep/mix per pixel) in all 8 chapters because the gate was a
        // uniform *multiply*, not a branch. We instead compile a LEAN graph WITHOUT the lens
        // branch (the default for chapters 1–6, 8) and a FULL graph WITH it (ch7), and swap
        // postProcessing.outputNode at the ch7 boundary in update() (edge-triggered — at most
        // a handful of recompiles across the whole journey, never per-frame).
        //
        // Orthogonally, QW14 gives each a with-bloom and a no-bloom form so dark/low-key
        // chapters (Deep Ocean, Black Hole void) where the bloom contribution is ~0 detach
        // the bloom node from the graph entirely — that stops its ~6 (was ~12) full-screen
        // passes from rendering at all, not merely scaling their result to ~0.
        //
        // Variants are keyed 'lens|bloom' (booleans). They are pure node graphs — cheap to
        // build, no GPU cost until selected — so we precompute the ones this tier can reach.
        this._outputVariants = new Map();
        this._activeVariantKey = null;
        // Default look: lean graph (no lens), bloom on iff this tier enables bloom. Matches
        // the legacy behaviour for chapters 1–6/8 with the lens uniforms left at their no-op
        // defaults, so first paint is visually identical to before.
        this._selectVariant(false, this.enableBloom);
    }

    /**
     * Variant-key helper. Booleans → stable string key for the output-node cache.
     * @private
     */
    static _variantKey(withLens, withBloom) {
        return `${withLens ? 1 : 0}|${withBloom ? 1 : 0}`;
    }

    /**
     * Select (building + caching on first use) the output-node variant for the given
     * feature flags and bind it to postProcessing. Edge-triggered: a no-op (no recompile)
     * when the requested variant is already active, so it is safe to call every frame.
     * @param {boolean} withLens include the ch7 lensing / hero-CA branch
     * @param {boolean} withBloom add the bloom node into the graph (renders its passes)
     * @private
     */
    _selectVariant(withLens, withBloom) {
        // Bloom can only be requested if the node exists (enableBloom tier).
        const wantBloom = withBloom && this.bloomNode !== null;
        const key = OdysseyTslPipeline._variantKey(withLens, wantBloom);
        if (key === this._activeVariantKey) return; // already bound — no recompile

        let node = this._outputVariants.get(key);
        if (!node) {
            node = this._buildOutputNode(withLens, wantBloom);
            this._outputVariants.set(key, node);
        }
        this.postProcessing.outputNode = node;
        this.postProcessing.needsUpdate = true; // recompiles the post material (edge only)
        this._activeVariantKey = key;
    }

    /**
     * Build ONE final-output `vec4` node graph. Pure node construction (no GPU work). The
     * full master grade / per-chapter signature / vignette / grain stages are identical
     * across variants and shared by every chapter; only the SAMPLING stage differs:
     *   • withLens=false (LEAN, default): a plain radial-edge CA gather on the unwarped uv —
     *     no lens warp, no hero-CA recentre, no event-horizon core gate. The lens uniforms
     *     are not referenced, so none of that ALU exists in chapters 1–6/8.
     *   • withLens=true (FULL, ch7): the gravitational-lensing UV warp + hero-recentred CA +
     *     black-core gate (the original ch7 signature shot), driven by uLensStrength.
     *   • withBloom=false: the bloom add term is dropped (bloom node detached → its passes
     *     don't render). Used on dark/low-key chapters and the no-bloom tier.
     * Look-identical to the pre-split graph for each chapter's normal uniform state.
     * @param {boolean} withLens
     * @param {boolean} withBloom
     * @returns {*} vec4 output node
     * @private
     */
    _buildOutputNode(withLens, withBloom) {
        const sceneColor = this._sceneColor;
        const uv = viewportUV;
        const centered = uv.sub(vec2(0.5, 0.5));
        const dist = length(centered);

        let sceneHDR;
        if (withLens) {
            // ── 0. BLACK HOLE screen-space gravitational LENSING (ch7; the signature shot) ──
            //        BEFORE the CA sample, warp the sample UV radially around the hero's
            //        projected NDC centre so the starfield/disk bend into Einstein arcs. Folded
            //        into the CA gather: the 3 chroma taps read the WARPED uv → ~0 extra fetches.
            const lensDir = uv.sub(this.uLensCenter); // vector from hero centre to this pixel
            const lensR = length(lensDir).max(1e-4); // radial distance (eps to avoid /0)
            const lensN = lensDir.div(lensR); // unit radial
            // Deflection falls as 1/r, shaped so it engages in a ring around the hole and dies
            // out well before the frame edge (smoothstep from 2x radius down toward 0.25x).
            const lensShape = smoothstep(this.uLensRadius.mul(2.0), this.uLensRadius.mul(0.25), lensR);
            const deflect = this.uLensStrength.div(lensR.add(0.04)).mul(lensShape);
            // Tangential star-smear: rotate the radial 90° and add a fraction so light streaks
            // AROUND the photon ring (the iconic lensed arc), not just radially inward.
            const lensTangent = vec2(lensN.y.negate(), lensN.x);
            // Pull the sample inward (toward the hole) + a tangential swirl. Capped by lensShape.
            const lensWarp = lensN.mul(deflect.negate()).add(lensTangent.mul(deflect.mul(0.55)));
            const warpedUv = uv.add(lensWarp);

            // ── 1. Chromatic aberration recentred on the lensed hero (uLensStrength>0): the
            //        chroma fringe wraps the event horizon (per §2's "center on singularity"),
            //        blended in by the same lens gate so it eases on with the chapter.
            const radialEdge = dist.mul(dist).mul(2.4);
            const heroEdge = lensR.mul(lensR).mul(2.4);
            const caRadial = mix(radialEdge, heroEdge, clamp(this.uLensStrength.mul(8.0), 0.0, 1.0));
            const caCentered = mix(centered, lensDir, clamp(this.uLensStrength.mul(8.0), 0.0, 1.0));
            const chromaOffset = caCentered.mul(this.uChroma).mul(caRadial);
            // The 3 chroma taps read the WARPED uv (lensing + CA gather share the same fetches).
            const sampleR = sceneColor.sample(warpedUv.add(chromaOffset)).r;
            const sampleG = sceneColor.sample(warpedUv).g;
            const sampleB = sceneColor.sample(warpedUv.sub(chromaOffset)).b;
            // Hard black event-horizon core: crush the sample to deep void inside uLensRadius
            // (smooth inner edge so it never reads as a hard disc). Multiplies the gathered HDR.
            const coreMask = smoothstep(this.uLensRadius.mul(0.55), this.uLensRadius, lensR);
            const coreGate = mix(float(1.0), coreMask, clamp(this.uLensStrength.mul(8.0), 0.0, 1.0));
            sceneHDR = vec3(sampleR, sampleG, sampleB).mul(coreGate);
        } else {
            // ── 1. Chromatic aberration (radial, ~0 at centre, concentrated at EDGES) ──
            // CA is a lens artifact on the source image, so it must resample the HDR scene
            // texture (a UV-offset gather). The offset scales with dist² (radialEdge) so it
            // vanishes at the centre and ramps up hard only near the frame edge — an edge-only
            // lens character, never a centre haze. LEAN variant: no lens warp/core (ch7-only),
            // so chapters 1–6/8 carry none of that per-pixel ALU.
            const radialEdge = dist.mul(dist).mul(2.4);
            const chromaOffset = centered.mul(this.uChroma).mul(radialEdge);
            const sampleR = sceneColor.sample(uv.add(chromaOffset)).r;
            const sampleG = sceneColor.sample(uv).g;
            const sampleB = sceneColor.sample(uv.sub(chromaOffset)).b;
            sceneHDR = vec3(sampleR, sampleG, sampleB);
        }

        // ── 2. Bloom add (threshold-disciplined; only genuinely bright pixels bloom) ──
        // QW14: dropped on the no-bloom variants so the bloom node detaches from the graph
        // and its blur/composite passes are not rendered at all.
        const preExposure = withBloom ? sceneHDR.add(this.bloomNode.rgb) : sceneHDR;

        // ── 3. Exposure → 4. ACES filmic tonemap (manual; renderer = NoToneMapping) ──
        // One global exposure scales the HDR colour, then a single ACES curve maps every
        // chapter (dark cosmic ↔ bright mountains) to display range. Per-channel fit keeps
        // bright emitters' HUE instead of clipping each channel to white independently.
        // B4: ch8 IGNITION SWELL — over the last ~18% of ch8 swell global exposure ~+15% so
        // the igniting finale spire blooms hardest (the journey's closing payoff). uIgnition
        // is 0 everywhere else, so this is a no-op outside the ch8 climax.
        const ignitionExposure = float(1.0).add(this.uIgnition.mul(0.15));
        const exposed = preExposure.mul(this.uExposure).mul(ignitionExposure);
        const acesNum = exposed.mul(exposed.mul(2.51).add(0.03));
        const acesDen = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        const toned = clamp(acesNum.div(acesDen), 0.0, 1.0);

        // ── 5. MASTER GRADE (display space; ONE film stock for all 8 chapters) ──
        // Everything below operates on the [0,1] tonemapped image — it cannot reintroduce
        // HDR, so the grade can never cause a white blowout (Phase A/B discipline preserved).
        const masterGraded = this._applyMasterGrade(toned);

        // ── 5b. PER-CHAPTER signature shift (small, on top of the master curve) ──
        // (a) signature tint: multiply toward the chapter tint, then re-normalise toward
        //     the original luma so the tint shifts HUE without dragging exposure;
        // (b) a tiny per-chapter contrast nudge around mid-grey.
        const chapterTinted = masterGraded.mul(vec3(this.uChapterTint));
        const tintedLuma = dot(chapterTinted, vec3(0.2126, 0.7152, 0.0722)).max(1e-4);
        const origLuma = dot(masterGraded, vec3(0.2126, 0.7152, 0.0722));
        const chapterColor = chapterTinted.mul(origLuma.div(tintedLuma));
        const contrastShifted = chapterColor.sub(0.5).mul(this.uChapterContrast).add(0.5);
        // (c) PER-CHAPTER SATURATION (B4 new column, seam-lerped + smoothed). Hot chapters
        //     (Earth Core / Urban) drop below the 1.06 anchor so lava/neon do not over-
        //     saturate toward clipping; cool chapters keep the richer 1.06.
        const csLuma = dot(contrastShifted, vec3(0.2126, 0.7152, 0.0722));
        const graded = mix(vec3(csLuma), contrastShifted, this.uChapterSat);

        // Legacy per-chapter tint hook (uGradeTint/uGradeStrength) kept live for API
        // compatibility — a subtle additional pull toward a director-supplied key colour.
        const withLegacyTint = mix(graded, graded.mul(vec3(this.uGradeTint)), this.uGradeStrength);

        // ── 6a. VALUE-AWARE arc-modulated vignette (display-space, post-tonemap) ──
        // A SCENE-LUMA-COUPLED vignette so edges darken in PROPORTION to local brightness —
        // ch2's 1.28 and ch7's 1.05 weights bite, while ch4/ch5 (light weights) stay open.
        const vignetteFactor = smoothstep(0.95, 0.32, dist); // 1 centre → 0 edge
        const edgeAmount = float(1.0).sub(vignetteFactor); // 0 centre → 1 edge
        const localLuma = dot(withLegacyTint, vec3(0.2126, 0.7152, 0.0722));
        // Two coupled darkening terms, summed then applied as one multiplier:
        //  • radial: the classic uVignette % falloff (kept so dark frames still get a base).
        //  • value : extra darkening that scales with local brightness so bright edges are
        //            pulled in harder than already-dark edges (focuses the eye, never lifts).
        const radialDarken = edgeAmount.mul(this.uVignette);
        const valueDarken = edgeAmount.mul(localLuma).mul(this.uVignette).mul(0.85);
        const vignetteMul = clamp(float(1.0).sub(radialDarken.add(valueDarken)), 0.0, 1.0);
        const vignetted = withLegacyTint.mul(vignetteMul);

        // ── 6b. Film grain + dither (anti-banding) — always last ──
        const grainSeed = uv.mul(132.0).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17)));
        const grain = fract(sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453))
            .sub(0.5).mul(this.uGrain);
        const ditherSeed = uv.mul(317.0).add(vec2(0.17, 0.31));
        const dither = fract(sin(dot(ditherSeed, vec2(127.1, 269.5))).mul(43758.5453))
            .sub(0.5).mul(0.0022);

        const finalColor = clamp(vignetted.add(vec3(grain)).add(vec3(dither)), 0.0, 1.0);
        return vec4(finalColor, 1.0);
    }

    /**
     * The shared filmic master grade (display space, post-ACES). Pure node math on a
     * [0,1] colour → [0,1] colour; never reintroduces HDR (no white blowout). Order:
     * tinted toe (lift+tint shadows, crush blacks) → highlight shoulder → temp/tint bias
     * → S-curve contrast → saturation lift.
     * @param {*} color tonemapped vec3 node in [0,1]
     * @returns {*} graded vec3 node in [0,1]
     * @private
     */
    _applyMasterGrade(color) {
        const luma = dot(color, vec3(0.2126, 0.7152, 0.0722));

        // (a) TINTED TOE: in the deepest shadows, blend toward the cool toe tint, then
        // crush the black point. shadowMask ≈ 1 in deep shadow, 0 by the lower mids.
        const shadowMask = smoothstep(0.35, 0.0, luma);
        const toeColor = mix(color, vec3(this.uToeTint), shadowMask.mul(this.uToeLift));
        // B4: ch8 SHADOW-FLOOR LIFT — at the ch8 ignition, lift the deepest shadows toward a
        // deep INDIGO film floor (not pure black) so the megacity void reads graded, never
        // crushed. uShadowFloorLift is 0 elsewhere, so this is a no-op outside the ch8 climax.
        const floored = mix(toeColor, vec3(this.uShadowFloorTint), shadowMask.mul(this.uShadowFloorLift));
        // Gentle black crush: subtract a small floor and rescale so blacks deepen without
        // clipping the rest of the range to grey. B4: uCrushScale eases the crush DOWN in ch7
        // so the structured violet void survives tonemap instead of crushing to RGB-black.
        const crush = this.uBlackCrush.mul(this.uCrushScale);
        const crushed = max(floored.sub(vec3(crush)), vec3(0.0))
            .div(float(1.0).sub(crush));

        // (b) HIGHLIGHT SHOULDER: soft roll-off above the knee so highlights compress
        // gently instead of clipping flat. Below the knee the colour is untouched. B4: the
        // knee is the PER-CHAPTER shoulder-knee (smoothed) so hot chapters (Earth Core ~0.78
        // / Urban ~0.80) roll off EARLIER and lava/neon compress before they clip; reference
        // chapters sit at the master 0.86.
        const knee = this.uShoulderKnee;
        const over = max(crushed.sub(vec3(knee)), vec3(0.0));
        const headroom = max(float(1.0).sub(knee), float(1e-3));
        // Smooth compressive curve: x - x²/(2*headroom), clamped into the remaining range.
        const rolled = min(over.sub(over.mul(over).div(headroom.mul(2.0))), headroom);
        const shouldered = vec3(knee).add(rolled);
        // Re-merge: only the highlights took the shoulder.
        const withShoulder = mix(crushed, shouldered, smoothstep(knee.sub(0.05), knee, luma));

        // (c) GLOBAL TEMPERATURE / TINT BIAS — a hair of teal/amber separation baked in.
        const biased = withShoulder.mul(vec3(this.uTempBias));

        // (d) GENTLE S-CURVE CONTRAST around mid-grey.
        const contrasted = biased.sub(0.5).mul(this.uMasterContrast).add(0.5);

        // (e) SUBTLE SATURATION LIFT.
        const gLuma = dot(contrasted, vec3(0.2126, 0.7152, 0.0722));
        const saturated = mix(vec3(gLuma), contrasted, this.uMasterSaturation);

        // Guard back into display range (pow-free clamp keeps it tasteful, no blowout).
        return clamp(saturated, 0.0, 1.0);
    }

    /**
     * Resolve the per-chapter grade signature for the current journey state (source →
     * target chapter blended by seamProgress) into the scratch tint + scalar returns. B4
     * adds `saturation` + `shoulderKnee` to the SAME seam-lerp path as tint/contrast.
     * @param {object} directorState
     * @returns {{ contrast:number, vignetteWeight:number, chromaWeight:number,
     *             saturation:number, shoulderKnee:number }}
     * @private
     */
    _resolveChapterSignature(directorState) {
        const seamT = THREE.MathUtils.clamp(directorState?.seamProgress ?? 0, 0, 1);
        const src = CHAPTER_SIGNATURES[clampChapter(
            directorState?.sourceChapter ?? directorState?.activeChapter ?? 1,
        ) - 1];
        const tgt = CHAPTER_SIGNATURES[clampChapter(
            directorState?.targetChapter ?? directorState?.activeChapter ?? 1,
        ) - 1];

        // Blend the signature tint into the scratch colour (no alloc).
        this._scratchTint.setRGB(
            lerp(src.tint[0], tgt.tint[0], seamT),
            lerp(src.tint[1], tgt.tint[1], seamT),
            lerp(src.tint[2], tgt.tint[2], seamT),
        );
        return {
            contrast: lerp(src.contrast, tgt.contrast, seamT),
            vignetteWeight: lerp(src.vignette, tgt.vignette, seamT),
            chromaWeight: lerp(src.chroma, tgt.chroma, seamT),
            saturation: lerp(src.sat, tgt.sat, seamT),
            shoulderKnee: lerp(src.shoulderKnee, tgt.shoulderKnee, seamT),
        };
    }

    /**
     * Per-frame director-driven params (pass a cached object; no per-frame allocs).
     * { time, exposure, bloomStrength, gradeTint(THREE.Color), gradeStrength,
     *   saturation, contrast, vignette, chroma }
     */
    updateDynamic(p = {}) {
        if (p.time !== undefined) this.uTime.value = p.time;
        if (p.exposure !== undefined) this.uExposure.value = p.exposure;
        if (p.bloomStrength !== undefined && this.bloomNode) this.bloomNode.strength.value = p.bloomStrength;
        if (p.gradeStrength !== undefined) this.uGradeStrength.value = p.gradeStrength;
        if (p.saturation !== undefined) this.uSaturation.value = p.saturation;
        if (p.contrast !== undefined) this.uContrast.value = p.contrast;
        if (p.vignette !== undefined) this.uVignette.value = p.vignette;
        if (p.chroma !== undefined) this.uChroma.value = p.chroma;
        if (p.gradeTint && this.uGradeTint.value?.set) {
            if (p.gradeTint.isColor) this.uGradeTint.value.copy(p.gradeTint);
            else this.uGradeTint.value.set(p.gradeTint);
        }
    }

    updateTime(time) {
        this.uTime.value = time;
    }

    // ── Drop-in PostProcessingStack-compatible API (board controller calls these) ──

    /**
     * Per-frame board update: accumulate time, map OdysseyDirector state → post uniforms
     * (exposure, bloom, and the Phase C cinematic grade — master + per-chapter signature,
     * arc-modulated vignette, edge CA), and decay the chapter-seam bloom punch. Mirrors
     * PostProcessingStack.update(delta, state). The director-modulated amounts are
     * exponentially smoothed so seams/beats glide rather than pop.
     */
    update(delta = 0, directorState = null) {
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
        this.uTime.value += dt;
        this._seamBoost *= 0.9; // frame-decay the transient seam punch
        if (this._seamBoost < 1e-3) this._seamBoost = 0;

        const post = directorState?.post || null;
        const atmo = directorState?.atmosphere || null;
        const energy = directorState?.energy ?? 0;

        // Director-driven bloom weight (post.bloom ∈ ~[0,1]); cached for the bloom-active gate
        // below. When the bloom node is disabled for this tier, _baseBloom is 0 so this stays 0.
        const bloomWeight = post?.bloom ?? 1;
        if (this.bloomNode) {
            this.bloomNode.strength.value = this._baseBloom * bloomWeight + this._seamBoost;
        }
        if (atmo?.exposure !== undefined) this.uExposure.value = atmo.exposure;
        // Energy warms the legacy grade hook (post.grade ∈ [0,1]); keep tint white-ish.
        this.uGradeStrength.value = 0.14 + (post?.grade ?? energy) * 0.12;

        // ── Phase C: per-chapter signature + arc-modulated vignette + edge CA ──
        // Smoothing factor (frame-rate aware; ~0.12/frame at 60fps, faster on long frames).
        const k = directorState ? Math.min(1, dt > 0 ? 1 - Math.exp(-6.0 * dt) : 0.12) : 0.12;

        // Targets resolved below, then a single smoothing pass applies them all.
        let lensTarget = 0; // ch7 lensing strength target
        let crushScaleTarget = 1.0; // ch7 black-crush softening target (→ ~0.35 in ch7)
        let ignitionTarget = 0; // ch8 ignition swell target (last ~18% of ch8)

        if (directorState) {
            const sig = this._resolveChapterSignature(directorState);

            // Base vignette/CA, modulated by the arc weight; beat energy tightens the
            // vignette a touch (eye drawn inward on a hit) and a hair of extra CA.
            const beatPulse = directorState.beatPulse ?? 0;
            const baseVignette = 0.40 * sig.vignetteWeight + energy * 0.05 + beatPulse * 0.03;
            const baseChroma = 0.0015 * sig.chromaWeight + beatPulse * 0.0004;

            this._smVignette = lerp(this._smVignette, baseVignette, k);
            this._smChroma = lerp(this._smChroma, baseChroma, k);
            this._smChapterContrast = lerp(this._smChapterContrast, sig.contrast, k);
            this._smChapterTint.lerp(this._scratchTint, k);
            this._smChapterSat = lerp(this._smChapterSat, sig.saturation, k);
            this._smShoulderKnee = lerp(this._smShoulderKnee, sig.shoulderKnee, k);

            // ── B4: ch7 BLACK HOLE lensing strength + void-crush softening ──
            // ch7Presence = how much chapter 7 is on-screen (entering 6→7 ramps it on, the
            // body holds it at 1, leaving 7→8 holds the hero until the neon-snap). Lensing
            // PEAKS LATE: a smoothstep on the chapter's tail (the 7→8 departure seam).
            const seamT = THREE.MathUtils.clamp(directorState.seamProgress ?? 0, 0, 1);
            const src = directorState.sourceChapter ?? directorState.activeChapter ?? 1;
            const tgt = directorState.targetChapter ?? directorState.activeChapter ?? 1;
            let ch7Presence = 0;
            let ch7Late = 0; // 0 entry → 1 climax (drives the peak-late ramp)
            if (directorState.activeChapter === 7) {
                if (src === 6 && tgt === 7) {
                    // 6→7 entry seam: switch lensing ON gradually (continuous singularity).
                    ch7Presence = seamT; ch7Late = seamT * 0.4;
                } else if (src === 7 && tgt === 8) {
                    // 7→8 departure seam: hero held; lensing pushed to journey-max (late peak).
                    ch7Presence = 1; ch7Late = 0.6 + seamT * 0.4;
                } else {
                    // ch7 body: present; late ramp tracks audio energy as a mid-chapter rise.
                    ch7Presence = 1; ch7Late = THREE.MathUtils.clamp(0.35 + energy * 0.35, 0, 0.85);
                }
            } else if (src === 7 && tgt === 8) {
                // active flipped to 8 but still in the 7→8 band: keep the hero lensing alive.
                ch7Presence = THREE.MathUtils.clamp(1 - seamT, 0, 1);
                ch7Late = 0.6;
            }
            // Only lens when the BH env actually published a valid screen target this frame.
            const lensGate = this._lensActive ? 1 : 0;
            // Peak deflection ~0.045 NDC at the climax; eased by presence × late ramp.
            lensTarget = 0.045 * ch7Presence * (0.4 + 0.6 * ch7Late) * lensGate;
            // Soften the ch7 black-crush so the structured violet void survives tonemap
            // (1.0 → ~0.35 with presence). Outside ch7 stays full crush.
            crushScaleTarget = lerp(1.0, 0.35, ch7Presence);

            // ── B4: ch8 IGNITION SWELL (last ~18% of ch8) ──
            // Prefer the urban env's eased reveal if the controller forwarded it; else derive
            // from the global ascent progress (mirrors urban-dreams.js: (p-0.82)/0.18 eased).
            let reveal = Number.isFinite(directorState.urbanReveal) ? directorState.urbanReveal : null;
            if (reveal === null) {
                const p = directorState.ascentProgress ?? 0;
                const r = THREE.MathUtils.clamp((p - 0.82) / 0.18, 0, 1);
                reveal = r * r * (3 - 2 * r); // smootherstep ease (matches the env)
            }
            // Only swell while ch8 is the on-screen chapter (active or arriving 7→8).
            const inCh8 = directorState.activeChapter === 8 || (src === 7 && tgt === 8) ? 1 : 0;
            ignitionTarget = reveal * inCh8;
        } else {
            // No director (non-cinematic path): relax toward neutral so we never strand
            // a strong vignette/tint from a previous cinematic session.
            this._smVignette = lerp(this._smVignette, 0.40, k);
            this._smChroma = lerp(this._smChroma, 0.0015, k);
            this._smChapterContrast = lerp(this._smChapterContrast, 1.0, k);
            this._smChapterTint.lerp(NEUTRAL_TINT, k);
            this._smChapterSat = lerp(this._smChapterSat, MASTER.saturation, k);
            this._smShoulderKnee = lerp(this._smShoulderKnee, MASTER.shoulder, k);
        }

        // Smooth the ch7 lensing / crush + ch8 ignition (enter/exit glide, no pops).
        this._smLensStrength = lerp(this._smLensStrength, lensTarget, k);
        this._smIgnition = lerp(this._smIgnition, ignitionTarget, k);
        const smCrushScale = directorState
            ? lerp(this.uCrushScale.value, crushScaleTarget, k)
            : lerp(this.uCrushScale.value, 1.0, k);

        this.uVignette.value = this._smVignette;
        // Wave 2 (adaptive quality): scale the cheapest post terms by the controller's
        // post-quality multipliers AFTER smoothing so the softened/disabled state persists
        // (both are 1 by default → identical look for non-adaptive callers).
        this.uChroma.value = this._smChroma * this._postChromaScale;
        this.uGrain.value = this._baseGrain * this._postGrainScale;
        this.uChapterContrast.value = this._smChapterContrast;
        if (this.uChapterTint.value?.copy) this.uChapterTint.value.copy(this._smChapterTint);
        this.uChapterSat.value = this._smChapterSat;
        this.uShoulderKnee.value = this._smShoulderKnee;
        this.uLensStrength.value = this._smLensStrength;
        if (this.uLensCenter.value?.copy) this.uLensCenter.value.copy(this._smLensCenter);
        this.uCrushScale.value = smCrushScale;
        this.uIgnition.value = this._smIgnition;
        // ch8 shadow-floor lift tracks ignition (deep-indigo floor, peak ~0.5 lift).
        this.uShadowFloorLift.value = this._smIgnition * 0.5;
        // ch8 IGNITION bloom push: ignited spire blooms hardest (added on top of director).
        if (this.bloomNode) this.bloomNode.strength.value += this._smIgnition * 0.18;

        // ── Batch5/QW14: edge-triggered output-variant swap (NOT per-frame) ──────────────
        // Pick the cheapest graph that still looks right for the current chapter:
        //   • lens branch ONLY while the Black Hole hero is on-screen (ch7, or the 6→7 / 7→8
        //     bands) — every other chapter runs the LEAN graph with no lens ALU at all;
        //   • bloom term ONLY when it can actually contribute — the bloom node exists AND the
        //     effective bloom strength is above a small epsilon (so dark/low-key chapters whose
        //     director weight rides ~0 detach the bloom node and skip its passes entirely).
        // _selectVariant is a no-op when the variant is unchanged, so this recompiles the post
        // material at most a handful of times across the whole journey — never each frame.
        if (directorState) {
            const ac = directorState.activeChapter;
            const sc = directorState.sourceChapter ?? ac;
            const tc = directorState.targetChapter ?? ac;
            const wantLens = ac === 7 || sc === 7 || tc === 7;
            // Effective bloom contribution this frame (mirrors the strength math above plus the
            // ignition push). Use HYSTERESIS so a director weight hovering near zero across a
            // seam can't flip the bloom node on/off repeatedly (each flip = one recompile):
            // turn bloom OFF only when clearly dark (< 1e-3), back ON as soon as it is meaningful
            // (> 6e-3). Between those it holds whatever variant is already bound.
            const effBloom = this.bloomNode
                ? (this._baseBloom * bloomWeight + this._seamBoost + this._smIgnition * 0.18)
                : 0;
            const bloomCurrentlyOn = this._activeVariantKey
                ? this._activeVariantKey.endsWith('|1')
                : this.bloomNode !== null;
            let wantBloom = bloomCurrentlyOn;
            if (effBloom > 6e-3) wantBloom = true;
            else if (effBloom < 1e-3) wantBloom = false;
            // Wave 2 Tier-1: a hard controller override wins over the director weight — when
            // the adaptive controller has shut bloom off under pressure, force the no-bloom
            // variant (detaches the bloom node, skips its passes) until it restores bloom.
            if (!this._bloomAllowed) wantBloom = false;
            this._selectVariant(wantLens, wantBloom);
        }

        // Reset the per-frame lens-active flag (re-armed by setLensTarget next frame).
        this._lensActive = false;
    }

    /**
     * B4 — wire the Black Hole (ch7) screen-space lensing centre. Each frame the board
     * controller passes the BH env group.userData.lensWorldPos (a world Vector3 the BH env
     * keeps updated). We project it to NDC using the pipeline camera + size and smooth the
     * centre so it glides on enter/exit. Reuses scratch Vector3/Vector2 (no allocations).
     * Strength itself is driven from directorState in update(); this only sets the centre +
     * arms the lens for this frame. Safe to call every frame (no-op if no valid target).
     * @param {THREE.Vector3|null} worldVec3
     */
    setLensTarget(worldVec3) {
        if (!worldVec3 || !this.camera) return;
        // World → clip → NDC (-1..1) → UV (0..1). project() needs an up-to-date camera
        // matrix; the camera controller updates it before render, so this is current.
        this._scratchLensV3.copy(worldVec3).project(this.camera);
        const ndcX = this._scratchLensV3.x;
        const ndcY = this._scratchLensV3.y;
        const behind = this._scratchLensV3.z > 1; // behind the camera → ignore this frame
        if (behind || !Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return;
        // NDC (-1..1, y up) → viewport UV (0..1, y up to match viewportUV).
        this._scratchLensV2.set(ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5);
        // Smooth the centre toward the new target (frame-rate aware; enter/exit glide).
        this._smLensCenter.lerp(this._scratchLensV2, 0.18);
        this._lensActive = true;
    }

    resize(width, height) {
        this.setSize(width, height);
    }

    // A6: the seam used to PUNCH bloom (intensity * 0.5) to hide a hard portal cut behind
    // a white flash. The ecotone now carries the transition (both biomes co-present), so the
    // seam bloom is demoted to a barely-there accent — a small fraction of the old boost so
    // the blend stays legible instead of blowing out to white. Signatures unchanged.
    /** Transient (now subtle) bloom accent as the camera crosses a chapter seam. */
    triggerChapterSeam({ intensity = 1 } = {}) {
        this._seamBoost = Math.max(this._seamBoost, intensity * SEAM_BLOOM_BOOST);
    }

    setChapterSeamState({ intensity = 0 } = {}) {
        this._seamBoost = Math.max(this._seamBoost, intensity * SEAM_BLOOM_BOOST);
    }

    // ── Wave 2 hook (adaptive quality controller) ──────────────────────────────────
    // Clean knob for the forthcoming OdysseyAdaptiveQuality controller to drop/raise the
    // bloom WORKING resolution at runtime (e.g. 0.5 → 0.25 under load) without a rebuild.
    // Takes effect on the next bloom resize (the node re-derives size each frame in
    // updateBefore via the scaling wrapper). No-op when bloom is disabled for this tier.
    /** @param {number} scale clamped to a sane (0.1..1] working-res fraction. */
    setBloomScale(scale) {
        if (!Number.isFinite(scale)) return;
        this.bloomScale = Math.min(1, Math.max(0.1, scale));
    }

    /**
     * Wave 2 (OdysseyAdaptiveQuality) Tier-1 hook: hard-gate the bloom node on/off at
     * runtime, overriding the director's per-frame bloom weight. Disabling forces the LEAN
     * no-bloom output variant on the next update() (the bloom node detaches and its passes
     * stop rendering); enabling returns control to the director. No-op when this tier never
     * built a bloom node (constructor enableBloom:false). Edge-triggered downstream — cheap
     * to call repeatedly.
     * @param {boolean} enabled
     */
    setBloomEnabled(enabled) {
        // Cannot enable bloom if the node was never built for this tier.
        this._bloomAllowed = this.bloomNode !== null && enabled !== false;
    }

    /**
     * Wave 2 (OdysseyAdaptiveQuality) Tier-2 hook: scale the cheapest per-pixel post terms
     * (edge chromatic-aberration + film grain) toward off under sustained GPU pressure, and
     * restore them on recovery. `level` is a 0..1 quality fraction: 1 = full look (default),
     * 0 = those terms disabled. Applied as multipliers in update() so it never fights the
     * per-frame director smoother. Pure uniform scaling — no node rebuild, no allocation.
     * (Dither is a fixed anti-banding constant in the graph and is intentionally left on.)
     * @param {number} level 0 (stripped) .. 1 (full)
     */
    setPostQuality(level) {
        const q = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
        this._postChromaScale = q;
        this._postGrainScale = q;
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        // Resize the bloom render targets ONLY after the bloom node has built its
        // internal blur materials (i.e. after the first render). Calling setSize
        // before that throws ("Cannot read properties of undefined (reading 'invSize')").
        // Pass the FULL size: the bloomNode.setSize wrapper (constructor) applies bloomScale.
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
        }
    }

    dispose() {
        this.scenePass.dispose?.();
        this.bloomNode?.dispose?.(); // null on the no-bloom (enableBloom:false) tier
        this.postProcessing.dispose?.();
    }
}

export default OdysseyTslPipeline;
