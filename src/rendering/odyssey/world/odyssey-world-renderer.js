import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, int,
    abs, acos, attribute, clamp, cos, cross, dFdx, dFdy, fwidth, dot, exp, exp2, float, floor, fract, frontFacing,
    log2,
    hash, length, max, min, mix, reflect, select, sign, sqrt, uniformArray,
    normalize, normalWorld, positionGeometry, positionLocal, positionWorld as positionWorldNode, sin,
    smoothstep, step as tslStep, texture, uniform, uv, varying, vec2, vec3, vec4,
    cameraPosition as cameraPositionNode,
    cameraViewMatrix,
    pow2,
} from 'three/tsl';

import {
    ODYSSEY_MASSIFS,
    ODYSSEY_NORTH_BEACH,
    ODYSSEY_NORTH_BEACH_FRAME,
    ODYSSEY_NORTH_LAKE,
    ODYSSEY_NORTH_LAKE_BOX,
    ODYSSEY_NORTH_LAKE_PLATE,
    ODYSSEY_SEA_LEVEL,
    ODYSSEY_SCULPT_PLATE,
    ODYSSEY_TARN,
    ODYSSEY_TARN_BOX,
    ODYSSEY_TARN_PLATE,
} from './odyssey-world-height.js';
import { MORPH_END, MORPH_START, buildOdysseyClipmap } from './odyssey-clipmap.js';
import {
    GROUND_ATLAS_WORLD, bakeGroundAtlas, bakeGroundSunFields,
} from './odyssey-ground-bakes.js';
import {
    RELIEF_EXTENT, bakeDetailNormalData, bakeMacroData, bakeOdysseyCloudField, bakeReliefData,
    bakeNorthLakePlateData, bakeSculptPlateData, bakeSeaLaceData, bakeTarnPlateData, makeReliefSampler,
} from './odyssey-world-bake-data.js';
import {
    ODYSSEY_GROUND_DISTANCE,
    ODYSSEY_GROUND_DRYNESS,
    ODYSSEY_GROUND_LUMA,
    ODYSSEY_GROUND_MOISTURE,
    ODYSSEY_GROUND_PALETTE,
    ODYSSEY_GROUND_SHADE,
    ODYSSEY_GROUND_STRATA,
} from './odyssey-ground-palette.js';
import { hash21, noise2 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { buildKelpGeometry, buildSpireGeometry, planOceanForms } from './odyssey-ocean-forms.js';
import {
    ODYSSEY_BOW, antisolarSchedule, bowSkyLight, bowSpectrum,
} from './odyssey-sky-optics.js';
import { showerBowVolume } from './odyssey-shower.js';
import { WATER_CLOUD_SLOTS, selectWaterClouds } from './odyssey-water-clouds.js';
import { buildNorthLakeSurface, buildTarnSurface, tarnOpenWater } from './odyssey-tarn-surface.js';
import {
    LAKE_WATER, SEA_ABSORB_GAIN, SEA_AIR, SEA_BEACH, SEA_CAPS, SEA_CREST_GLOW, SEA_GLOSS, SEA_SUN_GLITTER, SEA_SURF_BREAK, SEA_WET, SEA_FILM, SEA_HORIZON_DOWN, SEA_RAMP, SEA_SURF,
    SEA_SWELL_TILT, SEA_TROUGH, SEA_WINDROWS, WATER_SHORE_DEPTH_BIAS,
} from './odyssey-water-looks.js';
import { createForestMaterials } from './odyssey-forest-material.js';
import { buildForestMesh, createForestTextures } from './odyssey-forest-mesh.js';
import { forestTier } from './odyssey-forest-species.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import { FOREST_FLOOR_PLATE, bakeForestFloorData, forestClosure } from './odyssey-forest-floor.js';
import { FOREST_SHADE_PLATE, bakeForestShadeData } from './odyssey-forest-shade.js';
import { bakeValleyMist } from './odyssey-valley-mist.js';
import {
    ODYSSEY_DAY_TURN, ODYSSEY_HOUR_LOOK, createDayTurnPace, dayTurnField,
} from './odyssey-day-turn.js';
import { odysseyWeatherDrive } from './odyssey-weather-clock.js';
import { createOdysseyHollowMist } from './odyssey-hollow-mist.js';
import {
    ODYSSEY_TURN_WAKE, createOdysseyTurnWake, inTurnWakeReach, turnWakeSheds,
} from './odyssey-turn-wake.js';
import { createWakeFieldfares } from './odyssey-wake-fieldfares.js';
import { prefersReducedMotion } from '../../../themes/shared/reduced-motion.js';
import {
    ODYSSEY_BOULDERS, boulderMatrix, buildBoulderGeometry, buildBoulderSites,
} from './odyssey-boulders.js';
import {
    billboardWorld, makeQuadInstancedGeometry,
} from '../chapter-environments/shared/odyssey-tsl-billboard.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import {
    sampleColourScript,
    ODYSSEY_WATER_RAMP,
} from '../odyssey-colour-script.js';
import {
    OCEAN_EXTINCTION, OCEAN_SHAFT_EXTINCTION, applyOceanClock, createOceanClock, createOceanLook, oceanClockAt,
    oceanDepthLook, oceanHazeColour,
} from './odyssey-ocean-depth.js';
import {
    SNELL_WINDOW, snellDepthLight, snellMirror, snellWindowLift, snellWindowPresence, snellWindowWorld,
} from './odyssey-ocean-window.js';
import { createOdysseyOceanScenery } from './odyssey-ocean-scenery.js';
import { createOdysseyBreachBurst } from '../composition/odyssey-breach-burst.js';
import { createOdysseyDolphins } from './odyssey-dolphins.js';
// Read-only: the 1->2 carry fades ocean life by the SAME density curve the quench veils with,
// so a re-shaped quench cannot leave fish visible through a thinner veil.
import { behindSteamDepth, steamQuenchDensity } from '../composition/odyssey-steam-quench.js';
import { ORBIT_EARTH_SEAM, orbitEarthOver } from '../composition/odyssey-orbit-earth.js';
import { createOdysseyFish } from './odyssey-fish.js';
import { createOdysseyJellyfish } from './odyssey-jellyfish.js';
// THE EVENING (chapter 5, 2026-11-17): the day ends on the climb. See odyssey-evening.js.
import {
    ODYSSEY_EVENING_U, eveningAir, eveningCirrusColour, eveningCirrusCover, eveningCloudLitShare, eveningCloudWhite,
    eveningDome, eveningLights, updateOdysseyEvening,
} from './odyssey-evening.js';
import { createOdysseyCloudSea } from './odyssey-cloud-sea.js';
import { createOdysseyClouds } from './odyssey-clouds.js';
import { createCloudShadows } from './odyssey-cloud-shadows.js';
import { createHighClouds } from './odyssey-high-clouds.js';
import { createOdysseyWallGusts, wallGustsRevealAt } from './odyssey-wall-gusts.js';
import { findHeroSummit } from '../composition/odyssey-summit-spindrift.js';

// The golden suite imports the cloud silhouette bake from here; it now lives in the pure module.
export { bakeOdysseyCloudField };

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
        // 160 since 2026-10-31 (was 128): the lattice's spacing at a given range is ~range /
        // (gridN / 2), so the massif, seen at 0.5-1.5 km, is drawn a fifth finer and changes far
        // less as the rings pass over it (see clipmapXZ's continuous morph). ~373k ground
        // triangles (was ~239k). The water and the cloud deck keep the lattice their spacing was
        // tuned on (`waterLattice`).
        gridN: 160,
        waterLattice: 128,
        levels: 9,
        baseSpacing: 1.6,
        holeShrink: 3,
        reliefRes: 1024,
        shadowRes: 512,
        treeSpacing: 15,
        detailScales: 2,
        cavity: 0.30,
        ridgeRock: 0.16,
        cloudShadows: true,
        leafClumps: true,
        // Water pass steps 2-3: the waters trace the clouds and the sea marches the land.
        waterReflections: true,
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
        cloudShadows: false,
        leafClumps: false,
        waterReflections: false,
    },
});

// RELIEF_EXTENT is exported by odyssey-world-bake-data.js (shared with the worker).

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
/** Wind-swept lighter bands. Deliberately small: this is a painted stroke, not a strobe. */
const GROUND_WIND_LIFT = 0.055;
/**
 * THE MEADOW (2026-11-22). Tussocks and flower clumps modelled and photographed from straight above
 * in Blender (scripts/blender/odyssey/odyssey_meadow.py -> assets/ground/meadow.png: R the turf's
 * value, G flower coverage). From the rail the grass was felt: the ground's own stroke field is
 * finer than a pixel at 50-150 u and quiet by design. The photograph is `tile` u a side, mipmapped,
 * so it melts to its mean with distance by itself; `turf` is how far its value field moves the
 * grass (Wolfire's mean-transparent ratio: `mean` is the bake's own mean, so the painted colour
 * never shifts), off on steep ground (`slope`: a tussock does not hang on a cliff).
 *
 * FLOWERS IN DRIFTS: the photograph's clumps are everywhere; a drift field `driftCell` u across
 * (two noises) lets them through only in patches, never in deep forest shade, and a species field
 * `speciesCell` u across gives each patch its flower: buttercup, ox-eye daisy, red clover or
 * harebell. Authored for the world's output contract (paler and greyer than the screen result).
 *
 * TONES: the chapter 3-4 meadows were one green; three soft tones in patches `toneCell` u across
 * (a lusher blue-green, a fresh yellow-green, a sun-dried olive), as the north plain has.
 *
 * UNDER THE TREES: the litter of their own leaves and long, darker grass round the trunks, from the
 * forest's cover plate (`litter`, `litterTone`, `rough`).
 *
 * WIND YOU CAN SEE: bands of bent grass, paler, running across the meadow with the gust (`waveLen`
 * u apart, `waveSpeed` u/s, along the one wind's heading, their phase bent by a bounded noise so
 * they are not ruled lines), only while a gust is on (the front's envelope): `waveLift` brightens
 * and `waveFlatten` smooths the turf where a band lies.
 */
const MEADOW = Object.freeze({
    tile: 16,
    mean: 0.282,
    turf: 0.42,
    slope: Object.freeze([0.16, 0.34]),
    driftCell: 95,
    drift: Object.freeze([0.56, 0.74]),
    speciesCell: 140,
    flowers: 1.1,
    shadeKeep: 0.15,
    buttercup: Object.freeze([0.60, 0.47, 0.06]),
    daisy: Object.freeze([0.60, 0.60, 0.54]),
    clover: Object.freeze([0.50, 0.17, 0.30]),
    harebell: Object.freeze([0.25, 0.28, 0.60]),
    toneCell: 120,
    lush: Object.freeze([0.90, 1.02, 1.06]),
    fresh: Object.freeze([1.10, 1.12, 0.62]),
    dry: Object.freeze([1.32, 1.05, 0.74]),
    toneEdge: 0.07,
    // The 2026-11-22 audit measured the sunlit lowland lawn at value ~0.25, saturation ~0.75 on
    // screen: darker than the leaves of the trees on it, a billiard table. The chapter 3-4 meadows
    // (not the north plain, which has its own greens) are lifted and warmed, a touch less saturated.
    lift: Object.freeze([1.26, 1.2, 1.4]),
    // Under the crowns (the forest's cover plate): the litter of their own leaves, in the crowns'
    // mean colour dimmed (`litterTone`), up to `litter` of the ground; long, darker grass round the
    // trunks (`rough` deepens the turf there).
    litter: 0.38,
    litterTone: 0.62,
    rough: 0.35,
    waveLen: 26,
    waveSpeed: 9,
    waveLift: 0.085,
    waveFlatten: 0.5,
});
/**
 * THE CLOUDS IN THE WORLD'S LIGHT (odyssey-cloud-material.js): the strengths of the sun in them (`ramp`: from
 * which share of it to which a flank goes from shade to light), the sky's
 * over and beside them, what comes up from the sea (`bounce`), the burning edge toward the sun (`silver`),
 * the pale rim of a thin edge (`rim`), the crease between billows, and the air they stand in: `haze` of the
 * world's own rate, full at `hazeFoot` (world y) and a third of it `hazeHeight` over that.
 */
const CLOUD_WORLD = Object.freeze({
    sun: 1.16,
    ramp: Object.freeze([0.10, 0.74]),
    sky: 0.86,
    side: 0.66,
    bounce: 0.34,
    bounceTint: Object.freeze([1.06, 0.98, 0.88]),
    silver: 0.9,
    rim: 0.40,
    crease: Object.freeze([0.54, 1.18]),
    hollow: 0.62,
    haze: 0.95,
    hazeFoot: 640,
    hazeHeight: 620,
});
const ODYSSEY_MEADOW_URL = new URL('../assets/ground/meadow.png', import.meta.url).href;
/**
 * THE FOREST'S FLOOR (2026-11-24). Under a wood the ground is no meadow: last year's leaves in drifts, moss,
 * low green herbs. Where the wood is shut, and whose wood it is, the floor plate says (odyssey-forest-floor.js:
 * R the floor, G needles, B blossom, A the gold side); what it looks like is photographed in Blender
 * (scripts/blender/odyssey/odyssey_floor.py: R the litter's light, G moss, B leaves newly fallen), one tile
 * `tile` u across, its light divided by its mean.
 *
 * The outline is broken twice: by a noise `raggedCell` u across and, leaf by leaf, by the litter's own light
 * (`edge`). Coming in from the grass one walks through low green plants first and comes to the leaves after
 * (`deep`): a wood has no brown line round it. `light` is how much of the photograph's light is kept. A
 * broadleaf wood lies in `litter`, a needle wood in `duff`, the gold side in its own leaves (the cover plate's
 * mean crown colour), and under the blossom the grass stays, strewn with `petals`. `moss` and `herb` (low
 * plants, in patches `herbCell` u across, the turf's own photograph for their leaves) keep it green: from the
 * rail a wood's floor is as much green as brown. The sun comes down to it in flecks (`fleck`: how much of it),
 * long along the low sun and narrow across it (`fleckSize`, u), which melt into the shade where a pixel is
 * as wide as one (`fleckMelt`, u).
 */
const FLOOR = Object.freeze({
    tile: 16,
    mean: 0.346,
    slope: Object.freeze([0.30, 0.48]),
    from: Object.freeze([0.22, 0.62]),
    edge: 0.42,
    raggedCell: 6.5,
    ragged: 0.34,
    deep: Object.freeze([0.30, 0.86]),
    light: 0.62,
    litter: Object.freeze([0.278, 0.204, 0.100]),
    duff: Object.freeze([0.242, 0.178, 0.092]),
    fresh: Object.freeze([0.370, 0.250, 0.092]),
    petals: Object.freeze([0.620, 0.330, 0.420]),
    petalShare: 0.62,
    fallen: 0.92,
    moss: Object.freeze([0.132, 0.196, 0.044]),
    mossShare: 0.85,
    herb: Object.freeze([0.112, 0.176, 0.054]),
    herbCell: 17,
    herbShare: 0.78,
    fleck: 0.72,
    fleckFrom: Object.freeze([0.60, 0.76]),
    fleckSize: Object.freeze([7.6, 2.7]),
    fleckMelt: Object.freeze([0.45, 1.5]),
});
const ODYSSEY_FLOOR_URL = new URL('../assets/ground/floor.png', import.meta.url).href;
/**
 * THE NORTH BEACH'S PAINT (2026-11-02; the landform is ODYSSEY_NORTH_BEACH). The sand there is
 * paler than the island's golden shore sand (`pale`, mixed in by `paleMix`), wet only in a thin
 * strip at the water, and broken on the dunes by tufts of dune grass (`grass`, a pale olive),
 * clumps at two scales (u) that thicken toward the dunes' back. `bedKeep` keeps the shallow
 * seabed sand-coloured, so the shallows over it read light.
 */
const NORTH_BEACH_PAINT = Object.freeze({
    pale: Object.freeze([0.90, 0.81, 0.60]),
    paleMix: 0.6,
    grass: Object.freeze([0.21, 0.25, 0.085]),
    tuftScales: Object.freeze([38, 12]),
    toneScale: 90,
    tone: 0.07,
    bedKeep: 0.7,
});
/**
 * THE PLAIN'S MEADOWS (2026-11-02). North of the massif the meadow was one green. Painted
 * patches of three greens now lie over it, a few hundred units across, with soft-edged painted
 * shapes rather than a mottle: a fresh yellow-green, a deep blue-green and a warm olive, each a
 * multiplier on the grass colour (about luma-neutral). `from` is where the plain begins (z, u),
 * so the meadows the rail flies over in chapters 3-4 are untouched.
 */
const PLAIN_MEADOWS = Object.freeze({
    from: Object.freeze([-1250, -1450]),
    cell: 260,
    cellOlive: 170,
    fresh: Object.freeze([0.96, 1.12, 0.55]),
    deep: Object.freeze([0.56, 0.88, 1.28]),
    olive: Object.freeze([1.45, 1.02, 0.70]),
    edge: 0.05,
});
/**
 * Snow's ice-blue shadow, from the old alpine language — the ONE shadow colour here that is prior
 * art rather than a measurement (no reference frame contains snow). Authored luma-neutral
 * (0.2126/0.7152/0.0722 weights sum to 0.997) so it shifts hue only and cannot claim a second
 * share of the value drop that `value` owns.
 */
// Bluer than the shipped [0.87, 1.01, 1.24] (item 5) and still luma-neutral (0.97): with the
// ambient now owning a LUMINOUS shade (ODYSSEY_GROUND_SHADE.snow), the hue shift is what says
// "snow in shadow" rather than "grey".
const GROUND_SNOW_SHADE = Object.freeze([0.80, 0.99, 1.32]);
/**
 * How hard convex ground strips its own snow. Wind scours ribs and fills hollows, so a peak's
 * structure shows as stone on the crests — the one cue that separates a snowy MOUNTAIN from a
 * smooth white cone when the silhouette cannot help.
 */
const GROUND_SNOW_CREST_STRIP = 0.75;
/**
 * CRISP SNOW (round two): above `from` (altitude ramp, u) the snow weight is thresholded instead
 * of blended; `breakup` is how far the atlas grain pushes the boundary, `edge` the threshold's
 * half-width bounds (a pixel's fwidth sits between them).
 */
/** Crisp rock ramps in over this altitude band (u): above the shore lowlands, below the scree. */
const ROCK_CRISP_FROM = Object.freeze([320, 380]);
/**
 * THE SUMMIT'S ROCK (2026-10-31): above `from` (u) shaded stone takes more of the sky
 * (`rockAmbient`) and of its hue (`rockSkyChroma`): open to the whole dome and to the bounce off the
 * snow round it, it is slate lit by the sky, not black paint. (Its snow ledges, a line every 7.5 u,
 * went with the mountain's rebuild, 2026-11-25: they were the audit's striped snow.)
 */
const SUMMIT_ROCK = Object.freeze({
    from: Object.freeze([600, 690]),
    rockAmbient: 0.50,
    rockSkyChroma: 0.55,
});
const SNOW_CRISP = Object.freeze({
    from: Object.freeze([560, 680]),
    breakup: 0.20,
    edge: Object.freeze([0.055, 0.3]),
});
/**
 * CLOUD SHADOWS ON THE LAND AND THE SEA: the sky's own clouds' (odyssey-cloud-shadows.js), on the high tier only
 * (ODYSSEY_WORLD_QUALITY.cloudShadows). Strength and cover are uniforms the update drives (`cloudShadowSchedule`).
 */
const GROUND_CLOUD_SHADOW = Object.freeze({
    /** How much of the sun the thickest cloud takes. */
    depth: 0.50,
});
/**
 * How dark the sea's body stands where a cloud's shadow is deepest, against its sunlit self: the
 * field takes 0.46 of the direct light, and this is the body at light 0 (so ~0.72 under a cloud).
 */
const SEA_CLOUD_SHADE = 0.40;
/**
 * Cloud-shadow strength and cover over Act II progress (pure; exported for its test). The breach
 * comes up under a broken sky that opens as the shore arrives ("light floods the island"), then a
 * steady scattered cover; under water there is no ground light to shade.
 * @param {number} actT 0..1 across Act II
 * @returns {{strength:number, cover:number}}
 */
export function cloudShadowSchedule(actT) {
    const t = Math.min(Math.max(Number.isFinite(actT) ? actT : 0, 0), 1);
    const ramp = (a, b, x) => {
        const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
        return u * u * (3 - (2 * u));
    };
    // The 2->3 breach sits at actT ~0.105 and L12 (the first full shore orb) at ~0.13.
    const opening = ramp(0.105, 0.150, t);
    return {
        strength: ramp(0.08, 0.11, t),
        cover: 0.82 - (0.30 * opening) + (0.06 * ramp(0.42, 0.62, t)),
    };
}
/**
 * THE MASSIF'S SNOW (2026-11-25, the mountain rebuilt; see the block that reads it in the ground):
 *   couloir     how much lower the snowline runs where the form gathers water (u, x `gully`)
 *   rib         how much higher on a convex rib (u, x `crest`)
 *   sunward     how much higher on a face square to the low western sun, lower in its lee (u)
 *   breakScale  the snow edge's break-up read (1 / u): lobes tens of units across
 *   breakReach  how far that break-up moves the snowline (u)
 *   cliff       the slope (1 - normal.y) where snow lets go of the face, and where it is gone
 *   mantle      the heights over which the summit's snow becomes a mantle (the ribs strip less)
 */
/**
 * THE MASSIF'S ROCK UP CLOSE (2026-11-25; see the block that reads it in the ground): joint spacing across
 * world x, z and the bedding's in height (u), their wobble (u), a crack's half width in a cell (share), how
 * dark a crack draws and how far a block's own tone swings; `near` the footprint (u a pixel) over which the
 * joints fade in, so they show only where a cell is several pixels wide.
 */
const MASSIF_ROCK = Object.freeze({
    spacing: Object.freeze([11, 13, 7.5]),
    wobble: 6,
    crack: 0.035,
    crackDark: 0.42,
    blockTone: 0.18,
    near: Object.freeze([0.14, 0.42]),
    /** The slope (1 - normal.y) over which a face becomes jointed rock. */
    steep: Object.freeze([0.42, 0.6]),
});
const MASSIF_SNOW = Object.freeze({
    couloir: 130,
    rib: 55,
    sunward: 60,
    breakScale: 0.021,
    breakReach: 85,
    cliff: Object.freeze([0.70, 0.84]),
    mantle: Object.freeze([820, 960]),
});
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
 * THE TARN'S MIRROR (see the tarn material): the march (`steps`, the first step and how each grows,
 * world units), where the reflected land turns to rock and to snow (altitude ramps), and its light
 * (sun gain over the baked visibility, sky ambient).
 *
 * ONE WATER (2026-10-31): the tarn's water is the sea's (the `water*` helpers), with three pond
 * settings: `absorb` drives the sea's pigment ramp by the tarn's own few units of depth (the sea's
 * 0.02 a metre would leave a 3 u pond at the palest step), `calm` scales the sea's ripple slope
 * (a sheltered pond, not open water), and `fresnel` is the sea's [gain, floor] with a higher floor,
 * because still water mirrors more than a sea under wind.
 */
/**
 * THE SHOWER'S LOOK (round three; the layout is odyssey-shower.js): how fast the rain falls (u/s)
 * and how long its streaks are (u), the even veil and the streaks' share of its density, and how
 * strong the bow is in it against the sky's old bow.
 */
const SHOWER_LOOK = Object.freeze({
    /** Optical depth per unit of integrated (1 - r^2) rain: the bow's mask is ~0.9 through the line. */
    density: 0.009,
    /** The bow against the sky's old one, the glow inside it, and Alexander's band (a darkening). */
    bowGain: 2.0,
    glow: 0.08,
    band: 0.10,
});
/**
 * THE WORLD IN THE SEA (water pass step 3): the sea's own march over the macro and relief plates
 * (no summit plate: the summit stands too far back to stand in the water), coarse and short: its
 * steps grow faster than the tarn's, it stops once a ray has climbed over every summit
 * (`ceiling`), and only water within `reach` of the eye marches (beyond it the sea's mirror is
 * the sky's, and the horizon dissolve owns the frame).
 */
const SEA_MIRROR = Object.freeze({
    steps: 18,
    firstStep: 6.0,
    stepGrowth: 1.24,
    soft: 3.0,
    ceiling: 1150,
    reach: 1000,
    // A SOFT SHARE, NOT A HIT TEST (2026-11-21 sea audit, item 3). The land ray followed the whole
    // swell, so on its back faces it dipped under the horizon, a 0.02 clamp re-aimed those rays into
    // the sunlit beach and the binary hit drew hard khaki pills with dark rims across the shelf.
    // The ray now follows `swell` of the swell's slope; how much land it takes is a smoothstep of
    // how far the land rises over it (radians), as soft as `blur`: [a floor, a share of the swell's
    // RMS slope the ray no longer follows, pixels of the ray's own footprint]. `lift`: rays this
    // close to level fade in (a grazing ray meets the next wave); `gain`: the land's share.
    swell: 0.35,
    blur: Object.freeze([0.02, 0.33, 1.5]),
    lift: 0.05,
    gain: 0.8,
});
/**
 * THE SWANS' WAKES on the tarn (life at the pond, 2026-11-02): the V's spread (tan of ~19.5 deg),
 * where it starts behind the breast and how wide its arms are and grow, how far it reaches, the
 * speed at which it is whole, its crests per unit, how much it tilts the water and lifts it toward
 * white; the bow wave; the swans in the mirror (body and neck above the water, drawn units).
 */
const TARN_WAKE = Object.freeze({
    spread: 0.36,
    bow: 0.6,
    width: 0.5,
    widen: 0.05,
    reach: 34,
    fullSpeed: 0.9,
    crests: 1.7,
    tilt: 0.28,
    // (0.12 until 2026-11-20: over the clear, darker water the crests read as a dotted white line from above.)
    whiten: 0.04,
    bowAt: 1.5,
    bowR: 0.9,
    bodyY: 0.35,
    bodyR: 1.1,
    neckAt: 1.3,
    neckY: 1.5,
    neckR: 0.35,
    swanWhite: Object.freeze([0.80, 0.82, 0.83]),
});
/**
 * THE TARN'S SEAT in the ground's lattice (see the ground's position): a vertex the tarn's plate
 * puts under the water sits at least `sink` under it, one it puts on dry ground at least `dry`
 * over it, each a share of the vertex's own spacing within [min, max] (u); `wetBy` is the depth
 * by which a vertex counts as wet.
 */
const TARN_SEAT = Object.freeze({
    sink: Object.freeze([0.08, 0.05, 0.6]),
    dry: Object.freeze([0.01, 0.02, 0.06]),
    wetBy: 0.12,
});
/** One texel of a drawn water's plate (u, along x and z): the step of the slope's differences. */
const plateTexel = (P) => Object.freeze([(P.box[1] - P.box[0]) / P.resX, (P.box[3] - P.box[2]) / P.resZ]);
const TARN_TEXEL = plateTexel(ODYSSEY_TARN_PLATE);
const LAKE_TEXEL = plateTexel(ODYSSEY_NORTH_LAKE_PLATE);
/**
 * THE TARN'S SHORE on the ground (2026-11-20), by the distance to the waterline the tarn's plate
 * carries (u, + on land). The meadow round the tarn was painted by the SEA's rules, which read
 * height over the sea: the basin's floor, 5-10 u over it, came out part sand and half wet, a tan
 * ring round the water. Inside the tarn's box the shore is the tarn's own:
 *   - `beach`: gravel from under the water out to between these distances (u), the reach moved
 *     by a low noise (`beachCell` u) so stretches of beach alternate with turf that comes down
 *     to the water; `beachEdge` is its edge's softness and `beachBreak` how far the atlas grain
 *     breaks it (u);
 *   - `lush`: the turf is the damp, green pole near the water, fading out between these
 *     distances (u);
 *   - `near`: the band (u) the shore's paint is computed in at all.
 */
const TARN_SHORE = Object.freeze({
    // (2026-11-22 land audit: the bank read as a kerb of one width all round, so the gravel stretches
    // are now rarer, narrower and shorter, and most of the shore is turf down to the water.)
    beach: Object.freeze([-0.45, 1.7]),
    /** Where the reach's noise turns from the narrow to the wide (a short band: one or the other). */
    beachSplit: Object.freeze([0.62, 0.7]),
    /** The beach's own stone: a cool grey gravel, not the sea's warm sand (linear albedo). */
    gravel: Object.freeze([0.40, 0.37, 0.31]),
    beachCell: 13,
    beachEdge: 0.35,
    beachBreak: 0.5,
    lush: Object.freeze([1.5, 9]),
    near: Object.freeze([4, 10]),
    fade: 10,
});
/**
 * THE TARN'S BED (2026-11-20): what the clear water shows. Pale gravel on the shelf and darker
 * silt in the basins (`gravel`, `silt`, linear albedo, the silt from 0.5 u of depth, whole by
 * 2.2), weed in patches (`weed`, a mottle of two noise cells, u) from ~0.4 u down; seen through
 * the water's own colour, which takes red first, then green (`absorb`, per unit of depth, for
 * the light's way down and back up). Just above the waterline the gravel and turf are wet
 * (`wetTone`, out to `wetAbove` u).
 */
const TARN_BED = Object.freeze({
    gravel: Object.freeze([0.42, 0.39, 0.31]),
    /** The shelf's bed off a turf bank: peat and moss, nearly as dark as the silt. */
    peat: Object.freeze([0.12, 0.13, 0.07]),
    silt: Object.freeze([0.17, 0.17, 0.12]),
    weed: Object.freeze([0.10, 0.15, 0.06]),
    cells: Object.freeze([7.5, 2.6]),
    absorb: Object.freeze([0.95, 0.30, 0.22]),
    wetTone: 0.68,
    wetAbove: 0.55,
});
/**
 * THE DRAWN WATERS' PAINT (2026-11-21): the north lake paints its shore and its bed by the
 * tarn's rules (TARN_SHORE, TARN_BED) in its own units, its distances divided by `scale` and
 * its depths by `depthScale` (a beach out to ~10 u, a shelf whose silt starts at 2 u), and its
 * bed seen through its own water (`absorb` per unit of depth: a bluer, clearer lake, so its
 * gravel shelf reads turquoise and its deep blue-teal from the climb).
 */
const DRAWN_PAINT = Object.freeze({
    tarn: Object.freeze({
        scale: 1, depthScale: 1, absorb: TARN_BED.absorb, shelfGravel: 0,
    }),
    lake: Object.freeze({
        // (Its shelf is dark wet sand with some gravel, and its water takes red fast: so even a
        // unit of it reads turquoise from the climb, through the evening's haze.)
        scale: 3.3,
        depthScale: 4,
        absorb: Object.freeze([1.1, 0.18, 0.07]),
        shelfGravel: 0.45,
        sand: Object.freeze([0.36, 0.35, 0.30]),
    }),
});
/** The world sun's bearing on the ground plane (the near sea's chop facets face it or not). */
const SEA_SUN_FLAT = (() => {
    const l = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[2]);
    return [ODYSSEY_WORLD_SUN[0] / l, ODYSSEY_WORLD_SUN[2] / l];
})();
const TARN_MIRROR = Object.freeze({
    steps: 24,
    firstStep: 3.0,
    stepGrowth: 1.22,
    rockFrom: Object.freeze([420, 520]),
    snowFrom: Object.freeze([610, 700]),
    sunLit: 0.95,
    ambient: 0.45,
    /** How close a reflected ray may pass over the land and still take some of it (u, or 2% of the run). */
    soft: 1.6,
    /** The sea's ripple slope, scaled down for a sheltered tarn (0.35 until 2026-11-20: the mirror broke into cells). */
    calm: 0.27,
    /** How many rings (rises) the pond carries at once (water pass step 4), and their places. */
    rings: 3,
    ringSites: 8,
    fresnel: Object.freeze([0.85, 0.20]),
    /**
     * CLEAR WATER (2026-11-20, Olov: "improve the looks of the pond"). It was a painted pigment,
     * the milky jade of glacial flour in four flat plates, nearly opaque from shore to shore: the
     * brightest, flattest thing in every frame, a pool on the meadow. Now it is a clear mountain
     * tarn: the bed shows through (TARN_BED: gravel on the shelf, silt and weed in the basins) as
     * the water takes it, `clarity` per unit of depth, and what the bed no longer gives is the
     * water's own deep colour (`deep`, linear), with the sky and the mountain mirrored over all of
     * it by the Fresnel share.
     */
    clarity: 0.62,
    deep: Object.freeze([0.012, 0.062, 0.068]),
    /**
     * The soft waterline: the film thins to nothing over this many units of depth, or this many
     * pixels' worth of it from afar, whichever is wider.
     */
    shore: 0.16,
    shorePx: 1.6,
});
/**
 * The jade a thin wave crest transmits, seen from ABOVE (the topside twin of `uWaterGlow`'s
 * underside SSS). Authored greener and brighter than the pixel it should land on: the world
 * hands the grade a 0.72-saturation image and the grade puts the chroma back.
 */
const WATER_JADE = Object.freeze([0.20, 0.72, 0.60]);
/**
 * THE UNDERWATER LIGHT LADDER (item 4) — the two poles the submerged frame now walks between.
 * The colour script's water keyframes are all steel/navy blues, so every submerged frame was
 * one mid-blue from edge to edge: a "flat uniform blue void". Light under water is not
 * uniform: it is a luminous teal ceiling where the surface lets the sky in, falling to deep
 * indigo where the water column is long. These lean the existing plates toward those poles
 * (never replace them — the script still owns the journey's hue walk), authored bright and
 * saturated for the grade like every palette here.
 */
// (2026-11-17: the two poles are the depth arc's now, one pair per water — `uWaterLum` and the
// deep plate, written each frame from odyssey-ocean-depth.js by the eye's depth.)

/**
 * THE 1->2 CARRY — embers become bubbles (seamless pass, cross-session interface).
 *
 * The board hands the world the steam quench's own clock, `steamQuenchSeamT` (0 at the approach
 * edge, 0.5 exactly on the 1->2 boundary, 1 at the exit edge), through `setQuenchCarry(t)`. Across
 * it the world's motes stop being drifting specks and behave as a column of RISING BUBBLES — faster,
 * wobbling, ring-shaped — whose colour walks ember -> white -> cyan, so the updraft of embers the
 * player climbed through in Earth Core is the thing that turns into the sea. Ocean LIFE (fish, the
 * whale, the light shafts) waits for the veil to thin, so nothing oceanic stands in the cavern
 * beside the basalt columns (the audit's p=0.0529 frame).
 *
 * Pure function of t, exported for tests. `carry` is how much the motes behave as bubbles, `bubble`
 * how ring-shaped they are (embers are hot dots, bubbles are rims), `tint` the colour they wear while
 * carried, `life` the presence of ocean life: 0 on the cavern side, then 1 - the quench's density.
 */
export const QUENCH_EMBER = Object.freeze([1.0, 0.46, 0.16]);
export const QUENCH_WHITE = Object.freeze([0.96, 0.97, 1.0]);
export const QUENCH_CYAN = Object.freeze([0.42, 0.92, 0.96]);
/** How much faster a carried mote rises (x1 + this at full carry). */
export const QUENCH_RISE_BOOST = 4.5;
const smooth01 = (a, b, x) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - (2 * t));
};
export function odysseyQuenchCarry(seamT) {
    const t = Math.min(Math.max(Number.isFinite(seamT) ? seamT : 1, 0), 1);
    const carry = smooth01(0.10, 0.30, t) * (1 - smooth01(0.70, 1.0, t));
    // Rims only while carried: back to today's dot by the exit edge (t = 1 is the neutral ocean).
    const bubble = smooth01(0.42, 0.62, t) * (1 - smooth01(0.72, 1.0, t));
    const tint = t < 0.5
        ? QUENCH_EMBER.map((c, i) => c + ((QUENCH_WHITE[i] - c) * smooth01(0.25, 0.5, t)))
        : QUENCH_WHITE.map((c, i) => c + ((QUENCH_CYAN[i] - c) * smooth01(0.5, 0.8, t)));
    // 0 until the boundary (the cavern side), then whole within the steam's densest stretch, so
    // when it clears the ocean's life is already there (2026-10-25: it used to follow the veil
    // thinning, and came in as the steam cleared). It lies behind the steam's shell meanwhile
    // (behindSteamDepth), so a fish never stands crisp against white vapour.
    const life = t <= 0.5 ? 0 : smooth01(0.5, 0.53, t);
    return {
        carry, bubble, tint, life,
    };
}

/**
 * THE 2->3 BREACH SPRAY — bubbles become spray. When the EYE crosses sea level upward the world
 * throws a camera-relative burst of droplets, re-using the motes (one draw that already exists and
 * is warmed with the world — no new mesh, no new pipeline). `SPRAY_LIFE_S` is the burst's length;
 * `SPRAY_CLIMB_RATE` lets the eye's own height above the surface age the burst too, so a scrub or a
 * frozen-clock capture shows the burst at the age the climb implies rather than frozen at birth.
 */
export const SPRAY_LIFE_S = 1.8;
export const SPRAY_CLIMB_RATE = 9;
export function odysseySprayEnvelope(age) {
    if (!Number.isFinite(age) || age < 0 || age >= SPRAY_LIFE_S) return 0;
    return 1 - smooth01(SPRAY_LIFE_S * 0.55, SPRAY_LIFE_S, age);
}
/**
 * THE EDGE OF SPACE (item 10). The departure fade used to pull zenith, horizon, clouds and
 * ground toward the void TOGETHER, which reads as a dimmer switch. Leaving an atmosphere is
 * ordered: the sky goes black overhead first, the horizon holds a thin glowing limb, and the
 * cloud tops below stay lit longest. The fade is split into a zenith pace (fade^0.55, ahead)
 * and a horizon/cloud pace (fade^1.8, behind), and the limb glows by fade^3 (1 - fade) —
 * present only once the sky overhead has gone dark, which is exactly when a limb is seen.
 */
const DEPART_ZENITH_POW = 0.55;
const DEPART_HORIZON_POW = 1.8;
/** The atmospheric limb (Rayleigh blue) and the thin airglow line just above it. */
const DEPART_LIMB = Object.freeze([0.22, 0.48, 0.95]);
const DEPART_AIRGLOW = Object.freeze([0.20, 0.78, 0.46]);
/**
 * Where the colour script stops walking at the old pace and runs out to its LAST keyframe.
 * The map was `0.05 + p * 0.9`, so the script never got past 0.95 and its 'edge-of-space'
 * keyframe (near-black zenith, deep-blue horizon) was never reached inside Act II. Below this
 * act progress the old map is kept EXACTLY (ch2-5 unchanged); above it the script runs out to
 * 1.0 at the act edge, through the same departure the fade opens on (actT ~0.82).
 */
const SCRIPT_RUNOUT_FROM = 0.82;
/** Peak opacity of the valley mist (item 7) — a veil, never a fog bank. */
const VALLEY_MIST_GAIN = 0.20;
/**
 * MIST LYING LOW (round three, 2026-10-31). Olov: "soft haze lying in the valleys and hollows, so
 * the forest and hills stack in layers instead of reading flat." The air's haze grows with range
 * and thins with height over ~650 u, so from the meadows (the eye 60-100 u over the sea) the
 * forest, the slopes behind it and the far hills all hazed alike. Two thin bodies of mist lie on
 * the land as well, both integrated along the eye's ray:
 *  - a LAYER over the sea and the low land, its density falling with height above the sea over a
 *    few tens of units, so the feet of every far hill stand in pale air and their tops stand clear;
 *  - POOLS in the hollows (odyssey-valley-mist.js), each a slab of mist from the ground up to its
 *    level top, so a basin's floor goes soft while the crowns and ridges round it stand out.
 * Its colour is the sunlit air's, never grey: the sky's own air washed toward white, a touch cooler
 * in the land's shadows, and glowing toward the sun.
 */
const GROUND_MIST = Object.freeze({
    /** The layer: density at the sea (per u) and its scale height (u). */
    density: 0.0012,
    height: 35,
    /** The pools: density per u of path through them, the longest path counted (u), and the
     * shallowest slant a ray is counted at (|dir.y|). */
    pool: 0.008,
    poolPath: 400,
    graze: 0.08,
    /** The most it veils, the clear zone round the eye (u), and the eye heights over the sea it
     * fades out between on the climb (u). */
    gain: 0.5,
    near: Object.freeze([150, 1000]),
    eyeFade: Object.freeze([1400, 2600]),
    /** Wisps: the noise's scale (1/u), its swing (±), and the wind it drifts on (u/s). */
    wispScale: 1 / 1100,
    wisp: 0.35,
    drift: Object.freeze([3.0, -1.8]),
    /** Its colour: the sunlit white and how bright it is against the land, how much of the sky's
     * air it keeps, its shade (a multiplier, in the land's shadow) and its glow toward the sun. */
    white: Object.freeze([0.97, 0.975, 0.98]),
    bright: 1.25,
    air: 0.35,
    shade: 0.92,
    forward: 0.30,
    /** Over the open sea it is laid thinner, so the water keeps its blue to the horizon. */
    sea: 0.4,
});
// The light either side of the day's turn (odyssey-day-turn.js): the script at the two ends of its
// window, on the same act-progress map `update` walks the script by (0.05 + actT x 0.9).
const DAY_TURN_FROM = sampleColourScript(0.05 + (ODYSSEY_DAY_TURN.window[0] * 0.9));
const DAY_TURN_TO = sampleColourScript(0.05 + (ODYSSEY_DAY_TURN.window[1] * 0.9));
/** A light's sun under the weather (odyssey-weather-clock.js): softened toward its sky, then its brightness. */
function weatherSun(light, weather, target) {
    return target.setRGB(
        (light.sun[0] + ((light.skyHorizon[0] - light.sun[0]) * weather.soft)) * weather.sun,
        (light.sun[1] + ((light.skyHorizon[1] - light.sun[1]) * weather.soft)) * weather.sun,
        (light.sun[2] + ((light.skyHorizon[2] - light.sun[2]) * weather.soft)) * weather.sun,
    );
}
/** The land's share of the hour's look at `hour`: (shade chroma, snow shade chroma, alpenglow, shade depth). */
function landHourLook(hour, look, target) {
    return target.set(
        look.shadeChroma * hour,
        look.snowShadeChroma * hour,
        look.alpenglow * hour,
        look.shadeDeep * hour,
    );
}

// ── bakes ────────────────────────────────────────────────────────────────────────

// ── bakes (pure halves live in odyssey-world-bake-data.js; these wrap arrays as textures) ─────

function halfFloatTexture(data, res, wrapping) {
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = wrapping;
    tex.wrapT = wrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

/** Relief + derivatives texture and the CPU mirror sampler; `baked` skips the bake. */
function buildReliefBake(reliefRes, baked = null) {
    const d = baked ?? bakeReliefData(reliefRes);
    // Half-float is filterable everywhere with no feature request; float32-filterable is
    // optional in WebGPU and r181's fallback covers only DataTexture, not render targets.
    return { tex: halfFloatTexture(d.data, d.res, THREE.ClampToEdgeWrapping), sample: makeReliefSampler(d) };
}

function bakeMacroTexture(res = 512, baked = null) {
    const d = baked ?? bakeMacroData(res);
    return halfFloatTexture(d.data, d.res, THREE.ClampToEdgeWrapping);
}

function bakeDetailNormal(res = 256, baked = null) {
    const d = baked ?? bakeDetailNormalData(res);
    const { cloudStats } = d;
    // eslint-disable-next-line no-console
    console.log('[world] cloud silhouette histogram', JSON.stringify({
        k: Number(cloudStats.k.toFixed(3)),
        p10: Number(cloudStats.p10.toFixed(4)),
        p50: Number(cloudStats.p50.toFixed(4)),
        p90: Number(cloudStats.p90.toFixed(4)),
    }));
    return halfFloatTexture(d.data, d.res, THREE.RepeatWrapping);
}

/**
 * The forest's draw distance from the rail, PER TREE (audit 2026-10-18). Chunks used to switch
 * on and off whole when their CENTRE crossed 1450 u, and a far chunk is 1,680 u wide, so ~500
 * trees as close as ~830 u popped in or out together while scrolling (forest-stats capture:
 * p 0.186 -> 0.190). Now each tree sinks into the ground across NEAR..FAR by its own
 * distance, and a chunk draws while its nearest tree is inside FAR, i.e. it switches only
 * where every tree in it is already sunk. Measured over Act II at 0.004 steps: about +3%
 * forest vertices for about the same number of standing trees.
 */
const FOREST_DRAW_NEAR = 1450;
const FOREST_DRAW_FAR = 1650;
// Deeper than the tallest tree (~31 u) plus a crown overhanging a steep slope.
const FOREST_FADE_SINK = 90;
/**
 * THE FOREST'S SHADE ON THE GROUND (Act II pass, step 3) — see odyssey-forest-shade.js.
 *   SHADOW_DEPTH   how much of the direct sun a baked crown shadow takes off the ground;
 *   FLOOR_AO       how much of the sky the canopy takes off the forest floor;
 *   FAR_*          where the far forest is painted onto the ground: across the same band the
 *                  trees sink in (FOREST_DRAW_NEAR..FAR), so the canopy hands over to its own
 *                  painted density instead of leaving bare grass where the forest stops drawing;
 *                  its tone is the crowns' mean colour, darkened toward their shade side.
 */
const FOREST_SHADOW_DEPTH = 0.9;
const FOREST_FLOOR_AO = 0.5;
const FOREST_FAR_TONE = 0.78;

// ── the world ────────────────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {string} [opts.quality] 'high' | 'low'
 * @param {Array<{x:number,y:number,z:number}>} [opts.railSamples] points along the journey
 *   rail, sampled by the CALLER (the world deliberately does not know the path). Used to seat
 *   the underwater god-ray shafts along the submerged stretch; empty means no shafts.
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
 * @param {boolean} [opts.clouds] the sky's clouds (odyssey-clouds.js, odyssey-high-clouds.js) and the sea of clouds' bed.
 *   `?odysseyWorldNoClouds=1` on the board takes them away, for a bisect or a measurement.
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
 */
export function createOdysseyWorld({
    quality = 'high', applyExposure = true, outputScale = 1, outputSaturation = 1, clouds = true,
    // THE SEA OF CLOUDS under chapter 5's evening (odyssey-cloud-sea.js). Rides the clouds' lever too;
    // `?odysseyNoCloudSea=1` on the board removes its bed alone.
    cloudSea = true,
    water = true,
    forest = true,
    // The rail-visibility cull: drop trees the journey's camera can never see. Ships ON — it
    // was measured at 0.00% of pixels changed across four rail stations, for 0.20 ms p50 — and
    // `?odysseyWorldNoVisCull=1` restores every tree (ADR-0015).
    visibilityCull = true,
    // The wild horses' meadow kept open (odyssey-meadow-clearing.js). Ships ON;
    // `?odysseyNoMeadowClearing=1` puts its trees back (ADR-0015).
    meadowClearing = true,
    // EXPERIMENT: pin every tree to one LOD tier. `?odysseyForestLod=hero` is the "what would
    // high-detail trees everywhere feel like" lever. Not a quality setting — it ignores
    // distance entirely, so it costs ~18 ms of forest on the integrated lane.
    forestLod = null,
    /** Quality tier name — selects the forest's hero/mid LOD distances. */
    qualityTier = null,
    /** Whether the pass this world is drawn in has MSAA (its leaves soften their edges by coverage). */
    sceneMultisampled = true,
    // MEASUREMENT ONLY (ground plan Wave 0a). Same geometry, same draws, same triangles —
    // only the ground's fragment mesostructure is withheld, so `baseline - flat-ground`
    // prices exactly the stack the overhaul spends against. Never shipped on.
    flatGround = false,
    skyRadius = null, railSamples = [],
    // Item 2.1: bakes landed by odyssey-world-bake-loader.js (Worker or its synchronous twin).
    // `{ relief, textures: { sunFields, atlas, detail, macro }, scatter }`; any missing
    // piece is baked right here, synchronously, as before — one code path, pinned by goldens.
    prebaked = null,
    // Where the weather's clock stands at world time 0 (seconds; odyssey-weather-clock.js). The
    // board hands in the wall clock, so a session does not open on the same weather as the last;
    // left at 0 (the playgrounds, the tests) a pinned time repeats.
    weatherPhase = 0,
} = {}) {
    const weatherEpoch = Number.isFinite(weatherPhase) ? weatherPhase : 0;
    const weatherNow = {};
    const dayTurnPace = createDayTurnPace(DAY_TURN_FROM, DAY_TURN_TO);
    // ── THE CLIMB'S FRAME (2026-10-24) ──────────────────────────────────────────────────
    // At the end of chapter 5 the board shrinks this whole group toward the sea-level point
    // beneath the eye (`setClimb`, odyssey-world-act-gate.js `worldClimbScale`): a world shrunk
    // by s about that point looks exactly like the world seen from 1/s times as high, so the eye
    // climbs above the clouds. Every material below was written for an identity group, and
    // distances drive their haze, their detail and their fades, so they all read positions and
    // the eye in the group's OWN frame: there the world keeps its size and the eye stands as high
    // as the climb has taken it. These two names shadow three's nodes for the whole build; with
    // the group at identity (everywhere but the climb) they ARE positionWorld and cameraPosition.
    // Directions are unchanged by a scale about a point, so anything that only looks along a
    // view direction reads the same either way.
    const uClimb = uniform(1); // 1 / the group's scale
    const uClimbCentre = uniform(new THREE.Vector3(0, ODYSSEY_SEA_LEVEL, 0));
    const inClimbFrame = (p) => uClimbCentre.add(p.sub(uClimbCentre).mul(uClimb));
    const positionWorld = inClimbFrame(positionWorldNode);
    const cameraPosition = inClimbFrame(cameraPositionNode);

    const q = ODYSSEY_WORLD_QUALITY[quality] || ODYSSEY_WORLD_QUALITY.high;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);

    const pre = prebaked || {};
    const preTex = pre.textures || {};
    const relief = buildReliefBake(q.reliefRes, pre.relief?.res === q.reliefRes ? pre.relief : null);
    // The world plate: sun visibility (R, unchanged) plus the three fields that ARE the
    // painting — wide occlusion, moisture, and the island's colour zone. Deciles are logged so
    // a rebake cannot silently flatten a field the whole palette hangs off.
    const prebakedSunFields = preTex.sunFields?.res === q.shadowRes ? preTex.sunFields : null;
    const sunFields = bakeGroundSunFields(relief.sample, q.shadowRes, prebakedSunFields);
    const sunVisTex = sunFields.tex;
    // The plate's R (sun visibility) sampled on the CPU exactly as the GPU's LinearFilter /
    // ClampToEdge sampler reads it at `xz / RELIEF_EXTENT + 0.5` — for per-instance consumers
    // (the forest), so they carry the shadow without a texture fetch per vertex.
    const sunVisAt = (() => {
        const { width: res, data } = sunVisTex.image;
        const at = (i, j) => {
            const ci = Math.min(Math.max(i, 0), res - 1);
            const cj = Math.min(Math.max(j, 0), res - 1);
            return THREE.DataUtils.fromHalfFloat(data[((cj * res) + ci) * 4]);
        };
        return (x, z) => {
            const fx = (((x / RELIEF_EXTENT) + 0.5) * res) - 0.5;
            const fz = (((z / RELIEF_EXTENT) + 0.5) * res) - 0.5;
            const i0 = Math.floor(fx);
            const j0 = Math.floor(fz);
            const tx = fx - i0;
            const tz = fz - j0;
            const top = at(i0, j0) + ((at(i0 + 1, j0) - at(i0, j0)) * tx);
            const bot = at(i0, j0 + 1) + ((at(i0 + 1, j0 + 1) - at(i0, j0 + 1)) * tx);
            return top + ((bot - top) * tz);
        };
    })();
    const groundAtlas = bakeGroundAtlas(undefined, preTex.atlas ?? null);
    const groundTex = groundAtlas.tex;
    const atlasAvg = groundAtlas.avg;
    const detailTex = bakeDetailNormal(undefined, preTex.detail ?? null);
    // THE SEA'S LACE (SEA_CAPS, 2026-11-21): the foam-lace tile the whitecaps thin into. Tiling, no
    // mips: it is read at level 0 inside a per-pixel branch.
    const seaLace = preTex.detail?.lace ?? bakeSeaLaceData();
    const seaLaceTex = new THREE.DataTexture(seaLace.data, seaLace.res, seaLace.res, THREE.RGBAFormat, THREE.UnsignedByteType);
    seaLaceTex.wrapS = THREE.RepeatWrapping;
    seaLaceTex.wrapT = THREE.RepeatWrapping;
    seaLaceTex.magFilter = THREE.LinearFilter;
    seaLaceTex.minFilter = THREE.LinearFilter;
    seaLaceTex.generateMipmaps = false;
    seaLaceTex.colorSpace = THREE.NoColorSpace;
    seaLaceTex.needsUpdate = true;
    const macroTex = bakeMacroTexture(undefined, preTex.macro ?? null);
    const heightTex = relief.tex;
    // THE SCULPT PLATE (bakeSculptPlateData): ~1.8 u of form over the hero's top and the tarn,
    // which the 8.8 u relief cannot hold. Clamped: its border is beyond the sculpt's reach, so it reads 0
    // everywhere else.
    const summitBake = preTex.summit ?? bakeSculptPlateData();
    const summitTex = halfFloatTexture(summitBake.data, summitBake.res, THREE.ClampToEdgeWrapping);
    // THE LATTICE'S PREFILTER (2026-10-31): the two height plates the ground's vertices read are
    // mipmapped, so each ring reads the height at its own spacing (see groundMat.positionNode).
    // Every other read of them stays on level 0, explicitly. The image data is untouched (the
    // mips are made on the GPU), so the pinned bake bytes are too.
    [heightTex, summitTex].forEach((t) => {
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.needsUpdate = true;
    });
    // THE TARN'S PLATE (bakeTarnPlateData, carried on the sculpt plate's bake): the tarn's form at
    // ~0.6 u, read at level 0 by the ground and the tarn's water. Clamped: its border is past the
    // bank's reach (weight 0), so it adds nothing outside its box.
    // ...and the north lake's (bakeNorthLakePlateData, 2026-11-21), ~2.3 u, the same layout.
    const drawnWaterTexture = (bake) => {
        const tex = new THREE.DataTexture(bake.data, bake.resX, bake.resZ, THREE.RGBAFormat, THREE.HalfFloatType);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        return tex;
    };
    const tarnTex = drawnWaterTexture(summitBake.tarn ?? bakeTarnPlateData());
    const lakeTex = drawnWaterTexture(summitBake.lake ?? bakeNorthLakePlateData());
    const boxUv = (box) => (xz) => xz.sub(vec2(box[0], box[2])).div(vec2(box[1] - box[0], box[3] - box[2]));
    /** 1 inside the box, 0 outside it. */
    const boxOf = (box) => (xz) => tslStep(float(box[0]), xz.x).mul(tslStep(xz.x, float(box[1])))
        .mul(tslStep(float(box[2]), xz.y))
        .mul(tslStep(xz.y, float(box[3])));
    const tarnPlateUv = boxUv(ODYSSEY_TARN_BOX);
    const lakePlateUv = boxUv(ODYSSEY_NORTH_LAKE_BOX);
    const tarnBoxOf = boxOf(ODYSSEY_TARN_BOX);
    const lakeBoxOf = boxOf(ODYSSEY_NORTH_LAKE_BOX);
    /** The drawn height over a `base` the other plates draw, with a drawn water's plate texel `tp` applied. */
    const withWater = (base, tp, waterY) => base.mul(float(1).sub(tp.g)).add(tp.g.mul(waterY)).add(tp.r);
    const withTarn = (base, tp) => withWater(base, tp, ODYSSEY_TARN.waterY);
    // THE FOREST'S SHADE PLATE (odyssey-forest-shade.js): baked with the scatter in the worker,
    // or after it below when the scatter runs here; zeros (no shade) when there is no forest.
    // MIPMAPPED, unlike the other plates: it is read at every range, a crown's shadow is two
    // texels wide, and the far forest is read as canopy DENSITY, which is what the mips average.
    const forestShadeTex = new THREE.DataTexture(
        pre.scatter?.shade?.data ?? new Uint8Array(FOREST_SHADE_PLATE.res * FOREST_SHADE_PLATE.res * 4),
        FOREST_SHADE_PLATE.res,
        FOREST_SHADE_PLATE.res,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
    );
    forestShadeTex.minFilter = THREE.LinearMipmapLinearFilter;
    forestShadeTex.magFilter = THREE.LinearFilter;
    forestShadeTex.wrapS = THREE.ClampToEdgeWrapping;
    forestShadeTex.wrapT = THREE.ClampToEdgeWrapping;
    forestShadeTex.generateMipmaps = true;
    forestShadeTex.needsUpdate = true;
    // THE FOREST'S PHOTOGRAPHS (odyssey-forest-mesh.js): its leaves, its far views, and the texture every
    // tree's shape is pulled from. They land a moment after the build; until then the forest is folded
    // onto its feet (`uForestOn`) and draws nothing.
    const uForestOn = uniform(0);
    const forestTextures = createForestTextures({ load: forest, onReady: () => { uForestOn.value = 1; } });
    // THE MEADOW (MEADOW; scripts/blender/odyssey/odyssey_meadow.py): the Blender bake of tussocks and
    // flowers, data not colour, mipmapped. It arrives a moment after the world is built: until then
    // three binds a 1x1 placeholder and `uMeadowOn` keeps the ground as it was. No browser (the unit
    // tests build this world in node): no fetch, and the ground stays as it was.
    const groundPhoto = () => {
        const tex = new THREE.Texture();
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        return tex;
    };
    const meadowTex = groundPhoto();
    const uMeadowOn = uniform(0);
    // THE FOREST'S FLOOR (FLOOR): its photograph arrives as the meadow's does, and its plate is baked with the
    // scatter in the worker, as the shade plate is (zeros, no floor, when there is no forest).
    // (Its own texture, never `meadowTex.clone()`: a clone shares its image, and the last photograph to land
    // is then both of them.)
    const floorTex = groundPhoto();
    const uFloorOn = uniform(0);
    const forestFloorTex = new THREE.DataTexture(
        pre.scatter?.floor?.data ?? new Uint8Array(FOREST_FLOOR_PLATE.res * FOREST_FLOOR_PLATE.res * 4),
        FOREST_FLOOR_PLATE.res,
        FOREST_FLOOR_PLATE.res,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
    );
    forestFloorTex.minFilter = THREE.LinearMipmapLinearFilter;
    forestFloorTex.magFilter = THREE.LinearFilter;
    forestFloorTex.generateMipmaps = true;
    forestFloorTex.needsUpdate = true;
    let groundPhotosDisposed = false;
    if (typeof createImageBitmap === 'function' && typeof fetch === 'function' && typeof document !== 'undefined') {
        [[ODYSSEY_MEADOW_URL, meadowTex, uMeadowOn], [ODYSSEY_FLOOR_URL, floorTex, uFloorOn]].forEach(([url, tex, uOn]) => {
            fetch(url)
                .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`${url} ${res.status}`))))
                .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
                .then((bitmap) => {
                    if (groundPhotosDisposed) { bitmap.close?.(); return; }
                    tex.image = bitmap;
                    tex.needsUpdate = true;
                    uOn.value = 1;
                })
                .catch((error) => console.warn('[OdysseyWorld] ground bake not loaded:', error?.message || error));
        });
    }
    // THE MIST PLATE (GROUND_MIST; odyssey-valley-mist.js): R = the hollows' mist top over the
    // sea, G = the pool's depth, both in u, read at `xz / RELIEF_EXTENT + 0.5`.
    const valleyMistPlate = bakeValleyMist(relief.sample, ODYSSEY_SEA_LEVEL);
    const valleyMistTex = (() => {
        const plate = valleyMistPlate;
        const half = new Uint16Array(plate.data.length);
        const one = THREE.DataUtils.toHalfFloat(1);
        for (let t = 0; t < plate.data.length; t += 4) {
            half[t] = THREE.DataUtils.toHalfFloat(plate.data[t] - ODYSSEY_SEA_LEVEL);
            half[t + 1] = THREE.DataUtils.toHalfFloat(plate.data[t + 1]);
            half[t + 3] = one;
        }
        return halfFloatTexture(half, plate.res, THREE.ClampToEdgeWrapping);
    })();
    const t1 = (typeof performance !== 'undefined' ? performance.now() : 0);

    const group = new THREE.Group();
    group.name = 'odyssey-act2-world';

    const ground = buildOdysseyClipmap({
        gridN: q.gridN, levels: q.levels, baseSpacing: q.baseSpacing, holeShrink: q.holeShrink,
    });
    const waterSpacing = (q.baseSpacing * (q.waterLattice ?? q.gridN)) / 32;
    // `waterGeo`, not `water` — the option of that name is the build gate (matches cloudGeo).
    const waterGeo = buildOdysseyClipmap({
        gridN: 32, levels: q.levels, baseSpacing: waterSpacing, holeShrink: 1,
    });

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
    // THE DEEP IS DARK (Act I overhaul, 2026-10-20): the in-scattered light's multiplier by the
    // eye's depth (the depth arc's `dim`), so the column is deep and dim at the vent and the
    // shafts, motes and Snell window are the lights in it. 1 near the surface (the breach).
    const uDeepDim = uniform(1);
    // 1 while the eye is AT the surface (ramping out over 6 u), 0 elsewhere — the meniscus window.
    const uBreachNear = uniform(0);
    // THE CEILING-NET GATE: 1 while the eye is close enough to the surface (66 u) that the caustic
    // net — faded out by 62 u of 3D eye distance — can reach a pixel at all. The CPU knows; the
    // GPU should not run a derivative net on a ceiling where it is provably zero (ch2 mid-column).
    const uCeilNet = uniform(0);
    // VALLEY-MIST GATE: the mist term rides smoothstep(350, 470, eye y), exactly 0 below 350 u (all of
    // ch2-3) — so it only runs above that, as a uniform branch inside applyAerial.
    const uValleyMist = uniform(0);
    // GROUND-MIST GATE (GROUND_MIST): 1 while the eye is in the air and under the height the mist
    // has faded out by, so the sea's depths and the climb out never build it.
    const uGroundMist = uniform(0);
    // THE 1->2 CARRY (see `odysseyQuenchCarry`): bubble behaviour, ring profile, carried tint, the
    // extra rise phase the CPU accumulates (a speed change on a time-scaled fract would make every
    // mote jump), and the presence of ocean life. Neutral values = today's ocean exactly.
    const uQuench = uniform(0);
    const uBubble = uniform(0);
    const uMoteTint = uniform(new THREE.Color(...QUENCH_CYAN));
    const uMoteLift = uniform(0);
    const uLife = uniform(1);
    // THE BUBBLES SHOW THROUGH THE STEAM (Act I overhaul, 2026-10-20): the quench's density
    // squared (the board's steam-fog weight) while the carry runs. The motes then draw after the
    // steam's shell and dim with distance by its fog, so the column of rising bubbles the carry
    // makes is seen in the veil instead of behind it. 0 with no carry.
    const uMoteVeil = uniform(0);
    // THE 2->3 SPRAY: envelope (0 = off) and age in seconds since the eye broke the surface.
    const uSpray = uniform(0);
    const uSprayAge = uniform(0);
    // The three water plates, written each frame from the depth arc (odyssey-ocean-depth.js).
    const uWaterShallow = uniform(new THREE.Color(0.29, 0.54, 0.69));
    const uWaterMid = uniform(new THREE.Color(0.10, 0.29, 0.42));
    const uWaterDeep = uniform(new THREE.Color(0.020, 0.105, 0.165));
    // THE DEPTH ARC (odyssey-ocean-depth.js): the light the surface lets in at the eye's depth
    // (turquoise in the shallows, a dim blue in the abyss) and how much of a well of it the
    // zenith keeps in the dimmed column.
    const uWaterLum = uniform(new THREE.Color(0.10, 0.50, 0.54));
    const uWaterWell = uniform(0);
    // ...the god rays' strength there, how much of the surface's light the water over the eye takes
    // (per u of path), and how much of the world Snell's window shows (odyssey-ocean-window.js).
    const uShaftGain = uniform(1);
    const uCeilAbsorb = uniform(0);
    const uSnellWorld = uniform(0);
    // The window's lift (snellWindowLift, 2026-11-21): written each frame from the level water's light.
    const uWindowLift = uniform(1);
    // The window's sun is the AIR's (the colour script's first air keyframe), not the water's
    // dim steel-blue one: the sun seen through the surface is the sun.
    const WINDOW_SUN = sampleColourScript(0.18).sun;
    const windowHazeScratch = [0, 0, 0];
    // ALIVE ON THE CLOCK (odyssey-ocean-depth.js `oceanClockAt`): the light a passing cloud leaves
    // the column, the surface's state (calm .. choppy; 1 out of the water, so the island's sea is
    // its own), and the wandering plankton bloom (xyz, strength).
    const uSeaLight = uniform(1);
    const uSeaChop = uniform(1);
    const uBloom = uniform(new THREE.Vector4(0, 0, 0, 0));
    const seaClock = createOceanClock();
    const seaClockColumn = { x: -8, z: 3, seaLevel: ODYSSEY_SEA_LEVEL };
    const oceanLook = createOceanLook();
    /** The dawn-gold kiss the crest SSS transmits — kept OUT of the air palette on purpose. */
    const uWaterGlow = uniform(new THREE.Color(0.88, 0.75, 0.50));
    /**
     * THE SWASH — one run-up clock shared by the WATER (whose shoreline vertices rise with it
     * and whose foam front rides it) and the GROUND (whose wet-sand sheen is phase-locked to
     * it), so the waterline and the wet line can never disagree. A skewed cycle — a quick
     * run-up over the first third, a long backwash — because a symmetric sine reads as the sea
     * breathing, not lapping. The phase walks along the shore so the beach laps in a travelling
     * rhythm rather than in unison. Returns the run-up HEIGHT above sea level, world units.
     */
    /**
     * ONE WIND (item 11). The meadow's light sweep, the forest's sway and the canopy's light
     * ripple each ran their own phase, frequency and direction, so a gust brightening the grass
     * never coincided with the trees leaning. One travelling front now drives all three: the
     * grass lightens, the crowns lean and the canopy band ripples TOGETHER as it passes.
     * ~1.4 km wavelength, travelling along +x/+z; per-tree flutter rides on top of it.
     */
    const WIND_K = 0.0045;
    // GUSTS COME IN SPELLS (masterpiece pass, 2026-11-17): the front was one endless even wave
    // train. A slow envelope now travels through it on its own heading (a ~4 km swell of wind
    // every ~50 s), so a few fronts run through the meadow and the forest together and then the
    // air stills; `uGust` is the weather's own windiness on top (odyssey-weather-clock.js).
    const uGust = uniform(1);
    const gustFront = (xz) => sin(uTime.mul(0.6).sub(xz.x.mul(WIND_K * 0.8).add(xz.y.mul(WIND_K * 0.6))))
        .mul(sin(uTime.mul(0.125).sub(xz.x.mul(0.0011).sub(xz.y.mul(0.0009)))).mul(0.42).add(0.58).mul(uGust));
    // CLOUD SHADOWS (see GROUND_CLOUD_SHADOW): strength 0..1 and cover 0..1, CPU-driven.
    const uCloudShadow = uniform(0);
    const uCloudCover = uniform(0.5);
    // THE DAY TURNS + THE HOUR (odyssey-day-turn.js). `uTurn` is the turning shade (front, width,
    // on, depth). The land's sun and the land's share of the hour's look stand at two values, the
    // light ahead of the shade and the light behind it; outside the turn both are the script's
    // live value, so `mix(a, b, turned)` is that value. `uHourSky` is the hour's look for
    // everything the shade does not cross (the dome and the clouds):
    // (warm air, cloud sun, the evening belt, -).
    const uTurn = uniform(new THREE.Vector4(0, ODYSSEY_DAY_TURN.width, 0, 0));
    const uLandSunA = uniform(new THREE.Color(1, 0.95, 0.86));
    const uLandSunB = uniform(new THREE.Color(1, 0.95, 0.86));
    // (shade chroma, snow shade chroma, alpenglow, shade depth)
    const uLandHourA = uniform(new THREE.Vector4(0, 0, 0, 0));
    const uLandHourB = uniform(new THREE.Vector4(0, 0, 0, 0));
    const uHourSky = uniform(new THREE.Vector4(0, 0, 0, 0));
    // The mist low on the land (GROUND_MIST): its density and the most it veils, as multiples of
    // noon's (the hour gathers it, the weather breathes it).
    const uMist = uniform(new THREE.Vector2(1, 1));
    // (Its outline is the detail bake's own: the value noise for the billows, and the cumulus
    // silhouette the cloud shadows are cut from, stretched off its 0.42..0.70 band, for the heads.)
    const dayTurnOf = (xz) => dayTurnField(xz, uTurn, {
        billow: (uvN) => texture(detailTex, uvN).level(0).b,
        scallop: (uvN) => clamp(texture(detailTex, uvN).level(0).a.sub(0.42).mul(3.57), 0, 1),
    });
    const landSunOf = (turn) => mix(uLandSunA, uLandSunB, turn.y);
    const landHourOf = (turn) => mix(uLandHourA, uLandHourB, turn.y);
    // THE ANTISOLAR SKY (odyssey-sky-optics.js): the bow's and the shower veil's strengths.
    const uBow = uniform(0);
    const uShowerVeil = uniform(0);
    /**
     * Direct-light factor under the clouds' shadows at world `xz` (1 = open sun): the sky's own
     * clouds' (odyssey-cloud-shadows.js), one fetch. The weather's cover deepens or lightens them.
     * Plain (inline): it samples a texture, at level 0, so any stage may ask.
     */
    // `turn` (optional): the caller's own `dayTurnOf(xz)`, so the turning shade is read once.
    const skyCloudField = { sdf: null };
    const cloudShadows = createCloudShadows({ field: () => skyCloudField.sdf });
    const cloudShadowLight = (xz, turn = null) => {
        const cloudTaken = cloudShadows.at(xz).mul(mix(float(0.72), float(1.18), uCloudCover));
        // ...and the one great shadow the day turns behind (odyssey-day-turn.js).
        return float(1).sub(clamp(cloudTaken, 0, 1).mul(GROUND_CLOUD_SHADOW.depth).mul(uCloudShadow))
            .mul(float(1).sub((turn || dayTurnOf(xz)).x.mul(uTurn.w)));
    };
    const SWASH_RUN = 0.62;
    const SWASH_BASE = -0.14;
    const swashPhase = (xz) => fract(uTime.mul(0.085).add(xz.x.mul(0.0021)).add(xz.y.mul(0.0013)));
    const swashRise = (xz) => {
        const swashAt = swashPhase(xz);
        return smoothstep(float(0.0), float(0.32), swashAt)
            .mul(float(1).sub(smoothstep(float(0.32), float(1.0), swashAt)))
            .mul(SWASH_RUN)
            .add(SWASH_BASE);
    };
    // The wet line the run-up leaves (twin: swashMemory01): up with the water, back ~3x slower.
    const swashMemory01 = (f) => smoothstep(float(0.0), float(0.32), f)
        .mul(sqrt(sqrt(clamp(float(1).sub(smoothstep(float(0.32), float(1.0), f)), 0, 1))));

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
    /**
     * WARM AIR TOWARD THE SUN (Act II pass, step 4). The sky was one gradient by elevation, the
     * same colour whichever way the eye turned, with a glow round the sun's own disc. Low air seen
     * toward a low sun is lit from behind: the horizon on the sun's side carries a broad warm
     * lift, fading up the dome and round to nothing at right angles to the sun. It is part of
     * the AIR, not a decoration on the dome: the dome, the aerial haze over land and sea, and the
     * clouds' haze all read it through `skyAirAt`, so a distant ridge toward the sun takes the
     * same warm veil as the sky behind it and the horizon keeps one colour at infinity.
     * (`uSunDir` is the constant world sun, so its bearing is folded in JS.)
     */
    // A BAND, NOT A PILLAR: wide in azimuth (cos^1.5, ~70 degrees each side) and low (gone by
    // ~11 degrees up). The first cut was narrow (cos^3) and reached 20 degrees up, and with the
    // sun's own round halo above it the two read as one column of light standing on the sea.
    // Authored warm against the grade, which pulls saturation ~0.72 before the screen.
    const SKY_WARM_AIR = [1.0, 0.70, 0.42];
    const SKY_WARM_AIR_GAIN = 0.16;
    const SKY_SUN_FLAT_LEN = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[2]);
    const skySunFlat = vec2(ODYSSEY_WORLD_SUN[0] / SKY_SUN_FLAT_LEN, ODYSSEY_WORLD_SUN[2] / SKY_SUN_FLAT_LEN);
    /**
     * The air in a view direction (unit vector): the sky's gradient plus its warm side.
     *
     * THE HOUR (odyssey-day-turn.js): late in the day the warm air toward the sun deepens, and the
     * lowest sky all round the horizon takes the evening's rose, deepest OPPOSITE the sun (the belt
     * over the Earth's shadow), which is the sky the act's camera faces. The belt is a MIX toward
     * its own colour and lies under ~12 degrees: the script's horizon colour reaches a third of the
     * way up the dome, and a warm horizon there mixes with the zenith's blue into a grey lilac
     * (captured; the owner judges the sky's colour first). So the script's horizon stays the day's
     * pale blue, the sky above the belt stays clean, and the far land takes the belt as its haze.
     * Both terms are zero at noon.
     *
     * The air is read for every fragment of the world, some of them several times, so the belt is
     * two straight ramps, squared, not smoothsteps (as smoothsteps it was the largest single cost
     * this pass added on the meadow stations), and a caller whose direction can never lie in the
     * belt leaves it out (`belt` false).
     */
    const skyAirAt = (dir, belt = true) => {
        const toSun = dot(normalize(dir.xz.add(vec2(1e-4, 0))), skySunFlat).toVar();
        const side = clamp(toSun, 0, 1);
        const low = float(1).sub(smoothstep(float(-0.06), float(0.19), dir.y));
        const warm = uSunColour.mul(vec3(...SKY_WARM_AIR))
            .mul(side.mul(sqrt(side)).mul(low).mul(float(SKY_WARM_AIR_GAIN).add(uHourSky.x)));
        // Through chapter 5 the evening's two sides are laid over the hour's air
        // (odyssey-evening.js; a uniform branch elsewhere).
        if (!belt) return eveningAir(skyColourFor(dir.y).add(warm), dir, uSunColour);
        const band = clamp(float(1).sub(dir.y.mul(1 / 0.21)), 0, 1)
            .mul(clamp(dir.y.add(0.34).mul(1 / 0.29), 0, 1));
        const beltAmt = band.mul(band).mul(clamp(toSun.negate(), 0, 1).mul(0.6).add(0.4)).mul(uHourSky.z);
        return eveningAir(
            mix(skyColourFor(dir.y), vec3(...ODYSSEY_HOUR_LOOK.antiRoseTint), beltAmt).add(warm),
            dir,
            uSunColour,
        );
    };
    /**
     * THE HORIZON IS THE LIMB (2026-10-26). Climbing, the Earth's horizon sinks under the level
     * (its limb's depression, ORBIT_EARTH_SEAM.limbSin), and the sky's bright horizon has to sink
     * with it: measured from the level, the dome's pale band stood a few degrees over the Earth's
     * limb with a strip of darker sky under it, two horizons. While the Earth is there the sky
     * measures its elevation from the limb (`limbUp`: the limb is 0, the zenith still 1), and the
     * air seen against the surface below takes the sky's colour at the same angle on the far side
     * of the limb (`limbMirror`: pale at the limb, deep blue looking straight down). With no Earth
     * the limb is the level and both are the old elevation.
     */
    const limbUp = (y) => y.add(ORBIT_EARTH_SEAM.limbSin).div(ORBIT_EARTH_SEAM.limbSin.add(1));
    const limbMirror = (y) => max(abs(y).sub(ORBIT_EARTH_SEAM.limbSin), 0)
        .div(float(1).sub(ORBIT_EARTH_SEAM.limbSin));
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
    // The air's scale height above the sea, world units (see THINNER AIR ABOVE in applyAerial).
    const AERIAL_SCALE_HEIGHT = 650;
    // `hazeFloor` (optional node, 0..1): a MINIMUM underwater haze weight, so a surface can be
    // dissolved into the water around it uniform-driven (the fish's 1->2 presence) — no alpha,
    // no blend state, the opaque path unchanged. JS-gated: only the caller that passes it builds it.
    // `perFragmentMedium` (JS flag, the ground only): inside the breach band, decide the medium per
    // fragment instead of by the eye's smoothed uSubmerged — see `subW` in submergedOf.
    // The trailing arguments of a call that takes the ground's mist and nothing else (the sea: its share).
    const MIST_ONLY = [false, null, false, true];
    const MIST_SEA = [false, null, false, GROUND_MIST.sea];
    const applyAerial = (
        lit,
        wp,
        ceil = AERIAL_CEIL_WATER,
        rate = 1,
        valleyMist = false,
        hazeFloor = null,
        perFragmentMedium = false,
        // GROUND_MIST: true (all of it), false, or the share of it this surface takes.
        groundMist = valleyMist,
        // JS flag, the sea only: its own air where it is seen from above (SEA_AIR).
        seaAir = false,
    ) => {
        const to = wp.sub(cameraPosition);
        const d = length(to);
        const toDir = to.div(max(d, float(0.001)));
        const dirY = toDir.y;
        // THINNER AIR ABOVE (all-angles pass, 2026-10-18). The haze was a function of range
        // alone, so from 1-2 km up the ray down to the island hazed as much as a ray skimming the
        // sea, and every view off the climb went milky. Density now falls with height above the
        // sea (an exponential atmosphere, AERIAL_SCALE_HEIGHT) and the ray takes its MEAN: at the
        // shore (eye 15-70 u up) nothing moves; from the climb the island keeps its colour while
        // the horizon band stays. Past ~4.5 km the full density returns, so the far sea still
        // converges on the plate the sky dome converges on (no seam at the far plane).
        const hEye = max(cameraPosition.y.sub(ODYSSEY_SEA_LEVEL), 0).div(AERIAL_SCALE_HEIGHT);
        const hPoint = max(wp.y.sub(ODYSSEY_SEA_LEVEL), 0).div(AERIAL_SCALE_HEIGHT);
        const eEye = exp(hEye.negate());
        const ePoint = exp(hPoint.negate());
        const meanAir = max(
            abs(ePoint.sub(eEye)).div(max(abs(hEye.sub(hPoint)), float(0.01))),
            min(ePoint, eEye),
        );
        // (Past ~4.5 km the full density returns so the far sea meets the dome's plate; while the
        // Earth is there it meets the Earth instead, hazed by this same air, so the true mean holds.)
        const farDense = smoothstep(float(4500), float(8500), d).mul(float(1).sub(ORBIT_EARTH_SEAM.presence));
        const airDepth = d.mul(uAerialK).mul(mix(meanAir, float(1), farDense));
        // Looking down from the climb (while the Earth is there) the air scatters the sky's light at
        // the same angle above the level, as the Earth below is hazed (earthAirFor): the sea under
        // the eye stays blue and the pale haze lies at the horizon.
        // (Mirrored about the Earth's limb, THE HORIZON IS THE LIMB.)
        const mirroredAir = vec3(toDir.x, limbMirror(toDir.y), toDir.z);
        const lookDown = ORBIT_EARTH_SEAM.presence.mul(smoothstep(float(0), float(0.05), dirY.negate()));
        // THE SEA'S OWN AIR FROM ABOVE (SEA_AIR, 2026-11-21): seen from the climb, near and away
        // from the sun, the sea takes the land's haze weight and the dome's colour higher up, not
        // the palest horizon's, so it keeps a value of its own. Plain expressions (no toVar): the
        // mist branch inlines its own copy. The far band, the grazing rays, the sun's side, the
        // shore eyes and the Earth's departure keep today's air.
        const seaOwn = seaAir
            ? float(1).sub(max(max(
                smoothstep(float(SEA_AIR.far[0]), float(SEA_AIR.far[1]), d),
                float(1).sub(smoothstep(float(SEA_AIR.graze[0]), float(SEA_AIR.graze[1]), dirY.negate())),
            ), smoothstep(
                float(SEA_AIR.sunSide[0]),
                float(SEA_AIR.sunSide[1]),
                dot(normalize(toDir.xz.add(vec2(1e-4, 0))), skySunFlat),
            )))
                .mul(smoothstep(
                    float(SEA_AIR.eyeAbove[0]),
                    float(SEA_AIR.eyeAbove[1]),
                    cameraPosition.y.sub(ODYSSEY_SEA_LEVEL),
                ))
                .mul(float(1).sub(ORBIT_EARTH_SEAM.presence))
            : null;
        const airHere = seaOwn ? mix(skyAirAt(toDir), skyColourFor(float(SEA_AIR.up)), seaOwn) : skyAirAt(toDir);
        const airCol = mix(airHere, skyAirAt(mirroredAir), lookDown);
        const airW = seaOwn
            ? clamp(
                float(1).sub(exp(airDepth.negate())).mul(mix(float(rate), float(AERIAL_RATE_LAND), seaOwn)),
                0,
                mix(float(ceil), float(AERIAL_CEIL_LAND), seaOwn),
            )
            : clamp(float(1).sub(exp(airDepth.negate())).mul(float(rate)), 0, ceil);
        const airBase = mix(lit, airCol, airW);
        // VALLEY MIST (item 7) — height haze for LAND seen from the climb. Aerial perspective
        // here is a function of range only, so from 600 u up the forest at the massif's feet
        // and the meadow beside the rail hazed identically and the slopes stacked flat. Mist
        // pools LOW: a fragment near the valley floor takes a pale horizon-white veil that
        // thins with its own height and grows with range, so the massif rises out of a misty
        // floor — the depth layering every reference mountain has. Gated on the EYE being
        // above 350 u, so ch3 (eye 300-360, at the shore) is untouched by construction; JS
        // flag, so water and sky never build the term.
        const valleyMistOf = (base) => mix(
            base,
            mix(uSkyHorizon, vec3(0.96, 0.97, 1.0), float(0.35)),
            float(1).sub(smoothstep(float(ODYSSEY_SEA_LEVEL + 30), float(ODYSSEY_SEA_LEVEL + 300), wp.y))
                .mul(smoothstep(float(260), float(1500), d))
                .mul(smoothstep(float(350), float(470), cameraPosition.y))
                .mul(VALLEY_MIST_GAIN),
        );
        // MIST LYING LOW (GROUND_MIST): the layer's optical depth along the ray (the same mean of
        // an exponential over the ray's heights the air takes, at the layer's own scale height),
        // plus the path through the hollow's pool over this point, broken into slow wisps. The
        // mist lies NEARER than the air beyond it, so its colour is hazed by the same air:
        // mix(base, mix(mist, air, airW), w) is exactly the mist laid under the air.
        const gmStrength = groundMist === true ? 1 : (Number(groundMist) || 0);
        const groundMistOf = (base) => {
            const gmUv = wp.xz.div(float(RELIEF_EXTENT)).add(0.5);
            const gmPlate = texture(valleyMistTex, gmUv).level(0);
            const gmUnder = clamp(gmPlate.r.add(ODYSSEY_SEA_LEVEL).sub(wp.y), float(0), gmPlate.g);
            const gmPoolPath = min(
                gmUnder.div(max(abs(dirY), float(GROUND_MIST.graze))),
                min(d, float(GROUND_MIST.poolPath)),
            );
            const gmHEye = max(cameraPosition.y.sub(ODYSSEY_SEA_LEVEL), 0).div(GROUND_MIST.height);
            const gmHPoint = max(wp.y.sub(ODYSSEY_SEA_LEVEL), 0).div(GROUND_MIST.height);
            const gmEEye = exp(gmHEye.negate());
            const gmEPoint = exp(gmHPoint.negate());
            const gmMean = max(
                abs(gmEPoint.sub(gmEEye)).div(max(abs(gmHEye.sub(gmHPoint)), float(0.01))),
                min(gmEPoint, gmEEye),
            );
            const gmWispN = texture(
                detailTex,
                wp.xz.sub(vec2(...GROUND_MIST.drift).mul(uTime)).mul(GROUND_MIST.wispScale),
            ).b;
            const gmWisp = gmWispN.sub(0.5).mul(2 * GROUND_MIST.wisp).add(1);
            // (`uMist.x`: the mist gathers late in the day and breathes with the weather.)
            const gmTau = d.mul(gmMean).mul(GROUND_MIST.density)
                .add(gmPoolPath.mul(GROUND_MIST.pool))
                .mul(max(gmWisp, float(0)))
                .mul(uMist.x);
            const gmW = float(1).sub(exp(gmTau.negate()))
                .mul(smoothstep(float(GROUND_MIST.near[0]), float(GROUND_MIST.near[1]), d))
                .mul(float(1).sub(smoothstep(
                    float(ODYSSEY_SEA_LEVEL + GROUND_MIST.eyeFade[0]),
                    float(ODYSSEY_SEA_LEVEL + GROUND_MIST.eyeFade[1]),
                    cameraPosition.y,
                )))
                // (`uMist.y`: late in the day it may veil a little more than at noon.)
                .mul(uMist.y.mul(GROUND_MIST.gain).mul(seaOwn
                    ? mix(float(gmStrength), float(SEA_AIR.mistAbove), seaOwn)
                    : float(gmStrength)));
            const gmSun = texture(sunVisTex, gmUv).level(0).r;
            const gmGlow = max(dot(toDir, uSunDir), 0).pow(6).mul(GROUND_MIST.forward);
            const gmCol = mix(
                vec3(...GROUND_MIST.white).mul(uSunColour).mul(GROUND_MIST.bright),
                airCol,
                float(GROUND_MIST.air),
            )
                .mul(mix(float(GROUND_MIST.shade), float(1), clamp(gmSun, 0, 1)))
                .add(uSunColour.mul(gmGlow));
            return mix(base, mix(gmCol, airCol, airW), gmW);
        };
        const submergedOf = (air) => {
            // PER-CHANNEL BEER-LAMBERT, so red dies first and distance reads as WATER rather than
            // as blue fog: one scalar became a vec3 whose red extinguishes ~3.5x faster than blue,
            // the one cue that separates "underwater" from "tinted air". The old 0.97 clamp is gone
            // with it — it pinned everything past ~470 u to 97% of one target, which is why
            // removing the steam veil exposed a frame with 97.5% of its pixels in ONE luma band.
            // 0.995 keeps a floor of the fragment's own colour so the far field converges without
            // ever fully degenerating to the plate.
            const wRGBBase = clamp(float(1).sub(exp(d.mul(vec3(...OCEAN_EXTINCTION).negate()))), 0, 0.995);
            const wRGB = hazeFloor ? max(wRGBBase, vec3(hazeFloor)) : wRGBBase;
            // The up-lift is a DOWNWELLING cone (pow-concentrated overhead), and grazing rays
            // converge to the DEEP plate: from 100+ u down the whole up-hemisphere is the water
            // plane's underside, whose fragments all sit AT the surface (depthBelow = 0), so
            // without a directional term every up-ray converged to the same shallow plate —
            // capture-measured at p=0.130 as 90% of the frame's pixels in ONE luma band. A
            // grazing ray is a long horizontal water column and must darken like one.
            const surfaceGlow = clamp(dirY, 0, 1).pow(2.2).mul(0.55);
            const grazing = clamp(float(1).sub(abs(dirY)), 0.0, 1.0).pow(3);
            // BANDED DEPTH, not one exponential (plan §3.4.1 — a painted film's stacked plates). Depth is
            // shown as discrete hue steps within one temperature family, which is how every
            // adopted reference does it and why none of them need grey scattering. The band index
            // comes from the fragment's own depth below the surface, so the column brightens
            // TOWARD the light instead of away from it — Phase 0 measured the shipped gradient
            // reading darker near the surface than at mid-depth.
            const depthBelow = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(160), 0, 1);
            const bandShallow = mix(uWaterShallow, uWaterMid, smoothstep(float(0.10), float(0.42), depthBelow));
            // The deep end leans INDIGO (item 4): a long water column is violet-dark, not grey-navy.
            const deepIndigo = uWaterDeep;
            const banded = mix(bandShallow, deepIndigo, smoothstep(float(0.45), float(0.92), depthBelow));
            // ...and in the last ~25 u under the surface the long rays converge on LUMINOUS water,
            // not mid-blue: the top metres of a sunlit sea glow. Without it the frame just under the
            // breach sat a 34-luma step below the daylight frame above it (2->3 seam gate).
            const convergePlate = mix(
                mix(uWaterMid, deepIndigo, uEyeDepth),
                // (1.25 -> 0.90, 2026-11-21: the window is the light; the water round it glows less.)
                uWaterLum.mul(0.90),
                float(1).sub(smoothstep(float(0.0), float(0.18), uEyeDepth)).mul(0.8),
            );
            const bandedDir = mix(banded, convergePlate, grazing);
            // ...and the overhead lift leans LUMINOUS TEAL, brightest near the surface: the ceiling
            // the ascent camera stares at for the whole chapter glows instead of sitting mid-blue.
            const glowTarget = mix(
                skyColourSubmergedUp.mul(0.45),
                // Dimmed hard with the eye's depth: the glow is the SURFACE's, so 120 u down it must
                // sit back and let the shafts be the luminous accents (the value hierarchy) rather
                // than wash the whole frame teal — the first capture's read.
                uWaterLum.mul(float(1).sub(uEyeDepth.mul(0.72))),
                0.60,
            );
            // THE WELL OF LIGHT (Act I overhaul, 2026-10-20): in the deep the light that reaches the
            // eye comes DOWN from the surface, so the dimmed column keeps a luminous well at the
            // zenith the climb stares up — the frame is a gradient toward the light, not a flat navy.
            const zen2 = clamp(dirY, 0, 1).mul(clamp(dirY, 0, 1));
            const zen8 = zen2.mul(zen2).mul(zen2.mul(zen2));
            const waterTarget = mix(bandedDir, glowTarget, surfaceGlow).mul(uDeepDim)
                .add(uWaterLum.mul(zen8.mul(uWaterWell).mul(0.42)));
            // Component-wise mix against the same target: the hue WALKS with distance (red gone
            // first, blue last) instead of every channel arriving together. This is what puts
            // value structure back into the frame the steam veil used to supply.
            const litUnder = lit.mul(vec3(0.42, 0.86, 1.0));
            const submergedCol = mix(litUnder, waterTarget, wRGB);
            // THE MEDIUM, PER FRAGMENT, IN THE BREACH BAND (ground only). uSubmerged is the EYE's
            // smoothed blend over a 14 u band, so with the eye 3 u under the surface the seabed —
            // seen through 160 u of water — took only 36 % water haze and showed as sunlit sand with
            // its caustic flecks (the crossing frame's "grid"). Eye and fragment both under the
            // surface: the ray never leaves the water. Both above: it never enters it. Only a ray
            // that crosses the surface keeps the eye's blend. Outside the band this IS uSubmerged.
            const subW = perFragmentMedium
                ? select(
                    cameraPosition.y.lessThan(ODYSSEY_SEA_LEVEL).and(wp.y.lessThan(ODYSSEY_SEA_LEVEL)),
                    float(1),
                    select(
                        cameraPosition.y.greaterThanEqual(ODYSSEY_SEA_LEVEL)
                            .and(wp.y.greaterThanEqual(ODYSSEY_SEA_LEVEL)),
                        float(0),
                        uSubmerged,
                    ),
                )
                : uSubmerged;
            return mix(air, submergedCol, subW);
        };
        // ⚠️ UNIFORM-GATED BRANCHES (seamless pass). Everything below `airBase` used to be built
        // as one expression and multiplied by uSubmerged / the eye-height smoothstep — and a
        // multiply by a zero uniform is NOT dead code on this stack (the water plate's logged
        // lesson). So every ground, tree, lake and water fragment of chapters 3-5 paid the whole
        // underwater column — three exps, two pows, a dozen mixes — to multiply it away, and the
        // ch3 shore paid the valley mist it can never show. Both are uniform conditions, so the
        // If is coherent; the air path is identical, and under water the result is unchanged.
        return Fn(() => {
            const out = airBase.toVar();
            if (valleyMist) {
                If(uValleyMist.greaterThan(0.5), () => { out.assign(valleyMistOf(airBase)); });
            }
            if (gmStrength > 0) {
                If(uGroundMist.greaterThan(0.5), () => { out.assign(groundMistOf(out)); });
            }
            If(uSubmerged.greaterThan(0.001), () => { out.assign(submergedOf(out)); });
            return out;
        })();
    };

    // `continuousMorph` (the ground, 2026-10-31): the morph is measured from the LOD centre
    // itself, not from the ring's snapped origin. Measured from the origin, a vertex's place in
    // its morph band jumped by 2 / halfN (a fifth of the band) each time the origin stepped 2
    // cells, every 25-51 u of travel where the massif is seen, and every step redrew its ridges
    // and faces: Olov, "why does some of the shape of the mountain like change a bit as we move
    // along the path". Measured from the centre, it glides with the eye. It must finish 4 / gridN
    // earlier (continuousMorphEndCeiling, pinned by the clipmap test for the ground's tiers); the
    // water and cloud lattices (gridN 32) have no such margin and keep the snapped morph.
    const clipmapXZ = (spacing0, halfN, continuousMorph = false) => {
        const aGrid = attribute('position', 'vec3');
        const spacing = float(spacing0).mul(exp2(aGrid.y));
        const origin = floor(uLodCenter.div(spacing.mul(2))).mul(spacing.mul(2));
        const gridXZ = vec2(aGrid.x, aGrid.z);
        const local = gridXZ.mul(spacing);
        const fromCentre = continuousMorph ? origin.add(local).sub(uLodCenter) : local;
        const cheb = max(abs(fromCentre.x), abs(fromCentre.y)).div(spacing.mul(float(halfN)));
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
    const g = clipmapXZ(q.baseSpacing, q.gridN / 2, true);
    const reliefUv = g.worldXZ.div(float(RELIEF_EXTENT)).add(0.5);
    const vUv = varying(reliefUv, 'vUv');
    // Macro terrain comes from the BAKE, not from analytic TSL — see bakeMacroTexture. The
    // analytic fold in a shader graph froze the tab for minutes at build time.
    const gMacroTex = texture(macroTex, reliefUv).level(0);
    const gMacro = gMacroTex.r;
    const gWeight = gMacroTex.g;
    const groundMat = new THREE.MeshBasicNodeMaterial();
    const summitUv = g.worldXZ.sub(vec2(ODYSSEY_SCULPT_PLATE.x, ODYSSEY_SCULPT_PLATE.z))
        .div(float(ODYSSEY_SCULPT_PLATE.extent))
        .add(0.5);
    // EACH RING READS THE HEIGHT AT ITS OWN SPACING (2026-10-31). The relief (8.8 u texels) and
    // the summit's sculpt (1.8 u) hold form far finer than the 12.8-51 u rings the massif is seen
    // on, so a coarse vertex caught whichever sliver of a ridge it happened to land on, and the
    // morph between rings swapped those slivers as the rail moved: the summit's faces and ridge
    // lines changed shape on the way (Olov: "why does some of the shape of the mountain like
    // change a bit as we move along the path"). Read at the mip that matches the vertex's spacing
    // (which the morph carries smoothly from one ring's to the next), the geometry holds only the
    // form it can draw, and that form does not change as the rings pass over it. The near rings
    // (spacing under a relief texel) still read level 0; the shading reads level 0 everywhere.
    const gReliefMip = max(log2(g.spacing.div(RELIEF_EXTENT / q.reliefRes)), 0);
    const gSummitMip = max(log2(g.spacing.div(ODYSSEY_SCULPT_PLATE.extent / summitBake.res)), 0);
    const gSculpt = texture(summitTex, summitUv).level(gSummitMip).r;
    // THE DRAWN WATERS' PLATES (the tarn's, the north lake's), at level 0 and exact: in the water
    // the height is the water's own, whatever the other plates draw at this vertex's mip. Outside
    // its box a plate reads its border (no weight), so only the water a vertex is by applies.
    const gTarn = texture(tarnTex, tarnPlateUv(g.worldXZ)).level(0);
    const gLake = texture(lakeTex, lakePlateUv(g.worldXZ)).level(0);
    const gHeight = withWater(
        withTarn(gMacro.add(texture(heightTex, reliefUv).level(gReliefMip).r.mul(gWeight)).add(gSculpt), gTarn),
        gLake,
        ODYSSEY_NORTH_LAKE.waterY,
    );
    // THE TARN'S WATERLINE IS THE WATER'S, NOT THE LATTICE'S (2026-11-20). The tarn's film thins
    // to nothing by its real depth, read per pixel. A triangle that spans the waterline cuts it
    // along its own straight edges, and on the far rings (triangles tens of units wide) those cut
    // the shore in teeth, the ground poking through the film. So each vertex the plate touches is
    // SEATED: one under the water sits at least `sink` under it, one on dry ground at least `dry`
    // over it (TARN_SEAT, a share of the vertex's spacing, so the near rings barely move): an edge
    // that crosses the waterline then crosses it close to its dry end, and the line the eye sees
    // is the film's.
    const gSink = clamp(g.spacing.mul(TARN_SEAT.sink[0]), TARN_SEAT.sink[1], TARN_SEAT.sink[2]);
    const gDry = clamp(g.spacing.mul(TARN_SEAT.dry[0]), TARN_SEAT.dry[1], TARN_SEAT.dry[2]);
    // (Seated against the water whose plate touches the vertex: the boxes lie apart.)
    const gWaterY = mix(float(ODYSSEY_TARN.waterY), float(ODYSSEY_NORTH_LAKE.waterY), tslStep(float(0.001), gLake.g));
    const gTarnSeated = mix(
        max(gHeight, gDry.add(gWaterY)),
        min(gHeight, gSink.negate().add(gWaterY)),
        smoothstep(float(0), float(TARN_SEAT.wetBy), gWaterY.sub(gHeight)),
    );
    groundMat.positionNode = vec3(g.worldXZ.x, mix(gHeight, gTarnSeated, tslStep(float(0.001), gTarn.g.add(gLake.g))), g.worldXZ.y);
    const vSummitUv = varying(summitUv, 'vSuv');
    const vSpacing = varying(g.spacing, 'vS');

    const aux = texture(heightTex, vUv).level(0);
    const summitAux = texture(summitTex, vSummitUv).level(0);
    // THE SURFACE PER FRAGMENT, not per lattice vertex (2026-10-31; see `height` below). The
    // macro's slope and the relief's weight were varyings, interpolated across triangles 12.8-51 u
    // wide where the massif is seen, so its normals — every light and shadow on its faces —
    // changed each time the rings stepped. Read at the fragment's own uv they are the surface's.
    const surfaceMacro = texture(macroTex, vUv).level(0);
    // THE DRAWN WATERS' PLATES at this fragment (the tarn's, the north lake's): read only inside a
    // water's box (a branch, so the rest of the island pays two compares; level 0, as a branch
    // requires), with the plate's own slope from the next texels along x and z. The boxes lie
    // apart, so a fragment reads at most one. Outside both: no water (weight 0, far from a shore).
    const tarnBoxIn = tarnBoxOf(positionWorld.xz).toVar('tarnBoxIn');
    const lakeBoxIn = lakeBoxOf(positionWorld.xz).toVar('lakeBoxIn');
    const drawnIn = tarnBoxIn.add(lakeBoxIn).toVar('drawnIn');
    const fTarn = Fn(() => {
        const o = vec4(0, 0, ODYSSEY_TARN.bank, 0).toVar();
        If(tarnBoxIn.greaterThan(0.5), () => {
            o.assign(texture(tarnTex, tarnPlateUv(positionWorld.xz)).level(0));
        }).ElseIf(lakeBoxIn.greaterThan(0.5), () => {
            o.assign(texture(lakeTex, lakePlateUv(positionWorld.xz)).level(0));
        });
        return o;
    })().toVar('fTarn');
    const plateGrad = (tex, uvOf, texel) => {
        const ax = texture(tex, uvOf(positionWorld.xz.add(vec2(texel[0], 0)))).level(0);
        const az = texture(tex, uvOf(positionWorld.xz.add(vec2(0, texel[1])))).level(0);
        return vec4(
            ax.r.sub(fTarn.r).div(texel[0]),
            az.r.sub(fTarn.r).div(texel[1]),
            ax.g.sub(fTarn.g).div(texel[0]),
            az.g.sub(fTarn.g).div(texel[1]),
        );
    };
    const fTarnGrad = Fn(() => {
        const gr = vec4(0, 0, 0, 0).toVar();
        If(tarnBoxIn.greaterThan(0.5), () => {
            gr.assign(plateGrad(tarnTex, tarnPlateUv, TARN_TEXEL));
        }).ElseIf(lakeBoxIn.greaterThan(0.5), () => {
            gr.assign(plateGrad(lakeTex, lakePlateUv, LAKE_TEXEL));
        });
        return gr;
    })().toVar('fTarnGrad');
    // The water this fragment is by: its level, and its paint's units (DRAWN_PAINT).
    const drawnY = mix(float(ODYSSEY_TARN.waterY), float(ODYSSEY_NORTH_LAKE.waterY), lakeBoxIn).toVar('drawnY');
    const drawnScale = mix(float(DRAWN_PAINT.tarn.scale), float(DRAWN_PAINT.lake.scale), lakeBoxIn).toVar('drawnScale');
    const drawnDepthScale = mix(float(DRAWN_PAINT.tarn.depthScale), float(DRAWN_PAINT.lake.depthScale), lakeBoxIn)
        .toVar('drawnDepthScale');
    // The other plates' height here, and the slope of the drawn height with the water applied:
    // h = base (1 - w) + waterY w + R, so dh = (1 - w) dbase + (waterY - base) dw + dR.
    const groundBaseHeight = surfaceMacro.r.add(aux.r.mul(surfaceMacro.g)).add(summitAux.r).toVar('groundBaseHeight');
    const tarnKeep = float(1).sub(fTarn.g);
    const tarnRise = drawnY.sub(groundBaseHeight);
    const baseNormal = normalize(vec3(
        aux.g.mul(surfaceMacro.g).add(surfaceMacro.b).add(summitAux.g).mul(tarnKeep)
            .add(fTarnGrad.z.mul(tarnRise))
            .add(fTarnGrad.x)
            .negate(),
        1,
        aux.b.mul(surfaceMacro.g).add(surfaceMacro.a).add(summitAux.b).mul(tarnKeep)
            .add(fTarnGrad.w.mul(tarnRise))
            .add(fTarnGrad.y)
            .negate(),
    ));
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
    // The forest's shade on this ground: R the crowns' sun shadow, G their cover, B/A their
    // colour premultiplied by the cover (odyssey-forest-shade.js). Sampled on the root path, with
    // the hardware's own mip choice — no branch above it.
    const forestShade = texture(
        forestShadeTex,
        positionWorld.xz.sub(vec2(FOREST_SHADE_PLATE.x, FOREST_SHADE_PLATE.z)).div(FOREST_SHADE_PLATE.extent).add(0.5),
    );
    const treeSun = float(1).sub(forestShade.r.mul(FOREST_SHADOW_DEPTH));

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
        // ...and the summit's own couloirs (+) and aretes (-) join it (bakeSculptPlateData).
        const curvature = clamp(aux.a.mul(surfaceMacro.g).add(summitAux.a).mul(9.0), -1, 1);
        const gully = max(curvature, 0);
        const crest = max(curvature.negate(), 0);
        const flatness = clamp(baseNormal.y, 0, 1);
        const normal = normalize(baseNormal.add(vec3(bump.x, 0, bump.y).mul(flatness.mul(0.42))));

        // THE SURFACE'S OWN HEIGHT, not the mesh's (2026-10-31). Olov: "why does some of the
        // shape of the mountain like change a bit as we move along the path". Every band that
        // draws the mountain — the snow line, the mantle, the strata, the summit's ledges, the
        // crisp rock — is a function of height, and `positionWorld.y` is the LATTICE's: on the
        // 12.8-51 u rings the massif is seen on, a fragment's height is interpolated between
        // vertices up to tens of units apart, and each step of the rings (the lattice re-centring
        // every 2 cells as the rail moves, its morph bands moving with it) moved it by units, so
        // the bands crawled and jumped across the faces. The height field is sampled here at the
        // fragment's own place (the same three plates the vertex reads, at the varying uv, which
        // is exact: xz is linear across every triangle), so the paint stays on the mountain
        // whatever the lattice does. Measured on a frozen frame with only the rings moved.
        // (...and the tarn's plate, exact: the waterline the paint and the water agree on.)
        const height = withWater(groundBaseHeight, fTarn, drawnY).toVar();
        // Biome follows the LANDFORM; only lighting sees the grain. Driving both from the
        // detailed normal makes grass and rock track the surface noise, which reads as
        // camouflage blotching.
        const slope = clamp(float(1).sub(baseNormal.y), 0, 1);
        const detailGate = float(1).sub(smoothstep(float(1.2), float(9), footprint))
            .mul(float(1).sub(smoothstep(float(2), float(6), vSpacing)));
        // THE LANDFORM GATE (item 6), for the two terms that describe FORM rather than grain:
        // crest rock and gully cavity. Both rode `detailGate`, whose vSpacing half is 0 past the
        // 6.4 u ring — and the massif is only ever seen from 1-2 km, on the 12.8-51 u rings — so
        // the ribs and couloirs that separate a mountain from a smooth cone were switched off on
        // every frame that shows the mountain. Curvature is read PER FRAGMENT from the relief
        // bake, so it does not need fine geometry to be true; footprint alone bounds it.
        const formGate = float(1).sub(smoothstep(float(6), float(48), footprint));

        /**
         * THE ATLAS (Wave 2) — one fetch, four material mesostructures, mean-transparent.
         *
         * `tile / avg` is the Wolfire division The Witness adopted for exactly this problem:
         * the mean of the ratio is 1 by construction, so tiled detail can add texture to the
         * painted colour and can never shift it. Everything below that reads the atlas reads
         * it through that ratio — including the boundary breakup, so even the material borders
         * are drawn by the same field that draws the grain.
         */
        const atlasTop = texture(groundTex, positionWorld.xz.div(float(GROUND_ATLAS_WORLD))).toVar();
        // TRIPLANAR ON THE STEEP FACES (2026-10-25, Act II pass, step 2). Projected from above
        // alone, the atlas streaked down every steep face: the summit's rock and snow read as
        // smeared plaster. Where the ground is steep it is also projected from the two sides,
        // blended by which way the face looks. A branch on the slope (coherent: whole faces), with
        // explicit-level fetches (the atlas has no mips), so the flat island pays nothing.
        const steepness = smoothstep(float(0.45), float(0.8), float(1).sub(baseNormal.y)).toVar();
        const atlas = Fn(() => {
            const a = atlasTop.toVar();
            If(steepness.greaterThan(0.001), () => {
                // Projected on the SURFACE's height, not the lattice's (see `height`): the side
                // projections run up the face, so a lattice that moved a fragment a few units slid
                // the whole face's rock and snow with it as the rings stepped.
                const fromX = texture(groundTex, vec2(positionWorld.z, height).div(float(GROUND_ATLAS_WORLD))).level(0);
                const fromZ = texture(groundTex, vec2(positionWorld.x, height).div(float(GROUND_ATLAS_WORLD))).level(0);
                const wx = abs(baseNormal.x);
                const side = mix(fromZ, fromX, wx.div(max(wx.add(abs(baseNormal.z)), float(1e-4))));
                a.assign(mix(atlasTop, side, steepness));
            });
            return a;
        })().toVar();
        // DISTANCE DISCIPLINE (rule 7). "From far away, the grain melts away and the structure
        // is mostly a solid color, accented by lighting." The melt is a look requirement first;
        // that it also caps the atlas's bandwidth to the near field is the bonus.
        const detailMelt = float(1)
            .sub(smoothstep(float(GROUND_MELT[0]), float(GROUND_MELT[1]), footprint)).toVar();
        // The seabed's sand ripples are a 3.7 u stripe: they need ~4 px a period to read as
        // ripples rather than moire, so they melt far sooner than the general grain (built here,
        // on the root path, because the shore branch below may not take derivatives).
        const bedRippleMelt = float(1).sub(smoothstep(float(0.35), float(1.6), footprint)).toVar();
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
        // A DECIDED BEACH (SEA_BEACH, 2026-11-21 sea audit, item 9): the 13 u cross-fade above
        // ran grass strokes down to the water and put the whole beach half-way to turf. Now pure
        // sand from the water up to a lobed top 2.6-6.7 u over the sea, turf above it, the edge as
        // soft as the pixel's height footprint (root terms only: no derivative in a branch).
        const beachTanSlope = sqrt(max(float(1).sub(baseNormal.y.mul(baseNormal.y)), float(0)))
            .div(max(baseNormal.y, float(0.05)));
        const heightPx = footprint.mul(beachTanSlope).toVar();
        const beachNoise = Fn(() => {
            const o = vec2(0, 1).toVar();
            If(height.greaterThan(ODYSSEY_SEA_LEVEL - 6).and(height.lessThan(ODYSSEY_SEA_LEVEL + 9)), () => {
                o.assign(vec2(
                    noise2(positionWorld.xz.div(float(SEA_BEACH.topCell)).add(vec2(6.1, 2.7))).sub(0.5)
                        .mul(2 * SEA_BEACH.topWobble),
                    noise2(positionWorld.xz.div(float(SEA_BEACH.toneCell)).add(vec2(3.3, 8.1))).sub(0.5)
                        .mul(2 * SEA_BEACH.tone)
                        .add(1),
                ));
            });
            return o;
        })().toVar();
        const beachTop = float(ODYSSEY_SEA_LEVEL + SEA_BEACH.top).add(beachNoise.x)
            .add(edgeBreak.mul(SEA_BEACH.topBreak).mul(detailMelt));
        const beachEdge = clamp(heightPx.mul(1.5), SEA_BEACH.topEdge[0], SEA_BEACH.topEdge[1]);
        const wSandShore = float(1).sub(smoothstep(beachTop.sub(beachEdge), beachTop.add(beachEdge), height));
        /**
         * THE NORTH BEACH (2026-11-02): the bay of `odysseyNorthBeachAt`, in its own frame (`u`
         * along the chord, `s` inland of the waterline). Sand from the water up through the
         * dunes, with tufts of dune grass on the dunes that thicken toward their back, where the
         * meadow takes over. ALU only, and the tufts' noise runs only on the bay's fragments.
         */
        const NB = ODYSSEY_NORTH_BEACH;
        const NBF = ODYSSEY_NORTH_BEACH_FRAME;
        const nbRel = positionWorld.xz.sub(vec2(NBF.mx, NBF.mz));
        const nbUn = dot(nbRel, vec2(NBF.tx, NBF.tz)).div(NBF.halfChord).toVar();
        const nbS = dot(nbRel, vec2(NBF.nx, NBF.nz))
            .sub(float(NB.bite).mul(float(1).sub(nbUn.mul(nbUn)))).toVar();
        // The sand's reach: the whole bay out to sea, the beach and the dunes, gone by their back
        // (the boundary broken by the atlas grain, like every lowland edge).
        const nbBelt = float(1).sub(smoothstep(float(NB.hornIn), float(NB.hornOut), abs(nbUn)))
            .mul(smoothstep(float(-NB.shelfOut), float(-NB.shelf), nbS))
            .mul(float(1).sub(smoothstep(
                float(NB.duneBack - 60),
                float(NB.duneBack + 10),
                nbS.add(edgeBreak.mul(18).mul(detailMelt)),
            )))
            .toVar();
        // 0 on the beach, 1 at the dunes' back: how much of the dune grass stands.
        const nbDune = smoothstep(float(NB.beach - 30), float(NB.duneBack - 30), nbS).toVar();
        const nbTufts = Fn(() => {
            const nbOut = vec2(0, 1).toVar();
            If(nbBelt.greaterThan(0.001), () => {
                const nbXZ = positionWorld.xz;
                const nbClump = noise2(nbXZ.div(float(NORTH_BEACH_PAINT.tuftScales[0])).add(vec2(3.1, 7.7))).mul(0.62)
                    .add(noise2(nbXZ.div(float(NORTH_BEACH_PAINT.tuftScales[1])).add(vec2(9.2, 1.3))).mul(0.38));
                // Grass where the clump field falls under the cover, a painted edge either side.
                const nbCover = nbDune.mul(0.82);
                const nbTuftW = smoothstep(nbCover.add(0.035), nbCover.sub(0.035), nbClump).mul(smoothstep(float(0.02), float(0.12), nbDune));
                // A broad tonal swell along the sand, so the beach is never one flat stripe.
                const nbTone = noise2(nbXZ.div(float(NORTH_BEACH_PAINT.toneScale)).add(vec2(4.4, 2.9))).sub(0.5)
                    .mul(2 * NORTH_BEACH_PAINT.tone).add(1);
                nbOut.assign(vec2(nbTuftW, nbTone));
            });
            return nbOut;
        })().toVar();
        // THE TARN'S SHORE (TARN_SHORE), by the plate's distance to the waterline (+ on land): the
        // sea's height-driven sand is kept out of the tarn's box (soft at its border), and the
        // tarn's own gravel beach runs from under the water out to a reach that wanders.
        const tarnIn = smoothstep(float(ODYSSEY_TARN_BOX[0]), float(ODYSSEY_TARN_BOX[0] + TARN_SHORE.fade), positionWorld.x)
            .mul(smoothstep(float(ODYSSEY_TARN_BOX[1]), float(ODYSSEY_TARN_BOX[1] - TARN_SHORE.fade), positionWorld.x))
            .mul(smoothstep(float(ODYSSEY_TARN_BOX[2]), float(ODYSSEY_TARN_BOX[2] + TARN_SHORE.fade), positionWorld.z))
            .mul(smoothstep(float(ODYSSEY_TARN_BOX[3]), float(ODYSSEY_TARN_BOX[3] - TARN_SHORE.fade), positionWorld.z))
            .toVar();
        // (The distance in the tarn's units: the north lake's divided by its scale, DRAWN_PAINT.)
        const tarnD = fTarn.b.div(drawnScale).toVar();
        const tarnNear = float(1).sub(smoothstep(float(TARN_SHORE.near[0]), float(TARN_SHORE.near[1]), tarnD))
            .mul(drawnIn)
            .toVar();
        // The sea's own beach (SEA_BEACH): not the north beach's bay, not the tarn's or the lake's
        // shore, and the shelf only down to a few units under the water.
        const seaBeachIn = float(1).sub(tarnNear).mul(float(1).sub(nbBelt))
            .mul(smoothstep(float(ODYSSEY_SEA_LEVEL - 6), float(ODYSSEY_SEA_LEVEL - 3), height))
            .toVar();
        // Which stretches of shore are beach (1) and which are turf down to the water (0): one
        // low noise, split short, so a stretch is one or the other.
        const tarnBeachy = Fn(() => {
            const by = float(0).toVar();
            If(tarnNear.greaterThan(0.001), () => {
                by.assign(smoothstep(
                    float(TARN_SHORE.beachSplit[0]),
                    float(TARN_SHORE.beachSplit[1]),
                    noise2(positionWorld.xz.div(drawnScale.mul(TARN_SHORE.beachCell)).add(vec2(8.3, 1.9))),
                ));
            });
            return by;
        })().toVar();
        const tarnBeach = Fn(() => {
            const tb = float(0).toVar();
            If(tarnNear.greaterThan(0.001), () => {
                const reach = mix(float(TARN_SHORE.beach[0]), float(TARN_SHORE.beach[1]), tarnBeachy);
                tb.assign(float(1).sub(smoothstep(
                    reach.sub(TARN_SHORE.beachEdge),
                    reach.add(TARN_SHORE.beachEdge),
                    tarnD.add(edgeBreak.mul(TARN_SHORE.beachBreak)),
                )).mul(tarnNear));
            });
            return tb;
        })().toVar();
        const wSand = max(max(wSandShore.mul(float(1).sub(tarnIn)), nbBelt.mul(float(1).sub(nbTufts.x))), tarnBeach);
        // ALPINE SURFACE LANGUAGE (Ch4 port). The peaks survive suppression as terms in the
        // height field, so the camera stares at them for all of Ch4 — but a generic biome ramp
        // gives them a CLEAN HORIZONTAL snow band, which reads as a contour line on a map rather
        // than a mountain. The old alpine language broke that band with FBM jitter and gated snow by
        // slope; both port directly here, the jitter riding a low-frequency read of the detail
        // texture (one fetch) instead of procedural noise. The band is also tightened 620..790 ->
        // 620..730 now that the jitter, not the ramp width, is what softens the boundary.
        const snowJitterRaw = texture(detailTex, positionWorld.xz.mul(0.0016)).b.toVar();
        /**
         * THE MASSIF'S SNOW AND ROCK, READ OFF ITS FORM (2026-11-25; docs/ODYSSEY_MOUNTAIN_2026-11.md).
         *
         * The hero is a grown landform now (odyssey-massif-form.js): ridges, couloirs the rain cut,
         * cliff bands at its hard beds. Its snow and rock follow that FORM, and nothing on it is
         * drawn by height alone. (The audit's layer cake was three height bands laid on a smooth
         * cone: a rock step every 22 u in the old sculpt, a snow line every 7.5 u, a stratum every
         * 24 u; and the snow's tongues were two sines of azimuth, its flutes a tilt of the light.)
         * On the massif snow lies
         *   - lower in the couloirs (`gully`: the plate's curvature plus the rain's own flow) and
         *     higher on the ribs (`crest`), so it runs down the gullies in tongues;
         *   - less on the faces the low western sun works (`sunward`), more in their lee;
         *   - not on the cliffs (the slope gate), and with its edge broken at ~40 u (`snowBreak`),
         *     never in single pixels.
         */
        const heroMassif = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        const heroRel = positionWorld.xz.sub(vec2(heroMassif.x, heroMassif.z));
        const heroR = length(heroRel);
        const heroW = float(1).sub(smoothstep(
            float(heroMassif.radius * 0.55),
            float(heroMassif.radius * 0.95),
            heroR,
        )).toVar();
        // The hero's whole cone, wider than `heroW` (which ramps out from 0.55 of the radius).
        const heroCrestW = float(1).sub(smoothstep(
            float(heroMassif.radius * 0.80),
            float(heroMassif.radius * 1.05),
            heroR,
        )).toVar();
        const litNormal = normal.toVar();
        // Which way a slope faces the sun's bearing: +1 square to it, -1 in its lee; 0 on the flat.
        const faceFlat = baseNormal.xz;
        const sunward = dot(faceFlat.div(max(length(faceFlat), float(1e-4))), vec2(...SEA_SUN_FLAT))
            .mul(smoothstep(float(0.06), float(0.25), slope))
            .toVar();
        // The snow edge's own break-up: the jitter's noise at ~40 u, so a snowfield's outline is
        // lobes and tongues tens of units across (the audit's M14: a 1-3 px stipple at every edge).
        const snowBreak = texture(detailTex, positionWorld.xz.mul(MASSIF_SNOW.breakScale)).b.sub(0.5).toVar();
        // The jitter halves on the hero (its form owns the structure), not elsewhere.
        const snowJitter = snowJitterRaw.sub(0.5).mul(mix(float(92), float(46), heroW));
        // THE SUMMIT MANTLE: high on the hero the snow is a mantle, not a stipple; the ribs strip less.
        const mantle = heroCrestW
            .mul(smoothstep(float(MASSIF_SNOW.mantle[0]), float(MASSIF_SNOW.mantle[1]), height))
            .toVar();
        const snowHeight = height.add(snowJitter).add(edgeBreak.mul(mix(float(9), float(2), heroW)))
            .add(gully.mul(mix(float(70), float(MASSIF_SNOW.couloir), heroW)))
            .sub(crest.mul(float(MASSIF_SNOW.rib).mul(heroW)))
            .sub(sunward.mul(float(MASSIF_SNOW.sunward).mul(heroW)))
            .add(snowBreak.mul(float(MASSIF_SNOW.breakReach).mul(heroW)))
            .toVar();
        // The altitude the ROCK term reads.
        const alpineHeight = height.add(snowJitter).add(edgeBreak.mul(9)).toVar();
        // Snow holds the steep faces up to a cliff (on the hero a steeper one: alpine faces carry
        // snow on every bench), and convex ground strips its own (wind scours the ribs).
        const snowSlopeGate = mix(float(0.62), float(MASSIF_SNOW.cliff[0]), heroW);
        const wSnow = smoothstep(float(620), float(730), snowHeight)
            .mul(float(1).sub(smoothstep(
                snowSlopeGate,
                snowSlopeGate.add(mix(float(0.14), float(MASSIF_SNOW.cliff[1] - MASSIF_SNOW.cliff[0]), heroW)),
                slope,
            )))
            .mul(float(1).sub(smoothstep(
                float(0.18),
                float(0.40),
                crest.mul(float(GROUND_SNOW_CREST_STRIP).mul(float(1).sub(mantle.mul(0.45)))),
            )));
        // The SLOPE half takes the same patch rule as the altitude half below: on the massif's
        // mid flanks (slope 0.2-0.35, the whole ch4 view) a 0.17..0.40 ramp made every fragment
        // part stone, part grass — the khaki. Off the massif the ramp is kept as it was.
        const slopeRockRamp = smoothstep(float(0.17), float(0.40), slope.add(edgeBreak.mul(0.035)));
        // The patches' edges: the pixel grain off the massif; on it, the snow's own ~40 u break-up and
        // the form's gullies (scree runs down them), so a patch is a shape and not a field of flecks
        // (the audit's M10: an even leopard pattern of 6-15 px spots over every rock patch).
        const patchBreak = mix(edgeBreak.mul(0.25), snowBreak.mul(0.55).sub(gully.mul(0.18)), heroCrestW).toVar();
        const slopeRockPatch = smoothstep(
            snowJitterRaw.mul(0.55).add(patchBreak).add(0.18),
            snowJitterRaw.mul(0.55).add(patchBreak).add(0.30),
            smoothstep(float(0.13), float(0.42), slope),
        );
        const wRock = clamp(max(
            mix(slopeRockRamp, slopeRockPatch, smoothstep(float(380), float(440), height)),
            // ...reaching FULL rock above the treeline, in PATCHES rather than a ramp: the altitude
            // sets a probability and a patch field decides each fragment (green alpine meadow islands
            // in grey scree, thinning with height), so every pixel lands on a real material.
            smoothstep(
                snowJitterRaw.mul(0.62).add(patchBreak).add(0.12),
                snowJitterRaw.mul(0.62).add(patchBreak).add(0.26),
                smoothstep(float(440), float(700), alpineHeight),
            ),
        ).add(crest.mul(uRidgeRock).mul(formGate)), 0, 1);

        /**
         * The four weights, made EXPLICIT (snow over rock over sand over grass), addressable, so the
         * paint, the mesostructure and the shadow models all read the same numbers.
         */
        // CRISP SNOW: high up, snow is a DECISION, thresholded at 0.5 over an edge about a pixel wide
        // (fwidth, clamped), so the summit is snowfields and rock with drawn boundaries. On the hero
        // the per-pixel atlas grain barely touches the cover (the edge breaks at `snowBreak`'s scale).
        const snowCover = wSnow
            .add(edgeBreak.mul(SNOW_CRISP.breakup).mul(detailMelt).mul(mix(float(1), float(0.3), heroW)))
            .toVar();
        const snowEdge = clamp(fwidth(snowCover).mul(1.2), SNOW_CRISP.edge[0], SNOW_CRISP.edge[1]);
        const snowCrisp = smoothstep(float(0.5).sub(snowEdge), float(0.5).add(snowEdge), snowCover);
        const kSnow = mix(
            wSnow,
            snowCrisp,
            smoothstep(float(SNOW_CRISP.from[0]), float(SNOW_CRISP.from[1]), height),
        ).toVar();
        // CRISP ROCK: the same cure for the flanks, above the shore lowlands: a meadow or a scree
        // patch, the boundary broken (on the hero, by the snow's own break-up, not the pixel grain).
        const rockBreak = mix(
            edgeBreak.mul(SNOW_CRISP.breakup * 1.2).mul(detailMelt),
            snowBreak.mul(0.35),
            heroW,
        );
        const rockCover = wRock.add(rockBreak).toVar();
        const rockEdge = clamp(fwidth(rockCover).mul(1.2), SNOW_CRISP.edge[0], SNOW_CRISP.edge[1]);
        const rockCrisp = smoothstep(float(0.5).sub(rockEdge), float(0.5).add(rockEdge), rockCover);
        const wRockCrisp = mix(
            wRock,
            rockCrisp,
            smoothstep(float(ROCK_CRISP_FROM[0]), float(ROCK_CRISP_FROM[1]), height),
        );
        // The summit's rock takes more of the sky (see `rockAmbient`): above ~600 u.
        const summitGate = smoothstep(float(SUMMIT_ROCK.from[0]), float(SUMMIT_ROCK.from[1]), height).toVar();
        const kRock = wRockCrisp.mul(float(1).sub(kSnow)).toVar();
        const kSand = wSand.mul(float(1).sub(wRockCrisp)).mul(float(1).sub(kSnow)).toVar();
        const kGrass = clamp(float(1).sub(kSnow).sub(kRock).sub(kSand), 0, 1).toVar();
        // THE WET SAND (SEA_WET, 2026-11-21): x the sand the sea keeps damp (up to a wandering top
        // ~1.6 u over the water), y the thin film the backwash leaves (on the run-up's memory: it
        // recedes ~3x slower than the water), z the depth of the live water over it.
        const wetField = Fn(() => {
            const o = vec3(0).toVar();
            If(height.lessThan(ODYSSEY_SEA_LEVEL + 3.0).and(seaBeachIn.greaterThan(0.001)), () => {
                const f = swashPhase(positionWorld.xz).toVar();
                const live = float(ODYSSEY_SEA_LEVEL + SWASH_BASE).add(smoothstep(float(0.0), float(0.32), f)
                    .mul(float(1).sub(smoothstep(float(0.32), float(1.0), f))).mul(SWASH_RUN));
                const mem01 = swashMemory01(f).toVar();
                const memY = float(ODYSSEY_SEA_LEVEL + SWASH_BASE).add(mem01.mul(SWASH_RUN));
                const rag = noise2(positionWorld.xz.div(float(SEA_WET.cells[0])).add(vec2(2.3, 9.1))).sub(0.5).mul(1.2)
                    .add(noise2(positionWorld.xz.div(float(SEA_WET.cells[1])).add(vec2(7.7, 0.4))).sub(0.5).mul(0.8));
                const top = float(ODYSSEY_SEA_LEVEL + SEA_WET.top).add(rag.mul(SEA_WET.wobble)).add(mem01.mul(SEA_WET.breathe));
                const e = clamp(heightPx.mul(0.9), SEA_WET.edge[0], SEA_WET.edge[1]);
                const damp = float(1).sub(smoothstep(top.sub(e), top.add(e), height));
                const film = float(1).sub(smoothstep(memY.sub(0.08), memY.add(0.10), height));
                const under = clamp(live.sub(height), 0, 3);
                o.assign(vec3(damp.mul(kSand).mul(seaBeachIn), film.mul(kSand).mul(seaBeachIn), under.mul(seaBeachIn)));
            });
            return o;
        })().toVar('wetField');

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
        // On the north beach only a thin strip at the water is wet; the rest is dry, pale sand.
        const nbDry = nbBelt.mul(smoothstep(float(-8), float(8), nbS)).toVar();
        // By the tarn the turf is damp and green (TARN_SHORE.lush): the water's own margin.
        const tarnLush = drawnIn.mul(float(1).sub(smoothstep(float(TARN_SHORE.lush[0]), float(TARN_SHORE.lush[1]), tarnD)));
        const moist = mix(
            clamp(max(max(plate.b, wetBand.mul(0.94)), tarnLush.mul(0.96)), 0, 1),
            smoothstep(float(ODYSSEY_SEA_LEVEL + 1.6), float(ODYSSEY_SEA_LEVEL + 0.2), height).mul(0.94),
            nbDry,
        ).toVar();
        // SHAPED, not linear. A linear read put the whole shoreline plain on the golden pole,
        // because the midpoint of a two-pole lerp is already half-way to gold and the midpoint
        // is where most of the island sits. Ref1's lawn is GREEN with golden patches — so green
        // is the default and gold arrives only where the field says the ground is truly dry.
        // ...and ALPINE meadows stay green (seamless pass): the dry pole is lowland gold, and on
        // the massif's flanks it painted the khaki sheet; from the massif's foot (~370 u) up,
        // most of the dryness is withdrawn, so the patches between the scree read as pasture.
        const dryness = smoothstep(
            float(ODYSSEY_GROUND_DRYNESS[0]),
            float(ODYSSEY_GROUND_DRYNESS[1]),
            moist,
        ).mul(float(1).sub(smoothstep(float(368), float(520), height).mul(0.72))).toVar();
        const poles = (mat) => mix(
            vec3(...ODYSSEY_GROUND_PALETTE[mat].damp),
            vec3(...ODYSSEY_GROUND_PALETTE[mat].dry),
            dryness.mul(float(ODYSSEY_GROUND_MOISTURE[mat])),
        );
        /**
         * THE PLAIN'S MEADOWS (see PLAIN_MEADOWS): three greens in painted patches over the
         * plain behind the massif. Two noise fields (the second for the olive), thresholded with
         * a narrow soft edge; only the plain's fragments pay for them.
         */
        const plainW = smoothstep(float(PLAIN_MEADOWS.from[0]), float(PLAIN_MEADOWS.from[1]), positionWorld.z)
            .mul(float(1).sub(nbBelt)).toVar();
        const meadowTint = Fn(() => {
            const mTint = vec3(1, 1, 1).toVar();
            If(plainW.greaterThan(0.001), () => {
                const mXZ = positionWorld.xz;
                const mWarp = noise2(mXZ.div(float(PLAIN_MEADOWS.cell * 2.7)).add(vec2(1.7, 6.1))).sub(0.5).mul(0.9);
                const mField = noise2(mXZ.div(float(PLAIN_MEADOWS.cell)).add(vec2(mWarp, mWarp.negate())).add(vec2(13.3, 2.2)));
                const mOliveField = noise2(mXZ.div(float(PLAIN_MEADOWS.cellOlive)).add(vec2(mWarp.negate(), mWarp)).add(vec2(5.9, 17.4)));
                const mEdge = float(PLAIN_MEADOWS.edge);
                const mDeep = smoothstep(float(0.40).add(mEdge), float(0.40).sub(mEdge), mField);
                const mFresh = smoothstep(float(0.60).sub(mEdge), float(0.60).add(mEdge), mField);
                const mOlive = smoothstep(float(0.70).sub(mEdge), float(0.70).add(mEdge), mOliveField);
                const mTintA = mix(vec3(1, 1, 1), vec3(...PLAIN_MEADOWS.deep), mDeep);
                const mTintB = mix(mTintA, vec3(...PLAIN_MEADOWS.fresh), mFresh);
                mTint.assign(mix(vec3(1, 1, 1), mix(mTintB, vec3(...PLAIN_MEADOWS.olive), mOlive), plainW));
            });
            return mTint;
        })();
        // The north beach: dune grass in the tufts, and paler sand with a broad tonal swell.
        // THE DAY'S TURN at this point of the land (odyssey-day-turn.js), read once: how deep it
        // stands in the turning shade, and whether its light is already the afternoon's.
        const gTurn = dayTurnOf(positionWorld.xz).toVar();
        const grassPole = mix(poles('grass').mul(meadowTint), vec3(...NORTH_BEACH_PAINT.grass), nbBelt.mul(nbDune));
        // The sea's beach is pale dry sand (SEA_BEACH.dry) with a broad tonal swell, eased back
        // toward the palette's sand from afar so the coast seen from the climb has no pale outline.
        const beachSand = mix(
            vec3(...SEA_BEACH.dry).mul(beachNoise.y),
            vec3(...ODYSSEY_GROUND_PALETTE.sand.dry),
            smoothstep(float(6), float(24), footprint).mul(SEA_BEACH.farKeep),
        );
        const sandPole = mix(
            mix(
                mix(
                    poles('sand'),
                    vec3(...NORTH_BEACH_PAINT.pale).mul(mix(float(1), float(0.86), dryness.oneMinus())),
                    nbBelt.mul(NORTH_BEACH_PAINT.paleMix),
                ).mul(mix(float(1), nbTufts.y, nbBelt)),
                beachSand,
                seaBeachIn,
            ),
            // By the tarn the "sand" is its gravel (TARN_SHORE.gravel).
            vec3(...TARN_SHORE.gravel),
            tarnNear,
        );
        let albedo = grassPole.mul(kGrass)
            .add(sandPole.mul(kSand))
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
        // Under the sea the sand's straight stripes give way to the seabed's own ripple field (the
        // shore branch below), which melts before it can moire; this grain only keeps the beach.
        const sandTooth = mix(
            atlas.b.div(float(atlasAvg[2])),
            float(1),
            smoothstep(float(ODYSSEY_SEA_LEVEL - 4), float(ODYSSEY_SEA_LEVEL - 30), height),
        );
        const toothMat = atlas.r.div(float(atlasAvg[0])).mul(kGrass)
            .add(atlas.g.div(float(atlasAvg[1])).mul(kRock))
            .add(sandTooth.mul(kSand))
            .add(tooth.mul(kSnow));
        const toothAmt = float(GROUND_TOOTH.grass).mul(kGrass)
            .add(float(GROUND_TOOTH.rock).mul(kRock))
            .add(mix(float(GROUND_TOOTH.sand), float(SEA_BEACH.tooth), seaBeachIn)
                .mul(float(1).sub(wetField.x.mul(1 - SEA_WET.toothKeep))).mul(kSand))
            .add(float(GROUND_TOOTH.snow).mul(kSnow));
        albedo = albedo.mul(mix(float(1), toothMat, detailMelt.mul(toothAmt)));

        /**
         * THE CONTACT BAND. A background painter paints a darker, WARMER lip where grass meets a path or a
         * beach — grass roots darken at contacts, and the edge is a painted occlusion band
         * rather than a gradient. The product of two weights peaks exactly at the boundary and
         * is zero in both interiors, so this needs no mask of its own.
         */
        const contact = clamp(kGrass.mul(kSand.add(kRock)).mul(4), 0, 1);
        albedo = albedo.mul(mix(vec3(1), vec3(...GROUND_EDGE_TINT), contact.mul(GROUND_EDGE_AMT).mul(detailGate)));

        /**
         * THE SWASH-WET STRIP. Sand the run-up reaches is darker and cooler than the dry beach
         * above it (ref3's waterline sand measures 0.7x the hill), and the strip just above the
         * LIVE waterline glistens — the sheen the backwash leaves — riding the same `swashRise`
         * clock the water's shoreline vertices and foam front ride, so the wet line and the
         * water edge cannot drift apart. Sand only, and only within a metre of the sea, so it
         * can never read as a fog band across the island.
         */
        //
        // ⚠️ SHORE-ONLY, PER FRAGMENT (seamless pass — Lane A ch4 0.92 -> 1.05 ms at the same 53
        // draws). This strip, the seabed tint below it and the caustic web further down (one
        // texture fetch) are all EXACTLY zero above sea level + ~1.1 u, yet every ground fragment
        // of the island and the massif paid for them: a swash clock, eight smoothsteps, the fetch.
        // A branch on the fragment's own height skips them for everything inland — divergence is
        // only along the coastline, where both sides are cheap — and inside it nothing takes a
        // derivative and the one fetch pins its LOD (.level(0); the tile has no mips, so it is the
        // same texel), which is what WGSL requires of non-uniform control flow. Every shared node
        // they read (kSand, atlas, normal, sunVis) is built earlier on the root path.
        /**
         * THE FAR FOREST (Act II pass, step 3). Every tree sinks out of the draw across
         * FOREST_DRAW_NEAR..FAR, and what it left was the grass it stood on: from the climb the
         * forest stopped in a line and the land beyond it was a bare green plain. The shade plate's
         * cover, read through its mips as canopy density, paints the canopy back across the same
         * band in the crowns' own mean colour (B/A over G, blue from green as the roster's crowns
         * hold it), so the trees hand over to their own painted mass. Lit like the ground, so the
         * baked shadows above give it the dark texture of a canopy seen from afar.
         */
        const farForest = forestShade.g.mul(smoothstep(
            float(FOREST_DRAW_NEAR - 120),
            float(FOREST_DRAW_FAR),
            length(positionWorld.xz.sub(uLodCenter)),
        ));
        const canopyMean = vec3(forestShade.b, forestShade.a, forestShade.a.mul(0.42))
            .div(max(forestShade.g, 0.02))
            .mul(FOREST_SHADE_PLATE.colourScale * FOREST_FAR_TONE);
        albedo = mix(albedo, canopyMean, clamp(farForest.mul(1.6), 0, 1));

        // THE WET SAND'S ALBEDO (SEA_WET): darker where the sea keeps it damp, a little more under
        // the backwash's film, and the first units of water over it taking red first (from above;
        // under water the haze owns it). Replaces the old 1 u matte strip.
        const albedoBeforeWet = albedo;
        albedo = Fn(() => {
            const a = albedoBeforeWet.toVar();
            If(wetField.x.add(wetField.z).greaterThan(0.001), () => {
                a.assign(a
                    .mul(mix(vec3(1), vec3(...SEA_WET.dark), wetField.x))
                    .mul(mix(float(1), float(SEA_WET.filmDark), wetField.y))
                    .mul(mix(
                        vec3(1),
                        exp(vec3(...SEA_WET.absorb).negate().mul(min(wetField.z, float(2)))),
                        float(1).sub(smoothstep(float(2), float(3), wetField.z)).mul(float(1).sub(uSubmerged)),
                    )));
            });
            return a;
        })();
        const SHORE_TOP = ODYSSEY_SEA_LEVEL + 1.2;
        const albedoInland = albedo;
        albedo = Fn(() => {
            const a = albedoInland.toVar();
            If(height.lessThan(SHORE_TOP), () => {
                // THE SEABED (item 4). Everything under the shelf is weighted "sand", so the ocean
                // floor wore the BEACH palette — warm khaki under a blue column, which the water's
                // red-first extinction turned into grey murk. Below a few metres it leans to a cool
                // green-grey bed with the sand atlas's own grain doubled into speckle
                // (mean-preserving, like the tooth).
                const seabed = smoothstep(float(ODYSSEY_SEA_LEVEL - 4), float(ODYSSEY_SEA_LEVEL - 30), height)
                    .mul(kSand)
                    // The north beach's shelf stays sand under the shallows (they read light).
                    .mul(float(1).sub(nbBelt.mul(NORTH_BEACH_PAINT.bedKeep)
                        .mul(smoothstep(float(ODYSSEY_SEA_LEVEL - 34), float(ODYSSEY_SEA_LEVEL - 14), height))));
                /**
                 * A FIELD, NOT A CARPET (Odyssey audit 2026-10-18). The bed read the atlas's sand
                 * channel straight — parallel crests every 3.7 u, repeating every 22 u tile — at
                 * +-40 % with no distance melt: from the rail it was knitted carpet behind every
                 * chapter-2 orb, and at grazing angles a moire. Now the crests bend through a slow
                 * domain warp and turn ~60 degrees in the patches where another current ran,
                 * melt by the footprint before they can alias, and the bed breaks into sea-grass
                 * meadows and pale sand fans a few tens of metres across. Two `noise2` calls and
                 * two pinned fetches, on seabed fragments only.
                 */
                const bedXZ = positionWorld.xz;
                const bendX = noise2(bedXZ.div(float(26)).add(vec2(5.1, 1.7))).sub(0.5);
                const bendZ = noise2(bedXZ.div(float(26)).add(vec2(9.7, 3.3))).sub(0.5);
                const crestUv = bedXZ.div(float(GROUND_ATLAS_WORLD)).add(vec2(bendX, bendZ).mul(0.4));
                const crestA = texture(groundTex, crestUv).level(0).b;
                const crestUvB = vec2(
                    crestUv.x.mul(0.5).sub(crestUv.y.mul(0.866)),
                    crestUv.x.mul(0.866).add(crestUv.y.mul(0.5)),
                ).mul(1.35);
                const crestB = texture(groundTex, crestUvB).level(0).b;
                // + a broad 110 u swell of light and dark ground (all-angles pass, 2026-10-18):
                // the orb close-ups look DOWN at a few hundred metres of bed, and with only the
                // 13-38 u patches it still read as one even carpet.
                const broad = noise2(bedXZ.div(float(110)).add(vec2(2.3, 8.9)));
                const patch = noise2(bedXZ.div(float(38))).mul(0.5)
                    .add(noise2(bedXZ.div(float(13)).add(vec2(17.3, 4.1))).mul(0.25))
                    .add(broad.mul(0.25))
                    .toVar();
                const bedCrest = mix(crestA, crestB, smoothstep(float(0.42), float(0.58), patch))
                    .div(float(atlasAvg[2]));
                const meadow = smoothstep(float(0.58), float(0.72), patch);
                const fan = smoothstep(float(0.40), float(0.26), patch);
                // Ripples belong to the sand: half strength on the plain bed, near none in the grass.
                const bedRipple = mix(float(1), bedCrest, bedRippleMelt.mul(mix(float(0.15), float(0.03), meadow)));
                const bedColor = mix(
                    mix(vec3(0.20, 0.31, 0.28), vec3(0.09, 0.21, 0.13), meadow.mul(0.9)),
                    vec3(0.36, 0.42, 0.36),
                    fan.mul(0.6),
                ).mul(mix(float(0.82), float(1.14), broad));
                a.assign(mix(a, bedColor.mul(bedRipple), seabed.mul(0.75)));
            });
            return a;
        })();

        // THE TARN'S BED AND ITS WET MARGIN (TARN_BED). Just above the waterline the gravel and
        // turf are wet; under the water the ground is the tarn's bed (gravel on the shelf, silt and
        // weed in the basins) seen through the water's colour by its depth. Only the fragments by
        // the water pay for it.
        const albedoDry = albedo;
        albedo = Fn(() => {
            const a = albedoDry.toVar();
            If(tarnD.lessThan(TARN_BED.wetAbove).and(drawnIn.greaterThan(0.5)), () => {
                const tarnDepth = drawnY.sub(height).toVar();
                // (Depth in the tarn's units for the bed's bands; the water's own colour by the real depth.)
                const depthN = tarnDepth.div(drawnDepthScale).toVar();
                const wet = float(1).sub(smoothstep(float(-0.05), float(TARN_BED.wetAbove), tarnD));
                a.assign(a.mul(mix(float(1), float(TARN_BED.wetTone), wet)));
                If(tarnDepth.greaterThan(0), () => {
                    const bx = positionWorld.xz;
                    const mott = noise2(bx.div(drawnScale.mul(TARN_BED.cells[0])).add(vec2(3.7, 9.1))).mul(0.6)
                        .add(noise2(bx.div(drawnScale.mul(TARN_BED.cells[1])).add(vec2(1.3, 5.5))).mul(0.4))
                        .toVar();
                    const weed = smoothstep(float(0.56), float(0.70), mott).mul(smoothstep(float(0.4), float(1.6), depthN));
                    // The shelf's bed: gravel off a beach, the bank's dark peat and moss where the
                    // turf comes down to the water; silt in the basins.
                    // (The lake's shallows are mostly gravel, `shelfGravel`: its turquoise is the shelf.)
                    const shelfStone = mix(vec3(...TARN_BED.gravel), vec3(...DRAWN_PAINT.lake.sand), lakeBoxIn);
                    const shelfBed = mix(vec3(...TARN_BED.peat), shelfStone, max(tarnBeachy, lakeBoxIn.mul(DRAWN_PAINT.lake.shelfGravel)));
                    const bedGround = mix(shelfBed, vec3(...TARN_BED.silt), smoothstep(float(0.5), float(2.2), depthN))
                        .mul(mott.sub(0.5).mul(0.5).add(1));
                    const bed = mix(bedGround, vec3(...TARN_BED.weed), weed.mul(0.8));
                    const absorb = mix(vec3(...DRAWN_PAINT.tarn.absorb), vec3(...DRAWN_PAINT.lake.absorb), lakeBoxIn);
                    const column = exp(absorb.mul(tarnDepth.negate()));
                    a.assign(mix(a, bed, smoothstep(float(0), float(0.12), depthN)).mul(column));
                });
            });
            return a;
        })();

        /**
         * THE MEADOW (MEADOW): the Blender turf over the grass, its tones, its flower drifts and the
         * wind's bands through it. Sampled on the root path (the hardware's own mip, no branch).
         */
        const gust = gustFront(positionWorld.xz);
        const meadowXZ = positionWorld.xz;
        const meadowTexel = texture(meadowTex, meadowXZ.div(float(MEADOW.tile))).toVar();
        // The forest's floor (FLOOR): where it lies, the meadow does not.
        const floorPlate = texture(
            forestFloorTex,
            meadowXZ.sub(vec2(FOREST_FLOOR_PLATE.x, FOREST_FLOOR_PLATE.z)).div(FOREST_FLOOR_PLATE.extent).add(0.5),
        ).toVar();
        const floorTexel = texture(floorTex, meadowXZ.div(float(FLOOR.tile))).toVar();
        // (x how much of it lies here, y how deep into the wood, z the sun's flecks: skipped where no wood is near.)
        const floorField = Fn(() => {
            const field = vec3(0, 0, 0).toVar();
            const floorNear = float(1).sub(smoothstep(float(FLOOR.fleckMelt[0]), float(FLOOR.fleckMelt[1]), footprint)).toVar();
            If(floorPlate.r.greaterThan(0.01), () => {
                const floorIn = floorPlate.r
                    .add(noise2(meadowXZ.div(float(FLOOR.raggedCell)).add(vec2(9.4, 31.7))).sub(0.5).mul(FLOOR.ragged)).toVar();
                const floorDeep = smoothstep(float(FLOOR.deep[0]), float(FLOOR.deep[1]), floorIn).toVar();
                const floorSun = normalize(uSunDir.xz).toVar();
                const fleckAt = vec2(
                    dot(meadowXZ, floorSun).div(float(FLOOR.fleckSize[0])),
                    dot(meadowXZ, vec2(floorSun.y.negate(), floorSun.x)).div(float(FLOOR.fleckSize[1])),
                );
                field.assign(vec3(
                    smoothstep(float(FLOOR.from[0]), float(FLOOR.from[1]), floorIn.add(floorTexel.r.sub(FLOOR.mean).mul(FLOOR.edge))),
                    floorDeep,
                    smoothstep(float(FLOOR.fleckFrom[0]), float(FLOOR.fleckFrom[1]), noise2(fleckAt)).mul(floorDeep).mul(FLOOR.fleck)
                        .mul(floorNear),
                ));
            });
            return field;
        })().toVar();
        const floorOn = floorField.x
            .mul(float(1).sub(smoothstep(float(FLOOR.slope[0]), float(FLOOR.slope[1]), slope)))
            .mul(kGrass).mul(uFloorOn).toVar();
        const meadowOn = kGrass.mul(uMeadowOn)
            .mul(float(1).sub(smoothstep(float(MEADOW.slope[0]), float(MEADOW.slope[1]), slope)))
            // (Under the blossom the grass stays.)
            .mul(float(1).sub(floorOn.mul(float(1).sub(floorPlate.b)))).toVar();
        // Bands of bent grass running with the gust: a fixed heading and length, the phase bent by a
        // bounded noise, on only while the front's envelope is up.
        const waveBend = noise2(meadowXZ.div(float(MEADOW.waveLen * 3.1)).add(vec2(4.2, 9.7)))
            .sub(0.5)
            .mul(2.4);
        const wavePhase = meadowXZ.x.mul(0.8)
            .add(meadowXZ.y.mul(0.6))
            .div(float(MEADOW.waveLen))
            .sub(uTime.mul(MEADOW.waveSpeed / MEADOW.waveLen))
            .add(waveBend)
            .mul(Math.PI * 2);
        const meadowWave = smoothstep(float(0.35), float(0.95), sin(wavePhase))
            .mul(smoothstep(float(0.52), float(0.85), gust.mul(0.5).add(0.5))).mul(meadowOn).toVar();
        const turfRatio = meadowTexel.r.div(float(MEADOW.mean));
        const underCrowns = clamp(forestShade.g.mul(1.4), 0, 1).toVar();
        albedo = albedo.mul(mix(float(1), turfRatio, meadowOn.mul(MEADOW.turf)
            .mul(underCrowns.mul(MEADOW.rough).add(1))
            .mul(float(1).sub(meadowWave.mul(MEADOW.waveFlatten)))));
        // Three soft tones in patches (the chapter 3-4 meadows; the north plain has its own).
        const toneField = noise2(meadowXZ.div(float(MEADOW.toneCell)).add(vec2(21.7, 3.9))).mul(0.7)
            .add(noise2(meadowXZ.div(float(MEADOW.toneCell * 0.37)).add(vec2(8.3, 14.1))).mul(0.3));
        const toneLush = smoothstep(float(0.42).add(MEADOW.toneEdge), float(0.42).sub(MEADOW.toneEdge), toneField);
        const toneFresh = smoothstep(float(0.58).sub(MEADOW.toneEdge), float(0.58).add(MEADOW.toneEdge), toneField);
        const toneDryField = noise2(meadowXZ.div(float(MEADOW.toneCell * 1.6)).add(vec2(2.9, 30.3)));
        const toneDry = smoothstep(float(0.66), float(0.74), toneDryField);
        const toneLushFresh = mix(mix(vec3(1), vec3(...MEADOW.lush), toneLush), vec3(...MEADOW.fresh), toneFresh);
        const tone = mix(toneLushFresh, vec3(...MEADOW.dry), toneDry.mul(0.7));
        albedo = albedo.mul(mix(vec3(1), tone, meadowOn.mul(float(1).sub(plainW))));
        // The sunlit lowland meadow, lighter and warmer (MEADOW.lift).
        albedo = albedo.mul(mix(vec3(1), vec3(...MEADOW.lift), meadowOn.mul(float(1).sub(plainW))
            .mul(float(1).sub(underCrowns.mul(0.6)))));
        // Under the crowns, the litter of their own leaves (the cover plate's mean crown colour).
        albedo = mix(albedo, canopyMean.mul(MEADOW.litterTone), underCrowns.mul(meadowOn).mul(MEADOW.litter));
        // Flowers, in drifts, each drift its own flower; never in deep forest shade.
        const driftField = noise2(meadowXZ.div(float(MEADOW.driftCell)).add(vec2(17.1, 5.3))).mul(0.65)
            .add(noise2(meadowXZ.div(float(MEADOW.driftCell * 0.31)).add(vec2(2.4, 11.8))).mul(0.35));
        const drift = smoothstep(float(MEADOW.drift[0]), float(MEADOW.drift[1]), driftField)
            .mul(mix(float(1), float(MEADOW.shadeKeep), forestShade.g));
        const pick = noise2(meadowXZ.div(float(MEADOW.speciesCell)).add(vec2(40.1, 7.7)));
        const flowerColour = mix(
            mix(vec3(...MEADOW.buttercup), vec3(...MEADOW.daisy), smoothstep(float(0.36), float(0.46), pick)),
            mix(vec3(...MEADOW.clover), vec3(...MEADOW.harebell), smoothstep(float(0.70), float(0.78), pick)),
            smoothstep(float(0.56), float(0.64), pick),
        );
        albedo = mix(albedo, flowerColour, clamp(meadowTexel.g.mul(drift).mul(meadowOn).mul(MEADOW.flowers), 0, 1));
        // The bent grass shows its paler side.
        albedo = albedo.mul(meadowWave.mul(MEADOW.waveLift).add(1));
        // THE FOREST'S FLOOR (FLOOR). Skipped where there is none, which is most of the island.
        const albedoBeforeFloor = albedo;
        albedo = Fn(() => {
            const a = albedoBeforeFloor.toVar();
            const floorCrowns = vec3(canopyMean).toVar();
            const floorTurf = float(turfRatio).toVar();
            If(floorOn.greaterThan(0.004), () => {
                const floorLight = mix(float(1), floorTexel.r.div(float(FLOOR.mean)), FLOOR.light).toVar();
                const floorNeedles = floorPlate.g.toVar();
                const floorBlossom = floorPlate.b.toVar();
                const floorGold = floorPlate.a.toVar();
                const floorLitter = mix(mix(vec3(...FLOOR.litter), vec3(...FLOOR.duff), floorNeedles), floorCrowns.mul(FLOOR.fallen), floorGold.mul(0.85));
                const floorFresh = mix(vec3(...FLOOR.fresh), floorCrowns.mul(1.35), max(floorGold, 0.2));
                const floorGround = mix(floorLitter.mul(floorLight), floorFresh.mul(mix(float(1), floorLight, 0.4)), floorTexel.b.mul(0.8)).toVar();
                // Low plants, in patches; moss where the photograph has it, more of it under needles.
                const floorPatch = smoothstep(float(0.42), float(0.60), noise2(meadowXZ.div(float(FLOOR.herbCell)).add(vec2(5.7, 23.1))))
                    .mul(float(1).sub(floorNeedles.mul(0.5))).mul(float(1).sub(floorGold.mul(0.5)));
                const floorHerbs = max(floorPatch, float(1).sub(floorField.y)).mul(FLOOR.herbShare);
                floorGround.assign(mix(floorGround, vec3(...FLOOR.herb).mul(floorTurf), floorHerbs));
                floorGround.assign(mix(floorGround, vec3(...FLOOR.moss).mul(floorLight), clamp(floorTexel.g.mul(floorNeedles.mul(0.5).add(FLOOR.mossShare)), 0, 1)));
                // Petals lie on the grass.
                const floorStrewn = smoothstep(float(0.28), float(0.62), floorTexel.r.add(floorTexel.b)).mul(FLOOR.petalShare);
                floorGround.assign(mix(floorGround, mix(a, vec3(...FLOOR.petals), floorStrewn), floorBlossom));
                a.assign(mix(a, floorGround, floorOn));
            });
            return a;
        })();

        /**
         * WIND, at no cost. The painted meadow signature is lighter stroke bands sweeping across
         * a slope; the forest's travelling gust line proved the mechanism here — a static field
         * plus a time-varying PHASE, so motion is a sine and not a second texture.
         */
        const sweep = smoothstep(float(0.30), float(0.92), tooth.mul(0.52).add(gust.mul(0.5).add(0.5).mul(0.48)));
        albedo = albedo.mul(sweep.mul(kGrass).mul(float(1).sub(floorOn)).mul(detailMelt).mul(GROUND_WIND_LIFT)
            .add(1));

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
        // (None on the hero massif since its rebuild, 2026-11-25: a value step every 24 u of height
        // was one of the three bands of the audit's layer cake; its own beds stand as cliffs now.)
        const strataAmt = smoothstep(
            float(ODYSSEY_GROUND_STRATA.slope[0]),
            float(ODYSSEY_GROUND_STRATA.slope[1]),
            slope,
        ).mul(kRock).mul(strataFade).mul(float(1).sub(heroCrestW));
        const strataCell = height.add(edgeBreak.mul(float(ODYSSEY_GROUND_STRATA.warp)))
            .div(float(ODYSSEY_GROUND_STRATA.band));
        const bandStep = fract(floor(strataCell).mul(0.1731).add(zone.mul(0.37))).sub(0.5)
            .mul(float(ODYSSEY_GROUND_STRATA.step)).mul(strataAmt);
        albedo = albedo.mul(vec3(
            bandStep.mul(1.25).add(1),
            bandStep.add(1),
            bandStep.mul(0.7).add(1),
        ));

        /**
         * THE MASSIF'S ROCK UP CLOSE (2026-11-25, the audit's M5: from the climb, rock and snow were a
         * flat two-tone decal on a draped surface). The form carries the couloirs and the cliff bands;
         * at the climb's range a face also needs to be STONE: blocks, the joints between them, a tone
         * per block. Joints stand in the rock, never along the face (gotcha #1603): two sets of upright
         * planes, one across world x and one across world z, each wobbled by a broad noise, and a face
         * shows the set that crosses it (the results mixed by its facing, never the coordinates); bedding
         * from the height alone, broken into short runs so no line crosses a face. Only where a joint is
         * a few pixels apart (`footprint`), only on the massif's rock.
         */
        // (Steep faces only: scree and slabs on the gentler ground are not jointed blocks, and a joint
        // set over a whole slope read as pinstripes from mid range.)
        const jointOn = kRock.mul(heroCrestW)
            .mul(float(1).sub(smoothstep(float(MASSIF_ROCK.near[0]), float(MASSIF_ROCK.near[1]), footprint)))
            .mul(smoothstep(float(MASSIF_ROCK.steep[0]), float(MASSIF_ROCK.steep[1]), slope))
            .toVar();
        const jWob = texture(detailTex, positionWorld.xz.mul(0.006)).b.sub(0.5).mul(MASSIF_ROCK.wobble);
        const jx = positionWorld.x.add(jWob).div(MASSIF_ROCK.spacing[0]);
        const jz = positionWorld.z.sub(jWob).div(MASSIF_ROCK.spacing[1]);
        const jy = height.add(jWob.mul(0.6)).div(MASSIF_ROCK.spacing[2]);
        // A joint is kept or not by its own hash (about half are), so the set is irregular, never a grid.
        const jointLine = (c, salt) => {
            const d = abs(fract(c.add(0.5)).sub(0.5));
            const w = fwidth(c).mul(1.2).add(MASSIF_ROCK.crack);
            const kept = smoothstep(float(0.48), float(0.52), hash(floor(c.add(0.5)).add(salt)));
            return float(1).sub(smoothstep(float(MASSIF_ROCK.crack), w, d)).mul(kept);
        };
        const nxz = baseNormal.xz.mul(baseNormal.xz);
        const facingZ = nxz.y.div(max(nxz.x.add(nxz.y), float(1e-4)));
        // (No bedding cracks: a line every few units of height is the striped snow and the layer cake
        // again. The blocks' tones step with the height instead, each block its own.)
        const crack = mix(jointLine(jz, 9001.0), jointLine(jx, 7001.0), facingZ);
        const blockTone = hash(floor(jx).mul(73.0)
            .add(floor(jz).mul(19.0))
            .add(floor(jy).mul(5.0))
            // (kept positive for the hash, which reads its seed as an unsigned integer: gotcha #87)
            .add(40000.0)).sub(0.5);
        const blockPaint = float(1).sub(crack.mul(MASSIF_ROCK.crackDark))
            .mul(float(1).add(blockTone.mul(MASSIF_ROCK.blockTone)));
        albedo = albedo.mul(mix(float(1), blockPaint, jointOn));

        // (Far pre-desaturation lived here. It measured NEGATIVE twice and is retired — see the
        // palette's `presat` note. Distance discipline is owned by the detail melt above and by
        // aerial perspective below, both of which measured positive.)

        /**
         * CAUSTICS on the submerged shelf, RE-CUT (Wave 4) to obey this file's own header law.
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
        // Gated with the shore strip (see SHORE_TOP): computed only for fragments that can carry it.
        const shoreLight = Fn(() => {
            const c = vec3(0).toVar();
            If(height.lessThan(SHORE_TOP), () => {
                const causticUv = positionWorld.xz.mul(0.055).add(vec2(uTime.mul(0.004), uTime.mul(-0.003)));
                const causticTex = texture(detailTex, causticUv).level(0);
                const causticWeb = min(causticTex.b, clamp(causticTex.a.sub(0.42).mul(3.57), 0, 1));
                const caustic = smoothstep(float(ODYSSEY_SEA_LEVEL), float(ODYSSEY_SEA_LEVEL - 7), height)
                    // Item 4: projected surface light FADES with the column above it — the deep
                    // floor was as caustic-lit as the shelf, which flattened the depth read.
                    .mul(smoothstep(float(ODYSSEY_SEA_LEVEL - 150), float(ODYSSEY_SEA_LEVEL - 25), height))
                    .mul(smoothstep(sin(uTime.mul(0.7)).mul(0.04).add(0.52), float(0.80), causticWeb))
                    // Projected surface light cannot paint a cliff wall or the underside of a ledge.
                    .mul(clamp(normal.y, 0, 1));
                c.assign(vec3(0.55, 0.85, 0.90).mul(caustic).mul(sunVis.mul(0.7).add(0.3)).mul(0.5));
            });
            return c;
        })();
        // THE WET SAND'S SHEEN (SEA_WET, 2026-11-21; replaces the constant glisten strip): wet sand
        // is a weak mirror, so it takes the sky by a Fresnel share (more under the backwash's film),
        // and on High the reflected sky itself and a narrow lobe of the sun's glare. Only where
        // the sand is out of the water (the sea's film draws the rest).
        const wetSheen = Fn(() => {
            const c = vec3(0).toVar();
            If(wetField.x.add(wetField.y).greaterThan(0.002), () => {
                const wN = normalize(mix(baseNormal, normal, 0.3));
                const wV = normalize(cameraPosition.sub(positionWorld));
                const wFb = float(1).sub(clamp(dot(wN, wV), 0, 1));
                const wFb2 = wFb.mul(wFb);
                const wFres = wFb2.mul(wFb2).mul(wFb).mul(0.98).add(0.02);
                const exposed = float(1).sub(smoothstep(float(0.0), float(0.25), wetField.z));
                const gloss = mix(float(SEA_WET.gloss[0]), float(SEA_WET.gloss[1]), wetField.y).add(wFres.mul(0.6))
                    .mul(max(wetField.x, wetField.y)).mul(exposed);
                if (q.waterReflections) {
                    const wR = reflect(wV.negate(), wN);
                    const wHv = normalize(ODYSSEY_EVENING_U.sunDir.add(wV).add(vec3(0, 1e-4, 0)));
                    const wNh = clamp(dot(wN, wHv), 0, 1);
                    const lobe = smoothstep(float(0.985), float(0.9985), wNh).mul(SEA_WET.glare[0])
                        .add(smoothstep(float(0.94), float(0.985), wNh).mul(SEA_WET.glare[1]));
                    c.assign(skyAirAt(vec3(wR.x, max(wR.y, float(0.02)), wR.z), false).mul(gloss)
                        .add(landSunOf(gTurn).mul(lobe)
                            .mul(wetField.y.add(wetField.x.mul(0.3)))
                            .mul(sunVis.mul(treeSun).mul(exposed))
                            .mul(float(1).sub(smoothstep(float(1), float(4), footprint)))));
                } else {
                    c.assign(mix(uSkyHorizon, uSkyZenith, float(0.45)).mul(gloss));
                }
            });
            return c;
        })();

        /**
         * THE TWO SHADOW MODELS (G1) — the bar's most load-bearing measurement, and the ground
         * twin of the forest's foliage-shade law.
         *
         * Vegetation, soil and sand keep chromaticity and saturation EXACTLY and lose only
         * value (ref2's leaf ground: sat 0.76 lit, 0.74 shaded, identical norms, luma x0.57);
         * rock instead DESATURATES toward neutral (ref2's ledge 0.33 -> 0.06). Desaturating a
         * warm colour raises its relative blue on its own, so `desat` OWNS the measured hue
         * shift and no blue tint is added anywhere — the one-owner law. Snow is the documented
         * exception: it takes the old alpine language's ice-blue shadow, authored luma-neutral so it
         * shifts hue without also claiming a second share of the value drop.
         *
         * Every colour term below is luma-preserving BY CONSTRUCTION, so the measured shade:lit
         * RATIO is produced in exactly one place — `value`.
         */
        const ndl = max(dot(litNormal, uSunDir), 0);
        // (The day's turn at this point, `gTurn`, was read above with the grass.)
        const gSun = landSunOf(gTurn).toVar();
        const gHour = landHourOf(gTurn).toVar();
        // Drifting cloud shadows over all dry land (see GROUND_CLOUD_SHADOW); the seabed and the
        // wet margin are left alone (their light is the water's business).
        const cloudLight = q.cloudShadows
            ? mix(
                float(1),
                cloudShadowLight(positionWorld.xz, gTurn),
                // (From SEA + 0.2, 2026-11-21: the dry beach shades with the land.)
                smoothstep(float(ODYSSEY_SEA_LEVEL + 0.2), float(ODYSSEY_SEA_LEVEL + 1.6), height),
            )
            : float(1);
        // Lambert, S-shaped. The shoulders group the terminator into masses (the painted law);
        // the middle keeps the mid-tones a rolling landform needs. See the palette's terminator
        // note for the two remaps that tried to replace Lambert and measured worse than it.
        const lightAmt = smoothstep(
            float(ODYSSEY_GROUND_SHADE.terminator[0]),
            float(ODYSSEY_GROUND_SHADE.terminator[1]),
            clamp(ndl.mul(sunVis).mul(cloudLight).mul(max(treeSun, floorField.z.mul(floorOn))), 0, 1),
        ).toVar();
        const albLuma = dot(albedo, vec3(...ODYSSEY_GROUND_LUMA)).toVar();
        const mineralW = clamp(kRock.add(kSnow), 0, 1).toVar();
        const shadeChroma = mix(albedo, vec3(albLuma), mineralW.mul(float(ODYSSEY_GROUND_SHADE.mineral.desat)));
        // Less ice on the hero's shaded snow: across its flutes, full ice-blue walls read as chrome.
        // ...and less with distance (the audit's M15: the far peaks' shaded snow screened cyan, bluer
        // than the sky beside it, and read as holes in the mesh): far off the air's own colour owns it.
        const iceFar = float(1).sub(smoothstep(float(0.8), float(2.6), footprint).mul(0.7));
        const shadeIce = mix(
            shadeChroma,
            albLuma.mul(vec3(...GROUND_SNOW_SHADE)),
            kSnow.mul(mix(float(0.9), float(0.55), heroW)).mul(iceFar),
        );
        // The warm, red-enriched deep tint is the SOIL and ROCK law; snow is exempt (item 5) —
        // warming a blue snow shadow is exactly how it turned beige.
        const shadeCol = shadeIce.mul(mix(
            mix(vec3(...ODYSSEY_GROUND_SHADE.deepTint), vec3(1), kSnow),
            vec3(1),
            lightAmt,
        ));
        const surface = mix(shadeCol, albedo, lightAmt);

        // Cavity occlusion: the baked plate's AO already knows what the landform shadows, but it
        // is baked at a radius that cannot see a gully. This is the small-scale half of the same
        // term, and the split is by RADIUS so neither owns the other's job.
        // Cavity takes the landform gate at HALF weight beyond the detail range: at full weight the
        // far gullies drew as dark grey smudges on the slopes (capture, item 6).
        const cavity = clamp(float(1).sub(gully.mul(uCavity).mul(max(detailGate, formGate.mul(0.5)))), 0.62, 1.0);
        // THE AMBIENT owns the floor — the one thing Lambert cannot supply and the one thing the
        // shipped graph had wrong (0.06 against the references' 0.27-0.32). It is per-material
        // (rock takes less sky than a meadow does) and deepens where the baked occlusion says
        // the sky cannot see in, which is how a hollow in shadow reaches the measured deep band
        // without a second darkening term fighting the first.
        const openness = smoothstep(float(GROUND_AO_FLOOR), float(1), wideAo)
            .mul(float(1).sub(forestShade.g.mul(FOREST_FLOOR_AO)));
        // THREE families now, weighted by the explicit material weights: snow split out of
        // `mineralW` (item 5), because snow in shade is lit by the sky it faces and stays bright.
        // High rock takes more of the sky (2026-10-31): at the summit, open to the whole dome and to
        // the bounce off the snow round it, shaded stone is a slate lit by the sky, not black paint.
        const rockAmbient = mix(
            float(ODYSSEY_GROUND_SHADE.mineral.ambient),
            float(SUMMIT_ROCK.rockAmbient),
            summitGate,
        );
        const ambient = mix(
            mix(float(ODYSSEY_GROUND_SHADE.deepAmbient), float(ODYSSEY_GROUND_SHADE.snow.deep), kSnow),
            float(ODYSSEY_GROUND_SHADE.vegetation.ambient).mul(clamp(float(1).sub(kRock).sub(kSnow), 0, 1))
                .add(rockAmbient.mul(kRock))
                .add(float(ODYSSEY_GROUND_SHADE.snow.ambient).mul(kSnow)),
            openness,
        ).toVar();
        // (`gHour.w`, the hour: under a low sun the sky's fill is a smaller share of the light, so the
        // long shadows stand a little deeper against the lit land.)
        const ambientNow = ambient.mul(float(1).sub(gHour.w));
        const value = ambientNow.add(float(1).sub(ambientNow).mul(lightAmt)).mul(float(GROUND_LIT_GAIN));
        // The journey's ambient still reaches the ground — the colour script drives it — but
        // NORMALISED to luma 1 and pulled most of the way to neutral first, because a saturated
        // cool fill light is precisely what the measurement refutes for vegetation shade.
        const ambientHue = uShadowTint.div(max(dot(uShadowTint, vec3(...ODYSSEY_GROUND_LUMA)), 0.001));
        // THE HOUR (odyssey-day-turn.js `ODYSSEY_HOUR_LOOK`): late in the day the shade takes more of
        // the sky's hue (long blue shadows; `gHour.x` on the land, `.y` on snow), and lit snow leans
        // from the sun's gold to rose (`gHour.z`, alpenglow). All three are zero at noon.
        const lightCol = mix(
            mix(vec3(1), ambientHue, mix(
                mix(float(GROUND_AMBIENT_CHROMA), float(SUMMIT_ROCK.rockSkyChroma), kRock.mul(summitGate))
                    // (...and under the turning shade the land is lit by the sky alone: cool and
                    // silver, not merely darker.)
                    .add(gHour.x)
                    .add(gTurn.x.mul(ODYSSEY_DAY_TURN.silver)),
                float(ODYSSEY_GROUND_SHADE.snow.skyChroma).add(gHour.y),
                kSnow,
            )),
            gSun.mul(mix(vec3(1), vec3(...ODYSSEY_HOUR_LOOK.alpenglowTint), kSnow.mul(gHour.z))),
            lightAmt,
        );
        // Rim: unlit-compatible fake translucency on snow only, cool and weak.
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        // The rim reads the FORM's normal: on the flutes' tilted one it lit every flute edge,
        // and the cone turned to brushed chrome.
        // Clamped: a dot of unit vectors can round past 1, and pow of a negative base is NaN, which
        // bloom spreads into a black block (as it once did on the old water surface's caustics).
        const rim = clamp(float(1).sub(abs(dot(normal, viewDir))), 0.0, 1.0).pow(4)
            .mul(kSnow)
            .mul(0.14);
        // NOTE the wide occlusion is NOT multiplied in here. It reaches the image through
        // `ambient` above, which is the one-owner form: occlusion darkens the part of the light
        // that occlusion actually blocks (the sky fill) and leaves direct sun alone. Multiplying
        // it over the whole result as well drove a hollow in shadow to 0.195 against the
        // measured 0.27-0.32 band, and dimmed sunlit hollows that the sun plainly reaches.
        groundColour = surface.mul(lightCol).mul(value).mul(cavity)
            .add(shoreLight)
            .add(wetSheen)
            // ALPENGLOW: high snow takes a warm kiss, riding the same kSnow the albedo uses so it
            // can never bleed onto rock or meadow, and multiplied by the baked sun visibility so
            // a shadowed crown stays cold. ⚠️ ON THE TURN OF THE FORM ONLY (item 6): it rode
            // ndl^1.6, i.e. it peaked on FACE-ON snow — and Act II flies with the sun behind the
            // camera, so every face it shows is face-on and the whole summit took a 30 % peach
            // cast that the grade rendered as beige sand. Real alpenglow is light raking across
            // a slope; a band over the terminator half of the Lambert range keeps the warm kiss
            // on the turning flanks and leaves face-on snow white.
            .add(gSun.mul(vec3(1.0, 0.70, 0.55))
                .mul(kSnow.mul(sunVis)
                    .mul(smoothstep(float(0.04), float(0.30), ndl))
                    .mul(float(1).sub(smoothstep(float(0.45), float(0.80), ndl)))
                    .mul(0.26)))
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
    // The two paces of the ordered departure and the limb's own envelope (item 10), all
    // computed on the CPU in setDepartureFade — three scalar uniforms instead of a pow per pixel.
    const uFadeZenith = uniform(0);
    const uFadeHorizon = uniform(0);
    const uLimbGlow = uniform(0);
    // The airglow line's own envelope: the limb's, gated on the HORIZON having gone dark. Airglow
    // is only ever seen against night; under the limb's envelope alone it drew a mint stripe
    // across a still-blue sky at the top of the climb (all-angles pass, p 0.715).
    const uAirglowGlow = uniform(0);
    // THE EARTH BELOW (2026-10-24, composition/odyssey-orbit-earth.js): once the round planet has
    // arrived, its own rim is the limb, so the dome's straight limb line yields to it, and the
    // airglow line sits at the airglow layer's height over that limb (sin of its elevation;
    // 0.075 is the line's place before the Earth, ~4 deg over the level).
    const uLimbYield = uniform(1);
    const uAirglowSin = uniform(0.075);
    // WHERE THE SEA ENDS, seen from the eye (all-angles pass, 2026-10-18). The limb used to sit
    // at elevation +0.01, the horizon of an endless sea. The sea is not endless: the camera's
    // far plane cuts it along a straight line, and from ~900 u up at the top of the climb that
    // line sits ~0.10 below level — so a 6-degree wedge of dome showed between the sea's edge
    // and the limb, and the limb read as a glowing tube floating over the water. The limb now
    // sits ON the drawn edge. The far cut is planar, so the edge's distance grows off-axis
    // (far / cos of the azimuth from the view's forward); the clipmap's reach caps it.
    const uEyeH = uniform(0);
    const uViewFar = uniform(1e7); // no camera handed in: the clipmap's reach is the edge
    const uViewFwdXZ = uniform(new THREE.Vector2(0, -1));
    const uSeaReach = uniform(1e5);
    // The chapter-6 aurora's live glow (0..1), handed in by the board: as its curtains rise OUT OF
    // the airglow line, the line yields to them (owner 2026-10-02: "it feels like we have two
    // different auroras" — a straight green line under the curtains read as a second one).
    const uAuroraGlow = uniform(0);
    const toOutputFaded = (c, fadeAmt) => {
        const scaled = (applyExposure ? c.mul(uExposure) : c).mul(uOutputScale);
        const graded = mix(vec3(dot(scaled, vec3(0.2126, 0.7152, 0.0722))), scaled, uOutputSat);
        return mix(graded, uWorldFadeColour, fadeAmt);
    };
    const toOutput = (c) => toOutputFaded(c, uWorldFade);
    // The sea and the ground under a climbing eye stay lit: the departure darkens the sky over it,
    // not the ground below. While the Earth is there they take no fade toward the void (it is on its
    // way from before the fade has begun, so nothing brightens back).
    const toOutputSurface = (c) => toOutputFaded(c, uWorldFade.mul(float(1).sub(ORBIT_EARTH_SEAM.presence)));
    // BELOW THE HORIZON THE AIR FADES AT THE SEA'S PACE (2026-10-25). The departure takes the sky
    // overhead first and the horizon last (uFadeZenith, uFadeHorizon), and the sea with the world
    // (uWorldFade, ahead of the horizon). Below the horizon the dome had the horizon's pace, so
    // where the climb dropped the sea's drawn edge below the horizon it opened onto air far paler
    // than the sea beside it, and the Earth arriving there wore that pale air: a white band that
    // widened down the frame as the eye rose. Below the horizon the air now fades as the sea does;
    // the horizon itself keeps its own pace, a thin bright line. (Act II: every fade is 0.)
    const fadeBelowHorizon = (dirY) => mix(uWorldFade, uFadeHorizon, smoothstep(float(-0.06), float(0), dirY));
    // The world's air for a view direction: the colour its far sea and its sky meet in (the dome's
    // own, faded at the departure's pace there). What the world melts into, and what the Earth wears.
    const airFor = (dir) => toOutputFaded(skyAirAt(dir), fadeBelowHorizon(dir.y));
    // THE ONE AIR (2026-10-26): what the Earth below is hazed by while the world is there. Its
    // colour is the world's own air for the direction (not faded toward the void: the air under a
    // climbing eye stays lit), and its column over the eye is the world's exponential atmosphere
    // (AERIAL_SCALE_HEIGHT) at the colour script's density: a ray down at sine `mu` crosses
    // column / mu, exactly as the world's own sea is hazed (applyAerial's mean air), so where the
    // far sea gives way to the Earth the haze carries straight on. Thick toward the horizon from low
    // down, thinning as the eye climbs. The Earth's own air takes over as the eye rises past the
    // weather (`weight`).
    const earthAirFor = (dir) => {
        const climbed = max(cameraPosition.y.sub(ODYSSEY_SEA_LEVEL), 0);
        // The light the air scatters toward an eye looking DOWN is the sky's at the same angle
        // above the level (the sky seen in the mirror of the haze): pale near the horizon, deep
        // blue looking steeply down, so the sea below stays blue and the haze lies at the horizon.
        // (Mirrored about the Earth's limb, THE HORIZON IS THE LIMB.)
        const mirrored = vec3(dir.x, limbMirror(dir.y), dir.z);
        return {
            colour: toOutputFaded(skyAirAt(mirrored), float(0)),
            column: uAerialK.mul(AERIAL_SCALE_HEIGHT).mul(float(1).sub(exp(climbed.div(AERIAL_SCALE_HEIGHT).negate()))),
            ceil: 0.82,
            weight: float(1).sub(smoothstep(float(6000), float(20000), climbed)),
        };
    };
    // THE WORLD ENDS IN THE SKY (2026-10-24). The sea is drawn out to the camera's far plane (a
    // straight cut) or, high in the climb, to the clipmap's square, and past it the dome shows the
    // sky below the horizon. Through the departure the two met at a visible edge: the far sea
    // fades with the world (uWorldFade) and the dome below the horizon with the horizon
    // (uFadeHorizon), so in the climb the sea read as a grey slab with a pale band beyond it. Over
    // the last stretch before the drawn edge the world now takes the dome's own colour for its
    // direction, so the cut and the square's corners vanish into the haze, and the limb glow sits
    // just above. Only while the departure runs (a uniform branch, so Act II pays nothing for
    // it): Act II's horizon is untouched.
    const meltIntoSky = (out, wp) => Fn(() => {
        const res = out.toVar();
        If(uWorldFade.greaterThan(0.001).or(ORBIT_EARTH_SEAM.presence.greaterThan(0.001)), () => {
            const to = wp.sub(cameraPosition);
            const d = length(to);
            const dir = to.div(max(d, float(0.001)));
            const flat = normalize(dir.xz.add(vec2(1e-4, 0)));
            // The drawn edge in this direction (see uEyeH), taken into the climb's frame.
            const edge = min(uViewFar.div(max(dot(flat, uViewFwdXZ), 0.3)), uSeaReach).mul(uClimb);
            If(ORBIT_EARTH_SEAM.presence.greaterThan(0.001), () => {
                // THE SEAM, ONE SURFACE (2026-10-26, Olov: the Earth's surface "transitions in";
                // "it should feel natural and not like we reveal the earth surface"). The Earth
                // stands at the eye's own height (orbitEarthAt), so the world's sea and the planet's
                // ocean are the same place seen the same way: the far sea simply IS the Earth, in
                // the world's own air, and gives way to it over a stretch of distance that holds
                // still on screen as the eye climbs (both scale with the height). No front sweeps
                // and nothing is revealed: the coasts and the weather out there were always there,
                // in the haze, and come clear as the air under the eye thins. As the world's clouds
                // go into the Earth the rest of the surface follows (its near sea and the island,
                // under the frame by then), so when the world is switched off nothing changes.
                const far = smoothstep(float(0.25), float(0.8), d.div(edge));
                const w = max(far, ORBIT_EARTH_SEAM.cloudsAway).mul(float(1).sub(uSubmerged));
                res.assign(mix(res, orbitEarthOver(dir, airFor(dir), res, earthAirFor(dir)), w));
            }).Else(() => {
                // Before the Earth (the departure's first stretch): the drawn edge melts into the
                // dome's own colour, so the cut and the square's corners vanish into the haze.
                const w = smoothstep(float(0.55), float(0.97), d.div(edge))
                    .mul(smoothstep(float(0), float(0.2), uWorldFade))
                    .mul(float(1).sub(uSubmerged));
                res.assign(mix(res, airFor(dir), w));
            });
        });
        return res;
    })();
    // Land ceiling + rate, valley mist on, no haze floor, the per-fragment medium (breach band).
    const GROUND_AERIAL_ARGS = [AERIAL_CEIL_LAND, AERIAL_RATE_LAND, true, null, true];
    groundMat.colorNode = meltIntoSky(
        toOutputSurface(applyAerial(groundColour, positionWorld, ...GROUND_AERIAL_ARGS)),
        positionWorld,
    );

    // THE SEAM for the clouds: they stay real clouds in front of the Earth while the climb takes
    // them down below the eye, and only once they are small go into it, melting into what the
    // Earth shows behind them, never into the sky in front of the eye.
    // While the Earth is there, the clouds are lit over it, not fading toward the void with the rest
    // of the departing world (that fade is what turned them into grey ghosts over the planet).
    const notOverEarth = float(1).sub(ORBIT_EARTH_SEAM.presence);
    const intoEarth = (out) => Fn(() => {
        const res = out.toVar();
        If(ORBIT_EARTH_SEAM.cloudsAway.greaterThan(0.001), () => {
            const dir = normalize(positionWorld.sub(cameraPosition));
            // (in the same air as the surfaces and the backdrop show it: THE ONE AIR)
            const earth = orbitEarthOver(dir, airFor(dir), airFor(dir), earthAirFor(dir));
            res.assign(mix(res, earth, ORBIT_EARTH_SEAM.cloudsAway));
        });
        return res;
    })();

    const groundMesh = new THREE.Mesh(ground.geometry, groundMat);
    const lakeMeshes = [];
    // Once the Earth below has fully arrived it covers the surface out to its own backdrop, and
    // the near world inside that (straight down, already faded) would show as a dark patch on it:
    // the surfaces stop drawing (setEarth). The sky dome stays.
    let earthCovers = false;
    groundMesh.frustumCulled = false;
    groundMesh.matrixAutoUpdate = false;
    groundMesh.updateMatrix();
    groundMesh.name = 'odyssey-world-ground';
    group.add(groundMesh);

    // ── ONE WATER (2026-10-31) ──────────────────────────────────────────────────────────
    // Olov: "the water in the pond looks totally different than the water in the ocean!" The
    // tarn had a palette of its own (murky green over near-black) under a grey mirror, while the
    // sea wears the colour script's pigment ramp, a stepped wash of sky and sun glints. These are
    // the sea's terms as functions, read by both waters, so they are painted from one set and
    // cannot drift apart again. Call them inside a Fn (they make vars).
    /** The pigment ramp (viridian, cerulean, cobalt, Prussian) at driver `t`, in flat plates. */
    // `soft` 0..1 widens each plate's edge into a wash: from high above (the summit's view of the
    // coast) the plates' 2 px steps read as a contour map (the mountain's audit, N1), so far off they melt.
    const waterRampBody = (t, ramp = ODYSSEY_WATER_RAMP, soft = float(0)) => {
        const bands = float(ODYSSEY_WATER_RAMP.bands);
        const cell = t.mul(bands).toVar();
        const edge = mix(float(0.05), float(0.5), soft);
        const seg = floor(cell).add(smoothstep(float(0.5).sub(edge), float(0.5).add(edge), fract(cell)))
            .div(bands)
            .mul(3)
            .toVar();
        return mix(
            mix(
                mix(vec3(...ramp.shore), vec3(...ramp.shelf), clamp(seg, 0, 1)),
                vec3(...ramp.open),
                clamp(seg.sub(1), 0, 1),
            ),
            vec3(...ramp.deep),
            clamp(seg.sub(2), 0, 1),
        );
    };
    /**
     * The sky in the reflected direction, on four stepped plates of the sky's own sqrt curve,
     * lifted a quarter up it (the bottom plate is the palest horizon and bleached the sea to milk).
     */
    const waterSkyWash = (reflDir) => {
        const t = sqrt(clamp(reflDir.y, 0, 1)).mul(4).toVar();
        const step = floor(t).add(smoothstep(float(0.40), float(0.60), fract(t))).div(4).toVar();
        const s = step.mul(0.75).add(0.25);
        // The dome's own air on this bearing (2026-11-20): the warm side toward the sun, the hour's
        // belt, the evening's gold; it was the bare horizon-to-zenith gradient, a grey violet at
        // grazing that the dome never shows.
        return skyAirAt(vec3(reflDir.x, s.mul(s), reflDir.z));
    };
    /** The share of sky: (1 - N·V)^4 · gain + floor. */
    const waterFresnel = (N, V, gain, floorShare) => {
        const fb = float(1).sub(max(dot(N, V), 0));
        return fb.mul(fb).mul(fb).mul(fb)
            .mul(gain)
            .add(floorShare);
    };
    /**
     * The sun on water: a hairline core on the half vector and a road on the mirror ray, both under
     * the sun the player sees (the dome's: it sinks to the evening's through chapter 5; outside the
     * evening it is the world's).
     *
     * THE ROAD (2026-11-20): a soft shoulder (~6-17 degrees) and a faint skirt round the core,
     * which stays waterSunCore's hairline. It was one lobe ~26 degrees wide at 0.45: every pixel of
     * water within 15 degrees of the sun's bearing took up to 0.45 of white, from the horizon to the
     * frame's foot, and the hill and cloud shadows cut that into milky smears that read as fog banks
     * on the water (gotcha #1314). Glitter only on the sun's road.
     */
    const waterSunCore = (N, V) => smoothstep(float(0.9955), float(0.9995), dot(normalize(ODYSSEY_EVENING_U.sunDir.add(V)), N))
        .mul(0.9);
    const waterSunRoad = (reflDir) => {
        const toSun = clamp(dot(reflDir, ODYSSEY_EVENING_U.sunDir), 0, 1);
        return smoothstep(float(0.955), float(0.995), toSun).mul(0.14)
            .add(smoothstep(float(0.90), float(0.99), toSun).mul(0.05));
    };
    /** The glints' colour. */
    const WATER_GLINT = [1, 0.96, 0.88];
    /**
     * The sea's two scrolling ripple fetches from the detail bake (rg = signed slopes, b = the
     * scalar noise the glitter and the foam break up with).
     */
    const waterRippleTex = (xz) => ({
        a: texture(detailTex, xz.mul(0.021).add(vec2(uTime.mul(0.010), uTime.mul(-0.014)))),
        b: texture(detailTex, xz.mul(0.047).add(vec2(uTime.mul(-0.018), uTime.mul(0.008)))),
    });
    // ── WIND ON THE WATER (water pass step 4) ──────────────────────────────────────────────
    // The water rides the same wind as the land (`gustFront`, ONE WIND: the meadow lightens and the
    // crowns lean as a front passes): where the front is up, drifting patches of rougher water (a
    // sailor's cat's paws) sweep downwind over both waters, and between them the water lies calm.
    // Returns 0 calm .. 1 in a gust. One fetch of the detail bake's value noise, ~400 u a tile,
    // scrolling along the wind (+x/+z, the front's direction).
    const WATER_WIND = vec2(0.8, 0.6);
    const waterGust = (xz) => {
        const front = gustFront(xz).mul(0.5).add(0.5);
        const paws = texture(detailTex, xz.mul(0.0025).sub(WATER_WIND.mul(uTime.mul(0.0042)))).b;
        return smoothstep(float(0.40), float(0.72), paws.add(front.sub(0.5).mul(0.40)));
    };
    // ── CLOUDS IN THE WATER (water pass step 2; odyssey-water-clouds.js) ──────────────────
    // The reflected ray traced against the few cloud masses the CPU picked this frame (their
    // mirror image in view), each an ellipsoid fitted to its lobes and drifting with the field.
    // The ray's closest approach to a mass's centre, in the mass's unit frame, says how far inside
    // its outline the ray passes: the outline is broken into lobes by three sines of that point,
    // cut flat at the mass's base, lit from its crown (sunlit white) to its base (the cool under
    // tone), and hazed by the run like the field itself. `sky` is the water's own sky in that
    // direction, so a ray that misses every mass returns it unchanged.
    const waterCloudRows = Array.from({ length: WATER_CLOUD_SLOTS * 3 }, () => new THREE.Vector4());
    const uWaterCloudRows = uniformArray(waterCloudRows, 'vec4');
    const uWaterCloudCount = uniform(0);
    const waterCloudTop = mix(uSunColour, vec3(1.0, 1.0, 1.0), float(0.55)).mul(1.02);
    const waterCloudBase = mix(skyColourFor(float(0.30)), vec3(0.86, 0.88, 0.93), float(0.5));
    // `gloss` (the sea only, SEA_GLOSS): { v, h, on } the reflection's lobe along the view's vertical
    // and across it (slope spreads the mirrored ray by 2 sigma up and down, by 2 sigma sin(dip)
    // sideways), and whether it is drawn here; null builds the mirror as before (the tarn, the lake).
    const waterCloudsAlong = (O, R, skyIn, gloss = null) => {
        if (!q.waterReflections) return skyIn;
        const sky = vec3(skyIn).toVar();
        const col = vec3(sky).toVar();
        const rise = smoothstep(float(0.0), float(0.03), R.y).toVar();
        const eH = gloss ? normalize(vec3(R.z.add(1e-5), 0, R.x.negate())).toVar() : null;
        const eV = gloss ? cross(eH, R).toVar() : null;
        Loop({
            start: int(0), end: int(uWaterCloudCount), type: 'int', condition: '<', name: 'wcl',
        }, ({ wcl }) => {
            const r0 = uWaterCloudRows.element(wcl.mul(3)).toVar();
            const r1 = uWaterCloudRows.element(wcl.mul(3).add(1)).toVar();
            const r2 = uWaterCloudRows.element(wcl.mul(3).add(2)).toVar();
            const rel = O.sub(r0.xyz);
            const lo = vec3(
                rel.x.mul(r0.w).add(rel.z.mul(r1.w)),
                rel.y,
                rel.z.mul(r0.w).sub(rel.x.mul(r1.w)),
            ).mul(r1.xyz).toVar();
            const ld = vec3(
                R.x.mul(r0.w).add(R.z.mul(r1.w)),
                R.y,
                R.z.mul(r0.w).sub(R.x.mul(r1.w)),
            ).mul(r1.xyz).toVar();
            const tStar = dot(lo, ld).negate().div(max(dot(ld, ld), float(1e-9))).toVar();
            const qc = lo.add(ld.mul(tStar)).toVar();
            const lobes = sin(qc.x.mul(7.1).add(r2.y))
                .add(sin(qc.z.mul(5.3).add(r2.y.mul(1.7))))
                .add(sin(qc.x.add(qc.z).mul(4.3).add(r2.y.mul(0.6))))
                .mul(0.045);
            let cov;
            if (gloss) {
                // THE GLOSS (SEA_GLOSS): the disc convolved with the lost slope's lobe, in the mass's
                // unit frame. Its outline grows along the view's vertical and across it, its peak
                // falls, its lobes and its flat base blur. At no gloss it is the mirror's own disc.
                const rho2 = dot(qc, qc).toVar();
                const keep = float(1).toVar();
                const baseSoft = float(0).toVar();
                If(gloss.on, () => {
                    const toUnit = (e) => vec3(
                        e.x.mul(r0.w).add(e.z.mul(r1.w)),
                        e.y,
                        e.z.mul(r0.w).sub(e.x.mul(r1.w)),
                    ).mul(r1.xyz);
                    const span = max(tStar, float(0));
                    const ldn = normalize(ld);
                    const flatOf = (gv) => gv.sub(ldn.mul(dot(gv, ldn)));
                    const gV = flatOf(toUnit(eV).mul(span.mul(gloss.v))).toVar();
                    const gH = flatOf(toUnit(eH).mul(span.mul(gloss.h))).toVar();
                    const nV = dot(gV, gV).add(1).toVar();
                    const nH = dot(gH, gH).add(1).toVar();
                    const qv = dot(qc, gV);
                    const qh = dot(qc, gH);
                    rho2.assign(max(rho2.sub(qv.mul(qv).div(nV)).sub(qh.mul(qh).div(nH)), float(0)));
                    keep.assign(exp2(log2(nV.mul(nH)).mul(-0.5 * SEA_GLOSS.keepPow)));
                    baseSoft.assign(abs(gV.y));
                });
                cov = float(1).sub(smoothstep(float(0.66), float(1.0), sqrt(rho2).add(lobes.mul(keep))))
                    .mul(smoothstep(r2.x.sub(baseSoft), r2.x.add(0.18).add(baseSoft), qc.y))
                    .mul(tslStep(float(0), tStar))
                    .mul(rise)
                    .mul(keep)
                    .toVar();
            } else {
                cov = float(1).sub(smoothstep(float(0.66), float(1.0), length(qc).add(lobes)))
                    .mul(smoothstep(r2.x, r2.x.add(0.18), qc.y))
                    .mul(tslStep(float(0), tStar))
                    .mul(rise)
                    .toVar();
            }
            If(cov.greaterThan(0.002), () => {
                const up = smoothstep(r2.x, float(0.75), qc.y);
                const lit = mix(waterCloudBase, waterCloudTop, up);
                const haze = clamp(float(1).sub(exp(tStar.mul(uAerialK).negate())), 0, 0.82).mul(0.42);
                col.assign(mix(col, mix(lit, sky, haze), cov));
            });
        });
        return col;
    };

    // ── THE TARN (Act II pass, step 6) — the meadow pond that mirrors the massif ─────────
    // See ODYSSEY_TARN (odyssey-world-height.js) for where it is and why: the pond the chapter-3
    // basin was scooped for, on the line the chapter-4 eyes look along. Its water is a MIRROR,
    // not a tint: the reflected view ray is marched over the same plates the ground draws (macro
    // + relief + the sculpt plate), and where it meets the land it takes that land's colour by
    // height (meadow, forest from the shade plate's cover, rock, snow) under the baked sun, hazed
    // by the distance it ran; where it runs out into the sky it takes the sky and the warm air.
    // So the hero massif's lit face stands upside down in the water from every station that sees
    // it, with a slow ripple breaking the mirror. Opaque discs again, the shoreline drawn by the
    // depth buffer where the carve's banks rise through them (the north lake's rule).
    //
    // COST: a 24-step march (three fetches a step) for the tarn's own pixels only, at most a few
    // percent of the frame from L20-L23 and nothing elsewhere (the discs are culled out of view).
    // ── THE LAND IN THE WATER (shared since water pass step 3) ─────────────────────────────
    // The reflected ray marched over the height plates (steps that grow with range: fine by the
    // bank, long toward the massif), keeping its closest pass over the land too, so a ray that
    // only grazes a ridge takes some of it: the reflected skyline is soft instead of a pixel-hard
    // stair that would crawl as the ripple moves. `heightAt` is the water's own choice of plates
    // (the tarn reads all three, the sea the macro shape only); `ceiling` stops a ray that has
    // climbed over every summit. Returns the hit distance (or the closest pass) and how much of
    // the land the ray takes.
    const waterPlateUv = (xz) => xz.div(float(RELIEF_EXTENT)).add(0.5);
    // `blur` (a node, the sea only): return a SOFT share, smoothstep(-blur, blur) of the most the
    // land rises over the ray (radians, its gap over the distance run), marching on past the first
    // hit until the share is whole; null builds the hit test as before (the tarn, the window).
    const waterMarchLand = (P, R, {
        heightAt, steps, firstStep, stepGrowth, soft, ceiling = null, blur = null,
    }) => {
        const tHit = float(-1).toVar();
        const tPrev = float(0).toVar();
        const tCur = float(firstStep).toVar();
        const gapMin = float(1e6).toVar();
        const tClose = float(firstStep).toVar();
        const rise = blur ? float(-1).toVar() : null;
        Loop({
            start: int(0), end: int(steps), type: 'int', condition: '<',
        }, () => {
            const qr = P.add(R.mul(tCur)).toVar();
            if (ceiling !== null) {
                If(qr.y.greaterThan(ceiling), () => {
                    Break();
                });
            }
            const gap = qr.y.sub(heightAt(qr.xz)).toVar();
            If(gap.lessThan(gapMin), () => {
                gapMin.assign(gap);
                tClose.assign(tCur);
            });
            if (blur) {
                rise.assign(max(rise, gap.negate().div(tCur)));
                If(gap.lessThan(0).and(tHit.lessThan(0)), () => {
                    // The secant between the last two steps: the reflected shore stops stepping.
                    const gPrev = P.add(R.mul(tPrev)).toVar();
                    const gapPrev = max(gPrev.y.sub(heightAt(gPrev.xz)), float(0));
                    tHit.assign(mix(tPrev, tCur, gapPrev.div(max(gapPrev.sub(gap), float(1e-3)))));
                });
                If(rise.greaterThan(blur), () => {
                    Break();
                });
            } else {
                If(gap.lessThan(0), () => {
                    // One halving between the last two steps.
                    const tMid = tPrev.add(tCur).mul(0.5).toVar();
                    const qm = P.add(R.mul(tMid)).toVar();
                    tHit.assign(select(heightAt(qm.xz).greaterThan(qm.y), tMid, tCur));
                    Break();
                });
            }
            tPrev.assign(tCur);
            tCur.assign(tCur.mul(stepGrowth).add(firstStep));
        });
        const hit = tHit.greaterThan(0);
        const tLand = select(hit, tHit, tClose).toVar();
        const landW = blur
            ? smoothstep(blur.negate(), blur, rise).toVar()
            : select(
                hit,
                float(1),
                float(1).sub(smoothstep(float(0), max(float(soft), tClose.mul(0.02)), gapMin)),
            ).toVar();
        return { tLand, landW };
    };
    /**
     * The land a reflected ray meets at H, by height from the ground palette's own poles: the
     * beach just over the sea, meadow, the forest (the shade plate's cover), rock, snow. Lit by its
     * own slope (the relief plate's gradient) under the baked sun, broken by a little value noise
     * so a reflected hillside is not one flat colour, and hazed by the run toward the air on R.
     */
    const waterLandLit = (H, tLand, airOnR) => {
        const T = TARN_MIRROR;
        const cover = texture(
            forestShadeTex,
            H.xz.sub(vec2(FOREST_SHADE_PLATE.x, FOREST_SHADE_PLATE.z)).div(FOREST_SHADE_PLATE.extent).add(0.5),
        ).level(0).g;
        const meadow = mix(vec3(...ODYSSEY_GROUND_PALETTE.grass.damp), vec3(0.075, 0.13, 0.05), cover);
        // (The sea's beach as the ground paints it, SEA_BEACH and SEA_WET, 2026-11-21.)
        const beach = mix(
            mix(
                vec3(...SEA_BEACH.dry).mul(vec3(...SEA_WET.dark)),
                vec3(...SEA_BEACH.dry),
                smoothstep(float(ODYSSEY_SEA_LEVEL + 1.2), float(ODYSSEY_SEA_LEVEL + 2.0), H.y),
            ),
            meadow,
            smoothstep(float(ODYSSEY_SEA_LEVEL + 3.5), float(ODYSSEY_SEA_LEVEL + 5.5), H.y),
        );
        const rock = vec3(...ODYSSEY_GROUND_PALETTE.rock.dry);
        const snow = vec3(...ODYSSEY_GROUND_PALETTE.snow.dry);
        const land = mix(
            mix(beach, rock, smoothstep(float(T.rockFrom[0]), float(T.rockFrom[1]), H.y)),
            snow,
            smoothstep(float(T.snowFrom[0]), float(T.snowFrom[1]), H.y),
        );
        const reliefAt = texture(heightTex, waterPlateUv(H.xz)).level(0);
        const n = normalize(vec3(reliefAt.g.negate(), 1, reliefAt.b.negate()));
        const vis = texture(sunVisTex, waterPlateUv(H.xz)).level(0).r;
        const ndl = clamp(dot(n, uSunDir), 0, 1);
        const grain = noise2(H.xz.mul(0.045)).mul(0.35).add(0.82);
        const lit = land.mul(grain).mul(uSunColour.mul(ndl.mul(vis).mul(T.sunLit)).add(uShadowTint.mul(T.ambient)));
        const haze = clamp(
            float(1).sub(exp(tLand.mul(uAerialK).negate())).mul(AERIAL_RATE_LAND),
            0,
            AERIAL_CEIL_LAND,
        );
        return mix(lit, airOnR, haze);
    };

    // THE SWANS ON THE TARN (life at the pond, composition/odyssey-pond-life.js): each swan's place
    // and velocity (x, z, vx, vz), handed in every frame by `setTarnSwans`; far away when none.
    const tarnSwanRows = [new THREE.Vector4(1e5, 0, 0, 0), new THREE.Vector4(1e5, 0, 0, 0)];
    const uTarnSwans = uniformArray(tarnSwanRows, 'vec4');
    // Where a ring may rise: places in the open water, spread over the whole tarn.
    const tarnRingSites = tarnOpenWater(TARN_MIRROR.ringSites).map(([x, z]) => new THREE.Vector4(x, z, 0, 0));
    const uTarnRingSites = uniformArray(tarnRingSites, 'vec4');
    const tarnMat = new THREE.MeshBasicNodeMaterial();
    {
        const T = TARN_MIRROR;
        const plateUv = waterPlateUv;
        const sculptUv = (xz) => xz.sub(vec2(ODYSSEY_SCULPT_PLATE.x, ODYSSEY_SCULPT_PLATE.z))
            .div(float(ODYSSEY_SCULPT_PLATE.extent))
            .add(0.5);
        // The drawn surface's height, as the ground's vertex stage builds it (explicit LOD: these
        // run inside the march's loop).
        const landAt = (xz) => {
            const m = texture(macroTex, plateUv(xz)).level(0);
            return withTarn(
                m.r.add(texture(heightTex, plateUv(xz)).level(0).r.mul(m.g)).add(texture(summitTex, sculptUv(xz)).level(0).r),
                texture(tarnTex, tarnPlateUv(xz)).level(0),
            );
        };
        // The water column over the drawn bed. A var built at the colour Fn's root (its first
        // read), so the opacity below reads the same value (the north lake's rule).
        const tarnDepth = float(ODYSSEY_TARN.waterY).sub(landAt(positionWorld.xz)).toVar('tarnDepth');
        // How much depth one pixel spans: the waterline's soft band is at least `shorePx` of them.
        const tarnDepthPx = abs(dFdx(tarnDepth)).add(abs(dFdy(tarnDepth)));
        const tarnShoreW = max(float(T.shore), tarnDepthPx.mul(T.shorePx));
        // RINGS (water pass step 4): a fish rising, an insect landing. A few rings at a time, each
        // slot on its own clock, born near one of the open-water places (picked by a hash of the
        // slot's cycle), spreading at ~3.6 u/s and dying in ~6 s (drawn large, as the meadow's
        // butterflies are: the eye is ~200 u off). The ring is a travelling ripple in the slope
        // (its radial derivative), so it lives in the reflection and the glints, not as a drawn line.
        const tarnRings = (xz) => {
            let slope = vec2(0, 0);
            for (let k = 0; k < T.rings; k += 1) {
                const period = 6.2 + (k * 1.37);
                const clock = uTime.add(k * 2.31).div(period);
                const cycle = floor(clock);
                const age = fract(clock).mul(period);
                const seed = cycle.add(4096 + (k * 977));
                const pick = min(floor(hash(seed.mul(3).add(2)).mul(tarnRingSites.length)), float(tarnRingSites.length - 1));
                const site = uTarnRingSites.element(int(pick));
                const hx = hash(seed.mul(3)).sub(0.5).mul(9);
                const hz = hash(seed.mul(3).add(1)).sub(0.5).mul(9);
                const rel = xz.sub(vec2(site.x.add(hx), site.y.add(hz)));
                const r = length(rel);
                const front = r.sub(age.mul(3.6));
                const life = float(1).sub(smoothstep(float(1.5), float(5.8), age))
                    .mul(smoothstep(float(0.0), float(0.25), age));
                const wave = sin(front.mul(2.2)).mul(exp(front.mul(front).mul(-0.35)));
                slope = slope.add(rel.div(max(r, float(0.05))).mul(wave.mul(life).mul(0.09)));
            }
            return slope;
        };
        // THE WAKES (TARN_WAKE): behind each swan a soft V (the Kelvin angle, ~19.5 deg), its arms
        // a few short crests that travel out, widening and fading over ~26 u; a small bow wave
        // round the breast. They tilt the water (so they live in its reflection and glints) and lift
        // it a little toward white. Returns the slope and the wake's strength.
        const tarnWakes = (xz) => {
            const W = TARN_WAKE;
            let slope = vec2(0, 0);
            let lift = float(0);
            for (let k = 0; k < tarnSwanRows.length; k += 1) {
                const row = uTarnSwans.element(k);
                const speed = max(length(row.zw), float(0.05));
                const f = row.zw.div(speed);
                const side = vec2(f.y.negate(), f.x);
                const rel = xz.sub(row.xy);
                const behind = dot(rel, f).negate();
                const across = dot(rel, side);
                const arm = abs(across).sub(behind.mul(W.spread)).sub(W.bow);
                const width = behind.mul(W.widen).add(W.width);
                const fade = exp(behind.div(-W.reach)).mul(smoothstep(float(-1.2), float(1.6), behind))
                    .mul(min(speed.div(W.fullSpeed), 1.2));
                const crest = sin(behind.mul(W.crests).sub(uTime.mul(2.2))).mul(0.5).add(0.5);
                const amp = exp(arm.div(width).pow2().negate()).mul(fade).mul(crest.mul(0.6).add(0.4));
                const bow = exp(length(rel.sub(f.mul(W.bowAt))).sub(W.bowR).div(0.55).pow2()
                    .negate())
                    .mul(min(speed.div(W.fullSpeed), 1.2)).mul(0.6);
                const outward = side.mul(select(across.greaterThanEqual(0), float(1), float(-1)));
                slope = slope.add(outward.mul(amp.mul(W.tilt))).add(normalize(rel.add(1e-4)).mul(bow.mul(W.tilt)));
                lift = lift.add(amp).add(bow);
            }
            return { slope, lift: min(lift, float(1)) };
        };
        // The swans in the mirror: the reflected ray's nearest pass to each swan's body and neck,
        // a soft white shape (the pond's own ripple breaks it as it breaks everything else).
        const tarnSwanMirror = (P, R) => {
            const W = TARN_WAKE;
            let cover = float(0);
            for (let k = 0; k < tarnSwanRows.length; k += 1) {
                const row = uTarnSwans.element(k);
                const f = row.zw.div(max(length(row.zw), float(0.05)));
                const body = vec3(row.x, float(ODYSSEY_TARN.waterY + W.bodyY), row.y);
                const neck = vec3(row.x.add(f.x.mul(W.neckAt)), float(ODYSSEY_TARN.waterY + W.neckY), row.y.add(f.y.mul(W.neckAt)));
                const passBody = cross(body.sub(P), R);
                const passNeck = cross(neck.sub(P), R);
                const ahead = smoothstep(float(0), float(1), dot(body.sub(P), R));
                cover = max(cover, max(
                    exp(length(passBody).div(W.bodyR).pow2().negate()),
                    exp(length(passNeck).div(W.neckR).pow2().negate()),
                ).mul(ahead));
            }
            return cover;
        };
        const tarnFilm = Fn(() => {
            const depth = tarnDepth.toVar('tarnRootDepth');
            const P = positionWorld.toVar();
            const V = normalize(cameraPosition.sub(P)).toVar();
            // The sea's ripple (ONE WATER), calmed: the same two scrolling fetches and slopes, a
            // third as steep, so the pond's surface has the sea's grain but holds its mirror.
            const ripTex = waterRippleTex(P.xz);
            // The wind's patches (water pass step 4): the pond lies a mirror in the lulls and
            // shivers under a gust, as a sheltered pond does.
            const gust = waterGust(P.xz).toVar();
            const rip = ripTex.a.rg.mul(0.9).add(ripTex.b.rg.mul(0.5))
                .mul(T.calm)
                .mul(mix(float(0.35), float(2.6), gust))
                .add(tarnRings(P.xz))
                .toVar();
            const wake = tarnWakes(P.xz);
            rip.addAssign(wake.slope);
            const N = normalize(vec3(rip.x.negate(), 1, rip.y.negate())).toVar();
            const Rraw = reflect(V.negate(), N);
            const R = normalize(vec3(Rraw.x, max(Rraw.y, 0.004), Rraw.z)).toVar();
            const { tLand, landW } = waterMarchLand(P, R, {
                heightAt: landAt, steps: T.steps, firstStep: T.firstStep, stepGrowth: T.stepGrowth, soft: T.soft,
            });
            const H = P.add(R.mul(tLand)).toVar();
            // ONE WATER: where the ray runs into open sky the pond shows the sea's stepped sky wash
            // and the clouds above it; the land it meets is hazed toward the real air on that ray.
            const reflected = mix(
                mix(
                    waterCloudsAlong(P, R, waterSkyWash(R)),
                    waterLandLit(H, tLand, skyAirAt(R)),
                    landW,
                ),
                vec3(...TARN_WAKE.swanWhite),
                tarnSwanMirror(P, R).mul(0.85),
            );
            // CLEAR WATER (TARN_MIRROR.clarity): the bed shows through by `clear` (the ground draws
            // it, tinted by its depth: TARN_BED), the water's own deep colour stands where it does
            // not, and the mirror lies over both by the Fresnel share. A gust's rough patch mirrors
            // less of the bright sky: cat's paws read darker.
            const clear = exp(depth.mul(-T.clarity)).toVar();
            const fres = waterFresnel(N, V, T.fresnel[0], T.fresnel[1]).mul(mix(float(1), float(0.68), gust)).toVar();
            // The sun: its core and its road on the water, over the baked sun visibility (no
            // glitter field: the owner's rule for water).
            const wVis = texture(sunVisTex, plateUv(P.xz)).r;
            const cloudLight = q.cloudShadows ? cloudShadowLight(P.xz) : float(1);
            const glints = waterSunCore(N, V).add(waterSunRoad(R));
            const deep = vec3(...T.deep).mul(cloudLight.mul(0.3).add(0.7)).mul(wVis.mul(0.18).add(0.82));
            // The film's share of the pixel, and its colour over that share (so what blends in is
            // deep * (1 - clear) * (1 - fres) + mirror * fres over the bed's clear * (1 - fres)).
            const cover = max(float(1).sub(clear.mul(float(1).sub(fres))), float(1e-3)).toVar();
            const film = deep.mul(float(1).sub(clear)).mul(float(1).sub(fres))
                .add(reflected.mul(fres))
                .add(vec3(...WATER_GLINT).mul(glints).mul(wVis).mul(cloudLight))
                .add(vec3(0.92, 0.97, 0.99).mul(wake.lift.mul(TARN_WAKE.whiten)))
                .div(cover);
            return vec4(film, cover);
        })().toVar('tarnFilm');
        const tarnCol = tarnFilm.rgb;
        const tarnAired = applyAerial(tarnCol, positionWorld, AERIAL_CEIL_LAND, AERIAL_RATE_LAND, ...MIST_ONLY);
        tarnMat.colorNode = toOutput(tarnAired);
        // THE SOFT WATERLINE (2026-11-20; the north lake's rule): the film is clear at the
        // waterline and has its full share past `tarnShoreW` of depth, so no edge is drawn.
        // Blended, drawn after the land, no depth written; the sheet's own edge lies on dry ground
        // under the bank (odyssey-tarn-surface.js).
        tarnMat.opacityNode = smoothstep(float(0), tarnShoreW, tarnDepth).mul(tarnFilm.a);
        tarnMat.transparent = true;
        tarnMat.depthWrite = false;
        tarnMat.polygonOffset = true;
        tarnMat.polygonOffsetFactor = 0;
        tarnMat.polygonOffsetUnits = -WATER_SHORE_DEPTH_BIAS;
        tarnMat.side = THREE.FrontSide;
    }
    {
        const sheet = buildTarnSurface();
        const tarnGeo = new THREE.BufferGeometry();
        tarnGeo.setAttribute('position', new THREE.BufferAttribute(sheet.positions, 3));
        tarnGeo.setIndex(new THREE.BufferAttribute(sheet.indices, 1));
        tarnGeo.computeBoundingSphere();
        const tarnMesh = new THREE.Mesh(tarnGeo, tarnMat);
        tarnMesh.matrixAutoUpdate = false;
        tarnMesh.updateMatrix();
        tarnMesh.name = 'odyssey-world-tarn';
        group.add(tarnMesh);
        lakeMeshes.push(tarnMesh);
    }

    // ── THE NORTH LAKE: REAL WATER (2026-11-02), CLEAR AND DRAWN (2026-11-21) ──────────────────
    // Olov (2026-11-02): "Real water for the lake. It would get the same treatment as the swans'
    // pond: reflections of the sky and clouds, a turquoise-to-blue depth colour, and a soft
    // shoreline instead of a hard dark edge." It is the island's one water, the terms the sea and
    // the tarn share (LAKE_WATER):
    //   - the sea's ripple and the wind's gusts, calmed for a big sheltered lake;
    //   - the sky in the reflected direction and the cloud masses above it. No land march: from the
    //     climb the reflected rays rise 30-50 degrees and clear the low banks within a few units;
    //   - CLEAR WATER (2026-11-21, the tarn's): its bed shows through by its depth (the ground draws
    //     it, by the tarn's bed in the lake's units, DRAWN_PAINT: gravel on the shelf, silt and weed
    //     in the basins, seen through a water that takes red first), the lake's own deep colour
    //     stands where the bed does not, and the mirror lies over both by the Fresnel share. So the
    //     turquoise is the gravel shelf under a few units of water, round the shore and the islets,
    //     and the middle is deep blue. It was a pigment in four flat plates, the most saturated
    //     cyan inland in every climb frame, a blot that followed the old lobes;
    //   - a soft shoreline: the film thins to nothing over the last half unit of depth (a couple of
    //     pixels' worth from afar), with no pale line drawn on it (the wet line was an outline).
    // Its depth is read from the plates the ground draws, the lake's plate exact over them
    // (ODYSSEY_NORTH_LAKE_PLATE). One sheet cut to the drawn shore (odyssey-tarn-surface.js),
    // blended like the sea, drawn after the land, no depth written.
    const lakeMat = new THREE.MeshBasicNodeMaterial();
    {
        const L = LAKE_WATER;
        const lakeUv = waterPlateUv(positionWorld.xz);
        const lakeBedTex = texture(macroTex, lakeUv).level(0);
        const lakeSculptUv = positionWorld.xz.sub(vec2(ODYSSEY_SCULPT_PLATE.x, ODYSSEY_SCULPT_PLATE.z))
            .div(float(ODYSSEY_SCULPT_PLATE.extent))
            .add(0.5);
        // The water column over the drawn bed. A var built at the colour Fn's root (its first
        // read), so the opacity below reads the same value.
        const lakeDepth = float(ODYSSEY_NORTH_LAKE.waterY)
            .sub(withWater(
                lakeBedTex.r.add(texture(heightTex, lakeUv).level(0).r.mul(lakeBedTex.g))
                    .add(texture(summitTex, lakeSculptUv).level(0).r),
                texture(lakeTex, lakePlateUv(positionWorld.xz)).level(0),
                ODYSSEY_NORTH_LAKE.waterY,
            ))
            .toVar('lakeDepth');
        // How much depth one pixel spans: the shore's soft band is at least `shorePx` of them wide.
        const lakeDepthPx = abs(dFdx(lakeDepth)).add(abs(dFdy(lakeDepth)));
        const lakeShoreW = max(float(L.shore), lakeDepthPx.mul(L.shorePx));
        const lakeFilm = Fn(() => {
            const depth = lakeDepth.toVar('lakeRootDepth');
            const P = positionWorld.toVar();
            const V = normalize(cameraPosition.sub(P)).toVar();
            const ripTex = waterRippleTex(P.xz);
            const gust = waterGust(P.xz).toVar();
            const dist = length(P.xz.sub(cameraPosition.xz)).toVar();
            // The sea's fine ripple is finer than a pixel from the climb (the detail bake has no
            // mips): it would speckle the clouds in the water. It fades with range, and a broad,
            // slow undulation (the same bake read ~10x coarser, drifting downwind) bends the
            // reflection instead, so the sky's plates and the clouds' edges waver gently.
            const swellTex = texture(detailTex, P.xz.mul(L.swellScale).sub(WATER_WIND.mul(uTime.mul(0.0011))));
            const rip = ripTex.a.rg.mul(0.9).add(ripTex.b.rg.mul(0.5))
                .mul(float(1).sub(smoothstep(float(L.rippleFade[0]), float(L.rippleFade[1]), dist).mul(0.85)))
                .mul(L.calm)
                .add(swellTex.rg.mul(L.swell))
                .mul(mix(float(0.55), float(1.9), gust))
                .toVar();
            const N = normalize(vec3(rip.x.negate(), 1, rip.y.negate())).toVar();
            const Rraw = reflect(V.negate(), N);
            const R = normalize(vec3(Rraw.x, max(Rraw.y, 0.004), Rraw.z)).toVar();
            // The sky and the clouds in the water (the sea's stepped sky wash, the picked masses).
            const reflected = waterCloudsAlong(P, R, waterSkyWash(R));
            // CLEAR WATER: the bed shows through by `clear`; a gust's rough patch mirrors less of
            // the bright sky (cat's paws read darker).
            const clear = exp(depth.mul(-L.clarity)).toVar();
            const fres = waterFresnel(N, V, L.fresnel[0], L.fresnel[1]).mul(mix(float(1), float(0.72), gust)).toVar();
            const wVis = texture(sunVisTex, lakeUv).r;
            const cloudLight = q.cloudShadows ? cloudShadowLight(P.xz) : float(1);
            const glints = waterSunCore(N, V).add(waterSunRoad(R));
            // The water's own colour: turquoise in the first units, deep blue past `blend`.
            const deep = mix(vec3(...L.shallow), vec3(...L.deep), smoothstep(float(L.blend[0]), float(L.blend[1]), depth))
                .mul(cloudLight.mul(0.3).add(0.7))
                .mul(wVis.mul(0.18).add(0.82));
            // The film's share of the pixel, and its colour over that share (the tarn's form).
            const cover = max(float(1).sub(clear.mul(float(1).sub(fres))), float(1e-3)).toVar();
            const film = deep.mul(float(1).sub(clear)).mul(float(1).sub(fres))
                .add(reflected.mul(fres))
                .add(vec3(...WATER_GLINT).mul(glints).mul(wVis).mul(cloudLight))
                .div(cover);
            return vec4(film, cover);
        })().toVar('lakeFilm');
        // THE **LAND** AERIAL, not the sea's (measured on the painted lake, 2026-08): an inland
        // surface inside terrain that hazes at the land rate; on the sea's rate it faded toward
        // the sky ~1.6x faster than its own banks and read washed out.
        lakeMat.colorNode = toOutput(
            applyAerial(lakeFilm.rgb, positionWorld, AERIAL_CEIL_LAND, AERIAL_RATE_LAND, ...MIST_ONLY),
        );
        // The soft shore: clear at the waterline, the film's full share past `lakeShoreW` of depth.
        lakeMat.opacityNode = smoothstep(float(0), lakeShoreW, lakeDepth).mul(lakeFilm.a);
        lakeMat.transparent = true;
        lakeMat.depthWrite = false;
        // The sea's depth bias (THE SHORE'S DEPTH FIGHT): the undecided line lies on the dry bank,
        // where the film is exactly clear, instead of on the waterline.
        lakeMat.polygonOffset = true;
        lakeMat.polygonOffsetFactor = 0;
        lakeMat.polygonOffsetUnits = -WATER_SHORE_DEPTH_BIAS;
        // No alphaTest (a discard): through chapters 3-4 the lake is in frame but behind the
        // massif, and the depth test should reject it before it shades. A clear film just blends.
        lakeMat.side = THREE.FrontSide;
    }
    {
        const sheet = buildNorthLakeSurface();
        const lakeGeo = new THREE.BufferGeometry();
        lakeGeo.setAttribute('position', new THREE.BufferAttribute(sheet.positions, 3));
        lakeGeo.setIndex(new THREE.BufferAttribute(sheet.indices, 1));
        lakeGeo.computeBoundingSphere();
        const lakeMesh = new THREE.Mesh(lakeGeo, lakeMat);
        lakeMesh.matrixAutoUpdate = false;
        lakeMesh.updateMatrix();
        lakeMesh.name = 'odyssey-world-north-lake';
        group.add(lakeMesh);
        lakeMeshes.push(lakeMesh);
    }

    // ── THE SHOWER (round three, 2026-10-31; odyssey-shower.js) ──────────────────────────────
    // A soft COLUMN of rain under each storm mass (the field's rain cloud), and the bow IN it.
    // Each column is an elliptic cylinder shaped from its cloud's base, tucked into it at the top,
    // leaning a little in the wind down to the ground or the sea. A closed proxy hull is drawn; each
    // pixel works out, in closed form, how much rain its view ray crosses: the density falls off
    // as (1 - r^2) across the column, so the integral along the chord is exact and smooth, densest
    // through the middle and fading to nothing at the column's edge (no noise, no hard edge). The
    // rain takes its cloud's shaded base colour where it leaves it and turns to a sunlit silver
    // lower down (the sun is behind every eye that sees the bow); a few broad, soft bands drift down
    // it. The bow is drawn in it at the true angle round the antisolar point (`bowSpectrum`),
    // brightest where the rain is thickest. World geometry: the climb leaves it below with the
    // clouds. (A first cut of flat strips of fine streaks read as dark noise, not as rain.)
    const showerMat = new THREE.MeshBasicNodeMaterial();
    const showerMesh = (() => {
        // One volume along the whole line (odyssey-shower.js `showerBowVolume`): the bow's rain.
        const columns = [showerBowVolume()];
        // A unit cylinder, y 0 (top) .. 1 (foot), capped: front faces cover the column's whole
        // silhouette from any side, above it too. A little proud of the ellipse, so the analytic
        // edge is never clipped by the hull.
        const hull = new THREE.CylinderGeometry(1.03, 1.03, 1, 28, 1, false);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = hull.index;
        geo.setAttribute('position', hull.getAttribute('position'));
        const aA = new Float32Array(columns.length * 4);
        const aB = new Float32Array(columns.length * 4);
        const aC = new Float32Array(columns.length * 4);
        columns.forEach((c, k) => {
            aA.set([c.x, c.z, c.top, c.bottom], k * 4);
            aB.set([c.rx, c.rz, c.cos, c.sin], k * 4);
            aC.set([c.leanX, c.leanZ, c.seed, 0], k * 4);
        });
        geo.setAttribute('aColA', new THREE.InstancedBufferAttribute(aA, 4));
        geo.setAttribute('aColB', new THREE.InstancedBufferAttribute(aB, 4));
        geo.setAttribute('aColC', new THREE.InstancedBufferAttribute(aC, 4));
        geo.instanceCount = columns.length;
        const cA = attribute('aColA', 'vec4');
        const cB = attribute('aColB', 'vec4');
        const cC = attribute('aColC', 'vec4');
        // The hull in the world: its unit ring scaled to the ellipse and turned to the mass's axis,
        // sheared by the lean (none at the top, all of it at the foot).
        const down = float(0.5).sub(positionGeometry.y);
        const ringX = positionGeometry.x.mul(cB.x);
        const ringZ = positionGeometry.z.mul(cB.y);
        showerMat.positionNode = vec3(
            cA.x.add(ringX.mul(cB.z)).sub(ringZ.mul(cB.w)).add(cC.x.mul(down)),
            mix(cA.z, cA.w, down),
            cA.y.add(ringX.mul(cB.w)).add(ringZ.mul(cB.z)).add(cC.y.mul(down)),
        );
        showerMat.outputNode = Fn(() => {
            const shTop = cA.z.toVar();
            const shFoot = cA.w.toVar();
            const shH = shTop.sub(shFoot).toVar();
            const shO = cameraPosition.toVar();
            const shHullP = vec3(
                cA.x.add(ringX.mul(cB.z)).sub(ringZ.mul(cB.w)).add(cC.x.mul(down)),
                mix(cA.z, cA.w, down),
                cA.y.add(ringX.mul(cB.w)).add(ringZ.mul(cB.z)).add(cC.y.mul(down)),
            );
            const shD = normalize(varying(shHullP, 'vShowerHull').sub(shO)).toVar();
            // The ray in the column's unsheared, unit frame: u(t) = shA + shB t.
            const shE1 = vec2(cB.z, cB.w);
            const shE2 = vec2(cB.w.negate(), cB.z);
            const shLean = vec2(cC.x, cC.y);
            const shRayA = shO.xz.sub(cA.xy).sub(shLean.mul(shTop.sub(shO.y).div(shH)));
            const shRayB = shD.xz.add(shLean.mul(shD.y.div(shH)));
            const shA = vec2(dot(shRayA, shE1).div(cB.x), dot(shRayA, shE2).div(cB.y)).toVar();
            const shB = vec2(dot(shRayB, shE1).div(cB.x), dot(shRayB, shE2).div(cB.y)).toVar();
            const shBb = max(dot(shB, shB), float(1e-12)).toVar();
            const shAb = dot(shA, shB);
            const shDisc = shAb.mul(shAb).sub(shBb.mul(dot(shA, shA).sub(1))).toVar();
            const shHalf = sqrt(max(shDisc, float(0))).div(shBb).toVar();
            const shMid = shAb.negate().div(shBb).toVar();
            // ...and between the shFoot and the cloud base, in front of the eye.
            const shTA = shFoot.sub(shO.y).div(shD.y);
            const shTB = shTop.sub(shO.y).div(shD.y);
            const shLo = max(max(shMid.sub(shHalf), min(shTA, shTB)), float(0));
            const shHi = min(shMid.add(shHalf), max(shTA, shTB));
            // The density (1 - r^2) integrated exactly over [shLo, shHi], in the chord's own centred
            // coordinate (x = t - shMid, |x| <= shHalf: small numbers, no cancellation).
            const shXl = clamp(shLo.sub(shMid), shHalf.negate(), shHalf);
            const shXh = clamp(shHi.sub(shMid), shHalf.negate(), shHalf);
            const shPrim = (x) => shHalf.mul(shHalf).mul(x).sub(x.mul(x).mul(x).div(3));
            const shDepth = max(shPrim(shXh).sub(shPrim(shXl)), float(0)).mul(shBb).mul(tslStep(float(0), shDisc)).toVar();
            // Where along its height the ray crosses it: thinning to its shFoot, melting into the base.
            const shTMid = shLo.add(shHi).mul(0.5);
            const shYMid = shO.y.add(shD.y.mul(shTMid));
            const shUp01 = clamp(shYMid.sub(shFoot).div(shH), 0, 1).toVar();
            // Soft at the sea and melting away under the cloud base.
            const shVertical = smoothstep(float(0.0), float(0.10), shUp01)
                .mul(float(1).sub(smoothstep(float(0.80), float(1.0), shUp01)));
            // How much of this ray's way lies in the (unseen) rain: the bow's mask.
            const shRain = float(1).sub(exp(shDepth.mul(SHOWER_LOOK.density).mul(shVertical).negate()))
                .mul(uBow)
                .toVar();
            // The bow and the sky's own light round it, all light added (no veil): the spectrum with
            // its supernumeraries, the glow inside the primary, and Alexander's band between the
            // two bows as a faint darkening of whatever is behind (the alpha of a premultiplied over).
            const shTheta = acos(clamp(dot(shD, uSunDir.negate()), -1, 1)).mul(57.29578).toVar();
            const shSky = bowSkyLight(shTheta);
            const shLight = bowSpectrum(shTheta).mul(ODYSSEY_BOW.gain * SHOWER_LOOK.bowGain).mul(uSunColour)
                .add(uSunColour.mul(shSky.glow.mul(SHOWER_LOOK.glow)))
                .mul(shRain);
            // The air between: a far bow is a little softer than a near one.
            const shAt = shO.add(shD.mul(shTMid));
            const shAir = clamp(float(1).sub(exp(length(shAt.sub(shO)).mul(uAerialK).negate())), 0, 0.6);
            const shDark = shSky.band.mul(SHOWER_LOOK.band).mul(shRain);
            return vec4(toOutput(shLight.mul(float(1).sub(shAir.mul(0.5)))), shDark);
        })();
        showerMat.transparent = true;
        showerMat.premultipliedAlpha = true;
        showerMat.depthWrite = false;
        showerMat.side = THREE.FrontSide;
        const mesh = new THREE.Mesh(geo, showerMat);
        mesh.frustumCulled = false;
        // After the sea (1): the rain over it stands in front of the water behind it.
        mesh.renderOrder = 5;
        mesh.name = 'odyssey-world-shower';
        return mesh;
    })();
    group.add(showerMesh);

    // ── sky ──
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const skyDir = normalize(positionWorld.sub(cameraPosition));
    // The dome's gradient and its departure pace measured from the Earth's limb while the Earth is
    // there (THE HORIZON IS THE LIMB); the sun, the cirrus and the limb line keep the level.
    const skyUpY = limbUp(skyDir.y);
    const skyGradDir = vec3(skyDir.x, skyUpY, skyDir.z);
    // The dome's own sun: the world sun, sinking in the sky through chapter 5's evening (the
    // APPARENT sun of odyssey-evening.js; everywhere else it IS uSunDir, value for value).
    const uSkySun = ODYSSEY_EVENING_U.sunDir;
    // THE HIGH SKY (odyssey-high-clouds.js): cirrus and altocumulus, each on its own shell, over the gradient.
    const highSky = createHighClouds({ load: clouds });
    const skyAir = highSky.over({
        base: eveningDome(skyAirAt(skyGradDir), skyDir, uSunColour),
        dir: skyDir,
        eye: cameraPosition,
        time: uTime,
        sunDir: uSkySun,
        sunColour: uSunColour,
        shade: mix(skyColourFor(float(0.30)), vec3(0.78, 0.82, 0.92), float(0.35)),
        hour: eveningCirrusColour,
        coverOf: eveningCirrusCover,
        // ...and gone as the departure darkens the zenith: the eye is climbing out of the air.
        keep: float(1).sub(smoothstep(float(0.0), float(0.3), uFadeZenith)),
    })
        .add(vec3(1, 0.86, 0.66).mul(
            smoothstep(float(0.90), float(1), dot(skyDir, uSkySun)).pow(3).mul(0.3),
        ))
        .add(vec3(1, 0.97, 0.9).mul(
            smoothstep(float(0.9985), float(0.9995), dot(skyDir, uSkySun)).mul(2.2),
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
        mix(
            mix(uWaterMid, skyColourSubmergedGraze.mul(0.42), float(0.35)),
            uWaterLum.mul(0.85),
            float(0.40),
        ),
        clamp(downwelling, 0, 1),
    );
    // ZENITH FIRST (item 10): overhead runs ahead of the act fade, the horizon behind it, and
    // a thin limb + airglow line glow at the horizon while the sky is half gone. With
    // uWorldFade at 0 every term here is exactly the old sky.
    const skyFade = mix(fadeBelowHorizon(skyUpY), uFadeZenith, smoothstep(float(-0.05), float(0.55), skyUpY));
    // UNIFORM-GATED (seamless pass): the water dome only under water, the limb + airglow (two
    // exps and two pows per sky pixel) only while the departure lights them. Both were built for
    // every sky fragment of the act and multiplied away by a zero uniform — not dead code here.
    // `skyAir` and `skyDir` are built at the root first, so neither branch can starve the other.
    const skyShaded = Fn(() => {
        const base = skyAir.toVar('skyBaseCol');
        // (The rainbow and its shower are no longer painted on the dome: since round three they
        // are the world's own, the shower's rain curtains under its rain cloud. See THE SHOWER.)
        If(uSubmerged.greaterThan(0.001), () => { base.assign(mix(skyAir, skyWater, uSubmerged)); });
        const out = toOutputFaded(base, skyFade).toVar('skyOutCol');
        If(uLimbGlow.greaterThan(0.0001), () => {
            // THE LIMB HAS A SUNLIT SIDE (all-angles pass, 2026-10-18). One band of equal
            // brightness all the way round read as a glowing tube from every heading at the top
            // of the climb. The arc now burns toward the sun's azimuth and falls to a faint
            // night-side rim behind, and thins as it goes — the curve of a real limb.
            const skyFlat = normalize(skyDir.xz.add(vec2(1e-4, 0)));
            const limbAz = dot(skyFlat, normalize(vec2(uSunDir.x, uSunDir.z)))
                .mul(0.5).add(0.5);
            const limbWidth = mix(float(0.026), float(0.05), limbAz);
            // The drawn edge's elevation along this azimuth (see uEyeH above). Above it the limb
            // fades into the dark at limbWidth; below it the sea covers the dome, and the short
            // lower tail only closes the seam where the planar cut is approximated.
            const edgeDist = min(uViewFar.div(max(dot(skyFlat, uViewFwdXZ), 0.3)), uSeaReach);
            const edgeY = uEyeH.negate().div(sqrt(uEyeH.mul(uEyeH).add(edgeDist.mul(edgeDist))));
            const limbRise = skyDir.y.sub(edgeY.add(0.004));
            const limbBand = exp(pow2(limbRise.div(select(limbRise.greaterThan(0), limbWidth, float(0.008)))).negate())
                .mul(mix(float(0.22), float(1.25), limbAz.mul(limbAz)));
            const airglowBand = exp(pow2(skyDir.y.sub(uAirglowSin).div(0.012)).negate());
            const airglowYield = float(1).sub(uAuroraGlow.mul(0.8));
            out.assign(out.add(vec3(...DEPART_LIMB).mul(limbBand).mul(uLimbGlow.mul(uLimbYield))
                .add(vec3(...DEPART_AIRGLOW).mul(airglowBand.mul(0.45).mul(airglowYield)).mul(uAirglowGlow.mul(uLimbYield)))
                .mul(uOutputScale)
                .mul(float(1).sub(uSubmerged))));
        });
        // THE EVENING'S LIGHTS (odyssey-evening.js): the moon over the summit, the first stars, a
        // shooting star. Over the fade (they come out as the sky darkens), and gone with the
        // world's own sky at the end of the departure, where chapter 6's stars take over.
        If(ODYSSEY_EVENING_U.moon.greaterThan(0.001), () => {
            out.addAssign(eveningLights(skyDir).mul(uOutputScale)
                .mul(float(1).sub(smoothstep(float(0.62), float(1.0), uWorldFade)))
                .mul(float(1).sub(uSubmerged)));
        });
        return out;
    })();
    skyMat.colorNode = skyShaded;
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
    // ── THE SWELL (painted-water Wave 2) ──────────────────────────────────────────────
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
    // (sin(k dir.x + w t) travels toward -dir. 2026-11-20: the long swell turned to roll in on
    // the south beach the shore orbs face, the second crossing it along the shore, the chop
    // angled in; the long swell used to slide sideways along the beach and the sea heaved in place.)
    const WAVES = [
        {
            dirX: -0.24, dirZ: 0.97, len: 54, amp: 1.30, speed: 0.85,
        },
        {
            dirX: 0.94, dirZ: 0.34, len: 31, amp: 0.72, speed: 1.15,
        },
        {
            dirX: 0.55, dirZ: 0.83, len: 19, amp: 0.34, speed: 1.55,
        },
    ];
    // Wavelengths halved from the first cut (110/62/37 m): at the shoreline station the sea
    // spans ~300 m, so a 110 m dominant wave put only two or three crests in the entire frame
    // and the foam read as isolated patches rather than a running sea. 54/31/19 m keeps every
    // wave clear of the 13 m geometric floor while roughly doubling the crest count in view.
    /** Summed amplitude — the normaliser the whitecap threshold is expressed against. */
    const WAVE_AMP_SUM = 2.36;
    /** The wave field's RMS slope (~0.168): what the sea's land mirror softens by (SEA_MIRROR.blur). */
    const WAVE_RMS_SLOPE = Math.sqrt(WAVES.reduce((s, wv) => s + ((((2 * Math.PI * wv.amp) / wv.len) ** 2) / 2), 0));
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
    // THE SWASH, AS GEOMETRY. The shoreline vertices rise and fall on the shared run-up clock,
    // so the depth test against the beach draws a waterline that LAPS — the sea's edge was a
    // fixed contour for the life of this plate. Gated to the last few metres of bed (the full
    // relief, not the macro alone: the beach is relief detail), and vertical only, like the
    // swell — horizontal motion would tear the clipmap's morph seams.
    const wVertBedFull = wVertBed.r.add(texture(heightTex, wVertUv).level(0).r.mul(wVertBed.g));
    const wShoreGateV = float(1).sub(smoothstep(float(1.0), float(6.0), float(ODYSSEY_SEA_LEVEL).sub(wVertBedFull)));
    const swashVert = swashRise(w.worldXZ).mul(wShoreGateV);
    waterMat.positionNode = vec3(w.worldXZ.x, float(ODYSSEY_SEA_LEVEL).add(swell).add(swashVert), w.worldXZ.y);
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
        .sub(bedTex.r.add(texture(heightTex, wUv).level(0).r.mul(bedTex.g))).toVar();
    // (`depthLive` — the water column under the LIVE, swash-raised surface — is built with the
    // shore foam below, inside the topside regime: see `shoreTerms`.)
    // ── THE PAINTED SEA (painted-water Wave 1) ────────────────────────────────────────
    // Was: two smooth mixes over hardcoded vec3s with band edges at 0-18 m and 18-103 m.
    // MEASURED problem: the median visible bed depth is 49.6 m at the shoreline station and
    // 133 m just past the breach, so both of the journey's largest water views sat inside
    // that ramp's flat upper region — one colour, no structure, exactly the "flat steel-blue
    // sheet" the capture critique found. Now: a Beer-Lambert depth driver tuned so the
    // measured range spans the whole ramp, quantised into flat plates, over the four-stop
    // pigment ramp the colour script owns (viridian -> cerulean -> cobalt -> Prussian):
    // `waterRampBody`, shared with the tarn since ONE WATER (2026-10-31).
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
    // The whole texel is kept, not just `.rg`: `.b` (the scalar value noise the derivatives were
    // taken from) is the free break-up field for the topside glitter and the shore foam — same
    // fetch, no new sampler. First built at the Fn root through the `wN` pin, so a branch that
    // reads `.b` reuses the root's sample rather than starving (the root-pin note below).
    // (ONE WATER: the fetches are `waterRippleTex`, shared with the tarn.)
    const seaRipples = waterRippleTex(positionWorld.xz);
    const rippleTexA = seaRipples.a;
    const rippleTexB = seaRipples.b;
    const rippleA = rippleTexA.rg;
    const rippleB = rippleTexB.rg;
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
    const waveSlope = vec2(wFrag.dx, wFrag.dz).mul(wFragFade).toVar();
    // The wind's patches roughen the chop (water pass step 4): calm lanes hold the mirror, gusts
    // break it and glitter.
    const seaGust = waterGust(positionWorld.xz).toVar();
    const rippleSlope = ripple.mul(vSwellFade).mul(mix(float(0.70), float(1.45), seaGust)).mul(uSeaChop).toVar();
    const wSlope = waveSlope.add(rippleSlope).toVar();
    const wN = normalize(vec3(wSlope.x.negate(), 1, wSlope.y.negate())).toVar();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const spec = waterSunCore(wN, viewDir);
    const grazing = float(1).sub(clamp(abs(dot(wN, viewDir)), 0, 1));
    // WAVE 5 — the MENISCUS: while the eye is within ~6 u of the plane, the extreme-grazing
    // sliver of the surface lights as a thin bright line — the crossing cue that makes the
    // breach one event instead of a fade. Rides `grazing`, so it IS the waterline.
    const meniscus = smoothstep(float(0.93), float(0.995), grazing).mul(uBreachNear).mul(0.9);
    // ── THE SHORE (item 2): foam rings that travel in, a swash front that laps ──────────
    // Was a STATIC brightening band at the waterline: a beach that never moved. Now:
    //  · RINGS — iso-depth foam lines out to ~10 m of water (waves refract onto the depth
    //    contours, so iso-depth IS where a real shore's foam lines sit), marching shoreward at
    //    a constant rate and broken into lace by the ripple fetch's own scalar channel. The
    //    band is deliberately wider than a physical surf zone: this island's beach shelves at
    //    ~0.6, so the 0.1-3.5 m zone is 2-6 px tall from every rail camera and its lines
    //    collapsed into their own anti-aliasing mean — measured from the first capture.
    //    Anti-aliased by their own footprint: where a ring spacing shrinks under ~1.5 px the
    //    lines collapse to a faint mean instead of shimmering — kept FAINT, because a band at
    //    range that brightens uniformly is exactly the "shore band reads as fog" failure.
    //  · FRONT — a thin foam lip riding the live waterline (`depthLive` ~ 0), so the edge the
    //    swash vertices draw is always a foam edge.
    // `opacityNode` reads both terms too (foam is opaque where the water film under it is not),
    // so they are VARS declared out here, pinned at the Fn root (depthLive = depth there), and
    // only REFINED inside the topside regime below.
    //
    // ⚠️ TOPSIDE-ONLY, the seamless pass's ch2 regression hunt. These shipped as root terms that
    // every water fragment paid in BOTH regimes — a swash clock (fract + two smoothsteps), a
    // fract ring field with its own screen-space derivative pair, and nine more smoothsteps —
    // so the whole underwater ceiling (most of every ch2 frame: the ascent looks straight up at
    // it) computed shore foam it could never show; the shore is 100s of u away and the
    // underside branch never reads them. Under water `depthLive` is just `depth` (the swash only
    // moves the last 6 m of shore) and the foam is exactly 0, which is what the shoreline
    // opacity terms reduce to there anyway. uSubmerged is a uniform, so the If is coherent and
    // the derivatives sit in uniform control flow (WGSL requires it).
    const depthLive = depth.toVar('wDepthLive');
    const shoreFoam = float(0).toVar('wShoreFoam');
    const buildShoreFoam = () => {
        // The water column under the LIVE surface: `depth` plus the swash run-up the vertex stage
        // applied (same clock, same gate), so the foam front sits exactly on the drawn waterline.
        depthLive.assign(depth
            .add(swashRise(positionWorld.xz).mul(float(1).sub(smoothstep(float(1.0), float(6.0), depth)))));
        // (The iso-depth rings and the 0.75 m swash front are gone, 2026-11-21: on this steep bed
        // they were hairlines and a pencil rim. The surf below is measured across the water.)
        // THE SURF LINE FROM AFAR (2026-11-02, "a soft white line of foam"). The front lives in
        // the last 0.75 m of depth and the rings collapse to their faint mean with range, so a
        // coast seen from the climb had no white line at all. Once a pixel spans more than ~0.3 m
        // of depth, a soft line takes over on the waterline: about three pixels wide, measured in
        // the depth's own screen footprint, so it keeps its width at any range and on any slope.
        // It swells as the swash runs up and is broken along the coast by a slow drifting field.
        // Far off, where one pixel spans the whole surf zone (the east isle from the climb), it
        // thins: the foam is only part of what that pixel sees.
        // It reaches a pixel over the dry side too (opacity follows the foam), so the coast
        // shades softly into the sand instead of stopping at a line.
        const depthPx = max(abs(dFdx(depthLive)).add(abs(dFdy(depthLive))), float(1e-3));
        const surfPx = depthLive.div(depthPx);
        const swashPulse = swashRise(positionWorld.xz).sub(SWASH_BASE).div(SWASH_RUN);
        const surfBreak = texture(detailTex, positionWorld.xz.mul(SEA_SURF.breakScale)
            .add(vec2(uTime.mul(0.0031), uTime.mul(-0.0023)))).b;
        const surfWidth = mix(float(SEA_SURF.widthPx[0]), float(SEA_SURF.widthPx[1]), swashPulse);
        const surfLine = smoothstep(float(-1.0), float(0.4), surfPx)
            .mul(float(1).sub(smoothstep(float(1.0), surfWidth, surfPx)))
            .mul(mix(float(SEA_SURF.broken), float(1), smoothstep(float(0.30), float(0.62), surfBreak)))
            .mul(smoothstep(float(0.3), float(1.2), depthPx))
            .mul(float(1).sub(smoothstep(float(SEA_SURF.thinPx[0]), float(SEA_SURF.thinPx[1]), depthPx)
                .mul(1 - SEA_SURF.thinKeep)))
            .mul(SEA_SURF.gain);
        // THE SURF, BREAKING (SEA_SURF_BREAK, 2026-11-21 sea audit, item 16): across the water, on
        // the long swell's own clock. The bed's slope and the way out to sea come from texels
        // already fetched; `xs` is the way (u) from the still waterline out to this water.
        const SB = SEA_SURF_BREAK;
        const sW0 = WAVES[0];
        const sK1 = (Math.PI * 2) / sW0.len;
        const sKS = sW0.speed / SB.boreSpeed;
        const bedRel = texture(heightTex, wUv).level(0);
        const bedGrad = vec2(bedRel.g.mul(bedTex.g).add(bedTex.b), bedRel.b.mul(bedTex.g).add(bedTex.a)).toVar();
        const bedSlope = max(length(bedGrad), float(SB.slopeMin)).toVar();
        const nSea = bedGrad.negate().div(bedSlope).toVar();
        const xs = min(depth.div(bedSlope), float(200)).toVar();
        const xb = clamp(float(SB.breakDepth).div(bedSlope), SB.breakX[0], SB.breakX[1]).toVar();
        // Seaward of the break: the swell's crest itself. Inside it: shore-parallel, slowed to the
        // bores' speed (the refraction comes by construction). Whole numbers on the crests.
        const surfC = dot(positionWorld.xz, vec2(sW0.dirX, sW0.dirZ)).mul(sK1)
            .add(uTime.mul(sW0.speed))
            .add(float(sKS).sub(dot(nSea, vec2(sW0.dirX, sW0.dirZ)).mul(sK1)).mul(min(xs.sub(xb), float(0))))
            .sub(Math.PI / 2)
            .div(Math.PI * 2)
            .toVar();
        const surfCPx = fwidth(surfC).toVar();
        // Strongest at the points, calmer in the bays (the relief here: above 0 a point).
        const surfStr = mix(float(SB.exposure), float(1), smoothstep(float(-0.3), float(0.7), dot(nSea, vec2(sW0.dirX, sW0.dirZ))))
            .mul(mix(float(0.75), float(1.2), smoothstep(float(-4), float(5), bedRel.r.mul(bedTex.g))))
            .mul(SB.gain)
            .toVar();
        const surfNear = float(1).sub(smoothstep(float(0.3), float(1.2), depthPx)).toVar();
        const surfLaceB = rippleTexB.b.toVar('wSurfLaceB');
        const bores = float(0).toVar('wSurfBores');
        // (Per pixel: only explicit-LOD reads and ALU in here.)
        If(xs.lessThan(SB.reach).and(surfNear.greaterThan(0.001)), () => {
            const u = fract(surfC).toVar();
            const seed = fract(floor(surfC).mul(vec2(0.618, 0.414)));
            // Each bore its own world-anchored field: the foam it leaves stays where it was left.
            const boreTex = texture(detailTex, positionWorld.xz.mul(0.022).add(seed)).level(0);
            const seg = smoothstep(float(0.30), float(0.48), boreTex.b).toVar();
            const laceN = surfLaceB.mul(0.6).add(clamp(boreTex.a.sub(0.42).mul(3.57), 0, 1).mul(0.4)).toVar();
            const age = clamp(xb.sub(xs).div(xb), 0, 1);
            const surfZone = float(1).sub(smoothstep(xb.sub(1.5), xb.add(2), xs)).mul(smoothstep(float(-0.3), float(0.5), xs));
            const lipW = max(mix(float(SB.lip * 0.35), float(SB.lip), seg), surfCPx.mul(1.5));
            const lip = float(1).sub(smoothstep(lipW.mul(0.4), lipW, u)).mul(smoothstep(float(0), surfCPx.add(1e-4), u));
            const tk = clamp(u.div(mix(float(SB.trail[0]), float(SB.trail[1]), age)), 0, 1);
            const th = mix(float(SB.lace[0]), float(SB.lace[1]), tk);
            const lace = smoothstep(th, th.add(0.12), laceN);
            const trail = float(1).sub(smoothstep(float(0.55), float(1), tk));
            // The crest whitens as it shoals, on the real swell crest.
            const feather = float(1).sub(smoothstep(xb.add(0.5), xb.add(SB.feather), xs))
                .mul(float(1).sub(smoothstep(float(0), float(0.035), u)))
                .mul(smoothstep(float(0), surfCPx.add(1e-4), u))
                .mul(0.45)
                .mul(seg);
            // White water lying along the edge of the live water, about a unit across.
            const xl = depthLive.div(bedSlope);
            const edge = float(1).sub(smoothstep(float(0.1), float(1.1), xl))
                .mul(smoothstep(float(-0.3), float(0.1), xl))
                .mul(smoothstep(float(0.35), float(0.5), laceN))
                .mul(0.7);
            const crisp = surfZone.mul(max(lip.mul(mix(float(0.6), float(1), seg)), trail.mul(lace).mul(0.85))).add(feather);
            bores.assign(mix(surfZone.mul(0.2), crisp, float(1).sub(smoothstep(float(0.06), float(0.16), surfCPx)))
                .add(edge)
                .mul(surfStr)
                .mul(surfNear));
        });
        shoreFoam.assign(clamp(max(bores, surfLine), 0, 1));
    };
    // ── THE REGIME BRANCH (MEASURED, and it pays for the whole painterly package) ────────
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
        // ORDER MATTERS: `wN` first, because building it builds both ripple fetches at the root —
        // the topside's shore-foam block reads their `.b` inside its branch, and a texel first
        // sampled there would leave the underside reading a zero-initialised sample.
        wN.toVar('wRootN');
        depth.toVar('wRootDepth');
        // The shore vars' ROOT values (depthLive = depth, foam = 0) — what the underside and
        // opacityNode read when the topside branch is skipped.
        depthLive.toVar('wRootDepthLive');
        shoreFoam.toVar('wRootShoreFoam');
        spec.toVar('wRootSpec');
        grazing.toVar('wRootGrazing');
        // How far off the sea lies (root, before the branch): its plates melt into a wash past ~1 km.
        const seaFar = smoothstep(float(600), float(1500), length(positionWorld.sub(cameraPosition))).toVar('wSeaFar');
        const col = vec3(0).toVar('waterRegimeCol');
        If(uSubmerged.lessThan(0.999), () => {
            // The swash-raised column + the shore foam (see `buildShoreFoam`): topside only.
            buildShoreFoam();
            // ── TOPSIDE: the painted sea (Wave 1) + whitecaps (Wave 2) ──
            // exp2 absorption, not a linear lerp: near-shore metres get the resolution
            // they need while the deep saturates instead of clipping.
            const wT = clamp(
                float(1).sub(exp2(depth.mul(-ODYSSEY_WATER_RAMP.absorptionPerMetre * SEA_ABSORB_GAIN))),
                0,
                1,
            ).toVar();
            // QUANTISE into flat plates with an anti-aliased edge (`waterRampBody`, ONE WATER).
            // A hard floor() posterise aliases badly at 720p on a surface this size.
            const body = waterRampBody(wT, SEA_RAMP, seaFar);
            // FROM ABOVE, THE FAR RIPPLE IS FINER THAN A PIXEL (2026-11-02): the detail bake has
            // no mips, so a reflected ray jittered by it flickers in and out of a cloud's outline,
            // and the clouds in the sea under the climb came out speckled (and the fresnel's share
            // of them grainy). Where the eye looks down on far water, the reflection and its share
            // ride the swell and a little of the ripple. The shore orbs look along the water (under
            // the gate), so their sea is unchanged.
            // ...and wherever a pixel spans metres of water at all (2026-11-20): past ~300 u from a
            // shore eye a pixel took a different random tilt of the mip-less ripple every frame,
            // and the far sea crawled. Settled by the pixel's own footprint, the far sea mirrors
            // the swell (and the clouds and the sky plates steadily) instead of noise.
            const seaFoot = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz))).toVar('wSeaFoot');
            // (The settle pinned, 2026-11-21: the far gloss reads it too, SEA_GLOSS.)
            const seaSettle = max(
                smoothstep(float(1.5), float(8.0), seaFoot),
                smoothstep(float(SEA_HORIZON_DOWN[0]), float(SEA_HORIZON_DOWN[1]), viewDir.y)
                    .mul(smoothstep(float(250), float(900), wFragDist)),
            ).toVar();
            const reflRipple = float(1).sub(seaSettle.mul(0.95));
            const seaGloss = seaSettle.mul((WAVE_RMS_SLOPE / Math.SQRT2) * SEA_GLOSS.slopeGain).toVar();
            // FINE CHOP UNDER THE EYE (2026-11-20; gotcha #210): the near sea read as gel, the
            // two ripple fetches a tenth of the swell's slope and nothing finer than ~1 u. A third,
            // finer fetch (~0.33 u cells) is kept only where its cells span ~4 px or more (so it
            // never becomes grain): it tilts the mirror, and its facets lift or sink the BODY by
            // how they face the sun, which is most of a near pixel. High tier.
            const chop = vec2(0, 0).toVar();
            if (q.waterReflections) {
                const chopFoot = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)));
                const chopKeep = float(1).sub(smoothstep(float(0.035), float(0.09), chopFoot)).mul(vSwellFade);
                chop.assign(texture(detailTex, positionWorld.xz.mul(0.13).add(vec2(uTime.mul(0.034), uTime.mul(-0.026)))).rg
                    .mul(mix(float(2.2), float(3.6), seaGust)).mul(chopKeep));
            }
            const chopFacet = clamp(chop.x.mul(SEA_SUN_FLAT[0]).add(chop.y.mul(SEA_SUN_FLAT[1])).mul(-1.6), -0.16, 0.16).add(1).toVar();
            // A STEADY NEAR SEA (SEA_SWELL_TILT, 2026-11-21): near the eye the reflection rides only
            // part of the swell's tilt (the ripple's whole), so the sky's share and the mirrored shore
            // stop swinging across the foreground once a wave; past the range it is today's normal.
            const swellTilt = mix(
                float(SEA_SWELL_TILT.near),
                float(1),
                smoothstep(float(SEA_SWELL_TILT.range[0]), float(SEA_SWELL_TILT.range[1]), length(positionWorld.sub(cameraPosition))),
            );
            const waveSlopeTop = waveSlope.mul(swellTilt).toVar();
            const wNTop = normalize(vec3(
                waveSlopeTop.x.add(wSlope.x.sub(waveSlope.x)).negate(),
                1,
                waveSlopeTop.y.add(wSlope.y.sub(waveSlope.y)).negate(),
            ));
            const reflN = normalize(mix(vec3(waveSlopeTop.x.negate(), 1, waveSlopeTop.y.negate()), wNTop, reflRipple)
                .add(vec3(chop.x.negate(), 0, chop.y.negate())));
            // FRESNEL TWO-TONE, then the sun glint over the baked sun visibility. painterly
            // water is not a mirror: the sky arrives as a colour wash, never an image.
            const fres = waterFresnel(reflN, viewDir, 0.62, 0.05).mul(mix(float(1), float(0.78), seaGust));
            const wVis = texture(sunVisTex, wUv).r;
            // THE SKY IN THE REFLECTED DIRECTION, not one constant (`skyColourFor(0.22)` was
            // the whole sea's sky for the life of this graph). Near water reflects high sky
            // (deeper blue), far water reflects the horizon (pale) — the gradient a flat
            // constant could never paint. QUANTISED on the sky's own sqrt curve into four
            // plates with an anti-aliased riser, so the ripple normal bends each plate edge
            // into the wobbling bands of painted water instead of a smooth airbrush ramp.
            // ALU only: the sky is analytic.
            const reflDir = reflect(viewDir.negate(), reflN).toVar();
            // Lifted a quarter up the curve (`waterSkyWash`): the bottom plate is grazing horizon,
            // which is the palest colour in the palette, and unlifted it bleached the whole
            // mid-distance sea to milk in the first capture. Painted seas hold their blue to the
            // haze line; the horizon dissolve below still owns the far convergence.
            // ...and the clouds above it (water pass step 2).
            const skyRefl = waterCloudsAlong(positionWorld, reflDir, waterSkyWash(reflDir), {
                v: seaGloss.mul(2).toVar(),
                h: seaGloss.mul(2).mul(clamp(viewDir.y, 0.02, 1)).toVar(),
                on: seaSettle.greaterThan(0.01),
            }).toVar();
            // THE WORLD IN THE SEA (water pass step 3): the beach, the hills and the massif stand
            // upside down in the water near the eye. High tier only; past `reach` the sky's.
            const seaMirror = vec3(skyRefl).toVar();
            if (q.waterReflections) {
                // The land ray and its softness, pinned here in uniform control flow: a derivative
                // first met inside the per-pixel If below is a WebGPU validation error (gotcha #300).
                // A distant shore is mirrored by a calm normal, a share of the swell and a third of
                // the ripple; a ray under the horizon meets the next wave (the sky's) and skips.
                const landSlope = waveSlope.mul(SEA_MIRROR.swell).add(ripple.mul(vSwellFade).mul(0.3));
                const landDir = reflect(viewDir.negate(), normalize(vec3(landSlope.x.negate(), 1, landSlope.y.negate())))
                    .toVar('wLandRay');
                const landBlur = max(
                    wFragFade.mul(SEA_MIRROR.blur[1] * (1 - SEA_MIRROR.swell) * WAVE_RMS_SLOPE).add(SEA_MIRROR.blur[0]),
                    fwidth(landDir.y).mul(SEA_MIRROR.blur[2]),
                ).toVar('wLandBlur');
                If(wFragDist.lessThan(SEA_MIRROR.reach).and(landDir.y.greaterThan(0)), () => {
                    const seaHeightAt = (xz) => {
                        const m = texture(macroTex, waterPlateUv(xz)).level(0);
                        return m.r.add(texture(heightTex, waterPlateUv(xz)).level(0).r.mul(m.g));
                    };
                    const { tLand, landW } = waterMarchLand(positionWorld, landDir, {
                        heightAt: seaHeightAt,
                        steps: SEA_MIRROR.steps,
                        firstStep: SEA_MIRROR.firstStep,
                        stepGrowth: SEA_MIRROR.stepGrowth,
                        soft: SEA_MIRROR.soft,
                        ceiling: SEA_MIRROR.ceiling,
                        blur: landBlur,
                    });
                    const H = positionWorld.add(landDir.mul(tLand));
                    const near = float(1)
                        .sub(smoothstep(float(SEA_MIRROR.reach * 0.7), float(SEA_MIRROR.reach), wFragDist));
                    // Fading in off the level, and a hit under the sea is water, not land.
                    const keep = smoothstep(float(0), max(float(SEA_MIRROR.lift), landBlur), landDir.y)
                        .mul(smoothstep(float(ODYSSEY_SEA_LEVEL - 0.3), float(ODYSSEY_SEA_LEVEL + 0.6), H.y));
                    seaMirror.assign(mix(
                        skyRefl,
                        waterLandLit(H, tLand, skyRefl),
                        landW.mul(keep).mul(near).mul(SEA_MIRROR.gain),
                    ));
                });
            }
            // JADE WAVE BACKS — the topside twin of the underside's crest SSS. Thin crests
            // transmit light and go jade; troughs sink a step deeper. Driven by the displaced
            // height the triangle actually carries (vSwell), so the colour rides the moving
            // geometry and the sea gains value structure that travels.
            // ...and only as much as the sun stands behind the wave (2026-11-20).
            // ...and only on the crest TOPS, on the face turned to the eye (SEA_CREST_GLOW, 2026-11-21):
            // keyed to the whole stacked height, every patch of the near sea swung from deep blue to
            // jade and back once a wave, the shore orbs' foreground flipping within a second.
            const backlit = smoothstep(float(-0.2), float(0.8), dot(
                normalize(viewDir.xz.negate().add(vec2(1e-4, 0))),
                normalize(uSunDir.xz.add(vec2(1e-4, 0))),
            ));
            const swellN = vSwell.div(WAVE_AMP_SUM).toVar();
            const faceToEye = smoothstep(
                float(SEA_CREST_GLOW.face[0]),
                float(SEA_CREST_GLOW.face[1]),
                dot(waveSlope, normalize(viewDir.xz.add(vec2(1e-4, 0)))).negate(),
            );
            const crestGlow = smoothstep(float(SEA_CREST_GLOW.top[0]), float(SEA_CREST_GLOW.top[1]), swellN)
                .mul(faceToEye).mul(backlit).mul(vSwellFade);
            const troughDeep = smoothstep(float(SEA_TROUGH.window[0]), float(SEA_TROUGH.window[1]), swellN.negate())
                .mul(vSwellFade);
            const bodyLive = mix(
                mix(body, body.mul(vec3(...SEA_TROUGH.tint)), troughDeep),
                vec3(...WATER_JADE),
                crestGlow.mul(SEA_CREST_GLOW.gain),
            );
            // SUNLIT SHALLOWS (2026-10-31, "can we improve the water in the ocean"). Over the sand,
            // a clear sea shows the light its ripples focus on the bed: the underside's caustic
            // net (two crossing iso-lines of the ripple fetches, knots where they cross), seen
            // here from ABOVE through the water body, so it rides the body and not the reflection.
            // Strongest in the first few metres, gone by ~9 m and by ~320 u of range (before it
            // can shimmer), only in the sun. No fetch: both ripple texels are already resident.
            // (2026-11-20: within ~10 u of depth and ~150 u of range; further out its lines fell
            // 2-4 px apart and the shallows read as frosted glass with a scribbled net on it.)
            const shoalAt = smoothstep(float(0.25), float(1.2), depthLive)
                .mul(float(1).sub(smoothstep(float(3.0), float(10.0), depthLive)))
                .mul(float(1).sub(smoothstep(float(70), float(150), wFragDist)))
                .toVar();
            const shoalDiff = rippleTexA.b.sub(rippleTexB.b);
            const shoalSum = rippleTexA.b.add(rippleTexB.b).sub(1);
            const shoalAA = abs(dFdx(shoalDiff)).add(abs(dFdy(shoalDiff)));
            const shoalAAs = abs(dFdx(shoalSum)).add(abs(dFdy(shoalSum)));
            const shoalW = rippleTexA.b.mul(0.035).add(0.012);
            const shoalA = float(1).sub(smoothstep(float(0.0), shoalAA.add(shoalW), abs(shoalDiff)));
            const shoalB = float(1).sub(smoothstep(float(0.0), shoalAAs.add(shoalW), abs(shoalSum)));
            const shoalLight = max(shoalA, shoalB).mul(0.45).add(shoalA.mul(shoalB).mul(1.2))
                .mul(smoothstep(float(0.25), float(0.60), rippleTexB.b.add(rippleTexA.b.mul(0.35))))
                .mul(shoalAt)
                .mul(float(1).sub(fres))
                .mul(wVis);
            const bodyShoal = bodyLive.add(vec3(1, 0.97, 0.84).mul(shoalLight).mul(0.22));
            // (The sea's sun road, its sparkle and its core are one term since 2026-11-21: the sun in
            // a sea of facets, SEA_SUN_GLITTER, added after the horizon dissolve below.)
            // CLOUD SHADOWS ON THE SEA (masterpiece pass, 2026-11-17): the shadows that cross the
            // land stopped at the waterline, so the sea, half of every shore orb's frame, never
            // changed. The same field now lies on the water: under a cloud the body sinks a step
            // deeper and loses its glints (the sky it mirrors stays), and the patches drift in
            // from the sea and on over the beach as one shadow. High tier, as on the land.
            const seaSun = q.cloudShadows ? cloudShadowLight(positionWorld.xz).toVar() : float(1);
            const wl = mix(bodyShoal.mul(chopFacet).mul(mix(float(SEA_CLOUD_SHADE), float(1), seaSun)), seaMirror, fres)
                .mul(wVis.mul(0.18).add(0.82))
                .toVar();
            // WHITECAPS — The Witness reference: opaque flat white with a drawn edge, so
            // this MIXES toward white in a narrow (0.06) threshold band. HEIGHT is the
            // driver (height+steepness fight each other: a sine's crest has zero slope),
            // normalised against the real summed amplitude so the threshold means what it
            // says; high-frequency noise breaks the crest lines into separate caps without
            // out-voting them.
            // WHITECAPS WITH A LIFE (SEA_CAPS, 2026-11-21 sea audit, item 11). They were the swell's
            // stacked height at that instant cut in a narrow band: paper-white blobs that switched on
            // and off within a tenth of a second. Now each has an AGE, worked out here with no stored
            // state: the seconds since the long swell's crest last passed this water (`capAge`), and
            // how high the three waves stood together at that moment (`capStack`, the breaking
            // strength). It flashes, thins as a sheet and a lace, and is gone before the next crest.
            const C = SEA_CAPS;
            const [cW0, cW1, cW2] = WAVES;
            const capPhase = (wv) => positionWorld.x.mul((wv.dirX * Math.PI * 2) / wv.len)
                .add(positionWorld.z.mul((wv.dirZ * Math.PI * 2) / wv.len))
                .add(uTime.mul(wv.speed));
            const capPeriod = (Math.PI * 2) / cW0.speed;
            const crestCyc = capPhase(cW0).mul(1 / (Math.PI * 2)).sub(0.25).toVar();
            const crestN = floor(crestCyc).toVar();
            const capAge = crestCyc.sub(crestN).mul(capPeriod).toVar();
            const capStack = float(cW0.amp)
                .add(sin(capPhase(cW1).sub(capAge.mul(cW1.speed))).mul(cW1.amp))
                .add(sin(capPhase(cW2).sub(capAge.mul(cW2.speed))).mul(cW2.amp))
                .mul(vSwellFade)
                .div(WAVE_AMP_SUM)
                .add(seaGust.sub(0.5).mul(C.gust))
                .toVar();
            const capRise = smoothstep(float(0), float(C.rise), capAge).toVar();
            const capLife = exp(capAge.mul(-1 / C.sheetT)).mul(C.sheetShare)
                .add(exp(capAge.mul(-1 / C.laceT)).mul(1 - C.sheetShare))
                .mul(capRise)
                .mul(float(1).sub(smoothstep(float(capPeriod - C.tail), float(capPeriod), capAge)))
                .toVar();
            const capRange = float(1).sub(smoothstep(float(C.range[0]), float(C.range[1]), wFragDist))
                .mul(smoothstep(float(0.4), float(2.5), depth)).toVar();
            // The lace's pixel footprint (in tiles) and the ripple values it bends by, pinned here:
            // nothing in the per-pixel branch below may take a derivative or an implicit mip.
            const capFoot = seaFoot.div(C.tile).toVar();
            const capRipA = rippleTexA.b.toVar('wCapRipA');
            const capRipB = rippleTexB.b.toVar('wCapRipB');
            const capA = float(0).toVar('wCapA');
            // (An upper bound on the breaking strength: the per-crest pattern adds at most C.gate/2.)
            If(smoothstep(float(C.birth[0]), float(C.birth[1]), capStack.add(C.gate / 2))
                .mul(capLife).mul(capRange).greaterThan(0.002), () => {
                // A new 2-D pattern for each crest, still while that crest's foam lives.
                const capG = texture(
                    detailTex,
                    positionWorld.xz.mul(0.011).add(hash21(vec2(crestN.add(4096), 17)).mul(vec2(7.13, 3.71))),
                ).level(0).b;
                const brk = smoothstep(float(C.birth[0]), float(C.birth[1]), capStack.add(capG.sub(0.5).mul(C.gate)))
                    .mul(capRange);
                const cov = brk.mul(capLife).toVar();
                const flash = brk.mul(exp(capAge.mul(-1 / C.flashT))).mul(capRise).toVar();
                const laceUv = vec2(
                    dot(positionWorld.xz, WATER_WIND).sub(uTime.mul(C.drift)).div(C.tile * C.streak),
                    positionWorld.x.mul(WATER_WIND.y).sub(positionWorld.z.mul(WATER_WIND.x)).div(C.tile),
                ).add(vec2(capRipA, capRipB).sub(0.5).mul(C.bend));
                const L = texture(seaLaceTex, laceUv).level(0).toVar();
                // The threads thicken with the cover until the cells close, then the cells tear out;
                // never thinner than ~0.7 px (fainter instead), and their mean where cells are tiny.
                // FOAM, NOT A NET: a translucent sheet that opens into holes as it thins. The cover is
                // shaped (most of a cap's life is spent thin), the threads fall off softly, whole cells
                // stay filled while it is fresh and whole cells drop out as it goes.
                const covS = sqrt(cov).toVar();
                const capW = mix(float(C.width[0]), float(C.width[1]), covS).mul(capRipB.mul(0.9).add(0.55)).toVar();
                const wB = max(capW, capFoot.mul(15.75));
                const wS = max(capW, capFoot.mul(36.75));
                const wall = float(1).sub(smoothstep(float(0), wB, L.r)).mul(clamp(capW.div(wB), 0.35, 1));
                const fine = float(1).sub(smoothstep(wS.mul(0.2), wS, L.g))
                    .mul(smoothstep(float(0.30), float(0.70), covS))
                    .mul(clamp(capW.div(wS), 0.35, 1));
                const raft = smoothstep(float(0.45), float(0.75), L.b).mul(smoothstep(float(0.45), float(0.85), covS));
                const torn = smoothstep(L.b.sub(0.15), L.b.add(0.15), covS.mul(1.5));
                // (Torn at its edge, where the cover is thinnest: a ragged outline, not a pill.)
                const sheet = covS.mul(0.42).mul(torn);
                const lace = clamp(max(max(wall, fine), raft).mul(torn).add(sheet).add(L.a.mul(flash).mul(0.3)), 0, 1);
                const keep = float(1).sub(smoothstep(float(0.25), float(0.5), capFoot.mul(21)));
                capA.assign(mix(covS.mul(0.55), lace, keep).mul(cov.greaterThan(0.002).select(float(1), float(0)))
                    .mul(mix(float(C.alpha[0]), float(C.alpha[1]), flash)));
            });
            // FOAM IS LIT (2026-11-20): in the island's shadow or a cloud's it is a shaded blue-grey,
            // not paper white (the caps, the windrows and the shore's foam alike).
            const foamLight = mix(float(0.64), float(1), wVis.mul(seaSun)).toVar();
            wl.assign(mix(wl, vec3(...C.colour).mul(foamLight), capA));
            // WINDROWS (water pass step 5; rebuilt 2026-11-21, SEA_WINDROWS): long foam streaks
            // parallel to the wind, a row a cell, each wandering along the wind only (it can never
            // fold or meet a neighbour), riding the swell's orbit sideways, lit in long stretches by
            // a break field drawn out along it, drifting downwind; deep water only, off the near
            // water, gone before a row is a pixel wide (no moire).
            const W_ROWS = SEA_WINDROWS;
            const along = dot(positionWorld.xz, WATER_WIND).sub(uTime.mul(W_ROWS.drift));
            const acrossLive = positionWorld.x.mul(WATER_WIND.y).sub(positionWorld.z.mul(WATER_WIND.x))
                .sub(dot(waveSlope, vec2(WATER_WIND.y, WATER_WIND.x.negate())).mul(W_ROWS.ride)).toVar();
            const rowPx = fwidth(acrossLive);
            const rowC = acrossLive.div(W_ROWS.spacing);
            const rowCell = floor(rowC);
            // (A positive seed: the hash of a negative integer is undefined.)
            const rowH = hash(rowCell.add(4096));
            const rowWander = sin(along.mul(W_ROWS.wanderK[0]).add(rowH.mul(6.2832))).mul(W_ROWS.wander[0])
                .add(sin(along.mul(W_ROWS.wanderK[1]).add(fract(rowH.mul(7.31)).mul(6.2832))).mul(W_ROWS.wander[1]));
            const rowStrength = smoothstep(float(W_ROWS.lit[0]), float(W_ROWS.lit[1]), texture(detailTex, vec2(
                along.mul(W_ROWS.alongScale),
                rowCell.mul(0.173).add(0.31).add(uTime.mul(W_ROWS.evolve)),
            )).level(0).b);
            const rowOff = rowC.sub(rowCell).sub(0.5).sub(rowH.sub(0.5).mul(W_ROWS.jitter));
            const rowD = abs(rowOff.mul(W_ROWS.spacing).sub(rowWander));
            const rowHalfW = mix(float(W_ROWS.halfWidth[0]), float(W_ROWS.halfWidth[1]), rowStrength);
            const rowHalf = max(rowHalfW, rowPx.mul(0.7));
            const rowLine = float(1).sub(smoothstep(rowHalf.mul(W_ROWS.soft), rowHalf.add(rowPx), rowD))
                .mul(clamp(rowHalfW.div(rowHalf), 0.35, 1));
            const rows = rowLine.mul(rowStrength)
                .mul(smoothstep(float(8), float(20), depth))
                .mul(smoothstep(float(W_ROWS.near[0]), float(W_ROWS.near[1]), wFragDist))
                .mul(float(1).sub(smoothstep(float(300), float(520), wFragDist)))
                .mul(float(1).sub(smoothstep(float(W_ROWS.footprint[0]), float(W_ROWS.footprint[1]), rowPx.div(W_ROWS.spacing))))
                .mul(mix(float(0.35), float(1), seaGust))
                .mul(W_ROWS.gain);
            wl.assign(mix(wl, vec3(0.93, 0.97, 1.0).mul(foamLight), rows));
            // THE SHORE FOAM (rings + swash front, built at the root — see `shoreFoam`),
            // before the horizon dissolve so far foam melts into the sky with the sea.
            wl.assign(mix(wl, vec3(0.95, 0.99, 1.0).mul(foamLight), shoreFoam.mul(0.92)));
            // HORIZON DISSOLVE — far water converges on the sky (80% by 1.2 km, capped
            // below 1 so the boundary never becomes a hard line of its own), applied AFTER
            // the caps so far foam melts into sky instead of shimmering; then a faint static
            // shore brightening band (proven live by the Wave 0 GPU probe) — faint now that
            // the moving foam owns the waterline, kept so the shore still reads at range.
            // ...but only where the eye looks ALONG the sea (2026-11-02). The dissolve is the sea
            // meeting the sky at the horizon. By range alone it also took the sea under the
            // climbing eye, 1-2 km off but 20-40 degrees down, to 60-80% of the pale horizon
            // colour: from the climb the whole sea read milky and flat, and the coasts' depth
            // colour was gone. A ray that looks down more steeply than ~3 degrees now starts to keep
            // the sea's own colour, and by ~14 degrees keeps all of it (the air's haze, applyAerial,
            // still lies over it): the east isle, 3.5 km off and 11 degrees down from the climb,
            // keeps its shallows. From the shore orbs the eye looks along the water at under ~3
            // degrees wherever the dissolve is strong, so the coast views keep it.
            // (2026-11-20: it began at the eye and reached 80 % by 1.7 km, toward one mid-dome
            // blue, and the aerial perspective hazed the sea again on top of it: the open sea was the
            // sky's colour from ~1 km out. Now it gathers over 3 km, to 60 %, toward the dome's own
            // air at the sea line on this bearing, so a cobalt band of open sea lies between the
            // near water and the haze, and toward the sun the far sea takes the warm air's gold.)
            const wHorizon = clamp(
                length(positionWorld.sub(cameraPosition)).mul(1 / 3000),
                0,
                1,
            ).pow(2.2).mul(0.6)
                .mul(float(1).sub(smoothstep(float(SEA_HORIZON_DOWN[0]), float(SEA_HORIZON_DOWN[1]), viewDir.y)));
            const seaLine = skyAirAt(vec3(viewDir.x.negate(), float(0), viewDir.z.negate()));
            wl.assign(mix(wl, seaLine, wHorizon));
            // THE SUN ROAD (SEA_SUN_GLITTER, 2026-11-21 sea audit, item 18): the sun seen in a sea of
            // facets. The facet the sun needs (the half vector's slope) against the surface's own
            // (the settled reflection normal); their spread is the chop's plus the swell's that the
            // distance fade took from the normal, so the band runs to the horizon, narrow there.
            // HDR, eased by a knee; near the eye a broad sheen instead of whole lit wave faces.
            // After the dissolve: only the air takes it, as light through air.
            const SG = SEA_SUN_GLITTER;
            const sunH = normalize(ODYSSEY_EVENING_U.sunDir.add(viewDir)).toVar();
            const sunHy = max(sunH.y, float(0.08));
            const sunMiss = sunH.xz.negate().div(sunHy).sub(reflN.xz.negate().div(max(reflN.y, float(0.2))));
            const sunM2 = dot(sunMiss, sunMiss).toVar();
            const roadKeep = clamp(float(1).sub(wFragDist.div(520)), 0, 1);
            const roadS2 = mix(float(SG.floorVar[0]), float(SG.floorVar[1]), seaGust)
                .add(float(SG.waveVar).mul(vSwellFade.mul(vSwellFade)).mul(float(1).sub(roadKeep.mul(roadKeep))))
                .toVar();
            const roadVh = clamp(dot(viewDir, sunH), 0, 1);
            const roadFb = float(1).sub(roadVh);
            const roadFb2 = roadFb.mul(roadFb);
            const roadFres = roadFb2.mul(roadFb2).mul(roadFb).mul(0.98).add(0.02);
            const roadHy = max(sunHy, float(SG.hyFloor));
            const roadHy2 = roadHy.mul(roadHy);
            const roadLight = roadFres.div(max(viewDir.y, float(SG.vyFloor)).mul(roadHy2.mul(roadHy2)).mul(8 * Math.PI));
            const kneeOf = (x) => x.div(x.mul(SG.knee).add(1));
            const roadBand = kneeOf(exp(sunM2.div(roadS2.mul(-2))).div(roadS2).mul(roadLight));
            const roadSheenS2 = roadS2.add(SG.sheenVar);
            const roadSheen = kneeOf(exp(sunM2.div(roadSheenS2.mul(-2))).div(roadSheenS2).mul(roadLight));
            const roadNear = float(1).sub(smoothstep(float(SG.glintFoot[0]), float(SG.glintFoot[1]), seaFoot));
            const seaRoad = mix(roadBand, roadSheen.mul(SG.sheenShare), roadNear).mul(SG.gain).toVar('wSeaRoad');
            wl.assign(wl.add(mix(uSunColour, vec3(1, 0.98, 0.94), 0.3)
                .mul(seaRoad)
                .mul(wVis.mul(seaSun).mul(seaSun))
                .mul(float(1).sub(clamp(capA.add(rows).add(shoreFoam), 0, 1)))
                .mul(smoothstep(float(0), float(0.03), ODYSSEY_EVENING_U.sunDir.y))));
            wl.assign(wl.add(vec3(0.92, 0.97, 0.99).mul(
                smoothstep(float(2.6), float(0.15), depth)
                    .mul(smoothstep(float(-0.4), float(0.5), depth)).mul(0.10)
                    // From afar the surf line and the swash front are the coast's: the band would turn
                    // the first plate into a white ribbon round the island seen from the climb.
                    .mul(float(1).sub(smoothstep(float(400), float(1200), wFragDist).mul(0.75))),
            )));
            col.assign(wl);
        });
        If(uSubmerged.greaterThan(0.001), () => {
            // ── UNDERSIDE: the luminous ceiling (Wave 5 of the seam plan, unchanged) ──
            // Crest SSS + Snell's window + TIR; the swell-perturbed normal (shared, above)
            // is what makes the window's rim ripple live.
            const crestMask = clamp(vSwell.mul(1.6).add(0.35), 0, 1);
            // Crest translucency is a NEAR-field effect (a thin crest close by); at the breach the
            // far grazing ceiling took it everywhere and painted the TIR band a sandy gold.
            const sss = crestMask.mul(grazing).mul(clamp(dot(uSunDir, vec3(0, 1, 0)), 0, 1))
                .mul(float(1).sub(smoothstep(float(30), float(140), wFragDist)));
            // THE FAR CEILING IS CALM (audit pass, 2026-10-22). From deep in the column the
            // window's rim read the full swell normal on a ceiling 200-400 u away, so the swell
            // pushed patches back and forth across the 0.60..0.72 threshold and the frame's edges
            // filled with dark blurred blades — smudges, not water. Waves that far off average
            // out; the rim keeps its ripple where the surface is near (the breach), by 3-D eye
            // distance (the column looks straight up: the horizontal range overhead is ~0).
            const ceilDist = length(positionWorld.sub(cameraPosition)).toVar();
            const ceilFar = smoothstep(float(40), float(180), ceilDist).toVar();
            const ceilN = normalize(mix(wN, vec3(0, 1, 0), ceilFar)).toVar();
            const ceilIn = viewDir.negate().toVar();
            // THE WINDOW'S OWN SURFACE (SNELL_WINDOW.surface, 2026-11-21): a level sea tipped by a
            // slow share of the swell and crinkled by the ripple, the tilt capped, so the rim moves
            // at most ~3.4 degrees and holds still instead of lurching; within ~6 u of the surface
            // (the breach) it is the water's own normal again. The mirror outside keeps `ceilN`.
            const SWS = SNELL_WINDOW.surface;
            const winTilt = waveSlope.mul(SWS.swellShare).add(rippleSlope.mul(SWS.rippleShare))
                .mul(float(1).sub(ceilFar)).toVar();
            const winTiltC = winTilt.mul(min(float(1), float(SWS.tiltCap).div(max(length(winTilt), float(1e-5)))));
            const winN = normalize(mix(vec3(winTiltC.x.negate(), 1, winTiltC.y.negate()), ceilN, uBreachNear)).toVar();
            const upCos = clamp(dot(ceilIn, winN), 0, 1);
            const snellWindow = smoothstep(float(0.60), float(0.72), upCos);
            // THE CAUSTIC WEB ON THE CEILING (item 4). Seen from below, a rippled surface is a
            // net of bright refracted lines, not a mottle. The lines are where the two ripple
            // layers' scalar fields CROSS (|A - B| ~ 0): an iso-contour of two decorrelated,
            // independently scrolling fields is a meandering net that re-forms as they slide —
            // which is how real caustic nets move — and it costs no fetch at all (both texels are
            // already resident). The first cut thresholded the floor's min(b, a) web instead and
            // drew the 256-texel tile as a grid of identical blobs across the whole ceiling; an
            // iso-line of two layers at a non-integer scale ratio has no such period.
            // Footprint-widened so it never aliases, and near-field only by EYE distance (3D —
            // the ascent looks straight up, so the overhead ceiling has ~zero HORIZONTAL range
            // and a planar fade let the net tile the whole sky from 117 u down: measured). The
            // line weight swells and breaks with the first field, so the net has thick bright
            // knots and gaps like a real caustic instead of reading as a contour map.
            //
            // GATED (seamless pass): the net fades out by 62 u of 3D eye distance, and no part of
            // the ceiling is nearer than the eye's own depth — so below ~66 u (most of ch2's
            // column) it is provably zero on every pixel while its derivative pair and seven
            // smoothsteps still ran on the whole ceiling. `uCeilNet` is the CPU's exact answer.
            //
            // TWO FAMILIES, crossing (seamless pass): the net used ONE iso-contour, |A - B| ~ 0,
            // whose zero set is a field of closed meandering loops — it read as a contour map of
            // noodles, not as caustics. |A + B - 1| ~ 0 is a second, INDEPENDENT meander family
            // (the sum and difference of two independent fields are uncorrelated), so the union
            // crosses itself into cells, and where the two cross the knot burns brighter — the
            // polygonal web with bright nodes a refracting surface actually draws. Lines thinner.
            const ceilLines = float(0).toVar('wCeilLines');
            If(uCeilNet.greaterThan(0.5), () => {
                const ceilDiff = rippleTexA.b.sub(rippleTexB.b);
                const ceilSum = rippleTexA.b.add(rippleTexB.b).sub(1);
                const ceilAA = abs(dFdx(ceilDiff)).add(abs(dFdy(ceilDiff)));
                const ceilAAs = abs(dFdx(ceilSum)).add(abs(dFdy(ceilSum)));
                // LIGHT, NOT A NET (Act I overhaul, 2026-10-20). Seen from ~35 u down the thin even
                // lines read as a fishing net drawn on the ceiling. Wider and softer lines that carry
                // little light of their own, the light gathered where two cross (the focus knots),
                // and broken into patches by the coarse field's other channel: a shimmer of light
                // focusing in the ripples, brightest at its knots, not a drawn web.
                const ceilWidth = rippleTexA.b.mul(0.040).add(0.014);
                const lineA = float(1).sub(smoothstep(float(0.0), ceilAA.add(ceilWidth), abs(ceilDiff)));
                const lineB = float(1).sub(smoothstep(float(0.0), ceilAAs.add(ceilWidth), abs(ceilSum)));
                const ceilPatch = smoothstep(float(0.30), float(0.72), rippleTexA.a.mul(0.7).add(rippleTexB.b.mul(0.5)));
                ceilLines.assign(max(lineA, lineB).mul(0.32).add(lineA.mul(lineB).mul(1.5))
                    .mul(ceilPatch)
                    .mul(smoothstep(float(0.30), float(0.55), rippleTexB.b.add(rippleTexA.b.mul(0.3))))
                    .mul(float(1).sub(smoothstep(float(22), float(62), length(positionWorld.sub(cameraPosition)))))
                    // Mostly inside the window: at grazing angles the world-space net stretches
                    // into long loops across the ceiling (seen from just under the breach).
                    .mul(snellWindow.mul(0.85).add(0.15)));
            });
            // THE WORLD IN THE WINDOW (odyssey-ocean-window.js): near the surface the window holds
            // the sky, its cloud, the sun's glare and the island along its rim, refracted through
            // the ripples; from deeper it is the flat glow it was. The land march is the High tier's.
            const windowFlat = skyColourSubmergedUp.mul(1.30).toVar();
            const windowWorld = snellWindowWorld({
                incident: ceilIn,
                normal: winN,
                wobble: mix(float(SNELL_WINDOW.surface.imageWobble), float(2), uBreachNear),
                at: positionWorld,
                flat: windowFlat,
                presence: uSnellWorld,
                time: uTime,
                sunDir: uSunDir,
                sunColour: vec3(...WINDOW_SUN),
                lift: uWindowLift,
                skyAt: skyAirAt,
                noiseTex: detailTex,
                march: q.waterReflections ? (P, R) => waterMarchLand(P, R, {
                    heightAt: (xz) => {
                        const m = texture(macroTex, waterPlateUv(xz)).level(0);
                        return m.r.add(texture(heightTex, waterPlateUv(xz)).level(0).r.mul(m.g));
                    },
                    ...SNELL_WINDOW.march,
                }) : null,
                landLit: waterLandLit,
            });
            // (2026-11-21: the filaments are the window's own light, ~1.3x it, a crossing capped at
            // ~1.6x; and the whole window is pre-lifted against the water's filter that the medium
            // lays over every underside fragment, so it keeps the air's colour, not a cyan cast.)
            const windowSky = windowWorld
                .add(vec3(1, 0.96, 0.88).mul(spec).mul(1.2))
                .add(windowWorld.mul(0.8).add(vec3(0.10, 0.12, 0.12)).mul(min(ceilLines, float(0.6))))
                .mul(vec3(1 / 0.42, 1 / 0.86, 1));
            // THE SURFACE FLOODS WITH LIGHT AS YOU REACH IT (2->3 seam). Seen from deep below, the
            // ceiling outside Snell's window is the dark total-internal-reflection body; over the
            // last ~25 u it becomes a bright, wavering lid — and without that the breach was a 37-luma
            // jump from a dark TIR frame straight into daylight (the seam gate's worst step).
            // uEyeDepth is a uniform, so this is two mixes on the ceiling, no branch.
            // ...and that lid is a MIRROR of the water below (total internal reflection): each
            // swell and ripple facet turns a different depth of it toward the eye, so the lid moves
            // as the sea does instead of lying flat (`snellMirror`).
            const tirMirror = snellMirror({
                incident: ceilIn,
                // (A calmer normal than the window's: a steep facet would show the deep plate as a
                // dark stain on the lid.)
                normal: normalize(mix(ceilN, vec3(0, 1, 0), 0.55)),
                // (1.18 -> 0.72, 2026-11-21: the lid stays under the window it mirrors.)
                near: uWaterLum.mul(0.72).add(windowFlat.mul(0.16)),
                mid: uWaterMid.mul(1.05),
                deep: uWaterDeep.mul(1.2),
            }).add(uWaterLum.mul(0.6).add(vec3(0.26, 0.32, 0.30)).mul(ceilLines.mul(0.35)));
            const tirBody = mix(
                mix(uWaterMid, uWaterDeep, uEyeDepth).mul(0.6),
                tirMirror,
                float(1).sub(smoothstep(float(0.0), float(0.18), uEyeDepth)).mul(0.85),
            );
            // The water over the eye takes the surface's light on the way down (the depth arc's
            // `overhead`): from the abyss the window is a far, soft well, brightest straight up.
            const underside = mix(tirBody, windowSky, snellWindow)
                .mul(snellDepthLight(ceilDist, uCeilAbsorb).mul(uSeaLight))
                .add(uWaterGlow.mul(sss).mul(0.55));
            // THE BREACH, PER FRAGMENT (seamless pass, 2->3). Inside the 14 u band both regimes
            // run, and this used to cross-dissolve the WHOLE plane by the eye's uSubmerged — at
            // the crossing frame every water pixel was a 36/64 blend of topside and ceiling, a
            // grey muddle with whitecap flecks where the meniscus should have been the hero. The
            // rasteriser already knows the truth for each fragment: a FRONT face (the plane's
            // normal is +Y) is surface seen from above, a back face is ceiling seen from below.
            // So a crest that rises above the eye shows its luminous underside while the trough
            // beside it shows sky, split by the meniscus line where `grazing` peaks. Outside the
            // band only one branch runs and this reduces to the old answer exactly.
            const faceUnder = select(frontFacing, float(0), float(1));
            col.assign(mix(col, underside, select(uSubmerged.greaterThanEqual(0.999), float(1), faceUnder)));
        });
        return col.add(vec3(0.95, 0.99, 1.0).mul(meniscus));
    })();
    const waterAired = applyAerial(waterShaded, positionWorld, AERIAL_CEIL_WATER, 1, ...MIST_SEA, true);
    waterMat.colorNode = meltIntoSky(toOutputSurface(waterAired), positionWorld);
    // The film thins toward the LIVE waterline (the swash), and foam is opaque where the
    // film under it is not — otherwise the lapping front would be drawn at ~20 % alpha.
    waterMat.opacityNode = clamp(max(
        smoothstep(float(SEA_FILM[0]), float(SEA_FILM[1]), depthLive),
        shoreFoam.mul(0.92),
    ), 0, 1);
    waterMat.transparent = true;
    waterMat.depthWrite = false;
    // THE SHORE'S DEPTH FIGHT (2026-11-03; WATER_SHORE_DEPTH_BIAS). From the climb the last part
    // of a metre of water over the north beach's 2-degree sand lies inside one step of the depth
    // buffer, so the film and the sand fought there and the waterline flickered with every
    // sub-pixel move of the camera. The film is drawn a few depth steps nearer the eye (steps grow
    // with range as the precision falls): in that band the water always wins and its own opacity,
    // which reads the real depth over the seabed, decides what shows. The undecided line is now on
    // the dry sand, where the film is clear. Tiny near the eye (0.16 u along the ray at 300 u).
    waterMat.polygonOffset = true;
    waterMat.polygonOffsetFactor = 0;
    waterMat.polygonOffsetUnits = -WATER_SHORE_DEPTH_BIAS;
    waterMat.alphaTest = 0.004;
    waterMat.side = THREE.DoubleSide;
    // NOT forceSinglePass, deliberately (2026-08-22 audit): every other transparent DoubleSide
    // surface in the startup groups is a single facet or additively blended, so the
    // BackSide/FrontSide split is provably redundant there. The water is neither — it is a
    // displaced sheet with NORMAL blending that the rail passes UNDER (the sunken stretch
    // with the god rays and fish), so where the surface folds over itself the two passes
    // composite far-then-near. Keeping the split costs one pipeline and buys correct order.
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

    // A cloud's white: never quite white, and through the evening the sun's own (odyssey-evening.js).
    const cloudWhite = eveningCloudWhite(vec3(0.97, 0.975, 0.99), uSunColour);
    const heroMassifSpec = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
    // ── THE CLOUDS (2026-11-24; odyssey-clouds.js) ─────────────────────────────────────────────
    // The sun in them is the hour's: at noon the white of a cloud, late in the day the sun's own colour.
    const skyCloudLight = {
        prepare: (rd) => {
            const cloudLitWhite = mix(cloudWhite, uSunColour, uHourSky.y);
            const cloudToSun = clamp(dot(rd, uSunDir), 0, 1).toVar();
            return {
                toSun: cloudToSun,
                sun: mix(uSunColour, cloudLitWhite, eveningCloudLitShare(float(0.70).sub(uHourSky.y.mul(0.4)))).mul(CLOUD_WORLD.sun).toVar(),
                skyTop: skyColourFor(float(0.55)).mul(CLOUD_WORLD.sky).toVar(),
                skySide: skyColourFor(float(0.10)).mul(CLOUD_WORLD.side).toVar(),
                bounce: mix(uSkyHorizon, uShadowTint, float(0.35)).mul(vec3(...CLOUD_WORLD.bounceTint)).mul(CLOUD_WORLD.bounce).toVar(),
                // Thin edges against the sun burn; away from it every edge keeps a little of the sky behind it.
                silver: cloudToSun.mul(cloudToSun).mul(cloudToSun).mul(cloudToSun).mul(CLOUD_WORLD.silver)
                    .toVar(),
            };
        },
        light: (k, s) => {
            // What is going thin lets the light through.
            const cloudOpen = s.eaten.mul(0.65);
            const cloudReached = mix(s.sun, float(0.86), cloudOpen);
            const cloudCrease = mix(float(CLOUD_WORLD.crease[0]), float(CLOUD_WORLD.crease[1]), s.relief.mul(0.45).add(s.lit.mul(0.55)));
            const cloudDirect = smoothstep(float(CLOUD_WORLD.ramp[0]), float(CLOUD_WORLD.ramp[1]), cloudReached).mul(0.55)
                .add(cloudReached.mul(0.45)).mul(cloudCrease)
                // (A hollow of the body is darker than its crown, however square to the sun.)
                .mul(mix(float(CLOUD_WORLD.hollow), float(1), smoothstep(float(0.22), float(0.78), mix(s.sky, float(1), cloudOpen))));
            const cloudThin = float(1).sub(s.body);
            const cloudSunlight = k.sun.mul(cloudDirect.add(k.silver.mul(cloudThin).mul(s.sun)));
            const cloudUp = mix(k.skySide, k.skyTop, s.sky);
            const cloudSkylight = cloudUp.mul(mix(s.sky, float(1), cloudOpen).mul(0.72).add(0.28)).mul(mix(float(0.86), float(1.08), s.relief));
            const cloudFrom = k.bounce.mul(s.ground).mul(mix(float(1), float(0.35), s.h));
            return cloudSunlight.add(cloudSkylight).add(cloudFrom).add(k.skySide.mul(float(1).sub(s.dens).mul(cloudThin).mul(CLOUD_WORLD.rim)));
        },
        air: (rgb, alpha, rd, p, dist, wall) => {
            const cloudTone = rgb.div(max(alpha, float(1e-3)));
            // The air between: thick low down and far off, so the last of the sky's clouds stand in its haze.
            const cloudLow = exp(max(p.y.sub(CLOUD_WORLD.hazeFoot), 0).div(CLOUD_WORLD.hazeHeight).negate());
            const cloudHaze = float(1).sub(exp(dist.mul(uAerialK).mul(CLOUD_WORLD.haze).negate()))
                .mul(cloudLow.mul(0.62).add(0.38))
                .mul(mix(float(1), float(1.12), wall));
            const cloudAired = mix(cloudTone, skyAirAt(rd), clamp(cloudHaze, 0, 0.94));
            const cloudShown = intoEarth(toOutputFaded(cloudAired, uFadeHorizon.mul(notOverEarth)));
            return vec4(cloudShown.mul(alpha), alpha);
        },
    };
    const skyClouds = createOdysseyClouds({
        tier: qualityTier,
        load: clouds,
        summit: findHeroSummit(relief.sample, heroMassifSpec),
        ctx: {
            cameraPosition, uTime, uSunDir, ...skyCloudLight,
        },
    });
    skyClouds.mesh.renderOrder = 2;
    group.add(skyClouds.mesh);
    const intoGroupFrame = (v) => v.sub(group.position).divideScalar(group.scale.x);
    const sphereToWorld = (sp) => {
        sp.center.multiplyScalar(group.scale.x).add(group.position);
        sp.radius *= group.scale.x;
    };
    // THE SEA OF CLOUDS' BED (chapter 5's evening, odyssey-cloud-sea.js): the clouds' own light on one ring
    // round the summit, gathered by the evening (hidden until then).
    const cloudSeaLayer = cloudSea && clouds
        ? createOdysseyCloudSea({
            cameraPosition,
            skyAirAt,
            light: skyCloudLight,
            aerialK: uAerialK,
            climb: uClimb,
            cloudShadowLight: q.cloudShadows ? cloudShadowLight : null,
            toCloudOutput: (c) => intoEarth(toOutputFaded(c, uFadeHorizon.mul(notOverEarth))),
            quality: quality === 'low' ? 'low' : 'high',
            load: clouds,
        })
        : null;
    if (cloudSeaLayer) group.add(cloudSeaLayer.mesh);
    // MIST IN THE HOLLOW (odyssey-hollow-mist.js): the upper meadow's basin holds a pool of mist
    // through the mountains' afternoon, a soft sheet at the pool's own level that the trees rise
    // through. One blended draw; the high tier's (it rides the tier the cloud shadows do).
    const hollowMist = q.cloudShadows
        ? createOdysseyHollowMist({
            heightAt: relief.sample,
            plate: valleyMistPlate,
            positionWorld,
            cameraPosition,
            time: uTime,
            noise: detailTex,
            sunColour: uSunColour,
            sunDir: uSunDir,
            skyAirAt,
            toOutput: (c, at) => toOutputSurface(applyAerial(c, at, AERIAL_CEIL_LAND, AERIAL_RATE_LAND)),
        })
        : null;
    if (hollowMist) group.add(hollowMist.mesh);
    // THE WALL'S GUSTS (odyssey-wall-gusts.js): spindrift blown across the face where the climb
    // begins, the 4->5 seam's own event. Same lever.
    const wallGusts = cloudSea && clouds
        ? createOdysseyWallGusts({
            sunColour: uSunColour,
            hazeColour: uSkyHorizon,
            quality: quality === 'low' ? 'low' : 'high',
        })
        : null;
    if (wallGusts) group.add(wallGusts.mesh);

    // ── god rays (Ch2 port) ─────────────────────────────────────────────────────────
    // The deep-ocean chapter's declared hero: descending light shafts with caustic shimmer.
    // Ported as ONE InstancedMesh of open cones seated along the SUBMERGED stretch of the
    // rail (the caller samples its spline into railSamples — the world does not know the
    // path), tilted to the real ODYSSEY_WORLD_SUN rather than the old chapter's private
    // "light from above" assumption. Visible only while the camera is underwater.
    const sunkPoints = railSamples.filter((pt) => pt && pt.y < ODYSSEY_SEA_LEVEL - 6);
    // THE OPEN-WATER SPAN (item 3) — where life may be seeded. The caller hands 48 samples
    // over the WHOLE journey; only ~7 are submerged and 3 of those lie below the seabed, inside
    // the Earth Core shaft (rail y -30..72 against a bed near 98). Seeding fish and motes from
    // `sunkPoints` therefore put ~3/7 of them in rock, early-Z'd invisible, and left the water
    // column the camera actually rises through thinly populated. So the rail is DENSIFIED
    // (eight steps per sample pair) and every point kept is in open water: under the surface
    // and at least 2 u above the bed, on the CPU height mirror the ground displaces to.
    const openWater = [];
    for (let i = 0; i + 1 < railSamples.length; i += 1) {
        const ra = railSamples[i];
        const rb = railSamples[i + 1];
        if (ra && rb) {
            for (let k = 0; k < 8; k += 1) {
                const t = k / 8;
                const ox = ra.x + ((rb.x - ra.x) * t);
                const oy = ra.y + ((rb.y - ra.y) * t);
                const oz = ra.z + ((rb.z - ra.z) * t);
                if (oy < ODYSSEY_SEA_LEVEL - 6 && oy > relief.sample(ox, oz) + 2) {
                    openWater.push({ x: ox, y: oy, z: oz });
                }
            }
        }
    }
    // WAVE 4: the cap is the REAL number. Four research findings priced this system at "22
    // cones" off the old cap while the submerged rail has ever only yielded 9 — the code's
    // own constant was the source of the wrong number, so it now states the truth.
    // Item 4: seated along the OPEN-WATER span, not the raw submerged samples (three of which
    // are the Earth Core shaft), and three more of them — the ascent looks straight up through
    // them, so a fan of shafts converging on the surface is the chapter's hero read.
    const rayPoints = openWater.length > 2 ? openWater : sunkPoints;
    // ⚠️ THE CH2 REGRESSION (seamless pass; Lane A measured ch2 0.52 -> 0.72 ms at the SAME 38
    // draws). These cones are additive, double-sided and full height, and the ascent looks
    // straight UP their axes, so each one rasterises as a near-full-screen disc of TWO walls.
    // The masterpiece pass took them from 7 cones of radius 7 to 12 of radius 10: area per cone
    // seen end-on goes as r^2 (x2.04), times 12/7 cones — ~3.5x the blended fill, every
    // fragment of it also paying a 3D simplex (~100+ ALU). That is the whole +0.20 ms.
    // Now: 9 cones (6 on the low tier) at radius 7, a texture shimmer instead of the simplex,
    // and an alpha floor that discards the near-transparent majority of each wall before the
    // blend. ~0.37x the masterpiece fill, ~1/8 of its per-fragment ALU.
    const rayCount = Math.min(quality === 'low' ? 6 : 9, rayPoints.length);
    let rayMesh = null;
    let rayMat = null;
    // The shafts' axes (base centre, radius at the surface, phase) and their shared direction, for
    // the motes' "lit where a shaft crosses" term (Act I overhaul, 2026-10-20).
    const shaftAxes = [];
    const shaftDir = new THREE.Vector3(0, 1, 0);
    if (rayCount > 2) {
        rayMat = new THREE.MeshBasicNodeMaterial();
        const rUv = uv();
        // Brightest where the shaft meets the surface, feathering to nothing as it descends —
        // with a short feather AT the base too (first capture after the flip showed the open
        // base's rim as a hard bright ellipse; a shaft of light has no end-cap). The depth
        // exponent steepened 1.15 -> 1.6 so the shaft melts out by mid-depth instead of
        // standing as a full-height pipe.
        // 1.6 -> 2.4 (audit 2026-10-18): seen from beside or above, the deep half still glowed
        // where the floor cut it, and the shafts read as glass rods standing on the bed.
        // (Clamped: with MSAA the tip's pixel is shaded past it, at uv.y over 1, and pow of a negative
        // base is NaN. Today the floor hides the tips.)
        // ROOTED AT THE SURFACE (2026-11-21 sea audit, item 6): the head feather blanked the first
        // 34 u of the axis, so the light began ~25 u under the lid as a rounded top hanging in
        // mid-water. The cones now reach up through the surface and are cut by it in world height
        // (the water writes no depth, so the clip is the shader's): full strength 16 u down.
        const vFade = clamp(float(1).sub(rUv.y), 0.0, 1.0).pow(2.4)
            .mul(float(1).sub(smoothstep(float(ODYSSEY_SEA_LEVEL - 16), float(ODYSSEY_SEA_LEVEL + 0.5), positionWorld.y)));
        // FACING fade, not a uv.x feather. On a ConeGeometry uv.x runs around the
        // CIRCUMFERENCE, so the ported `abs(uv.x - 0.5)` lit one side of the cone and left a
        // hard seam on the other — in-game that read as solid triangular wedges, not light.
        // A shell standing in for a volume must instead dim where it is seen EDGE-ON, because
        // the grazing angle IS the silhouette; fading it there means the shape has no visible
        // boundary at all.
        const rayView = normalize(cameraPosition.sub(positionWorld));
        // Steeper than the shipped 0.85 (item 4): with the shafts finally bright enough to
        // read, the cone silhouettes drew hard straight edges; a faster fall toward edge-on
        // leaves a soft-edged shaft.
        // ...and cubed (2026-11-21): ^1.25 still left 84 % at half the radius and fell off a cliff at
        // the silhouette, a straight hard edge (a slab); cubed the cross-section has zero slope there.
        const eN = clamp(abs(dot(normalWorld, rayView)), 0, 1);
        const eFade = eN.mul(eN).mul(eN).toVar();
        // NEAR fade: the rail passes THROUGH these shafts, and a 220 u cone a few metres from
        // the eye fills the frame with one flat wedge. Same lesson as the cloud deck.
        const rayDist = length(positionWorld.sub(cameraPosition)).toVar();
        const rayNear = smoothstep(float(14), float(85), rayDist);
        // The water's extinction along the view ray (OCEAN_SHAFT_EXTINCTION, split as the blades'):
        // a cone 150 u off kept its full gain in front of a haze that had taken most of the rest.
        const raySeen = exp(rayDist.mul(-OCEAN_SHAFT_EXTINCTION * OCEAN_EXTINCTION[2]));
        const rayHue = exp(rayDist.mul(vec3(
            OCEAN_EXTINCTION[0] - OCEAN_EXTINCTION[2],
            OCEAN_EXTINCTION[1] - OCEAN_EXTINCTION[2],
            0,
        ).mul(-OCEAN_SHAFT_EXTINCTION)));
        // FROM ABOVE: light pouring down is seen looking UP it (the climb's hero read). Looked
        // down on — an orb close-up, the arrival orbit — a shell has no volume to sell, so it
        // steps back to a quarter instead of standing as a lit tube.
        const rayAbove = float(1).sub(smoothstep(float(0.1), float(0.65), rayView.y).mul(0.75));
        // SHIMMER FROM THE RESIDENT DETAIL TILE, not a per-fragment simplex (the file's header
        // law: "detail comes from a tiled texture, ~1 ALU against ~100"). One fetch, sampled
        // ANISOTROPICALLY — three repeats round the circumference against a fifth of one down the
        // length — so the noise is drawn out into STREAKS along the shaft: the striated light a
        // rippled surface pours down, where the old round simplex blobs read as a pale tube.
        // Scrolled down the shaft, with its two scalar channels (value noise .b, the stretched
        // cloud field .a) cross-fading on a slow sine so the streaks evolve instead of sliding as
        // a rigid decal. uv.x x3 is an integer, so the open cone's seam lands on a tile repeat.
        const rayTex = texture(detailTex, vec2(rUv.x.mul(3), rUv.y.mul(0.2).add(uTime.mul(-0.02))));
        const rayShimmer = mix(
            rayTex.b,
            clamp(rayTex.a.sub(0.42).mul(3.57), 0, 1),
            sin(uTime.mul(0.37)).mul(0.5).add(0.5),
        );
        // Same NaN guard as before: pow() with a negative base is UNDEFINED in WGSL. Clamp first.
        // Wider swing than the simplex had (0.25..1, was 0.45..1): the streaks ARE the shaft now.
        const rayShimmerSafe = clamp(rayShimmer, 0, 1).pow(1.5)
            .mul(0.75)
            .add(0.25);
        // Bypasses toOutput (no grade on the shafts), so it takes the departure fade directly.
        // Item 4: a luminous teal-white, not the script's sun. Under water the script's sun is
        // a dim steel blue (0x4080a0 at mid-water), and ADDED onto a blue column it carried no
        // contrast at all — the shafts were present in every capture and readable in none.
        rayMat.colorNode = mix(
            mix(uSunColour, vec3(0.62, 0.96, 1.0), 0.65).mul(rayHue).mul(uOutputScale),
            uWorldFadeColour,
            uWorldFade,
        );
        // 0.55 -> 0.34: the flip put the wide (formerly buried) half of every cone in front
        // of the camera, and DoubleSide additive pays both walls — at the old master the
        // shafts read as solid pipes.
        // x uLife: the shafts arrive with the ocean as the quench veil thins (1->2 carry), never
        // as additive light inside Earth Core's cavern.
        // EACH SHAFT BREATHES ON ITS OWN (Act I overhaul, 2026-10-20): the surface's ripples move,
        // so the light each one lets down waxes and wanes — a per-shaft phase (a static instance
        // attribute) instead of nine identical, constant pipes.
        const rayPhase = attribute('aRayPhase', 'float');
        const rayBreath = sin(uTime.mul(0.11).add(rayPhase.mul(6.2831853))).mul(0.5).add(0.5)
            .mul(sin(uTime.mul(0.29).add(rayPhase.mul(17.0))).mul(0.25).add(0.75))
            .mul(0.7)
            .add(0.3);
        rayMat.opacityNode = vFade.mul(eFade).mul(rayNear).mul(raySeen).mul(rayAbove)
            .mul(rayShimmerSafe)
            .mul(rayBreath)
            .mul(uSubmerged)
            .mul(uLife)
            .mul(uShaftGain)
            // 0.52 -> 0.62: the streaked shimmer's mean sits ~a quarter under the simplex's.
            // 0.62 -> 0.80 (2026-11-21): the extinction and the soft edge take their share.
            .mul(0.80)
            .toVar();
        // THE BLEND-BANDWIDTH FLOOR (the cloud deck's lesson): most of a wall's area sits at
        // near-zero opacity (depth feather, edge-on fade, near fade) and each of those fragments
        // still paid a read-modify-write of the HDR target. Discarding under 1/160 costs nothing
        // that can be seen (an additive 0.006 of teal) and keeps the blend for the shaft itself.
        rayMat.alphaTest = 0.006;
        rayMat.transparent = true;
        rayMat.blending = THREE.AdditiveBlending;
        rayMat.depthWrite = false;
        rayMat.side = THREE.DoubleSide;
        rayMat.forceSinglePass = true;
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
        const rayCosT = new THREE.Vector3(0, 1, 0).applyQuaternion(tilt).y;
        // Radius 7 again (the masterpiece pass's 10 doubled each cone's end-on fill — see rayCount).
        const rayGeo = new THREE.ConeGeometry(7, 240, 14, 1, true);
        // WAVE 4: RIGHT WAY UP. ConeGeometry seats the wide base (uv.y=0, where vFade is
        // brightest) at the BOTTOM and the apex at the top — so the shafts were brightest at
        // their deep end, the bright base buried below the seabed, and the thin dark apex
        // poking above the surface. Flipping the geometry puts the wide bright end AT the
        // surface and tapers the shaft dark toward the floor, which is what refracted
        // surface light does.
        rayGeo.rotateX(Math.PI);
        const rayPhases = new Float32Array(rayCount);
        for (let i = 0; i < rayCount; i += 1) rayPhases[i] = hash01((i * 7) + 5);
        rayGeo.setAttribute('aRayPhase', new THREE.InstancedBufferAttribute(rayPhases, 1));
        rayMesh = new THREE.InstancedMesh(rayGeo, rayMat, rayCount);
        const rm4 = new THREE.Matrix4();
        const rPos = new THREE.Vector3();
        const rScl = new THREE.Vector3();
        for (let i = 0; i < rayCount; i += 1) {
            const pt = rayPoints[Math.floor((i / rayCount) * rayPoints.length)];
            const a = hash01(i * 3 + 1) * Math.PI * 2;
            const r = 18 + (hash01(i * 3 + 2) * 46);
            // Base (wide, bright end) just above the surface; the apex feathers down to
            // ~SEA-236, dark before it can meet the deepest floor (~SEA-207).
            // (2026-11-21: re-seated so the wide end reaches 12 u over the surface along the lean,
            // its rim's lowest point still above it; the shader cuts it at the surface.)
            rPos.set(pt.x + (Math.cos(a) * r), ODYSSEY_SEA_LEVEL + 12 - (120 * rayCosT), pt.z + (Math.sin(a) * r));
            const sc = 0.75 + (hash01(i * 3 + 3) * 0.7);
            rScl.set(sc, 1, sc);
            rayMesh.setMatrixAt(i, rm4.compose(rPos, tilt, rScl));
            // The motes below read these: marine snow is lit where a shaft crosses it.
            shaftAxes.push({
                x: rPos.x, y: rPos.y, z: rPos.z, radius: 7 * sc, phase: rayPhases[i],
            });
        }
        shaftDir.set(0, 1, 0).applyQuaternion(tilt);
        rayMesh.instanceMatrix.needsUpdate = true;
        rayMesh.frustumCulled = false;
        rayMesh.renderOrder = 3;
        rayMesh.name = 'odyssey-world-godrays';
        group.add(rayMesh);
    }

    // ── motes (Wave 4: the particulate the luminous ocean was missing) ─────────────
    // a painted film's transmitted-light rig, sized for Lane B: the spores are LIGHT SOURCES, so
    // each mote's brightness scales with how dark the water behind it is (deeper = brighter
    // relative to its background), and serenity comes from CONSTANT velocity — no easing.
    // ONE material, ONE instanced draw, and the budget lever is SIZE, not count: additive
    // overdraw is what killed Cosmic Noir on this lane, and a 0.5–1.1 u quad cannot overdraw
    // much no matter how many there are.
    let moteMesh = null;
    let moteMat = null;
    if (openWater.length > 2) {
        const MOTES = 640;
        const mSeed = new Float32Array(MOTES);
        const mOrigin = new Float32Array(MOTES * 3);
        for (let i = 0; i < MOTES; i += 1) {
            const pt = openWater[Math.floor((i / MOTES) * openWater.length)];
            const h = (bits) => {
                let v = Math.imul(bits ^ 0x27d4eb2f, 2654435761);
                v = Math.imul(v ^ (v >>> 13), 1274126177);
                return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
            };
            mSeed[i] = h(i * 5 + 1);
            const a = h(i * 5 + 2) * Math.PI * 2;
            const r = 6 + (h(i * 5 + 3) * 64);
            const mx = pt.x + (Math.cos(a) * r);
            const mz = pt.z + (Math.sin(a) * r);
            // Seeded from the OPEN-WATER span (see `openWater`), so no station is in the shaft
            // and every mote clears the bed under its own XZ — the old reseat rule, now total.
            const my = Math.min(
                Math.max(pt.y + ((h(i * 5 + 4) - 0.35) * 90), relief.sample(mx, mz) + 2),
                ODYSSEY_SEA_LEVEL - 3,
            );
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
        // The rise clock is `uTime + uMoteLift`: the CPU banks EXTRA phase while the 1->2 carry
        // speeds the column up (a bubble rises far faster than a drifting speck). Scaling uTime
        // instead would teleport every mote the moment the speed changed. uMoteLift is 0 with no
        // carry, so the column is today's, bit for bit.
        const mPhaseT = uTime.add(uMoteLift);
        const mRise = fract(mPhaseT.mul(0.014).mul(mS.mul(0.5).add(0.6)).add(mS));
        const mSway = sin(uTime.mul(0.30).add(mS.mul(41))).mul(2.2);
        // A rising bubble zig-zags; the wobble only exists while the column is carried.
        const mWobble = sin(mPhaseT.mul(2.3).add(mS.mul(57))).mul(uQuench.mul(0.9));
        // MARINE SNOW (Act I overhaul, 2026-10-20). Two motes in three SINK, slowly, against the
        // ascent — the flakes of a deep sea — while the third rise as before. Each runs its own
        // phase (no switch between the two, so nothing jumps when the 1->2 carry ends); the
        // sinkers stay hidden while the column is carried, when every speck is a rising bubble.
        const mSink = tslStep(0.34, fract(mS.mul(5.71)));
        const mFall = fract(uTime.mul(-0.0055).mul(mS.mul(0.5).add(0.6)).add(mS.mul(1.7)));
        const mLift = mix(mRise, mFall, mSink);
        // Both ends of the travel fade, so a wrap never pops a speck from one end to the other.
        const mEnds = smoothstep(float(0.0), float(0.06), mLift).mul(float(1).sub(smoothstep(float(0.94), float(1.0), mLift)));
        const moteDrift = vec3(
            mO.x.add(mSway).add(mWobble),
            mO.y.add(mLift.mul(70)),
            mO.z.add(mSway.mul(0.7)).add(mWobble.mul(0.6)),
        );
        // ── THE 2->3 SPRAY (bubbles become spray) ─────────────────────────────────────────
        // A third of the motes double as droplets: when the eye breaks the surface (uSpray > 0)
        // they leave the column — which the camera is leaving too — and burst CAMERA-RELATIVE:
        // born in a loose disc just ahead of the lens, flying outward past it, thrown up then
        // falling, so the climb out of the sea throws water at the edges of the frame. The
        // camera basis comes from the view matrix (rows of its rotation), so nothing new is
        // uploaded. Vertex ALU on 640 quads, and only the selected third ever moves.
        const mSpraySel = tslStep(0.78, fract(mS.mul(13.37)));
        const sprayOn = mSpraySel.mul(tslStep(0.0005, uSpray));
        const camR = vec3(cameraViewMatrix.element(0).x, cameraViewMatrix.element(1).x, cameraViewMatrix.element(2).x);
        const camU = vec3(cameraViewMatrix.element(0).y, cameraViewMatrix.element(1).y, cameraViewMatrix.element(2).y);
        const camF = vec3(cameraViewMatrix.element(0).z, cameraViewMatrix.element(1).z, cameraViewMatrix.element(2).z)
            .negate();
        const sAng = fract(mS.mul(91.7)).mul(6.2831853);
        // Weighted to the LOWER half of the frame — the surface the eye just broke is below it.
        const sDir = camR.mul(cos(sAng)).add(camU.mul(sin(sAng).mul(0.7).sub(0.45)));
        // Never nearer than 1.4 u: spray at the edges of the frame, not ON the lens. Born LOW in
        // the frame (the surface the eye just left is below it), thrown up, then falling away.
        const sAhead = max(fract(mS.mul(53.3)).mul(6.5).add(1.8).sub(uSprayAge.mul(1.6)), float(1.4));
        const sOut = fract(mS.mul(37.1)).mul(1.4).add(0.25)
            .add(fract(mS.mul(17.9)).mul(4.5).add(1.5).mul(uSprayAge));
        const sLift = fract(mS.mul(7.7)).mul(3.4).add(0.8).mul(uSprayAge)
            .sub(uSprayAge.mul(uSprayAge).mul(5.2))
            .sub(fract(mS.mul(43.9)).mul(1.6).add(0.4));
        const sprayCenter = cameraPosition.add(camF.mul(sAhead)).add(sDir.mul(sOut)).add(vec3(0, sLift, 0));
        const moteCenter = mix(moteDrift, sprayCenter, sprayOn);
        // 0.5–1.1 u world size, AND screen-space capped (plan Wave 3): the reseat lifts 267
        // previously-buried motes into open water, so the additive fill they can spend is
        // clamped — a mote may never exceed ~1.2 degrees of screen no matter how close it
        // drifts to the eye. Far motes keep their world size (the min never binds).
        // Item 4: ~3 % of motes are BIOLUMINESCENT — three times the size, a warmer cyan, and
        // slow to pulse — the rare larger glows that make a column of specks read as alive.
        const mGlow = tslStep(0.97, fract(mS.mul(7.13)));
        // THE PLANKTON BLOOM (the sea's clock): where the wandering patch lies, the specks flare.
        const vBloom = varying(
            uBloom.w.mul(float(1).sub(smoothstep(float(9), float(46), length(moteDrift.sub(uBloom.xyz))))),
            'vMoteBloom',
        );
        const moteSize = mS.mul(0.6).add(0.5).mul(mGlow.mul(2.0).add(1)).mul(vBloom.mul(0.7).add(1));
        // Droplets: FINE spray (2-6 cm) — at 2-8 u ahead of the lens that is a 5-15 px sparkle;
        // the first cut's 16 cm beads read as snowballs.
        const spraySize = fract(mS.mul(29.3)).mul(0.04).add(0.02);
        const moteDist = length(moteCenter.sub(cameraPosition));
        const moteSizeClamped = min(
            mix(moteSize, spraySize, sprayOn),
            moteDist.mul(mix(float(0.02), float(0.05), sprayOn)).add(0.04),
        );
        moteMat.positionNode = billboardWorld(moteCenter, moteSizeClamped);
        // LIT WHERE A SHAFT CROSSES IT (Act I overhaul, 2026-10-20 — Ocean's "lit where a shaft
        // crosses it"). Each mote measures itself against the nine shafts' axes (known at build,
        // above) in the vertex stage: inside a cone, scaled by how near the surface it is (the
        // shaft's own fade) and by that shaft's breath, it catches the light; between the shafts
        // it sits back. So the shafts read as VOLUMES of lit water, not pale tubes.
        const shaftLight = (() => {
            let lit = float(0);
            const d = vec3(shaftDir.x, shaftDir.y, shaftDir.z);
            shaftAxes.forEach((sa) => {
                const qs = moteCenter.sub(vec3(sa.x, sa.y, sa.z));
                const t = dot(qs, d);
                const along = clamp(t.add(120).div(240), 0, 1);
                const rad = max(along.mul(sa.radius * 1.15), float(0.6));
                const inside = float(1).sub(smoothstep(rad.mul(0.3), rad, length(qs.sub(d.mul(t)))));
                const breath = sin(uTime.mul(0.11).add(sa.phase * 6.2831853)).mul(0.5).add(0.5)
                    .mul(sin(uTime.mul(0.29).add(sa.phase * 17.0)).mul(0.25).add(0.75))
                    .mul(0.7)
                    .add(0.3);
                lit = lit.add(inside.mul(along.mul(along).mul(along.add(0.4))).mul(breath));
            });
            return min(lit, float(1.5));
        })();
        const vShaftLit = varying(shaftLight, 'vMoteShaftLit');
        // THE WAKE: in the deep half, plankton near the lens wakes as the camera passes — a cool
        // spark on the specks within ~15 u, gone toward the surface where the light is daylight.
        const vWake = varying(
            float(1).sub(smoothstep(float(5), float(16), moteDist)).mul(smoothstep(float(0.45), float(0.9), uEyeDepth)),
            'vMoteWake',
        );
        const mUv = uv();
        const mR = length(mUv.sub(vec2(0.5)));
        const mRadial = float(1).sub(smoothstep(float(0.0), float(0.5), mR));
        const mDot = mRadial.mul(mRadial);
        // An ember is a hot DOT; a bubble is a bright RIM round a clearer centre. uBubble walks
        // the profile from one to the other across the carry (0 = today's dot exactly).
        const mRing = smoothstep(float(0.20), float(0.38), mR)
            .mul(float(1).sub(smoothstep(float(0.38), float(0.5), mR)))
            .add(mDot.mul(0.30));
        const mProfile = mix(mDot, mRing.mul(1.3), uBubble);
        // Transmitted light: brightness rises with depth below the surface, because the
        // background darkens with depth — the same inverse the vault's ember gate uses.
        const mDepth = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(120), 0, 1);
        const moteBase = mix(
            mix(vec3(0.55, 0.85, 0.90), vec3(0.35, 0.75, 0.80), mDepth)
                .mul(mDepth.mul(0.9).add(0.35))
                // In a shaft it catches the light; between the shafts it sits back.
                .mul(float(0.5).add(vShaftLit.mul(2.3)))
                .add(vec3(0.20, 0.95, 0.88).mul(vWake).mul(0.7))
                .add(vec3(0.26, 1.0, 0.46).mul(vBloom).mul(1.1)),
            vec3(0.42, 1.0, 0.84),
            mGlow,
        );
        // Carried: the column wears the quench's tint (ember -> white -> cyan, CPU-walked).
        const moteCarried = mix(moteBase, uMoteTint, uQuench);
        moteMat.colorNode = mix(
            mix(moteCarried, vec3(0.92, 0.98, 1.0), sprayOn).mul(uOutputScale),
            uWorldFadeColour,
            uWorldFade,
        );
        // TWINKLE: each speck catches the light on its own slow clock (a drifting flake turning),
        // so the field glitters instead of sitting as a static star map.
        const mTwinkle = sin(uTime.mul(mS.mul(2.6).add(0.9)).add(mS.mul(40))).mul(0.5).add(0.5);
        const mPulse = sin(uTime.mul(0.7).add(mS.mul(17))).mul(0.35).add(0.65);
        // Carried bubbles burn brighter, so the column reads through what is left of the veil.
        const moteAlpha = mProfile.mul(uSubmerged)
            .mul(mix(mTwinkle.mul(mTwinkle).mul(0.55).add(0.12), mPulse.mul(0.75), mGlow))
            .mul(uQuench.mul(0.9).add(1))
            .mul(mEnds)
            // Sinkers sit out the carry (the bubbles rise alone), then join the snow.
            .mul(float(1).sub(mSink.mul(uQuench)))
            .mul(vWake.mul(0.8).add(1))
            .mul(vBloom.mul(1.5).add(1));
        // Each droplet has its own life inside the burst (0.9-1.8 s) and fades over its last half.
        const sLifeT = clamp(uSprayAge.div(fract(mS.mul(11.1)).mul(0.9).add(0.9)), 0, 1);
        const sprayAlpha = mDot.mul(uSpray).mul(float(1).sub(smoothstep(float(0.55), float(1.0), sLifeT))).mul(0.85);
        // Through the steam: the share of the mote's light the vapour lets reach the eye (the
        // board's steam fog, 0.042 at full weight).
        const moteVeilD = moteDist.mul(uMoteVeil.mul(0.042));
        const vMoteVeil = varying(exp(moteVeilD.mul(moteVeilD).negate()), 'vMoteVeil');
        moteMat.opacityNode = mix(moteAlpha.mul(vMoteVeil), sprayAlpha, sprayOn);
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

    // ── fish (item 3: SCHOOLS on ribbon paths, countershaded, flashing) ─────────────
    // Four schools wheeling round the ascent in ONE instanced draw (odyssey-fish.js): two hulls
    // modelled in Blender (a schooling jack, a cruising tuna; scripts/blender/odyssey/
    // odyssey_fish.py) swimming by a body wave in the vertex stage, countershaded with a flank
    // flash. Hazed by the world's water, behind the 1->2 steam, and seen through the surface after
    // the breach while any school still shows (the jellies keep the same rules).
    const fish = openWater.length > 2 ? createOdysseyFish({
        uTime,
        uLife,
        seaLevel: ODYSSEY_SEA_LEVEL,
        openWater,
        heightAt: (x, z) => relief.sample(x, z),
        haze: (c, wp) => applyAerial(c, wp, AERIAL_CEIL_WATER, 1, false, float(1).sub(uLife)),
        grade: toOutput,
        positionWorld,
        cameraPosition,
    }) : null;
    if (fish) group.add(fish.mesh);

    // ── jellyfish (2026-11-01): a living drift in the open water, one draw ─────────────────
    // The big animals swim long loops and are in view part of the time; between their passes the
    // mid-water was sparse. A few dozen jellies hang in it on their own slow loops (placed on the
    // real rail camera, odyssey-jellyfish-drift.js), beating and trailing their strands, so the
    // climb is never through empty water (odyssey-jellyfish.js). Hazed by the world's water as the
    // fish are, behind the 1->2 steam while it is up, and seen through the surface after the
    // breach while any of them still shows (the fish's rules).
    const jellyfish = openWater.length > 2 ? createOdysseyJellyfish({
        uTime,
        uLife,
        seaLevel: ODYSSEY_SEA_LEVEL,
        haze: (c, wp) => applyAerial(c, wp, AERIAL_CEIL_WATER, 1, false, float(1).sub(uLife)),
        grade: toOutput,
        gradeLight: (c) => toOutputFaded(c, float(0)),
    }) : null;
    if (jellyfish) group.add(jellyfish.mesh);

    // ── ocean forms (Odyssey audit 2026-10-18): what stands in the blue around the column ──
    // Spires in the deep bowl and kelp on the shelf (odyssey-ocean-forms.js), so a look away from
    // the rail — an orb close-up, the arrival orbit — finds silhouettes layered by the water's
    // own extinction instead of one flat teal field. Shaded like the fish: facet normals from
    // derivatives (instancing-safe), the surface as the only lamp, the shared water colour, and
    // the same `uLife` haze so nothing stands crisp in Earth Core's steam.
    const oceanPlan = planOceanForms({
        heightAt: (x, z) => relief.sample(x, z),
        rail: openWater,
        seaLevel: ODYSSEY_SEA_LEVEL,
        quality,
    });
    let spireMesh = null;
    let spireMat = null;
    let kelpMesh = null;
    let kelpMat = null;
    const formEye = normalize(cameraPosition.sub(positionWorld));
    const formNormal = (() => {
        const n = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
        return n.mul(sign(dot(n, formEye)).add(0.0001));
    })();
    const formDepth = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(200), 0, 1);
    const formLifeHaze = float(1).sub(uLife);
    if (oceanPlan.spires.length > 0) {
        spireMat = new THREE.MeshBasicNodeMaterial();
        const sH = positionGeometry.y;
        // Dark green-grey rock that lifts toward the crown the light reaches.
        const sAlbedo = mix(vec3(0.07, 0.10, 0.10), vec3(0.21, 0.27, 0.24), smoothstep(float(0), float(1), sH));
        const sDown = clamp(formNormal.y.mul(0.5).add(0.5), 0, 1);
        const sLight = mix(float(0.42), float(1.1), sDown.pow(1.3)).mul(float(1).sub(formDepth.mul(0.5)));
        const sLit = sAlbedo.mul(sLight);
        spireMat.colorNode = toOutput(applyAerial(sLit, positionWorld, AERIAL_CEIL_WATER, 1, false, formLifeHaze));
        spireMat.depthNode = behindSteamDepth(positionWorld);
        spireMat.fog = false;
        spireMesh = new THREE.InstancedMesh(buildSpireGeometry(), spireMat, oceanPlan.spires.length);
        const sm4 = new THREE.Matrix4();
        const sq = new THREE.Quaternion();
        const se = new THREE.Euler();
        oceanPlan.spires.forEach((s, i) => {
            sq.setFromEuler(se.set(s.leanX, s.yaw, s.leanZ, 'YXZ'));
            const sPos = new THREE.Vector3(s.x, s.y, s.z);
            spireMesh.setMatrixAt(i, sm4.compose(sPos, sq, new THREE.Vector3(s.radius, s.height, s.radius)));
        });
        spireMesh.instanceMatrix.needsUpdate = true;
        spireMesh.computeBoundingSphere();
        spireMesh.name = 'odyssey-world-spires';
        group.add(spireMesh);
    }
    if (oceanPlan.kelp.length > 0) {
        const kGeo = buildKelpGeometry();
        const kAttr = new Float32Array(oceanPlan.kelp.length * 2);
        oceanPlan.kelp.forEach((k, i) => { kAttr[i * 2] = k.phase; kAttr[(i * 2) + 1] = k.height; });
        kGeo.setAttribute('aKelp', new THREE.InstancedBufferAttribute(kAttr, 2));
        kelpMat = new THREE.MeshBasicNodeMaterial();
        const kA = attribute('aKelp', 'vec2');
        const kY = positionGeometry.y;
        // The current bends the fronds more toward their tips; two slow waves so a stand never
        // sways in lock-step. positionLocal already carries the instance transform.
        const kBend = kY.pow(1.6);
        const kSwayX = sin(uTime.mul(0.55).add(kA.x).add(kY.mul(2.4))).mul(kA.y.mul(0.07)).mul(kBend);
        const kSwayZ = sin(uTime.mul(0.37).add(kA.x.mul(1.7)).add(kY.mul(3.1))).mul(kA.y.mul(0.045)).mul(kBend);
        kelpMat.positionNode = positionLocal.add(vec3(kSwayX, 0, kSwayZ));
        const kAlbedo = mix(vec3(0.085, 0.11, 0.04), vec3(0.27, 0.32, 0.085), kY);
        const kDown = clamp(formNormal.y.mul(0.5).add(0.5), 0, 1);
        // Seen from below, a frond glows: the surface light comes THROUGH the blade.
        const kBack = smoothstep(float(0.15), float(0.75), formEye.negate().y).mul(kY);
        const kLit = kAlbedo.mul(mix(float(0.55), float(1.0), kDown))
            .add(vec3(0.26, 0.34, 0.10).mul(kBack))
            .mul(float(1).sub(formDepth.mul(0.45)));
        kelpMat.colorNode = toOutput(applyAerial(kLit, positionWorld, AERIAL_CEIL_WATER, 1, false, formLifeHaze));
        kelpMat.depthNode = behindSteamDepth(positionWorld);
        kelpMat.side = THREE.DoubleSide;
        kelpMat.fog = false;
        kelpMesh = new THREE.InstancedMesh(kGeo, kelpMat, oceanPlan.kelp.length);
        const km4 = new THREE.Matrix4();
        const kq = new THREE.Quaternion();
        const yAxis = new THREE.Vector3(0, 1, 0);
        oceanPlan.kelp.forEach((k, i) => {
            kq.setFromAxisAngle(yAxis, k.yaw);
            const kPos = new THREE.Vector3(k.x, k.y, k.z);
            kelpMesh.setMatrixAt(i, km4.compose(kPos, kq, new THREE.Vector3(k.width, k.height, 1)));
        });
        kelpMesh.instanceMatrix.needsUpdate = true;
        // The sway moves tips a few units outside the static bounds: pad the sphere.
        kelpMesh.computeBoundingSphere();
        kelpMesh.boundingSphere.radius += 12;
        kelpMesh.name = 'odyssey-world-kelp';
        group.add(kelpMesh);
    }
    // ── THE ISLAND'S UNDERWATER FLANK (masterpiece pass, 2026-11-17) ──────────────────────
    // The kelp tower, the sea stacks, the coral and the forest on the slope every orb's close-up
    // looks at (odyssey-ocean-reef.js plants them, odyssey-ocean-scenery.js draws them): two
    // static draws in the world's own water haze, behind the 1->2 steam like the spires.
    const oceanScenery = openWater.length > 2 ? createOdysseyOceanScenery({
        heightAt: (x, z) => relief.sample(x, z),
        rail: openWater,
        seaLevel: ODYSSEY_SEA_LEVEL,
        quality,
        uTime,
        noiseTex: detailTex,
        haze: (c, wpos) => applyAerial(c, wpos, AERIAL_CEIL_WATER, 1, false, formLifeHaze),
        grade: toOutput,
        depthNode: behindSteamDepth,
        gradeLight: (c) => toOutputFaded(c, float(0)),
        sun: ODYSSEY_WORLD_SUN,
        sunColour: uSunColour,
        uLife,
    }) : null;
    if (oceanScenery) group.add(oceanScenery.group);
    // THE BREACH (composition/odyssey-breach-burst.js): the crown of water, the sheet running off
    // the lens and the light flooding in when the eye breaks the surface; bubbles when it dives.
    const breachBurst = openWater.length > 2 ? createOdysseyBreachBurst({
        seaLevel: ODYSSEY_SEA_LEVEL,
        noiseTex: detailTex,
        gradeLight: (c) => toOutputFaded(c, float(0)),
        quality,
    }) : null;
    if (breachBurst) group.add(breachBurst.group);
    // THE DOLPHINS IN THE BAY (odyssey-dolphins.js; their clock route is composition/
    // odyssey-dolphin-pod.js): a pod porpoising between the breach and the shore, in the water's
    // haze below the surface and the world's sun above it, decided per fragment.
    const dolphinPod = openWater.length > 2 ? createOdysseyDolphins({
        seaLevel: ODYSSEY_SEA_LEVEL,
        quality,
        noiseTex: detailTex,
        haze: (c, wpos) => applyAerial(c, wpos, AERIAL_CEIL_WATER, 1, false, formLifeHaze, true, false),
        grade: toOutput,
        gradeLight: (c) => toOutputFaded(c, float(0)),
        depthNode: behindSteamDepth,
        sunDir: uSunDir,
        sunColour: uSunColour,
        skyLight: mix(uSkyHorizon, uSkyZenith, float(0.45)),
    }) : null;
    if (dolphinPod) group.add(dolphinPod.group);

    // ── forest ──
    // MEASUREMENT LEVER (see the `forest` option). When off, the scatter never runs, so no
    // chunk is bucketed, no InstancedMesh is built and `treeMat` never reaches a render —
    // zero draws, zero vertex work, zero fill AND zero pipeline compile. Same shape as the
    // `water` gate, and deliberately NOT the deck's asymmetric "built but withheld" shape:
    // the forest's own header law says its cost is VERTEX, so a gate that left the meshes
    // constructed would price the wrong thing.
    //
    // The materials below are still built unconditionally, exactly as the water's are: TSL nodes are
    // plain JS until a mesh that uses them is rendered, and the fog opt-out and dispose lists keep
    // covering them. Everything downstream degrades to a no-op through the empty array.
    // Each tree sinks out of the draw distance by its own distance from the rail (FOREST_DRAW_NEAR).
    const forestReachSink = (xz) => smoothstep(
        float(FOREST_DRAW_NEAR),
        float(FOREST_DRAW_FAR),
        length(xz.sub(uLodCenter)),
    ).mul(-FOREST_FADE_SINK);
    const forestMats = createForestMaterials({
        pullTex: forestTextures.pullTex,
        leafTex: forestTextures.leafTex,
        farTex: forestTextures.farTex,
        uOn: uForestOn,
        edgeCut: sceneMultisampled ? 0.02 : 0.5,
        cameraPosition,
        positionWorld,
        uTime,
        uSunDir,
        uSkyHorizon,
        landSunOf,
        landHourOf,
        dayTurnOf,
        gustFront,
        // Read once a vertex: a crown is several cards deep on screen.
        cloudLight: (xz, turn) => (q.cloudShadows ? cloudShadowLight(xz, turn) : float(1).sub(turn.x.mul(uTurn.w))),
        reachSink: forestReachSink,
        hourGold: { gain: ODYSSEY_HOUR_LOOK.capGold / ODYSSEY_HOUR_LOOK.alpenglow, tint: ODYSSEY_HOUR_LOOK.capGoldTint },
        silver: ODYSSEY_DAY_TURN.silver * 0.6,
        // The trees stand IN the valley mist with the ground under them.
        finish: (c, at) => toOutput(applyAerial(c, at, AERIAL_CEIL_WATER, 1, true)),
    });
    const treeMeshes = [];
    // The trees round the 18->19 glide's view, for the turn's wake (odyssey-turn-wake.js).
    const wakeTrees = [];
    let forestStats = null;
    let forestPlacements = null;
    let forestClearedSites = [];
    if (forest) {
        // The scatter is pure arithmetic over the height mirror and the rail, so the world-bake
        // worker runs it while this thread builds clipmaps and material graphs (item 2.1
        // follow-up). `prebaked.scatter` is trusted only when the bake was asked for THIS tree
        // count and LOD policy — the loader is handed the same options object.
        const tier = forestTier(qualityTier);
        const scatterOptions = {
            spacing: q.treeSpacing,
            seaLevel: ODYSSEY_SEA_LEVEL,
            rail: railSamples,
            visibilityCull,
            meadowClearing,
            forceLod: forestLod,
            lodDistance: { hero: tier.hero, mid: tier.mid },
        };
        const zoned = pre.scatter && pre.scatter.stats?.trees > 0
            ? pre.scatter
            : scatterZonedForest(relief.sample, scatterOptions);
        // The shade plate the ground was built against: baked with a scatter from the worker,
        // otherwise here, from this one (before the first frame, so nothing pops in).
        if (!zoned.shade) zoned.shade = bakeForestShadeData(zoned.placements, relief.sample);
        if (forestShadeTex.image.data !== zoned.shade.data) {
            forestShadeTex.image.data = zoned.shade.data;
            forestShadeTex.needsUpdate = true;
        }
        if (!zoned.floor) zoned.floor = bakeForestFloorData(forestClosure(zoned.placements));
        if (forestFloorTex.image.data !== zoned.floor.data) {
            forestFloorTex.image.data = zoned.floor.data;
            forestFloorTex.needsUpdate = true;
        }
        let triangles = 0;
        // Front to back along the journey, nearest tier first: the meshes all stand at the origin, so three
        // draws them in this order.
        const tierRank = { hero: 0, mid: 1, far: 2 };
        const inOrder = [...zoned.buckets.values()]
            .sort((a, b) => (tierRank[a.lod] - tierRank[b.lod]) || (b.centre.z - a.centre.z));
        inOrder.forEach((bucket) => {
            const mesh = buildForestMesh(bucket, forestMats, { sunVisAt, cardShare: tier.cards });
            if (!mesh) return;
            triangles += mesh.userData.forest.triangles;
            group.add(mesh);
            treeMeshes.push(mesh);
        });
        zoned.placements.forEach((t) => {
            if (!inTurnWakeReach(t.x, t.z) || t.role === 'shrub' || t.role === 'floor') return;
            wakeTrees.push({
                x: t.x, y: t.y, z: t.z, top: t.y + t.height, broad: turnWakeSheds(t.speciesId),
            });
        });
        forestStats = { ...zoned.stats, triangles: Math.round(triangles) };
        // (A fern gives way to a boulder, not the boulder to the fern.)
        forestPlacements = zoned.placements.filter((t) => t.role !== 'floor');
        // The horses' meadow's cleared sites still count for the boulders' clearance (they stay as they were).
        forestClearedSites = zoned.meadowCleared ?? [];
    }
    // THE TURN'S WAKE (odyssey-turn-wake.js): as the turning shade's edge passes the rail, leaves
    // let go of the crowns along it and birds lift out of them. One alpha-tested draw of leaves and
    // the fieldfares' own draw (the Blender bird, odyssey-wake-fieldfares.js) as its child, so they
    // are shown, hidden and compiled with it; drawn only while a wake is in the air.
    const wakeLightAt = (xz) => {
        const turn = dayTurnOf(xz).toVar();
        return {
            sun: landSunOf(turn),
            direct: q.cloudShadows ? cloudShadowLight(xz, turn) : float(1).sub(turn.x.mul(uTurn.w)),
        };
    };
    const wakeToOutput = (c, at) => toOutputSurface(applyAerial(c, at, AERIAL_CEIL_LAND, AERIAL_RATE_LAND));
    const turnWake = wakeTrees.length
        ? createOdysseyTurnWake({
            trees: wakeTrees,
            heightAt: relief.sample,
            time: uTime,
            leaves: q.cloudShadows ? ODYSSEY_TURN_WAKE.leaves.count : Math.round(ODYSSEY_TURN_WAKE.leaves.count * 0.4),
            // The summer's greens (a leaf in the air is lit through).
            tints: [[0.36, 0.46, 0.12], [0.50, 0.54, 0.15], [0.30, 0.40, 0.10], [0.58, 0.56, 0.18]],
            lightAt: wakeLightAt,
            skyColour: uSkyHorizon,
            toOutput: wakeToOutput,
        })
        : null;
    const wakeFieldfares = turnWake
        ? createWakeFieldfares({
            birds: turnWake.plan.birds,
            time: uTime,
            uWake: turnWake.uniforms.uWake,
            lightAt: wakeLightAt,
            skyColour: uSkyHorizon,
            sunDir: uSunDir,
            toOutput: wakeToOutput,
        })
        : null;
    if (turnWake) group.add(turnWake.mesh);
    if (wakeFieldfares) turnWake.mesh.add(wakeFieldfares.mesh);

    // ── BOULDERS AND OUTCROPS (Act II leftovers, 2026-11-02; odyssey-boulders.js) ─────────────
    // Rocks for scale on the meadows and slopes, sited on the rail camera. Three shapes at two
    // tiers, six instanced meshes, one material. Lit as the ground's rock is: the S-shaped Lambert
    // under the baked sun (terrain and tree shadows, the drifting cloud shade), rock's mineral shade
    // (desaturated, the warm deep tint, the sky's fill from above), the meadow creeping up the foot
    // and a little lichen on the tops, then the ground's own air and mist.
    const boulderMat = new THREE.MeshBasicNodeMaterial();
    boulderMat.name = 'OdysseyWorldBoulders';
    const boulderMeshes = [];
    let boulderRocks = [];
    {
        const vRock = varying(vec4(0), 'odBoulderLook');
        boulderMat.positionNode = Fn(() => {
            vRock.assign(attribute('aRock', 'vec4'));
            return positionLocal;
        })();
        const boulderCol = Fn(() => {
            const N = normalize(normalWorld).toVar();
            const P = positionWorld.toVar();
            const tone = vRock.x;
            const moss = vRock.y;
            // 0 at the ground under the rock, 1 at its top.
            const lift = clamp(P.y.sub(vRock.z).div(max(vRock.w, float(0.5))), 0, 1).toVar();
            const grain = noise2(P.xz.mul(0.31).add(P.y.mul(0.23))).mul(0.22)
                .add(noise2(P.xz.mul(0.09).sub(P.y.mul(0.07))).mul(0.16))
                .add(0.83);
            // Darker than the painted scree (it stands against the meadow, not on the rock), a
            // little warm or cool from one rock to the next.
            const rockAlb = mix(
                vec3(...ODYSSEY_GROUND_PALETTE.rock.damp),
                vec3(...ODYSSEY_GROUND_PALETTE.rock.dry).mul(vec3(1.0, 0.96, 0.88)),
                tone.mul(0.55),
            ).mul(grain);
            // Lichen and moss on the open tops (an olive-gold); the meadow creeping up the foot.
            const lichen = mix(
                vec3(...ODYSSEY_GROUND_PALETTE.grass.damp),
                vec3(...ODYSSEY_GROUND_PALETTE.grass.dry),
                0.55,
            ).mul(1.35);
            const top = smoothstep(float(0.5), float(0.92), N.y).mul(moss).mul(0.55);
            const foot = float(1).sub(smoothstep(float(0.0), float(0.32), lift));
            const albedo = mix(
                mix(rockAlb, lichen, top),
                vec3(...ODYSSEY_GROUND_PALETTE.grass.damp).mul(1.1),
                foot.mul(0.7),
            ).toVar();
            const sunVisHere = texture(sunVisTex, P.xz.div(float(RELIEF_EXTENT)).add(0.5)).r;
            const shadeHere = texture(
                forestShadeTex,
                P.xz.sub(vec2(FOREST_SHADE_PLATE.x, FOREST_SHADE_PLATE.z)).div(FOREST_SHADE_PLATE.extent).add(0.5),
            );
            const treeLight = float(1).sub(shadeHere.r.mul(FOREST_SHADOW_DEPTH));
            // (The day's turn, as the ground under the stone takes it: odyssey-day-turn.js.)
            const bTurn = dayTurnOf(P.xz).toVar();
            const cloudLight = q.cloudShadows ? cloudShadowLight(P.xz, bTurn) : float(1);
            const ndl = max(dot(N, uSunDir), 0);
            const lightAmt = smoothstep(
                float(ODYSSEY_GROUND_SHADE.terminator[0]),
                float(ODYSSEY_GROUND_SHADE.terminator[1]),
                clamp(ndl.mul(sunVisHere).mul(treeLight).mul(cloudLight), 0, 1),
            ).toVar();
            const albLuma = dot(albedo, vec3(...ODYSSEY_GROUND_LUMA));
            const shadeCol = mix(
                albedo,
                vec3(albLuma),
                float(ODYSSEY_GROUND_SHADE.mineral.desat).mul(float(1).sub(foot)),
            ).mul(mix(vec3(...ODYSSEY_GROUND_SHADE.deepTint), vec3(1), lightAmt));
            const surface = mix(shadeCol, albedo, lightAmt);
            // The sky's fill: more on faces turned up, less in the crease at the foot and under trees.
            const ambient = mix(
                float(ODYSSEY_GROUND_SHADE.deepAmbient),
                float(ODYSSEY_GROUND_SHADE.mineral.ambient).add(N.y.mul(0.08)),
                smoothstep(float(0.0), float(0.45), lift).mul(float(1).sub(shadeHere.g.mul(FOREST_FLOOR_AO))),
            );
            // The tops catch the sky, the sides fall off: the form reads even with the sun behind.
            const skyTop = N.y.mul(0.22).add(0.84);
            const value = ambient.add(float(1).sub(ambient).mul(lightAmt)).mul(float(GROUND_LIT_GAIN)).mul(skyTop);
            const ambientHue = uShadowTint.div(max(dot(uShadowTint, vec3(...ODYSSEY_GROUND_LUMA)), 0.001));
            const lightCol = mix(
                mix(vec3(1), ambientHue, float(GROUND_AMBIENT_CHROMA).add(landHourOf(bTurn).x)),
                landSunOf(bTurn),
                lightAmt,
            );
            return surface.mul(lightCol).mul(value);
        })();
        boulderMat.colorNode = toOutputSurface(applyAerial(
            boulderCol,
            positionWorld,
            AERIAL_CEIL_LAND,
            AERIAL_RATE_LAND,
            true,
        ));
        boulderRocks = buildBoulderSites(relief.sample, { trees: [...(forestPlacements ?? []), ...forestClearedSites] });
        const { lod } = ODYSSEY_BOULDERS;
        ODYSSEY_BOULDERS.shapes.forEach((_, si) => {
            const mine = boulderRocks.filter((r) => r.shape === si);
            if (!mine.length) return;
            ['near', 'far'].forEach((tier) => {
                const geo = buildBoulderGeometry(si, lod[tier]);
                const look = new THREE.InstancedBufferAttribute(new Float32Array(mine.length * 4), 4);
                geo.setAttribute('aRock', look);
                const mesh = new THREE.InstancedMesh(geo, boulderMat, mine.length);
                mesh.name = `odyssey-world-boulders-${si}-${tier}`;
                mesh.userData.boulders = { rocks: mine, tier, look };
                mesh.count = 0;
                mesh.frustumCulled = true;
                group.add(mesh);
                boulderMeshes.push(mesh);
            });
        });
    }
    // Which tier each rock is drawn at, rewritten only when one crosses `lod.switchAt`.
    let boulderTierKey = '';
    const boulderMatrix4 = new THREE.Matrix4();
    const updateBoulderTiers = (eyeX, eyeZ) => {
        if (!boulderMeshes.length) return;
        const near = (rock) => Math.hypot(rock.x - eyeX, rock.z - eyeZ) < ODYSSEY_BOULDERS.lod.switchAt;
        const key = boulderRocks.map((rock) => (near(rock) ? 1 : 0)).join('');
        if (key === boulderTierKey) return;
        boulderTierKey = key;
        boulderMeshes.forEach((mesh) => {
            const { rocks, tier, look } = mesh.userData.boulders;
            let n = 0;
            rocks.forEach((rock) => {
                if ((tier === 'near') !== near(rock)) return;
                mesh.setMatrixAt(n, boulderMatrix(rock, boulderMatrix4));
                const tall = rock.sy * ODYSSEY_BOULDERS.shapes[rock.shape].flat * 1.42;
                look.setXYZW(n, rock.tone, rock.moss, rock.ground, tall);
                n += 1;
            });
            mesh.count = n;
            mesh.computeBoundingSphere();
            mesh.instanceMatrix.needsUpdate = true;
            look.needsUpdate = true;
        });
    };
    updateBoulderTiers(-160, -260);

    const t2 = (typeof performance !== 'undefined' ? performance.now() : 0);
    // The game puts a per-CHAPTER FogExp2 on the scene. Left on, it saturates the sky dome —
    // 3,600 units out is ~100% fogged at any density the chapters use — so the colour script
    // was never once visible in-game, and the ground got double-fogged on top of applyAerial.
    // These four materials carry their own aerial perspective; the scene fog is not theirs.
    [groundMat, waterMat, skyMat, lakeMat, tarnMat,
        showerMat, boulderMat]
        .forEach((m) => { m.fog = false; });

    // What the scene fog SHOULD be, for everything the world does not draw (the path ribbon,
    // the level orbs, neighbouring chapters). Exposed so one horizon drives the whole frame
    // instead of the chapter profiles of chapters that no longer exist. Colour is pre-scaled
    // into the same output space the world's own materials write.
    const fogState = { color: new THREE.Color(), density: 0.0004 };
    // FogExp2 is 1-exp(-(d*z)^2); applyAerial is 1-exp(-K*z). Equal at z = FOG_MATCH_DISTANCE.
    const FOG_MATCH_DISTANCE = 1200;
    const scratchViewDir = new THREE.Vector3();
    // The waters' cloud picks (water pass step 2): the camera's frustum and the eye.
    const waterCloudFrustum = new THREE.Frustum();
    const waterCloudProjView = new THREE.Matrix4();
    const waterCloudSphere = new THREE.Sphere();
    const waterCloudEye = new THREE.Vector3();
    const WATER_CLOUD_LEVELS = Object.freeze([ODYSSEY_SEA_LEVEL, ODYSSEY_TARN.waterY, ODYSSEY_NORTH_LAKE.waterY]);
    const waterCloudInView = (x, y, z, r) => {
        waterCloudSphere.center.set(x, y, z);
        waterCloudSphere.radius = r;
        return waterCloudFrustum.intersectsSphere(waterCloudSphere);
    };

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
        submerged: 0,
        scriptName: '',
        actT: 0,
        lodCenter: { x: 0, z: 0 },
        eyeY: null,
        // The 1->2 carry's ocean-life presence (0..1) — the whale pass reads it so the pair
        // arrives with the fish, by the same quench density, not inside the cavern.
        lifePresence: 1,
        // Seconds since the eye broke the surface (null when no spray is live) — instruments only.
        sprayAge: null,
        // The hour the world wears (0 noon .. 1 sunset) and the day's turn (0 the island's
        // morning .. 1 the mountains' afternoon; between them the shade is crossing).
        hour: 0,
        dayTurn: 0,
    };
    // THE CARRY'S HANDSHAKE. `setQuenchCarry(t)` may be called every frame or only inside the
    // quench window (the board owns that), so each call is CONSUMED by the next update(): a frame
    // with no call is the neutral ocean (t = 1: no carry, full life). That makes the world correct
    // whichever way the caller gates it, and unchanged while no caller exists at all.
    let quenchT = 1;
    let quenchFresh = false;
    let lastUpdateTime = null;
    let prevEyeY = null;
    let sprayStart = null;

    const stats = {
        quality,
        groundTriangles: ground.triangles,
        // `waterGeo`, not `water` — the option of that name is a boolean build gate, so this
        // read `undefined` for as long as the stat existed.
        waterTriangles: waterGeo.triangles,
        reach: ground.reach,
        trees: forestStats ? forestStats.trees : 0,
        forestChunks: treeMeshes.length,
        forest: forestStats,
        materials: 4 + (clouds ? 1 : 0),
        cloudCount: clouds ? skyClouds.clouds.length : 0,
        applyExposure,
        outputScale,
        outputSaturation,
        clouds,
        godRays: rayCount > 2 ? rayCount : 0,
        motes: moteMesh ? 640 : 0,
        fish: fish ? fish.count : 0,
        jellyfish: jellyfish ? jellyfish.count : 0,
        spires: oceanPlan.spires.length,
        kelp: oceanPlan.kelp.length,
        skyRadius: domeRadius,
        bakeMs: { relief: +(t1 - t0).toFixed(1), total: +(t2 - t0).toFixed(1) },
        // Item 2.1: which bakes arrived pre-baked (worker) — 'relief' above is then the wrap cost.
        prebaked: prebaked ? {
            relief: pre.relief?.res === q.reliefRes,
            textures: !!(preTex.sunFields && preTex.atlas && preTex.detail && preTex.macro),
            scatter: !!pre.scatter,
            viaWorker: !!pre.viaWorker,
            workerMs: pre.ms ?? null,
        } : null,
    };

    return {
        group,
        stats,
        state,
        heightAt: relief.sample,
        /** The five boot-bake textures, in bake order (tests pin their bytes; never mutate). */
        bakeTextures: Object.freeze({
            height: heightTex, sunVis: sunVisTex, atlas: groundTex, detail: detailTex, macro: macroTex,
        }),
        fog: fogState,
        /**
         * THE DEPARTURE FADE (Wave 1B). `setDepartureFade(t, colour)` pulls the whole world
         * toward `colour` as t goes 0 -> 1, so Act II recedes instead of being switched off.
         * The caller owns the schedule; see OdysseyBoardController, which derives it from the
         * act edge so it completes BEFORE the visibility gate fires.
         */
        setDepartureFade(t, colour = null) {
            const f = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1);
            uWorldFade.value = f;
            uFadeZenith.value = f ** DEPART_ZENITH_POW;
            uFadeHorizon.value = f ** DEPART_HORIZON_POW;
            // f^3 (1 - f), normalised to peak 1 at f = 0.75: the limb only reads against a sky
            // that has already gone dark overhead — at the symmetric 4f(1-f) it peaked while the
            // sky was still daylight blue and drew a glowing ring across it (capture, ch5 0.8).
            uLimbGlow.value = (f ** 3) * (1 - f) * 9.48;
            const dark = Math.min(Math.max((uFadeHorizon.value - 0.62) / (0.85 - 0.62), 0), 1);
            uAirglowGlow.value = uLimbGlow.value * dark * dark * (3 - (2 * dark));
            if (colour) uWorldFadeColour.value.copy(colour);
        },
        /**
         * THE CLIMB (odyssey-world-act-gate.js `worldClimbScale`): shrink the whole group by
         * `scale` toward the sea-level point beneath `eye`, which the eye sees as climbing to
         * 1 / scale times its height above the sea. The materials shade in the group's own frame
         * (THE CLIMB'S FRAME, top of this file), so haze and detail follow the climbed height.
         * The sky dome only looks along directions and keeps its size (it is counter-scaled):
         * shrunk with the rest, it would come inside the view as a ball below the eye.
         * @param {number} scale 1 = untouched
         * @param {{x:number,z:number}} eye camera position
         */
        /**
         * THE SWANS ON THE TARN (composition/odyssey-pond-life.js): their places and velocities,
         * `rows` = [x, z, vx, vz] per swan (x 1e5 = none). The tarn's water draws their wakes and
         * their reflections from these.
         * @param {ArrayLike<number>} rows
         */
        setTarnSwans(rows) {
            tarnSwanRows.forEach((v, i) => v.set(
                rows[i * 4] ?? 1e5,
                rows[(i * 4) + 1] ?? 0,
                rows[(i * 4) + 2] ?? 0,
                rows[(i * 4) + 3] ?? 0,
            ));
        },
        setClimb(scale, eye) {
            const s = Number.isFinite(scale) && eye ? Math.min(Math.max(scale, 1e-3), 1) : 1;
            if (s === 1) {
                if (group.scale.x !== 1) {
                    group.scale.setScalar(1);
                    group.position.set(0, 0, 0);
                    skyMesh.scale.setScalar(1);
                    skyMesh.position.set(0, 0, 0);
                }
                uClimb.value = 1;
                return;
            }
            group.scale.setScalar(s);
            group.position.set(eye.x * (1 - s), ODYSSEY_SEA_LEVEL * (1 - s), eye.z * (1 - s));
            skyMesh.scale.setScalar(1 / s);
            skyMesh.position.copy(group.position).multiplyScalar(-1 / s);
            uClimb.value = 1 / s;
            uClimbCentre.value.set(eye.x, ODYSSEY_SEA_LEVEL, eye.z);
        },
        /**
         * THE 1->2 CARRY (cross-session interface, seamless pass). `t` is the steam quench's own
         * `steamQuenchSeamT` (0..1, 0.5 exactly on the 1->2 boundary). Across it the motes rise
         * as bubbles tinted ember -> white -> cyan and ocean life (fish, shafts, the whale via
         * `state.lifePresence`) fades in by the quench density. Consumed by the next update();
         * a frame without a call is the neutral ocean. See `odysseyQuenchCarry`.
         */
        /**
         * THE AIRGLOW YIELDS TO THE AURORA. `setAuroraGlow(g)` (0..1, the chapter-6 band's live
         * glow, from the board) dims the airglow line as the curtains rise out of it.
         */
        /**
         * THE EARTH BELOW: `presence` (0..1) of the round planet, whose rim takes over the limb,
         * the airglow line's elevation (radians) over its limb, and whether it now `covers` the
         * world (its surfaces and clouds have become the Earth's look, so they are switched off).
         * THE SEAM itself (the world showing the Earth on its surfaces) reads the Earth's own state.
         */
        setEarth(presence, airglowElevation, covers = false) {
            const pr = Math.min(Math.max(Number.isFinite(presence) ? presence : 0, 0), 1);
            uLimbYield.value = 1 - pr;
            uAirglowSin.value = Number.isFinite(airglowElevation) ? Math.sin(airglowElevation) : 0.075;
            if (!!covers !== earthCovers) {
                earthCovers = !!covers;
                // The surfaces with no per-frame gate of their own; the rest AND this in update().
                [groundMesh, waterMesh, ...lakeMeshes].forEach((m) => {
                    if (m) m.visible = !earthCovers && m.userData.filterVisible !== false;
                });
            }
        },
        /** The world's air for a view direction (a TSL node), which the Earth wears as it arrives. */
        hazeFor: airFor,
        /** The world's air for the Earth below (THE ONE AIR): { colour, column, ceil, weight } nodes. */
        earthAirFor,
        setAuroraGlow(glow) {
            uAuroraGlow.value = Math.min(Math.max(Number.isFinite(glow) ? glow : 0, 0), 1);
        },
        setQuenchCarry(t) {
            quenchT = Math.min(Math.max(Number.isFinite(t) ? t : 1, 0), 1);
            quenchFresh = true;
        },
        /** The act's horizon and sun colour, as live TSL nodes: what stands in the world's air reads the world's own. */
        cloudPalette: {
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
        update(time, railPoint, progress, eyeY = null, viewCamera = null) {
            uTime.value = time;
            // Clouds in the water: the masses whose mirror image can be in view this frame. Off
            // in the climb's frame (the waters are below the climbed eye's frame by then).
            const waterCam = uClimb.value === 1 && viewCamera?.projectionMatrix && viewCamera.matrixWorldInverse;
            if (clouds && waterCam) {
                waterCloudProjView.multiplyMatrices(viewCamera.projectionMatrix, viewCamera.matrixWorldInverse);
                waterCloudFrustum.setFromProjectionMatrix(waterCloudProjView);
                viewCamera.getWorldPosition(waterCloudEye);
                uWaterCloudCount.value = selectWaterClouds(
                    skyClouds.states,
                    waterCloudEye,
                    waterCloudInView,
                    WATER_CLOUD_LEVELS,
                    waterCloudRows,
                );
            } else {
                uWaterCloudCount.value = 0;
            }
            // The lattice centres on the rail's ground track IN THE CLIMB'S FRAME, so the rings
            // stay round the point beneath the climbed eye (a 30 u offset is 1,500 u at x50).
            if (uClimb.value === 1) {
                uLodCenter.value.set(railPoint.x, railPoint.z);
            } else {
                const c = uClimbCentre.value;
                uLodCenter.value.set(
                    c.x + ((railPoint.x - c.x) * uClimb.value),
                    c.z + ((railPoint.z - c.z) * uClimb.value),
                );
            }
            // The limb's anchor: the sea's drawn edge from this eye (see uEyeH).
            uEyeH.value = Number.isFinite(eyeY) ? Math.max(eyeY - ODYSSEY_SEA_LEVEL, 0) : 0;
            uSeaReach.value = waterGeo.reach * group.scale.x;
            if (viewCamera?.getWorldDirection) {
                viewCamera.getWorldDirection(scratchViewDir);
                const flat = Math.hypot(scratchViewDir.x, scratchViewDir.z);
                if (flat > 1e-3) uViewFwdXZ.value.set(scratchViewDir.x / flat, scratchViewDir.z / flat);
                if (Number.isFinite(viewCamera.far)) uViewFar.value = viewCamera.far;
            }
            state.lodCenter.x = railPoint.x;
            state.lodCenter.z = railPoint.z;
            state.eyeY = eyeY;
            updateBoulderTiers(railPoint.x, railPoint.z);
            const actP = Math.max(0, Math.min(1, progress));
            const runoutStart = 0.05 + (SCRIPT_RUNOUT_FROM * 0.9);
            const scriptP = actP <= SCRIPT_RUNOUT_FROM
                ? 0.05 + (actP * 0.9)
                : runoutStart + (((actP - SCRIPT_RUNOUT_FROM) / (1 - SCRIPT_RUNOUT_FROM)) * (1 - runoutStart));
            const cs = sampleColourScript(scriptP);
            // THE EVENING (odyssey-evening.js): chapter 5's sky state for this frame; its light
            // breathes on the clock (a gain of 1 outside the evening).
            const evening = updateOdysseyEvening(actP, time, viewCamera);
            // THE DAY'S TURN, AT A CLOUD'S PACE (odyssey-day-turn.js): `cs` becomes the light the
            // world wears now, and `turn` says where the turning shade stands and what the land's
            // light is ahead of it and behind it. With reduced motion the light still turns over
            // the same seconds, with no shade travelling across the land.
            const turn = dayTurnPace.step(cs, actP, time);
            const sweeping = turn.on && !prefersReducedMotion();
            // THE WEATHER (odyssey-weather-clock.js), in the air only: the light softens and
            // clears, the cover (below), the wind and the mist follow it.
            const weather = odysseyWeatherDrive(time + weatherEpoch, 1 - uSubmerged.value, weatherNow);
            uSkyHorizon.value.setRGB(...cs.skyHorizon);
            uSkyZenith.value.setRGB(...cs.skyZenith);
            weatherSun(cs, weather, uSunColour.value).multiplyScalar(evening.breath);
            uShadowTint.value.setRGB(...cs.groundShadow);
            // THE HOUR: the land's share at the two sides of the shade (both this frame's own
            // outside the turn), and the sky's.
            const HL = ODYSSEY_HOUR_LOOK;
            uTurn.value.set(
                turn.front,
                ODYSSEY_DAY_TURN.width,
                sweeping ? 1 : 0,
                sweeping ? ODYSSEY_DAY_TURN.depth * (1 - uSubmerged.value) : 0,
            );
            weatherSun(sweeping ? turn.ahead : cs, weather, uLandSunA.value);
            weatherSun(sweeping ? turn.behind : cs, weather, uLandSunB.value);
            landHourLook(sweeping ? turn.ahead.hour : cs.hour, HL, uLandHourA.value);
            landHourLook(sweeping ? turn.behind.hour : cs.hour, HL, uLandHourB.value);
            // (The warm air and the evening belt are the lower air's: they leave with the first
            // third of the departure, so the limb the climb looks down on is the Earth's own blue.)
            const lowAir = 1 - Math.min(uWorldFade.value / 0.35, 1);
            // THE EVENING TAKES THE SKY OVER (odyssey-evening.js): from the 4->5 seam its own gold
            // arch, belt and cloud light come in, so the hour's warm air and belt hand over to
            // them across the evening's first fifth, and the hour's share of the clouds' light
            // and of the mist holds at the mountains' last orb (the evening's own terms go on).
            const handover = 1 - Math.min(evening.dusk / HL.eveningHandover, 1);
            const hourLow = cs.hour * lowAir * lowAir * (3 - (2 * lowAir))
                * handover * handover * (3 - (2 * handover));
            const hourHeld = Math.min(cs.hour, HL.hourHeld);
            uHourSky.value.set(HL.warmAir * hourLow, HL.cloudSun * hourHeld, HL.antiRose * hourLow, 0);
            uMist.value.set((1 + (HL.mist * hourHeld)) * weather.mist, 1 + (HL.mistVeil * hourHeld));
            uGust.value = weather.gust;
            uAerialK.value = cs.fogDensity;
            // (The water's depth plates are written below with the depth arc, by the eye's depth.)
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
            const shadowPlan = cloudShadowSchedule(actP);
            uCloudShadow.value = shadowPlan.strength * (1 - uSubmerged.value);
            // (+ the weather: more cloud over the land for a while, then less.)
            uCloudCover.value = Math.min(Math.max(shadowPlan.cover + weather.cover, 0), 1);
            const optics = antisolarSchedule(actP);
            // Only with the eye over the water (2026-11-21 sea audit, item 10): from under the surface
            // sky light reaches the eye only through Snell's window, which the bow never reaches,
            // and the 14 u breach band let it draw on the underside of the surface at grazing angles.
            const aboveSea = smooth01(ODYSSEY_SEA_LEVEL + 0.5, ODYSSEY_SEA_LEVEL + 3, submergedRefY);
            uBow.value = optics.bow * aboveSea;
            uShowerVeil.value = optics.veil * aboveSea;
            // THE DEPTH ARC: the column's plates, its light and its darkness are the eye's depth's
            // (odyssey-ocean-depth.js), so the abyss is blue-black and the shallows turquoise.
            oceanDepthLook(ODYSSEY_SEA_LEVEL - submergedRefY, oceanLook);
            // ...under the sea's own weather: cloud over the sun, the surface's state, the bloom.
            oceanClockAt(time, seaClockColumn, seaClock);
            applyOceanClock(oceanLook, seaClock);
            uSeaLight.value = seaClock.light;
            uSeaChop.value = 1 + ((seaClock.chop - 1) * uSubmerged.value);
            uBloom.value.set(seaClock.bloom[0], seaClock.bloom[1], seaClock.bloom[2], seaClock.bloom[3]);
            uWaterShallow.value.setRGB(...oceanLook.shallow);
            uWaterMid.value.setRGB(...oceanLook.mid);
            uWaterDeep.value.setRGB(...oceanLook.deep);
            uWaterLum.value.setRGB(...oceanLook.luminous);
            uWaterWell.value = oceanLook.well;
            uShaftGain.value = oceanLook.shafts;
            uCeilAbsorb.value = oceanLook.overhead;
            uSnellWorld.value = uSubmerged.value > 0.001 ? snellWindowPresence(oceanLook.depth) : 0;
            if (uSubmerged.value > 0.001) {
                const hz = oceanHazeColour(oceanLook.depth, windowHazeScratch);
                const zen = cs.skyZenith;
                uWindowLift.value = snellWindowLift(
                    (0.2126 * hz[0]) + (0.7152 * hz[1]) + (0.0722 * hz[2]),
                    (0.2126 * zen[0]) + (0.7152 * zen[1]) + (0.0722 * zen[2]),
                    oceanLook.depth,
                );
            } else {
                uWindowLift.value = 1;
            }
            uDeepDim.value = oceanLook.dim;
            // Scene fog (the rail, the orbs) dims with the water it stands in, or the far rail
            // would fade to a brighter blue than the deep around it.
            fogState.color.multiplyScalar(1 - ((1 - uDeepDim.value) * uSubmerged.value));
            // 6 u, not 3: the eye crosses ~11 u per 0.01 p near the surface, so a 3 u window lit the
            // meniscus on almost no frame of the crossing — the breach's hero line went unseen.
            uBreachNear.value = Math.max(0, 1 - (Math.abs(ODYSSEY_SEA_LEVEL - submergedRefY) / 6));
            // The ceiling net can only reach a pixel when the eye is within its 62 u fade of the
            // surface (+4 u of swell): exact, so the gate changes no pixel.
            uCeilNet.value = (ODYSSEY_SEA_LEVEL - submergedRefY) < 66 ? 1 : 0;
            uValleyMist.value = submergedRefY > 349 ? 1 : 0;
            uGroundMist.value = submergedRefY > ODYSSEY_SEA_LEVEL
                && submergedRefY < ODYSSEY_SEA_LEVEL + GROUND_MIST.eyeFade[1] ? 1 : 0;

            // ── THE 1->2 CARRY (consumed; neutral when the board did not call this frame) ──
            const dt = lastUpdateTime === null ? 0 : Math.min(Math.max(time - lastUpdateTime, 0), 0.1);
            lastUpdateTime = time;
            const carryT = quenchFresh ? quenchT : 1;
            quenchFresh = false;
            const carry = odysseyQuenchCarry(carryT);
            uQuench.value = carry.carry;
            uBubble.value = carry.bubble;
            uMoteTint.value.setRGB(...carry.tint);
            uLife.value = carry.life;
            const moteVeil = steamQuenchDensity(carryT);
            uMoteVeil.value = moteVeil * moteVeil;
            state.lifePresence = carry.life;
            // Bank the extra rise phase; wrapped so the float never grows without bound (any
            // multiple of every mote's period works — 1/(0.014 x 0.6..1.1) are not commensurate,
            // so wrap only when the carry is idle, where the term no longer moves anything).
            uMoteLift.value += dt * QUENCH_RISE_BOOST * carry.carry;
            if (carry.carry === 0 && uMoteLift.value > 1e5) uMoteLift.value = 0;

            // ── THE 2->3 SPRAY: fire on the EYE crossing sea level upward ──
            // From the eye height itself, not from ODYSSEY_BREACH_P (a progress constant that has
            // already drifted once with the layout). A jump of 40 u+ in one update is a scrub or
            // a teleport, not a breach, and fires nothing; going back under clears the burst.
            if (Number.isFinite(eyeY)) {
                if (prevEyeY !== null && prevEyeY < ODYSSEY_SEA_LEVEL && eyeY >= ODYSSEY_SEA_LEVEL
                    && Math.abs(eyeY - prevEyeY) < 40) {
                    sprayStart = time;
                }
                if (eyeY < ODYSSEY_SEA_LEVEL - 0.5) sprayStart = null;
                prevEyeY = eyeY;
            }
            // Aged by the clock OR by the climb, whichever is further along — a parked camera
            // still lets the burst finish, and a frozen-clock capture shows the age the eye's
            // height implies instead of a burst frozen at birth.
            const sprayAge = sprayStart === null
                ? Infinity
                : Math.max(time - sprayStart, ((eyeY ?? ODYSSEY_SEA_LEVEL) - ODYSSEY_SEA_LEVEL) / SPRAY_CLIMB_RATE);
            const spray = odysseySprayEnvelope(sprayAge);
            if (spray === 0 && sprayStart !== null && sprayAge >= SPRAY_LIFE_S) sprayStart = null;
            uSpray.value = spray;
            uSprayAge.value = spray > 0 ? sprayAge : 0;
            state.sprayAge = spray > 0 ? sprayAge : null;
            // Publish what this frame decided, for instruments (see `state` above). Written
            // LAST so a reader can never observe a half-updated frame.
            state.submerged = uSubmerged.value;
            state.scriptName = cs.name;
            state.actT = progress;
            // The hour the world wears and where the day's turn stands (odyssey-day-turn.js).
            state.hour = cs.hour;
            state.dayTurn = turn.t;
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
            skyCloudField.sdf = skyClouds.volumes.state.sdf;
            skyClouds.update(
                time,
                viewCamera,
                authored(skyClouds.mesh) && uSubmerged.value < 0.999 && !earthCovers,
                evening,
                intoGroupFrame,
                sphereToWorld,
                uClimb.value,
            );
            // (Where the sky's clouds are this frame, their shadows on the land and the sea.)
            if (q.cloudShadows && clouds && uClimb.value === 1) cloudShadows.update(skyClouds.states, time);
            if (cloudSeaLayer) {
                cloudSeaLayer.update(
                    time,
                    evening.sea,
                    authored(cloudSeaLayer.mesh) && uSubmerged.value < 0.999 && !earthCovers,
                );
            }
            if (hollowMist) {
                // (In the air only: under water the basin is far above a blue column.)
                const mistShown = authored(hollowMist.mesh) && uSubmerged.value < 0.001 && !earthCovers;
                hollowMist.update(cs.hour, weather.pool, mistShown);
            }
            if (turnWake) {
                // (The forest sways harder for the few seconds the gust takes to pass.)
                const wakeShown = authored(turnWake.mesh) && uSubmerged.value < 0.001 && !earthCovers;
                uGust.value = weather.gust
                    * (1 + turnWake.update(time, turn.front, sweeping, railPoint.x, railPoint.z, wakeShown));
            }
            if (wallGusts) {
                // (keyed on journey progress, as its window is written: Act II progress back to it)
                const gustsShown = authored(wallGusts.mesh) && uSubmerged.value < 0.999 && !earthCovers;
                wallGusts.update(time, wallGustsRevealAt(0.0649 + (actP * 0.6894)), gustsShown);
            }
            // THE FOREST IS SUBMITTED UNDER WATER AND CANNOT BE SEEN (MEASURED 2026-08-13).
            // The trees are legitimately the far SHORE -- the scatter rejects any site below
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
            // Ocean LIFE also waits for the 1->2 carry (uLife): no shaft or school is submitted
            // while the eye is still in Earth Core's cavern behind the quench. The motes stay —
            // they ARE the carry — and also draw above water while the breach spray is live.
            const lifeOn = uLife.value > 0.001;
            if (rayMesh) rayMesh.visible = uSubmerged.value > 0.001 && lifeOn;
            if (moteMesh) {
                moteMesh.visible = uSubmerged.value > 0.001 || spray > 0;
                // A sort key only (no pipeline change): after the steam's shell (12) while veiled.
                moteMesh.renderOrder = uMoteVeil.value > 0.01 ? 13 : 4;
            }
            // The fish stay while the eye is in the water, and after the breach while any school
            // still shows through the surface: they are passed, never switched off in view.
            if (fish) fish.mesh.visible = (uSubmerged.value > 0.001 || fish.seenFromAbove(viewCamera)) && lifeOn;
            // The jellies likewise, while any of them in view still shows through the surface.
            if (jellyfish) {
                jellyfish.mesh.visible = (uSubmerged.value > 0.001 || jellyfish.seenFromAbove(viewCamera, time))
                    && lifeOn;
            }
            if (spireMesh) spireMesh.visible = uSubmerged.value > 0.001 && lifeOn;
            if (kelpMesh) kelpMesh.visible = uSubmerged.value > 0.001 && lifeOn;
            if (oceanScenery) oceanScenery.update(oceanLook, uSubmerged.value > 0.001 && lifeOn);
            if (breachBurst) breachBurst.update(time, viewCamera?.position ?? null);
            if (dolphinPod) dolphinPod.update(time, viewCamera?.position ?? null, lifeOn);
            const forestDrawable = uSubmerged.value < 0.999 && !earthCovers;
            for (let i = 0; i < treeMeshes.length; i += 1) {
                const c = treeMeshes[i].userData.centre;
                // ⚠️ AND-ed WITH THE AUTHORED FLAG, because this per-frame write silently
                // DEFEATED the `?worldOnly=` mesh filter. That lever sets `.visible` once at
                // mount; this loop overwrote it on the very next frame, so the forest was
                // unhideable and every `?worldOnly=<not-forest>` bisect quietly kept a whole
                // forest in the frame. That is the repo's own worst failure mode — a lever
                // that reports innocence rather than absence — and it was found while trying
                // to isolate one LOD tier for a wind capture.
                // Drawn while its NEAREST tree is inside the far edge of the per-tree sink, so a
                // chunk only ever switches where all of its trees are already underground.
                treeMeshes[i].visible = authored(treeMeshes[i]) && forestDrawable
                    && Math.hypot(c.x - railPoint.x, c.y - railPoint.z) - treeMeshes[i].userData.radius
                        < FOREST_DRAW_FAR;
            }
        },
        dispose() {
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
            // heroMat included 2026-08-14: it was missing from this list for as long as the
            // heroes shipped, leaking the compiled hero material on every world dispose; with
            // the heroes retired it is usually never uploaded, but the ?odysseyWorldHeroes=1
            // escape hatch still renders it and must not leak (the SB-15 teardown class).
            [groundMat, waterMat, skyMat, lakeMat,
                tarnMat, showerMat, boulderMat].forEach((m) => m.dispose());
            forestMats.near.dispose();
            forestMats.far?.dispose();
            skyClouds.dispose();
            cloudShadows.dispose();
            highSky.dispose();
            if (cloudSeaLayer) cloudSeaLayer.dispose();
            if (hollowMist) hollowMist.dispose();
            if (wakeFieldfares) wakeFieldfares.dispose();
            if (turnWake) turnWake.dispose();
            if (wallGusts) wallGusts.dispose();
            if (rayMat) rayMat.dispose();
            if (moteMat) moteMat.dispose();
            // The fish's material was missing here once (the same SB-15 teardown class heroMat was):
            // every world dispose leaked the compiled fish material.
            if (fish) fish.dispose();
            if (jellyfish) jellyfish.dispose();
            if (spireMat) spireMat.dispose();
            if (kelpMat) kelpMat.dispose();
            if (oceanScenery) oceanScenery.dispose();
            if (breachBurst) breachBurst.dispose();
            if (dolphinPod) dolphinPod.dispose();
            if (moteMesh) moteMesh.geometry.dispose();
            if (rayMesh) rayMesh.geometry.dispose();
            [heightTex, sunVisTex, groundTex, detailTex, seaLaceTex, macroTex, summitTex, tarnTex, lakeTex, forestShadeTex,
                valleyMistTex, meadowTex, floorTex, forestFloorTex].forEach((t) => t.dispose());
            forestTextures.dispose();
            groundPhotosDisposed = true;
            [meadowTex, floorTex].forEach((t) => { if (t.image && typeof t.image.close === 'function') t.image.close(); });
        },
    };
}
