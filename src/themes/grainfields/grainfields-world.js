/**
 * Grainfields — one shared world (the theme and the playground mount the same one).
 *
 * Grain country under a breaking storm: the barley round the eye, the land (the patchwork, the
 * path, the vale, the fort's knoll, the ridges' forest), Lapporten on the horizon, the
 * shelterbelts' trees, the sky with its deck, the locks' sunbeams and the motes in the air; and
 * everything gameplay does to them (grainfields-reactions.js holds the event language).
 *
 * What an event throws into the air over the stand reads at every hour, storm or not
 * (grainfields-chaff.js): a lock lifts a puff of chaff in the piece's colour through its beam; a
 * hard drop bursts a cloud of dust and a fountain of husks out of the barley; a clear's lane of
 * wind carries the rows' chaff out along it; a twist raises a dust devil that walks the field
 * (grainfields-devil.js), its flakes wound up round it; four lines burst light through the gate
 * (grainfields-gate-rays.js) and their gust comes in across the barley with a wall of chaff
 * streaming past the eye; a perfect clear's still air fills with gold dust rising; a level-up
 * turns the day in time-lapse, the deck racing over.
 *
 * How hot play runs (src/themes/shared/gameplay-surge.js) builds the storm's break across a run:
 * calm, the world as it stands; warm, the wind rises in the barley and the beams stand wider;
 * hot, the gusts race over the field, the deck runs faster and tears open even without a chain,
 * the horses lift their heads; fever, the storm breaks wide (past the chain's last step), the sun
 * pours through gold, the herd gallops and a skein of geese lifts off for the gate. A perfect
 * clear is the release (the sky clears and the wind stills); at rest it all breathes back.
 *
 * Lifecycle: `await GrainfieldsWorld.prepare(quality, { signal })` lays the land's mesh and the
 * planted things out in slices; `new GrainfieldsWorld({ ..., prepared }).build()` makes the scene
 * objects; each frame `updateCamera` → `update` → the post renders.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { breathe, drainSteps, stepClock } from '../shared/build-steps.js';
import { GameplaySurge } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    DECK, DEG, EYE, PIECE_COLORS, PLACES, RIG, TAU, TIMING, clamp, hexToLinear, rigFor, smooth,
} from './grainfields-core.js';
import {
    HOURS, HourWheel, applyHarvestNight, blendLight, copyLight, createLight, lightAt,
} from './grainfields-hours.js';
import { tierFor } from './grainfields-quality.js';
import {
    CLOSE_STAND, PATH, PATH_POINTS, PLANT_SLICE_MS, flowerWidth, grainSitesSteps, groundHeight, pathDistance,
    treeSites,
} from './grainfields-plan.js';
import { createNoiseTexture, createUniforms, deckThreshold } from './grainfields-tsl.js';
import { createLandSteps, fanSteps } from './grainfields-land.js';
import { createLapportenSteps, gateHeight } from './grainfields-lapporten.js';
import { createSky } from './grainfields-sky.js';
import { createForestSteps } from './grainfields-forest.js';
import { disposeGrainfieldsAssets, loadGrainfieldsAssets } from './grainfields-assets.js';
import { createGrainSteps } from './grainfields-grain.js';
import { createBeams } from './grainfields-beams.js';
import { createMotes } from './grainfields-motes.js';
import { CHAFF_KIND, DEVIL_WALK, createChaff } from './grainfields-chaff.js';
import { createDevils } from './grainfields-devil.js';
import { createGateRays } from './grainfields-gate-rays.js';
import { createLensEars } from './grainfields-lens.js';
import { createFort } from './grainfields-fort.js';
import { createGeese } from './grainfields-geese.js';
import {
    askTakeoffs, planTakeoff, stepTakeoffs, takeoffSteps,
} from './grainfields-goose-flight.js';
import { createHerd } from './grainfields-herd.js';
import { createTrample } from './grainfields-trample.js';
import { createHerdShadow } from './grainfields-herd-shadow.js';

import { GUST, GrainfieldsReactions, freeColumn } from './grainfields-reactions.js';
import { cardUnion, fallbackLayout } from './grainfields-composition.js';

export const GRAINFIELDS_PARTS = Object.freeze([
    'grain', 'land', 'lapporten', 'fort', 'trees', 'herd', 'geese', 'sky', 'rays', 'beams', 'devils', 'chaff', 'motes', 'lens',
]);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;
export const PIECE_LINEAR = PIECE_COLORS.map((c) => hexToLinear(c));

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'twists', 'perfects', 'chainSteps', 'b2bSteps',
    'levelUps', 'gameOvers', 'mornings', 'spins',
];
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'duskFrom', 'duskTarget', 'duskAt', 'levelUpAt', 'lapseFrom', 'lapseTo',
    'lapseAt',
]);

/**
 * A level-up turns the day in time-lapse: over `span` seconds the deck runs `run` seconds of its
 * drift further than the clock alone carries it (clouds racing over, their shadows with them).
 */
export const LAPSE = Object.freeze({ span: 5, run: 170 });
/** A hard drop's burst is whole again this long after the last one (seconds). */
const BURST_CLEARS = 3.5;
/** Chaff's gold (linear), for what no piece gives its colour. */
const CHAFF_GOLD = Object.freeze([1, 0.82, 0.45]);

/** Where a four-line tear aims: the sun's ray to this height over the gate (metres). */
const GATE_TEAR_HEIGHT = 1800;
/** The deck's drift (metres per second of clock): a constant wind aloft, from the west-south-west. */
const DECK_WIND = Object.freeze([9.5, 3.2]);
/**
 * The shafts before the fells: where each lands (degrees off the bearing to the gate, metres out),
 * how far and how fast it wanders, and its gap's radius (metres) and breathing rate.
 */
const RAY_LANDINGS = Object.freeze([
    Object.freeze({
        bearing: -9, distance: 4200, wander: 5, pace: 0.017, radius: 190, breathe: 0.037,
    }),
    Object.freeze({
        bearing: -2, distance: 6000, wander: 6, pace: 0.013, radius: 230, breathe: 0.029,
    }),
    Object.freeze({
        bearing: 6, distance: 7600, wander: 5, pace: 0.019, radius: 170, breathe: 0.041,
    }),
    Object.freeze({
        bearing: 13, distance: 5000, wander: 4, pace: 0.011, radius: 150, breathe: 0.033,
    }),
]);
/** The gusts in the grain travel along the wind at this speed (metres per second). */
const GUST_SPEED = 7.5;
/** A level-up's (or a fever's) flight out goes up at most once in this long (two can be in the air at once). */
const SKEIN_AWAY = 45;
/** The take-off routes' slices in the stepped build (ms; a frame's share after it, goose-flight's own). */
const TAKEOFF_BUILD_SLICE_MS = 8;

/**
 * How far the sun's own gap swings off the eye's line under a heavy deck (shares of its radius):
 * `rest` its mean, `sway` and `flicker` two slow swells over it (their rates per second of
 * clock), `turn` how fast the side it swings to goes round. Its clear heart is about a third of
 * the radius and its torn edge reaches about the radius. Both swells start at their least, so a
 * run opens with the field in the sun and the storm's shade sweeps in over the first half-minute.
 */
export const SUN_GAP_SWING = Object.freeze({
    rest: 0.5, sway: 0.32, swayRate: 0.043, flicker: 0.14, flickerRate: 0.11, turn: 0.017,
});

/** The sun's gap's swing off the eye's line (a share of its radius) for the clock and the deck. */
export function sunGapSwing(time, cover, breaking = 0) {
    const S = SUN_GAP_SWING;
    const storm = smooth(0.6, 0.85, cover) * (1 - clamp(breaking, 0, 1));
    const swell = S.rest - S.sway * Math.cos(time * S.swayRate) - S.flicker * Math.cos(time * S.flickerRate);
    return storm * Math.max(0, swell);
}

/**
 * Everything heavy a world needs before its scene objects: the land's mesh data. One clock for
 * all of it: each piece yields once it has run PLANT_SLICE_MS (the fan's rows and the barley's
 * tries; the near stand was one ~59 ms step, 2026-10-31).
 */
function* prepareSteps(quality) {
    const tier = tierFor(quality);
    const clock = stepClock(PLANT_SLICE_MS);
    const fan = yield* fanSteps(tier.fan.cols, tier.fan.rows, clock);
    const trees = treeSites();
    yield 'trees';
    clock.restart();
    const { grain } = tier;
    const near = yield* grainSitesSteps({
        count: grain.near, near: 2.5, far: grain.nearReach, knee: 7, seed: 0x6a7e,
    }, clock);
    yield 'grain-near';
    clock.restart();
    const far = yield* grainSitesSteps({
        count: grain.far, near: grain.nearReach * 0.92, far: grain.farReach, seed: 0x6a7f,
    }, clock);
    // The clearing round the eye, planted for the portrait lens (drawn only under it).
    const close = yield* grainSitesSteps({
        count: Math.round(grain.near * CLOSE_STAND.share),
        near: CLOSE_STAND.near,
        far: CLOSE_STAND.far,
        knee: CLOSE_STAND.far,
        bearings: CLOSE_STAND.bearings,
        bank: false,
        fade: false,
        seed: 0x6a7d,
    }, clock);
    return {
        quality, fan, trees, grain: { near, far, close },
    };
}

/**
 * Prepare, yielding to the page between slices (abortable): the land's layout, and the trees'
 * authored assets (loaded meanwhile). `loader`/`textureLoader` override three's (tests).
 */
async function prepareData(quality, { signal, loader, textureLoader } = {}) {
    const aborted = () => signal?.aborted === true;
    // A failed download costs the belts their trees (the land's canopy stands in), not the theme.
    const loading = loadGrainfieldsAssets({ loader, textureLoader, isCurrent: () => !aborted() })
        .catch((error) => {
            console.warn('[Grainfields] The trees could not be loaded; the belts stand as canopy.', error);
            return null;
        });
    const steps = prepareSteps(quality);
    let data;
    // A breath before each step, the first included: the layout never shares a task with the start
    // that asked for it (the renderer's setup, the assets' requests).
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        await breathe();
        if (aborted()) break;
        const next = steps.next();
        if (next.done) {
            data = next.value;
            break;
        }
    }
    const assets = await loading;
    if (aborted()) {
        disposeGrainfieldsAssets(assets);
        throw new DOMException('Aborted', 'AbortError');
    }
    return { ...data, assets };
}

/** The same, synchronously (unit tests, the playground). */
function prepareDataSync(quality) {
    const steps = prepareSteps(quality);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

export class GrainfieldsWorld {
    /** Lay the land out, yielding to the page between slices. */
    static prepare(quality = 'High', { signal } = {}) {
        return prepareData(quality, { signal });
    }

    /** The same, synchronously: the land only (`assets` may be added before the build). */
    static prepareSync(quality = 'High', assets = null) {
        return { ...prepareDataSync(quality), assets };
    }

    constructor({
        scene, quality = 'High', capture = false, prepared = null, samples = 0, cloudSteps = null,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        // (Measurements: the deck's march overridden, 0 drawing it flat.)
        if (Number.isFinite(cloudSteps) && cloudSteps >= 0) this.tier = { ...this.tier, cloudSteps: Math.round(cloudSteps) };
        this.capture = capture === true;
        this.samples = samples;
        this.prepared = prepared;
        this.root = new THREE.Group();
        this.root.name = 'GrainfieldsWorld';
        this.parts = {};
        this.partList = [];
        this.disposed = false;
        this.reducedMotion = false;
        this.overrides = { hour: null };
        this.aspect = 16 / 9;
        this.viewportHeight = 1080;
        this.cssWidth = 1920;
        this.cssHeight = 1080;
        this.layout = fallbackLayout(this.cssWidth, this.cssHeight);
        this.layoutLive = false;
        this._camera = null;
        this._ray = [0, 0, 0];
        this._aimV = new THREE.Vector3();
        this.reactions = new GrainfieldsReactions();
        this.fx = {
            breaking: 0, tear: 0, flare: 0, clearSky: 0, still: 0,
        };
        /**
         * How hot play runs: the storm opens, the wind rises and the light turns gold with it (see
         * the header). Sampled once a frame on the world's clock; `heat` is the last sample.
         */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** The beams' dust, as the surge thickens it (grainfields-beams.js reads it). */
        this.beamGlow = 1;
        /** The fever's gold in the sun (0..1; none in a dusk). */
        this.blaze = 0;

        this.u = createUniforms();
        // The way from the eye to the gate (the four-line gust comes out of it).
        const toGate = Math.hypot(PLACES.gate.x - EYE.x, PLACES.gate.z - EYE.z) || 1;
        this.u.gustFront.value.set((PLACES.gate.x - EYE.x) / toGate, (PLACES.gate.z - EYE.z) / toGate, GUST.from, 0);
        this.textures = null;
        this.wheel = new HourWheel();
        this._hourLight = createLight();
        this._duskLight = createLight();
        this.light = createLight();
        this._post = {
            exposure: 1, bloomBoost: 0, air: 1, flash: 0, flashColour: [1, 0.9, 0.75], saturation: 1.1,
        };
        this.resetState();
        lightAt(2, this._duskLight);
    }

    resetState() {
        this.time = 0;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.duskFrom = 0;
        this.duskTarget = 0;
        this.duskAt = -1e6;
        this.dusk = 0;
        this.levelUpAt = -1e6;
        this.breakShown = 0;
        this.counts = emptyCounts();
        if (this.surge) {
            this.surge.reset();
            this.heat = this.surge.sample(-1e6);
        }
        this.surgeStage = 0;
        /**
         * What the surge has run the deck and the gusts ahead of the clock's closed forms (seconds
         * of the deck's drift; metres of the gusts' travel). Nothing at rest, so a seek lands on
         * the closed forms.
         */
        this.deckLead = 0;
        this.gustLead = 0;
        /** Flights out launched this run (each stirs where the next goes up). */
        this.skeins = 0;
        // The level-ups' time-lapse: how far it stood when the last one came, how far it is asked
        // to run in all, and when that was asked (none yet).
        this.lapseFrom = 0;
        this.lapseTo = 0;
        this.lapseAt = -1e6;
        /** When the last hard drop burst (its dust is still in the air a few seconds on). */
        this.burstAt = -1e6;
        /** The last piece locked: its colour (linear) and the side of the board it fell on. */
        this.lastLock = { rgb: [1, 0.82, 0.45], side: 1 };
        this.chaffSeed = 0x2f6e2b1;
    }

    /** A deterministic draw in [0, 1) for the chaff (reseeded by a seek: captures repeat). */
    draw() {
        this.chaffSeed = (this.chaffSeed + 0x6d2b79f5) >>> 0;
        let z = this.chaffSeed;
        z = Math.imul(z ^ (z >>> 15), z | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    }

    /** How far the level-ups' time-lapses have carried the deck by `time` (seconds of its drift). */
    lapseRun(time) {
        return this.lapseFrom + (this.lapseTo - this.lapseFrom) * smooth(0, LAPSE.span, time - this.lapseAt);
    }

    // ── Build ─────────────────────────────────────────────────────────────────────

    * buildSteps() {
        const prepared = this.prepared || prepareDataSync(this.quality);
        this.prepared = prepared;
        // Where the herd has parted the barley (pressed in each frame, read by the stalks).
        this.trample = createTrample();
        // Where the herd's shadows lie on the barley (cast each frame from the posed horses).
        this.herdShadow = createHerdShadow();
        this.textures = {
            noise: createNoiseTexture(), trample: this.trample.texture, herdShadow: this.herdShadow.texture,
        };
        this.writePath();
        // (The noise bake and the barley were one ~30 ms step of a first visit, 2026-10-31.)
        yield 'textures';
        const { u, textures: t, tier } = this;
        this.addPart('grain', yield* createGrainSteps(u, t, prepared.grain, { coverage: this.samples > 0 }));
        yield 'grain';
        this.addPart('land', yield* createLandSteps(u, t, tier, prepared));
        yield 'land';
        // The fells' mesh and the belts yield inside too, by their own clocks.
        this.addPart('lapporten', yield* createLapportenSteps(u, t, tier));
        // The ruin is authored too; without it the knoll stands bare.
        const fort = createFort(u, t, prepared.assets?.ruin);
        if (fort) this.addPart('fort', fort);
        yield 'lapporten';
        // The trees need their authored assets; without them the belts stand as the land's canopy.
        if (prepared.assets) {
            const options = { coverage: this.samples > 0 };
            this.addPart('trees', yield* createForestSteps(u, t, prepared.assets, prepared.trees, tier, options));
        }
        yield 'trees';

        // The herd needs its authored horse; without it the field is the barley's alone.
        const herd = createHerd(u, t, tier.herd, prepared.assets?.horse);
        if (herd) {
            this.addPart('herd', herd);
            herd.setView(this.herdView());
            herd.setCalm(this.reducedMotion);
        }
        // The geese need their authored goose; without it the sky goes without them.
        const geese = createGeese(u, t, tier.birds, prepared.assets?.goose);
        if (geese) {
            this.addPart('geese', geese);
            // Scoring the take-off routes for the layout: steps of their own (~20-35 ms at once).
            yield 'herd and geese';
            this.warmTakeoffs();
            yield* takeoffSteps(TAKEOFF_BUILD_SLICE_MS);
            yield 'takeoffs';
        }
        this.addPart('sky', createSky(u, t, tier));
        this.addPart('rays', createGateRays(u, t));
        this.addPart('beams', createBeams(u, t, this.reactions));
        this.addPart('devils', createDevils(u, t, this.reactions));
        this.addPart('chaff', createChaff(u, t, Math.round(tier.motes * 0.5)));
        this.addPart('motes', createMotes(u, t, tier.motes));
        // The ears by the lens: nearer than it can focus, soft in the bottom corners.
        this.addPart('lens', createLensEars(u, t, { count: tier.lens }));
        this.scene.add(this.root);
        return this;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /** The path's centre line, for the shaders: (x, z, along, flowers' half-width). */
    writePath() {
        const rows = this.u.tables.path;
        let total = 0;
        const lengths = [0];
        for (let i = 1; i < PATH_POINTS.length; i++) {
            const [ax, az] = PATH_POINTS[i - 1];
            const [bx, bz] = PATH_POINTS[i];
            total += Math.hypot(bx - ax, bz - az);
            lengths.push(total);
        }
        PATH_POINTS.forEach(([x, z], i) => {
            const along = lengths[i] / total;
            rows[i].set(x, z, along, PATH.track + flowerWidth(along));
        });
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.partList.push(part);
        const meshes = part.meshes || [part.mesh];
        for (const mesh of meshes) if (mesh) this.root.add(mesh);
    }

    showOnlyParts(names) {
        const keep = new Set(names);
        for (const name of Object.keys(this.parts)) {
            const part = this.parts[name];
            for (const mesh of part.meshes || [part.mesh]) if (mesh) mesh.visible = keep.has(name);
        }
    }

    bindCamera(camera) { this._camera = camera; }

    setReducedMotion(value) {
        this.reducedMotion = value === true;
        this.parts.herd?.setCalm(this.reducedMotion);
    }

    setCaptureOverrides(overrides) { Object.assign(this.overrides, overrides); }

    /** The post marches the light in the air: the land then leaves the sunlit air to it. */
    setAirMarch(on) { this.u.airMarch.value = on ? 1 : 0; }

    setViewport(bufferWidth, bufferHeight, aspect, cssWidth = bufferWidth, cssHeight = bufferHeight) {
        if (aspect > 0) this.aspect = aspect;
        this.u.aspect.value = this.aspect;
        this.viewportHeight = Math.max(1, bufferHeight);
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        if (!this.layoutLive) this.layout = fallbackLayout(this.cssWidth, this.cssHeight);
        this.parts.herd?.setView(this.herdView());
        this.warmTakeoffs();
        // Only the portrait lens looks down into the clearing round the eye.
        this.parts.grain?.setClose?.(rigFor(this.aspect) === RIG.portrait);
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.cssWidth, this.cssHeight);
        this.parts.herd?.setView(this.herdView());
        this.warmTakeoffs();
    }

    /**
     * Ask for the geese's take-off routes for the layout (cached), so a level-up need not score them:
     * scored a slice a frame from the next update on (a resize or a layout read scoring them at once
     * held its task 19-23 ms); the same routes for the same layout either way.
     */
    warmTakeoffs() {
        if (this.parts.geese) askTakeoffs(this.layout, this.aspect);
    }

    /**
     * The view the herd lives in (bearings, degrees right of the view axis): the frame's edges at
     * rest, and the stretches the board and the stats bar cover (the band grazes in the open).
     */
    herdView() {
        const rig = rigFor(this.aspect);
        const tanH = Math.tan(rig.fov * DEG * 0.5) * this.aspect;
        const bearingAt = (x) => rig.yaw + Math.atan((x * 2 - 1) * tanH) / DEG;
        const blocked = [];
        const card = this.layoutLive ? cardUnion(this.layout) : null;
        if (card) blocked.push([bearingAt(card.x0), bearingAt(card.x1)]);
        const hud = this.layoutLive ? this.layout?.hud : null;
        if (hud) blocked.push([bearingAt(hud.x0), bearingAt(hud.x1)]);
        return { left: bearingAt(0), right: bearingAt(1), blocked };
    }

    // ── Camera ────────────────────────────────────────────────────────────────────

    /** The rest pose plus a slow breath of the lens and the pointer's parallax. */
    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.set(EYE.x, EYE.y, EYE.z);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 83) * 0.3 + clamp(pointerX, -1, 1) * 0.7);
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 61) * 0.1 - clamp(pointerY, -1, 1) * 0.22);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        if (rig.shift) {
            // A vertical lens shift: the image moves up by `shift` in NDC (the horizon with it).
            camera.projectionMatrix.elements[9] = -rig.shift;
            camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        }
        camera.updateMatrixWorld();
    }

    restCamera(camera) {
        this.pose(camera, 0, 0, 0);
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        // The shared breath on top of pose()'s drift (a view out over the land: it only turns).
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Gameplay (the event language: grainfields-reactions.js) ──────────────────

    /**
     * The ground point at `distance` metres along the screen column through (x, y) (screen
     * fractions, y down) as [x, ground y, z]: where an event aimed at that part of the frame lands.
     */
    aim(x, y, distance) {
        const cam = this._camera;
        let bearing;
        if (cam) {
            const v = this._aimV.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(cam).sub(cam.position);
            bearing = Math.atan2(v.x, -v.z);
        } else {
            const rig = rigFor(this.aspect);
            const tanH = Math.tan(rig.fov * DEG * 0.5) * this.aspect;
            bearing = rig.yaw * DEG + Math.atan((x * 2 - 1) * tanH);
        }
        const gx = EYE.x + Math.sin(bearing) * distance;
        const gz = EYE.z - Math.cos(bearing) * distance;
        return [gx, groundHeight(gx, gz), gz];
    }

    deckState() {
        const d = this.u.drift.value;
        const s = this.u.sunDir.value;
        return { drift: [d.x, d.y], sunDir: [s.x, s.y, s.z] };
    }

    onLock(c) {
        this.counts.locks += 1;
        if (c?.hardDrop) this.counts.hardDrops += 1;
        const aim = (x, y, d) => this.aim(x, y, d);
        const { level } = this.heat;
        const gap = this.reactions.lock(c, this.time, {
            layout: this.layout, aim, deck: this.deckState(), heat: level,
        });
        this.surge.lock(c, this.time);
        if (gap) {
            this.lastLock.rgb = gap.rgb;
            this.lastLock.side = (c?.u ?? 0.5) < 0.5 ? -1 : 1;
        }
        if (c?.hardDrop && !this.reducedMotion) this.parts.herd?.startle(this.time);
        if (gap && !this.reducedMotion) this.lockChaff(gap, level);
        if (gap && !this.reducedMotion) {
            // Pigment dust of the piece's colour lifts through the beam (more of it, hotter).
            this.parts.motes?.burst({
                x: gap.footX,
                y: gap.footY + 0.4,
                z: gap.footZ,
                count: Math.round((gap.hard ? 48 : 28) * (1 + 0.4 * level)),
                spread: gap.radius * 0.7,
                up: gap.hard ? 1.6 : 1.1,
                out: 0.3,
                rgb: gap.rgb,
                life: 7,
                size: 0.016,
                time: this.time,
            });
        }
    }

    onClear(c) {
        // A perfect clear settled after its clear's last wave: the crown on it, not a clear.
        if (c?.crown) {
            this.onCrown();
            return;
        }
        const lines = Math.max(1, Math.min(4, Math.round(Number(c?.lines) || 1)));
        const depth = Math.max(1, Math.min(10, Math.round(Number(c?.cascade) || 1))) - 1;
        this.counts.clears += 1;
        this.counts.lines += lines;
        if (lines >= 4) this.counts.quads += 1;
        if (c?.twist) this.counts.twists += 1;
        if (c?.perfect) this.counts.perfects += 1;
        const aim = (x, y, d) => this.aim(x, y, d);
        // A tear still open over the gate keeps its place (it is fed, not moved).
        const tearOpen = this.reactions.tear(this.time) > 0.05;
        const added = this.reactions.clear({ ...c, palette: PIECE_LINEAR }, this.time, { layout: this.layout, aim });
        this.surge.clear(c, this.time);
        if (c?.perfect) this.launchSkein(this.time);
        if ((lines >= 4 || c?.b2b) && !tearOpen) {
            // The tear: where the sun's ray to the gate meets the deck, fixed to the deck as it is now.
            const deck = this.deckState();
            const lift = Math.max(0, DECK.base - GATE_TEAR_HEIGHT) / Math.max(0.035, deck.sunDir[1]);
            this.reactions.tearX = PLACES.gate.x + deck.sunDir[0] * lift + deck.drift[0];
            this.reactions.tearZ = PLACES.gate.z + deck.sunDir[2] * lift + deck.drift[1];
        }
        if (this.reducedMotion) return;
        // A twist wheels the herd round, and its whirl lifts a spinning column of chaff.
        if (c?.twist) this.parts.herd?.wheel(this.time);
        const whirl = this.reactions.pulses[this.reactions.pulses.length - 1];
        if (c?.twist) this.devilChaff(this.reactions.devils[this.reactions.devils.length - 1]);
        if (lines >= 4) this.gustChaff(this.reactions.rowColour({ ...c, palette: PIECE_LINEAR }));
        if (c?.perfect) this.stillChaff();
        if (c?.twist && whirl?.kind === 1) {
            this.parts.motes?.burst({
                x: whirl.x,
                y: groundHeight(whirl.x, whirl.z) + 0.3,
                z: whirl.z,
                count: 110,
                spread: 4,
                up: 2.4,
                out: 0.15,
                rgb: [1, 0.82, 0.45],
                life: 6,
                size: 0.014,
                time: this.time,
            });
        }
        // Chaff of the rows' colours thrown up where each new lane starts (more for each wave).
        const { trails } = this.reactions;
        for (let lane = trails.length - added; lane < trails.length; lane++) {
            const tr = trails[lane];
            this.laneChaff(tr, lines, depth, c?.b2b);
            for (let k = 0; k < 3; k++) {
                this.parts.motes?.burst({
                    x: tr.x + tr.hx * (8 + k * 9),
                    y: groundHeight(tr.x, tr.z) + 0.7,
                    z: tr.z + tr.hz * (8 + k * 9),
                    count: 10 + lines * 4 + Math.min(depth, 5) * 4,
                    spread: 3,
                    up: 0.5,
                    out: 0.9,
                    rgb: tr.rgb,
                    life: 5,
                    size: 0.012,
                    time: tr.at + k * 0.25,
                });
            }
        }
    }

    // ── What the events throw into the air (grainfields-chaff.js) ───────────────────

    /**
     * A flake's colour for a piece's (linear): a petal of that colour, a share of the field's own
     * gold in it (husks and straw fly with the petals).
     */
    flakeColour(rgb, own = 0.75) {
        return [
            CHAFF_GOLD[0] + (rgb[0] * 1.5 + 0.1 - CHAFF_GOLD[0]) * own,
            CHAFF_GOLD[1] + (rgb[1] * 1.5 + 0.1 - CHAFF_GOLD[1]) * own,
            CHAFF_GOLD[2] + (rgb[2] * 1.5 + 0.1 - CHAFF_GOLD[2]) * own,
        ];
    }

    /**
     * A lock: a puff of chaff in the piece's colour lifts out of the stand where its beam lands.
     * A hard drop bursts: a cloud of the field's dust, a fountain of husks through it and a crown
     * of them thrown out low over the ears.
     */
    lockChaff(gap, heat = 0) {
        const { chaff } = this.parts;
        if (!chaff) return;
        const r = () => this.draw();
        const { share } = chaff;
        const rgb = this.flakeColour(gap.rgb, 0.88);
        const y = gap.footY + 0.9;
        // A beam lands 26 to 140 m out: what it throws up is sized to its distance, so a far
        // lock's puff stands about as tall beside the card as a near one's.
        const far = clamp(Math.hypot(gap.footX - EYE.x, gap.footZ - EYE.z) / 26, 1, 3.4);
        const lift = far ** 0.75;
        // Fast play drops a piece a second: a whole burst for each would stand as one bank of dust
        // over the gate. A burst is as big as the air has had time to clear since the last one
        // (a quarter at least), so the first drop after a pause is the one that bursts.
        const room = gap.hard ? clamp((this.time - this.burstAt) / BURST_CLEARS, 0.25, 1) : 1;
        if (gap.hard) this.burstAt = this.time;
        const flakes = Math.round((gap.hard ? 64 * (0.4 + 0.6 * room) : 42) * share * (1 + 0.4 * heat));
        for (let i = 0; i < flakes; i++) {
            const a = r() * TAU;
            const d = Math.sqrt(r()) * gap.radius * 0.6;
            // A hard drop's crown: one in three goes out low and fast.
            const crown = gap.hard && i % 3 === 0;
            const out = (crown ? 5 + r() * 5 : 0.5 + r() * 1.6) * lift;
            chaff.fly({
                x: gap.footX + Math.cos(a) * d,
                y,
                z: gap.footZ + Math.sin(a) * d,
                vx: Math.cos(a) * out,
                vy: (crown ? 1.4 + r() * 2 : (gap.hard ? 6 : 4.2) * (0.6 + r())) * lift,
                vz: Math.sin(a) * out,
                life: 3 + r() * 1.8,
                size: (gap.hard ? 0.085 : 0.075) * (0.7 + r() * 0.8) * far,
                rgb,
                seed: r(),
                time: this.time + r() * (gap.hard ? 0.18 : 0.5),
            });
        }
        // The puff itself. A lock's: a few small clouds of the piece's pigment lifting off the
        // ears. A hard drop's: a column of the field's dust thrown up through them, small clouds
        // at many heights (one big one read as a ball), a breath of the pigment in it.
        const puffs = Math.max(2, Math.round((gap.hard ? 14 * room : 3) * share));
        for (let i = 0; i < puffs; i++) {
            const a = r() * TAU;
            const out = (gap.hard ? 0.8 + r() * 2.4 : 0.3 + r() * 0.7) * lift;
            const up = (gap.hard ? 1.5 + r() * r() * 11 : 1 + r() * 1.6) * lift;
            chaff.fly({
                x: gap.footX + Math.cos(a) * 0.5,
                y: y - 0.2,
                z: gap.footZ + Math.sin(a) * 0.5,
                vx: Math.cos(a) * out,
                vy: up,
                vz: Math.sin(a) * out,
                life: (gap.hard ? 2.6 : 2.3) + r() * 1.2,
                size: (gap.hard ? 0.45 + r() * 0.35 : 0.4 + r() * 0.25) * far,
                grow: (gap.hard ? 1.3 + r() * 1.1 : 1 + r() * 0.6) * far,
                kind: CHAFF_KIND.puff,
                rgb: gap.rgb,
                pigment: gap.hard ? 0.12 : 0.25,
                seed: r(),
                time: this.time + r() * (gap.hard ? 0.25 : 0.4),
            });
        }
    }

    /** Husks trace the wind in the air above the lane. Their arrangement and rhythm carry the clear. */
    laneChaff(tr, lines, depth, backToBack) {
        const { chaff } = this.parts;
        if (!chaff) return;
        const r = () => this.draw();
        const rgb = this.flakeColour(tr.rgb, 0.7);
        const n = Math.round((22 + 12 * lines + 6 * Math.min(depth, 5)) * chaff.share);
        const sideX = -tr.hz;
        const sideZ = tr.hx;
        for (let i = 0; i < n; i++) {
            const run = r();
            let along = 5 + run * run * 40;
            let across = (r() - 0.5) * tr.width * 0.48;
            let lift = 1.8 + r() * 2.8;
            let outward = 0;
            let beat = 0;
            if (backToBack) {
                // A second difficult clear folds two crescents of straw up the same flank in succession.
                const arc = run * Math.PI;
                const second = i % 2;
                along = 8 + (1 - Math.cos(arc)) * 9 + second * 7;
                across += tr.side * Math.sin(arc) * (4 + second * 1.8);
                lift += Math.sin(arc) * 5;
                outward = tr.side * Math.cos(arc) * 2;
                beat = second * 0.72;
            } else if (lines === 2) {
                // The wind divides round a patch of standing barley. The husks mark both banks.
                const bank = i % 2 ? 1 : -1;
                across += bank * (0.4 + 0.105 * along);
                outward = bank * (1.9 + 2 * run);
                lift += 0.9;
            } else if (lines === 3) {
                // Three successively taller, slanting breakers, near to far.
                const rank = i % 3;
                along = 7 + rank * 7.5 + run * 5;
                across += (run - 0.5) * (5 + rank * 3);
                lift += rank * 1.7 + 2 * Math.sin(run * Math.PI);
                beat = rank * 0.19;
            }
            if (depth > 0) {
                // Debris from a cascade arrives in separate, rising pulses within the clear.
                const echo = i % Math.min(4, depth + 1);
                beat += 0.32 * echo;
                lift += 1.6 * echo;
            }
            const x = tr.x + tr.hx * along + sideX * across;
            const z = tr.z + tr.hz * along + sideZ * across;
            const speed = 5 + r() * 7;
            const sideSpeed = outward + (r() - 0.5) * 1.8;
            chaff.fly({
                x,
                y: groundHeight(x, z) + 0.95,
                z,
                vx: tr.hx * speed + sideX * sideSpeed,
                vy: lift,
                vz: tr.hz * speed + sideZ * sideSpeed,
                life: 2.6 + r() * 1.6,
                size: 0.07 * (0.7 + r() * 0.8),
                rgb,
                seed: r(),
                // Thrown as the lane's head passes: nearest first.
                time: tr.at + along / 70 + beat + r() * 0.14,
            });
        }
        if (lines === 1 && depth === 0 && !backToBack) return;
        // The dust follows the same fork, cross-wind ridges, or double crescent. At a full-field
        // distance the individual husks can fall below a pixel; the translucent banks still read.
        const bands = backToBack ? 2 : Math.min(lines, 3);
        const puffs = bands * Math.max(2, Math.round(4 * chaff.share));
        for (let i = 0; i < puffs; i++) {
            const band = i % bands;
            const run = (i + r()) / puffs;
            let along = 7 + run * 22;
            let across = 0;
            let beat = 0;
            if (backToBack) {
                along = 8 + (1 - Math.cos(Math.PI * run)) * 9 + band * 7;
                across = tr.side * Math.sin(Math.PI * run) * (4 + band * 1.8);
                beat = band * 0.72;
            } else if (lines === 2) {
                across = (band ? 1 : -1) * (0.6 + 0.14 * along);
            } else if (lines === 3) {
                along = 7 + band * 7.5 + run * 5;
                across = (run - 0.5) * (5 + band * 3);
                beat = band * 0.19;
            }
            const x = tr.x + tr.hx * along + sideX * across;
            const z = tr.z + tr.hz * along + sideZ * across;
            const birth = tr.at + along / 70 + beat + 0.07 * r();
            chaff.fly({
                x,
                y: groundHeight(x, z) + 1.05,
                z,
                vx: tr.hx * (3 + r() * 3),
                vy: 2.1 + band * 0.8 + r() * 1.5,
                vz: tr.hz * (3 + r() * 3),
                life: 2.8 + r() * 1.2,
                size: 0.32 + r() * 0.27,
                grow: 0.95 + 0.024 * along + r() * 0.6,
                kind: CHAFF_KIND.puff,
                rgb: tr.rgb,
                pigment: 0.35,
                seed: r(),
                time: birth + (depth > 0 ? 0.32 * (i % Math.min(4, depth + 1)) : 0),
            });
        }
    }

    /**
     * A dust devil's own: flakes wound up round it in the last piece's colour (they leave its foot
     * one after another as it turns, so they stand as a spiral that climbs), and the dust it
     * flings out round its foot.
     */
    devilChaff(devil) {
        const { chaff } = this.parts;
        if (!chaff || !devil) return;
        const r = () => this.draw();
        const rgb = this.flakeColour(this.lastLock.rgb, 0.8);
        const n = Math.round(84 * chaff.share * devil.power);
        const y = groundHeight(devil.x, devil.z) + 0.6;
        for (let i = 0; i < n; i++) {
            const born = 0.25 + (i / n) * 4.6;
            const climb = (3.4 + r() * 2.2) * (devil.height / 12.5);
            chaff.fly({
                // Where the devil's foot stands when this flake leaves it.
                x: devil.x + DEVIL_WALK[0] * born,
                y,
                z: devil.z + DEVIL_WALK[1] * born,
                kind: CHAFF_KIND.wound,
                radius: devil.radius * (0.55 + r() * 0.6),
                climb,
                turn: devil.spin * (0.75 + r() * 0.5),
                open: 0.15 + r() * 0.06,
                life: (devil.height / climb) * (0.85 + r() * 0.25),
                size: 0.08 * (0.7 + r() * 0.8),
                rgb,
                seed: r(),
                time: devil.at + born,
            });
        }
        const puffs = Math.max(3, Math.round(7 * chaff.share * devil.power));
        for (let i = 0; i < puffs; i++) {
            const a = r() * TAU;
            const born = 0.1 + r() * 3.2;
            chaff.fly({
                x: devil.x + DEVIL_WALK[0] * born + Math.cos(a) * devil.radius,
                y: y + 0.2,
                z: devil.z + DEVIL_WALK[1] * born + Math.sin(a) * devil.radius,
                vx: Math.cos(a) * (1.5 + r() * 2.5),
                vy: 0.8 + r() * 1.6,
                vz: Math.sin(a) * (1.5 + r() * 2.5),
                life: 2.6 + r() * 1.4,
                size: 0.4 + r() * 0.3,
                grow: 1.2 + r() * 0.8,
                kind: CHAFF_KIND.puff,
                pigment: 0,
                seed: r(),
                time: devil.at + born,
            });
        }
    }

    /**
     * Four lines' gust: as its front comes in across the stand it tears chaff out of the ears and
     * carries it past the eye, a wall of husks streaming out of the gate's light (each flake is
     * thrown when the front reaches it), the field's dust rolling in under it.
     */
    gustChaff(rows = CHAFF_GOLD) {
        const { chaff } = this.parts;
        if (!chaff) return;
        const r = () => this.draw();
        const d = this.u.gustFront.value;
        const start = this.reactions.gustAt;
        const tinted = this.flakeColour(rows, 0.45);
        const n = Math.round(170 * chaff.share);
        for (let i = 0; i < n; i++) {
            const ahead = 3 + r() * 92;
            const across = (r() - 0.5) * (30 + ahead * 0.9);
            const x = EYE.x + d.x * ahead - d.y * across;
            const z = EYE.z + d.y * ahead + d.x * across;
            const speed = 15 + r() * 13;
            chaff.fly({
                x,
                y: groundHeight(x, z) + 0.9 + r() * 0.4,
                z,
                vx: -d.x * speed + (r() - 0.5) * 3,
                vy: 1.2 + r() * 4.4,
                vz: -d.y * speed + (r() - 0.5) * 3,
                life: 1.7 + r() * 1.1,
                size: 0.075 * (0.7 + r() * 0.8),
                rgb: i % 3 ? CHAFF_GOLD : tinted,
                seed: r(),
                time: start + (GUST.from - ahead) / GUST.speed + r() * 0.3,
            });
        }
        const puffs = Math.max(4, Math.round(12 * chaff.share));
        for (let i = 0; i < puffs; i++) {
            const ahead = 16 + r() * 80;
            const across = (r() - 0.5) * (40 + ahead);
            const x = EYE.x + d.x * ahead - d.y * across;
            const z = EYE.z + d.y * ahead + d.x * across;
            chaff.fly({
                x,
                y: groundHeight(x, z) + 0.8,
                z,
                vx: -d.x * (5 + r() * 4),
                vy: 1 + r() * 1.5,
                vz: -d.y * (5 + r() * 4),
                life: 2.4 + r() * 1.2,
                size: 0.7 + r() * 0.5,
                grow: 2.2 + r() * 1.4,
                kind: CHAFF_KIND.puff,
                pigment: 0,
                seed: r(),
                time: start + (GUST.from - ahead) / GUST.speed + r() * 0.2,
            });
        }
    }

    /**
     * As the field falls still the seeds let go along two sweeping drifts. The far ends rise first,
     * then the nearer ears open and the slower cream-coloured seed down follows the geese into the sky.
     */
    stillChaff() {
        const { chaff } = this.parts;
        if (!chaff) return;
        const r = () => this.draw();
        const n = Math.round(180 * chaff.share);
        for (let i = 0; i < n; i++) {
            const along = r();
            const side = i % 2 === 0 ? -1 : 1;
            const arch = Math.sin(along * Math.PI);
            const column = 0.08 + 0.31 * along + (r() - 0.5) * 0.09;
            const u = freeColumn(this.layout, 0, side < 0 ? column : 1 - column);
            const distance = 13 + 30 * (1 - along) + 4 * arch + r() * 5;
            const [x, y, z] = this.aim(u, 0.72, distance);
            chaff.fly({
                x,
                y: y + 0.88,
                z,
                kind: CHAFF_KIND.wound,
                radius: 0.3 + r() * 0.55,
                climb: 0.54 + 0.53 * arch + 0.36 * r(),
                turn: side * (0.26 + r() * 0.42),
                open: 0.16,
                life: 7 + r() * 3,
                size: (0.042 + r() * 0.036) * (1 + distance / 80),
                rgb: i % 3 === 0 ? [0.92, 0.62, 0.24] : [1.18, 1.04, 0.72],
                seed: r(),
                time: this.time + 0.25 + along * 2.15 + (side + 1) * 0.22 + 0.32 * r(),
            });
        }
    }

    onCombo(n) {
        const next = Math.max(0, Math.round(Number(n) || 0));
        if (next >= 2 && next > this.combo) this.counts.chainSteps += 1;
        // The storm breaking open at a chain of three sets the horses running.
        if (next >= 3 && this.combo < 3 && !this.reducedMotion) this.parts.herd?.run(this.time);
        this.combo = next;
        this.peak = Math.max(this.peak, next);
        this.reactions.setCombo(next, this.time);
    }

    onB2B(level) {
        const next = Math.max(0, Math.round(Number(level) || 0));
        if (next > this.b2b) this.counts.b2bSteps += 1;
        this.b2b = next;
        this.reactions.setB2B(next, this.time);
    }

    /**
     * The crown on a clear already playing (a perfect clear settled after its last wave): the sky
     * clears and the wind stills from where they stand, and the geese lift off for the gate.
     */
    onCrown() {
        this.counts.perfects += 1;
        this.reactions.perfect(this.time);
        this.surge.crown(this.time);
        this.launchSkein(this.time);
        if (!this.reducedMotion) this.stillChaff();
    }

    /** A twist that cleared nothing: a small whirl of wind in the stand, and the horses look up. */
    onSpin(c) {
        this.counts.spins += 1;
        this.surge.spin(this.time);
        const aim = (x, y, d) => this.aim(x, y, d);
        const whirl = this.reactions.spin(c, this.time, { layout: this.layout, aim });
        if (!whirl || this.reducedMotion) return;
        this.parts.herd?.startle(this.time);
        this.devilChaff(this.reactions.devils[this.reactions.devils.length - 1]);
        this.parts.motes?.burst({
            x: whirl.x,
            y: groundHeight(whirl.x, whirl.z) + 0.3,
            z: whirl.z,
            count: 40,
            spread: 2.5,
            up: 1.8,
            out: 0.12,
            rgb: [1, 0.82, 0.45],
            life: 4.5,
            size: 0.013,
            time: this.time,
        });
    }

    /**
     * A skein of geese lifts off the field and flies out through the gate, unless one has only
     * just gone (a second flight out, later, flies beside the first: neither vanishes). Where it
     * goes up is the route that keeps it in the open for the layout on screen. Not under reduced
     * motion.
     */
    launchSkein(time) {
        if (this.reducedMotion) return false;
        const age = time - this.u.skein.value;
        if (age >= 0 && age < SKEIN_AWAY) return false;
        this.u.skein.value = time;
        this.skeins += 1;
        const { geese } = this.parts;
        if (geese) geese.launch(time, planTakeoff({ layout: this.layout, aspect: this.aspect, seed: this.skeins }));
        return true;
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n > this.level && !silent) {
            this.counts.levelUps += 1;
            this.levelUpAt = time;
            this.surge.levelUp(time);
            if (!this.reducedMotion) {
                this.reactions.levelUp(time);
                // A skein of geese lifts off the field and flies out through the gate.
                this.launchSkein(time);
                // The day turns in time-lapse: the deck races on from where it stands (never back),
                // a whole run further than it was already asked to go (a second level-up while the
                // first still runs adds its own, it does not replace what is left of the first).
                this.lapseFrom = this.lapseRun(time);
                this.lapseTo += LAPSE.run;
                this.lapseAt = time;
            }
        }
        this.wheel.levelUp(n, time, silent || this.reducedMotion);
        this.level = n;
    }

    onGameOver() {
        this.counts.gameOvers += 1;
        this.duskFrom = this.dusk;
        this.duskTarget = 1;
        this.duskAt = this.time;
    }

    onSessionStart() {
        if (this.duskTarget > 0) {
            this.counts.mornings += 1;
            this.duskFrom = this.dusk;
            this.duskTarget = 0;
            this.duskAt = this.time;
        }
    }

    resetSession() {
        this.reactions.setCombo(0, this.time);
        this.reactions.setB2B(0, this.time);
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.level = 1;
        this.wheel.newRun();
    }

    /** Jump the clock (captures): everything in flight is dropped, the light stands where the clock puts it. */
    seek(time) {
        const t = Math.max(0, Number(time) || 0);
        this.resetState();
        this.wheel.reset();
        this.reactions.reset();
        this.parts.motes?.reset();
        this.parts.chaff?.reset();
        this.parts.herd?.reset(t);
        this.trample?.clear();
        this.herdShadow?.clear();
        this.u.herdShadow.value.set(0, 0, 0);
        this.u.skein.value = -1e6;
        this.parts.geese?.reset();
        this.time = t;
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const { time, u } = this;
        const dt = Math.max(0, Math.min(0.25, sim.delta || 0));
        // Dusk at game over, morning after.
        this.dusk = this.duskFrom + (this.duskTarget - this.duskFrom)
            * smooth(0, this.duskTarget ? TIMING.dusk : TIMING.dawn, time - this.duskAt);
        // The light of the hour.
        const place = this.overrides.hour !== null ? this.overrides.hour : this.wheel.place(time);
        lightAt(place, this._hourLight);
        const L = this.dusk > 0.001
            ? blendLight(this._hourLight, this._duskLight, this.dusk * 0.85, this.light)
            : copyLight(this._hourLight, this.light);
        applyHarvestNight(L, u.moon.value, this.dusk);
        // A bank of damp air crosses the valley on a different clock from the sun. The
        // hollows fill first. Behind it the ridgelines separate again in the clearer air.
        const front = 0.64 * Math.sin(time * 0.032) + 0.36 * Math.sin(time * 0.071 + 1.6);
        const humid = smooth(-0.7, 0.85, front);
        L.cover = clamp(L.cover + 0.09 * front * (1 - this.dusk), 0.08, 0.96);
        L.hazeDensity *= 0.65 + 0.28 * humid;
        L.mistDensity *= 0.60 + 0.72 * humid;
        // How hot play runs (once a frame, on the world's clock): see the header.
        const heat = this.surge.sample(time);
        this.heat = heat;
        const { level, fever } = heat;
        this.stageChanged(heat.stage, time);
        // In a fever the sun pours through gold: a little more of it on the land, a little warmer
        // (the iris closes as much in updatePost, and the light in the air is held back by the
        // same share, so the sunlit gold deepens and the shade and the air keep their depth).
        const blaze = fever * (1 - this.dusk);
        this.blaze = blaze;
        u.sunDir.value.set(L.dir[0], L.dir[1], L.dir[2]);
        u.sunUp.value = L.sunUp;
        u.day.value = L.day;
        u.sun.value.set(L.sun[0] * (1 + 0.16 * blaze), L.sun[1] * (1 + 0.08 * blaze), L.sun[2]);
        u.fill.value.set(L.fill[0], L.fill[1], L.fill[2]);
        u.bounce.value.set(L.bounce[0], L.bounce[1], L.bounce[2]);
        u.zenith.value.set(L.zenith[0], L.zenith[1], L.zenith[2]);
        u.horizon.value.set(L.horizon[0], L.horizon[1], L.horizon[2]);
        u.glow.value.set(L.glow[0], L.glow[1], L.glow[2]);
        u.haze.value.set(L.haze[0], L.haze[1], L.haze[2]);
        u.mist.value.set(L.mist[0], L.mist[1], L.mist[2]);
        // The torn cloud's sunlit edges catch the gold too.
        const lit = L.cloudLit;
        u.cloudLit.value.set(lit[0] * (1 + 0.16 * blaze), lit[1] * (1 + 0.06 * blaze), lit[2] * (1 - 0.08 * blaze));
        // ...and their bellies darken: the torn storm stands sculpted against the blue.
        const shade = 1 - 0.35 * blaze;
        u.cloudShade.value.set(L.cloudShade[0] * shade, L.cloudShade[1] * shade, L.cloudShade[2] * shade);
        u.hazeDensity.value = L.hazeDensity;
        u.mistDensity.value = L.mistDensity;
        u.stars.value = L.stars;
        u.dusk.value = this.dusk;
        u.time.value = time;
        // A chain breaks the deck into clouds with clear sky between them (real gaps, so the shafts
        // stand apart), not a thinner veil over everything. Hot play tears it open too, with no
        // chain at all, and a fever opens it past the chain's last step.
        const open = 1 - (1 - this.reactions.breaking(time)) * (1 - 0.22 * level - 0.5 * fever);
        this.breakShown = open;
        u.cover.value = clamp(L.cover + this.dusk * 0.25 - 0.5 * open, 0.05, 0.97);
        u.deckLo.value.set(deckThreshold(u.cover.value), deckThreshold(0.975));
        // Rain hangs under the storm's core while the deck is heavy; a chain breaking the storm
        // stops it, the storm closing at game over brings it back.
        u.rain.value = smooth(0.78, 0.92, u.cover.value);
        // The deck drifts and the gusts run with constant speeds (closed form: the clock times a
        // constant; their strength, not their speed, follows the hour), and the hotter play runs,
        // the faster: the deck races overhead and the gusts run over the barley (a lead on the
        // closed form that only grows while play is hot; reduced motion lets a little of it through).
        const motion = this.reducedMotion ? 0.3 : 1;
        this.deckLead += dt * (0.5 * level + 0.9 * fever) * motion;
        const ran = time + this.deckLead + this.lapseRun(time);
        u.drift.value.set(ran * DECK_WIND[0], ran * DECK_WIND[1]);
        // The events: gaps, trails, pulses, the storm's break, the tear, the flare, a clear sky
        // (after the drift: the gaps are written against the deck as it stands this frame).
        const fx = this.reactions.writeUniforms(u, time);
        // (The shafts through the gate are a burst of light over a part of the frame: Reduce
        // flashing softens them.)
        fx.rays *= 0.55 + 0.45 * flashScale();
        fx.breaking = open;
        u.breaking.value = open;
        this.fx = fx;
        const gale = this.reactions.gale(time);
        this.gustLead += dt * GUST_SPEED * (0.6 * level + 0.8 * fever + 0.6 * gale) * motion * (1 - fx.still);
        u.gust.value = time * GUST_SPEED + this.gustLead;
        // The wind: the storm's break, the run, the gale the clears have blown up and the fever.
        const b2b = this.reactions.b2bShown(time);
        const blow = 1 + 0.55 * open + 0.06 * b2b + 0.22 * gale + 0.12 * fever;
        u.windStrength.value = L.wind * blow * (1 - 0.85 * fx.still);
        // The breeze veers independently of the long cloud deck. Keep the gust texture's own
        // frame fixed so a slow turn never swings a distant weather front across the horizon.
        const veer = Math.sin(time * 0.061) * 0.21 + Math.sin(time * 0.023) * 0.16;
        const windBearing = 0.6075 + veer * motion * (1 - fx.still);
        u.windDir.value.set(Math.cos(windBearing), Math.sin(windBearing));
        // The beams stand in thicker dust the hotter play runs; under a perfect clear's open sky
        // (no deck for them to come through) they pale.
        this.beamGlow = (1 + 0.08 * level + 0.12 * fever) * (1 - 0.35 * fx.clearSky);
        // The sun's own gap: held on the eye's line to the sun, so the sun is seen through the deck
        // at the storm break and the fields round the eye stand in its light.
        const sy = Math.max(0.035, L.dir[1]);
        const lift = (DECK.base - EYE.y) / sy;
        // Small: the eye stands in the sun, but the air beyond a kilometre or so toward the sun is in
        // the deck's shade, so the shafts of the other gaps stand out against it.
        const wanderX = 70 * Math.sin(time * 0.023 + 0.4) + 30 * Math.sin(time * 0.061);
        const wanderZ = 60 * Math.sin(time * 0.017 + 1.9) + 25 * Math.sin(time * 0.047 + 0.8);
        const gapRadius = 600 + 90 * Math.sin(time * 0.021);
        // At the storm break the gap swings off the eye's line and back (SUN_GAP_SWING): the fields
        // round the eye stand now in its clear heart, now in its torn edge (sun and shade in patches
        // running with the deck), now and then in the deck's shade, where the locks' pools of sun
        // stand out. A lighter deck, or a chain breaking the storm, holds it on the eye.
        const swing = sunGapSwing(time, L.cover, this.breakShown) * gapRadius;
        const turn = time * SUN_GAP_SWING.turn + 0.9;
        u.sunGap.value.set(
            EYE.x + L.dir[0] * lift + wanderX + Math.cos(turn) * swing,
            EYE.z + L.dir[2] * lift + wanderZ + Math.sin(turn) * swing,
            gapRadius,
            1,
        );
        // The storm's core lies out along the sun's bearing while the deck is heavy (the storm break):
        // the fells and the middle distance in its shade, the sun looking through its own gap.
        const flat = Math.hypot(L.dir[0], L.dir[2]) || 1;
        u.stormCore.value.set(
            EYE.x + (L.dir[0] / flat) * 11500,
            EYE.z + (L.dir[2] / flat) * 11500,
            9500,
            smooth(0.58, 0.78, L.cover) * (1 - this.breakShown),
        );
        // Gaps whose shafts stand in the air in front of the fells: each lands on the land at its
        // foot, kilometres out, and wanders across it; seen from the eye its column of lit air rises
        // toward the sun past the mountain's dark face. Strongest while the deck is heavy: the hole
        // is where the sun's ray through the landing point meets the deck.
        const heavy = smooth(0.5, 0.72, L.cover) * (1 - this.dusk);
        RAY_LANDINGS.forEach((landing, k) => {
            const at = this.rayLanding(time, k, this._ray);
            const liftK = Math.max(0, DECK.base - at[1]) / sy;
            const radius = landing.radius * (1 + 0.28 * Math.sin(time * landing.breathe + k * 1.7));
            u.tables.rays[k].set(at[0] + L.dir[0] * liftK, at[2] + L.dir[2] * liftK, radius, heavy);
        });

        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, this.viewportHeight || 1080);
        }
        this.updatePost(dt);
        for (const part of this.partList) part.update?.(time, dt, this);
        if (this.parts.herd && this.parts.grain) this.trample.press(this.parts.herd.horses, dt);
        const { herd } = this.parts;
        if (herd && this.herdShadow) {
            const s = u.sunDir.value;
            this.herdShadow.cast(herd.rig, herd.motions, [s.x, s.y, s.z], groundHeight);
            const w = this.herdShadow.window;
            u.herdShadow.value.set(w.x, w.z, w.span);
        }
        // The take-off routes a resize or a layout asked for, a slice a frame (warmTakeoffs).
        if (this.parts.geese) stepTakeoffs();
    }

    /**
     * Where shaft `k` lands (world x, y, z): on the land in front of the fells (see
     * RAY_LANDINGS), each wandering slowly across the bearings the mountain fills.
     */
    rayLanding(time, k, out) {
        const V = PLACES.gate;
        const R = RAY_LANDINGS[k];
        const toward = Math.atan2(V.x - EYE.x, -(V.z - EYE.z)) / DEG;
        const bearing = toward + R.bearing + R.wander * Math.sin(time * R.pace + k * 2.1);
        const distance = R.distance + 800 * Math.sin(time * 0.011 + k);
        out[0] = EYE.x + Math.sin(bearing * DEG) * distance;
        out[2] = EYE.z - Math.cos(bearing * DEG) * distance;
        out[1] = Math.max(groundHeight(out[0], out[2]), gateHeight(out[0], out[2]));
        return out;
    }

    /**
     * The surge's act rose: the horses lift their heads as play turns hot; in a fever they gallop
     * and a skein of geese lifts off for the gate (once each time the act is reached).
     */
    stageChanged(stage, time) {
        const was = this.surgeStage;
        this.surgeStage = stage;
        if (stage <= was || this.reducedMotion) return;
        if (stage >= 2 && was < 2) this.parts.herd?.startle(time);
        if (stage >= 3) {
            this.parts.herd?.run(time);
            this.launchSkein(time);
        }
    }

    updatePost() {
        const post = this._post;
        const L = this.light;
        const { fx } = this;
        const { punch, level, fever } = this.heat;
        const flashing = flashScale();
        // The quads' light: the front's first moments flash over the frame; the rest is the front.
        const frontAge = this.time - this.reactions.flareAt;
        const kick = fx.flare * (1 - smooth(0.3, 1.6, frontAge));
        // Hold the hour's shadows while reserving highlight room for the direct sun,
        // newly exposed field, and light concentrated in an opening over the gate.
        const sunlight = L.sunUp * smooth(0.6, 3.5, L.sun[0]);
        const opening = 0.06 * fx.breaking + 0.11 * fx.clearSky + 0.055 * fx.tear;
        const iris = 1 / (1 + sunlight * (0.07 + opening + 0.11 * fever) + 0.025 * fx.flare);
        post.exposure = L.exposure * iris;
        // (A perfect clear's air is rain-washed: crisp, and the colours with it.)
        post.saturation = 1.10 + 0.03 * fx.breaking + 0.025 * level + 0.035 * fever + 0.035 * fx.clearSky;
        // A clear sky lights all the air at once: hold the veil back so the gate stays crisp. The
        // fever's stronger sun is not let into the air (the gold is the land's, not a haze).
        post.air = (1 - 0.72 * fx.clearSky) / (1 + 0.16 * this.blaze + 0.09 * fx.breaking);
        // Each event's kick rides on the light a moment (on a floor under rapid play); held low, so
        // the glare round the sun never veils the fells.
        post.bloomBoost = (0.085 * fx.breaking + (0.14 * fx.flare + 0.08 * punch) * flashing) * (1 - 0.4 * fx.clearSky);
        // The flash is added after the exposure: scaled with it, it stays the same share of the
        // picture in a darker-exposed hour (the post scales it for Reduce flashing).
        post.flash = 0.095 * kick * Math.min(1, L.exposure / 0.92);
        post.flashColour = L.glow;
    }

    /** GPU work that must precede the frame (none: the deck's shadow is read in the shaders). */
    /** The world's own passes before the frame: the deck marched as a volume. */
    prerender(renderer, camera = this._camera) {
        this.parts.sky?.render?.(renderer, camera);
    }

    getPostState() { return this._post; }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            hour: {
                place: this.light.place,
                from: this.light.from,
                to: this.light.to,
                mix: this.light.mix,
                az: this.light.az,
                el: this.light.el,
                name: HOURS[this.light.from].name,
                of: this.light.hour,
                day: this.light.day,
                sunUp: this.light.sunUp,
                cover: this.u.cover.value,
            },
            counts: { ...this.counts },
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            dusk: this.dusk,
            surge: { level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage },
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            parts: Object.keys(this.parts),
        };
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT) scalars[key] = this[key];
        return { scalars, wheel: this.wheel.exportState(), counts: { ...this.counts } };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.wheel.importState(state.wheel);
        this.counts = { ...emptyCounts(), ...state.counts };
        // The reactions draw the chain and the run: carry them over already eased in.
        this.reactions.setCombo(this.combo, -1e6);
        this.reactions.setB2B(this.b2b);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        this.textures?.noise?.dispose();
        this.trample?.dispose();
        this.herdShadow?.dispose();
        disposeGrainfieldsAssets(this.prepared?.assets);
        this.root.clear();
        this.partList.length = 0;
    }
}

export { pathDistance };
