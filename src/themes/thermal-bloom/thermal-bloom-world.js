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
    chaliceSchedule,
    columnHeight,
    FUMAROLES,
    fumarolePlan,
    jewelPlan,
    pinePlan,
    plumePlan,
    rigFrame,
} from './thermal-bloom-tsl.js';
import { tierFor } from './thermal-bloom-quality.js';
import { createSky } from './thermal-bloom-sky.js';
import { createBasin } from './thermal-bloom-basin.js';
import { createTerraces } from './thermal-bloom-terraces.js';
import { createFumaroles, createMist, createSteam } from './thermal-bloom-steam.js';
import {
    COLUMN_KIND, COLUMN_SLOT, createChalice, createColumns, createSpray,
} from './thermal-bloom-geyser.js';
import { createPines } from './thermal-bloom-flora.js';
import { bakeCellular, bakeNoise, bakeRamp } from './thermal-bloom-bake.js';
import { cardUnion, fallbackLayout } from './thermal-bloom-composition.js';

/** The rest camera's clip planes and the bounds of its field of view (degrees). */
export const REST_RIG = Object.freeze({
    near: 1.5,
    far: 24000,
    minFov: 40,
    maxFov: 66,
});

/** Every part of the picture, in draw order of build (the URL reference lists the same names). */
export const THERMAL_BLOOM_PARTS = Object.freeze(['sky', 'basin', 'terraces', 'steam', 'geyser', 'flora', 'fx']);

/** The plume sheets, the ground mist and the fumaroles, as one part. */
function buildSteam(world) {
    const sheets = createSteam(world.u, world.tier, world.tex);
    const mist = world.tier.mistSheets > 0 ? createMist(world.u, world.tier, world.tex) : null;
    const fumaroles = createFumaroles(world.u, FUMAROLES.length, world.tex);
    const group = new THREE.Group();
    group.name = 'ThermalBloomSteamGroup';
    group.add(sheets.mesh);
    if (mist) group.add(mist.mesh);
    group.add(fumaroles.mesh);
    return {
        mesh: group,
        sheets,
        mist,
        fumaroles,
        place: (x, z) => mist?.place(x, z),
        dispose: () => {
            [sheets, mist, fumaroles].forEach((p) => {
                p?.geometry.dispose();
                p?.material.dispose();
            });
        },
    };
}

/** The Chalice's cone, the eruption columns and the spray, as one part. */
function buildGeyser(world) {
    const chalice = createChalice(world.u, world.tier, world.tex);
    const columns = createColumns(world.u, world.tier, world.tex);
    const spray = createSpray(world.u, world.tier);
    const group = new THREE.Group();
    group.name = 'ThermalBloomGeyserGroup';
    [chalice, columns, spray].forEach((p) => group.add(p.mesh));
    return {
        mesh: group,
        chalice,
        columns,
        spray,
        place: (x, y, z) => chalice.place(x, y, z),
        dispose: () => {
            [chalice, columns, spray].forEach((p) => {
                p.geometry.dispose();
                p.material.dispose();
            });
        },
    };
}

/**
 * The three spouters round the Chalice's hill: offsets from its vent (metres; y below the vent's
 * base, on the hill's skirt) and their periods (§1.4: 7, 11, 13 s).
 */
const SPOUTERS = Object.freeze([
    Object.freeze({
        dx: -34, dz: 22, dy: -4.2, period: 7, phase: 1.3,
    }),
    Object.freeze({
        dx: 38, dz: 12, dy: -5.0, period: 11, phase: 4.1,
    }),
    Object.freeze({
        dx: -16, dz: -36, dy: -4.6, period: 13, phase: 8.7,
    }),
]);

/** Builders of the parts that exist so far. */
const PART_BUILDERS = Object.freeze({
    sky: (world) => createSky(world.u, world.tier, world.tex),
    basin: (world) => createBasin(world.u, world.tier, world.tex),
    terraces: (world) => createTerraces(world.u, world.tier, world.tex),
    steam: buildSteam,
    geyser: buildGeyser,
    flora: (world) => createPines(world.u, world.tier.pines),
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
        this.lastRelease = { at: -1e6, peak: 0, length: 0 };
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
        this.parts.steam?.fumaroles?.setVents(fumarolePlan(plan));
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
        steam?.place(plan.eye[0], plan.eye[2]);
    }

    /**
     * The eruption columns' rows from the closed-form schedules: the Chalice's idle cycle and its
     * preplay splashes, the spouters; the Consort's and the Sleeper's slots stay dormant until
     * their events (stage B). After the Chalice's water, its steam thread thickens for the steam
     * phase.
     */
    writeColumns(t) {
        const { u, plan } = this;
        if (!u || !plan) return;
        const rows = u.tables.events;
        const at = EVENT_ROWS.eruptions;
        const set = (slot, x, z, base, height, radius, flare, kind) => {
            rows[at + slot * 2].set(x, z, base, height);
            rows[at + slot * 2 + 1].set(radius, 0, flare, kind);
        };
        const [cx, cy, cz] = plan.chalice;
        const vent = cy + CHALICE.height - 0.4;
        const sched = chaliceSchedule(t, this._sched || (this._sched = {}));
        let height = 0;
        let radius = 1.2;
        if (sched.eruptionAge >= 0 && sched.eruptionAge < IDLE_WATER + 1) {
            height = columnHeight('idle', sched.eruptionAge);
            radius = 2.4;
        } else if (sched.preplayAge >= 0) {
            // A cluster of 2–4 splashes, each about a second apart.
            const k = Math.floor(sched.preplayAge / 1.2);
            if (k < sched.splashes) {
                height = columnHeight('preplay', sched.preplayAge - k * 1.2, 2 + 2 * sched.preplaySeed);
            }
            radius = 0.9;
        }
        set(COLUMN_SLOT.chalice, cx, cz, vent, height, radius, 0.6, COLUMN_KIND.water);
        set(COLUMN_SLOT.consort, 0, 0, 0, 0, 1, 0, COLUMN_KIND.water);
        set(COLUMN_SLOT.sleeper, 0, 0, 0, 0, 1, 0, COLUMN_KIND.water);
        SPOUTERS.forEach((sp, i) => {
            const mirror = this.mirrored ? -1 : 1;
            const age = (t + sp.phase) % sp.period;
            set(
                COLUMN_SLOT.spouter0 + i,
                cx + sp.dx * mirror,
                cz + sp.dz,
                cy + sp.dy,
                columnHeight('spouter', age),
                0.5,
                0.3,
                COLUMN_KIND.spouter,
            );
        });
        u.eruptionCount.value = COLUMN_SLOT.spouter0 + SPOUTERS.length;
        // The steam phase: the thread swells for IDLE_STEAM seconds after the water.
        if (this.threadSlot >= 0) {
            const age = sched.eruptionAge - IDLE_WATER;
            const live = age > -1.5 && age < IDLE_STEAM;
            const swell = live ? Math.sin(Math.PI * Math.min(1, (age + 1.5) / (IDLE_STEAM + 1.5))) : 0;
            u.tables.plumes[this.threadSlot * 2 + 1].z = this.threadDensity * (1 + 2.5 * swell);
        }
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
        this.lastEventAt = t;
        // The next run's first lock refills a drained Chalice.
        if (this.drain.at > this.drain.refillAt) this.refill(t);
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
        if (lines >= 4) this.counts.quads += 1;
        if (C.tspin) this.counts.tspins += 1;
        if (C.perfect) this.counts.perfects += 1;
        if (C.cascade > 1) this.counts.cascades += 1;
        // Every cleared row lays a stripe in the stone record.
        this.records += C.perfect ? 0 : lines;
        this.lastEventAt = t;
    }

    /** The true combo changed (0 = the chain broke): a splash a link; a broken chain steams. */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        const t = this.time;
        if (n >= 2 && n > this.combo) this.counts.chainSteps += 1;
        if (n === 0 && this.peak >= 2) {
            this.counts.releases += 1;
            this.lastRelease = { at: t, peak: this.peak, length: steamPhaseLength(this.peak) };
        }
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
        this.combo = n;
        if (n > 0) this.lastEventAt = t;
    }

    /** The live back-to-back level (0 = the chain broke … 3): the Consort. */
    onB2B(level) {
        const n = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
        if (n > this.b2b) this.counts.b2bSteps += 1;
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

    /** Pre-fill the stone record with n stripes (captures). */
    primeRecord(n) {
        if (Number.isFinite(n)) this.records = Math.max(0, Math.round(n));
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
        const vividTarget = 1;
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
