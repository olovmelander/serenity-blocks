/**
 * Solar Eclipse — the world: the moment of totality over the salt mirror, and the board that
 * dresses the black sun.
 *
 * Builds the parts (the dome with the sun in it, the motes), owns the scene's state and writes it
 * to the shared uniforms once a frame. The gameplay arrives already resolved by the director:
 *
 *   onLock   a mote in the piece's colour leaves the card's edge at the piece's height and flies
 *            to the sun's limb (the board's columns laid over the top of the sun, left to
 *            right), where a PROMINENCE of that colour rises: an arch, or a ragged hedgerow. The
 *            limb keeps twelve; each stands about half a minute. It is born in a flare at its
 *            feet, and the mirror gives back the mote's flight and the flare. A hard drop raises
 *            a taller arch and a brighter flare, and jolts the lens.
 *   onClear  a necklace of light (Baily's beads) runs round the black sun, one bead per line,
 *            the chromosphere flashes, and the oldest prominences ERUPT, two per line: each
 *            lifts off the limb and is flung out through the corona. With none held, white
 *            jets run out instead. Four lines or a perfect clear bring the DIAMOND RING (the
 *            moon slides off until one lunar valley lets the photosphere through, and daylight
 *            floods back for a breath) and a coronal mass ejection. Every clear drops a ring
 *            into the sun's own reflection; the diamond lays a glitter path down the water and
 *            sends shadow bands racing over the salt. A T-spin twists the corona and winds a
 *            whirl into the mirror.
 *   onCombo  the chain is a longer exposure: the outer corona reaches further, the faint stars
 *            come out and earthshine lights the moon's face, and the water stills to glass. It
 *            closes slowly when the chain breaks.
 *   levelUp  the light turns one step (it also turns by itself, one step every HOUR_SECONDS):
 *            ember → gold → jade → azure → violet → rose → round again, and the solar cycle
 *            with it, from the long wings of a quiet sun to the round crown of an active one.
 *
 * Nothing restarts under fast play (src/themes/shared/gameplay-surge.js): the corona's swell, the
 * chromosphere's flash, the lens's kick and shake and a T-spin's twist are Swells, so every hit
 * adds to what is still lit; the necklace ADDS pearls to the one still turning (a cascade lights
 * more and more of the limb until it closes into a ring); a second diamond feeds the one still
 * burning (the moon stays slid off, the glare flares again) instead of snapping the moon back;
 * two CMEs may be in the air at once. A cascade's deeper waves add more beads, a brighter flash
 * and stronger rings, and the third throws off a CME; a back-to-back throws twin CMEs either side
 * of the crown; a perfect clear settled after its clear is the CROWN on it (the diamond held and
 * re-flared, the necklace closed into a full ring), never a second clear.
 *
 * The heat of play builds totality: warm, the corona swells and reaches further and the
 * chromosphere's pink rim brightens; hot, the sun wakes (new streamers sprout round the crown),
 * the 360° sunset on the horizon and the alpenglow on the far shore burn, the newest prominences
 * stand as a crown the clears no longer spend, the stars come out; fever is deep totality: the
 * sky darkens overhead, the necklace turns faster and the crown of coloured flux ropes rings the
 * black sun. The quad's diamond ring is the release: daylight floods back for a breath.
 *
 * Everything is a function of the clock and the events' start times, so a seek() that replays
 * the same events gives the same frame.
 */
import * as THREE from 'three/webgpu';
import {
    DEG,
    ERUPTION_SECONDS,
    HOUR_SECONDS,
    KIND,
    MIRROR,
    MOON,
    PALETTES,
    PALETTE_KEYS,
    PROMINENCES,
    PROMINENCE_LIFE,
    PROMINENCE_RISE,
    STREAMERS,
    STREAMER_SET,
    TAU,
    WORLD,
    approach,
    axisAt,
    bakeNoise,
    bakeRanges,
    clamp,
    clamp01,
    exposureFor,
    groundOf,
    hexToLinear,
    limbAngleFor,
    moonWander,
    mulberry32,
    paletteAt,
    prominenceShape,
    smooth01,
    streamersAt,
    sunFrame,
    umbraAzAt,
    wrapAngle,
} from './solar-eclipse-core.js';
import { tierFor } from './solar-eclipse-quality.js';
import {
    STREAKS, createNoiseTexture, createRangeTexture, createUniforms,
} from './solar-eclipse-tsl.js';
import { createSky } from './solar-eclipse-sky.js';
import { createFx } from './solar-eclipse-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './solar-eclipse-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

export const REST_RIG = Object.freeze({
    near: 1,
    far: 12000,
    /** A long lens: the sun and its corona fill the free space beside the card. */
    fov: 30,
});

/** Vertical field of view: 30° on a wide screen, opened up on a tall one so the scene still fits. */
export function fovForAspect(aspect) {
    const wide = Math.tan((REST_RIG.fov * Math.PI) / 360);
    const need = Math.tan(17 * DEG) / Math.max(0.3, aspect || 1);
    return Math.min(74, (Math.atan(Math.max(wide, need)) * 360) / Math.PI);
}

const PARTS = ['sky', 'motes'];

/** The frame height every pixel size in the scene is authored for. */
export const DESIGN_LINES = 1080;

const DEFAULT_SPARK = Object.freeze([1.0, 0.86, 0.62]);
/** Seconds a mote takes to reach the limb. */
const MOTE_FLIGHT = 0.8;
const MOTE_FLIGHT_HARD = 0.55;
/** The diamond: seconds to open, to hold, to close; how far it lights the day. */
const DIAMOND_OPEN = 0.38;
const DIAMOND_HOLD = 0.55;
const DIAMOND_CLOSE = 1.5;
/** A T-spin's twist of the corona (radians at the limb) and how it rings down. */
const TWIST = 1.0;
const TWIST_DECAY = 1.5;
/** Below this the twist has rung down (radians). */
const TWIST_REST = 0.002;
/**
 * The necklace: the most pearls round the limb at once (a ring), how fast it turns (radians a
 * second, at rest), how bright a clear's light reads per unit of its swell, below what light it
 * has gone out (the next clear starts a new one at a new angle) and below what it is not drawn.
 */
const BEADS_MAX = 12;
const BEAD_SPIN = 2.7;
const BEAD_GAIN = 1.2;
const BEADS_LIVE = 0.15;
const BEADS_OUT = 0.03;
/** How fast a new bead splits off the first and slides into its place (per second). */
const BEAD_SPLIT = 5;
/**
 * Where a four-line clear's diamond breaks through and its CME leaves (position angles): beside
 * the card the CME climbs into the open sky up and away from the card (the frame above the sun is
 * only a few radii tall) and the diamond burns low on the card's side; above the card the CME
 * runs off to the side.
 */
const BESIDE = Object.freeze({ diamond: -32 * DEG, cme: 134 * DEG });
const ABOVE = Object.freeze({ diamond: -150 * DEG, cme: 12 * DEG });

/** The rings the gameplay drops on the mirror: their slope (strength) per event. */
const RING = Object.freeze({
    clear: 0.026,
    line: 0.009,
    great: 0.06,
    whirl: 0.05,
    level: 0.02,
});
/** How bright the diamond's glitter path burns on the water, per unit of its glare. */
const GLINT_POWER = 5.5;

/** Where smooth01 reads `s` (0..1): its inverse, by bisection. */
function unsmooth01(s) {
    if (!(s > 0)) return 0;
    if (s >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
        const mid = (lo + hi) * 0.5;
        if (smooth01(mid) < s) lo = mid;
        else hi = mid;
    }
    return (lo + hi) * 0.5;
}

/**
 * How far the moon has slid off the limb for a diamond ({ openAt, closeAt }) at `time`: it opens
 * over DIAMOND_OPEN from `openAt`, holds, and closes over DIAMOND_CLOSE from `closeAt`.
 */
export function diamondSwing(ring, time) {
    if (!ring) return 0;
    const open = smooth01((time - ring.openAt) / DIAMOND_OPEN);
    const close = 1 - smooth01((time - ring.closeAt) / DIAMOND_CLOSE);
    return Math.min(open, close);
}

export class SolarEclipseWorld {
    /**
     * @param {object} options
     * @param {THREE.Scene} options.scene
     * @param {string} [options.quality='High']
     * @param {boolean} [options.capture=false] a frozen or stepped clock: nothing eases in
     */
    constructor({ scene, quality = 'High', capture = false } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.u = createUniforms();
        this.root = new THREE.Group();
        this.root.name = 'solar-eclipse-world';
        this.parts = new Map();
        this.noise = null;
        this.rangeTexture = null;
        this.ranges = null;
        this.sky = null;
        this.fx = null;
        this.reduced = false;
        this.aspect = 16 / 9;
        this.bufferHeight = 1080;
        this.layout = null;
        this._camera = null;
        this._right = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._fwd = new THREE.Vector3(0, 0, -1);
        this._ray = new THREE.Vector3();
        this._rgb = [1, 1, 1];
        this._dir = [0, 0, 0];
        this._screen = { x: 0.5, y: 0.5, front: true };
        this._palette = {};
        this._moon = [0, 0];
        this._streamers = new Float32Array(STREAMERS);
        this._ground = [0, 0, 0];
        this._mirrored = [0, 0, 0];
        this._echoScreen = { x: 0, y: 0, front: true };
        this._post = {
            flash: 0,
            kick: 0,
            bloomBoost: 0,
            exposure: 1,
            ripple: {
                x: 0.2, y: 0.36, radius: 0, strength: 0,
            },
            moon: {
                x: 0.2, y: 0.36, radius: 0, matte: 0,
            },
            echo: {
                x: 0.2, y: 0.84, radius: 0, matte: 0,
            },
            /** The water: where the horizon stands on screen (y down) and how far it stirs. */
            water: { horizon: WORLD.horizonY, stir: 1 },
        };
        this._level = [0, 0, -1];
        this.frame = sunFrame(0, 12 * DEG);
        this.sunAz = 0;
        this.sunAlt = 12 * DEG;
        this.sunAzTarget = 0;
        this.sunAltTarget = 12 * DEG;
        this.sunScreenX = WORLD.sunScreenX;
        this.sunScreenY = WORLD.sunScreenY;
        this.sunBeside = true;
        this.freeShare = 0.3;
        this.composed = false;
        /**
         * Every reaction ACCUMULATES (src/themes/shared/swell.js): a hit adds to what is still lit
         * and never restarts it, so a single after a quad lifts the light instead of cutting it.
         *   corona   the corona's swell on a lock's landing and a clear (u.surge)
         *   flashes  the chromosphere's flash (u.flash; `flash` is its reading this frame)
         *   shake    the lens's shake (radians); kick the post's fringe
         *   twist    a T-spin's twist of the corona (× TWIST radians), wound in, ringing down
         *   burst    the diamond's flare as the light breaks through (each re-flare adds)
         *   beads    the necklace's light (× BEAD_GAIN)
         */
        this.corona = new Swell({ release: 1.6, ceiling: 0.62, knee: 0.38 });
        this.flashes = new Swell({ release: 0.9, ceiling: 1.2, knee: 1.0 });
        /** The chromosphere's flash as it burns this frame (the swell's reading). */
        this.flash = 0;
        this.shake = new Swell({ release: 0.35, ceiling: 0.0034, knee: 0.0024 });
        this.kick = new Swell({ release: 0.3, ceiling: 1.1, knee: 0.7 });
        this.twist = new Swell({
            attack: 0.3, release: TWIST_DECAY, ceiling: 1.8, knee: 1.2,
        });
        this.burst = new Swell({
            attack: 0.1, release: 0.2, ceiling: 1.6, knee: 1.0,
        });
        this.beadLight = new Swell({
            attack: 0.04, release: 1.9, ceiling: 1.25, knee: 0.9,
        });
        /** The necklace: its turn (radians), when it began, the pearls it holds and those shown. */
        this.necklace = {
            angle: 0, at: -100, count: 0, shown: 0,
        };
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js): totality deepens with it.
         * `heat` is its reading as of the last frame (events read it, the post state too).
         */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.resetState(0);
    }

    /** Totality at rest at `time`: no prominence held, the exposure short, nothing in the air. */
    resetState(time) {
        this.time = time;
        this.rand = mulberry32(20170821);
        this.combo = 0;
        this.exposure = 0;
        this.exposureTarget = 0;
        this.level = 1;
        this.hourShift = 0;
        this.corona.reset();
        this.flashes.reset();
        this.flash = 0;
        this.shake.reset();
        this.kick.reset();
        this.twist.reset();
        this.burst.reset();
        this.beadLight.reset();
        this.necklace.angle = 0;
        this.necklace.at = -100;
        this.necklace.count = 0;
        this.necklace.shown = 0;
        this.surge.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        this.diamond = null;
        this.scheduled = [];
        this.prominences = Array.from({ length: PROMINENCES }, () => ({
            on: false,
            born: 0,
            erupts: 1e6,
            fades: 1e6,
            kind: KIND.arch,
            angle: 0,
            halfWidth: 0.1,
            height: 0.2,
            seed: 0,
            rgb: [1, 1, 1],
            power: 1,
            serial: 0,
        }));
        this.serial = 0;
        this.streakEnds = new Float64Array(STREAKS).fill(-1000);
        this.rippleAt = new Float64Array(MIRROR.ripples).fill(-1000);
        this.cursor = { streak: 0 };
        const { u } = this;
        u.tables.streaks.forEach((row, i) => row.set(0, i % 4 < 2 ? 1 : 0, 0, i % 4 === 0 ? -1000 : 0));
        u.tables.prominences.forEach((row) => row.set(0, 0, 0, 0));
        u.tables.ripples.forEach((row) => row.set(0, 0, -1000, 0));
        u.glass.value = 0;
        u.glint.value.w = 0;
        u.bands.value = 0;
        u.beads.value.set(0, -100, 0, 0);
        u.cme.value.set(0, -100, 0, 0.6);
        u.cme2.value.set(0, -100, 0, 0.6);
        u.twist.value = 0;
        u.diamond.value.set(1, 0, 0, 0);
        u.daylight.value = 0;
    }

    build() {
        const { u, tier } = this;
        this.noise = createNoiseTexture(bakeNoise(2017));
        this.ranges = bakeRanges();
        this.rangeTexture = createRangeTexture(this.ranges);
        this.sky = createSky({
            u, noise: this.noise, ranges: this.rangeTexture, tier,
        });
        this.fx = createFx({ u, tier });
        this.addPart('sky', this.sky.object);
        this.addPart('motes', this.fx.motes);
        this.scene.add(this.root);
        this.compose();
        this.applyPalette();
        this.writeTables();
        return this;
    }

    addPart(name, object) {
        this.parts.set(name, object);
        this.root.add(object);
    }

    /** Debug: draw only the named parts. */
    showOnlyParts(names) {
        const wanted = new Set(names);
        this.parts.forEach((object, name) => {
            object.visible = wanted.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (bufferHeight > 0) this.bufferHeight = bufferHeight;
        if (aspect > 0) this.aspect = aspect;
        this.updatePixelAngle();
        this.compose();
    }

    /** The live card/board/HUD rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (aspect > 0) this.aspect = aspect;
        this.compose();
    }

    setReducedMotion(reduced) {
        this.reduced = reduced === true;
    }

    seek(time) {
        this.resetState(time);
        this.applyPalette();
        this.writeTables();
        this.writeSun();
    }

    /** A new run: the prominences fade, the exposure closes, the light eases back. */
    resetSession() {
        this.combo = 0;
        this.exposureTarget = 0;
        this.level = 1;
        this.scheduled.length = 0;
        this.prominences.forEach((p) => {
            if (p.on) p.fades = Math.min(p.fades, this.time + 2.5);
        });
    }

    bindCamera(camera) {
        this._camera = camera;
        this.updatePixelAngle();
    }

    fov() {
        return fovForAspect(this.aspect);
    }

    /** The field of view of the lens really drawn through (a capture may aim its own). */
    lensFov() {
        return this._camera?.fov ?? this.fov();
    }

    /** The lens's tilt: the horizon sits at WORLD.horizonY on screen. */
    pitch() {
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        return Math.atan((WORLD.horizonY - 0.5) * 2 * tan);
    }

    /**
     * The sun's angular radius (radians): a set share of the frame (smaller over a tall card),
     * and never so large that its crown overflows the free space beside the card.
     */
    sunRadius() {
        const fov = this.fov();
        if (!this.sunBeside) return WORLD.sunShare * 0.5 * fov * DEG;
        const across = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * this.aspect);
        return Math.min(WORLD.sunShare * fov * DEG, this.freeShare * across * 0.3);
    }

    updatePixelAngle() {
        const fov = this._camera?.fov ?? this.fov();
        const span = 2 * Math.tan((fov * Math.PI) / 360);
        const { u } = this;
        u.design.value = span / DESIGN_LINES;
        u.texel.value = span / Math.max(1, this.bufferHeight);
        const tanR = Math.tan(this.sunRadius());
        u.sunTan.value = tanR;
        u.designR.value = u.design.value / tanR;
        u.pxR.value = u.texel.value / tanR;
    }

    /** The layout the picture is composed for: the live one, else the stylesheet's solo layout. */
    layoutNow() {
        if (this.layout) return this.layout;
        const win = typeof window !== 'undefined' ? window : null;
        const height = win?.innerHeight || 1080;
        const width = win?.innerWidth || height * this.aspect;
        return fallbackLayout(width, height);
    }

    /** Screen point (fractions, y down) → its (azimuth, altitude) at rest, into `out`. */
    restAngles(sx, sy, out = [0, 0]) {
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        const nx = (sx * 2 - 1) * tan * this.aspect;
        const ny = (1 - sy * 2) * tan;
        const p = this.pitch();
        // forward (0, sin p, −cos p), right (1, 0, 0), up (0, cos p, sin p)
        const x = nx;
        const y = Math.sin(p) + ny * Math.cos(p);
        const z = -Math.cos(p) + ny * Math.sin(p);
        out[0] = Math.atan2(x, -z);
        out[1] = Math.atan2(y, Math.hypot(x, z));
        return out;
    }

    /**
     * Stand the sun in the free space left of the card (above it when the screen is too narrow to
     * leave any): the whole crown is seen beside the board.
     */
    compose() {
        const layout = this.layoutNow();
        const card = cardUnion(layout);
        const free = card ? card.x0 : 0.3;
        this.freeShare = free;
        this.sunBeside = free > 0.17;
        if (this.sunBeside) {
            this.sunScreenX = clamp(free * 0.5, 0.11, 0.3);
            this.sunScreenY = WORLD.sunScreenY;
        } else {
            this.sunScreenX = 0.5;
            this.sunScreenY = clamp((card ? card.y0 : 0.2) * 0.52, 0.06, 0.3);
        }
        const angles = this.restAngles(this.sunScreenX, this.sunScreenY);
        this.sunAzTarget = angles[0];
        this.sunAltTarget = angles[1];
        if (!this.composed || this.capture) {
            this.sunAz = this.sunAzTarget;
            this.sunAlt = this.sunAltTarget;
            this.composed = true;
        }
        this.updatePixelAngle();
        this.writeSun();
    }

    /** The sun's direction, and where it stands in the lens's image plane, to the uniforms. */
    writeSun() {
        const { u, frame } = this;
        sunFrame(this.sunAz, this.sunAlt, frame);
        const d = frame.dir;
        u.sunDir.value.set(d[0], d[1], d[2]);
        const f = Math.max(1e-4, d[0] * this._fwd.x + d[1] * this._fwd.y + d[2] * this._fwd.z);
        u.sunAt.value.set(
            (d[0] * this._right.x + d[1] * this._right.y + d[2] * this._right.z) / f,
            (d[0] * this._up.x + d[1] * this._up.y + d[2] * this._up.z) / f,
        );
    }

    /** Take the lens's basis from a camera (the rig's, or a capture's own aim). */
    adoptCamera(camera) {
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        this._right.set(e[0], e[1], e[2]);
        this._up.set(e[4], e[5], e[6]);
        this._fwd.set(-e[8], -e[9], -e[10]);
        const { u } = this;
        u.camRight.value.copy(this._right);
        u.camUp.value.copy(this._up);
        u.camFwd.value.copy(this._fwd);
        this.writeSun();
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const still = this.reduced;
        let yaw = 0;
        let pitch = this.pitch();
        if (!still) {
            yaw = Math.sin(t * 0.041) * 0.0035 + Math.sin(t * 0.017 + 1.3) * 0.002 - (sim.pointerX || 0) * 0.008;
            pitch += Math.sin(t * 0.029 + 0.7) * 0.0018 - (sim.pointerY || 0) * 0.005;
            const shake = this.shake.valueAt(t);
            if (shake > 1e-4) {
                yaw += shake * Math.sin(t * 57.3) * Math.cos(t * 21.1);
                pitch += shake * Math.sin(t * 43.9 + 1.0);
            }
        }
        const fov = this.fov();
        if (camera.fov !== fov) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
            this.updatePixelAngle();
        }
        camera.position.set(0, 0, 0);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
        // The shared breath (shared/camera-breath.js) on top of the sway above, before the lens's
        // basis is taken from the camera: the view only turns (a sky has no near layer), off under
        // reduced motion.
        applyCameraBreath(camera, t, { scale: still ? 0 : 1 });
        this.adoptCamera(camera);
    }

    /** A screen point (fractions, y down) → the ray through it, in `out` (unit). */
    screenRay(sx, sy, out = this._ray) {
        const tan = Math.tan((this.lensFov() * Math.PI) / 360);
        const nx = (sx * 2 - 1) * tan * this.aspect;
        const ny = (1 - sy * 2) * tan;
        return out.copy(this._fwd).addScaledVector(this._right, nx).addScaledVector(this._up, ny).normalize();
    }

    /** A world direction (three numbers) → where it is on screen, in `out` ({ x, y, front }). */
    screenOf(d, out = this._screen) {
        const f = d[0] * this._fwd.x + d[1] * this._fwd.y + d[2] * this._fwd.z;
        const tan = Math.tan((this.lensFov() * Math.PI) / 360);
        const safe = Math.max(f, 1e-3);
        out.front = f > 0.02;
        const across = d[0] * this._right.x + d[1] * this._right.y + d[2] * this._right.z;
        const upward = d[0] * this._up.x + d[1] * this._up.y + d[2] * this._up.z;
        out.x = 0.5 + across / safe / (2 * tan * this.aspect);
        out.y = 0.5 - upward / safe / (2 * tan);
        return out;
    }

    /** A point of the sun's plane (solar radii) → its world direction, into `out`. */
    sunPoint(x, y, out = this._dir) {
        const { u } = this;
        const tx = u.sunAt.value.x + x * u.sunTan.value;
        const ty = u.sunAt.value.y + y * u.sunTan.value;
        out[0] = this._fwd.x + this._right.x * tx + this._up.x * ty;
        out[1] = this._fwd.y + this._right.y * tx + this._up.y * ty;
        out[2] = this._fwd.z + this._right.z * tx + this._up.z * ty;
        const n = Math.hypot(out[0], out[1], out[2]) || 1;
        out[0] /= n;
        out[1] /= n;
        out[2] /= n;
        return out;
    }

    // ── events ──────────────────────────────────────────────────────────────────

    schedule(time, run) {
        this.scheduled.push({ time, run });
    }

    colourOf(hex) {
        const rgb = this._rgb;
        if (!hexToLinear(hex, rgb)) {
            rgb[0] = DEFAULT_SPARK[0];
            rgb[1] = DEFAULT_SPARK[1];
            rgb[2] = DEFAULT_SPARK[2];
        }
        // Lift a dark colour so every piece's light reads against the corona.
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
        const gain = Math.max(1, 0.9 / peak);
        rgb[0] = Math.min(1.4, rgb[0] * gain);
        rgb[1] = Math.min(1.4, rgb[1] * gain);
        rgb[2] = Math.min(1.4, rgb[2] * gain);
        return rgb;
    }

    /**
     * A mote from one world direction to another (unit, three numbers each): a free slot, else
     * the mote nearest its landing (never one just leaving the card).
     */
    streak(from, to, {
        start = this.time, duration = 0.8, rgb = DEFAULT_SPARK, power = 1, tail = 0.3, width = 3.6, bow = 0,
    } = {}) {
        const slots = this.fx?.count ?? STREAKS;
        let index = -1;
        let soonest = 0;
        for (let i = 0; i < slots; i += 1) {
            const candidate = (this.cursor.streak + i) % slots;
            if (this.streakEnds[candidate] <= this.time) {
                index = candidate;
                break;
            }
            if (index < 0 || this.streakEnds[candidate] < soonest) {
                soonest = this.streakEnds[candidate];
                index = candidate;
            }
        }
        this.cursor.streak = index + 1;
        this.streakEnds[index] = start + duration + 0.2;
        const { streaks } = this.u.tables;
        streaks[index * 4].set(from[0], from[1], from[2], start);
        streaks[index * 4 + 1].set(to[0], to[1], to[2], duration);
        streaks[index * 4 + 2].set(rgb[0], rgb[1], rgb[2], power);
        streaks[index * 4 + 3].set(0, tail, width, bow);
    }

    /**
     * A ring (kind 0) or a whirl (kind 1) dropped on the mirror at ground point (x, z) metres:
     * the oldest slot is taken.
     */
    ripple(x, z, {
        strength = RING.clear, kind = 0, turn = 2.6, start = this.time,
    } = {}) {
        let index = 0;
        for (let i = 1; i < MIRROR.ripples; i += 1) {
            if (this.rippleAt[i] < this.rippleAt[index]) index = i;
        }
        this.rippleAt[index] = start;
        const { ripples } = this.u.tables;
        ripples[index * 2].set(x, z, start, strength);
        ripples[index * 2 + 1].set(kind, turn, 0, 0);
        return index;
    }

    /** The ground point (metres) under a screen point (fractions, y down), or null above the horizon. */
    groundAtScreen(sx, sy, out = this._ground) {
        const ray = this.screenRay(sx, sy, this._ray);
        return groundOf([ray.x, ray.y, ray.z], out);
    }

    /**
     * Where the sun stands in the mirror: the ground point (metres) that reflects a point of the
     * sun's plane (solar radii) to the lens.
     */
    reflectionPoint(x = 0, y = 0, out = this._ground) {
        const d = this.sunPoint(x, y, this._mirrored);
        return groundOf([d[0], -d[1], d[2]], out);
    }

    /** A prominence slot: a free one, else the one that has stood longest (an erupting one last). */
    takeSlot() {
        let best = null;
        for (let i = 0; i < this.prominences.length; i += 1) {
            const p = this.prominences[i];
            if (!p.on) return p;
            const busy = p.erupts < 1e5 ? 1e6 : 0;
            if (!best || p.serial + busy < best.serial + (best.erupts < 1e5 ? 1e6 : 0)) best = p;
        }
        return best;
    }

    raise(slot, {
        angle, kind, halfWidth, height, rgb, power, born, seed,
    }) {
        this.serial += 1;
        Object.assign(slot, {
            on: true,
            born,
            erupts: 1e6,
            fades: born + PROMINENCE_LIFE,
            kind,
            angle,
            halfWidth,
            height,
            seed,
            power,
            serial: this.serial,
        });
        slot.rgb[0] = rgb[0];
        slot.rgb[1] = rgb[1];
        slot.rgb[2] = rgb[2];
    }

    onLock(c = {}) {
        const layout = this.layoutNow();
        const board = boardFor(layout, c.player) || layout.cards[0];
        const card = cardUnion(layout) || board;
        const rows = c.rows?.length ? c.rows : [19];
        let row = 0;
        for (let i = 0; i < rows.length; i += 1) row += rows[i];
        const at = boardPoint(board, c.u ?? 0.5, row / rows.length);
        const rgb = this.colourOf(c.color).slice();
        const hard = c.hardDrop === true;
        const angle = limbAngleFor(c.screen ? c.screen.x : c.u) + (this.rand() - 0.5) * 0.14;
        const flight = hard ? MOTE_FLIGHT_HARD : MOTE_FLIGHT;
        const to = this.sunPoint(Math.cos(angle) * 1.03, Math.sin(angle) * 1.03, [0, 0, 0]);

        // The mote leaves the card's edge on the sun's side, at the piece's own height (from the
        // card's top when the sun stands over the card).
        const where = this.screenOf(to);
        let sx = where.x < (card.x0 + card.x1) * 0.5 ? card.x0 : card.x1;
        let sy = at.y;
        if (where.front && where.x > card.x0 && where.x < card.x1) {
            sx = at.x;
            sy = card.y0;
        }
        if (c.screen) {
            sx = c.screen.x;
            sy = c.screen.y;
        }
        const ray = this.screenRay(sx, sy, this._ray);
        const from = [ray.x, ray.y, ray.z];
        this.streak(from, to, {
            duration: flight,
            rgb,
            power: hard ? 1.5 : 1.1,
            tail: 0.28,
            width: hard ? 5.0 : 3.8,
            bow: (sy > where.y ? -1 : 1) * 0.04,
        });

        // The hotter play runs, the taller and brighter the flux ropes the board raises.
        const { level } = this.heat;
        const shape = prominenceShape(this.rand(), hard);
        this.raise(this.takeSlot(), {
            angle,
            kind: shape.kind,
            halfWidth: shape.halfWidth,
            height: shape.height * (1 + 0.3 * level),
            rgb,
            power: (hard ? 1.35 : 1) * (1 + 0.2 * level),
            born: this.time + flight * 0.92,
            seed: this.rand(),
        });
        // The corona swells as the mote lands: rapid locks ride it up, never restart it.
        this.corona.hit(hard ? 0.12 : 0.06, this.time + flight);
        if (hard) {
            this.shake.hit(0.0013, this.time);
            this.kick.hit(0.32, this.time);
        }
        this.surge.lock(c, this.time);
    }

    onClear(c = {}) {
        if (c.crown === true) {
            this.crown();
            return;
        }
        const lines = clamp(Math.round(c.lines || 1), 1, 4);
        const big = lines >= 4 || c.perfect === true;
        // Waves past the first of a cascade: each builds on the last.
        const wave = clamp(Math.round(c.cascade || 1), 1, 12) - 1;
        const { time } = this;
        const aim = this.sunBeside ? BESIDE : ABOVE;

        // Beads round the black sun, one per line, ADDED to the necklace still turning: a cascade's
        // deeper waves add more and burn brighter, until the necklace closes into a ring.
        // The necklace closes into a full ring only in a fever or a deep cascade (a quad brings it
        // whole).
        const most = big ? BEADS_MAX : Math.min(BEADS_MAX, 6 + Math.round(6 * this.heat.fever) + wave);
        const pearls = big ? 6 : lines + Math.min(2, wave);
        this.addBeads(pearls, (big ? 1.3 : 1) + Math.min(0.6, wave * 0.15), time + 0.04, most);
        this.flashes.hit((0.45 + lines * 0.12) * (1 + 0.15 * Math.min(wave, 4)), time);
        this.corona.hit(0.14 * lines + 0.06 * Math.min(wave, 6), time);

        // The oldest prominences erupt: two per line, every one on a great clear. The hotter play
        // runs, the more of the newest stand: a crown of coloured flux ropes that thickens through
        // a long chain instead of being spent clear by clear (a quad still erupts it whole).
        const held = this.prominences
            .filter((p) => p.on && p.erupts > 1e5 && p.born <= time && p.kind !== KIND.jet)
            .sort((a, b) => a.serial - b.serial);
        const keep = big ? 0 : Math.floor(this.heat.level * 6 + this.heat.fever * 2);
        const wanted = big ? held.length : Math.min(Math.max(0, held.length - keep), lines * 2);
        for (let i = 0; i < wanted; i += 1) {
            held[i].erupts = time + 0.12 + i * 0.11;
            held[i].fades = Math.min(held[i].fades, held[i].erupts + ERUPTION_SECONDS + 0.5);
        }
        // With too few held, white jets run out from the limb instead (never in place of the crown
        // the heat keeps standing).
        for (let i = held.length; i < lines; i += 1) {
            const angle = limbAngleFor(this.rand()) + (this.rand() - 0.5) * 0.3;
            const born = time + 0.08 + i * 0.12;
            const slot = this.takeSlot();
            this.raise(slot, {
                angle,
                kind: KIND.jet,
                halfWidth: 0.05,
                height: 1,
                rgb: [1.0, 0.92, 0.8],
                power: 1.1,
                born,
                seed: this.rand(),
            });
            slot.erupts = born;
            slot.fades = born + ERUPTION_SECONDS;
        }

        // A ring dropped into the sun's own reflection: a deeper wave drops a stronger one.
        const echo = this.reflectionPoint(0, 0);
        if (echo) {
            const [ex, ez] = echo;
            const deeper = 1 + 0.3 * Math.min(wave, 5);
            this.ripple(ex, ez, { strength: (big ? RING.great : RING.clear + RING.line * (lines - 1)) * deeper });
            if (big) this.ripple(ex, ez, { strength: RING.great * 0.7, start: time + 0.55 });
            if (c.tspin) {
                this.ripple(ex, ez, {
                    strength: RING.whirl, kind: 1, turn: this.reduced ? 1.2 : 2.6, start: time + 0.05,
                });
            }
        }

        if (big) {
            // A back-to-back's diamond burns brighter than the first.
            const power = (c.perfect ? 1.3 : 1) * (c.b2b ? 1.15 : 1);
            this.schedule(time + 0.14, () => this.diamondRing(aim.diamond + (this.rand() - 0.5) * 0.5, power));
            this.schedule(time + 0.5, () => this.ejection(aim.cme + (this.rand() - 0.5) * 0.5, power));
            this.corona.hit(0.7, time);
            this.shake.hit(0.0022, time);
            if (c.perfect) {
                this.flashes.hit(0.9, time);
                this.schedule(time + 1.1, () => this.addBeads(6, 1.4, this.time));
            }
        } else if (wave >= 2 && wave % 3 === 2) {
            // The third wave of a cascade (and every third after it) throws off mass.
            const power = 0.7 + 0.08 * wave;
            this.schedule(time + 0.3, () => this.ejection(aim.cme + (this.rand() - 0.5) * 0.9, power));
        }
        if (c.b2b) {
            // Back-to-back: twin ejections, either side of the crown, and the corona flares.
            const twin = Math.PI - aim.cme;
            this.schedule(time + 0.62, () => this.ejection(twin + (this.rand() - 0.5) * 0.3, 1.1));
            if (!big) this.schedule(time + 0.5, () => this.ejection(aim.cme + (this.rand() - 0.5) * 0.3, 1.1));
            this.flashes.hit(0.35, time);
            this.corona.hit(0.35, time);
        }
        if (c.tspin) this.twist.hit(1, time);
        this.kick.hit(0.15 + lines * 0.1 + 0.05 * Math.min(wave, 4), time);
        this.surge.clear(c, time);
    }

    /**
     * A perfect clear settled after its clear's last wave: the CROWN on the clear still playing,
     * never a second one. The diamond burns on (held and re-flared; it breaks through now if the
     * clear brought none), the necklace closes into a full ring of pearls, the chromosphere and
     * the corona flare, and the mirror takes one great ring.
     */
    crown() {
        const { time } = this;
        const aim = this.sunBeside ? BESIDE : ABOVE;
        this.schedule(time + 0.05, () => this.diamondRing(aim.diamond + (this.rand() - 0.5) * 0.5, 1.3));
        this.schedule(time + 0.35, () => this.addBeads(BEADS_MAX, 1.4, this.time));
        this.flashes.hit(0.8, time);
        this.corona.hit(0.5, time);
        this.kick.hit(0.25, time);
        const echo = this.reflectionPoint(0, 0);
        if (echo) this.ripple(echo[0], echo[1], { strength: RING.great * 0.8, start: time + 0.1 });
        this.surge.crown(time);
    }

    /** A T-spin that cleared nothing: a smaller twist of the corona and a whirl in the mirror. */
    onSpin() {
        const { time } = this;
        this.twist.hit(0.5, time);
        const echo = this.reflectionPoint(0, 0);
        if (echo) {
            this.ripple(echo[0], echo[1], {
                strength: RING.whirl * 0.6, kind: 1, turn: this.reduced ? 1.2 : 2.6, start: time + 0.05,
            });
        }
        this.kick.hit(0.12, time);
        this.surge.spin(time);
    }

    /**
     * Pearls added to the necklace: to the one still turning, at its own angle (a bead splits off
     * the first and slides into place), or a new necklace at a new angle once the last has gone out.
     */
    addBeads(count, power, at, most = BEADS_MAX) {
        const k = this.necklace;
        const room = Math.min(BEADS_MAX, most);
        // Read where the new pearls join it, so a clear a frame after another finds its beads.
        if (this.beadLight.valueAt(Math.max(this.time, at)) * BEAD_GAIN < BEADS_LIVE) {
            k.angle = limbAngleFor(0.5) + this.rand() * TAU;
            k.at = at;
            k.count = Math.min(room, count);
            k.shown = k.count;
        } else {
            k.count = Math.max(k.count, Math.min(room, k.count + count));
        }
        this.beadLight.hit(power, at);
    }

    /**
     * The diamond ring at `angle`. While one still burns it is FED, never restarted: the moon stays
     * slid off the limb it left (or slides back off from where it stands as it closes), the glare
     * flares again and the hold lasts on; the power can only rise.
     */
    diamondRing(angle, power = 1) {
        const { time } = this;
        const ring = this.diamond;
        if (ring && time < ring.closeAt + DIAMOND_CLOSE) {
            if (time > ring.closeAt) {
                // Closing: reopen from where the moon stands now.
                ring.openAt = time - DIAMOND_OPEN * unsmooth01(diamondSwing(ring, time));
            }
            ring.closeAt = Math.max(ring.closeAt, Math.max(ring.openAt + DIAMOND_OPEN, time) + DIAMOND_HOLD);
            ring.power = Math.max(ring.power, power);
        } else {
            this.diamond = {
                bornAt: time,
                openAt: time,
                closeAt: time + DIAMOND_OPEN + DIAMOND_HOLD,
                angle,
                power,
                shown: power,
                spin: 0.35 + this.rand() * 0.5,
            };
        }
        this.burst.hit(power, time + DIAMOND_OPEN * 0.55);
        this.shake.hit(0.0014, time);
    }

    /**
     * A coronal mass ejection: two may be in the air at once, so a new one takes a free slot or
     * the one that has faded most, never cutting one still leaving the limb.
     */
    ejection(angle, power = 1) {
        const { time, u } = this;
        let pick = u.cme.value;
        let least = Infinity;
        const slots = [u.cme.value, u.cme2.value];
        for (let i = 0; i < slots.length; i += 1) {
            const s = slots[i];
            const age = time - s.y;
            const left = s.z > 0.001 && age >= 0 && age < 8 ? s.z * Math.exp(-age / 2.8) : 0;
            if (left < least) {
                least = left;
                pick = s;
            }
        }
        pick.set(angle, time, power, 0.62 + power * 0.18);
    }

    /** The true combo (0 = the chain broke). */
    onCombo(combo) {
        this.combo = Math.max(0, Math.round(combo || 0));
        this.exposureTarget = exposureFor(this.combo);
    }

    levelUp(level, { silent = false } = {}) {
        const next = Math.max(1, Math.round(level || 1));
        if (silent) {
            this.level = next;
            this.hourShift = next - 1;
            this.applyPalette();
            return;
        }
        this.level = next;
        this.flashes.hit(1, this.time);
        this.corona.hit(0.5, this.time);
        this.addBeads(2, 1.1, this.time + 0.05);
        const echo = this.reflectionPoint(0, 0);
        if (echo) this.ripple(echo[0], echo[1], { strength: RING.level });
        this.surge.levelUp(this.time);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    wheel() {
        return this.time / HOUR_SECONDS + this.hourShift;
    }

    applyPalette() {
        const p = paletteAt(this.wheel(), this._palette);
        const { u } = this;
        for (let i = 0; i < PALETTE_KEYS.length; i += 1) {
            const key = PALETTE_KEYS[i];
            u[key].value.set(p[key][0], p[key][1], p[key][2]);
        }
        u.glowHeight.value = p.glowHeight;
        u.starPower.value = p.starPower;
        u.alpenPower.value = p.alpenPower;
        u.cycle.value = p.cycle;
        return p;
    }

    /** The prominence and streamer tables, as they stand at this.time. */
    writeTables() {
        const { time, u } = this;
        const { prominences } = u.tables;
        for (let i = 0; i < PROMINENCES; i += 1) {
            const p = this.prominences[i];
            if (p.on && time > p.fades) p.on = false;
            const a = prominences[i * 3];
            const b = prominences[i * 3 + 1];
            const c = prominences[i * 3 + 2];
            if (!p.on) {
                c.set(0, 0, 0, 0);
                continue;
            }
            a.set(p.angle, p.halfWidth, p.height, p.seed);
            b.set(p.born, p.erupts, p.fades, p.kind);
            c.set(p.rgb[0], p.rgb[1], p.rgb[2], p.power);
        }
        const strength = streamersAt(u.cycle.value, this._streamers);
        for (let i = 0; i < STREAMERS; i += 1) {
            const s = STREAMER_SET[i];
            const sway = Math.sin(time / 47 + i * 1.7) * 0.05;
            u.tables.streamers[i].set(wrapAngle(s.angle + sway), s.width, strength[i], i);
        }
    }

    update(sim, camera = this._camera) {
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const { u } = this;
        const { time } = this;

        // Staged events whose moment has come, earliest first (nothing allocated a frame).
        for (;;) {
            const list = this.scheduled;
            let first = -1;
            for (let i = 0; i < list.length; i += 1) {
                if (list[i].time <= time && (first < 0 || list[i].time < list[first].time)) first = i;
            }
            if (first < 0) break;
            const due = list[first];
            list[first] = list[list.length - 1];
            list.pop();
            due.run();
        }

        // How hot play runs: totality deepens with it.
        const sample = this.surge.sample(time);
        const { heat } = this;
        heat.punch = sample.punch;
        heat.level = sample.level;
        heat.fever = sample.fever;
        heat.stage = sample.stage;
        const { level, fever } = heat;
        const fs = flashScale();

        // The chain opens the exposure quickly and lets it close slowly.
        const opening = this.exposureTarget > this.exposure;
        this.exposure += (this.exposureTarget - this.exposure) * approach(opening ? 1.3 : 0.4, dt);
        this.hourShift += ((this.level - 1) - this.hourShift) * approach(0.35, dt);

        // The sun eases to where the composition wants it.
        const k = this.capture ? 1 : approach(1.2, dt);
        this.sunAz += (this.sunAzTarget - this.sunAz) * k;
        this.sunAlt += (this.sunAltTarget - this.sunAlt) * k;
        this.writeSun();

        // The moon: its slow wander, and the slide off one limb for the diamond.
        const moon = moonWander(time, this._moon);
        let swing = 0;
        let glare = 0;
        let power = 1;
        if (this.diamond && time > this.diamond.closeAt + DIAMOND_CLOSE) this.diamond = null;
        const ring = this.diamond;
        if (ring) {
            // A diamond fed while it burns brightens over a moment, never in one frame.
            ring.shown += (ring.power - ring.shown) * approach(5, dt);
            power = ring.shown;
            swing = diamondSwing(ring, time);
            glare = swing ** 1.5 * power + this.burst.valueAt(time) * 0.6;
            const ax = Math.cos(ring.angle);
            const ay = Math.sin(ring.angle);
            // Away from the bead, so the limb opens there.
            moon[0] = moon[0] * (1 - swing) - ax * MOON.diamond * swing;
            moon[1] = moon[1] * (1 - swing) - ay * MOON.diamond * swing;
            u.diamond.value.set(ax * 0.995, ay * 0.995, glare, ring.spin);
            const bead = this.sunPoint(ax * 0.995, ay * 0.995);
            u.glint.value.set(bead[0], bead[1], bead[2], glare * GLINT_POWER);
            // Shadow bands race over the salt as the light breaks through and as it goes.
            u.bands.value = this.reduced ? 0 : clamp01(swing * 1.6) * (1 - 0.5 * clamp01(swing ** 4));
            const at = this.screenOf(this.sunPoint(ax, ay));
            const post = this._post;
            post.ripple.x = at.x;
            post.ripple.y = at.y;
            // From the first break-through: a re-flare never pulls the ripple back in.
            post.ripple.radius = Math.max(0, time - ring.bornAt - DIAMOND_OPEN * 0.8) * 0.55;
            post.ripple.strength = this.reduced ? 0 : swing * power;
        } else {
            u.diamond.value.z = 0;
            u.glint.value.w = 0;
            u.bands.value = 0;
            this._post.ripple.strength = 0;
        }
        // Daylight floods the whole sky for the diamond's breath: a frame-wide flash (ADR-0021).
        u.daylight.value = clamp01(swing * 0.75 * power) * fs;

        // The heat opens the exposure a little by itself (a quick hand with no chain still brings
        // the outer corona and the first stars out); the chain opens it all the way.
        const open = 0.22 * level + 0.3 * fever;
        const exposure = 1 - (1 - this.exposure) * (1 - open);
        u.moon.value.set(moon[0], moon[1], MOON.ratio, exposure);

        // A T-spin's twist rings down; another winds it further instead of starting again.
        const twist = this.twist.valueAt(time) * TWIST;
        u.twist.value = twist > TWIST_REST ? twist * (this.reduced ? 0.4 : 1) : 0;

        // The necklace turns (faster the hotter play runs) and a new bead slides into its place.
        const { necklace } = this;
        const beads = this.beadLight.valueAt(time) * BEAD_GAIN;
        if (beads < BEADS_OUT) {
            u.beads.value.w = 0;
        } else {
            const split = (necklace.count - necklace.shown) * approach(BEAD_SPLIT, dt);
            necklace.shown = Math.min(necklace.count, necklace.shown + split);
            // It turns faster the hotter play runs (not under reduced motion: its own pace, as ever).
            const quick = this.reduced ? 0 : 0.5 * level + 0.5 * fever;
            necklace.angle = wrapAngle(necklace.angle + dt * BEAD_SPIN * (1 + quick));
            // Many pearls are finer ones: the ring they close into glows, never glares.
            const fine = 1 + 0.07 * Math.max(0, necklace.shown - 6);
            u.beads.value.set(necklace.angle, necklace.at, necklace.shown, beads / fine);
        }

        u.time.value = time;
        u.axis.value = axisAt(time);
        u.umbraAz.value = umbraAzAt(time);
        u.exposure.value = exposure;
        // A chain stills the water to glass (a fever all the way).
        u.glass.value = clamp01(this.exposure * 1.2 + 0.3 * fever);
        // The corona's swell: every lock's landing and every clear add to it; the heat holds it up.
        const corona = this.corona.valueAt(time);
        const swollen = corona + 0.06 * level + 0.08 * fever;
        u.surge.value = swollen;
        // The chromosphere's pink rim: each flash adds to what still burns (scaled under Reduce
        // flashing); the heat lifts it slowly by itself, a glow rather than a flash.
        this.flash = this.flashes.valueAt(time);
        u.flash.value = this.flash * flashScale() + 0.12 * level + 0.2 * fever;

        const p = this.applyPalette();
        // Totality deepens with the heat: the sun wakes (new streamers sprout round its crown), the
        // sunset all round the horizon and the alpenglow on the far shore burn, the stars come
        // out, and in a fever the sky darkens overhead.
        u.cycle.value = Math.min(1, p.cycle + 0.18 * level + 0.25 * fever);
        u.glow.value.multiplyScalar(1 + 0.3 * level + 0.4 * fever);
        u.alpenPower.value = p.alpenPower * (1 + 0.6 * level + 0.8 * fever);
        u.starPower.value = p.starPower * (1 + 0.8 * fever);
        u.zenith.value.multiplyScalar(1 - 0.4 * fever);
        u.mid.value.multiplyScalar(1 - 0.25 * fever);
        this.writeTables();
        if (camera) this.sky?.update(camera);

        const post = this._post;
        post.flash = clamp01(glare * 0.5);
        post.kick = this.kick.valueAt(time) + heat.punch * 0.15;
        post.bloomBoost = corona * 0.3 + exposure * 0.2 + Math.min(1, glare) * 0.4 * fs
            + 0.04 * level + 0.08 * fever;
        // The iris closes on the glare, and a little as the heat adds light, so colours stay deep.
        post.exposure = 1 - 0.3 * clamp01(glare) - 0.06 * level - 0.1 * fever;
        const centre = this.sunPoint(moon[0], moon[1]);
        const disc = this.screenOf(centre);
        const radius = MOON.ratio / Math.max(1e-6, u.pxR.value);
        post.moon.x = disc.x;
        post.moon.y = disc.y;
        post.moon.radius = disc.front ? radius : 0;
        post.moon.matte = 0.97 * (1 - 0.65 * clamp01(glare));
        // Its reflection in the mirror, held off the bloom a little less (the water stirs it).
        const mirrored = this._mirrored;
        mirrored[0] = centre[0];
        mirrored[1] = -centre[1];
        mirrored[2] = centre[2];
        const echo = this.screenOf(mirrored, this._echoScreen);
        post.echo.x = echo.x;
        post.echo.y = echo.y;
        post.echo.radius = echo.front && centre[1] > 0 ? radius : 0;
        post.echo.matte = 0.9 * (1 - 0.65 * clamp01(glare)) * (1 - 0.4 * clamp01(swollen));
        // The horizon straight ahead, where the water begins; a chain stills it to glass.
        const ahead = this._level;
        const lf = Math.hypot(this._fwd.x, this._fwd.z) || 1;
        ahead[0] = this._fwd.x / lf;
        ahead[1] = 0;
        ahead[2] = this._fwd.z / lf;
        post.water.horizon = this.screenOf(ahead, this._echoScreen).y;
        post.water.stir = 1 - 0.75 * u.glass.value;
    }

    getPostState() {
        return this._post;
    }

    getState() {
        const palette = PALETTES[this._palette.index ?? 0]?.name ?? null;
        let held = 0;
        let erupting = 0;
        for (let i = 0; i < this.prominences.length; i += 1) {
            const p = this.prominences[i];
            if (!p.on) continue;
            if (p.erupts <= this.time) erupting += 1;
            else held += 1;
        }
        let motes = 0;
        for (let i = 0; i < STREAKS; i += 1) {
            if (this.streakEnds[i] > this.time) motes += 1;
        }
        let ripples = 0;
        for (let i = 0; i < MIRROR.ripples; i += 1) {
            const age = this.time - this.rippleAt[i];
            if (age >= 0 && age < MIRROR.rippleLife * 1.6) ripples += 1;
        }
        return {
            time: this.time,
            quality: this.quality,
            combo: this.combo,
            exposure: this.exposure,
            level: this.level,
            palette,
            paletteTurn: this._palette.turn ?? 0,
            cycle: this.u.cycle.value,
            prominences: held,
            erupting,
            motes,
            ripples,
            glass: this.u.glass.value,
            diamond: this.diamond ? Math.round(this.u.diamond.value.z * 100) / 100 : 0,
            beads: Math.round(this.necklace.shown * 100) / 100,
            heat: Math.round(this.heat.level * 100) / 100,
            fever: Math.round(this.heat.fever * 100) / 100,
            stage: this.heat.stage,
            sunScreenX: this.sunScreenX,
            sunScreenY: this.sunScreenY,
            sunBeside: this.sunBeside,
            sunRadiusDeg: this.sunRadius() / DEG,
        };
    }

    dispose() {
        this.scene?.remove(this.root);
        this.sky?.dispose();
        this.fx?.dispose();
        this.noise?.dispose();
        this.rangeTexture?.dispose();
        this.root.clear();
        this.parts.clear();
        this.sky = null;
        this.fx = null;
        this.noise = null;
        this.rangeTexture = null;
        this.ranges = null;
    }
}

export { PARTS as SOLAR_ECLIPSE_PARTS, PROMINENCE_RISE };
