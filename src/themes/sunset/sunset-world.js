/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the lantern sea: the world.
 *
 * The eye floats a little above an open sea, and the whole day turns in front of it: the sun
 * comes up out of the sea right of the card, climbs out of the top of the picture, comes back in
 * at the top left and sets into the water left of the card; the moon comes up on the right as
 * the sun sets, rides over the picture in the night and comes down on the left before dawn.
 * Over the eye a deck of cloud runs in toward the place the sky goes down, lit from beneath while
 * a body is on the horizon. Everything is built here and shared with the playground effect
 * (src/playground/effects/sunset.effect.js), so what is iterated there ships.
 *
 * Parts (showOnlyParts names): sky, sea, lanterns, glows, birds.
 *
 * What the board does to it:
 *   lock        a light of the piece's colour leaves the card's edge at the piece's height and
 *               comes down to the sea beside the card (lower pieces nearer, higher pieces further
 *               out), where it becomes a paper lantern afloat in that colour; a ring runs out
 *               from it and the water mirrors it on a streak of its own light.
 *   hard drop   the lantern is set down hard: a splash of drops in its light, a wider ring.
 *   clear       for every line the oldest lantern on the water lifts off, and the evening wind
 *               carries it away toward the place the sun goes down; a 22-degree halo blooms
 *               round the sun (the moon at night) and the sun's road on the sea flares.
 *   twist      the lanterns that lift go up turning round where they rose (one that clears
 *               nothing still sends the oldest lantern up turning).
 *   cascade     each wave lifts more than the last, and feeds the halo, the fire and the road.
 *   back-to-back  sun dogs: two mock suns stand on the halo either side of the light.
 *   four lines  every lantern on the water lifts at once, the sky fires, and the sun, if it is
 *               low, shows the green flash (a second quad holds it, never restarts it).
 *   perfect     the crown on the clear: whatever is still afloat lifts, the great 46-degree halo
 *               rings the light with sun dogs on the near one, the whole flock comes.
 *   combo       a chain sets the sky on fire: the clouds burn brighter and further across the
 *               sky with every clear held, the sea's road with them; from three a flock crosses
 *               the light and every clear after calls more birds into it.
 *   level up    the day runs on an eighth of itself: the sun, the moon and the stars are seen
 *               to run across the sky.
 *
 * Nothing restarts: every halo, flare, flash and kick is a Swell (shared/swell.js) that a new
 * event adds to; a halo still standing takes the new light where it is, a flock in the air takes
 * the newcomers. And the world builds with play (shared/gameplay-surge.js): as the hands quicken
 * the cloud catches fire and burns from gold to ember and rose under a deepening sky, the deck
 * streams faster toward the light, the lanterns burn brighter and the road on the sea blazes; in
 * a fever the halo stands round the light with its sun dogs and the great halo rings the sky.
 * When the hands rest it all breathes back to the evening it was.
 *
 * And the clock turns the same day by itself (sunset-hours.js: one day in DAY_SECONDS, lingering
 * at dawn and dusk), in every mode, the ones that never level included.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell, softCeiling } from '../shared/gameplay-surge.js';
import {
    DEG, EYE_HEIGHT, approach, azElDirection, clamp01, discSquash, lerp, mulberry32, pieceLight, seaHeight, smooth,
} from './sunset-core.js';
import { tierFor } from './sunset-quality.js';
import {
    REST_RIG, aimLanding, aimLeave, boardFor, boardPoint, cardFor, fallbackLayout, fovForAspect, frameFor,
} from './sunset-composition.js';
import {
    HOUR_COLOURS, LEVEL_SECONDS, MOON_LAG, MOON_PEAK, MOON_PHASE, STATIONS, SUN_PEAK, arcAt, dayHourAt, hourAngle,
    levelOffset, lightAt, moonLit, moonPhaseAt, turnSeconds,
} from './sunset-hours.js';
import {
    TUNE, createLight, createSeaNoise, createSkyNoise, tune,
} from './sunset-tsl.js';
import { createSky } from './sunset-sky.js';
import { WAVE_LIFE, WHIRL_LIFE, createSea } from './sunset-sea.js';
import { LanternPool, MOTE_SECONDS, moteAt } from './sunset-lantern-pool.js';
import { createGlows, createLanterns } from './sunset-lanterns.js';
import { createFlock } from './sunset-birds.js';
import { createBoat, lampForSun } from './sunset-boat.js';
import { createIslands } from './sunset-islands.js';
import { createMeteors } from './sunset-meteors.js';
import {
    NowAndThen, skyAt, skyDrift, skyPhaseOf,
} from './sunset-weather.js';
import { flashScale } from '../../utils/photosensitivity.js';

export { REST_RIG, fovForAspect };

/** The parts a capture can show alone. */
export const SUNSET_PARTS = Object.freeze(['sky', 'sea', 'islands', 'lanterns', 'glows', 'birds', 'boat', 'meteors']);

/** The sun's and the moon's angular radius (degrees): larger than life, as a long lens sees them. */
export const SUN_RADIUS = 1.45;
export const MOON_RADIUS = 1.2;

/** Seconds a ring stays on the water. */
const RING_LIFE = 7;
/** Waves of light and whirls alive at once on the sea. */
const WAVE_ROWS = 5;
/** A clear's halo: how long it takes to run out to its place, and its radius (degrees). */
const HALO_RISE = 1.1;
const HALO_RADIUS = 22;
/** The great halo's radius (degrees), and its width as a cosine (as wide as the 22° one is). */
const GREAT_RADIUS = 46;
const GREAT_WIDTH = (0.0075 * Math.sin(GREAT_RADIUS * DEG)) / Math.sin(HALO_RADIUS * DEG) + 0.0012;
/** Below this a halo has faded: the next one runs out from the disc again. */
const HALO_GONE = 0.04;
/** The green flash holds this long after a four-line clear (a second one holds it longer). */
const GREEN_HOLD = 1.6;

/**
 * The sky burning with play: what the hour's colours lean toward at full heat (multipliers on
 * HOUR_COLOURS rows). The cloud goes from gold to ember, the high cloud to rose, the shade of a
 * cloud to dusky rose, and the zenith deepens so the darks stay dark under the fire.
 */
const EMBER = Object.freeze([
    ['cloudLit', [1.14, 0.74, 0.5]],
    ['cloudRim', [1.12, 0.84, 0.6]],
    ['cirrus', [1.12, 0.72, 0.8]],
    ['cloudShade', [1.0, 0.8, 0.9]],
    ['cloudDeep', [0.95, 0.78, 0.9]],
    // The broad glow round the light deepens without brightening: it must not wash the frame.
    ['midSun', [1.0, 0.78, 0.66]],
    ['horizonSun', [1.0, 0.76, 0.6]],
    ['sunAureole', [1.0, 0.82, 0.68]],
    ['zenithSun', [0.8, 0.7, 0.92]],
    ['zenithFar', [0.8, 0.7, 0.92]],
    ['midFar', [0.92, 0.78, 0.92]],
].map(([name, rgb]) => Object.freeze([HOUR_COLOURS.indexOf(name), ...rgb])));
/** The rows of the hour's colours that are the moon's light on the air and the sea. */
const MOON_LIGHT_ROWS = Object.freeze(['moonGlow', 'moonGlint'].map((name) => HOUR_COLOURS.indexOf(name)));
/** A splash's drops fall back within this long. */
const DROP_LIFE = 1.15;
/**
 * The far shore's answer to four lines: lanterns let go all along the horizon. How long one is
 * seen, how far out they rise (metres), how fast (m/s), how long the letting-go takes to run
 * along the shore from where the sun sets (seconds), and the wind that carries them (m/s).
 */
export const RELEASE = Object.freeze({
    life: 15, range: Object.freeze([230, 700]), rise: Object.freeze([5.5, 10.5]), ripple: 3.0, wind: 3.2,
});
/**
 * The night's fishing boats far out, their lamps over the side: [the gate each keeps its place
 * by, degrees off it, metres out].
 */
export const NIGHT_BOATS = Object.freeze([
    ['set', -15, 4200], ['set', 9.5, 3300], ['set', 20, 5200],
    ['rise', -9, 3900], ['rise', 8, 3000], ['rise', 15, 4800],
].map((row) => Object.freeze(row)));
/** How large a lantern is drawn against the model's own size. */
export const LANTERN_SIZE = 1.18;
/** Room among the soft lights for the lamps under the islands. */
const ISLAND_LAMPS = 24;
/** The boat's wake: puffs of spray trailing astern. */
const WAKE_PUFFS = 9;
/** A shower (the crown, by night): how many fall, and over how long. */
const SHOWER = Object.freeze({ count: 13, seconds: 2.6 });
/** The trail a light leaves in flight: points, and seconds between them. */
const MOTE_TRAIL = 16;
const MOTE_STEP = 0.009;

/** How far a chain of `combo` clears sets the sky on fire (0..1). */
export function fireForCombo(combo) {
    return combo > 1 ? 1 - Math.exp(-(combo - 1) * 0.32) : 0;
}

/** How many birds a chain calls: none below three clears. */
export function birdsForCombo(combo, most) {
    if (combo < 3) return 0;
    return Math.min(most, 5 + (combo - 3) * 4);
}

const tmpRay = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpSun = new THREE.Vector3();
const tmpKey = new THREE.Vector3();

export class SunsetWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]   built for a deterministic capture (reported in getState)
     * @param {number} [p.seed]
     * @param {number} [p.hour]   hold the day at this hour (0..24: 6 sunrise, 12 noon, 18 sunset,
     *                            18.4 afterglow, 0 midnight)
     * @param {object} [p.tune]   overrides for TUNE (the playground's P.<name>=)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 29, hour = null, tune: overrides = null, weather = null,
        moonPhase = null,
    }) {
        tune(overrides);
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.seed = seed;
        this.rand = mulberry32(seed);
        this.group = new THREE.Group();
        this.group.name = 'sunset-world';
        this.parts = {};
        this.camera = null;
        this.aspect = 16 / 9;
        this.viewport = { w: 1920, h: 1080 };
        this.layout = null;
        this.reducedMotion = false;
        /** The frame's time (the camera sways on it) and the world's own clock. */
        this.time = 0;
        this.clock = 0;
        /** Where the horizon is for this frame shape, and where the sky sets and rises. */
        this.frame = frameFor(this.aspect, null);
        this.setAz = this.frame.setAz;
        this.riseAz = this.frame.riseAz;
        this.pitch = this.frame.pitch;
        /**
         * How far the levels have carried the day on (seconds of the timetable; see
         * sunset-hours.js): eased from `from` to `to` over `seconds` from `at`.
         */
        this.day = {
            from: 0, to: 0, at: -100, seconds: 1, pin: Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : null,
        };
        this.light = lightAt(12);
        /**
         * The weather (sunset-weather.js): the phase a capture holds it on (else its own clock
         * turns it), and what it is now.
         */
        this.weatherPin = skyPhaseOf(weather);
        this.sky = skyAt(this.weatherPin ?? 0);
        /** The moon's phase angle (degrees): the one a capture holds it on, else the days turn it. */
        this.moonPin = Number.isFinite(moonPhase) ? Math.max(0, Math.min(170, moonPhase)) : null;
        this.moonPhase = MOON_PHASE;
        /** Where the sun and the moon stand: { az, el } in degrees. */
        this.sunArc = { az: 0, el: 0 };
        this.moonArc = { az: 0, el: 0 };
        this.lightRows = HOUR_COLOURS.map(() => new THREE.Vector4(0, 0, 0, 0));
        this.U = {
            time: uniform(0),
            light: createLight(uniformArray(this.lightRows, 'vec4')),
            sun: uniform(new THREE.Vector3(0, 0.1, -1)),
            sunRight: uniform(new THREE.Vector3(1, 0, 0)),
            sunTop: uniform(new THREE.Vector3(0, 1, 0)),
            sunSize: uniform(Math.sin(SUN_RADIUS * DEG)),
            sunSquash: uniform(1),
            sunLow: uniform(0),
            sunPower: uniform(20),
            /** 0..1: how much of the sun's disc stands over the sea. */
            sunUp: uniform(1),
            moon: uniform(new THREE.Vector3(0, -0.5, -1)),
            moonRight: uniform(new THREE.Vector3(1, 0, 0)),
            moonTop: uniform(new THREE.Vector3(0, 1, 0)),
            moonSize: uniform(Math.sin(MOON_RADIUS * DEG)),
            moonSquash: uniform(1),
            moonPower: uniform(1.7),
            moonUp: uniform(0),
            /** How far the moon's face is turned as it crosses the sky (radians). */
            moonTilt: uniform(0),
            /** Tonight's phase: (sine, cosine of its angle, the earth's light on its dark side). */
            moonPhase: uniform(new THREE.Vector3(Math.sin(MOON_PHASE * DEG), Math.cos(MOON_PHASE * DEG), 0.018)),
            /** 0: the sun lights the clouds; 1: the moon does. */
            moonKey: uniform(0),
            stars: uniform(0),
            /** How far the night sky has turned round its pole with the hours (radians). */
            starTurn: uniform(0),
            cover: uniform(0.5),
            /** 0: clouds lit from above (day); 1: from beneath (the sun on the horizon). */
            fire: uniform(0.5),
            /** 0..1: a chain or a clear sets the sky on fire. */
            skyFire: uniform(0),
            /** The key light's way across the deck, in the deck's noise coordinates. */
            keyFlat: uniform(new THREE.Vector2(1, 0)),
            /** The cloud streets run toward this (xz, unit), and how far the deck has drifted. */
            street: uniform(new THREE.Vector2(0, -1)),
            drift: uniform(new THREE.Vector2(0, 0)),
            /**
             * A clear's halo: (cosine of its radius, its width as a cosine, its strength, its sun
             * dogs), and its centre.
             */
            pulse: uniform(new THREE.Vector4(1, 0.02, 0, 0)),
            pulseDir: uniform(new THREE.Vector3(0, 0, -1)),
            /** The great halo round the same light: (cosine of its radius, width, strength). */
            greatHalo: uniform(new THREE.Vector3(Math.cos(GREAT_RADIUS * DEG), GREAT_WIDTH, 0)),
            /** The green flash (0..1). */
            green: uniform(0),
            /** A clear flares the sun (0 at rest). */
            flare: uniform(0),
            /** The sun's road flares (0 at rest). */
            glint: uniform(0),
            /** Radians a pixel spans (the sea and the glows size themselves by it). */
            pixelAngle: uniform(0.0008),
            /** x: live rings, y: waves of light and whirls, z: lanterns the water mirrors. */
            counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
            /** The weather's hand on the sea: the wind's chop (1: the day the theme ships). */
            chop: uniform(1),
            /** How far the eye sees through the air over the sea (metres). */
            hazeReach: uniform(TUNE.hazeReach),
            /** 0..1: how far the sea answers a touch with its own cold light (the night's). */
            seaFire: uniform(0),
            /** The clouds' own clock (seconds; it runs faster as the evening wind rises with play). */
            cloudClock: uniform(0),
            /** The weather's hand on the sky (1, 1, 0, 0, 0: the day the theme ships). */
            cirrus: uniform(1),
            bars: uniform(1),
            towers: uniform(0),
            veil: uniform(0),
            mackerel: uniform(0),
            /** Lightning inside a far tower: (its bearing in radians, how bright). */
            bolt: uniform(new THREE.Vector2(0, 0)),
            /** The bearings of the places the sky sets and rises (radians right of the view line). */
            gates: uniform(new THREE.Vector2(-0.44, 0.56)),
            /** Where the sky sets and rises, level (unit): the towers stand back from both. */
            setDir: uniform(new THREE.Vector3(-0.4, 0, -0.9)),
            riseDir: uniform(new THREE.Vector3(0.5, 0, -0.85)),
            /** The horizon lit from end to end (a new level; the far shore's lanterns): rgb, 1. */
            horizonGlow: uniform(new THREE.Vector4(0, 0, 0, 1)),
            /** The rays thrown wide (four lines, the crown), and the pillar over the light. */
            rayBurst: uniform(0),
            pillar: uniform(0),
            /** The halo's body: its right hand on the sky, and whether it is the moon (0 | 1). */
            pulseRight: uniform(new THREE.Vector3(1, 0, 0)),
            haloMoon: uniform(0),
        };

        this.ringRows = Array.from({ length: this.tier.rings * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.lampRows = Array.from({ length: this.tier.lit * 2 }, () => new THREE.Vector4(0, 0, 0, 0));
        /** Waves of light and whirls: (x, z, born, strength), (r, g, b, 0 a wave | the way a whirl turns). */
        this.waveRows = Array.from({ length: WAVE_ROWS * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.rows = {
            rings: uniformArray(this.ringRows, 'vec4'),
            lamps: uniformArray(this.lampRows, 'vec4'),
            waves: uniformArray(this.waveRows, 'vec4'),
        };
        this.ringCount = 0;
        this.waveCount = 0;

        this.pool = new LanternPool({ capacity: this.tier.lanterns, seed: seed + 3 });
        /** Splash drops: [x, y, z, vx, vy, vz, born, r, g, b] each, in a ring buffer. */
        this.drops = new Float32Array(this.tier.drops * 10).fill(-100);
        this.dropCursor = 0;
        /**
         * The far shore's lanterns: up to three lettings-go at once, each a table of
         * [x, z, delay, rise, r, g, b, phase] rows, dealt from a generator of their own.
         */
        this.releases = Array.from({ length: 3 }, () => ({
            at: -100, n: 0, rows: new Float32Array(this.tier.release * 8),
        }));
        this.releaseCursor = 0;
        this.farRand = mulberry32(seed + 401);
        /** What happens by itself: a shooting star, lightning in a far tower, a few gulls. */
        this.ambient = {
            meteor: new NowAndThen({ seed: seed + 71, every: [9, 26], first: 3 }),
            bolt: new NowAndThen({ seed: seed + 113, every: [3.5, 12], first: 2 }),
            gulls: new NowAndThen({ seed: seed + 157, every: [55, 120], first: 25 }),
        };
        this.boltBearing = 0;

        this.state = {
            combo: 0,
            level: 1,
            fire: 0,
            /** The green flash as shown (eased), and until when a four-line clear holds it up. */
            green: 0,
            greenUntil: -100,
            /** When the halo standing now ran out from the disc, and whether round the moon. */
            haloFrom: -100,
            haloMoon: false,
            flockSize: 0,
            pitch: null,
            locks: 0,
            clears: 0,
            lifted: 0,
            flocks: 0,
            releases: 0,
            showers: 0,
        };
        /**
         * Every event's light ADDS to what is still lit (shared/swell.js), so a single after a
         * quad lifts the light instead of cutting it: the post's flash, the kick a clear gives the
         * fire in the sky, the sun's road, the sun's flare, the 22-degree halo, its sun dogs and the
         * great halo.
         */
        this.fx = {
            flash: new Swell({ release: 0.25, ceiling: 0.6, knee: 0.4 }),
            fireKick: new Swell({
                attack: 0.12, release: 1 / 0.45, ceiling: 0.8, knee: 0.55, headroom: 1.3,
            }),
            glint: new Swell({ release: 1 / 0.9, ceiling: 2.5, knee: 1.6 }),
            flare: new Swell({ release: 1 / 1.3, ceiling: 1.5, knee: 1 }),
            halo: new Swell({
                attack: 0.3, release: 1.2, ceiling: 0.75, knee: 0.5, headroom: 1.3,
            }),
            dogs: new Swell({
                attack: 0.4, release: 2.4, ceiling: 1.2, knee: 0.85,
            }),
            great: new Swell({
                attack: 0.8, release: 3.4, ceiling: 1.1, knee: 0.8,
            }),
            /** The pillar of light over the sun or the moon (three lines and more). */
            pillar: new Swell({
                attack: 0.35, release: 1.7, ceiling: 1.2, knee: 0.8,
            }),
            /** The rays thrown wide (four lines, the crown). */
            rays: new Swell({
                attack: 0.25, release: 2.4, ceiling: 1.2, knee: 0.8,
            }),
            /** The horizon lit from end to end (a new level). */
            dawn: new Swell({
                attack: 0.45, release: 2.4, ceiling: 1.1, knee: 0.8,
            }),
            /** The far shore's lanterns' light on the horizon. */
            release: new Swell({
                attack: 1.4, release: 7, ceiling: 1.2, knee: 0.8,
            }),
            /** Every flame afloat leaps (a new level). */
            lampKick: new Swell({ release: 1.3, ceiling: 1, knee: 0.7 }),
            /** Lightning inside a far tower. */
            bolt: new Swell({ release: 0.16, ceiling: 1.4, knee: 1 }),
        };
        /**
         * How hot play runs (shared/gameplay-surge.js), sampled once a frame on the world's clock:
         * the sky burns from gold to ember and rose, the deck streams in faster, the lanterns and
         * the road burn brighter, and in a fever the halos stand round the light.
         */
        this.surge = new GameplaySurge();
        this.heat = this.surge.sample(-100);
        /** 0..1: how far the hour's colours lean toward the ember (EMBER). */
        this.ember = 0;
        /** The halo the heat holds up (added to the clears' own), for sendPulse to see. */
        this.haloHeld = 0;
        /** The cloud deck's own clock: it runs faster as play heats. */
        this.driftClock = 0;
        /** How much brighter the flames burn with the heat: afloat, and rising. */
        this.lampBoost = 1;
        this.airBoost = 1;
        this.sunScreen = { x: 0.25, y: 0.5, visible: 0 };
        this._point = { x: 0.5, y: 0.5 };
        this._landing = { x: 0.5, y: 0.9 };
        this._leave = { x: 0.5, y: 0.5 };
        this._lantern = {};
        this._mote = { x: 0, y: 0, z: 0 };
        this._to = { x: 0, y: 0, z: 0 };
        this._lamps = [];
        this._lifted = [];
        this._jitter = [0, 0];
        this._waveRgb = [1, 0.8, 0.6];
        this._origin = { x: 0, y: 0, z: 0 };
        this._from = { x: 0, y: 1, z: 0 };
        this._toward = { x: 0, y: 1, z: 0 };
        this.applyHour();
    }

    build() {
        const { tier, U } = this;
        this.skyNoise = createSkyNoise(tier.skyNoise);
        const sea = createSeaNoise(tier.seaNoise);
        this.seaNoise = sea.map;
        this.parts.sky = createSky({ tier, noise: this.skyNoise, U });
        // The islands before the sea: the sea mirrors them from their skyline.
        this.parts.islands = createIslands({ U, tier, seed: this.seed });
        this.parts.sea = createSea({
            tier,
            U,
            skyNoise: this.skyNoise,
            seaNoise: this.seaNoise,
            seaVariance: sea.variance,
            rows: this.rows,
            skyline: this.parts.islands.skyline,
        });
        this.parts.lanterns = createLanterns({ capacity: tier.lanterns, U });
        // (One more for the boat's lantern; the far shore's lanterns, two lettings-go deep; the
        // night's fishing boats, a lamp and the haze it lights each.)
        const glowCapacity = tier.lanterns + tier.motes * MOTE_TRAIL + tier.drops + 1 + tier.release * 2
            + NIGHT_BOATS.length * 2 + WAKE_PUFFS + 1 + ISLAND_LAMPS;
        this.parts.glows = createGlows({ capacity: glowCapacity, U });
        this.parts.birds = createFlock({ count: tier.birds, U, seed: this.seed });
        this.parts.boat = createBoat({ U, seed: this.seed, seaRings: tier.seaRings });
        this.parts.meteors = createMeteors({ capacity: tier.meteors, U });
        Object.values(this.parts).forEach((part) => this.group.add(part.mesh));
        this.scene.add(this.group);
        return this;
    }

    bindCamera(camera) {
        this.camera = camera;
        camera.near = REST_RIG.near;
        camera.far = REST_RIG.far;
        camera.fov = fovForAspect(this.aspect);
        camera.updateProjectionMatrix();
        this.updateCamera(camera, {
            time: this.time, delta: 0, pointerX: 0, pointerY: 0,
        });
    }

    /** Drawing-buffer size (pixels) and the CSS aspect. */
    setViewport(bufferWidth, bufferHeight, aspect) {
        this.viewport.w = Math.max(1, bufferWidth);
        this.viewport.h = Math.max(1, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        const fov = fovForAspect(this.aspect);
        this.U.pixelAngle.value = (2 * Math.tan((fov * DEG) / 2)) / this.viewport.h;
        if (this.camera) {
            this.camera.fov = fov;
            this.camera.aspect = this.aspect;
            this.camera.updateProjectionMatrix();
        }
        frameFor(this.aspect, this.layout, this.frame);
    }

    /** The live gameplay rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        frameFor(this.aspect, this.layout, this.frame);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Draw only the named parts (captures). */
    showOnlyParts(names) {
        const wanted = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            const part = this.parts[name];
            // (The boat shows itself only while it sails: it is told, not switched.)
            if (typeof part.setShown === 'function') part.setShown(wanted.has(name));
            else part.mesh.visible = wanted.has(name);
        });
    }

    // ── time ────────────────────────────────────────────────────────────────────

    /** Put the world at `time` with nothing in flight, at the hour the clock alone gives. */
    seek(time) {
        this.time = Math.max(0, time);
        this.clock = this.time;
        this.driftClock = this.clock;
        this.resetSession();
        // A seek starts from a still evening. (A new run does not: what still glows from the
        // last one, the fire and the halos, breathes out on its own.)
        const s = this.state;
        s.fire = 0;
        s.green = 0;
        s.greenUntil = -100;
        s.haloFrom = -100;
        s.haloMoon = false;
        Object.values(this.fx).forEach((swell) => swell.reset());
        this.surge.reset();
        this.heat = this.surge.sample(-100);
        this.ember = 0;
        this.haloHeld = 0;
        this.restoreDay(0);
        // The boat's evening starts over too: none on the water, the first a while off. And so
        // does everything else that happens by itself.
        this.parts.boat?.restart(this.clock);
        Object.values(this.ambient).forEach((kind) => kind.restart(this.clock));
        s.pitch = null;
        this.setAz = this.frame.setAz;
        this.riseAz = this.frame.riseAz;
        this.applyHour();
    }

    /**
     * A new run: no lantern, no chain, nothing in the air. The clock runs on, and with it the
     * day, from where the last run left it: nothing turns it back.
     */
    resetSession() {
        const s = this.state;
        s.combo = 0;
        s.level = 1;
        s.flockSize = 0;
        s.locks = 0;
        s.clears = 0;
        s.lifted = 0;
        s.flocks = 0;
        s.releases = 0;
        s.showers = 0;
        this.ringCount = 0;
        this.waveCount = 0;
        this.pool.reset();
        this.drops.fill(-100);
        this.dropCursor = 0;
        this.releases.forEach((batch) => {
            batch.at = -100;
            batch.n = 0;
        });
        this.parts.birds?.reset();
        this.parts.meteors?.reset();
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const s = this.state;
        const target = this.frame.pitch;
        if (s.pitch === null) s.pitch = target;
        else s.pitch += (target - s.pitch) * approach(1.2, sim.delta);
        const t = sim.time;
        const still = this.reducedMotion ? 0 : 1;
        // Afloat: the swell lifts the eye a little and rolls it a hair.
        const heave = still * seaHeight(0, -3, this.clock) * 0.35;
        const sway = still * (Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.13 + 1.3) * 0.4);
        const px = still * (sim.pointerX || 0);
        const py = still * (sim.pointerY || 0);
        const yaw = (sway * 0.45 + px * 1.6) * DEG;
        const pitch = (s.pitch + sway * 0.12 - py * 0.9) * DEG;
        camera.position.set(px * 0.18, EYE_HEIGHT + heave, 0);
        camera.up.set(Math.sin(sway * 0.004), 1, 0).normalize();
        tmpRay.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(camera.position.x + tmpRay.x, camera.position.y + tmpRay.y, camera.position.z + tmpRay.z);
        // The shared breath (shared/camera-breath.js) on top of the swell above: an eye-level
        // view out to the horizon, so it only turns. Off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }

    /** A screen point (fractions, y down) → the world ray through it (unit). */
    screenRay(x, y, out = tmpRay) {
        const { camera } = this;
        return out.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    }

    /** Where a screen point's ray meets the still sea (clamped to `near`..`far` metres out). */
    castSea(x, y, near = 7, far = 160, out = this._to) {
        const { camera } = this;
        const ray = this.screenRay(x, y);
        const p = camera.position;
        let t = ray.y < -1e-4 ? -p.y / ray.y : far * 4;
        const flat = Math.hypot(ray.x, ray.z) * t;
        if (flat > far) t *= far / flat;
        if (flat < near) t *= near / Math.max(flat, 1e-3);
        out.x = p.x + ray.x * t;
        out.z = p.z + ray.z * t;
        out.y = 0;
        return out;
    }

    /**
     * The layout events aim at: the live one, else the stylesheet's solo layout for a window of
     * this shape (asked for a 1000 px tall window: its formulas are in CSS pixels).
     */
    aimLayout() {
        return this.layout || fallbackLayout(this.aspect * 1000, 1000);
    }

    // ── tables ──────────────────────────────────────────────────────────────────

    /** A piece's colour as the light its lantern burns with. */
    rgbOf(color) {
        return pieceLight(color, [1, 0.72, 0.36]);
    }

    /**
     * A ring on the water at (x, z), born at `at` (it may be in the future). When the table is
     * full the ring with the least left in it makes room (the one nearly run out, never one still
     * running strong, so a burst of rings cannot wipe the water).
     */
    addRing(x, z, at, strength, rgb, light) {
        const cap = this.ringRows.length / 2;
        let slot = this.ringCount;
        if (this.ringCount >= cap) {
            let least = Infinity;
            for (let i = 0; i < this.ringCount; i += 1) {
                const row = this.ringRows[i * 2];
                const left = row.w * (1 - Math.max(0, this.clock - row.z) / RING_LIFE);
                if (left < least) {
                    least = left;
                    slot = i;
                }
            }
        } else {
            this.ringCount += 1;
        }
        const k = slot * 2;
        this.ringRows[k].set(x, z, at, strength);
        this.ringRows[k + 1].set(rgb[0], rgb[1], rgb[2], light);
    }

    /**
     * A wave of light on the sea from (x, z), born at `at`, in the light `rgb`; `turn` 0 is a
     * front racing out to the horizon (a clear), +1 or -1 a whirl turning that way where it began
     * (a twist). When the table is full the one with the least left in it makes room.
     */
    addWave(x, z, at, strength, rgb, turn = 0) {
        const cap = this.waveRows.length / 2;
        let slot = this.waveCount;
        if (this.waveCount >= cap) {
            let least = Infinity;
            for (let i = 0; i < this.waveCount; i += 1) {
                const row = this.waveRows[i * 2];
                const life = this.waveRows[i * 2 + 1].w !== 0 ? WHIRL_LIFE : WAVE_LIFE;
                const left = row.w * (1 - Math.max(0, this.clock - row.z) / life);
                if (left < least) {
                    least = left;
                    slot = i;
                }
            }
        } else {
            this.waveCount += 1;
        }
        const k = slot * 2;
        this.waveRows[k].set(x, z, at, strength);
        this.waveRows[k + 1].set(rgb[0], rgb[1], rgb[2], turn);
    }

    /**
     * The light a wave on the sea is made of at this hour: the sun's own on its road by day, gold
     * and then rose as it sets, and by night the sea's cold fire.
     */
    waveLight(out = this._waveRgb) {
        const L = this.light;
        const night = L.stars;
        const day = clamp01(this.sunArc.el / 18);
        // The low sun's light is ember; a wave of it would not read on a sea already red, so it
        // runs gold at sunset and near white under a high sun.
        const warm = [1.0, lerp(0.74, 0.92, day), lerp(0.4, 0.78, day)];
        out[0] = lerp(warm[0], 0.1, night);
        out[1] = lerp(warm[1], 0.8, night);
        out[2] = lerp(warm[2], 1.0, night);
        return out;
    }

    /** A crown of `n` drops thrown up from (x, z) at `at`, in the light `rgb`. */
    splash(x, z, at, n, rgb) {
        const cap = this.drops.length / 10;
        for (let i = 0; i < n; i += 1) {
            const k = this.dropCursor * 10;
            this.dropCursor = (this.dropCursor + 1) % cap;
            const a = this.rand() * Math.PI * 2;
            // A crown thrown outward, and a jet straight up from its middle.
            const jet = i < n * 0.24;
            const out = jet ? this.rand() * 0.22 : 0.5 + this.rand() * 1.3;
            this.drops[k] = x;
            this.drops[k + 1] = 0.05;
            this.drops[k + 2] = z;
            this.drops[k + 3] = Math.cos(a) * out;
            this.drops[k + 4] = jet ? 3.0 + this.rand() * 2.4 : 1.4 + this.rand() * 1.9;
            this.drops[k + 5] = Math.sin(a) * out;
            this.drops[k + 6] = at + this.rand() * 0.05;
            this.drops[k + 7] = lerp(rgb[0], 1, 0.35);
            this.drops[k + 8] = lerp(rgb[1], 0.9, 0.35);
            this.drops[k + 9] = lerp(rgb[2], 0.75, 0.35);
        }
    }

    /**
     * A halo blooms round the sun (the moon by night). Its light ADDS to a halo still standing,
     * which keeps its place: only one that has faded runs out from the disc again.
     */
    sendPulse(strength) {
        const s = this.state;
        const standing = this.fx.halo.rawAt(this.clock) + this.haloHeld;
        if (this.clock - s.haloFrom > HALO_RISE && standing < HALO_GONE) {
            s.haloFrom = this.clock;
            s.haloMoon = this.light.moonKey > 0.5;
        }
        this.fx.halo.hit(strength, this.clock);
    }

    /** The green flash, if the sun is low enough to show one; a second one holds it on longer. */
    greenFlash() {
        if (this.U.sunUp.value > 0.05 && this.U.sunLow.value > 0.4) {
            this.state.greenUntil = Math.max(this.state.greenUntil, this.clock + GREEN_HOLD);
        }
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /** A piece locked: { player, rows, u, hardDrop, color, screen }. */
    onLock(c) {
        if (!this.camera) return;
        const s = this.state;
        s.locks += 1;
        const hard = c.hardDrop === true;
        const rgb = pieceLight(c.color, [1, 0.72, 0.36]);
        let landX = 0.25;
        let landY = 0.85;
        let leaveX = 0.5;
        let leaveY = 0.5;
        if (c.screen) {
            landX = c.screen.x;
            landY = Math.max(c.screen.y, this.frame.horizon + 0.06);
            leaveX = c.screen.x;
            leaveY = c.screen.y;
        } else {
            const layout = this.aimLayout();
            const board = boardFor(layout, c.player || 0);
            if (board) {
                const rows = c.rows?.length ? c.rows : [19];
                const row = rows[Math.floor(rows.length / 2)];
                const u = clamp01(c.u ?? 0.5);
                boardPoint(board, u, row, this._point);
                const card = cardFor(layout, board) || board;
                this._jitter[0] = this.rand() * 2 - 1;
                this._jitter[1] = this.rand() * 2 - 1;
                aimLanding(layout, card, this._point, u, row, this.frame.horizon, this._jitter, this._landing);
                aimLeave(card, this._point, this._landing, this._leave);
                landX = this._landing.x;
                landY = this._landing.y;
                leaveX = this._leave.x;
                leaveY = this._leave.y;
            }
        }
        const to = this.castSea(landX, landY);
        const ray = this.screenRay(leaveX, leaveY, tmpV);
        const p = this.camera.position;
        const from = { x: p.x + ray.x * 5.5, y: p.y + ray.y * 5.5, z: p.z + ray.z * 5.5 };
        const record = this.pool.send(this.clock, from, to.x, to.z, rgb, {
            hard,
            windAzimuth: this.setAz * DEG,
        });
        this.addRing(to.x, to.z, record.t0, hard ? 1.7 : 1, rgb, hard ? 1.6 : 1);
        if (hard) {
            this.splash(to.x, to.z, record.t0, Math.round(this.tier.drops / 14), rgb);
            // Set down hard, the water answers twice: a second ring follows the first.
            this.addRing(to.x, to.z, record.t0 + 0.26, 1.15, rgb, 1.2);
            this.fx.flash.hit(0.06, this.clock);
        }
        this.surge.lock(c, this.clock);
    }

    /** Lines cleared: { player, rows, lines, combo, cascade, twist, perfect, b2b, screen }. */
    onClear(c) {
        const s = this.state;
        const at = this.clock;
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
        // A cascade's waves (360 ms apart) each build on the last: more lanterns, sooner, a
        // fuller halo, more fire, a brighter road.
        const wave = Math.max(0, Math.min(9, Math.round(Number(c.cascade) || 1) - 1));
        const swell = 1 + wave * 0.22;
        // Lanterns go up: one a line, more in a chain and with every wave, all of them for four lines.
        const chain = Math.min(3, Math.floor(Math.max(0, s.combo - 1) / 2));
        const count = big ? this.pool.capacity : lines + chain + wave;
        const lifted = this._lifted;
        lifted.length = 0;
        const went = this.pool.lift(at, count, {
            gap: (big ? 0.16 : 0.32) / swell, spiral: c.twist ? 1.25 : 0, out: lifted,
        });
        s.lifted += went;
        // Each leaves a ring where it rose from the water (a quad's first few only: the rest
        // would crowd every lock's ring off the water).
        const rings = Math.min(lifted.length, Math.max(2, Math.ceil(this.ringRows.length / 4)));
        for (let i = 0; i < rings; i += 1) {
            const r = lifted[i];
            this.addRing(r.xr, r.zr, r.tr, 1.2 * Math.min(1.6, swell), r.rgb, 0.8);
        }
        // A wave of light races out over the sea from under the board to the horizon, in the
        // hour's own light: stronger with every line, every wave of a cascade and every clear a
        // chain holds. A twist winds a whirl of light round where its lanterns rose instead of
        // (and beside) it; a back-to-back sends a second wave on the heels of the first.
        const origin = this.castSea(0.5, 0.985, 3, 30, this._origin);
        const tint = this.waveLight();
        const power = (0.5 + lines * 0.2) * Math.min(1.6, swell) * (1 + 0.07 * Math.min(8, s.combo));
        this.addWave(origin.x, origin.z, at, power, tint, 0);
        if (c.b2b) this.addWave(origin.x, origin.z, at + 0.3, power * 0.85, tint, 0);
        if (big && !c.b2b) this.addWave(origin.x, origin.z, at + 0.42, power * 0.7, tint, 0);
        if (c.twist) this.whirl(lifted, at, 1.15);
        // Three lines and more stand a pillar of light over the sun (the moon by night).
        if (lines >= 3) this.fx.pillar.hit(0.55 + (lines - 3) * 0.35, at);
        this.sendPulse((0.5 + lines * 0.1) * swell);
        this.fx.glint.hit((0.6 + lines * 0.3) * swell, at);
        this.fx.flare.hit((0.35 + lines * 0.15) * Math.min(1.5, swell), at);
        this.fx.fireKick.hit((0.18 + lines * 0.1) * swell, at);
        this.fx.flash.hit(0.08 + lines * 0.05, at);
        // The second difficult clear in a row: sun dogs stand on the halo either side of the light.
        if (c.b2b) this.fx.dogs.hit(1, at);
        if (big) {
            this.fx.fireKick.hit(0.5, at);
            this.fx.flash.hit(0.2, at);
            this.fx.rays.hit(0.8, at);
            this.greenFlash();
            // And the far shore answers: lanterns let go all along the horizon.
            this.sendRelease(at + 0.45, 1, lifted);
        }
        if (c.perfect) this.crownMoment(at);
        this.surge.clear(c, at);
    }

    /**
     * A perfect clear, settled after its clear (sunset-director.js): the crown on the clear still
     * playing, never a second one.
     */
    onCrown() {
        this.crownMoment(this.clock);
        this.surge.crown(this.clock);
    }

    /**
     * The crown: whatever is still afloat lifts, the great halo rings the light with sun dogs on
     * the near halo, the sun flares and its road blazes, the green flash (if the sun is low) is
     * held on, and the whole flock comes.
     */
    crownMoment(at) {
        const lifted = this._lifted;
        lifted.length = 0;
        this.state.lifted += this.pool.lift(at, this.pool.capacity, { gap: 0.12, out: lifted });
        for (let i = 0; i < Math.min(2, lifted.length); i += 1) {
            const r = lifted[i];
            this.addRing(r.xr, r.zr, r.tr, 1.4, r.rgb, 0.9);
        }
        this.sendPulse(0.45);
        // The whole shore lets its lanterns go, the rays are thrown wide and the pillar stands;
        // by night the sky answers with a shower of shooting stars.
        this.sendRelease(at + 0.3, 1.6, lifted);
        this.fx.rays.hit(1, at);
        this.fx.pillar.hit(1, at);
        if (this.light.stars > 0.4) this.sendShower(at + 0.35);
        const origin = this.castSea(0.5, 0.985, 3, 30, this._origin);
        this.addWave(origin.x, origin.z, at, 1.5, this.waveLight(), 0);
        this.fx.great.hit(1, at);
        this.fx.dogs.hit(0.8, at);
        this.fx.flare.hit(0.8, at);
        this.fx.glint.hit(1.2, at);
        this.fx.fireKick.hit(0.35, at);
        this.fx.flash.hit(0.12, at);
        this.greenFlash();
        this.sendFlock(this.parts.birds?.count ?? 0);
    }

    /** A twist that cleared nothing: the oldest lantern on the water goes up turning. */
    onSpin() {
        const at = this.clock;
        const lifted = this._lifted;
        lifted.length = 0;
        this.state.lifted += this.pool.lift(at, 1, { spiral: 1.25, out: lifted });
        if (lifted.length) this.addRing(lifted[0].xr, lifted[0].zr, lifted[0].tr, 1.2, lifted[0].rgb, 0.8);
        this.whirl(lifted, at, 0.8);
        this.fx.flare.hit(0.2, at);
        this.fx.glint.hit(0.3, at);
        this.surge.spin(at);
    }

    /**
     * A whirl of light on the water (a twist): round where the first of `lifted` rose, in its
     * colour and turning the way it does; with none afloat, under the board in the hour's light.
     */
    whirl(lifted, at, strength) {
        const first = lifted[0];
        if (first) {
            this.addWave(first.xr, first.zr, first.tr, strength, first.rgb, first.spiral < 0 ? -1 : 1);
            return;
        }
        const origin = this.castSea(0.5, 0.985, 3, 30, this._origin);
        this.addWave(origin.x, origin.z, at, strength, this.waveLight(), 1);
    }

    /**
     * The far shore lets its lanterns go: `scale` of the tier's count rise all along the horizon,
     * the letting-go running along the shore from where the sun sets, most of them candle gold and
     * some in the colours of the lanterns that just rose (`lifted`).
     */
    sendRelease(at, scale = 1, lifted = null) {
        const batch = this.releases[this.releaseCursor];
        this.releaseCursor = (this.releaseCursor + 1) % this.releases.length;
        const cap = batch.rows.length / 8;
        const n = Math.min(cap, Math.round(cap * Math.min(1, 0.62 * scale)));
        const half = this.halfView() + 4;
        const rand = this.farRand;
        const { rows } = batch;
        for (let i = 0; i < n; i += 1) {
            const az = (rand() * 2 - 1) * half;
            const range = lerp(RELEASE.range[0], RELEASE.range[1], rand() ** 0.7);
            const k = i * 8;
            rows[k] = Math.sin(az * DEG) * range;
            rows[k + 1] = -Math.cos(az * DEG) * range;
            rows[k + 2] = 0.2 + (Math.abs(az - this.setAz) / (2 * half)) * RELEASE.ripple + rand() * 1.3;
            rows[k + 3] = lerp(RELEASE.rise[0], RELEASE.rise[1], rand());
            const own = lifted?.length && rand() < 0.3 ? lifted[Math.floor(rand() * lifted.length)].rgb : null;
            const warm = rand();
            rows[k + 4] = own ? own[0] : 1;
            rows[k + 5] = own ? own[1] : 0.56 + 0.14 * warm;
            rows[k + 6] = own ? own[2] : 0.2 + 0.12 * warm;
            rows[k + 7] = rand() * Math.PI * 2;
        }
        batch.at = at;
        batch.n = n;
        this.state.releases += 1;
        this.fx.release.hit(0.75 * Math.min(1.4, scale), at);
    }

    /** A shower of shooting stars from high over the picture (the crown, by night). */
    sendShower(at) {
        const { meteors } = this.parts;
        if (!meteors) return;
        const rand = this.farRand;
        const half = this.halfView();
        for (let i = 0; i < SHOWER.count; i += 1) {
            // Each falls away from a point high over the frame, down and to one side.
            const az = (rand() * 2 - 1) * (half - 4);
            const el = 16 + rand() * 16;
            const lean = (az / half) * 26 + (rand() * 2 - 1) * 10;
            const length = 11 + rand() * 9;
            azElDirection(az, el, this._from);
            azElDirection(az + Math.sin(lean * DEG) * length, el - Math.cos(lean * DEG) * length, this._toward);
            meteors.send(
                at + (i / SHOWER.count) * SHOWER.seconds + rand() * 0.15,
                this._from,
                this._toward,
                0.5 + rand() * 0.4,
                1.6 + rand() * 1.4,
            );
        }
        this.state.showers += 1;
    }

    /** One shooting star by itself, somewhere in the picture's sky. */
    sendMeteor(at, roll) {
        const { meteors } = this.parts;
        if (!meteors) return;
        const rand = this.farRand;
        const half = this.halfView();
        const az = (rand() * 2 - 1) * (half - 5);
        const el = 13 + rand() * 15;
        const lean = (roll * 2 - 1) * 62;
        const length = 9 + rand() * 9;
        azElDirection(az, el, this._from);
        const low = Math.max(2, el - Math.cos(lean * DEG) * length);
        azElDirection(az + Math.sin(lean * DEG) * length, low, this._toward);
        meteors.send(at, this._from, this._toward, 0.45 + rand() * 0.5, 1.1 + rand() * 1.3);
    }

    /** The longest chain any board is holding (0 = it broke). */
    onCombo(combo) {
        const s = this.state;
        const next = Math.max(0, combo | 0);
        if (next > s.combo && next >= 3) this.sendFlock(birdsForCombo(next, this.parts.birds?.count ?? 0));
        s.combo = next;
    }

    /**
     * Call `n` birds across the light. A flock still on its way in takes them (the skein grows
     * with the chain); one called later sets out beside it. Nothing is refused, nothing restarted.
     */
    /** Half the frame's horizontal field of view (degrees): where the boat comes in and goes out. */
    halfView() {
        const vertical = fovForAspect(this.aspect) * DEG;
        return Math.atan(Math.tan(vertical / 2) * this.aspect) / DEG;
    }

    /**
     * Send the boat across now (the playground stages a passage): `dir` 1 left to right, -1 right
     * to left; `range`, `speed` and `slant` as BOAT has them. It otherwise comes by itself.
     */
    sendBoat(options = {}) {
        this.parts.boat?.send(this.clock, this.halfView(), options);
    }

    sendFlock(n) {
        const s = this.state;
        if (!this.parts.birds || n <= 0) return;
        s.flockSize = n;
        s.flocks += 1;
        const target = this.light.moonKey > 0.5 ? this.U.moon.value : this.U.sun.value;
        this.parts.birds.send(this.clock, n, target, this.rand());
    }

    /**
     * A new level: the day runs on LEVEL_SECONDS of its timetable for every level gained, from
     * where the last turn was headed (never back). `silent`: it simply is that level.
     */
    levelUp(level, { silent = false } = {}) {
        const s = this.state;
        const { day } = this;
        const next = Math.max(1, level | 0);
        if (silent) {
            this.restoreDay((next - 1) * LEVEL_SECONDS);
        } else if (next > s.level) {
            this.surge.levelUp(this.clock);
            // The day's turn shows first on the horizon, lit from end to end, and every flame
            // afloat leaps.
            this.fx.dawn.hit(1, this.clock);
            this.fx.lampKick.hit(1, this.clock);
            day.from = this.dayOffset();
            day.to += (next - s.level) * LEVEL_SECONDS;
            day.at = this.clock;
            day.seconds = turnSeconds(day.to - day.from);
        }
        s.level = next;
        this.applyHour();
    }

    // ── the day ─────────────────────────────────────────────────────────────────

    /** Seconds of the timetable the levels have carried the day on (eased while it turns). */
    dayOffset() {
        const { day } = this;
        return levelOffset(day.from, day.to, this.clock - day.at, day.seconds);
    }

    /** Where a turn is headed: what a rebuild in place hands to the new world (restoreDay). */
    dayTarget() {
        return this.day.to;
    }

    /** Stand the day on an offset at once (a rebuild in place picks the day up where it was). */
    restoreDay(offset) {
        const { day } = this;
        day.from = Number.isFinite(offset) ? offset : 0;
        day.to = day.from;
        day.at = -100;
        day.seconds = 1;
    }

    /** Where the day stands on its timetable (seconds): the clock plus what the levels added. */
    wheel() {
        return this.clock + this.dayOffset();
    }

    /** The hour of the day (0..24). */
    dayHour() {
        return this.day.pin ?? dayHourAt(this.wheel());
    }

    /** Hand the hour's light to the shaders, and put the sun and the moon where the hour has them. */
    applyHour() {
        const { U } = this;
        const hour = this.dayHour();
        const light = lightAt(hour, this.light);
        for (let i = 0; i < HOUR_COLOURS.length; i += 1) {
            const colour = light[HOUR_COLOURS[i]];
            this.lightRows[i].set(colour[0], colour[1], colour[2], 0);
        }
        // The sky burning with play: the hour's cloud and air lean toward the ember.
        const { ember } = this;
        if (ember > 0) {
            for (let i = 0; i < EMBER.length; i += 1) {
                const e = EMBER[i];
                const v = this.lightRows[e[0]];
                v.set(v.x * lerp(1, e[1], ember), v.y * lerp(1, e[2], ember), v.z * lerp(1, e[3], ember), 0);
            }
        }
        // The weather's hand on the hour.
        const sky = skyAt(this.weatherPin ?? skyDrift(this.clock), this.sky);
        U.stars.value = light.stars;
        U.cover.value = clamp01(light.cover + sky.cover);
        U.cirrus.value = sky.cirrus;
        U.bars.value = sky.bars;
        U.towers.value = sky.towers;
        U.veil.value = sky.veil;
        U.mackerel.value = sky.mackerel;
        U.hazeReach.value = TUNE.hazeReach * sky.haze;
        U.chop.value = sky.chop;
        U.fire.value = light.fire;
        U.moonKey.value = light.moonKey;
        // The night sky turns about its pole with the hours, the same way the sun and the moon go
        // (right to left in front of the eye); at midnight it stands as the shader places it.
        U.starTurn.value = -(hour / 24) * Math.PI * 2;

        // The sun.
        const sun = arcAt(hourAngle(hour), SUN_PEAK, this.setAz, this.riseAz, this.sunArc);
        azElDirection(sun.az, sun.el, U.sun.value);
        this.bodyFrame(U.sun.value, U.sunRight.value, U.sunTop.value);
        U.sunUp.value = smooth(-SUN_RADIUS, SUN_RADIUS, sun.el);
        U.sunLow.value = 1 - smooth(1.5, 11, sun.el);
        U.sunSquash.value = discSquash(sun.el);
        // Near the sea a body looks larger than it does high up.
        U.sunSize.value = Math.sin(SUN_RADIUS * DEG) * (1 + 0.1 * (1 - smooth(0, 15, sun.el)));
        // A low sun is a coal seen through a long way of air; a high one is white.
        U.sunPower.value = lerp(6, 28, smooth(0, 13, sun.el) ** 1.4);
        // The moon, its face turning as it crosses the sky.
        const angle = hourAngle(hour, MOON_LAG);
        const moon = arcAt(angle, MOON_PEAK, this.setAz, this.riseAz, this.moonArc);
        azElDirection(moon.az, moon.el, U.moon.value);
        this.bodyFrame(U.moon.value, U.moonRight.value, U.moonTop.value);
        U.moonUp.value = smooth(-MOON_RADIUS, MOON_RADIUS, moon.el);
        U.moonSquash.value = discSquash(moon.el);
        U.moonSize.value = Math.sin(MOON_RADIUS * DEG) * (1 + 0.22 * (1 - smooth(0, 18, moon.el)));
        U.moonPower.value = lerp(0.8, 1.05, smooth(0, 8, moon.el));
        U.moonTilt.value = -0.45 * Math.sin(angle * DEG);
        // Tonight's moon: its phase, and the light a moon of that phase gives the sea and the air
        // (against the gibbous moon the hours are authored for).
        const phase = this.moonPin ?? moonPhaseAt(this.wheel());
        this.moonPhase = phase;
        U.moonPhase.value.set(Math.sin(phase * DEG), Math.cos(phase * DEG), lerp(0.018, 0.07, smooth(60, 125, phase)));
        const share = moonLit(phase) / moonLit(MOON_PHASE);
        for (let i = 0; i < MOON_LIGHT_ROWS.length; i += 1) this.lightRows[MOON_LIGHT_ROWS[i]].multiplyScalar(share);

        // The key light's way across the cloud deck, and the streets running in toward the place
        // the sky goes down.
        const street = U.street.value;
        street.set(Math.sin(this.setAz * DEG), -Math.cos(this.setAz * DEG));
        azElDirection(this.setAz, 0, U.setDir.value);
        azElDirection(this.riseAz, 0, U.riseDir.value);
        U.gates.value.set(this.setAz * DEG, this.riseAz * DEG);
        const key = tmpKey.copy(U.sun.value).lerp(U.moon.value, light.moonKey);
        const kx = key.x;
        const kz = key.z;
        const kl = Math.hypot(kx, kz);
        if (kl > 1e-3) {
            const along = (kx * street.x + kz * street.y) / kl;
            const across = (kx * -street.y + kz * street.x) / kl;
            const l = Math.hypot(along * TUNE.deckAlong, across * TUNE.deckAcross) || 1;
            U.keyFlat.value.set((along * TUNE.deckAlong) / l, (across * TUNE.deckAcross) / l);
        }
    }

    /** A body's right and up axes on the sky (for its disc). */
    bodyFrame(dir, right, top) {
        right.set(-dir.z, 0, dir.x);
        if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
        right.normalize();
        // A body behind the eye: keep its right hand on the right as the eye sees it.
        if (dir.z > 0) right.negate();
        top.crossVectors(right, dir).normalize();
        if (top.y < 0) top.negate();
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    update(sim, camera) {
        if (!this.parts.sea) return;
        const dt = Math.max(0, sim.delta);
        this.time = sim.time;
        const { U } = this;
        const s = this.state;
        this.clock += dt;
        const now = this.clock;
        U.time.value = now;
        // How hot play runs (once a frame, on the clock the events are stamped with).
        const heat = this.surge.sample(now);
        this.heat = heat;
        const { level, fever, punch } = heat;
        // The hour's colours lean toward the ember as play heats (less under the moon, whose
        // cloud is silver): nothing in casual play, the whole sky in a fever.
        this.ember = clamp01(0.25 * smooth(0.3, 0.9, level) + 0.75 * fever ** 1.3) * (1 - 0.5 * this.light.moonKey);
        // The places the sky sets and rises follow the frame (a board arriving, a resize).
        const k = approach(0.9, dt);
        this.setAz += (this.frame.setAz - this.setAz) * k;
        this.riseAz += (this.frame.riseAz - this.riseAz) * k;
        this.applyHour();
        // The islands keep their bearings from the two gates. (To a thousandth of a degree: the
        // eased bearings creep toward their places for a long time, and the islands redo their
        // lamps and their skyline whenever a gate has moved at all.)
        this.parts.islands?.update(now, {
            setAz: Math.round(this.setAz * 1000) / 1000, riseAz: Math.round(this.riseAz * 1000) / 1000,
        });

        // Rings run their course (the table is in no order: the spent ones are packed out).
        let live = 0;
        for (let i = 0; i < this.ringCount; i += 1) {
            if (now - this.ringRows[i * 2].z > RING_LIFE) continue;
            if (live !== i) {
                this.ringRows[live * 2].copy(this.ringRows[i * 2]);
                this.ringRows[live * 2 + 1].copy(this.ringRows[i * 2 + 1]);
            }
            live += 1;
        }
        this.ringCount = live;
        // …and so do the waves of light and the whirls.
        live = 0;
        for (let i = 0; i < this.waveCount; i += 1) {
            const life = this.waveRows[i * 2 + 1].w !== 0 ? WHIRL_LIFE : WAVE_LIFE;
            if (now - this.waveRows[i * 2].z > life) continue;
            if (live !== i) {
                this.waveRows[live * 2].copy(this.waveRows[i * 2]);
                this.waveRows[live * 2 + 1].copy(this.waveRows[i * 2 + 1]);
            }
            live += 1;
        }
        this.waveCount = live;
        // The sea's own cold light answers a touch once the sky is dark.
        U.seaFire.value = this.light.stars;

        // The fire in the sky: the chain holds it, each clear kicks it (the kicks add up), and the
        // heat of play lays a floor under both that a fever lifts past where a chain alone goes.
        const { fx } = this;
        const held = fireForCombo(s.combo);
        s.fire += (held - s.fire) * approach(held > s.fire ? 1.4 : 0.35, dt);
        U.skyFire.value = softCeiling(s.fire + fx.fireKick.valueAt(now) + 0.15 * level + 0.35 * fever, 1, 1.4);
        U.flare.value = fx.flare.valueAt(now) + 0.3 * fever;
        // The sun's road: each clear flares it, a chain and the heat of play keep it burning, and
        // every lock and drop sets it shimmering.
        U.glint.value = fx.glint.valueAt(now) + s.fire * 0.6 + 0.3 * level + 0.5 * fever + 0.4 * punch;
        // The green flash: up within a quarter of a second, held, then away over a second or so.
        const green = now < s.greenUntil ? 1 : 0;
        s.green += (green - s.green) * approach(green > s.green ? 9 : 2.4, dt);
        if (green === 0 && s.green < 1e-3) s.green = 0;
        U.green.value = s.green;
        // The halo: it runs out from the disc to its place and stands as long as it is lit. The
        // heat of play holds it up; a fever puts the sun dogs on it and the great halo round it.
        // (And a veil of high cloud stands one there by itself.)
        this.haloHeld = 0.2 * smooth(0.3, 0.9, level) + 0.45 * fever + 0.34 * this.sky.veil;
        const halo = fx.halo.valueAt(now);
        if (halo + this.haloHeld < HALO_GONE && now - s.haloFrom > HALO_RISE) s.haloMoon = this.light.moonKey > 0.5;
        const reach = (0.15 + 0.85 * smooth(0, HALO_RISE, now - s.haloFrom)) * HALO_RADIUS * DEG;
        const width = (0.0075 * Math.sin(reach)) / Math.sin(HALO_RADIUS * DEG) + 0.0012;
        U.pulse.value.set(
            Math.cos(reach),
            width,
            softCeiling(halo + this.haloHeld, 0.9, 1.3),
            softCeiling(fx.dogs.valueAt(now) + 0.35 * fever, 0.8, 1.2),
        );
        U.greatHalo.value.z = softCeiling(fx.great.valueAt(now) + 0.55 * fever, 0.8, 1.1);
        U.pulseDir.value.copy(s.haloMoon ? U.moon.value : U.sun.value);
        U.pulseRight.value.copy(s.haloMoon ? U.moonRight.value : U.sunRight.value);
        U.haloMoon.value = s.haloMoon ? 1 : 0;
        U.pillar.value = softCeiling(fx.pillar.valueAt(now) + 0.2 * fever, 0.8, 1.2);
        U.rayBurst.value = fx.rays.valueAt(now);
        // The horizon lit from end to end: a new level's turn in the hour's brightest light, and
        // the far shore's lanterns in candle gold.
        const dawn = fx.dawn.valueAt(now) * 0.42;
        const shore = fx.release.valueAt(now) * 0.13;
        const rim = this.light.cloudRim;
        U.horizonGlow.value.set(rim[0] * dawn + shore, rim[1] * dawn + 0.55 * shore, rim[2] * dawn + 0.2 * shore, 1);
        this.runAmbient(now);
        // The cloud deck drifts in toward the sun, faster as play heats: the evening wind rises.
        const still = this.reducedMotion ? 0.25 : 1;
        this.driftClock += dt * (1 + still * (0.8 * level + 1.4 * fever));
        U.drift.value.set(-this.driftClock * 0.0011, this.driftClock * 0.00023);
        U.cloudClock.value = this.driftClock;
        // The lanterns burn brighter with the heat (a lock's hit kicks the ones afloat), and the
        // ones rising into a burning sky brighter still.
        this.lampBoost = 1 + 0.22 * level + 0.3 * fever + 0.25 * punch + 0.7 * fx.lampKick.valueAt(now);
        this.airBoost = 1 + 0.3 * level + 0.6 * fever;

        // The boat first: its lantern joins the glows and the lamps the sea mirrors.
        this.parts.boat?.update(this.clock, { halfView: this.halfView(), night: lampForSun(this.sunArc.el) });
        this.updateLanterns(camera);
        this.parts.birds.update(this.clock);
        this.parts.meteors?.update(this.clock);
        U.counts.value.set(this.ringCount, this.waveCount, this._lampCount ?? 0, 0);

        if (camera) {
            this.parts.sky.follow(camera);
            // Where the sun stands on screen (the post draws its shafts from there).
            const body = this.light.moonKey > 0.5 ? U.moon.value : U.sun.value;
            tmpSun.copy(body).multiplyScalar(1000).add(camera.position).project(camera);
            const ahead = tmpRay.set(0, 0, -1).transformDirection(camera.matrixWorld).dot(body);
            this.sunScreen.x = tmpSun.x * 0.5 + 0.5;
            this.sunScreen.y = 0.5 - tmpSun.y * 0.5;
            // The moon draws no shafts: they would comb the stars into streaks. Nor does a sun
            // high over the picture: they would rake down from its top edge.
            const up = U.sunUp.value * (1 - this.light.moonKey) * (1 - smooth(18, 34, this.sunArc.el));
            this.sunScreen.visible = ahead > 0.2 ? up : 0;
        }
    }

    /**
     * What happens by itself, each on a clock of its own: a shooting star in a dark sky, lightning
     * flickering inside a far tower of cloud when the light is low, a few gulls crossing by day.
     */
    runAmbient(now) {
        const { ambient, light } = this;
        const meteor = ambient.meteor.due(now);
        if (meteor >= 0 && light.stars > 0.55 && this.U.cover.value < 0.62) {
            this.sendMeteor(now, ambient.meteor.roll);
        }
        const dim = 1 - smooth(-2, 9, this.sunArc.el);
        const bolt = ambient.bolt.due(now);
        // (Not under reduced motion: a flicker is the one thing here that is not slow.)
        if (bolt >= 0 && this.sky.towers > 0.35 && dim > 0.2 && !this.reducedMotion) {
            // A flicker of two or three flashes inside one head, somewhere along the horizon.
            const half = this.halfView();
            this.boltBearing = ((ambient.bolt.roll * 2 - 1) * half) * DEG;
            this.fx.bolt.hit(1, now);
            this.fx.bolt.hit(0.6, now + 0.1);
            if (ambient.bolt.roll > 0.4) this.fx.bolt.hit(0.9, now + 0.24);
        }
        this.U.bolt.value.set(this.boltBearing, this.fx.bolt.valueAt(now) * dim * this.sky.towers * flashScale());
        const gulls = ambient.gulls.due(now);
        if (gulls >= 0 && light.birds > 0.5 && this.state.combo < 3 && (this.parts.birds?.airborne(now) ?? 1) === 0) {
            this.sendFlock(3 + Math.floor(ambient.gulls.roll * 5));
            this.state.flocks -= 1;
        }
    }

    /** The lanterns, their halos, the lights in flight, the splashes, and the lamps the sea mirrors. */
    updateLanterns(camera) {
        const { pool, clock } = this;
        const { lanterns } = this.parts;
        const { glows } = this.parts;
        lanterns.begin();
        glows.begin();
        pool.sweep(clock);
        const lamps = this._lamps;
        lamps.length = 0;
        const st = this._lantern;
        const eye = camera ? camera.position : { x: 0, y: EYE_HEIGHT, z: 0 };
        /** How brightly a flame shows against the hour's light (the stations' `lantern`). */
        const shown = this.light.lantern;
        for (let i = 0; i < pool.records.length; i += 1) {
            const r = pool.records[i];
            pool.stateOf(r, clock, st);
            if (!st.phase) continue;
            if (st.phase === 'mote') {
                // The light in flight, and its trail.
                this._to.x = r.x0;
                this._to.z = r.z0;
                this._to.y = seaHeight(r.x0, r.z0, r.t0) + 0.3;
                for (let j = 0; j < MOTE_TRAIL; j += 1) {
                    const s = st.mote - (j * MOTE_STEP) / MOTE_SECONDS;
                    if (s < 0) break;
                    moteAt({ x: r.fromX, y: r.fromY, z: r.fromZ }, this._to, s, this._mote);
                    const fade = (1 - j / MOTE_TRAIL) ** 1.5;
                    const hot = j === 0 ? 3 : 1;
                    glows.push(
                        this._mote.x,
                        this._mote.y,
                        this._mote.z,
                        (j === 0 ? 0.24 : 0.13) * fade + 0.03,
                        r.rgb[0] * 4 * fade * hot,
                        r.rgb[1] * 4 * fade * hot,
                        r.rgb[2] * 4 * fade * hot,
                    );
                }
                continue;
            }
            const air = st.phase === 'air';
            // The heat of play: every flame burns brighter, the rising ones most.
            const glow = st.glow * (air ? this.airBoost : this.lampBoost);
            // (Drawn a little over life size: the lotus is finer than the shell it replaced, and
            // at life size it was a smaller thing in the picture.)
            const size = st.scale * LANTERN_SIZE;
            lanterns.push(st.x, st.y, st.z, st.tiltX, st.tiltZ, size, r.rgb, glow, r.seed);
            // The halo round its flame, a little larger than the bud, and only as strong as the
            // hour lets a flame show: round a paper lantern in full sun a glow is the least
            // believable thing in the picture.
            const fy = st.y + 0.26 * size;
            const halo = glow * 0.36 * shown;
            const reach = (air ? 0.62 : 0.5) * LANTERN_SIZE;
            glows.push(st.x, fy, st.z, reach, r.rgb[0] * halo, r.rgb[1] * halo, r.rgb[2] * halo);
            const dx = st.x - eye.x;
            const dz = st.z - eye.z;
            const far = Math.hypot(dx, dz);
            const score = (glow / (1 + far * 0.03)) * (fy < 40 ? 1 : 0.25);
            lamps.push({
                x: st.x, y: fy, z: st.z, glow: glow * shown, rgb: r.rgb, score,
            });
        }
        // The boat's lantern, lit from dusk: a small warm light far out, and its road on the sea.
        const boatLamp = this.parts.boat?.lampLight();
        if (boatLamp) {
            const { rgb } = boatLamp;
            const g = boatLamp.glow;
            glows.push(boatLamp.x, boatLamp.y, boatLamp.z, 0.45, rgb[0] * g, rgb[1] * g, rgb[2] * g);
            const far = Math.hypot(boatLamp.x - eye.x, boatLamp.z - eye.z);
            lamps.push({
                x: boatLamp.x, y: boatLamp.y, z: boatLamp.z, glow: g * 2.2, rgb, score: g / (1 + far * 0.03),
            });
        }
        // The boat's wake: the churned water astern and the wave at its bow, pale in the sky's
        // light. (Seen so low over the water a wake drawn on the sea is thinner than a pixel; the
        // spray standing a hand over it is what the eye sees.)
        const wake = this.parts.boat?.wake();
        if (wake) {
            const L = this.light;
            const lit = 0.3 * (this.U.sunUp.value * (1 - L.moonKey) + this.U.moonUp.value * L.moonKey);
            const fr = (L.ambient[0] * 0.5 + L.cloudLit[0] * lit) * wake.run;
            const fg = (L.ambient[1] * 0.5 + L.cloudLit[1] * lit) * wake.run;
            const fb = (L.ambient[2] * 0.5 + L.cloudLit[2] * lit) * wake.run;
            for (let i = 0; i < WAKE_PUFFS; i += 1) {
                const back = wake.stern + 0.6 + i * 2.1;
                const fade = (1 - i / WAKE_PUFFS) ** 1.4;
                const wob = Math.sin(clock * 2.3 + i * 1.7) * 0.12 * i * 0.3;
                glows.push(
                    wake.x - wake.hx * back + wake.hz * wob,
                    wake.y + 0.16,
                    wake.z - wake.hz * back - wake.hx * wob,
                    0.42 + i * 0.05,
                    fr * fade,
                    fg * fade,
                    fb * fade,
                    1,
                );
            }
            const bx = wake.x + wake.hx * wake.bow;
            const bz = wake.z + wake.hz * wake.bow;
            glows.push(bx, wake.y + 0.14, bz, 0.34, fr * 0.7, fg * 0.7, fb * 0.7, 1);
        }
        // The drops of a splash: thrown up, falling back.
        const nd = this.drops.length / 10;
        for (let i = 0; i < nd; i += 1) {
            const k = i * 10;
            const age = clock - this.drops[k + 6];
            if (age < 0 || age > DROP_LIFE) continue;
            const y = this.drops[k + 1] + this.drops[k + 4] * age - 4.9 * age * age;
            if (y < -0.05) continue;
            const fade = 1 - smooth(DROP_LIFE * 0.5, DROP_LIFE, age);
            glows.push(
                this.drops[k] + this.drops[k + 3] * age,
                y,
                this.drops[k + 2] + this.drops[k + 5] * age,
                0.045,
                this.drops[k + 7] * 3.2 * fade,
                this.drops[k + 8] * 3.2 * fade,
                this.drops[k + 9] * 3.2 * fade,
                1,
            );
        }
        // The far shore's lanterns: each climbs out of the distance, is taken by the wind toward
        // the place the sun sets, and gutters out.
        const windX = Math.sin(this.setAz * DEG);
        const windZ = -Math.cos(this.setAz * DEG);
        for (let b = 0; b < this.releases.length; b += 1) {
            const batch = this.releases[b];
            const since = clock - batch.at;
            if (batch.n === 0 || since < 0 || since > RELEASE.life + RELEASE.ripple + 2) continue;
            const { rows } = batch;
            for (let i = 0; i < batch.n; i += 1) {
                const k = i * 8;
                const s = since - rows[k + 2];
                if (s < 0 || s > RELEASE.life) continue;
                const up = rows[k + 3] * (s - 1.4 * (1 - Math.exp(-s / 1.4)));
                const away = RELEASE.wind * (s - 5 * (1 - Math.exp(-s / 5)));
                const sway = Math.sin(s * 0.6 + rows[k + 7]) * 1.5;
                const fade = smooth(0, 0.9, s) * (1 - smooth(RELEASE.life - 5.5, RELEASE.life, s));
                const g = 2.3 * fade * (0.86 + 0.14 * Math.sin(clock * 7.3 + rows[k + 7] * 5));
                glows.push(
                    rows[k] + windX * away - windZ * sway,
                    1.2 + up,
                    rows[k + 1] + windZ * away + windX * sway,
                    0.85,
                    rows[k + 4] * g,
                    rows[k + 5] * g,
                    rows[k + 6] * g,
                );
            }
        }
        // The night's fishing boats far out: a hard green-white lamp each, and the haze it lights.
        const night = this.light.stars;
        // And the lamps of the people who live under the islands, lit as the light goes: warm
        // points at the water's edge.
        const dusk = lampForSun(this.sunArc.el);
        const homes = dusk > 0.04 ? this.parts.islands?.lights() : null;
        if (homes) {
            for (let i = 0; i < homes.length; i += 1) {
                const home = homes[i];
                const lamp = dusk * (0.85 + 0.15 * Math.sin(clock * 1.3 + i * 2.7)) * 1.5;
                glows.push(home.x, home.y + 1.5, home.z, 2.2, lamp, 0.62 * lamp, 0.26 * lamp);
            }
        }
        if (night > 0.04) {
            for (let i = 0; i < NIGHT_BOATS.length; i += 1) {
                const [gate, off, range] = NIGHT_BOATS[i];
                const az = ((gate === 'set' ? this.setAz : this.riseAz) + off) * DEG;
                const x = Math.sin(az) * range;
                const z = -Math.cos(az) * range;
                const lamp = night * (0.9 + 0.1 * Math.sin(clock * 0.8 + i * 2.1));
                glows.push(x, 5, z, 4, 1.1 * lamp, 2.3 * lamp, 1.6 * lamp);
                glows.push(x, 18, z, 110, 0.03 * lamp, 0.085 * lamp, 0.062 * lamp, 1);
            }
        }
        lanterns.end();
        glows.end();
        // The lamps the sea mirrors: the brightest and nearest.
        lamps.sort((a, b) => b.score - a.score);
        const n = Math.min(lamps.length, this.lampRows.length / 2);
        for (let i = 0; i < n; i += 1) {
            const l = lamps[i];
            this.lampRows[i * 2].set(l.x, l.y, l.z, l.glow * 55);
            this.lampRows[i * 2 + 1].set(l.rgb[0], l.rgb[1], l.rgb[2], 0);
        }
        this._lampCount = n;
    }

    /** What the post stack should know this frame. */
    getPostState() {
        const L = this.light;
        const now = this.clock;
        const { level, fever } = this.heat;
        // Past 1 the fire burns hotter in the cloud only: the lens takes no more of it.
        const fire = Math.min(1, this.U.skyFire.value);
        return {
            flash: this.fx.flash.valueAt(now),
            bloomBoost: fire * 0.4 + this.fx.glint.valueAt(now) * 0.1,
            warm: fire,
            sunX: this.sunScreen.x,
            sunY: this.sunScreen.y,
            // The light stands in the air as the sky burns.
            shafts: this.sunScreen.visible * (0.42 + fire * 0.4 + fever * 0.15),
            // Copies: the hour's arrays are rewritten every frame.
            shaftTint: [L.shaft[0], L.shaft[1], L.shaft[2]],
            gradeShadow: [L.gradeShadow[0], L.gradeShadow[1], L.gradeShadow[2]],
            gradeLight: [L.gradeLight[0], L.gradeLight[1], L.gradeLight[2]],
            // An iris: it closes a little as play heats, so the burning sky stays deep in colour
            // instead of washing toward white.
            exposure: L.exposure * (1 - 0.07 * level - 0.06 * fever),
        };
    }

    getState() {
        const s = this.state;
        const { pool, clock } = this;
        return {
            quality: this.quality,
            capture: this.capture,
            time: this.time,
            clock,
            combo: s.combo,
            level: s.level,
            hour: this.light.name,
            hourNext: this.light.next,
            hourMix: this.light.mix,
            dayHour: this.dayHour(),
            wheel: this.wheel(),
            stations: STATIONS.length,
            sunHeight: this.sunArc.el,
            moonHeight: this.moonArc.el,
            sunAz: this.sunArc.az,
            moonAz: this.moonArc.az,
            setAz: this.setAz,
            riseAz: this.riseAz,
            horizon: this.frame.horizon,
            floating: pool.floating(clock),
            flying: pool.flying(clock),
            rings: this.ringCount,
            waves: this.waveCount,
            lamps: this._lampCount ?? 0,
            fire: this.U.skyFire.value,
            green: this.U.green.value,
            halo: this.U.pulse.value.z,
            haloReach: Math.acos(Math.min(1, this.U.pulse.value.x)) / DEG,
            sunDogs: this.U.pulse.value.w,
            greatHalo: this.U.greatHalo.value.z,
            ember: this.ember,
            heat: { ...this.heat },
            locks: s.locks,
            clears: s.clears,
            lifted: s.lifted,
            flocks: s.flocks,
            releases: s.releases,
            showers: s.showers,
            meteors: this.parts.meteors?.falling(clock) ?? 0,
            moonPhase: this.moonPhase,
            weather: this.sky.name,
            weatherNext: this.sky.next,
            weatherMix: this.sky.mix,
            towers: this.U.towers.value,
            veil: this.U.veil.value,
            pillar: this.U.pillar.value,
            rayBurst: this.U.rayBurst.value,
            horizonGlow: Math.max(this.U.horizonGlow.value.x, this.U.horizonGlow.value.y, this.U.horizonGlow.value.z),
            birds: this.parts.birds?.airborne?.(clock) ?? 0,
            boat: this.parts.boat?.getState?.() ?? null,
            islands: this.parts.islands?.getState?.() ?? null,
            sun: { ...this.sunScreen },
        };
    }

    get combo() {
        return this.state.combo;
    }

    dispose() {
        Object.values(this.parts).forEach((part) => part.dispose());
        this.parts = {};
        this.group.removeFromParent();
        this.skyNoise?.dispose();
        this.seaNoise?.dispose();
        this.skyNoise = null;
        this.seaNoise = null;
        this.camera = null;
    }
}
