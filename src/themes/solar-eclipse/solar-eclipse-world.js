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
        };
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
        this.surge = 0;
        this.flash = 0;
        this.shake = 0;
        this.kick = 0;
        this.diamond = null;
        this.tspinAt = -1000;
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
            if (this.shake > 1e-4) {
                yaw += this.shake * Math.sin(t * 57.3) * Math.cos(t * 21.1);
                pitch += this.shake * Math.sin(t * 43.9 + 1.0);
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

    /** A mote from one world direction to another (unit, three numbers each). */
    streak(from, to, {
        start = this.time, duration = 0.8, rgb = DEFAULT_SPARK, power = 1, tail = 0.3, width = 3.6, bow = 0,
    } = {}) {
        const slots = this.fx?.count ?? STREAKS;
        let index = this.cursor.streak % slots;
        for (let i = 0; i < slots; i += 1) {
            const candidate = (this.cursor.streak + i) % slots;
            if (this.streakEnds[candidate] <= this.time) {
                index = candidate;
                break;
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

        const shape = prominenceShape(this.rand(), hard);
        this.raise(this.takeSlot(), {
            angle,
            kind: shape.kind,
            halfWidth: shape.halfWidth,
            height: shape.height,
            rgb,
            power: hard ? 1.35 : 1,
            born: this.time + flight * 0.92,
            seed: this.rand(),
        });
        this.schedule(this.time + flight, () => {
            this.surge = Math.max(this.surge, hard ? 0.22 : 0.1);
        });
        if (hard) {
            this.shake = Math.max(this.shake, 0.0016);
            this.kick = Math.max(this.kick, 0.45);
        }
    }

    onClear(c = {}) {
        const lines = clamp(Math.round(c.lines || 1), 1, 4);
        const big = lines >= 4 || c.perfect === true;
        const { time } = this;

        // A necklace of beads round the black sun, one bead per line.
        this.u.beads.value.set(limbAngleFor(0.5) + this.rand() * TAU, time + 0.04, big ? 6 : lines, big ? 1.3 : 1);
        this.flash = Math.max(this.flash, 0.45 + lines * 0.12);
        this.surge = Math.max(this.surge, 0.18 * lines);

        // The oldest prominences erupt: two per line, every one on a great clear.
        const held = this.prominences
            .filter((p) => p.on && p.erupts > 1e5 && p.born <= time && p.kind !== KIND.jet)
            .sort((a, b) => a.serial - b.serial);
        const wanted = big ? held.length : Math.min(held.length, lines * 2);
        for (let i = 0; i < wanted; i += 1) {
            held[i].erupts = time + 0.12 + i * 0.11;
            held[i].fades = Math.min(held[i].fades, held[i].erupts + ERUPTION_SECONDS + 0.5);
        }
        // With too few held, white jets run out from the limb instead.
        for (let i = wanted; i < lines; i += 1) {
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

        // A ring dropped into the sun's own reflection.
        const echo = this.reflectionPoint(0, 0);
        if (echo) {
            const [ex, ez] = echo;
            this.ripple(ex, ez, { strength: big ? RING.great : RING.clear + RING.line * (lines - 1) });
            if (big) this.ripple(ex, ez, { strength: RING.great * 0.7, start: time + 0.55 });
            if (c.tspin) {
                this.ripple(ex, ez, {
                    strength: RING.whirl, kind: 1, turn: this.reduced ? 1.2 : 2.6, start: time + 0.05,
                });
            }
        }

        if (big) {
            const power = c.perfect ? 1.3 : 1;
            const aim = this.sunBeside ? BESIDE : ABOVE;
            this.schedule(time + 0.14, () => this.diamondRing(aim.diamond + (this.rand() - 0.5) * 0.5, power));
            this.schedule(time + 0.5, () => this.ejection(aim.cme + (this.rand() - 0.5) * 0.5, power));
            this.surge = 1;
            this.shake = Math.max(this.shake, 0.0026);
            if (c.perfect) {
                this.flash = 1.4;
                this.schedule(time + 1.1, () => {
                    this.u.beads.value.set(this.rand() * TAU, this.time, 6, 1.4);
                });
            }
        }
        if (c.tspin) this.tspinAt = time;
        this.kick = Math.max(this.kick, 0.2 + lines * 0.12);
    }

    diamondRing(angle, power = 1) {
        this.diamond = {
            t0: this.time, angle, power, spin: 0.35 + this.rand() * 0.5,
        };
        this.shake = Math.max(this.shake, 0.0022);
    }

    ejection(angle, power = 1) {
        this.u.cme.value.set(angle, this.time, power, 0.62 + power * 0.18);
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
        this.flash = Math.max(this.flash, 1);
        this.surge = Math.max(this.surge, 0.5);
        this.u.beads.value.set(this.rand() * TAU, this.time + 0.05, 2, 1.1);
        const echo = this.reflectionPoint(0, 0);
        if (echo) this.ripple(echo[0], echo[1], { strength: RING.level });
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

        // Staged events whose moment has come.
        if (this.scheduled.length) {
            const due = this.scheduled.filter((s) => s.time <= time);
            if (due.length) {
                this.scheduled = this.scheduled.filter((s) => s.time > time);
                due.sort((a, b) => a.time - b.time).forEach((s) => s.run());
            }
        }

        // The chain opens the exposure quickly and lets it close slowly.
        const opening = this.exposureTarget > this.exposure;
        this.exposure += (this.exposureTarget - this.exposure) * approach(opening ? 1.3 : 0.4, dt);
        this.hourShift += ((this.level - 1) - this.hourShift) * approach(0.35, dt);
        this.surge *= Math.exp(-dt / 1.6);
        this.flash *= Math.exp(-dt / 0.9);
        this.shake *= Math.exp(-dt / 0.35);
        this.kick *= Math.exp(-dt / 0.3);

        // The sun eases to where the composition wants it.
        const k = this.capture ? 1 : approach(1.2, dt);
        this.sunAz += (this.sunAzTarget - this.sunAz) * k;
        this.sunAlt += (this.sunAltTarget - this.sunAlt) * k;
        this.writeSun();

        // The moon: its slow wander, and the slide off one limb for the diamond.
        const moon = moonWander(time, this._moon);
        let swing = 0;
        let glare = 0;
        const ring = this.diamond;
        if (ring) {
            const age = time - ring.t0;
            if (age > DIAMOND_OPEN + DIAMOND_HOLD + DIAMOND_CLOSE) {
                this.diamond = null;
            } else {
                const open = smooth01(age / DIAMOND_OPEN);
                const close = 1 - smooth01((age - DIAMOND_OPEN - DIAMOND_HOLD) / DIAMOND_CLOSE);
                swing = Math.min(open, close);
                const burst = Math.exp(-(((age - DIAMOND_OPEN * 0.9) / 0.22) ** 2)) * 0.6;
                glare = (swing ** 1.5 + burst) * ring.power;
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
                post.ripple.radius = Math.max(0, age - DIAMOND_OPEN * 0.8) * 0.55;
                post.ripple.strength = this.reduced ? 0 : swing * ring.power;
            }
        }
        if (!this.diamond) {
            u.diamond.value.z = 0;
            u.glint.value.w = 0;
            u.bands.value = 0;
            this._post.ripple.strength = 0;
        }
        u.moon.value.set(moon[0], moon[1], MOON.ratio, this.exposure);
        u.daylight.value = clamp01(swing * 0.75 * (ring?.power ?? 1));

        // A T-spin's twist rings down.
        const tAge = time - this.tspinAt;
        u.twist.value = tAge >= 0 && tAge < 6
            ? TWIST * Math.sin(Math.min(1, tAge / 0.35) * Math.PI * 0.5)
                * Math.exp(-Math.max(0, tAge - 0.35) / TWIST_DECAY)
                * (this.reduced ? 0.4 : 1)
            : 0;

        u.time.value = time;
        u.axis.value = axisAt(time);
        u.exposure.value = this.exposure;
        // A chain stills the water to glass.
        u.glass.value = clamp01(this.exposure * 1.2);
        u.surge.value = this.surge;
        u.flash.value = this.flash * flashScale();

        this.applyPalette();
        this.writeTables();
        if (camera) this.sky?.update(camera);

        const post = this._post;
        post.flash = clamp01(glare * 0.5);
        post.kick = this.kick;
        post.bloomBoost = this.surge * 0.45 + this.exposure * 0.2 + Math.min(1, glare) * 0.4;
        post.exposure = 1 - 0.3 * clamp01(glare);
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
        post.echo.matte = 0.9 * (1 - 0.65 * clamp01(glare)) * (1 - 0.4 * clamp01(this.surge));
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
