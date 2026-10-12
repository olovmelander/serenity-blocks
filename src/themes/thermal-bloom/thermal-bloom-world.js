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
 *
 * The parts are built from a registry (PART_BUILDERS); a part not built yet is simply absent.
 * Nothing is created at event time: events write numbers into preallocated state, so seek(t)
 * plus a fixed-step replay reproduces any frame. What moves at a changing rate is integrated;
 * everything else is closed form in the clock.
 */

import * as THREE from 'three/webgpu';
import {
    DEG,
    SEASONS,
    SEASON_CLOCK,
    TAU,
    approach,
    aspectWeights,
    breathAt,
    clamp01,
    composeWorld,
    createThermalBloomTexture,
    createThermalBloomUniforms,
    eyeHeat,
    fingerReach,
    gustAt,
    hexToLinear,
    lerp,
    pieceCode,
    projectToScreen,
    rigForAspect,
    seasonForLevel,
    smooth,
    solveSun,
    steamForBreath,
    steamPhaseLength,
    sunVector,
    visibleColumn,
    windAt,
    CHALICE,
    EVENT_ROWS,
    IDLE_STEAM,
    IDLE_WATER,
    IRIS_RADIUS,
    PLUME_KIND,
    bloomLife,
    chaliceSchedule,
    columnHeight,
    columnState,
    SPOUTER_BURBLE,
    screenToGround,
    FUMAROLES,
    fumarolePlan,
    jewelPlan,
    pinePlan,
    plumePlan,
    rigFrame,
    PIECE_CODE,
    PIECE_HEX,
    RECORD_RING0,
    RECORD_ROWS,
    EVENT_SLOTS,
    mulberry32,
    ERUPTIONS,
    preplayHeight,
} from './thermal-bloom-tsl.js';
import { tierFor } from './thermal-bloom-quality.js';
import { createSky } from './thermal-bloom-sky.js';
import { createBasin } from './thermal-bloom-basin.js';
import { createTerraces } from './thermal-bloom-terraces.js';
import { createMist, createSteam } from './thermal-bloom-steam.js';
import { createFumaroles } from './thermal-bloom-fumaroles.js';
import { createDevils } from './thermal-bloom-devils.js';
import {
    COLUMN_KIND, COLUMN_SLOT, createChalice, createColumns, createConsort, createSleeper, createSpray,
} from './thermal-bloom-geyser.js';
import { createPines } from './thermal-bloom-flora.js';
import { createMotes } from './thermal-bloom-motes.js';
import { bakeCellular, bakeNoise, bakeRamp } from './thermal-bloom-bake.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './thermal-bloom-composition.js';

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

/** The ghost pines and the near air's motes, as one part. */
function buildFlora(world) {
    const pines = createPines(world.u, world.tier.pines);
    const motes = createMotes(world.u, world.tier.motes);
    const group = new THREE.Group();
    group.name = 'ThermalBloomFloraGroup';
    group.add(pines.mesh);
    group.add(motes.mesh);
    return {
        mesh: group,
        pines,
        motes,
        setTrees: (trees) => pines.setTrees(trees),
        setVolume: (plan) => motes.setVolume(plan),
        dispose: () => {
            [pines, motes].forEach((p) => {
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
});

/** The analytic steam veil's strength per tier: the fewer the sheets, the more it carries. */
const VEIL = Object.freeze({ Minimal: 1.8, Low: 1.5, Medium: 1.2 });

/** How far the succession front sweeps (metres from the Iris): past every living band. */
const FRONT_REACH = 900;
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
/** The succession front's sweep (seconds), and the sun's easing toward a new solution (τ, s). */
const SEASON_SWEEP = 6;
const SUN_TAU = 2;
/** A session is live while a lock came in the last SESSION_LIVE seconds. */
const SESSION_LIVE = 20;
/** The lock-rate estimate's easing (seconds). */
const RATE_TAU = 10;
/** The vivid lift's time constant (seconds; photosensitivity: at least 0.4). */
const VIVID_TAU = 0.45;
/** Clocks wrap here (float precision in the shaders). */
const CLOCK_WRAP = 4096;

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
        scene, quality = 'High', capture = false, seed = 0x1b15,
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
            season: null, heat: null, breath: null, gust: null,
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
        /** The season's index, and the succession front sweeping from the old one. */
        this.season = 0;
        this.front = {
            from: 0, to: 0, start: -1e6, length: SEASON_SWEEP,
        };
        /** Seconds of live play since the season last turned (the clock where no level comes). */
        this.seasonClock = 0;
        /** A level-up was heard this session: the season follows the levels, not the clock. */
        this.levelsSeen = false;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.lastRelease = {
            at: -1e6, peak: 0, length: 0, sustained: 0,
        };
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
        const noise = bakeNoise(256, this.seed);
        const cellular = bakeCellular(256, 12, this.seed ^ 0x5e11);
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
        Object.values(tex).forEach((t) => this.textures.push(t));
        return tex;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). Unknown names are ignored. */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = keep.has(name);
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
        // The two least important far columns (the last in the plan's priority) lend their slots.
        const far = plumes.slice(2, slots);
        this.spareSlots = far.slice(-2).reverse().map((p) => order.indexOf(p)).filter((i) => i >= 0);
        this.threadBase = this.threadSlot >= 0
            ? { height: order[this.threadSlot].height, r1: order[this.threadSlot].r1 } : { height: 0, r1: 0 };
        steam?.place(plan.eye[0], plan.eye[2]);
    }

    /**
     * The eruption columns' rows from the closed-form schedules: the Chalice's idle cycle and its
     * preplay splashes, the spouters; the Consort's and the Sleeper's slots stay dormant until
     * their events (stage B). Each row pair is (x, z, base, height) and (radius, fall, flare,
     * kind): through the fall-back the crown keeps its height and `fall` runs 0 → 1 (the column
     * empties from the base up and rains from the crown). After the Chalice's water, its steam
     * thread thickens for the steam phase.
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
        let radius = 1.8;
        let flare = 0.7;
        const C = this.lastClear;
        const quadAge = C.lines >= 4 && !C.perfect ? t - C.at : -1;
        const q = ERUPTIONS.quad;
        const quadLive = quadAge >= 0 && quadAge < q.delay + q.rise + q.hold + q.fall;
        const linkAge = t - this.lastLinkAt;
        const releaseAge = t - this.lastRelease.at;
        // Full idle eruptions run only in menus or after a minute with no events (§3.9); while a
        // session is live the Chalice keeps to its preplay splashes.
        const quiet = !this.layoutLive || t - this.lastEventAt > 60;
        const idleAge = quiet ? sched.eruptionAge : -1;
        if (quadLive) {
            // Four lines (§3.10): the surge, then the column to 90 m, then the fall-back as rain.
            columnState('quad', quadAge, undefined, state);
            radius = 4.2;
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
        } else if (this.combo >= 2 && linkAge < 1.6) {
            // One burst a link, so the count reads as splashes (§3.9 gauge 1).
            columnState('preplay', linkAge, preplayHeight(this.combo), state);
            radius = this.combo >= 4 ? 1.6 : 0.9;
            flare = 0.9;
        } else if (idleAge >= 0) {
            columnState('idle', idleAge, undefined, state);
        } else if (sched.preplayAge >= 0) {
            // A cluster of 2–4 splashes, each about a second apart.
            const k = Math.floor(sched.preplayAge / 1.2);
            if (k < sched.splashes) {
                columnState('preplay', sched.preplayAge - k * 1.2, 2 + 2 * sched.preplaySeed, state);
            }
            radius = 0.9;
            flare = 0.9;
        }
        set(COLUMN_SLOT.chalice, cx, cz, vent, state.height, radius, flare, COLUMN_KIND.water, state.fall);
        // The Consort (§3.5): splashes while a back-to-back chain lives (2–4 m every 3–5 s, then
        // 4–8 m, then a steady 10 m fountain); with four lines, the double eruption.
        const [ox, oy, oz] = plan.consort;
        const cs = this._consort || (this._consort = { height: 0, fall: 0 });
        cs.height = 0;
        cs.fall = 0;
        if (quadLive && this.b2b > 0) {
            columnState('consort', quadAge, undefined, cs);
        } else if (this.b2b >= 3) {
            columnState('combo', t - this.b2bAt, 10, cs);
        } else if (this.b2b > 0) {
            const period = 4 - this.b2b * 0.5;
            columnState('preplay', t % period, this.b2b === 1 ? 3 : 6, cs);
        }
        const consortR = this.b2b > 0 && quadLive ? 2.6 : 0.8;
        set(COLUMN_SLOT.consort, ox, oz, oy + 0.2, cs.height, consortR, 0.9, COLUMN_KIND.water, cs.fall);
        // The Sleeper (§3.12): a perfect clear wakes its 150 m column.
        const [sx, sy, sz] = plan.sleeper;
        const sl = this._sleeper || (this._sleeper = { height: 0, fall: 0 });
        sl.height = 0;
        sl.fall = 0;
        if (C.perfect) columnState('sleeper', t - C.at, undefined, sl);
        set(COLUMN_SLOT.sleeper, sx, sz, sy - 1, sl.height, 6.5, 1.4, COLUMN_KIND.water, sl.fall);
        // The spouters: a constant burble with a pulse on each one's own period.
        const spouts = this.parts.geyser?.spouts;
        SPOUTERS.forEach((sp, i) => {
            const mirror = this.mirrored ? -1 : 1;
            const spot = spouts?.[i] || [cx + sp.lx * mirror, cy - 6, cz + sp.lz];
            const age = (t + sp.phase) % sp.period;
            const burble = SPOUTER_BURBLE * (0.85 + 0.2 * Math.sin(t * 5.3 + i * 2.1) + 0.12 * Math.sin(t * 8.9 + i));
            const sym = quadLive ? columnHeight('spouter', quadAge - 0.6 - i * 0.95, 6 + 2 * i) : 0;
            set(
                COLUMN_SLOT.spouter0 + i,
                spot[0],
                spot[2],
                spot[1] - 0.1,
                Math.max(burble, columnHeight('spouter', age), sym),
                sym > 2 ? 0.45 : 0.2,
                0.5,
                COLUMN_KIND.spouter,
            );
        });
        // The hard drops' fumarole jets: sharp white chuffs, 2–8 m by the rows fallen.
        for (let j = 0; j < 2; j++) {
            const jet = this.jets[j];
            const age = jet ? t - jet.start : 1e6;
            const h = jet && age < 2 ? columnHeight('spouter', age, jet.height) : 0;
            set(
                COLUMN_SLOT.spouter0 + SPOUTERS.length + j,
                jet ? jet.x : 0,
                jet ? jet.z : 0,
                jet ? jet.base : 0,
                h,
                0.35,
                0.4,
                COLUMN_KIND.spouter,
            );
        }
        u.eruptionCount.value = COLUMN_SLOT.spouter0 + SPOUTERS.length + 2;
        // The thread thickens with the water (steam flashes off the column), then swells through
        // the steam phase for IDLE_STEAM seconds after the water, and thins back to its thread.
        if (this.threadSlot >= 0) {
            const ea = idleAge;
            const idleSwell = ea >= 0
                ? smooth(0, 3, ea) * (0.5 + 0.5 * smooth(IDLE_WATER - 2, IDLE_WATER + 3, ea))
                    * (1 - smooth(IDLE_WATER + 6, IDLE_WATER + IDLE_STEAM, ea))
                : 0;
            // A broken chain's roaring white exhalation (4 + 2·peak s), and four lines' (15 s)
            // after the fall-back: taller and wider, drifting and thinning.
            const rl = this.lastRelease;
            const relSwell = rl.peak >= 2 && releaseAge >= 0 && releaseAge < rl.length
                ? smooth(0, 1.2, releaseAge) * (1 - smooth(rl.length * 0.45, rl.length, releaseAge)) : 0;
            const relScale = Math.min(1.2, 0.5 + 0.08 * rl.peak);
            const qs = quadAge - (q.delay + q.rise + q.hold);
            const quadSwell = C.lines >= 4 && !C.perfect && qs >= -1 && qs < q.steam
                ? smooth(-1, 1.5, qs) * (1 - smooth(q.steam * 0.4, q.steam, qs)) : 0;
            const swell = Math.max(idleSwell * 0.6, relSwell * relScale, quadSwell * 1.4);
            const A = u.tables.plumes[this.threadSlot * 2];
            const B = u.tables.plumes[this.threadSlot * 2 + 1];
            A.w = this.threadBase.height * (1 + 1.6 * swell);
            B.y = this.threadBase.r1 * (1 + 3 * swell);
            // A drained Chalice (game over) breathes only a faint thread.
            B.z = this.threadDensity * (1 + 2.5 * Math.min(1, swell)) * (1 - 0.8 * (this.drained || 0));
        }
        // The flood, the fumaroles' sympathy and the bow, for the shaders (on the wrapped clock).
        u.floodAt.value = this.toPhase(this.floodAt);
        u.sympathyAt.value = this.toPhase(this.sympathyAt);
        const bowIn = this.reducedMotion ? 0.8 : 0.5;
        u.bow.value = quadLive ? smooth(0.85, 0.85 + bowIn, quadAge) * (1 - smooth(4.0, 4.5, quadAge)) : 0;
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
        const t = this.time;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.lockRate = 0;
        this.records = 0;
        this.clearRecord();
        this.levelsSeen = false;
        this.seasonClock = 0;
        if (this.level !== 1 || this.season !== 0) this.turnSeason(0, t, true);
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
        const yaw = (breathYaw - px * PARALLAX_YAW) * calm;
        const pitch = -rig.pitch + (breathPitch - py * PARALLAX_PITCH) * calm;
        const driftX = (Math.sin(TAU * BREATH_FX * t + 0.7) * BREATH_X + px * PARALLAX_X) * calm;
        const driftY = Math.sin(TAU * BREATH_FY * t + 2.3) * BREATH_Y * calm;
        camera.position.set(driftX, rig.height + driftY, 0);
        camera.rotation.set(pitch * DEG, yaw * DEG, 0, 'YXZ');
        camera.updateMatrixWorld();
    }

    updateCamera(camera, sim) {
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = sim.time;
        this.pose(camera, sim.time, sim.pointerX, sim.pointerY, this.reducedMotion ? 0 : 1);
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
        if (upright) {
            sx = 0.12 + 0.76 * clamp01(u);
            sy = Math.min(0.97, card.y1 + 0.04);
            screenLeft = !this.mirrored;
        } else {
            const { hud } = layout;
            const hudLeft = hud && (hud.x0 + hud.x1) / 2 < (card.x0 + card.x1) / 2;
            const edgeL = Math.min(card.x0, hud && hudLeft ? hud.x0 : 1);
            const edgeR = Math.max(card.x1, hud && !hudLeft ? hud.x1 : 0);
            sx = screenLeft ? Math.max(0.03, edgeL - 0.06) : Math.min(0.97, edgeR + 0.06);
        }
        // The Iris's ground is on the screen's left unless the layout mirrors it.
        const side = screenLeft !== this.mirrored ? 0 : 1;
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
        return {
            x: g[0], z: g[2], y: g[1] || 0, side, perRow,
        };
    }

    /**
     * The Spill (§3.7): a lock's strip on its side's ground, scoured and then bloomed in the
     * piece's colour, its span the piece's rows, its length 2.5 rows (1.5× for a hard drop), its
     * life set by the slot pressure. A hard drop also fires the nearest fumarole's jet.
     */
    spill(L) {
        const mid = (L.rowTop + L.rowBottom) / 2;
        const aim = this.aimRow(L.player, L.u, mid);
        const rows = Math.max(1, L.rowBottom - L.rowTop + 1);
        const hard = L.hardDrop ? 1.5 : 1;
        const span = Math.min(99, Math.max(2, aim.perRow * rows));
        // 2.5 cell heights on screen (1.5× for a hard drop), at least two cells (§3.7).
        const length = Math.min(60, Math.max(2 * aim.perRow, aim.perRow * 2.5 * hard));
        const slots = this.tier.bloomSlots;
        const life = bloomLife(slots, this.lockRate);
        const t = this.time;
        // Reuse the slot nearest its end once every slot is taken.
        if (this.blooms.length >= slots) {
            let k = 0;
            for (let i = 1; i < this.blooms.length; i++) {
                const a = this.blooms[i];
                const b = this.blooms[k];
                if (a.start + a.life < b.start + b.life) k = i;
            }
            this.blooms.splice(k, 1);
        }
        const rgb = hexToLinear(L.color || '#EDE6CF');
        this.blooms.push({
            x: aim.x, z: aim.z, start: t, life, rgb, side: aim.side, span, length,
        });
        if (L.hardDrop) {
            this.jets.push({
                x: aim.x, z: aim.z, base: aim.y, start: t, height: 2 + 6 * clamp01(L.distance / 18),
            });
            if (this.jets.length > 2) this.jets.shift();
        }
    }

    /** The live blooms into their rows (compacted at the front of the block). */
    writeBlooms(t) {
        const { u } = this;
        const rows = u.tables.events;
        const at = EVENT_ROWS.blooms;
        this.blooms = this.blooms.filter((b) => t - b.start < b.life);
        this.blooms.forEach((b, i) => {
            rows[at + i * 2].set(b.x, b.z, this.toPhase(b.start), b.life);
            const code = b.side * 10000 + Math.round(b.span) * 100 + Math.round(b.length);
            rows[at + i * 2 + 1].set(b.rgb[0], b.rgb[1], b.rgb[2], code);
        });
        u.bloomCount.value = this.blooms.length;
    }

    /** Lines cleared: the Seal (four: the eruption; perfect: the Sleeper). Copy what is kept. */
    onClear(context = {}) {
        if (!this.u) return;
        const t = this.time;
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
        if (lines >= 4) {
            this.counts.quads += 1;
            if (!C.perfect) this.floodAt = t + ERUPTIONS.quad.delay;
        }
        if (C.tspin) this.counts.tspins += 1;
        if (C.perfect) this.counts.perfects += 1;
        if (C.cascade > 1) this.counts.cascades += 1;
        // Every cleared row lays a stripe in the stone record (a perfect clear's stone stays).
        this.records += C.perfect ? 0 : lines;
        if (!C.perfect) this.seal(C);
        if (C.tspin) this.spawnDevils(C);
        // The perfect clear renews the basin (§3.12): every live bloom finishes into recolonised
        // mat at once; the stone (fossils, rosettes) stays.
        if (C.perfect) this.blooms.forEach((b) => { b.life = Math.min(b.life, t - b.start + 0.4); });
        this.lastEventAt = t;
    }

    /**
     * The Seal (§1.5, §3.8): for each cleared row, on both sides at that row's height, a new lip
     * draws along its rim and the pool behind it fills (a cascade's waves reach one tier further
     * each); then the row's own colours fix into the record, on its Stair tier and on its ring of
     * the Iris's microterraces. A synthetic clear without rows seals the lowest tiers in Bleached
     * Sinter.
     */
    seal(C) {
        const tiers = Math.max(1, this.parts.terraces?.tiers ?? 10);
        const rows = C.rows.length ? C.rows : Array.from({ length: C.lines }, (_, k) => 19 - k);
        const t = this.time;
        rows.forEach((row, k) => {
            const codes = C.rowCodes.length >= (k + 1) * 10 ? C.rowCodes.slice(k * 10, k * 10 + 10) : null;
            const tier = Math.max(1, Math.min(tiers, 1 + Math.floor(clamp01(row / 20) * tiers)));
            const ring = Math.min(RECORD_ROWS - RECORD_RING0 - 1, Math.floor(clamp01(row / 20) * 6));
            this.layStripe(tier - 1, codes);
            this.layStripe(RECORD_RING0 + ring, codes);
            [0, 1].forEach((edge) => {
                const aim = this.aimRow(C.player, edge, row);
                const index = aim.side === 1 ? tier : ring;
                const last = aim.side === 1 ? tiers : 5;
                for (let w = 0; w < Math.min(3, C.cascade); w++) {
                    this.pushFill(aim.x, aim.z, aim.side, Math.min(last, index + w), t + w * 0.5);
                }
            });
        });
        if (this.tex?.record) this.tex.record.needsUpdate = true;
    }

    /** One fill row (the newest live ones); `start` may lie a little ahead (a cascade's wave). */
    pushFill(x, z, side, index, start) {
        this.fills.push({
            x, z, start, code: side * 100 + index,
        });
        if (this.fills.length > EVENT_SLOTS.fills) this.fills.shift();
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
     * record row, at fossil saturation, overwriting the oldest band once the row is full.
     */
    layStripe(row, codes) {
        if (!this.recordData) return;
        const samples = this.tier.recordSamples;
        const band = Math.max(10, Math.floor(samples / 8));
        const at = this.recordCursor[row];
        for (let s = 0; s < band; s++) {
            const cell = Math.min(9, Math.floor((s / band) * 10));
            const code = codes ? codes[cell] : PIECE_CODE.GARBAGE;
            const rgb = FOSSIL[code] || FOSSIL[PIECE_CODE.GARBAGE];
            const o = (row * samples + ((at + s) % samples)) * 4;
            this.recordData[o] = rgb[0];
            this.recordData[o + 1] = rgb[1];
            this.recordData[o + 2] = rgb[2];
            this.recordData[o + 3] = 255;
        }
        this.recordCursor[row] = (at + band) % samples;
    }

    /** A new session's stone: bare. */
    clearRecord() {
        if (!this.recordData) return;
        this.recordData.fill(0);
        this.recordCursor.fill(0);
        if (this.tex?.record) this.tex.record.needsUpdate = true;
    }

    /** The true combo changed (0 = the chain broke): a splash a link; a broken chain steams. */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        const t = this.time;
        if (n >= 2 && n > this.combo) {
            this.counts.chainSteps += 1;
            this.lastLinkAt = t;
            if (n >= 6 && this.combo < 6) this.sustainAt = t;
            // Links 4 and 5: the fumaroles across the basin chuff in sympathy.
            if (n >= 4 && n <= 5) this.sympathyAt = t;
        }
        if (n === 0 && this.peak >= 2) {
            this.counts.releases += 1;
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
     * The T-spin's devils (§3.11): one a line (1–3), spinning up off the Iris's rim on the side
     * facing the card and wandering toward the card's side for 5–7 s, never round it; under
     * reduced motion they turn in place.
     */
    spawnDevils(C) {
        const { plan } = this;
        const n = Math.max(1, Math.min(3, C.lines));
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
            const fromX = ex + (dx / dl) * IRIS_RADIUS * 1.08 + (rand() - 0.5) * 18;
            const fromZ = ez + (dz / dl) * IRIS_RADIUS * 1.08 + (rand() - 0.5) * 18;
            this.devils.push({
                start: t + i * 0.35,
                life: 5 + 2 * rand(),
                fromX,
                fromZ,
                toX: fromX + (goal[0] - fromX) * 0.7,
                toZ: fromZ + (goal[2] - fromZ) * 0.7,
                height: 18 + 10 * rand(),
                radius: 3 + rand(),
                seed: rand(),
            });
        }
        while (this.devils.length > EVENT_SLOTS.devils) this.devils.shift();
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
            const k = this.reducedMotion ? 0 : smooth(0, 1, Math.max(0, age) / d.life);
            const px = -(d.toZ - d.fromZ);
            const pz = d.toX - d.fromX;
            const pl = Math.hypot(px, pz) || 1;
            const wob = this.reducedMotion ? 0 : Math.sin(age * 1.7 + d.seed * 6) * 6;
            d.x = d.fromX + (d.toX - d.fromX) * k + (px / pl) * wob;
            d.z = d.fromZ + (d.toZ - d.fromZ) * k + (pz / pl) * wob;
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
     * Steam columns that stand only for an event borrow the two least important far plumes: the
     * Consort's standing column while a back-to-back chain lives (40, 60, 80 m by its level,
     * 12 m wide), and the Sleeper's steam phase after a perfect clear, rolling up through the sky
     * band for some twenty seconds. Each slot returns to its far column when the event ends.
     */
    writeSteamOverrides(t) {
        const { u, plan } = this;
        if (!this.spareSlots || !this.plumeBase) return;
        const rows = u.tables.plumes;
        const restore = (slot) => {
            rows[slot * 2].copy(this.plumeBase[slot * 2]);
            rows[slot * 2 + 1].copy(this.plumeBase[slot * 2 + 1]);
        };
        const [cSlot, sSlot] = this.spareSlots;
        if (cSlot !== undefined) {
            if (this.consortWet > 0.02) {
                const [x, y, z] = plan.consort;
                const level = Math.max(1, this.b2b);
                rows[cSlot * 2].set(x, z, y, (20 + 20 * level) * Math.min(1, this.consortWet * 1.2));
                rows[cSlot * 2 + 1].set(6, 14, 0.9 * this.consortWet, PLUME_KIND.column);
            } else restore(cSlot);
        }
        if (sSlot !== undefined) {
            const C = this.lastClear;
            const age = t - C.at;
            if (C.perfect && age > 1.5 && age < 26) {
                const [x, y, z] = plan.sleeper;
                const k = smooth(1.5, 9, age);
                const thin = 1 - smooth(14, 26, age);
                rows[sSlot * 2].set(x, z, y, 120 + 300 * k);
                rows[sSlot * 2 + 1].set(40, 90 + 220 * k, 0.9 * thin, PLUME_KIND.column);
            } else restore(sSlot);
        }
    }

    /** A world time on the shaders' wrapped clock (u.time is the phase, CLOCK_WRAP periodic). */
    toPhase(t) {
        return t - (this.time - this.phase);
    }

    /** The sustained column's height for the live chain (§3.9: 25 m at six links, 60 m by ten). */
    sustainedHeight() {
        return 25 + 35 * clamp01((this.combo - 6) / 4);
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
        this.level = lv;
        this.levelsSeen = true;
        this.seasonClock = 0;
        const to = seasonForLevel(lv);
        if (silent || !this.u) {
            this.season = to;
            this.front = {
                from: to, to, start: -1e6, length: SEASON_SWEEP,
            };
            return;
        }
        this.counts.levelUps += 1;
        if (to !== this.season) this.turnSeason(to, t, false);
    }

    /** Start the succession front toward a season (instant: the front has already passed). */
    turnSeason(to, t, instant) {
        const sweep = this.seasonSweepAt(t);
        const from = sweep < 0.5 ? this.front.from : this.front.to;
        this.season = to;
        this.front = {
            from: instant ? to : from, to, start: instant ? -1e6 : t, length: SEASON_SWEEP,
        };
        if (!instant) this.counts.seasonSteps += 1;
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
            const s = ((Math.round(this.held.season) % SEASONS.length) + SEASONS.length) % SEASONS.length;
            this.season = s;
            this.front = {
                from: s, to: s, start: -1e6, length: SEASON_SWEEP,
            };
        }
    }

    /** Pre-fill the stone record with n stripes (captures): deterministic rows of mixed pieces. */
    primeRecord(n) {
        if (!Number.isFinite(n)) return;
        const count = Math.max(0, Math.round(n));
        this.records = count;
        const rand = mulberry32(0x5eed);
        const tiers = Math.max(1, this.parts.terraces?.tiers ?? 10);
        for (let i = 0; i < count; i++) {
            const codes = Array.from({ length: 10 }, () => Math.floor(rand() * 7));
            this.layStripe(Math.floor(rand() * tiers), codes);
            this.layStripe(RECORD_RING0 + Math.floor(rand() * 6), codes);
        }
        if (this.tex?.record) this.tex.record.needsUpdate = true;
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
        const live = t - this.lastLock.at < SESSION_LIVE;
        if (live && !this.levelsSeen && this.held.season === null) {
            this.seasonClock += dt;
            if (this.seasonClock >= SEASON_CLOCK) {
                this.seasonClock = 0;
                this.turnSeason((this.season + 1) % SEASONS.length, t, false);
            }
        }

        // ── The gauges ──
        const heat = this.held.heat !== null ? clamp01(this.held.heat) : null;
        const heatTarget = heat !== null ? heat * 0.5 : eyeHeat(this.combo, this.level);
        this.heat += (heatTarget - this.heat) * approach(this.combo > 0 ? 3 : 1 / 4, dt);
        const reachTarget = heat !== null ? 1 + heat * 0.96 : fingerReach(this.combo);
        // The fronts push out at once a link, and drain back notch by notch over about 12 s.
        this.reach += (reachTarget - this.reach) * approach(reachTarget > this.reach ? 4 : 1 / 3, dt);
        const C = this.lastClear;
        const sinceClear = t - C.at;
        let vividTarget = 1;
        if (C.perfect && sinceClear < 22) vividTarget = 1.25;
        else if (C.lines >= 4 && sinceClear < 6) vividTarget = 1.18;
        this.vivid += (vividTarget - this.vivid) * approach(1 / VIVID_TAU, dt);

        // ── Weather ──
        const breath = this.held.breath !== null ? clamp01(this.held.breath) : breathAt(t);
        const wind = windAt(t, this._wind);
        u.breath.value = breath;
        u.steam.value = steamForBreath(breath) * SEASONS[this.season].steam;
        const heading = -0.35 + wind.angle; // the breeze leans the steam to the right
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
        this.writeSteamOverrides(t);
        // The Chalice drains at a game over and refills with the next run.
        const drainTarget = this.drain.at > this.drain.refillAt ? 1 : 0;
        this.drained += (drainTarget - this.drained) * approach(drainTarget ? 1 / 2.5 : 1 / 1.2, dt);
        u.drain.value = this.drained;
        // The Consort's mound darkens wet while its chain lives, and dries over ~8 s after.
        this.consortWet += ((this.b2b > 0 ? 1 : 0) - this.consortWet) * approach(this.b2b > 0 ? 1 / 0.7 : 1 / 8, dt);
        u.consortWet.value = this.consortWet;
        u.seasonFrom.value = this.front.from;
        u.seasonTo.value = this.front.to;
        const sweep = this.seasonSweepAt(t);
        u.frontRadius.value = this.front.from === this.front.to ? 1e6 : smooth(0, 1, sweep) * FRONT_REACH;
        u.heat.value = this.heat;
        u.reach.value = this.reach;

        // ── The sun: eased toward the solution, never while an eruption is live ──
        const erupting = t - this.lastClear.at < 20 && this.lastClear.lines >= 4;
        if (!erupting) {
            const k = approach(1 / SUN_TAU, dt);
            this.sunNow.azimuth += (this.sunTarget.azimuth - this.sunNow.azimuth) * k;
            this.sunNow.elevation += (this.sunTarget.elevation - this.sunNow.elevation) * k;
        }
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

        // ── Post ──
        const post = this._post;
        post.exposure = 1;
        post.iris = 1;
        post.sat = SEASONS[this.season].sat;
        post.vivid = this.vivid;
        post.bloomBoost = 0;
        u.iris.value = 1 / post.iris;
        this.writeShimmer();
    }

    /** The season's sky, haze, rim and sun, crossfaded over the succession front's sweep. */
    writeSeasonAir(t) {
        const { u } = this;
        const k = smooth(0, 1, this.seasonSweepAt(t));
        const A = this._seasonRgb[this.front.from];
        const B = this._seasonRgb[this.front.to];
        const set = (node, key) => {
            node.value.set(lerp(A[key][0], B[key][0], k), lerp(A[key][1], B[key][1], k), lerp(A[key][2], B[key][2], k));
        };
        set(u.zenith, 'zenith');
        set(u.haze, 'haze');
        set(u.rim, 'rim');
        set(u.meadow, 'meadow');
        set(u.sunColor, 'sun');
        const sa = SEASONS[this.front.from];
        const sb = SEASONS[this.front.to];
        u.snow.value = lerp(sa.snow, sb.snow, k);
        u.frost.value = lerp(sa.frost, sb.frost, k);
        u.wetness.value = lerp(sa.wet, sb.wet, k);
        set(u.streamer, 'streamer');
        u.streamerAmount.value = lerp(sa.streamerAmount || 0, sb.streamerAmount || 0, k);
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
            seasonClock: this.seasonClock,
            breath: this.u ? this.u.breath.value : null,
            gust: this._gust.phase,
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            heat: this.heat,
            reach: this.reach,
            lockRate: this.lockRate,
            records: this.records,
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
