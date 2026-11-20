/**
 * Nimbus Veil — the world: builds every part, solves the composition, drives the camera, turns
 * the light and the air by their clocks and turns gameplay events into light.
 *
 * Composition. The sun stands at azimuth 0 over the cloud sea. The gameplay board covers the
 * middle of the screen, so the camera YAWS until the sun lands in the centre of the free zone
 * left of the board; with no board on screen (menus) it faces the sun. Layout changes ease in as
 * a slow pan. The lens is Hor+ (fixed vertical FOV, horizontal capped) and the pitch puts the
 * horizon at RIG.horizonFrac.
 *
 * Draws at High: sky, cloud sea, cumulus, four veils, birds, the optics card, motes, sparkles —
 * eleven.
 *
 * Three clocks turn the place, in every mode:
 *   - the HOURS (nimbus-veil-moods.js): golden sunrise, pearl morning, white noon, rose evening
 *     and the blue hour, each resting a while and then melting into the next. The sun rides its
 *     arc with them: up through the morning, down through the evening, under the sea line in the
 *     blue hour, so the deck's shadows shorten and lengthen and the last light leaves the deck
 *     before it leaves the towers' crowns and the high cloud. A level is one hour forward on top;
 *   - the AIR (nimbus-veil-weather.js): fair, mares' tails, a mackerel sky, a broken ceiling
 *     that fans the sun into beams and shade, and mist, on a wheel of its own length;
 *   - HAPPENINGS, one to a slot with quiet slots between: a skein of birds, a drift of ice
 *     glitter, a tower that boils up, shooting stars, heat lightning inside a far tower.
 *
 * Play builds the light instead of restarting it (src/themes/shared/gameplay-surge.js). Every
 * event's light is a Swell that adds to what is still lit, and every event has an instrument of
 * its own, so a glance tells what just happened:
 *
 *   a lock            a ripple of light on the deck beside the board (a hard drop: a wider one)
 *   one to three      as many light waves, in echelon, rolling in from beyond the towers
 *   four lines        the waves on the deck AND a wave crossing the high cloud overhead
 *   a cascade         a ray from the sun for each of its waves, standing together
 *   a chain           stepping stones of light on the deck down the sun's bearing, one more
 *                     and one nearer with each clear; when the chain breaks the world breathes
 *                     out (a wave rolling out) and they go out from the nearest back
 *   a twist           a corona of mother-of-pearl round the sun, and its colours in the cloud
 *   a back-to-back    a lantern lit at the heart of a tower, one more tower for each in the
 *                     streak, and a gold tide line that halts mid-deck
 *   a perfect clear   the whole fan of rays at once, the spectrum rolling out over the deck and
 *                     over the high cloud, every tower crown lit, the air clearing to the horizon
 *   a new level       light climbing every tower from the deck to its crown, as the hour turns
 *   the run's end     the veil closes: the mist takes the towers and the light drains
 *   a new run         the veil lifts on a fan of rays
 *
 * The heat of play goes into the world's own light, locally, never into the air: as play warms,
 * the flight quickens and the sun's fan of beams sharpens; hot, the towers' crowns catch fire
 * and the glare path on the deck turns molten; in a fever the air clears (the frame-wide glow
 * gives way), the beams blaze in a turning gold crown and the camera skims low and fast.
 */

import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    MOON,
    RIG,
    SEA_SPEED,
    SEA_WRAP,
    SUN,
    SUN_TAN,
    TOWERS,
    bearingVector,
} from './nimbus-veil-tsl.js';
import { createSky } from './nimbus-veil-sky.js';
import { RAY_SLOTS, createOptics } from './nimbus-veil-optics.js';
import {
    RIPPLE_SLOTS, ROAD_STONES, SEA_SHADOW_TAPS, createCloudSea,
} from './nimbus-veil-cloudsea.js';
import { createCumulus } from './nimbus-veil-cumulus.js';
import { NimbusFx } from './nimbus-veil-fx.js';
import { applyCameraBreath, easedMotion } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { easeStep, moodDrift } from '../shared/mood-clock.js';
import {
    MOODS, MOOD_COUNT, MOOD_HOLD, MOOD_KEYS, MOOD_PERIOD, moodAt, moodName, sunHeightAt,
} from './nimbus-veil-moods.js';
import {
    AIRS, HAPPENINGS, HAPPEN_SLOT, airAt, airIndex, airPhase, happeningEnvelope, happeningKind,
    happeningSlot, happeningState, slotHash,
} from './nimbus-veil-weather.js';

/** Per-tier content. Every tier keeps the composition; tiers trade detail, not layout. */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        rings: 90, segments: 100, towers: 3, billows: 22, motes: 0, sparkles: 120, veils: 1, birds: 9,
    },
    Low: {
        rings: 120, segments: 130, towers: 4, billows: 28, motes: 40, sparkles: 200, veils: 2, birds: 11,
    },
    Medium: {
        rings: 150, segments: 150, towers: 5, billows: 34, motes: 80, sparkles: 300, veils: 3, birds: 13,
    },
    High: {
        rings: 180, segments: 180, towers: 7, billows: 44, motes: 120, sparkles: 450, veils: 4, birds: 15,
    },
    Ultra: {
        rings: 200, segments: 200, towers: 7, billows: 50, motes: 160, sparkles: 600, veils: 4, birds: 15,
    },
    Extreme: {
        rings: 220, segments: 220, towers: 7, billows: 56, motes: 200, sparkles: 800, veils: 4, birds: 15,
    },
});

/**
 * Per-tier cloud-sea and sky detail: self-shadow taps toward the sun, the cauliflower and finest
 * octaves in the deck's light, the high cloud's shade on the deck, the distant cumulus banks, and
 * in the sky the mackerel cloudlets, the ceiling's third octave and the Milky Way.
 */
export const SEA_DETAIL = Object.freeze({
    Minimal: {
        seaShadow: 'none',
        cauliflower: false,
        fine: false,
        banks: false,
        shade: false,
        ripples: false,
        fineCeiling: false,
        milkyWay: false,
    },
    Low: {
        seaShadow: 'one',
        cauliflower: true,
        fine: false,
        banks: true,
        shade: true,
        ripples: false,
        fineCeiling: false,
        milkyWay: false,
    },
    Medium: {
        seaShadow: 'two',
        cauliflower: true,
        fine: false,
        banks: true,
        shade: true,
        ripples: true,
        fineCeiling: true,
        milkyWay: true,
    },
    High: {
        seaShadow: 'four',
        cauliflower: true,
        fine: true,
        banks: true,
        shade: true,
        ripples: true,
        fineCeiling: true,
        milkyWay: true,
    },
    Ultra: {
        seaShadow: 'four',
        cauliflower: true,
        fine: true,
        banks: true,
        shade: true,
        ripples: true,
        fineCeiling: true,
        milkyWay: true,
    },
    Extreme: {
        seaShadow: 'four',
        cauliflower: true,
        fine: true,
        banks: true,
        shade: true,
        ripples: true,
        fineCeiling: true,
        milkyWay: true,
    },
});

const GLINT_COLORS = [0xfff1c9, 0xffd88f, 0xffc2a8, 0xf3dcff, 0xffffff].map((h) => new THREE.Color(h));

/** Camera-space depth the combo burst floats at: past the near veil, well before the towers. */
const BURST_DEPTH = 60;

/** Where a light wave starts (distance from the camera): beyond the farthest tower. */
const RING_START = 1100;

/**
 * Light-wave slots: enough for a procession (a clear every ~0.6 s with each wave ~3 s long, a
 * cascade's waves 0.36 s apart, or the four bands of four lines in echelon) to show every band at
 * once. The cloud sea and the towers each read them all (one exp per slot).
 */
export const RING_SLOTS = 8;

/** Seconds between the bands of one clear: a line a band, in echelon. */
const ECHELON = 0.24;

/** Seconds after a lock with no clear before the chain it carried counts as ended. */
const CHAIN_GRACE = 0.25;

/** How a light wave travels: in from beyond the towers, in and halting mid-deck, or out. */
const RING_IN = 0;
const RING_HOLD = 1;
const RING_OUT = 2;

/** The bearings (round the sun, degrees from its right) a cascade's rays take, in order. */
const RAY_FAN = Object.freeze([108, 70, 132, 48, 90, 152, 30]);
/** Seconds a ray stands. */
const RAY_LIFE = 4.2;
/** Seconds the wave over the high cloud takes from the horizon to overhead. */
const SKY_WAVE_DUR = 2.5;
/** Seconds the light takes to climb a tower on a new level. */
const CLIMB_DUR = 1.7;
/** Seconds a ripple on the deck lives. */
const RIPPLE_LIFE = 3.4;

/** Seconds a streak's lanterns stand after its last back-to-back before they go out. */
const LANTERN_HOLD = 3.4;

/** The moon's direction and frame (the lamp of the night's optics), and its light's colour. */
const MOON_DIR = new THREE.Vector3(...bearingVector(MOON.az, MOON.el));
const MOON_RIGHT = new THREE.Vector3(0, 1, 0).cross(MOON_DIR).normalize().negate();
const MOON_UP = MOON_DIR.clone().cross(MOON_RIGHT).normalize().negate();
const MOON_TINT = Object.freeze([0.78, 0.86, 1.0]);
/** By day the optics are deep gold: against the sun's white-gold glow, colour is what shows. */
const SUN_GOLD = Object.freeze([1.0, 0.56, 0.16]);
/** How bright the night lets event light be (1 by day). */
const NIGHT_LIGHT = 0.4;

const smooth01 = (e0, e1, x) => {
    const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return k * k * (3 - 2 * k);
};

/** A light wave at `age` seconds: its radius, 1/width and energy (0 when it has finished). */
export function ringState(ring, age, out) {
    const o = out;
    o.radius = 0;
    o.invWidth = 1;
    o.energy = 0;
    if (!(ring.energy > 0) || age < 0) return o;
    const { dur } = ring;
    let radius;
    let env;
    if (ring.mode === RING_OUT) {
        // The exhale: from under the camera out to the horizon, slow to leave, quick at the end.
        if (age > dur + 0.3) return o;
        radius = 20 + (RING_START - 20) * Math.min(1, age / dur) ** 1.6;
        env = smooth01(0, 0.35, age) * (1 - smooth01(dur - 0.6, dur + 0.3, age));
    } else if (ring.mode === RING_HOLD) {
        // A tide line: rolls in fast, halts at `hold` and lingers there, fading slowly.
        const life = dur + ring.linger * 3;
        if (age > life) return o;
        radius = ring.hold + (RING_START - ring.hold) * Math.max(0, 1 - age / dur) ** 1.4;
        env = Math.min(1, age / 0.2) * (age < dur ? 1 : Math.exp(-(age - dur) / ring.linger))
            * (1 - smooth01(life - 0.6, life, age));
    } else {
        // In from beyond the farthest tower to under the camera, slowing as it nears, so the
        // band crosses the screen at an even pace.
        if (age > dur + 0.2) return o;
        radius = RING_START * Math.max(0, 1 - age / dur) ** 1.4;
        // It lets go of its light before it reaches the lens, where a band would fill the frame.
        env = Math.min(1, age / 0.25) * (1 - smooth01(dur * 0.8, dur * 0.94, age));
    }
    o.radius = radius;
    o.invWidth = 1 / ((5 + radius * 0.06) * ring.widthK);
    o.energy = ring.energy * env;
    return o;
}

/**
 * The wave over the high cloud at `age`: its radius on the ceiling's plane (the cotangent of a
 * height over the horizon: 11 is five degrees up, under 1 is overhead), 1/width and energy. It
 * shrinks by a fixed share a second, which on the screen is an even climb.
 */
export function skyWaveState(wave, age, out) {
    const o = out;
    o.radius = 0;
    o.invWidth = 1;
    o.energy = 0;
    if (!(wave.energy > 0) || age < 0 || age > SKY_WAVE_DUR) return o;
    o.radius = 11 * 0.06 ** (age / SKY_WAVE_DUR);
    o.invWidth = 1 / (0.085 * o.radius + 0.03);
    o.energy = wave.energy * Math.min(1, age / 0.2) * (1 - smooth01(SKY_WAVE_DUR - 0.6, SKY_WAVE_DUR, age));
    return o;
}

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

/** How fast a level's step eases toward its mood (1/s). */
const MOOD_EASE = 0.8;
/** How fast the sun follows a level's step along its arc (1/s): it glides, the colours lead. */
const SUN_EASE = 0.42;

const DEG = Math.PI / 180;

/**
 * What the sun's height (degrees) means for the light: how much of it still reaches the deck
 * (`day`: none once it stands under the sea line) and how strongly it lights the high cloud from
 * below (`under`: all of it from a low sun and after it has set, none from a high one).
 */
export function sunReach(heightDeg) {
    return {
        day: smooth01(-1.6, 3.2, heightDeg),
        under: 1 - smooth01(3, 14.5, heightDeg),
    };
}

export function createWorldUniforms() {
    return {
        time: uniform(0),
        seaScroll: uniform(0),
        sunDir: uniform(new THREE.Vector3(0, Math.sin(SUN.elevation), -Math.cos(SUN.elevation))),
        sunRight: uniform(new THREE.Vector3(1, 0, 0)),
        sunUp: uniform(new THREE.Vector3(0, Math.cos(SUN.elevation), Math.sin(SUN.elevation))),
        sunRadius: uniform(SUN.radius),
        /** tan of the sun's height: how fast a ray toward it climbs (negative once it has set). */
        sunTan: uniform(SUN_TAN),
        /** The sun's height (radians) and the share of its light that reaches the deck. */
        sunEl: uniform(SUN.elevation),
        day: uniform(1),
        sunPulse: uniform(0),
        seaGlow: uniform(0),
        /** Light waves: (radius, 1/width, energy, heat 0..1: gold → molten amber). */
        rings: Array.from({ length: RING_SLOTS }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
        /**
         * The heat of play spent locally: x the sun's fan of beams (contrast, reach, gold), y the
         * towers' burning crowns and rims, z the molten glare path on the deck, w every tower
         * crown lit at once (perfect clear, back-to-back).
         */
        blaze: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The turn of the sun's fan of beams (a twist turns it; a fever turns it slowly). */
        beamTurn: uniform(0),
        /** The flight clock: the veils and motes drift on it; it runs faster as play heats. */
        flight: uniform(0),
        /** The motes' brightness (1 at rest) and the ice glitter passing (0 at rest). */
        moteGlow: uniform(1),
        glitter: uniform(0),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camBack: uniform(new THREE.Vector3(0, 0, 1)),
        invTanHalfV: uniform(1 / Math.tan(THREE.MathUtils.degToRad(RIG.vfov) / 2)),
        /** The live mood's colours (nimbus-veil-moods.js MOOD_KEYS), scene-linear. */
        mood: Object.fromEntries(MOOD_KEYS.map((key) => [key, uniform(new THREE.Vector3(...MOODS[0][key]))])),
        /** The live mood's starlight (0 by day). */
        starGain: uniform(MOODS[0].stars),
        /** The air (nimbus-veil-weather.js): x high cloud, y its kind, z the veils, w the deck's heads. */
        air: uniform(new THREE.Vector4(AIRS[0].ceil, AIRS[0].ripple, AIRS[0].veil, AIRS[0].heads)),
        /** x how strongly the high cloud breaks the sun, z the haze's rate (y is not used). */
        air2: uniform(new THREE.Vector4(AIRS[0].beams, 0, AIRS[0].haze, 0)),
        /** The high cloud's drift (integrated: along the wind, across it). */
        ceilFlow: uniform(new THREE.Vector2(0, 0)),
        /** x the low sun's light under the high cloud. */
        ceil: uniform(new THREE.Vector4(sunReach(MOODS[0].sun).under, 0, 0, 0)),
        /**
         * The lamp the optics stand round: the sun by day, the young moon once the stars are out
         * (its direction and frame, its light's colour, and x its disc's radius, y its share: it
         * dips to nothing while one hands over to the other).
         */
        lampDir: uniform(new THREE.Vector3(0, Math.sin(SUN.elevation), -Math.cos(SUN.elevation))),
        lampRight: uniform(new THREE.Vector3(1, 0, 0)),
        lampUp: uniform(new THREE.Vector3(0, Math.cos(SUN.elevation), Math.sin(SUN.elevation))),
        lampTint: uniform(new THREE.Vector3(...MOODS[0].glowCore)),
        lampInfo: uniform(new THREE.Vector4(SUN.radius, 1, 1, 0)),
        /** A twist's corona round the lamp: x its light, y its turn (0..1, wrapped). */
        optics: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** A chain's stepping stones on the deck: x how many are lit, y 1 while any is. */
        road: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** A back-to-back streak's lanterns: how many towers are lit from within. */
        lanterns: uniform(0),
        /** A cascade's rays: (cos, sin of the bearing round the sun, light, sharpness). */
        rays: uniformArray(Array.from({ length: RAY_SLOTS }, () => new THREE.Vector4(0, 1, 0, 600)), 'vec4'),
        /** The wave over the high cloud: (radius on its plane, 1/width, energy, spectrum 0|1). */
        skyWave: uniform(new THREE.Vector4(0, 1, 0, 0)),
        /** The spectrum rolling out over the deck (a perfect clear): (radius, 1/width, energy). */
        glory: uniform(new THREE.Vector4(0, 1, 0, 0)),
        /** Ripples on the deck (locks): (x, z, radius, energy). */
        ripples: uniformArray(Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0, 0, 1, 0)), 'vec4'),
        /** A new level: x how far up the towers the light has climbed, y its energy, z their surge. */
        climb: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** A tower boiling up by itself: (its bearing, how far). */
        boil: uniform(new THREE.Vector4(99, 0, 0, 0)),
        /** Heat lightning inside a tower: (its bearing, light, where across, where up). */
        ember: uniform(new THREE.Vector4(99, 0, 0, 0.5)),
        /** Two shooting stars: (head bearing, head height, tail bearing, tail height), and their light. */
        meteorA: uniform(new THREE.Vector4(0, 1, 0, 1)),
        meteorB: uniform(new THREE.Vector4(0, 1, 0, 1)),
        meteorGain: uniform(new THREE.Vector2(0, 0)),
        /** The skein: (the leader's place, the wingbeat's clock) and (its heading, 1 while it flies). */
        skein: uniform(new THREE.Vector4(0, -500, 0, 0)),
        skeinDir: uniform(new THREE.Vector4(1, 0, 0, 0)),
    };
}

export class NimbusWorld {
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
        this.root.name = 'NimbusWorld';
        this.time = 0;
        this.parts = {};

        this.lens = { vfov: RIG.vfov, aspect: 16 / 9 };
        this.pitch = 0;
        this.yaw = 0;
        this.targetYaw = 0;
        this.yawSettled = false;
        this.board = null;

        const el = SUN.elevation;
        this.sunDir = new THREE.Vector3(0, Math.sin(el), -Math.cos(el));
        this.sunUp = new THREE.Vector3(0, Math.cos(el), Math.sin(el));
        this.sunRight = new THREE.Vector3(1, 0, 0);
        /** The sun's height (degrees), and the height the composition was last solved for. */
        this.sunHeight = MOODS[0].sun;
        this.solvedSunHeight = MOODS[0].sun;
        this.u.sunDir.value.copy(this.sunDir);
        this.u.sunUp.value.copy(this.sunUp);
        this.u.sunRight.value.copy(this.sunRight);

        /**
         * The air's glow (sky, haze, the sun's aureole) and the deck's warmth: frame-wide, so
         * they stay low (a single reads as it always has; a frenzy never washes the frame) and
         * Reduce flashing holds them back (ADR-0021). Every hit adds to what is still lit.
         */
        this.glow = new Swell({ release: 1.0, ceiling: 0.45, knee: 0.3 });
        this.warmth = new Swell({ release: 1.25, ceiling: 0.6, knee: 0.35 });
        /** The sun's flare (four lines, a twist, a perfect clear): its beams and the towers' rims. */
        this.flare = new Swell({
            attack: 0.06, release: 1.4, ceiling: 1.3, knee: 0.8,
        });
        /** Every tower crown lit at once (perfect clear, back-to-back, level up). */
        this.crownLight = new Swell({
            attack: 0.12, release: 2.4, ceiling: 1.4, knee: 0.9,
        });
        /** The camera's dip toward the deck (locks, hard drops): rides lower under a quick hand. */
        this.dip = new Swell({
            attack: 0.05, release: 0.35, ceiling: 1, knee: 0.6,
        });
        /** How fast a twist turns the sun's fan of beams (rad/s). */
        this.spin = new Swell({ release: 0.7, ceiling: 1.6, knee: 1 });
        /** A twist's corona round the sun. */
        this.corona = new Swell({
            attack: 0.12, release: 1.9, ceiling: 1.3, knee: 0.9,
        });
        /** The air clearing to the horizon (a perfect clear). */
        this.clarity = new Swell({
            attack: 0.4, release: 4.0, ceiling: 1, knee: 0.8,
        });
        /** The iris closing a little on the big moments, so their light has room to show. */
        this.focus = new Swell({
            attack: 0.15, release: 1.6, ceiling: 1, knee: 0.7,
        });
        /** The towers swelling upward (a new level). */
        this.towerSurge = new Swell({
            attack: 0.3, release: 1.5, ceiling: 1.2, knee: 0.9,
        });
        /** How hot play runs (src/themes/shared/gameplay-surge.js). */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.heatAt = Number.NaN;
        /** The values written last frame (the theme's post reads them). */
        this.sunPulse = 0;
        this.seaGlow = 0;
        this.flareShown = 0;
        this.rings = Array.from({ length: RING_SLOTS }, () => ({
            t0: -1e6, energy: 0, dur: 3, widthK: 1, heat: 0, mode: RING_IN, hold: 0, linger: 1,
        }));
        this._ring = { radius: 0, invWidth: 1, energy: 0 };
        /** A cascade's rays, the wave over the high cloud, the spectrum on the deck, the ripples. */
        this.rays = Array.from({ length: RAY_SLOTS }, () => ({
            t0: -1e6, energy: 0, cos: 0, sin: 1, sharp: 600,
        }));
        this.rayTurn = 0;
        this.skyWave = { t0: -1e6, energy: 0, spectrum: 0 };
        this.glory = {
            t0: -1e6, energy: 0, dur: 3.4, widthK: 2.2, mode: RING_OUT, hold: 0, linger: 1,
        };
        this.ripples = Array.from({ length: RIPPLE_SLOTS }, () => ({
            t0: -1e6, x: 0, z: 0, energy: 0, reach: 20,
        }));
        this.rippleCursor = 0;
        this.climbAt = -1e6;
        /** A chain's stepping stones: how many the chain has lit, and how many are showing. */
        this.roadGoal = 0;
        this.road = 0;
        /** A streak's lanterns: how many towers it has reached, and how many are showing. */
        this.lanternGoal = 0;
        this.lanterns = 0;
        this.coronaTurn = 0;
        /** The veil closing at a run's end (0 open .. 1 closed), where it is heading, how fast. */
        this.dusk = 0;
        this.duskGoal = 0;
        this.duskRate = 0.9;
        this.flight = 0;
        this.seaLead = 0;
        this.beamTurn = 0;
        this.hardDropPending = false;
        /** A chain that ends unless the lock just made clears something (see onPieceLock). */
        this.chainWatch = 0;
        this.chainWatchAt = -1e6;
        this.b2bStreak = 0;
        this.b2bAt = -1e6;
        this._post = {
            bloomBoost: 0, rays: 1, exposure: 1, dusk: 0,
        };
        /** The game's level (a level is one mood forward) and its eased step on the wheel. */
        this.level = 1;
        this.moodStep = 0;
        /** The sun's own, slower step: it glides to a new level's place on its arc. */
        this.sunStep = 0;
        this._mood = {};
        this._moodProbe = {};
        /** The air: the live one, and a capture's override (an index into AIRS, or null). */
        this.air = airAt(0, {});
        this.airOverride = null;
        this.ceilFlowX = 0;
        this.ceilFlowY = 0;
        /** Happenings: on unless a capture turns them off; the slot in hand and what it holds. */
        this.happenings = true;
        this.happenForce = null;
        this.happenSlot = -1;
        this.happenKind = null;
        this._happen = {
            kind: null, age: 0, dur: 1, u: 0, seed: 0,
        };

        this._camRest = new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        this._fwd = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._target = new THREE.Vector3();
        this._a = new THREE.Vector3();
        this._b = new THREE.Vector3();
    }

    build() {
        const { q, u, rand } = this;
        const detail = SEA_DETAIL[this.qualityName];
        this.parts.sky = createSky(u, {
            banks: detail.banks, ripples: detail.ripples, fine: detail.fineCeiling, milkyWay: detail.milkyWay,
        });
        this.parts.sea = createCloudSea(u, {
            rings: q.rings,
            segments: q.segments,
            shadowTaps: SEA_SHADOW_TAPS[detail.seaShadow],
            cauliflower: detail.cauliflower,
            fine: detail.fine,
            shade: detail.shade,
            towers: q.towers,
        });
        this.parts.cumulus = createCumulus(u, { rand, towers: q.towers, billowsPerTower: q.billows });
        this.parts.optics = createOptics(u);
        this.fx = new NimbusFx(u, {
            motes: q.motes, sparkles: q.sparkles, veils: q.veils, birds: q.birds, rand,
        });
        for (const part of Object.values(this.parts)) {
            if (part) this.root.add(part);
        }
        this.root.add(this.fx.group);
        this.scene.add(this.root);
        this.applyMood(1);
        return this;
    }

    // ── Composition ─────────────────────────────────────────────────────────

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
        const depth = d.x * Math.sin(yaw) * cp + d.y * sp - d.z * Math.cos(yaw) * cp;
        const side = d.x * Math.cos(yaw) + d.z * Math.sin(yaw);
        return (side / Math.max(1e-4, depth) / (tanV * this.lens.aspect)) * 0.5 + 0.5;
    }

    /** Solve the lens, pitch and target yaw for an aspect and the board rect (or null). */
    setLayout(aspect, board = null, { immediate = false } = {}) {
        this.lens.aspect = Math.max(0.1, aspect || 16 / 9);
        this.lens.vfov = NimbusWorld.verticalFov(this.lens.aspect);
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2);
        this.u.invTanHalfV.value = 1 / tanV;
        this.pitch = Math.atan((2 * RIG.horizonFrac - 1) * tanV);
        this.board = board;
        this.solveYaw();
        if (immediate || !this.yawSettled) {
            this.yaw = this.targetYaw;
            this.yawSettled = true;
        }
    }

    /** The yaw that puts the sun where the layout wants it (the eased yaw heads there). */
    solveYaw() {
        const { board } = this;
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
        this.solvedSunHeight = this.sunHeight;
    }

    /** The current view's basis at the rest pose (eased yaw + pitch; no drift or parallax). */
    viewBasis() {
        const cp = Math.cos(this.pitch);
        this._fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
        this._right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
        this._up.crossVectors(this._right, this._fwd).normalize();
        return { fwd: this._fwd, right: this._right, up: this._up };
    }

    /** Camera: eased yaw, the rest pose, a slow floating drift and pointer parallax. */
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
        const driftX = (Math.sin(t * 0.045) * 1.1 + Math.sin(t * 0.021 + 1.1) * 0.5) * motion;
        const driftY = (Math.sin(t * 0.06 + 0.4) * 0.55 + Math.sin(t * 0.017) * 0.3) * motion;
        const px = (sim.pointerX ?? 0) * 1.2 * motion;
        const py = -(sim.pointerY ?? 0) * 0.5 * motion;
        // The flight sinks toward the heads as play heats (a fever skims them) and bobs down
        // with each lock; a quick hand rides lower. Held at rest under reduced motion.
        const { level, fever } = this.sampleHeat(t);
        const skim = (level * 0.6 + fever * 1.3 + this.dip.valueAt(t) * 1.1) * motion;
        camera.position.copy(this._camRest).addScaledVector(right, driftX + px);
        camera.position.y += driftY + py - skim;
        this._target.copy(this._camRest).addScaledVector(fwd, 2000);
        camera.lookAt(this._target);
        // The shared breath (shared/camera-breath.js) on top of the drift above, before the basis
        // is read back: the view only turns (the look point is a far heading over the cloud
        // sea), on the same ease.
        applyCameraBreath(camera, t, { scale: motion });
        camera.updateMatrixWorld();
        // Camera basis for the cumulus sphere normals (columns of the world matrix).
        const m = camera.matrixWorld.elements;
        this.u.camRight.value.set(m[0], m[1], m[2]).normalize();
        this.u.camUp.value.set(m[4], m[5], m[6]).normalize();
        this.u.camBack.value.set(m[8], m[9], m[10]).normalize();
        // The veils travel with the view's yaw.
        if (this.fx?.veils) {
            this.fx.veils.position.copy(camera.position);
            this.fx.veils.rotation.set(0, -this.yaw, 0);
        }
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
        // Reduced motion: the cloud sea drifts at 30 % (a lag, so a seek still lands right) and the
        // sun's pulses stay soft.
        const motion = this.motion ?? 1;
        if (this.chainWatch && t - this.chainWatchAt > CHAIN_GRACE) {
            const chain = this.chainWatch;
            this.chainWatch = 0;
            this.onChainEnd(chain);
        }
        const { level, fever, punch } = this.sampleHeat(t);
        // The flight quickens with play: a warm hand streams the deck under the camera, a fever
        // races it (the extra distance is integrated, so a change of pace never jumps the deck).
        const speedUp = (level * 1.1 + fever * 1.5) * motion;
        this.seaLead += dt * SEA_SPEED * speedUp;
        this.seaLag = (this.seaLag ?? 0) + dt * SEA_SPEED * 0.7 * (1 - motion);
        u.seaScroll.value = ((((t * SEA_SPEED) - this.seaLag + this.seaLead) % SEA_WRAP) + SEA_WRAP) % SEA_WRAP;
        this.flight += dt * (1 + (level * 1.6 + fever * 2.2) * motion);
        u.flight.value = this.flight;
        const turn = this.spin.valueAt(t) + fever * 0.035;
        this.beamTurn = (this.beamTurn + dt * turn * motion) % (Math.PI * 2);
        u.beamTurn.value = this.beamTurn;

        // Frame-wide light: low, held back under Reduce flashing, and in a fever the air clears
        // (the light goes into the sun's crown, the towers and the deck instead).
        const fs = flashScale();
        const clearAir = 1 - 0.5 * fever;
        this.sunPulse = Math.min(this.glow.valueAt(t) * fs, 0.5 + 0.7 * motion) * clearAir;
        this.seaGlow = this.warmth.valueAt(t) * fs * clearAir;
        u.sunPulse.value = this.sunPulse;
        u.seaGlow.value = this.seaGlow;

        // Local light: the acts of play. Calm shows nothing new; warm sharpens the beams and
        // warms the glare path; hot sets the towers' crowns burning; a fever blazes all three.
        const flare = this.flare.valueAt(t);
        this.flareShown = flare;
        const warm = smooth01(0.18, 0.55, level);
        const hot = smooth01(0.45, 0.85, level);
        u.blaze.value.set(
            Math.min(1.6, 0.45 * warm + 0.35 * hot + 0.6 * fever + 0.7 * flare * fs),
            Math.min(1.6, 0.35 * hot + 0.75 * fever + 0.5 * flare + 0.12 * punch),
            Math.min(1.6, 0.3 * warm + 0.4 * hot + 0.85 * fever + 0.3 * flare),
            this.crownLight.valueAt(t),
        );

        // Light waves: a procession of bands rolling in over the deck, past the towers (which
        // light as each goes through them).
        const ringOut = this._ring;
        this.rings.forEach((ring, i) => {
            const s = ringState(ring, t - ring.t0, ringOut);
            u.rings[i].value.set(s.radius, s.invWidth, s.energy, ring.heat);
        });
        this.updateInstruments(t, dt, motion);

        // The veil closing at a run's end, lifting at the next one's start.
        this.dusk += (this.duskGoal - this.dusk) * approach(this.duskRate, dt);
        if (Math.abs(this.duskGoal - this.dusk) < 1e-4) this.dusk = this.duskGoal;

        // The post: rays toward the sun lengthen with the beams; the iris closes a little as
        // play heats, so the colours stay saturated and the deep sky stays deep.
        const post = this._post;
        post.bloomBoost = Math.min(1, this.sunPulse * 0.9 + flare * fs * 0.25 + fever * 0.15);
        post.rays = 1 + u.blaze.value.x * 0.55 + this.air.beams * 0.35;
        post.exposure = 1 - Math.max(0, level - 0.2) * 0.1 - fever * 0.08 - this.focus.valueAt(t) * 0.13;
        post.dusk = this.dusk;

        this.applyMood(approach(MOOD_EASE, dt), approach(SUN_EASE, dt));
        this.applyAir(t, dt, level);
        this.applyHappening(t);
        u.moteGlow.value = 1 + level * 0.7 + fever * 0.9;
    }

    /**
     * The events' own instruments: the stepping stones, the lanterns, the corona, the rays, the
     * two waves, the ripples, the climb.
     */
    updateInstruments(t, dt, motion) {
        const { u } = this;
        // The stones light one by one as the chain builds, and go out from the nearest back
        // when it breaks; a streak's lanterns stand a while after its last back-to-back.
        const rising = this.roadGoal > this.road;
        this.road += (this.roadGoal - this.road) * approach(rising ? 6 : 1.2, dt);
        if (this.road < 1e-3 && this.roadGoal === 0) this.road = 0;
        u.road.value.set(this.road, this.road > 0 ? 1 : 0, 0, 0);
        if (this.lanternGoal > 0 && t - this.b2bAt > LANTERN_HOLD) this.lanternGoal = 0;
        const lighting = this.lanternGoal > this.lanterns;
        this.lanterns += (this.lanternGoal - this.lanterns) * approach(lighting ? 4 : 0.8, dt);
        if (this.lanterns < 1e-3 && this.lanternGoal === 0) this.lanterns = 0;
        u.lanterns.value = this.lanterns;
        const corona = this.corona.valueAt(t);
        this.coronaTurn = (this.coronaTurn + dt * (0.12 + 0.5 * corona) * (0.3 + 0.7 * motion)) % 1;
        u.optics.value.set(corona, this.coronaTurn, 0, 0);

        const rays = u.rays.array;
        for (let i = 0; i < RAY_SLOTS; i += 1) {
            const ray = this.rays[i];
            const age = t - ray.t0;
            const live = age >= 0 && age < RAY_LIFE && ray.energy > 0;
            const env = live
                ? Math.min(1, age / 0.14) * Math.exp(-Math.max(0, age - 0.7) / 1.7)
                    * (1 - smooth01(RAY_LIFE - 0.9, RAY_LIFE, age))
                : 0;
            rays[i].set(ray.cos, ray.sin, ray.energy * env, ray.sharp);
        }

        const wave = skyWaveState(this.skyWave, t - this.skyWave.t0, this._ring);
        u.skyWave.value.set(wave.radius, wave.invWidth, wave.energy, this.skyWave.spectrum);
        const glory = ringState(this.glory, t - this.glory.t0, this._ring);
        u.glory.value.set(glory.radius, glory.invWidth, glory.energy, 0);

        const ripples = u.ripples.array;
        for (let i = 0; i < RIPPLE_SLOTS; i += 1) {
            const r = this.ripples[i];
            const age = t - r.t0;
            if (age < 0 || age > RIPPLE_LIFE || !(r.energy > 0)) {
                ripples[i].set(0, 0, 1, 0);
            } else {
                const radius = 1.5 + r.reach * (1 - Math.exp(-age * 1.6));
                ripples[i].set(r.x, r.z, radius, r.energy * Math.min(1, age / 0.06) * Math.exp(-age * 0.85)
                    * (1 - smooth01(RIPPLE_LIFE - 0.8, RIPPLE_LIFE, age)));
            }
        }

        const climbAge = t - this.climbAt;
        const climbing = climbAge >= 0 && climbAge < CLIMB_DUR + 0.6;
        u.climb.value.set(
            climbing ? (climbAge / CLIMB_DUR) * 1.2 - 0.08 : 0,
            climbing ? Math.min(1, climbAge / 0.12) * (1 - smooth01(CLIMB_DUR - 0.3, CLIMB_DUR + 0.6, climbAge)) : 0,
            this.towerSurge.valueAt(t) * (0.35 + 0.65 * motion),
            0,
        );
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
     * Where the light stands on its wheel of moods, heading for: one step a level, turned on by
     * the clock. The whole part names a mood, the fraction is how far it has melted into the next.
     */
    moodPhase() {
        return (this.level - 1) + moodDrift(this.time, MOOD_PERIOD, MOOD_HOLD);
    }

    /** The live mood's name (diagnostics). */
    moodName() {
        return moodName(this.moodStep + moodDrift(this.time, MOOD_PERIOD, MOOD_HOLD));
    }

    /**
     * Set the live mood's uniforms. The clock's turn is exact (a function of the time alone, so a
     * seek and a replay agree); the level's step eases in by `k` (1 snaps), the short way round,
     * and the sun follows by its own, slower `kSun`.
     */
    applyMood(k, kSun = k) {
        this.moodStep = easeStep(this.moodStep, this.level - 1, k, MOOD_COUNT);
        this.sunStep = easeStep(this.sunStep, this.level - 1, kSun, MOOD_COUNT);
        const drift = moodDrift(this.time, MOOD_PERIOD, MOOD_HOLD);
        const mood = moodAt(this.moodStep + drift, this._mood);
        const { u } = this;
        for (let i = 0; i < MOOD_KEYS.length; i += 1) {
            const key = MOOD_KEYS[i];
            const c = mood[key];
            u.mood[key].value.set(c[0], c[1], c[2]);
        }
        u.starGain.value = mood.stars;
        this.setSunHeight(sunHeightAt(this.sunStep + drift));
        this.setLamp(mood);
    }

    /**
     * The lamp the optics stand round: the sun, or the young moon once the stars are out. The
     * handover goes through nothing (the lamp's share dips to zero at the middle), so a ring
     * never jumps across the sky.
     */
    setLamp(mood) {
        const { u } = this;
        const night = smooth01(0.1, 0.7, mood.stars);
        const share = Math.abs(2 * night - 1);
        if (night > 0.5) {
            u.lampDir.value.copy(MOON_DIR);
            u.lampRight.value.copy(MOON_RIGHT);
            u.lampUp.value.copy(MOON_UP);
            u.lampTint.value.set(MOON_TINT[0], MOON_TINT[1], MOON_TINT[2]);
            u.lampInfo.value.set(MOON.radius, share, 1 + (NIGHT_LIGHT - 1) * night, 0);
        } else {
            u.lampDir.value.copy(this.sunDir);
            u.lampRight.value.copy(this.sunRight);
            u.lampUp.value.copy(this.sunUp);
            u.lampTint.value.set(
                mood.glowCore[0] * 0.4 + SUN_GOLD[0] * 0.6,
                mood.glowCore[1] * 0.4 + SUN_GOLD[1] * 0.6,
                mood.glowCore[2] * 0.4 + SUN_GOLD[2] * 0.6,
            );
            u.lampInfo.value.set(SUN.radius, share, 1 + (NIGHT_LIGHT - 1) * night, 0);
        }
    }

    /** The sun at `degrees` over the horizon: its direction, its reach, and the composition. */
    setSunHeight(degrees) {
        this.sunHeight = degrees;
        const el = degrees * DEG;
        const { u } = this;
        this.sunDir.set(0, Math.sin(el), -Math.cos(el));
        this.sunUp.set(0, Math.cos(el), Math.sin(el));
        u.sunDir.value.copy(this.sunDir);
        u.sunUp.value.copy(this.sunUp);
        u.sunTan.value = Math.tan(el);
        u.sunEl.value = el;
        const reach = sunReach(degrees);
        u.day.value = reach.day;
        u.ceil.value.x = reach.under;
        // The sun's place on the screen shifts a little with its height: solve again now and then.
        if (this.yawSettled && Math.abs(degrees - this.solvedSunHeight) > 0.75) this.solveYaw();
    }

    // ── The air ─────────────────────────────────────────────────────────────

    /** Hold one air (its name, or an index into AIRS), or pass null to let the clock turn it. */
    setAir(air) {
        const index = typeof air === 'string' ? airIndex(air) : Number(air);
        this.airOverride = air !== null && air !== undefined && index >= 0 && index < AIRS.length ? index : null;
        this.applyAir(this.time, 0, 0);
    }

    /** The live air's name (diagnostics). */
    airName() {
        return this.air.name;
    }

    applyAir(t, dt, level) {
        const { u } = this;
        const air = airAt(this.airOverride ?? airPhase(t), this.air);
        const closed = this.dusk;
        const clear = this.clarity.valueAt(t);
        u.air.value.set(air.ceil, air.ripple, air.veil + closed * 0.9, air.heads);
        u.air2.value.set(
            air.beams,
            0,
            air.haze * (1 - 0.42 * clear) * (1 + 1.25 * closed),
            0,
        );
        // The high cloud streams on the wind (integrated, so a change of pace never jumps it).
        this.ceilFlowX += dt * 0.012 * air.wind * (1 + 0.5 * level);
        this.ceilFlowY += dt * 0.0035;
        u.ceilFlow.value.set(this.ceilFlowX, this.ceilFlowY);
    }

    // ── Happenings ──────────────────────────────────────────────────────────

    /** Turn the sky's own happenings on or off, or hold one kind (a capture's `happen=`). */
    setHappenings(on, force = null) {
        this.happenings = on !== false;
        this.happenForce = force && HAPPENINGS[force] ? force : null;
        this.happenSlot = -1;
    }

    /** The starlight at `time` (with the level's step as it stands). */
    starsAt(time) {
        return moodAt(this.moodStep + moodDrift(time, MOOD_PERIOD, MOOD_HOLD), this._moodProbe).stars;
    }

    /** What the sky is doing by itself at `t`: one happening or none, a function of its age. */
    applyHappening(t) {
        const { u } = this;
        const h = this._happen;
        h.kind = null;
        if (this.happenings) {
            const slot = happeningSlot(t);
            if (slot !== this.happenSlot) {
                // Which happening a slot holds is settled once, at its start, from the starlight
                // there: a level that turns the hour mid-slot never swaps one for another.
                this.happenSlot = slot;
                this.happenKind = this.happenForce ?? happeningKind(slot, this.starsAt(slot * HAPPEN_SLOT));
            }
            if (this.happenForce) {
                // A held happening (a capture) begins with its slot: its age is the slot's.
                const age = t - slot * HAPPEN_SLOT;
                const { dur } = HAPPENINGS[this.happenForce];
                h.dur = dur;
                h.seed = slotHash(slot, 3);
                if (age <= dur) {
                    h.kind = this.happenForce;
                    h.age = age;
                    h.u = age / dur;
                }
            } else happeningState(this.happenKind, slot, t, h);
        }
        const env = h.kind ? happeningEnvelope(h.u) : 0;
        const built = Math.max(1, Math.min(this.q.towers, TOWERS.length));

        u.glitter.value = h.kind === 'glitter' ? env : 0;

        // A tower boiling up: the same tower for the whole happening.
        if (h.kind === 'boil') {
            const tower = TOWERS[Math.min(built - 1, Math.floor(h.seed * built))];
            u.boil.value.set(tower.az * DEG, env, 0, 0);
        } else u.boil.value.set(99, 0, 0, 0);

        // Heat lightning: a few soft double pulses, deep inside one tower.
        if (h.kind === 'flicker') {
            const pick = Math.min(built - 1, Math.floor(slotHash(this.happenSlot, 7) * built));
            const tower = TOWERS[pick];
            let light = 0;
            let cx = 0;
            let cy = 0.5;
            for (let k = 0; k < 4; k += 1) {
                const x = h.age - (0.8 + k * 2.9 + slotHash(this.happenSlot, 10 + k) * 1.4);
                if (x <= 0 || x > 2.2) continue;
                const pulse = Math.exp(-x * 2.6) * (1 - Math.exp(-x * 22)) * (0.72 + 0.28 * Math.sin(x * 16));
                if (pulse > light) {
                    light = pulse;
                    cx = (slotHash(this.happenSlot, 20 + k) - 0.5) * 0.34;
                    cy = 0.3 + slotHash(this.happenSlot, 30 + k) * 0.42;
                }
            }
            // Reduce flashing: the same glow, softer.
            u.ember.value.set(tower.az * DEG, light * 1.6 * (0.4 + 0.6 * flashScale()), cx, cy);
        } else u.ember.value.set(99, 0, 0, 0.5);

        // Shooting stars: three across the happening, two slots.
        u.meteorGain.value.set(0, 0);
        if (h.kind === 'meteor') {
            for (let k = 0; k < 3; k += 1) {
                const s = (h.age - (1.2 + k * 4.6 + slotHash(this.happenSlot, 40 + k) * 2.2)) / 0.95;
                if (s <= 0 || s >= 1) continue;
                const az0 = this.targetYaw + (slotHash(this.happenSlot, 50 + k) - 0.5) * 1.05;
                const el0 = 0.3 + slotHash(this.happenSlot, 60 + k) * 0.2;
                const side = slotHash(this.happenSlot, 70 + k) < 0.5 ? -1 : 1;
                const dAz = side * (0.16 + slotHash(this.happenSlot, 80 + k) * 0.1);
                const dEl = -(0.08 + slotHash(this.happenSlot, 90 + k) * 0.07);
                const tail = Math.max(0, s - 0.42);
                const line = k % 2 === 0 ? u.meteorA.value : u.meteorB.value;
                line.set(az0 + dAz * s, el0 + dEl * s, az0 + dAz * tail, el0 + dEl * tail);
                const gain = Math.sin(Math.PI * s) ** 0.6;
                if (k % 2 === 0) u.meteorGain.value.x = gain;
                else u.meteorGain.value.y = gain;
            }
        }

        // The skein: one line across the view, edge to edge, whole from its first bird.
        if (h.kind === 'skein') {
            const dirSign = h.seed < 0.5 ? 1 : -1;
            const ny = 0.02 + slotHash(this.happenSlot, 5) * 0.34;
            const depth = 250 + slotHash(this.happenSlot, 6) * 70;
            const from = this.pointAt(-1.22 * dirSign, ny, depth, this._a);
            const to = this.pointAt(1.62 * dirSign, ny + 0.1, depth, this._b);
            const p = this._tmp.copy(from).lerp(to, h.u);
            u.skein.value.set(p.x, p.y + Math.sin(h.age * 0.5) * 2.5, p.z, t);
            this._tmp.copy(to).sub(from).normalize();
            u.skeinDir.value.set(this._tmp.x, this._tmp.y, this._tmp.z, 1);
        } else u.skeinDir.value.w = 0;
    }

    /** The happening in the sky now (diagnostics): its kind or null, and its age. */
    happeningNow() {
        return this._happen;
    }

    /** The surge at `t`, sampled once per frame whichever of updateCamera/update asks first. */
    sampleHeat(t) {
        if (t !== this.heatAt) {
            this.heatAt = t;
            const s = this.surge.sample(t);
            const h = this.heat;
            h.punch = s.punch;
            h.level = s.level;
            h.fever = s.fever;
            h.stage = s.stage;
        }
        return this.heat;
    }

    /** What the post stack reads this frame (bloom boost, rays, exposure, the closing veil). */
    postState() {
        return this._post;
    }

    /** Where the world stands (diagnostics and tests). */
    getState() {
        return {
            mood: this.moodName(),
            air: this.air.name,
            sunHeight: this.sunHeight,
            happening: this._happen.kind,
            dusk: this.dusk,
            road: this.road,
            lanterns: this.lanterns,
        };
    }

    seek(time) {
        this.time = time;
        this.sunPulse = 0;
        this.seaGlow = 0;
        for (const swell of [
            this.glow, this.warmth, this.flare, this.crownLight, this.dip, this.spin,
            this.corona, this.clarity, this.towerSurge, this.focus,
        ]) swell.reset();
        this.surge.reset();
        this.heatAt = Number.NaN;
        this.rings.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.rays.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.ripples.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.skyWave.t0 = -1e6;
        this.skyWave.energy = 0;
        this.glory.t0 = -1e6;
        this.glory.energy = 0;
        this.climbAt = -1e6;
        this.rayTurn = 0;
        this.road = 0;
        this.roadGoal = 0;
        this.lanterns = 0;
        this.lanternGoal = 0;
        this.coronaTurn = 0;
        this.dusk = 0;
        this.duskGoal = 0;
        this.flight = time;
        this.seaLead = 0;
        this.beamTurn = 0;
        this.ceilFlowX = time * 0.012;
        this.ceilFlowY = time * 0.0035;
        this.hardDropPending = false;
        this.chainWatch = 0;
        this.b2bStreak = 0;
        this.b2bAt = -1e6;
        this.happenSlot = -1;
        this.fx?.clear();
        this.applyMood(1);
        this.applyAir(time, 0, 0);
    }

    /** A new run: no chain in flight, the heat of the last one gone (the clocks run on). */
    resetSession() {
        this.surge.reset();
        this.heatAt = Number.NaN;
        this.hardDropPending = false;
        this.chainWatch = 0;
        this.b2bStreak = 0;
        this.b2bAt = -1e6;
        this.roadGoal = 0;
        this.lanternGoal = 0;
    }

    // ── Events ───────────────────────────────────────────────────────────────
    // Each adds to what is lit; none restarts it. `at` is the world clock of the last frame.

    /** Same tick as, and just before, the PIECE_LOCK of the same piece. */
    onHardDrop() {
        this.hardDropPending = true;
    }

    /**
     * A piece locked: a ripple of light spreads on the deck beside the board (wider for a hard
     * drop) and the flight dips. `chain` is the true combo it carries in (ComboTracker): when it
     * is a chain of two or more and no clear follows within CHAIN_GRACE, the chain has ended
     * (see update()).
     */
    onPieceLock({ chain = 0 } = {}) {
        const at = this.time;
        const hard = this.hardDropPending;
        this.hardDropPending = false;
        this.chainWatch = chain >= 2 ? chain : 0;
        this.chainWatchAt = at;
        this.surge.lock({ hardDrop: hard }, at);
        this.glow.hit(0.08, at);
        this.warmth.hit(0.05, at);
        this.dip.hit(hard ? 0.45 : 0.15, at);
        // A lock that comes while the veil is closed opens it: the safety net.
        if (this.duskGoal > 0) {
            this.duskGoal = 0;
            this.duskRate = 1.8;
        }
        const ripple = this.triggerRipple(hard ? 1.0 : 0.62, hard ? 0.27 : 0.16);
        // A few glints lift off the deck where it landed; more the quicker the hand.
        const glints = Math.round((hard ? 4 : 2) + 7 * this.heat.level);
        this.emitPuff(ripple.x, ripple.z, hard ? 16 : 9, glints);
    }

    /**
     * A wave of a line clear. `cascade` is the wave's depth (1 = the lock's own clear), `combo`
     * the true consecutive-clear combo (ComboTracker), `chainStep` true on the wave that
     * advanced it. The lock's own clear sends a light wave for each line, in echelon; each
     * cascade wave after it sends one, brighter, wider, faster and hotter than the last. Four
     * lines also send a wave over the high cloud. A chain lights its stepping stones.
     */
    onLineClear(lines = 1, { cascade = 1, combo = 1, chainStep = false } = {}) {
        const n = Math.max(1, Math.min(4, lines | 0));
        const at = this.time;
        const depth = Math.max(1, Math.min(12, cascade | 0));
        const chain = Math.max(1, combo | 0);
        const deep = depth - 1;
        const steps = Math.min(9, chain - 1);
        this.chainWatch = 0;
        if (depth <= 1) this.surge.clear({ lines: n, cascade: 1, combo: chain }, at);
        else this.surge.wave(at);
        // The hotter play runs, the finer the bands: a procession of bright lines rolling in
        // over the heads, not a flood of light over the whole deck.
        const { level, fever } = this.heat;
        const bands = depth <= 1 ? n : 1;
        const share = depth <= 1 ? (0.5 + 0.06 * n) : (0.45 + 0.18 * n);
        for (let k = 0; k < bands; k += 1) {
            this.triggerRing({
                delay: k * ECHELON,
                energy: share * (1 + 0.3 * deep) * (1 + 0.05 * steps),
                dur: 3 / (1 + 0.12 * deep),
                widthK: (1 + 0.15 * deep + 0.04 * steps) / ((1 + 1.1 * level + 0.6 * fever) * (1 + 0.12 * (bands - 1))),
                heat: Math.min(1, 0.2 * deep + 0.07 * steps + 0.5 * fever + 0.3 * level),
            });
        }
        this.glow.hit(0.15 * n, at);
        this.warmth.hit(0.25 * n, at);
        this.emitRisingSparkles(this.burstCount(0.05 * n + 0.01 * deep, 18 * n + 8 * deep));
        // A chain's every new step lights the next stone, nearer the lens than the last.
        if (chain >= 2) {
            this.roadGoal = Math.min(ROAD_STONES.length, chain - 1);
            this.focus.hit(0.12, at);
        }
        if (chainStep && chain >= 3) {
            this.emitHeavenlyBurst(this.burstCount(0.02 + 0.008 * steps, 14 + 5 * steps));
        }
        if (n >= 4) {
            this.glow.hit(0.2, at);
            this.flare.hit(0.8, at);
            this.crownLight.hit(0.3, at);
            this.focus.hit(0.7, at);
            this.triggerSkyWave(1.0, 0);
            this.emitHeavenlyBurst(this.burstCount(0.25, 110));
        }
    }

    /**
     * COMBO: the CASCADE depth of one lock (ADR-0011), from its second wave. Each wave stands a
     * ray in the sky, on the next bearing of the fan, a little brighter than the last.
     */
    onCombo(count = 1) {
        const c = Math.max(0, count | 0);
        const at = this.time;
        this.glow.hit(0.12, at);
        this.warmth.hit(0.2, at);
        // Each wave flares the sun a little more than the last.
        this.flare.hit(0.06 + 0.05 * Math.min(c, 10), at);
        this.triggerRay(0.8 + 0.08 * Math.min(c, 8));
        this.focus.hit(0.2, at);
        if (c >= 3) this.emitHeavenlyBurst(this.burstCount(0.04 + c * 0.02, 20 + 10 * c));
    }

    /**
     * A twist: a corona of mother-of-pearl opens round the sun and its colours run into the high
     * cloud, while the fan of beams turns; one that cleared nothing does both a little.
     */
    onTwist(lines = 0) {
        const at = this.time;
        const cleared = (lines | 0) > 0;
        if (cleared) this.surge.twist(at);
        else this.surge.spin(at);
        this.spin.hit(cleared ? 0.9 : 0.45, at);
        this.flare.hit(cleared ? 0.5 : 0.18, at);
        this.corona.hit(cleared ? 1.0 : 0.5, at);
        this.focus.hit(cleared ? 0.4 : 0.15, at);
        this.emitHeavenlyBurst(this.burstCount(cleared ? 0.05 : 0.02, cleared ? 40 : 14));
    }

    /**
     * Back-to-back: a lantern lights at the heart of a tower, a gold tide line rolls in fast
     * and halts mid-deck, lingering, and the towers' crowns light. Each one in a streak sets its
     * line nearer and brighter and lights one more tower's lantern.
     */
    onB2B() {
        const at = this.time;
        this.surge.b2b(at);
        this.b2bStreak = at - this.b2bAt < 25 ? this.b2bStreak + 1 : 1;
        this.b2bAt = at;
        const k = Math.min(4, this.b2bStreak);
        this.triggerRing({
            mode: RING_HOLD,
            hold: 300 - 40 * k,
            linger: 1.2 + 0.2 * k,
            dur: 1.4,
            energy: 0.8 + 0.15 * k,
            widthK: 0.55,
            heat: Math.min(1, 0.55 + 0.1 * k),
        });
        this.lanternGoal = Math.min(Math.max(1, this.q.towers), this.b2bStreak);
        this.focus.hit(0.35, at);
        this.crownLight.hit(0.3 + 0.1 * k, at);
        this.flare.hit(0.2, at);
    }

    /**
     * A perfect clear settles ~360 ms after its clear's last wave: the crown on that clear,
     * layered on its light, never a new clear. The whole fan of rays opens round the sun at
     * once, every tower crown lights, the air clears to the horizon, and a great wave rolls OUT
     * from under the camera carrying the spectrum, on the deck and over the high cloud: the
     * release.
     */
    onPerfectClear() {
        const at = this.time;
        this.surge.crown(at);
        this.crownLight.hit(1.0, at);
        this.flare.hit(0.5, at);
        for (let k = 0; k < RAY_SLOTS; k += 1) this.triggerRay(0.9, k * 0.07);
        this.clarity.hit(1.0, at);
        this.focus.hit(1.0, at);
        this.triggerRing({
            mode: RING_OUT, dur: 3.4, energy: 0.9, widthK: 0.9, heat: 0.85,
        });
        this.glory.t0 = at;
        this.glory.energy = 1;
        this.triggerSkyWave(1.0, 1);
        this.emitHeavenlyBurst(this.burstCount(0.3, 140));
    }

    /** A chain of clears ended (a lock that cleared nothing): the world breathes out. */
    onChainEnd(chain = 2) {
        const steps = Math.min(9, Math.max(1, chain | 0) - 1);
        this.roadGoal = 0;
        this.triggerRing({
            mode: RING_OUT, dur: 3.8, energy: 0.35 + 0.05 * steps, widthK: 1.3, heat: 0.1,
        });
        this.emitRisingSparkles(this.burstCount(0.04 + 0.01 * steps, 20 + 6 * steps));
    }

    /**
     * A new level: light climbs every tower from the deck to its crown while the towers surge,
     * with a wave and a burst (the hour's step comes with setLevel, which the theme calls
     * whether or not background effects are on: that setting gates reactions, not the light).
     */
    onLevelUp() {
        const at = this.time;
        this.surge.levelUp(at);
        this.glow.hit(0.4, at);
        this.warmth.hit(0.5, at);
        this.crownLight.hit(0.25, at);
        this.towerSurge.hit(1, at);
        this.focus.hit(0.5, at);
        this.climbAt = at;
        this.triggerRing({ energy: 1.0, heat: 0.3 });
        this.emitHeavenlyBurst(this.burstCount(0.2, 90));
    }

    /**
     * The run is over: the veil closes. The mist takes the towers, the veils thicken, the light
     * drains, and it stands so until the next run (onSessionStart) or until the mode is left
     * (onSessionStop). A lock that comes while it is closed opens it too: the safety net.
     */
    onGameOver() {
        this.duskGoal = 1;
        this.duskRate = 0.8;
        this.roadGoal = 0;
        this.chainWatch = 0;
    }

    /** A new run: the veil lifts on a fan of rays (a small one when it was never closed). */
    onSessionStart() {
        const at = this.time;
        const lifted = this.duskGoal > 0 || this.dusk > 0.05;
        this.duskGoal = 0;
        this.duskRate = 1.8;
        this.resetSession();
        const fan = lifted ? 5 : 3;
        for (let k = 0; k < fan; k += 1) this.triggerRay(lifted ? 0.7 : 0.45, k * 0.11);
        this.flare.hit(lifted ? 0.6 : 0.3, at);
        if (lifted) this.crownLight.hit(0.4, at);
    }

    /** The mode was left with the veil closed: it lifts quietly. */
    onSessionStop() {
        this.duskGoal = 0;
        this.duskRate = 0.6;
        this.resetSession();
    }

    /**
     * Start a light wave in the slot with the least light left (a finished one first), so a
     * wave still crossing the deck is never pulled back to the horizon while a weaker one waits.
     * `delay` starts it that many seconds from now (a band of an echelon): a slot waiting for
     * its start, or only just started, counts as full.
     */
    triggerRing({
        energy, dur = 3, widthK = 1, heat = 0, mode = RING_IN, hold = 0, linger = 1, delay = 0,
    }) {
        const t = this.time;
        let slot = 0;
        let least = Infinity;
        this.rings.forEach((ring, i) => {
            const age = t - ring.t0;
            let left;
            // A wave that has not begun, or is still rising (two events of one tick: four lines
            // and their back-to-back), has all of its light still to show.
            if (age < 0.3 && ring.energy > 0) left = ring.energy * (1 + ring.dur);
            else {
                const s = ringState(ring, age, this._ring);
                // What it still has to show: its light now, weighted by the life it has left.
                left = s.energy > 0 ? s.energy * (1 + Math.max(0, ring.dur - age)) : 0;
            }
            if (left < least) {
                least = left;
                slot = i;
            }
        });
        Object.assign(this.rings[slot], {
            t0: t + delay, energy, dur, widthK, heat, mode, hold, linger,
        });
    }

    /** Stand a ray in the sky on the next bearing of the fan (the slot with the least light left). */
    triggerRay(energy, delay = 0) {
        const t = this.time;
        let slot = 0;
        let oldest = Infinity;
        for (let i = 0; i < RAY_SLOTS; i += 1) {
            if (this.rays[i].t0 < oldest) {
                oldest = this.rays[i].t0;
                slot = i;
            }
        }
        const bearing = (RAY_FAN[this.rayTurn % RAY_FAN.length] + (this.rand() - 0.5) * 9) * DEG;
        this.rayTurn += 1;
        Object.assign(this.rays[slot], {
            t0: t + delay, energy, cos: Math.cos(bearing), sin: Math.sin(bearing), sharp: 320 + this.rand() * 240,
        });
    }

    /** Send a wave over the high cloud (`spectrum` 1: it carries the colours of the bow). */
    triggerSkyWave(energy, spectrum = 0) {
        this.skyWave.t0 = this.time;
        // A band crossing the sky is no frame-wide flash, but Reduce flashing softens it too.
        this.skyWave.energy = energy * 1.4 * (0.5 + 0.5 * flashScale());
        this.skyWave.spectrum = spectrum;
    }

    /**
     * A ripple on the deck, in the open stage beside the board: the lane's point on the deck. Its
     * fullest radius is `reach` times its distance, so near or far it is the same size on screen.
     */
    triggerRipple(energy, reach) {
        const r = this.ripples[this.rippleCursor % RIPPLE_SLOTS];
        this.rippleCursor += 1;
        const depth = 62 + this.rand() * 80;
        const tanH = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2) * this.lens.aspect;
        const side = this.laneX() * tanH * depth;
        const sy = Math.sin(this.yaw);
        const cy = Math.cos(this.yaw);
        r.x = RIG.x + sy * depth + cy * side;
        r.z = RIG.z - cy * depth + sy * side;
        r.t0 = this.time;
        r.energy = energy;
        r.reach = reach * depth;
        return r;
    }

    /** Glints lifting off the deck round a point (a lock's ripple): a small puff, `spread` wide. */
    emitPuff(x, z, spread, count) {
        const t = this.time;
        const r = this.rand;
        for (let i = 0; i < count; i += 1) {
            const a = r() * Math.PI * 2;
            const d = Math.sqrt(r()) * spread * 0.5;
            this.fx.spawnSparkle(
                t + r() * 0.2,
                x + Math.cos(a) * d,
                3 + r() * 4,
                z + Math.sin(a) * d,
                Math.cos(a) * 2.5,
                5 + r() * 6,
                Math.sin(a) * 2.5,
                1.6 + r() * 1.0,
                GLINT_COLORS[Math.floor(r() * GLINT_COLORS.length)],
                6 + r() * 6,
                {
                    drag: 0.9, lift: 1.5, twinkle: 7 + r() * 6, phase: r() * 6.28,
                },
            );
        }
    }

    /** A screen x (NDC) in the open stage: beside the board and its HUD, never behind them. */
    laneX() {
        const b = this.board;
        const r = this.rand();
        if (!b) return -0.85 + 1.7 * r;
        // A lane keeps clear of the screen's edge too: a ripple cut by it reads as a streak.
        const left = Math.max(0, b.x0 - 0.07);
        const right = Math.max(0, 0.9 - (b.x1 + 0.19));
        const useLeft = right < 0.04 || this.rand() < left / Math.max(1e-3, left + right);
        const fx = useLeft ? 0.09 + r * Math.max(0.02, left - 0.09) : b.x1 + 0.19 + r * right;
        return fx * 2 - 1;
    }

    burstCount(share, cap) {
        return Math.max(12, Math.min(cap, Math.floor(this.fx.sparkleCapacity * share)));
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
        return {
            x: this.sunDir.dot(right) / sd / tanH,
            y: this.sunDir.dot(up) / sd / tanV,
            ry: Math.tan(SUN.radius * 2.5) / sd / tanV,
            rx: (Math.tan(SUN.radius * 2.5) / sd / tanV) * (tanV / tanH),
        };
    }

    /**
     * A heavenly burst (four lines, a deep cascade, a new level): golden glints leave the sun and
     * drift to their own targets across the WHOLE screen — 70 % anywhere in the view, 30 % around
     * the sun — then float upward and twinkle out. Velocities are solved from the drag model
     * (travel = v / drag).
     */
    emitHeavenlyBurst(requested) {
        // A third as many glints under reduced motion.
        const count = Math.round(requested * (0.35 + 0.65 * (this.motion ?? 1)));
        const t = this.time;
        const r = this.rand;
        const drag = 1.1;
        const sun = this.sunNdc();
        for (let i = 0; i < count; i += 1) {
            const a = r() * Math.PI * 2;
            const rr = Math.sqrt(r());
            this.pointAt(sun.x + Math.cos(a) * rr * sun.rx, sun.y + Math.sin(a) * rr * sun.ry, BURST_DEPTH, this._a);
            let tx;
            let ty;
            if (r() < 0.7) {
                tx = -1.15 + r() * 2.3;
                ty = -0.8 + r() * 1.9;
            } else {
                const b = r() * Math.PI * 2;
                const d = 0.12 + r() * 0.4;
                tx = sun.x + Math.cos(b) * d;
                ty = sun.y + Math.sin(b) * d * 1.4;
            }
            this.pointAt(tx, ty, BURST_DEPTH, this._b);
            const reach = (0.85 + r() * 0.35) * drag;
            this.fx.spawnSparkle(
                t + r() * 0.15,
                this._a.x,
                this._a.y,
                this._a.z,
                (this._b.x - this._a.x) * reach,
                (this._b.y - this._a.y) * reach,
                (this._b.z - this._a.z) * reach,
                2.6 + r() * 1.6,
                GLINT_COLORS[Math.floor(r() * GLINT_COLORS.length)],
                7 + r() * 9,
                {
                    drag, lift: 0.8 + r() * 1.2, twinkle: 6 + r() * 8, phase: r() * 6.28,
                },
            );
        }
    }

    /** Glints rising off the cloud domes across the view (line clears). */
    emitRisingSparkles(count) {
        const t = this.time;
        const r = this.rand;
        for (let i = 0; i < count; i += 1) {
            const D = 45 + r() * 120;
            this.pointAt(-1.05 + r() * 2.1, -0.7 + r() * 0.5, D, this._a);
            this._a.y = Math.max(this._a.y, 2);
            this.fx.spawnSparkle(
                t + r() * 0.3,
                this._a.x,
                this._a.y,
                this._a.z,
                (r() - 0.5) * 3,
                6 + r() * 6,
                (r() - 0.5) * 3,
                2.0 + r() * 1.2,
                GLINT_COLORS[Math.floor(r() * GLINT_COLORS.length)],
                6 + r() * 6,
                {
                    drag: 0.9, lift: 1.5, twinkle: 7 + r() * 6, phase: r() * 6.28,
                },
            );
        }
    }

    /** Hide everything but the named parts (sky sea cumulus fx) — iteration aid. */
    showOnlyParts(names) {
        const keep = new Set(names);
        for (const [name, part] of Object.entries(this.parts)) {
            if (part) part.visible = keep.has(name);
        }
        this.fx.group.visible = keep.has('fx');
    }

    dispose() {
        this.root.removeFromParent();
        for (const part of Object.values(this.parts)) {
            if (!part) continue;
            part.geometry?.dispose();
            part.material?.dispose();
        }
        this.fx?.dispose();
        this.parts = {};
    }
}
