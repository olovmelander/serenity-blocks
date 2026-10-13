/**
 * Rainbark — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (rainbark-theme.js) and the playground effect (src/playground/effects/rainbark.effect.js),
 * so what is iterated there ships.
 *
 * We hang in the middle storey of a forest of painted giants, looking level into blue air: the
 * Elder's wall of bark cropped on the left, two slim Sisters set deep on the right, the grove
 * receding diagonally behind the card, the canopy's lace far above and a floor of luminous mist
 * below. The board feeds it:
 *
 *   lock     the Peel: a strip of bark peels off a lane trunk at the piece's rows, and under it
 *            is fresh bark of the piece's own colour (every piece is one age of the bark). A
 *            hard drop is the Knock: the strip tears off whole and a gloss pulse runs up.
 *   clear    the Shed: a girdle splits at each cleared row on both near trunks, its sheet drops
 *            into the mist, and the ring under it blazes First Skin, then ripens into the row's
 *            own colours.
 *   four     the Great Moult: every trunk in view sheds its skin and stands in First Skin, then
 *            ripens back in flames of colour.
 *   combo    each link opens a gap in the canopy: one counted pool of sunlight per link.
 *   release  the Set: the gaps close and a curtain of curls falls, sized by the chain's peak.
 *   B2B      the Sunshower: rain in the light and wet, glistening bark while the chain lives.
 *   T-spin   the Unwinding: a helical strip unwinds like an apple peel; amber beads well up.
 *   perfect  the Floor: the mist drains and the forest floor shows for the first time.
 *   level    the Climb: the walkway rises a storey (12 m) and the giants slide down past us.
 *   over     Mistfall: the mist rises past the camera; a new run brings the morning back.
 *
 * The parts are built from a registry (PART_BUILDERS); a part not built yet is simply absent.
 * Nothing is created at event time: events write numbers into preallocated state, so seek(t)
 * plus a fixed-step replay reproduces any frame. What moves at a changing rate is integrated
 * (the group clocks); everything else is closed form in the clock.
 */

import * as THREE from 'three/webgpu';
import {
    DEG,
    CURL,
    FLOOR,
    LIANA,
    MEDITATION,
    LIGHT_WHEEL,
    lightWheelAt,
    GAP,
    HELIX,
    floorEnvelope,
    RAIN,
    HERO_TRUNKS,
    MOULT,
    SHED,
    packCodes,
    QUICKEN,
    SET,
    approach,
    quickenRate,
    KNOCK,
    MISTFALL,
    PEEL,
    PIECE_AGE,
    TWIN_SEEDS,
    TWIN_TRUNKS,
    PALETTE_ROWS,
    SUN_BOLE,
    SUN_WHITE,
    SUN_AZIMUTH,
    SUN_DRIFT,
    STOREY,
    TAU,
    TIDE_PERIOD,
    ZONES,
    ZONE_COLOR_KEYS,
    billowContrast,
    clamp01,
    CLIMB_BASE,
    canopyWind,
    climbHeight,
    createBarkTextures,
    createRainbarkUniforms,
    groupMean,
    hexToLinear,
    fleckLodAt,
    lerp,
    mistDrift,
    mistGrainAt,
    mistOnset,
    pieceCode,
    planGrove,
    projectRest,
    recordAxis,
    restLens,
    smooth,
    smoother,
    storeyFleck,
    sunDirection,
    tideClock,
    trunkHeightAt,
    TRUNK_STRIDE,
    viewFov,
    viewPitch,
    windScaleAt,
    writeRibbonPhases,
    zoneIndex,
} from './rainbark-tsl.js';
import { tierFor } from './rainbark-quality.js';
import {
    bakeCrownField, bakeFbm, bakeGapMask, bakeLattice, bakeLeafLace, bakePatchAtlas, bakeRamp,
} from './rainbark-bake.js';
import { createSky } from './rainbark-sky.js';
import { createTrunks } from './rainbark-trunks.js';
import { createMist } from './rainbark-mist.js';
import { createFx } from './rainbark-fx.js';
import { createCurls } from './rainbark-curls.js';
import { createLife } from './rainbark-life.js';
import { RainbarkEvents } from './rainbark-events.js';
import {
    BOARD_GRID, boardFor, cardUnion, createBand, fallbackFor, fallbackLayout, trunkBand,
} from './rainbark-composition.js';

/** The rest camera. */
export const REST_RIG = Object.freeze({
    near: 0.3,
    far: 3000,
    minFov: 30,
    maxFov: 78,
});

/** Every part of the picture, in draw order of build (the URL reference lists the same names). */
export const RAINBARK_PARTS = Object.freeze(['sky', 'trunks', 'mist', 'curls', 'fx', 'life']);

/**
 * Builders of the parts that exist so far; the rest arrive with later stages. A builder may give
 * nothing for a tier without that part (Minimal has no shafts).
 */
const PART_BUILDERS = Object.freeze({
    sky: (world) => createSky(world.u, world.tier),
    trunks: (world) => createTrunks(world.u, world.tier, {
        atlasSize: world.tier.atlas,
        farSlots: world.plan.trunks.length + TWIN_TRUNKS.length + world.plan.limbs.length,
    }),
    mist: (world) => createMist(world.u, world.tier),
    curls: (world) => createCurls(world.u, world.tier, world.quality),
    fx: (world) => createFx(world.u, world.tier),
    life: (world) => createLife(world.u, world.tier),
});

/** The bark's patch layout (the lead's ribbon seed) and the noise bakes' seeds. */
const ATLAS_SEED = 21;
const FBM_SEED = 4441;
const LATTICE_SEED = 9917;
/**
 * The bakes, by atlas size: pure functions of their seeds, so every world (a rebuild, a quality
 * change, a test) shares one set of typed arrays instead of baking them again.
 */
const BAKES = new Map();
let CANOPY = null;
/** The canopy's bakes (lace, crowns, gap mask): the same for every tier, baked once. */
function canopyBakes() {
    if (!CANOPY) CANOPY = { lace: bakeLeafLace(), crowns: bakeCrownField(), gap: bakeGapMask() };
    return CANOPY;
}
function bakesFor(atlasSize) {
    canopyBakes();
    if (!BAKES.has(atlasSize)) {
        BAKES.set(atlasSize, {
            atlas: bakePatchAtlas(ATLAS_SEED, atlasSize),
            ramp: bakeRamp(),
            fbm: bakeFbm(FBM_SEED),
            lattice: bakeLattice(LATTICE_SEED),
            lace: CANOPY.lace,
            crowns: CANOPY.crowns,
            gap: CANOPY.gap,
        });
    }
    return BAKES.get(atlasSize);
}

/**
 * The gobo's calibration of every storey (storeyFleck: its zone's share of bark in flecks at the
 * eye's level of the mask), found once at build (a pure function of the mask, which every world
 * shares), so a Climb never computes one mid-flight.
 */
let FLECK_STOREYS = null;
function fleckStoreys() {
    if (!FLECK_STOREYS) {
        const { gap } = canopyBakes();
        FLECK_STOREYS = Object.freeze(Array.from({ length: 12 }, (_, i) => storeyFleck(gap, i + 1)));
    }
    return FLECK_STOREYS;
}
const fleckFor = (level) => FLECK_STOREYS[level - 1];

/** The level whose storey a height is nearest (1 … 12). */
const storeyOf = (y) => Math.max(1, Math.min(12, Math.round((y - CLIMB_BASE) / STOREY) + 1));

/** Vertical field of view (degrees) for an aspect: 64° upright … 50° at 16:9 … 44° at 21:9. */
export function fovForAspect(aspect) {
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, viewFov(aspect)));
}

/** How far the view is pitched up (degrees): 9° upright, 6° at 16:9, 5° at 21:9. */
export function pitchForAspect(aspect) {
    return viewPitch(aspect);
}

/** The camera's breath (metres, Lissajous at 0.05 / 0.037 Hz) and the mouse's reach. */
const BREATH_X = 0.15;
const BREATH_Y = 0.1;
const BREATH_FX = 0.05;
const BREATH_FY = 0.037;
const PARALLAX = 0.25;
/** The Climb: it waits this long after the latest clear, then rises over CLIMB_TIME. */
const CLIMB_DELAY = 1.2;
const CLIMB_TIME = 3.5;
/** Under reduced motion the camera never moves: the zone crossfades instead, over this long. */
const CLIMB_FADE = 1.2;
/** Mistfall rises over this long; the morning drains it over MORNING_TIME. */
const MISTFALL_TIME = 4;
const MORNING_TIME = 3;
/** A new run's descent waits under the rising mist for this long. */
const MISTFALL_COVER = 2.5;
/** The grove's age drift (§3.4): bias at a session's start, per minute, and its cap. */
const AGE_BIAS_START = 0.3;
const AGE_BIAS_RATE = 0.05;
const AGE_BIAS_CAP = 1.2;
/** Group clocks wrap here (float precision in the bark's age maths). */
const CLOCK_WRAP = 65536;

function emptyCounts() {
    return {
        locks: 0,
        hardDrops: 0,
        clears: 0,
        lines: 0,
        quads: 0,
        tspins: 0,
        perfects: 0,
        chainSteps: 0,
        releases: 0,
        b2bSteps: 0,
        levelUps: 0,
        gameOvers: 0,
        mornings: 0,
    };
}

export class RainbarkWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]  salts every trunk (its patch hashes, bark offset and phases); the
     *   default was picked from a sweep so the Elder's face shows the grove's mean share of jewels
     *   at the reference frames (any seed gives the same mix on average)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 0x6364,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'Rainbark';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        /** The frame's CSS size (0 until the first setViewport that gives it): the fallback layout's. */
        this.css = { width: 0, height: 0 };
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(fovForAspect(this.aspect), this.aspect, REST_RIG.near, REST_RIG.far);
        /** The grove plan (build), the composition solved for the layout, and the storey it pivots at. */
        this.plan = null;
        this.band = createBand();
        /** trunkBand's options, reused every frame of a Climb (placeGrove allocates nothing). */
        this._bandOpts = { camY: 0, seeds: null };
        this._pivot = NaN;
        this._heroSeeds = [];
        this._standing = new Map();
        this._limbParents = [];
        this._rgb = [0, 0, 0];
        this._rgbB = [0, 0, 0];
        this._mean = [0, 0, 0, 0];
        /** The bias the group-mean rows were last computed for, and the atlas's matrix share. */
        this._meanBias = NaN;
        this.matrixShare = 0.42;
        this.islandShare = 0.05;
        this._sun = [0, 0, 0];
        this._wind = [0, 0];
        this._zoneMix = { a: 0, b: 0, mix: 0 };
        /** The light wheel (LIGHT_WHEEL): which moods the clock stands between. */
        this._wheel = {
            a: 0, b: 1, mix: 0, place: 0,
        };
        /** The tide clock in the zones a Climb crossfades between, and the mist's drift. */
        this._tideA = tideClock(0, ZONES[1]);
        this._tideB = tideClock(0, ZONES[1]);
        this._drift = [0, 0, 0];
        /** Each zone's colours (and the Mistfall look's) as linear rgb, converted once. */
        this._zoneRgb = ZONES.map((zone) => this.linearColors(zone.colors));
        this._mistRgb = this.linearColors(MISTFALL.colors);
        this._post = {
            exposure: 1,
            iris: 1,
            sat: 1,
            bloomBoost: 0,
            gradeShadow: [0, 0, 0],
            gradeLight: [1, 1, 1],
        };
        this.lastLock = {
            at: -1e6, player: 0, u: 0.5, rowTop: 19, rowBottom: 19, code: 7, color: null, hardDrop: false, distance: 0,
        };
        this.lastClear = {
            at: -1e6, player: 0, lines: 0, combo: 0, cascade: 1, tspin: false, perfect: false, b2b: false,
        };
        this.lastClear.rows = [];
        this.lastClear.rowCodes = [];
        /** The board's marks on the bark (the event table's writer) and what aiming them reuses. */
        this.events = new RainbarkEvents();
        this._lens = restLens(16 / 9);
        this._onTrunk = [0, 0];
        this._axis = [0, 0, 0];
        this._peel = {
            code: 1, yTop: 0, yBot: 0, theta: 0, half: 0.1, age: 0, radius: 1, hard: 0, axisX: 0, axisZ: 0,
        };
        this._peelOffset = 0;
        this._peelAxis = [0, 0, 0];
        this._peelAxisAt = (y) => recordAxis(this.parts.trunks.near.data, y, this._peelAxis, this._peelOffset);
        /** A lock's curl and a knock's flakes (reused records). */
        this._lockCurl = {
            theta: 0, yTop: 0, yBot: 0, radius: 1, axisX: 0, axisZ: 0, width: 1, unzip: 0.36, delay: 0, outerAge: 0.9, hard: false,
        };
        this._flakes = {
            theta: 0, spread: 0.6, y0: 0, axisAt: this._peelAxisAt,
        };
        /** The trunks ambient curls shed from (collectEmitters), and what their spawning reads. */
        this._emitters = [];
        this._emitterPool = [];
        this._emitAxis = [0, 0, 0];
        this._lianaAxis = [0, 0, 0];
        this._proj = [0, 0];
        this._cardBand = [0.5, 0.5];
        this._stations = Array.from({ length: GAP.stations.wide.length }, () => ({
            x: 0, y: 0, z: 0, ok: false,
        }));
        this._curtainAt = [0, 0, 0, 0, 0];
        this._moultAt = [0, 0, 0, 0, 0, 0, 0];
        this._arc = [0, 0];
        this._girdle = {
            code: 1, yC: 0, halfH: 0.2, lo: 0, hi: 0, thetaL: 0, span: 1, strength: 1,
        };
        this._helix = {
            code: 1, yTop: 0, turns: 1, pitch: 0.9, theta: 0, width: 0.3,
        };
        this._sheet = {
            theta: 0, yTop: 0, yBot: 0, radius: 1, axisX: 0, axisZ: 0, width: 1, unzip: 0.3, delay: 0.1, outerAge: 0.9, hard: false, kind: 5,
        };
        this._curlScene = {
            share: 1,
            eyeY: 56,
            tide: 26,
            canopyY: 172,
            emitters: this._emitters,
            pick: (r) => this.pickEmitter(r),
            axisAt: (e, y) => recordAxis(e.draw.data, y, this._emitAxis, e.offset),
            project: (x, y, z) => projectRest(this._lens, x, y, z, this._curlScene.eyeY, this._proj),
            inCardBand: (sx) => sx > this._cardBand[0] && sx < this._cardBand[1],
        };
        this.resetState(0);
    }

    linearColors(colors) {
        const out = {};
        ZONE_COLOR_KEYS.forEach((key) => { out[key] = hexToLinear(colors[key]); });
        return out;
    }

    /** Everything the choreography remembers, as it stands at `time` on level one. */
    resetState(time) {
        this.time = time;
        this.level = 1;
        this.camY = climbHeight(1);
        /** The rise in flight (or a jump waiting under the mist), else null. */
        this.climb = null;
        this.zone = zoneIndex(1);
        /** Mistfall: from, to, the moment it began and how long it takes. */
        this.mistfall = {
            from: 0, to: 0, start: -1e6, length: MISTFALL_TIME,
        };
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.sheds = 0;
        this.sessionAge = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.lastRelease = { at: -1e6, peak: 0 };
        /** When the latest Great Moult began. */
        this.moultAt = -1e6;
        /** Meditation's clicks: when the last one peeled, and how many have. */
        this._lastClick = -1e6;
        this._clicks = 0;
        /** When the latest perfect clear opened the Floor. */
        this.floorAt = -1e6;
        /** The Sunshower: how much rain falls (0 … 1) and how wet the grove is (eased). */
        this.rain = 0;
        this.wet = 0;
        /** The canopy gaps: when each opened and when it was told to shut (Infinity: not yet). */
        this.gapOpen = new Float64Array(GAP.stations.wide.length).fill(Infinity);
        this.gapClose = new Float64Array(GAP.stations.wide.length).fill(Infinity);
        /** Quickening: each group clock's rate (eased), and the canopy wind's boost. */
        this.rates = [1, 1, 1, 1];
        this.windBoost = 1;
        /** The four group clocks (Elder, Sisters, R1/R2, far): integrated, a chain quickens them. */
        this.clocks = [time % CLOCK_WRAP, time % CLOCK_WRAP, time % CLOCK_WRAP, time % CLOCK_WRAP];
        this.counts = emptyCounts();
        this.events.reset();
        this.parts.curls?.reset();
    }

    build() {
        this.preparePlan();
        const bakes = bakesFor(this.tier.atlas);
        this.matrixShare = bakes.atlas.matrixShare;
        this.islandShare = bakes.atlas.islandShare;
        const textures = createBarkTextures(bakes);
        this.textures.push(...Object.values(textures));
        this.u = createRainbarkUniforms(textures);
        fleckStoreys();
        // The ribbons' places in their tile's cycle, spread by their area (the same on every tier).
        writeRibbonPhases(this.u.tables.palette, bakes.atlas.phases);
        RAINBARK_PARTS.forEach((name) => {
            const make = PART_BUILDERS[name];
            const part = make ? make(this) : null;
            if (part) this.addPart(name, part);
        });
        this.prepareEmitters();
        this.resetState(this.time);
        this.placeGrove(this.heightAt(this.time));
        this.writeCardRect();
        this.scene.add(this.root);
        return this;
    }

    /**
     * The grove plan for the world's seed and tier, and what placing it needs: the heroes' seeds,
     * a mutable stand-in per solved trunk, and where each limb's parent stands.
     */
    preparePlan() {
        const plan = planGrove(this.seed, this.tier);
        this.plan = plan;
        this._heroSeeds = plan.heroes.map(({ seed }) => seed);
        this._standing.clear();
        [...HERO_TRUNKS, ...TWIN_TRUNKS].forEach((trunk) => this._standing.set(trunk.name, { ...trunk }));
        const farIndex = new Map(plan.trunks.map((trunk, i) => [trunk.name, i]));
        this._limbParents = plan.limbs.map((limb) => {
            const hero = HERO_TRUNKS.find((trunk) => trunk.name === limb.parent && trunk.code > 0);
            if (hero) return { near: true, slot: hero.code - 1 };
            return { near: false, slot: farIndex.has(limb.parent) ? farIndex.get(limb.parent) : -1 };
        });
    }

    /**
     * Stand the grove for the current layout and aspect, every trunk's axis pivoted at `pivot`
     * (the eye's storey): the heroes where the composition solver puts them (a hero it hides is
     * collapsed), the planned far grove, the 21:9 Twin, then the limbs out of their parents.
     * Instance data only: the draws, their slots and the scene never change. Allocation-free (it
     * runs every frame of a Climb).
     */
    placeGrove(pivot) {
        const { trunks } = this.parts;
        if (!trunks || !this.plan) return;
        const y = Number.isFinite(pivot) ? pivot : this.camY;
        this._pivot = y;
        this._bandOpts.camY = y;
        this._bandOpts.seeds = this._heroSeeds;
        const band = trunkBand(this.layout, this.aspect, this._bandOpts, this.band);
        const { near, far } = trunks;
        const { trunks: grove, limbs } = this.plan;
        const twinBase = grove.length;
        const limbBase = twinBase + TWIN_TRUNKS.length;
        for (let i = 0; i < band.placements.length; i++) {
            const place = band.placements[i];
            const stand = this._standing.get(place.name);
            stand.x = place.x;
            stand.z = place.z;
            stand.lean = place.lean;
            if (place.code > 0) {
                const seed = this._heroSeeds[place.code - 1];
                trunks.stand(near, place.code - 1, place.show ? stand : null, seed, y);
            } else {
                const twin = i - (band.placements.length - TWIN_TRUNKS.length);
                trunks.stand(far, twinBase + twin, place.show ? stand : null, TWIN_SEEDS[twin], y);
            }
        }
        for (let i = 0; i < grove.length; i++) trunks.stand(far, i, grove[i], grove[i].seed, y);
        for (let i = 0; i < limbs.length; i++) {
            const parent = this._limbParents[i];
            trunks.standLimb(limbBase + i, limbs[i], parent.near ? near : far, parent.slot);
        }
        trunks.commit();
        // The peel lanes on the Elder and Sister One (a hidden trunk has none).
        const [laneA, laneB] = band.lanes;
        this.u.laneA.value.set(laneA.theta0, laneA.theta1, laneA.code, band.placements[0].show ? 1 : 0);
        this.u.laneB.value.set(laneB.theta0, laneB.theta1, laneB.code, band.placements[1].show ? 1 : 0);
        this.hangLiana(y);
        this.collectEmitters();
    }

    /**
     * The trunks the grove's ambient curls shed from: every standing trunk in front of the rest eye
     * (the heroes weighted by how much of the frame they fill), each with its depth and the bearing
     * that faces the eye. The records are made once (prepareEmitters); this only refreshes them.
     */
    collectEmitters() {
        const list = this._emitters;
        list.length = 0;
        let total = 0;
        for (let i = 0; i < this._emitterPool.length; i++) {
            const e = this._emitterPool[i];
            if (!e.draw.live(e.slot)) continue;
            const axis = recordAxis(e.draw.data, this._pivot, this._emitAxis, e.offset);
            if (!(-axis[1] > 3)) continue;
            e.depth = -axis[1];
            e.facing = Math.atan2(-axis[1], -axis[0]);
            total += e.weight;
            e.total = total;
            list.push(e);
        }
    }

    /**
     * The liana's two ends (LIANA): on Sister One's and Sister Two's facing sides, LIANA.from and
     * LIANA.to over the eye's storey; hidden with Sister Two.
     */
    hangLiana(y) {
        const { life } = this.parts;
        const near = this.parts.trunks?.near;
        if (!life || !near) return;
        const { placements } = this.band;
        const shown = placements[1].show && placements[2].show && near.live(1) && near.live(2);
        if (!shown) {
            life.ends.a.value.w = 0;
            life.ends.b.value.w = 0;
            return;
        }
        const a = recordAxis(near.data, y + LIANA.from, this._lianaAxis, TRUNK_STRIDE);
        const b = recordAxis(near.data, y + LIANA.to, this._axis, 2 * TRUNK_STRIDE);
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const d = Math.max(Math.hypot(dx, dz), 1e-3);
        life.ends.a.value.set(a[0] + (dx / d) * a[2] * 0.95, y + LIANA.from, a[1] + (dz / d) * a[2] * 0.95, 1);
        life.ends.b.value.set(b[0] - (dx / d) * b[2] * 0.95, y + LIANA.to, b[1] - (dz / d) * b[2] * 0.95, 1);
    }

    /** The emitter at a share r (0 … 1) of the weights. */
    pickEmitter(r) {
        const list = this._emitters;
        if (!list.length) return null;
        const at = r * list[list.length - 1].total;
        for (let i = 0; i < list.length; i++) if (at <= list[i].total) return list[i];
        return list[list.length - 1];
    }

    /** One emitter record per near slot (the heroes, weighted) and per far grove trunk. */
    prepareEmitters() {
        const { trunks } = this.parts;
        this._emitterPool = [];
        if (!trunks) return;
        // (The heroes stand near: their curls are the ones the eye follows down through the air.)
        const heroWeights = [7, 6, 3, 3, 2, 1, 1, 1];
        const add = (draw, slot, weight) => this._emitterPool.push({
            draw, slot, offset: slot * TRUNK_STRIDE, weight, depth: 0, facing: 0, total: 0,
        });
        for (let s = 0; s < trunks.near.slots; s++) add(trunks.near, s, heroWeights[s] ?? 1);
        for (let s = 0; s < this.plan.trunks.length; s++) add(trunks.far, s, 1);
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

    /**
     * The drawing buffer's size, the frame's aspect and (optionally) its CSS size, which the solo
     * fallback layout is laid out at until a live layout arrives (else a 1080-line frame).
     */
    setViewport(bufferWidth, bufferHeight, aspect, cssWidth = 0, cssHeight = 0) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        const turned = Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect;
        if (turned) this.aspect = aspect;
        if (cssWidth > 0 && cssHeight > 0) {
            this.css.width = cssWidth;
            this.css.height = cssHeight;
        }
        if (!this.layoutLive) this.layout = fallbackFor(this.aspect, this.css.width, this.css.height);
        this.updatePixelAngle();
        if (turned || !this.layoutLive) this.placeGrove(this.heightAt(this.time));
        this.writeCardRect();
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
        this.layout = rects || fallbackFor(this.aspect, this.css.width, this.css.height);
        // The heroes stand round the cards and the HUD: re-solve (instance data only).
        this.placeGrove(this.heightAt(this.time));
        this.writeCardRect();
    }

    /** The cards' union on screen, which what drifts in the world keeps out of (u.cardRect). */
    writeCardRect() {
        if (!this.u) return;
        const card = cardUnion(this.layout);
        this._cardBand[0] = card ? card.x0 - 0.04 : 0.5;
        this._cardBand[1] = card ? card.x1 + 0.04 : 0.5;
        if (card) this.u.cardRect.value.set(card.x0, card.y0, card.x1, card.y1);
        else this.u.cardRect.value.set(0.5, 0.5, 0.5, 0.5);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight and stands on level one. */
    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
        this.placeGrove(this.heightAt(this.time));
    }

    /**
     * A new run: no chain, no rain, no sheds, the grove's age drift starts over, and the walkway
     * goes back down to the first storey: under the rising mist if Mistfall is on, else at once.
     */
    resetSession() {
        const t = this.time;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.sheds = 0;
        this.sessionAge = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.level = 1;
        const to = climbHeight(1);
        const from = this.heightAt(t);
        const rising = this.mistfall.to > 0;
        if (Math.abs(from - to) > 1e-6 || this.zone !== zoneIndex(1)) {
            this.climb = {
                from,
                to,
                start: rising ? Math.max(t, this.mistfall.start + MISTFALL_COVER) : t,
                length: 0,
                zoneFrom: this.zone,
                zoneTo: zoneIndex(1),
                zoneLength: 0,
            };
        }
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

    // ── The Climb and Mistfall (closed form in the clock) ───────────────────────

    /** The walkway's height at time t (metres). */
    heightAt(t) {
        const c = this.climb;
        if (!c) return this.camY;
        if (t < c.start) return c.from;
        if (!(c.length > 0)) return c.to;
        return lerp(c.from, c.to, smoother((t - c.start) / c.length));
    }

    /** The zone crossfade at time t: { a, b, mix } (indices into ZONES). */
    zoneAt(t, out = this._zoneMix) {
        const c = this.climb;
        if (!c) {
            out.a = this.zone;
            out.b = this.zone;
            out.mix = 0;
            return out;
        }
        out.a = c.zoneFrom;
        out.b = c.zoneTo;
        if (t < c.start) out.mix = 0;
        else if (!(c.zoneLength > 0)) out.mix = 1;
        else out.mix = smoother((t - c.start) / c.zoneLength);
        return out;
    }

    /** How far Mistfall has risen at time t (0 clear … 1 the mist above the camera). */
    mistfallAt(t) {
        const m = this.mistfall;
        return lerp(m.from, m.to, smooth(0, 1, (t - m.start) / m.length));
    }

    /** Settle a finished climb into the rest state (its end is where heightAt already is). */
    settleClimb(t) {
        const c = this.climb;
        if (!c || t < c.start + Math.max(c.length, c.zoneLength)) return;
        this.camY = c.to;
        this.zone = c.zoneTo;
        this.climb = null;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    /** Stand a camera on the rig: (x, camY + breath, 0), looking down −z, pitched up, no roll. */
    pose(camera, t, pointerX = 0, calm = 1) {
        const fov = fovForAspect(this.aspect);
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        const breathX = Math.sin(TAU * BREATH_FX * t) * BREATH_X;
        const breathY = Math.sin(TAU * BREATH_FY * t + 1.1) * BREATH_Y;
        const px = Math.max(-1, Math.min(1, Number(pointerX) || 0)) * PARALLAX;
        camera.position.set((breathX + px) * calm, this.heightAt(t) + breathY * calm, 0);
        camera.rotation.set(pitchForAspect(this.aspect) * DEG, 0, 0);
        camera.updateMatrixWorld();
    }

    updateCamera(camera, sim) {
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = sim.time;
        this.pose(camera, sim.time, sim.pointerX, this.reducedMotion ? 0 : 1);
        this._camera = camera;
    }

    /** The rest camera for the current aspect and level (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.aspect = this.aspect;
        cam.updateProjectionMatrix();
        this.pose(cam, this.time, 0, 0);
        return cam;
    }

    // ── Events (numbers only: the parts that show them read these) ──────────────

    /** A piece locked: the Peel (a hard drop is the Knock). The context is reused: copy it. */
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
        // The Peel: a band of the piece's own bark bared on its lane, at its rows; a hard drop
        // tears it off whole and knocks the trunk.
        const peel = rows ? this.peelTarget(L.player, L.u, L.rowTop, L.rowBottom, L.code, L.hardDrop) : null;
        if (peel) {
            this.events.peel(t, peel);
            const { curls } = this.parts;
            if (curls) {
                // The strip rolls up along the front, then lets go and tumbles into the mist.
                const c = this._lockCurl;
                c.theta = peel.theta;
                c.yTop = peel.yTop;
                c.yBot = peel.yBot;
                c.radius = peel.radius;
                c.axisX = peel.axisX;
                c.axisZ = peel.axisZ;
                c.width = 2 * peel.half * peel.radius * 0.92;
                c.unzip = L.hardDrop ? PEEL.unzipHard : PEEL.unzip;
                c.delay = PEEL.delay;
                // (Its outer face the lane's old bark at its warmest: rust into maroon.)
                c.outerAge = PEEL.laneAge + PEEL.laneSpread * 0.2;
                c.hard = L.hardDrop;
                curls.spawnLock(t, c);
            }
            if (L.hardDrop) {
                const strength = 0.4 + 0.6 * Math.min(1, L.distance / KNOCK.reach);
                this.events.knock(t, peel.code, peel.yBot, strength);
                if (curls) {
                    this._flakes.theta = peel.theta;
                    this._flakes.y0 = peel.yBot;
                    curls.spawnFlakes(t, this._flakes, 4 + Math.round(10 * strength));
                }
            }
        }
        // The lock's curl joins the session's sheds (the Floor's carpet counts them).
        this.sheds += 1;
        // The next run's first lock brings the morning back.
        if (this.mistfall.to > 0) this.morning(t);
    }

    /**
     * Where a lock peels (§6.0 anchors, as built): columns 0–4 the Elder's lane, 5–9 Sister One's
     * (the Elder's when hers is not on screen); across its lane the band follows its column, left
     * to right as on the board, the whole band inside the lane; its height is the piece's rows on
     * the board cast through the rest lens onto the lane's surface. Null when no lane trunk stands.
     * Reuses one record (copied by the event writer).
     */
    peelTarget(player, u, rowTop, rowBottom, code, hardDrop) {
        const near = this.parts.trunks?.near;
        if (!near) return null;
        const { lanes, placements } = this.band;
        const sister = placements[1].show && lanes[1].x0 > 0.01 && lanes[1].x1 < 0.995;
        const useSister = u >= 0.5 && sister;
        const lane = useSister ? lanes[1] : lanes[0];
        const slot = lane.code - 1;
        if (!placements[useSister ? 1 : 0].show || !near.live(slot)) return null;
        const offset = slot * TRUNK_STRIDE;
        const eyeY = this.heightAt(this.time);
        const radius = recordAxis(near.data, eyeY, this._axis, offset)[2];
        const span = lane.thetaRight - lane.thetaLeft;
        const width = useSister ? PEEL.width.sister : PEEL.width.elder;
        const half = Math.min(width / 2 / Math.max(radius, 0.3), Math.abs(span) * 0.48);
        const fx = useSister ? (u - 0.5) / 0.5 : Math.min(1, u / 0.5);
        // (Each band a little to one side or the other of its column, so a run of locks never
        // stacks into one ruled column of colour: PEEL.jitter of the lane's free width.)
        const free = Math.max(0, Math.abs(span) - 2 * half);
        const jog = (((this.counts.locks * 0.6180339887) % 1) - 0.5) * (useSister ? PEEL.jitterSister : PEEL.jitter);
        const across = Math.max(0, Math.min(1, Math.max(0, Math.min(1, fx)) + jog));
        const theta = lane.thetaLeft + Math.sign(span) * (half + across * free);
        const board = boardFor(this.layout, player);
        if (!board) return null;
        const lens = restLens(this.aspect, this._lens);
        const rowsTall = BOARD_GRID.rows;
        const syTop = board.y0 + ((board.y1 - board.y0) * Math.max(0, rowTop)) / rowsTall;
        const syBot = board.y0 + ((board.y1 - board.y0) * Math.min(rowsTall, rowBottom + 1)) / rowsTall;
        const p = this._peel;
        const top = trunkHeightAt(near.data, lens, syTop, theta, eyeY, offset, this._onTrunk)[0];
        const bot = trunkHeightAt(near.data, lens, syBot, theta, eyeY, offset, this._onTrunk)[0];
        // A ribbon, not a rectangle: taller than the rows it marks, tapering at both ends.
        const mid = (top + bot) / 2;
        const halfH = (Math.abs(top - bot) / 2) * PEEL.stretch + PEEL.extend / 2;
        p.yTop = mid + halfH;
        p.yBot = mid - halfH;
        p.radius = this._onTrunk[1];
        p.code = lane.code;
        this._peelOffset = offset;
        recordAxis(near.data, p.yTop, this._peelAxis, offset);
        p.axisX = this._peelAxis[0];
        p.axisZ = this._peelAxis[1];
        p.theta = theta;
        p.half = half;
        p.age = PIECE_AGE[Math.max(0, Math.min(PIECE_AGE.length - 1, code))];
        p.hard = hardDrop ? 1 : 0;
        return p;
    }

    /** Lines cleared: the Shed (four: the Great Moult; perfect: the Floor). Copy what is kept. */
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
        // Each cleared row's ten bark codes, flat and in step with `rows` (row k, column c at k·10 + c).
        const codes = context.rowCodes;
        C.rowCodes = Array.isArray(codes) || ArrayBuffer.isView(codes)
            ? Array.from(codes).slice(0, 40).map((code) => Math.max(0, Math.min(7, Math.round(Number(code) || 0))))
            : [];
        this.counts.clears += 1;
        this.counts.lines += lines;
        if (lines >= 4) this.counts.quads += 1;
        if (C.tspin) this.counts.tspins += 1;
        if (C.perfect) this.counts.perfects += 1;
        // Two sheet strips drop off each of the two near trunks per cleared row.
        this.sheds += lines * 4;
        // Meditation: a click (no board, a screen point) peels a band at the lane point nearest it.
        if (C.screen && !C.rows.length && !C.perfect) {
            this.clickPeel(t, C.screen);
            return;
        }
        // A perfect clear arrives on a frame of its own with no rows: the Floor.
        if (C.perfect) this.floorAt = t;
        else if (lines >= 4) this.moultStart(t);
        else if (C.tspin) this.unwind(t, C);
        else this.shed(t, C);
    }

    /**
     * The Unwinding (HELIX): a T-spin's helix on the T's side, from its top row down, one turn a
     * line; the freed strip falls as a corkscrew ribbon.
     */
    unwind(t, C) {
        const near = this.parts.trunks?.near;
        if (!near) return;
        const { lanes, placements } = this.band;
        const L = this.lastLock;
        const useSister = L.u >= 0.5 && placements[1].show;
        const lane = useSister ? lanes[1] : lanes[0];
        const slot = lane.code - 1;
        if (!near.live(slot)) return;
        const board = boardFor(this.layout, C.player);
        if (!board) return;
        const offset = slot * TRUNK_STRIDE;
        const lens = restLens(this.aspect, this._lens);
        const eyeY = this.heightAt(t);
        const theta = (lane.theta0 + lane.theta1) / 2;
        const syTop = board.y0 + ((board.y1 - board.y0) * Math.max(0, L.rowTop)) / BOARD_GRID.rows;
        const yTop = trunkHeightAt(near.data, lens, syTop, theta, eyeY, offset, this._onTrunk)[0];
        const h = this._helix;
        h.code = lane.code;
        h.yTop = yTop;
        h.turns = Math.max(1, Math.min(3, C.lines));
        h.pitch = useSister ? HELIX.pitch.sister : HELIX.pitch.elder;
        h.theta = theta;
        h.width = useSister ? HELIX.width.sister : HELIX.width.elder;
        const at = t + (this.reducedMotion ? 0 : 0);
        this.events.helix(at, h);
        // The freed strip: a long corkscrew ribbon dropping away once it has unwound.
        const { curls } = this.parts;
        if (curls) {
            recordAxis(near.data, yTop - h.turns * h.pitch * 0.5, this._axis, offset);
            const r = this._axis[2];
            const s = this._sheet;
            s.theta = theta;
            s.yTop = yTop;
            s.yBot = yTop - h.turns * h.pitch;
            s.radius = r;
            s.axisX = this._axis[0];
            s.axisZ = this._axis[1];
            s.width = h.width;
            s.unzip = HELIX.unwind;
            s.delay = HELIX.start;
            s.outerAge = PEEL.laneAge + 0.05;
            s.hard = false;
            s.kind = 6;
            curls.spawnLock(at, s);
        }
    }

    /**
     * Meditation's click (§6.13): a band peeled on the lane nearest the click (the Elder's on the
     * left half of the frame, Sister One's on the right), at the click's height, its age stepping
     * through the seven bark ages click by click; at most MEDITATION.rate a second.
     */
    clickPeel(t, screen) {
        const near = this.parts.trunks?.near;
        if (!near || t - this._lastClick < 1 / MEDITATION.rate) return;
        this._lastClick = t;
        const { lanes, placements } = this.band;
        const useSister = screen.x >= 0.5 && placements[1].show;
        const lane = useSister ? lanes[1] : lanes[0];
        const slot = lane.code - 1;
        if (!near.live(slot)) return;
        const offset = slot * TRUNK_STRIDE;
        const lens = restLens(this.aspect, this._lens);
        const eyeY = this.heightAt(t);
        const theta = (lane.theta0 + lane.theta1) / 2;
        const sy = Math.max(0.05, Math.min(0.95, screen.y));
        const y = trunkHeightAt(near.data, lens, sy, theta, eyeY, offset, this._onTrunk)[0];
        const radius = this._onTrunk[1];
        const p = this._peel;
        p.code = lane.code;
        p.yTop = y + MEDITATION.half;
        p.yBot = y - MEDITATION.half;
        p.theta = theta;
        p.half = Math.min((useSister ? PEEL.width.sister : PEEL.width.elder) / 2 / Math.max(radius, 0.3), Math.abs(lane.theta1 - lane.theta0) * 0.48);
        p.radius = radius;
        p.age = PIECE_AGE[this._clicks % 7];
        p.hard = 0;
        this._clicks += 1;
        this.events.peel(t, p);
    }

    /**
     * The visible arc of a near trunk at height y: its screen-left and screen-right bearings (the
     * silhouettes, or where the frame's edges cut it), written as [θL, span] (span < 0: from θL
     * round through the bearing that faces the eye to θR). Null when it stands nowhere in view.
     */
    visibleArc(slot, y, out) {
        const near = this.parts.trunks?.near;
        if (!near || !near.live(slot)) return null;
        const offset = slot * TRUNK_STRIDE;
        const ax = recordAxis(near.data, y, this._axis, offset);
        const d = Math.hypot(ax[0], ax[1]);
        if (!(d > ax[2] + 0.2)) return null;
        const toEye = Math.atan2(-ax[1], -ax[0]);
        const turn = Math.acos(Math.min(1, ax[2] / d)) * 0.985;
        const eyeY = this.heightAt(this.time);
        const xAt = (theta) => projectRest(this._lens, ax[0] + ax[2] * Math.cos(theta), y, ax[1] + ax[2] * Math.sin(theta), eyeY, this._proj)[0];
        // March each silhouette in toward the eye's bearing until it stands inside the frame.
        let left = toEye + turn;
        for (let i = 0; i < 40 && xAt(left) < 0.005; i++) left -= turn / 40;
        let right = toEye - turn;
        for (let i = 0; i < 40 && xAt(right) > 0.995; i++) right += turn / 40;
        if (!(left > right)) return null;
        out[0] = left;
        out[1] = right - left;
        return out;
    }

    /**
     * The Shed (SHED): each cleared row, lowest first, girdles the Elder and Sister One across
     * their visible arcs at its height, and its bark falls away in sheet pieces; a double girdles
     * the R1 trunks too (fainter, a beat later); a triple shakes sheets off the grove behind.
     */
    shed(t, C) {
        const near = this.parts.trunks?.near;
        if (!near || !C.rows.length) return;
        const board = boardFor(this.layout, C.player);
        if (!board) return;
        const lens = restLens(this.aspect, this._lens);
        const eyeY = this.heightAt(t);
        const rowH = (board.y1 - board.y0) / BOARD_GRID.rows;
        const sheets = SHED.sheets[this.quality] ?? SHED.sheets.High;
        const trunks = C.lines >= 2 ? [[1, 1, 0], [2, 1, 0], [4, SHED.second, SHED.secondDelay], [5, SHED.second, SHED.secondDelay]]
            : [[1, 1, 0], [2, 1, 0]];
        for (let r = 0; r < C.rows.length; r++) {
            const row = C.rows[r];
            const codes = C.rowCodes;
            const lo = codes.length >= r * 10 + 10 ? packCodes(codes, r * 10) : packCodes([7, 7, 7, 7, 7]);
            const hi = codes.length >= r * 10 + 10 ? packCodes(codes, r * 10 + 5) : packCodes([7, 7, 7, 7, 7]);
            const syC = board.y0 + rowH * (row + 0.5);
            for (let k = 0; k < trunks.length; k++) {
                const [code, strength, delay] = trunks[k];
                const slot = code - 1;
                if (!this.band.placements[Math.min(code - 1, 4)]?.show && code <= 5) continue;
                if (!near.live(slot)) continue;
                const offset = slot * TRUNK_STRIDE;
                const face = recordAxis(near.data, eyeY, this._axis, offset);
                const facing = Math.atan2(-face[1], -face[0]);
                const yC = trunkHeightAt(near.data, lens, syC, facing, eyeY, offset, this._onTrunk)[0];
                const yA = trunkHeightAt(near.data, lens, syC - (rowH * SHED.rows) / 2, facing, eyeY, offset, this._onTrunk)[0];
                const yB = trunkHeightAt(near.data, lens, syC + (rowH * SHED.rows) / 2, facing, eyeY, offset, this._onTrunk)[0];
                const arc = this.visibleArc(slot, yC, this._arc);
                if (!arc) continue;
                const at = t + r * SHED.stagger + delay;
                const g = this._girdle;
                g.code = code;
                g.yC = yC;
                // (Each ring its own height: SHED.vary, hashed from the row and the run's locks.)
                const vary = 1 + SHED.vary * (2 * (((row * 0.6180339887 + this.counts.locks * 0.3819660113) % 1)) - 1);
                g.halfH = Math.max(0.06, (Math.abs(yA - yB) / 2) * vary);
                g.lo = lo;
                g.hi = hi;
                g.thetaL = arc[0];
                g.span = arc[1];
                g.strength = strength;
                this.events.girdle(at, g);
                // Its bark falls away in pieces round the arc (the near pair only).
                if (code <= 2) this.shedSheets(at, slot, g, code === 1 ? sheets : Math.min(SHED.sisterSheets, sheets));
            }
        }
        if (C.lines >= 3) this.curtain(t + 0.3, 1 + Math.ceil(SHED.triple / SET.per) * C.lines);
    }

    /** A ring's bark, falling away in `n` sheet pieces across its arc (kind 5 pages). */
    shedSheets(at, slot, g, n) {
        const { curls } = this.parts;
        const near = this.parts.trunks?.near;
        if (!curls || !near) return;
        const offset = slot * TRUNK_STRIDE;
        const radius = recordAxis(near.data, g.yC, this._axis, offset)[2];
        for (let j = 0; j < n; j++) {
            // (Within the arc's middle SHED.sheetArc: a plate at the silhouette would stand out
            // past it as a thorn.)
            // (Each a little to one side of its slot and its own size, hashed per ring and slot: the
            // rings' lips stagger, never a row of piano keys.)
            const h = (((g.yC * 0.7548776662 + j * 0.6180339887) % 1) + 1) % 1;
            const jog = (h - 0.5) * SHED.sheetJog;
            const theta = g.thetaL + g.span * ((1 - SHED.sheetArc) / 2 + (SHED.sheetArc * (j + 0.5 + jog)) / n);
            const s = this._sheet;
            s.theta = theta;
            // (On Sister One's narrow arc, two lips unequal and one lower: never a pair of eyes.)
            const sister = g.code === 2;
            const drop = sister && j % 2 === 1 ? SHED.sisterDrop * g.halfH : 0;
            s.yTop = g.yC + g.halfH - drop;
            s.yBot = g.yC - g.halfH - drop;
            s.radius = radius;
            s.axisX = this._axis[0];
            s.axisZ = this._axis[1];
            const size = sister ? SHED.sisterSize[j % 2]
                : SHED.sheetSize[0] + (SHED.sheetSize[1] - SHED.sheetSize[0]) * ((h * 7.31) % 1);
            s.width = Math.min(0.75, ((Math.abs(g.span) * SHED.sheetArc * radius) / n) * 0.92 * size);
            s.unzip = SHED.bare - SHED.split;
            s.delay = SHED.split;
            // (Old bark in colour, violet to ember: never a muddy slate shard across the blaze.)
            s.outerAge = SHED.sheetAge[0] + (SHED.sheetAge[1] - SHED.sheetAge[0]) * (((j + 1) * 0.618 + g.yC * 0.13) % 1);
            s.hard = false;
            s.kind = 5;
            curls.spawnLock(at, s);
        }
    }

    /**
     * The Great Moult (MOULT): the front sweeps the grove, its bark pours away in sheets (ember,
     * ruby, violet, maroon) along it, and the near groups come back younger.
     */
    moultStart(t) {
        this.events.startMoult(t);
        this.moultAt = t;
        const { curls } = this.parts;
        if (!curls || !this._emitters.length) return;
        const count = Math.min(MOULT.sheets[this.quality] ?? MOULT.sheets.High, Math.floor(curls.events * 0.8));
        const eyeY = this.heightAt(t);
        const ages = [0.52, 0.66, 0.79, 0.885];
        curls.spawnMoult(t, count, (i, rng) => {
            const e = this.pickEmitter(rng());
            if (!e) return null;
            const when = rng();
            const el = (MOULT.from + (MOULT.to - MOULT.from) * when) * DEG;
            const y = eyeY + e.depth * Math.tan(el);
            if (y > this.u.canopyY.value - 6) return null;
            const theta = e.facing + (rng() - 0.5) * 2.2;
            const ax = recordAxis(e.draw.data, y, this._emitAxis, e.offset);
            const at = this._moultAt;
            at[0] = ax[0] + Math.cos(theta) * (ax[2] + 0.03);
            at[1] = y;
            at[2] = ax[1] + Math.sin(theta) * (ax[2] + 0.03);
            at[3] = Math.cos(theta);
            at[4] = Math.sin(theta);
            at[5] = t + MOULT.creak + (e.depth / 35) * MOULT.rankDelay + MOULT.front * when;
            at[6] = ages[Math.floor(rng() * ages.length)] + (rng() - 0.5) * 0.06;
            return at;
        });
    }

    /** The true combo changed (0 = the chain broke): a gap per link; a broken chain is the Set. */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        const t = this.time;
        if (n >= 2 && n > this.combo) this.counts.chainSteps += 1;
        // Opening the canopy: link n opens gap n − 1 (a jump of several opens each in turn); one
        // shutting after a release opens again where it stands (a rise within the Set resumes).
        if (n >= 2) {
            let k = 0;
            const upto = Math.min(this.gapOpen.length, n - 1);
            for (let i = 0; i < upto; i++) {
                const shut = this.gapClose[i] < Infinity && t >= this.gapClose[i] + GAP.close;
                if (this.gapOpen[i] === Infinity || shut) {
                    this.gapOpen[i] = t + k * GAP.stagger;
                    this.gapClose[i] = Infinity;
                    this.shakeLeaves(i, this.gapOpen[i]);
                    k += 1;
                } else if (this.gapClose[i] < Infinity) {
                    this.gapClose[i] = Infinity;
                }
            }
        }
        if (n === 0 && this.peak >= 2) {
            this.counts.releases += 1;
            this.lastRelease = { at: t, peak: this.peak };
            // The Set: the gaps shut in reverse, a curtain of curls falls off both near trunks.
            let open = 0;
            for (let i = 0; i < this.gapOpen.length; i++) {
                if (this.gapOpen[i] < Infinity && this.gapClose[i] === Infinity) open = i + 1;
            }
            for (let i = 0; i < open; i++) {
                if (this.gapOpen[i] < Infinity && this.gapClose[i] === Infinity) {
                    this.gapClose[i] = t + (open - 1 - i) * GAP.stagger;
                }
            }
            this.curtain(t, this.peak);
        }
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
        this.combo = n;
    }

    /** How far gap i stands open at time t (0 … 1, closed form). */
    gapOpenAt(i, t) {
        const o = this.gapOpen[i];
        if (!(t >= o)) return 0;
        const a = smoother((t - o) / GAP.open);
        const c = this.gapClose[i];
        const b = t >= c ? smoother((t - c) / GAP.close) : 0;
        return a * (1 - b);
    }

    /**
     * The stations the gaps' pools land on (GAP.stations, §4.10): a point on a lane (the Elder's,
     * Sister One's; Sister Two's face) at the station's screen row, cast up the sun's ray to the
     * canopy plane, where the gap is. Solved every frame from the live band (cheap, allocation-free):
     * the pools stay on the lanes through a Climb or a new layout.
     */
    solveStations(eyeY) {
        const near = this.parts.trunks?.near;
        const { gaps } = this.events;
        if (!near) return;
        const { lanes, placements } = this.band;
        const table = this.aspect < 1 ? GAP.stations.tall : GAP.stations.wide;
        const lens = restLens(this.aspect, this._lens);
        const L = this._sun;
        const k = Math.max(L[1], 0.2);
        const radius = eyeY >= GAP.high ? GAP.radius[1] : GAP.radius[0];
        for (let i = 0; i < gaps.length; i++) {
            let code = table[i][0];
            const sy = table[i][1];
            if (code === 2 && !placements[1].show) code = 1;
            if (code === 3 && !placements[2].show) code = placements[3].show ? 4 : 1;
            const slot = code - 1;
            const g = gaps[i];
            if (!near.live(slot)) {
                g.open = 0;
                continue;
            }
            const offset = slot * TRUNK_STRIDE;
            const lane = code === 1 || code === 2 ? lanes[code - 1] : null;
            const ax = recordAxis(near.data, eyeY, this._axis, offset);
            const theta = lane ? (lane.theta0 + lane.theta1) / 2 : Math.atan2(-ax[1], -ax[0]);
            const y = trunkHeightAt(near.data, lens, sy, theta, eyeY, offset, this._onTrunk)[0];
            const r = this._onTrunk[1];
            recordAxis(near.data, y, this._axis, offset);
            const px = this._axis[0] + r * Math.cos(theta);
            const pz = this._axis[1] + r * Math.sin(theta);
            const up = (this.u.canopyY.value - y) / k;
            g.qx = px + L[0] * up;
            g.qz = pz + L[2] * up;
            g.radius = radius;
            g.open = this.gapOpenAt(i, this.time);
            // Where its leaves shake down from: over the station, at the top of the frame there.
            const st = this._stations[i];
            st.x = px + Math.cos(theta) * 0.6;
            st.z = pz + Math.sin(theta) * 0.6;
            st.y = trunkHeightAt(near.data, lens, -0.02, theta, eyeY, offset, this._onTrunk)[0];
            st.ok = true;
        }
    }

    /** A gap opening shakes leaf bits from the crowns over its station. */
    shakeLeaves(i, at) {
        const st = this._stations[i];
        if (!st?.ok) return;
        const count = Math.round(GAP.leaves * (this.tier.curlsEvent >= 96 ? 1 : 0.6));
        this.parts.curls?.spawnLeaves(at, st.x, st.y, st.z, count);
    }

    /**
     * The Set's curtain: min(SET.per·(peak − 1), half the tier's event curls) curls off the near
     * trunks' lanes (the Elder's and Sister One's, alternately), from the top of the frame down to
     * its middle, spawned top to bottom over SET.over seconds.
     */
    curtain(t, peak) {
        const { curls } = this.parts;
        const near = this.parts.trunks?.near;
        if (!curls || !near) return;
        const count = Math.min(SET.per * (peak - 1), Math.floor(curls.events / 2));
        const { lanes, placements } = this.band;
        const lens = restLens(this.aspect, this._lens);
        const eyeY = this.heightAt(t);
        const at = this._curtainAt;
        curls.spawnCurtain(t, count, SET.over, (i, n) => {
            const useSister = i % 2 === 1 && placements[1].show;
            const lane = useSister ? lanes[1] : lanes[0];
            const slot = lane.code - 1;
            if (!near.live(slot)) return null;
            const offset = slot * TRUNK_STRIDE;
            const f = n > 1 ? i / (n - 1) : 0;
            const theta = lane.theta0 + (lane.theta1 - lane.theta0) * ((i * 0.618) % 1);
            const sy = 0.02 + 0.5 * f;
            const y = trunkHeightAt(near.data, lens, sy, theta, eyeY, offset, this._onTrunk)[0];
            const r = this._onTrunk[1];
            recordAxis(near.data, y, this._axis, offset);
            at[0] = this._axis[0] + Math.cos(theta) * (r + 0.03);
            at[1] = y;
            at[2] = this._axis[1] + Math.sin(theta) * (r + 0.03);
            at[3] = Math.cos(theta);
            at[4] = Math.sin(theta);
            return at;
        });
    }

    /** The live back-to-back level (0 = the chain broke … 3): the Sunshower. */
    onB2B(level) {
        const n = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
        if (n > this.b2b) this.counts.b2bSteps += 1;
        this.b2b = n;
    }

    /** The run ended: Mistfall. The mist rises past the camera. */
    onGameOver() {
        const t = this.time;
        this.mistfall = {
            from: this.mistfallAt(t), to: 1, start: t, length: MISTFALL_TIME,
        };
        this.counts.gameOvers += 1;
    }

    /** A mode started: a waiting descent happens now, and the morning drains the mist. */
    onSessionStart() {
        const t = this.time;
        if (this.climb && this.climb.start > t && this.climb.length === 0) this.climb.start = t;
        this.sessionAge = 0;
        if (this.mistfall.to > 0) this.morning(t);
    }

    /** Morning returns: the mist drains back to the zone's tide. */
    morning(t) {
        this.mistfall = {
            from: this.mistfallAt(t), to: 0, start: t, length: MORNING_TIME,
        };
        this.counts.mornings += 1;
    }

    /**
     * A new level: the Climb. It waits until CLIMB_DELAY after the latest clear (the shed reads
     * first, at a still camera), then rises a storey and crossfades into the new zone. Silent
     * (a rebuild mid-run) jumps straight to the right height. Under reduced motion the camera
     * jumps and the zone crossfades; a wrap down (level 13) jumps for now.
     */
    levelUp(level, { silent = false } = {}) {
        const lv = Math.max(1, Math.round(Number(level) || 1));
        const t = this.time;
        this.level = lv;
        const to = climbHeight(lv);
        const zoneTo = zoneIndex(lv);
        // (A new level heals the last one's helices: their scars belong to the level they were made in.)
        if (!silent) this.events.healHelices(t);
        if (silent || !this.u) {
            this.climb = null;
            this.camY = to;
            this.zone = zoneTo;
            this.placeGrove(to);
            return;
        }
        this.counts.levelUps += 1;
        const from = this.heightAt(t);
        const now = this.zoneAt(t);
        const zoneFrom = now.mix < 0.5 ? now.a : now.b;
        const still = this.reducedMotion || to < from;
        this.climb = {
            from,
            to,
            start: Math.max(t, this.lastClear.at + CLIMB_DELAY),
            length: still ? 0 : CLIMB_TIME,
            zoneFrom,
            zoneTo,
            zoneLength: this.reducedMotion ? CLIMB_FADE : CLIMB_TIME,
        };
    }

    /** Prime the session state a capture asks for: minutes since it began, curls shed so far. */
    primeSession({ minutes, sheds } = {}) {
        if (Number.isFinite(minutes)) this.sessionAge = Math.max(0, minutes) * 60;
        if (Number.isFinite(sheds)) this.sheds = Math.max(0, Math.round(sheds));
    }

    /** The grove's age bias for the session so far (§3.4). */
    ageBias() {
        return Math.min(AGE_BIAS_CAP, AGE_BIAS_START + (AGE_BIAS_RATE * this.sessionAge) / 60);
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        this.sessionAge += dt;
        // Quickening: while a chain lives the bark's clocks run fast (eased, integrated: a rate that
        // changes never jumps the phase); the canopy's wind blows further from ×QUICKEN.gust.
        for (let g = 0; g < 4; g++) {
            const target = quickenRate(g, this.combo);
            const tau = target > this.rates[g] ? QUICKEN.rise : QUICKEN.fall;
            this.rates[g] += (target - this.rates[g]) * approach(1 / tau, dt);
            this.clocks[g] = (this.clocks[g] + dt * this.rates[g]) % CLOCK_WRAP;
        }
        // The Sunshower: rain eases in with the back-to-back run and out when it breaks; the
        // grove wets quickly and dries slowly.
        const rainTo = this.b2b / 3;
        const step = dt / (rainTo > this.rain ? RAIN.fadeIn : RAIN.fadeOut);
        this.rain = rainTo > this.rain ? Math.min(rainTo, this.rain + step) : Math.max(rainTo, this.rain - step);
        const wetTo = RAIN.wet[Math.max(0, Math.min(3, this.b2b))];
        this.wet += (wetTo - this.wet) * approach(wetTo > this.wet ? 1 : 1 / RAIN.dry, dt);
        const windTo = this.combo >= QUICKEN.gust ? QUICKEN.wind : 1;
        this.windBoost += (windTo - this.windBoost) * approach(1 / QUICKEN.windTau, dt);

        // ── Where the walkway is, which zone, and how high the mist stands ──
        const camY = this.heightAt(t);
        const zm = this.zoneAt(t);
        const za = ZONES[zm.a];
        const zb = ZONES[zm.b];
        const k = zm.mix;
        const fall = this.mistfallAt(t);
        const clockA = tideClock(t, za, this._tideA);
        const clockB = tideClock(t, zb, this._tideB);
        const tideBase = lerp(clockA.tide, clockB.tide, k);
        // (The Floor drains the mist far below the walkway, then lets it back.)
        const floorK = floorEnvelope(t - this.floorAt);
        const tide = lerp(lerp(tideBase, FLOOR.tide, floorK), camY + MISTFALL.tideLift, fall);
        this.settleClimb(t);
        // The grove pivots at the eye's storey: while the walkway climbs it is re-stood each frame.
        if (!(Math.abs(camY - this._pivot) < 0.02)) this.placeGrove(camY);

        // ── Uniforms ──
        u.time.value = t;
        u.camY.value = camY;
        u.tide.value = tide;
        u.hazeY.value = lerp(za.tideTop, zb.tideTop, k);
        u.sigmaA.value = lerp(za.sigmaA, zb.sigmaA, k) * (1 - (1 - FLOOR.clear) * floorK);
        u.drain.value = floorK;
        u.carpet.value = 1 - Math.exp(-this.sheds / FLOOR.carpet);
        u.scaleHeight.value = lerp(za.scaleHeight, zb.scaleHeight, k);
        u.sigmaM.value = lerp(za.sigmaM, zb.sigmaM, k);
        // The billows' grain at the storeys the Climb runs between: a whole number, snapped at the
        // Climb's midpoint (a fractional grain would zoom the whole floor round the world origin).
        const { climb } = this;
        const grainA = mistGrainAt(climb ? climb.from : camY, za);
        const grainB = mistGrainAt(climb ? climb.to : camY, zb);
        u.mistGrain.value = k < 0.5 ? grainA : grainB;
        // (Swapped while the floor is flat: billowContrast.)
        u.billowK.value = billowContrast(k, grainA, grainB);
        // The tide clock (the same in every zone): the haze thickens toward high water on rays at
        // and above the horizon, the vapour begins higher over the tide, the sheets and wisps follow.
        u.airGain.value = clockA.air;
        u.mistOnset.value = mistOnset(clockA.onset, tide, camY);
        u.tideHigh.value = clockA.high;
        u.tideRise.value = clockA.rise;
        const sway = SUN_DRIFT * -Math.cos((TAU * t) / TIDE_PERIOD);
        const sun = sunDirection(lerp(za.sunElevation, zb.sunElevation, k), SUN_AZIMUTH + sway, this._sun);
        u.sunDir.value.set(sun[0], sun[1], sun[2]);
        this.writeFlecks(t, camY, k, clockA.fleckGain * (1 - fall), sun[1]);
        const drift = mistDrift(t, this._drift);
        u.mistDrift.value.set(drift[0], drift[1], drift[2]);
        lightWheelAt(t, this._wheel);
        this.writePalette(zm, fall);
        this.writeBark(clockA);
        // The board's marks: the live slots of every block, compacted, and their counts.
        this.solveStations(camY);
        const live = this.events.write(u.tables.events, t);
        u.peelCount.value = live.peels;
        u.knockCount.value = live.knocks;
        u.girdleCount.value = live.girdles;
        u.rain.value = this.rain;
        u.wet.value = this.wet;
        u.rainLength.value = this.reducedMotion ? 0.5 : 1;
        u.helixCount.value = live.helices;
        u.gapCount.value = live.gaps;
        // The grove's own shedding: fewer while a run is being played, fewest under Mistfall.
        const { curls } = this.parts;
        if (curls) {
            const S = this._curlScene;
            const playing = this.layoutLive && t - this.lastLock.at < 20;
            S.share = playing ? CURL.live : 1;
            if (fall > 0.5) S.share = 0.2;
            S.eyeY = camY;
            S.tide = tide;
            S.canopyY = u.canopyY.value;
            restLens(this.aspect, this._lens);
            curls.updateAmbient(t, S);
            curls.commit();
        }

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
        post.exposure = lerp(lerp(za.exposure, zb.exposure, k), MISTFALL.exposure, fall);
        // (The light wheel's mood: a touch brighter at noon, a touch lower in the gold.)
        const W = this._wheel;
        post.exposure *= lerp(1, lerp(LIGHT_WHEEL.moods[W.a].exposure, LIGHT_WHEEL.moods[W.b].exposure, W.mix), 1 - fall);
        // The Great Moult's naked First Skin is held under the shoulder by the iris (MOULT.iris
        // stops at most; it rises with the bared skin and decays as the colour climbs back).
        const mt = t - this.moultAt;
        const env = mt >= 0 && mt < 20
            ? smoother((mt - MOULT.creak - 0.2) / MOULT.rise) * (mt < MOULT.ripenAt ? 1 : Math.exp(-(mt - MOULT.ripenAt) / MOULT.decay)) : 0;
        post.iris = 2 ** (-MOULT.iris * env);
        // (The Floor lifts the frame a little, slowly: FLOOR.lift stops at most.)
        post.exposure *= 2 ** (FLOOR.lift * floorEnvelope(t - this.floorAt));
        u.exposure.value = post.exposure * post.iris;
        post.sat = lerp(lerp(za.sat, zb.sat, k), MISTFALL.sat, fall);
        post.bloomBoost = 0;
        u.iris.value = 1 / post.iris;
    }

    /**
     * The canopy's gobo (§4.5): its wind (two octaves and the gusts, closed form in the clock),
     * the threshold and mean light of the storeys a Climb runs between (crossfaded with the zone),
     * the flecks' light (the tide clock's gain, none under Mistfall) and the eye's level of the
     * mask (what Low and Minimal read everywhere).
     */
    writeFlecks(t, camY, k, light, sunY) {
        const { u, climb } = this;
        const wind = canopyWind(t, this._wind, windScaleAt(camY, sunY) * this.windBoost);
        u.wind.value.set(wind[0], wind[1]);
        const a = fleckFor(storeyOf(climb ? climb.from : camY));
        const b = fleckFor(storeyOf(climb ? climb.to : camY));
        u.fleckThr.value = lerp(a.thr, b.thr, k);
        u.fleckMean.value = lerp(a.mean, b.mean, k);
        u.fleckLight.value = light;
        u.fleckLod.value = fleckLodAt(camY, sunY);
    }

    /** The zone colours (and the shade row's pearl), crossfaded over the Climb and under the Mistfall look. */
    writePalette(zm, fall) {
        const table = this.u.tables.palette;
        const A = this._zoneRgb[zm.a];
        const B = this._zoneRgb[zm.b];
        const M = this._mistRgb;
        const c = this._rgb;
        const pearl = lerp(lerp(ZONES[zm.a].pearl, ZONES[zm.b].pearl, zm.mix), MISTFALL.pearl, fall);
        // The light wheel's moods tint the zone's colours (none under Mistfall's grey).
        const W = this._wheel;
        const moodA = LIGHT_WHEEL.moods[W.a].tint;
        const moodB = LIGHT_WHEEL.moods[W.b].tint;
        for (let i = 0; i < ZONE_COLOR_KEYS.length; i++) {
            const key = ZONE_COLOR_KEYS[i];
            const tA = moodA[key];
            const tB = moodB[key];
            for (let ch = 0; ch < 3; ch++) {
                const tint = lerp(lerp(tA ? tA[ch] : 1, tB ? tB[ch] : 1, W.mix), 1, fall);
                c[ch] = lerp(lerp(A[key][ch], B[key][ch], zm.mix), M[key][ch], fall) * tint;
            }
            table[PALETTE_ROWS[key]].set(c[0], c[1], c[2], key === 'hazeShade' ? pearl : 1);
            const grade = key === 'gradeShadow' ? this._post.gradeShadow : null;
            const out = key === 'gradeLight' ? this._post.gradeLight : grade;
            if (out) {
                out[0] = c[0];
                out[1] = c[1];
                out[2] = c[2];
            } else if (key === 'fleck') this.writeSun(c);
        }
    }

    /**
     * The sun's light: the Bole's strength, SUN_WHITE (a tenth) white and the rest the zone's fleck
     * colour (which makes the Bole's own sun: SUN_BOLE), so a fleck on the cool slate still lands
     * cream-gold (warm on cool, §2.1).
     */
    writeSun(fleck) {
        const peak = Math.max(1e-4, fleck[0], fleck[1], fleck[2]);
        const k = SUN_BOLE[0];
        const w = SUN_WHITE;
        this.u.sunCol.value.set(
            k * (w + ((1 - w) * fleck[0]) / peak),
            k * (w + ((1 - w) * fleck[1]) / peak),
            k * (w + ((1 - w) * fleck[2]) / peak),
        );
    }

    /**
     * The bark's clocks and light: the four group clocks, the grove's age bias (and the group
     * means the far bark fades to, recomputed when the bias moves), the sheen over the tide clock.
     */
    writeBark(clock) {
        const { u } = this;
        const c = this.clocks;
        u.groupClock.value.set(c[0], c[1], c[2], c[3]);
        const bias = this.ageBias();
        // After a Great Moult the near groups stand younger (MOULT.bias), relaxing back to the
        // grove's drift over MOULT.relax seconds (set once its new skin is bared, never seen jump).
        const since = this.time - this.moultAt;
        const young = since >= 1 ? 1 - smoother((since - 1) / MOULT.relax) : 0;
        const nearBias = lerp(bias, MOULT.bias, young);
        u.ageBias.value.set(nearBias, nearBias, nearBias, bias);
        if (!(Math.abs(bias - this._meanBias) < 2e-3) || !(Math.abs(nearBias - this._meanNear) < 2e-3)) {
            this._meanBias = bias;
            this._meanNear = nearBias;
            const table = u.tables.palette;
            for (let g = 0; g < 4; g++) {
                const m = groupMean(g < 3 ? nearBias : bias, this.matrixShare, this._mean, this.islandShare);
                table[PALETTE_ROWS.groupMean + g].set(m[0], m[1], m[2], m[3]);
            }
        }
        // Clearing (low tide) 0.6 … immersion (high tide) 1.0.
        // (The Set: the quickened bark sets, its sheen dipping for a few seconds.)
        const set = this.time - this.lastRelease.at;
        const dip = set >= 0 && set < SET.sheenFor
            ? smoother(set / 0.4) * (1 - smoother((set - SET.sheenFor + 1.2) / 1.2)) : 0;
        u.sheenK.value = clock.sheen * (1 - SET.sheen * dip);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const t = this.time;
        const zm = this.zoneAt(t);
        const zone = zm.mix < 0.5 ? zm.a : zm.b;
        return {
            quality: this.quality,
            time: t,
            level: this.level,
            zone: ZONES[zone].name,
            zoneMix: zm.mix,
            light: LIGHT_WHEEL.moods[this._wheel.mix < 0.5 ? this._wheel.a : this._wheel.b].name,
            lightPlace: this._wheel.place,
            camY: this.heightAt(t),
            climbing: Boolean(this.climb),
            tide: this.u ? this.u.tide.value : null,
            tidePhase: this._tideA.name,
            mistfall: this.mistfallAt(t),
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            sheds: this.sheds,
            ageBias: this.ageBias(),
            fov: fovForAspect(this.aspect),
            pitch: pitchForAspect(this.aspect),
            counts: { ...this.counts },
            marks: { ...this.events.counts, moult: this.events.moult.active },
            rain: this.rain,
            wet: this.wet,
            drain: this.u ? this.u.drain.value : 0,
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
