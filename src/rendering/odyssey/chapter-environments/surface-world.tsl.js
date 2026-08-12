/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Surface World (Chapter 3) — TSL/WebGPU conversion (P3, final batch).
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — board off WebGLRenderer). See
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md. Faithful TSL ports of surface-world.js's
 * GLSL ShaderMaterials — the graded sky-sphere backstop, the Gerstner-wave paradise
 * ocean (vertex-displaced + caustics + fresnel), the CPU-baked tropical-island
 * landscape, the CPU-baked foothill bridge, the wind-swaying instanced fluffy grass,
 * the additive golden sun-rays, the soft procedural clouds, the FBM-displaced distant
 * mountains (CPU-baked silhouette + GPU snow/rock/fog shading) and the foothill valley
 * mist — rebuilt as NodeMaterials so they run on the WebGPURenderer and its automatic
 * WebGL2 fallback backend (one codebase, both backends).
 *
 * The chapter's private inline Ashima `snoise` maps to `snoise3` (built-in MaterialX
 * gradient noise) in the shared TSL noise lib — scales/frequencies preserved so the
 * GLSL→TSL look carries over. The CPU heightfields (getTerrainHeight for the landscape
 * + grass anchoring, the foothill-bridge walk, the per-mountain cone/FBM bake) are kept
 * byte-for-byte on the CPU exactly as the GLSL version did (same geometry shape, same
 * `computeVertexNormals`); only the per-pixel shading moves to the GPU as TSL nodes.
 *
 * Bloom: only the additive golden sun-rays are tagged `userData.emitsBloom = true`
 * (emissiveNode lands with the TSL post graph; kept off here so the standalone pilot
 * harness, which has no MRT bloom, does not double-brighten). The sky/ocean/terrain/
 * cloud/mist surfaces are atmosphere/terrain backstops — NONE bloom.
 *
 * This is ADDITIVE: the live surface-world.js (raw GLSL ShaderMaterial on the
 * WebGLRenderer) is untouched and keeps working; mountain-aurora.js is out of scope.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    normalView,
    normalWorld,
    oneMinus,
    positionGeometry,
    positionLocal,
    positionWorld,
    pow,
    reflector,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { snoise3 } from './shared/odyssey-tsl-noise.js';
import { buildOdysseyWaterSurface } from './shared/odyssey-water-surface.tsl.js';
import { ODYSSEY_SUN } from './shared/chapter-profile.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import {
    MOUNTAIN_SKIRT_MEADOW,
    mountainColorNode,
    mountainCpuDisplacement,
    mountainSkirtColorNode,
    resolveMountainTreatment,
} from './shared/mountain-language.js';
import { createWaterSurfaceTSL as createDeepOceanWaterSurfaceTSL } from './deep-ocean.tsl.js';
// Real 3D per-species wildflower geometry (procedural, baked vertex colour, no GLB assets) —
// the Midsommar theme's flora builders, ported to replace Ch3's flat cross-card blooms.
import {
    buildDaisy, buildButtercup, buildLupine, buildCornflower, buildPoppy,
} from '../../../themes/summer/rendering/summer-flora.js';

const SURFACE_WORLD_TERRAIN_DEPTH_OFFSET = 8;

// ── Batch B5 composition anchors (shared by terrain carve + hero placement) ──────
// The river/lake winds along this X (carved into getTerrainHeight); the lake and the
// waterfall feeding it sit on the same axis so the water reads as one connected system.
const SURFACE_RIVER_CENTER_X = -20;
// HERO: a great ancient tree on a knoll off the LEFT of the path, on the SUN side so the low
// front-left sun (SURFACE_SUN_DIR) rim/back-lights its canopy (a dark, glowing-edged hero
// silhouette) and it agrees with the camera's hero-beat aim. Anchored in Z down-corridor so it
// reads against the sky. x=-80 is ~60u off the carved corridor so it never blocks the lane.
const SURFACE_GREAT_TREE_POS = { x: -80, z: -250 };
// HERO LAKE (BEAT-2): a calm basin the river feeds, wrapped + reflected by the Great Tree on
// the opposite (left) knoll. Carved into getTerrainHeight so the water plane fills it.
// The lake sits WITHIN the ±200 landscape mesh (getTerrainHeight only shapes the visible ground
// there — beyond it the foothill-bridge terrain takes over and would occlude the water).
const SURFACE_LAKE_CENTER = { x: -30, z: -150 };
const SURFACE_LAKE_RADIUS = 72;
// Second beat: a tiered waterfall at the far RIM of the lake (on the river axis, off the corridor
// so its base clears the lane), tumbling toward the camera INTO the lake — river → waterfall →
// lake reads as one connected water story, with the Great Tree on the far knoll beyond.
const SURFACE_WATERFALL_POS = { x: -34, z: -212 };

// ── Shared meadow COMPOSITION grammar (deliberate placement, NOT uniform random scatter) ─────
// The carved river-corridor centre at depth z (mirrors the getTerrainHeight river carve). Every
// meadow scatter pass keeps OUT of this band so the water + a thin dry trail read as clean
// negative space — a leading line down the frame — and biases DENSITY toward the flanking banks.
function surfaceCorridorCenter(z) {
    // BotW re-composition: the river now THREADS the lake centre (exactly -30 at z=-150) as one
    // gently winding stream — mountain snowmelt → lake → foreground — a single water leading line.
    // Must stay byte-identical to the getTerrainHeight carve or carve + keep-out desync.
    return SURFACE_LAKE_CENTER.x + Math.sin((z + 150) * 0.011) * 20;
}
// Deliberate meadow placement gate for (x,z): reject inside the corridor keep-out, then accept
// with a probability that is LUSH in the banks flanking the path and thins to a sparse wing-
// meadow with an aerial far-taper — the moving-camera equivalent of Midsommar's near-camera
// density wedge (since here "near camera" = near the path the spline follows). `keepOut` widens
// for taller assets (trees) so they never stand in the water/lane.
function surfaceMeadowPlace(x, z, keepOut = 26) {
    const lat = Math.abs(x - surfaceCorridorCenter(z));
    if (lat < keepOut) return false;
    const pLat = 1 - smoothstepCPU(keepOut + 14, 200, lat); // dense in the banks, ~0 far out
    const pFar = 1 - smoothstepCPU(150, 330, Math.hypot(x, z)); // aerial far-taper into distance
    return Math.random() < Math.max(0.12, pLat * pFar); // floor keeps a faint far-meadow
}
// Hero keep-out: a WIDE breathing ring around the Great Tree (BotW: the hero landmark reads
// ALONE against the sky — no stand crowds it).
function surfaceOffHero(x, z, r = 64) {
    return Math.hypot(x - SURFACE_GREAT_TREE_POS.x, z - SURFACE_GREAT_TREE_POS.z) > r;
}
// Deliberate TREE placement gate: solid higher ground, OUT of the meandering river corridor (a
// wider keep-out than the meadow so trunks never stand in the water/lane), and clear of the hero.
function surfaceTreeGate(x, z, minH = 6.0, keepOut = 40) {
    if (getTerrainHeight(x, z) < minH) return false;
    if (Math.abs(x - surfaceCorridorCenter(z)) < keepOut) return false;
    return surfaceOffHero(x, z);
}
// Curated deciduous COPSE hearts (BotW spareness — a FEW deliberate stands with wide open
// negative space between, not a scatter): right-near + deep-right + left-near corridor framing.
const DECIDUOUS_HEARTS = [
    { x: 72, z: -118 }, { x: 120, z: -238 }, { x: -70, z: -96 }, { x: 44, z: -292 },
];
// Curated spruce COPSE hearts: the OUTCROP crown (screens the range, right third) + a far-left
// ridge wing + a right-deep stand — dark spiky masses that frame, kept clear of the hero.
const SPRUCE_HEARTS = [
    { x: 74, z: -176 }, { x: -136, z: -182 }, { x: 114, z: -206 },
];
// Deliberate FLOWER drift PATCHES (BotW: a few concentrated blooms + open meadow between, not a
// banks-wide carpet): east lake shore, sunlit left hill shoulder, a drift up toward the hero, and
// a deep-right rhythm patch. { x, z, r } — filled by even-disc sampling, terrain-gated.
const SURFACE_FLOWER_PATCHES = [
    // East lakeside drift nudged OUTBOARD (was {56,-150} — its centre sat below the h>=4 gate, so it
    // was already a thin sliver) onto the solid east bank.
    { x: 108, z: -150, r: 22 }, { x: -104, z: -108, r: 30 },
    { x: -56, z: -196, r: 22 }, { x: 92, z: -232, r: 22 },
    // LEFT-frame fill (in-game "empty left" fix): a bloom bank on the new left-shoulder knoll
    // (getTerrainHeight leftShoulder) gives the left frame content, seated on solid ground.
    { x: -150, z: -150, r: 30 },
    // FOREGROUND meadow banks: centred on the two foreground bank KNOLLS carved in getTerrainHeight
    // (fgBankR / fgBankL) so the WHOLE disc clears the waterline (h >> 4) and the flowers seat on a
    // broad solid bank instead of the waterline sliver that read as a "floating island".
    { x: 138, z: -74, r: 24 }, { x: -140, z: -70, r: 24 },
];
// Even-disc sample within a random patch (sqrt(rand) radius = uniform area).
function surfaceFlowerPatchSample() {
    const p = SURFACE_FLOWER_PATCHES[Math.floor(Math.random() * SURFACE_FLOWER_PATCHES.length)];
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * p.r;
    return { x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr };
}

export const CH3_WATER_READABILITY_SETTINGS = Object.freeze({
    sourceChapter: 2,
    sourceBuilder: 'createWaterSurfaceTSL',
    ch2SurfaceDepth: 1,
    deepColor: 0x062a55,
    shallowColor: 0x0a9bb8,
    skyReflectionColor: 0x55efff,
    sunPathColor: 0x55efff,
    sunPathGain: 0.16,
    crestColor: [0.55, 0.95, 1.0],
    maxColor: [0.55, 0.95, 1.0],
    corridorWidth: 270,
    corridorDepth: 720,
    corridorCenterZ: 34,
    corridorScaleX: 0.72,
    corridorScaleZ: 0.62,
    seaWidth: 1320,
    seaDepth: 1140,
    seaCenterX: -30,
    // ONE water body (user: "still not one lake and looks squared"). The sea is now enlarged to
    // cover the WHOLE valley (centre pulled back to 40, depth ×2.0 → z≈−260..340), so it is the
    // single continuous water surface and the ONLY visible water edge is the organic grass
    // shoreline (where the terrain rises above the waterline) — never a plane's square rim. The
    // separate river/lake planes (which showed hard square edges over the water) are hidden; this
    // sea subsumes them. seaCenterZ 40 stays > corridorCenterZ 34 (test pin).
    seaCenterZ: 40,
    seaScaleX: 4.2,
    // WATER SET BACK FROM THE RANGE (in-game: "it still feels like the water goes to close the
    // mountain... then land between the water and mountain so it feels connected"). At ×2.0 the sea
    // ended at z≈−260 on a hard straight rim, leaving the pale empty gap; ×3.0 closed the gap but ran
    // the water all the way up the carved corridor to the foot of the range. ×2.4 with the noise-broken
    // rim dissolve (useRadialEdge, see below) starts releasing the water around z≈−220 and finishes by
    // z≈−320 — short of the first slope and on a wandering coastline — while the terrain's coastalRise
    // and the lifted foothill skirt carry dry land on from there into the mountain.
    seaScaleZ: 2.4,
    // Fix A finish: collapsed 3.0 → 0 so the Ch3 sea sits at exactly waterSurfaceY — the SAME world
    // plane as the Ch2 breach ceiling (no more 3u "double surface" the camera crossed twice) AND
    // exactly at the terrain shading waterline (surfaceWorldY, which is independent of seaYOffset —
    // the sea used to float 3u above the shoreline, leaving a band of "dry" grass under the water).
    // The river/lake keep their +0.4 as a z-bias only (distinct renderOrders avoid z-fighting).
    seaYOffset: 0,
    seaRenderOrder: -7,
    riverRenderOrder: -6,
    // Tightened -5.5/1.5 → -2.6/0.9 (waterline v2): the wide half-transparent terrain
    // shelf smeared a pale wedge across every shoreline. A tight cut keeps the ground
    // edge readable right up to the foam line. (Test pins only the signs.)
    waterShelfFadeMin: -2.6,
    waterShelfFadeMax: 0.9,
    // Softened from the "crisp dark line" navy ([0.018,0.22,0.55] @ 0.96): the water now
    // owns the boundary via its depth-based shore blend, so the terrain side contributes a
    // gentle wet-earth darkening instead of a second hard stripe at the same line.
    wetShoreColor: [0.10, 0.20, 0.30],
    wetShoreBlend: 0.55,
});

export const CH3_TREE_VALUE_SETTINGS = Object.freeze({
    deciduousShadow: [0.018, 0.15, 0.055],
    deciduousSunlit: [0.18, 0.52, 0.13],
    spruceShadow: [0.014, 0.105, 0.052],
    spruceSunlit: [0.08, 0.30, 0.13],
    greatTreeShadow: [0.02, 0.18, 0.07],
    greatTreeSunlit: [0.16, 0.44, 0.12],
    treeLineShadow: [0.045, 0.22, 0.11],
    treeLineSunlit: [0.13, 0.38, 0.17],
    cc0Candidates: Object.freeze([
        Object.freeze({
            name: 'Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/qZtx0AHhcy',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine Trees',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/oYtDty0fR6',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/igSu0cPoBz',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/79gmlLnweB',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/699sFuLCN2',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Trees',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/jUzojhHoYR',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/t9KbsfYdXz',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Twisted Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/edSPJNECM7',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Twisted Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/9aWlx82xUf',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Bush with Flowers',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/U1ymDy8tbY',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Stylized Nature MegaKit',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/bundle/Stylized-Nature-MegaKit-T34GZFA0fm',
            license: 'Public Domain (CC0)',
        }),
    ]),
});

export const CH3_BIRD_SILHOUETTE_SETTINGS = Object.freeze({
    flockCount: 8,
    crosserCount: 3,
    vertexCount: 45,
    cc0Candidate: Object.freeze({
        name: 'Bird',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/gYYC0gYMnw',
        license: 'Public Domain (CC0)',
    }),
    animatedCc0Candidate: Object.freeze({
        name: 'Pigeon',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/9NGlBTpDEr',
        license: 'Public Domain (CC0)',
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// CPU-side helpers (mirror surface-world.js exactly — terrain + grass anchoring)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU smoothstep — matches surface-world.js's private smoothstep().
function smoothstepCPU(min0, max0, value) {
    const x = Math.max(0, Math.min(1, (value - min0) / (max0 - min0)));
    return x * x * (3 - 2 * x);
}

// Terrain heightfield — drives BOTH the landscape bake AND every prop's anchoring
// (grass tufts, vegetation, reeds) so set-dressing lines up with the rendered ground.
// Phase B gave the rolling hills REAL volume: the original two thin sine ripples read as
// a near-flat card, so a couple of broader, higher-amplitude rolling waves were layered
// in (still gated by the same smoothstep so the shoreline/water stays put). The grass
// land gate (h >= 4.0) and the h < -2 -> -15 water clamp are preserved exactly.
//
// Batch B5 (Surface enrichment): the act-in read THIN — no silhouette/scale. Two
// composition fixes are baked HERE so the landscape mesh, every prop, the river channel
// and the lake all line up:
//   • a broad valley SWELL + a far RIDGELINE band (gated to the distance) so the chapter
//     gains a left/right hill silhouette that reads at the forward angle;
//   • a carved RIVER CHANNEL — a smooth low corridor along x ≈ RIVER_CENTER_X bending
//     gently along -Z — so the relocated lake/river reads as water winding INTO the frame
//     (the camera looks down its length). The channel sits below the water clamp so it
//     fills with water and the shoreline reeds (h in 2..7) hug its banks for free.
export function getTerrainHeight(x, z) {
    const d = Math.sqrt(x * x + z * z);

    // River / flight-lane centre — BYTE-IDENTICAL to surfaceCorridorCenter so the carve + the
    // meadow keep-out agree, and so the far ridgeline can be NOTCHED where the river runs.
    const riverCenter = SURFACE_LAKE_CENTER.x + Math.sin((z + 150) * 0.011) * 20;
    const channel = 1 - smoothstepCPU(0, 46, Math.abs(x - riverCenter));
    const laneDist = Math.abs(x - riverCenter);

    // ── MEANDERING SHORE (in-game: "i want... shoreline that is not straight so we need curved
    // land... no straight edges for water land or anything so it feels natural"). Every band that
    // decides where water ends and land begins used to key off laneDist — the DISTANCE FROM THE
    // CORRIDOR — so all of them ran parallel to the lane and the shoreline came out as long straight
    // rails down the valley. shoreDist offsets that lane by three incommensurate waves (two in z,
    // one in x) before measuring, so the same carves now produce a wandering coast with bays and
    // headlands. riverCenter itself is UNTOUCHED — it is byte-identical to surfaceCorridorCenter and
    // the prop keep-outs depend on that agreement.
    const shoreMeander = Math.sin(z * 0.0225 + 0.7) * 30
        + Math.cos(z * 0.0475 - 1.1) * 15
        + Math.sin(x * 0.019 + 2.3) * 13;
    const shoreDist = Math.abs(x - riverCenter - shoreMeander);

    // ── CORRIDOR VALLEY (Fix B: "the grass hills do not exist"). The old terrain was an ORIGIN-
    // centred BOWL (baseH −30→+20 with distance) whose entire near/mid field sat below the
    // waterline, so the flight lane flew over a flat washed water plane and the only relief (the
    // far ridgeline, amp 22) hid behind fog. Now the ground is a green VALLEY the lane threads:
    // the lane FLOOR stays low (fills with the river/lake — the water leading line) and the ground
    // RISES into rolling grass hills on BOTH flanks, close to the path, so real hills read right
    // beside the camera instead of a flat pale sheet. ──
    // ONE broad LAKE (user: "I want one water sea not two separate ponds — it does not read as one
    // lake"). The valley floor stays UNIFORMLY below the waterline across a wide ±66 central band
    // that runs the length of the chapter, so the whole water surface reads as a single continuous
    // lake — not a wide foreground sea + a narrow river + a separate hero-lake pool. The grass hills
    // rise only OUTSIDE the lake, framing it from the far shores.
    const valleyRise = smoothstepCPU(66, 196, shoreDist) * 22; // meandering lake → grass set back
    // Gentle down-valley grade — kept low enough that the lake stays water all the way to the
    // foothills (baseH −14 + grade ≤ −2 out to z≈−250), so the water never dries into a mid-valley
    // island that would split it into two pools.
    const grade = smoothstepCPU(150, -260, z) * 11;
    const baseH = -14.0 + valleyRise + grade;

    // Rolling grass hills — a MID octave the journey camera actually reads (λ≈105-125) + a broad
    // swell + a cross-roll for non-repeating shoulders + a calmed fine ripple + a broad valley
    // swell. Flank-biased (amplitude grows with distance from the lane) so the shoulders swell
    // higher than the lake — the lake threads a broad basin framed by hills on the far shores.
    const flankGain = 0.4 + smoothstepCPU(70, 200, laneDist) * 0.8;
    let hills = Math.sin(x * 0.06) * Math.cos(z * 0.05) * 6; // MID octave — the camera reads THIS
    hills += Math.cos(x * 0.045 + z * 0.04) * 4; // mid cross-roll → non-repeating shoulders
    hills += Math.sin(x * 0.018) * Math.cos(z * 0.021) * 6; // broad rolling swell
    hills += Math.sin(x * 0.1 + z * 0.13) * 1; // fine ripple (calmed)
    hills += Math.sin(x * 0.012) * Math.cos(z * 0.009) * 3; // broad valley swell
    hills *= flankGain;

    // Far RIDGELINE band (horizon hill silhouette), NOTCHED where the river runs so a gap in the
    // foothills reads as the stream's source at the valley mouth.
    const ridgeline = Math.sin(x * 0.009) * Math.cos(z * 0.006) * 22;
    const farBand = ridgeline * smoothstepCPU(120, 260, d) * (1 - channel * 0.75);

    let h = baseH + hills + farBand;

    // Carve the winding river channel — a stream GROWING deeper toward the far mountains (the
    // snowmelt source) so it reads as one connected water leading line threading the lake.
    const channelDepth = channel * (14 + smoothstepCPU(-60, -200, z) * 12);
    h -= channelDepth;

    // HERO LAKE basin — the river's mid-course pool (the river now threads its centre).
    const lakeD = Math.hypot(x - SURFACE_LAKE_CENTER.x, z - SURFACE_LAKE_CENTER.z);
    // Lobed, not circular: perturbing the basin radius by angle gives the pool bays and points, so
    // its shoreline never reads as a compass-drawn arc (part of the "no straight edges" pass).
    const lakeAngle = Math.atan2(z - SURFACE_LAKE_CENTER.z, x - SURFACE_LAKE_CENTER.x);
    const lakeLobe = Math.sin(lakeAngle * 3.0 + 0.6) * 13 + Math.sin(lakeAngle * 5.0 - 1.2) * 7;
    h -= (1 - smoothstepCPU(0, SURFACE_LAKE_RADIUS, lakeD + lakeLobe)) * 34;

    // Triangle-rule LANDMARKS (BotW three-point frame): a smooth KNOLL lifting the hero Great Tree
    // (left third) so it reads against the sky, + a steeper rocky OUTCROP (right third) that
    // balances the hero. Both clear of the river + lake.
    const knollD = Math.hypot(x - SURFACE_GREAT_TREE_POS.x, z - SURFACE_GREAT_TREE_POS.z);
    h += (1 - smoothstepCPU(0, 42, knollD)) * 16;
    const outD = Math.hypot(x - 74, z + 176);
    h += (1 - smoothstepCPU(0, 34, outD)) * 22;

    // FOREGROUND BANK KNOLLS + LEFT SHOULDER (in-game "floating flower islands" + "empty left" fix):
    // broad low knolls that lift the near-field foreground banks and a left mid-ground shoulder clear
    // of the waterline, so the foreground flower drifts seat on solid BROAD ground instead of a thin
    // waterline sliver that read as a "floating island", and the empty left third gains a hill
    // silhouette. Same smooth-knoll grammar as the hero knoll/outcrop above; kept off the corridor +
    // lake so they never dam the single water body.
    const fgBankR = Math.hypot(x - 138, z + 74);
    h += (1 - smoothstepCPU(0, 44, fgBankR)) * 14;
    const fgBankL = Math.hypot(x + 140, z + 70);
    h += (1 - smoothstepCPU(0, 44, fgBankL)) * 14;
    const leftShoulder = Math.hypot(x + 150, z + 150);
    h += (1 - smoothstepCPU(0, 52, leftShoulder)) * 18;

    // NATURAL WADE-IN SHORELINE (in-game "abrupt water↔land" fix; was: hard `h < -2 → -15` snap). The
    // snap made every shoreline a ~13u vertical wall and left the meadow perched ~+5 above the water
    // plane — reading in-game as "floating banks" and a hard water/land seam. Give the water a real
    // bed the banks slope INTO: (1) deepen the central lake band so a gentle slope reaches true depth
    // instead of surfacing as a mid-water island (the reason the snap existed — this STRENGTHENS the
    // one-lake invariant), then (2) ease sub-shoreline terrain down to the floor on a smooth curve so
    // the shader's wet-sand + landAlpha fade bands finally shade a real sloping shoreline.
    // COASTAL PLAIN (in-game: "it still feels like the water goes to close the mountain... then land
    // between the water and mountain so it feels connected"). The valley floor used to stay under the
    // waterline all the way to the far edge, so the sea ran right up to the foot of the range with no
    // shore in between. The ground now RISES across the back of the chapter, lifting the far valley
    // clear of the water so a real coastal plain separates the last wave from the first slope — and
    // the foothill bridge then continues that land up into the mountain. The rise is noise-warped so
    // its own leading edge is a wandering coast, never a straight line across the valley.
    const coastalWarp = Math.sin(x * 0.014 + 1.9) * 34 + Math.cos(x * 0.031 - 0.4) * 16;
    const coastalRise = smoothstepCPU(-95, -275, z + coastalWarp) * 30;
    h += coastalRise;

    const lakeBed = 1 - smoothstepCPU(62, 150, shoreDist); // 1 mid-water → 0 on the banks
    h -= lakeBed * 12; // sink the bed clear under the waterline
    if (h < 3.0) {
        const wade = smoothstepCPU(3.0, -20.0, h); // 0 at the grass line → 1 in the deep bed
        // The clamp used to flatten every submerged vertex onto ONE smooth ramp, so the shallows read
        // as a machined plate. A low-amplitude bed ripple (strongest in deep water, vanishing at the
        // grass line so the shoreline stays clean) gives the bed natural relief.
        const bedRipple = Math.sin(x * 0.048) * Math.cos(z * 0.041) * 1.7
            + Math.sin((x + z) * 0.029 + 0.8) * 1.2;
        h = 3.0 - 18.0 * wade + bedRipple * wade; // smooth grass(3) → rippled floor beach ramp
    }

    return h;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Sky Background (graded sky-sphere backstop; -100, must NOT bloom)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Golden-hour daytime sky dome. PRIORITY FIX (Phase B): the live sky read as a blown
 * pale-white upper frame — a near-white horizon color plus a broad white sun-glow bleed
 * that ACES could not pull back. This is a real three-band golden-hour gradient:
 *   deep saturated zenith blue  →  clear mid azure  →  warm peach horizon
 * with every band's VALUE kept moderate (peak channel ≲ 0.78) so the dome never washes
 * to white under the post ACES+exposure pass, and a SOFT, CONTAINED warm sun disc (a
 * small bright core + a tight falloff halo) instead of the old wide bleed. The sun sits
 * toward the warm horizon so the warm band reads as the light source, not a haze.
 *
 * `vWorldPosition` → positionWorld (on a backside sphere, the normalized world direction
 * drives both the vertical gradient and the sun angle).
 * @param {object} uTime shared time uniform (uniform(0)) — unused by the shader but
 *   shared for parity with the live material's uniform set.
 */
// Shared season gates (creative plan Ch3 item 6): one uSeason scalar (0 at the breach →
// 1 at the Mountains seam) scripts the chapter's spring→autumn→winter arc THROUGH LIGHT —
// the sky bands, the sun, the key light, and the particle stories all ride it.
function seasonAutumnT(uSeason) {
    return smoothstep(0.38, 0.6, uSeason).mul(oneMinus(smoothstep(0.72, 0.92, uSeason)));
}
function seasonWinterT(uSeason) {
    return smoothstep(0.68, 0.92, uSeason);
}

// Chapter 3 HERO SUN direction — ONE source of truth shared by the sky-dome glow,
// the billboard disc, and the god-ray fan. Low + LEFT so the visible sun sits just
// above the mountain ridge on the sun-rake side. This UNIFIES the light source with
// the terrain key light (normalize(-0.62,0.34,-0.71)) and with the god-ray fan (which
// already biases left); previously the disc/dome sat front-RIGHT (0.40,0.16,-0.90),
// contradicting both, so the god-rays fanned from an empty patch of sky.
export const SURFACE_SUN_DIR = new THREE.Vector3(...ODYSSEY_SUN).normalize();

export function createSkyBackgroundTSL(uTime = uniform(0), options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    // VISUAL POLISH (de-wash): the live sky read as a flat grey-blue band because the
    // mid-azure swallowed the whole near-horizontal frame and every value sat low-sat.
    // Re-graded as a REAL blue golden-hour dome (richer, more saturated bands pulled up
    // into the frame) sitting over a warm horizon, with a readable golden SUN disc + halo
    // toward that horizon. Reference look: sky-children-v2 sun (core/corona/halo) + the
    // himalayan/sakura warm-horizon palettes. Values capped (peak channel ≲ 0.78) so the
    // ACES+exposure pass keeps the hue and never washes to white.
    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave A): flip Ch3 from warm golden-hour to the shared
    // BRIGHT DAYLIGHT anchor — vivid azure zenith fading to a light cyan-blue horizon, the Ghibli/
    // Genshin/Europa sky of the reference images. The sunset gold/peach bands become pale cyan so
    // the meadow reads as a bright afternoon, and the turquoise lake below has a blue sky + white
    // cumulus to mirror (see the water repalette). Sun colour whitened here; its POSITION stays on
    // SURFACE_SUN_DIR until the Wave-D shared-sun pass. Winter poles (below) unchanged.
    const uZenith = uniform(new THREE.Color(0x2360c8)); // Vivid daylight azure zenith
    const uMid = uniform(new THREE.Color(0x3f8fe0)); // Clear saturated mid azure
    const uHorizon = uniform(new THREE.Color(0xbfe4f2)); // Light cyan-blue daylight horizon (was warm gold)
    const uHaze = uniform(new THREE.Color(0xd6ecf6)); // Pale cyan-white waterline haze (was warm)
    const uPeach = uniform(new THREE.Color(0xcfe6f4)); // Soft cyan mid-band (was sunset peach — neutralized)
    const uSunCore = uniform(new THREE.Color(0xfff6e2)); // Near-white daylight sun core
    const uSunGlow = uniform(new THREE.Color(0xffe4b0)); // Soft warm-white halo (was gold)
    const uOpacity = uniform(1);
    // uTime is part of the live uniform set; reference it so the shared tick stays valid.
    const t0 = uTime.mul(0.0);

    // Normalized view direction over the dome; y in ~[-1, 1].
    const dir = normalize(positionWorld);
    const h = max(dir.y, 0.0);

    // Season-scripted bands (plan item 6): autumn warms and deepens the horizon; winter
    // cools every band toward the #B4BBDD lavender pole and dims the golden read — the
    // season must arrive as a LIGHT change, never a prop swap.
    const autumnT = seasonAutumnT(uSeason);
    const winterT = seasonWinterT(uSeason);
    const horizonCol = mix(
        mix(uHorizon, vec3(0.94, 0.63, 0.33), autumnT.mul(0.45)),
        vec3(0.706, 0.733, 0.867), // #B4BBDD lavender (himalayan dawn pole)
        winterT.mul(0.85),
    );
    const midCol = mix(uMid, vec3(0.55, 0.61, 0.78), winterT.mul(0.7));
    const zenithCol = mix(uZenith, vec3(0.2, 0.27, 0.48), winterT.mul(0.6));

    // Two-stage vertical grade: warm horizon -> SATURATED mid azure (fast, low band) then
    // mid -> deep zenith (pulled up harder so the upper frame reads as real BLUE, not a
    // pale grey wash). The lower pow exponent lifts saturated blue earlier up the dome.
    const horizonBand = smoothstep(0.0, 0.16, h); // warm hugs the horizon line
    const zenithBand = pow(h, float(0.5)); // pull saturated blue up into the dome
    let sky = mix(horizonCol, midCol, horizonBand);
    // Saturated PEACH mid-stop (Midsommar): a distinct golden-hour band just above the horizon,
    // between the warm horizon and the azure mid — the split-complementary warmth that makes the
    // reference sky glow. Faded out toward winter (the cool arc reclaims the low sky).
    const peachBand = smoothstep(0.02, 0.14, h).mul(oneMinus(smoothstep(0.14, 0.34, h)));
    sky = mix(sky, uPeach, peachBand.mul(oneMinus(winterT.mul(0.85))).mul(0.5));
    sky = mix(sky, zenithCol, zenithBand);

    // Warm ground-haze band hugging the horizon line (very low, soft): warms the waterline
    // so the act-in vista reads golden-hour, not a cold flat stripe.
    const groundHaze = oneMinus(smoothstep(0.0, 0.085, h));
    sky = mix(sky, mix(uHaze, vec3(0.78, 0.8, 0.88), winterT.mul(0.8)), groundHaze.mul(0.34));

    // Readable golden SUN toward the warm horizon (low + LEFT, on the rake side). A tight
    // bright core + a wider golden halo (sky-children sun discipline) so the sun READS as the
    // light source. Both terms are additive but capped well below white so ACES rolls them
    // off — the core peaks at ~0.9*coreColor, never a clipped white hole.
    const sunDir = vec3(SURFACE_SUN_DIR.x, SURFACE_SUN_DIR.y, SURFACE_SUN_DIR.z);
    const sunDot = dot(dir, sunDir);
    // Brighter hero sun (overshoot): the RAW cap kept the core ≲0.9 so it never blew out in the
    // ungraded playground, but in-game ACES then maps it to a dim ~0.6 — so lift the core to ~1.0
    // and the halo up so the golden sun survives the tonemap and reads as the light source.
    const sunCore = pow(smoothstep(0.9955, 1.0, sunDot), float(1.6)).mul(1.0);
    const sunHalo = pow(smoothstep(0.80, 1.0, sunDot), float(2.4)).mul(0.52);
    // Winter cools and dims the in-dome sun (the pale #DCE8FF disc of the snow line).
    const domeSunCore = mix(uSunCore, vec3(0.863, 0.91, 1.0), winterT.mul(0.8));
    const domeSunGlow = mix(uSunGlow, vec3(0.74, 0.82, 0.94), winterT.mul(0.8));
    sky = mix(sky, domeSunCore, sunCore.mul(oneMinus(winterT.mul(0.3))));
    sky = sky.add(domeSunGlow.mul(sunHalo).mul(oneMinus(winterT.mul(0.4)))).add(t0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = sky;
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;
    // CRITICAL (2026-08, Wave A): the sky dome is a radius-2500 BackSide sphere, so the scene's
    // FogExp2 fogged it to ~100% → the entire azure→cyan gradient was being REPLACED by the pale
    // fog colour, which is why the sky always read as a flat washed cyan no matter the gradient. A
    // sky dome is the backdrop at infinity and must never be fogged (same class of bug as the finale
    // space heroes). fog=false lets the deep-blue zenith actually read — the #1 de-wash lever.
    material.fog = false;

    const geometry = new THREE.SphereGeometry(2500, 64, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Ocean Surface (Gerstner waves + caustics + fresnel; transparent, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

function configureChapter2WaterSurface(part, {
    name,
    x = 0,
    z = 0,
    scaleX = 1,
    scaleZ = 1,
    renderOrder = CH3_WATER_READABILITY_SETTINGS.seaRenderOrder,
}) {
    const { mesh, material } = part;
    mesh.name = name;
    mesh.position.x = x;
    mesh.position.z = z;
    mesh.scale.set(scaleX, 1, scaleZ);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.userData.readability = CH3_WATER_READABILITY_SETTINGS;
    mesh.userData.sourceChapter = CH3_WATER_READABILITY_SETTINGS.sourceChapter;
    mesh.userData.sourceBuilder = CH3_WATER_READABILITY_SETTINGS.sourceBuilder;
    material.userData.readability = CH3_WATER_READABILITY_SETTINGS;
    return mesh;
}

// Chapter 3 now uses the EXACT Chapter 2 water surface builder. The earlier Surface pass
// tried to approximate the breach water with a custom river/sea shader, but after the
// 2→3 seam faded, it read brown-green/flat. Reusing `createWaterSurfaceTSL` keeps the same
// Gerstner displacement, cyan/deep-blue palette, sharp caustic veins, additive blending
// and bloom tagging as Chapter 2; only transform/scale change so the surface-world terrain
// has enough coverage after the breach. The water renders behind the terrain so the
// additive Chapter 2 material cannot flood the green land.
// Golden-hour reflective LAKE (Golden-Forest-inspired, FULLY PROCEDURAL — no render target): a
// calm cool-teal water body that warms into a peach-gold reflected sky at the grazing rim (the
// reduced-fresnel warm-reflectance trick, rf0≈0.09 — NOT a mirror-blue ocean), with a camera-
// relative golden SUN-GLITTER path, faked dark shore/tree silhouette reflections on the far shore,
// gentle drifting ripples and a soft radial shore alpha. Replaces the cool deep-ocean caustic
// shader the Ch3 lake used to reuse. NON-additive, not bloom-tagged; ACES rolls off the overshoot.
// Shared GOLDEN-HOUR WATER material — the one warm reflective look for ALL Ch3 water
// (lake, river, foreground sea) so nothing reads as the old cool cyan caustic slab. It shades
// from positionWorld + uv, so the same material drops onto any flat water plane regardless of
// size/segments. `useRadialEdge` dissolves the plane at its rim (the pooled LAKE wants that; the
// river/sea want to fill to their scaled extent, so they pass false).
function buildGoldenWaterMaterial(uTime, {
    uSeason = uniform(0), uOpacity = uniform(1), useRadialEdge = true, rippleAmp = 0.16,
    reflection = null, shore = null,
} = {}) {
    // The Ch3 sea/river/lake are now the ONE shared Odyssey water surface (unified with the Ch2
    // breach ceiling — shared/odyssey-water-surface.tsl.js). Ch3 water is "surfaced" (uDepth=1 →
    // the caustic underside only shows if the camera dips beneath a wave) and calm (a small wave
    // scale mapped from the old rippleAmp). The golden-hour top, camera-relative sun-glitter,
    // reduced-fresnel body and optional hero-lake reflector all live in the shared builder, so
    // nothing here reads as the old cool cyan caustic slab and the breach is one continuous
    // membrane (the same surface simply shows its golden top from above, caustic teal from below).
    return buildOdysseyWaterSurface(uTime, {
        uDepth: uniform(1),
        uSeason,
        uOpacity,
        uWaveScale: uniform(rippleAmp * 0.6),
        useRadialEdge,
        baseAlpha: 1.0,
        reflection,
        shore,
    });
}

// ── SHORE HEIGHTMAP BAKE (depth-based shoreline blend) ──────────────────────────
// getTerrainHeight sampled over the landscape's exact 400×400 plate into a half-float
// R texture the shared water builder reads by world XZ. Half-float because WebGPU only
// guarantees FILTERABLE float sampling at 16 bits (float32-filterable is optional on
// Dawn); 512² over ±200 gives ~0.78u/texel, linear-filtered — well inside the 2.6u
// shore band. Baked from the SAME CPU function that displaces the terrain mesh, so the
// two can never drift apart.
const SHORE_HEIGHT_RES = 512;
const SHORE_PLATE_HALF = 200;

function bakeShoreHeightTexture() {
    const data = new Uint16Array(SHORE_HEIGHT_RES * SHORE_HEIGHT_RES);
    const step = (SHORE_PLATE_HALF * 2) / SHORE_HEIGHT_RES;
    for (let j = 0; j < SHORE_HEIGHT_RES; j += 1) {
        const z = -SHORE_PLATE_HALF + (j + 0.5) * step;
        for (let i = 0; i < SHORE_HEIGHT_RES; i += 1) {
            const x = -SHORE_PLATE_HALF + (i + 0.5) * step;
            data[j * SHORE_HEIGHT_RES + i] = THREE.DataUtils.toHalfFloat(getTerrainHeight(x, z));
        }
    }
    const tex = new THREE.DataTexture(
        data,
        SHORE_HEIGHT_RES,
        SHORE_HEIGHT_RES,
        THREE.RedFormat,
        THREE.HalfFloatType,
    );
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

export function createGoldenLakeTSL(uTime = uniform(0), options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const uOpacity = uniform(1);
    const { material } = buildGoldenWaterMaterial(uTime, {
        // useRadialEdge FALSE (was true): the hero lake used to dissolve into a discrete ellipse,
        // which read as a separate pond floating in the grass. It now fills to its extent so it
        // blends with the sea/river as ONE continuous lake surface (same material + Y).
        uSeason, uOpacity, useRadialEdge: false, reflection: options.reflection ?? null,
    });

    const geometry = new THREE.PlaneGeometry(SURFACE_LAKE_RADIUS * 2.5, SURFACE_LAKE_RADIUS * 2.5, 32, 32);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'surface-golden-lake';
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    return {
        mesh, material, geometry, uniforms: { uOpacity, uSeason },
    };
}

export function createOceanSurfaceTSL(uTime = uniform(0), surfaceOffsetY = -15, options = {}) {
    const uOpacity = uniform(1);
    const uDepth = uniform(CH3_WATER_READABILITY_SETTINGS.ch2SurfaceDepth);
    const deepWaterOptions = { uDepth, uOpacity };

    // Borrow the deep-ocean builder ONLY for its correctly-sized water plane geometry (the extent
    // configureChapter2WaterSurface scales against); its cool cyan caustic MATERIAL is discarded and
    // replaced by the shared golden-hour water below so the foreground sea + river read as the same
    // warm BotW valley water as the lake — no more cyan slab clashing with the golden pool.
    const seaPart = createDeepOceanWaterSurfaceTSL(
        uTime,
        surfaceOffsetY + CH3_WATER_READABILITY_SETTINGS.seaYOffset,
        deepWaterOptions,
    );
    seaPart.material?.dispose?.();
    // One golden material (no radial dissolve → fills to the scaled plane edge) shared by BOTH the
    // sea and river meshes — a single NodeMaterial pipeline for both, same draw/pipeline share the
    // old cyan reuse had, now warm. rippleAmp trimmed vs the lake since these are broad flat sheets.
    // HERO-LAKE REAL MIRROR (Wave D, flag ch3HeroMirror): build the planar reflector FIRST so the
    // VISIBLE sea material can sample it. The hero-lake mesh is hidden (the enlarged sea is the one
    // water body), so the mirror must ride the SEA to actually show the reflected blue sky + white
    // cumulus on the water; the hidden lake still receives it for parity.
    let reflection = null;
    if (options.enableReflector) {
        reflection = reflector({ resolutionScale: 0.5, bounces: false, generateMipmaps: false });
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.position.set(
            SURFACE_LAKE_CENTER.x,
            surfaceOffsetY + CH3_WATER_READABILITY_SETTINGS.seaYOffset + 0.08,
            SURFACE_LAKE_CENTER.z,
        );
    }
    // NO STRAIGHT EDGES: the sea used to fill flat to its rectangular plane rim, so wherever land
    // did not hide it the water ended on a ruler-straight horizon line. The shared rim dissolve is
    // now noise-broken (two octaves, see shared/odyssey-water-surface.tsl.js), so enabling it gives
    // the sea an organic meandering coastline in every direction instead of a machined edge.
    // Depth-based SHORE BLEND for the sea+river sheet (the sharp-intersection fix): the
    // water fades out and lightens over its true depth against the baked terrain, so every
    // interior shoreline shallowing replaces the old raw geometric clip line. The origin /
    // base-Y uniforms are driven by the live env (group world position + terrainOffsetY).
    const uShoreOriginXZ = uniform(new THREE.Vector2(0, 0));
    const uShoreBaseY = uniform(0);
    const shore = {
        heightTexture: bakeShoreHeightTexture(),
        uOriginXZ: uShoreOriginXZ,
        uBaseY: uShoreBaseY,
        extent: SHORE_PLATE_HALF,
        band: 1.1,
        shallowTint: [0.30, 0.58, 0.50],
    };
    const warmWater = buildGoldenWaterMaterial(uTime, {
        uOpacity, useRadialEdge: true, rippleAmp: 0.1, reflection, shore,
    });
    // BUG FIX: the sea MESH was built by createDeepOceanWaterSurfaceTSL with the deep-ocean cyan
    // material and nothing ever reassigned mesh.material — only the dict handle seaPart.material was
    // repointed — so the foreground sea rendered the (disposed) cyan additive caustic while the
    // river/lake rendered gold in the SAME frame. Reassign the mesh material so sea = river = lake.
    seaPart.mesh.material = warmWater.material;
    seaPart.material = warmWater.material;
    const sea = configureChapter2WaterSurface(seaPart, {
        name: 'surface-chapter-02-water-foreground',
        x: CH3_WATER_READABILITY_SETTINGS.seaCenterX,
        z: CH3_WATER_READABILITY_SETTINGS.seaCenterZ,
        scaleX: CH3_WATER_READABILITY_SETTINGS.seaScaleX,
        scaleZ: CH3_WATER_READABILITY_SETTINGS.seaScaleZ,
    });

    // The river is the EXACT same warm water as the sea — shared golden material + geometry (one
    // NodeMaterial pipeline, one geometry upload); only the mesh transform/renderOrder/name differ.
    const riverPart = {
        mesh: new THREE.Mesh(seaPart.geometry, warmWater.material),
        material: warmWater.material,
        geometry: seaPart.geometry,
    };
    const river = configureChapter2WaterSurface(riverPart, {
        name: 'surface-chapter-02-water-river',
        x: SURFACE_RIVER_CENTER_X - 8,
        z: CH3_WATER_READABILITY_SETTINGS.corridorCenterZ,
        scaleX: CH3_WATER_READABILITY_SETTINGS.corridorScaleX,
        scaleZ: CH3_WATER_READABILITY_SETTINGS.corridorScaleZ,
        renderOrder: CH3_WATER_READABILITY_SETTINGS.riverRenderOrder,
    });
    // Match the second-builder's mesh Y exactly: the original river sat 0.4u above the sea
    // (surfaceOffsetY + seaYOffset + 0.4). configureChapter2WaterSurface only sets x/z, so set
    // Y here to keep the river plane in the identical world position it had before.
    river.position.y = surfaceOffsetY + CH3_WATER_READABILITY_SETTINGS.seaYOffset + 0.08;
    // The enlarged sea now IS the whole valley's water; the separate river plane's hard square rim
    // showed over the water, so it's hidden (kept for the name/renderOrder test pins). renderOrder
    // draws transparents in order regardless of Y, so it can't just sit "under" the sea.
    river.visible = false;

    // HERO LAKE surface: the procedural GOLDEN-HOUR REFLECTIVE lake (createGoldenLakeTSL) pooled
    // over the carved basin (SURFACE_LAKE_CENTER) — same warm palette as the river/sea, but with a
    // soft radial shore dissolve since it's a discrete pool rather than a filled corridor.
    // reflection is now created ABOVE (shared by the visible sea AND this hidden hero-lake mesh —
    // one RTT sampled by both), so the mirror rides the sea that actually renders.
    const lakeBuilt = createGoldenLakeTSL(uTime, { reflection });
    const lake = lakeBuilt.mesh;
    lake.position.set(
        SURFACE_LAKE_CENTER.x,
        surfaceOffsetY + CH3_WATER_READABILITY_SETTINGS.seaYOffset + 0.08,
        SURFACE_LAKE_CENTER.z,
    );
    // Hidden for the same reason as the river: the enlarged sea is the single water surface, and the
    // hero-lake plane's square rim was the "looks squared" offender. (Reflector stays wired for the
    // opt-in hero-mirror flag; it's off by default so the hidden mesh is inert.)
    lake.visible = false;

    const group = new THREE.Group();
    group.name = 'surface-ocean-tsl';
    group.add(sea);
    group.add(river);
    group.add(lake);
    // The reflector target rides the ocean group (same space as the lake); it is a render helper,
    // not a mesh, so it is never tagged onto the reflection layer (the whole ocean group is
    // excluded from that layer by createSurfaceWorldEnvironment → no water-reflects-water feedback).
    if (reflection) group.add(reflection.target);
    group.userData.readability = CH3_WATER_READABILITY_SETTINGS;
    group.userData.sea = sea;
    group.userData.river = river;
    group.userData.sourceChapter = CH3_WATER_READABILITY_SETTINGS.sourceChapter;
    group.userData.sourceBuilder = CH3_WATER_READABILITY_SETTINGS.sourceBuilder;
    return {
        mesh: group,
        material: seaPart.material,
        geometry: seaPart.geometry,
        sea,
        seaMaterial: seaPart.material,
        seaGeometry: seaPart.geometry,
        river,
        riverMaterial: riverPart.material,
        riverGeometry: riverPart.geometry,
        reflection,
        // uShoreOriginXZ / uShoreBaseY: the live env aligns the baked shore heightfield to
        // the terrain's world placement (group world XZ + group Y + terrainOffsetY).
        uniforms: { uOpacity, uShoreOriginXZ, uShoreBaseY },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Landscape (CPU-baked tropical-island terrain; GPU shading only, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU heightfield bake — identical to surface-world.js createLandscape geometry walk.
function buildLandscapeGeometry() {
    const geometry = new THREE.PlaneGeometry(400, 400, 96, 96);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, getTerrainHeight(x, z));
    }
    geometry.computeVertexNormals();
    return geometry;
}

// Value noise in ~[0,1] — TSL twin of the landscape fragment's inline rand/noise.
// rand(p) = fract(sin(dot(p, (127.1, 311.7))) * 43758.5453); snoise3 is the gradient
// stand-in so the snow-patch pattern carries over (remapped to ~[0,1]).
function landscapeNoise(p) {
    return snoise3(vec3(p.x, p.y, 0.0)).mul(0.5).add(0.5);
}

export function createLandscapeTSL(uTime = uniform(0), waterLevel = 60.0) {
    const uWaterLevel = uniform(waterLevel);
    // uSnowBlend is kept (the manager's snowBlendUniformTargets still drive it) but the meadow no
    // longer repaints itself white — see the "GREEN STAYS GREEN" note below. The snow COLOUR
    // uniforms went with the repaint; the skirt/peaks own the winter palette now.
    const uSnowBlend = uniform(0);
    const uOpacity = uniform(1);
    // The live landscape shader is time-independent; uTime stays in the signature for
    // pilot/harness uniformity and is referenced as a no-op so the look is unchanged.
    const t0 = uTime.mul(0.0);

    // vNormal → normalView, vPosition/vWorldPosition → positionWorld (model==world here
    // for shading purposes; the live shader used the model-space transformed position).
    const vNormal = normalView;
    const vPosition = positionWorld;

    // Height based gradient — relative to water level.
    const relHeight = vPosition.y.sub(uWaterLevel).add(t0);
    const sandAmount = smoothstep(1.0, 6.0, relHeight);

    const sandColor = vec3(0.32, 0.36, 0.24); // warm wet earth between grass and shallows (was cool grey-teal)
    // VISUAL POLISH (de-wash): pull the grass into RICH saturated greens (golden-forest /
    // sakura-twilight palette discipline) — a vivid lit spring green low, a deep forest green
    // high — so the hills read green rather than the old pale wash. A subtle blue-green
    // variation by ground noise breaks the plastic uniformity.
    // BotW painterly sage: pull the vivid spring green toward a warmer OLIVE/sage (R nearer G, a
    // yellow-green rather than a saturated emerald) so the meadow reads like a sun-bleached Hyrule
    // field, not a neon lawn. Still lush — just muted enough to sit under the golden-hour grade.
    const grassColorLow = vec3(0.26, 0.58, 0.17); // vivid daylight spring green (Wave A: was olive 0.20,0.46,0.12)
    // Creative plan Ch3 item 1: shaded pole pulled toward #0D3A16 so tree silhouettes
    // separate from the ground in grayscale (the collapsed-value fix).
    const grassColorHigh = vec3(0.05, 0.15, 0.07); // Deep shaded sage-forest green
    // Ramp lifted (5,30)→(12,42): relHeight = terrain h + 7, so the old start=5 put the
    // WALKABLE meadow (h≈3-7 ⇒ rel 10-14) already 10-30% toward the near-black pole while
    // every plant on it kept constant bright greens — the "pasted-on vegetation" altitude
    // mechanism. Now the whole meadow band stays fully grassColorLow and the deep-shade
    // pole is reserved for genuine high crests (h ≥ 35).
    const grassColor = mix(grassColorLow, grassColorHigh, smoothstep(12.0, 42.0, relHeight));

    let color = mix(sandColor, grassColor, sandAmount);

    // Was "a crisp dark line between land and water" (BotW readability item 3) — but with
    // the water surface now carrying a real depth-based shore blend, the near-opaque navy
    // stripe double-painted the boundary as exactly the sharp intersection line the shore
    // blend removes. Widened + softened to a wet-earth darkening that hands off into the
    // water's own shallows. (Deviation from the frozen CH3_WATER_READABILITY numbers is
    // deliberate; the env test pins only deepColor + the shelf-fade signs.)
    const wetBand = oneMinus(smoothstep(0.8, 3.4, relHeight));
    color = mix(
        color,
        vec3(...CH3_WATER_READABILITY_SETTINGS.wetShoreColor),
        wetBand.mul(CH3_WATER_READABILITY_SETTINGS.wetShoreBlend),
    );

    // Subtle ground noise to break up the plastic look + add green tonal variation.
    // PIXELATION FIX (2026-08): this was the classic fract(sin(dot(...)*43758.5453)) hash —
    // per-fragment WHITE noise (decorrelates over ~1e-4 world units), far beyond Nyquist at
    // any resolution, so every framebuffer pixel got an independent random tint at 26% mix.
    // Under DRS below native it upscaled into multi-pixel random blocks — the "chunky
    // pixelated meadow". (WGSL also only guarantees sin() accuracy on [-π,π]; the hash arg
    // reached ~1800 rad and degraded into structured clumps on some GPUs.) Replaced with
    // two octaves of the module's band-limited gradient noise: ~4.5u painterly mottling +
    // a ~1.1u fine grain — both safely above the pixel footprint at all rail distances, so
    // the variation filters correctly instead of sizzling.
    const groundNoise = landscapeNoise(vPosition.xz.mul(0.22)).mul(0.65)
        .add(landscapeNoise(vPosition.xz.mul(0.9)).mul(0.35));
    color = mix(color, color.mul(vec3(0.82, 1.10, 0.78)), groundNoise.mul(0.26));

    // Golden-hour raking key (Batch B5): a LOW warm sun rakes the hills, a cool sky fill
    // lifts the shadows, a warm rim gilds slope edges, and a fake long-shadow gradient
    // bands the terrain along the sun azimuth so the relief reads at the forward angle.
    // De-wash: the cool fill is pulled DOWN + warmed toward neutral so it stops graying the
    // greens, and the overall exposure is lifted so the saturated base survives the shading
    // (peak channel still capped well below white).
    const lightDir = normalize(vec3(SURFACE_SUN_DIR.x, SURFACE_SUN_DIR.y, SURFACE_SUN_DIR.z)); // raking key = shared ODYSSEY_SUN
    const diff = max(dot(vNormal, lightDir), 0.0);
    // PAINTERLY-ASCENT REPALETTE (Wave A): the direct key is now bright NEUTRAL DAYLIGHT (was warm
    // gold 0.98,0.82,0.48, which gilded the whole meadow olive) so the grass stays vivid green; the
    // fill is a brighter cool SKY-blue that lifts shadows toward blue like the reference.
    const warmKey = vec3(0.97, 0.99, 0.93).mul(diff.mul(0.72));
    const coolFill = vec3(0.55, 0.64, 0.70).mul(0.34);
    color = color.mul(warmKey.add(coolFill));
    // Cool sky rim/backlight on grazing slope edges (was amber → now a soft sky-blue lift, capped).
    const rimFactor = pow(oneMinus(max(dot(vNormal, normalize(cameraPosition.sub(vPosition))), 0.0)), 2.0);
    color = color.add(vec3(0.82, 0.90, 0.98).mul(rimFactor).mul(0.10));
    // Fake long-shadow banding: project worldXZ onto the sun azimuth and band it so the
    // raking light reads as long cast shadows across the valley (subtle, value-only).
    const sunAz = vec2(SURFACE_SUN_DIR.x, SURFACE_SUN_DIR.z);
    const shadowPhase = dot(vPosition.xz, sunAz).mul(0.045);
    const longShadow = sin(shadowPhase).mul(0.5).add(0.5);
    // Softer banding for the bright daylight meadow (Wave A: 0.28 → 0.16) — keep a hint of relief
    // structure without carving dark cast-shadow stripes into the lit high-key field.
    color = color.mul(longShadow.mul(0.16).add(0.84));

    // GROUND DE-WASH (2026-08, "landscape doesn't connect to the hills"): the landscape
    // was DOUBLE-fogged — this authored haze PLUS the scene FogExp2 (density ~0.0024 ⇒
    // ~30% wash at 250u, ~60% at 400u), which whitened every hill base into a pale halo so
    // the hills read as pasted behind mist instead of rising from the meadow. Same class of
    // bug as the sky dome / finale space heroes ("#1 de-wash lever": material.fog=false,
    // set below). This authored haze now stands alone: fog-family blue-grey (not the old
    // warm amber that fought the daylight palette), starting past the playable meadow and
    // HEIGHT-WEIGHTED so hill crests shed the haze while valleys hold it — aerial
    // perspective that seats the hills instead of erasing them.
    const dist = length(vPosition.xz);
    const fog = smoothstep(220.0, 560.0, dist);
    const fogHeightWeight = mix(float(1.0), float(0.5), smoothstep(10.0, 30.0, relHeight));
    color = mix(color, vec3(0.47, 0.56, 0.63), fog.mul(fogHeightWeight).mul(0.42));

    // GREEN STAYS GREEN (in-game: "I do not want the green to swap to winter, i want the green to be
    // green and that we transition into the mountain winter landscape without like changing the
    // color... I want the lower ground to have the same green grass color as the hills. Now some
    // hills swap from grass green to snow filled").
    //
    // The meadow used to be REPAINTED white in place as the season drove uSnowBlend, and because the
    // mask was `snowHeight = smoothstep(6, 20, relHeight)` it whitened by ALTITUDE — so the hills
    // turned snowy while the low ground stayed green and the two stopped reading as one field. That
    // is a season recolour of the same ground, which is exactly what we do not want: winter should
    // be somewhere the journey TRAVELS TO, not something that happens to the meadow it is standing on.
    //
    // The meadow now keeps its grass colour for the whole chapter. The green -> rock -> snow ramp
    // still exists, but only on the geometry that is actually the mountain world: the foothill skirt
    // (mountainSkirtColorNode blends MOUNTAIN_SKIRT_MEADOW at its base up into rock and snow at its
    // top) and the peaks above it. So the transition happens by MOVING up the skirt into the range.
    // uSnowBlend stays in the returned uniforms so the collectors/targets are unchanged.

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    // GROUND DE-WASH: opt out of the scene FogExp2 — the authored height-weighted haze
    // above is the landscape's ONE atmosphere now (see the comment there; double-fogging
    // whitened every hill base into a pale disconnected halo).
    material.fog = false;
    // The CPU terrain clamps underwater basins to a flat low shelf. Let that submerged
    // shelf become transparent so the reused Chapter 2 water surface is visible BETWEEN
    // the camera and the islands, while green land remains opaque.
    const landAlpha = smoothstep(
        CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMin,
        CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMax,
        relHeight,
    );
    // As winter approaches, dissolve the far square edge of the Surface terrain into the
    // foothill skirt / mountain range with a noisy depth fade. This keeps the Ch3 meadow from
    // ending as a straight green card against the Ch4 sky.
    const edgeNoise = landscapeNoise(vPosition.xz.mul(0.035)).sub(0.5).mul(45.0);
    // MOUNTAIN↔TERRAIN CONTINUITY: dissolve the terrain's whole OUTER RIM (all four plane edges, via
    // the Chebyshev distance max(|x|,|z|)) into the atmosphere so the meadow never ends on a hard
    // green card/triangle — the seam capture showed the old far-z-only melt left the SIDE edges hard,
    // reading as a sharp green wedge at the Ch3→Ch4 seam. The fade only bites past ~±178 (a ~28u
    // border), so the whole valley — lake, hills, and the ground the camera stands on — stays FULLY
    // solid; only the outermost lip melts. (The earlier "ground missing" bug was fading the near/mid
    // ground; this fades only the far rim, which the eye reads as terrain receding into the range.)
    // Use positionLocal (the plane's own [-200,200] coords), NOT positionWorld — the chapter group
    // is offset along the spline, so worldX/worldZ don't line up with the plane edges (the first cut
    // used positionWorld and the edge stayed hard). max(|localX|,|localZ|) is the true rim distance.
    // NO STRAIGHT EDGES: max(|x|,|z|) is a SQUARE — the meadow melted on a box, so at grazing angles
    // its far rim still read as an angular card with straight sides and hard corners. Blending that
    // Chebyshev distance toward the Euclidean one rounds the melt into an island silhouette, and the
    // (widened) noise warp then breaks the remaining regularity so no edge reads as authored.
    const rimCheb = max(abs(positionLocal.x), abs(positionLocal.z));
    const rimRound = length(positionLocal.xz);
    const rimDist = mix(rimCheb, rimRound, 0.6);
    // The band must stay WIDER than the noise swing. At 38u wide against a +-58u warp the noise
    // dominated the gradient, so alpha snapped between 0 and 1 and the rim came back as a hard
    // angular wedge instead of dissolving. A 78u band against a +-45u warp keeps it a soft coast.
    const farMelt = oneMinus(smoothstep(172.0, 250.0, rimDist.add(edgeNoise)));
    material.opacityNode = uOpacity.mul(landAlpha).mul(farMelt);
    material.transparent = true;
    // GROUND PLATE WRITES DEPTH. The meadow is opaque ground wherever it is above the
    // waterline, so it must OCCLUDE later same-bucket transparent draws instead of letting
    // them paint through it — the identical defect the hero peaks fixed (see
    // mountain-peaks.tsl.js, "SOLIDITY FIX": depthWrite:true + alphaTest).
    //
    // alphaTest is MANDATORY here, not decorative: opacityNode is EXACTLY ZERO over the whole
    // submerged shelf (landAlpha, every fragment below waterline-2.6) and over the outer rim
    // melt (farMelt, rimDist 172->250). Without a discard those invisible fragments would
    // write a depth mask — an unseeable plane covering the entire lake bed and the far rim —
    // that culls the shoreline props and the Ch3->Ch4 seam tree-line standing behind them.
    material.depthWrite = true;
    material.alphaTest = 0.04;
    material.userData.waterShelfFade = {
        min: CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMin,
        max: CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMax,
    };
    // FrontSide only — never show the flat "cardboard" underside of the terrain plane.
    material.side = THREE.FrontSide;

    const geometry = buildLandscapeGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -15; // Base level
    return {
        mesh, material, geometry, uniforms: { uSnowBlend, uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Foothill Bridge (CPU-baked terrain bridge into Chapter 4; GPU shading, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU heightfield bake — identical to surface-world.js createFoothillBridge walk.
// Foothill-bridge surface height at (x, worldZ). EXPORTED so the snow-conifer tree-line can
// seat itself on the exact bridge surface as it climbs across the Ch3→Ch4 seam. The bridge
// mesh sits at (0, terrainOffsetY, -500) with local z built so worldZ == the vertex group-z,
// so a prop at group (x, foothillBridgeHeight(x, gz), gz) lands on the bridge.
export function foothillBridgeHeight(x, worldZ) {
    const clamp01 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const smoothstep01 = (edge0, edge1, v) => {
        const t = clamp01((v - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    };
    const frontZ = -180;
    const backZ = -820;
    const climb = clamp01((-worldZ - 180) / Math.abs(backZ - frontZ), 0, 1);
    const easedClimb = climb * climb * (3 - (2 * climb));
    // NO STRAIGHT EDGES: the shelf/shoulder bands keyed off |x| alone, so every ridge and every
    // band boundary on the skirt ran dead straight down -Z. Offsetting x by a slow wave in worldZ
    // (and the shoulder by a second, different one) bends them into wandering spurs and gullies.
    const bridgeMeander = Math.sin(worldZ * 0.0125 + 0.4) * 46 + Math.cos(worldZ * 0.027 - 1.6) * 20;
    const xm = x - bridgeMeander;
    const centerShelf = 1 - clamp01(Math.abs(xm) / 170, 0, 1);
    const pathCorridor = 1 - clamp01(Math.abs(x + 18) / 140, 0, 1);
    const shoulderMask = smoothstep01(70, 360, Math.abs(xm + (Math.sin(worldZ * 0.019) * 24)));
    // RELIEF (2026-08, "the skirt feels flat"): measured peak-to-peak across 300u of x, the
    // skirt had 7.3u of relief where the meadow beside it has 60.2u — about an eighth, which
    // reads as a plane laid next to a landscape. Two finer octaves added (the original three
    // are all ~45-110u wavelength, so the surface had no detail at the scale the eye reads as
    // ground), and the amplitude below is raised. Kept as cheap analytic sin/cos so the CPU
    // bake stays fast and `foothillBridgeHeight` remains a pure exported function (the
    // snow-conifer belt seats its props by calling it).
    const noise = (
        Math.sin(x * 0.022) * Math.cos(worldZ * 0.013) * 0.55
        + Math.sin((x + worldZ) * 0.009) * 0.3
        + Math.cos((x * 0.018) - (worldZ * 0.01)) * 0.22
        + Math.sin((x * 0.052) + (worldZ * 0.039)) * 0.20
        + Math.cos((x * 0.091) - (worldZ * 0.075)) * 0.11
    );
    // COASTAL PLAIN handoff: the skirt used to start at -18, i.e. ~11u BELOW the waterline, so the
    // sea ran up the carved corridor and lapped the foot of the range ("the water goes to close the
    // mountain"). Lifting the FRONT (the term decays to 0 by the top, so the back edge that meets the
    // range is unchanged) brings the near skirt up to about the waterline, so the meadow hands off to
    // dry rising land and the water is left behind well before the first slope.
    const base = -18 + (easedClimb * 26) + ((1 - easedClimb) * 14);
    const centerLift = centerShelf * (4.5 + (easedClimb * 6.5));
    const shoulderLift = shoulderMask * ((6 + (easedClimb * 22)) * 0.75);
    // Amplitude raised 4/6 → 13/10 for real undulation, but damped along the flight corridor
    // so the lane the camera rides stays smooth (the carve below assumes a calm centre).
    const ridgeLift = noise * (13 + (easedClimb * 10)) * (1 - (pathCorridor * 0.72));
    const backRise = smoothstep01(0.55, 1.0, easedClimb) * 11.5;
    const corridorCarve = pathCorridor * (10 + (easedClimb * 8));
    const frontFeather = (1 - smoothstep01(0.0, 0.12, easedClimb)) * 0.6; // was 2.5 — dug a trench at the handoff
    const raw = base + centerLift + shoulderLift + ridgeLift + backRise - corridorCarve - frontFeather;

    // WELD TO THE MEADOW. The skirt plane and the landscape plate overlap in worldZ ≈ -100..-200,
    // and their heightfields disagreed by a mean of 17.5u and up to 61u there — at x=+120 the
    // meadow rises to +36 while the skirt sat at -5, so the skirt sliced straight through the
    // hills. That is the "disconnected" read: two surfaces at different heights pretending to be
    // one landscape.
    //
    // Through the hand-off band the skirt now converges onto getTerrainHeight itself, sitting just
    // BELOW it. Ordering makes that invisible and seamless: the skirt is renderOrder -2 (drawn
    // first) and the meadow is drawn over it, so while the meadow is opaque it simply hides the
    // skirt; as the meadow's own rim melts (its farMelt runs rimDist 172→250) the skirt emerges at
    // essentially the same height and CONTINUES the surface, with no ledge to see.
    //
    // The weld is damped outside the meadow plate in x, because getTerrainHeight keeps returning
    // values where no meadow mesh exists — matching it out there would sculpt the skirt to an
    // invisible surface. The damp band mirrors the meadow's own rim melt.
    // The weld must stay FULL across the meadow's entire melt band, not release inside it.
    // The meadow's alpha melts over rimDist 172→250 (max(|x|,|z|)); the first cut released the
    // weld from 170/-190, i.e. exactly where the meadow turns semi-transparent — so the skirt's
    // (now much larger) ridges diverged from the terrain by up to 27u right where the meadow was
    // see-through, and they showed THROUGH it as dark angular shapes poking out of the hills.
    // Hold the weld until the meadow is fully gone (past rimDist 250), then release.
    const weldZ = smoothstep01(-360, -255, worldZ); // 1 while the meadow still draws, 0 past it
    const weldX = 1 - clamp01((Math.abs(x) - 255) / 85, 0, 1);
    const weld = weldZ * weldX;
    if (weld <= 0.001) return raw;
    return raw + ((getTerrainHeight(x, worldZ) - 0.5) - raw) * weld;
}

function buildFoothillBridgeGeometry() {
    const bridgeWidth = 920;
    // Reach the skirt FORWARD (depth 680 -> 880, centre -500 -> -540) so its front edge lands at
    // worldZ ~ -100 instead of ~ -160. With the lip now solid it must be tucked well inside the
    // meadow's opaque area (which starts dissolving around rimDist 172), otherwise that straight
    // plane edge is exposed as a hard green wedge once the meadow's rim melts past it.
    const bridgeDepth = 880;
    const bridgeCenterZ = -540;
    const geometry = new THREE.PlaneGeometry(bridgeWidth, bridgeDepth, 104, 112);
    geometry.rotateX(-Math.PI / 2);

    const positionAttribute = geometry.attributes.position;
    for (let i = 0; i < positionAttribute.count; i += 1) {
        const x = positionAttribute.getX(i);
        const worldZ = positionAttribute.getZ(i) + bridgeCenterZ;
        positionAttribute.setY(i, foothillBridgeHeight(x, worldZ));
    }

    geometry.computeVertexNormals();
    return { geometry, bridgeCenterZ };
}

// Value noise in ~[0,1] — TSL twin of the foothill-bridge fragment's inline hash/noise.
function bridgeNoise(p) {
    return snoise3(vec3(p.x, p.y, 0.0)).mul(0.5).add(0.5);
}

export function createFoothillBridgeTSL(uTime = uniform(0)) {
    // The foothill bridge is now a continuous low-amplitude FBM terrain SKIRT that
    // height-blends Surface meadow-green at its base UP into canonical mountain rock at
    // its top — a RAMP, not a hard faceted-grey wedge with a seam. Snow caps the very top
    // as the live winter blend climbs. One language: shared meadow + canonical rock/snow/
    // shadow/fog from mountain-language.js (rock/snow/fog ride the neutral grey-blue pole
    // so the skirt hands off cleanly to the distant range above it).
    const treatment = resolveMountainTreatment({ coolTemp: 0.2 });
    const uMeadow = uniform(new THREE.Color(MOUNTAIN_SKIRT_MEADOW));
    const uRock = uniform(new THREE.Color(treatment.rock));
    const uSnow = uniform(new THREE.Color(treatment.snow));
    const uShadow = uniform(new THREE.Color(treatment.shadow));
    const uFog = uniform(new THREE.Color(treatment.fog));
    const uSnowBlend = uniform(0);
    const uOpacity = uniform(1);
    // The skirt shading is time-independent; uTime stays in the signature for
    // pilot/harness uniformity and is referenced as a no-op so the look is unchanged.
    const t0 = uTime.mul(0.0);

    // World-space normal — the foothill skirt shares mountainSkirtColorNode's world-space
    // key light with the peaks, so it must use the same frame or the skirt de-syncs from the
    // range it ramps into (same port bug; see createFBMMountainTSL).
    const vNormal = normalWorld;
    const vWorldPosition = positionWorld.add(t0);
    const vLocalPosition = positionLocal;

    const terrainNoise = bridgeNoise(vWorldPosition.xz.mul(0.018));

    // ONE skirt ramp treatment (shared/mountain-language.js): meadow base -> rock top,
    // snow cap, canonical lighting + atmospheric fog.
    const color = mountainSkirtColorNode({
        uMeadow,
        uRock,
        uSnow,
        uShadow,
        uFog,
        uSnowBlend,
        vNormal,
        vWorldPosition,
        vLocalHeight: vLocalPosition.y,
        noise: terrainNoise,
        // Raised (+10) to compensate for the skirt's lifted front: mountainSkirtColorNode ramps
        // meadow -> rock -> snow off vLocalHeight, so lifting the geometry pulled rock and snow
        // DOWNHILL toward the meadow — the opposite of "green stays green". With these the near
        // skirt reads grass like the meadow it joins, and only the climb turns rock then snow.
        rockStartY: 36.0,
        snowStartY: 28.0,
    });

    // Far-depth opacity fade so the skirt's back edge dissolves into the distant range instead of
    // ending on a hard line. MOUNTAIN↔TERRAIN CONTINUITY (remake plan, art fix #1): apply it ALWAYS,
    // not only once winter's snow lifts up the ramp — so the meadow→foothill-bridge→peak handoff is
    // continuous from frame 1 in golden-hour too (winter was already applying it).
    // Dissolve ONLY the skirt's far BACK edge into the distant range so it doesn't end on a hard
    // line — but keep the bridge FRONT solid so it seats onto the meadow's far edge with no
    // transparent gap between them (the earlier always-on front fade opened that gap, part of the
    // "ground feels missing" report). Far-only melt; the bridge the eye travels up stays opaque.
    const depth = vWorldPosition.z.negate();
    const seamFade = oneMinus(smoothstep(250.0, 650.0, depth.sub(terrainNoise.mul(80.0))));
    // Dissolve the skirt's NEAR + SIDE lips into the atmosphere too (not just the far back edge):
    // the seam captures showed the bridge ending on hard opaque GREEN card edges (its near front
    // lip + its left/right sides) reading as sharp wedges over the golden haze at the Ch3→Ch4
    // approach. Fading all four plane rims (Chebyshev-style on the bridge's local coords, a noisy
    // ~80u lip) lets the ramp melt into the haze on every side; the mid stays fully solid so the
    // ground the eye travels up is continuous. The far edge additionally keeps its range seamFade.
    const edgeNoiseZ = bridgeNoise(vWorldPosition.xz.mul(0.03)).sub(0.5).mul(40.0);
    // ONE CONNECTED WORLD: the rim fade used to be SYMMETRIC on |localZ|, so the bridge's FRONT lip
    // (localZ→+340, i.e. worldZ≈−160..−242) dissolved in exactly the band where the meadow's own rim
    // melt (178→206) was already dissolving. Two fades over the same ground = no ground: the pale
    // empty gap between the water and the mountain base. The front lip is UNDERLAPPED by solid
    // meadow (which stays opaque to worldZ≈−178), so it does not need to melt at all — only a thin
    // feather at the very edge as insurance. The BACK lip keeps the full melt into the range.
    const zLocalN = vLocalPosition.z.add(edgeNoiseZ);
    const backness = oneMinus(smoothstep(-30.0, 30.0, zLocalN)); // 1 toward the range, 0 toward the meadow
    const backRim = oneMinus(smoothstep(334.0, 436.0, abs(zLocalN)));
    const frontRim = oneMinus(smoothstep(422.0, 440.0, abs(zLocalN)));
    const rimFadeZ = mix(frontRim, backRim, backness);
    const rimFadeX = oneMinus(smoothstep(388.0, 456.0, abs(vLocalPosition.x).add(edgeNoiseZ)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    // ATMOSPHERE PARITY: the landscape it grows out of and the range it climbs into BOTH opt out
    // of the scene FogExp2 and carry their own authored haze. The skirt did not — so the one
    // surface bridging them was the only one getting a pale scene-fog wash mixed in, which
    // flattened its contrast and made it read as a separate, hazier layer between two crisp ones.
    // Its own mountainSkirtColorNode fog ramp is its atmosphere, exactly like its neighbours.
    material.fog = false;
    material.opacityNode = uOpacity.mul(seamFade).mul(rimFadeZ).mul(rimFadeX);
    material.transparent = true;
    material.depthWrite = true;
    material.depthTest = true;
    material.side = THREE.FrontSide;

    const { geometry, bridgeCenterZ } = buildFoothillBridgeGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, bridgeCenterZ);
    mesh.renderOrder = -2;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend, uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Fluffy Grass (the chapter's only InstancedMesh material; wind sway, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// Procedural grass-blade billboard texture — identical to surface-world.js.
function createGrassTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, 512, 512);
    const drawBlade = (x, height, width, lean, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - width / 2, 512);
        ctx.quadraticCurveTo(x + lean, 512 - height / 2, x + lean * 2, 512 - height);
        ctx.quadraticCurveTo(x + lean + width / 2, 512 - height / 2, x + width / 2, 512);
        ctx.fill();
    };
    for (let i = 0; i < 150; i += 1) {
        const x = Math.random() * 512;
        const h = 200 + Math.random() * 300;
        const w = 15 + Math.random() * 20;
        const l = (Math.random() - 0.5) * 100;
        const lightness = 24 + Math.random() * 24;
        const color = `hsl(108, 58%, ${lightness}%)`;
        drawBlade(x, h, w, l, color);
    }
    const grassTex = new THREE.CanvasTexture(canvas);
    // Hygiene for if fluffy grass is ever restored (currently dormant — live add is
    // commented out): blades are authored in sRGB hsl(), and the rail camera grazes them.
    grassTex.colorSpace = THREE.SRGBColorSpace;
    grassTex.anisotropy = 8;
    return grassTex;
}

export function createFluffyGrassTSL(uTime = uniform(0), count = 1000) {
    const uColorBottom = uniform(new THREE.Color(0x1b4a22));
    const uColorTop = uniform(new THREE.Color(0x6eb846));

    const grassTexture = createGrassTexture();

    const planeGeo = new THREE.PlaneGeometry(8, 8);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = planeGeo.index;
    geometry.attributes = planeGeo.attributes;

    const vUv = uv();

    // Wind sway in the vertex stage — pos.x/pos.z displaced by uv.y^2 weighted wind.
    // (Per-instance world placement comes from instanceMatrix; the GLSL used object-space
    //  pos.x/pos.z in the wind phase, which we mirror with positionLocal.)
    const posL = positionLocal;
    const wind = sin(uTime.mul(0.5).add(posL.x.mul(0.1)).add(posL.z.mul(0.1))).mul(0.2);
    const wind2 = cos(uTime.mul(0.7).add(posL.z.mul(0.2))).mul(0.1);
    const sway = vUv.y.mul(vUv.y).mul(2.0);
    const displaced = vec3(
        posL.x.add(wind.mul(sway)),
        posL.y,
        posL.z.add(wind2.mul(sway)),
    );

    // Fragment: tinted grass texture, alpha-test discard (texColor.a < 0.5 → discard).
    const texColor = grassTexture
        ? texture(grassTexture, vUv)
        : vec3(1.0, 1.0, 1.0);
    const tint = mix(uColorBottom, uColorTop, vUv.y);
    const color = grassTexture ? tint.mul(texColor.rgb) : tint;
    const alpha = grassTexture ? texColor.a : float(1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    material.colorNode = color;
    material.opacityNode = alpha;
    // Hard alpha cutout, matching `if (texColor.a < 0.5) discard;`.
    material.alphaTest = 0.5;
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.depthWrite = false;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();

    let instanceCount = 0;
    for (let i = 0; i < count; i += 1) {
        const x = (Math.random() - 0.5) * 350;
        const z = (Math.random() - 0.5) * 350;
        const h = getTerrainHeight(x, z);

        // Only on "land" (h > 4.0) — distant hills.
        if (h >= 4.0) {
            const dummyScale = 0.5 + Math.random() * 0.5;
            dummy.position.set(x, h + 1.5, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(dummyScale, dummyScale, dummyScale);
            dummy.updateMatrix();
            mesh.setMatrixAt(instanceCount, dummy.matrix);
            instanceCount += 1;
        }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = instanceCount;
    mesh.position.y = -15; // Match landscape group offset.

    return {
        mesh, material, geometry, texture: grassTexture,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5b. Living Landscapes vegetation (instanced low-poly props — "Living Landscapes")
// ═══════════════════════════════════════════════════════════════════════════════
//
// Phase B set-dressing: the chapter read as bare rolling hills. This adds INSTANCED,
// CAPPED, low-poly vegetation anchored to the same getTerrainHeight() as the terrain so
// it sits ON the ground (no floating): grass tufts (closed cones — real volume, no flat
// cardboard underside), a few trees (merged trunk+canopy), and water-edge reeds. A
// shared wind-sway node bends each prop by its world-space phase. All MeshBasicNodeMaterial
// (FrontSide solid, no bloom). Anchoring matches the live grass: land props gate on
// h >= 4.0; reeds hug the shoreline band.

// Merge an array of {geo, offset:[x,y,z]} into one BufferGeometry (no external dep).
function mergeOffsetGeometries(parts) {
    const merged = new THREE.BufferGeometry();
    let vertexCount = 0;
    let indexCount = 0;
    parts.forEach(({ geo }) => {
        vertexCount += geo.attributes.position.count;
        indexCount += geo.index ? geo.index.count : geo.attributes.position.count;
    });

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);

    let vOff = 0;
    let iOff = 0;
    parts.forEach(({ geo, offset }) => {
        const [ox, oy, oz] = offset || [0, 0, 0];
        const pos = geo.attributes.position;
        const nrm = geo.attributes.normal;
        for (let i = 0; i < pos.count; i += 1) {
            positions[(vOff + i) * 3] = pos.getX(i) + ox;
            positions[(vOff + i) * 3 + 1] = pos.getY(i) + oy;
            positions[(vOff + i) * 3 + 2] = pos.getZ(i) + oz;
            normals[(vOff + i) * 3] = nrm ? nrm.getX(i) : 0;
            normals[(vOff + i) * 3 + 1] = nrm ? nrm.getY(i) : 1;
            normals[(vOff + i) * 3 + 2] = nrm ? nrm.getZ(i) : 0;
        }
        if (geo.index) {
            for (let i = 0; i < geo.index.count; i += 1) {
                indices[iOff + i] = geo.index.getX(i) + vOff;
            }
            iOff += geo.index.count;
        } else {
            for (let i = 0; i < pos.count; i += 1) {
                indices[iOff + i] = vOff + i;
            }
            iOff += pos.count;
        }
        vOff += pos.count;
        geo.dispose();
    });

    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    return merged;
}

// Shared wind-sway position node: bends the prop's UPPER half along x/z by a per-world
// phase, so taller props sway more at the tip and stay rooted at the base.
function vegetationSwayNode(uTime, strength = 1.0) {
    const posL = positionLocal;
    // Sway weight rises with local height (base ~0, tip ~1); square for a rooted bend.
    const heightW = smoothstep(0.0, 6.0, posL.y);
    const w = heightW.mul(heightW).mul(strength);
    const phase = uTime.mul(0.9).add(positionWorld.x.mul(0.06)).add(positionWorld.z.mul(0.05));
    const swayX = sin(phase).mul(0.55).mul(w);
    const swayZ = cos(phase.mul(0.8).add(1.3)).mul(0.35).mul(w);
    return vec3(posL.x.add(swayX), posL.y, posL.z.add(swayZ));
}

// Golden backlit SSS rim (Midsommar-inspired): a warm translucent glow when the camera looks
// toward the low sun THROUGH the foliage — the golden-hour "glow" that makes grass/flowers read
// as lit volume, not flat cards. Additive IN-SHADER so it survives the shared ACES post grade.
// `heightFrac` (0 base → 1 tip) concentrates the glow at the sunlit tips. Returns a vec3 to ADD
// to a vegetation colorNode.
function backlitSSSNode(heightFrac, strength = 0.5) {
    const sunDirN = vec3(SURFACE_SUN_DIR.x, SURFACE_SUN_DIR.y, SURFACE_SUN_DIR.z);
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const backlit = pow(clamp(dot(sunDirN, viewDir), 0.0, 1.0), float(2.5));
    return vec3(0.988, 0.835, 0.506).mul(backlit).mul(heightFrac).mul(strength); // #FCD581 warm gold
}

// Shared meadow wind direction (XZ) for the 3D wildflowers.
const SURFACE_WIND_DIR = new THREE.Vector2(0.94, 0.34);

// Height-masked wind sway for the instanced 3D wildflowers (Midsommar's makeFloraMat grammar):
// the bloom top bends along the wind while the stem stays rooted, phased PER-INSTANCE by a
// world-XZ attribute (positionNode runs BEFORE instanceMatrix, so the final world pos isn't
// available here — aWorldXZ is baked on the CPU at placement).
//
// CONSOLIDATION (remake plan action #2): the per-species params (amp/stiff/flutter/height) come
// from a per-instance `aSway` attribute instead of baked float() constants, so ONE material object
// drives ALL wildflower species — the 5 near-identical species materials (which differed ONLY by
// these constants) collapse to a single compiled pipeline, killing 4 of the chapter's first-visit
// compiles with zero visual change. aSway = vec4(amp, stiff, flutter, height); each species fills
// it uniformly across its instances.
function floraSwayNodeShared(uTime) {
    const aSway = attribute('aSway', 'vec4');
    const yN = clamp(positionLocal.y.div(aSway.w), 0.0, 1.0);
    const mask = pow(yN, aSway.y);
    const wxz = attribute('aWorldXZ', 'vec2');
    const ph = wxz.x.mul(0.6).add(wxz.y.mul(0.45));
    const sway = sin(uTime.mul(1.05).add(ph)).mul(0.7)
        .add(sin(uTime.mul(0.46).add(ph.mul(1.7))).mul(0.3));
    const bend = sway.mul(aSway.x).mul(mask);
    const flut = sin(uTime.mul(5.5).add(ph.mul(3.0))).mul(aSway.z).mul(yN);
    return positionLocal.add(vec3(
        float(SURFACE_WIND_DIR.x).mul(bend).add(flut),
        bend.abs().mul(-0.03),
        float(SURFACE_WIND_DIR.y).mul(bend).add(flut.mul(0.5)),
    ));
}

// Per-instance green-tint attribute: a small multiplicative RGB jitter so a field of
// instanced props reads as VARIED foliage (some bluer, some more yellow-green, some darker)
// instead of one flat plastic green — the "varied, better-coloured" the brief asks for.
// Cheap (3 floats/instance, no per-frame work). Returns the Float32Array to attach as aTint.
function buildTintArray(maxCount, spread = 0.18) {
    const tints = new Float32Array(maxCount * 3);
    for (let i = 0; i < maxCount; i += 1) {
        // Bias the jitter toward green: R/B vary more than G so hue shifts, value stays put.
        const warm = (Math.random() - 0.5) * spread; // +warm/-cool on R
        const cool = (Math.random() - 0.5) * spread; // +cool/-warm on B
        const val = 1.0 + (Math.random() - 0.5) * spread * 0.7; // gentle value jitter
        tints[i * 3] = val + warm;
        tints[i * 3 + 1] = val;
        tints[i * 3 + 2] = val + cool;
    }
    return tints;
}

// Low-poly grass tuft: a tight fan of 3 closed cones — volume, no flat underside.
export function createGrassTuftsTSL(uTime = uniform(0), count = 760) {
    // A SHORT base carpet (blades ~2u) that fills the ground BELOW the taller flowers (2.4–4.3u)
    // so it never occludes the blooms — a lush ground, not a wall of spikes.
    const blade = () => new THREE.ConeGeometry(0.5, 2.0, 5, 1, false);
    const geometry = mergeOffsetGeometries([
        { geo: blade(), offset: [0, 1.0, 0] },
        { geo: blade(), offset: [0.6, 0.85, 0.2] },
        { geo: blade(), offset: [-0.55, 0.85, -0.3] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.22), 3));

    // VISUAL POLISH (de-wash): richer saturated tuft greens + per-instance tint variation,
    // plus the golden backlit SSS rim so the carpet glows toward the low sun (Midsommar look).
    const grassHeightFrac = smoothstep(0.0, 2.0, positionLocal.y);
    const colorNode = mix(
        vec3(0.055, 0.27, 0.065), // shaded base green
        vec3(0.28, 0.62, 0.14), // saturated sunlit blade green
        grassHeightFrac,
    ).mul(attribute('aTint', 'vec3')).add(backlitSSSNode(grassHeightFrac, 0.4));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 1.0);
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    let guard = 0;
    // Same field + composition gate as the flowers so grass underlies every bloom (no floating
    // cards) and the carpet hugs the path exactly like the meadow — banks-dense, corridor-clear.
    while (n < count && guard < count * 16) {
        guard += 1;
        const x = (Math.random() - 0.5) * 460;
        const z = (Math.random() - 0.5) * 460 - 60;
        if (!surfaceMeadowPlace(x, z)) continue;
        const h = getTerrainHeight(x, z);
        if (h < 4.0) continue;
        const s = 0.6 + Math.random() * 0.8;
        dummy.position.set(x, h - 0.2, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        n += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15; // Match landscape offset.
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// Wildflower meadow (sky-children-v2 meadow-flowers grammar, ported to the Odyssey chapter):
// thousands of small CROSS-CARD flowers anchored to the terrain, colored in coherent
// painterly drifts (yellow/pink/white/purple/blue), with a stem→petal gradient, a petal-shape
// alpha, and a gentle wind sway. This REPLACES the old grass tufts.
const FLOWER_FAMILIES = [
    [1.0, 0.80, 0.16], // yellow
    [0.98, 0.40, 0.62], // pink
    [0.98, 0.96, 0.90], // white
    [0.64, 0.38, 0.92], // purple
    [0.36, 0.58, 0.96], // blue
];
const FLOWER_STEM = [0.34, 0.52, 0.27];

export function createMeadowFlowersTSL(uTime = uniform(0), count = 3600) {
    const positions = [];
    const colors = [];
    const phases = [];
    const uvy = [];
    const uvx = [];
    const indices = [];

    // One card (4 verts, 2 tris); `rot` swaps X/Z so each flower is a cross of two cards
    // (visible from any angle). Base xz/y is baked from getTerrainHeight (CPU-anchored).
    const pushQuad = (bx, by, bz, w, h, col, phase, rot) => {
        const base = positions.length / 3;
        const corners = [
            [-w, 0, 0, -1, 0], [w, 0, 0, 1, 0], [w, h, 0, 1, 1], [-w, h, 0, -1, 1],
        ];
        for (let c = 0; c < 4; c += 1) {
            const [cx, cy, cz, ux, uy] = corners[c];
            let lx = cx; let lz = cz;
            if (rot) { const t = lx; lx = lz; lz = t; }
            positions.push(bx + lx, by + cy, bz + lz);
            colors.push(col[0], col[1], col[2]);
            phases.push(phase);
            uvx.push(ux);
            uvy.push(uy);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    // Coherent color drifts: ~45-unit patches share a family (painterly bands, not noise).
    const familyAt = (x, z) => {
        const s = Math.sin(Math.floor(x / 45) * 127.1 + Math.floor(z / 45) * 311.7) * 43758.5453;
        const f = s - Math.floor(s);
        return FLOWER_FAMILIES[Math.floor(f * FLOWER_FAMILIES.length) % FLOWER_FAMILIES.length];
    };

    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 8) {
        guard += 1;
        const x = (Math.random() - 0.5) * 460;
        const z = (Math.random() - 0.5) * 460 - 60;
        const groundH = getTerrainHeight(x, z);
        if (groundH < 4.0) continue; // grass only — above the waterline
        const src = familyAt(x, z);
        const shade = 0.84 + Math.random() * 0.3;
        const col = [
            Math.min(1, src[0] * shade), Math.min(1, src[1] * shade), Math.min(1, src[2] * shade),
        ];
        const h = 2.4 + Math.random() * 1.9;
        const w = h * (0.18 + Math.random() * 0.09);
        const phase = Math.random() * 6.2831;
        pushQuad(x, groundH - 0.2, z, w, h, col, phase, 0);
        pushQuad(x, groundH - 0.2, z, w, h, col, phase, 1);
        placed += 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    geometry.setAttribute('aUvy', new THREE.Float32BufferAttribute(uvy, 1));
    geometry.setAttribute('aUvx', new THREE.Float32BufferAttribute(uvx, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // silence "normal not found" on MeshBasicNodeMaterial
    geometry.frustumCulled = false;

    const aColor = attribute('aColor', 'vec3');
    const aPhase = attribute('aPhase', 'float');
    const aUvy = attribute('aUvy', 'float');
    const aUvx = attribute('aUvx', 'float');

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.alphaTest = 0.42;
    material.toneMapped = false; // keep the family colors vivid (matches the chapter's props)

    // Gentle wind sway — the top (aUvy→1) sways, the base stays planted.
    const sway = sin(uTime.mul(1.4).add(aPhase)).mul(aUvy).mul(0.5);
    material.positionNode = positionLocal.add(vec3(sway.mul(0.9), 0.0, sway.mul(0.4)));

    // Stem→petal gradient (green base into the saturated family color), tiny warm top bias.
    const stem = vec3(FLOWER_STEM[0], FLOWER_STEM[1], FLOWER_STEM[2]);
    const head = aColor.mul(vec3(1.06, 1.02, 0.98));
    material.colorNode = mix(stem, head, smoothstep(0.30, 0.66, aUvy));

    // Petal shape: taper the card to a soft teardrop point (driven through alphaTest).
    material.opacityNode = oneMinus(smoothstep(0.45, 1.0, aUvx.abs().mul(aUvy)));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.position.y = -15; // overwritten by the env's terrainOffsetY like the other vegetation
    return { mesh, material, geometry };
}

// Real 3D per-species WILDFLOWERS (replaces the flat cross-card meadow blooms): oxeye daisies,
// buttercups, poppies + tall lupine & cornflower spikes — procedural geometry with baked vertex
// colour (summer-flora.js, no GLB assets), instanced per species, wind-swayed (floraSwayNode) and
// terrain-anchored. Daisy-dominant like the Midsommar reference. Returns { group, mesh, parts }.
// Scales are LARGE for the big Ch3 world (trees ~14u, grass ~2u): realistic flora proportions
// read as invisible specks here, so the blooms are bumped to bold, stylised heroes (~3–4u tall,
// heads ~0.6–0.8u) that rise above the grass and read as a lush colour field from the moving
// journey camera — the same builders Midsommar uses at its smaller world scale.
const WILDFLOWER_SPECIES = [
    {
        build: buildDaisy, frac: 0.40, sMin: 4.0, sMax: 5.8, amp: 0.16, stiff: 1.2, flutter: 0.04,
    },
    {
        build: buildButtercup, frac: 0.22, sMin: 4.6, sMax: 6.4, amp: 0.20, stiff: 1.1, flutter: 0.05,
    },
    {
        build: buildPoppy, frac: 0.08, sMin: 4.4, sMax: 5.8, amp: 0.18, stiff: 1.1, flutter: 0.05,
    },
    {
        build: buildLupine, frac: 0.14, sMin: 3.0, sMax: 4.4, amp: 0.22, stiff: 1.3, flutter: 0.03,
    },
    {
        build: buildCornflower, frac: 0.16, sMin: 4.0, sMax: 5.6, amp: 0.22, stiff: 1.3, flutter: 0.03,
    },
];

export function createWildflowersTSL(uTime = uniform(0), count = 1400) {
    const group = new THREE.Group();
    group.name = 'wildflowers-3d';
    const parts = [];
    const dummy = new THREE.Object3D();

    // ONE shared material across all five species (remake plan action #2). The species differ only
    // in geometry + the sway constants, which now ride the per-instance aSway attribute — so this
    // single MeshBasicNodeMaterial compiles ONCE instead of five times. colorNode still reads each
    // geometry's baked vertex colour, so every species keeps its exact palette.
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = floraSwayNodeShared(uTime);
    // ROOT-TIE (2026-08 "pasted-on" fix): the baked stem greens (~0x3f7a28-0x4f7a2a linear)
    // are about HALF the value and 1.6× the saturation of the flat-lit terrain product
    // (0.161, 0.383, 0.111) and receive none of its key/fill shading — every drift stood on
    // an alien stalk. Blend the lower stem from the exact lit-meadow colour up into the
    // baked species colour, so each flower grows OUT of the ground it stands on. yN uses
    // positionGeometry (NOT positionLocal — r181 InstanceNode reassigns positionLocal
    // before positionNode runs) over the species height carried in aSway.w. Heads keep
    // their vivid baked colour (and toneMapped=false) — only the roots seat.
    const stemNorm = clamp(
        positionGeometry.y.div(attribute('aSway', 'vec4').w.max(0.001)),
        0.0,
        1.0,
    );
    material.colorNode = mix(
        vec3(0.161, 0.383, 0.111),
        attribute('color', 'vec3'),
        smoothstep(0.20, 0.55, stemNorm),
    );
    material.side = THREE.DoubleSide;
    material.toneMapped = false; // keep the family colours vivid (matches the chapter props)

    WILDFLOWER_SPECIES.forEach((sp) => {
        const geo = sp.build();
        geo.computeBoundingBox();
        const gh = Math.max(0.001, geo.boundingBox.max.y - geo.boundingBox.min.y);
        const cnt = Math.max(1, Math.round(count * sp.frac));

        const mesh = new THREE.InstancedMesh(geo, material, cnt);
        const aWorldXZ = new Float32Array(cnt * 2);
        const aSway = new Float32Array(cnt * 4); // (amp, stiff, flutter, height) — uniform per species
        let n = 0;
        let guard = 0;
        while (n < cnt && guard < cnt * 24) {
            guard += 1;
            // BotW: cluster blooms into a FEW deliberate drift patches (open meadow between), not
            // a banks-wide carpet — even-disc samples within a random SURFACE_FLOWER_PATCHES patch.
            const { x, z } = surfaceFlowerPatchSample();
            const h = getTerrainHeight(x, z);
            if (h < 4.0) continue; // above the waterline (lakeside patches gate at the shore)
            const s = sp.sMin + Math.random() * (sp.sMax - sp.sMin);
            dummy.position.set(x, h - 0.2, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.scale.set(s, s * (0.9 + Math.random() * 0.3), s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            aWorldXZ[n * 2] = x;
            aWorldXZ[n * 2 + 1] = z;
            aSway[n * 4] = sp.amp;
            aSway[n * 4 + 1] = sp.stiff;
            aSway[n * 4 + 2] = sp.flutter;
            aSway[n * 4 + 3] = gh;
            n += 1;
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        geo.setAttribute('aWorldXZ', new THREE.InstancedBufferAttribute(aWorldXZ, 2));
        geo.setAttribute('aSway', new THREE.InstancedBufferAttribute(aSway, 4));
        mesh.frustumCulled = false;
        group.add(mesh);
        parts.push({ mesh, material, geometry: geo });
    });

    return { group, mesh: group, parts };
}

// A few low-poly trees: merged trunk (cylinder) + two stacked canopy cones. Denser + more
// varied than before, with richer greens, per-instance tint and a warm golden-hour rim.
export function createTreesTSL(uTime = uniform(0), count = 40, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const trunk = new THREE.CylinderGeometry(0.55, 0.9, 7, 6, 1);
    const canopyLow = new THREE.ConeGeometry(4.2, 6.5, 7, 1);
    const canopyHigh = new THREE.ConeGeometry(2.9, 5.5, 7, 1);
    const canopySideA = new THREE.ConeGeometry(2.8, 4.8, 7, 1);
    const canopySideB = new THREE.ConeGeometry(2.5, 4.4, 7, 1);
    const branchA = new THREE.CylinderGeometry(0.18, 0.32, 5.4, 5, 1);
    branchA.rotateZ(Math.PI / 2.9);
    branchA.rotateY(0.45);
    const branchB = new THREE.CylinderGeometry(0.14, 0.28, 4.6, 5, 1);
    branchB.rotateZ(-Math.PI / 3.2);
    branchB.rotateY(-0.7);
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 3.5, 0] },
        { geo: branchA, offset: [1.6, 7.1, 0.2] },
        { geo: branchB, offset: [-1.3, 8.8, -0.4] },
        { geo: canopyLow, offset: [0, 9.5, 0] },
        { geo: canopySideA, offset: [2.6, 10.2, 1.0] },
        { geo: canopySideB, offset: [-2.1, 11.2, -1.2] },
        { geo: canopyHigh, offset: [0, 13.0, 0] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.26), 3));
    geometry.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;

    // Crown gradient (plan item 5, sakura discipline): a darker shadow underbelly so each
    // tree has a glowing top and a dark belly that separates from the ground in grayscale.
    const isTrunk = oneMinus(smoothstep(6.0, 7.2, positionLocal.y));
    const tint = attribute('aTint', 'vec3');
    const crownGrade = smoothstep(7.0, 16.0, positionLocal.y);
    let foliage = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.deciduousShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.deciduousSunlit),
        crownGrade,
    );
    // Autumn recolor (plan item 6): deciduous foliage ages rust→gold with the season.
    const autumnFoliage = mix(vec3(0.55, 0.27, 0.1), vec3(0.91, 0.69, 0.29), crownGrade);
    foliage = mix(foliage, autumnFoliage, seasonAutumnT(uSeason)).mul(tint);
    const bark = vec3(0.34, 0.22, 0.12);
    // Snow toward the seam: the crown whitens as uSnowBlend rises, so the deciduous trees join
    // the winter tree-line gradient instead of staying summer-green up to the snow line.
    const uSnowBlend = options.uSnowBlend ?? uniform(0);
    const snowCap = crownGrade.mul(uSnowBlend).mul(oneMinus(isTrunk));
    const colorNode = mix(mix(foliage, bark, isTrunk), vec3(0.93, 0.96, 1.0), snowCap.mul(0.6));
    // TRUE sun-direction BACKLIT canopy glow (Midsommar-inspired): a warm golden rim that reads
    // only when the camera looks toward the low sun THROUGH the canopy — NOT the old view-only
    // fresnel that gilded every silhouette edge regardless of the sun. Emissive so it glows
    // independent of the diffuse (and feeds bloom in-game); concentrated on the upper crown.
    const canopyBacklit = backlitSSSNode(crownGrade, 0.5).mul(oneMinus(isTrunk));

    // LIT material (was unlit MeshBasic): the merged cone/trunk geometry is real 3D, but an
    // unlit material left it reading as flat cardboard. Lambert lets the directional sun reveal
    // the conical form; flatShading gives each facet a distinct catch (the crisp low-poly read
    // Midsommar gets from its faceN normal); the backlit glow stays as an emissive accent.
    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.4); // gentle whole-tree sway
    material.colorNode = colorNode;
    material.emissiveNode = canopyBacklit;
    material.flatShading = true;
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    // Deliberate STANDS around curated hearts (not random), gated OUT of the corridor + hero.
    const clusters = DECIDUOUS_HEARTS;
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 18) {
        guard += 1;
        const heart = clusters[guard % clusters.length];
        const x = heart.x + (Math.random() - 0.5) * 40;
        const z = heart.z + (Math.random() - 0.5) * 40;
        if (!surfaceTreeGate(x, z)) continue; // off-corridor, on higher ground, clear of the hero
        const h = getTerrainHeight(x, z);
        // ≥2.5× scale spread (saplings→old growth), with deeper hearts capped shorter for depth.
        const depthCap = 1 - smoothstepCPU(-60, -240, z) * 0.5;
        const s = (0.55 + Math.random() * 1.45) * depthCap;
        dummy.position.set(x, h - 0.5, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(s, s * (0.85 + Math.random() * 0.5), s);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        n += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    mesh.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend },
    };
}

// Spruce stands (creative plan item 5): the second species — five overlapping canopy
// cones on a short trunk (the golden-forest merged-spruce grammar), darker and spikier
// than the deciduous rounds so mixed stands read as forest, not uniform stamping.
// Evergreen: no autumn recolor (the conifers hold their green into the snow).
export function createSpruceTreesTSL(uTime = uniform(0), count = 22, options = {}) {
    const trunk = new THREE.CylinderGeometry(0.4, 0.7, 4.5, 6, 1);
    const tier = (r, hgt) => new THREE.ConeGeometry(r, hgt, 7, 1);
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 2.2, 0] },
        { geo: tier(4.6, 5.5), offset: [0, 6.5, 0] },
        { geo: tier(3.9, 5.2), offset: [0, 9.3, 0] },
        { geo: tier(3.1, 4.8), offset: [0, 12.0, 0] },
        { geo: tier(2.2, 4.2), offset: [0, 14.6, 0] },
        { geo: tier(1.3, 3.6), offset: [0, 17.0, 0] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.2), 3));

    const isTrunk = oneMinus(smoothstep(3.8, 4.8, positionLocal.y));
    const spruceGreen = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.spruceShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.spruceSunlit),
        smoothstep(5.0, 18.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));
    const bark = vec3(0.28, 0.18, 0.11);
    // Snow toward the seam: spruces are the conifer bridge to the snow-tree-line, so they take
    // the heaviest snow cap (whole crown whitens as uSnowBlend rises).
    const uSnowBlend = options.uSnowBlend ?? uniform(0);
    const snowCap = smoothstep(4.5, 18.0, positionLocal.y).mul(uSnowBlend).mul(oneMinus(isTrunk));
    const colorNode = mix(mix(spruceGreen, bark, isTrunk), vec3(0.93, 0.96, 1.0), snowCap.mul(0.7));
    const rim = pow(oneMinus(max(dot(normalView, normalize(cameraPosition.sub(positionWorld))), 0.0)), 2.0);

    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.25);
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.78, 0.58, 0.28).mul(rim).mul(0.05).mul(oneMinus(isTrunk));
    material.flatShading = true; // crisp low-poly facets (Midsommar faceted read)
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    // Deliberate spruce STANDS around curated hearts, gated OUT of the corridor + hero.
    const clusters = SPRUCE_HEARTS;
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 18) {
        guard += 1;
        const heart = clusters[guard % clusters.length];
        const x = heart.x + (Math.random() - 0.5) * 36;
        const z = heart.z + (Math.random() - 0.5) * 36;
        if (!surfaceTreeGate(x, z, 7.0, 42)) continue; // higher ground, off-corridor, off-hero
        const h = getTerrainHeight(x, z);
        const depthCap = 1 - smoothstepCPU(-60, -240, z) * 0.5;
        const s = (0.6 + Math.random() * 1.3) * depthCap;
        dummy.position.set(x, h - 0.4, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(s, s * (0.9 + Math.random() * 0.45), s);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        n += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend },
    };
}

// Water-edge reeds: tall thin tapered cones clustered along the shoreline band.
export function createReedsTSL(uTime = uniform(0), count = 220) {
    // 7-sided (was 4): a 4-sided cone seen edge-on collapses to a thin triangular shard —
    // the green "slivers" in capture. 7 sides + DoubleSide give a readable reed from any angle.
    const geometry = new THREE.ConeGeometry(0.28, 8.5, 6, 1, false);

    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.2), 3));
    const colorNode = mix(
        vec3(0.34, 0.48, 0.14), // richer olive base
        vec3(0.74, 0.82, 0.34), // warm dry tip
        smoothstep(0.0, 8.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 1.6); // reeds sway the most
    material.colorNode = colorNode;
    material.side = THREE.DoubleSide; // readable from both sides (no thin-shard edge-on)

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 16) {
        guard += 1;
        const x = (Math.random() - 0.5) * 260;
        const z = (Math.random() - 0.5) * 260;
        const h = getTerrainHeight(x, z);
        // Shoreline band: just above the water clamp, where land meets water. Keep reeds OFF
        // the PLAYER CORRIDOR (carved at x≈-18, matching the foothill bridge) so they line the
        // side shores instead of clustering on the emergence beam (a thicket of slivers there).
        if (h >= 2.0 && h <= 7.0 && Math.abs(x + 18) > 34) {
            const s = 0.7 + Math.random() * 0.7;
            dummy.position.set(x, h + 3.2 * s, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s * (0.8 + Math.random() * 0.7), s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            n += 1;
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5c. HERO landmarks (Batch B5): Great Tree, mid-distance tree LINE, cliff waterfall
// ═══════════════════════════════════════════════════════════════════════════════
//
// The chapter had no single hero the eye returns to. These add the two beats the plan
// asks for — a great ancient tree on a knoll off the left of the path (the ever-present
// landmark) and a tiered cliff waterfall feeding the lake further down-corridor — plus a
// mid-distance tree LINE so the silhouette layers in depth. All anchored to the same
// getTerrainHeight() bake so they sit on the rendered ground.

// Resolve the world Y of the Great Tree's knoll (so surface-world.js can sample it too).
export function getSurfaceGreatTreeAnchor() {
    return {
        x: SURFACE_GREAT_TREE_POS.x,
        y: getTerrainHeight(SURFACE_GREAT_TREE_POS.x, SURFACE_GREAT_TREE_POS.z),
        z: SURFACE_GREAT_TREE_POS.z,
    };
}

// HERO: one large merged low-poly tree (~3–4× the scattered trees). Tapered cylinder
// trunk + 5 stacked, offset cone canopy lobes, anchored via getTerrainHeight off the left
// of the path. A warm rim term gilds the canopy edge (golden-hour backlight) with a green
// height grade. FrontSide solid, no bloom; a gentle whole-tree sway shares uTime.
export function createGreatTreeTSL(uTime = uniform(0)) {
    // Tapered trunk + 5 canopy lobes (offset for an organic, asymmetric crown).
    const trunk = new THREE.CylinderGeometry(1.4, 2.6, 26, 8, 1);
    const lobe = (r, hgt, seg) => new THREE.ConeGeometry(r, hgt, seg, 1);
    const branch = (r0, r1, len, rz, ry) => {
        const geo = new THREE.CylinderGeometry(r0, r1, len, 6, 1);
        geo.rotateZ(rz);
        geo.rotateY(ry);
        return geo;
    };
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 13, 0] },
        { geo: branch(0.38, 0.8, 18, Math.PI / 2.9, 0.5), offset: [5.6, 23, 1.0] },
        { geo: branch(0.32, 0.68, 15, -Math.PI / 3.2, -0.85), offset: [-5.0, 27, -1.2] },
        { geo: branch(0.26, 0.58, 13, Math.PI / 3.5, -0.35), offset: [3.2, 32, -2.8] },
        { geo: lobe(13, 18, 9), offset: [0, 30, 0] },
        { geo: lobe(11, 16, 9), offset: [4.5, 37, 2.0] },
        { geo: lobe(10.5, 15, 9), offset: [-4.0, 38, -1.5] },
        { geo: lobe(8.5, 14, 8), offset: [1.5, 44, -3.0] },
        { geo: lobe(6.5, 12, 8), offset: [-1.0, 50, 1.5] },
    ]);
    geometry.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;

    const isTrunk = oneMinus(smoothstep(24.0, 27.0, positionLocal.y));
    const foliage = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.greatTreeShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.greatTreeSunlit),
        smoothstep(28.0, 56.0, positionLocal.y),
    );
    const bark = vec3(0.30, 0.20, 0.12);
    const colorNode = mix(foliage, bark, isTrunk);
    // Warm golden-hour rim on the grazing canopy edge (capped, never white) — emissive accent
    // over the lit canopy so the hero crown gets a glowing sun-side edge.
    const rim = pow(oneMinus(max(dot(normalView, normalize(cameraPosition.sub(positionWorld))), 0.0)), 2.0);

    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.22); // slow, heavy whole-tree sway
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.84, 0.60, 0.26).mul(rim).mul(0.07).mul(oneMinus(isTrunk));
    material.flatShading = true; // crisp low-poly facets (Midsommar faceted read)
    material.side = THREE.FrontSide;

    const mesh = new THREE.Mesh(geometry, material);
    const anchor = getSurfaceGreatTreeAnchor();
    // anchor.y is sampled from getTerrainHeight; the env lifts by terrainOffsetY so the trunk
    // foot seats on the rendered ground. No -15 (that legacy offset sank the hero ~15u under).
    mesh.position.set(anchor.x, anchor.y, anchor.z);
    // Creative plan asset 1: the hero must TRIPLE its visual presence — crown upscaled
    // ~1.45× (base stays rooted; the scale origin is the trunk foot).
    mesh.scale.set(1.45, 1.4, 1.45);
    mesh.frustumCulled = false;
    mesh.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;
    return { mesh, material, geometry };
}

// Falling-leaf billboards: a near-tree halo PLUS a corridor-wide autumn story (creative
// plan item 4). Every leaf is a SHAPED, feathered, TUMBLING teardrop alpha — never the
// old crisp orange rectangle/disc — and the corridor-wide half is gated by uSeason so
// leaves are the autumn act's particle story.
export function createFallingLeavesTSL(uTime = uniform(0), count = 120, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const corridorPlacements = options.corridorPlacements ?? [];
    const anchor = getSurfaceGreatTreeAnchor();
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const corridorFlags = new Float32Array(count);
    const palette = [
        new THREE.Color(0xe8b04a), // warm gold
        new THREE.Color(0xcf7a3a), // amber
        new THREE.Color(0xb0502e), // rust
        new THREE.Color(0x7fae3a), // green-gold
    ];
    const nearTreeCount = Math.min(count, Math.floor(count / 2));
    for (let i = 0; i < count; i += 1) {
        const corridorIdx = i - nearTreeCount;
        if (i < nearTreeCount || corridorPlacements.length === 0) {
            // Near-tree halo (denser than before — the hero's leaf-fall signature).
            bases[i * 3] = anchor.x + (Math.random() - 0.5) * 34;
            bases[i * 3 + 1] = anchor.y + 20 + Math.random() * 32;
            bases[i * 3 + 2] = anchor.z + (Math.random() - 0.5) * 30;
            corridorFlags[i] = 0;
        } else {
            // Corridor-wide autumn leaves, strung along the rail (placements sampled
            // from the spline in surface-world.js).
            const seat = corridorPlacements[corridorIdx % corridorPlacements.length];
            bases[i * 3] = seat.x + (Math.random() - 0.5) * 10;
            bases[i * 3 + 1] = seat.y + 4 + Math.random() * 12;
            bases[i * 3 + 2] = seat.z + (Math.random() - 0.5) * 10;
            corridorFlags[i] = 1;
        }
        randoms[i] = Math.random();
        sizes[i] = 0.7 + Math.random() * 0.8;
        const col = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
        aCorridor: { array: corridorFlags, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');
    const aCorridor = attribute('aCorridor', 'float');

    // Slow falling drift wrapping over a ~40-unit band, with a gentle lateral flutter.
    const fall = fract(uTime.mul(0.03).mul(aRandom.add(0.5)).add(aRandom)).mul(40.0);
    const py = aBase.y.sub(fall);
    const px = aBase.x.add(sin(uTime.mul(0.7).add(aRandom.mul(11.0))).mul(3.5));
    const pz = aBase.z.add(cos(uTime.mul(0.5).add(aRandom.mul(7.0))).mul(2.5));
    const positionNode = billboardWorld(vec3(px, py, pz), aSize);

    // TUMBLING LEAF alpha (the squares-killer): rotate the quad uv over time, then mask
    // a teardrop — an ellipse whose width tapers toward the tip — feathered to zero well
    // inside the quad edge (sakura petal technique).
    const spin = uTime.mul(aRandom.mul(1.6).add(0.7)).add(aRandom.mul(21.0));
    const cs = cos(spin);
    const sn = sin(spin);
    const p0 = uv().sub(0.5);
    const p = vec2(p0.x.mul(cs).sub(p0.y.mul(sn)), p0.x.mul(sn).add(p0.y.mul(cs)));
    const widthTaper = max(float(0.3).mul(oneMinus(p.y.mul(1.1))), 0.06);
    const leafR = length(vec2(p.x.div(widthTaper), p.y.div(0.46)));
    const leaf = oneMinus(smoothstep(0.62, 1.0, leafR));

    // Season gate: the near-tree halo always sheds a little; the corridor-wide story
    // belongs to autumn only (one particle story at a time).
    const autumnGate = smoothstep(0.36, 0.52, uSeason).mul(oneMinus(smoothstep(0.8, 0.93, uSeason)));
    const gate = mix(max(autumnGate, float(0.55)), autumnGate, aCorridor);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor;
    material.opacityNode = leaf.mul(0.9).mul(gate);
    material.alphaTest = 0.15;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// Mid-distance tree LINE: a 2nd instanced pass of smaller trees clustered in the
// 120<d<220 band so the hill silhouette layers in depth (foreground props + this far
// line + the distant range = a 3-tier depth read). Reuses the trunk+canopy merge.
export function createTreeLineTSL(uTime = uniform(0), count = 64) {
    const trunk = new THREE.CylinderGeometry(0.4, 0.7, 5.5, 5, 1);
    const canopy = new THREE.ConeGeometry(3.2, 7.0, 6, 1);
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 2.75, 0] },
        { geo: canopy, offset: [0, 8.0, 0] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.18), 3));

    // Cooler/hazier than the near trees (atmospheric perspective on the silhouette) but no
    // longer washed — richer greens + per-instance tint so the far line still reads as forest.
    const colorNode = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.treeLineShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.treeLineSunlit),
        smoothstep(4.0, 11.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));

    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.3);
    material.colorNode = colorNode;
    material.flatShading = true; // crisp low-poly facets (Midsommar faceted read)
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 24) {
        guard += 1;
        // BotW framing SCREEN: two flank wings that leave an OPEN CENTRAL GAP to the peaks (the
        // river's vanishing point), instead of a full-width curtain across the whole horizon.
        const sign = Math.random() < 0.5 ? -1 : 1;
        const x = sign * (64 + Math.random() * 118);
        const z = -(120 + Math.random() * 100); // far band, into the frame
        const d = Math.sqrt(x * x + z * z);
        const h = getTerrainHeight(x, z);
        if (h >= 5.0 && d >= 120 && d <= 240) {
            const s = 0.8 + Math.random() * 0.7;
            dummy.position.set(x, h - 0.5, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            n += 1;
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// Second beat: a tiered cliff WATERFALL — 2–3 thin scrolling emissive plane ribbons
// (downward FBM streaks, side-feathered) feeding a glowing splash pool at the lake. The
// ribbons are additive-soft + capped (peak channel ≤ ~0.8) so they bloom gently, never
// blow white. Anchored at SURFACE_WATERFALL_POS over the river axis.
export function createWaterfallTSL(uTime = uniform(0), options = {}) {
    const group = new THREE.Group();
    group.name = 'surface-waterfall-tsl';
    const uOpacity = uniform(1);
    // As winter arrives (shared season/altitude snow blend) the fall FREEZES: the vertical
    // scroll slows to a near-still glassy sheet and the water shifts to pale ice-blue, so the
    // hero fall reads as freezing over rather than simply vanishing across the 3→4 seam.
    const uSnowBlend = options.uSnowBlend ?? uniform(0);

    // One shared ribbon material: bright cool-white water graded warmer at the lit top,
    // with a vertical scrolling FBM streak and a side feather to 0 before the plane edge.
    const vUv = uv();
    const scroll = uTime.mul(mix(float(0.5), float(0.05), uSnowBlend));
    const streak = snoise3(vec3(vUv.x.mul(5.0), vUv.y.mul(7.0).add(scroll), scroll.mul(0.4)))
        .mul(0.5).add(0.5);
    const streak2 = snoise3(vec3(vUv.x.mul(11.0), vUv.y.mul(15.0).add(scroll.mul(1.6)), 0.0))
        .mul(0.5).add(0.5);
    const flow = streak.mul(0.7).add(streak2.mul(0.3));
    const sideFeather = oneMinus(smoothstep(0.32, 0.5, abs(vUv.x.sub(0.5))));
    const topFade = smoothstep(0.0, 0.12, vUv.y);
    const bottomFade = oneMinus(smoothstep(0.86, 1.0, vUv.y));
    // Warm-lit crest -> cool water body. Crests brightened toward #E8E2D0 (creative plan
    // asset 2) so the falls bloom gently and read from 200 units down the corridor.
    const liquidColor = mix(vec3(0.62, 0.74, 0.80), vec3(0.91, 0.89, 0.82), smoothstep(0.55, 1.0, vUv.y));
    // Frozen: pale ice-blue with a brighter icy crest (the fall glazes over as winter sets in).
    const iceColor = mix(vec3(0.80, 0.87, 0.93), vec3(0.94, 0.97, 1.0), smoothstep(0.4, 1.0, vUv.y));
    const ribbonColor = mix(liquidColor, iceColor, uSnowBlend);
    const ribbonAlpha = flow.mul(sideFeather).mul(topFade).mul(bottomFade)
        .mul(0.58)
        .mul(uOpacity);

    const ribbonMat = new THREE.MeshBasicNodeMaterial();
    ribbonMat.colorNode = ribbonColor;
    ribbonMat.opacityNode = ribbonAlpha;
    ribbonMat.transparent = true;
    ribbonMat.depthWrite = false;
    ribbonMat.side = THREE.DoubleSide;
    ribbonMat.blending = THREE.AdditiveBlending;
    ribbonMat.userData.emitsBloom = true;

    const ribbonGeo = new THREE.PlaneGeometry(14, 60);
    // Three tiers stepping down toward the lake (each lower + slightly forward).
    const tiers = [
        { x: 0, y: 56, z: 0 },
        { x: 3, y: 26, z: 6 },
        { x: -2, y: 0, z: 12 },
    ];
    // ZERO-VISUAL draw share: the three ribbon tiers already share ribbonMat + ribbonGeo and
    // differ ONLY by position. The ribbon shader is uv()+uTime-driven (no positionWorld) and the
    // only per-frame write touches the shared uOpacity node (waterfallOpacityUniformTargets) +
    // group.visible — never a single tier — so the three identical Mesh draws collapse into ONE
    // InstancedMesh draw whose instanceMatrix carries each tier's offset. Pixels unchanged.
    const ribbonMesh = new THREE.InstancedMesh(ribbonGeo, ribbonMat, tiers.length);
    ribbonMesh.frustumCulled = false;
    const ribbonDummy = new THREE.Object3D();
    tiers.forEach((tier, i) => {
        ribbonDummy.position.set(tier.x, tier.y, tier.z);
        ribbonDummy.updateMatrix();
        ribbonMesh.setMatrixAt(i, ribbonDummy.matrix);
    });
    ribbonMesh.instanceMatrix.needsUpdate = true;
    group.add(ribbonMesh);

    // Glowing splash pool at the base — a soft radial additive disc on the lake surface.
    const poolUv = uv().sub(0.5).length().mul(2.0);
    const poolGlow = oneMinus(smoothstep(0.2, 1.0, poolUv));
    const poolMat = new THREE.MeshBasicNodeMaterial();
    poolMat.colorNode = mix(vec3(0.70, 0.78, 0.74), vec3(0.82, 0.90, 0.96), uSnowBlend);
    poolMat.opacityNode = poolGlow.mul(0.4).mul(uOpacity);
    poolMat.transparent = true;
    poolMat.depthWrite = false;
    poolMat.side = THREE.DoubleSide;
    poolMat.blending = THREE.AdditiveBlending;
    poolMat.userData.emitsBloom = true;
    const poolGeo = new THREE.PlaneGeometry(40, 40);
    poolGeo.rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(-2, -12, 16);
    group.add(pool);

    const anchor = getTerrainHeight(SURFACE_WATERFALL_POS.x, SURFACE_WATERFALL_POS.z);
    group.position.set(SURFACE_WATERFALL_POS.x, anchor - 15, SURFACE_WATERFALL_POS.z);
    return {
        group, material: ribbonMat, geometry: ribbonGeo, uniforms: { uOpacity, uSnowBlend },
    };
}

// Warm-amber pollen motes — instanced billboard quads with a radial alpha feather to 0
// before the quad edge (additive, capped). These are the "warm-amber pollen" the brief
// asks to keep, drifting in the golden-hour light.
export function createPollenTSL(uTime = uniform(0), count = 260, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 140;
        bases[i * 3 + 1] = Math.random() * 50;
        bases[i * 3 + 2] = (Math.random() - 0.5) * 90;
        randoms[i] = Math.random();
        sizes[i] = 0.5 + Math.random() * 0.9;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
    });

    const uOpacity = uniform(1);
    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');

    // Slow buoyant drift: gentle bob + lateral sway, wrapped over a tall band.
    const driftY = fract(uTime.mul(0.02).mul(aRandom.add(0.4)).add(aRandom)).mul(56.0);
    const py = aBase.y.add(driftY).sub(8.0);
    const px = aBase.x.add(sin(uTime.mul(0.4).add(aRandom.mul(9.0))).mul(3.0));
    const pz = aBase.z.add(cos(uTime.mul(0.3).add(aRandom.mul(6.0))).mul(2.2));
    const center = vec3(px, py, pz);

    const positionNode = billboardWorld(center, aSize);

    // Radial feather to 0 BEFORE the quad edge (soft round mote, no hard square).
    const r = uv().sub(0.5).length().mul(2.0);
    const feather = oneMinus(smoothstep(0.25, 1.0, r));

    // Summer's particle story (one story at a time): pollen fades in after the petals
    // and hands off to the autumn leaves.
    const summerGate = smoothstep(0.16, 0.3, uSeason).mul(oneMinus(smoothstep(0.5, 0.66, uSeason)));

    // TWO species share the field (Midsommar-inspired): warm cream POLLEN dust that shimmers
    // slowly, and brighter yellow-green FIREFLIES that BLINK independently and GLOW (bloom via
    // emissiveNode + emitsBloom). isFly is split by the per-instance random; the twinkle rate +
    // sharpness differ so flies blink fast/hard while pollen shimmers slow/soft.
    const isFly = smoothstep(0.62, 0.66, aRandom); // ~34% fireflies
    const twk = pow(
        sin(uTime.mul(mix(float(1.1), float(3.0), isFly)).add(aRandom.mul(6.283))).mul(0.5).add(0.5),
        mix(float(1.0), float(2.6), isFly),
    );
    const twinkle = mix(float(0.7).add(twk.mul(0.45)), float(0.1).add(twk.mul(1.0)), isFly);
    const moteCol = mix(vec3(1.0, 0.80, 0.42), vec3(0.85, 1.0, 0.52), isFly.mul(0.8)); // amber → yellow-green
    const bright = mix(float(1.0), float(1.9), isFly);
    const gate = summerGate.mul(0.7).add(0.3);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = moteCol.mul(bright).mul(twinkle);
    material.opacityNode = feather.mul(twinkle).mul(gate).mul(0.5).mul(uOpacity);
    // Fireflies feed the MRT threshold bloom (like the sun disc); pollen barely glows.
    material.emissiveNode = moteCol.mul(feather).mul(twinkle).mul(isFly.mul(1.2).add(0.2)).mul(gate);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// Slow winter snow motes (creative plan asset 9): the snow line's particle story — soft
// white flecks gated to the chapter's final act so the world hushes as the key cools.
export function createSnowMotesTSL(uTime = uniform(0), count = 220, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const uOpacity = uniform(1);
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 160;
        bases[i * 3 + 1] = 10 + Math.random() * 50;
        bases[i * 3 + 2] = (Math.random() - 0.5) * 140 - 60;
        randoms[i] = Math.random();
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');

    const fall = fract(uTime.mul(0.025).mul(aRandom.add(0.5)).add(aRandom)).mul(52.0);
    const py = aBase.y.sub(fall).add(26.0);
    const px = aBase.x.add(sin(uTime.mul(0.5).add(aRandom.mul(13.0))).mul(2.6));
    const pz = aBase.z.add(cos(uTime.mul(0.4).add(aRandom.mul(8.0))).mul(2.0));
    const positionNode = billboardWorld(vec3(px, py, pz), aRandom.mul(0.4).add(0.35));

    const r = uv().sub(0.5).length().mul(2.0);
    const feather = oneMinus(smoothstep(0.2, 1.0, r));
    const winterGate = smoothstep(0.7, 0.88, uSeason);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec3(0.95, 0.97, 1.0); // #F2F7FF snow
    material.opacityNode = feather.mul(0.6).mul(winterGate).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// Chapter-3 butterflies material (creative plan asset "Fluttering Butterflies"): the ONE
// particle the .tsl.js polish sweep missed — it lived as a raw OPAQUE MeshBasicMaterial in
// the .js builder (pure orange #FFAA00, no alpha, tone-mapped), so 20 hard garish squares
// tumbled near the path. Rebuilt here alongside its siblings with the same squares-killer
// discipline: a soft honey-amber node material (golden-hour amber family, #E6B45A — a touch
// deeper than the #FFCC6B pollen so they read as their own creature) with a radial wing-oval
// feather to 0 BEFORE the quad rim, alpha-blended and not tone-clipped. One shared material
// across the 20 JS-animated butterfly meshes — they keep their per-frame flap/heading in
// updateSurfaceWorldEnvironment; only the look moves to the GPU here.
export function createButterflyMaterialTSL() {
    // Horizontal wing-oval feather: alpha falls to 0 before the plane edge, slightly wider
    // than tall so the fluttering quad reads as beating wings rather than a round mote.
    const c = uv().sub(0.5);
    const r = c.mul(vec2(1.0, 1.5)).length().mul(2.0);
    const feather = oneMinus(smoothstep(0.32, 1.0, r));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec3(0.902, 0.706, 0.353); // #E6B45A soft honey-amber (golden-hour family)
    material.opacityNode = feather.mul(0.9);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;
    return material;
}

// Drifting bird silhouettes — adapted from golden-forest-birds' swept-wing shape. Each
// bird is a small body triangle (tail -> beak -> shoulder) plus two SWEPT wings (root ->
// tip -> trailing edge) so the silhouette reads as a real bird, not a flat V. The wing tips
// carry Y extent, so the update loop's scale.y flap actually beats the wings up/down. Dark
// warm-grey silhouette with a faint distance haze lift (matches the golden-forest birds).
// Animated in updateSurfaceWorldEnvironment via group.userData.birds (API unchanged).
export function createBirdsTSL(count = 7) {
    const group = new THREE.Group();
    group.name = 'surface-birds-tsl';

    // Swept-wing bird geometry, scaled up for Chapter 3's world units. Body forward is +Z;
    // the update faces it to heading. Built as triangle panels so the silhouette has mass:
    // body, head/beak, tail fan, inner/outer wing panels and primary tips.
    const wingGeo = new THREE.BufferGeometry();
    const s = 2.25;
    const verts = [];
    const tri = (...coords) => {
        coords.forEach((coord) => verts.push(coord * s));
    };

    tri(0.00, -0.07, -1.34, 0.00, 0.08, 1.42, -0.26, 0.08, 0.04);
    tri(0.00, -0.07, -1.34, 0.26, 0.08, 0.04, 0.00, 0.08, 1.42);
    tri(-0.17, 0.09, 1.16, 0.00, 0.21, 1.74, 0.17, 0.09, 1.16);
    tri(-0.34, -0.04, -1.30, 0.00, -0.20, -2.02, 0.00, -0.04, -1.22);
    tri(0.34, -0.04, -1.30, 0.00, -0.04, -1.22, 0.00, -0.20, -2.02);

    tri(-0.12, 0.07, 0.20, -0.88, 0.22, 0.08, -0.34, -0.03, -0.30);
    tri(-0.88, 0.22, 0.08, -2.08, 0.50, -0.22, -0.66, -0.09, -0.56);
    tri(-0.66, -0.09, -0.56, -2.08, 0.50, -0.22, -1.76, 0.08, -0.86);
    tri(-2.08, 0.50, -0.22, -2.74, 0.28, -0.56, -1.76, 0.08, -0.86);
    tri(-1.76, 0.08, -0.86, -2.74, 0.28, -0.56, -2.10, -0.08, -1.10);

    tri(0.12, 0.07, 0.20, 0.34, -0.03, -0.30, 0.88, 0.22, 0.08);
    tri(0.88, 0.22, 0.08, 0.66, -0.09, -0.56, 2.08, 0.50, -0.22);
    tri(0.66, -0.09, -0.56, 1.76, 0.08, -0.86, 2.08, 0.50, -0.22);
    tri(2.08, 0.50, -0.22, 1.76, 0.08, -0.86, 2.74, 0.28, -0.56);
    tri(1.76, 0.08, -0.86, 2.10, -0.08, -1.10, 2.74, 0.28, -0.56);

    wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    wingGeo.computeVertexNormals();
    wingGeo.userData.silhouette = CH3_BIRD_SILHOUETTE_SETTINGS;

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec3(0.055, 0.065, 0.075); // dark, readable sky silhouette
    material.side = THREE.DoubleSide;

    for (let i = 0; i < count; i += 1) {
        const bird = new THREE.Mesh(wingGeo, material);
        bird.userData = {
            speed: 0.2 + Math.random() * 0.35,
            radius: 38 + Math.random() * 60,
            height: 28 + Math.random() * 34,
            offset: Math.random() * Math.PI * 2,
            flap: 4 + Math.random() * 3,
        };
        group.add(bird);
    }
    group.userData.silhouette = CH3_BIRD_SILHOUETTE_SETTINGS;
    group.userData.cc0Candidate = CH3_BIRD_SILHOUETTE_SETTINGS.cc0Candidate;
    return { group, material, geometry: wingGeo };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5e. SUN disc + soft halo (golden-hour; additive, capped, bloom-eligible)
// ═══════════════════════════════════════════════════════════════════════════════
//
// VISUAL POLISH (user note "maybe a SUN"): a visible warm golden sun — a soft bright core,
// a turbulent corona ring and a wide soft halo — adapted from sky-children-v2's
// createSunNodeMaterial (core/corona/halo radial smoothsteps + faint noise turbulence),
// re-implemented as a single camera-facing billboard quad. Placed far down-corridor toward
// the sky's sun direction (vec3(0.40, 0.16, -0.90)) so the disc sits where the sky's warm
// band + sun glow are. Additive but every term is CAPPED below 1.0 so ACES/bloom roll it
// off into a glow rather than a clipped white hole (peak channel ≈ 0.85). One quad, no
// per-frame allocation; uOpacity tagged so the surface fade collector drives it.
export function createSunDiscTSL(uTime = uniform(0), options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const uOpacity = uniform(1);
    const winterT = seasonWinterT(uSeason);
    // Winter cools the disc toward #DCE8FF (the season arrives as light, not props).
    const uCore = mix(uniform(new THREE.Color(0xffeec0)), vec3(0.863, 0.91, 1.0), winterT.mul(0.85));
    const uCorona = mix(uniform(new THREE.Color(0xffc66a)), vec3(0.72, 0.8, 0.93), winterT.mul(0.85));
    const uHalo = mix(uniform(new THREE.Color(0xff9e44)), vec3(0.6, 0.7, 0.88), winterT.mul(0.85));

    const centered = uv().sub(0.5);
    const dist = length(centered);

    // Faint turbulence so the disc edge shimmers organically (no hard plastic circle).
    const turb = snoise3(vec3(centered.x.mul(7.0), centered.y.mul(7.0), uTime.mul(0.05)))
        .mul(0.06).sub(0.03);

    // Radial core / corona / halo (sky-children sun discipline). Soft edges via smoothstep.
    const core = oneMinus(smoothstep(0.0, float(0.16).add(turb), dist));
    const corona = oneMinus(smoothstep(0.10, float(0.34).add(turb), dist));
    const halo = oneMinus(smoothstep(0.20, 0.5, dist));

    // Build the colour: warm core blends to golden corona by radius, plus a wide amber halo.
    const surface = mix(uCore, uCorona, smoothstep(0.0, 0.34, dist));
    let color = surface.mul(core.mul(0.85).add(corona.mul(0.4)));
    color = color.add(uHalo.mul(pow(halo, 2.0)).mul(0.28));
    // Gentle breathing pulse (very subtle).
    const pulse = sin(uTime.mul(0.5)).mul(0.04).add(1.0);
    color = color.mul(pulse);

    // Alpha: bright at the core, fading through the halo to 0 well before the quad edge.
    const alpha = oneMinus(smoothstep(0.06, 0.5, dist)).mul(0.96).mul(uOpacity);

    // A single camera-facing billboard quad far down-corridor along the sky's sun direction,
    // so the disc always reads as a round distant sun regardless of camera yaw. Far + large
    // so perspective renders it as a distant sun low toward the horizon.
    const sunDir = SURFACE_SUN_DIR;
    const center = vec3(sunDir.x * 900, sunDir.y * 900, sunDir.z * 900);
    const positionNode = billboardWorld(center, float(186.0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false; // sit in the sky behind everything, never z-fight terrain
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -90; // just in front of the sky sphere (-100), behind terrain
    mesh.frustumCulled = false;

    const group = new THREE.Group();
    group.name = 'surface-sun-tsl';
    group.add(mesh);
    return {
        group, mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Sun Rays (additive golden volumetric beams; bloom-eligible)
// ═══════════════════════════════════════════════════════════════════════════════

export function createSunRaysTSL(uTime = uniform(0), options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const uOpacity = uniform(1);
    const vUv = uv();

    const edgeFade = oneMinus(pow(abs(vUv.x.sub(0.5)).mul(2.5), 2.0));
    const bottomFade = smoothstep(0.0, 0.3, vUv.y);
    const topFade = oneMinus(smoothstep(0.8, 1.0, vUv.y));
    const shimmer = sin(vUv.y.mul(10.0).sub(uTime.mul(0.5))).mul(0.1).add(0.9);
    const beam = smoothstep(0.3, 0.7, sin(vUv.x.mul(20.0).add(uTime.mul(0.2))).mul(0.5).add(0.5));

    const alpha = edgeFade.mul(bottomFade).mul(topFade).mul(shimmer)
        .mul(beam.mul(0.1).add(0.1))
        // Dimmed: additive white rays were part of the blown upper frame. Pulled back so
        // the god-rays accent the warm sky rather than veiling it white. Winter thins
        // the shafts further (plan item 6: the snow line is hushed, not golden).
        .mul(0.26)
        .mul(oneMinus(seasonWinterT(uSeason).mul(0.45)))
        .mul(uOpacity);

    // Warm golden god-ray tint (matches the golden-hour sun, no neutral-white additive).
    const color = vec3(1.0, 0.86, 0.56);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(30, 120);

    const group = new THREE.Group();
    group.name = 'sun-rays-tsl';
    // Batch B5: 5 → 7 beams, clustered toward the lower-left where the raking sun sits, so
    // the god-rays fan FROM the light source (densest in the hero-tree beat shafts).
    // ZERO-VISUAL draw share: every beam was already the SAME material + geometry differing
    // ONLY by transform (position + rotation.z), and the shader animates GPU-side via uv()+uTime
    // (no per-mesh mutation in update() — only the shared uOpacity node and group.visible). Seven
    // identical Mesh draws collapse into ONE InstancedMesh draw (instanceMatrix carries each
    // beam's transform); the random spread is generated identically, so the pixels are unchanged.
    const beamCount = 7;
    const mesh = new THREE.InstancedMesh(geometry, material, beamCount);
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < beamCount; i += 1) {
        // Bias the fan to the RIGHT (sun-side) now that ODYSSEY_SUN is upper-right (Wave D).
        dummy.position.set(
            40 + (Math.random() - 0.5) * 70,
            40,
            -30 - Math.random() * 50,
        );
        dummy.rotation.set(0, 0, -0.18 + (Math.random() - 0.5) * 0.4); // lean toward the (upper-right) sun
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return {
        group, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Clouds (soft procedural noise puffs; NormalBlending transparent, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

export function createCloudsTSL(uTime = uniform(0)) {
    const uOpacity = uniform(1);
    const vUv = uv();

    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave A): big soft white DAYLIGHT CUMULUS — near-white
    // sunlit tops over soft blue-grey undersides, structure from layered FBM. The hero sky element
    // of the reference images; the turquoise lake below reflects these (see the water repalette).
    const t = uTime.mul(0.045);

    // Stretched coords give horizontal STRATA (wide, layered banks) not round blobs.
    const sx = vUv.x.mul(2.4);
    const sy = vUv.y.mul(4.6);
    const n1 = snoise3(vec3(sx.add(t), sy, t));
    const n2 = snoise3(vec3(sx.mul(2.1).sub(t), sy.mul(2.1), t.mul(1.4))).mul(0.5);
    const n3 = snoise3(vec3(sx.mul(4.3).add(t.mul(0.6)), sy.mul(4.3), t.mul(0.8))).mul(0.25);
    const body = n1.add(n2).add(n3);

    // Rounder, puffier BILLOWING mask (was a flat wide ellipse → thin strata) so the banks read as
    // big soft CUMULUS, not haze veils.
    // ORGANIC CLOUD EDGES (in-game: "the clouds ... feels like they are cut in a straight line on
    // the left side, they need to be more organic and not have straight lines either").
    // The falloff ran to 0.95 but the ellipse only REACHED 0.7 at the quad's left/right edge, so the
    // cloud was still ~40% opaque where the geometry stopped — the plane boundary itself became the
    // silhouette: a dead-straight vertical cut. Scaling by 2.0 makes dist == 1.0 exactly at the edge
    // midpoints, and the band now completes at 0.82 so even the worst-case noise warp lands on 0
    // before the rim. The noise then breaks the remaining ellipse into a billowing, irregular edge.
    const ex = vUv.x.sub(0.5).mul(2.0);
    const ey = vUv.y.sub(0.5).mul(2.0);
    const dist = length(vec2(ex, ey));
    const maskWarp = snoise3(vec3(sx.mul(0.85), sy.mul(0.85), t.mul(0.5))).mul(0.18);
    const mask = oneMinus(smoothstep(0.40, 0.82, dist.add(maskWarp)));

    // Tighter density band → defined puffy cores with soft edges (was a thin low-contrast smear).
    const density = smoothstep(0.30, 0.80, body.add(0.5)).mul(mask);

    // Bright DAYLIGHT cumulus: near-white sunlit top, soft blue-grey shaded underside (was warm gold).
    const litTop = uv().y; // 0 at base, 1 at top of the plane
    const sunlit = vec3(0.98, 0.99, 1.0); // Bright white cloud top
    const shaded = vec3(0.72, 0.80, 0.90); // Soft blue-grey shaded underside
    const color = mix(shaded, sunlit, smoothstep(0.25, 0.95, litTop.add(body.mul(0.12))));

    // Opaque enough to read as solid cumulus (was 0.10 thin strata); NormalBlending keeps them white.
    const alpha = density.mul(0.62).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;

    // Taller planes so the billowing mask reads as cumulus puffs, not flat horizontal strata.
    const geometry = new THREE.PlaneGeometry(84, 46);

    const group = new THREE.Group();
    group.name = 'clouds-tsl';
    // Batch B5: fill the empty act-in sky. 7 → 12 banks spanning z -60..-220, with the
    // LOWEST bank dropped to y≈14 so the strata sit nearer the horizon line (not floating
    // high), plus 3 large soft horizon cumulus pushed far back for a layered sky read.
    // ZERO-VISUAL draw share: every bank already shares this material + geometry, differing
    // ONLY by transform (position + non-uniform scale). The shader is purely uv()/uTime-driven
    // (no positionWorld, no per-mesh mutation in update() — only the shared uOpacity node and
    // group.visible), so the 15 identical Mesh draws collapse into ONE InstancedMesh draw whose
    // instanceMatrix carries each bank's transform. The Math.random() draws run in the same order,
    // so every bank lands at the identical transform it had before — pixels unchanged.
    const cloudCount = 12;
    const horizonCount = 3;
    const mesh = new THREE.InstancedMesh(geometry, material, cloudCount + horizonCount);
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cloudCount; i += 1) {
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(
            (Math.random() - 0.5) * 200,
            // Lift the banks well above the mountain mid-section so they read as high sky strata,
            // not a grey haze veiling the peaks (the old y≈30 banks smeared across the range).
            58 + (i * 5.0) + Math.random() * 6,
            -60 - Math.random() * 160, // widened z spread (-60..-220)
        );
        dummy.scale.set(1.0 + Math.random() * 0.7, 0.8 + Math.random() * 0.5, 1.0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    // 3 large soft horizon cumulus far back + low, wide — the warm golden-hour backdrop.
    for (let i = 0; i < horizonCount; i += 1) {
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(
            (i - 1) * 130 + (Math.random() - 0.5) * 50,
            42 + Math.random() * 10,
            -240 - Math.random() * 90,
        );
        dummy.scale.set(2.6 + Math.random() * 1.1, 1.4 + Math.random() * 0.6, 1.0);
        dummy.updateMatrix();
        mesh.setMatrixAt(cloudCount + i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return {
        group, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Distant Mountains (CPU-baked cone/FBM silhouette + GPU snow/rock/fog shading)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU heightfield bake — ONE displacement language (shared/mountain-language.js), so a
// peak on Surface's horizon is the SAME mountain shape the Mountains chapter shows close.
function buildDistantMountainGeometry(config) {
    const segments = 128;
    const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const posAttribute = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const heights = [];
    const seed = config.seed || 0;

    for (let i = 0; i < posAttribute.count; i += 1) {
        vertex.fromBufferAttribute(posAttribute, i);
        const h = mountainCpuDisplacement(vertex.x, vertex.z, {
            size: config.size,
            height: config.height,
            seed,
        });
        posAttribute.setY(i, h);
        heights.push(h);
    }

    geometry.computeVertexNormals();

    const heightAttr = new Float32Array(posAttribute.count);
    for (let i = 0; i < posAttribute.count; i += 1) {
        heightAttr[i] = heights[i] / config.height;
    }
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));

    return geometry;
}

export function createDistantMountainTSL(config = {}) {
    const {
        size = 800,
        height = 300,
        seed = 0,
        position = new THREE.Vector3(0, 0, 0),
    } = config;

    // Surface's distant range rides the NEUTRAL end of the temperature ramp (grey-blue,
    // farther + hazier + cooler than the Mountains chapter heroes) but uses the SAME
    // canonical palette + snow-line + alpenglow + fog treatment, so it reads as the same
    // mountains seen from a distance. A low coolTemp + a low snow line (distant peaks are
    // mostly capped) does the work; per-instance variation = distance/fog + coolTemp only.
    const treatment = resolveMountainTreatment({ coolTemp: 0.28, snowLine: 0.38 });

    const uSnow = uniform(new THREE.Color(treatment.snow));
    const uRock = uniform(new THREE.Color(treatment.rock));
    const uShadow = uniform(new THREE.Color(treatment.shadow));
    const uFog = uniform(new THREE.Color(treatment.fog));
    const uAlpen = uniform(new THREE.Color(treatment.alpenglow));
    const uRim = uniform(new THREE.Color(treatment.rim));
    const uSnowLine = uniform(treatment.snowLine);
    const uSnowBlend = uniform(0);
    const uOpacity = uniform(1);

    // World-space normal (same port bug as the live peaks; this builder is currently
    // unused by the live path but kept consistent so it cannot re-introduce it).
    const vNormal = normalWorld;
    const vWorldPosition = positionWorld;
    const vHeight = attribute('aHeight', 'float');

    // ONE shading treatment — distance fog onset pulled nearer so the far range hazes off
    // into the sky (atmospheric perspective is the dominant per-instance cue here).
    const color = mountainColorNode({
        uSnow,
        uRock,
        uShadow,
        uFog,
        uAlpen,
        uRim,
        uSnowLine,
        uSnowBlend,
        vNormal,
        vWorldPosition,
        vHeight,
        fogNear: 380.0,
        fogFar: 1400.0,
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.transparent = true;
    material.depthWrite = false;

    const geometry = buildDistantMountainGeometry({ size, height, seed });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.renderOrder = -2;
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend, uOpacity },
    };
}

export function createDistantMountainsTSL(uTime = uniform(0)) {
    const group = new THREE.Group();
    group.name = 'distant-mountains-tsl';
    const parts = [];

    const left = createDistantMountainTSL({
        size: 780,
        height: 300,
        position: new THREE.Vector3(-280, -8, -460),
        seed: 12.34,
    });
    const center = createDistantMountainTSL({
        size: 1100,
        height: 480,
        position: new THREE.Vector3(0, -28, -650),
        seed: 89.12,
    });
    const right = createDistantMountainTSL({
        size: 780,
        height: 290,
        position: new THREE.Vector3(280, -12, -500),
        seed: 45.67,
    });
    group.add(left.mesh, center.mesh, right.mesh);
    parts.push(left, center, right);

    const mist = createMountainMistTSL(uTime);
    group.add(mist.group);
    parts.push(mist);

    return {
        group, parts, mist, uniforms: { uTime },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Mountain Mist (foothill valley mist; NormalBlending transparent, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// Value noise (squared) in ~[0,1] — TSL twin of the mist fragment's inline rand/noise.
function mistNoise(p) {
    const n = snoise3(vec3(p.x, p.y, 0.0)).mul(0.5).add(0.5);
    return n.mul(n);
}

export function createMountainMistTSL(uTime = uniform(0)) {
    const uColor = uniform(new THREE.Color(0xc4d6e6)); // Cool blue-grey haze (was near-white)
    const uOpacity = uniform(1);

    const vUv = uv();
    const vWorldPosition = positionWorld;

    const center = vUv.sub(0.5);
    const dist = length(center);
    let alpha = oneMinus(smoothstep(0.08, 0.62, dist));
    alpha = alpha.mul(smoothstep(0.02, 0.28, vUv.y));
    alpha = alpha.mul(oneMinus(smoothstep(0.74, 1.0, vUv.y)));
    const n = mistNoise(vWorldPosition.xz.mul(0.02).add(vec2(0.0, uTime.mul(0.04))));
    alpha = alpha.mul(n.mul(0.35).add(0.65));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uColor;
    material.opacityNode = alpha.mul(0.18).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.depthTest = true;
    material.blending = THREE.NormalBlending;

    const geometry = new THREE.PlaneGeometry(520, 240);

    const group = new THREE.Group();
    group.name = 'foothill-valley-mist-tsl';

    const positions = [
        {
            x: -190, y: 34, z: -380, scale: 1.12, rotY: 0.14,
        },
        {
            x: 35, y: 40, z: -520, scale: 1.26, rotY: -0.1,
        },
        {
            x: 225, y: 46, z: -680, scale: 1.18, rotY: 0.08,
        },
        {
            x: -50, y: 52, z: -810, scale: 1.38, rotY: -0.06,
        },
    ];

    // ZERO-VISUAL draw share: the four mist banks already share this material + geometry,
    // differing ONLY by transform (position/rotation/uniform scale) and a uniform renderOrder
    // (-1). The shader is uv()+positionWorld.xz+uTime-driven — InstancedMesh feeds each bank's
    // own world XZ through positionWorld, so the noise samples identically — and update() never
    // mutates these meshes (only the shared uOpacity node + group.visible). Four identical Mesh
    // draws collapse into ONE InstancedMesh draw whose instanceMatrix carries each transform.
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    const dummy = new THREE.Object3D();
    positions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.rotation.set(-0.08, pos.rotY, 0);
        dummy.scale.setScalar(pos.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);

    return {
        group, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Falu-red cabin + foreground pass-by layer (creative plan assets 3 + 7)
// ═══════════════════════════════════════════════════════════════════════════════

// The cabin is the chapter's human-scale cue: falu red #8B2F26 walls, white #F3EFE4
// gable trim, a dark pyramid roof and one smoke wisp — promoted from hazed speck to
// landmark at the treeline right of the path, mid-corridor.
const SURFACE_CABIN_POS = { x: 56, z: -310 };

function findCabinAnchor() {
    // Search outward from the desired seat until the terrain offers solid land (h>=6),
    // so layout edits never strand the cabin in the river.
    for (let ring = 0; ring < 8; ring += 1) {
        const x = SURFACE_CABIN_POS.x + ring * 9;
        const z = SURFACE_CABIN_POS.z + ring * 6;
        const h = getTerrainHeight(x, z);
        if (h >= 6.0) return { x, y: h, z };
    }
    return {
        x: SURFACE_CABIN_POS.x,
        y: Math.max(getTerrainHeight(SURFACE_CABIN_POS.x, SURFACE_CABIN_POS.z), 6),
        z: SURFACE_CABIN_POS.z,
    };
}

export function createCabinTSL(uTime = uniform(0)) {
    const uOpacity = uniform(1);
    const group = new THREE.Group();
    group.name = 'falu-cabin';

    // Merged body: walls + pyramid roof + chimney (one draw call).
    const walls = new THREE.BoxGeometry(7, 4.5, 5.5);
    const roof = new THREE.ConeGeometry(5.6, 3.4, 4, 1);
    roof.rotateY(Math.PI / 4);
    const chimney = new THREE.BoxGeometry(0.9, 2.4, 0.9);
    const geometry = mergeOffsetGeometries([
        { geo: walls, offset: [0, 2.25, 0] },
        { geo: roof, offset: [0, 6.1, 0] },
        { geo: chimney, offset: [1.8, 6.6, 0.8] },
    ]);

    // Color by height bands: falu walls, white gable trim, dark shingle roof/chimney.
    const py = positionLocal.y;
    const falu = vec3(0.545, 0.184, 0.149); // #8B2F26
    const trim = vec3(0.953, 0.937, 0.894); // #F3EFE4
    const roofDark = vec3(0.2, 0.14, 0.11);
    const trimBand = smoothstep(3.85, 4.05, py).mul(oneMinus(smoothstep(4.35, 4.55, py)));
    let color = mix(falu, roofDark, smoothstep(4.45, 4.8, py));
    color = mix(color, trim, trimBand);
    // The same raking key the landscape uses, so the cabin sits in the scene's light.
    const lightDir = normalize(vec3(SURFACE_SUN_DIR.x, SURFACE_SUN_DIR.y, SURFACE_SUN_DIR.z));
    const diff = max(dot(normalView, lightDir), 0.0);
    color = color.mul(diff.mul(0.5).add(vec3(0.62, 0.68, 0.74).mul(0.5)));

    const bodyMaterial = new THREE.MeshBasicNodeMaterial();
    bodyMaterial.colorNode = color;
    bodyMaterial.opacityNode = uOpacity;
    bodyMaterial.transparent = true;
    bodyMaterial.side = THREE.FrontSide;
    const body = new THREE.Mesh(geometry, bodyMaterial);
    group.add(body);

    // One smoke wisp: a vertical billboard streamer rising off the chimney.
    const wispUv = uv();
    const wispNoise = snoise3(vec3(wispUv.x.mul(3.0), wispUv.y.mul(5.0).sub(uTime.mul(0.35)), uTime.mul(0.08)))
        .mul(0.5).add(0.5);
    const wispStrand = oneMinus(smoothstep(0.0, 0.3, abs(wispUv.x.sub(0.5).add(
        sin(wispUv.y.mul(5.0).add(uTime.mul(0.6))).mul(0.12).mul(wispUv.y),
    ))));
    const wispAlpha = wispStrand.mul(wispNoise)
        .mul(smoothstep(0.0, 0.15, wispUv.y))
        .mul(oneMinus(smoothstep(0.6, 1.0, wispUv.y)))
        .mul(0.4)
        .mul(uOpacity);
    const wispMaterial = new THREE.MeshBasicNodeMaterial();
    wispMaterial.colorNode = vec3(0.82, 0.82, 0.84);
    wispMaterial.opacityNode = wispAlpha;
    wispMaterial.transparent = true;
    wispMaterial.depthWrite = false;
    wispMaterial.side = THREE.DoubleSide;
    const wisp = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 9), wispMaterial);
    wisp.position.set(1.8, 11.5, 0.8);
    group.add(wisp);

    const anchor = findCabinAnchor();
    group.position.set(anchor.x, anchor.y - 15, anchor.z);
    group.traverse((child) => { child.frustumCulled = false; });
    return {
        group, material: bodyMaterial, geometry, uniforms: { uOpacity },
    };
}

// Foreground PASS-BY layer (creative plan asset 7 — "currently absent, build it"):
// dark near-silhouette grass heads, reed plumes, and branch sweeps flanking the spline
// 2–8 units off the rail for the whole chapter, sitting at the darkest value in frame
// (#0E1F12) — the dark anchor the pastels need, and the speed cue for the rail ride.
// Placements (chapter-local, sampled from the spline) come from surface-world.js.
export function createForegroundPassByTSL(uTime = uniform(0), placements = [], options = {}) {
    const count = Math.max(placements.length, 1);
    const uOpacity = options.uOpacity ?? uniform(1);
    const bases = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const shapes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        const seat = placements[i] ?? { x: 0, y: 0, z: -10 };
        bases[i * 3] = seat.x;
        bases[i * 3 + 1] = seat.y;
        bases[i * 3 + 2] = seat.z;
        seeds[i] = Math.random();
        sizes[i] = 2.6 + Math.random() * 3.2;
        shapes[i] = i % 3; // 0 grass head, 1 reed plume, 2 branch sweep
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
        aShape: { array: shapes, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSeed = attribute('aSeed', 'float');
    const aSize = attribute('aSize', 'float');
    const aShape = attribute('aShape', 'float');

    const positionNode = billboardWorld(aBase, aSize);

    // Mask-space breeze: shear the sampled u by height² so the silhouettes sway rooted.
    const coord = uv();
    const vv = coord.y;
    const sway = sin(uTime.mul(1.1).add(aSeed.mul(9.0))).mul(0.06).mul(vv.mul(vv));
    const u = coord.x.add(sway);

    // Shape 0 — grass head: three thin blades fanning up from the base.
    const blade = (cu, lean) => {
        const bu = u.sub(cu).add(vv.mul(lean));
        const w = mix(float(0.045), float(0.012), vv);
        return oneMinus(smoothstep(0.0, 1.0, abs(bu).div(w)))
            .mul(smoothstep(0.0, 0.06, vv))
            .mul(oneMinus(smoothstep(0.8, 1.0, vv)));
    };
    const grassHead = max(
        max(blade(float(0.36), float(0.1)), blade(float(0.5), float(-0.05))),
        blade(float(0.64), float(0.13)),
    );

    // Shape 1 — reed plume: one stem + an elongated plume head near the top.
    const stem = oneMinus(smoothstep(0.0, 0.02, abs(u.sub(0.5).add(vv.mul(0.06)))))
        .mul(smoothstep(0.0, 0.05, vv))
        .mul(oneMinus(smoothstep(0.66, 0.74, vv)));
    const plumeR = length(vec2(u.sub(0.5).add(vv.mul(0.06)).div(0.085), vv.sub(0.76).div(0.16)));
    const plume = oneMinus(smoothstep(0.6, 1.0, plumeR));
    const reed = max(stem, plume);

    // Shape 2 — branch sweep: a diagonal limb with two leaf lobes.
    const limbT = abs(vv.sub(u.mul(0.85).add(0.05)));
    const limb = oneMinus(smoothstep(0.0, 0.035, limbT)).mul(smoothstep(0.04, 0.2, u));
    const lobeA = oneMinus(smoothstep(0.5, 1.0, length(vec2(u.sub(0.42).div(0.16), vv.sub(0.46).div(0.1)))));
    const lobeB = oneMinus(smoothstep(0.5, 1.0, length(vec2(u.sub(0.72).div(0.14), vv.sub(0.72).div(0.09)))));
    const branch = max(max(limb, lobeA), lobeB);

    const isGrass = oneMinus(smoothstep(0.5, 0.51, aShape));
    const isReed = smoothstep(0.5, 0.51, aShape).mul(oneMinus(smoothstep(1.5, 1.51, aShape)));
    const isBranch = smoothstep(1.5, 1.51, aShape);
    const mask = grassHead.mul(isGrass).add(reed.mul(isReed)).add(branch.mul(isBranch));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    // The darkest value in frame (#0E1F12), faintly lifted at the tips so it reads as
    // backlit silhouette, not a hole.
    material.colorNode = vec3(0.055, 0.122, 0.071).mul(vv.mul(0.35).add(0.75));
    material.opacityNode = mask.mul(uOpacity);
    material.alphaTest = 0.3;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'foreground-pass-by';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pilot assembler — mirrors createDeepOceanPilotTSL.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assemble the converted Surface World materials on their original geometries into one
 * group + the shared uTime uniform the caller ticks each frame. Used by the standalone
 * WebGPU pilot validation page. Reproduces the original geometry types/sizes and mesh
 * placement (relative offsets) faithfully. The petals (THREE.Points) and butterflies
 * (MeshBasicMaterial) of the live chapter are out of scope for the material conversion.
 */
export function createSurfaceWorldPilotTSL({
    surfaceOffsetY = -15,
    waterLevel = 60.0,
    grassCount = 1000,
} = {}) {
    const uTime = uniform(0);
    const group = new THREE.Group();
    group.name = 'surface-world-pilot-tsl';

    const terrainOffsetY = surfaceOffsetY + (15 - SURFACE_WORLD_TERRAIN_DEPTH_OFFSET);

    const sky = createSkyBackgroundTSL(uTime);
    const ocean = createOceanSurfaceTSL(uTime, surfaceOffsetY);
    const landscape = createLandscapeTSL(uTime, waterLevel);
    landscape.mesh.position.y += terrainOffsetY;
    const bridge = createFoothillBridgeTSL(uTime);
    bridge.mesh.position.y += terrainOffsetY;
    const grass = createFluffyGrassTSL(uTime, grassCount);
    const grassTufts = createGrassTuftsTSL(uTime, 700);
    grassTufts.mesh.position.y += terrainOffsetY;
    const trees = createTreesTSL(uTime, 26);
    trees.mesh.position.y += terrainOffsetY;
    const reeds = createReedsTSL(uTime, 220);
    reeds.mesh.position.y += terrainOffsetY;
    const pollen = createPollenTSL(uTime, 260);
    const birds = createBirdsTSL(7);
    const sun = createSunDiscTSL(uTime);
    const rays = createSunRaysTSL(uTime);
    const clouds = createCloudsTSL(uTime);
    const mountains = createDistantMountainsTSL(uTime);

    // Batch B5 hero landmarks (anchored to getTerrainHeight with -15 baked in, same as the
    // prop instancers; add terrainOffsetY for the pilot's relative offset like the props).
    const treeLine = createTreeLineTSL(uTime, 44);
    treeLine.mesh.position.y += terrainOffsetY;
    const greatTree = createGreatTreeTSL(uTime);
    greatTree.mesh.position.y += terrainOffsetY;
    const leaves = createFallingLeavesTSL(uTime, 60);
    const waterfall = createWaterfallTSL(uTime);
    waterfall.group.position.y += terrainOffsetY;

    group.add(
        sky.mesh,
        ocean.mesh,
        landscape.mesh,
        bridge.mesh,
        grass.mesh,
        grassTufts.mesh,
        trees.mesh,
        treeLine.mesh,
        reeds.mesh,
        greatTree.mesh,
        leaves.mesh,
        waterfall.group,
        pollen.mesh,
        birds.group,
        sun.group,
        rays.group,
        clouds.group,
        mountains.group,
    );

    const parts = [
        sky, ocean, landscape, bridge, grass,
        grassTufts, trees, treeLine, reeds, greatTree, leaves, waterfall,
        pollen, birds, sun,
        rays, clouds,
        ...mountains.parts,
    ];

    return {
        group,
        uniforms: { uTime },
        dispose() {
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
                part.texture?.dispose?.();
            });
        },
    };
}

export default createSurfaceWorldPilotTSL;
