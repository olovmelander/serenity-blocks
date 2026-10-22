/**
 * Spring — one shared world (the theme and the playground mount the same one).
 *
 * A Norrland river in its spring flood, seen from a flowering granite knoll at the outside of a
 * bend: the fall up to the left pouring over its granite step into the plunge pool at the head
 * of a short gorge, the rapids coming down to the knoll, the river swinging round under it and
 * away down the valley to the right through spruce and birch toward the snow-patched fells; and
 * everything gameplay does to them:
 *
 *   lock          a patch of the piece's own flower bursts into bloom on the knoll where it
 *                 landed, opening outward from the spot (a splash where it lands on the water)
 *   clear         one surge of white water down the rapids from the pool, the bigger the more
 *                 lines; the whole knoll flushes into bloom
 *   chain         the spring flood rises with each link: the river swells, runs whiter and faster
 *                 and the fall's mist thickens; when the chain breaks it falls back
 *   four lines    the great surge, and the last of the winter's ice goes out on it
 *   T-spin        the pool turns in a whirl where it drains
 *   back-to-back  the river glitters while the run lasts, and each back-to-back clear flares it
 *                 and lights the bow in the fall's spray, brighter each step of the run
 *   perfect       two surges, and whooper swans come over the valley (the crown on the clear it
 *                 settles after: the knoll stands in full flower, the air stills)
 *   level up      the day steps a station forward (it also turns with the clock alone); cranes pass
 *   game over     the light falls to dusk; it comes back with the next run
 *
 * and the heat of play under all of it (shared/gameplay-surge.js, HEAT below): calm play looks as
 * it always did; warm, the kinds of flower the player has been playing open all over the knoll
 * and the air stirs; hot, the river rises and runs whiter, the fall's spray swells, the breeze
 * leans the meadow and the colours deepen; in a fever the spring flood is at its height: the whole
 * knoll in flower and glowing in the colours played, the bow blazing in the spray, the river
 * glittering, cranes trumpeting over the valley. When the hands rest it all breathes back.
 * Nothing restarts: a clear's flush of bloom, a T-spin's whirl, a perfect clear's stillness and a
 * clear's breath are taken up where they stand by the next one (spring-core.js Rejoin, the shared
 * Swell), so fast play builds on what is lit instead of blinking it out.
 *
 * and the air over it all (spring-air.js, spring-motes.js): willow down and pollen drift on the
 * breeze; a lock shakes the piece's own pollen out of its patch and puffs the air round it; a
 * clear lifts pollen and down off the knoll in the cleared rows' colours and sends a breath out
 * across the valley; each link of a chain spins up a little whirlwind beside the card, the air
 * thickens and two gyres turn it, and a broken chain lets its down go; a T-spin whirls too; back-
 * to-back strikes glints off the river; a level up sends willow down drifting over from upwind;
 * a perfect clear stills the air and showers it gold.
 *
 * Lifecycle: `await SpringWorld.prepare(quality, { signal })` reads the valley's baked ground and
 * the authored trees and granite (once a session; none depend on the tier); `new SpringWorld({
 * ..., prepared }).build()` makes the scene objects; each frame `updateCamera` → `update` →
 * `prerender(renderer)` → the post renders.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { drainSteps } from '../shared/build-steps.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import {
    DEG, PIECE_COLORS, Rejoin, TAU, TIMING, approach, clamp, hexToLinear, mulberry32, smooth,
} from './spring-core.js';
import {
    EYE, RIG, S_POOL, levelAt, pointAt, riverNearest, rigFor,
} from './spring-plan.js';
import { bakeTerrain, groundHeight, waterEdge } from './spring-terrain.js';
import {
    HOURS, HourWheel, blendLight, copyLight, createLight, lightAt,
} from './spring-hours.js';
import { tierFor } from './spring-quality.js';
import {
    EVENT_ROWS, PALETTE_ROWS, PATCHES, SURGES, createLatticeTexture, createNoiseTexture, createUniforms,
} from './spring-tsl.js';
import { SPRING_FLOWERS, springFlowerSlotForPiece } from './spring-flowers.js';
import { PATCH, SpringMeadow } from './spring-meadow.js';
import { createLand } from './spring-land.js';
import { WHIRL, WHIRL_CENTRE_AT, createRiver } from './spring-river.js';
import { createPour, createStepFace } from './spring-fall.js';
import { createRocks } from './spring-rocks.js';
import { SpringForest } from './spring-forest.js';
import { createWoods } from './spring-woods.js';
import { ImpostorAtlas } from './spring-impostors.js';
import { loadSpringAssets, loadSpringValley } from './spring-assets.js';
import { createSky } from './spring-sky.js';
import { createCumulus } from './spring-cumulus.js';
import { MOTE_KIND, Motes } from './spring-motes.js';
import { AIR, SpringAir } from './spring-air.js';
import { Mist } from './spring-mist.js';
import { Floes } from './spring-floes.js';
import { Flights } from './spring-flights.js';
import { cardUnion, fallbackLayout } from './spring-composition.js';

export const SPRING_PARTS = Object.freeze(['land', 'river', 'rocks', 'trees', 'woods', 'meadow', 'fx', 'sky']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'waves', 'quads', 'tspins', 'spins', 'perfects', 'chainSteps',
    'releases', 'b2bSteps', 'levelUps', 'gameOvers', 'mornings', 'feverFlights',
];
/** How long ago (s) an event row's moment was (Infinity before it). */
const time0 = (now, born) => (now >= born ? now - born : Infinity);
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'flood', 'foamBoost', 'flowClock', 'perfectAt', 'duskFrom', 'duskTarget',
    'duskAt', 'gloryShown', 'surgeCursor', 'patchCursor', 'lastLockAt', 'levelUpAt', 'airClock', 'airGyre', 'stir',
    'airWaveAt', 'airWavePower', 'airWave2At', 'airWave2Power', 'burstSide', 'lastLockU', 'gust', 'bowShown',
    'feverFlightAt', 'lastStage',
]);
/** The envelopes and swells a rebuild in place carries over (exportSessionState). */
const ENVELOPES = Object.freeze(['flush', 'still', 'poolWhirl']);
const SWELLS = Object.freeze(['flashKick', 'floodKick', 'gustKick', 'gloryKick', 'bowKick']);

/**
 * A lock's patch of bloom: how wide it opens (radius m, wider for a hard drop) and how far, and
 * how far from the eye it blooms on the knoll when the lock landed on the water (m).
 */
export const BLOOM_PATCH = Object.freeze({
    radius: 3.2, hardRadius: 5, soft: 0.85, hard: 1, onKnoll: 8.5,
});
/** Four lines: how many floes the ice going out sends down the river. */
export const ICE_OUT = Object.freeze({ floes: 24 });
/** A line clear's flush of bloom over the whole knoll: rise, hold and fall (s). */
export const FLUSH = Object.freeze({ rise: 0.6, hold: 2.2, fall: 3.5 });

/**
 * The air (spring-air.js): how much faster a full chain runs it down the breeze, how fast its gyres
 * turn at a full chain (rad/s), the chain that stirs it fully (links), its pace under reduced
 * motion, and a clear's breath (its speed m/s; its power per line, from `wave`).
 */
export const AIR_MOTION = Object.freeze({
    hurry: 1.3,
    gyre: 0.45,
    fullChain: 8,
    reduced: 0.4,
    waveSpeed: AIR.breath.speed,
    wave: 0.45,
    wavePerLine: 0.18,
    /** A clear this soon (s) after a breath set out feeds it; a later one sends the other breath. */
    breathJoin: 1.8,
    /** The most a fed breath carries. */
    breathMost: 1.35,
});
/** A perfect clear's still, golden air: in, held, out (s from the clear). */
export const STILL = Object.freeze({ rise: 2.5, hold: 10, fall: 18 });
/** Linear RGB of each piece code (the meadow's flowers). */
const PIECE_RGB = PIECE_COLORS.map((hex) => hexToLinear(hex));
const GOLD = Object.freeze([1.0, 0.8, 0.42]);
const DOWN_WHITE = Object.freeze([1.0, 0.98, 0.94]);

/** The flood: how high each link of a chain lifts the river (m), and the most it rises. */
export const FLOOD = Object.freeze({
    perLink: 0.14, most: 0.9, foamPerLink: 0.09, foamMost: 0.6,
});

/**
 * The heat of play in the valley (GameplaySurge: `level` 0..1 how hot play runs, `fever` 0..1 a
 * sustained hot streak, `punch` each event's momentary hit), as amounts at full level / full fever:
 *   flood, foam      the river's rise (m) and extra white water under the chain's own (Fever: the
 *                    spring flood at its height); `room` how far past the chain's most they may go
 *   wave             a cascade wave past the first lifts the river this much more (m, a swell)
 *   gust             the breeze's lean on the meadow and the trees (eased: rise, fall per s)
 *   stir             the air stirs (its motes thicken, run, wobble, turn round the gyres)
 *   bloom            how far the kinds of flower the player has been playing open all over the
 *                    knoll (from `bloomFrom` to `bloomTo` of the level, plus the fever's share);
 *                    `kindHit` what a lock adds to its kind's share (a 24 s swell)
 *   flushFever       the whole knoll in flower in a fever
 *   glitter          the river glitters in a fever (a floor under back-to-back's glory)
 *   bow              how much brighter the spray bow stands (back-to-back per step of the run)
 *   saturation, iris the grade: deeper colour, and the iris closing a little so it stays deep
 *   bloomBoost       a little more glare off the brightest water and petals
 *   shafts           the sun's shafts through the fall's mist (where the sun is on screen)
 *   patch            a lock's patch of bloom opens this much wider (share of its radius), and
 *                    its light runs `patchLight` brighter through the flowers
 *   warm             the sunlight warms toward gold (at full fever; the level adds 0.4 of it)
 *   nudge            the lens dips this far (deg) at a punch of 1 (not under reduced motion)
 *   flightGap        cranes come over at most this often (s) when play breaks into a fever
 */
export const HEAT = Object.freeze({
    flood: 0.3,
    floodFever: 0.25,
    floodRoom: 0.15,
    foam: 0.25,
    foamFever: 0.2,
    foamRoom: 0.15,
    wave: 0.07,
    gust: 0.2,
    gustFever: 0.3,
    gustRise: 1.6,
    gustFall: 0.45,
    stir: 0.45,
    stirFever: 0.4,
    bloomFrom: 0.15,
    bloomTo: 0.8,
    bloom: 0.5,
    bloomFever: 0.45,
    kindHit: 0.45,
    flushFever: 0.75,
    glitter: 0.4,
    bow: 0.25,
    bowFever: 0.75,
    bowB2B: 0.3,
    saturation: 0.08,
    saturationFever: 0.06,
    iris: 0.08,
    irisFever: 0.03,
    bloomBoost: 0.08,
    bloomBoostFever: 0.06,
    shafts: 0.25,
    shaftsFever: 0.6,
    patch: 0.3,
    patchLight: 0.35,
    warm: 0.3,
    nudge: 0.16,
    flightGap: 30,
});

let BAKED = null;
/**
 * The valley's ground, the same for every tier: the shipped bake once it has been read
 * (SpringWorld.prepare), else baked here (unit tests, a failed read).
 */
export function valleyGround() {
    if (!BAKED) BAKED = bakeTerrain();
    return BAKED;
}

/** Hand the world an already decoded valley (tools and tests that read the asset themselves). */
export function useValleyGround(baked) {
    if (baked?.near?.h && baked.mid?.h && baked.far?.h) BAKED = baked;
}

function prepareData(quality, assets = null) {
    return { quality, ground: valleyGround(), assets };
}

export class SpringWorld {
    /**
     * Read the valley's baked ground and load the trees and the granite (once a session each),
     * yielding to the page first.
     */
    static async prepare(quality = 'High', { signal } = {}) {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const [assets, ground] = await Promise.all([
            loadSpringAssets({ signal }).catch((error) => {
                if (error?.name === 'AbortError') throw error;
                console.warn('[Spring] The trees and the granite could not be loaded; the valley goes without.', error);
                return null;
            }),
            loadSpringValley({ signal }).catch((error) => {
                if (error?.name === 'AbortError') throw error;
                console.warn('[Spring] The baked valley could not be read; baking it here.', error);
                return null;
            }),
        ]);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (ground && !BAKED) BAKED = ground;
        const prepared = prepareData(quality, assets);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return prepared;
    }

    /** The same, synchronously (unit tests). */
    static prepareSync(quality = 'High') {
        return prepareData(quality);
    }

    constructor({
        scene, quality = 'High', capture = false, seed = 0x5b12, prepared = null, samples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.prepared = prepared;
        this.samples = samples;
        this.root = new THREE.Group();
        this.root.name = 'Spring';
        this.parts = {};
        this.partList = [];
        this.u = createUniforms();
        // The palette: the seven flowers' colours (linear).
        const linear = new THREE.Color();
        SPRING_FLOWERS.forEach((flower, k) => {
            linear.setHex(flower.petal);
            this.u.tables.palette[PALETTE_ROWS.colour + k].set(linear.r, linear.g, linear.b, 0);
        });
        this.wheel = new HourWheel();
        this.light = createLight();
        this._hourLight = createLight();
        this._duskLight = lightAt(3.55);
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this.reducedMotion = false;
        this.disposed = false;
        this._camera = null;
        this._ray = new THREE.Vector3();
        this._sunScreen = new THREE.Vector3();
        this._sunWorld = new THREE.Vector3();
        this._hit = {
            x: 0, y: 0, z: 0, distance: 0,
        };
        this._near = {};
        this._edge = {};
        this._post = {
            exposure: 1,
            bloomBoost: 0,
            sun: {
                x: 0.2, y: 0.2, onScreen: 0, strength: 0,
            },
            shaftColour: [1, 0.9, 0.75],
            flash: 0,
            flashColour: [1, 0.95, 0.85],
            saturation: 1.1,
        };
        this.overrides = { hour: null };
        this.ground = null;
        // ── What gameplay lights, all of it taken up where it stands by the next event ──
        /** How hot play runs (shared/gameplay-surge.js); `heat` is this frame's reading of it. */
        this.playSurge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** A clear's flush of bloom over the whole knoll; a perfect clear's still, golden air. */
        this.flush = new Rejoin({
            rise: FLUSH.rise, holdEnd: FLUSH.rise + FLUSH.hold, fallEnd: FLUSH.rise + FLUSH.hold + FLUSH.fall,
        });
        this.still = new Rejoin({ rise: STILL.rise, holdEnd: STILL.hold, fallEnd: STILL.fall });
        /** A T-spin's whirl in the plunge pool (the river's shader draws the same curve). */
        this.poolWhirl = new Rejoin({
            rise: WHIRL.life[0], holdEnd: WHIRL.life[1], fallEnd: WHIRL.life[2], ceiling: 1.6,
        });
        /** A four-line clear's flash; a cascade's lift of the river; each event's push on the breeze. */
        this.flashKick = new Swell({ release: 0.35, ceiling: 0.8, knee: 0.6 });
        this.floodKick = new Swell({
            attack: 0.35, release: 4, ceiling: 0.35, knee: 0.25,
        });
        this.gustKick = new Swell({
            attack: 0.12, release: 0.9, ceiling: 0.4, knee: 0.25,
        });
        /** A back-to-back clear: the river's glitter flares, and the bow in the spray brightens. */
        this.gloryKick = new Swell({
            attack: 0.15, release: 1.8, ceiling: 0.6, knee: 0.4,
        });
        this.bowKick = new Swell({
            attack: 0.4, release: 3, ceiling: 1.2, knee: 0.8,
        });
        /** Each kind of flower's share of the player's recent locks (the heat opens those kinds). */
        this.kindBloom = SPRING_FLOWERS.map(() => new Swell({
            attack: 0.5, release: 24, ceiling: 1, knee: 0.6, headroom: 1.3,
        }));
        this.placeGyres();
        this.resetState(0);
    }

    resetState(time) {
        this.time = time;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.counts = emptyCounts();
        this.wheel.reset();
        this.flood = 0;
        this.foamBoost = 0;
        this.flowClock = time;
        this.perfectAt = -1e6;
        this.duskFrom = 0;
        this.duskTarget = 0;
        this.duskAt = -1e6;
        this.dusk = 0;
        this.gloryShown = 0;
        this.surgeCursor = 0;
        this.patchCursor = 0;
        this.lastLockAt = -1e6;
        this.levelUpAt = -1e6;
        this.airClock = time;
        this.airGyre = 0;
        this.stir = 0;
        this.airWaveAt = -1e6;
        this.airWavePower = 0;
        this.airWave2At = -1e6;
        this.airWave2Power = 0;
        this.gust = 1;
        this.bowShown = 1;
        this.feverFlightAt = -1e6;
        this.lastStage = 0;
        this.playSurge.reset();
        Object.assign(this.heat, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
        for (const key of ENVELOPES) this[key].reset();
        for (const key of SWELLS) this[key].reset();
        for (const swell of this.kindBloom) swell.reset();
        for (let k = 0; k < PALETTE_ROWS.count; k++) this.u.tables.palette[PALETTE_ROWS.colour + k].w = 0;
        this.burstSide = 1;
        this.lastLockU = 0.5;
        this.lastRgb = [...GOLD];
        const { events } = this.u.tables;
        for (let k = 0; k < SURGES; k++) events[EVENT_ROWS.surge + k].set(-1e6, 0, 0, 0);
        for (let k = 0; k < PATCHES; k++) {
            events[EVENT_ROWS.patch + k * 2].set(0, 0, -1e6, 0);
            events[EVENT_ROWS.patch + k * 2 + 1].set(-1, 1, 0, 0);
        }
        this.u.whirl.value.set(-1e6, 0);
        this.random = mulberry32(this.seed ^ 0x51ab);
        this.parts?.fx?.reset?.();
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /** The build as steps, a part to a step (shared/build-steps.js breathes between them). */
    * buildSteps() {
        if (this.root.parent) return;
        const prepared = this.prepared || SpringWorld.prepareSync(this.quality);
        this.prepared = null;
        this.ground = prepared.ground;
        const { tier } = this;
        this.textures = {
            noise: createNoiseTexture(),
            lattice: createLatticeTexture(),
        };
        // The ground, and the granite step the river falls over (its own sheer face).
        const land = createLand(this.u, this.textures, tier, this.ground);
        const face = createStepFace(this.u, this.textures, tier, this.ground);
        this.addPart('land', {
            mesh: land.mesh,
            meshes: [land.mesh, face.mesh],
            dispose: () => {
                land.dispose();
                face.dispose();
            },
        });
        yield 'land';
        // The river's surface, and the fall's water pouring over the step.
        const river = createRiver(this.u, this.textures, tier, this.ground);
        const pour = createPour(this.u, this.textures, tier);
        this.addPart('river', {
            mesh: river.mesh,
            meshes: [river.mesh, pour.mesh],
            dispose: () => {
                river.dispose();
                pour.dispose();
            },
        });
        yield 'river';
        this.addPart('rocks', createRocks(this.u, this.textures, prepared.assets, this.ground, tier));
        yield 'rocks';
        if (prepared.assets) {
            const forest = new SpringForest(this.u, this.textures, prepared.assets, tier).build(this.ground);
            this.forest = forest;
            this.addPart('trees', {
                mesh: forest.group, meshes: [forest.group], stats: forest.stats, dispose: () => forest.dispose(),
            });
        } else {
            this.addPart('trees', { mesh: null, meshes: [], dispose() {} });
        }
        yield 'trees';
        // The woods: cards of the modelled trees, from an atlas bakeImpostors() draws once (the
        // simple trees when the models could not be loaded).
        this.impostors = prepared.assets
            ? new ImpostorAtlas(this.u, this.textures, prepared.assets, { cellPixels: tier.impostorCell ?? 256 })
            : null;
        const woods = createWoods(this.u, this.textures, tier, this.ground, {
            atlas: this.impostors, samples: this.samples,
        });
        this.addPart('woods', {
            ...woods,
            dispose: () => {
                woods.dispose();
                this.impostors?.dispose();
                this.impostors = null;
            },
        });
        yield 'woods';
        const meadow = new SpringMeadow(this.u, this.textures, tier, this.ground);
        yield* meadow.buildSteps();
        this.meadow = meadow;
        this.addPart('meadow', {
            mesh: meadow.group, meshes: [meadow.group], stats: meadow.stats, dispose: () => meadow.dispose(),
        });
        yield 'meadow';
        // The effects: the fall's mist, the air's down and pollen, what gameplay throws into the air,
        // the ice going out, birds.
        this.motes = new Motes(this.u, tier.motes);
        this.air = new SpringAir(this.u, tier.air);
        // Bursts are sized to the tier's ring of motes (gently: a burst must still read on Minimal),
        // so a busy moment does not eat its own start.
        this.burstScale = clamp(Math.sqrt(tier.motes / 1280), 0.55, 1.35);
        this.mist = new Mist(this.u, this.textures, tier.mist);
        this.floes = new Floes(this.u, tier.floes);
        // Three flights at once: a perfect clear's swans, a level-up's cranes and a fever's.
        this.flights = new Flights(this.u, { slots: 3 });
        this.addPart('fx', {
            mesh: this.motes.mesh,
            meshes: [this.mist.mesh, this.air.mesh, this.motes.mesh, this.floes.mesh, ...this.flights.meshes],
            reset: () => {
                this.motes.clear();
                this.floes.clear();
                this.flights.clear();
            },
            dispose: () => {
                this.motes.dispose();
                this.air.dispose();
                this.mist.dispose();
                this.floes.dispose();
                this.flights.dispose();
            },
        });
        yield 'fx';
        const sky = createSky(this.u, this.textures, tier);
        const banks = createCumulus(this.u, this.textures, tier, tier.banks);
        this.addPart('sky', {
            mesh: sky.mesh,
            meshes: [sky.mesh, banks.mesh],
            dispose: () => {
                sky.dispose();
                banks.dispose();
            },
        });
        this.scene.add(this.root);
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

    setReducedMotion(value) { this.reducedMotion = value === true; }

    setCaptureOverrides(overrides) { Object.assign(this.overrides, overrides); }

    setViewport(width, height, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.u.aspect.value = this.aspect;
        this.viewportHeight = Math.max(1, height);
        if (!this.layoutLive) this.layout = fallbackLayout(width, height);
        this.placeGyres();
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(1920, 1920 / Math.max(0.2, this.aspect));
        this.placeGyres();
    }

    /**
     * Where the chain's gyres (and its whirlwinds) stand: on the knoll's top in the middle of the
     * free strip left of the card and right of it (or of the HUD beside it), at the lens at rest.
     */
    placeGyres() {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const { hud } = this.layout;
        const rightEdge = hud && hud.x0 > card.x1 && hud.x0 - card.x1 < 0.1 ? hud.x1 : card.x1;
        const rig = rigFor(this.aspect);
        const across = Math.tan((rig.fov * DEG) / 2) * this.aspect;
        const bearingAt = (sx) => rig.yaw + Math.atan((sx * 2 - 1) * across) / DEG;
        const left = pointAt(bearingAt(Math.max(0.03, card.x0 * 0.45)), AIR.gyre.distance);
        const right = pointAt(bearingAt(Math.min(0.97, rightEdge + (1 - rightEdge) * 0.55)), AIR.gyre.distance);
        this.gyres = [left, right];
        this.u.airGyres.value.set(left.x, left.z, right.x, right.z);
    }

    /** The rest pose plus a slow drift of the lens and the pointer's parallax. */
    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.set(EYE.x, EYE.y, EYE.z);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 83) * 0.35 + clamp(pointerX, -1, 1) * 0.8);
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 61) * 0.12 - clamp(pointerY, -1, 1) * 0.25);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        if (rig.shift) {
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
        // The shared breath (shared/camera-breath.js) on top of pose()'s drift. Off under reduced motion.
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        // Each event's punch dips the lens a touch (it rides on a floor under rapid locks rather
        // than juddering; the last frame's reading). Off under reduced motion.
        const nudge = this.reducedMotion ? 0 : this.heat.punch * HEAT.nudge;
        if (nudge > 1e-4) {
            camera.rotateX(-nudge * DEG);
            camera.updateMatrixWorld();
        }
        this._camera = camera;
    }

    // ── Where on the valley an event happens ─────────────────────────────────────

    /**
     * The surface (ground or water) under a screen point (fractions, y down): marched along the
     * view ray over the baked ground and the river's level. Null when the ray meets nothing within
     * `far` metres. `water` is true when it met the river.
     */
    surfaceAt(sx, sy, out = this._hit, far = 600) {
        const camera = this._camera;
        if (!camera || !this.ground) return null;
        camera.updateMatrixWorld();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const o = camera.position;
        const d = this._ray;
        if (d.y > 0.05) return null;
        // The surface: the river's where the baked edge says there is water, else the ground.
        const w = this._edge;
        const surface = (x, z) => {
            const ground = groundHeight(this.ground, x, z);
            waterEdge(this.ground, x, z, w);
            return w.edge < 0 ? Math.max(ground, w.level + this.flood) : ground;
        };
        let prev = 0.5;
        for (let t = 0.5; t < far; t += Math.max(0.25, t * 0.02)) {
            if (o.y + d.y * t <= surface(o.x + d.x * t, o.z + d.z * t) + 0.05) {
                // Halve back to the surface.
                let a = prev;
                let b = t;
                for (let k = 0; k < 8; k++) {
                    const m = (a + b) / 2;
                    if (o.y + d.y * m <= surface(o.x + d.x * m, o.z + d.z * m) + 0.05) b = m;
                    else a = m;
                }
                out.x = o.x + d.x * b;
                out.z = o.z + d.z * b;
                const ground = groundHeight(this.ground, out.x, out.z);
                out.y = surface(out.x, out.z);
                out.water = out.y > ground + 0.02;
                out.s = riverNearest(out.x, out.z, this._near).s;
                out.distance = Math.hypot(out.x - EYE.x, out.z - EYE.z);
                return out;
            }
            prev = t;
        }
        return null;
    }

    /**
     * The screen point a lock at board column `u` and row `row` happens at: the valley on that
     * side of the card (column 0 far left … column 1 far right), the floor rows nearest the eye.
     */
    sitePoint(u = 0.5, row = 14) {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const f = clamp(row, 0, 19) / 19;
        if (this.aspect < 0.75) {
            const left = Math.max(0.02, card.x0 * 0.45);
            const right = Math.min(0.98, card.x1 + (1 - card.x1) * 0.55);
            return { x: u < 0.5 ? left : right, y: 0.2 + 0.22 * f };
        }
        const { hud } = this.layout;
        let lo;
        let hi;
        let k;
        if (u < 0.5) {
            lo = 0.06;
            hi = card.x0 - 0.025;
            k = u / 0.5;
        } else {
            lo = card.x1 + 0.025;
            hi = 0.95;
            if (hud && hud.x0 > card.x1 && hud.x1 < hi && hud.y1 > 0.55) {
                if (0.95 - hud.x1 > hud.x0 - lo) lo = hud.x1 + 0.02;
                else hi = hud.x0 - 0.02;
            }
            k = (u - 0.5) / 0.5;
        }
        return { x: lo + (hi - lo) * clamp(k, 0, 1), y: 0.55 + 0.4 * f };
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────────

    onLock(context = {}) {
        if (this.disposed) return;
        this.counts.locks++;
        const hard = Boolean(context.hardDrop);
        if (hard) this.counts.hardDrops++;
        this.lastLockAt = this.time;
        if (this.duskTarget > 0) this.onSessionStart();
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : [14];
        const row = rows.reduce((a, b) => a + b, 0) / rows.length;
        const p = this.sitePoint(context.u ?? 0.5, row);
        const site = this.surfaceAt(p.x, p.y);
        // A patch of the piece's own flower bursts into bloom where it landed (the anemones for
        // a shape the meadow has no flower for); on the water it splashes, and the patch opens
        // on the knoll's near edge at the same bearing.
        const kind = springFlowerSlotForPiece(context.shape);
        const slot = kind >= 0 ? kind : SPRING_FLOWERS.find((f) => f.id === 'anemone').slot;
        // The hotter play runs, the wider each patch opens.
        const radius = (hard ? BLOOM_PATCH.hardRadius : BLOOM_PATCH.radius) * (1 + HEAT.patch * this.heat.level);
        // (and the brighter its light runs through the flowers).
        const power = (hard ? BLOOM_PATCH.hard : BLOOM_PATCH.soft) * (1 + HEAT.patchLight * this.heat.level);
        const onKnoll = site && !site.water && site.distance < 40;
        if (!onKnoll && site?.water) this.spray(site, hard ? 1 : 0.5);
        const b = onKnoll ? 0
            : Math.atan2(site ? site.x - EYE.x : (context.u ?? 0.5) - 0.5, site ? -(site.z - EYE.z) : 1);
        const x = onKnoll ? site.x : EYE.x + Math.sin(b) * BLOOM_PATCH.onKnoll;
        const z = onKnoll ? site.z : EYE.z - Math.cos(b) * BLOOM_PATCH.onKnoll;
        this.bloomPatch(x, z, slot, power, radius);
        // The piece's own pollen shaken out of the patch as it opens (its flower's colour).
        const rgb = typeof context.color === 'string' ? hexToLinear(context.color, [0, 0, 0]) : null;
        const tone = rgb && rgb[0] + rgb[1] + rgb[2] > 0.05
            ? rgb : this.u.tables.palette[PALETTE_ROWS.colour + slot].toArray().slice(0, 3);
        this.lastRgb = tone;
        this.lastLockU = clamp(Number(context.u ?? 0.5), 0, 1);
        this.pollenBurst(x, z, tone, hard, radius);
        // Its kind's share of the knoll (the heat opens the kinds played), a push on the breeze,
        // and the heat of play.
        this.kindBloom[slot]?.hit(power * HEAT.kindHit, this.time);
        this.gustKick.hit(hard ? 0.14 : 0.07, this.time);
        this.playSurge.lock(context, this.time);
        if (context.tspin) this.onSpin();
    }

    /** True when gameplay may throw motes into the air (not under reduced motion). */
    canBurst() {
        return Boolean(this.motes) && !this.reducedMotion && Boolean(this.ground);
    }

    /** The surface's height at (x, z): the ground, or the river's where it runs (the knoll's with no ground). */
    floorAt(x, z) {
        if (!this.ground) return EYE.y - 1.6;
        const ground = groundHeight(this.ground, x, z);
        waterEdge(this.ground, x, z, this._edge);
        return this._edge.edge < 0 ? Math.max(ground, this._edge.level + this.flood) : ground;
    }

    /**
     * A lock's pollen: specks of the piece's colour (and a little gold) shaken up out of its patch
     * of bloom in an arc, drifting off on the breeze, and glints on the cups as they open; a hard
     * drop shakes out more and higher, and knocks a ring of down off the plants.
     */
    pollenBurst(x, z, rgb, hard, radius) {
        if (!this.canBurst()) return;
        const r = this.random;
        const y = this.floorAt(x, z) + 0.25;
        const count = Math.round((hard ? 96 : 60) * this.burstScale);
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const at = Math.sqrt(r()) * radius * 0.55;
            const out = 0.2 + r() * 0.6;
            const gold = r() < 0.2;
            this.motes.spawn({
                x: x + Math.cos(a) * at,
                y: y + r() * 0.3,
                z: z + Math.sin(a) * at,
                vx: Math.cos(a) * out,
                vy: (hard ? 2.0 : 1.4) * (0.5 + r()),
                vz: Math.sin(a) * out,
                born: this.time + r() * 0.5,
                life: 5 + r() * 3,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: gold ? GOLD : rgb,
                kind: MOTE_KIND.pollen,
                seed: r(),
                drift: 0.25,
                gravity: -0.25,
            });
        }
        const glints = Math.round(10 * this.burstScale);
        for (let i = 0; i < glints; i++) {
            const a = r() * TAU;
            const at = Math.sqrt(r()) * radius * 0.8;
            this.motes.spawn({
                x: x + Math.cos(a) * at,
                y: y + 0.05 + r() * 0.2,
                z: z + Math.sin(a) * at,
                born: this.time + r() * 0.9,
                life: 0.35 + r() * 0.5,
                size: 0.06,
                rgb: [1.0, 0.97, 0.9],
                kind: MOTE_KIND.glint,
                seed: r(),
            });
        }
        if (!hard) return;
        const ring = Math.round(14 * this.burstScale);
        for (let i = 0; i < ring; i++) {
            const a = (i / ring) * TAU + r() * 0.3;
            this.motes.spawn({
                x: x + Math.cos(a) * 0.4,
                y: y + 0.1,
                z: z + Math.sin(a) * 0.4,
                vx: Math.cos(a) * (1.1 + r() * 0.6),
                vy: 0.4 + r() * 0.5,
                vz: Math.sin(a) * (1.1 + r() * 0.6),
                born: this.time + r() * 0.15,
                life: 6 + r() * 3,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: DOWN_WHITE,
                kind: MOTE_KIND.down,
                seed: r(),
                drift: 0.4,
                gravity: -0.06,
            });
        }
    }

    /**
     * A clear: pollen and down lift off the knoll either side of the card in the colours of the
     * rows that went (each side the colours of its half of the board), three puffs a side running
     * out from the card, the more the more lines.
     */
    clearDrift(lines, rowCodes) {
        if (!this.canBurst()) return;
        const r = this.random;
        const codes = Array.isArray(rowCodes) || ArrayBuffer.isView(rowCodes) ? Array.from(rowCodes) : [];
        const sideColour = (left) => {
            const sum = [0, 0, 0];
            let n = 0;
            for (let k = 0; k < codes.length; k++) {
                const column = k % 10;
                const code = codes[k];
                if ((column < 5) !== left || !(code >= 0 && code < 7)) continue;
                sum[0] += PIECE_RGB[code][0];
                sum[1] += PIECE_RGB[code][1];
                sum[2] += PIECE_RGB[code][2];
                n += 1;
            }
            return n ? sum.map((v) => v / n) : [...this.lastRgb];
        };
        const perPuff = Math.round((12 + 7 * lines) * this.burstScale);
        for (const side of [-1, 1]) {
            const rgb = sideColour(side < 0);
            for (let k = 0; k < 3; k++) {
                const p = pointAt(side * (22 + k * 9), 9 + k * 1.5);
                const y = this.floorAt(p.x, p.z) + 0.3;
                for (let i = 0; i < perPuff; i++) {
                    const a = r() * TAU;
                    const at = Math.sqrt(r()) * 2.2;
                    const down = r() < 0.3;
                    this.motes.spawn({
                        x: p.x + Math.cos(a) * at,
                        y: y + r() * 0.4,
                        z: p.z + Math.sin(a) * at,
                        vx: Math.cos(a) * 0.5 + AIR.breeze[0] * 0.4,
                        vy: (0.9 + 0.15 * lines) * (0.5 + r()),
                        vz: Math.sin(a) * 0.5 + AIR.breeze[1] * 0.4,
                        born: this.time + k * 0.22 + r() * 0.3,
                        life: 5 + r() * 3,
                        size: (down ? 0.075 : 0.05) * (0.7 + r() * 0.6),
                        rgb: down ? DOWN_WHITE : rgb,
                        kind: down ? MOTE_KIND.down : MOTE_KIND.pollen,
                        seed: r(),
                        drift: 0.3,
                        gravity: down ? -0.04 : 0,
                    });
                }
            }
        }
    }

    /**
     * A little whirlwind of pollen and down beside the card (on side -1 left, 1 right), `strength`
     * 1 for a chain's second link and more for each after it.
     */
    whirlwind(side, strength, rgb) {
        if (!this.canBurst()) return;
        const r = this.random;
        const g = this.gyres[side < 0 ? 0 : 1];
        const turnWay = AIR.gyre.turn[side < 0 ? 0 : 1];
        const y = this.floorAt(g.x, g.z) + 0.15;
        const count = Math.round(Math.min(240, 44 + 22 * strength) * this.burstScale);
        const radius = Math.min(1.7, 0.55 + 0.12 * strength);
        const climb = Math.min(1.8, 0.65 + 0.1 * strength);
        const turn = Math.min(5, 2.4 + 0.25 * strength) * turnWay;
        for (let i = 0; i < count; i++) {
            const down = r() < 0.3;
            const gold = r() < 0.3;
            // A funnel: narrow at the foot, the circle widening as the mote climbs.
            const rise = climb * (0.55 + r() * 0.9);
            this.motes.whirl({
                x: g.x,
                y: y + r() * 0.3,
                z: g.z,
                radius: radius * (0.15 + r() * 0.3),
                climb: rise,
                turn: turn * (0.8 + r() * 0.4),
                grow: rise * (0.3 + r() * 0.15),
                born: this.time + r() * 0.9,
                life: 3.2 + r() * 2.6,
                size: (down ? 0.075 : 0.05) * (0.7 + r() * 0.6),
                rgb: (down && DOWN_WHITE) || (gold && GOLD) || rgb,
                seed: r(),
            });
        }
    }

    /** A broken chain lets go of its down: tufts lift off the whole knoll and drift away. */
    exhale(peak) {
        if (!this.canBurst()) return;
        const r = this.random;
        const count = Math.round(Math.min(190, 22 * peak) * this.burstScale);
        for (let i = 0; i < count; i++) {
            const p = pointAt(-48 + r() * 92, 4 + r() * 11);
            this.motes.spawn({
                x: p.x,
                y: this.floorAt(p.x, p.z) + 0.2 + r() * 0.6,
                z: p.z,
                vx: AIR.breeze[0] * 0.5 * r(),
                vy: 0.5 + r() * 0.9,
                vz: AIR.breeze[1] * 0.5 * r(),
                born: this.time + r() * 1.4,
                life: 6 + r() * 4,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: r() < 0.2 ? GOLD : DOWN_WHITE,
                kind: r() < 0.2 ? MOTE_KIND.pollen : MOTE_KIND.down,
                seed: r(),
                drift: 0.4,
                gravity: -0.03,
            });
        }
    }

    /** Back-to-back: glints struck off the river's ripples in front of the knoll, more each level. */
    riverGlints(level) {
        if (!this.canBurst() || !this._camera) return;
        const r = this.random;
        const hits = [];
        for (let k = 0; k < 10; k++) {
            const sx = k < 5 ? 0.04 + k * 0.065 : 0.66 + (k - 5) * 0.065;
            const site = this.surfaceAt(sx, 0.56 + r() * 0.08);
            if (site?.water) hits.push({ ...site });
        }
        if (!hits.length) return;
        const count = Math.round(Math.min(90, 22 * level) * this.burstScale);
        for (let i = 0; i < count; i++) {
            const h = hits[Math.floor(r() * hits.length)];
            const spread = 1.5 + h.distance * 0.12;
            this.motes.spawn({
                x: h.x + (r() - 0.5) * spread * 2,
                y: h.y + 0.05,
                z: h.z + (r() - 0.5) * spread * 2,
                born: this.time + r() * 1.6,
                life: 0.35 + r() * 0.45,
                size: 0.045 * clamp(h.distance / 14, 0.7, 3),
                rgb: [1.0, 0.97, 0.9],
                kind: MOTE_KIND.glint,
                seed: r(),
            });
        }
    }

    /** A level up: willow down drifting over from the birches upwind, across the knoll. */
    downDrift() {
        if (!this.canBurst()) return;
        const r = this.random;
        const count = Math.round(110 * this.burstScale);
        for (let i = 0; i < count; i++) {
            const p = pointAt(-52 + r() * 34, 10 + r() * 12);
            this.motes.spawn({
                x: p.x,
                y: EYE.y + 0.5 + r() * 4.5,
                z: p.z,
                vx: AIR.breeze[0] * (0.5 + r() * 0.5),
                vy: 0.1 + r() * 0.3,
                vz: AIR.breeze[1] * (0.5 + r() * 0.5),
                born: this.time + r() * 2.5,
                life: 9 + r() * 4,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: DOWN_WHITE,
                kind: MOTE_KIND.down,
                seed: r(),
                drift: 0.5,
                gravity: -0.04,
            });
        }
    }

    /** A perfect clear: gold pollen and down showering slowly over the knoll and the river. */
    goldShower() {
        if (!this.canBurst()) return;
        const r = this.random;
        const count = Math.round(200 * this.burstScale);
        for (let i = 0; i < count; i++) {
            const p = pointAt(-46 + r() * 90, 6 + r() * 20);
            const down = r() < 0.35;
            this.motes.spawn({
                x: p.x,
                y: EYE.y + 2 + r() * 6,
                z: p.z,
                vx: (r() - 0.5) * 0.3,
                vy: 0.15 * r(),
                vz: (r() - 0.5) * 0.3,
                born: this.time + r() * 2.2,
                life: 8 + r() * 4,
                size: (down ? 0.075 : 0.05) * (0.7 + r() * 0.6),
                rgb: down ? DOWN_WHITE : GOLD,
                kind: down ? MOTE_KIND.down : MOTE_KIND.pollen,
                seed: r(),
                drift: 0.3,
                gravity: -0.12,
            });
        }
    }

    /**
     * A patch of one kind of flower bursting into bloom round (x, z). Only the patches the tier's
     * meadow reads are written (a lock written past them bloomed nothing), and a new one takes the
     * patch that has closed furthest (the oldest of those closed alike); what a patch still open
     * had left goes to its kind's share of the knoll, which the heat of play opens.
     */
    bloomPatch(x, z, slot, power, radius) {
        const { events } = this.u.tables;
        const shown = clamp(Math.round(this.tier?.patches ?? PATCHES), 1, PATCHES);
        let k = 0;
        let least = Infinity;
        for (let i = 0; i < shown; i++) {
            const where = events[EVENT_ROWS.patch + i * 2];
            const age = this.time - where.z;
            const left = age < 0 ? where.w : where.w * (1 - smooth(PATCH.hold, PATCH.hold + PATCH.close, age));
            if (left < least - 1e-6 || (left <= least + 1e-6 && where.z < events[EVENT_ROWS.patch + k * 2].z)) {
                least = Math.min(least, left);
                k = i;
            }
        }
        const taken = Math.round(events[EVENT_ROWS.patch + k * 2 + 1].x);
        if (least > 0.02) this.kindBloom[taken]?.hit(least * 0.3, this.time);
        this.patchCursor = (this.patchCursor + 1) % (PATCHES * 1000);
        events[EVENT_ROWS.patch + k * 2].set(x, z, this.time, power);
        events[EVENT_ROWS.patch + k * 2 + 1].set(slot, radius, 0, 0);
    }

    /** Spray thrown up from the water (or dew off the ground) at a site. */
    spray(site, power) {
        if (!this.motes) return;
        const r = this.random;
        const scale = clamp(site.distance / 14, 0.7, 3);
        const count = Math.round(18 + 30 * power);
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const out = (0.6 + r() * 1.8) * power;
            this.motes.spawn({
                x: site.x + Math.cos(a) * r() * 0.8,
                y: site.y + 0.1,
                z: site.z + Math.sin(a) * r() * 0.8,
                vx: Math.cos(a) * out,
                vy: 2.2 + r() * 3.2 * power,
                vz: Math.sin(a) * out,
                born: this.time + r() * 0.08,
                life: 0.9 + r() * 0.7,
                size: 0.03 * scale,
                rgb: [0.9, 0.95, 1.0],
                kind: MOTE_KIND.dew,
                seed: r(),
                drift: 0,
                gravity: -9.8,
            });
        }
    }

    /**
     * A surge of white water down the rapids from the pool (power ~1 a line). It takes the surge
     * with the least left of it (faded furthest down the river), never one still to set out.
     */
    surge(power, delay = 0) {
        const { events } = this.u.tables;
        let slot = 0;
        let least = Infinity;
        for (let k = 0; k < SURGES; k++) {
            const row = events[EVENT_ROWS.surge + k];
            const age = this.time - row.x;
            let left = 0;
            if (age < 0) left = Infinity;
            else if (age < 60) left = row.y * Math.exp(-age * 0.05);
            if (left < least) {
                least = left;
                slot = k;
            }
        }
        this.surgeCursor = (this.surgeCursor + 1) % (SURGES * 1000);
        events[EVENT_ROWS.surge + slot].set(this.time + delay, power, 0, 0);
    }

    /**
     * A clear's breath out across the valley from the eye. A clear soon after a breath set out
     * feeds it (it rolls on, stronger); a later one sends the other breath, so neither is ever cut
     * short mid-crossing by the next.
     */
    breathe(power) {
        const t = this.time;
        const newestIsA = this.airWaveAt >= this.airWave2At;
        const newestAt = newestIsA ? this.airWaveAt : this.airWave2At;
        if (t >= newestAt && t - newestAt < AIR_MOTION.breathJoin) {
            const held = newestIsA ? this.airWavePower : this.airWave2Power;
            const fed = Math.min(AIR_MOTION.breathMost, Math.max(held, power) + 0.3 * Math.min(held, power));
            if (newestIsA) this.airWavePower = fed;
            else this.airWave2Power = fed;
            return;
        }
        // The older of the two (by now far out over the valley, or spent).
        if (this.airWaveAt <= this.airWave2At) {
            this.airWaveAt = t;
            this.airWavePower = power;
        } else {
            this.airWave2At = t;
            this.airWave2Power = power;
        }
    }

    onClear(context = {}) {
        if (this.disposed) return;
        // A perfect clear the game settled after the clear it crowns (the director's `crown`): the
        // crown on the clear still playing, never a second clear of rows already gone.
        if (context.perfect && context.crown) {
            this.onPerfect();
            this.playSurge.crown(this.time);
            return;
        }
        const lines = clamp(Math.round(context.lines || 1), 1, 4);
        // A cascade's waves build on each other: each deeper one sends a bigger surge, a fuller
        // flush and breath, more of the knoll's pollen, and lifts the river a step more.
        const deeper = clamp(Math.round(context.cascade || 1), 1, 10) - 1;
        this.counts.clears++;
        this.counts.lines += lines;
        if (deeper > 0) this.counts.waves++;
        // One surge down the rapids, the bigger the more lines; the whole knoll flushes into bloom
        // (taken up where the last clear's flush stands), its pollen and down lift off it, and a
        // breath runs out through the air.
        this.surge(0.55 + lines * 0.3 + deeper * 0.25, 0);
        this.flush.hit(Math.min(1, 0.45 + lines * 0.15 + deeper * 0.1), this.time, 0.1);
        this.breathe(Math.min(1.25, AIR_MOTION.wave + AIR_MOTION.wavePerLine * lines) + deeper * 0.1);
        if (deeper > 0) this.floodKick.hit(HEAT.wave * deeper, this.time);
        this.gustKick.hit(0.1 + 0.05 * lines, this.time);
        this.clearDrift(lines + deeper * 0.5, context.rowCodes);
        if (lines === 4) this.onQuad();
        if (context.tspin) this.onTSpin(context);
        if (context.b2b) this.onB2BClear();
        // A perfect clear in the clear's own frame: the clear, and its crown on top.
        if (context.perfect) this.onPerfect();
        this.playSurge.clear(context, this.time);
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    /** Four lines: the clear's surge is the great one, and the last of the winter's ice goes out on it. */
    onQuad() {
        this.counts.quads++;
        this.floes?.breakUp(this.time + 1.6, ICE_OUT.floes);
        this.flashKick.hit(0.5, this.time);
    }

    /** The plunge pool's whirl, taken up where it stands (a second T-spin keeps it turning, harder). */
    spinPool(power) {
        this.poolWhirl.hit(power, this.time, 0.3);
        this.u.whirl.value.set(this.poolWhirl.at, this.poolWhirl.power);
    }

    /** A T-spin: the plunge pool turns in a whirl, and so does the air beside the card on its side. */
    onTSpin() {
        this.counts.tspins++;
        this.spinPool(1);
        this.whirlSpray();
        this.whirlwind(this.lastLockU < 0.5 ? -1 : 1, 5, PIECE_RGB[1]);
    }

    /** A T-spin that cleared nothing: the pool stirs a little, and a small whirl of air beside the card. */
    onSpin() {
        this.counts.spins++;
        this.spinPool(0.45);
        this.whirlSpray(36);
        this.whirlwind(this.lastLockU < 0.5 ? -1 : 1, 2, PIECE_RGB[1]);
        this.playSurge.spin(this.time);
    }

    /**
     * A back-to-back clear: the river's glitter flares and the bow in the fall's spray brightens,
     * more for each step of the run (the run's own glitter and bow hold while it lasts).
     */
    onB2BClear() {
        const step = Math.min(4, this.b2b + 1);
        this.gloryKick.hit(0.25 + 0.08 * step, this.time);
        this.bowKick.hit(0.35 + 0.15 * step, this.time);
    }

    /** Spray flung off the whirl's rim as it spins up: it turns, seen even edge-on. */
    whirlSpray(count = 90) {
        if (!this.motes) return;
        const r = this.random;
        const c = WHIRL_CENTRE_AT;
        const level = levelAt(S_POOL + WHIRL.at) + this.flood;
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const rim = WHIRL.radius * (0.35 + r() * 0.5);
            // Tangential (the whirl turns anticlockwise seen from above), a little outward and up.
            const speed = 2.5 + r() * 3.5;
            this.motes.spawn({
                x: c.x + Math.cos(a) * rim,
                y: level + 0.15,
                z: c.z + Math.sin(a) * rim,
                vx: -Math.sin(a) * speed + Math.cos(a) * 0.6,
                vy: 1.6 + r() * 2.6,
                vz: Math.cos(a) * speed + Math.sin(a) * 0.6,
                born: this.time + 0.4 + r() * 2.6,
                life: 0.9 + r() * 0.8,
                size: 0.09,
                rgb: [0.92, 0.96, 1.0],
                kind: MOTE_KIND.dew,
                seed: r(),
                drift: 0,
                gravity: -9.8,
            });
        }
    }

    /**
     * A perfect clear: the river surges twice, the whole knoll stands in flower, the air stills
     * and showers gold, and whooper swans come over the valley.
     */
    onPerfect() {
        this.counts.perfects++;
        this.perfectAt = this.time;
        this.still.hit(1, this.time);
        this.flush.hit(1, this.time);
        this.surge(1.4, 0);
        this.surge(1.4, 1.2);
        this.flights?.launch('swan', this.time);
        this.goldShower();
    }

    onCombo(value) {
        const n = clamp(Math.round(value) || 0, 0, 1000);
        if (n === this.combo) return;
        if (n > this.combo && n >= 2) {
            this.counts.chainSteps++;
            // Each link spins up a whirlwind beside the card, on alternate sides, stronger each time.
            this.burstSide = -this.burstSide;
            this.whirlwind(this.burstSide, n - 1, this.lastRgb);
        }
        if (n === 0 && this.peak >= 3) {
            this.counts.releases++;
            this.exhale(this.peak);
        }
        this.combo = n;
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
    }

    onB2B(value) {
        const n = clamp(Math.round(value) || 0, 0, 4);
        if (n > this.b2b) {
            this.counts.b2bSteps++;
            this.riverGlints(n);
        }
        this.b2b = n;
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n === this.level) return;
        const up = n > this.level;
        this.wheel.levelUp(n, time, silent || this.reducedMotion);
        this.level = n;
        if (up && !silent) {
            this.counts.levelUps++;
            this.levelUpAt = time;
            // The day steps on, cranes pass over on their way north, and willow down drifts over.
            this.flights?.launch('crane', time);
            this.downDrift();
            this.playSurge.levelUp(time);
        }
    }

    onGameOver() {
        this.counts.gameOvers++;
        this.duskFrom = this.dusk;
        this.duskTarget = 1;
        this.duskAt = this.time;
    }

    onSessionStart() {
        if (this.duskTarget > 0) this.counts.mornings++;
        this.duskFrom = this.dusk;
        this.duskTarget = 0;
        this.duskAt = this.time;
    }

    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.level = 1;
        this.wheel.newRun();
    }

    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const { time, u } = this;
        const dt = Math.max(0, Math.min(0.25, sim.delta || 0));
        // ── The heat of play: read once a frame, on the theme's clock ──
        const sample = this.playSurge.sample(time);
        const { heat } = this;
        heat.punch = sample.punch;
        heat.level = sample.level;
        heat.fever = sample.fever;
        heat.stage = sample.stage;
        const { level, fever } = heat;
        if (this.motes) this.motes.now = time;
        this.dusk = this.duskFrom + (this.duskTarget - this.duskFrom)
            * smooth(0, this.duskTarget ? TIMING.dusk : TIMING.dawn, time - this.duskAt);
        const place = this.overrides.hour !== null ? this.overrides.hour : this.wheel.place(time);
        lightAt(place, this._hourLight);
        const L = this.dusk > 0.001
            ? blendLight(this._hourLight, this._duskLight, this.dusk * 0.85, this.light)
            : copyLight(this._hourLight, this.light);
        u.sunDir.value.set(L.dir[0], L.dir[1], L.dir[2]);
        u.sunUp.value = L.sunUp;
        u.sunEl.value = L.el;
        u.skyline.value = L.skyline;
        // The heat of play warms the sunlight toward gold (the iris closes to match, updatePost).
        const warm = HEAT.warm * (0.4 * level + fever);
        u.sun.value.set(L.sun[0] * (1 + warm * 0.3), L.sun[1] * (1 + warm * 0.08), L.sun[2] * (1 - warm * 0.35));
        u.fill.value.set(L.fill[0], L.fill[1], L.fill[2]);
        u.bounce.value.set(L.bounce[0], L.bounce[1], L.bounce[2]);
        u.zenith.value.set(L.zenith[0], L.zenith[1], L.zenith[2]);
        u.horizon.value.set(L.horizon[0], L.horizon[1], L.horizon[2]);
        u.glow.value.set(L.glow[0] * (1 + warm * 0.2), L.glow[1], L.glow[2] * (1 - warm * 0.3));
        u.haze.value.set(L.haze[0], L.haze[1], L.haze[2]);
        u.mist.value.set(L.mist[0], L.mist[1], L.mist[2]);
        u.cloudLit.value.set(L.cloudLit[0], L.cloudLit[1], L.cloudLit[2]);
        u.cloudShade.value.set(L.cloudShade[0], L.cloudShade[1], L.cloudShade[2]);
        u.water.value.set(L.water[0], L.water[1], L.water[2]);
        u.hazeDensity.value = L.hazeDensity;
        u.mistDensity.value = L.mistDensity;
        u.cloudCover.value = L.cover;
        u.open.value = L.open * (1 - this.dusk * 0.8);
        u.dew.value = L.dew;
        u.dusk.value = this.dusk;
        u.day.value = L.day;
        u.time.value = time;
        u.wind.value.set(time * 6.5, time * -2.2);
        // ── The breeze in the plants: a chain and the heat of play lean them harder. Eased, so a
        // broken chain lets them settle instead of snapping every blade and tree back at once;
        // each event's push rides on top (both calmer under reduced motion). ──
        const sway = this.reducedMotion ? AIR_MOTION.reduced : 1;
        const gustAsk = 1 + 0.1 * Math.min(this.combo, 6) + (HEAT.gust * level + HEAT.gustFever * fever) * sway;
        this.gust += (gustAsk - this.gust) * approach(gustAsk > this.gust ? HEAT.gustRise : HEAT.gustFall, dt);
        u.gust.value = this.gust + this.gustKick.valueAt(time) * sway;

        // ── The air: a chain stirs it (it eases in and settles slowly), and so does the heat of
        // play (whichever stirs it more, but not in a perfect clear's stillness); a perfect clear
        // stills it ──
        const stirAsk = clamp((this.combo - 1) / (AIR_MOTION.fullChain - 1), 0, 1);
        this.stir += (stirAsk - this.stir) * approach(stirAsk > this.stir ? 1.2 : 0.3, dt);
        const still = this.still.valueAt(time);
        const pace = this.reducedMotion ? AIR_MOTION.reduced : 1;
        const airStir = Math.max(this.stir, clamp(HEAT.stir * level + HEAT.stirFever * fever, 0, 1) * (1 - still));
        this.airClock += dt * (1 + AIR_MOTION.hurry * airStir) * (1 - 0.85 * still) * pace;
        this.airGyre += dt * airStir * AIR_MOTION.gyre * pace;
        u.air.value.set(this.airClock, this.airGyre, airStir, still);
        u.airWave.value.set(this.airWaveAt, this.airWavePower, this.airWave2At, this.airWave2Power);

        // ── The spring flood: each link of a chain lifts the river, and so does the heat of play
        // (a cascade's deeper waves a step more); it falls back after ──
        const link = Math.max(0, this.combo - 1);
        const lift = this.floodKick.valueAt(time);
        const chainFlood = this.combo >= 2 ? Math.min(FLOOD.most, FLOOD.perLink * link) : 0;
        const chainFoam = this.combo >= 2 ? Math.min(FLOOD.foamMost, FLOOD.foamPerLink * link) : 0;
        const floodAsk = Math.min(
            FLOOD.most + HEAT.floodRoom,
            chainFlood + HEAT.flood * level + HEAT.floodFever * fever + lift,
        );
        const foamAsk = Math.min(
            FLOOD.foamMost + HEAT.foamRoom,
            chainFoam + HEAT.foam * level + HEAT.foamFever * fever + lift * 0.8,
        );
        this.flood += (floodAsk - this.flood) * approach(floodAsk > this.flood ? 1.4 : 0.35, dt);
        this.foamBoost += (foamAsk - this.foamBoost) * approach(foamAsk > this.foamBoost ? 1.8 : 0.4, dt);
        u.flood.value = this.flood;
        u.foamBoost.value = this.foamBoost;
        // The water's own clock runs faster as the flood rises (integrated: never a jump).
        this.flowClock += dt * (1 + this.flood * 0.6);
        u.flowClock.value = this.flowClock;
        // ── The meadow: a clear's flush of bloom; in a fever the whole knoll stands in flower; the
        // heat of play opens the kinds the player has been playing all over it ──
        u.flush.value = Math.max(this.flush.valueAt(time), HEAT.flushFever * fever);
        const fill = smooth(HEAT.bloomFrom, HEAT.bloomTo, level) * HEAT.bloom + HEAT.bloomFever * fever;
        for (let k = 0; k < this.kindBloom.length; k++) {
            this.u.tables.palette[PALETTE_ROWS.colour + k].w = fill * this.kindBloom[k].valueAt(time);
        }
        // ── Back-to-back: the river glitters while the run lasts (flaring at each back-to-back
        // clear), and in a fever; the bow in the spray brightens with the run and the heat ──
        this.gloryShown += (this.b2b / 3 - this.gloryShown) * approach(1.2, dt);
        u.glory.value = clamp(Math.max(this.gloryShown + this.gloryKick.valueAt(time), HEAT.glitter * fever), 0, 1);
        const bowAsk = 1 + HEAT.bowB2B * this.b2b + HEAT.bow * level + HEAT.bowFever * fever;
        this.bowShown += (bowAsk - this.bowShown) * approach(bowAsk > this.bowShown ? 1.5 : 0.5, dt);
        u.bow.value = this.bowShown + this.bowKick.valueAt(time);
        u.whirl.value.set(this.poolWhirl.at, this.poolWhirl.power);
        // ── Play breaks into a fever: cranes come trumpeting over the valley ──
        if (heat.stage === 3 && this.lastStage < 3 && time - this.feverFlightAt > HEAT.flightGap) {
            this.feverFlightAt = time;
            this.counts.feverFlights++;
            this.flights?.launch('crane', time);
        }
        this.lastStage = heat.stage;

        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, this.viewportHeight || 1080);
        }
        this.updatePost(camera);
        this.motes?.update();
        this.floes?.update(time, this.flood);
        this.flights?.update(time);
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    updatePost(camera) {
        const post = this._post;
        const L = this.light;
        const { level, fever } = this.heat;
        // The heat of play deepens the colours, and the iris closes a little as it does, so the
        // brighter water and flowers stay saturated instead of washing out.
        post.exposure = L.exposure * (1 - HEAT.iris * Math.max(0, level - 0.2) - HEAT.irisFever * fever);
        post.shaftColour = L.glow;
        post.saturation = 1.1 + HEAT.saturation * level + HEAT.saturationFever * fever;
        post.bloomBoost = Math.min(
            1,
            this.gloryShown * 0.2 + this.foamBoost * 0.3 + HEAT.bloomBoost * level + HEAT.bloomBoostFever * fever,
        );
        // A four-line clear's flash (a swell: a second quad adds to it; the post scales it by
        // Reduce flashing).
        const kick = this.flashKick.valueAt(this.time);
        post.flash = kick * kick * 0.3;
        post.flashColour = L.glow;
        post.sun.strength = 0;
        if (camera) {
            this._sunWorld.set(EYE.x + L.dir[0] * 1000, EYE.y + L.dir[1] * 1000, EYE.z + L.dir[2] * 1000);
            this._sunScreen.copy(this._sunWorld).project(camera);
            const inFront = this._sunScreen.z < 1;
            post.sun.x = this._sunScreen.x * 0.5 + 0.5;
            post.sun.y = 0.5 - this._sunScreen.y * 0.5;
            const margin = Math.max(Math.abs(post.sun.x - 0.5), Math.abs(post.sun.y - 0.5));
            post.sun.onScreen = inFront ? 1 - smooth(0.5, 0.9, margin) : 0;
            // The shafts outlast the disc a little: rays fan out from behind the rim it sank behind.
            post.sun.strength = post.sun.onScreen * smooth(-2.5, 1.5, L.el - L.skyline) * smooth(-1.2, 2, L.el)
                * (1 - smooth(18, 34, L.el))
                // The shafts stand stronger through the fall's swollen mist as play heats.
                * (1 + HEAT.shafts * level + HEAT.shaftsFever * fever);
        }
    }

    /**
     * Draw the woods' impostor atlas, once, before the first frame: its materials compiled off
     * the main thread where the backend can, then its two passes (drawn again on the next frames'
     * prerender until every tree is in it).
     */
    async bakeImpostors(renderer) {
        if (!renderer || !this.impostors || this.impostors.ready || this.impostors.failed) return;
        try {
            await this.impostors.bake(renderer);
        } catch (error) {
            // Not given up on here (a compile that failed while the app was busy): the next frames'
            // prerender draws the atlas again, and only a draw that throws there leaves the woods
            // without their cards.
            console.warn('[Spring] The woods\' impostors were not drawn yet; drawing them on the next frame.', error);
        }
    }

    /** Before the frame: the impostor atlas, until it holds every tree. */
    prerender(renderer) {
        const atlas = this.impostors;
        if (!renderer || !atlas || atlas.ready || atlas.failed) return;
        try {
            atlas.draw(renderer);
        } catch (error) {
            atlas.failed = true;
            console.warn('[Spring] The woods\' impostors could not be drawn.', error);
        }
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
            },
            counts: { ...this.counts },
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            flood: this.flood,
            foamBoost: this.foamBoost,
            glory: this.gloryShown,
            open: this.u.open.value,
            patches: Array.from({ length: PATCHES }, (_, k) => this.u.tables.events[EVENT_ROWS.patch + k * 2])
                .filter((row) => time0(this.time, row.z) < 24).length,
            flush: this.u.flush.value,
            whirlAge: this.u.whirl.value.y > 0 ? this.time - this.u.whirl.value.x : null,
            heat: { level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage },
            gust: this.u.gust.value,
            bow: this.u.bow.value,
            floes: this.floes?.live ?? 0,
            air: { clock: this.airClock, gyre: this.airGyre, stir: this.stir },
            // The woods' impostor atlas: kept (every tree drawn into it), and the bakes it took.
            woods: this.impostors ? {
                baked: this.impostors.ready, failed: this.impostors.failed === true, attempts: this.impostors.attempts,
            } : null,
            birds: (this.flights?.live || []).reduce((a, b) => a + b, 0),
            dusk: this.dusk,
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            parts: Object.keys(this.parts),
        };
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT) scalars[key] = this[key];
        const envelopes = {};
        for (const key of ENVELOPES) envelopes[key] = this[key].exportState();
        const swells = {};
        for (const key of SWELLS) swells[key] = this[key].exportState();
        return {
            scalars,
            wheel: this.wheel.exportState(),
            counts: { ...this.counts },
            events: this.u.tables.events.map((v) => v.toArray()),
            envelopes,
            swells,
            kinds: this.kindBloom.map((swell) => swell.exportState()),
            surge: this.playSurge.exportState(),
        };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.wheel.importState(state.wheel);
        this.counts = { ...emptyCounts(), ...state.counts };
        if (Array.isArray(state.events)) state.events.forEach((row, k) => this.u.tables.events[k]?.fromArray(row));
        for (const key of ENVELOPES) if (state.envelopes?.[key]) this[key].importState(state.envelopes[key]);
        for (const key of SWELLS) if (state.swells?.[key]) this[key].importState(state.swells[key]);
        if (Array.isArray(state.kinds)) state.kinds.forEach((o, k) => this.kindBloom[k]?.importState(o));
        if (state.surge) this.playSurge.importState(state.surge);
        this.u.whirl.value.set(this.poolWhirl.at, this.poolWhirl.power);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        if (this.textures) {
            this.textures.noise.dispose();
            this.textures.lattice.dispose();
        }
        this.root.clear();
        this.partList.length = 0;
    }
}
