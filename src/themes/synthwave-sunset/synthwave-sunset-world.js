/**
 * Synthwave Sunset — the world: builds every part, solves the composition, drives the camera
 * and turns gameplay into light.
 *
 * A retro seaside at dusk. The sun sets into the sea at azimuth 0 (straight down −z) behind a
 * ferris wheel at the end of a pleasure pier; the eye stands on the wet sand at the waterline.
 * The gameplay board covers the middle of the screen, so the camera YAWS until the sun lands in
 * the centre of the free zone left of the board (the HUD sits right of it). With no board on
 * screen (menus) the camera faces the sun. Layout changes ease in as a slow pan. The lens is Hor+
 * (fixed vertical FOV, horizontal capped), and the pitch puts the horizon at RIG.horizonFrac.
 *
 * The evening has four clocks (synthwave-sunset-evening.js), each a function of the time alone and
 * each of its own length, so the same picture does not come round for a long while. The hour
 * walks in every mode, the menus and Serenity included: from the sunset (the opening look: the
 * sun on the sea) through the afterglow to a moonlit night, back through the sunset to the golden
 * hour, the sun in the wheel's hub, and round again; a level steps it on, and the wheel's neon
 * ring turns to its other colour at every stop. Tonight's colours turn through four temperaments,
 * the sky's weather through four (streaks, a mackerel sky, clear, cumulus towers with heat
 * lightning after dark), the sea through its states; the wheel's lights through five programmes.
 *
 * Gameplay: every event has an instrument of its own.
 *   lock         the wheel's rims: two bands of the piece's colour run round from the side of its
 *                column and meet at the top (bands that pile up under rapid locks add their light
 *                instead of cutting each other off)
 *   hard drop    the pier's lights: a pulse of the piece's colour runs out along the pier from
 *                the land end to the wheel, brighter the further the piece fell
 *   line clear   the barge's shells, a figure for each count: one shell whose kind turns with
 *                each clear; a pair bursting side by side; a fan under a gold palm; four lines,
 *                the finale across the whole free sky closed by a gold brocade crown while the
 *                wheel's face bursts in gold. The show has memory: a longer chain and hotter
 *                play fire more and bigger shells, and each cascade wave bursts higher
 *   cascade      the pier's deck: roman candles, more of them the deeper the wave
 *   twist        the wheel: it whirls and throws sparks off its rim like a Catherine wheel
 *   back-to-back the wheel's hub: a fan of lasers, a beam more for each in a row, over the
 *                salute's row of rings
 *   perfect      the whole pier: a wall of gold comets, then a waterfall of gold sparks off its
 *                seaward edge into the sea, under a curtain of gold willows, the bay at full blaze
 *   chain        the coaster climbs the lift hill a notch per link (its lift's bulbs fill like a
 *                meter, past eight links ever closer to the crest and ever brighter); when the
 *                chain breaks after three or more it goes round the circuit into the station
 *                (faster and with a longer trail for a longer chain, twice round from ten), and
 *                the lemon drains down the lift instead of going dark. A chain built during a
 *                ride charges the lift ahead of the train, which climbs it on its return
 *   level up     a new act: searchlights sweep up from the pier and cross over the bay, a broad
 *                wave of gold runs out along its lights, the wheel's face bursts in its next
 *                colour, a saturn and a ring go up; the evening steps on along its walk (the
 *                show only with reactions on)
 *
 * The crescendo (src/themes/shared/gameplay-surge.js, sampled once a frame on the world's clock):
 * as play heats, the pleasure pier powers up ahead of the evening. Warm: the pier's lights race
 * out to the wheel, the bulbs burn brighter, more hotel rooms switch on and the chase lights
 * quicken. Hot: the wheel turns faster, the sea breeze stirs the palms, the shells grow and the
 * sky stays lit between them. Fever: the midway at full blaze, the barge firing a volley of its
 * own between the player's shells, the wheel spinning and shooting stars over the bay. When
 * the hands rest it all breathes back to the quiet evening over a few seconds.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import { meltColour, moodDrift, wheelAt } from '../shared/mood-clock.js';
import { RIG, SUN } from './synthwave-sunset-tsl.js';
import {
    EVENING, HOUR, SKY_KEYS, eveningHour, eveningLights, eveningLook, eveningStops, hourOfDusk,
    moonDirection, seaStateAt, skyColours, temperamentPhase, weatherAt, weatherPhase,
} from './synthwave-sunset-evening.js';
import { createSky } from './synthwave-sunset-sky.js';
import { createSea } from './synthwave-sunset-sea.js';
import { NEON_RING, WHEEL, createWheel } from './synthwave-sunset-wheel.js';
import { createPier } from './synthwave-sunset-pier.js';
import { PIER, PIER_HEAD, pierFrame } from './synthwave-sunset-layout.js';
import { Beams } from './synthwave-sunset-beams.js';
import { createLife } from './synthwave-sunset-life.js';
import { loadStrollerFigures } from './synthwave-sunset-people.js';
import { createCoaster } from './synthwave-sunset-coaster.js';
import { createPromenadeSteps } from './synthwave-sunset-promenade.js';
import { createPalms } from './synthwave-sunset-palms.js';
import { SynthwaveGulls, loadGullGeometry } from './synthwave-sunset-gulls.js';
import { FIREWORK_COLORS, Fireworks, WILLOW_GOLD } from './synthwave-sunset-fireworks.js';
import { SYNTHWAVE_SUNSET_TETROMINOS } from './synthwave-sunset-tetrominos.js';
import { applyCameraBreath, easedMotion, prefersReducedMotion } from '../shared/camera-breath.js';
import { drainSteps } from '../shared/build-steps.js';
import { flashScale, prefersReducedFlashing } from '../../utils/photosensitivity.js';

/**
 * The layer the sea's reflection pass renders: everything that stands in the scene and should be
 * mirrored (the wheel, the pier, the coaster, the town, the fireworks). The main camera sees it.
 */
export const MIRROR_LAYER = 3;

/** The parts, in build order (the playground's `parts=` names). */
export const SYNTHWAVE_PARTS = Object.freeze([
    'sky', 'sea', 'wheel', 'pier', 'coaster', 'promenade', 'palms', 'life', 'gulls', 'fireworks', 'beams',
]);

/** Per-tier content. Every tier keeps the full composition; tiers trade detail, not layout. */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        cloudOctaves: 0,
        stars: true,
        shooting: false,
        seaTrains: 4,
        seaClouds: 0,
        swash: false,
        sandDetail: false,
        mirrorScale: 0,
        palms: 6,
        gulls: 3,
        strollers: 4,
        fireworks: 2000,
        stars0: 70,
        finale: 3,
    },
    Low: {
        cloudOctaves: 2,
        stars: true,
        shooting: true,
        seaTrains: 5,
        seaClouds: 0,
        mackerel: false,
        swash: true,
        sandDetail: false,
        mirrorScale: 0.25,
        palms: 10,
        gulls: 4,
        strollers: 6,
        fireworks: 2800,
        stars0: 90,
        finale: 4,
    },
    Medium: {
        cloudOctaves: 2,
        stars: true,
        shooting: true,
        seaTrains: 6,
        seaClouds: 2,
        swash: true,
        mirrorScale: 0.35,
        palms: 14,
        gulls: 5,
        strollers: 7,
        fireworks: 4200,
        stars0: 120,
        finale: 5,
    },
    High: {
        cloudOctaves: 3,
        stars: true,
        shooting: true,
        seaTrains: 8,
        seaClouds: 2,
        swash: true,
        mirrorScale: 0.5,
        palms: 20,
        gulls: 7,
        strollers: 10,
        fireworks: 6200,
        stars0: 150,
        finale: 6,
    },
    Ultra: {
        cloudOctaves: 3,
        stars: true,
        shooting: true,
        seaTrains: 8,
        seaClouds: 3,
        swash: true,
        mirrorScale: 0.5,
        palms: 24,
        gulls: 8,
        strollers: 12,
        fireworks: 7400,
        stars0: 170,
        finale: 7,
    },
    Extreme: {
        cloudOctaves: 3,
        stars: true,
        shooting: true,
        seaTrains: 8,
        seaClouds: 3,
        swash: true,
        mirrorScale: 0.6,
        palms: 28,
        gulls: 9,
        strollers: 14,
        fireworks: 8800,
        stars0: 200,
        finale: 8,
    },
});

export {
    EVENING, HOUR, eveningHour, eveningStops,
};

/** The evening's old measure at the sunset stop, where the walk sets out (the playground's dusk=). */
export const DUSK = Object.freeze({ rest: EVENING.restDusk });

/** The uniform each of tonight's colours is written into (SKY_KEYS, in order). */
export const SKY_UNIFORMS = Object.freeze({
    horizon0: 'skyHorizon0',
    horizon1: 'skyHorizon1',
    low0: 'skyLow0',
    low1: 'skyLow1',
    mid0: 'skyMid0',
    mid1: 'skyMid1',
    high: 'skyHigh',
    zenith: 'skyZenith',
    cloud0: 'cloud0',
    cloud1: 'cloud1',
    disc0: 'sunDisc0',
    disc1: 'sunDisc1',
    disc2: 'sunDisc2',
    warm: 'sunWarm',
    band: 'sunBand',
    glint: 'sunGlint',
});

/**
 * Heat lightning in the cumulus towers: the flickers of one flash (seconds after it starts,
 * strength), how wide a stretch of the bank it lights (rad) and the wait between flashes (s).
 */
export const LIGHTNING = Object.freeze({
    flickers: Object.freeze([[0.03, 0.6], [0.13, 1], [0.19, 0.45], [0.36, 0.8]]),
    flicker: 0.035,
    life: 0.6,
    waitMin: 2.6,
    waitSpread: 7,
});

/** The theme's piece palette (synthwave-sunset-tetrominos.js), for a lock's chase colour. */
export const PIECE_COLORS = Object.freeze(Object.fromEntries(['I', 'O', 'T', 'S', 'Z', 'J', 'L']
    .map((k) => [k, new THREE.Color(SYNTHWAVE_SUNSET_TETROMINOS.colors[k])])));

/** Gameplay boards carry data-player; the lobby's avatar cards reuse .player-card without it. */
export const BOARD_SELECTOR = '.player-card[data-player]';

/**
 * The visible gameplay boards' union rect in screen fractions (x0, y0, x1, y1; y down), or null.
 * A board inside a container hidden by an ANCESTOR's opacity/visibility still has a rect and its
 * own computed opacity is 1, so Element.checkVisibility (which walks the ancestors) decides
 * where available. DOM read: call on layout changes, never per frame.
 */
export function readBoardRect() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    const W = window.innerWidth || 1;
    const H = window.innerHeight || 1;
    let rect = null;
    document.querySelectorAll(BOARD_SELECTOR).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;
        if (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H) return;
        if (typeof el.checkVisibility === 'function'
            && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) return;
        const next = {
            x0: r.left / W, y0: r.top / H, x1: r.right / W, y1: r.bottom / H,
        };
        rect = rect ? {
            x0: Math.min(rect.x0, next.x0),
            y0: Math.min(rect.y0, next.y0),
            x1: Math.max(rect.x1, next.x1),
            y1: Math.max(rect.y1, next.y1),
        } : next;
    });
    return rect;
}

export function boardRectsDiffer(a, b) {
    if (!a || !b) return a !== b;
    return Math.abs(a.x0 - b.x0) > 0.004 || Math.abs(a.x1 - b.x1) > 0.004
        || Math.abs(a.y0 - b.y0) > 0.004 || Math.abs(a.y1 - b.y1) > 0.004;
}

/** Frame-rate independent approach factor for a rate (1/s). */
const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/**
 * Lock chases running round the wheel at once (a band meets at the top at 1.25 s, gone by 1.6 s:
 * four keep up with a lock every 0.3 s). A new lock takes the oldest band once it has started to
 * fade (CHASE_FADE); faster than that it joins the newest band (brighter, its colour blended)
 * instead of cutting one off halfway round.
 */
export const CHASE_SLOTS = 4;
const CHASE_FADE = 1.15;

/** Rim angles: the bottom of the wheel (where a lock's bands leave from) and its top. */
const RIM_BOTTOM = -Math.PI / 2;

/**
 * How far up the lift (0 foot .. 1 crest) a chain of `notch` links lifts the train: an eighth a
 * link to six, then ever closer to the crest (a twenty-chain still climbs where an eight-chain
 * stood).
 */
export function liftShare(notch) {
    const n = Math.max(0, notch);
    if (n <= 6) return n / 8;
    return 0.75 + 0.25 * (1 - Math.exp(-(n - 6) / 4));
}

/** Colours the reactions use (linear, from the fireworks' palette). */
const MINT = new THREE.Color(FIREWORK_COLORS[0]);
const PINK = new THREE.Color(FIREWORK_COLORS[1]);
const LEMON = new THREE.Color(FIREWORK_COLORS[2]);
const LILAC = new THREE.Color(FIREWORK_COLORS[3]);

/**
 * A hard drop's pulse along the pier: its strength at a full drop, its speed (pier lengths a
 * second: the land end to the wheel in under a second), its width (pier lengths) and the fall
 * (rows) that counts as a full drop.
 */
export const PULSE = Object.freeze({
    strength: 1.3, speed: 1.15, width: 0.06, fullDrop: 16,
});
/** Pulses running out along the pier at once. */
export const PULSE_SLOTS = 4;

/** The beams' slots: the back-to-back's lasers first, then the level's searchlights. */
export const LASER_SLOTS = 6;
export const SEARCH_SLOTS = 4;
export const BEAMS = Object.freeze({
    laserLength: 300, laserLevel: 1.15, searchLength: 330, searchLevel: 0.42,
});
const LASER_COLORS = [0xff5fa8, 0x7ff0d4, 0xc8a2ff, 0xffe46a, 0x6fd8ff, 0xff8a5c]
    .map((hex) => new THREE.Color(hex).multiplyScalar(1.5));
const SEARCH_COLOR = new THREE.Color(0xfff0d2);

/**
 * The figures a clear draws in the sky: the kinds a single line turns through, the kinds a pair
 * takes, the order of a finale's volley.
 */
const SINGLES = ['peony', 'pistil', 'chrys', 'crossette'];
const DOUBLES = ['pistil', 'ring', 'strobe'];
const FINALE = ['chrys', 'pistil', 'ring', 'crossette', 'peony', 'saturn', 'strobe', 'palm'];

/**
 * Where the pier's roman candles stand (metres from the wheel's end): the stretch a game shows
 * left of its board, and the short one beside the board's far side.
 */
export const CANDLES = Object.freeze({ far: Object.freeze([12, 74]), near: Object.freeze([128, 152]) });

/** The wheel's light programmes: how many, seconds each shows, the share of that it rests. */
export const WHEEL_SHOW = Object.freeze({ programmes: 5, seconds: 46, hold: 0.9 });

/** Chain lengths that send a shooting star over the bay. */
const SHOOT_MILESTONES = new Set([5, 8, 10, 12, 15, 20, 25, 30]);

/** CPU smoothstep on 0..1. */
const ease01 = (x) => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
};

export function createWorldUniforms() {
    const u = {
        time: uniform(0),
        /** The gulls' clock: the scene's, held back under reduced motion (they glide slower). */
        gullTime: uniform(0),
        sunDir: uniform(new THREE.Vector3(0, 0, -1)),
        sunRight: uniform(new THREE.Vector3(1, 0, 0)),
        sunUp: uniform(new THREE.Vector3(0, 1, 0)),
        /** The sun's bearing on the horizontal plane (x, z), unit length. */
        sunAz: uniform(new THREE.Vector2(0, -1)),
        sunRadius: uniform(Math.sin(SUN.radius)),
        sunTan: uniform(Math.tan(SUN.radius)),
        /** The evening's old measure: 0 = the golden hour, 1 = afterglow and night, the sun gone. */
        dusk: uniform(0),
        /** The golden hour (1) melting into the sunset (0). */
        gold: uniform(0),
        /** The daylight left on what stands in the scene (1 at the sunset's start, less by night). */
        ambient: uniform(1),
        /** The weather: how much (cirrus, mackerel sky, cumulus towers) the sky carries. */
        cloudCover: uniform(new THREE.Vector4(0.78, 0, 0, 0)),
        /** How far the stars are out, the moon's light, the evening star's, the night (0..1). */
        skyLights: uniform(new THREE.Vector4(0, 0, 1, 0)),
        /** The crescent moon's frame: its direction, toward the sun across its disc, and up. */
        moonDir: uniform(new THREE.Vector3(-0.13, 0.42, -0.9).normalize()),
        moonRight: uniform(new THREE.Vector3(1, 0, 0)),
        moonUp: uniform(new THREE.Vector3(0, 1, 0)),
        /** Heat lightning in the towers: (bearing rad, width rad, strength, 0). */
        bolt: uniform(new THREE.Vector4(0, 0.2, 0, 0)),
        /** How lively the sea runs (a scale on the swell's slopes; 1 = a light breeze). */
        seaState: uniform(1),
        /** The ferris wheel: its angle (rad), how bright its lights burn, the neon ring's hue. */
        wheelAngle: uniform(0),
        wheelGlow: uniform(1),
        /** The wheel's light programme: (the one showing, the one it turns to, how far, 0). */
        wheelShow: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The wheel's starburst: (start time, strength, 0, 0) and its colour. */
        wheelBurst: uniform(new THREE.Vector4(-1e6, 0, 0, 0)),
        wheelBurstCol: uniform(new THREE.Color(1, 1, 1)),
        /** How far the neon ring has turned from pink (0) to mint (1), and its colour (NEON_RING). */
        wheelNeonMix: uniform(0),
        wheelNeon: uniform(new THREE.Color(...NEON_RING[0])),
        /** The pier: how far its lights have come on (0..1, from the land end), how bright. */
        pierPower: uniform(1),
        pierGlow: uniform(1),
        /** The town round the bay: its windows, neon and house lights (0..1). */
        townLights: uniform(0.6),
        /** The midway's chase clock: the bulbs' chase programmes run on it, quicker as play heats. */
        chaseTime: uniform(0),
        /** The sea breeze on the palms (1 at rest). */
        breeze: uniform(1),
        /** The coaster: its lift meter (track parameter lit up to) and how hard it is riding. */
        coasterMeter: uniform(0),
        /** The meter's charge: how bright the lemon burns (0 dark, 1 a chain, more for a long one). */
        coasterCharge: uniform(0),
        coasterRide: uniform(0),
        coasterTrain: uniform(0),
        /** The ride's trail: its fall-off along the track (smaller is longer). */
        coasterTrail: uniform(34),
        /** The lift's foot on the track (set by the coaster from its circuit). */
        coasterFoot: uniform(0.12),
        /** Fireworks: overall level, Reduce flashing (1 = calm), the two sky glows. */
        fireworkLevel: uniform(1),
        fireworkCalm: uniform(0),
        burst0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        burst1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        burstCol0: uniform(new THREE.Color(1, 1, 1)),
        burstCol1: uniform(new THREE.Color(1, 1, 1)),
        shoot0A: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shoot0B: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shoot1A: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shoot1B: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
    for (let i = 0; i < CHASE_SLOTS; i += 1) {
        u[`chase${i}`] = uniform(new THREE.Vector4(-1e6, 0, 0, 0));
        u[`chaseCol${i}`] = uniform(new THREE.Color(1, 1, 1));
    }
    for (let i = 0; i < PULSE_SLOTS; i += 1) {
        u[`pulse${i}`] = uniform(new THREE.Vector4(-1e6, 0, 1, 0.05));
        u[`pulseCol${i}`] = uniform(new THREE.Color(1, 1, 1));
    }
    // Tonight's colours: the opening look (the sunset, the first temperament) until the world
    // writes its own (applyEvening).
    const opening = skyColours(eveningLook(EVENING.start), 0);
    for (const key of SKY_KEYS) {
        const [r, g, b] = opening[key];
        u[SKY_UNIFORMS[key]] = uniform(new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace));
    }
    return u;
}

export class SynthwaveWorld {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {string} [opts.quality='High']
     * @param {() => number} [opts.random]
     */
    constructor({ scene, quality = 'High', random = Math.random }) {
        this.scene = scene;
        this.qualityName = WORLD_QUALITY[quality] ? quality : 'High';
        this.q = WORLD_QUALITY[this.qualityName];
        this.rand = random;
        this.u = createWorldUniforms();
        this.root = new THREE.Group();
        this.root.name = 'SynthwaveWorld';
        this.time = 0;
        this.parts = {};

        // Composition state
        this.lens = { vfov: RIG.vfov, aspect: 16 / 9 };
        this.pitch = 0;
        this.yaw = 0;
        this.targetYaw = 0;
        this.yawSettled = false;
        this.board = null;

        // Sun frame (its bearing is fixed; it sinks with the evening)
        this.sunDir = new THREE.Vector3(0, 0, -1);
        this.sunUp = new THREE.Vector3(0, 1, 0);
        this.sunRight = new THREE.Vector3(1, 0, 0);
        /**
         * The evening: its hour along the walk (HOUR: 0 golden hour .. 3 night), what that looks
         * like (gold, dusk, night) and the light it gives the bay. `dusk` is the look's old
         * measure, kept for the gulls' roost and the tests.
         */
        this.hour = EVENING.start;
        this.look = eveningLook(EVENING.start);
        this.lights = eveningLights(this.look);
        this.dusk = this.look.dusk;
        /** The levels' steps along the evening's walk (hours), eased toward hourTarget. */
        this.hourSteps = 0;
        this.hourTarget = 0;
        /** An evening held still (the playground's hour= and dusk=): hourBase, whatever the clock. */
        this.hourBase = EVENING.start;
        this.hourHeld = false;
        /**
         * Tonight's colours, the weather and the sea, each on its own clock (a held value, the
         * playground's temper=, weather= and sea=, stands whatever the clock).
         */
        this.temper = 0;
        this.temperHeld = null;
        this.weather = weatherAt(0);
        this.weatherHeld = null;
        this.seaHeld = null;
        this._sky = {};
        this._moon = [0, 0, 0];
        this._v = new THREE.Vector3();
        /** Heat lightning: the flash in the air (its start, bearing and width) and the next one. */
        this.lightning = {
            t0: -1e6, az: 0, width: 0.2, next: 6,
        };
        /**
         * What play adds to the bay's lights this frame (updateSurge writes it, applyEvening folds
         * it in): the pier's light front, the bulbs' glow, the town's lights; and the wheel's extra
         * turn, the chase lights' pace and the breeze. All rest at 0 (1 for the paces).
         */
        this.bay = {
            power: 0, glow: 0, town: 0, spin: 0, chase: 1, breeze: 1,
        };
        this.setHour(EVENING.start);

        // Reactive state
        this.chases = Array.from({ length: CHASE_SLOTS }, () => ({ t0: -1e6, strength: 0 }));
        this.lastLockColor = new THREE.Color(FIREWORK_COLORS[0]);
        /** When each pulse along the pier set out (its slot gives way to a new one, oldest first). */
        this.pulses = new Array(PULSE_SLOTS).fill(-1e6);
        /** Which figure the next single and the next pair draw (they turn with each clear). */
        this.figures = { single: 0, double: 0 };
        /**
         * The beams: the back-to-back's lasers (their light, and how many the streak has lit)
         * and the level's searchlights, both accumulating swells; the clock they sweep on.
         */
        this.lasers = new Swell({
            attack: 0.25, release: 2.6, ceiling: 1.3, knee: 1.0,
        });
        this.laserCount = 2;
        this.search = new Swell({
            attack: 0.5, release: 3.4, ceiling: 1.2, knee: 0.95,
        });
        this.beamClock = 0;
        this.beamsLit = false;
        /**
         * The neon ring's colour walk: the clock turns it on to its other colour at every stop of
         * the evening, and each level turns it on once more (eased), never back.
         */
        this.neonTarget = 0;
        this.neonPhase = 0;
        this._neonRgb = [0, 0, 0];
        /**
         * The coaster. `notch` is the live chain; `meter`/`charge` what the lift shows (eased: it
         * drains, never snaps); on a ride `lap` counts the wraps of `laps`, `launch` is the crest
         * speed (m/s) and `trail` the trail's fall-off, both from the chain that sent it.
         */
        this.coaster = {
            mode: 'idle', t: 0, notch: 0, lap: 0, laps: 1, launch: 3, trail: 34, meter: 0, charge: 0, ride: 0,
        };
        this.bloomBoost = 0;
        /** The iris for the post stack (1 open): it closes a little as the bay blazes. */
        this.exposure = 1;
        this.shoots = [{ t0: -1e6, life: 1 }, { t0: -1e6, life: 1 }];
        /** Shooting stars waiting for a free slot (never one cut off mid-streak). */
        this.pendingShoots = 0;
        this.nextAmbientShoot = 12 + this.rand() * 18;
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js) on the world's clock, and its
         * reading this frame; the perfect clear's crown; a twist's whirl of the wheel.
         */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.crown = new Swell({
            attack: 0.3, release: 2.8, ceiling: 1.2, knee: 0.85,
        });
        this.spin = new Swell({
            attack: 0.12, release: 0.9, ceiling: 2.5, knee: 1.6,
        });
        /** Back-to-back difficult clears in a row (the salute grows with it). */
        this.b2bStreak = 0;
        /** The fever volley's next shell, and the fever's next shooting star. */
        this.nextVolleyAt = -1e6;
        this.nextFeverShoot = -1e6;
        this.nextQueuedShoot = -1e6;
        this.chaseClock = 0;

        this._camRest = new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        this._fwd = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._target = new THREE.Vector3();
    }

    build() {
        return drainSteps(this.buildSteps());
    }

    /**
     * The build as steps, a part or two to a step (the theme breathes between them:
     * shared/build-steps.js), the same work in the same order, drawing the same random numbers.
     * Built in one task, a first visit's held the switch's worst frame at ~45 ms (2026-10-31).
     */
    * buildSteps() {
        const { q, u, rand } = this;
        this.parts.sky = createSky(u, {
            cloudOctaves: q.cloudOctaves, stars: q.stars, shootingStars: q.shooting, mackerel: q.mackerel !== false,
        });
        this.parts.sea = createSea(u, {
            trains: q.seaTrains,
            clouds: q.seaClouds,
            swash: q.swash,
            mirrorScale: q.mirrorScale,
            sandDetail: q.sandDetail !== false,
            mackerel: q.mackerel !== false,
        });
        this.reflection = this.parts.sea.userData.reflection ?? null;
        if (this.reflection) this.root.add(this.reflection.target);
        this.parts.wheel = createWheel(u, { mirrorLayer: MIRROR_LAYER });
        yield 'sky, sea and wheel';
        this.parts.pier = createPier(u, { mirrorLayer: MIRROR_LAYER });
        yield 'pier';
        this.parts.coaster = createCoaster(u, { mirrorLayer: MIRROR_LAYER });
        yield 'coaster';
        this.parts.promenade = yield* createPromenadeSteps(u, { rand, mirrorLayer: MIRROR_LAYER });
        yield 'hotels';
        this.parts.palms = createPalms(u, { rand, count: q.palms });
        yield 'palms';
        this.parts.life = createLife(u, { strollers: q.strollers, mirrorLayer: MIRROR_LAYER });
        this.people = this.parts.life.userData.people;
        yield 'strollers and boats';
        this.gulls = new SynthwaveGulls(u, { count: q.gulls, mirrorLayer: MIRROR_LAYER });
        this.parts.gulls = this.gulls.group;
        this.fireworks = new Fireworks(u, { capacity: q.fireworks, rand, mirrorLayer: MIRROR_LAYER });
        // A bang startles the gulls (on their clock, which lags the world's under Reduce motion).
        // The people on the pier look up at it (on the same clock).
        this.fireworks.onBurst = (b) => {
            this.gulls?.hit(b.scale ?? 1, b.at - (this.gullLag ?? 0), this.motion ?? 1);
            this.people?.notice(b.pos, b.at - (this.gullLag ?? 0), b.scale ?? 1);
        };
        this.parts.fireworks = this.fireworks.mesh;
        this.beams = new Beams(u, { mirrorLayer: MIRROR_LAYER });
        this.parts.beams = this.beams.mesh;
        // Where the pier's own effects stand: its frame, the wheel's face (the hub in front of
        // the near rim, the plane's two axes and the axle) and the searchlights' feet on the deck.
        this.pierAt = pierFrame();
        const { wheel } = this.parts;
        wheel.updateMatrixWorld(true);
        const axle = new THREE.Vector3().setFromMatrixColumn(wheel.matrixWorld, 2).normalize();
        this.wheelFace = {
            ax: new THREE.Vector3().setFromMatrixColumn(wheel.matrixWorld, 0).normalize(),
            ay: new THREE.Vector3().setFromMatrixColumn(wheel.matrixWorld, 1).normalize(),
            axle,
            center: new THREE.Vector3().setFromMatrixPosition(wheel.matrixWorld).addScaledVector(axle, WHEEL.depth / 2 + 0.6),
        };
        this.searchFeet = [26, 62, 132, 150].map((along, i) => this.pierAt.at(along, (i % 2 ? -1 : 1) * 1.5, PIER.deckY + 1.4));
        this.track = this.parts.coaster.userData;
        this.coaster.t = this.track.marks.station;
        this.coaster.meter = this.track.marks.liftFoot;
        this.crestY = this.track.curve.getPointAt(this.track.marks.liftTop).y;
        this._trackPoint = new THREE.Vector3();
        for (const part of Object.values(this.parts)) {
            if (part) this.root.add(part);
        }
        this.scene.add(this.root);
        // The gulls' model comes when it comes: nothing waits for it (a capture may: `gullsReady`).
        this.gullsReady = loadGullGeometry().then((geometry) => {
            if (!geometry) return false;
            if (this.disposed || !this.gulls) {
                geometry.dispose();
                return false;
            }
            this.gulls.attach(geometry);
            return true;
        });
        // So do the people's figures (`peopleReady` for a capture).
        this.peopleReady = this.people?.count > 0 ? loadStrollerFigures().then((figures) => {
            if (!figures || this.disposed || !this.people) return false;
            return this.people.attach(figures);
        }) : Promise.resolve(false);
        return this;
    }

    /** The camera that renders the world: it sees the mirror layer, the reflection only that. */
    bindCamera(camera) {
        if (!camera) return;
        this._camera = camera;
        camera.layers.enable(MIRROR_LAYER);
        const virtual = this.reflection?.reflector?.getVirtualCamera?.(camera);
        if (virtual) virtual.layers.set(MIRROR_LAYER);
    }

    // ── The evening ──────────────────────────────────────────────────────────

    /**
     * Set the evening's hour (HOUR: 0 golden hour, 1 sunset, 2 afterglow, 3 night) at once; with
     * `hold` it stays there whatever the clock (the next frame otherwise takes it back to the
     * walk).
     */
    setHour(value, { hold = false } = {}) {
        const hour = THREE.MathUtils.clamp(Number.isFinite(Number(value)) ? Number(value) : EVENING.start, HOUR.gold, HOUR.night);
        this.hour = hour;
        this.hourBase = hour;
        if (hold) this.hourHeld = true;
        this.applyEvening();
    }

    /** Set the evening by its old measure (0 = the golden hour .. 1 = the afterglow). */
    setDusk(value, opts) {
        this.setHour(hourOfDusk(Number(value) || 0), opts);
    }

    /**
     * Where the evening's walk stands at `time`: the clock's walk there and back plus the levels'
     * steps along it, as an hour (or the hour it is held at).
     * @param {number} time
     */
    hourAt(time) {
        return this.hourHeld ? this.hourBase : eveningHour(this.hourSteps, time);
    }

    /** The evening's old measure at `time` (the gulls' roost reads it ahead and behind). */
    duskAt(time) {
        this._lookAt ??= { gold: 0, dusk: 0, night: 0 };
        return eveningLook(this.hourAt(time), this._lookAt).dusk;
    }

    /**
     * Write the evening into the uniforms: the sun's height (it stands in the wheel's hub at the
     * golden hour, sits on the sea at the sunset and is gone by the afterglow), tonight's
     * colours, the bay's lights with what play adds to them, the stars and the moon.
     */
    applyEvening() {
        const { u } = this;
        const look = eveningLook(this.hour, this.look);
        const { dusk, gold, night } = look;
        this.dusk = dusk;
        u.dusk.value = dusk;
        u.gold.value = gold;
        const lift = SUN.lift + (SUN.setLift - SUN.lift) * dusk ** 1.15 + (SUN.goldLift - SUN.lift) * gold;
        const elev = SUN.radius * lift;
        this.sunDir.set(0, Math.sin(elev), -Math.cos(elev));
        this.sunUp.set(0, Math.cos(elev), Math.sin(elev));
        u.sunDir.value.copy(this.sunDir);
        u.sunUp.value.copy(this.sunUp);
        u.sunRight.value.copy(this.sunRight);
        u.sunAz.value.set(this.sunDir.x, this.sunDir.z).normalize();

        const sky = skyColours(look, this.temper, this._sky);
        for (const key of SKY_KEYS) {
            const c = sky[key];
            u[SKY_UNIFORMS[key]].value.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
        }

        // The pier lights come on from the land end as the evening deepens; the town too. Play
        // powers them up ahead of the evening (this.bay: 0 at rest and under casual play).
        const L = eveningLights(look, this.lights);
        const { bay } = this;
        u.pierPower.value = THREE.MathUtils.clamp(L.power + bay.power, 0, 1);
        u.wheelGlow.value = L.glow * (1 + bay.glow);
        u.pierGlow.value = L.glow * (1 + bay.glow * 0.8);
        u.townLights.value = Math.min(1.35, L.town + bay.town);
        u.ambient.value = L.ambient;
        // The evening star is the first light out and is gone in the golden hour's bright sky.
        u.skyLights.value.set(L.stars, L.moon, (0.9 + dusk * 1.6) * (1 - gold) ** 2, night);

        // The moon: its horns turn from the sun, so "right" across its disc is toward the sun.
        const m = moonDirection(look, this._moon);
        u.moonDir.value.set(m[0], m[1], m[2]);
        const right = this._v.copy(this.sunDir).addScaledVector(u.moonDir.value, -this.sunDir.dot(u.moonDir.value));
        if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
        u.moonRight.value.copy(right.normalize());
        u.moonUp.value.crossVectors(u.moonDir.value, u.moonRight.value).normalize();
    }

    // ── Composition ─────────────────────────────────────────────────────────

    /** Vertical FOV (deg) of the Hor+ lens for an aspect. */
    static verticalFov(aspect) {
        const a = Math.max(0.1, aspect || 16 / 9);
        const capped = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(RIG.hFovCap) / 2) / a);
        return Math.min(RIG.vfov, THREE.MathUtils.radToDeg(capped));
    }

    /** Screen x (fraction from the left) of the sun for a camera yaw. */
    sunScreenX(yaw) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2);
        const cp = Math.cos(this.pitch);
        const sp = Math.sin(this.pitch);
        const d = this.sunDir;
        const fx = Math.sin(yaw) * cp;
        const fy = sp;
        const fz = -Math.cos(yaw) * cp;
        const rx = Math.cos(yaw);
        const rz = Math.sin(yaw);
        const depth = d.x * fx + d.y * fy + d.z * fz;
        const side = d.x * rx + d.z * rz;
        const ndc = side / Math.max(1e-4, depth) / (tanV * this.lens.aspect);
        return ndc * 0.5 + 0.5;
    }

    /**
     * Solve the lens, pitch and target yaw for an aspect and the board rect (screen fractions,
     * or null when no board is on screen).
     */
    setLayout(aspect, board = null, { immediate = false } = {}) {
        this.lens.aspect = Math.max(0.1, aspect || 16 / 9);
        this.lens.vfov = SynthwaveWorld.verticalFov(this.lens.aspect);
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2);
        this.pitch = Math.atan((2 * RIG.horizonFrac - 1) * tanV);
        this.board = board;

        // The sun in the middle of the free zone left of the board; centred with no board.
        let targetX = 0.5;
        if (board && board.x0 > 0.16) targetX = THREE.MathUtils.clamp(board.x0 * 0.5, 0.12, 0.34);
        let lo = -1.25;
        let hi = 1.25;
        for (let i = 0; i < 40; i += 1) {
            const mid = (lo + hi) / 2;
            // sunScreenX decreases as the camera yaws right (the sun slides left).
            if (this.sunScreenX(mid) > targetX) lo = mid;
            else hi = mid;
        }
        this.targetYaw = (lo + hi) / 2;
        if (immediate || !this.yawSettled) {
            this.yaw = this.targetYaw;
            this.yawSettled = true;
        }
    }

    /** Camera: eased yaw, the rest pose, a slow drift and pointer parallax. */
    updateCamera(camera, sim) {
        const dt = sim.delta ?? 0;
        // Reduced motion (Settings or the system) eases the camera to rest; update() reads the
        // same factor for the rest of the scene.
        this.motionState ??= {};
        const motion = easedMotion(this.motionState, dt);
        this.motion = motion;
        this.yaw += (this.targetYaw - this.yaw) * approach(1.4, dt);
        if (camera.fov !== this.lens.vfov || camera.aspect !== this.lens.aspect) {
            camera.fov = this.lens.vfov;
            camera.aspect = this.lens.aspect;
            camera.updateProjectionMatrix();
        }
        const t = sim.time ?? this.time;
        const cp = Math.cos(this.pitch);
        this._fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
        this._right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
        const driftX = (Math.sin(t * 0.031) * 0.7 + Math.sin(t * 0.017 + 1.3) * 0.35) * motion;
        const driftY = Math.sin(t * 0.023 + 0.7) * 0.18 * motion;
        const px = (sim.pointerX ?? 0) * 1.2 * motion;
        const py = -(sim.pointerY ?? 0) * 0.4 * motion;
        camera.position.copy(this._camRest)
            .addScaledVector(this._right, driftX + px);
        camera.position.y += driftY + py;
        // A distant look target: the far scene (sun, wheel) stays put, the near palms parallax.
        this._target.copy(this._camRest).addScaledVector(this._fwd, 1500);
        camera.lookAt(this._target);
        // The shared breath (shared/camera-breath.js) on top of the drift above, turning the
        // view only (the look target is a far direction marker), on the same ease.
        applyCameraBreath(camera, t, { scale: motion });
        camera.updateMatrixWorld();
    }

    /** Sun position in screen UV (x right, y DOWN) + a 0..1 on-screen weight, for the post. */
    getSunScreen(camera, out) {
        this._tmp.copy(camera.position).addScaledVector(this.sunDir, 2000).project(camera);
        const x = this._tmp.x * 0.5 + 0.5;
        const y = 0.5 - this._tmp.y * 0.5;
        const inFront = this._tmp.z < 1 ? 1 : 0;
        const edge = Math.min(x + 0.15, 1.15 - x, y + 0.15, 1.15 - y);
        out.set(x, y);
        return inFront * THREE.MathUtils.clamp(edge / 0.15, 0, 1);
    }

    // ── Per frame ────────────────────────────────────────────────────────────

    update(sim) {
        const t = sim.time ?? 0;
        const dt = sim.delta ?? 0;
        this.time = t;
        const { u } = this;
        u.time.value = t;
        const motion = this.motion ?? 1;

        // How hot play runs, and what the bay makes of it (applyEvening folds it into the lights).
        this.updateSurge(t);
        const { bay } = this;

        // The wheel turns on the clock (a seek lands right); reduced motion slows it to a crawl,
        // play turns it faster and a twist whirls it (all through the lag: it never jumps).
        this.wheelLag = (this.wheelLag ?? 0) + dt * ((1 - motion) * 0.85 - bay.spin * motion);
        u.wheelAngle.value = ((t - this.wheelLag) * (Math.PI * 2)) / WHEEL.period;
        this.gullLag = (this.gullLag ?? 0) + dt * (1 - motion) * 0.6;
        u.gullTime.value = t - this.gullLag;
        // The neon ring walks on to its next colour (pink, mint, pink…), never back: at every stop
        // of the evening's walk, and once more for each level.
        this.neonPhase += (this.neonTarget - this.neonPhase) * approach(0.8, dt);
        if (Math.abs(this.neonTarget - this.neonPhase) < 1e-4) this.neonPhase = this.neonTarget;
        const neon = 0.5 - 0.5 * Math.cos(Math.PI * (this.neonPhase + eveningStops(t)));
        u.wheelNeonMix.value = neon;
        // Round the colour wheel through blue-violet (NEON_RING[1]): a straight mix of pink and
        // mint is a pale grey-white, and the clock's turn lingers between them for a minute.
        const half = neon * 2;
        const rgbNeon = half <= 1
            ? meltColour(NEON_RING[0], NEON_RING[1], half, this._neonRgb)
            : meltColour(NEON_RING[1], NEON_RING[2], half - 1, this._neonRgb);
        u.wheelNeon.value.setRGB(rgbNeon[0], rgbNeon[1], rgbNeon[2], THREE.LinearSRGBColorSpace);
        // The chase lights run on their own clock, quicker with play (not under reduced motion);
        // the breeze on the palms freshens with it.
        this.chaseClock += dt * (1 + (bay.chase - 1) * motion);
        u.chaseTime.value = this.chaseClock;
        u.breeze.value = 1 + (bay.breeze - 1) * motion;

        // The evening walks by the clock in every mode; a level's step eases in on top. Tonight's
        // colours, the weather and the sea turn on clocks of their own.
        this.hourSteps += (this.hourTarget - this.hourSteps) * approach(0.6, dt);
        if (Math.abs(this.hourTarget - this.hourSteps) < 1e-5) this.hourSteps = this.hourTarget;
        this.hour = this.hourAt(t);
        this.temper = this.temperHeld ?? temperamentPhase(t);
        this.applyEvening();
        weatherAt(this.weatherHeld ?? weatherPhase(t), this.weather);
        u.cloudCover.value.set(this.weather.cirrus, this.weather.mackerel, this.weather.towers, 0);
        u.seaState.value = this.seaHeld ?? seaStateAt(t);
        this.updateLightning(t);
        // The gulls go to roost as the evening runs out (and come back when it turns back).
        this.gulls?.update(u.gullTime.value, this.dusk, (time) => this.duskAt(time + this.gullLag));
        // The people walk on the same clock (they slow with the gulls under reduced motion).
        this.people?.update(u.gullTime.value);

        this.updateCoaster(dt, motion);
        this.updateBeams(t, dt, motion);
        // The wheel's light programme turns by the clock (the classic first: the opening look).
        const show = wheelAt(moodDrift(t, WHEEL_SHOW.seconds, WHEEL_SHOW.hold), WHEEL_SHOW.programmes, this._show ??= { a: 0, b: 0, melt: 0 });
        u.wheelShow.value.set(show.a, show.b, show.melt, 0);

        // Fireworks: bursts arriving, the sky glows round them (held back under Reduce flashing).
        this.fireworks.update(t);
        const calm = prefersReducedFlashing();
        u.fireworkCalm.value = calm ? 1 : 0;
        u.fireworkLevel.value = calm ? 0.6 : 1;
        const flash = flashScale();
        this.fireworks.writeGlows(t, flash);
        const w0 = u.burst0.value.w;
        const w1 = u.burst1.value.w;
        // The bloom swells with the sky's gathered glow and a little with the heat of play; the
        // iris closes about as much, so the bay's colours stay saturated and the dusk stays deep.
        this.bloomBoost = Math.max(w0, w1) * 0.45 + (w0 + w1) * 0.1
            + bay.hot * 0.05 + bay.fever * 0.08 + (bay.crown * 0.15 + this.heat.punch * 0.08) * flash;
        this.exposure = 1 - bay.hot * 0.03 - bay.fever * 0.05 - bay.crown * 0.05 * flash
            - Math.min(0.05, (w0 + w1) * 0.02);

        // Shooting stars: now and then, on chain milestones and through a fever. A star waits for
        // a free slot rather than cutting one off mid-streak.
        const still = prefersReducedMotion();
        if (this.q.shooting && t >= this.nextAmbientShoot && !still) {
            this.nextAmbientShoot = this.spawnShootingStar(0.7) ? t + 22 + this.rand() * 30 : t + 1;
        }
        if (this.pendingShoots > 0) {
            if (still || !this.q.shooting) this.pendingShoots = 0;
            else if (t >= this.nextQueuedShoot && this.spawnShootingStar(1)) {
                this.pendingShoots -= 1;
                this.nextQueuedShoot = t + 0.4;
            }
        }
        this.shoots.forEach((s, i) => {
            const age = t - s.t0;
            const B = i === 0 ? u.shoot0B : u.shoot1B;
            if (age < 0 || age > s.life) {
                B.value.z = 0;
                return;
            }
            const fade = Math.min(1, age / 0.12) * (1 - THREE.MathUtils.smoothstep(age, s.life * 0.6, s.life));
            B.value.set(age, s.len, s.intensity * fade, 0);
        });
    }

    /**
     * Heat lightning: once the evening is dark enough and a bank of towers stands on the horizon,
     * a flash now and then flickers inside it, somewhere along the bank (left of the sunset, or
     * round to the right of it). Silent, far away, and held back under Reduce flashing.
     */
    updateLightning(t) {
        const li = this.lightning;
        const dark = THREE.MathUtils.smoothstep(this.dusk, 0.45, 0.9);
        const stand = this.weather.towers * dark;
        if (stand > 0.35 && t >= li.next) {
            const r = this.rand;
            li.t0 = t;
            li.az = r() < 0.6 ? -(0.22 + r() * 0.5) : 0.24 + r() * 0.9;
            li.width = 0.07 + r() * 0.09;
            li.next = t + LIGHTNING.waitMin + r() * LIGHTNING.waitSpread;
        }
        const age = t - li.t0;
        let level = 0;
        if (age >= 0 && age < LIGHTNING.life) {
            if (prefersReducedFlashing()) {
                // One soft swell in place of the flickers.
                const k = (age - LIGHTNING.life * 0.4) / (LIGHTNING.life * 0.3);
                level = Math.exp(-k * k) * 0.6;
            } else {
                for (const [at, strength] of LIGHTNING.flickers) {
                    const k = (age - at) / LIGHTNING.flicker;
                    level = Math.max(level, strength * Math.exp(-k * k));
                }
            }
        }
        this.u.bolt.value.set(li.az, li.width, level * stand * flashScale(), 0);
    }

    /**
     * How hot play runs, made into the bay (this.bay, folded into the lights by applyEvening). All of
     * it rests at nothing under casual play, so the evening looks as it always did:
     *   warm   the pier powers up ahead of the evening: its light front races out to the wheel,
     *          the bulbs burn brighter, the hotels switch more rooms on, the chases quicken;
     *   hot    the wheel turns faster, the sea breeze stirs the palms, the shells grow;
     *   fever  the midway at full blaze: the barge fires a volley of its own between the player's
     *          shells, shooting stars cross the bay;
     *   crown  a perfect clear lifts it all to full blaze for a few seconds.
     * Every hit's punch makes the bulbs throb a little (riding on a floor under rapid locks).
     */
    updateSurge(t) {
        const heat = this.surge.sample(t);
        const H = this.heat;
        H.punch = heat.punch;
        H.level = heat.level;
        H.fever = heat.fever;
        H.stage = heat.stage;
        const { fever } = heat;
        const warm = ease01((heat.level - 0.12) / 0.43);
        const hot = ease01((heat.level - 0.45) / 0.45);
        const crown = this.crown.valueAt(t);
        const kick = heat.punch * flashScale();
        const { bay } = this;
        bay.warm = warm;
        bay.hot = hot;
        bay.fever = fever;
        bay.crown = crown;
        bay.power = 0.6 * warm + 0.4 * fever + crown;
        bay.glow = 0.1 * warm + 0.1 * hot + 0.14 * fever + 0.15 * crown + 0.12 * kick;
        bay.town = 0.3 * warm + 0.15 * hot + 0.2 * fever + 0.3 * crown;
        bay.spin = 0.7 * warm + 1.1 * hot + 1.8 * fever + 7 * this.spin.valueAt(t);
        bay.chase = 1 + 0.9 * warm + 1.1 * hot + 1.4 * fever + crown;
        bay.breeze = 1 + 0.5 * warm + 0.4 * hot + 0.6 * fever;
        this.feverVolley(t, fever);
        if (fever > 0.5 && t >= this.nextFeverShoot) {
            this.queueShootingStars(1);
            this.nextFeverShoot = t + 2.2 + this.rand() * 1.6;
        }
    }

    /**
     * The fever's volley: the barge fires shells of its own between the player's, quicker the
     * hotter the fever (halved under reduced motion), as a display builds to its finale.
     */
    feverVolley(t, fever) {
        if (fever < 0.3) {
            this.nextVolleyAt = Math.max(this.nextVolleyAt, t + 0.3);
            return;
        }
        if (t < this.nextVolleyAt) return;
        const r = this.rand;
        const reduced = (this.motion ?? 1) < 0.5;
        const kinds = ['chrys', 'ring', 'pistil', 'crackle', 'saturn', 'strobe', 'willow'];
        const kind = kinds[Math.floor(r() * kinds.length)];
        const stars = Math.round(this.q.stars0 * (reduced ? 0.6 : 1) * 0.8);
        this.fireworks.launch(t, {
            kind,
            color: new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]),
            scale: 0.95 + 0.25 * fever,
            stars,
            high: 0.4 * r(),
        });
        const gap = THREE.MathUtils.lerp(1.3, 0.55, Math.min(1, fever)) * (reduced ? 2 : 1);
        this.nextVolleyAt = t + gap * (0.8 + 0.4 * r());
    }

    /**
     * The coaster: on the lift it climbs to the notch its chain has earned; released, a tyre
     * drive takes it over the crest and it rides the circuit on its own speed (energy from the
     * crest's height and its launch, which a longer chain makes faster), brakes on the return and
     * rolls into the station, having gone round once (twice from a ten-chain).
     *
     * The lift's meter is lit from the foot up to the train while a chain lifts it; a chain built
     * during a ride charges the lift ahead of the train (which climbs it on its return); a chain
     * that let go drains down the lift and fades instead of going dark in one frame.
     */
    updateCoaster(dt, motion) {
        const c = this.coaster;
        const { curve, marks } = this.track;
        if (!curve || !marks) return;
        const length = curve.getLength();
        const pace = 0.5 + 0.5 * motion;
        const notchT = marks.liftFoot + (marks.liftTop - marks.liftFoot) * liftShare(c.notch);
        const climb = (3.2 * pace * dt) / length;
        let ride = 0;
        if (c.mode === 'lift' || c.mode === 'idle') {
            const target = c.mode === 'lift' ? notchT : marks.station;
            c.t += THREE.MathUtils.clamp(target - c.t, -climb, climb);
        } else if (c.mode === 'ride') {
            // Home: past its last wrap, rolling round the last turn into the station.
            const home = c.lap >= c.laps;
            let v;
            if (!home && c.t < marks.liftTop) {
                v = 5 * pace; // the tyre drive up to the crest
            } else {
                const h = curve.getPointAt(c.t, this._trackPoint).y;
                v = Math.sqrt(Math.max(0, 2 * 9.81 * (this.crestY - h)) + c.launch * c.launch) * pace;
                // The brakes on the return, then a slow roll round the last turn into the station.
                if (home || c.t >= marks.returnStart) v = Math.min(v, 8 * pace);
                if (home) v = Math.min(v, 3.5 * pace);
            }
            c.t += (v * dt) / length;
            if (c.t >= 1) {
                c.t -= 1;
                c.lap += 1;
            }
            ride = Math.min(1, v / 18);
            if (c.lap >= c.laps && c.t >= marks.station) {
                c.t = marks.station;
                // A chain built during the ride: the train climbs the lift it charged.
                c.mode = c.notch > 0 ? 'lift' : 'idle';
            }
        }
        // The ride's light eases in and out (it never starts at full strength in one frame).
        c.ride += (ride - c.ride) * approach(c.mode === 'ride' ? 4 : 1.5, dt);

        const rest = marks.liftFoot - 0.012;
        if (c.notch > 0) {
            if (c.mode === 'lift') c.meter = Math.max(c.t, Math.min(c.meter, notchT));
            else c.meter += THREE.MathUtils.clamp(notchT - c.meter, -climb, climb);
        } else {
            c.meter += (rest - c.meter) * approach(1.4, dt);
        }
        // A long chain's lemon burns brighter than a short one's.
        const charge = c.notch > 0 ? Math.min(1.6, 1 + Math.max(0, c.notch - 6) * 0.06) : 0;
        c.charge += (charge - c.charge) * approach(c.notch > 0 ? 4 : 1.5, dt);

        this.u.coasterMeter.value = c.meter;
        this.u.coasterCharge.value = c.charge;
        this.u.coasterRide.value = c.ride;
        this.u.coasterTrail.value = c.trail;
        this.u.coasterTrain.value = c.t;
        this.track.placeTrain(c.t);
    }

    /**
     * Seek (deterministic captures): no events in flight, the train at the station, the evening
     * where the clock alone has walked it (or where it is held) with no level's step on top and
     * the neon ring on the clock's colour (a capture replays its events on every frame), play cold.
     */
    seek(time) {
        this.time = time;
        this.u.time.value = time;
        this.u.gullTime.value = time - (this.gullLag ?? 0);
        this.gulls?.seek();
        this.people?.seek();
        this.surge.reset();
        this.crown.reset();
        this.spin.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        Object.assign(this.bay, {
            power: 0, glow: 0, town: 0, spin: 0, chase: 1, breeze: 1, warm: 0, hot: 0, fever: 0, crown: 0,
        });
        this.b2bStreak = 0;
        this.nextVolleyAt = -1e6;
        this.nextFeverShoot = -1e6;
        this.chaseClock = time;
        this.lasers.reset();
        this.search.reset();
        this.laserCount = 2;
        this.beamClock = time;
        this.beams?.clear();
        this.beamsLit = false;
        this.figures.single = 0;
        this.figures.double = 0;
        this.pulses.fill(-1e6);
        for (let i = 0; i < PULSE_SLOTS; i += 1) this.u[`pulse${i}`].value.set(-1e6, 0, 1, 0.05);
        this.u.wheelBurst.value.set(-1e6, 0, 0, 0);
        this.u.chaseTime.value = time;
        this.hourSteps = 0;
        this.hourTarget = 0;
        this.hour = this.hourAt(time);
        this.temper = this.temperHeld ?? temperamentPhase(time);
        this.applyEvening();
        this.lightning.t0 = -1e6;
        this.lightning.next = time + 3 + this.rand() * LIGHTNING.waitSpread;
        this.u.bolt.value.z = 0;
        this.neonTarget = 0;
        this.neonPhase = 0;
        this.chases.forEach((ch, i) => {
            ch.t0 = -1e6;
            ch.strength = 0;
            this.u[`chase${i}`].value.set(-1e6, 0, 0, 0);
        });
        const c = this.coaster;
        c.mode = 'idle';
        c.t = this.track?.marks?.station ?? 0;
        c.notch = 0;
        c.lap = 0;
        c.laps = 1;
        c.meter = (this.track?.marks?.liftFoot ?? 0) - 0.012;
        c.charge = 0;
        c.ride = 0;
        this.u.coasterMeter.value = c.meter;
        this.u.coasterCharge.value = 0;
        this.u.coasterRide.value = 0;
        this.shoots.forEach((s) => { s.t0 = -1e6; });
        this.pendingShoots = 0;
        this.nextAmbientShoot = time + 12 + this.rand() * 18;
        this.fireworks?.clear();
        this.track?.placeTrain?.(c.t);
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * A piece locked: two bands of its colour run round the wheel's rims from its column's side
     * (left columns start left of the bottom, right columns right of it) and meet at the top. A
     * hard drop is the pier's as well: a pulse of the piece's colour runs out along the pier's
     * lights from the land to the wheel, brighter the further the piece fell, and its bands on
     * the rims burn brighter.
     */
    onPieceLock(piece, { hardDrop = false, distance = 0 } = {}) {
        const color = (() => {
            if (typeof piece?.color === 'string' || typeof piece?.color === 'number') {
                try {
                    return new THREE.Color(piece.color);
                } catch {
                    return null;
                }
            }
            return null;
        })() ?? PIECE_COLORS[piece?.type] ?? PIECE_COLORS.T;
        this.lastLockColor.copy(color);
        const column = Number.isFinite(piece?.x) ? THREE.MathUtils.clamp(piece.x + 1, 0, 9) : this.rand() * 9;
        const start = RIM_BOTTOM + ((column - 4.5) / 4.5) * 0.7;
        this.runChase(start, color, hardDrop ? 1.25 : 1);
        if (hardDrop) {
            const fall = THREE.MathUtils.clamp((Number(distance) || 0) / PULSE.fullDrop, 0, 1);
            this.runPulse(color, PULSE.strength * (0.55 + 0.45 * fall), PULSE.speed, PULSE.width);
        }
        this.surge.lock({ hardDrop }, this.time);
    }

    /**
     * Send two bands round the rims from `start`. The oldest band gives way once it has begun to
     * fade; while every band is still running, the newest takes this one in (brighter, its colour
     * blended), so rapid locks build the light instead of cutting a band off halfway round.
     */
    runChase(start, color, strength = 1) {
        const now = this.time;
        let oldest = 0;
        let newest = 0;
        for (let i = 1; i < CHASE_SLOTS; i += 1) {
            if (this.chases[i].t0 < this.chases[oldest].t0) oldest = i;
            if (this.chases[i].t0 > this.chases[newest].t0) newest = i;
        }
        if (now - this.chases[oldest].t0 >= CHASE_FADE) {
            const ch = this.chases[oldest];
            ch.t0 = now;
            ch.strength = strength;
            this.u[`chase${oldest}`].value.set(now, start, strength, 0);
            this.u[`chaseCol${oldest}`].value.copy(color);
            return;
        }
        const ch = this.chases[newest];
        this.u[`chaseCol${newest}`].value.lerp(color, strength / (ch.strength + strength));
        ch.strength = Math.min(2.2, ch.strength + strength * 0.5);
        this.u[`chase${newest}`].value.z = ch.strength;
    }

    /**
     * Send a pulse of light out along the pier, from the land end to the wheel: `speed` in pier
     * lengths a second, `width` in pier lengths. The pulse furthest along gives way to a new one
     * (it is at the wheel by then), so rapid hard drops follow each other down the pier.
     */
    runPulse(color, strength, speed = PULSE.speed, width = PULSE.width) {
        let oldest = 0;
        for (let i = 1; i < PULSE_SLOTS; i += 1) {
            if (this.pulses[i] < this.pulses[oldest]) oldest = i;
        }
        this.pulses[oldest] = this.time;
        this.u[`pulse${oldest}`].value.set(this.time, strength, speed, width);
        this.u[`pulseCol${oldest}`].value.copy(color);
    }

    /** The wheel's starburst: a ring of `color` bursts from the hub out to the rim. */
    flareWheel(color, strength = 1) {
        this.u.wheelBurst.value.set(this.time, strength * flashScale(), 0, 0);
        this.u.wheelBurstCol.value.copy(color);
    }

    /**
     * Lines cleared (one call per cascade wave). Each count has its own figure in the sky:
     *   one line     one shell in the locking piece's colour, its kind turning with each clear
     *   two lines    a pair of the same kind bursting together, side by side
     *   three lines  a fan: two chrysanthemums low, then a gold palm above them
     *   four lines   the finale: a volley across the whole free sky, each shell higher than the
     *                last, closed by a gold brocade crown, while the wheel's face bursts in gold
     * The show has memory: the chain (`combo`), the wave's depth and the heat of play add shells,
     * size and stars and tighten the volley, and each wave bursts higher and fuller than the
     * last. A cascade's later waves are the pier's too: roman candles fire from its deck, more
     * the deeper the wave. A twist turns the wheel into a Catherine wheel; a back-to-back fires
     * the salute and lights the lasers.
     * @param {number} [lines]
     * @param {{ cascade?: number, combo?: number, twist?: boolean, b2b?: boolean }} [info]
     */
    onLineClear(lines = 1, {
        cascade = 1, combo = 0, twist = false, b2b = false,
    } = {}) {
        const n = Math.max(1, Math.min(4, lines | 0));
        const depth = Math.max(1, cascade | 0);
        const t = this.time;
        const fw = this.fireworks;
        const r = this.rand;
        this.surge.clear({
            lines: n, cascade: depth, combo, twist, b2b,
        }, t);
        const { level } = this.heat;
        const reduced = (this.motion ?? 1) < 0.5;
        const wave = Math.min(depth - 1, 4);
        const chain = Math.max(0, (combo | 0) - 1);
        const stars = Math.round(this.q.stars0 * (reduced ? 0.6 : 1) * (1 + 0.25 * level + 0.05 * wave));
        const high = wave * 0.22;
        const pick = () => new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]);
        if (b2b) this.b2bStreak += 1;
        else if (depth === 1 && n < 4 && !twist) this.b2bStreak = 0;
        if (twist) this.catherine(n);
        const lead = twist ? LILAC : this.lastLockColor;
        if (n < 4) {
            const scale = 0.85 + n * 0.08 + 0.12 * level + 0.06 * wave;
            const gap = 0.32 - 0.1 * level;
            if (n === 1) {
                const kind = twist ? 'saturn' : SINGLES[this.figures.single % SINGLES.length];
                this.figures.single += 1;
                fw.launch(t, {
                    color: lead, kind, scale, stars, high,
                });
            } else if (n === 2) {
                const kind = twist ? 'saturn' : DOUBLES[this.figures.double % DOUBLES.length];
                this.figures.double += 1;
                const x = (r() - 0.5) * 0.5;
                for (const side of [-1, 1]) {
                    fw.launch(t, {
                        color: side < 0 ? lead : pick(), kind, scale, stars, high, x: x + side * 0.17, rise: 1.2,
                    });
                }
            } else {
                const x = (r() - 0.5) * 0.36;
                for (const side of [-1, 1]) {
                    fw.launch(t, {
                        color: side < 0 ? lead : pick(), kind: 'chrys', scale, stars, high, x: x + side * 0.23, rise: 1.1,
                    });
                }
                fw.launch(t, {
                    color: twist ? LILAC : WILLOW_GOLD,
                    kind: 'palm',
                    scale: scale * 1.15,
                    stars,
                    high: Math.min(1, high + 0.55),
                    x,
                    rise: 1.45,
                });
            }
            // The chain and the cascade add shells to the volley (none to a plain clear): a
            // cascade's deeper waves always fire more than its first, however long the chain.
            const extra = reduced ? 0 : Math.min(3, Math.floor(chain / 3)) + Math.min(wave, 2);
            for (let k = 0; k < extra; k += 1) {
                let kind = k % 2 ? 'crackle' : 'chrys';
                if (chain >= 5 && k === extra - 1) kind = 'willow';
                fw.launch(t, {
                    color: pick(),
                    kind,
                    scale,
                    delay: 0.35 + k * gap,
                    stars: kind === 'willow' ? Math.round(stars * 1.2) : stars,
                    high,
                });
            }
        } else {
            // The finale: a volley over a second and a half (fuller and quicker as play heats)
            // across the whole free sky, each shell higher than the last, then the crown.
            const shells = reduced ? Math.min(3, this.q.finale) : this.q.finale + Math.round(level * 2);
            const gap = 0.24 - 0.06 * level;
            for (let k = 0; k < shells; k += 1) {
                fw.launch(t, {
                    color: k === 0 ? lead : pick(),
                    kind: FINALE[k % FINALE.length],
                    scale: 1.05 + r() * 0.2 + 0.1 * level,
                    delay: k * gap,
                    stars,
                    high: Math.min(1, high + (0.4 * k) / shells),
                    x: ((k * 0.618 + 0.3) % 1) - 0.5,
                });
            }
            fw.launch(t, {
                kind: 'brocade',
                color: WILLOW_GOLD,
                scale: 1.45,
                delay: shells * gap + 0.2,
                stars: Math.round(stars * 1.3),
                high: 1,
                x: (r() - 0.5) * 0.3,
            });
            this.flareWheel(WILLOW_GOLD, 1.2);
        }
        if (b2b) this.salute(stars);
        // Each cascade wave past the first sends a band round the rims, brighter the deeper, and
        // fires the pier's roman candles.
        if (wave > 0) {
            this.runChase(RIM_BOTTOM, this.lastLockColor, 1 + 0.25 * wave);
            this.candles(wave);
        }
    }

    /**
     * A twist: the wheel whirls round and throws sparks off its rim like a Catherine wheel, lilac
     * and gold, and a lilac band runs round the rims. With lines it whirls harder and longer.
     * @param {number} lines the lines the twist cleared (0: none)
     */
    catherine(lines) {
        const t = this.time;
        const big = lines > 0;
        this.spin.hit(big ? 1 : 0.5, t);
        this.runChase(RIM_BOTTOM, LILAC, 1.2);
        const face = this.wheelFace;
        if (!face) return;
        const reduced = (this.motion ?? 1) < 0.5;
        const share = big ? 1 + 0.25 * lines : 0.65;
        this.fireworks.spray(t, {
            center: face.center,
            ax: face.ax,
            ay: face.ay,
            radius: WHEEL.radius + 0.7,
            count: Math.round(this.q.stars0 * share * (reduced ? 0.4 : 1)),
            seconds: big ? 1.5 : 1.0,
            speed: 15,
            turn: reduced ? 1.2 : 3.2,
            colorA: LILAC,
            colorB: WILLOW_GOLD,
        });
    }

    /**
     * A cascade's wave: roman candles from the pier's deck, a comet each with a long tail that
     * ends in a puff of crackle, thrown up and out over the sea. More of them the deeper the wave,
     * stepping out along the pier, with one or two from its near end beside the board's far side.
     * @param {number} wave how many waves past the first (1..)
     */
    candles(wave) {
        const frame = this.pierAt;
        if (!frame) return;
        const t = this.time;
        const r = this.rand;
        const reduced = (this.motion ?? 1) < 0.5;
        const count = reduced ? 2 : 2 + wave;
        const side = PIER.width * 0.3;
        const up = PIER.deckY + 1.2;
        const v = this._v;
        for (let k = 0; k < count; k += 1) {
            const s = CANDLES.far[0] + ((CANDLES.far[1] - CANDLES.far[0]) * (k + r() * 0.6)) / count;
            v.set(0, 27 + r() * 5, 0)
                .addScaledVector(frame.across, 3 + r() * 5)
                .addScaledVector(frame.along, (r() - 0.5) * 6);
            this.fireworks.comet(t, {
                from: frame.at(s, side, up),
                velocity: v,
                color: k % 2 ? new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]) : this.lastLockColor,
                delay: k * 0.09,
            });
        }
        for (let k = 0; k < Math.min(2, wave); k += 1) {
            const s = CANDLES.near[0] + (CANDLES.near[1] - CANDLES.near[0]) * r();
            v.set(0, 15 + r() * 3, 0).addScaledVector(frame.across, 2 + r() * 3);
            this.fireworks.comet(t, {
                from: frame.at(s, side, up),
                velocity: v,
                color: this.lastLockColor,
                delay: 0.15 + k * 0.12,
                life: 1.15,
                size: 0.6,
                crackle: 6,
            });
        }
    }

    /**
     * Back-to-back: the salute. A row of rings across the free sky bursting together in the
     * wheel's neon colours, one more for each back-to-back in a row (two to five), both rims
     * ringing round, and the laser fan from the wheel's hub (a beam more for each in a row, held
     * while they keep coming).
     */
    salute(stars) {
        const rings = Math.min(5, 1 + this.b2bStreak);
        for (let k = 0; k < rings; k += 1) {
            this.fireworks.launch(this.time, {
                kind: 'ring',
                color: k % 2 ? MINT : PINK,
                scale: 1.15,
                delay: 0.12,
                rise: 1.2,
                x: -0.42 + (0.84 * k) / (rings - 1),
                high: 0.5,
                stars: Math.round(stars * 0.8),
            });
        }
        this.runChase(RIM_BOTTOM, PINK, 1.3);
        this.runChase(RIM_BOTTOM + Math.PI, MINT, 1.3);
        this.laserCount = Math.min(LASER_SLOTS, 2 + this.b2bStreak);
        this.lasers.hit(1, this.time);
    }

    /** A twist that cleared nothing: the wheel whirls a little and throws a short spray. */
    onTwist() {
        this.catherine(0);
        this.surgeBonus('twist', 0.45);
    }

    /**
     * The perfect clear: the crown over the clear still in the air (physics sends it ~0.36 s after
     * the clear's last wave), never a second clear. The pier itself answers: a waterfall of gold
     * sparks pours off its whole seaward edge into the sea, lit from the land end out to the
     * wheel, under a curtain of gold willows across the free sky; the wheel's face bursts in
     * gold, its rims ring round, the whole bay stands at full blaze, shooting stars cross.
     */
    onPerfectClear() {
        const t = this.time;
        this.crown.hit(1, t);
        this.surgeBonus('perfect');
        const reduced = (this.motion ?? 1) < 0.5;
        const count = reduced ? 2 : Math.min(5, Math.max(3, this.q.finale - 2));
        const stars = Math.round(this.q.stars0 * (reduced ? 0.6 : 1) * 0.9);
        for (let k = 0; k < count; k += 1) {
            this.fireworks.launch(t, {
                kind: 'willow',
                color: WILLOW_GOLD,
                scale: 1.2,
                delay: 0.25 + k * 0.07,
                rise: 1.3,
                x: -0.45 + (0.9 * k) / (count - 1),
                high: 0.7,
                stars,
            });
        }
        const frame = this.pierAt;
        if (frame) {
            // A wall of gold comets from the whole length of the deck, then the waterfall.
            const wall = reduced ? 4 : 12;
            const v = this._v;
            const r = this.rand;
            for (let k = 0; k < wall; k += 1) {
                const far = k % 3 !== 2;
                const lane = far ? CANDLES.far : CANDLES.near;
                const s = lane[0] + (lane[1] - lane[0]) * ((Math.floor(k / 3) * (far ? 2 : 1) + (k % 3) + r() * 0.5) / (far ? 8 : 4));
                v.set(0, far ? 30 + r() * 4 : 16 + r() * 3, 0).addScaledVector(frame.across, 1 + r() * 3);
                this.fireworks.comet(t, {
                    from: frame.at(s, PIER.width * 0.3, PIER.deckY + 1.2),
                    velocity: v,
                    color: WILLOW_GOLD,
                    delay: 0.05 + k * 0.045,
                    life: far ? 1.6 : 1.15,
                    size: far ? 0.8 : 0.55,
                    crackle: far ? 12 : 6,
                });
            }
            const fall = Math.round(this.q.stars0 * (reduced ? 7 : 20));
            const side = PIER.width / 2 + 0.2;
            const edge = PIER.deckY - 0.5;
            this.fireworks.waterfall(t, {
                a: frame.at(frame.length - 5, side, edge),
                b: frame.at(PIER_HEAD.s1, side, edge),
                count: fall,
                seconds: 4.2,
                sweep: 1.1,
            });
            // The pier head's own edge, lit last.
            this.fireworks.waterfall(t + 1.1, {
                a: frame.at(PIER_HEAD.s1, PIER_HEAD.halfAcross, edge),
                b: frame.at(PIER_HEAD.s0, PIER_HEAD.halfAcross, edge),
                count: Math.round(fall * 0.12),
                seconds: 3.4,
                sweep: 0.2,
            });
        }
        this.flareWheel(WILLOW_GOLD, 1.4);
        this.runChase(RIM_BOTTOM, WILLOW_GOLD, 1.3);
        this.runChase(RIM_BOTTOM + Math.PI, WILLOW_GOLD, 1.3);
        this.queueShootingStars(2);
    }

    /** One event's own worth added to the surge (an event whose clear already counted its lines). */
    surgeBonus(kind, scale = 1) {
        const punch = SURGE_WEIGHTS.punch[kind] * scale;
        const heat = SURGE_WEIGHTS.heat[kind] * scale;
        if (punch > 0) this.surge.punch.hit(punch, this.time);
        if (heat > 0) this.surge.level.hit(heat, this.time);
    }

    /**
     * The true combo (consecutive clearing locks; 0 when the chain broke). Each link lifts the
     * train a notch (milestones send shooting stars over the bay); a chain built during a ride
     * charges the lift for the train's return. A chain of three or more that breaks sends it
     * round the circuit, faster and with a longer trail for a longer chain, twice round from
     * ten, the wheel's rims ringing round with the riders' cheer.
     */
    onChain(count) {
        const c = this.coaster;
        const n = Math.max(0, count | 0);
        if (n > 0) {
            if (n > c.notch && SHOOT_MILESTONES.has(n)) this.queueShootingStars(n >= 10 ? 2 : 1);
            c.notch = n;
            if (c.mode !== 'ride') c.mode = 'lift';
            return;
        }
        const chain = c.notch;
        c.notch = 0;
        if (c.mode === 'ride') {
            // A chain built and broken during a ride: its energy sends the train round again.
            if (chain >= 3) {
                c.laps = Math.min(c.laps + 1, c.lap + 2);
                this.cheer(chain);
            }
            return;
        }
        if (c.mode !== 'lift') return;
        if (chain >= 3) {
            c.mode = 'ride';
            c.lap = 0;
            c.laps = chain >= 10 ? 2 : 1;
            c.launch = 3 + Math.min(chain - 3, 9) * 0.5;
            c.trail = Math.max(12, 34 - (chain - 3) * 2.5);
            this.cheer(chain);
        } else {
            c.mode = 'idle';
        }
    }

    /** The riders' cheer as the train is let go: the wheel's rims ring round in sympathy. */
    cheer(chain) {
        const strength = Math.min(1.5, 0.9 + chain * 0.05);
        this.runChase(RIM_BOTTOM, LEMON, strength);
        if (chain >= 6) this.runChase(RIM_BOTTOM + Math.PI, MINT, strength);
    }

    /** Cascade depth (bus COMBO): each wave's own clear already builds on the last. */
    onCombo() {
        // Nothing of its own: the wave's clear carries its depth.
    }

    /**
     * A level: the evening steps on along its walk (eased in, on top of the clock) and the neon
     * ring turns on to its next colour. With reactions on, the pier opens a new act: searchlights
     * sweep up from its deck and cross over the bay, a broad wave of gold runs out along its
     * lights to the wheel, whose face bursts in its new colour, and two shells go up, a saturn and
     * a ring. With reactions off (`react: false`) the light still steps; the show does not.
     * @param {{ react?: boolean }} [opts]
     */
    onLevelUp({ react = true } = {}) {
        this.hourTarget += EVENING.levelStep;
        // Always forward: a second level mid-turn carries it on to the colour after.
        this.neonTarget = Math.floor(this.neonTarget + 1e-6) + 1;
        if (!react) return;
        this.surge.levelUp(this.time);
        const t = this.time;
        this.search.hit(1, t);
        this.runPulse(WILLOW_GOLD, PULSE.strength * 1.25, PULSE.speed * 0.5, PULSE.width * 2.6);
        this.flareWheel(this.neonTarget % 2 ? MINT : PINK, 1);
        this.fireworks.launch(t, {
            kind: 'saturn', color: PINK, scale: 1.25, stars: this.q.stars0, high: 0.8, x: -0.12,
        });
        this.fireworks.launch(t, {
            kind: 'ring', color: MINT, scale: 1.15, delay: 0.3, stars: this.q.stars0, high: 0.5, x: 0.2,
        });
    }

    /**
     * The beams, once a frame: the laser fan from the wheel's hub while a back-to-back's light
     * lasts (a beam for each in a row, each on its own slow sweep in the wheel's plane) and the
     * searchlights from the pier's deck after a level (swaying about the vertical, so they cross
     * and part). They show best after dark, as beams in air do, but keep a floor by day.
     */
    updateBeams(t, dt, motion) {
        const B = this.beams;
        if (!B) return;
        const laser = this.lasers.valueAt(t);
        const search = this.search.valueAt(t);
        if (laser < 0.01 && search < 0.01) {
            if (this.beamsLit) {
                B.clear();
                this.beamsLit = false;
            }
            return;
        }
        this.beamsLit = true;
        this.beamClock += dt * (0.25 + 0.75 * motion);
        const tt = this.beamClock;
        const air = 0.5 + 0.5 * this.dusk;
        const face = this.wheelFace;
        const dir = this._v;
        B.begin();
        for (let i = 0; i < LASER_SLOTS; i += 1) {
            if (!face || i >= this.laserCount || laser < 0.01) {
                B.off(i);
                continue;
            }
            const a = Math.PI * (0.14 + 0.72 * ((i + 0.5) / this.laserCount)) + 0.2 * Math.sin(tt * (0.7 + 0.13 * i) + i * 2.1);
            const lean = 0.16 * Math.sin(tt * 0.5 + i * 1.3);
            dir.set(0, 0, 0)
                .addScaledVector(face.ax, Math.cos(a))
                .addScaledVector(face.ay, Math.sin(a))
                .addScaledVector(face.axle, lean)
                .normalize();
            B.set(i, face.center, dir, BEAMS.laserLength, 0.5, 0.004, LASER_COLORS[i % LASER_COLORS.length], laser * air * BEAMS.laserLevel);
        }
        for (let j = 0; j < SEARCH_SLOTS; j += 1) {
            const foot = this.searchFeet?.[j];
            if (!foot || search < 0.01) {
                B.off(LASER_SLOTS + j);
                continue;
            }
            const az = j * 1.7 + tt * (0.34 + 0.07 * j) * (j % 2 ? -1 : 1);
            const tilt = 0.3 + 0.2 * Math.sin(tt * 0.6 + j * 1.9);
            dir.set(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
            B.set(LASER_SLOTS + j, foot, dir, BEAMS.searchLength, 2.2, 0.085, SEARCH_COLOR, search * air * BEAMS.searchLevel);
        }
        B.commit();
    }

    /** Shooting stars to send as soon as a slot is free (none under reduced motion). */
    queueShootingStars(count) {
        if (!this.q.shooting) return;
        this.pendingShoots = Math.min(4, this.pendingShoots + count);
    }

    /**
     * A streak across the upper sky, in (azimuth, elevation) space around the current view, in a
     * free slot (false when both are still streaking: a star is never cut off mid-flight).
     */
    spawnShootingStar(intensity = 1) {
        if (!this.q.shooting) return false;
        let slot = -1;
        for (let i = 0; i < this.shoots.length; i += 1) {
            const age = this.time - this.shoots[i].t0;
            if (age < 0 || age > this.shoots[i].life) {
                slot = i;
                break;
            }
        }
        if (slot < 0) return false;
        const s = this.shoots[slot];
        const r = this.rand;
        const az0 = this.yaw + (r() * 2 - 1) * 0.55;
        const e0 = 0.3 + r() * 0.16;
        const dirSign = r() < 0.5 ? -1 : 1;
        const speed = 0.5 + r() * 0.3;
        s.t0 = this.time;
        s.life = 0.9 + r() * 0.5;
        s.len = 0.08 + r() * 0.05;
        s.intensity = intensity;
        (slot === 0 ? this.u.shoot0A : this.u.shoot1A).value.set(az0, e0, dirSign * speed * 0.9, -speed * (0.25 + r() * 0.25));
        return true;
    }

    /** Hide everything but the named parts (see SYNTHWAVE_PARTS) — iteration aid. */
    showOnlyParts(names) {
        const keep = new Set(names);
        for (const [name, part] of Object.entries(this.parts)) {
            if (part) part.visible = keep.has(name);
        }
    }

    dispose() {
        this.disposed = true;
        this.root.removeFromParent();
        this.reflection?.dispose?.();
        this._camera?.layers?.disable?.(MIRROR_LAYER);
        this.reflection = null;
        this.people?.dispose();
        this.people = null;
        for (const part of Object.values(this.parts)) {
            part?.traverse((object) => {
                object.geometry?.dispose();
                object.material?.dispose();
            });
        }
        this.fireworks = null;
        this.beams = null;
        this.gulls = null;
        this.parts = {};
    }
}
