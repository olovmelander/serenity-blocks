/**
 * Thermal Bloom — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (thermal-bloom-theme.js) and the playground effect
 * (src/playground/effects/thermal-bloom.effect.js), so what is iterated there ships.
 *
 * We stand on a pale sinter lip above the Iris Basin at late morning, looking down at it: left of
 * the card the Iris, a great hot spring (a cobalt eye ringed by bands of living colour, its runoff
 * fingers fanning out like the rays of a printed sun); right of it the Chalice, a white sinter
 * geyser cone on a cream mound, and the Stair, travertine terraces stepping down from it toward
 * the bottom-right corner; behind the card the far apron with its jewel pools and ghost pines,
 * steam columns at a dozen depths, the far rim and a band of cerulean sky. The board is a source
 * of heat and water for the basin, and the world answers from inside itself:
 *
 *   lock     the Spill: a hot surge scours a strip to bare cream sinter at the piece's rows, and
 *            the piece's colour blooms there in streamers; it bleaches to white on the world's
 *            own clock unless a clear seals it. A hard drop is the Plunge (a fumarole jet).
 *   clear    the Seal: a new white sinter lip draws itself along a rim at each cleared row, the
 *            pool behind it fills and spills, and the cleared row's own colours fix into the
 *            stone record. Cascade waves extend the cascade one tier a wave.
 *   four     the Chalice's major eruption: one column of water, the one bow in its spray, and the
 *            apron flooding wet; then the steam phase, its shadow sweeping the basin.
 *   combo    one preplay splash at the Chalice a link (the count), and the fingers' wet front a
 *            notch farther out (the reach); the eye widens.
 *   release  the steam phase: 4 + 2·peak seconds of white exhalation; the fingers drain back.
 *   B2B      the Consort: a companion vent wakes and stands while the chain lives.
 *   T-spin   steam devils off the Iris, each leaving a sinter rosette in the mats.
 *   perfect  the Sleeper wakes on the far rim; the living colour is renewed; the stone stays.
 *   level    the year turns: a succession front sweeps out from the Iris along the fingers.
 *   over     the springs sigh: the blooms bleach, the Chalice drains; a new run refills it.
 *   heat     how hot play runs (shared/gameplay-surge.js): the basin boils harder — more steam,
 *            the spouters burbling and pulsing faster, the far columns swelling, the fumaroles
 *            chuffing together, the Chalice roaring steam, the eye widening, the bands brightening,
 *            the overlook leaning in, the Consort stirring in a fever — and breathes back to calm.
 *
 * Nothing running is cut by what comes next: the eruptions are fed columns (thermal-bloom-fed-
 * column.js), the perfect clear is a crown on the clear it follows, a second break's steam rolls
 * on the first's, the ladder cools from the top down, full pools are topped up, spinning devils
 * are fed, and springs and boil-overs that must make room fade out.
 *
 * The parts are built from a registry (PART_BUILDERS); a part not built yet is simply absent.
 * Nothing is created at event time: events write numbers into preallocated state, so seek(t)
 * plus a fixed-step replay reproduces any frame. What moves at a changing rate is integrated;
 * everything else is closed form in the clock.
 */

import * as THREE from 'three/webgpu';
import {
    CHALICE,
    DEG,
    ERUPTIONS,
    EVENT_ROWS,
    EVENT_SLOTS,
    FUMAROLES,
    GHOSTS_MAX,
    IDLE_STEAM,
    IDLE_WATER,
    IRIS_RADIUS,
    PIECE_CODE,
    PIECE_HEX,
    PLUME_KIND,
    RECORD_RING0,
    RECORD_ROWS,
    SEASONS,
    SPOUTER_BURBLE,
    STEAM_SLOTS,
    TAU,
    BLOOM_CODE,
    BLOOM_OUT,
    BURST_KIND,
    BURST_SLOTS,
    VAPOUR_KIND,
    VAPOUR_ROWS_PER,
    VAPOUR_SLOTS,
    approach,
    aspectWeights,
    bloomLife,
    breathAt,
    chaliceSchedule,
    clamp01,
    columnHeight,
    columnState,
    composeWorld,
    createThermalBloomTexture,
    createThermalBloomUniforms,
    eyeHeat,
    fingerReach,
    fumarolePlan,
    gustAt,
    hexToLinear,
    jewelPlan,
    lerp,
    mulberry32,
    pieceCode,
    pinePlan,
    plumePlan,
    preplayHeight,
    projectToScreen,
    rigForAspect,
    rigFrame,
    screenToGround,
    seasonPair,
    seasonWheel,
    smooth,
    solveSun,
    steamForBreath,
    steamPhaseLength,
    sunVector,
    vapourCode,
    visibleColumn,
    windAt,
    DRIFT,
    VAPOUR_RISE,
    WIND_HEADING,
    plumeDrift,
    rigidDrift,
    riseForLean,
    windRunTable,
} from './thermal-bloom-tsl.js';
import { tierFor } from './thermal-bloom-quality.js';
import { createSky } from './thermal-bloom-sky.js';
import { createBasin } from './thermal-bloom-basin.js';
import { createTerraces, stairBakeArgs } from './thermal-bloom-terraces.js';
import { createMist, createSteam } from './thermal-bloom-steam.js';
import { createFumaroles } from './thermal-bloom-fumaroles.js';
import { createDevils } from './thermal-bloom-devils.js';
import {
    COLUMN_KIND, COLUMN_SLOT, createChalice, createColumns, createConsort, createSleeper, createSpray,
} from './thermal-bloom-geyser.js';
import { createPines } from './thermal-bloom-flora.js';
import { createSnags } from './thermal-bloom-snags.js';
import { burstCode, createBursts } from './thermal-bloom-bursts.js';
import { createMotes } from './thermal-bloom-motes.js';
import {
    bakeCellular, bakeNoise, bakeRamp, bakeVapourNoise,
} from './thermal-bloom-bake.js';
import { createVapourTexture } from './thermal-bloom-vapour.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './thermal-bloom-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { FedColumn, STEAM_LEAD } from './thermal-bloom-fed-column.js';
import { GameplaySurge, SURGE_WEIGHTS } from '../shared/gameplay-surge.js';

/** The rest camera's clip planes and the bounds of its field of view (degrees). */
export const REST_RIG = Object.freeze({
    near: 1.5,
    far: 24000,
    minFov: 40,
    maxFov: 66,
});

/**
 * The record's fossil colours (8-bit linear), by piece code: about 0.55 of the pigment toward
 * Sinter Cream (§3.8); garbage cells are Bleached Sinter #7E776C.
 */
const FOSSIL = (() => {
    const cream = hexToLinear('#E8DCC0');
    const out = PIECE_HEX.map((hex) => {
        const c = hexToLinear(hex);
        return [0, 1, 2].map((i) => Math.round(255 * (cream[i] + (c[i] - cream[i]) * 0.55)));
    });
    out[PIECE_CODE.GARBAGE] = hexToLinear('#7E776C').map((v) => Math.round(255 * v));
    return out;
})();

/** Every part of the picture, in draw order of build (the URL reference lists the same names). */
/** The world's default seed. */
export const THERMAL_BLOOM_SEED = 0x1b15;

/** The world's texture bakes' arguments (bakeTextures and the worker bake loader share them). */
function textureBakeArgs(tier, seed) {
    return {
        noise: [256, seed],
        cellular: [256, 12, seed ^ 0x5e11],
        vapour: [tier.vapourNoise || 48, seed ^ 0x5713],
    };
}

/**
 * Every CPU bake a world of this quality and seed builds from, as worker jobs (kind, args): the
 * theme hands them to the bake loader before the build, so the build finds them in the cache.
 */
export function thermalBloomBakeJobs(quality = 'High', seed = THERMAL_BLOOM_SEED) {
    const tier = tierFor(quality);
    const args = textureBakeArgs(tier, seed);
    return [
        { kind: 'noise', args: args.noise },
        { kind: 'cellular', args: args.cellular },
        { kind: 'vapour', args: args.vapour },
        { kind: 'stair', args: [stairBakeArgs(tier)] },
    ];
}

export const THERMAL_BLOOM_PARTS = Object.freeze(['sky', 'basin', 'terraces', 'steam', 'geyser', 'flora', 'fx']);

/** The plume sheets, the ground mist and the fumaroles, as one part. */
function buildSteam(world) {
    const sheets = createSteam(world.u, world.tier, world.tex);
    const mist = world.tier.mistSheets > 0 ? createMist(world.u, world.tier, world.tex) : null;
    // One more vent than the fumaroles: the Sleeper's resting wisp.
    const fumaroles = createFumaroles(world.u, FUMAROLES.length + 1, world.tex);
    const devils = createDevils(world.u, world.tier, world.tex);
    const group = new THREE.Group();
    group.name = 'ThermalBloomSteamGroup';
    group.add(sheets.mesh);
    if (mist) group.add(mist.mesh);
    group.add(fumaroles.mesh);
    group.add(devils.mesh);
    return {
        mesh: group,
        sheets,
        mist,
        fumaroles,
        devils,
        place: (x, z) => mist?.place(x, z),
        dispose: () => {
            [sheets, mist, fumaroles, devils].forEach((p) => {
                p?.geometry.dispose();
                p?.material.dispose();
            });
        },
    };
}

/**
 * The near snags (thermal-bloom-snags.js): where they stand on screen in the corner on the Iris's
 * side (screen x, y; mirrored with the layout) and how tall (metres). Landscape only.
 */
const NEAR_SNAGS = Object.freeze([
    Object.freeze({
        x: 0.03, y: 0.97, height: 24, heading: 0.4,
    }),
    Object.freeze({
        x: 0.075, y: 0.92, height: 19, heading: 2.1,
    }),
    Object.freeze({
        x: 0.215, y: 0.79, height: 12, heading: 4.4,
    }),
]);

/** The ghost pines and the near air's motes, as one part. */
function buildFlora(world) {
    const pines = createPines(world.u, world.tier.pines);
    const motes = createMotes(world.u, world.tier.motes);
    const snags = createSnags(world.u, world.tex, NEAR_SNAGS.length);
    const group = new THREE.Group();
    group.name = 'ThermalBloomFloraGroup';
    group.add(pines.mesh);
    group.add(motes.mesh);
    group.add(snags.mesh);
    return {
        mesh: group,
        pines,
        motes,
        snags,
        setTrees: (trees) => pines.setTrees(trees),
        setVolume: (plan) => motes.setVolume(plan),
        dispose: () => {
            [pines, motes, snags].forEach((p) => {
                p.geometry.dispose();
                p.material.dispose();
            });
        },
    };
}

/**
 * The three spouters on the Chalice's mound (§1.4: 1–2 m spouts, periods 7, 11, 13 s): where
 * they stand in the mound's frame (metres from the vent; +z down the Stair, −x the frame's middle
 * side, mirrored with the layout), on its skirt beside the Stair, in frame at 16:9; each pulses
 * on its own period over a constant burble.
 */
const SPOUTERS = Object.freeze([
    Object.freeze({
        lx: -27, lz: 4, period: 7, phase: 1.3,
    }),
    Object.freeze({
        lx: -15, lz: 1, period: 11, phase: 4.1,
    }),
    Object.freeze({
        lx: 21, lz: 6, period: 13, phase: 8.7,
    }),
]);

/** The Chalice's cone, the dormant Sleeper and Consort, the eruption columns and the spray. */
function buildGeyser(world) {
    const chalice = createChalice(world.u, world.tier, world.tex);
    const sleeper = createSleeper(world.u, world.tier, world.tex);
    const consort = createConsort(world.u, world.tier, world.tex);
    const columns = createColumns(world.u, world.tier, world.tex);
    const spray = createSpray(world.u, world.tier);
    const parts = [chalice, sleeper, consort, columns, spray];
    const group = new THREE.Group();
    group.name = 'ThermalBloomGeyserGroup';
    parts.forEach((p) => group.add(p.mesh));
    const geyser = {
        mesh: group,
        chalice,
        sleeper,
        consort,
        columns,
        spray,
        /** The spouters' vents on the Chalice's ground (world [x, y, z]), set by `place`. */
        spouts: [],
        /**
         * The Chalice stands on its vent's base, its mound turned to the Stair's line (the world
         * lays the Stair from the vent toward the plan's `stairNear`), and the spouters stand on
         * its skirt (on the side toward the frame's middle, so the mirror keeps them in frame).
         */
        place: (x, y, z) => {
            const { plan } = world;
            const dir = plan ? [plan.stairNear[0] - x, plan.stairNear[2] - z] : [0, 1];
            chalice.place(x, y, z, dir);
            const mirror = world.mirrored ? -1 : 1;
            geyser.spouts = SPOUTERS.map((sp) => chalice.spot(sp.lx * mirror, sp.lz));
        },
        /** The Sleeper and the Consort stand where the plan puts them. */
        placeMounds: (plan) => {
            sleeper.place(plan.sleeper[0], plan.sleeper[1], plan.sleeper[2]);
            consort.place(plan.consort[0], plan.consort[1], plan.consort[2]);
        },
        dispose: () => {
            parts.forEach((p) => {
                p.geometry.dispose();
                p.material.dispose();
            });
        },
    };
    return geyser;
}

/** Builders of the parts that exist so far. */
const PART_BUILDERS = Object.freeze({
    sky: (world) => createSky(world.u, world.tier, world.tex),
    basin: (world) => createBasin(world.u, world.tier, world.tex),
    terraces: (world) => createTerraces(world.u, world.tier, world.tex),
    steam: buildSteam,
    geyser: buildGeyser,
    flora: buildFlora,
    // The events' drops (the boil-overs, the jets, the chain's vents).
    fx: (world) => createBursts(world.u, world.tier.burstDrops || 48),
});

/** The analytic steam veil's strength per tier: the fewer the sheets, the more it carries. */
const VEIL = Object.freeze({ Minimal: 1.8, Low: 1.5, Medium: 1.2 });

/**
 * The succession front's radius (metres from the Iris's centre) a fraction `s` into its sweep:
 * it leaves the rim at once, stands in the middle of the coloured ground in view at half time
 * (the fingers carry it further), and is gone past everything as the sweep ends.
 */
export function frontRadiusAt(s) {
    if (!(s < 1)) return 1e6;
    const k = Math.max(0, s);
    return (IRIS_RADIUS * (0.95 + 2.6 * k)) / Math.max(0.02, 1 - 0.97 * k * k * k);
}
/** The runoff fans out toward the camera, turned this far toward the Iris's outer side (degrees). */
const DOWNHILL_TURN = 6;

/** Vertical field of view (degrees) for an aspect: 62° upright … 46° on a desktop. */
export function fovForAspect(aspect) {
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, rigForAspect(aspect).fov));
}

/**
 * The camera's breath (±0.3° over about 30 s, Lissajous, with a metre or so of drift so the near
 * terraces slide against the far rim) and the pointer's reach (degrees and metres).
 */
const BREATH_DEG = 0.3;
const BREATH_FX = 1 / 31;
const BREATH_FY = 1 / 37;
const BREATH_X = 1.2;
const BREATH_Y = 0.5;
const PARALLAX_YAW = 0.4;
const PARALLAX_PITCH = 0.25;
const PARALLAX_X = 2.0;
/** The low morning sun's strength over the season's colour (it lights a level floor obliquely). */
const SUN_GAIN = 1.3;
/** The succession front's sweep (seconds), and the sun's easing toward a new solution (τ, s). */
const SEASON_SWEEP = 6;
const SUN_TAU = 2;
/** The lock-rate estimate's easing (seconds). */
const RATE_TAU = 10;
/** Lock springs alive at once (the slot pressure's N for their life; the ladder's vents apart). */
const LOCK_SPRINGS = 5;
/** A ladder's springs at its release: seconds to fade into the ground (the shader's BLOOM_OUT). */
const OUT_TIME = BLOOM_OUT.fade;
/** The perfect clear's renewal wave: its start after the clear and its sweep (seconds). */
const RENEW = Object.freeze({ delay: 0.4, sweep: 4.5 });
/** The vivid lift's time constant (seconds; photosensitivity: at least 0.4). */
const VIVID_TAU = 0.45;
/** Clocks wrap here (float precision in the shaders). */
const CLOCK_WRAP = 4096;
/**
 * The chain's thermometer cools from the top down at a break: the hottest vent goes out first,
 * the next this many seconds later (the ladder never blows out in one frame).
 */
const LADDER_OUT_STEP = 0.3;
/** Lock springs that may still be fading into the ground beyond the live ones (bounded GPU). */
const SPRINGS_FADING = 3;
/** A boil-over asked to make room thins away over this long instead of vanishing (seconds). */
const BOIL_THIN = 0.8;
/** Boil-overs in the air at once (the oldest beyond BOILS_SOFT thin away to make room). */
const BOILS_SOFT = 8;
const BOILS_MAX = 12;
/** A back-to-back clear's answer at the Consort: a burst off its pool (§3.5), fed by the next. */
const CONSORT_KICK = Object.freeze({
    delay: 0.15, rise: 0.45, hold: 0.9, fall: 0.8, steam: 0, height: 9,
});
/** What a perfect clear on its own frame adds to the surge (its clear was counted already). */
const PERFECT_ALONE = Object.freeze({ lines: 1, perfect: true });
/** The surge's acts (src/themes/shared/gameplay-surge.js SURGE_STAGES). */
const STAGE_HOT = 2;
const STAGE_FEVER = 3;
/** Under hot play the fumaroles across the basin chuff together this often (seconds, hot … fever). */
const CHUFF_EVERY = Object.freeze({ hot: 3.4, fever: 2.4 });
/** The camera's answer to play (degrees, metres): a thump on each hit, a lean in over a fever. */
const THUMP = Object.freeze({ pitch: 0.28, drop: 0.32 });
const LEAN = Object.freeze({ pitch: 0.55, forward: 2.2, drop: 0.8 });

function emptyCounts() {
    return {
        locks: 0,
        hardDrops: 0,
        clears: 0,
        lines: 0,
        quads: 0,
        tspins: 0,
        perfects: 0,
        cascades: 0,
        chainSteps: 0,
        releases: 0,
        b2bSteps: 0,
        b2bBreaks: 0,
        levelUps: 0,
        seasonSteps: 0,
        gameOvers: 0,
        refills: 0,
    };
}

export class ThermalBloomWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', capture = false, seed = THERMAL_BLOOM_SEED,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'ThermalBloom';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.mirrored = false;
        this.plan = composeWorld(this.aspect, false);
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(fovForAspect(this.aspect), this.aspect, REST_RIG.near, REST_RIG.far);
        this._rig = { height: 44, pitch: 18, fov: 46 };
        this._sun = [0, 0, 0];
        this._wind = { angle: 0, speed: 2 };
        this._gust = { phase: -1, seed: 0 };
        this._rgbA = [0, 0, 0];
        this._rgbB = [0, 0, 0];
        this._seasonRgb = SEASONS.map((s) => ({
            zenith: hexToLinear(s.zenith),
            haze: hexToLinear(s.haze),
            rim: hexToLinear(s.rim),
            meadow: hexToLinear(s.meadow),
            sun: hexToLinear(s.sun),
            streamer: hexToLinear(s.streamer || '#E07FA0'),
        }));
        /** Held values (the playground's season/heat/breath/gust; null = the clock's own). */
        this.held = {
            season: null, heat: null, breath: null, gust: null, sunAz: null, sunEl: null,
        };
        this._post = {
            exposure: 1,
            iris: 1,
            sat: 1,
            vivid: 1,
            bloomBoost: 0,
            gradeShadow: [0.012, 0.03, 0.06],
            gradeLight: [1.0, 0.93, 0.84],
            shimmer: [[0, 0, 0, 0], [0, 0, 0, 0]],
        };
        this.lastLock = {
            at: -1e6, player: 0, u: 0.5, rowTop: 19, rowBottom: 19, code: 7, color: null, hardDrop: false, distance: 0,
        };
        this.lastClear = {
            at: -1e6, player: 0, lines: 0, combo: 0, cascade: 1, tspin: false, perfect: false, b2b: false,
        };
        this.lastClear.rows = [];
        this.lastClear.rowCodes = [];
        /**
         * The eruptions are fed, never restarted: a running one finishes (or is held up and
         * raised by what comes next). The Chalice's four-line column, the Consort's double
         * eruption with it, the Consort's burst at a back-to-back clear, the Sleeper's column.
         */
        this.quad = new FedColumn(ERUPTIONS.quad, { gain: 0.25, most: 1.5 });
        this.consortCol = new FedColumn(ERUPTIONS.consort, { gain: 0.2, most: 1.4 });
        this.consortKick = new FedColumn(CONSORT_KICK, { gain: 0.35, most: 2.6 });
        this.sleeperCol = new FedColumn(ERUPTIONS.sleeper, { gain: 0.15, most: 1.3 });
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js): the basin boils harder the
         * longer the hands stay quick — the steam thickens, the spouters burble and pulse faster,
         * the far columns swell, the fumaroles chuff together, the Chalice roars steam, the eye
         * widens and the living bands brighten — and breathes back to calm when they rest.
         */
        this.surge = new GameplaySurge();
        /** The surge as of the last sample (the camera reads it before this frame's events). */
        this.surgeLevel = 0;
        this.surgeFever = 0;
        this.surgeStage = 0;
        this.surgePunch = 0;
        /** The sun: the solved target and the eased value (azimuth, elevation, degrees). */
        this.sunTarget = { azimuth: 122, elevation: 32, onColumn: true };
        this.sunNow = { azimuth: 122, elevation: 32 };
        this.resetState(0);
        this.recompose();
        this.sunNow.azimuth = this.sunTarget.azimuth;
        this.sunNow.elevation = this.sunTarget.elevation;
    }

    /** Everything the choreography remembers, as it stands at `time` on level one. */
    resetState(time) {
        this.time = time;
        this.level = 1;
        /**
         * The year (SEASON_STEP): the wheel turns with the clock, and the levels gained add a step
         * each (`seasonOffset`, never lowered by a new run: the light never turns back). The
         * succession front sweeps from the offset before a level-up to the one after it. `season`
         * is the index of the season the wheel stands nearest (names and tests).
         */
        this.seasonOffset = 0;
        this.season = 0;
        this.wheel = 0;
        this.front = {
            from: 0, to: 0, start: -1e6, length: SEASON_SWEEP,
        };
        this._pairA = { a: 0, b: 1, k: 0 };
        this._pairB = { a: 0, b: 1, k: 0 };
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.lastRelease = {
            at: -1e6, peak: 0, length: 0, sustained: 0,
        };
        /** The break before it, whose steam phase may still be rolling (both roll to their end). */
        this.prevRelease = this.lastRelease;
        this.quad.reset();
        this.consortCol.reset();
        this.consortKick.reset();
        this.sleeperCol.reset();
        /**
         * The perfect clear's awakening (§3.12): when the Sleeper woke, the latest perfect clear
         * that fed it, and the renewal front's start (a front already sweeping is not restarted).
         */
        this.perfect = { at: -1e6, fedAt: -1e6, renewAt: -1e6 };
        /** The spouters' own clock (it runs faster under hot play) and the cascade waves' kicks. */
        this.spoutClock = time;
        this.spoutKicks = Array.from({ length: 6 }, () => ({ at: -1e6, height: 0, spouter: 0 }));
        this.surge.reset();
        this.surgeLevel = 0;
        this.surgeFever = 0;
        this.surgeStage = 0;
        this.surgePunch = 0;
        this._thump = 0;
        this._lean = 0;
        /** The chain's last link and when it reached six (the sustained column); the flood. */
        this.lastLinkAt = -1e6;
        this.sustainAt = -1e6;
        this.b2bAt = -1e6;
        this.floodAt = -1e6;
        this.sympathyAt = -1e6;
        this.lastB2BBreak = -1e6;
        this.drain = { at: -1e6, refillAt: -1e6 };
        this.lastEventAt = -1e6;
        /** Locks a second (eased over RATE_TAU): the blooms' life follows the slot pressure. */
        this.lockRate = 0;
        /** The eased gauges: the eye's heat and the fingers' reach. */
        this.heat = 0;
        this.reach = 1;
        this.vivid = 1;
        this.records = 0;
        /** The live blooms (both sides share the tier's slots) and the hard drops' jets. */
        this.blooms = [];
        this.jets = [];
        this.fills = [];
        /**
         * The locks' boil-overs in the air: where each spilled (world x, y, z), when, the piece's
         * colour, metres per board cell there, and whether it was a hard drop (a plunge).
         */
        this.boils = [];
        /**
         * The chain's ladder (§3.9, the combo's gauge beside the card): a vent a link, climbing
         * the card's sides two rows a link, the Iris's side and the Stair's in turn; each plays a
         * fountain under a standing column of steam lit by the chain's heat while the chain lives,
         * and blows out when it breaks (`out` the time it did).
         */
        this.ladder = [];
        /** The T-spin's devils in flight and the rosettes they left. */
        this.devils = [];
        this.rosettes = [];
        this.drained = 0;
        this.consortWet = 0;
        this.phase = time % CLOCK_WRAP;
        this.counts = emptyCounts();
    }

    build() {
        this.u = createThermalBloomUniforms();
        this.tex = this.bakeTextures();
        // The cloud shadows (tbCloudShade) read the shared noise from the bag, so every part's
        // sun term can take them, including the parts that are handed no textures.
        this.u.cloudTex = this.tex.noise;
        THERMAL_BLOOM_PARTS.forEach((name) => {
            const make = PART_BUILDERS[name];
            if (make) this.addPart(name, make(this));
        });
        this.resetState(this.time);
        this.writeComposition();
        this.scene.add(this.root);
        return this;
    }

    /** Every texture the parts read, baked on the CPU (nothing is downloaded). */
    bakeTextures() {
        const args = textureBakeArgs(this.tier, this.seed);
        const noise = bakeNoise(...args.noise);
        const cellular = bakeCellular(...args.cellular);
        const ramp = bakeRamp();
        const tex = {
            noise: createThermalBloomTexture(noise.data, noise.size, noise.size, {
                name: 'thermal-bloom-noise', filter: 'mipmap', mipmaps: noise.mips,
            }),
            cellular: createThermalBloomTexture(cellular.data, cellular.size, cellular.size, {
                name: 'thermal-bloom-cellular', filter: 'mipmap', mipmaps: cellular.mips,
            }),
            ramp: createThermalBloomTexture(ramp.data, ramp.width, ramp.height, {
                name: 'thermal-bloom-ramp', filter: 'linear', wrap: 'clamp',
            }),
        };
        // The stone record (§3.8): 16 rows (the Stair's tiers, then the Iris's microterrace rings)
        // of arc-length samples, CPU-owned; a clear lays a stripe and uploads it whole.
        const samples = this.tier.recordSamples;
        this.recordData = new Uint8Array(samples * RECORD_ROWS * 4);
        this.recordCursor = new Array(RECORD_ROWS).fill(0);
        tex.record = createThermalBloomTexture(this.recordData, samples, RECORD_ROWS, {
            name: 'thermal-bloom-record', filter: 'linear', wrap: 'clamp',
        });
        // The vapour's billows: a tileable 3D noise the post's march reads.
        const vapour = bakeVapourNoise(...args.vapour);
        tex.vapour = createVapourTexture(vapour.data, vapour.size);
        Object.values(tex).forEach((t) => this.textures.push(t));
        return tex;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /**
     * Draw only the named parts (captures, bisecting a look). `part/sub` keeps one sub-mesh of a
     * grouped part (`steam/mist`, `steam/sheets`). Unknown names are ignored.
     */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            const part = this.parts[name];
            const subs = names.filter((n) => n.startsWith(`${name}/`)).map((n) => n.slice(name.length + 1));
            part.mesh.visible = keep.has(name) || subs.length > 0;
            if (subs.length === 0) return;
            Object.entries(part).forEach(([key, sub]) => {
                if (sub?.mesh?.isObject3D) sub.mesh.visible = subs.includes(key);
            });
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
        this.recompose();
        this.updatePixelAngle();
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.updatePixelAngle();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        // The steam thins over a live card only (captures without a board keep their steam).
        const card = this.layoutLive ? cardUnion(this.layout) : null;
        if (this.u) {
            if (card) this.u.cardRect.value.set(card.x0, card.y0, card.x1, card.y1);
            else this.u.cardRect.value.set(-1, -1, -1, -1);
        }
        this.recompose();
    }

    /**
     * The composition for the current aspect and layout: the HUD mirror rule (the Iris goes to
     * the side away from the HUD), then every hero placed by its screen anchor, then the sun
     * solved inside its ranges so the bow would cross the Chalice's column.
     */
    recompose() {
        const card = cardUnion(this.layout);
        const hud = this.layout?.hud;
        const cardMid = card ? (card.x0 + card.x1) / 2 : 0.5;
        this.mirrored = Boolean(hud && (hud.x0 + hud.x1) / 2 < cardMid);
        this.plan = composeWorld(this.aspect, this.mirrored);
        const frame = rigFrame(this.plan.rig);
        const { k } = aspectWeights(this.aspect);
        const solved = solveSun({
            eye: frame.position,
            forward: frame.forward,
            base: this.plan.chalice,
            height: visibleColumn(this.plan.rig, this.plan.chalice, 90),
            preset: k < 0.5 ? 'portrait' : 'desktop',
            mirrored: this.mirrored,
        });
        this.sunTarget.azimuth = solved.azimuth;
        this.sunTarget.elevation = solved.elevation;
        this.sunTarget.onColumn = solved.onColumn;
        this.writeComposition();
    }

    /** The heroes' world positions into the uniforms. */
    writeComposition() {
        const { u, plan } = this;
        if (!u) return;
        u.irisCentre.value.set(plan.eye[0], plan.eye[2]);
        u.irisRadius.value = IRIS_RADIUS;
        // The runoff fans toward the camera, turned toward the Iris's outer side of the frame.
        const dx = -plan.eye[0];
        const dz = -plan.eye[2];
        const len = Math.hypot(dx, dz) || 1;
        const turn = (this.mirrored ? -DOWNHILL_TURN : DOWNHILL_TURN) * DEG;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        // A positive turn swings it toward −x (the screen's left): (0, 1) → (−sin, cos).
        u.downhill.value.set((dx * c - dz * s) / len, (dx * s + dz * c) / len);
        this.parts.basin?.place(plan.eye[0], plan.eye[2]);
        // The Stair steps down from the Chalice's flank toward the bottom-right corner.
        const sx = plan.stairNear[0] - plan.chalice[0];
        const sz = plan.stairNear[2] - plan.chalice[2];
        const sl = Math.hypot(sx, sz) || 1;
        const flank = CHALICE.radius * 1.6;
        this.parts.terraces?.place(
            [plan.chalice[0] + (sx / sl) * flank, plan.chalice[2] + (sz / sl) * flank],
            [plan.stairNear[0], plan.stairNear[2]],
        );
        u.chalice.value.set(plan.chalice[0], plan.chalice[1], plan.chalice[2]);
        this.parts.geyser?.place(plan.chalice[0], plan.chalice[1], plan.chalice[2]);
        this.parts.flora?.setTrees(pinePlan(plan, this.tier.pines));
        this.parts.flora?.setVolume(plan);
        // The near snags stand in the corner on the Iris's side (a landscape frame only).
        const landscape = aspectWeights(this.aspect).k > 0.5;
        const snagPoints = landscape ? NEAR_SNAGS.map((snag) => {
            const at = this.mirrored ? 1 - snag.x : snag.x;
            const g = screenToGround(plan.rig, this.aspect, at, snag.y, 0);
            return g ? [g[0], 0, g[2], snag.height, snag.heading] : null;
        }).filter(Boolean) : [];
        this.parts.flora?.snags?.place(snagPoints);
        // Their shadows on the floor (the trunk's radius at its foot: about 3.4% of its height).
        (u.tables.snags || []).forEach((row, i) => {
            const p = snagPoints[i];
            if (p) row.set(p[0], p[2], p[3], 0.034 * p[3]);
            else row.set(0, 0, 0, 0);
        });
        this.parts.geyser?.placeMounds(plan);
        // The fumaroles, then the Sleeper's faint resting wisp off its crater (it never chuffs).
        const [slx, sly, slz] = plan.sleeper;
        this.parts.steam?.fumaroles?.setVents([...fumarolePlan(plan), {
            x: slx, z: slz, period: 1, phase: 0, base: sly - 1, scale: 3, chuff: false,
        }]);
        jewelPlan(plan).forEach((j, i) => u.tables.jewels[i].set(j.x, j.z, j.radius, j.kind));
        this.writePlumes();
    }

    /** The steam plumes into their rows, far to near (the sheets draw in slot order). */
    writePlumes() {
        const { u, plan } = this;
        const { steam } = this.parts;
        const slots = steam ? steam.sheets.slots : Math.min(this.tier.plumes, this.tier.shadowEllipses);
        const plumes = plumePlan(plan, Math.max(slots, this.tier.shadowEllipses));
        this.plumes = plumes;
        const order = plumes.slice(0, slots).sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z));
        const rows = u.tables.plumes;
        rows.forEach((r) => r.set(0, 0, 0, 0));
        order.forEach((p, i) => {
            rows[i * 2].set(p.x, p.z, p.base, p.height);
            rows[i * 2 + 1].set(p.r0, p.r1, p.density, p.kind);
        });
        u.steamCount.value = order.length;
        this.threadSlot = order.findIndex((p) => p.kind === PLUME_KIND.thread);
        this.threadDensity = this.threadSlot >= 0 ? order[this.threadSlot].density : 0;
        this.plumeBase = rows.map((r) => r.clone());
        // The columns this tier draws no sheets for stand in the sky as analytic ghosts, seen
        // from the rest camera: (azimuth, base elevation, half-width, top elevation), radians.
        const camH = plan.rig.height;
        const ghosts = slots < 8
            ? plumePlan(plan, STEAM_SLOTS).filter((p) => p.kind === PLUME_KIND.column)
            : [];
        const drawn = new Set(plumes.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
        const extra = ghosts.filter((p) => !drawn.has(`${p.x.toFixed(2)},${p.z.toFixed(2)}`)).slice(0, GHOSTS_MAX);
        u.tables.ghosts.forEach((g) => g.set(0, 0, 0, 0));
        extra.forEach((p, i) => {
            const d = Math.max(1, Math.hypot(p.x, p.z));
            u.tables.ghosts[i].set(
                Math.atan2(p.x, -p.z),
                Math.atan2(p.base - camH, d),
                (p.r0 * 1.2) / d,
                Math.atan2(p.base + p.height - camH, d),
            );
        });
        u.ghostCount.value = extra.length;
        // The two least important far columns (the last in the plan's priority) lend their slots.
        const far = plumes.slice(2, slots);
        this.spareSlots = far.slice(-2).reverse().map((p) => order.indexOf(p)).filter((i) => i >= 0);
        this.threadBase = this.threadSlot >= 0
            ? { height: order[this.threadSlot].height, r1: order[this.threadSlot].r1 } : { height: 0, r1: 0 };
        steam?.place(plan.eye[0], plan.eye[2]);
    }

    /**
     * The eruption columns' rows from the closed-form schedules: the Chalice's idle cycle, its
     * preplay splashes and the chain's count, the four-line surge and column; the Consort's
     * standing steam column and splashes; the Sleeper's column; the spouters and the hard drops'
     * jets. Each row pair is (x, z, base, height) and (radius, fall, flare, kind): through the
     * fall-back the crown keeps its height and `fall` runs 0 → 1 (the column empties from the base
     * up and rains from the crown); a standing column's `flare` carries its steam instead (see
     * COLUMN_KIND). The Chalice's steam thread swells into each steam phase.
     */
    writeColumns(t) {
        const { u, plan } = this;
        if (!u || !plan) return;
        const rows = u.tables.events;
        const at = EVENT_ROWS.eruptions;
        const set = (slot, x, z, base, height, radius, flare, kind, fall = 0) => {
            rows[at + slot * 2].set(x, z, base, height);
            rows[at + slot * 2 + 1].set(radius, fall, flare, kind);
        };
        const [cx, cy, cz] = plan.chalice;
        const vent = cy + CHALICE.height - 0.6;
        const sched = chaliceSchedule(t, this._sched || (this._sched = {}));
        const state = columnState('idle', -1, undefined, this._column || (this._column = { height: 0, fall: 0 }));
        // On an upright phone the Chalice stands over a kilometre off: its columns are drawn wider
        // and a little taller there, so their spray carries the bow as a band across it, not a cone.
        const phone = 1 - aspectWeights(this.aspect).k;
        const wide = 1 + 1.6 * phone;
        const tall = 1 + 0.35 * phone;
        let radius = 1.8;
        let flare = 1.1;
        // The four-line eruption is its own record, fed by what follows (never cut by a clear).
        const Q = this.quad;
        const qs = Q.state(t, this._quadState || (this._quadState = { height: 0, fall: 0, surge: -1 }));
        const quadLive = Q.live(t);
        const quadAge = quadLive ? t - Q.at : -1;
        const q = ERUPTIONS.quad;
        const { surgeLevel: level, surgeFever: fever } = this;
        const linkAge = t - this.lastLinkAt;
        const releaseAge = t - this.lastRelease.at;
        // Full idle eruptions run only in menus or after a minute with no events (§3.9); while a
        // session is live the Chalice keeps to its preplay splashes.
        const quiet = !this.layoutLive || t - this.lastEventAt > 60;
        const idleAge = quiet ? sched.eruptionAge : -1;
        if (quadLive && qs.surge >= 0) {
            // The surge (§1.5, 0–0.35 s): the pool heaves into a dome over the lip and spills down
            // the cone, a steam skirt flaring round it (a dome written with no crown flare).
            state.height = 4.0 * smooth(0, 0.26, qs.surge) * (1 + 0.06 * Math.sin(qs.surge * 37));
            state.fall = 0;
            radius = 3.2;
            flare = 0;
        } else if (quadLive) {
            // Four lines (§3.10): the column out of the surge, then the fall-back as rain. A second
            // four (or the chain's clears) feeds it: held up longer, its crown climbing higher.
            state.height = qs.height;
            state.fall = qs.fall;
            if (state.fall === 0) state.height = Math.max(state.height, 4.0);
            radius = 9 * (1 + 0.12 * (Q.peak(t) / q.height - 1));
            flare = 1.3;
        } else if (this.combo >= 6) {
            // A sustained column, growing with the chain (no bow).
            columnState('combo', t - this.sustainAt, this.sustainedHeight(), state);
            radius = 2.8;
            flare = 0.9;
        } else if (this.lastRelease.sustained > 0 && releaseAge < 2) {
            // The chain broke under it: the column gives way to the steam phase.
            state.height = this.lastRelease.sustained;
            state.fall = clamp01(releaseAge / 1.4);
            radius = 2.8;
        } else if (this.combo >= 2) {
            // The count (§3.9 gauge 1): a burst at each new link, then the Chalice keeps pulsing
            // at the chain's height while it lives (rhythmic at links 4–5, as the fumaroles chuff
            // in sympathy), each burst held near a second, so the gauge reads at any moment.
            const period = this.combo >= 4 ? 2.0 : 2.6;
            const age = linkAge < period ? linkAge : (linkAge - period) % period;
            columnState('preplay', age, preplayHeight(this.combo), state);
            // Between the bursts the pool keeps boiling over its lip: the Chalice never rests.
            if (state.height === 0) state.height = 1.3 + 0.3 * Math.sin(t * 4.7) + 0.2 * Math.sin(t * 7.3);
            radius = this.combo >= 4 ? 2.0 : 1.2;
            flare = 0.9;
        } else if (idleAge >= 0) {
            columnState('idle', idleAge, undefined, state);
        } else if (sched.preplayAge >= 0) {
            // A cluster of 2–4 splashes, each about a second apart.
            const k = Math.floor(sched.preplayAge / 1.2);
            if (k < sched.splashes) {
                columnState('splash', sched.preplayAge - k * 1.2, 2 + 2 * sched.preplaySeed, state);
            }
            radius = 0.9;
            flare = 0.9;
        }
        const { water } = COLUMN_KIND;
        set(COLUMN_SLOT.chalice, cx, cz, vent, state.height * tall, radius * wide, flare, water, state.fall);
        // What the vapour builds round it (its spray veil, the steam at its vent).
        const now = this.chaliceNow || (this.chaliceNow = {});
        now.x = cx;
        now.y = vent;
        now.z = cz;
        now.height = state.height * tall;
        now.fall = state.fall;
        now.radius = radius * wide;
        now.quad = quadLive ? quadAge : -1;
        now.grown = 0;
        now.dense = 0;
        now.size = 0;
        // The Consort (§3.5): while a back-to-back chain lives, a standing steam column (40, 60,
        // 80 m by its level, about 12 m wide, underlit turquoise by its pool) over a splash every
        // 3–5 s (2–4 m, then 4–8 m, then a steady 10 m fountain); when the chain breaks the
        // fountain stops and the column thins away over 6 s. With four lines, the double eruption.
        const [ox, oy, oz] = plan.consort;
        const cs = this._consort || (this._consort = { height: 0, fall: 0 });
        cs.height = 0;
        cs.fall = 0;
        if (this.b2b > 0) this._consortLevel = this.b2b;
        const b2bLevel = this.b2b > 0 ? this.b2b : (this._consortLevel || 1);
        // Its eruptions are records of their own (a double eruption runs to its end even if the
        // chain breaks under it); each back-to-back clear's burst is fed by the next.
        if (!this._consortBig) {
            this._consortBig = { height: 0, fall: 0, surge: -1 };
            this._consortKick = { height: 0, fall: 0, surge: -1 };
        }
        const big = this.consortCol.state(t, this._consortBig);
        const kick = this.consortKick.state(t, this._consortKick);
        const bigUp = big.height > 0;
        const kickUp = kick.height > 0;
        if (bigUp && (!kickUp || big.height >= kick.height || kick.fall > 0)) {
            cs.height = big.height;
            cs.fall = big.fall;
        } else if (kickUp) {
            cs.height = kick.height;
            cs.fall = kick.fall;
        } else if (this.b2b >= 3) {
            columnState('combo', t - this.b2bAt, 10, cs);
        } else if (this.b2b > 0) {
            // Each splash its own height (level 1: 2–4 m every 4.5 s; level 2: 4–8 m every 3.5 s).
            const period = this.b2b === 1 ? 4.5 : 3.5;
            const k = Math.floor(t / period);
            const peak = (this.b2b === 1 ? 2 : 4) * (1 + mulberry32(k * 7919 + 13)());
            columnState('preplay', t - k * period, peak, cs);
        }
        const stand = this.consortStand(t);
        // (row 1 z: the standing column's height in whole metres, its amount as the fraction)
        const standing = stand > 0.01
            ? Math.round((20 + 20 * b2bLevel) * (0.6 + 0.4 * stand)) + Math.min(0.99, stand) : 0;
        let consortR = kickUp ? 1.5 : 1.0;
        if (bigUp) consortR = 2.6;
        set(COLUMN_SLOT.consort, ox, oz, oy + 0.2, cs.height, consortR, standing, COLUMN_KIND.standing, cs.fall);
        // The Sleeper (§3.12): a perfect clear wakes its 150 m column, wide and flaring (a second
        // perfect clear while it stands holds it up and lifts it).
        const [sx, sy, sz] = plan.sleeper;
        const sl = this.sleeperCol.state(t, this._sleeper || (this._sleeper = { height: 0, fall: 0, surge: -1 }));
        set(COLUMN_SLOT.sleeper, sx, sz, sy - 1, sl.height, 18, 1.6, COLUMN_KIND.water, sl.fall);
        // The spouters: a constant burble with a pulse on each one's own period. Under hot play
        // they burble higher and pulse faster (their own clock runs quicker) and higher; a
        // four-line eruption sets them off in sympathy (again with each feed), and each cascade
        // wave kicks one, higher the deeper the wave.
        const spouts = this.parts.geyser?.spouts;
        const boil = 1 + 1.4 * level + 2.2 * fever;
        const pulse = 1 + 0.8 * level + 1.6 * fever;
        SPOUTERS.forEach((sp, i) => {
            const mirror = this.mirrored ? -1 : 1;
            const spot = spouts?.[i] || [cx + sp.lx * mirror, cy - 6, cz + sp.lz];
            const age = (((this.spoutClock + sp.phase) % sp.period) + sp.period) % sp.period;
            const burble = SPOUTER_BURBLE * boil
                * (0.85 + 0.2 * Math.sin(t * 5.3 + i * 2.1) + 0.12 * Math.sin(t * 8.9 + i));
            let sym = 0;
            if (quadLive) {
                sym = Math.max(
                    columnHeight('spouter', t - Q.at - 0.6 - i * 0.95, 6 + 2 * i),
                    columnHeight('spouter', t - Q.kickAt - 0.6 - i * 0.95, 6 + 2 * i),
                );
            }
            this.spoutKicks.forEach((k) => {
                if (k.spouter === i && t - k.at < 2) sym = Math.max(sym, columnHeight('spouter', t - k.at, k.height));
            });
            set(
                COLUMN_SLOT.spouter0 + i,
                spot[0],
                spot[2],
                spot[1] - 0.1,
                Math.max(burble, columnHeight('spouter', age, ERUPTIONS.spouter.height * pulse), sym),
                sym > 2 ? 0.45 : 0.2 + 0.08 * fever,
                0.5,
                COLUMN_KIND.spouter,
            );
        });
        // The hard drops' fumarole jets: sharp white steam and water, 2–8 m by the rows fallen,
        // their slug's drops flying in one arc.
        for (let j = 0; j < 2; j++) {
            const jet = this.jets[j];
            const age = jet ? t - jet.start : 1e6;
            const h = jet && age < 2 ? columnHeight('jet', age, jet.height) : 0;
            set(
                COLUMN_SLOT.spouter0 + SPOUTERS.length + j,
                jet ? jet.x : 0,
                jet ? jet.z : 0,
                jet ? jet.base : 0,
                h,
                0.55,
                0.4,
                COLUMN_KIND.jet,
            );
        }
        u.eruptionCount.value = COLUMN_SLOT.spouter0 + SPOUTERS.length + 2;
        // The steam phases (§1.4, §3.9, §3.10): the Chalice's thread swells into a billowing white
        // exhalation — three to four times the column's width, towering out of the frame and
        // leaning across the sky band, its shadow cast from the same row — then thins and settles
        // back to its thread. Each source gives how far it has grown (the plume's size), how dense
        // it still is, and how big it gets.
        if (this.threadSlot >= 0 && this.plumeBase) {
            let grown = 0;
            let dense = 0;
            let size = 0;
            const take = (g, d, s) => {
                if (g * s > grown * size) size = s;
                grown = Math.max(grown, g);
                dense = Math.max(dense, d);
            };
            // A phase `age` seconds in of `len`: in over `rise`, thinning from 40%, settling at the end.
            const phase = (age, len, rise, s) => {
                if (!(age >= 0) || age >= len) return;
                const g = smooth(0, rise, age);
                take(g * (1 - smooth(len * 0.8, len, age)), g * (1 - smooth(len * 0.4, len * 0.95, age)), s);
            };
            // Idle: steam flashes off the 25 m column, then a 20 s steam phase after its water.
            if (idleAge >= 0) {
                const flash = smooth(0, 3, idleAge) * (1 - smooth(IDLE_WATER, IDLE_WATER + 4, idleAge));
                take(0.25 * flash, 0.3 * flash, 0.45);
                phase(idleAge - IDLE_WATER + 2, IDLE_STEAM + 2, 4, 0.45);
            }
            // A broken chain's roaring white exhalation, 4 + 2·peak seconds, as big as the chain was
            // (a second break inside it rolls on top of it: both run to their end).
            const exhale = (rl) => {
                if (rl.peak >= 2) phase(t - rl.at, rl.length, 1.2, clamp01(0.3 + 0.11 * rl.peak));
            };
            exhale(this.prevRelease);
            exhale(this.lastRelease);
            // Four lines: steam flashes off the column, then the 15 s steam phase from its fall-back
            // (a phase a feed overtook rolls on to its end under the next).
            if (quadLive) take(0.3 * smooth(0.3, 1.5, quadAge), 0.35 * smooth(0.3, 1.5, quadAge), 1);
            phase(t - (Q.holdEnd - STEAM_LEAD), q.steam + STEAM_LEAD, 2.4, 1);
            phase(t - Q.overtaken[0], q.steam + STEAM_LEAD, 2.4, 1);
            phase(t - Q.overtaken[1], q.steam + STEAM_LEAD, 2.4, 1);
            // Hot play: the Chalice boils harder, its thread swelling toward a standing steam column
            // that roars through a fever.
            const roar = 0.12 * level * level + 0.5 * fever;
            if (roar > 0.005) take(roar, roar, 0.25 + 0.45 * fever);
            now.grown = grown;
            now.dense = dense;
            now.size = size;
            const A0 = this.plumeBase[this.threadSlot * 2];
            const B0 = this.plumeBase[this.threadSlot * 2 + 1];
            const A = u.tables.plumes[this.threadSlot * 2];
            const B = u.tables.plumes[this.threadSlot * 2 + 1];
            // (its fullest billows stand where the frame shows them, its crown far above the top)
            A.w = lerp(A0.w, 100 + 60 * size, grown);
            B.x = lerp(B0.x, 8 + 14 * size, grown);
            B.y = lerp(B0.y, 24 + 40 * size, grown);
            // Thinning: the grown plume loses its density before it settles back.
            B.z = lerp(B0.z, 1.25 + 0.45 * size, dense) * lerp(1, 0.35, Math.max(0, grown - dense))
                // A drained Chalice (game over) breathes only a faint thread.
                * (1 - 0.8 * (this.drained || 0));
        }
        // The flood, the fumaroles' sympathy and the bow, for the shaders (on the wrapped clock).
        u.floodAt.value = this.toPhase(this.floodAt);
        u.sympathyAt.value = this.toPhase(this.sympathyAt);
        // The bow lives in the column's spray while it stands: it fades with the fall-back, and a
        // refill brings it back from where it had faded to (never a jump).
        const bowIn = this.reducedMotion ? 0.8 : 0.5;
        let bow = 0;
        if (quadLive) {
            bow = smooth(0.85, 0.85 + bowIn, quadAge) * (1 - smooth(Q.holdEnd, Q.holdEnd + 0.5, t));
            const r = t - Q.refillAt;
            if (r >= 0 && r < bowIn) {
                const from = 1 - smooth(0, 0.5, Q.refillFrom * q.fall);
                bow *= lerp(from, 1, smooth(0, bowIn, r));
            }
        }
        u.bow.value = bow;
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight and stands on level one. */
    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
        this.sunNow.azimuth = this.sunTarget.azimuth;
        this.sunNow.elevation = this.sunTarget.elevation;
    }

    /**
     * A new run: no chain, no Consort, the gauges at rest, the season back to High Summer (the
     * stone record clears with it). The basin's own clocks run on.
     */
    resetSession() {
        this.ladder = [];
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.lockRate = 0;
        this.records = 0;
        this.clearRecord();
        // (the surge is not reset: the basin breathes back to calm on its own clock, no snap)
        // A new run starts on level one, but the year does not turn back: the wheel keeps the
        // place it reached (and goes on turning with the clock).
        this.front = {
            from: this.seasonOffset, to: this.seasonOffset, start: -1e6, length: SEASON_SWEEP,
        };
        this.level = 1;
    }

    /** Kept so the theme and the playground bind every world alike. */
    bindCamera(camera) {
        this._camera = camera;
    }

    updatePixelAngle() {
        if (!this.u) return;
        const height = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / height;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    /**
     * Stand a camera on the rig: on the overlook at (0, height, 0), looking down −z at the
     * rig's pitch, breathing ±0.3° over about 30 s, and turned a little by the pointer.
     */
    pose(camera, t, pointerX = 0, pointerY = 0, calm = 1) {
        const rig = rigForAspect(this.aspect, this._rig);
        const fov = Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, rig.fov));
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        const breathYaw = Math.sin(TAU * BREATH_FX * t) * BREATH_DEG;
        const breathPitch = Math.sin(TAU * BREATH_FY * t + 1.1) * BREATH_DEG * 0.6;
        const px = Math.max(-1, Math.min(1, Number(pointerX) || 0));
        const py = Math.max(-1, Math.min(1, Number(pointerY) || 0));
        // Play moves the overlook a little: each hit thumps it (the ground shaking under the
        // eruptions, riding on a floor under a quick hand) and a fever leans it in over the basin.
        // Off under reduced motion, and at rest (the rest camera is posed with calm 0).
        const thump = Math.min(1.2, this._thump || 0) * calm;
        const lean = (this._lean || 0) * calm;
        const yaw = (breathYaw - px * PARALLAX_YAW) * calm;
        const pitch = -rig.pitch + (breathPitch - py * PARALLAX_PITCH) * calm
            - THUMP.pitch * thump - LEAN.pitch * lean;
        const driftX = (Math.sin(TAU * BREATH_FX * t + 0.7) * BREATH_X + px * PARALLAX_X) * calm;
        const driftY = Math.sin(TAU * BREATH_FY * t + 2.3) * BREATH_Y * calm - THUMP.drop * thump - LEAN.drop * lean;
        camera.position.set(driftX, rig.height + driftY, -LEAN.forward * lean);
        camera.rotation.set(pitch * DEG, yaw * DEG, 0, 'YXZ');
        camera.updateMatrixWorld();
    }

    updateCamera(camera, sim) {
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = sim.time;
        // (the hits so far, read without stepping the surge, softened over a frame or two so a hit
        // lands as a thump, not a cut; the fever as last sampled)
        const punch = this.surge.punch.valueAt(sim.time);
        const k = approach(1 / 0.07, Math.max(0, sim.delta || 0));
        this._thump = (this._thump || 0) + (punch - (this._thump || 0)) * (punch > (this._thump || 0) ? k : 1);
        this._lean = smooth(0.1, 0.9, this.surgeFever);
        this.pose(camera, sim.time, sim.pointerX, sim.pointerY, this.reducedMotion ? 0 : 1);
        // The shared breath (shared/camera-breath.js) on top of the pose, turning the view
        // only (a look out from the overlook): off under reduced motion. update() copies the
        // camera's matrix into the backdrop's uniforms, so it is refreshed here.
        applyCameraBreath(camera, sim.time, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.aspect = this.aspect;
        cam.updateProjectionMatrix();
        this.pose(cam, this.time, 0, 0, 0);
        return cam;
    }

    // ── Events (numbers only: the parts that show them read these) ──────────────

    /** A piece locked: the Spill (a hard drop is the Plunge). The context is reused: copy it. */
    onLock(context = {}) {
        if (!this.u) return;
        const t = this.time;
        const L = this.lastLock;
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : null;
        L.at = t;
        L.player = Number(context.player) || 0;
        L.u = Number.isFinite(context.u) ? clamp01(context.u) : 0.5;
        L.rowTop = rows ? Math.min(...rows) : 19;
        L.rowBottom = rows ? Math.max(...rows) : 19;
        L.code = pieceCode(context.shape);
        L.color = typeof context.color === 'string' ? context.color : null;
        L.hardDrop = context.hardDrop === true;
        L.distance = Number.isFinite(context.distance) ? Math.max(0, context.distance) : 0;
        this.counts.locks += 1;
        if (L.hardDrop) this.counts.hardDrops += 1;
        // The slot pressure: one more lock into the eased rate (an impulse of 1/τ).
        this.lockRate += 1 / RATE_TAU;
        this.surge.lock(L, t);
        this.spill(L);
        this.lastEventAt = t;
        // The next run's first lock refills a drained Chalice.
        if (this.drain.at > this.drain.refillAt) this.refill(t);
    }

    /**
     * Where a board row lands on its side's ground (§1.5 aiming, §3.7): on screen just beyond the
     * card (and the HUD, when it stands on that side) at the row's height — the Iris's ground on
     * its side, the Stair on the other. Upright, the margins are slivers, so a lock lands on the
     * Iris's near rim below the card, its column mapped along the rim. Returns the ground point
     * (world xz, its height), the side (0 the Iris's ground, 1 the Stair) and metres per board
     * row there.
     */
    aimRow(player, u, row) {
        const { plan } = this;
        const layout = this.layout || fallbackLayout(this.aspect * 1000, 1000);
        const card = cardUnion(layout) || {
            x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.9,
        };
        const board = boardFor(layout, player);
        const at = board ? boardPoint(board, u, row) : { x: 0.5, y: 0.1 + 0.8 * ((row + 0.5) / 20) };
        const rowH = board ? (board.y1 - board.y0) / 20 : 0.04;
        const upright = this.aspect < 0.62;
        let sx;
        let sy = at.y;
        let screenLeft = u < 0.5;
        // The nearest edge of what stands between the aim and the board (the card, or the HUD).
        let edge;
        // Upright: the Iris's near rim below the card, the column mapped along it (column 0 at
        // its left end); where the layout leaves that rim off-screen, the margin slivers beside
        // the card at the row's height, as on a desktop (§3.7).
        const rim = upright ? this.uprightRimPoint(u, card) : null;
        if (rim) {
            [sx, sy] = rim;
            screenLeft = !this.mirrored;
            edge = card.y1;
        } else {
            const { hud } = layout;
            const hudLeft = hud && (hud.x0 + hud.x1) / 2 < (card.x0 + card.x1) / 2;
            const edgeL = Math.min(card.x0, hud && hudLeft ? hud.x0 : 1);
            const edgeR = Math.max(card.x1, hud && !hudLeft ? hud.x1 : 0);
            sx = screenLeft ? Math.max(0.03, edgeL - 0.06) : Math.min(0.97, edgeR + 0.06);
            edge = screenLeft ? edgeL : edgeR;
        }
        // The Iris's ground is on the screen's left unless the layout mirrors it.
        const side = screenLeft !== this.mirrored ? 0 : 1;
        const toCard = rim ? 0 : 2 * Number(screenLeft) - 1;
        let g = screenToGround(plan.rig, this.aspect, sx, sy, 0) || [0, 0, -300];
        const { terraces } = this.parts;
        if (side === 1 && terraces?.heightAt) {
            // The Stair stands up off the floor: walk the ray onto its surface.
            for (let i = 0; i < 3; i++) {
                const h = terraces.heightAt(g[0], g[2]);
                g = screenToGround(plan.rig, this.aspect, sx, sy, h) || g;
                g[1] = h;
            }
        }
        const g2 = screenToGround(plan.rig, this.aspect, sx, Math.min(0.995, sy + rowH), g[1]) || g;
        const perRow = Math.max(0.6, Math.hypot(g2[0] - g[0], g2[2] - g[2]));
        // A board cell's size where it stands, ACROSS the view (metres): what a thing standing up
        // there (a puff, a jet, a curtain of steam) is measured by, whatever the ground's slant.
        const eye = rigFrame(plan.rig).position;
        const range = Math.hypot(g[0] - eye[0], (g[1] || 0) - eye[1], g[2] - eye[2]);
        const cell = Math.max(0.3, range * rowH * 2 * Math.tan((plan.rig.fov * DEG) / 2));
        return {
            x: g[0],
            z: g[2],
            y: g[1] || 0,
            side,
            perRow,
            cell,
            // Where it is on screen, a board cell's height there (screen fractions), and which way
            // the card lies from it: +1 to the right, −1 to the left, 0 above (upright).
            sx,
            sy,
            rowH,
            upright,
            edge,
            toCard,
        };
    }

    /**
     * Upright, where column `u` lands on the Iris's near rim: the rim's points (1.12 pool radii
     * out, on the living bands) that show on screen below the card's foot, ordered left to right,
     * `u` picking along them. Null when none shows (the caller uses the margin slivers).
     */
    uprightRimPoint(u, card) {
        const { rig } = this.plan;
        const [ex, , ez] = this.plan.eye;
        const key = `${this.aspect}|${card.x0}|${card.y0}|${card.x1}|${card.y1}|${ex}|${ez}`;
        if (this.rimKey !== key) {
            const pts = [];
            const m = 0.03;
            for (let i = 0; i < 240; i++) {
                const a = (i / 240) * TAU;
                const r = IRIS_RADIUS * 1.12;
                const p = projectToScreen(rig, this.aspect, [ex + Math.cos(a) * r, 0, ez + Math.sin(a) * r]);
                if (p && p[0] > card.x0 && p[0] < card.x1 && p[1] > card.y1 + m && p[1] < 0.95) pts.push(p);
            }
            pts.sort((a, b) => a[0] - b[0]);
            this.rimKey = key;
            this.rimPoints = pts;
        }
        const pts = this.rimPoints;
        if (!pts.length) return null;
        return pts[Math.min(pts.length - 1, Math.floor(clamp01(u) * pts.length))];
    }

    /**
     * The aim moved `cells` board cells further from the card on screen, onto the ground (the
     * Iris's side: the floor), never off the screen. On the rim below the card: unchanged.
     */
    aimAway(aim, cells) {
        if (aim.toCard === 0) return [aim.x, aim.z];
        const sx = aim.sx - aim.toCard * cells * (aim.rowH / this.aspect);
        const g = screenToGround(this.plan.rig, this.aspect, Math.max(0.02, Math.min(0.98, sx)), aim.sy, 0);
        return g ? [g[0], g[2]] : [aim.x, aim.z];
    }

    /**
     * The Spill (§3.7): a lock's fan on its side's ground. A hot surge leaves the runoff channel
     * at the piece's rows (on the Stair: the brimming lip there) and runs downstream, away from
     * the card: it scours a strip to bare cream, then streamers in the piece's colour grow down it,
     * and it bleaches on the slot pressure's life. Its size is the screen's: about 2.6 board cells
     * long (1.5× for a hard drop) and the piece's rows wide (1.5 cells high at least on phones),
     * never within half a cell of the card; each slot varies its length and heading. A hard drop
     * also fires the nearest fumarole's jet.
     */
    spill(L) {
        const mid = (L.rowTop + L.rowBottom) / 2;
        const aim = this.aimRow(L.player, L.u, mid);
        const rows = Math.max(1, L.rowBottom - L.rowTop + 1);
        const hard = L.hardDrop ? 1.5 : 1;
        const rand = mulberry32((this.counts.locks * 7919) ^ 0xb100);
        const fan = this.placeBloom(aim, rows, hard, rand);
        // At most LOCK_SPRINGS lock springs at once (the ladder's vents keep their own): the
        // ground reads as a few fresh springs, never a carpet of discs. Hot play keeps a couple
        // more, and keeps them in colour longer (the slot pressure alone would bleach a quick
        // hand's springs fastest): the stone remembers a fever.
        const t = this.time;
        const level = this.surge.level.valueAt(t);
        const slots = Math.min(this.tier.bloomSlots, LOCK_SPRINGS + Math.round(2 * level));
        const life = Math.min(60, Math.max(bloomLife(slots, this.lockRate), 6 + 7 * level + 5 * this.surgeFever));
        // Once they are all taken the spring nearest its end goes out: it fades into the ground
        // over OUT_TIME, never vanishing (its bleach kept: see goOut).
        const springs = this.blooms.filter((b) => !b.vent && !(b.outAt >= 0));
        if (springs.length >= slots) {
            let k = springs[0];
            springs.forEach((b) => {
                if (b.start + b.life < k.start + k.life) k = b;
            });
            ThermalBloomWorld.goOut(k, t);
        }
        // Bounded: the springs fading out beyond SPRINGS_FADING (and anything when the pool is
        // full) give way, the furthest gone first.
        const fading = this.blooms.filter((b) => !b.vent && b.outAt >= 0);
        if (fading.length > SPRINGS_FADING || this.blooms.length >= this.tier.bloomSlots) {
            const pool = fading.length ? fading : this.blooms;
            let k = pool[0];
            const remains = (b) => (b.outAt >= 0 ? b.outAt + OUT_TIME : b.start + b.life);
            pool.forEach((b) => {
                if (remains(b) < remains(k)) k = b;
            });
            this.blooms.splice(this.blooms.indexOf(k), 1);
        }
        const rgb = hexToLinear(L.color || '#EDE6CF');
        this.blooms.push({
            x: fan.x,
            z: fan.z,
            cell: aim.cell,
            start: t,
            life,
            rgb,
            side: aim.side,
            span: fan.span,
            length: fan.length,
            heading: fan.heading,
        });
        if (L.hardDrop) {
            this.jets.push({
                x: aim.x, z: aim.z, base: aim.y, start: t, height: 2 + 6 * clamp01(L.distance / 18),
            });
            if (this.jets.length > 2) this.jets.shift();
        }
        // The boil-over: the spill's water bursts up where it leaves its channel (the fan's
        // foot), thrown as drops and a puff of steam lit from below by the piece's colour.
        const stairY = aim.side === 1 && this.parts.terraces?.heightAt
            ? this.parts.terraces.heightAt(fan.x, fan.z) : 0;
        this.boils.push({
            x: fan.x,
            y: stairY,
            z: fan.z,
            start: t,
            rgb,
            cell: aim.cell,
            hard: L.hardDrop,
            drop: clamp01(L.distance / 18),
            seed: this.counts.locks % 64,
            // (an upright phone's margin is a sliver about two cells wide: the boil keeps inside it)
            narrow: Boolean(aim.upright && aim.toCard !== 0),
            // (when it was asked to make room: it thins away from then, BOIL_THIN)
            cut: -1,
        });
        // A quick hand fills the air: past BOILS_SOFT the oldest thin away rather than vanish.
        let standing = 0;
        for (let i = this.boils.length - 1; i >= 0; i--) {
            const b = this.boils[i];
            if (b.cut >= 0) continue;
            standing += 1;
            if (standing > BOILS_SOFT) b.cut = t;
        }
        while (this.boils.length > BOILS_MAX) this.boils.shift();
    }

    /** How much of a boil-over's steam still stands at t (1, or thinning away once cut). */
    static boilThin(b, t) {
        return b.cut >= 0 ? 1 - smooth(b.cut, b.cut + BOIL_THIN, t) : 1;
    }

    /**
     * A spring goes out at `at`: it fades into the ground over OUT_TIME (the shader's BLOOM_OUT).
     * The shader reads a spring going out on the out life, so a lock spring's age is rescaled to
     * it: its colour stays as bleached as it was instead of flaring back.
     */
    static goOut(b, at) {
        if (b.outAt >= 0) return;
        if (!b.vent && b.life !== BLOOM_OUT.life) {
            const age = Math.max(0, at - b.start);
            b.start = at - Math.min(BLOOM_OUT.life * 0.98, age * (BLOOM_OUT.life / Math.max(1, b.life)));
            b.life = BLOOM_OUT.life;
        }
        b.outAt = at;
    }

    /** How long a boil-over stands in the air (seconds): its drops, then its steam. */
    static boilLife(b) {
        return b.hard ? 7 : 5.5;
    }

    /**
     * The bursts' rows (thermal-bloom-bursts.js): each live boil-over's splash, and a hard
     * drop's jet. Written newest first, at most BURST_SLOTS.
     */
    writeBursts(t) {
        const { u } = this;
        if (!u?.tables?.bursts) return;
        const rows = u.tables.bursts;
        let n = 0;
        this.boils = this.boils.filter((b) => t - b.start < ThermalBloomWorld.boilLife(b)
            && !(b.cut >= 0 && t - b.cut >= BOIL_THIN && t - b.start > 3));
        for (let i = this.boils.length - 1; i >= 0 && n < BURST_SLOTS; i--) {
            const b = this.boils[i];
            if (t - b.start > 3) continue;
            const scale = b.cell * (b.hard ? 1.2 + 0.7 * b.drop : 2) * (b.narrow ? 0.55 : 1);
            rows[n * 2].set(b.x, b.y, b.z, this.toPhase(b.start));
            const kind = b.hard ? BURST_KIND.jet : BURST_KIND.splash;
            rows[n * 2 + 1].set(b.rgb[0], b.rgb[1], b.rgb[2], burstCode(kind, scale));
            n += 1;
            if (b.hard && n < BURST_SLOTS) {
                rows[n * 2].set(b.x, b.y, b.z, this.toPhase(b.start + 0.05));
                rows[n * 2 + 1].set(b.rgb[0], b.rgb[1], b.rgb[2], burstCode(BURST_KIND.splash, b.cell * 2.6));
                n += 1;
            }
        }
        // The Seal: a splash of drops along each new lip as its pool fills and spills.
        for (let i = this.fills.length - 1; i >= 0 && n < BURST_SLOTS; i--) {
            const f = this.fills[i];
            const a = t - f.start;
            if (!(a >= 0.3) || a > 3) continue;
            const y = f.side === 1 && this.parts.terraces?.heightAt ? this.parts.terraces.heightAt(f.x, f.z) : 0;
            rows[n * 2].set(f.x, y, f.z, this.toPhase(f.start + 0.35));
            rows[n * 2 + 1].set(0.55, 0.95, 1.0, burstCode(BURST_KIND.splash, f.cell * 2.2));
            n += 1;
        }
        // The ladder: each live vent's fountain, lit by the chain's heat; it stops when the chain
        // breaks (a last splash as it blows out).
        const heat = ThermalBloomWorld.heatColour(this.ladderChain(t), this._heatRgb || (this._heatRgb = [0, 0, 0]));
        this.ladder = this.ladder.filter((v) => !(v.out > v.start) || t - v.out < 3);
        for (let i = this.ladder.length - 1; i >= 0 && n < BURST_SLOTS; i--) {
            const v = this.ladder[i];
            const blown = v.out > v.start;
            const life = blown ? Math.max(0.1, v.out - v.start) : 999;
            const vc = v.rgb || heat;
            rows[n * 2].set(v.x, v.y, v.z, this.toPhase(v.start));
            const rungK = 0.55 + 0.06 * Math.max(0, (v.link || 2) - 2);
            rows[n * 2 + 1].set(vc[0], vc[1], vc[2], burstCode(BURST_KIND.fountain, v.cell * rungK, life));
            n += 1;
            if (blown && t >= v.out && t - v.out < 1.5 && n < BURST_SLOTS) {
                rows[n * 2].set(v.x, v.y, v.z, this.toPhase(v.out));
                rows[n * 2 + 1].set(vc[0], vc[1], vc[2], burstCode(BURST_KIND.splash, v.cell * 2.2));
                n += 1;
            }
        }
        u.burstCount.value = n;
    }

    /**
     * Where a lock's fan lies, and how big (§3.7): its foot (world x, z), its heading (in
     * BLOOM_CODE's 128ths of a turn), its width at the far end and its length (whole metres).
     */
    placeBloom(aim, rows, hard, rand) {
        const { plan, u } = this;
        const { rig } = plan;
        const A = this.aspect;
        const cellPx = aim.rowH * 1000;
        const stair = aim.side === 1 && this.parts.terraces?.lipNear;
        // On screen (pixels of a 1000-high frame), on the Stair's own surface where it stands.
        const screen = (x, z) => {
            const p = projectToScreen(rig, A, [x, stair ? this.parts.terraces.heightAt(x, z) : 0, z]);
            return p ? [p[0] * A * 1000, p[1] * 1000] : null;
        };
        // A phone's margin slivers are narrow: there the fan is a cell wide and runs down them.
        const sliver = aim.upright && aim.toCard !== 0;
        // Each slot leaves its channel a little further from the card than the last, or nearer.
        let foot = stair || sliver ? [aim.x, aim.z] : this.aimAway(aim, 0.8 + rand() * 2.0);
        let dir;
        if (sliver) {
            // A sliver: the fan stands in its middle at the row's height and runs straight down
            // the screen (toward the lens), a cell wide.
            const mid = aim.toCard === 1 ? aim.edge / 2 : (aim.edge + 1) / 2;
            const ground = (sy) => {
                let g = screenToGround(rig, A, mid, sy, 0);
                for (let i = 0; stair && g && i < 3; i++) {
                    g = screenToGround(rig, A, mid, sy, this.parts.terraces.heightAt(g[0], g[2])) || g;
                }
                return g;
            };
            const g0 = ground(aim.sy);
            const g1 = ground(Math.min(0.99, aim.sy + aim.rowH));
            if (g0) foot = [g0[0], g0[2]];
            dir = g0 && g1 ? [g1[0] - g0[0], g1[2] - g0[2]] : [0, 1];
        } else if (stair) {
            // The Stair: the terrace at the piece's rows brims over its lip; the streamers run
            // down the riser below it, down the slope.
            const lip = this.parts.terraces.lipNear(aim.x, aim.z);
            if (lip) foot = [lip.x, lip.z];
            dir = [u.stairDown.value.x, u.stairDown.value.y];
        } else {
            // The Iris's ground: out of the nearest finger, downstream (outward from the Iris and
            // downhill), turned toward whichever way leads away from the card on screen.
            const ix = u.irisCentre.value.x;
            const iz = u.irisCentre.value.y;
            const rl = Math.hypot(foot[0] - ix, foot[1] - iz) || 1;
            const radial = [(foot[0] - ix) / rl, (foot[1] - iz) / rl];
            const down = [u.downhill.value.x, u.downhill.value.y];
            const base = aim.toCard === 0 ? radial : [0.4 * radial[0] + 0.6 * down[0], 0.4 * radial[1] + 0.6 * down[1]];
            const bl = Math.hypot(base[0], base[1]) || 1;
            const o = screen(foot[0], foot[1]);
            let best = [base[0] / bl, base[1] / bl];
            let bestScore = -Infinity;
            for (let deg = -70; deg <= 70; deg += 5) {
                const a = deg * DEG;
                const c = Math.cos(a);
                const s = Math.sin(a);
                const d = [(base[0] * c - base[1] * s) / bl, (base[0] * s + base[1] * c) / bl];
                const p = screen(foot[0] + d[0] * 4, foot[1] + d[1] * 4);
                if (!o || !p) continue;
                const vx = p[0] - o[0];
                const vy = p[1] - o[1];
                const vl = Math.hypot(vx, vy) || 1;
                // A fan three cells long must stay on the screen (a phone's slivers are narrow).
                const ex = o[0] + (vx / vl) * cellPx * 3.2;
                const ey = o[1] + (vy / vl) * cellPx * 3.2;
                const off = ex < 8 || ex > A * 1000 - 8 || ey > 992 ? 1 : 0;
                const score = (aim.toCard === 0 || sliver
                    ? vy / vl - 0.3 * Math.abs(vx / vl)
                    : (-aim.toCard * vx * 2.0 + vy * 0.6) / vl - 0.15 * Math.abs(deg / 70)) - off;
                if (score > bestScore) {
                    bestScore = score;
                    best = d;
                }
            }
            // Each slot a little its own way.
            const jitter = (rand() - 0.5) * 34 * DEG;
            const c = Math.cos(jitter);
            const s = Math.sin(jitter);
            dir = [best[0] * c - best[1] * s, best[0] * s + best[1] * c];
        }
        const dl = Math.hypot(dir[0], dir[1]) || 1;
        dir = [dir[0] / dl, dir[1] / dl];
        const perp = [-dir[1], dir[0]];
        // Metres per board cell on screen along the flow and across it, at the foot.
        // Across the flow at the foot's own height (the rim runs level); along it over the ground
        // as it falls (a riser's drop counts on screen).
        const perCell = (v, level = false) => {
            const h = stair && level ? this.parts.terraces.heightAt(foot[0], foot[1]) : null;
            const at = (x, z) => {
                if (h === null) return screen(x, z);
                const q = projectToScreen(rig, A, [x, h, z]);
                return q ? [q[0] * A * 1000, q[1] * 1000] : null;
            };
            const o = at(foot[0], foot[1]);
            const p = at(foot[0] + v[0], foot[1] + v[1]);
            const px = o && p ? Math.hypot(p[0] - o[0], p[1] - o[1]) : 0;
            return px > 1e-6 ? cellPx / px : aim.perRow;
        };
        const vary = 0.7 + 0.7 * rand();
        // About three cells long (the Stair: two, down the riser below the lip), the piece's
        // rows wide and never under a cell and a half (the Stair: two).
        let length = perCell(dir) * (stair ? 4.2 : 3.2) * hard * vary;
        const wide = sliver ? 1.05 : Math.max(stair ? 3.4 : 2.6, rows * 1.1) * (aim.upright ? 1.25 : 1);
        let span = perCell(perp, true) * wide * (0.85 + 0.3 * rand());
        // At least 1.5 cells tall on a phone's screen.
        if (aim.upright) {
            const o = screen(foot[0], foot[1]);
            const p = screen(foot[0] + dir[0] * length, foot[1] + dir[1] * length);
            const tall = o && p ? Math.abs(p[1] - o[1]) : cellPx;
            if (tall < cellPx * 1.5) length *= Math.min(3, (cellPx * 1.5) / Math.max(tall, 1e-3));
        }
        // On the Stair a fan runs down its riser (2.4–4 m of slope) and a little over the floor
        // below, never down the whole flight; a drop's a little further.
        if (stair) length = Math.min(length, 9 * hard);
        length = Math.max(1, Math.min(99, Math.round(length)));
        span = Math.max(2, Math.min(99, Math.round(span)));
        // Keep the whole fan at least half a cell clear of the card (or the HUD): slide its foot
        // away on screen until it is.
        const outline = [[0, 0.15], [0, -0.15], [1.05, 0.7], [1.05, -0.7], [0.6, 0.6], [0.6, -0.6]];
        for (let i = 0; i < 4; i++) {
            const [fx, fz] = foot;
            const pts = outline.map(([f, w]) => screen(
                fx + dir[0] * length * f + perp[0] * span * w,
                fz + dir[1] * length * f + perp[1] * span * w,
            )).filter(Boolean);
            if (!pts.length) break;
            let over = 0;
            if (aim.toCard === 1) over = Math.max(...pts.map((p) => p[0])) - (aim.edge * A * 1000 - cellPx * 0.5);
            else if (aim.toCard === -1) over = aim.edge * A * 1000 + cellPx * 0.5 - Math.min(...pts.map((p) => p[0]));
            else over = aim.edge * 1000 + cellPx * 0.5 - Math.min(...pts.map((p) => p[1]));
            if (over <= 0) break;
            const o = projectToScreen(rig, A, [foot[0], 0, foot[1]]);
            if (!o) break;
            let nx = aim.toCard === 0 ? o[0] : o[0] - (aim.toCard * (over + 2)) / (A * 1000);
            // Never off the screen's own edge: a fan in a phone's sliver may touch its gap.
            const keepIn = (cellPx * 0.6) / (A * 1000);
            nx = Math.max(keepIn, Math.min(1 - keepIn, nx));
            const ny = aim.toCard === 0 ? o[1] + (over + 2) / 1000 : o[1];
            const g = screenToGround(rig, A, Math.max(0.005, Math.min(0.995, nx)), Math.min(0.995, ny), 0);
            if (!g) break;
            foot = [g[0], g[2]];
            if (stair) {
                const lip = this.parts.terraces.lipNear(foot[0], foot[1]);
                if (lip) foot = [lip.x, lip.z];
            }
        }
        const turn = Math.atan2(dir[0], dir[1]) / TAU;
        const heading = ((Math.round(turn * BLOOM_CODE.headings) % BLOOM_CODE.headings) + BLOOM_CODE.headings)
            % BLOOM_CODE.headings;
        return {
            x: foot[0], z: foot[1], heading, span, length,
        };
    }

    /** The live blooms into their rows (compacted at the front of the block). */
    writeBlooms(t) {
        const { u } = this;
        const rows = u.tables.events;
        const at = EVENT_ROWS.blooms;
        this.blooms = this.blooms.filter((b) => t - b.start < b.life && !(t - b.outAt > OUT_TIME));
        this.blooms.forEach((b, i) => {
            rows[at + i * 2].set(b.x, b.z, this.toPhase(b.start), b.life);
            const code = (b.heading || 0) * BLOOM_CODE.heading + b.side * BLOOM_CODE.side
                + Math.round(b.span) * BLOOM_CODE.span + Math.round(b.length);
            // A spring going out (the release) fades into the ground: its life is written negated
            // as the phase it went out at (BLOOM_OUT).
            if (b.outAt >= 0) rows[at + i * 2].w = -this.toPhase(b.outAt);
            rows[at + i * 2 + 1].set(b.rgb[0], b.rgb[1], b.rgb[2], code);
        });
        u.bloomCount.value = this.blooms.length;
    }

    /** Lines cleared: the Seal (four: the eruption; perfect: the Sleeper). Copy what is kept. */
    onClear(context = {}) {
        if (!this.u) return;
        const t = this.time;
        // A perfect clear comes a beat after the clear it crowns, on a frame of its own with no
        // rows (the director resolves it alone): it is a crown on what is still playing — the
        // Sleeper wakes, the basin is renewed — never a new clear that would cut the eruption.
        if (context.perfect === true && !(Array.isArray(context.rows) && context.rows.length) && !context.screen) {
            this.crown(t);
            return;
        }
        const C = this.lastClear;
        const lines = Math.max(1, Math.min(4, Math.round(Number(context.lines) || 1)));
        C.at = t;
        C.player = Number(context.player) || 0;
        C.lines = lines;
        C.combo = Math.max(0, Math.round(Number(context.combo) || 0));
        C.cascade = Math.max(1, Math.round(Number(context.cascade) || 1));
        C.tspin = context.tspin === true;
        C.perfect = context.perfect === true;
        C.b2b = context.b2b === true;
        C.rows = Array.isArray(context.rows) ? context.rows.slice(0, 4).map((r) => Number(r) || 0) : [];
        // Each cleared row's ten piece codes, flat and in step with `rows` (row k, column c at k·10 + c).
        const codes = context.rowCodes;
        C.rowCodes = Array.isArray(codes) || ArrayBuffer.isView(codes)
            ? Array.from(codes).slice(0, 40).map((code) => Math.max(0, Math.min(7, Math.round(Number(code) || 0))))
            : [];
        this.counts.clears += 1;
        this.counts.lines += lines;
        this.surge.clear(C, t);
        if (lines >= 4) {
            this.counts.quads += 1;
            // The Chalice's major eruption: launched, or — while one stands — fed (held up longer,
            // its crown higher: two fours in a run are a double eruption). The apron floods (on
            // from where a flood still stands), and a back-to-back run doubles it at the Consort.
            this.quad.feed(t, 1);
            this.flood(t + ERUPTIONS.quad.delay);
            if (C.b2b || this.b2b > 0) this.consortCol.feed(t, 1);
        } else {
            // A smaller clear while the four-line column stands keeps it up a little longer and
            // a little higher (the chain feeds the eruption; it never cuts it).
            this.quad.feed(t, 0.12 * lines + 0.08 * Math.min(4, C.cascade - 1), { launch: false });
        }
        // A back-to-back clear: the Consort answers with a burst off its pool, the next one
        // feeding it higher (§3.5).
        if (C.b2b) this.consortKick.feed(t, 1);
        // Each cascade wave past the first kicks a spouter on the mound, higher the deeper it
        // runs; from the third the fumaroles across the basin chuff with it.
        if (C.cascade >= 2) {
            this.kickSpouter((C.cascade - 2) % SPOUTERS.length, 3 + 2.2 * Math.min(8, C.cascade), t);
            if (C.cascade >= 3 && t - this.sympathyAt > 1.2) this.sympathyAt = t;
        }
        if (C.tspin) this.counts.tspins += 1;
        if (C.cascade > 1) this.counts.cascades += 1;
        // Every cleared row lays a stripe in the stone record (a perfect clear's stone stays).
        this.records += C.perfect ? 0 : lines;
        if (!C.perfect) this.seal(C);
        if (C.tspin) this.spawnDevils(C);
        // A perfect clear in the clear's own frame: the clear, and its crown.
        if (C.perfect) this.crown(t, { clear: false });
        this.lastEventAt = t;
    }

    /**
     * The perfect clear's crown (§3.12): the Sleeper wakes on the far rim (a second while it
     * stands feeds it), a renewal front sweeps out from the Iris, the light swells and the colour
     * lifts; every live bloom finishes into recolonised mat at once; the stone (fossils,
     * rosettes) stays. Layered on whatever still plays: nothing running is cut.
     */
    crown(t, { clear = true } = {}) {
        const p = this.perfect;
        if (t - p.fedAt > 30) p.at = t;
        p.fedAt = t;
        if (!(t - p.renewAt - RENEW.delay < RENEW.sweep)) p.renewAt = t;
        this.sleeperCol.feed(t, 1);
        this.counts.perfects += 1;
        if (clear) this.surge.clear(PERFECT_ALONE, t);
        this.blooms.forEach((b) => { b.life = Math.min(b.life, t - b.start + 0.4); });
        this.lastEventAt = t;
    }

    /** A cascade wave's kick at one of the mound's spouters (the oldest kick gives way). */
    kickSpouter(spouter, height, t) {
        let k = this.spoutKicks[0];
        this.spoutKicks.forEach((s) => {
            if (s.at < k.at) k = s;
        });
        k.at = t;
        k.height = height;
        k.spouter = spouter;
    }

    /**
     * Four lines flood the apron from `at` (the shader's timeline: out over a second, draining
     * from 4 s, gone by 12.5). A flood still standing is not restarted from nothing: the new one
     * surges on from the reach it has.
     */
    flood(at) {
        const reachAt = (a) => (a >= 0 && a < 12.5 ? (1 - Math.exp(-a / 0.9)) * (1 - smooth(4, 12, a)) : 0);
        const age = at - this.floodAt;
        if (age >= 0 && age < 2) return;
        const r = Math.min(0.97, reachAt(age));
        this.floodAt = r > 0.02 ? at + 0.9 * Math.log(1 - r) : at;
    }

    /**
     * The Seal (§1.5, §3.8): for each cleared row, on both sides at that row's height, one new lip
     * draws along its rim and the pool behind it fills and spills (the rows chain 0.15 s apart;
     * a cascade's wave k reaches k − 1 tiers further down); the row's own colours fix into the
     * record on the riser under that lip. The Stair's lip is the one at the row's height on
     * screen (its tier is the one seen there, so the record row and the shader's tier agree);
     * the Iris's is the microterrace under the row beside the card. A synthetic clear without
     * rows seals the lowest rows in Bleached Sinter.
     */
    seal(C) {
        const rows = C.rows.length ? C.rows : Array.from({ length: C.lines }, (_, k) => 19 - k);
        const t = this.time;
        // The waves this clear has run (the director hands the last wave's count), as many as
        // the fill slots hold for its rows on both sides.
        const waves = Math.max(1, Math.min(C.cascade, 4, Math.floor(EVENT_SLOTS.fills / (2 * rows.length))));
        this.recordAfterSeek();
        this.writeRecordZones(C.player);
        rows.forEach((row, k) => {
            const codes = C.rowCodes.length >= (k + 1) * 10 ? C.rowCodes.slice(k * 10, k * 10 + 10) : null;
            [0, 1].forEach((edge) => {
                for (let w = 0; w < waves; w++) {
                    const site = this.sealSite(C.player, edge, row, w);
                    if (!site) return;
                    // The row's own stripe fixes under its own lip.
                    if (w === 0) this.layStripe(site.record, codes, site.at, site.tag);
                    this.pushFill(site.x, site.z, site.side, site.index, t + k * 0.15 + w * 0.3, site.cell);
                }
            });
        });
        if (this.tex?.record) this.tex.record.needsUpdate = true;
    }

    /**
     * Where a cleared row seals on one side: the fill row's aim and index (the Stair: the tier
     * whose riser drops from the lip; the Iris: the cascade's extension), the record row, where
     * along it the stripe starts (0..1) and its alpha (255 on the Stair; the Iris: the terrace
     * line it lies on, tagged 16·(line mod 15 + 1) + 8).
     */
    sealSite(player, edge, row, extend = 0) {
        const aim = this.aimRow(player, edge, row);
        const samples = this.tier.recordSamples;
        const band = Math.max(10, Math.floor(samples / 8));
        if (aim.side === 1) {
            const { terraces } = this.parts;
            const tiers = Math.max(1, terraces?.tiers ?? 10);
            const lip = terraces?.lipNear?.(aim.x, aim.z);
            // The lowest lip still in frame down this column: a wave that would reach past it (or
            // a row whose own lip lies below the frame) climbs back up the Stair instead, so every
            // wave lights a tier that is seen.
            const last = Math.max(1, Math.min(tiers, this.lowestStairLip(aim.sx)));
            const seen = Math.min(last, lip ? lip.index : 1 + Math.floor(clamp01(row / 20) * tiers));
            const reach = seen + extend;
            const index = Math.max(1, Math.min(tiers, reach > last ? last - (reach - last) : reach));
            return {
                side: 1,
                x: lip ? lip.x : aim.x,
                z: lip ? lip.z : aim.z,
                cell: aim.cell,
                index,
                record: index - 1,
                at: (lip ? lip.across : 0.5) - band / (2 * samples),
                tag: 255,
            };
        }
        const zones = this._zones;
        const zone = Math.min(5, Math.floor(clamp01(row / 20) * 6));
        const [x, z] = this.aimAway(aim, 1.5);
        const ix = this.u.irisCentre.value.x;
        const iz = this.u.irisCentre.value.y;
        const line = Math.floor(Math.hypot(x - ix, z - iz) / 2.6) + 2 * extend;
        let at = 0.06;
        if (zones) {
            const [cx, cz] = zones.centres[zone];
            const ax = cx - ix;
            const az = cz - iz;
            const bx = x - ix;
            const bz = z - iz;
            const s = Math.atan2(ax * bz - az * bx, ax * bx + az * bz) * Math.hypot(ax, az) * zones.away;
            at = s / zones.arc + zones.origin;
        }
        return {
            side: 0,
            x,
            z,
            cell: aim.cell,
            index: extend,
            record: RECORD_RING0 + zone,
            at,
            tag: ((line % 15) + 1) * 16 + 8,
        };
    }

    /**
     * The highest lip index (the furthest down the Stair) whose lip stands in frame on the
     * screen column `sx`, from the rest rig (cached per column and composition).
     */
    lowestStairLip(sx) {
        const { terraces } = this.parts;
        if (!terraces?.lipNear || !terraces?.heightAt) return terraces?.tiers ?? 10;
        const key = `${sx.toFixed(4)}|${this.aspect}|${this.plan.stairNear}|${this.plan.chalice}`;
        if (this.stairLipKey === key) return this.stairLipLast;
        const { rig } = this.plan;
        let last = 1;
        for (let sy = 0.2; sy < 0.97; sy += 0.01) {
            let g = screenToGround(rig, this.aspect, sx, sy, 0);
            for (let i = 0; g && i < 3; i++) {
                g = screenToGround(rig, this.aspect, sx, sy, terraces.heightAt(g[0], g[2])) || g;
            }
            const lip = g ? terraces.lipNear(g[0], g[2]) : null;
            const p = lip ? projectToScreen(rig, this.aspect, [lip.x, terraces.heightAt(lip.x, lip.z), lip.z]) : null;
            if (p && p[1] < 0.95 && lip.index > last) last = lip.index;
        }
        this.stairLipKey = key;
        this.stairLipLast = last;
        return last;
    }

    /**
     * The Iris's record zones (§3.8) for the current layout: six stretches of microterrace down
     * the side of the card, one a sixth of the board's rows (centred on its middle row's aim, a
     * cell and a half from the card), each record row spanning about eight stripes of three cells
     * along the rim, leading away from the card. Written into the basin as it seals.
     */
    writeRecordZones(player = 0) {
        const edge = this.mirrored ? 1 : 0;
        const centres = [];
        for (let k = 0; k < 6; k++) centres.push(this.aimAway(this.aimRow(player, edge, ((k + 0.5) * 20) / 6), 1.5));
        const mid = this.aimRow(player, edge, 10);
        const { rig } = this.plan;
        const step = (mid.rowH / this.aspect) * (mid.toCard === 0 ? 1 : -mid.toCard);
        const a = screenToGround(rig, this.aspect, mid.sx, mid.sy, 0);
        const b = screenToGround(rig, this.aspect, Math.max(0.005, Math.min(0.995, mid.sx + step)), mid.sy, 0);
        const cellAcross = a && b ? Math.max(0.5, Math.hypot(b[0] - a[0], b[2] - a[2])) : mid.perRow;
        const arc = cellAcross * 3 * 8;
        const ix = this.u.irisCentre.value.x;
        const iz = this.u.irisCentre.value.y;
        // Which way round the Iris leads away from the card on screen.
        const [cx, cz] = centres[2];
        const turn = 0.02;
        const rx = cx - ix;
        const rz = cz - iz;
        const p0 = projectToScreen(rig, this.aspect, [cx, 0, cz]);
        const p1 = projectToScreen(rig, this.aspect, [
            ix + rx * Math.cos(turn) - rz * Math.sin(turn), 0, iz + rx * Math.sin(turn) + rz * Math.cos(turn),
        ]);
        let away = 1;
        if (p0 && p1) {
            const moved = mid.toCard === 0 ? p1[0] - p0[0] : -mid.toCard * (p1[0] - p0[0]);
            away = moved >= 0 ? 1 : -1;
        }
        // Positive turns in the shader's sense (cross(a, b) = a.x·b.y − a.y·b.x in (x, z)).
        this._zones = {
            centres, away, arc, origin: 0.06, half: Math.max(4, 1.8 * mid.perRow),
        };
        this.parts.basin?.setRecordZones?.(centres, away, arc, this._zones.half, this._zones.origin);
    }

    /**
     * One fill row; `start` may lie a little ahead (a chain or a wave). The rows are few: while
     * there is room every fill keeps its own timeline (the shader keeps the strongest of each, so
     * a second fill at a rim still filling only adds). When they are all taken a pool already
     * brimming at that same rim is topped up instead — it brims again, held full — and only
     * otherwise does the oldest give way: a quad's pools are not deleted by the next clear.
     */
    pushFill(x, z, side, index, start, cell = 2) {
        const code = side * 100 + index;
        const fill = {
            x, z, start, code, side, cell: Math.max(0.3, cell),
        };
        if (this.fills.length >= EVENT_SLOTS.fills) {
            const near = Math.max(0.3, cell) * 1.5;
            let same = null;
            this.fills.forEach((f) => {
                if (f.code === code && Math.hypot(f.x - x, f.z - z) < Math.max(near, f.cell * 1.5)
                    && (!same || f.start > same.start)) same = f;
            });
            if (same) {
                // Topped up: its pool stays full (its timeline held at the brim), never restarted.
                if (this.time - same.start > 1.1) same.start = this.time - 1.1;
                return;
            }
            let oldest = this.fills[0];
            this.fills.forEach((f) => {
                if (f.start < oldest.start) oldest = f;
            });
            this.fills.splice(this.fills.indexOf(oldest), 1);
        }
        this.fills.push(fill);
    }

    /** The live fills into their rows. */
    writeFills(t) {
        const { u } = this;
        const rows = u.tables.events;
        this.fills = this.fills.filter((f) => t - f.start < 6);
        this.fills.forEach((f, i) => rows[EVENT_ROWS.fills + i].set(f.x, f.z, this.toPhase(f.start), f.code));
        u.fillCount.value = this.fills.length;
    }

    /**
     * Lay one stripe of ten cells (piece codes, left to right; null = Bleached Sinter) into a
     * record row, at fossil saturation. `at` (0..1) starts it where its lip was aimed, after the
     * stripes already laid on that same rim (the same row and tag), wrapping round the row, oldest
     * overwritten first; without it the row's own cursor runs on. `tag` is the alpha.
     */
    layStripe(row, codes, at = null, tag = 255) {
        if (!this.recordData) return;
        const samples = this.tier.recordSamples;
        const band = Math.max(10, Math.floor(samples / 8));
        let first;
        if (at === null || !Number.isFinite(at)) {
            first = this.recordCursor[row];
            this.recordCursor[row] = (first + band) % samples;
        } else {
            if (!this.stripeRuns) this.stripeRuns = new Map();
            const key = `${row}:${tag}`;
            const n = this.stripeRuns.get(key) || 0;
            this.stripeRuns.set(key, n + 1);
            first = Math.round(at * samples) + ((n * band) % samples);
        }
        for (let s = 0; s < band; s++) {
            const cell = Math.min(9, Math.floor((s / band) * 10));
            const code = codes ? codes[cell] : PIECE_CODE.GARBAGE;
            const rgb = FOSSIL[code] || FOSSIL[PIECE_CODE.GARBAGE];
            const o = (row * samples + ((((first + s) % samples) + samples) % samples)) * 4;
            this.recordData[o] = rgb[0];
            this.recordData[o + 1] = rgb[1];
            this.recordData[o + 2] = rgb[2];
            this.recordData[o + 3] = tag;
        }
    }

    /**
     * A seek (which starts the choreography's counts afresh) replays a capture from the start:
     * the stone it laid before is cleared, so a replayed clear lays its stripe once.
     */
    recordAfterSeek() {
        if (this.recordEpoch !== this.counts) {
            this.clearRecord();
            this.recordEpoch = this.counts;
        }
    }

    /** A new session's stone: bare. */
    clearRecord() {
        if (!this.recordData) return;
        this.recordData.fill(0);
        this.recordCursor.fill(0);
        this.stripeRuns?.clear();
        if (this.tex?.record) this.tex.record.needsUpdate = true;
    }

    /** The true combo changed (0 = the chain broke): a splash a link; a broken chain steams. */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        const t = this.time;
        if (n >= 2 && n > this.combo) {
            this.counts.chainSteps += 1;
            this.lastLinkAt = t;
            for (let link = Math.max(2, this.combo + 1); link <= n; link++) this.openVent(link, t);
            if (n >= 6 && this.combo < 6) this.sustainAt = t;
            // Links 4 and 5: the fumaroles across the basin chuff in sympathy.
            if (n >= 4 && n <= 5) this.sympathyAt = t;
        }
        if (n === 0 && this.peak >= 2) {
            this.counts.releases += 1;
            // The thermometer cools from the top down: the hottest vent goes out first, the next
            // a beat later, down to the foot (never the whole ladder in one frame). Each vent's
            // spring goes out with it: it cools toward the mat and is gone OUT_TIME later.
            const lit = this.ladder.filter((v) => !(v.out > v.start)).sort((a, b) => b.link - a.link);
            lit.forEach((v, k) => {
                v.out = t + k * LADDER_OUT_STEP;
                if (v.bloom) ThermalBloomWorld.goOut(v.bloom, v.out);
            });
            this.blooms.forEach((b) => {
                if (b.vent) ThermalBloomWorld.goOut(b, t + lit.length * LADDER_OUT_STEP);
            });
            // A break inside the last one's steam phase rolls on top of it: both run to their end.
            this.prevRelease = this.lastRelease;
            this.lastRelease = {
                at: t,
                peak: this.peak,
                length: steamPhaseLength(this.peak),
                sustained: this.combo >= 6 ? this.sustainedHeight() : 0,
            };
        }
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
        this.combo = n;
        if (n > 0) this.lastEventAt = t;
    }

    /**
     * A link's vent on the ladder: link 2 at the card's foot on the Iris's side, each further link
     * two rows higher on the other side, wrapping back to the foot past the card's top (the
     * newest replaces the oldest there); placed on the ground just beyond the card (and the HUD)
     * at that row's height, as a lock aims.
     */
    openVent(link, t) {
        const i = Math.max(0, link - 2);
        const row = 19 - ((2 * i) % 18);
        const left = i % 2 === 0;
        const aim = this.aimRow(0, left ? 0.04 : 0.96, row);
        // A hot spring opens at its foot in that colour, glowing while it is hot; the springs on
        // a side step out from the card and back (a zig-zag: no plume rises through the rung
        // above it), and each is a little bigger than the last.
        const zig = Math.floor(i / 2) % 2 === 0 ? 0.35 : 1.0;
        const seeded = mulberry32((link * 7919) ^ 0x1add);
        let first = true;
        const rand = () => {
            if (first) {
                first = false;
                return zig;
            }
            return seeded();
        };
        const fan = this.placeBloom(aim, 1, 1, rand);
        fan.span *= Math.min(1.5, 1 + 0.08 * i);
        const y = aim.side === 1 && this.parts.terraces?.heightAt ? this.parts.terraces.heightAt(fan.x, fan.z) : 0;
        this.ladder = this.ladder.filter((v) => v.row !== row || v.side !== aim.side);
        // Each vent keeps the heat of the link that opened it: the ladder reads as a thermometer
        // up the card's sides, turquoise at its foot to white-hot at its top.
        const rgb = ThermalBloomWorld.heatColour(link, [0, 0, 0]);
        this.ladder.push({
            x: fan.x,
            y,
            z: fan.z,
            row,
            side: aim.side,
            link,
            start: t,
            out: -1e6,
            cell: aim.cell,
            rgb,
            toCard: aim.toCard || (left ? 1 : -1),
        });
        while (this.ladder.length > 10) this.ladder.shift();
        const slots = this.tier.bloomSlots;
        if (this.blooms.length >= slots) {
            // Full: what is furthest gone gives way (a spring already going out, else the oldest).
            let k = this.blooms[0];
            const remains = (b) => (b.outAt >= 0 ? b.outAt + OUT_TIME - 1e3 : b.start + b.life);
            this.blooms.forEach((b) => {
                if (remains(b) < remains(k)) k = b;
            });
            this.blooms.splice(this.blooms.indexOf(k), 1);
        }
        const bloom = {
            x: fan.x,
            z: fan.z,
            cell: aim.cell,
            start: t,
            life: BLOOM_OUT.life,
            rgb,
            side: aim.side,
            span: fan.span,
            length: Math.max(1, Math.round(fan.length * 0.5)),
            heading: fan.heading,
            vent: true,
        };
        this.blooms.push(bloom);
        this.ladder[this.ladder.length - 1].bloom = bloom;
    }

    /** The chain the ladder shows: the live one, or the peak it broke at while its vents blow out. */
    ladderChain(t) {
        if (this.combo >= 2) return this.combo;
        // (until the last of its staggered vents has rolled away)
        return t - this.lastRelease.at < 4 + 10 * LADDER_OUT_STEP ? Math.max(2, this.lastRelease.peak) : 2;
    }

    /**
     * The chain's heat as a colour (linear rgb): turquoise at two links, gold by four, orange by
     * six, white-hot from nine.
     */
    static heatColour(chain, out = [0, 0, 0]) {
        const stops = [
            [2, [0.04, 0.6, 0.8]], [3, [0.08, 0.78, 0.42]], [4, [0.9, 0.78, 0.06]], [5, [1.0, 0.52, 0.04]],
            [6, [1.0, 0.3, 0.04]], [7, [0.95, 0.12, 0.08]], [9, [1.0, 0.86, 0.72]],
        ];
        const n = Math.max(2, chain);
        let a = stops[0];
        let b = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
            if (n >= stops[i][0] && n <= stops[i + 1][0]) {
                a = stops[i];
                b = stops[i + 1];
                break;
            }
        }
        const k = b[0] > a[0] ? clamp01((n - a[0]) / (b[0] - a[0])) : 1;
        for (let c = 0; c < 3; c++) out[c] = a[1][c] + (b[1][c] - a[1][c]) * k;
        return out;
    }

    /**
     * The T-spin's devils (§3.11): one a line (1–3), spinning up off the Iris's rim on the side
     * facing the card and wandering toward the card's side for 5–7 s, never round it; under
     * reduced motion they turn in place.
     */
    spawnDevils(C, { small = false } = {}) {
        const { plan } = this;
        const n = small ? 1 : Math.max(1, Math.min(3, C.lines));
        const t = this.time;
        const layout = this.layout || fallbackLayout(this.aspect * 1000, 1000);
        const card = cardUnion(layout) || {
            x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
        };
        const rand = mulberry32(Math.floor(t * 1000) ^ 0xd3);
        const [ex, , ez] = plan.eye;
        for (let i = 0; i < n; i++) {
            // Toward the card: the screen point beside the card at a spread of heights.
            const sx = this.mirrored ? card.x1 + 0.04 : card.x0 - 0.04;
            const sy = 0.45 + 0.12 * (i - (n - 1) / 2) + 0.04 * (rand() - 0.5);
            const goal = screenToGround(plan.rig, this.aspect, sx, sy, 0) || [ex, 0, ez];
            const dx = goal[0] - ex;
            const dz = goal[2] - ez;
            const dl = Math.hypot(dx, dz) || 1;
            const fromX = ex + (dx / dl) * IRIS_RADIUS * 0.35 + (rand() - 0.5) * 30;
            const fromZ = ez + (dz / dl) * IRIS_RADIUS * 0.35 + (rand() - 0.5) * 30;
            const life = 5 + 2 * rand();
            const height = small ? 34 + 10 * rand() : 55 + 20 * rand();
            if (this.devils.length >= EVENT_SLOTS.devils) {
                // Every slot spins: the T-spin feeds the devil nearest its end instead of deleting
                // one mid-spin — it spins on longer, climbs taller, and wanders on toward the card.
                let d = this.devils[0];
                this.devils.forEach((e) => {
                    if (e.start + e.life < d.start + d.life) d = e;
                });
                const x = d.x ?? d.fromX;
                const z = d.z ?? d.fromZ;
                d.fromX = x;
                d.fromZ = z;
                d.toX = x + (goal[0] - x) * 0.35;
                d.toZ = z + (goal[2] - z) * 0.35;
                d.pathAt = t;
                d.life = Math.max(d.life, t - d.start + life);
                d.pathLen = d.start + d.life - t;
                d.heightFrom = ThermalBloomWorld.devilHeight(d, t);
                d.heightTo = Math.min(105, Math.max(d.heightTo, height) + (small ? 6 : 14));
                d.heightAt = t;
                d.radius = Math.min(7.5, d.radius + (small ? 0.2 : 0.6));
                continue;
            }
            this.devils.push({
                start: t + i * 0.35,
                life,
                fromX,
                fromZ,
                toX: fromX + (goal[0] - fromX) * 0.45,
                toZ: fromZ + (goal[2] - fromZ) * 0.45,
                // (the path's own clock: a fed devil walks on from where it stands)
                pathAt: t + i * 0.35,
                pathLen: life,
                // 55–75 m tall, 8–11 m across: a column that reads from the overlook at the Iris
                // (a T-spin that clears nothing: a small one). A feed eases it taller.
                heightFrom: height,
                heightTo: height,
                heightAt: -1e6,
                radius: (small ? 3.2 : 4.2) + 1.4 * rand(),
                seed: rand(),
            });
        }
    }

    /** A devil's height at t (a feed eases it taller over a second). */
    static devilHeight(d, t) {
        return lerp(d.heightFrom, d.heightTo, smooth(d.heightAt, d.heightAt + 1.2, t));
    }

    /**
     * A T-spin that cleared nothing (the director's tspin): still a small devil off the Iris (or
     * a feed to one already spinning), and a little heat.
     */
    onTSpin() {
        if (!this.u) return;
        const t = this.time;
        this.counts.tspins += 1;
        this.spawnDevils(this.lastClear, { small: true });
        this.surge.punch.hit(SURGE_WEIGHTS.punch.tspin * 0.6, t);
        this.surge.level.hit(SURGE_WEIGHTS.heat.tspin * 0.4, t);
        this.lastEventAt = t;
    }

    /** The devils' rows from their paths; a devil that ends leaves its rosette. */
    writeDevils(t) {
        const { u } = this;
        const rows = u.tables.events;
        const keep = [];
        this.devils.forEach((d) => {
            const age = t - d.start;
            if (age >= d.life) {
                this.addRosette(d.x ?? d.fromX, d.z ?? d.fromZ, t);
                return;
            }
            const k = this.reducedMotion ? 0 : smooth(0, 1, Math.max(0, t - d.pathAt) / Math.max(0.1, d.pathLen));
            const px = -(d.toZ - d.fromZ);
            const pz = d.toX - d.fromX;
            const pl = Math.hypot(px, pz) || 1;
            const wob = this.reducedMotion ? 0 : Math.sin(age * 1.7 + d.seed * 6) * 6;
            // (the wobble is about the path: a re-based path starts where the devil stands)
            const wob0 = this.reducedMotion || !(d.pathAt > d.start)
                ? 0 : Math.sin((d.pathAt - d.start) * 1.7 + d.seed * 6) * 6;
            const w = wob - wob0 * (1 - k);
            d.x = d.fromX + (d.toX - d.fromX) * k + (px / pl) * w;
            d.z = d.fromZ + (d.toZ - d.fromZ) * k + (pz / pl) * w;
            d.height = ThermalBloomWorld.devilHeight(d, t);
            keep.push(d);
        });
        this.devils = keep;
        this.devils.forEach((d, i) => {
            rows[EVENT_ROWS.devils + i * 2].set(d.x, d.z, this.toPhase(d.start), d.life);
            rows[EVENT_ROWS.devils + i * 2 + 1].set(d.height, d.radius, d.seed, 0);
        });
        u.devilCount.value = this.devils.length;
        this.rosettes = this.rosettes.filter((r) => t - r.start < 240);
        this.rosettes.forEach((r, i) => rows[EVENT_ROWS.rosettes + i].set(r.x, r.z, this.toPhase(r.start), r.radius));
        u.rosetteCount.value = this.rosettes.length;
    }

    /** A sinter rosette where a devil died (≤ 6: the oldest gives way). */
    addRosette(x, z, t) {
        this.rosettes.push({
            x, z, start: t, radius: 2 + Math.abs(Math.sin(x * 0.37 + z * 0.11)),
        });
        while (this.rosettes.length > EVENT_SLOTS.rosettes) this.rosettes.shift();
    }

    /**
     * A steam phase that stands only for an event borrows one of the two least important far
     * plumes: the Sleeper's after a perfect clear (§3.12) — billows ramping in round its column
     * from about 2 s, then towering and rolling up through the sky band, thinning from about 14 s
     * (a vent's own steam: the thread kind, swollen). The far column fades out before it lends its
     * slot and back in after. The Consort's standing column is its own eruption slot's steam (see
     * writeColumns), so no far column goes missing while a back-to-back chain lives.
     */
    writeSteamOverrides(t) {
        const { u, plan } = this;
        if (!this.spareSlots || !this.plumeBase) return;
        const rows = u.tables.plumes;
        const restore = (slot, k = 1) => {
            rows[slot * 2].copy(this.plumeBase[slot * 2]);
            rows[slot * 2 + 1].copy(this.plumeBase[slot * 2 + 1]);
            rows[slot * 2 + 1].z *= k;
        };
        const [cSlot, sSlot] = this.spareSlots;
        if (cSlot !== undefined) restore(cSlot);
        if (sSlot === undefined) return;
        // (grown from the Sleeper's waking; thinning from the latest perfect clear that fed it)
        const p = this.perfect;
        const age = t - p.at;
        const late = t - p.fedAt;
        const from = 1.2;
        const until = 28;
        if (!(age >= 0) || late > until + 2) restore(sSlot);
        else if (age < from) restore(sSlot, 1 - smooth(0.2, from, age));
        else if (late >= until) restore(sSlot, smooth(until, until + 2, late));
        else {
            const [x, y, z] = plan.sleeper;
            const k = smooth(from, 3.2, age);
            const grow = smooth(1.5, 12, age);
            const thin = 1 - smooth(14, until, late);
            rows[sSlot * 2].set(x, z, y, 160 + 320 * grow);
            rows[sSlot * 2 + 1].set(26 + 14 * grow, 55 + 225 * grow, 1.4 * k * thin, PLUME_KIND.thread);
        }
    }

    /** A world time on the shaders' wrapped clock (u.time is the phase, CLOCK_WRAP periodic). */
    toPhase(t) {
        return t - (this.time - this.phase);
    }

    /** The sustained column's height for the live chain (§3.9: 25 m at six links, 60 m by ten). */
    sustainedHeight() {
        // (a fever lifts it on past the chain's own sixty metres)
        return 25 + 35 * clamp01((this.combo - 6) / 4) + 15 * this.surgeFever;
    }

    /**
     * How much of the Consort's standing steam column stands (0..1): while a back-to-back chain
     * lives, thinning away over 6 s after it breaks; and in a fever the companion vent stirs on
     * its own (the whole basin boils), settling back as the fever cools.
     */
    consortStand(t) {
        const chain = this.b2b > 0 ? smooth(0.05, 0.9, this.consortWet) : 1 - smooth(0, 6, t - this.lastB2BBreak);
        return Math.max(chain, 0.7 * smooth(0.3, 1, this.surgeFever));
    }

    /** The live back-to-back level (0 = the chain broke … 3): the Consort. */
    onB2B(level) {
        const n = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
        if (n > this.b2b) this.counts.b2bSteps += 1;
        if (n >= 3 && this.b2b < 3) this.b2bAt = this.time;
        if (n === 0 && this.b2b > 0) {
            this.counts.b2bBreaks += 1;
            this.lastB2BBreak = this.time;
        }
        this.b2b = n;
    }

    /** The run ended: the springs sigh, and the Chalice's pool drains into its vent. */
    onGameOver() {
        const t = this.time;
        this.drain.at = t;
        // The springs sigh: the living blooms bleach out over a few seconds.
        this.blooms.forEach((b) => { b.life = Math.min(b.life, t - b.start + 3); });
        this.counts.gameOvers += 1;
    }

    /** A mode started: a drained Chalice refills. */
    onSessionStart() {
        const t = this.time;
        if (this.drain.at > this.drain.refillAt) this.refill(t);
    }

    refill(t) {
        this.drain.refillAt = t;
        this.counts.refills += 1;
    }

    /**
     * A new level: the year turns. A succession front sweeps out from the Iris along the fingers
     * over SEASON_SWEEP seconds and the mats behind it take the new season's ramp row. Silent (a
     * rebuild mid-run) lands on the level's season at once.
     */
    levelUp(level, { silent = false } = {}) {
        const lv = Math.max(1, Math.round(Number(level) || 1));
        const t = this.time;
        const gained = Math.max(0, lv - this.level);
        this.level = lv;
        if (silent || !this.u) {
            // A rebuild mid-run (or a capture): straight to the place, no front.
            this.seasonOffset = Math.max(this.seasonOffset + gained, lv - 1);
            this.front = {
                from: this.seasonOffset, to: this.seasonOffset, start: -1e6, length: SEASON_SWEEP,
            };
            this.placeWheel(t);
            return;
        }
        this.counts.levelUps += 1;
        this.surge.levelUp(t);
        if (gained > 0) this.turnSeason(this.seasonOffset + gained, t);
        this.placeWheel(t);
    }

    /** Step the wheel's offset forward, the succession front sweeping the new place out. */
    turnSeason(to, t) {
        const sweep = this.seasonSweepAt(t);
        const from = sweep < 0.5 ? this.front.from : this.front.to;
        this.seasonOffset = to;
        this.front = {
            from, to, start: t, length: SEASON_SWEEP,
        };
        this.counts.seasonSteps += 1;
    }

    /**
     * Where the wheel stands at t: before the succession front (`wheelFrom`) and behind it
     * (`wheel`), and the season it stands nearest. Held still by the playground's season.
     */
    placeWheel(t = this.time) {
        const held = this.held.season;
        this.wheelFrom = held !== null ? held : seasonWheel(t, this.front.from);
        this.wheel = held !== null ? held : seasonWheel(t, this.front.to);
        this.season = Math.round(this.wheel) % SEASONS.length;
    }

    /** The place the wheel reached (handed to a rebuilt world, so a rebuild never turns it back). */
    setSeasonOffset(offset) {
        const o = Math.max(0, Number(offset) || 0);
        if (o <= this.seasonOffset) return;
        this.seasonOffset = o;
        this.front = {
            from: o, to: o, start: -1e6, length: SEASON_SWEEP,
        };
        this.placeWheel();
    }

    /** How far the succession front has swept at t (0 just begun … 1 done). */
    seasonSweepAt(t) {
        const f = this.front;
        if (f.from === f.to) return 1;
        return clamp01((t - f.start) / f.length);
    }

    // ── Playground holds ────────────────────────────────────────────────────────

    /** Hold the season (0..5), the combo heat (0..1), the breath (0..1) or a gust's phase (0..1). */
    hold(key, value) {
        if (!Object.prototype.hasOwnProperty.call(this.held, key)) return;
        const v = Number(value);
        this.held[key] = Number.isFinite(v) ? v : null;
        if (key === 'season' && this.held.season !== null) {
            // The wheel stands still there (a whole number is a season itself).
            this.held.season = Math.max(0, this.held.season);
            this.front = {
                from: 0, to: 0, start: -1e6, length: SEASON_SWEEP,
            };
            this.placeWheel();
        }
    }

    /**
     * Pre-fill the stone record with n stripes (captures): deterministic rows of mixed pieces,
     * each laid as a clear of a random board row would lay it, on both sides.
     */
    primeRecord(n) {
        if (!Number.isFinite(n)) return;
        const count = Math.max(0, Math.round(n));
        this.records = count;
        const rand = mulberry32(0x5eed);
        this.recordAfterSeek();
        this.writeRecordZones(0);
        for (let i = 0; i < count; i++) {
            const codes = Array.from({ length: 10 }, () => Math.floor(rand() * 7));
            const row = Math.floor(rand() * 20);
            [0, 1].forEach((edge) => {
                const site = this.sealSite(0, edge, row, 0);
                if (site) this.layStripe(site.record, codes, site.at, site.tag);
            });
        }
        if (this.tex?.record) this.tex.record.needsUpdate = true;
    }

    /**
     * The eye's widening (§3.9) grows away from the card: the basin scales its field about an
     * anchor 0.9 radii from the vent toward the card (on screen), so the card's side of the pool
     * hardly moves while the far side spreads. Returns how far the eye may widen (a fraction, as
     * eyeHeat's) before its water (the pool's edge with its lobes, 1.06 radii) comes within 0.02
     * of the screen of the card, and writes the anchor into the basin. Cached per layout.
     */
    eyeHeatCap() {
        const card = cardUnion(this.layout);
        const [ex, , ez] = this.plan.eye;
        const key = card
            ? `${this.aspect}|${card.x0}|${card.y0}|${card.x1}|${card.y1}|${ex}|${ez}`
            : `none|${ex}|${ez}`;
        if (this.heatCapKey === key) return this.heatCap;
        const { rig } = this.plan;
        let ax = ex;
        let az = ez;
        let cap = 0.5;
        const eye = projectToScreen(rig, this.aspect, [ex, 0, ez]);
        if (card && eye) {
            // Toward the card on screen: its nearest point at the eye's height (or above it).
            const tx = Math.max(card.x0, Math.min(card.x1, eye[0]));
            const ty = Math.max(card.y0, Math.min(card.y1, eye[1]));
            const g = screenToGround(rig, this.aspect, tx, Math.max(ty, eye[1] - 0.2), 0);
            if (g) {
                const dx = g[0] - ex;
                const dz = g[2] - ez;
                const dl = Math.hypot(dx, dz) || 1;
                ax = ex + (dx / dl) * IRIS_RADIUS * 0.9;
                az = ez + (dz / dl) * IRIS_RADIUS * 0.9;
            }
            const margin = 0.02;
            const fits = (h) => {
                const R = IRIS_RADIUS * 1.06;
                for (let i = 0; i < 48; i++) {
                    const a = (i / 48) * TAU;
                    const px = ax + (ex + Math.cos(a) * R - ax) * (1 + h);
                    const pz = az + (ez + Math.sin(a) * R - az) * (1 + h);
                    const p = projectToScreen(rig, this.aspect, [px, 0, pz]);
                    if (p && p[1] > card.y0 - margin && p[1] < card.y1 + margin
                        && p[0] > card.x0 - margin && p[0] < card.x1 + margin) return false;
                }
                return true;
            };
            // Where the composition already tucks the pool's edge under the card (upright), the
            // widening is left alone: it no longer moves that edge.
            if (fits(0) && !fits(0.5)) {
                let lo = 0;
                let hi = 0.5;
                for (let i = 0; i < 12; i++) {
                    const m = (lo + hi) / 2;
                    if (fits(m)) lo = m;
                    else hi = m;
                }
                cap = lo;
            }
        }
        this.parts.basin?.setHeatAnchor?.(ax, az);
        this.heatAnchor = [ax, az];
        this.heatCapKey = key;
        this.heatCap = cap;
        return cap;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        this.phase = (this.phase + dt) % CLOCK_WRAP;

        // ── The session and the season clock where no level comes ──
        this.lockRate *= Math.exp(-dt / RATE_TAU);
        // ── The year: the wheel turns with the clock, a level-up a step more ──
        this.placeWheel(t);

        // ── How hot play runs (sampled once a frame, after this frame's events) ──
        const surge = this.surge.sample(t);
        this.surgeLevel = surge.level;
        this.surgeFever = surge.fever;
        this.surgeStage = surge.stage;
        this.surgePunch = surge.punch;
        const { level: hot, fever } = surge;
        // The spouters' own clock: it runs faster the hotter play runs.
        this.spoutClock += dt * (1 + 0.9 * hot + 1.1 * fever);
        // Hot play: the fumaroles across the basin chuff together, more often in a fever.
        if (surge.stage >= STAGE_HOT) {
            const every = surge.stage >= STAGE_FEVER ? CHUFF_EVERY.fever : CHUFF_EVERY.hot;
            if (t - this.sympathyAt > every) this.sympathyAt = t;
        }

        // ── The gauges ──
        const heat = this.held.heat !== null ? clamp01(this.held.heat) : null;
        // The eye never widens under the card: its heat stops 0.02 of the screen short of it. A
        // fever keeps it widening past the chain's own cap.
        const heatTarget = Math.min(
            heat !== null ? heat * 0.5 : eyeHeat(this.combo, this.level) + 0.1 * fever,
            this.eyeHeatCap(),
        );
        this.heat += (heatTarget - this.heat) * approach(this.combo > 0 || fever > 0.05 ? 3 : 1 / 4, dt);
        // (a fever pushes the fingers' wet front a notch and a half past the chain's last)
        const reachTarget = heat !== null ? 1 + heat * 0.96 : fingerReach(this.combo) + 0.18 * fever;
        // The fronts push out at once a link, and drain back notch by notch over about 12 s.
        this.reach += (reachTarget - this.reach) * approach(reachTarget > this.reach ? 4 : 1 / 3, dt);
        // The living bands brighten with the heat of play (colour, never light), and a four or a
        // perfect clear lifts them further; a fever holds them near the cap.
        const p = this.perfect;
        let vividTarget = 1 + 0.08 * hot + 0.12 * fever;
        if (t - p.fedAt < 22) vividTarget = 1.25;
        else if (t - this.quad.kickAt < 6) vividTarget = Math.max(vividTarget, 1.18);
        this.vivid += (vividTarget - this.vivid) * approach(1 / VIVID_TAU, dt);

        // ── Weather ──
        const breath = this.held.breath !== null ? clamp01(this.held.breath) : breathAt(t);
        const wind = windAt(t, this._wind);
        u.breath.value = breath;
        // The basin boils harder under hot play: more steam off every vent and pool.
        u.steam.value = steamForBreath(breath) * this.seasonValue('steam') * (1 - 0.45 * (this.drained || 0))
            * (1 + 0.14 * hot + 0.2 * fever);
        const heading = WIND_HEADING + wind.angle; // the breeze leans the steam to the right
        u.windDir.value.set(Math.cos(heading), Math.sin(heading));
        u.windSpeed.value = wind.speed;
        if (this.held.gust !== null) {
            this._gust.phase = clamp01(this.held.gust);
            this._gust.seed = 0.37;
        } else gustAt(t, this._gust);
        u.gust.value.set(this._gust.phase, this._gust.seed);
        u.veil.value = VEIL[this.quality] ?? 1;

        // ── The season's air, crossfaded by the succession front, and the front on the ground ──
        this.writeSeasonAir(t);
        this.writeColumns(t);
        this.writeBlooms(t);
        this.writeFills(t);
        this.writeDevils(t);
        this.writeBursts(t);
        this.writeSteamOverrides(t);
        // The Chalice drains at a game over and refills with the next run.
        const drainTarget = this.drain.at > this.drain.refillAt ? 1 : 0;
        this.drained += (drainTarget - this.drained) * approach(drainTarget ? 1 / 2.5 : 1 / 1.2, dt);
        u.drain.value = this.drained;
        // The Consort's mound darkens wet while its chain lives, and dries over ~8 s after.
        this.consortWet += ((this.b2b > 0 ? 1 : 0) - this.consortWet) * approach(this.b2b > 0 ? 1 / 0.7 : 1 / 8, dt);
        u.consortWet.value = this.consortWet;
        u.seasonFrom.value = this.wheelFrom;
        u.seasonTo.value = this.wheel;
        const sweep = this.seasonSweepAt(t);
        let frontR = this.front.from === this.front.to ? 1e6 : frontRadiusAt(sweep);
        // A perfect clear sends a renewal wave out from the Iris along the fingers (the season
        // unchanged: only the front's glowing edge and the vivid wake behind it show).
        const renewAge = t - p.renewAt - RENEW.delay;
        const renewing = frontR > 1e5 && renewAge >= 0 && renewAge < RENEW.sweep;
        if (renewing) frontR = frontRadiusAt(renewAge / RENEW.sweep);
        if (renewing) u.frontTint.value.set(0.45, 0.95, 0.9);
        else u.frontTint.value.set(1.0, 0.55, 0.16);
        u.frontRadius.value = frontR;
        u.heat.value = this.heat;
        u.reach.value = this.reach;

        // ── The sun: eased toward the solution, never while an eruption is live ──
        const erupting = t - this.quad.kickAt < 20;
        if (!erupting) {
            const k = approach(1 / SUN_TAU, dt);
            this.sunNow.azimuth += (this.sunTarget.azimuth - this.sunNow.azimuth) * k;
            this.sunNow.elevation += (this.sunTarget.elevation - this.sunNow.elevation) * k;
        }
        if (this.held.sunAz !== null) this.sunNow.azimuth = this.held.sunAz;
        if (this.held.sunEl !== null) this.sunNow.elevation = this.held.sunEl;
        const frame = rigFrame(this.plan.rig);
        const sun = sunVector(
            this.sunNow.azimuth,
            this.sunNow.elevation,
            frame.forward[0],
            frame.forward[2],
            this.mirrored,
            this._sun,
        );
        u.sunDir.value.set(sun[0], sun[1], sun[2]);
        u.time.value = this.phase;

        // What follows the camera: its own frame for the backdrop.
        if (camera) {
            const e = camera.matrixWorld.elements;
            u.camPos.value.set(e[12], e[13], e[14]);
            u.camRight.value.set(e[0], e[1], e[2]);
            u.camUp.value.set(e[4], e[5], e[6]);
            u.camFwd.value.set(-e[8], -e[9], -e[10]);
            const tanV = Math.tan((camera.fov * DEG) / 2);
            u.tanHalf.value.set(tanV * (camera.aspect || this.aspect), tanV);
        }
        // The steam bodies, sorted by the camera just placed.
        this.writeVapour(t);

        // ── Post ──
        const post = this._post;
        // The springs sigh at a game over: the light dims a little until the next run.
        post.exposure = 1 - 0.12 * (this.drained || 0);
        post.iris = 1;
        post.sat = this.seasonValue('sat');
        post.vivid = this.vivid;
        // A perfect clear: the light itself swells for a few seconds (the bloom, never the
        // exposure), as the Sleeper wakes (a second one holds it).
        const pAge = t - p.at;
        post.bloomBoost = pAge >= 0 && t - p.fedAt < 10
            ? 0.9 * smooth(0.6, 2.0, pAge) * (1 - smooth(5, 10, t - p.fedAt)) : 0;
        u.iris.value = 1 / post.iris;
        this.writeShimmer();
    }

    // ── The vapour ──────────────────────────────────────────────────────────────

    /**
     * Every steam body the post's march draws this frame (thermal-bloom-vapour.js), near to far:
     * the Iris's dome and the Chalice's thread at rest, and whatever the events have raised.
     * Pooled objects, so a frame allocates nothing.
     */
    writeVapour(t) {
        const { u, plan } = this;
        if (!u?.tables?.vapour) return;
        if (!this._vapourPool) {
            this._vapourPool = Array.from({ length: VAPOUR_SLOTS * 3 }, () => ({
                x: 0,
                y: 0,
                z: 0,
                h: 0,
                r0: 0,
                r1: 0,
                density: 0,
                lean: 0,
                rise: 0,
                drift: new Float32Array(DRIFT.nodes * 2),
                ur: 0,
                ug: 0,
                ub: 0,
                code: 0,
                key: 0,
                pri: 0,
                order: 0,
            }));
            this._vapourList = [];
        }
        const list = this._vapourList;
        list.length = 0;
        const pool = this._vapourPool;
        const cam = u.camPos.value;
        // The breeze's run back from now: every trailing column's bend is read from it.
        this._windRun = windRunTable(this.time, this._windRun);
        const run = this._windRun;
        const centre = this._centre || (this._centre = [0, 0]);
        centre[0] = u.irisCentre.value.x;
        centre[1] = u.irisCentre.value.y;
        const gustPhase = u.gust.value.x;
        /**
         * One body (kind, seed, foot, height, radii, density, lean, the light from below, and how
         * fast its billows climb in m/s: RISE unless given). A plume trails its vent: its axis bends
         * with the wind's history; any other body leans as one.
         */
        const add = (kind, seed, x, y, z, h, r0, r1, density, lean, under = null, rise = VAPOUR_RISE) => {
            if (!(density > 1e-3) || !(h > 0.2) || list.length >= pool.length) return;
            const b = pool[list.length];
            b.rise = rise;
            if (kind === VAPOUR_KIND.plume) plumeDrift(this.time, x, z, h, riseForLean(lean), run, centre, b.drift);
            else rigidDrift(this.time, x, z, h, lean, centre, gustPhase, b.drift);
            b.x = x;
            b.y = y;
            b.z = z;
            b.h = h;
            b.r0 = r0;
            b.r1 = r1;
            b.density = density;
            b.lean = lean;
            b.ur = under ? under[0] : 0;
            b.ug = under ? under[1] : 0;
            b.ub = under ? under[2] : 0;
            b.code = vapourCode(kind, seed);
            b.key = Math.hypot(x - cam.x, y + h * 0.5 - cam.y, z - cam.z) - Math.max(r0, r1) * 0.5;
            // The basin's own steam first, then the eruptions, then the events (the densest
            // first: under fast play what gives way is what has nearly thinned away already, never
            // a body in its prime, so the march sheds steam by fading it, not by cutting it).
            b.pri = this._vapourPri;
            b.order = list.length;
            list.push(b);
        };
        this._vapourPri = 0;
        this.vapourSources(t, add, plan);
        if (list.length > VAPOUR_SLOTS) {
            list.sort((a, b) => a.pri - b.pri || b.density - a.density || b.order - a.order);
            list.length = VAPOUR_SLOTS;
        }
        list.sort((a, b) => a.key - b.key);
        const rows = u.tables.vapour;
        const n = Math.min(VAPOUR_SLOTS, list.length);
        for (let i = 0; i < n; i++) {
            const b = list[i];
            const o = i * VAPOUR_ROWS_PER;
            rows[o].set(b.x, b.y, b.z, b.h);
            rows[o + 1].set(b.r0, b.r1, b.density, b.rise);
            rows[o + 2].set(b.ur, b.ug, b.ub, b.code);
            const d = b.drift;
            rows[o + 3].set(d[0], d[1], d[2], d[3]);
            rows[o + 4].set(d[4], d[5], d[6], d[7]);
            rows[o + 5].set(d[8], d[9], d[10], d[11]);
        }
        u.vapourCount.value = n;
    }

    /** The bodies at rest and the events' (see writeVapour). */
    vapourSources(t, add, plan) {
        const { u } = this;
        const steam = u.steam.value;
        const [ex, , ez] = plan.eye;
        // How hard the basin boils with play (the surge): 0 at rest.
        const play = this.surgeLevel;
        const { surgeFever: fever } = this;
        const boil = 0.15 * play + 0.4 * fever;
        // The Iris's dome: a heap of steam as wide as the pool's skirts, leaning with the wind,
        // lit turquoise over the water and apricot over the mats (the shader's own underlight);
        // it heaps higher and thicker as the basin boils.
        add(
            VAPOUR_KIND.dome,
            3,
            ex,
            0,
            ez,
            50 * (1 + 0.3 * play + 0.6 * fever),
            IRIS_RADIUS * 1.12,
            IRIS_RADIUS * 0.95,
            0.2 * steam * (1 + 0.5 * play + 0.9 * fever),
            0.16,
        );
        // The Chalice's thread off its vent, swelling a little with the breath.
        const [cx, cy, cz] = plan.chalice;
        const vent = cy + CHALICE.height - 0.8;
        const now = this.chaliceNow;
        // The thread, swelling into the steam phases: a broken chain's exhalation, the four
        // lines' towering white column after its water, the idle eruption's (writeColumns grows
        // them: how far, how dense still, how big).
        const grown = now ? now.grown : 0;
        const size = now ? now.size : 0;
        const dense = now ? now.dense : 0;
        // While a tall column of water stands the thread steps aside (it would veil the jet).
        const jetUp = now && now.height > 4 ? smooth(4, 20, now.height) * (now.fall > 0 ? 1 - now.fall : 1) : 0;
        add(
            VAPOUR_KIND.plume,
            7,
            cx,
            vent,
            cz,
            lerp(42, 120 + 90 * size, grown),
            lerp(1.6, 7 + 12 * size, grown),
            lerp(8.5, 26 + 48 * size, grown),
            lerp(1.1 * steam, 1.5 + 0.5 * size, dense) * lerp(1, 0.35, Math.max(0, grown - dense))
                * (1 - this.drained * 0.85) * (1 - 0.85 * jetUp),
            lerp(0.11, 0.2, grown),
            null,
            riseForLean(lerp(0.11, 0.2, grown)) * 0.7,
        );
        // The Stair's hot upper pools breathe low wisps of steam (the water cools as it steps down).
        {
            const top = u.stairTop.value;
            const down = u.stairDown.value;
            const { terraces } = this.parts;
            [10, 24, 40].forEach((along, k) => {
                const x = top.x + down.x * along;
                const z = top.y + down.y * along;
                const y = terraces?.heightAt ? terraces.heightAt(x, z) : 6;
                const warmth = 1 - k * 0.3;
                add(
                    VAPOUR_KIND.plume,
                    33 + k,
                    x,
                    y - 0.5,
                    z,
                    16 + 6 * warmth,
                    6,
                    13,
                    0.4 * steam * warmth * (1 + 0.5 * fever),
                    0.22,
                    [0.04 * warmth, 0.42 * warmth, 0.5 * warmth],
                );
            });
        }
        // The far columns: every vent's steam across the basin, each its own lean and billows (the
        // sheets stand down while the march draws them).
        // At a perfect clear every vent across the basin swells in sympathy, near to far (grown
        // from the Sleeper's waking, thinning from the latest perfect clear). Under hot play every
        // vent swells with the basin's boil, and in a fever their feet glow apricot off the mats.
        const pr = this.perfect;
        const perfectAge = t - pr.at;
        const perfectLate = t - pr.fedAt;
        const camX = u.camPos.value.x;
        const camZ = u.camPos.value.z;
        (this.plumes || []).forEach((p, i) => {
            if (p.kind !== PLUME_KIND.column) return;
            const seed = (i * 13 + 5) % 64;
            const lean = 0.06 + 0.06 * ((i * 0.618) % 1);
            const delay = Math.hypot(p.x - camX, p.z - camZ) / 900;
            const sym = perfectAge >= 0 && perfectLate < 22
                ? smooth(0.6 + delay, 2.4 + delay, perfectAge) * (1 - smooth(14, 22, perfectLate)) : 0;
            // Every third vent breathes a broad low bank drifting off the flats, not a column.
            const bank = i % 3 === 1;
            const glow = sym > 0 || fever > 0.01;
            add(
                VAPOUR_KIND.plume,
                seed,
                p.x,
                p.base,
                p.z,
                p.height * (bank ? 0.42 : 1) * (1 + 0.9 * sym + boil),
                p.r0 * (bank ? 2.6 : 0.7 + 0.5 * sym + 0.15 * boil),
                p.r1 * (bank ? 2.0 : 0.9 + 0.6 * sym + 0.3 * boil),
                0.55 * p.density * steam * (bank ? 0.7 : 1) * (1 + 0.5 * sym + 0.35 * boil),
                bank ? lean * 2.5 : lean,
                glow ? [0.5 * sym + 0.3 * fever, 0.42 * sym + 0.19 * fever, 0.3 * sym + 0.09 * fever] : null,
                // Their billows climb with their puffs: a far column visibly breathes upward.
                riseForLean(bank ? lean * 2.5 : lean) * 0.7,
            );
        });
        // The Sleeper (§3.12): woken by a perfect clear, a towering column on the far rim, its
        // steam rolling up through the sky band, lit warm by the low sun.
        if (perfectAge >= 0 && perfectLate < 30) {
            const [sx, sy, sz] = plan.sleeper;
            const k = smooth(0.8, 3.2, perfectAge);
            const grow = smooth(0.8, 10, perfectAge);
            const thin = 1 - smooth(16, 30, perfectLate);
            // (its steam holds back while the water stands, so the column reads as a jet; then it
            // billows up as the water falls back)
            const steamUp = 0.06 + 0.94 * smooth(6, 10, perfectAge);
            add(
                VAPOUR_KIND.plume,
                61,
                sx,
                sy - 2,
                sz,
                200 + 320 * grow,
                22 + 16 * grow,
                70 + 150 * grow,
                2.2 * k * thin * steamUp,
                0.22,
                [0.55 * k, 0.45 * k, 0.34 * k],
            );
            if (perfectAge < 9) {
                const sprayH = 160 * smooth(0.8, 2.4, perfectAge);
                add(VAPOUR_KIND.spray, 62, sx, sy, sz, sprayH, 20, 50, 0.7 * k * (1 - smooth(6, 9, perfectAge)), 0.05);
            }
        }
        // The Consort (§3.5): while a back-to-back chain lives, a standing column over its pool,
        // taller with the level, lit turquoise from below; it thins away when the chain breaks.
        {
            const level = this.b2b > 0 ? this.b2b : (this._consortLevel || 1);
            const stand = this.consortStand(t);
            // (it heaps up with each back-to-back clear's burst off its pool, then settles back)
            const K = this.consortKick;
            const burst = t >= K.at && t - K.end < 3
                ? smooth(0, 0.6, t - K.at) * (1 - smooth(0, 3, t - K.end))
                    * Math.min(1.6, K.peak(t) / CONSORT_KICK.height)
                : 0;
            const shown = Math.max(stand, 0.7 * Math.min(1, burst));
            if (shown > 0.01) {
                const [ox, oy, oz] = plan.consort;
                const glow = shown * 1.2 * (1 + 0.5 * burst);
                add(
                    VAPOUR_KIND.plume,
                    57,
                    ox,
                    oy,
                    oz,
                    (45 + 25 * level) * (0.6 + 0.4 * shown) * (1 + 0.3 * burst),
                    5,
                    (16 + 6 * level) * (1 + 0.2 * burst),
                    1.7 * shown,
                    0.12,
                    // (its pool's turquoise under it, soft: at full strength the stem read neon)
                    [0.1 * glow, 0.62 * glow, 0.7 * glow],
                );
            }
        }
        this._vapourPri = 1;
        if (now && now.height > 2.5) {
            // The column's spray veil: a cloud of drops round the water, widest round its crown,
            // falling back as rain at the fall-back (the bow lives in it).
            const h = now.height;
            const rain = now.fall > 0 ? 1 - smooth(0.6, 1, now.fall) : 1;
            add(
                VAPOUR_KIND.spray,
                41,
                cx,
                vent,
                cz,
                h * 1.12,
                now.radius * 1.4,
                now.radius * 2.6 + h * 0.16,
                0.5 * rain * smooth(2.5, 8, h),
                0.04,
            );
            // The vent's churning skirt of steam, a low ring flaring round the water's foot (the
            // jet itself stays clear above it).
            add(
                VAPOUR_KIND.puff,
                43,
                cx,
                vent - 2,
                cz,
                5 + now.radius * 0.9,
                now.radius * 1.8,
                now.radius * 2.8,
                0.6 * smooth(2.5, 10, h) * rain,
                0.12,
                [0.3, 0.22, 0.14],
            );
        }
        this._vapourPri = 2;
        // The Seal: as each new lip sets and its pool fills, a curtain of steam lifts off the
        // rim (two puffs along it), lit from below by the pool's turquoise, and drifts away.
        this.fills.forEach((f, i) => {
            const a = t - f.start;
            if (!(a >= 0.2) || a > 4.5) return;
            const c = f.cell;
            const y = f.side === 1 && this.parts.terraces?.heightAt ? this.parts.terraces.heightAt(f.x, f.z) : 0;
            // Along the rim: across the Stair, or round the Iris.
            let rx;
            let rz;
            if (f.side === 1) {
                rx = u.stairDown.value.y;
                rz = -u.stairDown.value.x;
            } else {
                const dx = f.x - u.irisCentre.value.x;
                const dz = f.z - u.irisCentre.value.y;
                const dl = Math.hypot(dx, dz) || 1;
                rx = -dz / dl;
                rz = dx / dl;
            }
            const g = 1 - Math.exp(-(a - 0.2) / 0.6);
            const glow = 2.2 * (1 - smooth(0.6, 3.5, a));
            const under = [0.12 * glow, 0.75 * glow, 0.85 * glow];
            const dens = 1.25 * smooth(0.2, 0.5, a) * (1 - smooth(2.2, 4.5, a));
            // A curtain: four narrow plumes side by side along the rim, rising as one sheet.
            for (let k = 0; k < 4; k++) {
                const off = c * 1.45 * (k - 1.5);
                add(
                    VAPOUR_KIND.plume,
                    (47 + i * 5 + k) % 64,
                    f.x + rx * off,
                    y + c * 0.7 * Math.max(0, a - 1.4),
                    f.z + rz * off,
                    c * (2.4 + 5.2 * g) * (0.85 + 0.3 * ((k * 0.618) % 1)),
                    c * 0.9,
                    c * (1.5 + 0.9 * g),
                    dens,
                    0.12,
                    under,
                );
            }
        });
        // The chain's ladder: a rung a link up the card's sides, each a short white column of
        // steam over its fountain, its foot lit by the heat of the link that opened it (turquoise
        // at the bottom to white-hot at the top); when the chain breaks each column leans and
        // shears downwind and rolls away as a puff.
        if (this.ladder.length) {
            const chain = this.ladderChain(t);
            const heat = ThermalBloomWorld.heatColour(chain, this._heatVap || (this._heatVap = [0, 0, 0]));
            // Past six links the rungs grow taller together (the chain's heat rising), and from
            // nine their feet burn white.
            // (a fever keeps them climbing past the chain's own count, white-hot)
            const tower = Math.max(0, chain - 6) + 2.5 * this.surgeFever;
            const whiteHot = Math.max(smooth(8, 10, chain), 0.8 * this.surgeFever);
            this.ladder.forEach((v, i) => {
                const a = t - v.start;
                if (!(a >= 0)) return;
                // (a vent the break has not reached yet still stands: the thermometer cools from the top)
                const blown = v.out > v.start && t >= v.out;
                const since = blown ? t - v.out : 0;
                const c = v.cell;
                const g = 1 - Math.exp(-a / 0.35);
                // Each rung by its own link: the later ones taller and brighter (beating the
                // perspective that shrinks the rows nearer the card's top).
                const rung = Math.max(0, (v.link || 2) - 2);
                const glow = 2.6 + 0.35 * rung + 2.4 * whiteHot;
                const vc = v.rgb || heat;
                const under = [vc[0] * glow, vc[1] * glow, vc[2] * glow];
                if (a < 0.6) {
                    // The rung opens with a flash: a bright puff off its spring.
                    const fl = 1 - smooth(0.1, 0.6, a);
                    add(
                        VAPOUR_KIND.puff,
                        (41 + i * 3) % 64,
                        v.x,
                        v.y,
                        v.z,
                        c * (1.6 + 1.4 * smooth(0, 0.4, a)),
                        c * 0.9,
                        c * 1.5,
                        1.6 * fl,
                        0.1,
                        [vc[0] * 7 * fl, vc[1] * 7 * fl, vc[2] * 7 * fl],
                    );
                }
                if (!blown || since < 0.9) {
                    // The break lifts the column off its vent before it goes.
                    const lift = blown ? c * 3.5 * smooth(0, 0.9, since) : 0;
                    add(
                        VAPOUR_KIND.plume,
                        (11 + i * 5) % 64,
                        v.x,
                        v.y + lift,
                        v.z,
                        c * (2.4 + 0.42 * rung + 0.8 * tower) * g,
                        c * 0.45,
                        c * (1.2 + 0.1 * rung + 0.12 * tower),
                        1.9 * smooth(0, 0.2, a) * (1 - smooth(0.15, 0.9, since)),
                        0.06,
                        under,
                    );
                }
                if (blown && since < 2.8) {
                    // Each column rolls off as a big white puff, lit by its heat, away from the
                    // card on screen and up.
                    const gp = 1 - Math.exp(-since / 0.35);
                    const away = -(v.toCard || 1);
                    const rx = u.camRight.value.x * away;
                    const rz = u.camRight.value.z * away;
                    add(
                        VAPOUR_KIND.puff,
                        (29 + i * 7) % 64,
                        v.x + rx * since * c * 2.2,
                        v.y + c * (1.2 + since * 2.6),
                        v.z + rz * since * c * 2.2,
                        c * (3.5 + 4.5 * gp),
                        c * (1.8 + 2.4 * gp),
                        c * (2.8 + 3.6 * gp),
                        1.5 * smooth(0.02, 0.25, since) * (1 - smooth(1.4, 2.8, since)),
                        0.25,
                        [under[0] * 0.5, under[1] * 0.5, under[2] * 0.5],
                    );
                }
            });
        }
        // The T-spin's devils: slender spinning columns off the Iris, their skirts lit from below by
        // the bands they cross (turquoise core, apricot hem), fading in at birth and out at the end.
        this.devils.forEach((d, i) => {
            const a = t - d.start;
            if (!(a >= 0) || a > d.life || d.x === undefined) return;
            const fade = smooth(0, 0.6, a) * (1 - smooth(d.life - 1.2, d.life, a));
            add(
                VAPOUR_KIND.devil,
                (53 + i * 3) % 64,
                d.x,
                0,
                d.z,
                d.height * (0.6 + 0.4 * smooth(0, 1.2, a)),
                d.radius * 0.7,
                d.radius * 2.0,
                3.0 * fade,
                0.04,
                [0.5 * fade, 0.55 * fade, 0.45 * fade],
            );
            // Its foot whips the water into a skirt of spray.
            add(
                VAPOUR_KIND.puff,
                (55 + i * 3) % 64,
                d.x,
                -1,
                d.z,
                d.radius * 1.6,
                d.radius * 1.5,
                d.radius * 2.6,
                1.4 * fade,
                0.04,
                [0.05 * fade, 0.35 * fade, 0.42 * fade],
            );
        });
        // The fresh springs keep breathing: a thin wisp off each of the newest while it is hot,
        // lit in the piece's colour.
        for (let i = this.blooms.length - 1, n = 0; i >= 0 && n < 4; i--) {
            const bl = this.blooms[i];
            const a = t - bl.start;
            const hot = 1 - smooth(bl.life * 0.12, bl.life * 0.3, a);
            if (!(a > 2.5) || !(hot > 0.02)) continue;
            n += 1;
            const y = bl.side === 1 && this.parts.terraces?.heightAt ? this.parts.terraces.heightAt(bl.x, bl.z) : 0;
            const c = bl.cell || 2;
            const glow = 1.4 * hot;
            add(
                VAPOUR_KIND.plume,
                (59 + i) % 64,
                bl.x,
                y,
                bl.z,
                c * 5,
                c * 0.5,
                c * 2.2,
                0.55 * hot * smooth(2.5, 4, a),
                0.12,
                [bl.rgb[0] * glow, bl.rgb[1] * glow, bl.rgb[2] * glow],
            );
        }
        // The locks' boil-overs: a puff of steam swelling off each, lit from below by the piece's
        // colour while the bloom is fresh, lifting off the ground and drifting downwind as it thins.
        this.boils.forEach((b) => {
            const a = t - b.start;
            const life = ThermalBloomWorld.boilLife(b);
            if (!(a >= 0) || a > life) return;
            const thinning = ThermalBloomWorld.boilThin(b, t);
            if (!(thinning > 0.001)) return;
            const c = b.cell * (b.hard ? 1.3 : 1);
            const slim = b.narrow ? 0.4 : 1;
            const g = 1 - Math.exp(-a / 0.9);
            const glow = 4.5 * (1 - smooth(0.4, 4.5, a)) * thinning;
            const under = [b.rgb[0] * glow, b.rgb[1] * glow, b.rgb[2] * glow];
            const density = 1.5 * smooth(0, 0.15, a) * (1 - smooth(life * 0.4, life, a)) * thinning;
            // A plume off the new spring: it shoots up out of the boil-over in a second, billowing
            // as it climbs, sheared downwind, its foot lit in the piece's colour; then it lifts
            // off the ground and thins.
            if (a < 1.4) {
                const gr = 1 - Math.exp(-a / 0.3);
                add(
                    VAPOUR_KIND.puff,
                    (b.seed + 31) % 64,
                    b.x,
                    b.y - c * 0.2,
                    b.z,
                    c * (0.7 + 0.5 * gr),
                    c * (1.2 + 2.6 * gr) * slim,
                    c * (1.6 + 3.2 * gr) * slim,
                    1.3 * smooth(0, 0.08, a) * (1 - smooth(0.5, 1.4, a)) * thinning,
                    0.05,
                    [under[0] * 0.5, under[1] * 0.5, under[2] * 0.5],
                );
            }
            const lift = c * 0.9 * Math.max(0, a - 1.6);
            const tall = c * (3.4 + 11.5 * g);
            add(
                VAPOUR_KIND.plume,
                b.seed,
                b.x,
                b.y + lift + c * 0.25,
                b.z,
                tall,
                c * 0.4 * slim,
                c * (2.6 + 3.2 * g) * slim,
                density,
                0.05,
                under,
            );
            if (b.hard) {
                // The plunge's jet of steam, shot up with the drops.
                const gj = 1 - Math.exp(-a / 0.35);
                const dj = 1.3 * smooth(0, 0.1, a) * (1 - smooth(1.2, 3.5, a)) * thinning;
                add(
                    VAPOUR_KIND.plume,
                    (b.seed + 17) % 64,
                    b.x,
                    b.y,
                    b.z,
                    c * (6 + (10 + 8 * b.drop) * gj),
                    c * 0.7 * slim,
                    c * 2.4 * slim,
                    dj,
                    0.08,
                    // (a tall jet: its foot's colour faint, or a quarter of it reads as a pink pole)
                    [under[0] * 0.3, under[1] * 0.3, under[2] * 0.3],
                );
            }
        });
    }

    /** The season's sky, haze, rim and sun, crossfaded over the succession front's sweep. */
    writeSeasonAir(t) {
        const { u } = this;
        const k = smooth(0, 1, this.seasonSweepAt(t));
        const pa = seasonPair(this.wheelFrom ?? this.wheel, this._pairA);
        const pb = seasonPair(this.wheel, this._pairB);
        /** A colour at the two wheel places, then across the front's sweep. */
        const set = (node, key) => {
            const a0 = this._seasonRgb[pa.a][key];
            const a1 = this._seasonRgb[pa.b][key];
            const b0 = this._seasonRgb[pb.a][key];
            const b1 = this._seasonRgb[pb.b][key];
            const c = [0, 1, 2].map((i) => lerp(lerp(a0[i], a1[i], pa.k), lerp(b0[i], b1[i], pb.k), k));
            node.value.set(c[0], c[1], c[2]);
        };
        set(u.zenith, 'zenith');
        set(u.haze, 'haze');
        set(u.rim, 'rim');
        set(u.meadow, 'meadow');
        set(u.sunColor, 'sun');
        // A low sun lights a level floor less: the light is raised to keep the mats in full colour.
        u.sunColor.value.multiplyScalar(SUN_GAIN);
        set(u.streamer, 'streamer');
        u.snow.value = this.seasonValue('snow', k);
        u.frost.value = this.seasonValue('frost', k);
        u.wetness.value = this.seasonValue('wet', k);
        u.streamerAmount.value = this.seasonValue('streamerAmount', k);
    }

    /**
     * A season's number where the wheel stands (both places blended, then across the front's
     * sweep `k`; without one, the place after it).
     */
    seasonValue(key, k = 1) {
        const pa = seasonPair(this.wheelFrom ?? this.wheel, this._pairA);
        const pb = seasonPair(this.wheel, this._pairB);
        const v = (i) => SEASONS[i][key] || 0;
        return lerp(lerp(v(pa.a), v(pa.b), pa.k), lerp(v(pb.a), v(pb.b), pb.k), k);
    }

    /** The heat-shimmer ellipses: the Iris and the Chalice's vent, projected (screen fractions). */
    writeShimmer() {
        const { plan } = this;
        const { rig } = plan;
        const eye = projectToScreen(rig, this.aspect, plan.eye);
        const rimPoint = projectToScreen(rig, this.aspect, [plan.eye[0] + IRIS_RADIUS, 0, plan.eye[2]]);
        const vent = projectToScreen(rig, this.aspect, [plan.chalice[0], plan.chalice[1] + 14, plan.chalice[2]]);
        const s = this._post.shimmer;
        if (eye && rimPoint) {
            const rx = Math.abs(rimPoint[0] - eye[0]) * 0.9;
            s[0][0] = eye[0];
            s[0][1] = eye[1] - rx * 0.12;
            s[0][2] = rx;
            s[0][3] = rx * 0.45 * this.aspect;
        } else s[0].fill(0);
        if (vent) {
            s[1][0] = vent[0];
            s[1][1] = vent[1];
            s[1][2] = 0.018;
            s[1][3] = 0.05;
        } else s[1].fill(0);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const t = this.time;
        return {
            quality: this.quality,
            time: t,
            level: this.level,
            season: SEASONS[this.season].name,
            seasonSweep: this.seasonSweepAt(t),
            seasonWheel: this.wheel,
            seasonOffset: this.seasonOffset,
            breath: this.u ? this.u.breath.value : null,
            gust: this._gust.phase,
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            heat: this.heat,
            reach: this.reach,
            lockRate: this.lockRate,
            records: this.records,
            surge: { level: this.surgeLevel, fever: this.surgeFever, stage: this.surgeStage },
            drained: this.drain.at > this.drain.refillAt,
            mirrored: this.mirrored,
            sun: {
                azimuth: this.sunNow.azimuth,
                elevation: this.sunNow.elevation,
                onColumn: this.sunTarget.onColumn,
            },
            anchors: this.plan.anchors,
            fov: fovForAspect(this.aspect),
            counts: { ...this.counts },
            parts: Object.keys(this.parts),
            layoutLive: this.layoutLive,
            reducedMotion: this.reducedMotion,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.dispose?.();
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.u = null;
        this._camera = null;
    }
}
