/**
 * Neon Dusk — the world: builds every part, solves the composition, drives the camera and
 * turns gameplay events into light.
 *
 * Composition. The great sun sets at azimuth 0, into the pass between the mountain ranges. The
 * gameplay board covers the middle of the screen, so the camera YAWS until the sun lands in the
 * centre of the free zone left of the board; with no board on screen (menus) it faces the sun.
 * Layout changes ease in as a slow pan. The lens is Hor+ (fixed vertical FOV, horizontal capped)
 * and the pitch puts the horizon at RIG.horizonFrac.
 *
 * Draws at High: sky, mountains, ridgelines, floor, dust, burst pixels, tiles, pillars — eight,
 * plus the floor's reflector pass (sky, mountains and ridgelines again, at 0.4 resolution on
 * High; the fx stay out of it).
 *
 * The dusk never stands still (neon-dusk-moods.js, neon-dusk-clock.js). Five moods turn the
 * colour of the light — sky, sun, grid, scan lines and ridgelines all change hue together — and
 * beside them, on a period of their own, five airs turn what hangs in the sky: a clear dusk,
 * cloud bars across the sun, a deep sky with the galaxy bright, a haze with the sun's rays in
 * it, and the dome's lattice overhead. The stars wheel about a pole above the frame, a ringed
 * planet rises, arcs over the sun and sets, the sun rides a little higher and lower in the
 * pass, and now and then something crosses the picture: a meteor shower, a comet, a satellite,
 * lights racing out along the grid. A level is one mood forward on top, eased in over a few
 * seconds while the level-up's own show plays.
 *
 * Every gameplay event has an instrument of its own:
 *   a lock         the piece's hologram rises far out on the glass and glides in; a ripple
 *   a hard drop    a pillar of light strikes up where it landed and a SQUARE shock runs out
 *                  along the grid lines
 *   a single       a pulse of light runs out along the ridgelines from the pass; a wave rolls
 *                  in over the glass; a scan sweeps the ranges
 *   a double       + a dashed halo leaves the sun
 *   a triple       + three laser beams fan up out of the pass
 *   a quad         the sunburst: rays thrown across the whole sky, a five-beam laser crown,
 *                  a storm of pixels off the sun's face, the tape slips
 *   a twist        the neon triangle stands round the sun and spins home (an echo a line)
 *   back-to-back   the sun's twins: a cyan and a magenta ghost slide out of it and fold back,
 *                  wider with each streak; a double scan
 *   a cascade      a volley of meteors, one more a wave; the palette swings
 *   a combo        the sun's slits light one by one from its base (the chain's meter)
 *   a perfect      the coronation: the slits close and the disc burns gold, the rays stand
 *                  round it, seven gold beams crown it, every ridgeline is gilded from the
 *                  pass outward, meteors fall, and the glass breathes the light back out
 *   a level        the scan bar climbs the whole sky, the ranges light far to near, lights
 *                  race out along the grid
 *   a run's end    the sun goes down behind the pass and the stars come out; the next run
 *                  is its sunrise
 *
 * Gameplay builds instead of popping (src/themes/shared/gameplay-surge.js). Every event layer
 * ADDS to what is still lit: the sun's glow is a Swell, the layers are slot pools that join a
 * wave launched the same moment and otherwise take a free or the weakest slot, never one in
 * full flight. The surge's level and fever drive the dusk itself, in four acts:
 *   calm   — the dusk as it always was;
 *   warm   — the sun stokes up, the ridges' scan lines brighten, the grid quickens;
 *   hot    — the glass rushes toward the lens, bands of light run in along the grid on a beat,
 *            the holograms stand taller, the palette swings round the colour wheel;
 *   fever  — the sun burns gold and its slits race, its rays stand out, it beats out halos in
 *            time with the grid's bands, a meteor shower falls away from it, the dust streams up.
 */

import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    GRID_SPACING,
    RIG,
    SCROLL_SPEED,
    SCROLL_WRAP,
    SUN,
} from './neon-dusk-tsl.js';
import { SKY_SLOTS, SLITS, createSky } from './neon-dusk-sky.js';
import { createMountainsSteps } from './neon-dusk-mountains.js';
import { RIDGE_PULSES, createRidges } from './neon-dusk-ridges.js';
import { NeonDuskFlight } from './neon-dusk-flight.js';
import { AMBIENT_PULSE, RACER_SLOTS, createFloor } from './neon-dusk-floor.js';
import {
    DIRECT_ONLY_LAYER, NeonDuskFx, TILE_HOLOGRAM, pieceOutlineBits,
} from './neon-dusk-fx.js';
import { applyCameraBreath, easedMotion } from '../shared/camera-breath.js';
import { drainSteps } from '../shared/build-steps.js';
import {
    GameplaySurge, SURGE_WEIGHTS, Swell, softCeiling,
} from '../shared/gameplay-surge.js';
import { ComboTracker } from '../../core/combo-tracker.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { easeStep, moodDrift } from '../shared/mood-clock.js';
import {
    MOODS, MOOD_COUNT, MOOD_HOLD, MOOD_KEYS, MOOD_PERIOD, moodAt, moodName, swing,
} from './neon-dusk-moods.js';
import {
    AIRS, HAPPENING_PERIOD, PLANET, SKY_POLE, airAt, airName, airPhase, happeningOf, planetAt,
    skyTurn, sunDrift, windowRandom,
} from './neon-dusk-clock.js';

/**
 * Per-tier content. Every tier keeps the composition and every event; tiers trade detail, not
 * layout. `reflection` = the floor reflector's resolution scale (0 = analytic sky mirror, no 2nd
 * render); `reflectionBlur` = the mip level the mirror is read at (0 = no mip chain); `fine` =
 * the galaxy's own crowd of faint stars and its dust rift.
 */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        detail: 0.5,
        contours: true,
        dust: 0,
        burst: 120,
        tiles: 48,
        clouds: false,
        stars: 0.6,
        fine: false,
        reflection: 0,
        reflectionBlur: 0,
    },
    Low: {
        detail: 0.7,
        contours: true,
        dust: 70,
        burst: 200,
        tiles: 64,
        clouds: true,
        stars: 1,
        fine: false,
        reflection: 0,
        reflectionBlur: 0,
    },
    Medium: {
        detail: 0.85,
        contours: true,
        dust: 140,
        burst: 300,
        tiles: 96,
        clouds: true,
        stars: 1,
        fine: true,
        reflection: 0.3,
        reflectionBlur: 0,
    },
    High: {
        detail: 1,
        contours: true,
        dust: 210,
        burst: 450,
        tiles: 96,
        clouds: true,
        stars: 1,
        fine: true,
        reflection: 0.4,
        reflectionBlur: 1.6,
    },
    Ultra: {
        detail: 1.15,
        contours: true,
        dust: 270,
        burst: 600,
        tiles: 128,
        clouds: true,
        stars: 1,
        fine: true,
        reflection: 0.5,
        reflectionBlur: 1.9,
    },
    Extreme: {
        detail: 1.3,
        contours: true,
        dust: 330,
        burst: 800,
        tiles: 160,
        clouds: true,
        stars: 1,
        fine: true,
        reflection: 0.6,
        reflectionBlur: 2.1,
    },
});

/** Tetromino cells (x right, y away from the camera), matching the old theme's shapes. */
export const TETROMINO_SHAPES = Object.freeze({
    I: [[0, 0], [1, 0], [2, 0], [3, 0]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
    O: [[0, 0], [1, 0], [0, 1], [1, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
});

/** Piece colours: the theme's tetromino palette (neon-dusk-tetrominos.js). */
export const PIECE_COLORS = {
    I: 0xff5cc8, O: 0xa24bff, T: 0x2bffb0, S: 0xff7b24, Z: 0x00b4ff, J: 0xffcf1a, L: 0x00f6ff,
};
const PIECE_COLOR_LIST = Object.values(PIECE_COLORS).map((h) => new THREE.Color(h));
const BURST_COLORS = [0xff4fd8, 0x39f0ff, 0xffd25a, 0xb46bff, 0xffffff, 0xff7aa8].map((h) => new THREE.Color(h));

/** Camera-space depth the sun burst floats at: well in front of the mountains. */
const BURST_DEPTH = 60;

/**
 * A locked piece's hologram's way in (view depths, world units): it rises `far` out and glides
 * in along the grid until it lies down `near` the camera, where it comes in between `edge` (NDC
 * x; −1 is the screen's left edge) and the board.
 */
export const HOLO_PATH = Object.freeze({ far: [85, 105], near: [36, 42], edge: -1 });

/** Gameplay boards carry data-player; the lobby's avatar cards reuse .player-card without it. */
export const BOARD_SELECTOR = '.player-card[data-player]';

/**
 * The visible gameplay boards' union rect in screen fractions (x0, y0, x1, y1; y down), or null.
 * Element.checkVisibility walks the ancestors (a board in a container hidden by an ancestor's
 * opacity still has a rect). DOM read: call on layout changes, never per frame.
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
const smooth = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
};
const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/**
 * Event-layer slots: floor light waves, halos, lock ripples, scan sweeps, meteors, laser beams,
 * ridgeline pulses, hard-drop shocks and grid racers.
 */
export const SLOTS = Object.freeze({
    rings: 3,
    holos: 3,
    shoots: SKY_SLOTS.meteors,
    ripples: 4,
    contours: 4,
    beams: SKY_SLOTS.beams,
    pulses: RIDGE_PULSES,
    shocks: 2,
    racers: RACER_SLOTS,
});
/** A floor wave launched within this long of one still waiting below the horizon joins it. */
const RING_JOIN = 0.7;
/** Halos and scan sweeps launched within this long of each other are one. */
const HOLO_JOIN = 0.12;
const CONTOUR_JOIN = 0.1;

/** How each event layer rises and fades with age (s): the shapes the shaders are fed. */
const ringEnvelope = (age) => Math.min(1, age / 0.15) * (1 - smooth(2.2, 3, age));
const holoEnvelope = (age) => Math.min(1, age / 0.1) * (1 - age / 2.2) ** 1.5;
const rippleEnvelope = (age) => Math.min(1, age / 0.08) * (1 - age / 1.8) ** 1.5;
const contourEnvelope = (age) => Math.min(1, age / 0.12) * (1 - smooth(1.2, 1.6, age));

/** A meteor as the sky's shooting stars always flew: 0.9 s, 0.22 rad, a 0.09 rad tail. */
export const METEOR = Object.freeze({
    life: 0.9, reach: 0.22, tail: 0.09, gain: 1, width: 1,
});

/**
 * The instruments' own shapes:
 *   the triangle (a twist)   half its side in sun radii, how long it stands, how long it spins
 *   the twins (back-to-back) how far the ghosts slide (sun radii; more a streak), how long
 *   the scan bar (a level)   how high it climbs (the sine of the elevation), how long it takes
 *   a ridge pulse            how fast it runs out along the crests (rad of bearing a second),
 *                            how wide it is, and the bearing at which it is spent
 *   a hard drop's shock      how fast the square runs out (units/s) and how long it lasts
 *   a racer                  its speed (units/s), tail (units) and life (s)
 *   the run's end            how far the sun goes down (rad) and how fast it sets and rises (1/s)
 */
export const SHOW = Object.freeze({
    triangle: Object.freeze({
        side: 2.05, life: 1.6, spin: 0.95, turn: (Math.PI * 2) / 3,
    }),
    twins: Object.freeze({
        reach: 0.5, perStreak: 0.14, most: 1.1, life: 1.35,
    }),
    scan: Object.freeze({ top: 0.62, climb: 1.7, life: 2 }),
    pulse: Object.freeze({ speed: 0.8, width: 0.11, spent: 2.3 }),
    shock: Object.freeze({ speed: 64, life: 1.3 }),
    racer: Object.freeze({ speed: 150, tail: 38, life: 5.2 }),
    sunset: Object.freeze({ drop: 0.255, set: 0.55, rise: 1.1 }),
});

/** The slot with the least light still to give (`left` reads it): a new event takes it. */
function weakest(slots, left) {
    let best = 0;
    let least = Infinity;
    slots.forEach((slot, i) => {
        const value = left(slot);
        if (value < least) {
            least = value;
            best = i;
        }
    });
    return slots[best];
}

/** The piece's type: real play sends `type`, the Serenity tray only `shapeKey`. */
export function pieceType(piece) {
    const key = piece?.type || piece?.shapeKey;
    return key && TETROMINO_SHAPES[key] ? key : 'T';
}

/** The piece's own colour when it carries one (a hex string or number), else the theme's. */
export function pieceColor(piece, type, out) {
    const c = piece?.color;
    if (typeof c === 'number' && Number.isFinite(c)) return out.set(c);
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return out.set(c);
    return out.set(PIECE_COLORS[type]);
}

const rows = (n) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0));

export function createWorldUniforms() {
    const mood0 = MOODS[0];
    return {
        time: uniform(0),
        scroll: uniform(0),
        /** The lens's aspect (the ridgelines are widened in the image). */
        aspect: uniform(16 / 9),
        /** The camera's level right (the pillars turn to the lens about their upright). */
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        sunDir: uniform(new THREE.Vector3(0, 0, -1)),
        sunRight: uniform(new THREE.Vector3(1, 0, 0)),
        sunUp: uniform(new THREE.Vector3(0, 1, 0)),
        sunRadius: uniform(SUN.radius),
        sunPulse: uniform(0),
        comboShift: uniform(0),
        /** Floor light waves from the horizon (or out to it): (radius, 1/width, energy, 0). */
        ring0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        ring1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        ring2: uniform(new THREE.Vector4(0, 1, 0, 0)),
        /** The last piece locks' ripples in the glass: (x, z, radius, energy). */
        ripple0: uniform(new THREE.Vector4(0, 0, 0, 0)),
        ripple1: uniform(new THREE.Vector4(0, 0, 0, 0)),
        ripple2: uniform(new THREE.Vector4(0, 0, 0, 0)),
        ripple3: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** Hard drops' square shocks along the grid: (x, z, half-size, energy). */
        shock0: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shock1: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** Lights racing out along the grid: (lane x, head z, light, tail length), packed. */
        racers: uniformArray(rows(SLOTS.racers), 'vec4'),
        racerCount: uniform(0, 'int'),
        /** Hologram rings out of the sun: (radius in sun radii, 1/width, energy, dash turn). */
        holo0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        holo1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        holo2: uniform(new THREE.Vector4(0, 1, 0, 0)),
        /**
         * Meteors and satellites, two rows each, packed: (azimuth, elevation, heading, age 0..1)
         * and (reach, tail, light, width).
         */
        shoots: uniformArray(rows(SLOTS.shoots * 2), 'vec4'),
        shootCount: uniform(0, 'int'),
        /** Laser beams out of the pass, packed: (angle from upright, half-width, light, hue). */
        beams: uniformArray(rows(SLOTS.beams), 'vec4'),
        beamCount: uniform(0, 'int'),
        /** A twist's triangle: (half its side in sun radii, its turn, light, echoes). */
        tri: uniform(new THREE.Vector4(SHOW.triangle.side, 0, 0, 0)),
        /** Back-to-back's twin suns: (how far apart, in sun radii; light). */
        twin: uniform(new THREE.Vector2(0, 0)),
        /** The sunburst: (light, turn, reach in sun radii). */
        rays: uniform(new THREE.Vector3(0, 0, 1)),
        /** A level's scan bar: (the sine of its elevation, light). */
        scan: uniform(new THREE.Vector2(0, 0)),
        /** A comet: (azimuth, elevation, its tail's heading, light). */
        comet: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The chain's meter: how many of the sun's slits are lit, from its base. */
        slitFill: uniform(0),
        /** Waves of light rolling through the ranges toward the camera: (distance, energy) × 4. */
        contourA: uniform(new THREE.Vector4(0, 0, 0, 0)),
        contourB: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The ridges' scan lines' own light: 0.8 at rest, more as play heats. */
        scanGain: uniform(0.8),
        /** The ridgelines' light (1 at rest) and the pulses running along them, packed. */
        ridgeGain: uniform(1),
        ridgePulses: uniformArray(rows(SLOTS.pulses), 'vec4'),
        ridgePulseCount: uniform(0, 'int'),
        /** The ambient light that moves at rest (the grid's slow pulse): 1, or 0 under reduced motion. */
        ambient: uniform(1),
        /** The grid's pulse: (phase of the band running in, 0..1; its energy). */
        pulse: uniform(new THREE.Vector2(0, 0.2)),
        /** How far the sun's slits have slid (stripes). */
        slitPhase: uniform(0),
        /** How hot the sun burns (0 at rest): its face shifts toward the gold crown. */
        sunHeat: uniform(0),
        /** A perfect clear's crown (0..1): the slits close and the disc burns gold. */
        crown: uniform(0),
        /** The run's end (0..1): the sun has gone down, the stars are out. */
        night: uniform(0),
        /** The holograms' height (1 at rest; taller as play heats). */
        tileLift: uniform(1),
        /** The floor's scroll, unwrapped. */
        scrollRun: uniform(0),
        /** The holograms' run: the floor's scroll plus their own glide in (TILE_HOLOGRAM.glide). */
        tileRun: uniform(0),
        /** The dust's clock (the world's time at rest; quicker as play heats) and its light. */
        dustRun: uniform(0),
        dustGain: uniform(2.1),
        /** The live mood's colours (neon-dusk-moods.js MOOD_KEYS), scene-linear. */
        mood: Object.fromEntries(MOOD_KEYS.map((key) => [key, uniform(new THREE.Vector3(...mood0[key]))])),
        /** The live mood's starlight (1 in today's), times the air's. */
        starGain: uniform(mood0.stars),
        /** The grid's and the scan lines' live colours (the mood's, swung by a hot hand). */
        gridNear: uniform(new THREE.Vector3(...mood0.grid)),
        gridFar: uniform(new THREE.Vector3(...mood0.gridFar)),
        scanLow: uniform(new THREE.Vector3(...mood0.scanLow)),
        scanHigh: uniform(new THREE.Vector3(...mood0.scanHigh)),
        ridge: uniform(new THREE.Vector3(...mood0.ridge)),
        ridgeFar: uniform(new THREE.Vector3(...mood0.ridgeFar)),
        /** The live air (neon-dusk-clock.js AIRS). */
        cloud: uniform(AIRS[0].cloud),
        deep: uniform(AIRS[0].deep),
        haze: uniform(AIRS[0].haze),
        lattice: uniform(AIRS[0].lattice),
        calm: uniform(AIRS[0].calm),
        /** The sky's own turned frame (its y axis is the pole the stars wheel about). */
        skyRot: uniform(new THREE.Matrix3()),
        /** The ringed planet: where it stands, its east and north, (radius, rings' opening, how much of it shows, the rings' light). */
        planetDir: uniform(new THREE.Vector3(0, 0.3, -1).normalize()),
        planetEast: uniform(new THREE.Vector3(1, 0, 0)),
        planetNorth: uniform(new THREE.Vector3(0, 1, 0)),
        planet: uniform(new THREE.Vector4(PLANET.radius, 0.3, 0, 1.25)),
    };
}

/** Frame-rate independent approach factor of a level's step toward its mood (1/s). */
const MOOD_EASE = 0.8;

/** At rest a shooting star crosses the sky once in each window of this many seconds. */
export const AMBIENT_SHOOT_PERIOD = 19;

export class NeonDuskWorld {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {string} [opts.quality='High']
     * @param {() => number} [opts.random]
     * @param {object} [opts.overrides]  per-key tier overrides (A/B measurement aid)
     */
    constructor({
        scene, quality = 'High', random = Math.random, overrides = null,
    }) {
        this.scene = scene;
        this.qualityName = WORLD_QUALITY[quality] ? quality : 'High';
        this.q = overrides ? { ...WORLD_QUALITY[this.qualityName], ...overrides } : WORLD_QUALITY[this.qualityName];
        this.rand = random;
        this.u = createWorldUniforms();
        this.root = new THREE.Group();
        this.root.name = 'NeonDuskWorld';
        this.time = 0;
        this.parts = {};
        this.reflection = null;

        this.lens = { vfov: RIG.vfov, aspect: 16 / 9 };
        this.pitch = 0;
        this.yaw = 0;
        this.targetYaw = 0;
        this.yawSettled = false;
        this.board = null;

        this.sunDir = new THREE.Vector3();
        this.sunUp = new THREE.Vector3();
        this.sunRight = new THREE.Vector3(1, 0, 0);
        this.setSunElevation(SUN.elevation);

        /** The sun's glow (what u.sunPulse shows): event hits add to what is still lit. */
        this.sunPulse = 0;
        this.sunSwell = new Swell({
            attack: 0.06, release: 0.9, ceiling: 1.2, knee: 0.85, headroom: 1.4,
        });
        /** A perfect clear's crown: it swells in, holds a beat and lets go over ~3 s. */
        this.crownSwell = new Swell({
            attack: 0.12, release: 1.3, ceiling: 1, knee: 0.8,
        });
        /** The sunburst's own swell (a quad, a perfect clear, a sunrise). */
        this.raySwell = new Swell({
            attack: 0.08, release: 1.25, ceiling: 1.3, knee: 0.9,
        });
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), and the true combo (the lock
         * sequence: src/core/combo-tracker.js; the COMBO event carries the cascade depth).
         */
        this.surge = new GameplaySurge();
        this.heat = this.surge.sample(Number.NaN);
        this.combo = new ComboTracker();
        /** The acts as smooth factors (0..1), and what the post reads. */
        this.drive = {
            warm: 0, hot: 0, fever: 0, crown: 0, exposure: 1, bloomGain: 1,
        };
        this.chainLen = 0;
        this.lastLockAt = -1e6;
        this.lastLockCleared = true;
        this.hardDropAt = -1e6;
        this.b2bStreak = 0;
        this.comboShift = 0;
        this.comboTarget = 0;
        this.glitch = 0;
        // Integrated clocks the heat quickens (closed form at rest, so a seek lands right).
        this.scrollExtra = 0;
        this.scrollRun = 0;
        this.tileRun = 0;
        this.pulsePhase = 0;
        this.slitPhase = 0;
        this.dustRun = 0;
        this.meteorDue = 0;
        this.rayTurn = 0;
        this.slitFill = 0;
        this.slitGoal = 0;
        /** The run's end: the sun is down (`ended`), and how far (`nightK`, eased). */
        this.ended = false;
        this.nightK = 0;
        /** The game's level (a level is one mood forward) and its eased step on the wheel. */
        this.level = 1;
        this.moodStep = 0;
        this._mood = {};
        this._air = {};
        this._planet = {
            azimuth: 0, elevation: 0, arc: 0, roll: 0, open: 0, up: 0,
        };
        /**
         * Iteration aids (the playground sets them): `air` pins the air (an index into AIRS, or
         * null for the clock's), `happenings` off stills the sky's visitors, `planetTime` pins
         * the planet's round.
         */
        this.tune = { air: null, happenings: true, planetTime: null };

        const slots = (n, make) => Array.from({ length: n }, make);
        this.rings = slots(SLOTS.rings, () => ({ t0: -1e6, energy: 0, out: false }));
        this.holos = slots(SLOTS.holos, () => ({ t0: -1e6, energy: 0, spin: 0 }));
        this.shoots = slots(SLOTS.shoots, () => ({
            t0: -1e6, life: METEOR.life, az: 0, el: 0, heading: 0, reach: METEOR.reach, tail: METEOR.tail, gain: 1, width: 1,
        }));
        this.ripples = slots(SLOTS.ripples, () => ({
            t0: -1e6, x: 0, z: 0, run: 0, energy: 0,
        }));
        this.contours = slots(SLOTS.contours, () => ({ t0: -1e6, energy: 0, speed: 1 }));
        this.beams = slots(SLOTS.beams, () => ({
            t0: -1e6, life: 1, from: 0, to: 0, width: 0.03, energy: 0, hue: 0,
        }));
        this.pulses = slots(SLOTS.pulses, () => ({
            t0: -1e6, energy: 0, speed: SHOW.pulse.speed, width: SHOW.pulse.width, range: -1,
        }));
        this.shocks = slots(SLOTS.shocks, () => ({
            t0: -1e6, x: 0, z: 0, run: 0, energy: 0,
        }));
        this.racers = slots(SLOTS.racers, () => ({
            t0: -1e6, x: 0, z: 0, energy: 0,
        }));
        /** The one-at-a-time instruments. */
        this.triangle = {
            t0: -1e6, energy: 0, echoes: 0, dir: 1,
        };
        this.twins = { t0: -1e6, energy: 0, reach: SHOW.twins.reach };
        this.scan = { t0: -1e6, energy: 0 };
        this.comet = {
            t0: -1e6, life: 0, az: 0, el: 0, vaz: 0, vel: 0, energy: 0,
        };
        const { u } = this;
        this.ringU = [u.ring0, u.ring1, u.ring2];
        this.holoU = [u.holo0, u.holo1, u.holo2];
        this.rippleU = [u.ripple0, u.ripple1, u.ripple2, u.ripple3];
        this.shockU = [u.shock0, u.shock1];
        this.contourV = [u.contourA.value, u.contourB.value];
        this._color = new THREE.Color();
        this._swing = [0, 0, 0];

        this._camRest = new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        this._fwd = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._target = new THREE.Vector3();
        this._a = new THREE.Vector3();
        this._b = new THREE.Vector3();
        this._pole = new THREE.Vector3();
        this._ex = new THREE.Vector3();
        this._ez = new THREE.Vector3();
        this.applyClocks(0);
    }

    build() {
        return drainSteps(this.buildSteps());
    }

    /**
     * The build as steps (the theme breathes between them: shared/build-steps.js), the same work
     * in the same order from the same draws. Built in one task, the ranges' terrain held the
     * first-visit switch's worst frame at ~44 ms (2026-10-31).
     */
    * buildSteps() {
        const { q, u, rand } = this;
        this.parts.sky = createSky(u, { clouds: q.clouds, starDensity: q.stars, fine: q.fine });
        yield 'sky';
        this.parts.mountains = yield* createMountainsSteps(u, { detail: q.detail, contours: q.contours });
        yield 'mountains';
        this.parts.ridges = createRidges(u, this.parts.mountains.userData.crests);
        yield 'ridges';
        const floor = createFloor(u, { reflectionScale: q.reflection, reflectionBlur: q.reflectionBlur });
        this.parts.floor = floor.mesh;
        this.reflection = floor.reflection;
        this.fx = new NeonDuskFx(u, {
            dust: q.dust, burst: q.burst, tiles: q.tiles, rand,
        });
        this.flight = new NeonDuskFlight(u);
        for (const part of Object.values(this.parts)) {
            if (part) this.root.add(part);
        }
        if (floor.reflectorTarget) this.root.add(floor.reflectorTarget);
        this.root.add(this.flight.group);
        this.root.add(this.fx.group);
        this.scene.add(this.root);
        return this;
    }

    /**
     * Let the camera see the direct-only layer (all fx) while the reflector's mirrored
     * camera keeps to the default layer. Call once the render camera exists.
     */
    bindCamera(camera) {
        camera.layers.enable(DIRECT_ONLY_LAYER);
        this.reflection?.reflector?.getVirtualCamera(camera)?.layers.disable(DIRECT_ONLY_LAYER);
    }

    // ── Composition ─────────────────────────────────────────────────────────

    static verticalFov(aspect) {
        const a = Math.max(0.1, aspect || 16 / 9);
        const capped = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(RIG.hFovCap) / 2) / a);
        return Math.min(RIG.vfov, THREE.MathUtils.radToDeg(capped));
    }

    /** Stand the sun `elevation` (rad) over the horizon at azimuth 0 (the pass). */
    setSunElevation(elevation) {
        this.sunDir.set(0, Math.sin(elevation), -Math.cos(elevation));
        this.sunUp.set(0, Math.cos(elevation), Math.sin(elevation));
        this.u.sunDir.value.copy(this.sunDir);
        this.u.sunUp.value.copy(this.sunUp);
        this.u.sunRight.value.copy(this.sunRight);
    }

    /** Screen x (fraction from the left) of the sun for a camera yaw. */
    sunScreenX(yaw) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2);
        const cp = Math.cos(this.pitch);
        const sp = Math.sin(this.pitch);
        // The pass's bearing at the sun's authored height: the composition does not follow the
        // sun's own rise and fall.
        const dy = Math.sin(SUN.elevation);
        const dz = -Math.cos(SUN.elevation);
        const depth = dy * sp - dz * Math.cos(yaw) * cp;
        const side = dz * Math.sin(yaw);
        return (side / Math.max(1e-4, depth) / (tanV * this.lens.aspect)) * 0.5 + 0.5;
    }

    /** Solve the lens, pitch and target yaw for an aspect and the board rect (or null). */
    setLayout(aspect, board = null, { immediate = false } = {}) {
        this.lens.aspect = Math.max(0.1, aspect || 16 / 9);
        this.lens.vfov = NeonDuskWorld.verticalFov(this.lens.aspect);
        this.u.aspect.value = this.lens.aspect;
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2);
        this.pitch = Math.atan((2 * RIG.horizonFrac - 1) * tanV);
        this.board = board;
        let targetX = 0.5;
        if (board && board.x0 > 0.16) targetX = THREE.MathUtils.clamp(board.x0 * 0.5, 0.12, 0.34);
        let lo = -1.25;
        let hi = 1.25;
        for (let i = 0; i < 40; i += 1) {
            const mid = (lo + hi) / 2;
            if (this.sunScreenX(mid) > targetX) lo = mid;
            else hi = mid;
        }
        this.targetYaw = (lo + hi) / 2;
        if (immediate || !this.yawSettled) {
            this.yaw = this.targetYaw;
            this.yawSettled = true;
        }
    }

    /** The current view's basis at the rest pose (eased yaw + pitch; no drift or parallax). */
    viewBasis() {
        const cp = Math.cos(this.pitch);
        this._fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
        this._right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
        this._up.crossVectors(this._right, this._fwd).normalize();
        return { fwd: this._fwd, right: this._right, up: this._up };
    }

    /** Half the lens's horizontal field (rad). */
    halfField() {
        return Math.atan(Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2) * this.lens.aspect);
    }

    /** Camera: eased yaw, the rest pose, a slow gliding drift and pointer parallax. */
    updateCamera(camera, sim) {
        const dt = sim.delta ?? 0;
        // Reduced motion (Settings or the system) eases the camera to rest; update() reads the
        // same factor for the rest of the scene.
        this.motionState ??= {};
        const motion = easedMotion(this.motionState, dt);
        this.motion = motion;
        this.yaw += (this.targetYaw - this.yaw) * approach(1.2, dt);
        if (camera.fov !== this.lens.vfov || camera.aspect !== this.lens.aspect) {
            camera.fov = this.lens.vfov;
            camera.aspect = this.lens.aspect;
            camera.updateProjectionMatrix();
        }
        const t = sim.time ?? this.time;
        const { fwd, right } = this.viewBasis();
        this.u.camRight.value.copy(right);
        const driftX = (Math.sin(t * 0.05) * 1.4 + Math.sin(t * 0.023 + 1.1) * 0.6) * motion;
        const driftY = (Math.sin(t * 0.07 + 0.4) * 0.35 + Math.sin(t * 0.019) * 0.2) * motion;
        const px = (sim.pointerX ?? 0) * 1.6 * motion;
        const py = -(sim.pointerY ?? 0) * 0.6 * motion;
        camera.position.copy(this._camRest).addScaledVector(right, driftX + px);
        camera.position.y = Math.max(2, camera.position.y + driftY + py);
        this._target.copy(this._camRest).addScaledVector(fwd, 2000);
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
        const edge = Math.min(x + 0.2, 1.2 - x, y + 0.2, 1.2 - y);
        out.set(x, y);
        return inFront * THREE.MathUtils.clamp(edge / 0.2, 0, 1);
    }

    // ── Per frame ────────────────────────────────────────────────────────────

    update(sim) {
        const t = sim.time ?? 0;
        const dt = sim.delta ?? 0;
        this.time = t;
        const { u } = this;
        u.time.value = t;
        // Reduced motion: the floor runs at 30 % (a lag, so a seek still lands right), the sun's
        // pulses stay soft, the VHS glitch never shows and the heat quickens nothing.
        const motion = this.motion ?? 1;

        // ── How hot play runs: the four acts as smooth factors ──
        const heat = this.surge.sample(t);
        this.heat = heat;
        const warm = smooth(0.15, 0.5, heat.level);
        const hot = smooth(0.45, 0.85, heat.level);
        const { fever } = heat;
        const crown = this.crownSwell.valueAt(t);
        this.checkChain();

        // The run's end: the sun goes down behind the pass (and comes back up for the next).
        const S = SHOW.sunset;
        this.nightK += ((this.ended ? 1 : 0) - this.nightK) * approach(this.ended ? S.set : S.rise, dt);
        if (this.nightK < 1e-4) this.nightK = 0;
        const night = this.nightK * this.nightK * (3 - 2 * this.nightK);
        u.night.value = night;

        // The grid quickens with the heat (6 → ~16 units/s in a fever).
        this.scrollLag = (this.scrollLag ?? 0) + dt * SCROLL_SPEED * 0.7 * (1 - motion);
        this.scrollExtra += dt * SCROLL_SPEED * (0.45 * warm + 0.55 * hot + 0.65 * fever) * motion;
        this.scrollRun = t * SCROLL_SPEED - this.scrollLag + this.scrollExtra;
        u.scrollRun.value = this.scrollRun;
        // The holograms glide in on top of the scroll (slower too under reduced motion).
        this.glideLag = (this.glideLag ?? 0) + dt * TILE_HOLOGRAM.glide * 0.7 * (1 - motion);
        this.tileRun = this.scrollRun + t * TILE_HOLOGRAM.glide - this.glideLag;
        u.tileRun.value = this.tileRun;
        u.scroll.value = ((this.scrollRun % SCROLL_WRAP) + SCROLL_WRAP) % SCROLL_WRAP;
        u.ambient.value = motion;

        // The grid's pulse comes on a beat: one band every 11 s at rest, ~3 s hot, ~1.4 s in a
        // fever, each brighter. In a fever the sun beats out a halo as each band sets off.
        let period = AMBIENT_PULSE.period + (3.2 - AMBIENT_PULSE.period) * hot;
        period += (1.4 - period) * fever;
        this.pulsePhase += dt / period;
        if (this.pulsePhase >= 1) {
            this.pulsePhase %= 1;
            if (fever > 0.3) this.triggerHolo((0.25 + 0.4 * fever) * (0.4 + 0.6 * motion), 0, { join: false });
        }
        u.pulse.value.set(this.pulsePhase, AMBIENT_PULSE.energy * (1 + 0.9 * hot + 1.1 * fever));

        // A fever's meteor shower: stars fall away from the sun, about one a second.
        this.meteorDue += dt * (0.2 * hot + 0.85 * fever) * motion;
        if (this.meteorDue >= 1) {
            this.meteorDue -= 1;
            this.emitShootingStar();
        }
        this.updateAmbientShoot(t, motion);
        this.updateHappenings(t, motion);
        this.flight?.update(t, motion);

        // The clocks: the air, the sky's turn, the planet, the sun's height.
        this.applyClocks(dt, night);

        // The sun stokes up: its slits slide faster, its face burns toward the gold crown, its
        // glow keeps a floor under the events' hits; a perfect clear closes the slits.
        this.slitPhase += dt * SLITS.speed * (1 + (1.6 * hot + 3.4 * fever) * motion);
        u.slitPhase.value = this.slitPhase;
        u.sunHeat.value = 0.35 * hot + 0.65 * fever;
        u.crown.value = Math.min(1, crown);
        let pulse = this.sunSwell.valueAt(t) + 0.1 * warm + 0.12 * hot + 0.14 * fever + crown * 0.15;
        if (motion < 1) pulse = Math.min(pulse, 0.5 + 0.7 * motion);
        this.sunPulse = softCeiling(pulse, 0.85, 1.2);
        u.sunPulse.value = this.sunPulse;
        this.glitch *= Math.exp(-3.5 * dt) * motion;

        // The sunburst: its rays stand faint in the haze air and in a fever, a quad and a
        // perfect clear throw them out, and they turn a little faster while they burn.
        // A burst lights a third of the frame at once: Reduce flashing holds it back (ADR-0021).
        const burst = this.raySwell.valueAt(t) * flashScale();
        const rays = 0.22 * u.haze.value + 0.2 * fever + 0.55 * Math.min(1, crown) * (0.4 + 0.6 * flashScale()) + burst;
        this.rayTurn = (this.rayTurn + dt * (0.04 + 0.35 * burst) * motion) % (Math.PI * 2);
        u.rays.value.set(rays * (1 - 0.8 * night), this.rayTurn, 0.8 + 0.5 * u.haze.value + 2.4 * burst + 1.3 * Math.min(1, crown));

        // The chain's meter: a slit of the sun lights for each step of the combo.
        this.slitFill += (this.slitGoal - this.slitFill) * approach(this.slitGoal > this.slitFill ? 7 : 2.2, dt);
        u.slitFill.value = this.slitFill < 0.01 ? 0 : this.slitFill;

        // The palette swings round the colour wheel with the chain (in today's mood from
        // magenta toward cyan), and holds there while play stays hot; when the chain breaks
        // it eases back over a few seconds.
        this.comboTarget *= Math.exp(-0.35 * dt);
        const shiftTo = Math.max(this.comboTarget, 0.3 * hot + 0.45 * fever);
        this.comboShift += (shiftTo - this.comboShift) * approach(2.5, dt);
        u.comboShift.value = THREE.MathUtils.clamp(this.comboShift, 0, 1);

        // The ridges stay lit, the holograms stand taller, the dust streams up.
        u.scanGain.value = (0.8 + 0.3 * warm + 0.35 * hot + 0.45 * fever + crown * 1.1) * (1 - 0.35 * night);
        u.ridgeGain.value = (1 + 0.2 * warm + 0.25 * hot + 0.35 * fever + crown * 1.4) * (1 - 0.3 * night);
        u.tileLift.value = 1 + 0.15 * warm + 0.15 * hot + 0.2 * fever;
        this.dustRun += dt * (1 + (1.5 * hot + 2.5 * fever) * motion);
        u.dustRun.value = this.dustRun;
        u.dustGain.value = 2.1 * (1 + 0.3 * hot + 0.5 * fever);

        // The post: the iris closes a little as the dusk burns hotter (colours stay saturated),
        // and the bloom grows a touch.
        const d = this.drive;
        d.warm = warm;
        d.hot = hot;
        d.fever = fever;
        d.crown = crown;
        d.exposure = 1 - 0.04 * warm - 0.04 * hot - 0.04 * fever - 0.05 * Math.min(1, crown);
        d.bloomGain = 1 + 0.08 * hot + 0.1 * fever;

        this.applyMood(approach(MOOD_EASE, dt));
        this.updateSlots(t);
    }

    // ── The clocks: air, sky, planet, sun ───────────────────────────────────

    /** The time the slow clocks read: the world's, held back under reduced motion. */
    clockTime() {
        return Math.max(0, this.time - (this.clockLag ?? 0));
    }

    /**
     * Set what the slow clocks turn: the air's scalars, the sky's own frame, the planet and the
     * sun's height. All closed forms of the time (a seek lands on the same sky); reduced motion
     * runs them at a fifth.
     */
    applyClocks(dt, night = 0) {
        const { u } = this;
        const motion = this.motion ?? 1;
        this.clockLag = (this.clockLag ?? 0) + dt * 0.8 * (1 - motion);
        const t = this.clockTime();

        const air = airAt(this.tune.air ?? airPhase(t), this._air);
        u.cloud.value = air.cloud;
        u.deep.value = air.deep * (1 + 0.6 * night);
        u.haze.value = air.haze * (1 - night);
        u.lattice.value = air.lattice;
        u.calm.value = air.calm;

        // The sky's frame: y is the pole, x and z turn about it.
        const P = SKY_POLE;
        const pole = this._pole.set(
            Math.sin(P.azimuth) * Math.cos(P.elevation),
            Math.sin(P.elevation),
            -Math.cos(P.azimuth) * Math.cos(P.elevation),
        );
        const ex = this._ex.set(Math.cos(P.azimuth), 0, Math.sin(P.azimuth));
        const ez = this._ez.crossVectors(ex, pole).normalize();
        const turn = skyTurn(t, this.moodStep);
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        u.skyRot.value.set(
            ex.x * c + ez.x * s,
            ex.y * c + ez.y * s,
            ex.z * c + ez.z * s,
            pole.x,
            pole.y,
            pole.z,
            ez.x * c - ex.x * s,
            ez.y * c - ex.y * s,
            ez.z * c - ex.z * s,
        );

        // The planet: where it stands, its rings' roll and opening, and its fade at the ends
        // of its arc (it rises and sets behind the ranges).
        const planet = planetAt(this.tune.planetTime ?? t, this._planet);
        const ce = Math.cos(planet.elevation);
        const dir = u.planetDir.value.set(Math.sin(planet.azimuth) * ce, Math.sin(planet.elevation), -Math.cos(planet.azimuth) * ce);
        const east0 = this._a.set(-dir.z, 0, dir.x).normalize();
        const north0 = this._b.crossVectors(east0, dir).normalize();
        const cr = Math.cos(planet.roll);
        const sr = Math.sin(planet.roll);
        u.planetEast.value.copy(east0).multiplyScalar(cr).addScaledVector(north0, sr);
        u.planetNorth.value.copy(north0).multiplyScalar(cr).addScaledVector(east0, -sr);
        const show = planet.up ? smooth(0, 0.05, planet.arc) * (1 - smooth(0.95, 1, planet.arc)) : 0;
        u.planet.value.set(PLANET.radius, planet.open, show, 1.25);

        // The sun's height: its slow ride in the pass, and its setting at a run's end.
        this.setSunElevation(SUN.elevation + sunDrift(t) - SHOW.sunset.drop * night);
    }

    // ── Mood: the clock turns the light, a level is a step on top ───────────

    /**
     * The game's level. Each level is one mood forward on top of the clock's own turn; the step
     * eases in over a few seconds (`silent` snaps it, for a rebuild or a seek).
     */
    setLevel(level, { silent = false } = {}) {
        const asked = Math.round(Number(level));
        this.level = Number.isFinite(asked) ? Math.max(1, asked) : 1;
        if (silent) this.applyMood(1);
    }

    /**
     * Where the dusk stands on its wheel of moods, heading for: one step a level, turned on by the
     * clock. The whole part names a mood, the fraction is how far it has melted into the next.
     */
    moodPhase() {
        return (this.level - 1) + moodDrift(this.time, MOOD_PERIOD, MOOD_HOLD);
    }

    /** The live mood's name (diagnostics). */
    moodName() {
        return moodName(this.moodStep + moodDrift(this.time, MOOD_PERIOD, MOOD_HOLD));
    }

    /** The live air's name (diagnostics). */
    airName() {
        return airName(this.tune.air ?? airPhase(this.clockTime()));
    }

    /**
     * Set the live mood's uniforms. The clock's turn is exact (a function of the time alone, so a
     * seek and a replay agree); the level's step eases in by `k` (1 snaps), the short way round.
     */
    applyMood(k) {
        this.moodStep = easeStep(this.moodStep, this.level - 1, k, MOOD_COUNT);
        const mood = moodAt(this.moodStep + moodDrift(this.time, MOOD_PERIOD, MOOD_HOLD), this._mood);
        const { u } = this;
        for (let i = 0; i < MOOD_KEYS.length; i += 1) {
            const key = MOOD_KEYS[i];
            const c = mood[key];
            u.mood[key].value.set(c[0], c[1], c[2]);
        }
        u.starGain.value = mood.stars * (this._air.stars ?? 1) * (1 + 0.5 * u.night.value);
        // The grid and the scan lines: the mood's colours, swung by a hot hand.
        const shift = u.comboShift.value;
        const out = this._swing;
        const write = (target, from, to) => {
            swing(mood[from], mood[to], shift, out);
            target.value.set(out[0], out[1], out[2]);
        };
        write(u.gridNear, 'grid', 'gridHot');
        write(u.gridFar, 'gridFar', 'gridFarHot');
        write(u.scanLow, 'scanLow', 'scanLowHot');
        write(u.scanHigh, 'scanHigh', 'scanHighHot');
        u.ridge.value.set(mood.ridge[0], mood.ridge[1], mood.ridge[2]);
        u.ridgeFar.value.set(mood.ridgeFar[0], mood.ridgeFar[1], mood.ridgeFar[2]);
    }

    /** The event layers' uniforms from their slots (plain loops: nothing allocated a frame). */
    updateSlots(t) {
        const { u } = this;
        const motion = this.motion ?? 1;
        // Floor light waves: in from 700 units to past the camera in ~2.8 s, or (an exhale)
        // out from the camera toward the horizon.
        for (let i = 0; i < this.rings.length; i += 1) {
            const ring = this.rings[i];
            const age = t - ring.t0;
            const v = this.ringU[i].value;
            if (age < 0 || age > 3 || ring.energy <= 0) {
                v.z = 0;
            } else {
                const radius = ring.out ? 14 + age * 270 : Math.max(0, 700 - age * 250);
                v.set(radius, 1 / (5 + radius * 0.05), ring.energy * ringEnvelope(age), 0);
            }
        }

        // Hologram halos: out of the sun's rim to ~three radii in 2.2 s, fading as they go; a
        // spun one's dashes wheel round as it goes.
        for (let i = 0; i < this.holos.length; i += 1) {
            const holo = this.holos[i];
            const age = t - holo.t0;
            const v = this.holoU[i].value;
            if (age < 0 || age > 2.2 || holo.energy <= 0) {
                v.z = 0;
            } else {
                const k = age / 2.2;
                const radius = 1.04 + 1.9 * (1 - (1 - k) ** 2);
                v.set(radius, 1 / (0.08 + k * 0.2), holo.energy * holoEnvelope(age), holo.spin * age);
            }
        }

        // Meteors: the live ones packed at the front, two rows each.
        const shootRows = u.shoots.array;
        let live = 0;
        for (let i = 0; i < this.shoots.length; i += 1) {
            const star = this.shoots[i];
            const age = (t - star.t0) / star.life;
            if (age < 0 || age >= 1) continue;
            shootRows[live * 2].set(star.az, star.el, star.heading, age);
            shootRows[live * 2 + 1].set(star.reach, star.tail, star.gain, star.width);
            live += 1;
        }
        u.shootCount.value = live;

        // Lock ripples spread at 46 units/s and fade over 1.8 s, riding the floor's scroll.
        for (let i = 0; i < this.ripples.length; i += 1) {
            const rip = this.ripples[i];
            const age = t - rip.t0;
            const v = this.rippleU[i].value;
            if (age < 0 || age >= 1.8 || rip.energy <= 0) {
                v.w = 0;
            } else {
                v.set(rip.x, rip.z + (this.scrollRun - rip.run), 2 + age * 46, rip.energy * rippleEnvelope(age));
            }
        }

        // A hard drop's shock: a square running out along the grid, riding the scroll.
        for (let i = 0; i < this.shocks.length; i += 1) {
            const shock = this.shocks[i];
            const age = t - shock.t0;
            const v = this.shockU[i].value;
            if (age < 0 || age >= SHOW.shock.life || shock.energy <= 0) {
                v.w = 0;
            } else {
                const k = age / SHOW.shock.life;
                v.set(
                    shock.x,
                    shock.z + (this.scrollRun - shock.run),
                    3 + age * SHOW.shock.speed,
                    shock.energy * Math.min(1, age / 0.05) * (1 - k) ** 1.4,
                );
            }
        }

        // Scan sweeps roll in from behind the far range (3000 → 350 units) in 1.5 s at their
        // own pace (a deeper cascade wave sweeps faster): (distance, energy) pairs, two a vec4.
        for (let i = 0; i < this.contours.length; i += 1) {
            const wave = this.contours[i];
            const v = this.contourV[i >> 1];
            const age = (t - wave.t0) * wave.speed;
            const alive = age >= 0 && age < 1.6 && wave.energy > 0;
            const dist = alive ? 3000 - age * 1770 : 0;
            const energy = alive ? wave.energy * contourEnvelope(age) : 0;
            if (i & 1) {
                v.z = dist;
                v.w = energy;
            } else {
                v.x = dist;
                v.y = energy;
            }
        }

        // Ridgeline pulses run out along the crests from the pass, both ways at once.
        const pulseRows = u.ridgePulses.array;
        live = 0;
        for (let i = 0; i < this.pulses.length; i += 1) {
            const pulse = this.pulses[i];
            const age = t - pulse.t0;
            if (age < 0 || pulse.energy <= 0) continue;
            const at = age * pulse.speed;
            if (at >= SHOW.pulse.spent) continue;
            const envelope = Math.min(1, age / 0.07) * (1 - smooth(1.3, SHOW.pulse.spent, at));
            pulseRows[live].set(at, 1 / pulse.width, pulse.energy * envelope, pulse.range);
            live += 1;
        }
        u.ridgePulseCount.value = live;

        // Laser beams: each sweeps from one angle to another over its life.
        const beamRows = u.beams.array;
        live = 0;
        for (let i = 0; i < this.beams.length; i += 1) {
            const beam = this.beams[i];
            const age = t - beam.t0;
            if (age < 0 || age >= beam.life || beam.energy <= 0) continue;
            const k = age / beam.life;
            const sweep = motion * easeOut(k) + (1 - motion) * 0.5;
            const envelope = Math.min(1, age / 0.1) * (1 - smooth(0.62, 1, k));
            beamRows[live].set(beam.from + (beam.to - beam.from) * sweep, beam.width, beam.energy * envelope, beam.hue);
            live += 1;
        }
        u.beamCount.value = live;

        // Racers: lights running out along the grid's lines toward the horizon.
        const racerRows = u.racers.array;
        live = 0;
        for (let i = 0; i < this.racers.length; i += 1) {
            const racer = this.racers[i];
            const age = t - racer.t0;
            if (age < 0 || age >= SHOW.racer.life || racer.energy <= 0) continue;
            const k = age / SHOW.racer.life;
            const envelope = Math.min(1, age / 0.25) * (1 - smooth(0.6, 1, k));
            racerRows[live].set(racer.x, racer.z - age * SHOW.racer.speed, racer.energy * envelope, SHOW.racer.tail);
            live += 1;
        }
        u.racerCount.value = live;

        // A twist's triangle: it grows in, spins home (a third of a turn) and fades.
        const tri = this.triangle;
        const T = SHOW.triangle;
        const triAge = t - tri.t0;
        if (triAge < 0 || triAge >= T.life || tri.energy <= 0) {
            u.tri.value.z = 0;
        } else {
            const turn = tri.dir * T.turn * (1 - easeOut(triAge / T.spin)) * motion;
            const grow = 0.8 + 0.2 * easeOut(triAge / 0.45);
            const envelope = Math.min(1, triAge / 0.07) * (1 - smooth(T.life * 0.6, T.life, triAge));
            u.tri.value.set(T.side * grow, turn, tri.energy * envelope, tri.echoes);
        }

        // Back-to-back's twins: out and back.
        const twin = this.twins;
        const twinAge = t - twin.t0;
        if (twinAge < 0 || twinAge >= SHOW.twins.life || twin.energy <= 0) {
            u.twin.value.y = 0;
        } else {
            const k = twinAge / SHOW.twins.life;
            const out = Math.sin(Math.PI * Math.min(1, k * 1.08)) ** 0.75;
            const envelope = Math.min(1, twinAge / 0.08) * (1 - smooth(0.75, 1, k));
            u.twin.value.set(twin.reach * out * (0.35 + 0.65 * motion), twin.energy * envelope);
        }

        // A level's scan bar climbs the sky.
        const scanAge = t - this.scan.t0;
        if (scanAge < 0 || scanAge >= SHOW.scan.life || this.scan.energy <= 0) {
            u.scan.value.y = 0;
        } else {
            const k = Math.min(1, scanAge / SHOW.scan.climb);
            const climb = k * k * (3 - 2 * k);
            const envelope = Math.min(1, scanAge / 0.12) * (1 - smooth(SHOW.scan.climb * 0.8, SHOW.scan.life, scanAge));
            // The bar and its wake cross the whole sky: held back under Reduce flashing.
            u.scan.value.set(0.004 + SHOW.scan.top * climb, this.scan.energy * envelope * flashScale());
        }

        // A comet hangs in the sky and drifts.
        const { comet } = this;
        const cometAge = t - comet.t0;
        if (cometAge < 0 || cometAge >= comet.life || comet.energy <= 0) {
            u.comet.value.w = 0;
        } else {
            const az = comet.az + comet.vaz * cometAge;
            const el = comet.el + comet.vel * cometAge;
            // Its tail streams away from the sun.
            const heading = Math.atan2(el - Math.asin(this.sunDir.y), az);
            const envelope = smooth(0, 4, cometAge) * (1 - smooth(comet.life - 5, comet.life, cometAge));
            u.comet.value.set(az, el, heading, comet.energy * envelope);
        }
    }

    seek(time) {
        this.time = time;
        this.sunPulse = 0;
        this.sunSwell.reset();
        this.crownSwell.reset();
        this.raySwell.reset();
        this.surge.reset();
        this.heat = this.surge.sample(Number.NaN);
        this.combo.reset();
        this.chainLen = 0;
        this.lastLockAt = -1e6;
        this.lastLockCleared = true;
        this.hardDropAt = -1e6;
        this.b2bStreak = 0;
        this.glitch = 0;
        this.comboShift = 0;
        this.comboTarget = 0;
        this.scrollExtra = 0;
        this.pulsePhase = (time / AMBIENT_PULSE.period) % 1;
        this.slitPhase = time * SLITS.speed;
        this.dustRun = time;
        this.meteorDue = 0;
        this.rayTurn = (time * 0.04) % (Math.PI * 2);
        this.slitFill = 0;
        this.slitGoal = 0;
        this.ended = false;
        this.nightK = 0;
        this.u.night.value = 0;
        this.rings.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.holos.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.shoots.forEach((r) => { r.t0 = -1e6; });
        this.ripples.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.contours.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.beams.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.pulses.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.shocks.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.racers.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.triangle.t0 = -1e6;
        this.twins.t0 = -1e6;
        this.scan.t0 = -1e6;
        this.comet.t0 = -1e6;
        this.comet.energy = 0;
        this.ambientShootWindow = undefined;
        this.happenWindow = undefined;
        this.fx?.clear();
        this.flight?.clear();
        this.applyClocks(0);
        this.applyMood(1);
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /** A hard drop: the lock that comes with it (the same moment) lands harder. */
    onHardDrop() {
        this.hardDropAt = this.time;
    }

    /**
     * Where a locked piece's hologram rises (world x, z) and how far it glides in along the grid
     * (`travel`, units); `fh` is the view's level forward. The grid runs in from the sun's
     * point, so every lane fans out from there. With a board on screen the sun sits left of
     * it, and only there do the lanes run in at the camera (right of the board they run off
     * sideways), so every piece comes in on the sun's side: its lane is chosen by where it
     * comes in (HOLO_PATH.near), by the column it landed in — the board's left column farthest
     * out, its right column beside the board — and it runs from near the sun out to there,
     * never behind the board, however wide the piece (`halfWidth`, units). With no board the
     * lanes spread across the whole view.
     */
    hologramPath(col, r, halfWidth = 0) {
        const { lerp } = THREE.MathUtils;
        const P = HOLO_PATH;
        const { fwd, right } = this.viewBasis();
        const tanH = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2) * this.lens.aspect;
        const fh = this._a.set(fwd.x, 0, fwd.z).normalize();
        // One unit along the grid's run (+z) brings a point this much nearer in view depth.
        const closing = Math.max(0.3, -fh.z);
        const near = lerp(P.near[0], P.near[1], r());
        const far = lerp(P.far[0], P.far[1], r());
        const b = this.board;
        let nx = -0.85 + (col / 9) * 1.7;
        if (b && b.x0 > 0.16) {
            // The piece's whole width stays clear of the board.
            const byBoard = b.x0 * 2 - 1 - 0.08 - halfWidth / (tanH * near);
            nx = lerp(P.edge, Math.max(P.edge, byBoard), col / 9);
        }
        const cam = this._camRest;
        const travel = (far - near) / closing;
        return {
            x: cam.x + fh.x * near + right.x * nx * tanH * near,
            z: cam.z + fh.z * near + right.z * nx * tanH * near - travel,
            travel,
            fh,
        };
    }

    /**
     * A piece lock stands its hologram up in the glass: ONE solid piece in the piece's colour,
     * far out on the floor on the sun's side of the board (hologramPath), gliding in along the
     * grid toward the camera and lying back down in the glass as it arrives; a ripple ring
     * spreads out from where it rose and a few pixels rise off it.
     * A hard drop lands harder: a pillar of light strikes up out of the glass where it rose, a
     * square shock runs out along the grid's lines, a stronger ripple, more pixels, a bigger thump.
     */
    onPieceLock(piece) {
        const r = this.rand;
        const t = this.time;
        const hard = this.hardDropAt === t;
        this.hardDropAt = -1e6;
        // A lock after the run's end is a new run: the sun comes back up.
        if (this.ended) this.onSessionStart();
        // The chain: a lock that clears nothing ends it (checkChain sees it next frame).
        this.combo.notePieceLocked();
        this.lastLockAt = t;
        this.lastLockCleared = false;

        const type = pieceType(piece);
        const color = pieceColor(piece, type, this._color);
        const col = Number.isFinite(piece?.x) ? THREE.MathUtils.clamp(piece.x, 0, 9) : Math.floor(r() * 10);
        const turns = Number.isFinite(piece?.rotation) ? piece.rotation & 3 : 0;
        const cells = TETROMINO_SHAPES[type].map(([x, y]) => {
            let px = x;
            let py = y;
            for (let k = 0; k < turns; k += 1) [px, py] = [-py, px];
            return [px, py];
        });
        const S = GRID_SPACING;
        const xs = cells.map(([x]) => x);
        const ys = cells.map(([, y]) => y);
        const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
        const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
        const halfWidth = ((Math.max(...xs) - Math.min(...xs) + 1) * S) / 2;
        // Far out on the glass, gliding in to where the glass is steep enough to read the shape;
        // the path is the piece's middle.
        const path = this.hologramPath(col, r, halfWidth);
        const { fh } = path;
        // Snap to the grid as it stands now (cell centres sit half a cell off the lines).
        const scroll = this.u.scroll.value;
        const cx = (Math.floor(path.x / S - midX) + 0.5) * S;
        const cz = scroll + (Math.floor((path.z - scroll) / S + midY) + 0.5) * S;
        // One solid piece: each cell knows which of its sides join the piece (no seams).
        const bits = pieceOutlineBits(cells);
        const placed = cells.map(([px, py], i) => {
            const x = cx + px * S;
            const z = cz - py * S;
            return {
                x, z, bits: bits[i], depth: (x - this._camRest.x) * fh.x + (z - this._camRest.z) * fh.z,
            };
        });
        // Nearest the camera first: the fx draw the farther cells before the nearer ones.
        placed.sort((p, q) => p.depth - q.depth);
        this.fx.spawnPiece(t, placed, color, this.tileRun, this.tileRun + path.travel);
        this.spawnRipple(path.x, path.z, hard ? 1.5 : 1);
        if (hard) {
            const motion = this.motion ?? 1;
            this.spawnShock(path.x, path.z, 0.9 * (0.5 + 0.5 * motion));
            this.fx.spawnPillar(t, cx + midX * S, cz - midY * S, this.scrollRun, color, 1);
        }
        const pixels = hard ? 10 : 6;
        for (let i = 0; i < pixels; i += 1) {
            const [px, py] = cells[i % cells.length];
            this.fx.spawnPixel(
                t + r() * 0.2,
                cx + px * S + (r() - 0.5) * S,
                0.5,
                cz - py * S + (r() - 0.5) * S,
                (r() - 0.5) * 1.5,
                (hard ? 7 : 5) + r() * 5,
                (r() - 0.5) * 1.5,
                1.4 + r() * 0.8,
                color,
                4 + r() * 3,
                {
                    drag: 0.8, lift: 0.5, flicker: 10 + r() * 10, phase: r() * 6.28,
                },
            );
        }
        this.sunSwell.hit(hard ? 0.1 : 0.06, t);
        this.surge.lock({ hardDrop: hard }, t);
    }

    /**
     * A line clear (one wave of a lock's clear; `cascade` = its depth, 1 for the first). Each
     * cascade wave rolls through deeper, brighter and faster than the last, and each step of the
     * true combo lifts what the next clear lights. More lines bring more instruments: a single
     * is a pulse along the ridgelines (with the glass's wave and the ranges' scan), a double
     * adds the halo, a triple the laser fan, a quad the sunburst.
     */
    onLineClear(lines = 1, { cascade = 1 } = {}) {
        const t = this.time;
        const n = Math.max(1, Math.min(4, lines | 0));
        const deeper = Math.max(0, Math.round(Number(cascade) || 1) - 1);
        this.lastLockCleared = true;
        const combo = this.combo.noteLineClear();
        this.chainLen = combo;
        const steps = Math.min(10, Math.max(0, combo - 1));
        // The chain's meter: a slit of the sun for each step.
        this.slitGoal = Math.min(6, steps);
        // The ridgelines: a pulse of light runs out along the crests from the pass, at once.
        const pulseEnergy = (0.55 + 0.16 * n) * (1 + 0.18 * deeper) + 0.04 * steps;
        this.triggerRidgePulse(pulseEnergy, { speed: SHOW.pulse.speed * (1 + 0.16 * deeper) });
        if (n >= 3) this.triggerRidgePulse(pulseEnergy * 0.7, { delay: 0.16 });
        // The floor: a wave of light rolls in from the horizon; a quick hand's clears join the
        // one still waiting below it and arrive as one brighter band.
        this.triggerRing((0.5 + 0.2 * n) * (1 + 0.18 * deeper) + 0.04 * steps, 0.6);
        // The ranges: a laser sweep rolls through toward the camera.
        this.triggerContour((0.5 + 0.15 * n) * (1 + 0.22 * deeper) + 0.035 * steps, 1 + 0.16 * deeper);
        if (n >= 2 || steps >= 2) this.triggerHolo(0.6 + 0.15 * n + 0.04 * steps);
        if (n === 3) this.triggerBeams('triple');
        this.sunSwell.hit(0.12 * n + 0.05 * deeper + 0.03 * steps, t);
        this.emitRisingPixels(this.burstCount(0.05 * n + 0.01 * steps, 22 * n + 6 * Math.min(6, steps)));
        if (n >= 4) {
            // The quad: the sunburst.
            this.triggerHolo(1.2, 0.35);
            this.triggerBeams('quad');
            this.raySwell.hit(1, t);
            this.sunSwell.hit(0.7, t);
            this.glitch = Math.min(1, this.glitch + 0.5);
            this.emitSunBurst(this.burstCount(0.45, 220));
        }
        this.comboTarget = Math.min(1, Math.max(this.comboTarget, 0.09 * steps + 0.12 * deeper));
        // The surge: a lock's clear once (with its combo), each wave past the first one more wave.
        if (deeper === 0) this.surge.clear({ lines: n, combo }, t);
        else this.surge.clear({ lines: n, cascade: 2 }, t);
    }

    /**
     * A cascade wave past the first (`count` = its depth; it comes before the wave's clear): a
     * volley of meteors falls away from the sun, one more a wave, and the palette swings.
     */
    onCombo(count = 1) {
        const c = Math.max(0, count | 0);
        this.comboTarget = Math.min(1, Math.max(this.comboTarget, c * 0.16));
        this.sunSwell.hit(0.2, this.time);
        this.glitch = Math.min(1, this.glitch + 0.3 + c * 0.05);
        this.emitVolley(Math.min(5, Math.max(1, c)));
        if (c >= 2) this.emitSunBurst(this.burstCount(0.12 + c * 0.06, 60 + 28 * c));
    }

    /**
     * A level-up's show (the mood's step comes with setLevel, which the theme calls whether or not
     * background effects are on: that setting gates reactions, not the light): the scan bar climbs
     * the sky, the ranges light far to near, lights race out along the grid.
     */
    onLevelUp() {
        const t = this.time;
        this.sunSwell.hit(0.8, t);
        this.glitch = Math.min(1, this.glitch + 0.6);
        this.scan.t0 = t;
        this.scan.energy = 1;
        this.triggerRidgePulse(0.9, { range: 0 });
        this.triggerRidgePulse(1.0, { range: 1, delay: 0.22 });
        this.triggerRidgePulse(1.1, { range: 2, delay: 0.44 });
        this.emitRacers(SLOTS.racers, t, this.rand);
        this.triggerRing(1.0, 0.6);
        this.triggerHolo(1.2);
        this.triggerContour(1.2, 1.1);
        this.emitShootingStar();
        this.emitSunBurst(this.burstCount(0.4, 180));
        this.surge.levelUp(t);
    }

    /**
     * A twist: the neon triangle stands round the sun and spins home, with an echo for each line
     * it clears. One that clears nothing still turns a small one.
     */
    onTwist(lineCount = 0) {
        const t = this.time;
        const n = Math.max(0, lineCount | 0);
        const tri = this.triangle;
        const still = t - tri.t0 < SHOW.triangle.life * 0.6 ? tri.energy : 0;
        tri.energy = softCeiling(Math.max(still, n > 0 ? 0.8 + 0.12 * n : 0.55), 1.1, 1.4);
        tri.echoes = Math.max(n, t - tri.t0 < 0.3 ? tri.echoes : 0);
        tri.dir = -tri.dir;
        tri.t0 = t;
        this.sunSwell.hit(n > 0 ? 0.15 : 0.08, t);
        if (n === 0) this.emitRisingPixels(this.burstCount(0.03, 14));
        const k = n > 0 ? 1 : 0.5;
        this.surge.punch.hit(SURGE_WEIGHTS.punch.twist * k, t);
        this.surge.level.hit(SURGE_WEIGHTS.heat.twist * k, t);
    }

    /**
     * Back-to-back: the sun's twins slide out of it and fold back, farther with each streak, and
     * a double laser sweep rolls through the ranges.
     */
    onB2B(active = true) {
        if (active === false) {
            this.b2bStreak = 0;
            return;
        }
        const t = this.time;
        this.b2bStreak += 1;
        const k = 1 + 0.25 * Math.min(4, this.b2bStreak - 1);
        const W = SHOW.twins;
        this.twins.t0 = t;
        this.twins.energy = Math.min(1.5, 0.85 * k);
        this.twins.reach = Math.min(W.most, W.reach + W.perStreak * (this.b2bStreak - 1));
        this.triggerContour(0.9 * k, 1.12);
        this.triggerContour(0.9 * k, 1.12, 0.22);
        this.sunSwell.hit(0.3 * k, t);
        this.surge.punch.hit(SURGE_WEIGHTS.punch.b2b, t);
        this.surge.level.hit(SURGE_WEIGHTS.heat.b2b, t);
    }

    /**
     * The perfect clear (it comes ~0.36 s after the clear's last wave): a crown on the clear
     * still playing, not a new clear. The coronation: the slits close and the whole disc burns
     * gold, its rays stand round it, seven gold beams crown it, every ridgeline is gilded from
     * the pass outward, meteors fall, and the glass breathes the light back out to the horizon
     * as it lets go.
     */
    onPerfectClear() {
        const t = this.time;
        this.crownSwell.hit(1, t);
        this.sunSwell.hit(0.4, t);
        this.raySwell.hit(0.7, t);
        this.triggerBeams('crown');
        this.triggerRidgePulse(1.5, { speed: SHOW.pulse.speed * 0.6, width: SHOW.pulse.width * 2.4 });
        this.triggerRidgePulse(1.1, { speed: SHOW.pulse.speed * 0.6, width: SHOW.pulse.width * 2.4, delay: 0.5 });
        this.triggerHolo(1.4, 0, { spin: 2 });
        this.triggerHolo(1.1, 0.45, { spin: -2 });
        this.triggerContour(1.6, 1.25);
        this.triggerRing(1.0, 0.5, { out: true });
        this.emitVolley(6);
        this.emitSunBurst(this.burstCount(0.35, 160));
        this.surge.punch.hit(SURGE_WEIGHTS.punch.perfect, t);
        this.surge.level.hit(SURGE_WEIGHTS.heat.perfect, t);
    }

    /** The run is over: the sun goes down behind the pass and stays down until the next run. */
    onGameOver() {
        if (this.ended) return;
        this.ended = true;
        this.slitGoal = 0;
        this.triggerRing(0.7, 0.2, { out: true });
    }

    /** A new run: after a run's end it is the sunrise (the sun comes up, a pulse runs the ridges). */
    onSessionStart() {
        if (!this.ended) return;
        this.ended = false;
        this.raySwell.hit(0.45, this.time);
        this.triggerRidgePulse(0.9);
        this.triggerRing(0.6, 0.3);
    }

    /** Leaving the mode with the sun still down lifts the night quietly. */
    onSessionStop() {
        this.ended = false;
    }

    /**
     * After a lock that cleared nothing, a chain of three or more is over: the glass exhales,
     * a soft wave running out to the horizon (the palette eases back by itself), and the sun's
     * lit slits go out.
     */
    checkChain() {
        if (this.lastLockCleared || !(this.time > this.lastLockAt)) return;
        this.lastLockCleared = true;
        const chain = this.chainLen;
        this.chainLen = 0;
        this.slitGoal = 0;
        if (chain >= 3) this.triggerRing(0.3 + 0.05 * Math.min(10, chain), 0, { out: true });
    }

    /**
     * A floor light wave in from the horizon (or `out` to it) after `delay` s. One launched while
     * another still waits below the horizon joins it; otherwise it takes the weakest slot.
     */
    triggerRing(energy, delay = 0, { out = false } = {}) {
        const now = this.time;
        const at = now + delay;
        for (const ring of this.rings) {
            if (ring.out === out && ring.energy > 0 && ring.t0 > now - 0.05 && Math.abs(at - ring.t0) < RING_JOIN) {
                ring.energy = softCeiling(ring.energy + energy, 1.3, 2);
                return;
            }
        }
        const ring = weakest(this.rings, (s) => {
            const age = now - s.t0;
            if (s.energy <= 0 || age > 3) return 0;
            return age < 0.15 ? s.energy : s.energy * ringEnvelope(age);
        });
        ring.t0 = at;
        ring.energy = energy;
        ring.out = out;
    }

    /**
     * A halo out of the sun after `delay` s (`spin` turns its dashes, dash periods a second).
     * One launched with another joins it; otherwise it takes the weakest slot.
     */
    triggerHolo(energy, delay = 0, { spin = 0, join = true } = {}) {
        const now = this.time;
        const at = now + delay;
        if (join) {
            for (const holo of this.holos) {
                if (holo.energy > 0 && Math.abs(at - holo.t0) < HOLO_JOIN) {
                    holo.energy = softCeiling(holo.energy + energy, 1.2, 1.8);
                    if (Math.abs(spin) > Math.abs(holo.spin)) holo.spin = spin;
                    return;
                }
            }
        }
        const holo = weakest(this.holos, (s) => {
            const age = now - s.t0;
            if (s.energy <= 0 || age > 2.2) return 0;
            return age < 0.1 ? s.energy : s.energy * holoEnvelope(age);
        });
        holo.t0 = at;
        holo.energy = energy;
        holo.spin = spin;
    }

    /** A scan sweep through the ranges (`speed` × the usual pace) after `delay` s. */
    triggerContour(energy, speed = 1, delay = 0) {
        const now = this.time;
        const at = now + delay;
        for (const wave of this.contours) {
            if (wave.energy > 0 && Math.abs(at - wave.t0) < CONTOUR_JOIN) {
                wave.energy = softCeiling(wave.energy + energy, 1.4, 2.2);
                wave.speed = Math.max(wave.speed, speed);
                return;
            }
        }
        const wave = weakest(this.contours, (s) => {
            const age = (now - s.t0) * s.speed;
            if (s.energy <= 0 || age > 1.6) return 0;
            return age < 0.12 ? s.energy : s.energy * contourEnvelope(age);
        });
        wave.t0 = at;
        wave.energy = energy;
        wave.speed = speed;
    }

    /**
     * A pulse of light out along the ridgelines from the pass after `delay` s (`range` = the one
     * range it runs on, or −1 for all three). One launched with another on the same ranges joins
     * it; otherwise it takes a spent slot, else the one farthest along.
     */
    triggerRidgePulse(energy, {
        speed = SHOW.pulse.speed, width = SHOW.pulse.width, range = -1, delay = 0,
    } = {}) {
        const now = this.time;
        const at = now + delay;
        for (const pulse of this.pulses) {
            if (pulse.energy > 0 && pulse.range === range && Math.abs(at - pulse.t0) < 0.09) {
                pulse.energy = softCeiling(pulse.energy + energy, 1.4, 2.1);
                pulse.speed = Math.max(pulse.speed, speed);
                return;
            }
        }
        const pulse = weakest(this.pulses, (s) => {
            const age = now - s.t0;
            if (s.energy <= 0 || age * s.speed >= SHOW.pulse.spent) return 0;
            return age < 0 ? s.energy : s.energy * (1 - (age * s.speed) / SHOW.pulse.spent);
        });
        pulse.t0 = at;
        pulse.energy = energy;
        pulse.speed = speed;
        pulse.width = width;
        pulse.range = range;
    }

    /**
     * Laser beams out of the pass: a `triple`'s fan of three, a `quad`'s crown of five opening
     * across the sky, a perfect clear's `crown` of seven gold ones. Each takes a spent slot,
     * else the beam nearest its end.
     */
    triggerBeams(kind) {
        const t = this.time;
        const take = () => weakest(this.beams, (s) => {
            const age = t - s.t0;
            if (s.energy <= 0 || age >= s.life) return 0;
            return age < 0 ? s.energy : s.energy * (1 - age / s.life);
        });
        const add = (from, to, life, width, energy, hue, delay = 0) => {
            const beam = take();
            beam.t0 = t + delay;
            beam.life = life;
            beam.from = from;
            beam.to = to;
            beam.width = width;
            beam.energy = energy;
            beam.hue = hue;
        };
        if (kind === 'triple') {
            add(-0.16, -0.62, 1.7, 0.03, 0.95, 0);
            add(0.02, 0.0, 1.7, 0.03, 0.85, 1, 0.05);
            add(0.16, 0.62, 1.7, 0.03, 0.95, 0, 0.1);
        } else if (kind === 'quad') {
            for (let i = 0; i < 5; i += 1) {
                const k = i - 2;
                add(k * 0.1, k * 0.5, 2.3, 0.034, 1.15, i % 2, Math.abs(k) * 0.05);
            }
        } else {
            for (let i = 0; i < 7; i += 1) {
                const k = i - 3;
                add(k * 0.2, k * 0.36, 4.2, 0.03, 1.05, 2, Math.abs(k) * 0.07);
            }
        }
    }

    /** A lock's ripple in the glass at (x, z): the weakest of the four rings makes way. */
    spawnRipple(x, z, energy) {
        const now = this.time;
        const rip = weakest(this.ripples, (s) => {
            const age = now - s.t0;
            if (s.energy <= 0 || age >= 1.8) return 0;
            return age < 0.08 ? s.energy : s.energy * rippleEnvelope(age);
        });
        rip.t0 = now;
        rip.x = x;
        rip.z = z;
        rip.run = this.scrollRun;
        rip.energy = energy;
    }

    /** A hard drop's square shock at (x, z): the weaker of the two makes way. */
    spawnShock(x, z, energy) {
        const now = this.time;
        const shock = weakest(this.shocks, (s) => {
            const age = now - s.t0;
            if (s.energy <= 0 || age >= SHOW.shock.life) return 0;
            return s.energy * (1 - age / SHOW.shock.life);
        });
        shock.t0 = now;
        shock.x = x;
        shock.z = z;
        shock.run = this.scrollRun;
        shock.energy = energy;
    }

    /**
     * Now and then at rest a shooting star crosses the sky: one in each AMBIENT_SHOOT_PERIOD
     * window, at a time and on a path drawn from the window's own hash, so a seek lands on the
     * same star. None under reduced motion.
     */
    updateAmbientShoot(t, motion) {
        if (motion < 0.5) return;
        const k = Math.floor(t / AMBIENT_SHOOT_PERIOD);
        if (this.ambientShootWindow === k) return;
        const r = windowRandom(k);
        const start = k * AMBIENT_SHOOT_PERIOD + 1 + r() * (AMBIENT_SHOOT_PERIOD - 3);
        if (t < start) return;
        this.ambientShootWindow = k;
        // Fired late (a seek past it, a long frame): it is already over.
        if (t - start < 0.9) this.emitShootingStar(start, r);
    }

    /**
     * The sky's visitors: in each HAPPENING_PERIOD window one may come (neon-dusk-clock.js), at
     * a time and with numbers drawn from the window's own hash, so a seek lands in the middle of
     * the same happening. None under reduced motion.
     */
    updateHappenings(t, motion) {
        if (motion < 0.5 || !this.tune.happenings) return;
        const k = Math.floor(t / HAPPENING_PERIOD);
        if (this.happenWindow === k) return;
        const h = happeningOf(k);
        if (t < h.start) return;
        this.happenWindow = k;
        if (t - h.start < h.duration) this.startHappening(h.kind, h.start, h.random);
    }

    /** Begin a happening of `kind` as of `t0` (it may already be under way) with generator `r`. */
    startHappening(kind, t0 = this.time, r = this.rand) {
        const half = this.halfField();
        const boarded = Boolean(this.board && this.board.x0 > 0.16);
        // With a board up the open sky is to its right; without one, either side.
        const eitherSide = () => (r() < 0.5 ? -1 : 1);
        if (kind === 'meteors') {
            // A shower from one radiant, high over the open sky.
            const side = boarded ? 1 : eitherSide();
            const az0 = this.yaw + side * half * (0.45 + 0.3 * r());
            const count = 5 + Math.floor(r() * 3);
            for (let i = 0; i < count; i += 1) {
                const heading = -Math.PI / 2 + (r() - 0.5) * 1.5;
                this.emitMeteor({
                    t0: t0 + i * (0.5 + 0.5 * r()),
                    az: az0 + (r() - 0.5) * 0.3,
                    el: 0.36 + r() * 0.12,
                    heading,
                    reach: 0.2 + r() * 0.12,
                    tail: 0.1,
                    gain: 0.9,
                });
            }
        } else if (kind === 'satellite') {
            const dir = r() < 0.5 ? -1 : 1;
            this.emitMeteor({
                t0,
                life: 16,
                az: this.yaw - dir * half * 1.05,
                el: 0.3 + r() * 0.14,
                heading: dir > 0 ? (r() - 0.5) * 0.12 : Math.PI + (r() - 0.5) * 0.12,
                reach: half * 2.2,
                tail: 0,
                gain: 0.5,
                width: 1.25,
            });
        } else if (kind === 'comet') {
            const side = boarded ? 1 : eitherSide();
            const { comet } = this;
            comet.t0 = t0;
            comet.life = 22;
            comet.az = this.yaw + side * half * (0.55 + 0.25 * r());
            comet.el = 0.3 + r() * 0.1;
            comet.vaz = -side * 0.0022;
            comet.vel = -0.0012;
            comet.energy = 0.9;
        } else if (kind === 'racers') {
            this.emitRacers(3 + Math.floor(r() * 2), t0, r, 0.75);
        } else if (kind === 'flight') {
            this.flight?.start(t0, r);
        }
    }

    /**
     * A meteor across the sky (the fields of METEOR, plus where it starts and its heading). It
     * takes a dead slot, else the one furthest through its flight.
     */
    emitMeteor({
        t0 = this.time, az, el, heading, life = METEOR.life, reach = METEOR.reach, tail = METEOR.tail,
        gain = METEOR.gain, width = METEOR.width,
    }) {
        const now = this.time;
        let slot = this.shoots[0];
        let most = -Infinity;
        for (const star of this.shoots) {
            const age = (now - star.t0) / star.life;
            const through = age >= 1 ? 2 : age;
            if (through > most) {
                most = through;
                slot = star;
            }
        }
        slot.t0 = t0;
        slot.life = life;
        slot.az = az;
        slot.el = el;
        slot.heading = heading;
        slot.reach = reach;
        slot.tail = tail;
        slot.gain = gain;
        slot.width = width;
    }

    /** A shooting star across the visible upper sky, falling away from the sun. */
    emitShootingStar(t0 = this.time, r = this.rand) {
        const az = this.yaw + (r() * 2 - 1) * this.halfField() * 0.75;
        const el = 0.22 + r() * 0.22;
        // Heading in (azimuth, elevation) space: across and down.
        const across = az > this.yaw ? 1 : -1;
        const heading = Math.atan2(-(0.35 + r() * 0.4), across * (0.8 + r() * 0.4));
        this.emitMeteor({
            t0, az, el, heading,
        });
    }

    /** A volley: `count` meteors fanning away from over the sun, a beat apart. */
    emitVolley(count) {
        const r = this.rand;
        const t = this.time;
        const scale = 0.35 + 0.65 * (this.motion ?? 1);
        const n = Math.max(1, Math.round(count * scale));
        for (let i = 0; i < n; i += 1) {
            const fan = n > 1 ? i / (n - 1) - 0.5 : (r() - 0.5) * 0.6;
            // Out to its own side and down.
            const side = fan >= 0 ? 1 : -1;
            this.emitMeteor({
                t0: t + i * 0.07,
                az: fan * 0.5 + (r() - 0.5) * 0.08,
                el: 0.3 + r() * 0.1,
                heading: Math.atan2(-(0.3 + 0.3 * r()), side * (0.5 + Math.abs(fan) * 1.4)),
                reach: 0.26 + r() * 0.1,
                tail: 0.11,
                gain: 1.1,
                width: 1.2,
            });
        }
    }

    /**
     * Send `count` lights racing out along the grid's lines from under the lens toward the
     * horizon, as of `t0`, on lanes spread across the view.
     */
    emitRacers(count, t0 = this.time, r = this.rand, energy = 1) {
        const scale = 0.35 + 0.65 * (this.motion ?? 1);
        const n = Math.max(1, Math.round(count * scale));
        const S = GRID_SPACING;
        const { fwd, right } = this.viewBasis();
        const cam = this._camRest;
        const tanH = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2) * this.lens.aspect;
        for (let i = 0; i < n; i += 1) {
            // A lane under the lens, across the near field.
            const nx = -0.9 + (1.8 * (i + r())) / n;
            const depth = 26 + r() * 22;
            const x = cam.x + fwd.x * depth + right.x * nx * tanH * depth;
            const z = cam.z + fwd.z * depth + right.z * nx * tanH * depth;
            let slot = this.racers[0];
            let most = -Infinity;
            for (const racer of this.racers) {
                const age = t0 - racer.t0;
                const through = racer.energy <= 0 || age >= SHOW.racer.life ? 2 : age / SHOW.racer.life;
                if (through > most) {
                    most = through;
                    slot = racer;
                }
            }
            slot.t0 = t0 + i * 0.12;
            slot.x = Math.round(x / S) * S;
            slot.z = z + 30;
            slot.energy = energy * (0.8 + 0.4 * r());
        }
    }

    burstCount(share, cap) {
        return Math.max(16, Math.min(cap, Math.floor(this.fx.burstCapacity * share)));
    }

    /** NDC → world point at camera-space depth D on the current view (rest pose). */
    pointAt(nx, ny, D, out) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2);
        const tanH = tanV * this.lens.aspect;
        const { fwd, right, up } = this.viewBasis();
        return out.copy(this._camRest)
            .addScaledVector(fwd, D)
            .addScaledVector(right, nx * tanH * D)
            .addScaledVector(up, ny * tanV * D);
    }

    /** The sun's NDC position and disc radius (NDC units) on the current view. */
    sunNdc() {
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2);
        const tanH = tanV * this.lens.aspect;
        const { fwd, right, up } = this.viewBasis();
        const sd = Math.max(1e-3, this.sunDir.dot(fwd));
        const ry = Math.tan(SUN.radius) / sd / tanV;
        return {
            x: this.sunDir.dot(right) / sd / tanH,
            y: this.sunDir.dot(up) / sd / tanV,
            ry,
            rx: ry * (tanV / tanH),
        };
    }

    /**
     * A neon pixel burst (combos, Quad, level up): pixels leave the sun's face and fly to their
     * own targets across the WHOLE screen — 70 % anywhere in the view, 30 % around the sun — then
     * flicker out. Velocities are solved from the drag model (travel = v / drag).
     */
    emitSunBurst(requested) {
        // A third as many pixels under reduced motion.
        const count = Math.round(requested * (0.35 + 0.65 * (this.motion ?? 1)));
        const t = this.time;
        const r = this.rand;
        const drag = 1.3;
        const sun = this.sunNdc();
        for (let i = 0; i < count; i += 1) {
            const a = r() * Math.PI * 2;
            const rr = Math.sqrt(r()) * 0.8;
            // Only the sun's visible upper face (it sinks behind the ranges).
            const sy = sun.y + Math.abs(Math.sin(a)) * rr * sun.ry;
            this.pointAt(sun.x + Math.cos(a) * rr * sun.rx, sy, BURST_DEPTH, this._a);
            let tx;
            let ty;
            if (r() < 0.7) {
                tx = -1.15 + r() * 2.3;
                ty = -0.85 + r() * 1.95;
            } else {
                const b2 = r() * Math.PI * 2;
                const d = 0.15 + r() * 0.45;
                tx = sun.x + Math.cos(b2) * d;
                ty = sun.y + Math.abs(Math.sin(b2)) * d * 1.3;
            }
            this.pointAt(tx, ty, BURST_DEPTH, this._b);
            const reach = (0.85 + r() * 0.35) * drag;
            this.fx.spawnPixel(
                t + r() * 0.12,
                this._a.x,
                this._a.y,
                this._a.z,
                (this._b.x - this._a.x) * reach,
                (this._b.y - this._a.y) * reach,
                (this._b.z - this._a.z) * reach,
                2.2 + r() * 1.4,
                BURST_COLORS[Math.floor(r() * BURST_COLORS.length)],
                6 + r() * 7,
                {
                    drag, lift: -0.4 + r() * 0.6, flicker: 10 + r() * 14, phase: r() * 6.28,
                },
            );
        }
    }

    /** Pixels rising off the glass across the view (line clears). */
    emitRisingPixels(count) {
        const t = this.time;
        const r = this.rand;
        for (let i = 0; i < count; i += 1) {
            const D = 35 + r() * 110;
            this.pointAt(-1.05 + r() * 2.1, -0.75 + r() * 0.5, D, this._a);
            this._a.y = Math.max(this._a.y, 0.5);
            this.fx.spawnPixel(
                t + r() * 0.3,
                this._a.x,
                this._a.y,
                this._a.z,
                (r() - 0.5) * 2,
                5 + r() * 6,
                (r() - 0.5) * 2,
                1.8 + r() * 1.2,
                PIECE_COLOR_LIST[Math.floor(r() * PIECE_COLOR_LIST.length)],
                5 + r() * 5,
                {
                    drag: 0.9, lift: 1.2, flicker: 9 + r() * 9, phase: r() * 6.28,
                },
            );
        }
    }

    /** What the dusk is doing now (diagnostics, the playground, tests). */
    getState() {
        return {
            mood: this.moodName(),
            air: this.airName(),
            planet: { ...this._planet },
            night: this.u.night.value,
            ended: this.ended,
            stage: this.heat.stage,
            meteors: this.u.shootCount.value,
            beams: this.u.beamCount.value,
            ridgePulses: this.u.ridgePulseCount.value,
            racers: this.u.racerCount.value,
        };
    }

    /** Hide everything but the named parts (sky mountains ridges floor fx) — iteration aid. */
    showOnlyParts(names) {
        const keep = new Set(names);
        for (const [name, part] of Object.entries(this.parts)) {
            if (part) part.visible = keep.has(name);
        }
        this.fx.group.visible = keep.has('fx');
        this.flight.group.visible = keep.has('flight') || keep.has('fx');
    }

    dispose() {
        this.root.removeFromParent();
        for (const part of Object.values(this.parts)) {
            if (!part) continue;
            part.geometry?.dispose();
            part.material?.dispose();
        }
        this.reflection?.dispose?.();
        this.reflection = null;
        this.fx?.dispose();
        this.flight?.dispose();
        this.parts = {};
    }
}
