import * as THREE from 'three/webgpu';
import {
    Fn, If,
    abs, attribute, clamp, cos, cross, dFdx, dFdy, dot, exp, exp2, float, floor, fract, length,
    max, min, mix, sqrt,
    normalize, normalWorld, positionGeometry, positionLocal, positionWorld, sin, smoothstep,
    screenUV, step as tslStep, texture, uniform, uv, varying, vec2, vec3, cameraPosition,
} from 'three/tsl';

import {
    ODYSSEY_SEA_LEVEL,
    odysseyWorldDetailWeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import { MORPH_END, MORPH_START, buildOdysseyClipmap } from './odyssey-clipmap.js';
import { createTilingValueNoise } from './odyssey-tiling-noise.js';
import {
    GROUND_ATLAS_WORLD, bakeGroundAtlas, bakeGroundSunFields,
} from './odyssey-ground-bakes.js';
import {
    ODYSSEY_GROUND_DISTANCE,
    ODYSSEY_GROUND_DRYNESS,
    ODYSSEY_GROUND_LUMA,
    ODYSSEY_GROUND_MOISTURE,
    ODYSSEY_GROUND_PALETTE,
    ODYSSEY_GROUND_SHADE,
    ODYSSEY_GROUND_STRATA,
} from './odyssey-ground-palette.js';
import { buildHeroCloudGeometry } from './odyssey-hero-clouds.js';
import { buildCloudFieldGeometry } from './odyssey-cloud-field.js';
import { ODYSSEY_CLOUD_FIELD_SPECS } from './odyssey-cloud-field-specs.js';
import { buildForestTreeGeometry } from './odyssey-forest-geometry.js';
import { forestLodDistanceForTier, getForestSpecies } from './odyssey-forest-species.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import { ODYSSEY_HERO_CLOUD_SPECS } from './odyssey-hero-cloud-specs.js';
import { snoise3 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import {
    billboardWorld, makeQuadInstancedGeometry,
} from '../chapter-environments/shared/odyssey-tsl-billboard.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import {
    sampleColourScript,
    ODYSSEY_COLOUR_SCRIPT,
    ODYSSEY_WATER_RAMP,
} from '../odyssey-colour-script.js';

/**
 * THE ODYSSEY ACT II WORLD.
 *
 * One continuous surface for chapters 2–5 — ocean floor, sea, shore, forest, alpine, summit —
 * replacing the seven independent ground surfaces the shipped build spreads across four
 * chapter environments. See docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md.
 *
 * Everything here is generated at load: no meshes, no textures, no imported assets. Returns a
 * single Group plus an update() that takes the rail position — the caller owns nothing else.
 *
 * WHAT IS LOAD-BEARING, all of it paid for in measurement:
 *  - `texture(...).level(0)` is MANDATORY in a positionNode. WGSL forbids textureSample in the
 *    vertex stage and r181 injects a level only for EnvironmentNode/Background.
 *  - The analytic macro belongs in the VERTEX stage. Finite-differencing it per fragment cost
 *    7.5 ms of an 11.6 ms frame.
 *  - Detail comes from a TILED TEXTURE, not procedural noise: ~1 ALU against ~100, worth 6.5 ms.
 *  - Sun shadows are BAKED. One sun plus a rail makes self-shadowing static, which deletes the
 *    entire shadow-cascade budget line for one texture fetch.
 *  - Trees are CHUNKED. Their cost is vertex, not fill: collapsing distant instances to
 *    degenerate triangles changed nothing; giving three real bounds to cull against halved it.
 *  - A positionNode REPLACES the instance transform, so it must be built from `positionLocal`,
 *    while a local-space mask must read `positionGeometry`.
 */

// Imported, not owned: the canonical value now lives in chapter-profile.js so chapters can read
// the journey's sun without importing the whole world renderer. Re-exported under the same name
// because the world's own modules and tests already reference it from here.
export { ODYSSEY_WORLD_SUN };

export const ODYSSEY_WORLD_QUALITY = Object.freeze({
    high: {
        gridN: 128,
        levels: 9,
        baseSpacing: 1.6,
        holeShrink: 3,
        reliefRes: 1024,
        shadowRes: 512,
        treeSpacing: 15,
        detailScales: 2,
        cavity: 0.30,
        ridgeRock: 0.16,
    },
    low: {
        gridN: 96,
        levels: 8,
        baseSpacing: 2.2,
        holeShrink: 2,
        reliefRes: 768,
        shadowRes: 384,
        treeSpacing: 24,
        detailScales: 1,
        cavity: 0.24,
        ridgeRock: 0.12,
    },
});

const RELIEF_EXTENT = 9000;

// ── ground paint constants (ground plan §4) ──────────────────────────────────────
// The measured palette, shadow models, strata and distance windows live in
// odyssey-ground-palette.js; what follows is the handful of numbers that describe how those
// tables are APPLIED here, kept beside the graph that reads them.

/** Where atlas detail melts to pure macro paint. Aliased so the graph reads in one line. */
const GROUND_MELT = ODYSSEY_GROUND_DISTANCE.detailMelt;
/**
 * Per-material mesostructure amplitude — a weighted sum, never one global grain.
 *
 * The bar records TWO grass grammars and they are not compatible: Firewatch alternates 2.5-3x
 * inside a single patch (dark base, light tips), while Witness grass is FLAT to +-7 luma and
 * gets all its interest from metre-scale patch hue variegation. The first cut ran the Firewatch
 * amplitude on top of a patchy moisture field and got neither — the massif station read as
 * mottled smudge. The Witness is the stated target, so the tooth is quiet and the patches speak.
 * Paths and sand hills hold +-5..12 luma with no gravel noise anywhere in either game.
 */
const GROUND_TOOTH = Object.freeze({
    grass: 0.18, rock: 0.12, sand: 0.10, snow: 0.08,
});
/** Regional temperature drift. Neither pole BRIGHTENS blue — the cool end pulls red down. */
const GROUND_ZONE_WARM = Object.freeze([1.07, 1.00, 0.91]);
const GROUND_ZONE_COOL = Object.freeze([0.93, 0.98, 1.00]);
/** The painted contact lip where grass meets sand or rock: darker AND warmer, never grey. */
const GROUND_EDGE_TINT = Object.freeze([0.80, 0.72, 0.55]);
const GROUND_EDGE_AMT = 0.55;
/** Wind-swept lighter bands. Deliberately small: this is a Ghibli stroke, not a strobe. */
const GROUND_WIND_LIFT = 0.055;
/**
 * Snow's ice-blue shadow, from mountain-language.js — the ONE shadow colour here that is prior
 * art rather than a measurement (no reference frame contains snow). Authored luma-neutral
 * (0.2126/0.7152/0.0722 weights sum to 0.997) so it shifts hue only and cannot claim a second
 * share of the value drop that `value` owns.
 */
const GROUND_SNOW_SHADE = Object.freeze([0.87, 1.01, 1.24]);
/**
 * How hard convex ground strips its own snow. Wind scours ribs and fills hollows, so a peak's
 * structure shows as stone on the crests — the one cue that separates a snowy MOUNTAIN from a
 * smooth white cone when the silhouette cannot help.
 */
const GROUND_SNOW_CREST_STRIP = 0.75;
/**
 * Must match the bake's floor, or `openness` never reaches 0 in the deepest hollow.
 *
 * (A `GROUND_AO_STRENGTH` multiply over the whole lit result lived beside this. It is gone:
 * wide occlusion reaches the image through the per-material AMBIENT instead, which darkens the
 * sky fill that occlusion actually blocks and leaves direct sun alone. The multiply was a
 * second owner of the same measurement and drove a hollow in shadow to 0.195 against the
 * measured 0.27-0.32 band.)
 */
const GROUND_AO_FLOOR = 0.56;
/**
 * Absolute brightness of full sun, chosen so the sunlit island lands where the shipped graph
 * had it (`sunColour * 0.98 + shadowTint * 0.36`). It multiplies the whole value ramp, so the
 * measured shade:lit ratio is unaffected — one owner, one number.
 */
const GROUND_LIT_GAIN = 1.16;
/** How much of the journey's ambient HUE survives into ground shade. See the graph's note. */
const GROUND_AMBIENT_CHROMA = 0.25;
/**
 * Altitude of the one cloud deck, in world units. Chosen against the RAIL, not against a
 * chapter: the path leaves the shore at ~300, crosses 424 entering the ascent, tops Ch5's
 * climb at 656 and reaches the summit crown near 1017. A deck at 660 is therefore far
 * overhead from the valley, at eye height through the climb, and comfortably below the
 * summit — the three readings Ch3, Ch5 and Ch4 used to build separately.
 */
const CLOUD_DECK_Y = 660;

/**
 * How far the cloud-field normal is bent from the lobe's own radial normal toward the MASS
 * centre (plan Wave 0b). 0 = the retired heroes' bag-of-soap-bubbles; 1 = a featureless
 * ellipsoid with no lobe read at all. The Witness exposed this to artists per cloud for
 * exactly this reason; one global value is the probe's simplification.
 */
const FIELD_CENTROID_BEND = 0.30;
// 0.55 -> 0.30 once the SCULPTOR shipped (Wave 1). The bend existed to unify shading across
// lobes that were geometrically separate spheres; the sculptor's normals now come from the
// smooth-min field's own gradient, which is already continuous through every join. Left at
// 0.55 the bend was smoothing away the lobe definition the sculptor had just been built to
// create — the same term doing useful work before, and harm after.
/** Quantised silver-lining strength. Deliberately small — the references show a rim, not a bloom. */
const FIELD_MIE_GAIN = 0.10;
/**
 * ATMOSPHERIC THINNING (Wave 3 / F3): how much of each mass's body the full thin removes,
 * as a fraction of its distance to the mass centre. 0.30 at the schedule's 0.85 cap means
 * a mass ends the climb at ~74% of its authored size — visibly losing scale, still a cloud.
 * The pull rides INSIDE cfOffset so the vertex position and the cfWorld varying agree.
 */
const FIELD_THIN_SHRINK = 0.30;
/**
 * RIGID DRIFT (plan Wave 3). Amplitudes in world units and the period band in seconds.
 *
 * The masses TRANSLATE; they never deform. The look rules are explicit that silhouettes must
 * never boil, and a per-vertex wobble is exactly that — it also destroys the one thing the
 * sculptor exists to provide, a stable readable outline. Because the offset is a function of
 * the per-mass seed alone it is constant across every vertex of a mass, so the whole hull
 * moves as one body for free.
 *
 * AMPLITUDE IS SET BY WHAT THE EYE CAN RESOLVE, not by what sounds physical. The first values
 * (34 u over 90-240 s) were arithmetically defensible and visually nothing: at 1500 u away
 * that is ~1.3 degrees of arc per MINUTE, below the threshold at which anyone would call a
 * sky alive. 145 u over 70-165 s is ~5.5 degrees of swing, most of it covered in a quarter
 * period — a calm parallax slide you can actually see. The clearance validator accounts for
 * this amplitude, because a drifting mass must clear the rail at its CLOSEST excursion, not
 * at the position the spec table happens to name.
 */
const FIELD_DRIFT_XZ = 145;
const FIELD_DRIFT_Y = 26;
const FIELD_DRIFT_PERIOD_MIN = 70;
const FIELD_DRIFT_PERIOD_MAX = 165;
/**
 * NEAR-DISSOLVE band, world units from the eye to the fragment.
 *
 * The field is OPAQUE, so a mass the camera approaches is a hard white wall — the exact
 * "white slab" failure the heroes' MIN_RAIL_DIST existed to dodge by keeping every mass far
 * away. A fade lets masses live closer to the rail without that risk.
 *
 * ⚠️ IT DISSOLVES BY DITHER, NOT BY TRANSPARENCY. Turning the material transparent would put
 * it in the blend queue and buy the whole cost model that makes the SHEET expensive
 * (1.8 ms, coverage-independent, every fragment paying a read-modify-write). r181 applies
 * `opacityNode` to `diffuseColor.a` and then discards on `alphaTest` INDEPENDENTLY of the
 * `transparent` flag (NodeMaterial.js:872-890), so a stipple keeps the mesh in the cheap
 * opaque path and emits no blend state at all.
 */
const FIELD_FADE_NEAR = 55;
const FIELD_FADE_FAR = 165;
/**
 * LOBE BREATHING — the reshaping that makes a cloud read as alive rather than as a moved prop.
 *
 * ⚠️ THIS IS A DELIBERATE, OWNER-GRANTED EXCEPTION to the look rules' "silhouettes never boil",
 * and the distinction the rule was protecting is preserved in HOW it is done. Per-VERTEX noise
 * boils: neighbouring points on one lobe move independently, the outline shimmers, and the
 * stable readable silhouette the sculptor exists to produce is destroyed. Per-LOBE swelling
 * billows: every vertex the sculptor assigned to a lobe moves together, radially about that
 * lobe's own centre, so the mass changes SHAPE while each arc of its outline stays coherent.
 * That is what a growing cumulus does.
 *
 * The displacement rides the vertex's distance from its lobe centre, so it scales with lobe
 * size for free — big lobes swell more in world units, the same fraction in appearance. Phase
 * walks with lobe INDEX (baked), so adjacent lobes breathe nearly in step and the smooth-min
 * joins between them never tear open.
 *
 * ⚠️ The baked normals are NOT re-derived under the swell, so shading lags the shape by the
 * displacement's own gradient. Re-checked by capture at 0.34: the error stays under the
 * two-band quantisation because the displacement is RADIAL about the lobe centre, which is
 * very nearly the surface normal on a lobe — so it mostly moves the surface along its own
 * normal, which does not rotate it. A displacement with a large TANGENTIAL component would
 * not be this forgiving.
 *
 * ⚠️ NOT VERIFIED FROM CAPTURES, and the reason is a hard limit of the harness rather than
 * laziness. Cloud motion cannot be isolated in a screenshot here: advancing the clock also
 * moves the CAMERA (renderFrame re-poses it from the director, whose focal pulse reads the
 * clock), and an attempt to pin it by stubbing `cameraController.update`/`setDirectorState`
 * did NOT hold. Proof: with drift AND breathing both set to zero, the silhouette area still
 * varied 21.55 % across three clocks — HIGHER than the 19.50 % measured with breathing at
 * 0.14. The whole signal was the camera. DRIFT is verified by a different comparison that
 * does control for this (clouds-on vs clouds-off at the SAME clocks: sky changed +12 points
 * with clouds, rock control identical); no equivalent exists for breathing, so this amplitude
 * was set by eye in the live browser, not by measurement, and is recorded as such.
 */
const FIELD_BREATH_AMP = 0.34;
const FIELD_BREATH_PERIOD_MIN = 34;
const FIELD_BREATH_PERIOD_MAX = 78;

// The two fixed ends of the water banding, read ONCE from the colour script so the plates
// and the keyframes can never drift. Sampling the script for them per frame would be three
// more Oklab walks for values that do not change.
const SHALLOWS_BODY = sampleColourScript(0.12).skyHorizon;
const ABYSS_BODY = sampleColourScript(0.0).skyHorizon;
// Where the script stops being water: the last keyframe whose medium is 'water' (today the
// 'shallows' at 0.12 — computed, not asserted, so a script edit moves it). The MID water
// plate tracks the live sample, and past this point the script's horizon is the breach's
// pale AIR sky; with uSubmerged driven by the real eye, the p 0.18→0.20 ascent renders as
// water, and an unclamped plate would paint that air INTO the water column.
const WATER_SCRIPT_END = ODYSSEY_COLOUR_SCRIPT
    .filter((k) => k.medium === 'water')
    .reduce((last, k) => Math.max(last, k.p), 0);

// ── bakes ────────────────────────────────────────────────────────────────────────

function buildReliefBake(reliefRes) {
    const step = RELIEF_EXTENT / (reliefRes - 1);
    const origin = -RELIEF_EXTENT / 2;

    // The only place the noise is evaluated. Deriving everything else from this grid rather
    // than recomputing cost 352 ms of pure duplicate work when it was done twice.
    const relief = new Float32Array(reliefRes * reliefRes);
    for (let j = 0; j < reliefRes; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < reliefRes; i += 1) {
            relief[(j * reliefRes) + i] = odysseyWorldRelief(origin + (i * step), z);
        }
    }
    const at = (i, j) => relief[(Math.max(0, Math.min(reliefRes - 1, j)) * reliefRes)
        + Math.max(0, Math.min(reliefRes - 1, i))];

    // AUX: derivatives central-differenced from the BAKED heights, never re-evaluated
    // analytically, so lighting describes exactly the surface the vertex shader displaces to.
    // A carries CURVATURE — the discrete Laplacian, mean(4-neighbours) - centre, divided by the
    // step so it is dimensionless. Positive is concave (a gully, the neighbours stand above
    // you), negative convex (a ridge). It is the difference between a landform that reads as
    // rock and one that reads as a smooth pile: first derivatives only tell the light which
    // way a face points, and every face of a cone points somewhere plausible. The channel was
    // already allocated and written as a literal zero, so this costs bake time and nothing
    // else — no VRAM, no bandwidth, no extra fetch.
    const data = new Uint16Array(reliefRes * reliefRes * 4);
    for (let j = 0; j < reliefRes; j += 1) {
        for (let i = 0; i < reliefRes; i += 1) {
            const idx = ((j * reliefRes) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat(relief[(j * reliefRes) + i]);
            data[idx + 1] = THREE.DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) / (2 * step));
            data[idx + 2] = THREE.DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) / (2 * step));
            const neighbourMean = (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) / 4;
            data[idx + 3] = THREE.DataUtils.toHalfFloat(
                (neighbourMean - relief[(j * reliefRes) + i]) / step,
            );
        }
    }
    // Half-float is filterable everywhere with no feature request; float32-filterable is
    // optional in WebGPU and r181's fallback covers only DataTexture, not render targets.
    const tex = new THREE.DataTexture(data, reliefRes, reliefRes, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    // CPU mirror of the DRAWN height, derived — no noise re-evaluation.
    const total = new Float32Array(reliefRes * reliefRes);
    for (let j = 0; j < reliefRes; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < reliefRes; i += 1) {
            const x = origin + (i * step);
            total[(j * reliefRes) + i] = odysseyWorldMacro(x, z)
                + (relief[(j * reliefRes) + i] * odysseyWorldDetailWeight(x, z));
        }
    }
    const sample = (x, z) => {
        const gx = Math.max(0, Math.min(reliefRes - 1.001, (x - origin) / step));
        const gz = Math.max(0, Math.min(reliefRes - 1.001, (z - origin) / step));
        const i0 = Math.floor(gx);
        const j0 = Math.floor(gz);
        const fx = gx - i0;
        const fz = gz - j0;
        const i1 = Math.min(reliefRes - 1, i0 + 1);
        const j1 = Math.min(reliefRes - 1, j0 + 1);
        const a = total[(j0 * reliefRes) + i0];
        const b = total[(j0 * reliefRes) + i1];
        const c = total[(j1 * reliefRes) + i0];
        const d = total[(j1 * reliefRes) + i1];
        return (((a * (1 - fx)) + (b * fx)) * (1 - fz)) + (((c * (1 - fx)) + (d * fx)) * fz);
    };
    return { tex, sample };
}

/**
 * MACRO TEXTURE — [macro height, detail weight, dMacro/dx, dMacro/dz] at 512².
 *
 * This bake exists to DELETE the analytic macro from the shaders. The massif smooth-max fold,
 * expressed in TSL and referenced through varyings, hit a three r181 builder pathology:
 * build TIME scaled with (fold size × fragment references) — measured at 129 s for the water
 * material and 27 s for the ground, ~156 s of frozen tab on every load, uncached, while the
 * emitted WGSL stayed ~6 KB. `.toVar()` inside the fold changed nothing (the builder walks
 * through Var and Varying nodes), so the durable fix is for the fold to not exist at build
 * time at all: the CPU already evaluates the same functions for the mirror, the macro is
 * smooth by construction (512² over 9,000 u = 17.6 u texels under bilinear), and the shader
 * cost is one fetch it was already paying next door. After this, the world compiles in ~1 s.
 */
function bakeMacroTexture(res = 512) {
    const step = RELIEF_EXTENT / (res - 1);
    const origin = -RELIEF_EXTENT / 2;
    const e = 4;
    const data = new Uint16Array(res * res * 4);
    for (let j = 0; j < res; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < res; i += 1) {
            const x = origin + (i * step);
            const idx = ((j * res) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat(odysseyWorldMacro(x, z));
            data[idx + 1] = THREE.DataUtils.toHalfFloat(odysseyWorldDetailWeight(x, z));
            data[idx + 2] = THREE.DataUtils.toHalfFloat(
                (odysseyWorldMacro(x + e, z) - odysseyWorldMacro(x - e, z)) / (2 * e),
            );
            data[idx + 3] = THREE.DataUtils.toHalfFloat(
                (odysseyWorldMacro(x, z + e) - odysseyWorldMacro(x, z - e)) / (2 * e),
            );
        }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

/**
 * THE CLOUD SILHOUETTE FIELD (.a of the detail bake) — cloud plan Wave 1b.
 *
 * WHAT WAS WRONG. This channel used to be one octave of value noise (`vn(i, j, 1/96)`), and a
 * coverage threshold across value noise produces amoebae: soft, round-cornered, featureless
 * blobs with no top, no bottom and no edge. That is the entire reason Act II's sky reads as
 * salt-and-pepper static — no amount of shading can put a cloud shape into a field that has
 * none. The Ghibli/Witness distillation is explicit that the silhouette is where all the
 * frequency lives and the interior stays flat, so the fix belongs HERE, in the field, not in
 * the fragment shader.
 *
 * WHAT IT IS NOW. A union of discs at three scales — the cauliflower construction every
 * reference uses: 2-4 primary lobes that carry the read, secondaries riding on them, and
 * sparse tertiary scallops. `max()` of a domed falloff means the iso-contour of the union is
 * an arc-of-circles boundary, so ANY threshold through this field cuts a scalloped silhouette
 * by construction, at every coverage level. Sizes and spacing are irregular by mandate
 * (evenly-sized lobes read as soap bubbles). An inverted-ridge term fills the flanks between
 * lobes so they are not dead flat.
 *
 * TILING. The texture is 256^2 and repeats every ~488 world units at the deck's coarsest UV
 * scale, so stamped shapes WILL recur — the research critic flagged exactly this. Two defences:
 * distances wrap toroidally (no seam at the tile edge), and the deck samples this field at
 * three scales whose ratios are irrational-ish, so the recurrences of the three never line up.
 *
 * @param {number} res texture resolution
 * @param {(x:number,y:number,freq:number)=>number} vn the caller's tiling value-noise sampler
 * @returns {Float32Array} the silhouette field, histogram-matched (see bakeDetailNormal)
 */
/**
 * HISTOGRAM-MATCH the silhouette field so the shipped calibration survives the rebake.
 *
 * The deck's coverage thresholds (0.63 broken cumulus / 0.40 near-solid) and the vertex gate's
 * bands were placed against a MEASURED distribution of the summed density: p10 0.42, p50 0.58,
 * p90 0.70. Swap the field underneath them and those numbers stop meaning what the comments
 * say — coverage moves everywhere and every band needs re-tuning by eye, which is how a "look"
 * change quietly becomes a fortnight.
 *
 * So the new field is remapped by RANK onto a target marginal, and the target's spread is
 * SOLVED so that the quantity the thresholds actually see — the three-octave sum the fragment
 * stage computes — lands back on the measured percentiles. Rank-remapping is monotonic, so it
 * cannot disturb the silhouette geometry: it changes what the contour heights are called, never
 * where the contours are.
 *
 * The research critic's objection is the reason for the solve: matching ONE octave's marginals
 * does not bound the SUM's distribution. Matching the sum directly is the answer to it.
 *
 * ⚠️ RANK REMAPPING IS ONLY MONOTONIC IF TIES ARE HANDLED. This field is 64 % exact zeros and
 * the first version ranked them individually, which turned one input value into a texel-order
 * ramp across the tile — see `applyK`. A rank remap of a field with a large tied mass is a
 * trap; the same applies to any future bake that thresholds or gates its source.
 *
 * @param {Float32Array} field raw silhouette field (mutated in place)
 * @param {number} res texture resolution
 * @returns {{k:number, p10:number, p50:number, p90:number}} the solved stretch and the sum's
 *          achieved percentiles, for the assertion in the caller
 */
function matchCloudHistogram(field, res) {
    const n = res * res;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => field[a] - field[b]);
    // Target marginal: piecewise-linear through the three MEASURED percentiles, extended to
    // the tails. Expressed as an offset from the median so the stretch pivots on it.
    const targetQ = (u) => {
        if (u <= 0.10) return 0.386 + ((u / 0.10) * (0.42 - 0.386));
        if (u <= 0.50) return 0.42 + (((u - 0.10) / 0.40) * (0.58 - 0.42));
        if (u <= 0.90) return 0.58 + (((u - 0.50) / 0.40) * (0.70 - 0.58));
        return 0.70 + (((u - 0.90) / 0.10) * (0.73 - 0.70));
    };
    const matched = new Float32Array(n);
    // TIES MAP TO ONE VALUE — average-rank remapping, and it is load-bearing, not pedantry.
    // MEASURED 2026-08-13: 64.3 % of this field is EXACTLY zero (the sky between the disc
    // clusters, where the ridge term is gated off too). Giving each tied texel its own rank
    // `r` handed those 42,172 identical inputs 42,172 DIFFERENT outputs, spanning 0.256 to
    // 0.652 — and because `Array.prototype.sort` is stable, the order of the tie block is
    // texel order, so the field's own "empty sky" became a RAMP in row-major order that
    // stepped 0.394 at the wrap. The deck's whole anti-aliased alpha edge is 0.060 wide, so
    // that was a 6.6x razor line drawn across the sky every 488 world units, plus a coverage
    // gradient inside every tile that no threshold comment described. Averaging the rank over
    // each tied group keeps the map monotonic and makes it a function of the VALUE, which is
    // the only thing a histogram match is allowed to be a function of.
    const applyK = (k) => {
        let r = 0;
        while (r < n) {
            const value = field[order[r]];
            let end = r + 1;
            while (end < n && field[order[end]] === value) end += 1;
            const u = ((r + end) / 2) / n;
            const target = 0.58 + ((targetQ(u) - 0.58) * k);
            for (let t = r; t < end; t += 1) matched[order[t]] = target;
            r = end;
        }
    };
    // Bilinear, wrapping — the same filtering the GPU will do.
    const sample = (u, v) => {
        const x = ((((u * res) % res) + res) % res);
        const y = ((((v * res) % res) + res) % res);
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const x1 = (x0 + 1) % res;
        const y1 = (y0 + 1) % res;
        const a = matched[(y0 * res) + x0];
        const b = matched[(y0 * res) + x1];
        const c = matched[(y1 * res) + x0];
        const d = matched[(y1 * res) + x1];
        return (((a * (1 - fx)) + (b * fx)) * (1 - fy)) + (((c * (1 - fx)) + (d * fx)) * fy);
    };
    // The fragment stage's own octave scales and offsets (odyssey-world-renderer cloud deck).
    const sumAt = (wx, wz) => (sample(wx * 0.00205, wz * 0.00205) * 0.52)
        + (sample((wx * 0.00560) + 0.31, (wz * 0.00560) + 0.77) * 0.32)
        + (sample((wx * 0.01420) + 0.58, (wz * 0.01420) + 0.12) * 0.16);
    const SAMPLES = 8192;
    const pct = () => {
        const vals = new Float64Array(SAMPLES);
        let sd = 0x2545f491;
        const r = () => {
            sd = Math.imul(sd ^ (sd >>> 15), 2246822519);
            sd = (sd + 0x6d2b79f5) >>> 0;
            return ((sd ^ (sd >>> 13)) >>> 0) / 4294967296;
        };
        for (let i = 0; i < SAMPLES; i += 1) vals[i] = sumAt(r() * 24000, r() * 24000);
        vals.sort();
        return {
            p10: vals[Math.floor(SAMPLES * 0.10)],
            p50: vals[Math.floor(SAMPLES * 0.50)],
            p90: vals[Math.floor(SAMPLES * 0.90)],
        };
    };
    // Solve the stretch so the SUM's p90-p10 spread reproduces the measured 0.28. Averaging
    // three octaves narrows the distribution, so k > 1 is expected.
    let lo = 0.5;
    let hi = 6.0;
    let best = null;
    for (let it = 0; it < 22; it += 1) {
        const k = (lo + hi) / 2;
        applyK(k);
        best = pct();
        if ((best.p90 - best.p10) < 0.28) lo = k; else hi = k;
        best.k = k;
    }
    field.set(matched);
    return best;
}

function bakeCloudSilhouette(res, vn) {
    // Deterministic placement: the same sky every boot, and reproducible captures.
    let seed = 0x9e3779b9;
    const rnd = () => {
        seed = Math.imul(seed ^ (seed >>> 15), 2246822519);
        seed = (seed + 0x6d2b79f5) >>> 0;
        return ((seed ^ (seed >>> 13)) >>> 0) / 4294967296;
    };
    // DISCS ARE PLACED IN CLUSTERS, NOT SPREAD. The first cut scattered 77 discs uniformly
    // across the tile and the field came out above threshold almost everywhere: one connected
    // overcast mass rather than separate clouds (capture-confirmed — the sky filled in). A
    // cloud is a CLUSTER of lobes with sky around it, so each cluster gets its own 2-4
    // primaries, the secondaries ride those primaries' rims, and the tertiaries scallop the
    // crown. The gaps between clusters are the sky, and they only exist if the clusters are
    // placed sparsely on purpose.
    // NOTE this field is a PLAN view: the deck is a horizontal sheet, so what the viewer reads
    // as the cloud's outline is this field's contour seen from below or above. The Ghibli
    // "flat base" rule belongs to vertical faces and does not apply here; the scalloped
    // contour does, and that is exactly what a union of discs produces.
    const discs = [];
    const push = (x, y, r) => discs.push({ x: x * res, y: y * res, r: r * res });
    // SCALE, set against the owner's Witness reference. That sky is a FEW BIG clouds in
    // generous blue, and each one is big enough that you can count its lobes; the first cut
    // gave many small puffs — a mackerel sky, right grammar at the wrong size. So: 2 clusters
    // per tile instead of 3, primaries roughly doubled (0.070-0.115 -> 0.125-0.190 of the
    // tile), and the satellites scaled with them so the lobe HIERARCHY is preserved — a
    // cloud must still read as primaries carrying secondaries carrying scallops, just larger.
    // Cluster spreads grow with the lobes for the same reason.
    // In world terms at the coarsest octave (tile ~488 u) a primary lobe is now ~120-185 u
    // across rather than ~68-112, and there are fewer of them.
    const CLUSTERS = 2;
    for (let c = 0; c < CLUSTERS; c += 1) {
        const cx = rnd();
        const cy = rnd();
        const primaries = 2 + Math.floor(rnd() * 3); // 2-4 lobes carry the read
        for (let i = 0; i < primaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.26), cy + ((rnd() - 0.5) * 0.26), 0.125 + (rnd() * 0.065));
        }
        const secondaries = 5 + Math.floor(rnd() * 4);
        for (let i = 0; i < secondaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.40), cy + ((rnd() - 0.5) * 0.40), 0.058 + (rnd() * 0.048));
        }
        const tertiaries = 10 + Math.floor(rnd() * 7);
        for (let i = 0; i < tertiaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.50), cy + ((rnd() - 0.5) * 0.50), 0.024 + (rnd() * 0.026));
        }
    }
    const out = new Float32Array(res * res);
    const half = res / 2;
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            let m = 0;
            for (let d = 0; d < discs.length; d += 1) {
                const disc = discs[d];
                let dx = Math.abs(i - disc.x);
                if (dx > half) dx = res - dx;
                let dy = Math.abs(j - disc.y);
                if (dy > half) dy = res - dy;
                const dist = Math.sqrt((dx * dx) + (dy * dy));
                if (dist < disc.r) {
                    // sqrt dome: circular iso-contours, and a shoulder that stays fat near the
                    // rim so the union's boundary is an arc rather than a soft ramp.
                    const f = Math.sqrt(1 - (dist / disc.r));
                    if (f > m) m = f;
                }
            }
            // The ridge term is DETAIL ON the lobes, not a second cloud layer: gate it by the
            // disc field so it cannot raise the gaps between clusters back above threshold.
            const ridge = 1 - Math.abs((2 * vn(i, j, 1 / 26)) - 1);
            out[(j * res) + i] = (0.80 * m) + (0.20 * ridge * m);
        }
    }
    return out;
}

/**
 * The deck's silhouette field, baked and calibrated — the `.a` channel of the detail texture.
 *
 * EXPORTED FOR ITS UNIT GUARD (odyssey-cloud-field.test.js), because this field shipped two
 * defects that a screenshot could only show as "a straight line in the sky at ch5" and that
 * cost three bisect sessions between them: a value noise that did not tile, and a rank remap
 * that gave 42,172 tied texels 42,172 different values in texel order. Both are properties of
 * the FIELD, testable in milliseconds without a GPU, and neither was testable at all while
 * this lived inside `bakeDetailNormal` as two closures.
 *
 * @param {number} [res] texture resolution
 * @returns {{field: Float32Array, stats: {k:number,p10:number,p50:number,p90:number}}}
 */
export function bakeOdysseyCloudField(res = 256) {
    const field = bakeCloudSilhouette(res, createTilingValueNoise(res));
    const stats = matchCloudHistogram(field, res);
    return { field, stats };
}

function bakeDetailNormal(res = 256) {
    // THE NOISE MUST TILE, and until 2026-08-13 this one did not — see odyssey-tiling-noise.js
    // for the mechanism and the measured 48x seam step it put across the cloud silhouette.
    // EVERY channel of this texture is sampled with RepeatWrapping by something: .rg by the
    // ground's bump and the water's ripples, .b by the terrain's snow jitter and the deck's
    // vertex billow, .a by all three of the deck's density octaves. One non-tiling sampler
    // therefore drew a straight discontinuity across five surfaces at once.
    const vn = createTilingValueNoise(res);
    const field = new Float32Array(res * res);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            field[(j * res) + i] = (vn(i, j, 1 / 32) * 0.65) + (vn(i, j, 1 / 11) * 0.35);
        }
    }
    const at = (i, j) => field[((((j % res) + res) % res) * res) + (((i % res) + res) % res)];
    // RG are DERIVATIVES — signed, centred on zero — for the ground's bump term. BA carry the
    // scalar field itself at two frequencies, which the bake already computed and used to throw
    // away. The cloud deck needs a DENSITY, and reading it off the derivative channels gives a
    // field centred on zero that no coverage threshold can ever cross: the deck rendered
    // completely empty until this was widened. One texture, one fetch path, both uses served.
    // Rebake calibration guard: the sum the thresholds actually see must land back on the
    // measured p10/p50/p90 = 0.42/0.58/0.70, or 0.63/0.40 and the gate bands silently change
    // meaning. Logged rather than thrown — a sky that is a little off is a tuning note, not a
    // reason to refuse to boot — and asserted in odyssey-cloud-field.test.js.
    const { field: coarse, stats: cloudStats } = bakeOdysseyCloudField(res);
    // eslint-disable-next-line no-console
    console.log('[world] cloud silhouette histogram', JSON.stringify({
        k: Number(cloudStats.k.toFixed(3)),
        p10: Number(cloudStats.p10.toFixed(4)),
        p50: Number(cloudStats.p50.toFixed(4)),
        p90: Number(cloudStats.p90.toFixed(4)),
    }));
    const data = new Uint16Array(res * res * 4);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const idx = ((j * res) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) * 0.5);
            data[idx + 1] = THREE.DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) * 0.5);
            data[idx + 2] = THREE.DataUtils.toHalfFloat(field[(j * res) + i]);
            data[idx + 3] = THREE.DataUtils.toHalfFloat(coarse[(j * res) + i]);
        }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

// ── vegetation ───────────────────────────────────────────────────────────────────

/**
 * THE PAINT PROBE (forest plan Wave 0b) — the cheapest possible falsifier of the whole
 * overhaul, run on the INCUMBENT cone geometry so it costs no new geometry files.
 *
 * The research is unanimous that the painted-blob read is two things and neither is the mesh:
 * normals transferred from an enclosing blob, and a 2-3 band ramp on a WRAPPED light term.
 * If those two transform even a 30-triangle cone stack, the sculptor is funded; if they do
 * not, the paint is redesigned before a single species is built. Owner decision D0.
 *
 * Every constant below is a MEASURED band from the plan's §1b (Wave 0c, sampled from the
 * owner's five reference frames), not a taste setting — so a capture that misses the bar
 * names the constant to move rather than starting an argument.
 */
// Where the crown's blob normals radiate FROM, in local tree units. The canopy spans y 0.9
// (skirt) to 3.95 (apex) and a cone's mass is bottom-heavy, so the centre sits below the
// midpoint. Vertices below it therefore get normals pointing DOWN, which is what hands the
// underside its dark mass for free instead of needing a second term for it.
const FOREST_BLOB_CENTRE_Y = 1.95;
// "The leaves face outwards and upwards from the center of the tree" — the polycount/habrador
// reproduction of the Witness normal transfer. Applied to the already-normalised direction and
// renormalised, so it is a constant tilt rather than a distance-dependent one.
const FOREST_BLOB_UP_BIAS = 0.30;
// Wrap width: (dot(N,L) + w) / (1 + w). w=0.70 pushes the terminator far around the limb.
// The references show a soft turn of form across the whole crown, and a hard dot(N,L)
// terminator on a blob normal field cannot produce one at any threshold.
const FOREST_WRAP = 0.70;
// The band edges, placed ON the wrapped term so they land inside the soft falloff instead of
// replacing it. Wide on purpose, like the cloud field's 0.42..0.62.
// THREE STEPS. The lower pair turns shade into the mid tone across the crown's flank; the
// upper pair is placed where canopy TOPS actually compute (wrap ~0.66 at the authored sun
// angle), which is the only place a threshold can still do work when the camera looks down.
const FOREST_BAND_LO = 0.34;
const FOREST_BAND_MID = 0.52;
const FOREST_BAND_HI_LO = 0.60;
const FOREST_BAND_HI = 0.78;
/** How far the mid tone sits from shade toward the lit albedo. */
const FOREST_MID_TONE = 0.58;
// ⚠️ THE MEASURED SHADOW LAW (§1b R3). Foliage shade goes DEEPER and MORE SATURATED along the
// canopy's OWN hue axis: normalised blue FALLS and HSV saturation RISES in 14 of 15 measured
// reference pairs. It does NOT go cool/blue — that was the community-recipe assumption this
// plan carried until the pixels refuted it, and it survives only as the CLOUD law. Encoding
// it as a saturation gain > 1 with a value scale < 1 on the albedo's own colour makes the law
// STRUCTURAL: every crown hue authored later inherits a correct shade automatically, and no
// future palette edit can quietly reintroduce a grey or blue shadow.
const FOREST_SHADE_SAT = 1.30;
// The value ratio, inside the measured workhorse band (0.43..0.78; §1b R2).
//
// ⚠️ IT IS PRODUCED IN EXACTLY ONE PLACE — the ambient light's magnitude relative to the sun's
// — and the first cut of this probe got that wrong in a way the reference bar caught within
// one capture. That version scaled the ALBEDO by this constant, then multiplied by a dim
// ambient, then multiplied AGAIN by the occlusion floor; three compounding factors put the
// measured shade at p10 = 0.0 (literal black, after the grade's crush) against an incumbent
// that measured 66.9 and a target band of 0.43..0.78. The lesson is worth more than the fix:
// the measured ratio is a FINAL-PIXEL ratio, so only one term in the chain may own it.
const FOREST_SHADE_VALUE = 0.55;
// Sky occlusion at the crown's base. Oga's dark interior mass is "blocked from the light of
// the sky" — a height-in-crown term, NOT a second N.L, which is why this multiplies the band
// result rather than joining it.
// Raised from 0.62 after the first capture: this is a MODULATION on top of the band, not a
// second darkening authority, and at 0.62 it was compounding into the black-shade defect.
const FOREST_OCCLUSION_FLOOR = 0.80;
// The edge of that mass, in crown height. Placed low so the dark belly is a skirt under a
// large lit crown rather than half the tree.
const FOREST_OCC_LO = 0.10;
const FOREST_OCC_HI = 0.38;
/**
 * How far a tree's own band threshold may slide along the wrap ramp, per instance.
 *
 * The fix for "the forest reads as one flat sheet from above" — see the note at `fvBand`.
 * Large enough that neighbouring crowns separate into distinct tones; small enough that no
 * tree leaves the two authored tones, which is what §1b R1's "2-3 connected masses" requires.
 */
const FOREST_BAND_JITTER = 0.17;
/**
 * Where the band structure starts and finishes collapsing toward one tone, in world units.
 * FLAT_NEAR sits past the hero tier (a hero crown keeps all three tones); FLAT_FAR is inside
 * the 1450 u draw distance so the far half of the forest genuinely reads as massed colour.
 */
/** Saturation gain applied to the far tone BEFORE the aerial haze — see the note at use. */
const FOREST_FAR_PRESAT = 2.0;
const FOREST_FLAT_NEAR = 220;
const FOREST_FLAT_FAR = 950;
// The backlit gold: the Ghibli glow, and the half of §1b R7 that a near tree can show.
const FOREST_BACKLIT_GAIN = 0.30;
// Ambient = the colour script's shadow tint plus a little sky fill, so the shade band is a
// LIT colour and not merely a darker albedo. Nodes, never copied numbers — the whole forest
// re-tints with the journey's time of day for free.
// These two are HUE contributions only; the ambient's MAGNITUDE comes from the sun term
// scaled by FOREST_SHADE_VALUE, so the value ratio has exactly one owner.
const FOREST_AMBIENT_TINT = 0.10;
const FOREST_SKY_FILL = 0.08;
// Eased from 0.95: the first capture measured the probe 35% brighter than the incumbent and
// BELOW the references' saturation band, which is the wrong trade in a palette whose stated
// rule is that saturation never collapses.
const FOREST_SUN_GAIN = 0.88;
// Two crown greens, varied per instance by the existing `aTint`: one dominant hue per tree
// (§1b R5), and a preview of what Wave 2's zone field will drive properly.
// ⚠️ RE-TUNED TWICE, AND THE SECOND TIME UNDID THE FIRST. The first pass deepened these
// because the capture measured saturation 0.372 against the reference band of 0.46..0.75 —
// but that capture was taken while every canopy triangle was WOUND INSIDE-OUT, so the
// measurement described the far interior surface, not the tree. With the winding fixed the
// same albedo measured 0.867, well ABOVE the band: the deepening had been compensating for a
// bug. These are back near their authored values. The lesson is not about greens — it is that
// a measurement is only as good as the geometry underneath it, and a tuning pass done on top
// of a rendering defect encodes that defect into the palette.
const FOREST_CROWN_A = [0.145, 0.248, 0.108];
const FOREST_CROWN_B = [0.285, 0.415, 0.155];
// Trunk. §1b R6 measured the opposition as HUE-first (Firewatch trunk normR 0.57 against a
// canopy's 0.42), value-second — so this is a red-brown against the olive crowns, not a
// darker green.
const FOREST_TRUNK = [0.105, 0.055, 0.032];
/**
 * World scale for a roster tree. The sculptor authors at unit-ish size (a mature pine is ~4.5
 * local units tall); the incumbent's instance scale ran 3.2-6.6 on a ~4 unit tree, giving
 * 10.7-32.6 m. This lands the roster in the same band at 1 u = 1 m.
 */
const FOREST_V2_SCALE = 4.6;

/**
 * @param {boolean} [blobNormals] bake canopy normals radiating from the crown's blob centre
 *   instead of the per-face outward normals. Wave 0b's half of the probe that lives in the
 *   BAKE: it is vertex data only, costs nothing at runtime, and is the single change the
 *   research ranks first.
 */
function buildTreeGeometry(blobNormals = false) {
    const positions = [];
    const normals = [];
    const shade = [];
    const SIDES = 6;
    const trunkH = 0.9;
    const trunkR = 0.10;
    for (let i = 0; i < SIDES; i += 1) {
        const a0 = (i / SIDES) * Math.PI * 2;
        const a1 = ((i + 1) / SIDES) * Math.PI * 2;
        const nx = Math.cos((a0 + a1) / 2);
        const nz = Math.sin((a0 + a1) / 2);
        const p0 = [Math.cos(a0) * trunkR, Math.sin(a0) * trunkR];
        const p1 = [Math.cos(a1) * trunkR, Math.sin(a1) * trunkR];
        // CCW-outward. See the winding note in odyssey-forest-geometry.js: this stack was
        // emitted CW, so every triangle was back-face culled and the GPU shaded the far
        // interior. Harmless while the normals were flat per-face; NOT harmless once the
        // Wave 0b probe bakes blob normals and bands on them.
        [[p0[0], 0, p0[1], 0], [p1[0], trunkH, p1[1], 0.2], [p1[0], 0, p1[1], 0],
            [p0[0], 0, p0[1], 0], [p0[0], trunkH, p0[1], 0.2], [p1[0], trunkH, p1[1], 0.2]]
            .forEach(([x, y, z, sv]) => {
                positions.push(x, y, z);
                normals.push(nx, 0.1, nz);
                shade.push(sv);
            });
    }
    for (let t = 0; t < 3; t += 1) {
        const f = t / 3;
        const base = trunkH + (f * 2.5);
        const top = base + 1.55 - (f * 0.25);
        const radius = 1.0 - (f * 0.27);
        for (let i = 0; i < SIDES; i += 1) {
            const a0 = (i / SIDES) * Math.PI * 2;
            const a1 = ((i + 1) / SIDES) * Math.PI * 2;
            const nx = Math.cos((a0 + a1) / 2);
            const nz = Math.sin((a0 + a1) / 2);
            // rim0 -> apex -> rim1 is CCW seen from outside.
            const tri = [
                [Math.cos(a0) * radius, base, Math.sin(a0) * radius],
                [0, top, 0],
                [Math.cos(a1) * radius, base, Math.sin(a1) * radius],
            ];
            tri.forEach(([px, py, pz]) => positions.push(px, py, pz));
            if (blobNormals) {
                // PER-VERTEX, which is the entire point: three different normals across one
                // triangle is what turns a flat facet into a slice of a smooth ball. The
                // silhouette is untouched — the crown keeps its crisp cone edges and gains a
                // soft interior, which is exactly the Witness combination.
                tri.forEach(([px, py, pz]) => {
                    const dy0 = py - FOREST_BLOB_CENTRE_Y;
                    // Guarded: a zero-length normalize const-folds into a WGSL compile
                    // failure rather than a warning (the winter theme's logged trap). No
                    // canopy vertex sits at the blob centre, but the guard costs nothing and
                    // the constant above is meant to be tuned.
                    const l0 = Math.hypot(px, dy0, pz) || 1;
                    const uy = (dy0 / l0) + FOREST_BLOB_UP_BIAS;
                    const l1 = Math.hypot(px / l0, uy, pz / l0) || 1;
                    normals.push((px / l0) / l1, uy / l1, (pz / l0) / l1);
                });
            } else {
                for (let k = 0; k < 3; k += 1) normals.push(nx, 0.45, nz);
            }
            // ⚠️ ORDER FOLLOWS `tri`, which is now rim0 -> APEX -> rim1. Left as
            // (0.15, 0.15, 1.0) after the winding swap this would have put the apex's bright
            // value on a rim vertex and vice versa — a silent inversion of the incumbent's
            // vertical gradient, on the exact attribute the shipped forest reads.
            shade.push(0.15, 1.0, 0.15);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    return geo;
}

/**
 * Scatter on the CPU HEIGHT MIRROR — the same surface the vertex shader displaces to, so a
 * floating or buried tree is structurally impossible. (The shipped Ch4 belt is planted at a
 * constant Y with no heightfield sample at all: mean -4.5u, 37.7% of cells burying a tree by
 * more than 8u.) Jittered grid rather than pure random, which clumps and leaves holes at
 * exactly the scale the eye reads as a mistake.
 */
export function scatterTrees(heightAt, {
    cx, cz, radius, spacing, seaLevel, snowStart,
}) {
    const out = [];
    const rnd = (i, j, salt) => {
        let h = ((i | 0) * 374761393) + ((j | 0) * 668265263) + (salt * 2654435761);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const steps = Math.ceil((radius * 2) / spacing);
    for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < steps; i += 1) {
            const x = (cx - radius) + (i * spacing) + ((rnd(i, j, 1) - 0.5) * spacing * 0.95);
            const z = (cz - radius) + (j * spacing) + ((rnd(i, j, 2) - 0.5) * spacing * 0.95);
            if (Math.hypot(x - cx, z - cz) > radius) continue;
            const y = heightAt(x, z);
            if (y < seaLevel + 3 || y > snowStart) continue;
            const e = 4;
            const slope = Math.hypot(
                (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
                (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e),
            );
            if (slope > 0.62) continue;
            const mask = rnd(Math.floor(x / 140), Math.floor(z / 140), 3);
            const falloff = 1 - Math.max(0, (y - (snowStart - 130)) / 130);
            if (rnd(i, j, 4) > (0.35 + (mask * 0.95)) * Math.max(0.12, falloff)) continue;
            out.push({
                x,
                y,
                z,
                scale: 3.2 + (rnd(i, j, 5) * 3.4),
                rot: rnd(i, j, 6) * Math.PI * 2,
                tint: rnd(i, j, 7),
            });
        }
    }
    return out;
}

// ── the world ────────────────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {string} [opts.quality] 'high' | 'low'
 * @param {Array<{x:number,y:number,z:number}>} [opts.railSamples] points along the journey
 *   rail, sampled by the CALLER (the world deliberately does not know the path). Used to seat
 *   the underwater god-ray shafts along the submerged stretch; empty means no shafts.
 * @param {boolean} [opts.clouds] the flat cloud SHEET. ⚠️ DEFAULT FALSE since the owner
 *   retired it on 2026-08-14 in favour of the sculpted field — see `cloudField`. Retained per
 *   the ADR-0015 pattern and restorable with `?odysseyWorldCloudSheet=1`; the material and
 *   geometry are still built, so the escape hatch is one flag and not a revert. Its measured
 *   price at the moment of retirement was 1.180 ms (ch4) / 1.835 ms (ch5), COVERAGE-INDEPENDENT,
 *   against the field's 0.393 ms — so the swap refunds roughly 1.4 ms at ch5.
 *   Historically this was a bisect lever, default true. When false the cloud deck's mesh
 *   never enters the scene, so its pipeline is never compiled — the material and geometry are
 *   still constructed (that part is proven safe headless). Exists because every IN-GAME One
 *   World boot after the deck landed stalls before readiness while the playground renders the
 *   same deck perfectly; this isolates "is it the deck's in-game compile" to one URL flag
 *   instead of one source edit per experiment.
 * @param {boolean} [opts.applyExposure] whether the WORLD applies the colour script's
 *   exposure. True standalone (the playground has no post stack). FALSE inside the game,
 *   where odyssey-tsl-pipeline.js owns exposure and applies ACES after it — otherwise
 *   exposure is applied twice.
 * @param {number} [opts.outputSaturation] pulls the world's output toward its own luma before
 *   it reaches a post stack that adds saturation of its own. The Odyssey grade lifts master
 *   saturation 1.15x and chapter saturation a further ~1.10x on top of a black crush, which
 *   drove the sky's already-low red channel to a clamped ZERO. The world therefore has to hand
 *   that stack a FLATTER image than the one it wants on screen; 1.0 (the playground) is the
 *   image as authored.
 * @param {number} [opts.outputScale] scales the world's HDR output before it reaches a post
 *   stack. The palette is authored display-referred, which is right for a flat playground but
 *   far too hot for a pipeline that then adds bloom and an ACES curve: measured in-game, sky
 *   came out at luma 200 against 129 standalone and the massif washed to pale haze. Scene-
 *   linear output is what a tonemapper needs room to work with.
 * @param {boolean} [opts.heroes] mount the Act II hero cumulus AND the deck's hero-clearing
 *   coverage term (both ride this one option — see the clearings comment for the phantom-hole
 *   trap that made this mandatory). Default FALSE: the owner retired the heroes 2026-08-14 as
 *   an art-direction call — two cloud MODELS in one sky do not cohere — after they measured
 *   1-2 timer ticks (perf was never the issue). Module, specs and tests are RETAINED per the
 *   ADR-0015 pattern; `?odysseyWorldHeroes=1` in-game or `?heroes=1` on the playground rig restores
 *   the full system.
 * @param {boolean} [opts.cloudField] the SCULPTED cloud field — DEFAULT TRUE since
 *   2026-08-14; this is the shipped Act II sky. Removed for bisects with
 *   `?odysseyWorldNoCloudField=1` (gpu-split configuration `no-cloud-field`). 52 authored masses
 *   sculpted from a smooth-min SDF with flat bases and SDF-gradient normals — see
 *   odyssey-cloud-field.js. Opt-in until the plan's Wave 4 owner-gated swap; the sheet is
 *   still the shipped sky. docs/ODYSSEY_ACT2_CLOUD_FIELD_PLAN_2026-08.md §5.
 * @param {number} [opts.cloudFieldCount] slice the field to its first N masses. The cost-curve
 *   instrument: two counts in one thermal window separate the per-draw constant from the
 *   per-mass price.
 * @param {boolean} [opts.water] build the sea plate at all. A MEASUREMENT LEVER, not a player
 *   setting (board flag `?odysseyWorldNoWater=1`, gpu-split configuration `no-water`): the
 *   water surface is one ungated DoubleSide transparent clipmap that draws across the whole
 *   act window, and until 2026-08-13 nothing in the tree could turn it off — so its total cost
 *   had never been measured and no water work could be honestly funded. Skipping the BUILD
 *   (not just the draw) also prices its pipeline out of the cold-compile path. Same
 *   measurement-lever pattern as earth-core's ?earthCoreNoLake/NoHaze bisects.
 * @param {boolean} [opts.forest] scatter and build the forest at all. A MEASUREMENT LEVER,
 *   not a player setting (board flag `?odysseyWorldNoForest=1`, gpu-split configuration
 *   `no-forest`), added 2026-08-14 for the forest plan's Wave 0a. Same reason as `water`, and
 *   a starker case: the forest is the single biggest content system in this file — 15,427
 *   trees / 40 InstancedMesh chunks / 462,810 triangles at high quality — and its cost had
 *   NEVER been measured as a differential, because nothing in the tree could switch it off.
 *   ADR-0016 is explicit that an unmeasured cost cannot fund a package, so this lever is the
 *   prerequisite for every wave of docs/ODYSSEY_ACT2_FOREST_PLAN_2026-08.md. The ONE forest
 *   number that exists today is a by-product: at p=0.16 submerged, 11 of 45 draws were
 *   forest — measured while proving the underwater gate, not while pricing the system.
 *   Skipping the BUILD (not just the draw) prices draws + fill + vertex + pipeline together.
 * @param {'lattice'|'alpha'|'grid'|'mult'|'flat'|null} [opts.cloudDebug] DIAGNOSTIC LEVER, default null
 *   (board flag `?odysseyWorldCloudDebug=lattice`). Re-shades the deck — same mesh, same
 *   geometry, same draw — to answer one question per mode:
 *   `lattice` paints the CLIPMAP's own structure over the shipped deck (morph band yellow,
 *     the double-covered ring collars red and cyan), so a straight line in a capture can be
 *     tested against a ring boundary instead of guessed at;
 *   `alpha` draws the shipped opacity as an opaque greyscale sheet, which separates the
 *     opacity graph from the colour graph;
 *   `grid` is `alpha` with a world-space ruler over it (red = world X every 50 u, green =
 *     world Z), which says which world axis a straight edge is an iso-line of;
 *   `mult` puts the opacity graph's three attenuators in R/G/B (nearFade, bandFade, rim);
 *   `flat` draws constant white at constant alpha, which leaves only geometry and draw order.
 *   This exists because the deck's remaining defect class is "a quantity keyed to something
 *   other than the camera", and two sessions went on bisecting those one source edit at a
 *   time while the terms that generate them were undrawable.
 */
export function createOdysseyWorld({
    quality = 'high', applyExposure = true, outputScale = 1, outputSaturation = 1, clouds = false,
    // Default FALSE since the owner's 2026-08-14 retirement — and the default matters more
    // than it looks: the playground rig mounts this world too, and a rig that defaults heroes
    // ON while the board passes false is the "second, quieter opinion" disease the grade
    // contract file documents. One default, shared by every caller; opt back in explicitly.
    heroes = false,
    cloudField = true,
    cloudFieldCount = 0,
    water = true,
    forest = true,
    forestPaint = false,
    // THE SHIPPED FOREST since the 2026-08-14 swap (owner decisions D0/D1/D2/D5 — the roster
    // was accepted wave by wave through captures, and D5 fixed its price at the lean shape's
    // measured 2.621 ms). The incumbent cone forest is RETAINED per ADR-0015 behind
    // `?odysseyWorldForestV1=1`: builders, scatter and material all stay, one flag from
    // restoration, so a failure of the new forest is attributable rather than unfalsifiable.
    forestV2 = true,
    // The rail-visibility cull: drop trees the journey's camera can never see. Ships ON — it
    // was measured at 0.00% of pixels changed across four rail stations, for 0.20 ms p50 — and
    // `?odysseyWorldNoVisCull=1` restores every tree (ADR-0015).
    visibilityCull = true,
    // EXPERIMENT: pin every tree to one LOD tier. `?odysseyForestLod=hero` is the "what would
    // high-detail trees everywhere feel like" lever. Not a quality setting — it ignores
    // distance entirely, so it costs ~18 ms of forest on the integrated lane.
    forestLod = null,
    /** Quality tier name — selects the forest's hero/mid LOD distances. */
    qualityTier = null,
    // MEASUREMENT ONLY (ground plan Wave 0a). Same geometry, same draws, same triangles —
    // only the ground's fragment mesostructure is withheld, so `baseline - flat-ground`
    // prices exactly the stack the overhaul spends against. Never shipped on.
    flatGround = false,
    cloudDebug = null,
    skyRadius = null, railSamples = [],
} = {}) {
    const q = ODYSSEY_WORLD_QUALITY[quality] || ODYSSEY_WORLD_QUALITY.high;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);

    const relief = buildReliefBake(q.reliefRes);
    // The world plate: sun visibility (R, unchanged) plus the three fields that ARE the
    // painting — wide occlusion, moisture, and the island's colour zone. Deciles are logged so
    // a rebake cannot silently flatten a field the whole palette hangs off.
    const sunFields = bakeGroundSunFields(relief.sample, q.shadowRes);
    const sunVisTex = sunFields.tex;
    const groundAtlas = bakeGroundAtlas();
    const groundTex = groundAtlas.tex;
    const atlasAvg = groundAtlas.avg;
    const detailTex = bakeDetailNormal();
    const macroTex = bakeMacroTexture();
    const heightTex = relief.tex;
    const t1 = (typeof performance !== 'undefined' ? performance.now() : 0);

    const group = new THREE.Group();
    group.name = 'odyssey-act2-world';

    const ground = buildOdysseyClipmap({
        gridN: q.gridN, levels: q.levels, baseSpacing: q.baseSpacing, holeShrink: q.holeShrink,
    });
    const waterSpacing = (q.baseSpacing * q.gridN) / 32;
    // `waterGeo`, not `water` — the option of that name is the build gate (matches cloudGeo).
    const waterGeo = buildOdysseyClipmap({
        gridN: 32, levels: q.levels, baseSpacing: waterSpacing, holeShrink: 1,
    });
    // The cloud deck rides the same coarse lattice as the water: it is a smooth surface with
    // no small-scale geometry, so its detail belongs in the density field, not in triangles.
    const cloudSpacing = waterSpacing * 1.6;
    const cloudGeo = buildOdysseyClipmap({
        gridN: 32, levels: q.levels, baseSpacing: cloudSpacing, holeShrink: 1,
    });
    const cloudReach = cloudGeo.reach;

    const uLodCenter = uniform(new THREE.Vector2(0, 0));
    const uTime = uniform(0);
    const uSunDir = uniform(new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize());
    const uSkyHorizon = uniform(new THREE.Color(0.72, 0.82, 0.93));
    const uSkyZenith = uniform(new THREE.Color(0.19, 0.40, 0.76));
    const uSunColour = uniform(new THREE.Color(1, 0.95, 0.86));
    const uShadowTint = uniform(new THREE.Color(0.44, 0.58, 0.82));
    const uAerialK = uniform(0.00016);
    // How hard the baked curvature reads. Two separate gains because they answer different
    // questions: cavity is "how deep does this gully feel", ridgeRock is "has the weather
    // stripped this crest back to stone".
    const uCavity = uniform(q.cavity);
    const uRidgeRock = uniform(q.ridgeRock);
    const uExposure = uniform(1);
    const uOutputScale = uniform(outputScale);
    const uOutputSat = uniform(outputSaturation);
    const uSubmerged = uniform(0);
    // How deep the EYE is (0 at the surface, 1 by ~140 u down) — set from the same eye height
    // that drives uSubmerged. The convergence colour at infinity depends on it: at depth,
    // long rays converge on the abyss plate, but 30 u under the surface they converge on the
    // MID plate — capture-measured at p=0.185, a fixed deep-plate convergence rendered the
    // near-surface ascent as abyss-dark water.
    const uEyeDepth = uniform(1);
    // 1 while the eye is AT the surface (within ~3 u), 0 elsewhere — the meniscus window.
    const uBreachNear = uniform(0);
    // THE CLOUD REGIME GATE (cloud plan Wave 2, exit-gate response). 1 when the eye is high
    // enough that any part of the deck can show its sunlit TOP, 0 when it cannot. The CPU
    // knows this exactly, so the GPU should not pay to discover it per fragment — see the
    // If-branch on it in the deck's colour graph.
    const uCloudTopLit = uniform(0);
    // The three water plates. Driven from the colour script's water keyframes so the ocean's
    // depth banding and the journey's palette can never drift apart (they are the same data).
    const uWaterShallow = uniform(new THREE.Color(0.29, 0.54, 0.69));
    const uWaterMid = uniform(new THREE.Color(0.10, 0.29, 0.42));
    const uWaterDeep = uniform(new THREE.Color(0.020, 0.105, 0.165));
    /** The dawn-gold kiss the crest SSS transmits — kept OUT of the air palette on purpose. */
    const uWaterGlow = uniform(new THREE.Color(0.88, 0.75, 0.50));

    // THE SKY ABOVE 28 DEGREES — where this function used to return a constant.
    //
    // `clamp(dirY * 1.55 + 0.26, 0, 1)` reaches 1.0 at dirY 0.477, an elevation of 28.5
    // degrees. Every ray above that got ONE identical colour, so the entire horizon-to-zenith
    // palette was spent on the bottom third of the sky and the top two thirds were flat BY
    // CONSTRUCTION. Nobody saw it while the act's cameras looked along the ground; ch5 pitches
    // the rail 18 degrees off VERTICAL, so at p=0.565 the whole frame sat above the saturation
    // point. MEASURED there: the blue channel varied 172.8..178.9 across the entire frame
    // (2.5 %) with red and green pinned at EXACTLY 0.
    //
    // ⚠️ ONE REJECTED FIX, and one correction to why it was rejected — both worth keeping.
    // Holding the old ramp below the clamp and letting it rise gently above it looked like the
    // conservative choice, but the ramp reaches 1.0 at 0.477, so barely 9 % of the palette was
    // left for the ENTIRE upper hemisphere and ch5's deepest sky still measured 0/5/156 —
    // clipped, defect intact. The binding constraint is the palette, not the curve.
    // The correction: the first attempt was judged to have "washed the ch4 massif out to milk",
    // and that was a MISREAD OF THE PICTURE. Measured region by region, ch4's far massif moved
    // +5/+3/+1 and its forest 0/0/0 — aerial perspective was never affected. The whole
    // regression was +35 red in the SKY, which dominates the top of frame and coloured the
    // impression of everything under it. Do not re-reject a sky curve on aerial grounds
    // without measuring the ground itself.
    //
    // So: a power curve that never saturates, tuned so the mid sky lands where the old ramp
    // had it (they cross within 0.001 at dirY 0.2) and the cost is taken in the 30-50 degree
    // band that only ch4's upper sky sees. `below` reproduces the old ramp's descent under the
    // horizon exactly, so downward aerial rays are unchanged.
    // SQRT, NOT POW. The curve wants ~0.48 and `sqrt` is 0.5 — a difference of 0.013 in t at
    // dirY 0.2, which is nothing — but `applyAerial` calls this for EVERY ground, water and
    // tree fragment in the frame, so a general pow here is a transcendental on the whole
    // screen to buy two hundredths of a mix factor. Measured context: this function was the
    // only frame-wide shader change in the session where both Lane B baselines rose ~0.4 ms.
    // The exponent is spelled out in the name so nobody "restores" it to a pow later.
    // ...and the DEEP END MUST NOT SIT ON THE GAMUT EDGE. The colour the script hands over at
    // the ch5 zenith is `#041d84` — red at 0.016 BEFORE any grading — and the stack it goes to
    // lifts saturation twice (master 1.15, chapter 5 a further 1.12) over a black crush, so it
    // lands clamped: the overhead sky reads as a dark navy HOLE rather than as depth, and all
    // variation in the low channels dies at the clamp. `odyssey-world-grade.js` flattens the
    // whole world by 0.72 for exactly this reason; the zenith needs more than the average
    // because it IS the extreme of the palette. The pull rides t squared, so it is negligible
    // anywhere aerial perspective can see it and full only overhead.
    const SKY_ZENITH_GAMUT_PULL = 0.32;
    const skyColourFor = (dirY) => {
        const below = clamp(dirY.add(0.168).div(0.168), 0, 1);
        const t = sqrt(clamp(dirY, 0, 1)).mul(0.80).add(0.20)
            .mul(below)
            .toVar();
        const col = mix(uSkyHorizon, uSkyZenith, t);
        return mix(
            col,
            vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))),
            t.mul(t).mul(SKY_ZENITH_GAMUT_PULL),
        );
    };
    // THE CONSTANT CALL SITES ARE PINNED to the values the old ramp gave them, so this change
    // cannot reach into Ch2's or Ch3's shipped water look while nobody is watching it. Each fed
    // a constant, so each had exactly one answer: 0.5 and 0.9 both clamped to pure zenith, 0.4
    // landed at 0.88. (The two remaining variable-free sites, 0.22 and 0.16, sit below the
    // overhead term entirely and move by <0.02 under the gamut pull, so they are left alone.)
    const skyColourSubmergedUp = uSkyZenith;
    const skyColourSubmergedGraze = mix(uSkyHorizon, uSkyZenith, float(0.88));
    /**
     * How much of a distant surface the air is allowed to replace.
     *
     * 0.82 is the WATER's number and it earns it: the sea runs to the horizon, so its far
     * fragments must converge on the same plate the sky dome converges on or the horizon carries
     * a seam (the "ONE COLOUR AT INFINITY" note on the dome below). LAND never reaches that
     * distance — this is an island, the ocean is what meets the sky — so the ceiling that
     * prevents a seam for water only bleaches terrain for land.
     *
     * MEASURED from the air, which is the view that exposed it: the distant peak screened at
     * chromaticity .309/.331/.360 against the reference's .282/.342/.377 and saturation 0.14
     * against a 0.18-0.53 bar, and the very high aerials read as milk. At rail distance the mix
     * is only 5-21% and this ceiling is never reached, so lowering it for the GROUND is
     * surgical: it changes what is far away and nothing that is near.
     */
    const AERIAL_CEIL_WATER = 0.82;
    const AERIAL_CEIL_LAND = 0.58;
    /**
     * ...and the CEILING was not the binding constraint, which is worth recording because it
     * was the obvious lever and it did almost nothing. From 1,500 u up, the terrain below is
     * 1,500-3,000 u away and the mix is 27-40% — far under either ceiling. What bleaches an
     * aerial view is the RATE, not the cap. So land gets both: a lower cap for the far tail and
     * a scaled rate for everything before it. Water keeps 1.0 on both, because its haze is
     * doing a job (converging on the plate the sky converges on) that land's never has to.
     *
     * Held at 0.62 rather than lower on purpose. Sable's law is in this plan for a reason —
     * with flat shading the distance gradient is nearly the only depth cue there is — so this
     * trades some haze for colour and must not trade all of it.
     */
    const AERIAL_RATE_LAND = 0.62;
    const applyAerial = (lit, wp, ceil = AERIAL_CEIL_WATER, rate = 1) => {
        const to = wp.sub(cameraPosition);
        const d = length(to);
        const dirY = to.div(max(d, float(0.001))).y;
        const air = mix(
            lit,
            skyColourFor(dirY),
            clamp(float(1).sub(exp(d.mul(uAerialK.negate()))).mul(float(rate)), 0, ceil),
        );
        // PER-CHANNEL BEER-LAMBERT, so red dies first and distance reads as WATER rather than
        // as blue fog: one scalar became a vec3 whose red extinguishes ~3.5x faster than blue,
        // the one cue that separates "underwater" from "tinted air". The old 0.97 clamp is gone
        // with it — it pinned everything past ~470 u to 97% of one target, which is why
        // removing the steam veil exposed a frame with 97.5% of its pixels in ONE luma band.
        // 0.995 keeps a floor of the fragment's own colour so the far field converges without
        // ever fully degenerating to the plate.
        const wRGB = clamp(float(1).sub(exp(d.mul(vec3(-0.0160, -0.0082, -0.0046)))), 0, 0.995);
        // The up-lift is a DOWNWELLING cone (pow-concentrated overhead), and grazing rays
        // converge to the DEEP plate: from 100+ u down the whole up-hemisphere is the water
        // plane's underside, whose fragments all sit AT the surface (depthBelow = 0), so
        // without a directional term every up-ray converged to the same shallow plate —
        // capture-measured at p=0.130 as 90% of the frame's pixels in ONE luma band. A
        // grazing ray is a long horizontal water column and must darken like one.
        const surfaceGlow = clamp(dirY, 0, 1).pow(2.2).mul(0.5);
        const grazing = float(1).sub(abs(dirY)).pow(3);
        // BANDED DEPTH, not one exponential (plan §3.4.1 — Ponyo's stacked plates). Depth is
        // shown as discrete hue steps within one temperature family, which is how every
        // adopted reference does it and why none of them need grey scattering. The band index
        // comes from the fragment's own depth below the surface, so the column brightens
        // TOWARD the light instead of away from it — Phase 0 measured the shipped gradient
        // reading darker near the surface than at mid-depth.
        const depthBelow = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(160), 0, 1);
        const bandShallow = mix(uWaterShallow, uWaterMid, smoothstep(float(0.10), float(0.42), depthBelow));
        const banded = mix(bandShallow, uWaterDeep, smoothstep(float(0.45), float(0.92), depthBelow));
        const convergePlate = mix(uWaterMid, uWaterDeep, uEyeDepth);
        const bandedDir = mix(banded, convergePlate, grazing);
        const waterTarget = mix(bandedDir, skyColourSubmergedUp.mul(0.45), surfaceGlow);
        // Component-wise mix against the same target: the hue WALKS with distance (red gone
        // first, blue last) instead of every channel arriving together. This is what puts
        // value structure back into the frame the steam veil used to supply.
        const litUnder = lit.mul(vec3(0.42, 0.86, 1.0));
        const submergedCol = mix(litUnder, waterTarget, wRGB);
        return mix(air, submergedCol, uSubmerged);
    };

    const clipmapXZ = (spacing0, halfN) => {
        const aGrid = attribute('position', 'vec3');
        const spacing = float(spacing0).mul(exp2(aGrid.y));
        const origin = floor(uLodCenter.div(spacing.mul(2))).mul(spacing.mul(2));
        const gridXZ = vec2(aGrid.x, aGrid.z);
        const local = gridXZ.mul(spacing);
        const cheb = max(abs(local.x), abs(local.y)).div(spacing.mul(float(halfN)));
        const morph = clamp(cheb.sub(float(MORPH_START)).div(float(MORPH_END - MORPH_START)), 0, 1);
        const coarse = floor(gridXZ.mul(0.5)).mul(2).mul(spacing);
        return {
            // .toVar() is LOAD-BEARING throughout this file, not style. r181's node builder
            // re-walks a shared subexpression once PER REFERENCE during analysis; expressions
            // with high fan-out (this worldXZ feeds the macro, the weight, the UVs and the
            // swell) therefore make build TIME grow multiplicatively even while the emitted
            // WGSL stays tiny. Measured before/after on the water material: 129 s -> see
            // plan §Wave 2 addendum. A .toVar() materializes the value once and turns every
            // downstream reference into a leaf.
            worldXZ: origin.add(mix(local, coarse, morph)).toVar(),
            spacing: spacing.mul(morph.add(1)).toVar(),
            // FOR INSTRUMENTS. Every lattice-derived defect this repo has shipped — the water
            // plate's "square sections", the deck's straight ch5 diagonals — is a quantity that
            // terraces on the ring structure, and each one cost a session to find because the
            // structure itself was invisible. These two make it drawable (see the
            // `cloudDebug` material's `lattice` mode): the ring index and where inside the ring the
            // morph is. They are plain nodes; nothing pays for them unless a material reads them.
            level: aGrid.y,
            morph,
            cheb,
        };
    };

    // (The analytic tslMacro/tslWeight fold lived here. It is BAKED now — bakeMacroTexture —
    // because expressing it in TSL froze every first compile for minutes. Do not resurrect it.)

    // ── ground ──
    const g = clipmapXZ(q.baseSpacing, q.gridN / 2);
    const reliefUv = g.worldXZ.div(float(RELIEF_EXTENT)).add(0.5);
    const vUv = varying(reliefUv, 'vUv');
    // Macro terrain comes from the BAKE, not from analytic TSL — see bakeMacroTexture. The
    // analytic fold in a shader graph froze the tab for minutes at build time.
    const gMacroTex = texture(macroTex, reliefUv).level(0);
    const gMacro = gMacroTex.r;
    const gWeight = gMacroTex.g;
    const groundMat = new THREE.MeshBasicNodeMaterial();
    groundMat.positionNode = vec3(
        g.worldXZ.x,
        gMacro.add(texture(heightTex, reliefUv).level(0).r.mul(gWeight)),
        g.worldXZ.y,
    );
    const vWeight = varying(gWeight, 'vW');
    const vSpacing = varying(g.spacing, 'vS');
    const vMDx = varying(gMacroTex.b, 'vMDx');
    const vMDz = varying(gMacroTex.a, 'vMDz');

    const aux = texture(heightTex, vUv);
    const baseNormal = normalize(vec3(aux.g.mul(vWeight).add(vMDx).negate(), 1, aux.b.mul(vWeight).add(vMDz).negate()));
    const footprint = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)));
    /**
     * THE WORLD PLATE (ground plan Wave 1) — one fetch, four fields.
     *
     * This used to be a single-channel sun-visibility read. R still is, byte for byte and
     * math for math, because the water material reads the same texture and a silent change
     * there would be a second, quieter opinion about where the sun is. G, B and A were three
     * unused channel slots on a fetch the ground fragment was ALREADY paying for, and they now
     * carry the painting: wide-radius occlusion, the moisture field that places every material
     * between its two palette poles, and the island's regional colour zone. Widening a texture
     * that is already sampled is free per pixel — the same trick the relief bake's curvature
     * channel used when it stopped being "a literal zero".
     */
    const plate = texture(sunVisTex, vUv).toVar();
    const sunVis = plate.r;
    const wideAo = plate.g;
    const zone = plate.a;

    let groundColour;
    if (flatGround) {
        /**
         * THE PRICING LEVER (ground plan Wave 0a) — `?odysseyWorldFlatGround=1`.
         *
         * The ground fragment stack had never been priced, for the same reason the water, the
         * cloud deck and the forest each went unpriced until their own Wave 0: nothing in the
         * tree could switch it off, and ADR-0016 says an unmeasured cost cannot fund a package.
         * The ground cannot use the `no-water` shape (never built) — the clipmap IS the world,
         * so removing it would remove the station's content and measure a different scene while
         * the content-match guard still passed. So this takes the cloud DECK's asymmetric
         * shape, moved to the fragment stage: identical geometry, identical positionNode,
         * identical draws and triangles by construction, with only the disputed part withheld.
         *
         * What it withholds is exactly what an overhaul spends against — the detail bump
         * octaves, the atlas fetch, the biome mixes, curvature, strata, the caustic web and
         * the two-model shadow — leaving a constant albedo under the baked sun. Recorded
         * caveat, same as the deck's: pipeline compile stays on both sides, so the number is a
         * floor, not a ceiling.
         */
        const flatNdl = max(dot(baseNormal, uSunDir), 0);
        groundColour = vec3(0.42, 0.41, 0.38)
            .mul(uSunColour.mul(flatNdl.mul(sunVis).mul(0.92).add(0.06)));
    } else {
        /**
         * ONE bump octave, not two — the overhaul's own de-duplication.
         *
         * The 7.5 u octave existed because the 26 u one alone left the near field smooth, and
         * before this wave there was nothing else in the graph to fill that band. The atlas
         * now does: it tiles every 22 u with marks down to ~2 u, per material, mean-transparent.
         * Two systems describing the same frequencies is a second owner, and on this lane it is
         * a second owner with a price — the fetch is paid on every ground fragment in the frame.
         * MEASURED: dropping it is where a third of the overhaul's cost came back.
         */
        const detailScales = [{ world: 26, amp: 0.34 }].slice(0, q.detailScales);
        let bump = vec2(0, 0);
        detailScales.forEach(({ world: wl, amp }) => {
            const gate = float(1).sub(smoothstep(float(wl / 6), float(wl / 1.5), footprint));
            bump = bump.add(texture(detailTex, positionWorld.xz.div(wl)).rg.mul(amp).mul(gate));
        });
        // Curvature, on the same weight ramp as the relief it was baked from, so it fades out
        // with the detail rather than surviving as shading over a lattice too coarse to show it.
        const curvature = clamp(aux.a.mul(vWeight).mul(9.0), -1, 1);
        const gully = max(curvature, 0);
        const crest = max(curvature.negate(), 0);
        const flatness = clamp(baseNormal.y, 0, 1);
        const normal = normalize(baseNormal.add(vec3(bump.x, 0, bump.y).mul(flatness.mul(0.42))));

        const height = positionWorld.y;
        // Biome follows the LANDFORM; only lighting sees the grain. Driving both from the
        // detailed normal makes grass and rock track the surface noise, which reads as
        // camouflage blotching.
        const slope = clamp(float(1).sub(baseNormal.y), 0, 1);
        const detailGate = float(1).sub(smoothstep(float(1.2), float(9), footprint))
            .mul(float(1).sub(smoothstep(float(2), float(6), vSpacing)));

        /**
         * THE ATLAS (Wave 2) — one fetch, four material mesostructures, mean-transparent.
         *
         * `tile / avg` is the Wolfire division The Witness adopted for exactly this problem:
         * the mean of the ratio is 1 by construction, so tiled detail can add texture to the
         * painted colour and can never shift it. Everything below that reads the atlas reads
         * it through that ratio — including the boundary breakup, so even the material borders
         * are drawn by the same field that draws the grain.
         */
        const atlas = texture(groundTex, positionWorld.xz.div(float(GROUND_ATLAS_WORLD))).toVar();
        // DISTANCE DISCIPLINE (rule 7). "From far away, the grain melts away and the structure
        // is mostly a solid color, accented by lighting." The melt is a look requirement first;
        // that it also caps the atlas's bandwidth to the near field is the bonus.
        const detailMelt = float(1)
            .sub(smoothstep(float(GROUND_MELT[0]), float(GROUND_MELT[1]), footprint)).toVar();
        const tooth = atlas.a.div(float(atlasAvg[3])).toVar();
        // Signed and mean-zero, so a boundary it perturbs wanders without drifting.
        const edgeBreak = tooth.sub(1).toVar();

        /**
         * BIOME WEIGHTS, with AUTHORED BOUNDARIES rather than cross-fades.
         *
         * The playdough tell named by every reference read is `smoothstep(height)` producing a
         * soft gradient smear between materials; real turf gives way to sand in lobed, wandering
         * shapes with a semi-crisp edge, and biome A appears as discrete islands inside B near
         * the border (the ecotone the Witness's landscape architects describe as "one or two
         * dominant species from one landscape… overlapping another"). Perturbing each driver by
         * the atlas produces both at once, for zero extra fetches.
         *
         * The swing stays SMALLER than the band it perturbs — the dissolve law this repo paid
         * for once already: a band narrower than its own noise swing tears into confetti.
         */
        // The beach is a BAND, not a region. Measured on the first captures: with the shipped
        // 24 u height ramp the whole shoreline plain came out half sand, which is why darkening
        // the grass palette by 38% moved that plain's screen luma by 1.6% — it was barely grass.
        // 11 u of height on this shore is a beach a person could walk across; the swing stays
        // under the band width, per the dissolve law.
        const wSand = float(1).sub(smoothstep(
            float(ODYSSEY_SEA_LEVEL - 2),
            float(ODYSSEY_SEA_LEVEL + 11),
            height.add(edgeBreak.mul(4)),
        ));
        // ALPINE SURFACE LANGUAGE (Ch4 port). The peaks survive suppression as terms in the
        // height field, so the camera stares at them for all of Ch4 — but a generic biome ramp
        // gives them a CLEAN HORIZONTAL snow band, which reads as a contour line on a map rather
        // than a mountain. mountain-language.js broke that band with FBM jitter and gated snow by
        // slope; both port directly here, the jitter riding a low-frequency read of the detail
        // texture (one fetch) instead of procedural noise. The band is also tightened 620..790 ->
        // 620..730 now that the jitter, not the ramp width, is what softens the boundary.
        const snowJitter = texture(detailTex, positionWorld.xz.mul(0.0016)).b.sub(0.5).mul(92);
        const snowHeight = height.add(snowJitter).add(edgeBreak.mul(9)).toVar();
        /**
         * SNOW, MINUS THE RIBS. The summit read as a sand dune in the ascent capture, and the
         * diagnosis was not the rock palette at all — measured, the pale cone screens at
         * norm .351/.335/.314, which is the SNOW pole. It is a smooth, bright, near-uniform
         * cone, and a heightfield cannot give it silhouette the way a sculpted peak would.
         *
         * What a real snowy peak has, and what the reference massif shows on its own ridges, is
         * ROCK BREAKING THROUGH where the form is convex: wind strips the ribs and fills the
         * hollows. `crest` is exactly that convexity and is already computed for the cavity
         * term, so this costs one multiply and turns a blank cone into a ribbed one.
         */
        const wSnow = smoothstep(float(620), float(730), snowHeight)
            .mul(float(1).sub(smoothstep(float(0.42), float(0.70), slope)))
            .mul(float(1).sub(crest.mul(float(GROUND_SNOW_CREST_STRIP))));
        const wRock = clamp(max(
            smoothstep(float(0.17), float(0.40), slope.add(edgeBreak.mul(0.035))),
            smoothstep(float(470), float(640), snowHeight).mul(0.75),
        ).add(crest.mul(uRidgeRock).mul(detailGate)), 0, 1);

        /**
         * The four weights, made EXPLICIT. Algebraically identical to the sequential `mix`
         * chain that shipped before — snow over rock over sand over grass — but addressable,
         * which is what lets the paint, the mesostructure, the strata and the two shadow
         * models all read the same numbers instead of each re-deriving its own opinion about
         * what material a fragment is.
         */
        const kSnow = wSnow.toVar();
        const kRock = wRock.mul(float(1).sub(kSnow)).toVar();
        const kSand = wSand.mul(float(1).sub(wRock)).mul(float(1).sub(kSnow)).toVar();
        const kGrass = clamp(float(1).sub(kSnow).sub(kRock).sub(kSand), 0, 1).toVar();

        /**
         * MOISTURE picks the point on each material's two-pole axis. The baked field carries
         * the landscape logic (hollows collect, low ground is damp, the shore wets its margin,
         * sun-facing slopes dry out); the WET BAND is the one term the bake cannot know,
         * because it is a function of the drawn waterline rather than of the height field —
         * ref3's waterline sand measures 0.7x the dry hill above it, and ref2's wet rock 0.5x.
         * `max`, not a sum: the two are alternative sources of the same wetness, so one owner
         * wins rather than both adding.
         */
        const wetBand = smoothstep(float(ODYSSEY_SEA_LEVEL + 11), float(ODYSSEY_SEA_LEVEL + 0.5), height);
        const moist = clamp(max(plate.b, wetBand.mul(0.94)), 0, 1).toVar();
        // SHAPED, not linear. A linear read put the whole shoreline plain on the golden pole,
        // because the midpoint of a two-pole lerp is already half-way to gold and the midpoint
        // is where most of the island sits. Ref1's lawn is GREEN with golden patches — so green
        // is the default and gold arrives only where the field says the ground is truly dry.
        const dryness = smoothstep(
            float(ODYSSEY_GROUND_DRYNESS[0]),
            float(ODYSSEY_GROUND_DRYNESS[1]),
            moist,
        ).toVar();
        const poles = (mat) => mix(
            vec3(...ODYSSEY_GROUND_PALETTE[mat].damp),
            vec3(...ODYSSEY_GROUND_PALETTE[mat].dry),
            dryness.mul(float(ODYSSEY_GROUND_MOISTURE[mat])),
        );
        let albedo = poles('grass').mul(kGrass)
            .add(poles('sand').mul(kSand))
            .add(poles('rock').mul(kRock))
            .add(poles('snow').mul(kSnow));

        // REGIONAL PERSONALITY. The Witness gave each area of the island its own palette and
        // interpolated the light colour as the player walked between them; this is the cheap
        // scalar version of that. Neither pole brightens blue — the cool end pulls RED down
        // instead, which is the same relative shift without lifting a channel.
        albedo = albedo.mul(mix(vec3(...GROUND_ZONE_COOL), vec3(...GROUND_ZONE_WARM), zone));

        /**
         * MESOSTRUCTURE, per material and at the measured AMOUNT.
         *
         * The grammar differs by family, which is the whole point of a four-channel atlas —
         * and so does the amplitude, which the bar states in deciles: Firewatch grass
         * alternates 2.5-3x inside a single patch (dark base, light tips), while paths and
         * sand hills hold +-5..12 luma and show no gravel noise anywhere in either reference
         * game. A single global grain amount cannot be right for both, so it is a weighted sum
         * of four authored amounts. The `mix(1, ratio, t)` form keeps the Wolfire mean of 1 at
         * every distance, so melting the detail away cannot brighten or darken the island.
         */
        const toothMat = atlas.r.div(float(atlasAvg[0])).mul(kGrass)
            .add(atlas.g.div(float(atlasAvg[1])).mul(kRock))
            .add(atlas.b.div(float(atlasAvg[2])).mul(kSand))
            .add(tooth.mul(kSnow));
        const toothAmt = float(GROUND_TOOTH.grass).mul(kGrass)
            .add(float(GROUND_TOOTH.rock).mul(kRock))
            .add(float(GROUND_TOOTH.sand).mul(kSand))
            .add(float(GROUND_TOOTH.snow).mul(kSnow));
        albedo = albedo.mul(mix(float(1), toothMat, detailMelt.mul(toothAmt)));

        /**
         * THE CONTACT BAND. Ghibli paints a darker, WARMER lip where grass meets a path or a
         * beach — grass roots darken at contacts, and the edge is a painted occlusion band
         * rather than a gradient. The product of two weights peaks exactly at the boundary and
         * is zero in both interiors, so this needs no mask of its own.
         */
        const contact = clamp(kGrass.mul(kSand.add(kRock)).mul(4), 0, 1);
        albedo = albedo.mul(mix(vec3(1), vec3(...GROUND_EDGE_TINT), contact.mul(GROUND_EDGE_AMT).mul(detailGate)));

        /**
         * WIND, at no cost. The Ghibli meadow signature is lighter stroke bands sweeping across
         * a slope; the forest's travelling gust line proved the mechanism here — a static field
         * plus a time-varying PHASE, so motion is a sine and not a second texture.
         */
        const gust = sin(uTime.mul(0.32).add(positionWorld.x.mul(0.0016)).add(positionWorld.z.mul(0.0011)));
        const sweep = smoothstep(float(0.30), float(0.92), tooth.mul(0.52).add(gust.mul(0.5).add(0.5).mul(0.48)));
        albedo = albedo.mul(sweep.mul(kGrass).mul(detailMelt).mul(GROUND_WIND_LIFT).add(1));

        /**
         * STRATA (Wave 3) — rock's shape language, shaded because a heightfield cannot sculpt it.
         *
         * The bar is numeric: a captured cliff face steps 132->203, 128->221, 122->218 in its
         * deciles — two or three FLAT value bands per form, not a gradient. The Witness got that
         * from hand-sculpted planes ("hard edges are not evil… faceting became a powerful tool
         * to help define the form"); we get it from quantised world height, warped by the atlas
         * so the strata wobble like sediment instead of drawing a contour map, and hashed per
         * band so adjacent slabs differ in value AND temperature (brighter bands run warmer —
         * the "top light, front mid, undercut dark" the reference ledges show).
         *
         * Its own distance gate, deliberately looser than `detailGate`: strata are a landform
         * feature and must survive to the far massif, where the micro bump must not.
         */
        const strataFade = float(1).sub(smoothstep(float(6), float(18), footprint));
        const strataAmt = smoothstep(
            float(ODYSSEY_GROUND_STRATA.slope[0]),
            float(ODYSSEY_GROUND_STRATA.slope[1]),
            slope,
        ).mul(kRock).mul(strataFade);
        const strataCell = height.add(edgeBreak.mul(float(ODYSSEY_GROUND_STRATA.warp)))
            .div(float(ODYSSEY_GROUND_STRATA.band));
        const bandStep = fract(floor(strataCell).mul(0.1731).add(zone.mul(0.37))).sub(0.5)
            .mul(float(ODYSSEY_GROUND_STRATA.step)).mul(strataAmt);
        albedo = albedo.mul(vec3(
            bandStep.mul(1.25).add(1),
            bandStep.add(1),
            bandStep.mul(0.7).add(1),
        ));

        // (Far pre-desaturation lived here. It measured NEGATIVE twice and is retired — see the
        // palette's `presat` note. Distance discipline is owned by the detail melt above and by
        // aerial perspective below, both of which measured positive.)

        /**
         * CAUSTICS on the submerged shelf — ported from Ch2 (deep-ocean.tsl.js
         * causticProjection), and RE-CUT (Wave 4) to obey this file's own header law.
         *
         * It shipped as two `snoise3` evaluations per fragment: the only procedural noise left
         * in the graph, paid on every land pixel in the frame to light a shelf most frames
         * cannot see. "Detail comes from a TILED TEXTURE, not procedural noise: ~1 ALU against
         * ~100, worth 6.5 ms" — so the two noises become ONE scrolled fetch, and the second
         * decorrelated field comes from a different channel of the same fetch. The shape is
         * preserved exactly where it matters: min(), not add(), because summed fields regress
         * toward the mean and pow() them into soft blobs, while the MINIMUM of two fields is
         * bright only where both are, which is what draws the sharp intersecting veins a caustic
         * web actually has. The threshold breathes on a sine so a rigidly translating tile does
         * not read as a sliding decal.
         *
         * The `.a` channel is the cloud silhouette, histogram-matched to a narrow 0.42..0.70
         * band, so it is stretched back to full range before the minimum — an unstretched
         * narrow field would win every min() and flatten the web.
         */
        const causticUv = positionWorld.xz.mul(0.055).add(vec2(uTime.mul(0.004), uTime.mul(-0.003)));
        const causticTex = texture(detailTex, causticUv);
        const causticWeb = min(causticTex.b, clamp(causticTex.a.sub(0.42).mul(3.57), 0, 1));
        const caustic = smoothstep(float(ODYSSEY_SEA_LEVEL), float(ODYSSEY_SEA_LEVEL - 7), height)
            .mul(smoothstep(sin(uTime.mul(0.7)).mul(0.04).add(0.52), float(0.80), causticWeb))
            // Projected surface light cannot paint a cliff wall or the underside of a ledge.
            .mul(clamp(normal.y, 0, 1))
            .toVar();

        /**
         * THE TWO SHADOW MODELS (G1) — the bar's most load-bearing measurement, and the ground
         * twin of the forest's foliage-shade law.
         *
         * Vegetation, soil and sand keep chromaticity and saturation EXACTLY and lose only
         * value (ref2's leaf ground: sat 0.76 lit, 0.74 shaded, identical norms, luma x0.57);
         * rock instead DESATURATES toward neutral (ref2's ledge 0.33 -> 0.06). Desaturating a
         * warm colour raises its relative blue on its own, so `desat` OWNS the measured hue
         * shift and no blue tint is added anywhere — the one-owner law. Snow is the documented
         * exception: it takes mountain-language's ice-blue shadow, authored luma-neutral so it
         * shifts hue without also claiming a second share of the value drop.
         *
         * Every colour term below is luma-preserving BY CONSTRUCTION, so the measured shade:lit
         * RATIO is produced in exactly one place — `value`.
         */
        const ndl = max(dot(normal, uSunDir), 0);
        // Lambert, S-shaped. The shoulders group the terminator into masses (the Ghibli law);
        // the middle keeps the mid-tones a rolling landform needs. See the palette's terminator
        // note for the two remaps that tried to replace Lambert and measured worse than it.
        const lightAmt = smoothstep(
            float(ODYSSEY_GROUND_SHADE.terminator[0]),
            float(ODYSSEY_GROUND_SHADE.terminator[1]),
            clamp(ndl.mul(sunVis), 0, 1),
        ).toVar();
        const albLuma = dot(albedo, vec3(...ODYSSEY_GROUND_LUMA)).toVar();
        const mineralW = clamp(kRock.add(kSnow), 0, 1).toVar();
        const shadeChroma = mix(albedo, vec3(albLuma), mineralW.mul(float(ODYSSEY_GROUND_SHADE.mineral.desat)));
        const shadeIce = mix(shadeChroma, albLuma.mul(vec3(...GROUND_SNOW_SHADE)), kSnow.mul(0.8));
        const shadeCol = shadeIce.mul(mix(vec3(...ODYSSEY_GROUND_SHADE.deepTint), vec3(1), lightAmt));
        const surface = mix(shadeCol, albedo, lightAmt);

        // Cavity occlusion: the baked plate's AO already knows what the landform shadows, but it
        // is baked at a radius that cannot see a gully. This is the small-scale half of the same
        // term, and the split is by RADIUS so neither owns the other's job.
        const cavity = clamp(float(1).sub(gully.mul(uCavity).mul(detailGate)), 0.62, 1.0);
        // THE AMBIENT owns the floor — the one thing Lambert cannot supply and the one thing the
        // shipped graph had wrong (0.06 against the references' 0.27-0.32). It is per-material
        // (rock takes less sky than a meadow does) and deepens where the baked occlusion says
        // the sky cannot see in, which is how a hollow in shadow reaches the measured deep band
        // without a second darkening term fighting the first.
        const openness = smoothstep(float(GROUND_AO_FLOOR), float(1), wideAo);
        const ambient = mix(
            float(ODYSSEY_GROUND_SHADE.deepAmbient),
            mix(
                float(ODYSSEY_GROUND_SHADE.vegetation.ambient),
                float(ODYSSEY_GROUND_SHADE.mineral.ambient),
                mineralW,
            ),
            openness,
        ).toVar();
        const value = ambient.add(float(1).sub(ambient).mul(lightAmt)).mul(float(GROUND_LIT_GAIN));
        // The journey's ambient still reaches the ground — the colour script drives it — but
        // NORMALISED to luma 1 and pulled most of the way to neutral first, because a saturated
        // cool fill light is precisely what the measurement refutes for vegetation shade.
        const ambientHue = uShadowTint.div(max(dot(uShadowTint, vec3(...ODYSSEY_GROUND_LUMA)), 0.001));
        const lightCol = mix(
            mix(vec3(1), ambientHue, float(GROUND_AMBIENT_CHROMA)),
            uSunColour,
            lightAmt,
        );
        // Rim: unlit-compatible fake translucency on snow only, cool and weak.
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const rim = float(1).sub(abs(dot(normal, viewDir))).pow(4)
            .mul(kSnow)
            .mul(0.14);
        // NOTE the wide occlusion is NOT multiplied in here. It reaches the image through
        // `ambient` above, which is the one-owner form: occlusion darkens the part of the light
        // that occlusion actually blocks (the sky fill) and leaves direct sun alone. Multiplying
        // it over the whole result as well drove a hollow in shadow to 0.195 against the
        // measured 0.27-0.32 band, and dimmed sunlit hollows that the sun plainly reaches.
        groundColour = surface.mul(lightCol).mul(value).mul(cavity)
            .add(vec3(0.55, 0.85, 0.90).mul(caustic).mul(sunVis.mul(0.7).add(0.3)).mul(0.5))
            // ALPENGLOW: high snow that faces the sun takes a warm kiss, riding the same kSnow
            // the albedo uses so it can never bleed onto rock or meadow, and multiplied by the
            // baked sun visibility so a shadowed crown stays cold.
            .add(uSunColour.mul(vec3(1.0, 0.72, 0.52))
                .mul(kSnow.mul(ndl.pow(1.6)).mul(sunVis).mul(0.30)))
            .add(vec3(0.72, 0.82, 0.95).mul(rim));
    }
    // ── THE DEPARTURE FADE (Act II -> Space, Wave 1B) ────────────────────────────
    // The One World used to LEAVE BY BOOLEAN. `isWorldVisibleAtProgress` writes `.visible`
    // and nothing else, so at actEnd + 0.03 the ground, water, cloud deck, forest and
    // god-rays all stopped existing between two frames — a measured -89 luma step, 74% of
    // the seam's whole brightness change landing in its last fifth. The mountain vanishing
    // in front of the camera is that flag, seen on the biggest object in the frame.
    //
    // This recedes it instead. Note what it fades: COLOUR, not alpha. Every world material
    // is an unlit MeshBasicNodeMaterial with hand-authored colour, so pulling that colour
    // toward the sky is (a) exactly what distance does — this module already has
    // `applyAerial` for the same reason — and (b) free of every cost that fading alpha
    // would bring: nothing leaves the opaque queue, no render order changes, no blend
    // state appears, and the `opacityNode`-is-a-dead-write trap never comes up.
    //
    // At uWorldFade = 0 this is a bit-for-bit no-op, so the whole of Act II is untouched.
    // The binary gate STAYS exactly as it is: it remains the correctness backstop that
    // stops Act II painting over chapters that own their own frame (Earth Core's magma
    // cathedral was the proof case). It simply no longer has anything visible left to hide.
    const uWorldFade = uniform(0);
    const uWorldFadeColour = uniform(new THREE.Color(0x09283f));
    // ── ATMOSPHERIC THINNING (Wave 3 / F3) — consumed only by the cloud FIELD. ──────
    // 0 = full cumulus form; toward 1 the paint collapses into a flat haze family and
    // each mass shrinks toward its own centre (see the field material). Driven by the
    // board from `worldAtmosphericThin` in odyssey-world-act-gate.js — the schedule
    // lives beside the departure fade because the two are halves of one departure.
    const uWorldThin = uniform(0);
    const toOutput = (c) => {
        const scaled = (applyExposure ? c.mul(uExposure) : c).mul(uOutputScale);
        const graded = mix(vec3(dot(scaled, vec3(0.2126, 0.7152, 0.0722))), scaled, uOutputSat);
        return mix(graded, uWorldFadeColour, uWorldFade);
    };
    groundMat.colorNode = toOutput(applyAerial(groundColour, positionWorld, AERIAL_CEIL_LAND, AERIAL_RATE_LAND));

    const groundMesh = new THREE.Mesh(ground.geometry, groundMat);
    groundMesh.frustumCulled = false;
    groundMesh.matrixAutoUpdate = false;
    groundMesh.updateMatrix();
    groundMesh.name = 'odyssey-world-ground';
    group.add(groundMesh);

    // ── sky ──
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const skyDir = normalize(positionWorld.sub(cameraPosition));
    const skyAir = skyColourFor(skyDir.y)
        .add(vec3(1, 0.86, 0.66).mul(
            smoothstep(float(0.90), float(1), dot(skyDir, uSunDir)).pow(3).mul(0.3),
        ))
        .add(vec3(1, 0.97, 0.9).mul(
            smoothstep(float(0.9985), float(0.9995), dot(skyDir, uSunDir)).mul(2.2),
        ));
    // ONE COLOUR AT INFINITY. The seabed fades toward the deep plate while this dome sat
    // 6-11x brighter behind it, so the horizon carried a hard bright/dark seam that no amount
    // of fog tuning could hide. The dome now converges on the SAME deep plate the aerial
    // perspective converges on (uWaterDeep), and the bright lift is a DOWNWELLING cone,
    // pow-concentrated overhead, not a hemisphere-wide wash: surface light survives looking
    // UP, not sideways. Capture-measured at p=0.130 (camera pitched up the rail), the flat
    // hemisphere handed 90% of the frame's pixels one luma band; the cone is what puts a
    // dark-to-light gradient inside the up-pitched frame the ascent actually shows.
    const downwelling = clamp(skyDir.y, 0, 1).pow(2.2)
        .add(smoothstep(float(-0.15), float(0.35), skyDir.y).mul(0.22));
    const skyWater = mix(
        mix(uWaterMid, uWaterDeep, uEyeDepth),
        mix(uWaterMid, skyColourSubmergedGraze.mul(0.42), float(0.35)),
        clamp(downwelling, 0, 1),
    );
    skyMat.colorNode = toOutput(mix(skyAir, skyWater, uSubmerged));
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    // The dome must sit INSIDE the camera's far plane. Sized off `reach` it lands at 22,000:
    // fine for the playground's 30,000 far plane, and entirely CLIPPED by the game's 9,000 —
    // where the shipped r=4000 atmosphere backstop fills in and the world's own sky, colour
    // script and all, is never seen. Callers with a tighter frustum pass their own radius.
    const domeRadius = Number.isFinite(skyRadius) ? skyRadius : Math.min(ground.reach * 1.7, 22000);
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(domeRadius, 32, 20), skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -100;
    skyMesh.name = 'odyssey-world-sky';
    group.add(skyMesh);

    // ── water ──
    const w = clipmapXZ(waterSpacing, 16);
    const waterMat = new THREE.MeshBasicNodeMaterial();
    // ── THE SWELL (Ghibli-water Wave 2) ──────────────────────────────────────────────
    // Was ONE separable sine product, amplitude 0.55 u over 483-628 u wavelengths: a maximum
    // surface slope of 0.007 rad, i.e. a flat sheet from every camera in the journey. Worse,
    // the shading normal was built from the wave's VALUE rather than its GRADIENT (max tilt
    // +-0.0275), so light never responded and the sea could not move even in shading.
    //
    // Now a 3-wave directional sum with ANALYTIC normals. Constraints that set the numbers:
    // the water clipmap is 6.4 u/cell, so the finest representable wavelength is ~13 u — every
    // wavelength here is far above that floor (110/62/37 u) and the fine detail that cannot be
    // geometry lives in the ripple normal below. Vertical displacement only: this is a MORPHING
    // clipmap, and horizontal (Gerstner Q) displacement would tear the seams between LOD rings.
    // Crest SHARPNESS is therefore bought in the fragment stage (the whitecap threshold), which
    // is where a painted look wants it anyway.
    const WAVES = [
        {
            dirX: 0.94, dirZ: 0.34, len: 54, amp: 1.30, speed: 0.85,
        },
        {
            dirX: 0.20, dirZ: -0.98, len: 31, amp: 0.72, speed: 1.15,
        },
        {
            dirX: -0.72, dirZ: 0.69, len: 19, amp: 0.34, speed: 1.55,
        },
    ];
    // Wavelengths halved from the first cut (110/62/37 m): at the shoreline station the sea
    // spans ~300 m, so a 110 m dominant wave put only two or three crests in the entire frame
    // and the foam read as isolated patches rather than a running sea. 54/31/19 m keeps every
    // wave clear of the 13 m geometric floor while roughly doubling the crest count in view.
    /** Summed amplitude — the normaliser the whitecap threshold is expressed against. */
    const WAVE_AMP_SUM = 2.36;
    // Shallow-water taper: waves must not saw through the beach. The bed comes from the same
    // macro bake the fragment stage uses; a vertex-stage fetch REQUIRES .level(0) (WGSL forbids
    // implicit-derivative sampling outside the fragment stage — this file's own header note).
    const wVertUv = w.worldXZ.div(float(RELIEF_EXTENT)).add(0.5);
    const wVertBed = texture(macroTex, wVertUv).level(0);
    const wVertDepth = float(ODYSSEY_SEA_LEVEL).sub(wVertBed.r).toVar();
    const wSwellFade = clamp(wVertDepth.div(9), 0, 1).toVar();
    // ONE definition of the wave field, evaluated in BOTH stages. It must be re-evaluated per
    // FRAGMENT rather than interpolated from the vertices: this clipmap's cells double every
    // ring, so past ring 0 a cell is tens to hundreds of metres wide and linear interpolation
    // erases a 110 m wave completely — the first cut carried height/slope as varyings and the
    // whitecaps came out as round blobs of pure noise on a surface with no wave data left in
    // it. Displacement stays in the vertex stage (it is geometry); everything the LOOK depends
    // on — normal, glint, whitecaps — is computed here, where every pixel gets the real wave.
    // `ampScale(wv)` lets the two stages disagree about AMPLITUDE while sharing one phase
    // definition — the vertex stage must fade waves its lattice cannot sample (below), the
    // fragment stage keeps them all.
    const waveField = (xz, ampScale = () => float(1)) => {
        let h = float(0);
        let dx = float(0);
        let dz = float(0);
        WAVES.forEach((wv) => {
            const k = (Math.PI * 2) / wv.len;
            const phase = xz.x.mul(wv.dirX * k)
                .add(xz.y.mul(wv.dirZ * k))
                .add(uTime.mul(wv.speed));
            const a = ampScale(wv).mul(wv.amp);
            h = h.add(sin(phase).mul(a));
            // d/dx and d/dz of the same sum — the gradient the old normal never had.
            dx = dx.add(cos(phase).mul(a.mul(k * wv.dirX)));
            dz = dz.add(cos(phase).mul(a.mul(k * wv.dirZ)));
        });
        return { h, dx, dz };
    };
    // PER-WAVE CAMERA-DISTANCE ENVELOPES, IDENTICAL IN BOTH STAGES (second fix; the first
    // was wrong and the user caught it twice). The first fix faded amplitude by the clipmap's
    // morph-adjusted `spacing` — continuous in VALUE, but its change concentrates inside the
    // narrow morph bands at ring edges, so wave height dropped in RECTANGULAR terraces ("wave
    // squares" seen from above), and the fragment field — still full amplitude — disagreed
    // with the terraced geometry along the same rectangles. It also gutted the near field:
    // ring 0's 6.4 m cells sat inside the 19 m wave's fade window, so the smallest wave ran
    // ~60% faded everywhere and the underside lost its rolling character.
    //
    // Distance from the CAMERA is smooth and radial — no ring shapes anywhere — and each
    // wave's envelope (full inside 3.5·len, gone past 5·len) closes BEFORE its wavelength
    // becomes undersampled: the lattice reaches ~2.5 samples/cycle for a wave of length L at
    // roughly 6.4·L from the centre, and 5·L sits safely inside that. Near the camera every
    // wave is FULL amplitude again. Both stages use the same envelope, so geometry and
    // shading cannot disagree, ever, by construction.
    // 4.5L -> 6.2L, sized from the lattice itself: ring spacing at distance R is ~R/16, and
    // 2.5 samples/cycle for a wave of length L therefore fails at ~6.4L — the envelope ends
    // just inside it. The first cut used 3.5L->5L and flattened the far ceiling: the
    // reference A/B proved the underside's beloved plate-mottling is the DISPLACED
    // geometry self-occluding at glancing angles, which no normal trick can fake, so the
    // envelopes must run as wide as sampling allows and not a metre narrower.
    const waveEnvelope = (wv, distXZ) => float(1)
        .sub(smoothstep(float(wv.len * 4.5), float(wv.len * 6.2), distXZ));
    const wVertDist = length(w.worldXZ.sub(cameraPosition.xz)).toVar();
    const swellVert = waveField(w.worldXZ, (wv) => waveEnvelope(wv, wVertDist));
    const swell = swellVert.h.mul(wSwellFade).toVar();
    waterMat.positionNode = vec3(w.worldXZ.x, float(ODYSSEY_SEA_LEVEL).add(swell), w.worldXZ.y);
    const wUv = varying(w.worldXZ.div(float(RELIEF_EXTENT)).add(0.5), 'vWUv');
    // The other two clipmap-derived quantities the fragment stage needs, carried ACROSS the
    // stage boundary explicitly rather than recomputed (same reason as `wUv` above and the
    // cloud deck's cUvA/B/C — see the block at `rippleA`).
    //
    // `vSwell` is the DISPLACED HEIGHT the vertex stage actually applied. Interpolating it is
    // not the "varyings are destroyed by ring-doubling" trap that forced the wave FIELD into
    // the fragment stage: that trap is about the full-amplitude field, whose long waves a
    // coarse ring cannot carry. This one is enveloped per wave precisely so the lattice can
    // always sample it, so its linear interpolation IS the rendered triangle — which is what
    // crest lighting must agree with. (Re-evaluating it per fragment, as this did, sampled the
    // staircased `w.worldXZ` AND a staircased `wVertDist`, so the crest term terraced twice.)
    const vSwell = varying(swell, 'vSwell');
    const vSwellFade = varying(wSwellFade, 'vSwellFade');
    // Bed height from the macro BAKE — the analytic fold in a fragment-referenced varying was
    // the single largest cause of the minutes-long first compile (see bakeMacroTexture).
    const bedTex = texture(macroTex, wUv);
    const depth = float(ODYSSEY_SEA_LEVEL)
        .sub(bedTex.r.add(texture(heightTex, wUv).r.mul(bedTex.g))).toVar();
    // ── THE PAINTED SEA (Ghibli-water Wave 1) ────────────────────────────────────────
    // Was: two smooth mixes over hardcoded vec3s with band edges at 0-18 m and 18-103 m.
    // MEASURED problem: the median visible bed depth is 49.6 m at the shoreline station and
    // 133 m just past the breach, so both of the journey's largest water views sat inside
    // that ramp's flat upper region — one colour, no structure, exactly the "flat steel-blue
    // sheet" the capture critique found. Now: a Beer-Lambert depth driver tuned so the
    // measured range spans the whole ramp, quantised into flat plates, over the four-stop
    // pigment ramp the colour script owns (viridian -> cerulean -> cobalt -> Prussian).
    const wShore = vec3(...ODYSSEY_WATER_RAMP.shore);
    const wShelf = vec3(...ODYSSEY_WATER_RAMP.shelf);
    const wOpen = vec3(...ODYSSEY_WATER_RAMP.open);
    const wDeep = vec3(...ODYSSEY_WATER_RAMP.deep);
    // THE NORMAL IS THE GRADIENT NOW, plus animated ripple detail (Wave 2). The old normal
    // was built from the swell's VALUE, which is not a slope at all — it tilted +-0.0275 and
    // pointed the wrong way, so fresnel and the sun glint were effectively static. The wave
    // gradient arrives as a varying; the fine chop that the 13 u geometric floor forbids as
    // geometry is added here as a normal perturbation, sampled from the ALREADY-RESIDENT
    // detail bake (rg = signed derivatives, RepeatWrapping) at two scrolling scales — the
    // never-repeating trick harvested from r181's own WaterMesh.getNoise(), at two taps
    // instead of four because this sea is stylised, not photographic.
    // NOTE the encoding: detailTex.rg are SIGNED central-difference derivatives already
    // centred on zero (bakeDetailNormal), NOT a 0..1 normal map — subtracting 0.5 from them
    // injects a large constant slope over the whole sea, which is exactly how the first cut
    // of this term turned the ocean solid white.
    // ── NEVER SAMPLE `w.worldXZ` FROM THE FRAGMENT STAGE (the "square sections", 3rd sighting) ──
    // `w.worldXZ` is the clipmap fold: `origin + mix(local, coarse, morph)`, and both `origin`
    // and `coarse` contain a `floor()`. Reading that node here does NOT reuse the vertex result
    // — r181 auto-varyings the raw `position` ATTRIBUTE and re-executes the whole chain per
    // fragment, so the `floor()` runs on INTERPOLATED grid coordinates and turns
    // piecewise-constant. Inside each ring's morph band (Chebyshev 0.70..1.0 — a SQUARE ANNULUS
    // around uLodCenter) the shading coordinate then freezes across 2-cell blocks and steps at
    // even grid lines while the geometry glides smoothly past it: axis-aligned tiles of
    // 2*spacing*2^ring — 12.8 m at 72-102 m out, 25.6 m at 143-205 m, 51.2 m at 286-410 m —
    // with the lattice's alternating quad diagonals splitting them. Since uLodCenter tracks the
    // RAIL POINT, ring 0's unmorphed core sits exactly at the breach and the tiles ring it: the
    // owner's report was "squares on the sides, not where the path comes out of the water".
    //
    // `positionWorld.xz` is the fix and costs nothing: this swell displaces VERTICALLY ONLY, so
    // the fragment's interpolated world XZ is byte-identical to the smooth clipmap coordinate —
    // just honestly interpolated, with no `floor()` downstream of the interpolator. It is also
    // already resident (`wFragDist`/`wFrag` below use it), and dropping these reads takes the
    // morph chain out of the fragment shader entirely.
    const rippleA = texture(detailTex, positionWorld.xz.mul(0.021).add(vec2(uTime.mul(0.010), uTime.mul(-0.014)))).rg;
    const rippleB = texture(detailTex, positionWorld.xz.mul(0.047).add(vec2(uTime.mul(-0.018), uTime.mul(0.008)))).rg;
    const ripple = rippleA.mul(0.9).add(rippleB.mul(0.5)).toVar();
    // The wave field again, per fragment, from the true world position — at FULL amplitude.
    // The envelopes above are for DISPLACEMENT only: a lattice tears when asked to sample a
    // wave it cannot resolve, but shading is analytic per pixel and cannot tear, and it is
    // precisely the full-amplitude fragment normal modulating the Snell window that paints
    // the mottled light across the whole underside ceiling — the look the user named. (The
    // one-session detour that enveloped BOTH stages flattened that ceiling; reverted.) The
    // single global fade below only prevents sub-pixel shimmer at the horizon, where the
    // dissolve owns the frame anyway.
    const wFragDist = length(positionWorld.xz.sub(cameraPosition.xz)).toVar();
    const wFragFade = clamp(float(1).sub(wFragDist.div(520)), 0, 1).mul(vSwellFade).toVar();
    const wFrag = waveField(positionWorld.xz);
    const waveH = wFrag.h.mul(wFragFade).toVar();
    const waveSlope = vec2(wFrag.dx, wFrag.dz).mul(wFragFade).toVar();
    const wSlope = waveSlope.add(ripple.mul(vSwellFade)).toVar();
    const wN = normalize(vec3(wSlope.x.negate(), 1, wSlope.y.negate())).toVar();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const spec = smoothstep(float(0.9955), float(0.9995), dot(normalize(uSunDir.add(viewDir)), wN)).mul(0.9);
    const grazing = float(1).sub(clamp(abs(dot(wN, viewDir)), 0, 1));
    // WAVE 5 — the MENISCUS: while the eye is within ~3 u of the plane, the extreme-grazing
    // sliver of the surface lights as a thin bright line — the crossing cue that makes the
    // breach one event instead of a fade. Rides `grazing`, so it IS the waterline.
    const meniscus = smoothstep(float(0.93), float(0.995), grazing).mul(uBreachNear).mul(0.9);
    // ── THE REGIME BRANCH (MEASURED, and it pays for the whole Ghibli package) ────────
    // The cold-machine sweep priced waves 1+2 at +2.36 ms on the deep station — OVER its
    // 14.2 max — and the tell is that both hot stations are UNDERWATER frames: every
    // submerged pixel was paying for the full topside stack (quantised ramp, fresnel, sun
    // glint, whitecaps with their noise, horizon dissolve, shore band) and then discarding
    // it in the final mix, because a multiply-by-uniform is not dead code (this repo's
    // logged lesson). uSubmerged is a UNIFORM the CPU writes each frame, so `If` on it is
    // uniform control flow — the GPU skips the untaken side coherently, no divergence.
    // Both branches only run inside the 14 u breach transition band (~1% of the journey).
    // Shared prerequisites (wave field, ripple normal, spec, grazing) are defined above
    // because BOTH regimes read them — but they must also be BUILT below, at the branch
    // root, or the branch that runs second reads zeros. See the root-pin block.
    const waterShaded = Fn(() => {
        // ── ROOT-PIN THE SHARED TERMS (the "flat ceiling / clear sea" regression) ──
        // r181's WGSL builder hoists var DECLARATIONS to function scope but emits each
        // ASSIGNMENT at the node's first build site. These terms were first built inside
        // the TOPSIDE If, so on submerged frames (topside skipped) the underside read
        // ZERO-initialised depth/wN/spec/grazing: the Snell window collapsed to uniform
        // tirBody and opacityNode's depth read 0 (a semi-clear sea). A bare .toVar() here
        // runs toStack() at creation on the Fn's root stack, so each line below is a real
        // root statement that pins the assignment before either branch. Proven by the
        // always-true-conditions probe: identical formulas, branches forced on, and the
        // ceiling came back — the regime If was starving the untaken branch's inputs.
        depth.toVar('wRootDepth');
        wN.toVar('wRootN');
        spec.toVar('wRootSpec');
        grazing.toVar('wRootGrazing');
        const col = vec3(0).toVar('waterRegimeCol');
        If(uSubmerged.lessThan(0.999), () => {
            // ── TOPSIDE: the painted sea (Wave 1) + whitecaps (Wave 2) ──
            // exp2 absorption, not a linear lerp: near-shore metres get the resolution
            // they need while the deep saturates instead of clipping.
            const wT = clamp(
                float(1).sub(exp2(depth.mul(-ODYSSEY_WATER_RAMP.absorptionPerMetre))),
                0,
                1,
            ).toVar();
            // QUANTISE into flat plates with an anti-aliased edge. A hard floor()
            // posterise aliases badly at 720p on a surface this size.
            const bands = float(ODYSSEY_WATER_RAMP.bands);
            const wCell = wT.mul(bands).toVar();
            const wStep = floor(wCell).add(smoothstep(float(0.45), float(0.55), fract(wCell)))
                .div(bands)
                .toVar();
            const wSeg = wStep.mul(3).toVar();
            const body = mix(
                mix(
                    mix(wShore, wShelf, clamp(wSeg, 0, 1)),
                    wOpen,
                    clamp(wSeg.sub(1), 0, 1),
                ),
                wDeep,
                clamp(wSeg.sub(2), 0, 1),
            );
            // FRESNEL TWO-TONE, then the sun glint over the baked sun visibility. Ghibli
            // water is not a mirror: the sky arrives as a colour wash, never an image.
            const fb = float(1).sub(max(dot(wN, viewDir), 0));
            const fres = fb.mul(fb).mul(fb).mul(fb).mul(0.62);
            const wVis = texture(sunVisTex, wUv).r;
            const wl = mix(body, skyColourFor(float(0.22)), fres)
                .add(vec3(1, 0.96, 0.88).mul(spec).mul(wVis))
                .mul(wVis.mul(0.18).add(0.82))
                .toVar();
            // WHITECAPS — The Witness reference: opaque flat white with a drawn edge, so
            // this MIXES toward white in a narrow (0.06) threshold band. HEIGHT is the
            // driver (height+steepness fight each other: a sine's crest has zero slope),
            // normalised against the real summed amplitude so the threshold means what it
            // says; high-frequency noise breaks the crest lines into separate caps without
            // out-voting them.
            const crestNorm = clamp(waveH.div(WAVE_AMP_SUM), -1, 1);
            // Same world coordinate as before, taken from the fragment's own interpolated
            // position rather than the clipmap fold (see the `rippleA` block): identical cap
            // phase, minus the morph-band staircase.
            const capNoise = snoise3(vec3(
                positionWorld.x.mul(0.14),
                positionWorld.z.mul(0.14),
                uTime.mul(0.35),
            ));
            const capDrive = crestNorm.add(capNoise.mul(0.30));
            const cap = smoothstep(float(0.50), float(0.56), capDrive)
                .mul(smoothstep(float(0.4), float(2.5), depth));
            wl.assign(mix(wl, vec3(0.97, 0.99, 1.0), cap.mul(0.9)));
            // HORIZON DISSOLVE — far water converges on the sky (80% by 1.2 km, capped
            // below 1 so the boundary never becomes a hard line of its own), applied AFTER
            // the caps so far foam melts into sky instead of shimmering; then the static
            // shore brightening band (proven live by the Wave 0 GPU probe).
            const wHorizon = clamp(
                length(positionWorld.sub(cameraPosition)).mul(1 / 1200),
                0,
                1,
            ).pow(1.4).mul(0.8);
            wl.assign(mix(wl, skyColourFor(float(0.16)), wHorizon));
            wl.assign(wl.add(vec3(0.92, 0.97, 0.99).mul(
                smoothstep(float(2.6), float(0.15), depth)
                    .mul(smoothstep(float(-0.4), float(0.5), depth)).mul(0.55),
            )));
            col.assign(wl);
        });
        If(uSubmerged.greaterThan(0.001), () => {
            // ── UNDERSIDE: the luminous ceiling (Wave 5 of the seam plan, unchanged) ──
            // Crest SSS + Snell's window + TIR; the swell-perturbed normal (shared, above)
            // is what makes the window's rim ripple live.
            const crestMask = clamp(vSwell.mul(1.6).add(0.35), 0, 1);
            const sss = crestMask.mul(grazing).mul(clamp(dot(uSunDir, vec3(0, 1, 0)), 0, 1));
            const upCos = clamp(dot(viewDir.negate(), wN), 0, 1);
            const snellWindow = smoothstep(float(0.60), float(0.72), upCos);
            const windowSky = skyColourSubmergedUp.mul(1.30)
                .add(vec3(1, 0.96, 0.88).mul(spec).mul(1.2));
            const tirBody = mix(uWaterMid, uWaterDeep, uEyeDepth).mul(0.6);
            const underside = mix(tirBody, windowSky, snellWindow)
                .add(uWaterGlow.mul(sss).mul(0.55));
            col.assign(mix(col, underside, uSubmerged));
        });
        return col.add(vec3(0.95, 0.99, 1.0).mul(meniscus));
    })();
    waterMat.colorNode = toOutput(applyAerial(waterShaded, positionWorld));
    waterMat.opacityNode = clamp(smoothstep(float(-0.6), float(2.2), depth), 0, 1);
    waterMat.transparent = true;
    waterMat.depthWrite = false;
    waterMat.alphaTest = 0.004;
    waterMat.side = THREE.DoubleSide;
    // MEASUREMENT LEVER (see the `water` option): when off, the mesh is never created, so the
    // sea costs zero draws, zero vertex work, zero fill AND zero pipeline compile. The TSL
    // node objects above are plain JS until a material they feed is rendered, so building them
    // unconditionally keeps this gate a one-line diff with no dangling references.
    let waterMesh = null;
    if (water) {
        waterMesh = new THREE.Mesh(waterGeo.geometry, waterMat);
        waterMesh.frustumCulled = false;
        waterMesh.matrixAutoUpdate = false;
        waterMesh.updateMatrix();
        waterMesh.renderOrder = 1;
        waterMesh.name = 'odyssey-world-water';
        group.add(waterMesh);
    }

    // ── cloud deck ─────────────────────────────────────────────────────────────────
    // The single highest-value thing the chapters were doing that the world was not.
    // Ch3's biggest loss was its 15 cumulus banks, Ch4's was its cloud-SEA disc, Ch5's was
    // its six FBM strata — three chapters authoring three views of ONE physical layer, each
    // in its own local frame, which is the whole disease this rebuild exists to cure. Here
    // it is one deck at one altitude, and the reading changes because the RAIL CLIMBS
    // THROUGH it: cumulus overhead from the shore, strata at eye height on the ascent, a
    // sunlit sea below you from the summit. Nothing switches; the camera just moves.
    const cl = clipmapXZ(cloudSpacing, 16);
    const cloudMat = new THREE.MeshBasicNodeMaterial();

    // Billow, so the deck is a weather system and not a pane of glass. Cheap: two sines
    // against a texture lookup, all in the vertex stage.
    //
    // GATED BY COVERAGE. Run at full amplitude the billow displaces geometry that the
    // fragment stage then cuts a hole through, so every hole edge was a torn cliff a hundred
    // metres tall seen against the sky. Estimating the same coarse density here — the 0.52
    // weighted octave, the term that decides where the holes ARE — lets the surface sink back
    // to the flat deck plane exactly where it is about to become transparent. Edges dissolve
    // instead of tearing. `.level(0)` is mandatory (WGSL forbids implicit LOD in a vertex
    // stage) and the lint in odyssey-world-lints.test.js enforces it.
    const cloudDrift = uTime.mul(0.0016);
    // TWO octaves, RE-NORMALISED (cloud plan Wave 1a). The gate's whole job is to sink
    // geometry exactly where the FRAGMENT stage is about to go transparent, but it was
    // estimating that from octave A alone while the fragment sums three (A*0.52 + B*0.32 +
    // B*0.16). One octave cannot see holes the other two carve, so billowed geometry
    // survived into fragments that then discarded it — the torn-edge failure this gate
    // exists to prevent, just one octave later. Adding octave B covers 84 % of the
    // fragment sum; the weights are divided by that 0.84 so the MEAN is unchanged and the
    // 0.63/0.40 threshold calibration below still means what it says (an un-normalised
    // 0.84-weighted sum would sit systematically under the threshold and shift every gate
    // band). `.level(0)` is mandatory in the vertex stage and lint-enforced.
    const vertDensity = texture(detailTex, cl.worldXZ.mul(0.00205).add(vec2(cloudDrift, 0)))
        .level(0).a.mul(0.52 / 0.84)
        .add(texture(detailTex, cl.worldXZ.mul(0.00560).add(vec2(0.31, 0.77)).add(vec2(cloudDrift.mul(1.7), 0)))
            .level(0).a.mul(0.32 / 0.84))
        .toVar();
    const vertThreshold = mix(
        float(0.63),
        float(0.40),
        smoothstep(float(-150), float(-760), cl.worldXZ.y),
    ).toVar();
    const billowGate = smoothstep(
        vertThreshold.sub(0.16),
        vertThreshold.add(0.06),
        vertDensity,
    ).toVar();
    const billow = texture(detailTex, cl.worldXZ.mul(0.00042)).level(0).b.sub(0.5)
        .mul(165)
        .add(cl.worldXZ.x.mul(0.0016).add(uTime.mul(0.02)).sin().mul(34))
        .mul(billowGate);
    cloudMat.positionNode = vec3(cl.worldXZ.x, float(CLOUD_DECK_Y).add(billow), cl.worldXZ.y);
    // The fragment stage needs the DISPLACED height, not the deck plane, for its above/below
    // decision (see `fromAboveF`). One varying, no extra fetch.
    const vCloudY = varying(float(CLOUD_DECK_Y).add(billow), 'vCloudY');

    // Coverage is a property of the MAP, not of a chapter index. The rail runs inland and
    // upward as it climbs (z falls from the shore at +60 to the ascent at -700), so a deck
    // that thickens inland gives broken daylight cumulus over the valley and a solid sea
    // under the summit — the two things Ch3 and Ch4 each hand-authored — from one term.
    // The threshold is placed against the MEASURED distribution of the density field, not an
    // assumed one: sampled over the deck it runs p10 0.42 / p50 0.58 / p90 0.70, so a coverage
    // control expressed as "1 - cover" sat almost entirely above the field's own range and the
    // deck rendered empty. 0.63 leaves broken cumulus over the valley; 0.40 is a near-solid sea.
    // WIND STREETS (cloud plan Wave 1b). Coverage used to be a bare world-Z ramp, so at any
    // given distance inland the sky had ONE density everywhere across x — a gradient of fog
    // rather than weather. This adds a slow lateral swing so coverage opens and closes across
    // the valley. WAVELENGTH IS THE WHOLE POINT: the approach proposal specified 0.00022,
    // which is a ~28.5 km period — nearly constant over the visible deck, i.e. a no-op, and
    // the research critic caught it. 0.0018 is a ~3.5 km period, which puts two or three
    // openings across a wide view. The z term tilts the streets so they do not read as bars.
    // COVERAGE RAISED 0.63/0.40 -> 0.685/0.515 (Wave 2 exit-gate response + Witness reference).
    // TWO reasons that point the same way, which is why this is a threshold change and not a
    // shader trick. (1) MEASURED: the rebaked field put visibly more cloud on screen at the
    // old thresholds, and the deck's cost went 1.049 -> 1.376 ms at ch4 with a drift bound of
    // 0.066 — five times the bound, so real. The two new gradient taps can only account for
    // ~0.05 ms of that by arithmetic (≈0.37 Mpx covered x 2 fetches), so the cost is COVERAGE:
    // more covered pixels means more blended fill, and fill is what this iGPU is short of.
    // (2) ART: the owner's Witness reference is mostly BLUE — discrete cumulus with generous
    // sky between them, not a broken overcast. Lower coverage serves the budget and the
    // reference with one number, which is the rare case where the cheap fix is also the right
    // one. The inland end moves least (0.40 -> 0.515): ch5's overhead deck still reads as a
    // layer, just not a lid.
    // 0.685/0.515 -> 0.755/0.605 (second raise, and the last one). Measuring the reference
    // rather than eyeballing it: The Witness's sky is roughly a quarter to a third cloud, with
    // blue carrying the frame and a few masses reading against it. Ours was still past half,
    // which is why even a lit, scalloped, hero-populated sky read as "busy" rather than as that
    // reference. Coverage is the one lever here that is FREE — this deck's cost was measured to
    // be coverage-INDEPENDENT (0.63/0.40 -> 0.685/0.515 moved cloudsMs by exactly zero) — so
    // the composition can be set purely on what looks right.
    const cloudThresholdBase = mix(
        float(0.755),
        float(0.605),
        smoothstep(float(-150), float(-760), cl.worldXZ.y),
    ).add(sin(cl.worldXZ.x.mul(0.0018).add(cl.worldXZ.y.mul(0.0006))).mul(0.045))
        // ── FAR-FIELD MASS ───────────────────────────────────────────────────────────
        // Opening the sky was right overhead and WRONG at range: from a pulled-back review
        // camera (1.4 km back, 0.5 km up) the horizon went nearly bare, and the shoreline view
        // had almost no cloud over the sea at all — while the reference keeps chunky mass all
        // the way out. So coverage is now a function of DISTANCE as well: the raised threshold
        // holds near the camera and relaxes with range so the far field fills back in. Free,
        // like every coverage term here (this deck's cost was measured coverage-independent),
        // and it lives in the vertex stage with the rest.
        .sub(smoothstep(float(900), float(5200), length(cl.worldXZ.sub(uLodCenter))).mul(0.17));
    // ── HERO CLEARINGS — GATED ON THE SAME LEVER AS THE HERO MESH ────────────────────
    // A hero only reads as a hero if it stands in OPEN BLUE, so the deck opens up around each
    // hero's ground track (per VERTEX — six distance terms across ~9.8k verts are free, where
    // the same terms per fragment would land on the one stage this deck cannot afford). The
    // descending smoothstep(hi, lo, x) is the true descending ramp (GPU-probe-verified);
    // the clamp stops overlapping clearings erasing the sky wholesale.
    //
    // ⚠️ This term MUST ride the `heroes` option. It used to be unconditional, which was a
    // phantom-hole trap: with the meshes off (heroes retired 2026-08-14, opt-in via
    // `?odysseyWorldHeroes=1`)
    // the deck kept six absolute-world bald discs with nothing standing in them — full-clear
    // diameters 840-1232 u, and H1/H3 sit 945 u apart so their clearings MERGE into one
    // ~2.3 km hole directly over the summit, the exact frame the composition points at.
    const cloudThreshold = heroes
        ? cloudThresholdBase.add(clamp(
            ODYSSEY_HERO_CLOUD_SPECS.reduce(
                (acc, h) => acc.add(smoothstep(
                    float(h.w * 2.1),
                    float(h.w * 0.7),
                    length(cl.worldXZ.sub(vec2(h.x, h.z))),
                ).mul(0.30)),
                float(0),
            ),
            0,
            0.34,
        ))
        : cloudThresholdBase;
    const vThresh = varying(cloudThreshold, 'vThresh');
    const cUvA = varying(cl.worldXZ.mul(0.00205), 'vCUvA');
    const cUvB = varying(cl.worldXZ.mul(0.00560).add(vec2(0.31, 0.77)), 'vCUvB');
    const cUvC = varying(cl.worldXZ.mul(0.01420).add(vec2(0.58, 0.12)), 'vCUvC');
    const drift = uTime.mul(0.0016);
    // ALL THREE OCTAVES READ THE SILHOUETTE FIELD (.a) — cloud plan Wave 1b. Octaves 2 and 3
    // used to read .b, which is the terrain's value noise: lobes at the coarse scale with
    // static sprayed over them at the fine scales, so every cloud edge dissolved into
    // confetti exactly where the Ghibli rules want a drawn scallop. Reading .a at all three
    // scales gives the three-tier lobe hierarchy the references describe (primaries carry the
    // read, secondaries ride them, tertiaries scallop the crown), and the scale ratios
    // (2.73x, 2.54x) are deliberately non-integer so the 256^2 tile's recurrences at the
    // three octaves never coincide.
    const density = texture(detailTex, cUvA.add(vec2(drift, 0))).a.mul(0.52)
        .add(texture(detailTex, cUvB.add(vec2(drift.mul(1.7), 0))).a.mul(0.32))
        .add(texture(detailTex, cUvC).a.mul(0.16));

    // Fade the deck out at the lattice rim, or its far edge draws a horizon-wide straight
    // line across the sky — the same failure mode as a uv feather that never reaches 1.
    const cloudDist = length(cl.worldXZ.sub(uLodCenter));
    const rim = float(1).sub(smoothstep(float(cloudReach * 0.62), float(cloudReach * 0.95), cloudDist));
    // Widen the alpha edge with FOOTPRINT: a 0.06 band is a crisp cumulus edge up close and a
    // pixel-wide razor cut at 10 km, which aliases into hard confetti. Band-limiting the edge
    // is the same principle the ground's detail gate already uses.
    // THE STRAIGHT-EDGE DEFECT (found from the real spline camera at ch5, p=0.565).
    // This was `max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)))` — a
    // SCREEN-SPACE derivative of world position, which is continuous inside a triangle and
    // JUMPS BY 2x at every clipmap ring boundary, because adjacent rings' triangles differ 2x
    // in size. That discontinuity fed the alpha edge width, and since Wave 2 it also fed the
    // underside shadow-band position through `aaW` — so each rectangular ring border became a
    // hard step in BOTH alpha softness and colour, drawn across the sky as the straight
    // diagonal seams the ch5 capture shows. It is the same defect class, and the same cause,
    // as the water plate's "square sections": a lattice-derived quantity terraces at ring
    // boundaries. The water's fix applies here unchanged — key the band to CAMERA DISTANCE,
    // which is radial and continuous, so no ring shape can be constructed from it. Distance is
    // also the honest proxy for the band-limiting this term exists to do (world units per
    // pixel grows with range), and the 0.06 near / 0.11 far span is preserved exactly.
    const cloudFootprint = length(positionWorld.xz.sub(cameraPosition.xz));
    // A LITTLE band-limiting, not a lot: the first attempt lifted the edge to 0.22 at range,
    // which stopped anti-aliasing the edge and started making it — partial coverage everywhere
    // turned the distant broken cumulus into a translucent overcast veil across the whole sky.
    const puffBand = smoothstep(float(300), float(9000), cloudFootprint).mul(0.05).add(0.06);
    // The anti-aliased edge width, hoisted: BOTH the colour block (the underside's shadow-patch
    // step) and the opacity block (the drawn edge + opaque core) key off it, so it has to be
    // declared before either reads it.
    const aaW = puffBand.toVar();

    // ── TWO-BAND SUN SHADING (cloud plan Wave 2) ─────────────────────────────────────
    // The deck never read `uSunDir` at all: light had no direction, so every mass was the
    // same tone whichever way it faced, and the only variation came from DENSITY modulating
    // colour — which reads inverted, thin edges glowing and thick cores going dark (the
    // distillation's mistake #4: frequency belongs in the silhouette, the interior stays
    // flat). Now the silhouette field doubles as a height field: two extra taps give its
    // gradient, the gradient gives a pseudo-normal, and ONE dot against the sun through ONE
    // narrow smoothstep gives a hard quantised terminator. Because the normal comes from the
    // SAME field that cuts the silhouette, the terminator's edge scallops in step with the
    // outline — which is the "flat yet volumetric" trick the whole reference set turns on.
    // The gradient sampler. GUARDED normalize downstream: a zero-length vector const-folds into
    // a WGSL compile failure on this stack (the winter theme's logged trap), and the gradient
    // IS zero wherever the field is locally flat — most of a cloud's interior. The terminator
    // band is 8 % wide — a drawn line, not a gradient — and its edges are never equal, because
    // `smoothstep(a, a, x)` is a hard WGSL compile error.
    const cTexel = float(1 / 256);
    const cSample = (uvOff) => texture(detailTex, cUvA.add(vec2(drift, 0)).add(uvOff)).a;
    const cloudTop = mix(uSunColour.mul(1.06).add(uSkyZenith.mul(0.10)), vec3(0.99, 0.99, 1.0), 0.22);
    // The base tone leans on the HORIZON colour, not the shadow tint. The first version was
    // shadow-tint-dominated, which the playground (no post stack) rendered as soft grey — and
    // the in-game grade (outputScale 0.82, ACES, chapter saturation 1.10) crushed into ragged
    // NAVY shards across Ch5's sky. Same lesson as the ground palette: the world hands the
    // grade a brighter, flatter colour than it wants on screen, because the grade adds the
    // punch. Capture-diagnosed at Ch5 eye height, 2026-08-12.
    // THE SHADOW BAND IS A HUE SHIFT, NOT A DARKENING (rule 2). Mixing toward the horizon
    // colour and leaning violet keeps the value gap small (~85 % of lit) while the temperature
    // gap does the work; darkening instead reads muddy and grey. Everything here is authored
    // BRIGHT because the world hands the post stack a deliberately flattened image
    // (outputSaturation 0.72) and the grade supplies the vividness.
    const cloudShade = mix(cloudTop, uSkyHorizon, float(0.42)).mul(vec3(0.99, 0.995, 1.06));
    // THE UNDERSIDE IS WHERE THIS DECK ACTUALLY LIVES, so it gets two bands of its own.
    // MEASURED while building this wave: the rail's eye tops out around y=634 at the end of
    // ch5 (`?p=0.643` reports eyeY 634.1) against a deck plane at 660 — the camera never
    // climbs above the deck in Act II, it only reaches INSIDE the billow band. So the sun
    // terminator above is a late-ch5 detail, and a single flat underside tone would have made
    // this wave invisible for most of the journey.
    // The references do not paint undersides flat either: volume is read from the SHAPE of
    // flat shadow patches (the fish-scale stack), not from smooth shading. So the underside
    // takes ONE quantised step — thick core a touch cooler and darker, thin shoulder brighter
    // — with the step following the density contour, which makes each patch lobe-shaped for
    // free. NOTE THE SIGN: the old term did `mix(base, top, puff.oneMinus())`, i.e. LOW
    // density got the bright tone, so thin edges glowed and thick cores went dark — the
    // inverted read the critique flagged. This is that term, the right way round and
    // quantised instead of smooth. Both tones stay LIGHTER than the sky behind them (rule 3),
    // which is the anti-"navy shards" rule this deck has been burnt by before.
    // WHITE BIAS — a cloud must stay CLOUD-coloured even when the sky is not.
    // Found from the real spline camera at ch5 (p=0.565): every cloud tone here is derived
    // from `uSkyHorizon`, and chapter 5's script drives that to a near-pure ultramarine, so
    // the deck came out as pale BLUE patches on a blue sky — no longer reading as cumulus at
    // all. Earlier chapters hid this because their horizon is already pale. Mixing each tone
    // a third of the way to neutral white keeps the sky's hue in the clouds (they must still
    // belong to the scene) while guaranteeing they never inherit a saturated cast wholesale.
    const cloudWhite = vec3(0.97, 0.975, 0.99);
    const cloudUnderLit = mix(uSkyHorizon.mul(1.10).add(uShadowTint.mul(0.12)), cloudWhite, 0.34);
    // ~0.86 of the lit band's luminance with a strong violet lean. The first pass used 0.96 and
    // the patches were invisible once the grade had flattened them (outputSaturation 0.72 into
    // an ACES curve) — the repo's standing playground rule is that colour must OVERSHOOT here,
    // and a two-band read that survives the grade needs a bigger gap than it needs on the page.
    const cloudUnderShade = mix(
        uSkyHorizon.mul(0.86).add(uShadowTint.mul(0.36)).mul(vec3(0.96, 0.98, 1.09)),
        cloudWhite.mul(0.86),
        0.30,
    );
    // The step also starts closer to the silhouette edge, so the shadow patch covers a real
    // area of each lobe instead of only its densest core.
    const underStep = smoothstep(vThresh.add(aaW).add(0.012), vThresh.add(aaW).add(0.042), density);
    const cloudUnder = mix(cloudUnderLit, cloudUnderShade, underStep);
    // PER-FRAGMENT above/below, against the fragment's OWN displaced height. The old term read
    // the camera against the flat deck plane, so the entire sky swapped tone at once as the
    // rail climbed through y=660; now billow crests flip to their sunlit read before the
    // troughs do, which is a parallax reveal instead of a global colour swim.
    // ── THE REGIME GATE (MEASURED; this is the water plate's lesson applied) ─────────
    // Wave 2 shipped +0.327 ms at ch4 against a 0.066 drift bound — five times the bound, so
    // real, and it FAILED the wave's exit gate. The first hypothesis was fill, so coverage was
    // cut from 0.63/0.40 to 0.685/0.515: `cloudsMs` came back 1.376, IDENTICAL to the digit.
    // That refutes fill and confirms what the research critic said about the discard floor —
    // sub-threshold fragments still run every tap, discard only saves the blend write — so the
    // cost is shader work on EVERY rasterised sheet fragment, cloud or sky.
    //
    // And most of that work is invisible: the rail's eye tops out near y=634 against a deck at
    // 660, so below y≈484 (deck minus billow minus the fade's own 60 u) `fromAboveF` is zero
    // for every fragment and the entire top read — two gradient taps, a normalize, a dot and a
    // terminator — is computed and then multiplied away. A multiply by zero is NOT dead-code-
    // eliminated (this repo's logged lesson, and the exact bug the water plate had). `uCloudTopLit`
    // is a uniform the CPU writes, so `If` on it is uniform control flow the GPU skips coherently.
    const cloudCol = Fn(() => {
        // ROOT-PIN first: r181 emits a var's ASSIGNMENT at its first build site, so any shared
        // term first built inside a branch leaves the other path — and later graph roots like
        // `opacityNode` — reading zeros. This is the regression that broke the water's
        // underside; it is not being repeated here.
        density.toVar('cRootDensity');
        aaW.toVar('cRootAaW');
        vThresh.toVar('cRootThresh');
        const col = vec3(0).toVar('cloudColOut');
        col.assign(cloudUnder);
        If(uCloudTopLit.greaterThan(0.5), () => {
            const cCentre = cSample(vec2(0, 0)).toVar();
            const cGx = cSample(vec2(cTexel, 0)).sub(cCentre);
            const cGz = cSample(vec2(0, cTexel)).sub(cCentre);
            const cNraw = vec3(cGx.mul(-9.0), 1, cGz.mul(-9.0));
            const cN = cNraw.div(max(length(cNraw), float(1e-5)));
            const cSun = clamp(dot(cN, uSunDir).mul(0.5).add(0.5), 0, 1);
            const cBand = smoothstep(float(0.44), float(0.52), cSun);
            const fromAboveF = smoothstep(float(-60), float(90), cameraPosition.y.sub(vCloudY));
            col.assign(mix(cloudUnder, mix(cloudShade, cloudTop, cBand), fromAboveF));
        });
        return col;
    })();
    // THE DECK GETS ITS OWN, LIGHTER AERIAL — the actual reason the far field looked empty.
    // Adding distance-based coverage barely moved it, because the far clouds were never
    // missing: `applyAerial` caps its haze weight at 0.82, so past a few kilometres a cloud is
    // ~80 % sky colour and simply dissolves. The reference keeps chunky mass all the way to the
    // horizon, which needs the haze to stop eating the clouds rather than more of them.
    // 0.52 keeps a real depth cue (far clouds still sit back) while leaving them readable, and
    // it costs nothing — the aerial expression runs either way. The submerged branch is
    // skipped for the same reason the heroes skip it: the deck is CPU-gated off underwater, so
    // it must not pay for a branch it can never show (multiply-by-zero is not eliminated here).
    const cloudAerial = (deckLit, wp) => {
        const to = wp.sub(cameraPosition);
        const d = length(to);
        const dirY = to.div(max(d, float(0.001))).y;
        const weight = clamp(float(1).sub(exp(d.mul(uAerialK.negate()))), 0, 0.52);
        return mix(deckLit, skyColourFor(dirY), weight);
    };
    cloudMat.colorNode = toOutput(cloudAerial(cloudCol, positionWorld));
    // NEAR FADE: Ch5's rail crosses the deck's altitude, so without this the camera meets
    // paper-thin billowed geometry edge-on — ragged shards filling the frame. Fading by
    // distance to the EYE (not by altitude band) keeps the deck solid at range in every
    // direction while the 60..240 u shell around the camera reads as passing through mist.
    const nearFade = smoothstep(float(60), float(240), length(positionWorld.sub(cameraPosition)));
    // ALTITUDE-BAND FADE. The near fade alone is not enough: with the camera INSIDE the
    // deck's billow band, the sheet at the camera's own altitude forms hard torn silhouettes
    // at EVERY distance — the ragged-shards frame the first Ch5 capture produced. Fading
    // fragments within ~200 u of the camera's altitude opens a horizontal corridor through
    // the layer while the deck above and below stays solid, which reads as flying between
    // cloud floors — exactly the "strata at eye height" the chapter wants.
    // ALTITUDE CORRIDOR. Fades fragments near the camera's own altitude so the paper-thin
    // sheet is never met edge-on. NOTE FOR THE NEXT ATTEMPT AT THE CH5 STRAIGHT EDGES: this
    // term was suspected (a constant-altitude surface projects to a straight line from a
    // camera inside it) and widening it to 25..620 with a noise-broken threshold did NOT
    // remove the diagonals — it only thinned the deck. Reverted. The edges ARE the deck
    // (bisected: they vanish under ?odysseyWorldNoClouds=1 at p=0.565) but neither this nor
    // the screen-derivative footprint was the cause.
    const bandFade = smoothstep(float(40), float(200), abs(positionWorld.y.sub(cameraPosition.y)));
    // ── POSTER-PAINT ALPHA (cloud plan Wave 1b) ──────────────────────────────────────
    // Was a single smoothstep to 0.94: one soft ramp from sky to cloud, which is the
    // fog-blob edge the Ghibli/Witness distillation names as mistake #1, and a body that
    // never reached opaque so saturated sky bled through the mass everywhere (mistake #11,
    // and half of why the holes read ultramarine).
    //
    // Now TWO stops. `edgeA` is the drawn edge: it rises across the footprint-widened band
    // — keeping the far-field band-limiting that stops the horizon aliasing into confetti —
    // and stops at 0.72, so the silhouette has a visible rim rather than fading in. `coreA`
    // then takes the interior to FULLY opaque a little further in. `max` of the two is a
    // hard edge followed by poster paint, which is exactly the Witness cloud profile.
    const edgeA = smoothstep(vThresh, vThresh.add(aaW), density).mul(0.72);
    const coreA = smoothstep(vThresh.add(aaW).add(0.035), vThresh.add(aaW).add(0.085), density);
    const cloudAlpha = max(edgeA, coreA).mul(rim).mul(nearFade).mul(bandFade)
        .mul(float(1).sub(uSubmerged))
        // 0.94 -> 0.985: the last 6 % of transparency was the whole sky's worth of milkiness.
        .mul(0.985);
    cloudMat.opacityNode = cloudAlpha;
    cloudMat.transparent = true;
    cloudMat.depthWrite = false;
    // THE BLEND-BANDWIDTH FLOOR (cloud plan Wave 1a). The deck is a sky-covering sheet whose
    // alpha is zero or near-zero over most of its area, and every one of those fragments was
    // still paying a full read-modify-write in the ROP — on a shared-LPDDR iGPU that is the
    // expensive half of a transparent full-screen layer. Wave 0 measured the deck at 1.049 ms
    // (ch4) and 1.901 ms (ch5, 20.9 % of the frame), so this is being taken out of a real
    // number rather than a guess. Same 0.004 cut the water plate already uses.
    cloudMat.alphaTest = 0.004;
    cloudMat.side = THREE.DoubleSide;

    // ── DIAGNOSTIC RE-SHADES (see the `cloudDebug` option) ──────────────────────────
    // Drawn LAST so it overwrites the shipped graph rather than forking it: the point of a
    // diagnostic is to photograph the same mesh, the same geometry and the same draw the game
    // submits, with only the shading swapped. Ring index cycles through three hues so adjacent
    // rings can never be confused, the morph band burns yellow, and the flat 0.32 alpha is the
    // measuring stick — anywhere two rings overlap composites to 0.54, so double coverage is
    // legible as brightness without any extra term to compute.
    // `alpha` — the shipped opacity as an OPAQUE greyscale sheet. Splits the remaining defect
    // space in one capture: everything about cloud colour, the aerial and the sky behind is
    // gone, so a feature that still shows here lives in the opacity graph and a feature that
    // vanishes lives in the colour graph. `flat` goes one step further and removes the opacity
    // graph too — constant white at constant alpha, so only GEOMETRY and draw order remain.
    if (cloudDebug === 'alpha') {
        cloudMat.colorNode = toOutput(vec3(1).mul(cloudAlpha.div(0.985)));
        cloudMat.opacityNode = float(1);
        cloudMat.transparent = false;
        cloudMat.alphaTest = 0;
    }
    // `grid` — the alpha readout with a WORLD-SPACE ruler on it: red lines every 50 u of world
    // X, green every 50 u of world Z, both brightened every 500 u. A straight screen line is a
    // plane through the eye, so on a near-horizontal deck it is a straight line in world XZ —
    // and this says which one, which is the difference between "iso-line of world Z" (the
    // coverage ramp), "iso-line of X" (the billow sine) and "neither".
    if (cloudDebug === 'grid') {
        const rule = (coord) => {
            const f = coord.div(50).sub(floor(coord.div(50)));
            const fine = float(1).sub(tslStep(float(0.06), min(f, float(1).sub(f)).mul(2)));
            const c500 = coord.div(500).sub(floor(coord.div(500)));
            const coarse = float(1).sub(tslStep(float(0.03), min(c500, float(1).sub(c500)).mul(2)));
            return clamp(fine.mul(0.55).add(coarse), 0, 1);
        };
        cloudMat.colorNode = toOutput(vec3(1).mul(cloudAlpha.div(0.985)).mul(0.55)
            .add(vec3(rule(positionWorld.x), rule(positionWorld.z), 0)));
        cloudMat.opacityNode = float(1);
        cloudMat.transparent = false;
        cloudMat.alphaTest = 0;
    }
    // `mult` — the opacity graph's three attenuators, one per channel: R = nearFade (a sphere
    // around the eye), G = bandFade (two horizontal planes), B = rim (a circle on the lattice).
    // None of the three CAN draw a straight world-space line if it is doing what its name says,
    // so this is a falsification test: whichever channel carries the defect band is the term
    // that is not doing what its name says, and if none of them carries it the band lives in
    // max(edgeA, coreA) — i.e. in density, vThresh or aaW.
    if (cloudDebug === 'mult') {
        cloudMat.colorNode = toOutput(vec3(nearFade, bandFade, rim));
        cloudMat.opacityNode = float(1);
        cloudMat.transparent = false;
        cloudMat.alphaTest = 0;
    }
    if (cloudDebug === 'flat') {
        cloudMat.colorNode = toOutput(vec3(1));
        cloudMat.opacityNode = float(0.35);
    }
    if (cloudDebug === 'lattice') {
        // OVERLAY, NOT REPLACE — learnt the hard way in this very session. The first cut of
        // this instrument swapped the whole graph for a ring-hue picture, which produced a
        // beautiful diagram that could not be registered against the defect: two images, two
        // different shadings, and the eye guessing whether a line in one sat where a line in
        // the other did. Painting the marks ON TOP of the shipped deck makes it ONE frame, so
        // "is the defect band the morph band" is answered by looking at a single pixel column.
        const vMorph = varying(cl.morph, 'vClMorph');
        const vCheb = varying(cl.cheb, 'vClCheb');
        const vLevel = varying(cl.level, 'vClLevel');
        // The three lattice features that can construct a straight line in world space, each
        // in its own colour, all of them SQUARE iso-contours of the Chebyshev norm:
        // yellow — the morph band, where a vertex's world position (and therefore every UV,
        //          threshold and billow sampled from it) slides toward the coarse lattice;
        // red    — a ring's outer collar, the band that its neighbour's hole leaves DOUBLE
        //          COVERED, so a transparent deck blends there twice;
        // cyan   — the inner collar of the same overlap, seen from the outer ring's side.
        const markMorph = tslStep(float(0.02), vMorph).mul(float(1).sub(tslStep(float(0.98), vMorph)));
        const markOuter = tslStep(float(0.875), vCheb);
        const markInner = tslStep(float(0.5), vLevel).mul(float(1).sub(tslStep(float(0.51), vCheb)));
        const markAny = clamp(markMorph.add(markOuter).add(markInner), 0, 1);
        const markCol = vec3(
            clamp(markMorph.add(markOuter), 0, 1),
            clamp(markMorph.add(markInner), 0, 1),
            markInner,
        );
        cloudMat.colorNode = toOutput(mix(cloudAerial(cloudCol, positionWorld), markCol, markAny.mul(0.75)));
        cloudMat.opacityNode = max(cloudMat.opacityNode, markAny.mul(0.55));
    }

    const cloudMesh = new THREE.Mesh(cloudGeo.geometry, cloudMat);
    cloudMesh.frustumCulled = false;
    cloudMesh.matrixAutoUpdate = false;
    cloudMesh.updateMatrix();
    cloudMesh.renderOrder = 6;
    cloudMesh.name = 'odyssey-world-clouds';
    if (clouds) group.add(cloudMesh);

    // ── HERO CUMULUS (cloud plan §7.1 — RETIRED BY THE OWNER 2026-08-14) ─────────────
    // Approved 2026-08-13, retired the next day as an art-direction call: two cloud MODELS in
    // one sky do not cohere. Everything below is RETAINED and gated on `heroes` (default
    // false); `?odysseyWorldHeroes=1` restores it. The mount gate is `if (heroes)` at the
    // group.add below — do not read this block as shipping-by-default.
    // Real OPAQUE geometry, not billboards. The full argument lives in odyssey-hero-clouds.js;
    // the short version is that opaque lobes DELETE the billboard-basis problem, the
    // transparency-sorting problem and the no-vertical-mass problem instead of managing them,
    // and cost less on a fill-bound iGPU than any transparent alternative.
    //
    // The four tones below are the DECK'S OWN, referenced rather than copied, so heroes and
    // sheet cannot drift apart and there is no second colour tuning to get wrong.
    const heroBuild = buildHeroCloudGeometry(ODYSSEY_HERO_CLOUD_SPECS, { tertiaries: true });
    const heroMat = new THREE.MeshBasicNodeMaterial();
    const hN = normalWorld.toVar('heroN');
    const hSun = dot(hN, uSunDir).toVar('heroSun');
    const hUp = hN.y.toVar('heroUp');
    // Two flat bands on the sunlit family and two on the under family — the same quantised
    // grammar as the deck. Edges are never equal: smoothstep(a, a, x) is a hard WGSL compile
    // error, not a no-op.
    const hLitBand = smoothstep(float(0.16), float(0.24), hSun);
    const hTop = mix(cloudShade, cloudTop, hLitBand);
    const hUnderBand = smoothstep(float(-0.30), float(-0.62), hUp);
    const hUnder = mix(cloudUnderLit, cloudUnderShade, hUnderBand);
    const hBody = mix(hTop, hUnder, smoothstep(float(0.10), float(-0.10), hUp)).toVar('heroBody');
    // THE DRAWN EDGE (slice 2). On a closed lobe |dot(n, view)| falls to zero at the limb, so
    // this is a contour band just inside the silhouette — the painted outline the references
    // put on every cloud. The band is ~10 % of the silhouette RADIUS rather than a pixel: a
    // 1 px line is sub-pixel at 2 km and aliases into confetti, which is the same mistake the
    // deck's footprint-widened alpha edge exists to avoid.
    const hV = normalize(cameraPosition.sub(positionWorld));
    const hRim = float(1).sub(abs(dot(hN, hV)));
    const hEdge = smoothstep(float(0.55), float(0.88), hRim);
    const heroCol = mix(hBody, mix(cloudShade, uSkyHorizon, float(0.30)), hEdge.mul(0.55));
    // AIR-ONLY aerial. `applyAerial` always evaluates its submerged branch — per-channel exp,
    // two pows, three plate mixes — then multiplies by uSubmerged, and multiply-by-zero is NOT
    // dead-code-eliminated on this stack. Heroes are CPU-gated off underwater, so they must
    // never pay for a branch they can never show. 0.7 because the raw aerial weight at the
    // authored ranges is 0.27-0.40, which would wash the value bands out.
    const heroAerial = (heroLit, wp) => {
        const to = wp.sub(cameraPosition);
        const d = length(to);
        const dirY = to.div(max(d, float(0.001))).y;
        // 0.7 -> 0.42, set by capture: at the authored 1.6-2.9 km ranges the raw aerial weight
        // is 0.27-0.40, and even scaled by 0.7 it washed the value bands into one pale mass —
        // the heroes read as soft blobs rather than lit cumulus. 0.42 keeps the depth cue
        // (they still sit behind the mountains tonally) while letting the lit/shadow split and
        // the cool underside survive to the eye.
        const weight = clamp(float(1).sub(exp(d.mul(uAerialK.negate()))), 0, 0.82).mul(0.42);
        return mix(heroLit, skyColourFor(dirY), weight);
    };
    heroMat.colorNode = toOutput(heroAerial(heroCol, positionWorld));
    // OPAQUE, and each of these is load-bearing: `transparent:false` keeps the mesh in the
    // opaque queue, where hardware depth — not renderOrder — resolves it against the mountains
    // and the deck; FrontSide culls the far half of every closed lobe, a real ~2x cut on the
    // scarce resource; no opacityNode/alphaTest means no blend state is emitted at all.
    heroMat.side = THREE.FrontSide;
    // No positionNode: the geometry is already world-space and the world group's matrix is
    // identity — the same invariant the deck relies on.
    const heroMesh = new THREE.Mesh(heroBuild.geometry, heroMat);
    // Deliberately UNCULLED. Culling saves one draw, but a frustum-culled world-anchored mesh
    // flickers +-1 draw as the camera breathes — the defect that voided pairs at the ch1 station
    // (the corona sprites, whose fix was to UNcull them) and that the gpu-split content-match
    // guard voids runs over. A constant draw count is worth more than one culled draw.
    heroMesh.frustumCulled = false;
    heroMesh.matrixAutoUpdate = false;
    heroMesh.updateMatrix();
    // renderOrder deliberately left at 0 — it must sort with the ground, in the opaque queue.
    heroMesh.name = 'odyssey-world-hero-clouds';
    if (heroes) group.add(heroMesh);

    // ── CLOUD FIELD PROBE — THE WITNESS PAINT STACK (plan Wave 0b) ──────────────────
    // Wave 0a priced the MECHANISM with `heroMat` verbatim — zero new shader code, so the
    // 0.393 ms it measured at ch5 is triangles + opaque draws + rasterised silhouette and
    // nothing else. THIS material is the other probe: does the PAINT clear the reference bar
    // measured from the owner's Witness screenshots (plan §1b)? Three things `heroMat` lacks,
    // in the order the research ranks them:
    //
    // 1. THE CENTROID-BENT NORMAL FIELD — the load-bearing one, and the reason the retired
    //    heroes read as a bag of soap bubbles. The Witness blends each vertex normal toward
    //    `normalize(pos - cloudCentroid)` so a clump of lobes shades as ONE soft mass;
    //    per-lobe radial normals shade every lobe as its own sphere, which IS the "different
    //    object class" read that got the heroes retired.
    // 2. WRAP DIFFUSE instead of a hard band on dot(N, sun). The references measure shade/lit
    //    at 0.74-0.92 — a very low-contrast, soft turn of form — and a hard terminator on a
    //    sphere cannot produce that. Bands are kept, but placed ON the wrapped term so they
    //    land inside the soft falloff rather than replacing it.
    // 3. FAKE FORWARD (MIE) SCATTER, the silver lining. ⚠️ SIGN: `uSunDir` points TOWARD the
    //    sun (the ground's `ndl = max(dot(normal, uSunDir), 0)` proves it) and `cfV` points
    //    fragment->eye, so the view ray travels along `-cfV`. Forward scatter fires when the
    //    view looks INTO the sun, i.e. as `dot(cfV, uSunDir)` approaches -1. A design draft had
    //    this inverted and would have lit the ANTI-sun side of every cloud.
    //
    // Constructed unconditionally, like every other material here: TSL nodes are plain JS
    // until a material they feed is rendered, so this costs nothing when the probe is off and
    // it keeps the fog opt-out list (lint-enforced) able to name it.
    const cfCentre = attribute('aMassCentre', 'vec3');
    // `color.b` is the per-mass random the sculptor baked; it is CONSTANT across a mass, which
    // is what makes the offset below a rigid body translation rather than a deformation.
    const cfSeed = attribute('color', 'vec3').z;
    const cfPhase = cfSeed.mul(6.2831853);
    const cfPeriod = float(FIELD_DRIFT_PERIOD_MIN)
        .add(cfSeed.mul(FIELD_DRIFT_PERIOD_MAX - FIELD_DRIFT_PERIOD_MIN));
    const cfW = float(6.2831853).div(cfPeriod);
    // A bounded Lissajous, not a straight translation: three incommensurate terms keep a mass
    // inside a small volume forever, so drift can never walk a cloud into the rail or out of
    // the composition the clearance validator signed off.
    const cfDrift = vec3(
        sin(uTime.mul(cfW).add(cfPhase)).mul(FIELD_DRIFT_XZ),
        sin(uTime.mul(cfW.mul(0.61)).add(cfPhase.mul(1.7))).mul(FIELD_DRIFT_Y),
        cos(uTime.mul(cfW.mul(0.83)).add(cfPhase.mul(0.6))).mul(FIELD_DRIFT_XZ * 0.82),
    ).toVar('cfDrift');
    // THE DRIFTED WORLD POSITION, carried explicitly. `positionNode` replaces the vertex
    // position, but `positionWorld` is built from the ORIGINAL local position — so a colour
    // graph reading `positionWorld` would shade, fog and fade the mass at the place it used to
    // be. Everything downstream reads `cfWorld` instead; the geometry is already world-space
    // and the world group's matrix is identity, which is what makes this a plain add.
    // THE BREATH. `aLobe` carries the dominant lobe's centre (xyz) and its baked phase (w).
    const cfLobe = attribute('aLobe', 'vec4');
    const cfLobeRel = positionLocal.sub(cfLobe.xyz);
    const cfLobeDist = length(cfLobeRel);
    const cfBreathW = float(6.2831853).div(
        float(FIELD_BREATH_PERIOD_MIN)
            .add(cfSeed.mul(FIELD_BREATH_PERIOD_MAX - FIELD_BREATH_PERIOD_MIN)),
    );
    // Guarded divide: a vertex exactly at its lobe centre cannot happen on a surface, but a
    // zero-length normalize const-folds into a WGSL compile failure rather than a warning.
    // TWO TERMS, NOT ONE. A single sine is a pulse: every lobe reaches its maximum, holds
    // nothing, and returns by the identical path, which the eye reads as mechanical breathing
    // rather than as a cloud growing. A second, faster harmonic at 1.63x with its own phase
    // offset breaks the period so no lobe repeats the same excursion twice in a row, and the
    // sum still stays inside FIELD_BREATH_AMP because the weights total 1.
    const cfSwell = sin(uTime.mul(cfBreathW).add(cfLobe.w)).mul(0.68)
        .add(sin(uTime.mul(cfBreathW.mul(1.63)).add(cfLobe.w.mul(2.3))).mul(0.32))
        .mul(FIELD_BREATH_AMP);
    const cfBreath = cfLobeRel.div(max(cfLobeDist, float(1e-4)))
        .mul(cfLobeDist.mul(cfSwell));
    // ⚠️ NOT A SHARED `.toVar()`, AND THE VERTEX POSITION IS ASSIGNED FIRST. This cost a
    // session to find and it is the repo's own logged r181 trap wearing a new face: a var's
    // ASSIGNMENT is emitted at its FIRST BUILD SITE, and three builds `positionNode` BEFORE it
    // builds varyings. Written as a shared `toVar` that the `cfWorld` varying happened to
    // reference first in source order, the assignment landed inside the varying's block and
    // `positionNode` read an unassigned var — ZERO. The clouds therefore never moved, while
    // the COLOUR graph (which reads the varying) was correctly using the drifted position, so
    // nothing looked wrong in code and nothing moved on screen.
    //
    // PROVEN, not guessed: with the drift's time term replaced by a constant 3000 world units
    // — a shift that should have swept the sky clean — the frame was pixel-for-pixel the same
    // cloud count (71,251 vs 71,475). A displacement that large changing nothing can only mean
    // the displacement is not reaching the vertex.
    //
    // The rule that follows is cheap: build it as a PLAIN EXPRESSION, so each consumer inlines
    // its own copy. A few duplicated ALU beats a silent zero.
    //
    // ATMOSPHERIC THINNING (Wave 3): a third offset term pulls every vertex toward its own
    // mass centre as `uWorldThin` rises, shrinking the mass in place (same centres, smaller
    // bodies — the deck opens sky between masses instead of holding full form to the end).
    // Written as another PLAIN term inside cfOffset so the vertex position and the `cfWorld`
    // varying stay in the exact agreement the note above paid for.
    const cfThinPull = positionLocal.sub(cfCentre).mul(uWorldThin.mul(-FIELD_THIN_SHRINK));
    const cfOffset = cfDrift.add(cfBreath).add(cfThinPull);
    const cfWorld = varying(positionLocal.add(cfOffset), 'cfWorld');
    const cfGeoN = normalWorld.toVar('fieldGeoN');
    const cfRadial = cfWorld.sub(cfCentre);
    // Guarded: a vertex exactly at the centre would const-fold a zero-length normalize
    // into a WGSL compile failure (the winter theme's logged trap).
    const cfBent = cfRadial.div(max(length(cfRadial), float(1e-4)));
    const cfN = normalize(mix(cfGeoN, cfBent, float(FIELD_CENTROID_BEND))).toVar('fieldN');
    const cfV = normalize(cameraPosition.sub(cfWorld)).toVar('fieldV');
    // Wrap diffuse: (dot(N,L) + w) / (1 + w) — the GPU-Gems scatter approximation the
    // Witness reuses from its vegetation. w=0.75 keeps the whole mass lit and moves the
    // terminator far around the limb, which is what "no hard terminator" looks like.
    const cfWrap = clamp(dot(cfN, uSunDir).add(0.75).div(1.75), 0, 1).toVar('fieldWrap');
    // TWO bands on the wrapped term, deliberately WIDE (0.42..0.62) so the step is a soft
    // turn rather than the deck's 8% drawn line. Edges are never equal.
    const cfBand = smoothstep(float(0.42), float(0.62), cfWrap);
    const cfBody = mix(cloudUnderShade, cloudTop, cfBand).toVar('fieldBody');
    // The underside stays its own family, keyed to the BENT normal's up component so the
    // whole mass turns together instead of each lobe flipping on its own.
    const cfUnder = mix(cloudUnderLit, cloudUnderShade, smoothstep(float(-0.20), float(-0.70), cfN.y));
    const cfLit = mix(cfBody, cfUnder, smoothstep(float(0.05), float(-0.25), cfN.y)).toVar('fieldLit');
    // Mie: peaks when the view looks into the sun; attenuated by an N.L thickness proxy
    // (the cloud is optically thinner where it faces edge-on), then QUANTISED into the
    // grammar so it reads as a painted rim rather than a bloom.
    const cfMie = clamp(dot(cfV, uSunDir).add(0.9).mul(-10), 0, 1).pow(4)
        .mul(clamp(float(1.25).sub(abs(dot(cfN, uSunDir))), 0, 1));
    const cfRim = float(1).sub(abs(dot(cfN, cfV)));
    const cfEdge = smoothstep(float(0.55), float(0.88), cfRim);
    const fieldCol = mix(cfLit, mix(cloudShade, uSkyHorizon, float(0.30)), cfEdge.mul(0.55))
        .add(uSunColour.mul(smoothstep(float(0.15), float(0.55), cfMie)).mul(FIELD_MIE_GAIN));
    // ATMOSPHERIC THINNING (Wave 3 / F3): the paint half. As `uWorldThin` rises the whole
    // Witness band structure (lit/shade/underside/Mie) collapses toward one flat, low-sat
    // haze family — contrast and saturation leave together, which is what altitude does to
    // cumulus. Applied BEFORE the aerial so distance still grades the thinned colour.
    const fieldThinned = mix(fieldCol, mix(cloudShade, uSkyHorizon, float(0.65)), uWorldThin);
    const fieldMat = new THREE.MeshBasicNodeMaterial();
    fieldMat.colorNode = toOutput(heroAerial(fieldThinned, cfWorld));
    // Built from the plain `cfOffset` EXPRESSION, never from a shared var — see the note at
    // its definition. This line reading zero while the colour graph read the right value is
    // exactly what "the clouds do not move" looked like.
    fieldMat.positionNode = positionLocal.add(cfOffset);
    // THE STIPPLE DISSOLVE. `fade` is 0 at the near edge and 1 beyond the far edge, and the
    // hash is a per-pixel threshold — so a mass fades out as a shrinking scatter of kept
    // pixels instead of a wall sliding through the camera. Beyond FIELD_FADE_FAR the fade is
    // 1 and `step` keeps every fragment, so nothing is discarded and nothing is paid at range.
    const cfEyeDist = length(cameraPosition.sub(cfWorld));
    const cfFade = smoothstep(float(FIELD_FADE_NEAR), float(FIELD_FADE_FAR), cfEyeDist);
    const cfHash = fract(sin(dot(screenUV.mul(vec2(1927.0, 1083.0)), vec2(12.9898, 78.233)))
        .mul(43758.5453));
    fieldMat.opacityNode = tslStep(cfHash, cfFade);
    // alphaTest WITHOUT `transparent`: r181 discards on it regardless, so the mesh stays in
    // the opaque queue and emits no blend state.
    fieldMat.alphaTest = 0.5;
    fieldMat.side = THREE.FrontSide;

    let fieldProbeMesh = null;
    let fieldProbeBuild = null;
    if (cloudField) {
        // Built only when asked — an unmounted geometry is still a CPU bake and a GPU upload
        // nobody requested. `cloudFieldCount` slices the spec table so the Wave 0 cost-curve
        // instrument still works against the REAL field: two counts answer what one number
        // cannot, namely whether the price tracks mass count (so composition and LOD are the
        // levers) or is dominated by the per-draw constant. Wave 0 measured the latter.
        const fieldSpecs = cloudFieldCount > 0
            ? ODYSSEY_CLOUD_FIELD_SPECS.slice(0, cloudFieldCount)
            : ODYSSEY_CLOUD_FIELD_SPECS;
        fieldProbeBuild = buildCloudFieldGeometry(fieldSpecs, railSamples);
        fieldProbeMesh = new THREE.Mesh(fieldProbeBuild.geometry, fieldMat);
        // Same three invariants as the heroes: unculled (a breathing +-1 draw voids pairs via
        // the content-match guard), static matrix, opaque queue.
        fieldProbeMesh.frustumCulled = false;
        fieldProbeMesh.matrixAutoUpdate = false;
        fieldProbeMesh.updateMatrix();
        fieldProbeMesh.name = 'odyssey-world-cloud-field';
        group.add(fieldProbeMesh);
    }

    // ── god rays (Ch2 port) ─────────────────────────────────────────────────────────
    // The deep-ocean chapter's declared hero: descending light shafts with caustic shimmer.
    // Ported as ONE InstancedMesh of open cones seated along the SUBMERGED stretch of the
    // rail (the caller samples its spline into railSamples — the world does not know the
    // path), tilted to the real ODYSSEY_WORLD_SUN rather than the old chapter's private
    // "light from above" assumption. Visible only while the camera is underwater.
    const sunkPoints = railSamples.filter((pt) => pt && pt.y < ODYSSEY_SEA_LEVEL - 6);
    // WAVE 4: the cap is the REAL number. Four research findings priced this system at "22
    // cones" off the old cap while the submerged rail has ever only yielded 9 — the code's
    // own constant was the source of the wrong number, so it now states the truth.
    const rayCount = Math.min(9, sunkPoints.length);
    let rayMesh = null;
    let rayMat = null;
    if (rayCount > 2) {
        rayMat = new THREE.MeshBasicNodeMaterial();
        const rUv = uv();
        // Brightest where the shaft meets the surface, feathering to nothing as it descends —
        // with a short feather AT the base too (first capture after the flip showed the open
        // base's rim as a hard bright ellipse; a shaft of light has no end-cap). The depth
        // exponent steepened 1.15 -> 1.6 so the shaft melts out by mid-depth instead of
        // standing as a full-height pipe.
        const vFade = float(1).sub(rUv.y).pow(1.6).mul(smoothstep(float(0.0), float(0.14), rUv.y));
        // FACING fade, not a uv.x feather. On a ConeGeometry uv.x runs around the
        // CIRCUMFERENCE, so the ported `abs(uv.x - 0.5)` lit one side of the cone and left a
        // hard seam on the other — in-game that read as solid triangular wedges, not light.
        // A shell standing in for a volume must instead dim where it is seen EDGE-ON, because
        // the grazing angle IS the silhouette; fading it there means the shape has no visible
        // boundary at all.
        const rayView = normalize(cameraPosition.sub(positionWorld));
        const eFade = abs(dot(normalWorld, rayView)).pow(0.85).toVar();
        // NEAR fade: the rail passes THROUGH these shafts, and a 220 u cone a few metres from
        // the eye fills the frame with one flat wedge. Same lesson as the cloud deck.
        const rayNear = smoothstep(float(14), float(85), length(positionWorld.sub(cameraPosition)));
        const rayShimmer = snoise3(vec3(
            rUv.x.mul(3.0),
            rUv.y.mul(2.0).add(uTime.mul(-0.12)),
            uTime.mul(0.2),
        ));
        // Same NaN guard as the caustic below: pow() with a negative base and a non-integer
        // exponent is UNDEFINED in WGSL, and two summed noises can dip below the -0.5 that
        // .add(0.5) assumes. Clamp first.
        const rayShimmerSafe = clamp(rayShimmer.mul(0.5).add(0.5), 0, 1).pow(1.35)
            .mul(0.55)
            .add(0.45);
        // Bypasses toOutput (no grade on the shafts), so it takes the departure fade directly.
        rayMat.colorNode = mix(
            uSunColour.mul(vec3(0.75, 0.92, 1.0)).mul(uOutputScale),
            uWorldFadeColour,
            uWorldFade,
        );
        // 0.55 -> 0.34: the flip put the wide (formerly buried) half of every cone in front
        // of the camera, and DoubleSide additive pays both walls — at the old master the
        // shafts read as solid pipes.
        rayMat.opacityNode = vFade.mul(eFade).mul(rayNear).mul(rayShimmerSafe).mul(uSubmerged)
            .mul(0.34)
            .toVar();
        rayMat.transparent = true;
        rayMat.blending = THREE.AdditiveBlending;
        rayMat.depthWrite = false;
        rayMat.side = THREE.DoubleSide;
        rayMat.fog = false;

        const hash01 = (n) => {
            let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
            h = Math.imul(h ^ (h >>> 13), 1274126177);
            return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        };
        const sunLen = Math.hypot(...ODYSSEY_WORLD_SUN);
        const sunDirV = new THREE.Vector3(...ODYSSEY_WORLD_SUN).divideScalar(sunLen);
        // Lean toward the sun's azimuth but only PART WAY: at 25 degrees of solar elevation a
        // full alignment lays the cones nearly sideways, and refraction at the surface bends
        // real underwater shafts steeply toward the vertical (Snell), so a ~23 degree lean
        // keeps the direction of the light readable without the fallen-over look the first
        // capture showed. The AZIMUTH still matches the one canonical sun.
        const fullTilt = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDirV);
        const tilt = new THREE.Quaternion().slerp(fullTilt, 0.35);
        const rayGeo = new THREE.ConeGeometry(7, 240, 14, 1, true);
        // WAVE 4: RIGHT WAY UP. ConeGeometry seats the wide base (uv.y=0, where vFade is
        // brightest) at the BOTTOM and the apex at the top — so the shafts were brightest at
        // their deep end, the bright base buried below the seabed, and the thin dark apex
        // poking above the surface. Flipping the geometry puts the wide bright end AT the
        // surface and tapers the shaft dark toward the floor, which is what refracted
        // surface light does.
        rayGeo.rotateX(Math.PI);
        rayMesh = new THREE.InstancedMesh(rayGeo, rayMat, rayCount);
        const rm4 = new THREE.Matrix4();
        const rPos = new THREE.Vector3();
        const rScl = new THREE.Vector3();
        for (let i = 0; i < rayCount; i += 1) {
            const pt = sunkPoints[Math.floor((i / rayCount) * sunkPoints.length)];
            const a = hash01(i * 3 + 1) * Math.PI * 2;
            const r = 18 + (hash01(i * 3 + 2) * 46);
            // Base (wide, bright end) just above the surface; the apex feathers down to
            // ~SEA-236, dark before it can meet the deepest floor (~SEA-207).
            rPos.set(pt.x + (Math.cos(a) * r), ODYSSEY_SEA_LEVEL - 116, pt.z + (Math.sin(a) * r));
            const sc = 0.75 + (hash01(i * 3 + 3) * 0.7);
            rScl.set(sc, 1, sc);
            rayMesh.setMatrixAt(i, rm4.compose(rPos, tilt, rScl));
        }
        rayMesh.instanceMatrix.needsUpdate = true;
        rayMesh.frustumCulled = false;
        rayMesh.renderOrder = 3;
        rayMesh.name = 'odyssey-world-godrays';
        group.add(rayMesh);
    }

    // ── motes (Wave 4: the particulate the luminous ocean was missing) ─────────────
    // Nausicaa's transmitted-light rig, sized for Lane B: the spores are LIGHT SOURCES, so
    // each mote's brightness scales with how dark the water behind it is (deeper = brighter
    // relative to its background), and serenity comes from CONSTANT velocity — no easing.
    // ONE material, ONE instanced draw, and the budget lever is SIZE, not count: additive
    // overdraw is what killed Cosmic Noir on this lane, and a 0.5–1.1 u quad cannot overdraw
    // much no matter how many there are.
    let moteMesh = null;
    let moteMat = null;
    if (sunkPoints.length > 2) {
        const MOTES = 640;
        const mSeed = new Float32Array(MOTES);
        const mOrigin = new Float32Array(MOTES * 3);
        for (let i = 0; i < MOTES; i += 1) {
            const pt = sunkPoints[Math.floor((i / MOTES) * sunkPoints.length)];
            const h = (n) => {
                let v = Math.imul(n ^ 0x27d4eb2f, 2654435761);
                v = Math.imul(v ^ (v >>> 13), 1274126177);
                return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
            };
            mSeed[i] = h(i * 5 + 1);
            const a = h(i * 5 + 2) * Math.PI * 2;
            const r = 6 + (h(i * 5 + 3) * 64);
            const mx = pt.x + (Math.cos(a) * r);
            const mz = pt.z + (Math.sin(a) * r);
            let my = Math.min(pt.y + ((h(i * 5 + 4) - 0.35) * 90), ODYSSEY_SEA_LEVEL - 3);
            // WAVE 3 RESEAT — same rule as the fish: 267 motes were seeded under the seabed
            // and early-Z rejected. Lift only at open-water stations; shaft stations are
            // Wave 2's reseeding.
            if (pt.y > relief.sample(pt.x, pt.z) - 2) {
                my = Math.min(Math.max(my, relief.sample(mx, mz) + 2), ODYSSEY_SEA_LEVEL - 3);
            }
            mOrigin[i * 3] = mx;
            mOrigin[i * 3 + 1] = my;
            mOrigin[i * 3 + 2] = mz;
        }
        const moteGeo = makeQuadInstancedGeometry(MOTES, {
            aSeed: { array: mSeed, itemSize: 1 },
            aOrigin: { array: mOrigin, itemSize: 3 },
        });
        moteMat = new THREE.MeshBasicNodeMaterial();
        const mS = attribute('aSeed', 'float');
        const mO = attribute('aOrigin', 'vec3');
        // Constant-velocity drift upward with a slow sine sway; fract recycles each mote.
        const mRise = fract(uTime.mul(0.014).mul(mS.mul(0.5).add(0.6)).add(mS));
        const mSway = sin(uTime.mul(0.30).add(mS.mul(41))).mul(2.2);
        const moteCenter = vec3(
            mO.x.add(mSway),
            mO.y.add(mRise.mul(70)),
            mO.z.add(mSway.mul(0.7)),
        );
        // 0.5–1.1 u world size, AND screen-space capped (plan Wave 3): the reseat lifts 267
        // previously-buried motes into open water, so the additive fill they can spend is
        // clamped — a mote may never exceed ~1.2 degrees of screen no matter how close it
        // drifts to the eye. Far motes keep their world size (the min never binds).
        const moteSize = mS.mul(0.6).add(0.5);
        const moteDist = length(moteCenter.sub(cameraPosition));
        const moteSizeClamped = min(moteSize, moteDist.mul(0.02).add(0.04));
        moteMat.positionNode = billboardWorld(moteCenter, moteSizeClamped);
        const mUv = uv();
        const mRadial = float(1).sub(smoothstep(float(0.0), float(0.5), length(mUv.sub(vec2(0.5)))));
        // Transmitted light: brightness rises with depth below the surface, because the
        // background darkens with depth — the same inverse the vault's ember gate uses.
        const mDepth = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(120), 0, 1);
        moteMat.colorNode = mix(
            mix(vec3(0.55, 0.85, 0.90), vec3(0.35, 0.75, 0.80), mDepth)
                .mul(mDepth.mul(0.9).add(0.35))
                .mul(uOutputScale),
            uWorldFadeColour,
            uWorldFade,
        );
        moteMat.opacityNode = mRadial.mul(mRadial).mul(uSubmerged).mul(0.42);
        moteMat.transparent = true;
        moteMat.depthWrite = false;
        moteMat.blending = THREE.AdditiveBlending;
        moteMat.fog = false;
        moteMesh = new THREE.Mesh(moteGeo, moteMat);
        moteMesh.frustumCulled = false;
        moteMesh.renderOrder = 4;
        moteMesh.name = 'odyssey-world-motes';
        group.add(moteMesh);
    }

    // ── fish (Wave 5: life, as silhouettes between the camera and the light) ──────
    // ABZU's documented technique, ported to TSL: instanced static meshes animated ENTIRELY
    // in the vertex stage with cosine waves — no skeletons, no CPU skinning, vertex-ALU only.
    // The deep-ocean chapter's old creatures failed as "flat dark polygons" because they swam
    // against the dark; these school ABOVE the rail, so the breach light behind them is what
    // makes a silhouette read (the same reason the levistone device needs darkness).
    let fishMesh = null;
    let fishMat = null;
    if (sunkPoints.length > 2) {
        const FISH = 110;
        // WAVE 3 HULL. The old wedge was 7 of the 9 triangles a closed shape needs (the rear
        // back and belly were simply absent) and was WIDER (0.32) than tall (0.26) — a fish
        // flattened along the wrong axis. This one is CLOSED and laterally compressed the way
        // fish are (taller than wide, 0.60 vs 0.26), widest a third back from the nose, with
        // a forked caudal fin and a raked dorsal. Still nose-to-tail along +Z, still cheap:
        // 11 triangles, vertex-only animation.
        const fishGeo = new THREE.BufferGeometry();
        const fp = [];
        const push = (...v) => fp.push(...v);
        const HX = 0.13; // half-width  (lateral compression: narrower than tall)
        const HY = 0.30; // half-height at the deepest point of the body
        push(0, 0, 2.1, HX, HY, 0.9, HX, -HY, 0.9); // nose right
        push(0, 0, 2.1, HX, -HY, 0.9, -HX, -HY, 0.9); // nose belly
        push(0, 0, 2.1, -HX, -HY, 0.9, -HX, HY, 0.9); // nose left
        push(0, 0, 2.1, -HX, HY, 0.9, HX, HY, 0.9); // nose back
        push(HX, HY, 0.9, 0, 0.02, -1.6, HX, -HY, 0.9); // flank right
        push(-HX, HY, 0.9, -HX, -HY, 0.9, 0, 0.02, -1.6); // flank left
        push(HX, HY, 0.9, -HX, HY, 0.9, 0, 0.02, -1.6); // back (was OPEN)
        push(HX, -HY, 0.9, 0, 0.02, -1.6, -HX, -HY, 0.9); // belly (was OPEN)
        push(0, 0.02, -1.6, 0, 0.36, -2.25, 0, 0.10, -1.95); // caudal upper lobe
        push(0, 0.02, -1.6, 0, -0.06, -1.95, 0, -0.32, -2.25); // caudal lower lobe
        push(0, HY, 0.85, 0, HY + 0.24, 0.35, 0, HY - 0.02, 0.15); // dorsal fin, raked aft
        fishGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
        fishGeo.computeVertexNormals();
        const fInst = new THREE.InstancedBufferGeometry();
        fInst.index = fishGeo.index;
        fInst.setAttribute('position', fishGeo.getAttribute('position'));
        fInst.setAttribute('normal', fishGeo.getAttribute('normal'));
        fInst.instanceCount = FISH;
        const fSeed = new Float32Array(FISH);
        const fOrigin = new Float32Array(FISH * 3);
        const fh = (n) => {
            let v = Math.imul(n ^ 0x51ed270b, 2654435761);
            v = Math.imul(v ^ (v >>> 13), 1274126177);
            return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
        };
        for (let i = 0; i < FISH; i += 1) {
            fSeed[i] = fh(i * 7 + 1);
            const pt = sunkPoints[Math.floor((i / FISH) * sunkPoints.length)];
            const a = fh(i * 7 + 2) * Math.PI * 2;
            const r = 14 + (fh(i * 7 + 3) * 52);
            const x = pt.x + (Math.cos(a) * r);
            const z = pt.z + (Math.sin(a) * r);
            // ABOVE the rail, below the surface: the band where a silhouette has light
            // behind it. Clamped to 8 u under the surface so no fish breaches.
            let y = Math.min(pt.y + 14 + (fh(i * 7 + 4) * 46), ODYSSEY_SEA_LEVEL - 8);
            // WAVE 3 RESEAT — out of the ROCK, not out of the shaft. 40 of 110 seeded below
            // the seabed (the sample disc lands in hillsides) and were early-Z'd invisible.
            // Lift ONLY fish whose rail STATION is open water: a station whose rail runs
            // under the world's terrain is the Act I shaft, and lifting those fish would put
            // them in the cavern — the exact leak Wave 2's reseeding owns.
            if (pt.y > relief.sample(pt.x, pt.z) - 2) {
                y = Math.min(Math.max(y, relief.sample(x, z) + 4), ODYSSEY_SEA_LEVEL - 8);
            }
            fOrigin[i * 3] = x;
            fOrigin[i * 3 + 1] = y;
            fOrigin[i * 3 + 2] = z;
        }
        fInst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(fSeed, 1));
        fInst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(fOrigin, 3));

        fishMat = new THREE.MeshBasicNodeMaterial();
        const fS = attribute('aSeed', 'float');
        const fO = attribute('aOrigin', 'vec3');
        // WAVE 3 SIZING (plan, from Wave 0's unit ruling): 1 u = 1 m, and the old scale
        // (1.2–2.8 over a 4.2 u hull) made every fish in the chapter a 5–12 m whale. The
        // school now spans ~1.7–3.2 m — creature-sized, not vessel-sized.
        const fScale = fS.mul(0.35).add(0.38);
        // Slow circular cruise around each fish's own origin — a school drifts, it does not
        // teleport. Radius and rate vary per seed so the school never phase-locks, and HALF
        // THE SCHOOL CIRCLES THE OTHER WAY (step on the seed): one global handedness read as
        // a carousel, not a school.
        const swimDir = tslStep(0.5, fS).mul(2).sub(1);
        const cruiseRate = fS.mul(0.16).add(0.10);
        const cruiseA = uTime.mul(cruiseRate).mul(swimDir).add(fS.mul(40));
        const cruiseR = fS.mul(9).add(5);
        const fishCenter = vec3(
            fO.x.add(cos(cruiseA).mul(cruiseR)),
            fO.y.add(sin(uTime.mul(0.4).add(fS.mul(17))).mul(1.6)),
            fO.z.add(sin(cruiseA).mul(cruiseR)),
        );
        // WAVE 3 SWIM (replaces the standing-wave flap, whose one phase for the whole body
        // was the loudest "not alive" signal there was). Three coupled terms, all closed-form
        // per-instance, all vertex-ALU, keyed on positionGeometry.z (the instancing-safe
        // local axis — r181's InstanceNode rewrites positionLocal before positionNode runs):
        //   1. TAIL BEAT COUPLED TO SPEED: linear speed is cruiseR*cruiseRate; beat frequency
        //      is ~1.3 beats per body-length of travel + an idle floor. The old code beat at
        //      0.8–1.1 Hz while covering 0.06–0.21 body-lengths/s — treading water furiously.
        //   2. TRAVELLING wave: the phase LAGS down the body (-z), so the bend propagates
        //      nose to tail; amplitude grows tailward with a small head-sway floor.
        //   3. BANKING: a body in a constant-radius turn rolls INTO it; bank angle rides
        //      v*omega (centripetal), signed by the circle's handedness.
        const bodyLen = fScale.mul(4.35);
        const vLin = cruiseR.mul(cruiseRate);
        const beatHz = vLin.div(bodyLen).mul(1.3).add(0.4);
        const swimPhase = uTime.mul(beatHz.mul(Math.PI * 2)).add(fS.mul(60));
        const waveAmp = clamp(float(0.9).sub(positionGeometry.z).mul(0.30), 0.06, 1.0);
        const wave = sin(swimPhase.sub(positionGeometry.z.mul(1.6)).mul(swimDir));
        const lx = positionGeometry.x.add(wave.mul(waveAmp).mul(0.22));
        const bank = vLin.mul(cruiseRate).mul(0.55).mul(swimDir.negate());
        const cb = cos(bank);
        const sb = sin(bank);
        const bx = lx.mul(cb).add(positionGeometry.y.mul(sb));
        const by = positionGeometry.y.mul(cb).sub(lx.mul(sb));
        // Heading = tangent of the cruise circle, so the fish faces where it swims — the
        // tangent flips with the circle's handedness.
        const heading = cruiseA.add(swimDir.mul(Math.PI / 2));
        const ch = cos(heading);
        const sh = sin(heading);
        const lz = positionGeometry.z;
        const rotated = vec3(
            bx.mul(ch).sub(lz.mul(sh)),
            by,
            bx.mul(sh).add(lz.mul(ch)),
        );
        fishMat.positionNode = fishCenter.add(rotated.mul(fScale));
        // WAVE 3 SHADING: still a silhouette-first body, but no longer a FLAT one. The world
        // normal comes from screen-space derivatives (instancing-safe — it needs no normal
        // attribute and survives the vertex-stage swim), the dorsal surface catches a touch
        // of down-welling light, and the whole body hands itself to applyAerial so a distant
        // fish fades into the SAME water colour as everything else instead of staying an
        // ink-black dart at any range.
        const fN = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
        const fDepth = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(120), 0, 1);
        const fBase = mix(vec3(0.045, 0.10, 0.13), vec3(0.02, 0.05, 0.08), fDepth);
        const fDorsal = clamp(fN.y, 0, 1).mul(float(1).sub(fDepth).mul(0.7).add(0.3));
        const fLit = fBase.add(vec3(0.10, 0.22, 0.26).mul(fDorsal));
        fishMat.colorNode = toOutput(applyAerial(fLit, positionWorld));
        fishMat.side = THREE.DoubleSide;
        fishMat.fog = false;
        fishMesh = new THREE.Mesh(fInst, fishMat);
        fishMesh.frustumCulled = false;
        fishMesh.renderOrder = 2;
        fishMesh.name = 'odyssey-world-fish';
        group.add(fishMesh);
        fishGeo.dispose();
    }

    // ── forest ──
    // MEASUREMENT LEVER (see the `forest` option). When off, the scatter never runs, so no
    // chunk is bucketed, no InstancedMesh is built and `treeMat` never reaches a render —
    // zero draws, zero vertex work, zero fill AND zero pipeline compile. Same shape as the
    // `water` gate, and deliberately NOT the deck's asymmetric "built but withheld" shape:
    // the forest's own header law says its cost is VERTEX, so a gate that left the meshes
    // constructed would price the wrong thing.
    //
    // The material graph below is still built unconditionally, exactly as the water's is:
    // TSL nodes are plain JS until a mesh that uses them is rendered, `treeMat` has to stay a
    // `const` NodeMaterial for the fog opt-out lint and the dispose list to keep covering it,
    // and building it on both sides of the pair keeps the gate a small diff with no dangling
    // references. Everything downstream degrades to a no-op through the empty array: the
    // bucket Map stays empty, `treeMeshes` stays empty, and the update loop's gate iterates
    // nothing. `stats.trees` / `stats.forestChunks` then report 0, which is how a run with
    // the flag identifies itself in the boot log.
    const treeGeo = buildTreeGeometry(forestPaint);
    // ⚠️ `forest && !forestV2`: the two forests are ALTERNATIVES, not additive. Built together
    // (the first cut did) the world carries both and the gpu-split pair
    // `forest-v2` minus `no-forest` would price the pair rather than the new system — the
    // measurement the whole wave is gated on, quietly answering the wrong question.
    const trees = (forest && !forestV2)
        ? scatterTrees(relief.sample, {
            cx: -220,
            cz: -620,
            radius: 1750,
            spacing: q.treeSpacing,
            seaLevel: ODYSSEY_SEA_LEVEL,
            snowStart: 640,
        })
        : [];
    const CHUNK = 420;
    const buckets = new Map();
    trees.forEach((t) => {
        const key = `${Math.floor(t.x / CHUNK)}|${Math.floor(t.z / CHUNK)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(t);
    });

    const treeMat = new THREE.MeshBasicNodeMaterial();
    const gShade = attribute('aShade', 'float');
    const gPhase = attribute('aPhase', 'float');
    const gTint = attribute('aTint', 'float');
    const swayMask = clamp(positionGeometry.y.div(4.5), 0, 1);
    const gust = sin(uTime.mul(1.4).add(gPhase).add(positionWorld.x.mul(0.006)))
        .mul(0.10).mul(swayMask.mul(swayMask));
    // positionLocal, not positionGeometry: setupPosition() applies the instance matrix into
    // positionLocal and then positionNode REPLACES it, so building from the raw attribute
    // would discard the instance transform entirely.
    treeMat.positionNode = positionLocal.add(vec3(gust, 0, gust.mul(0.55)));
    const treeBase = mix(
        vec3(0.050, 0.105, 0.070),
        vec3(0.235, 0.375, 0.175),
        gShade.mul(0.75).add(gTint.mul(0.25)),
    );
    // THE INCUMBENT: one wrap-ish term on facet normals, with the vertical gradient baked
    // into the ALBEDO via `aShade`. Kept intact so the probe is an A/B and not a rewrite.
    const treeIncumbent = treeBase.mul(
        uSunColour.mul(max(dot(normalWorld, uSunDir), 0).mul(0.35).add(0.55))
            .add(uShadowTint.mul(0.30)),
    );
    // THE WAVE 0b PROBE. Built as plain expressions with no `.toVar()` anywhere: nothing here
    // is shared with `positionNode`, and the field's logged r181 trap (a var's assignment is
    // emitted at its FIRST build site, and positionNode builds before varyings) is cheapest to
    // avoid entirely. A few duplicated ALU beats a silent zero.
    //
    // Height in crown, local space — so it is identical on every instance regardless of the
    // per-tree scale, and it separates trunk from canopy at the one clean seam the geometry
    // has (the canopy's first tier starts exactly at trunkH = 0.9).
    const ftHeight = clamp(positionGeometry.y.sub(0.9).div(3.05), 0, 1);
    const ftV = normalize(cameraPosition.sub(positionWorld));
    // Wrap diffuse on the BAKED BLOB NORMAL (`normalWorld` carries it once buildTreeGeometry
    // baked it, already rotated into world space by the instance matrix — trees only rotate
    // about Y, so a blob normal field stays valid under instancing).
    const ftWrap = clamp(dot(normalWorld, uSunDir).add(FOREST_WRAP).div(1 + FOREST_WRAP), 0, 1);
    const ftBand = smoothstep(float(FOREST_BAND_LO), float(FOREST_BAND_HI), ftWrap);
    // Albedo: one dominant crown hue per tree, red-brown trunk below the seam.
    const ftAlbedo = mix(
        vec3(...FOREST_TRUNK),
        mix(vec3(...FOREST_CROWN_A), vec3(...FOREST_CROWN_B), gTint),
        smoothstep(float(0.80), float(0.95), positionGeometry.y),
    );
    // The measured shadow law, applied to whatever the albedo happens to be: pull AWAY from
    // its own luma (saturation gain > 1) and scale the value down. Clamped at zero because a
    // gain above 1 extrapolates past the endpoint and a future desaturated hue could cross it.
    const ftLuma = dot(ftAlbedo, vec3(0.2126, 0.7152, 0.0722));
    const ftShade = max(
        mix(vec3(ftLuma, ftLuma, ftLuma), ftAlbedo, float(FOREST_SHADE_SAT)),
        vec3(0, 0, 0),
    );
    // QUANTISED, not ramped. A linear height ramp reads as an airbrush gradient; §1b R1 and
    // Oga's rule both want the dark interior to be ONE CONNECTED MASS with a readable edge,
    // which is a soft step, not a slope. Measured first as a ramp and changed on the capture.
    const ftOcc = mix(
        float(FOREST_OCCLUSION_FLOOR),
        float(1),
        smoothstep(float(FOREST_OCC_LO), float(FOREST_OCC_HI), ftHeight),
    );
    const ftBody = mix(ftShade, ftAlbedo, ftBand).mul(ftOcc);
    // Two light colours, selected by the same band — so the shade band is a LIT colour, the
    // way the Witness tints its ambient rather than darkening toward black.
    const ftLight = mix(
        uSunColour.mul(FOREST_SHADE_VALUE)
            .add(uShadowTint.mul(FOREST_AMBIENT_TINT))
            .add(uSkyHorizon.mul(FOREST_SKY_FILL)),
        uSunColour.mul(FOREST_SUN_GAIN),
        ftBand,
    );
    // ⚠️ SIGN, the same one the cloud field documents: `uSunDir` points TOWARD the sun and
    // `ftV` points fragment->eye, so looking INTO the sun drives dot(ftV, uSunDir) toward -1.
    // Negating first makes the term fire on backlit crowns; without it this would light the
    // anti-sun side of every tree, which is where a design draft of the field's Mie ended up.
    const ftBack = clamp(dot(ftV, uSunDir).mul(-1), 0, 1).pow(2.5);
    // Weighted to the rim and to the upper crown — the thin parts light passes through.
    const ftRim = float(1).sub(abs(dot(normalWorld, ftV)));
    const treeProbe = ftBody.mul(ftLight)
        .add(uSunColour.mul(ftBack.mul(ftRim).mul(ftHeight).mul(FOREST_BACKLIT_GAIN)));
    // A JS-level branch, not a TSL `If`: only the selected graph is ever built into the
    // shader, and the other stays plain JS objects costing nothing.
    treeMat.colorNode = toOutput(applyAerial(
        forestPaint ? treeProbe : treeIncumbent,
        positionWorld,
    ));

    const treeMeshes = [];
    let forestV2Stats = null;
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    buckets.forEach((list) => {
        const n = list.length;
        const geo = treeGeo.clone();
        const aPhase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        const aTint = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        const mesh = new THREE.InstancedMesh(geo, treeMat, n);
        let cx = 0;
        let cz = 0;
        let maxY = -Infinity;
        let minY = Infinity;
        list.forEach((t, i) => {
            quat.setFromAxisAngle(axis, t.rot);
            pos.set(t.x, t.y, t.z);
            scl.set(t.scale, t.scale * (0.85 + (t.tint * 0.4)), t.scale);
            mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
            aPhase.setX(i, t.rot * 3.7);
            aTint.setX(i, t.tint);
            cx += t.x;
            cz += t.z;
            maxY = Math.max(maxY, t.y + (t.scale * 5));
            minY = Math.min(minY, t.y);
        });
        geo.setAttribute('aPhase', aPhase);
        geo.setAttribute('aTint', aTint);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.boundingSphere = new THREE.Sphere(
            new THREE.Vector3(cx / n, (minY + maxY) / 2, cz / n),
            (CHUNK * 0.75) + ((maxY - minY) / 2) + 40,
        );
        mesh.frustumCulled = true;
        mesh.userData.centre = new THREE.Vector2(cx / n, cz / n);
        mesh.name = 'odyssey-world-forest-chunk';
        group.add(mesh);
        treeMeshes.push(mesh);
    });

    // ── forest v2: the zoned species roster — THE SHIPPED FOREST since 2026-08-14 ─────
    //
    // Default since the Wave 5 swap; the incumbent above is retained per ADR-0015 behind
    // `?odysseyWorldForestV1=1`, one flag from restoration.
    //
    // ONE MATERIAL for every species and every LOD. Everything a species differs by rides
    // per-INSTANCE attributes — the `aMaxY`/`aSway` consolidation trick the conifer belt and
    // Ch3's flora both use here — because five species x three tiers as five materials would
    // be fifteen compiled pipelines for one visual idea.
    // ⚠️ PACKED, BECAUSE WEBGPU ALLOWS ONLY 8 VERTEX BUFFERS. The first cut used ten separate
    // attributes and every pipeline failed to create — "Vertex buffer count (10) exceeds the
    // maximum number of vertex buffers (8)" — rendering a BLACK frame. It is a hard device
    // limit, invisible to every headless test, and only a capture found it.
    //   aVert       (vec4, per vertex)   x AO · y height-in-crown · z crown mask · w height01
    //   aCrownSnow  (vec4, per instance) rgb crown colour · a snow amount
    //   aShadePhase (vec4, per instance) rgb shade colour · a wind phase
    //   aTrunk      (vec3, per instance) trunk colour
    // Six buffers plus the instance matrix — comfortably inside the limit.
    const fvVert = attribute('aVert', 'vec4');
    const fvCrownSnow = attribute('aCrownSnow', 'vec4');
    const fvShadePhase = attribute('aShadePhase', 'vec4');
    const fvTrunk = attribute('aTrunk', 'vec3');
    const fvCol = fvVert;
    const fvIsCrown = fvVert.z;
    const fvH01 = fvVert.w;
    const fvCrown = fvCrownSnow.xyz;
    const fvShade = fvShadePhase.xyz;
    const fvSnow = fvCrownSnow.w;
    const fvPhase = fvShadePhase.w;

    const forestV2Mat = new THREE.MeshBasicNodeMaterial();
    // WIND. Height above GROUND squared, so trunks stay planted and crowns lean; phase is
    // constant per tree (from its own instanced attribute, never per-vertex) or a near tree
    // shears — the framing-spruces rule. The two world terms make gust FRONTS cross the
    // forest rather than the whole island pulsing in lockstep ("rhythm, not a pulse").
    const fvMask = clamp(fvH01, 0, 1);
    const fvGust = sin(
        uTime.mul(1.05).add(fvPhase)
            .add(positionWorld.x.mul(0.0042)).add(positionWorld.z.mul(0.0031)),
    ).mul(0.5).add(
        sin(uTime.mul(0.61).add(fvPhase.mul(1.7)).add(positionWorld.x.mul(0.0017))).mul(0.5),
    ).mul(0.085)
        .mul(fvMask.mul(fvMask));
    // positionLocal, not positionGeometry: setupPosition() applies the instance matrix into
    // positionLocal and positionNode REPLACES it (the file's own header law).
    forestV2Mat.positionNode = positionLocal.add(vec3(fvGust, 0, fvGust.mul(0.55)));

    // Snow rides the crown's upper surface on the SAME shell — no second mesh, so nothing can
    // swim or z-fight against its own tree under wind.
    const fvSnowMix = clamp(fvSnow.mul(smoothstep(float(0.30), float(0.85), fvCol.y)), 0, 1);
    const fvCrownLit = mix(fvCrown, vec3(0.78, 0.83, 0.90), fvSnowMix);
    const fvCrownShade = mix(fvShade, vec3(0.42, 0.48, 0.58), fvSnowMix);
    const fvAlbedo = mix(fvTrunk, fvCrownLit, fvIsCrown);
    // The trunk's own shade follows the same law rather than a second authored colour.
    const fvShadeCol = mix(fvTrunk.mul(0.52), fvCrownShade, fvIsCrown);

    const fvWrap = clamp(dot(normalWorld, uSunDir).add(FOREST_WRAP).div(1 + FOREST_WRAP), 0, 1);
    // AO shifts the band THRESHOLD, never the colour — the cloud field's grammar. Darkening by
    // AO is how a stylised canopy turns muddy; moving the threshold keeps every pixel on one
    // of the two authored tones.
    // ⚠️ THREE TONES, NOT TWO — AND THE TWO-TONE VERSION IS WHY THE FOREST READ AS A SHEET.
    //
    // The game's camera looks DOWN at the forest, so the canopy TOP is the dominant surface,
    // and on a blob normal field every top faces up. With the sun at its authored angle a
    // canopy top computes wrap ~0.66 while the band ENDED at 0.58 — every top was already past
    // the ramp, pinned to the lit tone, and 15,412 crowns rendered as one flat green sheet.
    //
    // A first attempt jittered each tree's threshold to break that up. It measured NOTHING
    // (crown-scale mosaic 28.75 -> 29.03, inside noise) for the reason the numbers make
    // obvious in hindsight: **moving a threshold the pixels have already passed changes
    // nothing.** The band was saturated, not misplaced.
    //
    // So the ramp gains a third step and the upper transition is placed where canopy tops
    // ACTUALLY sit. §1b R1 asks for 2-3 quantised steps and this is the third: sides read
    // shade, the turn of the crown reads mid, and only the sun-facing top reaches full light.
    // The per-tree jitter now rides the UPPER threshold, where it decides how much of each
    // crown tips into the lit tone — so neighbouring trees separate into distinct tones and
    // the sheet becomes the mosaic the reference island's aerial frame shows.
    const fvTreeRand = fract(fvPhase.mul(0.1591549)).sub(0.5).mul(FOREST_BAND_JITTER);
    // WIND-LINES (Wave 6): the gust front expressed in the LIGHTING as well as the vertex
    // sway — a slow ripple of the upper band threshold travelling the same direction as the
    // displacement gusts, so light sweeps across the canopy the way the 80.lv Ghibli-island
    // breakdown animates its vegetation highlights. Three ALU; the amplitude is a fraction of
    // the band jitter so it can never flip a crown across a whole tone.
    const fvWindLine = sin(
        uTime.mul(0.8).add(positionWorld.x.mul(0.011)).add(positionWorld.z.mul(0.007)),
    ).mul(0.045);
    // AO shifts the band THRESHOLD, never the colour — the cloud field's grammar. Darkening by
    // AO is how a stylised canopy turns muddy; moving the threshold keeps every pixel on one
    // of the authored tones.
    const fvBandLo = smoothstep(float(FOREST_BAND_LO).sub(fvCol.x.mul(0.10)), float(FOREST_BAND_MID), fvWrap);
    const fvBandHi = smoothstep(
        float(FOREST_BAND_HI_LO).add(fvTreeRand).add(fvWindLine),
        float(FOREST_BAND_HI).add(fvTreeRand).add(fvWindLine),
        fvWrap,
    );
    const fvOcc = mix(
        float(FOREST_OCCLUSION_FLOOR),
        float(1),
        smoothstep(float(FOREST_OCC_LO), float(FOREST_OCC_HI), fvCol.y),
    );
    // The mid tone is DERIVED from the species' own two colours rather than authored a third
    // time — the same discipline as the shade recipe, so a palette edit cannot desynchronise
    // three colours from each other.
    const fvMidTone = mix(fvShadeCol, fvAlbedo, float(FOREST_MID_TONE));
    // THE DISTANCE COLLAPSE (§1b R9 + Hoa's law), and it is the paint's half of what the LOD
    // chain does for geometry: distant trees drop BANDS, not just polygons. The references
    // measured it — far foliage desaturates 2-3x, lifts, and converges toward the sky — and
    // Firewatch says the flattening is the POINT ("it flattens the shapes too... which is
    // actually what we want"). Near a crown carries three tones; by FLAT_FAR it carries one
    // (the mid tone), and `applyAerial` then does the atmospheric lift on top. Without this,
    // every distant crown still sparkles with per-tree band structure the eye reads as noise,
    // which is exactly the "distant creatures still flat dark polygons" class of defect.
    const fvEyeDist = length(cameraPosition.sub(positionWorld));
    const fvFlat = smoothstep(float(FOREST_FLAT_NEAR), float(FOREST_FLAT_FAR), fvEyeDist);
    const fvThree = mix(mix(fvShadeCol, fvMidTone, fvBandLo), fvAlbedo, fvBandHi);
    // PRE-SATURATED at distance, because the desaturators downstream cannot be retuned from
    // here: `applyAerial` hazes toward the sky for the whole world and the grade applies
    // `outputSaturation 0.72` after that. Measured against §1b R9 the far forest came back at
    // 4.5-4.6x desaturation versus the references' 2-3x, and softening the flatten's own sky
    // pull moved it by NOISE (4.51 -> 4.61) — the pull was never the culprit. So the far tone
    // leans AWAY from its luma before the haze leans it back; the two roughly cancel into the
    // measured band. The same overshoot-for-the-grade law as every palette in this file, in
    // saturation rather than value.
    const fvFarLuma = dot(fvMidTone, vec3(0.2126, 0.7152, 0.0722));
    const fvFarTone = max(
        mix(vec3(fvFarLuma, fvFarLuma, fvFarLuma), fvMidTone, float(FOREST_FAR_PRESAT)),
        vec3(0, 0, 0),
    );
    const fvBody = mix(fvThree, fvFarTone, fvFlat).mul(mix(fvOcc, float(1), fvFlat));
    // ⚠️ THE LIGHT MUST NOT DIM IN SHADE. The measured shade/lit VALUE RATIO already lives in
    // `aShade`, computed on the CPU by the tested `shadeColourFor`. Dimming the ambient here
    // as well would spend that ratio twice — precisely the Wave 0b defect that measured a
    // near-black p10 = 0.0. The ambient is therefore sun-magnitude and only HUE-shifted toward
    // the sky, which is what a shadow lit by the sky actually is.
    // The light term flattens with the same ramp: a far crown is lit by ONE colour, not by a
    // per-fragment band choice.
    const fvLight = mix(
        mix(mix(uSunColour, uSkyHorizon, float(0.55)), uSunColour, fvBandLo),
        // 0.12, down from a first-cut 0.28: measured against §1b R9 the far forest came back
        // at 4.5x desaturation against the references' 2-3x — the flatten and the aerial haze
        // both pull toward sky, so the flatten's own pull must be gentle or they compound.
        mix(uSunColour, uSkyHorizon, float(0.12)),
        fvFlat,
    );
    const fvView = normalize(cameraPosition.sub(positionWorld));
    // Sign as documented for the cloud field: uSunDir points TOWARD the sun and fvView points
    // fragment->eye, so looking INTO the sun drives the dot toward -1.
    const fvBack = clamp(dot(fvView, uSunDir).mul(-1), 0, 1).pow(2.5);
    const fvRim = float(1).sub(abs(dot(normalWorld, fvView)));
    const forestV2Col = fvBody.mul(fvLight)
        .add(uSunColour.mul(fvBack.mul(fvRim).mul(fvCol.y).mul(FOREST_BACKLIT_GAIN)));
    forestV2Mat.colorNode = toOutput(applyAerial(forestV2Col, positionWorld));

    // `forest &&`, not `forestV2` alone: the measurement lever must switch off the WHOLE
    // forest whichever one is mounted, or `?odysseyWorldNoForest=1` prices a half-empty world
    // and the differential silently means something else.
    if (forest && forestV2) {
        const zoned = scatterZonedForest(relief.sample, {
            spacing: q.treeSpacing,
            seaLevel: ODYSSEY_SEA_LEVEL,
            rail: railSamples,
            visibilityCull,
            forceLod: forestLod,
            lodDistance: forestLodDistanceForTier(qualityTier),
        });
        // One geometry per (species, LOD) — growth stages ride the instance matrix, because a
        // stage is defined as pure height/width multipliers (see the scatter's header).
        // ⚠️ THREE SEEDED VARIANTS PER (SPECIES, LOD), NOT ONE. The first cut cached a single
        // geometry (seed 4919), which meant every tree of a species+LOD in the entire world
        // was LITERALLY THE SAME MESH rotated — the "straight stock and the canopys" monotony
        // the owner named, at the level where no palette work could touch it. Each bucket now
        // picks one variant by its own key hash: draws stay identical (an InstancedMesh has
        // one geometry either way), neighbouring chunks stop repeating, and within a chunk
        // repetition hides behind rotation, scale, lean and density — the Firewatch recipe.
        const FOREST_GEO_VARIANTS = 3;
        const geoCache = new Map();
        const geoFor = (speciesId, lod, variant) => {
            const cacheKey = `${speciesId}|${lod}|${variant}`;
            if (!geoCache.has(cacheKey)) {
                const fSpec = getForestSpecies(speciesId);
                const mature = fSpec.stages.find((st) => st.id === 'mature') ?? fSpec.stages[0];
                geoCache.set(cacheKey, buildForestTreeGeometry(fSpec, mature, lod, 4919 + (variant * 104729)));
            }
            return geoCache.get(cacheKey);
        };
        const variantOf = (key) => {
            let h = 2166136261;
            for (let ci = 0; ci < key.length; ci += 1) {
                h = Math.imul(h ^ key.charCodeAt(ci), 16777619);
            }
            return (h >>> 0) % FOREST_GEO_VARIANTS;
        };
        const fm4 = new THREE.Matrix4();
        const fq = new THREE.Quaternion();
        const fEuler = new THREE.Euler();
        const fp = new THREE.Vector3();
        const fs = new THREE.Vector3();
        zoned.buckets.forEach((bucket) => {
            const n = bucket.items.length;
            const src = geoFor(bucket.speciesId, bucket.lod, variantOf(bucket.key));
            const geo = src.clone();
            const aCrownSnow = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
            const aShadePhase = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
            const aTrunk = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
            const mesh = new THREE.InstancedMesh(geo, forestV2Mat, n);
            const trunkCol = getForestSpecies(bucket.speciesId).trunk;
            let cx = 0;
            let cz = 0;
            let maxY = -Infinity;
            let minY = Infinity;
            bucket.items.forEach((t, i) => {
                // Lean: a few degrees of per-tree tilt, from the scatter. The cheapest possible
                // structural variety — it costs nothing and kills the surveyor's-row read that
                // perfectly vertical trunks give a hillside.
                fEuler.set(t.leanX ?? 0, t.rot, t.leanZ ?? 0, 'YXZ');
                fq.setFromEuler(fEuler);
                fp.set(t.x, t.y, t.z);
                // Non-uniform: the growth stage IS a proportion change.
                fs.set(t.scaleXZ * FOREST_V2_SCALE, t.scaleY * FOREST_V2_SCALE, t.scaleXZ * FOREST_V2_SCALE);
                mesh.setMatrixAt(i, fm4.compose(fp, fq, fs));
                aCrownSnow.setXYZW(i, t.crown[0], t.crown[1], t.crown[2], t.snow);
                aShadePhase.setXYZW(i, t.shade[0], t.shade[1], t.shade[2], t.rot * 3.7);
                aTrunk.setXYZ(i, trunkCol[0], trunkCol[1], trunkCol[2]);
                cx += t.x;
                cz += t.z;
                maxY = Math.max(maxY, t.y + (src.userData.forest.totalH * t.scaleY * FOREST_V2_SCALE));
                minY = Math.min(minY, t.y);
            });
            geo.setAttribute('aCrownSnow', aCrownSnow);
            geo.setAttribute('aShadePhase', aShadePhase);
            geo.setAttribute('aTrunk', aTrunk);
            mesh.instanceMatrix.needsUpdate = true;
            // The bucket's own edge, not a constant: mid and far buckets are 2x and 4x wider
            // than the hero grid, and a sphere sized for 420 u would cull half of one away.
            mesh.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(cx / n, (minY + maxY) / 2, cz / n),
                (bucket.edge * 0.75) + ((maxY - minY) / 2) + 40,
            );
            mesh.frustumCulled = true;
            mesh.userData.centre = new THREE.Vector2(cx / n, cz / n);
            // Keeps `?worldOnly=forest` working, which is the compile-bisect lever.
            mesh.name = `odyssey-world-forest-v2-${bucket.lod}`;
            group.add(mesh);
            treeMeshes.push(mesh);
        });
        forestV2Stats = zoned.stats;
        geoCache.forEach((cached) => cached.dispose());
    }

    const t2 = (typeof performance !== 'undefined' ? performance.now() : 0);
    // The game puts a per-CHAPTER FogExp2 on the scene. Left on, it saturates the sky dome —
    // 3,600 units out is ~100% fogged at any density the chapters use — so the colour script
    // was never once visible in-game, and the ground got double-fogged on top of applyAerial.
    // These four materials carry their own aerial perspective; the scene fog is not theirs.
    [groundMat, waterMat, skyMat, treeMat, forestV2Mat, cloudMat, heroMat, fieldMat].forEach((m) => { m.fog = false; });

    // What the scene fog SHOULD be, for everything the world does not draw (the path ribbon,
    // the level orbs, neighbouring chapters). Exposed so one horizon drives the whole frame
    // instead of the chapter profiles of chapters that no longer exist. Colour is pre-scaled
    // into the same output space the world's own materials write.
    const fogState = { color: new THREE.Color(), density: 0.0004 };
    // FogExp2 is 1-exp(-(d*z)^2); applyAerial is 1-exp(-K*z). Equal at z = FOG_MATCH_DISTANCE.
    const FOG_MATCH_DISTANCE = 1200;

    // LIVE STATE, for instruments only — never read by the renderer itself.
    // `uSubmerged` and the active colour-script keyframe are computed every frame and were
    // unreadable from outside, so a capture could not distinguish "the world believes it is
    // underwater" from "the world believes it is in air". That is precisely the question an
    // apparently-wrong submerged frame asks, and answering it by re-deriving the formula in
    // the harness would let the two copies drift.
    // `lodCenter` and `eyeY` join them for the same reason: the clipmap's square rings are
    // centred on the RAIL GROUND TRACK, not on the eye, so nothing outside could work out
    // where a ring boundary falls in a captured frame without re-deriving the offset.
    const state = {
        submerged: 0, scriptName: '', actT: 0, lodCenter: { x: 0, z: 0 }, eyeY: null,
    };

    const stats = {
        quality,
        groundTriangles: ground.triangles,
        waterTriangles: water.triangles,
        reach: ground.reach,
        trees: forestV2Stats ? forestV2Stats.trees : trees.length,
        forestChunks: treeMeshes.length,
        // Present only on the v2 path, so a boot log says which forest is on screen.
        forestV2: forestV2Stats,
        materials: 4 + (clouds ? 1 : 0) + (heroes ? 1 : 0),
        heroClouds: heroes ? ODYSSEY_HERO_CLOUD_SPECS.length : 0,
        heroTriangles: heroes ? heroBuild.triangles : 0,
        cloudField,
        cloudFieldMasses: fieldProbeBuild ? fieldProbeBuild.masses : 0,
        cloudFieldTriangles: fieldProbeBuild ? fieldProbeBuild.triangles : 0,
        applyExposure,
        outputScale,
        outputSaturation,
        clouds,
        godRays: rayCount > 2 ? rayCount : 0,
        motes: moteMesh ? 640 : 0,
        fish: fishMesh ? 110 : 0,
        skyRadius: domeRadius,
        bakeMs: { relief: +(t1 - t0).toFixed(1), total: +(t2 - t0).toFixed(1) },
    };

    return {
        group,
        stats,
        state,
        heightAt: relief.sample,
        fog: fogState,
        /**
         * THE DEPARTURE FADE (Wave 1B). `setDepartureFade(t, colour)` pulls the whole world
         * toward `colour` as t goes 0 -> 1, so Act II recedes instead of being switched off.
         * The caller owns the schedule; see OdysseyBoardController, which derives it from the
         * act edge so it completes BEFORE the visibility gate fires.
         */
        setDepartureFade(t, colour = null) {
            uWorldFade.value = Math.min(Math.max(t, 0), 1);
            if (colour) uWorldFadeColour.value.copy(colour);
        },
        /**
         * ATMOSPHERIC THINNING (Wave 3 / F3). `setAtmosphericThin(t)` collapses the cloud
         * field's paint toward a flat haze family and shrinks each mass toward its centre
         * as t goes 0 -> 1. The caller owns the schedule (`worldAtmosphericThin`, beside
         * the departure fade in odyssey-world-act-gate.js). Touches ONLY the cloud field.
         */
        setAtmosphericThin(t) {
            uWorldThin.value = Math.min(Math.max(t, 0), 1);
        },
        /**
         * THE ACT'S CLOUD PALETTE, as live TSL nodes — shared, never copied.
         *
         * The seam cloud bank is built by the BOARD, in its own module, with its own material,
         * and until 2026-08-14 it carried its own authored tones. That was survivable while
         * everything was soft FBM; once the field became sculpted poster cumulus the bank was
         * the last system speaking the old language, and a frame at p=0.63 shows both at once
         * — the exact "two cloud models in one sky" complaint that retired the heroes, with
         * the roles reversed.
         *
         * Handing over the NODES rather than copying the numbers is what makes drift
         * impossible: these are the very expressions the deck and the field shade with, driven
         * by the same colour-script uniforms, so a palette edit reaches the bank by
         * construction and no second tuning pass can disagree with the first. (The alternative
         * — re-deriving the same arithmetic CPU-side for the bank — is the "four different
         * answers to one contract" disease `odyssey-world-height.js` documents.)
         */
        cloudPalette: {
            top: cloudTop,
            shade: cloudShade,
            underLit: cloudUnderLit,
            underShade: cloudUnderShade,
            skyHorizon: uSkyHorizon,
            sunColour: uSunColour,
        },
        /**
         * @param {number} time seconds
         * @param {{x:number,y:number,z:number}} railPoint the GROUND-TRACK point — never the
         *   camera eye. Centring the lattice on the eye makes the ground change shape when
         *   only the camera moves (plan §3.1 point 4).
         * @param {number} progress 0..1 across Act II, for the colour script
         */
        update(time, railPoint, progress, eyeY = null) {
            uTime.value = time;
            uLodCenter.value.set(railPoint.x, railPoint.z);
            state.lodCenter.x = railPoint.x;
            state.lodCenter.z = railPoint.z;
            state.eyeY = eyeY;
            const scriptP = 0.05 + (Math.max(0, Math.min(1, progress)) * 0.9);
            const cs = sampleColourScript(scriptP);
            uSkyHorizon.value.setRGB(...cs.skyHorizon);
            uSkyZenith.value.setRGB(...cs.skyZenith);
            uSunColour.value.setRGB(...cs.sun);
            uShadowTint.value.setRGB(...cs.groundShadow);
            uAerialK.value = cs.fogDensity;
            // The depth plates come from the SCRIPT, not from constants beside it: shallow is
            // the shallows keyframe's body, mid is this sample's own body, deep is the abyss.
            // One table owns the ocean's colour, so a palette edit cannot desync the banding.
            // The MID plate's sample is clamped to the script's last WATER keyframe: past it
            // the horizon belongs to the breach's air sky, and the plates may never leave the
            // water table (see WATER_SCRIPT_END above).
            const csWater = scriptP > WATER_SCRIPT_END
                ? sampleColourScript(WATER_SCRIPT_END)
                : cs;
            uWaterShallow.value.setRGB(...SHALLOWS_BODY);
            uWaterMid.value.setRGB(...csWater.skyHorizon);
            uWaterDeep.value.setRGB(...ABYSS_BODY);
            uExposure.value = cs.exposure;
            const fogScale = (applyExposure ? cs.exposure : 1) * outputScale;
            const fogR = cs.skyHorizon[0] * fogScale;
            const fogG = cs.skyHorizon[1] * fogScale;
            const fogB = cs.skyHorizon[2] * fogScale;
            const fogL = (0.2126 * fogR) + (0.7152 * fogG) + (0.0722 * fogB);
            fogState.color.setRGB(
                fogL + ((fogR - fogL) * outputSaturation),
                fogL + ((fogG - fogL) * outputSaturation),
                fogL + ((fogB - fogL) * outputSaturation),
            );
            fogState.density = Math.sqrt(cs.fogDensity / FOG_MATCH_DISTANCE);
            // SUBMERSION IS THE EYE'S BUSINESS, NOT THE RAIL'S (MEASURED 2026-08-13).
            // This read `railPoint.y + 16`, but the eye does not sit above the rail: on a
            // climbing rail `computeFollowFrame` pulls it BACKWARDS along the tangent, so it
            // trails BELOW its rail point — measured -22.6 u at p=0.15 easing to -7.2 at
            // p=0.20. Bisected against the shipped spline, the rail crosses sea level at
            // p=0.19182 and the EYE at p=0.20023, while this expression reached zero at
            // p=0.18141. So for 0.0188 of progress — 17% of chapter 2, the entire final ascent
            // to the breach — the world rendered AIR while the camera was still under water:
            // air sky dome, air aerial perspective, cloud deck on, rays/motes/fish switched
            // off, and the water plane showing its topside from below.
            // Callers pass the real eye height; the old rail expression remains as the
            // fallback so no existing call site changes behaviour by omission.
            // The band widens 9 -> 14 u because the eye climbs ~11 u per 0.01 of progress near
            // the surface: 9 u resolved in under a hundredth of progress, which pops.
            const submergedRefY = Number.isFinite(eyeY) ? eyeY : (railPoint.y + 16);
            uSubmerged.value = Math.max(0, Math.min(
                1,
                (ODYSSEY_SEA_LEVEL + 2.0 - submergedRefY) / 14,
            ));
            uEyeDepth.value = Math.max(0, Math.min(1, (ODYSSEY_SEA_LEVEL - submergedRefY) / 140));
            uBreachNear.value = Math.max(0, 1 - (Math.abs(ODYSSEY_SEA_LEVEL - submergedRefY) / 3));
            // The deck's top read is only reachable once the eye is within the billow band:
            // deck plane 660, billow reaches ~116 below it, and `fromAboveF` needs another
            // 60 u before it leaves zero. Below that the GPU skips the whole top stack.
            uCloudTopLit.value = submergedRefY > (CLOUD_DECK_Y - 116 - 60) ? 1 : 0;
            // Publish what this frame decided, for instruments (see `state` above). Written
            // LAST so a reader can never observe a half-updated frame.
            state.submerged = uSubmerged.value;
            state.scriptName = cs.name;
            state.actT = progress;
            // WAVE 0's MEASURED DEFECT. `odyssey-world-clouds` was submitted and rasterised
            // at every fully-submerged station with its alpha provably zero (three texture
            // fetches per covered pixel of a sky-covering sheet, on the lane that measures
            // 7.73 ms), and the god-rays are the same bug inverted above the waterline. A
            // multiply by a zero uniform is NOT dead-code-eliminated — the repo has that
            // lesson logged — so the gate has to be a `visible` write on the CPU.
            // `authored()` AND-s in the `?worldOnly=` filter's intent. EVERY per-frame
            // `.visible` write in this update loop silently overrode that filter, so a mesh
            // the bisect lever had switched OFF came back on the next frame — the sky and
            // ground obeyed it (they have no per-frame write) while the clouds and the forest
            // never did. Found while trying to isolate one forest LOD tier for a wind capture.
            const authored = (mesh) => mesh.userData.filterVisible !== false;
            if (cloudMesh) cloudMesh.visible = authored(cloudMesh) && clouds && uSubmerged.value < 0.999;
            if (heroMesh) heroMesh.visible = authored(heroMesh) && heroes && uSubmerged.value < 0.999;
            // Same underwater gate as the heroes — the probe shares their material and their
            // altitude band, so it must share their CPU `.visible` write too.
            if (fieldProbeMesh) {
                fieldProbeMesh.visible = authored(fieldProbeMesh) && uSubmerged.value < 0.999;
            }
            // THE FOREST IS SUBMITTED UNDER WATER AND CANNOT BE SEEN (MEASURED 2026-08-13).
            // The trees are legitimately the far SHORE -- scatterTrees rejects any site below
            // seaLevel + 3, and the lowest trunk seats at y=290.3 against sea level 287.31, so
            // none of this geometry is ever underwater. But while the eye is submerged every one
            // of them is occluded: tracing eye->treetop rays to their y = SEA_LEVEL crossing and
            // evaluating the water's own opacity there gives, at p=0.174, 2,057 hidden by opaque
            // water and 13,355 by terrain with ZERO potentially visible; at p=0.16, 841 / 14,569
            // and 2, both of which still sit behind water at 0.75 opacity a kilometre out. It
            // cannot be otherwise: for an eye D below the surface and a treetop T above it at
            // range X, the ray meets the water plane at X*D/(D+T) < X, always.
            // Meanwhile 5-13 chunks pass the frustum, submitting 1,537-4,697 tree instances and
            // 46k-141k triangles to be shaded and painted over -- 11 of the 45 draws measured at
            // p=0.16 are forest. A CPU visible gate is required: multiplying by a zero uniform
            // would not remove the draw.
            // NOTE the draw count changes, so the p=0.16 cell must be RE-BASELINED; a pair
            // across this change is not content-matched and cannot be compared.
            if (rayMesh) rayMesh.visible = uSubmerged.value > 0.001;
            if (moteMesh) moteMesh.visible = uSubmerged.value > 0.001;
            if (fishMesh) fishMesh.visible = uSubmerged.value > 0.001;
            const forestDrawable = uSubmerged.value < 0.999;
            for (let i = 0; i < treeMeshes.length; i += 1) {
                const c = treeMeshes[i].userData.centre;
                // ⚠️ AND-ed WITH THE AUTHORED FLAG, because this per-frame write silently
                // DEFEATED the `?worldOnly=` mesh filter. That lever sets `.visible` once at
                // mount; this loop overwrote it on the very next frame, so the forest was
                // unhideable and every `?worldOnly=<not-forest>` bisect quietly kept a whole
                // forest in the frame. That is the repo's own worst failure mode — a lever
                // that reports innocence rather than absence — and it was found while trying
                // to isolate one LOD tier for a wind capture.
                treeMeshes[i].visible = authored(treeMeshes[i]) && forestDrawable
                    && Math.hypot(c.x - railPoint.x, c.y - railPoint.z) < 1450;
            }
        },
        dispose() {
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
            // heroMat included 2026-08-14: it was missing from this list for as long as the
            // heroes shipped, leaking the compiled hero material on every world dispose; with
            // the heroes retired it is usually never uploaded, but the ?odysseyWorldHeroes=1
            // escape hatch still renders it and must not leak (the SB-15 teardown class).
            [groundMat, waterMat, skyMat, treeMat, forestV2Mat, cloudMat, heroMat, fieldMat]
                .forEach((m) => m.dispose());
            if (rayMat) rayMat.dispose();
            if (moteMat) moteMat.dispose();
            if (moteMesh) moteMesh.geometry.dispose();
            if (rayMesh) rayMesh.geometry.dispose();
            [heightTex, sunVisTex, groundTex, detailTex, macroTex].forEach((t) => t.dispose());
            // When the mesh is in the group, group.traverse above already disposed it.
            if (!heroes) heroBuild.geometry.dispose();
            treeGeo.dispose();
        },
    };
}
