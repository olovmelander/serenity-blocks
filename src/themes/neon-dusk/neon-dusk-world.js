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
 * Draws at High: sky, mountains, floor, dust, burst pixels, tiles — six, plus the floor's
 * reflector pass (sky + mountains again, at 0.4 resolution on High; the fx stay out of it).
 *
 * Gameplay builds instead of popping (src/themes/shared/gameplay-surge.js). Every event layer
 * ADDS to what is still lit: the sun's glow is a Swell, the light waves, halos, scan sweeps,
 * lock ripples and shooting stars are slot pools that join a wave launched the same moment
 * and otherwise take a free or the weakest slot, never one in full flight. The surge's level
 * and fever drive the dusk itself, in four acts:
 *   calm   — the dusk as it always was;
 *   warm   — the sun stokes up, the ridges' scan lines brighten, the grid quickens;
 *   hot    — the glass rushes toward the lens, bands of light run in along the grid on a beat,
 *            the holograms stand taller, the palette swings from magenta toward cyan;
 *   fever  — the sun burns gold and its slits race, it beats out halos in time with the
 *            grid's bands, a meteor shower falls away from it, the dust streams up.
 * A perfect clear crowns it: the slits close and the whole disc burns gold, every range lights
 * up and the glass breathes the light back out to the horizon. The end of a chain exhales too.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    GRID_SPACING,
    RIG,
    SCROLL_SPEED,
    SCROLL_WRAP,
    SUN,
} from './neon-dusk-tsl.js';
import { SLITS, createSky } from './neon-dusk-sky.js';
import { createMountains } from './neon-dusk-mountains.js';
import { AMBIENT_PULSE, createFloor } from './neon-dusk-floor.js';
import { DIRECT_ONLY_LAYER, NeonDuskFx, pieceOutlineBits } from './neon-dusk-fx.js';
import { applyCameraBreath, easedMotion } from '../shared/camera-breath.js';
import {
    GameplaySurge, SURGE_WEIGHTS, Swell, softCeiling,
} from '../shared/gameplay-surge.js';
import { ComboTracker } from '../../core/combo-tracker.js';

/**
 * Per-tier content. Every tier keeps the composition; tiers trade detail, not layout.
 * `reflection` = the floor reflector's resolution scale (0 = analytic sky mirror, no 2nd render);
 * `reflectionBlur` = the mip level the mirror is read at (0 = no mip chain).
 */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        detail: 0.5,
        contours: true,
        dust: 0,
        burst: 120,
        tiles: 32,
        clouds: false,
        stars: 0.6,
        reflection: 0,
        reflectionBlur: 0,
    },
    Low: {
        detail: 0.7,
        contours: true,
        dust: 60,
        burst: 200,
        tiles: 48,
        clouds: true,
        stars: 1,
        reflection: 0,
        reflectionBlur: 0,
    },
    Medium: {
        detail: 0.85,
        contours: true,
        dust: 120,
        burst: 300,
        tiles: 64,
        clouds: true,
        stars: 1,
        reflection: 0.3,
        reflectionBlur: 0,
    },
    High: {
        detail: 1,
        contours: true,
        dust: 180,
        burst: 450,
        tiles: 64,
        clouds: true,
        stars: 1,
        reflection: 0.4,
        reflectionBlur: 1.6,
    },
    Ultra: {
        detail: 1.15,
        contours: true,
        dust: 240,
        burst: 600,
        tiles: 96,
        clouds: true,
        stars: 1,
        reflection: 0.5,
        reflectionBlur: 1.9,
    },
    Extreme: {
        detail: 1.3,
        contours: true,
        dust: 300,
        burst: 800,
        tiles: 128,
        clouds: true,
        stars: 1,
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

/** Event-layer slots: floor light waves, halos, shooting stars, lock ripples, scan sweeps. */
export const SLOTS = Object.freeze({
    rings: 3, holos: 3, shoots: 3, ripples: 4, contours: 4,
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

export function createWorldUniforms() {
    return {
        time: uniform(0),
        scroll: uniform(0),
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
        /** Hologram rings out of the sun: (radius in sun radii, 1/width, energy, dash turn). */
        holo0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        holo1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        holo2: uniform(new THREE.Vector4(0, 1, 0, 0)),
        /** Shooting stars: (azimuth, elevation, heading, normalised age; ≥ 1 = dead). */
        shoot0: uniform(new THREE.Vector4(0, 0, 0, 2)),
        shoot1: uniform(new THREE.Vector4(0, 0, 0, 2)),
        shoot2: uniform(new THREE.Vector4(0, 0, 0, 2)),
        /** Waves of light rolling through the ranges toward the camera: (distance, energy) × 4. */
        contourA: uniform(new THREE.Vector4(0, 0, 0, 0)),
        contourB: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The ridges' scan lines' own light: 0.8 at rest, more as play heats. */
        scanGain: uniform(0.8),
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
        /** The holograms' height (1 at rest; taller as play heats). */
        tileLift: uniform(1),
        /** The floor's scroll, unwrapped (the holograms ride it). */
        scrollRun: uniform(0),
        /** The dust's clock (the world's time at rest; quicker as play heats) and its light. */
        dustRun: uniform(0),
        dustGain: uniform(1.6),
    };
}

/** At rest a shooting star crosses the sky once in each window of this many seconds. */
export const AMBIENT_SHOOT_PERIOD = 19;

/** A small deterministic generator for one ambient window (so a seek replays the same star). */
function windowRandom(k) {
    let s = (Math.imul(k | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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

        const el = SUN.elevation;
        this.sunDir = new THREE.Vector3(0, Math.sin(el), -Math.cos(el));
        this.sunUp = new THREE.Vector3(0, Math.cos(el), Math.sin(el));
        this.sunRight = new THREE.Vector3(1, 0, 0);
        this.u.sunDir.value.copy(this.sunDir);
        this.u.sunUp.value.copy(this.sunUp);
        this.u.sunRight.value.copy(this.sunRight);

        /** The sun's glow (what u.sunPulse shows): event hits add to what is still lit. */
        this.sunPulse = 0;
        this.sunSwell = new Swell({
            attack: 0.06, release: 0.9, ceiling: 1.2, knee: 0.85, headroom: 1.4,
        });
        /** A perfect clear's crown: it swells in, holds a beat and lets go over ~3 s. */
        this.crownSwell = new Swell({
            attack: 0.12, release: 1.3, ceiling: 1, knee: 0.8,
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
        this.pulsePhase = 0;
        this.slitPhase = 0;
        this.dustRun = 0;
        this.meteorDue = 0;

        const slots = (n, make) => Array.from({ length: n }, make);
        this.rings = slots(SLOTS.rings, () => ({ t0: -1e6, energy: 0, out: false }));
        this.holos = slots(SLOTS.holos, () => ({ t0: -1e6, energy: 0, spin: 0 }));
        this.shoots = slots(SLOTS.shoots, () => ({ t0: -1e6 }));
        this.ripples = slots(SLOTS.ripples, () => ({
            t0: -1e6, x: 0, z: 0, run: 0, energy: 0,
        }));
        this.contours = slots(SLOTS.contours, () => ({ t0: -1e6, energy: 0, speed: 1 }));
        const { u } = this;
        this.ringU = [u.ring0, u.ring1, u.ring2];
        this.holoU = [u.holo0, u.holo1, u.holo2];
        this.shootU = [u.shoot0, u.shoot1, u.shoot2];
        this.rippleU = [u.ripple0, u.ripple1, u.ripple2, u.ripple3];
        this.contourV = [u.contourA.value, u.contourB.value];
        this._color = new THREE.Color();

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
        this.parts.sky = createSky(u, { clouds: q.clouds, starDensity: q.stars });
        this.parts.mountains = createMountains(u, { detail: q.detail, contours: q.contours });
        const floor = createFloor(u, { reflectionScale: q.reflection, reflectionBlur: q.reflectionBlur });
        this.parts.floor = floor.mesh;
        this.reflection = floor.reflection;
        this.fx = new NeonDuskFx(u, {
            dust: q.dust, burst: q.burst, tiles: q.tiles, rand,
        });
        for (const part of Object.values(this.parts)) {
            if (part) this.root.add(part);
        }
        if (floor.reflectorTarget) this.root.add(floor.reflectorTarget);
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
        this.lens.vfov = NeonDuskWorld.verticalFov(this.lens.aspect);
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

        // The grid quickens with the heat (6 → ~16 units/s in a fever).
        this.scrollLag = (this.scrollLag ?? 0) + dt * SCROLL_SPEED * 0.7 * (1 - motion);
        this.scrollExtra += dt * SCROLL_SPEED * (0.45 * warm + 0.55 * hot + 0.65 * fever) * motion;
        this.scrollRun = t * SCROLL_SPEED - this.scrollLag + this.scrollExtra;
        u.scrollRun.value = this.scrollRun;
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

        // The palette swings from magenta toward cyan with the chain, and holds there while
        // play stays hot; when the chain breaks it eases back over a few seconds.
        this.comboTarget *= Math.exp(-0.35 * dt);
        const shiftTo = Math.max(this.comboTarget, 0.3 * hot + 0.45 * fever);
        this.comboShift += (shiftTo - this.comboShift) * approach(2.5, dt);
        u.comboShift.value = THREE.MathUtils.clamp(this.comboShift, 0, 1);

        // The ridges stay lit, the holograms stand taller, the dust streams up.
        u.scanGain.value = 0.8 + 0.3 * warm + 0.35 * hot + 0.45 * fever + crown * 1.1;
        u.tileLift.value = 1 + 0.15 * warm + 0.15 * hot + 0.2 * fever;
        this.dustRun += dt * (1 + (1.5 * hot + 2.5 * fever) * motion);
        u.dustRun.value = this.dustRun;
        u.dustGain.value = 1.6 * (1 + 0.3 * hot + 0.5 * fever);

        // The post: the iris closes a little as the dusk burns hotter (colours stay saturated),
        // and the bloom grows a touch.
        const d = this.drive;
        d.warm = warm;
        d.hot = hot;
        d.fever = fever;
        d.crown = crown;
        d.exposure = 1 - 0.04 * warm - 0.04 * hot - 0.04 * fever - 0.05 * Math.min(1, crown);
        d.bloomGain = 1 + 0.08 * hot + 0.1 * fever;

        this.updateSlots(t);
    }

    /** The event layers' uniforms from their slots (plain loops: nothing allocated a frame). */
    updateSlots(t) {
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

        // Shooting stars live 0.9 s.
        for (let i = 0; i < this.shoots.length; i += 1) {
            this.shootU[i].value.w = Math.max(0, (t - this.shoots[i].t0) / 0.9);
        }

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

        // Scan sweeps roll in from behind the far range (3000 → 350 units) in 1.5 s at their
        // own pace (a deeper cascade wave sweeps faster): (distance, energy) pairs, two a vec4.
        for (let i = 0; i < this.contours.length; i += 1) {
            const wave = this.contours[i];
            const v = this.contourV[i >> 1];
            const age = (t - wave.t0) * wave.speed;
            const live = age >= 0 && age < 1.6 && wave.energy > 0;
            const dist = live ? 3000 - age * 1770 : 0;
            const energy = live ? wave.energy * contourEnvelope(age) : 0;
            if (i & 1) {
                v.z = dist;
                v.w = energy;
            } else {
                v.x = dist;
                v.y = energy;
            }
        }
    }

    seek(time) {
        this.time = time;
        this.sunPulse = 0;
        this.sunSwell.reset();
        this.crownSwell.reset();
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
        this.rings.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.holos.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.shoots.forEach((r) => { r.t0 = -1e6; });
        this.ripples.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.contours.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.ambientShootWindow = undefined;
        this.fx?.clear();
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /** A hard drop: the lock that comes with it (the same moment) lands harder. */
    onHardDrop() {
        this.hardDropAt = this.time;
    }

    /**
     * A piece lock stands its hologram up in the glass: ONE solid piece in the piece's colour on
     * the floor beside the board (left of it for pieces that landed in the board's left half),
     * a ripple ring spreading out from it and a few pixels rising off it. A hard drop lands
     * harder: a stronger ripple, more pixels, a bigger thump.
     */
    onPieceLock(piece) {
        const r = this.rand;
        const t = this.time;
        const hard = this.hardDropAt === t;
        this.hardDropAt = -1e6;
        // The chain: a lock that clears nothing ends it (checkChain sees it next frame).
        this.combo.notePieceLocked();
        this.lastLockAt = t;
        this.lastLockCleared = false;

        const type = pieceType(piece);
        const color = pieceColor(piece, type, this._color);
        const col = Number.isFinite(piece?.x) ? THREE.MathUtils.clamp(piece.x, 0, 9) : Math.floor(r() * 10);
        let nx;
        const b = this.board;
        if (b && b.x0 > 0.16) {
            const leftHi = b.x0 * 2 - 1 - 0.08;
            const rightLo = b.x1 * 2 - 1 + 0.08;
            nx = col < 5
                ? THREE.MathUtils.lerp(-0.92, leftHi, col / 4)
                : THREE.MathUtils.lerp(rightLo, 0.92, (col - 5) / 4);
        } else {
            nx = -0.85 + (col / 9) * 1.7;
        }
        // Close to the camera, where the glass is steep enough on screen to read the shape.
        const D = 20 + r() * 20;
        const { fwd, right } = this.viewBasis();
        const tanH = Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2) * this.lens.aspect;
        const fh = this._a.set(fwd.x, 0, fwd.z).normalize();
        const wx = this._camRest.x + fh.x * D + right.x * nx * tanH * D;
        const wz = this._camRest.z + fh.z * D + right.z * nx * tanH * D;
        // Snap to the grid as it stands now (cell centres sit half a cell off the lines).
        const S = GRID_SPACING;
        const scroll = this.u.scroll.value;
        const cx = (Math.floor(wx / S) + 0.5) * S;
        const cz = scroll + (Math.floor((wz - scroll) / S) + 0.5) * S;
        const turns = Number.isFinite(piece?.rotation) ? piece.rotation & 3 : 0;
        const cells = TETROMINO_SHAPES[type].map(([x, y]) => {
            let px = x;
            let py = y;
            for (let k = 0; k < turns; k += 1) [px, py] = [-py, px];
            return [px, py];
        });
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
        // A hot hand's holograms stand longer (as long as the pool holds a quick hand's pieces).
        const life = Math.min(
            2.6 + 0.8 * this.drive.hot + 0.6 * this.drive.fever,
            Math.max(2.6, (this.fx.tileCapacity / 4) * 0.3),
        );
        this.fx.spawnPiece(t, placed, color, life, this.scrollRun);
        this.spawnRipple(cx, cz, hard ? 1.5 : 1);
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
     * true combo lifts what the next clear lights.
     */
    onLineClear(lines = 1, { cascade = 1 } = {}) {
        const t = this.time;
        const n = Math.max(1, Math.min(4, lines | 0));
        const deeper = Math.max(0, Math.round(Number(cascade) || 1) - 1);
        this.lastLockCleared = true;
        const combo = this.combo.noteLineClear();
        this.chainLen = combo;
        const steps = Math.min(10, Math.max(0, combo - 1));
        // The floor: a wave of light rolls in from the horizon; a quick hand's clears join the
        // one still waiting below it and arrive as one brighter band.
        this.triggerRing((0.5 + 0.2 * n) * (1 + 0.18 * deeper) + 0.04 * steps, 1.25);
        // The ranges: a laser sweep rolls through toward the camera.
        this.triggerContour((0.5 + 0.15 * n) * (1 + 0.22 * deeper) + 0.035 * steps, 1 + 0.16 * deeper);
        if (n >= 2 || steps >= 2) this.triggerHolo(0.6 + 0.15 * n + 0.04 * steps);
        if (n >= 4) this.triggerHolo(1.2, 0.35);
        this.sunSwell.hit(0.12 * n + 0.05 * deeper + 0.03 * steps, t);
        this.emitRisingPixels(this.burstCount(0.05 * n + 0.01 * steps, 22 * n + 6 * Math.min(6, steps)));
        if (n >= 4) {
            this.sunSwell.hit(0.7, t);
            this.glitch = Math.min(1, this.glitch + 0.5);
            this.emitSunBurst(this.burstCount(0.45, 220));
        }
        this.comboTarget = Math.min(1, Math.max(this.comboTarget, 0.09 * steps + 0.12 * deeper));
        // The surge: a lock's clear once (with its combo), each wave past the first one more wave.
        if (deeper === 0) this.surge.clear({ lines: n, combo }, t);
        else this.surge.clear({ lines: n, cascade: 2 }, t);
    }

    /** A cascade wave past the first (`count` = its depth; it comes before the wave's clear). */
    onCombo(count = 1) {
        const c = Math.max(0, count | 0);
        this.comboTarget = Math.min(1, Math.max(this.comboTarget, c * 0.16));
        this.sunSwell.hit(0.2, this.time);
        this.glitch = Math.min(1, this.glitch + 0.3 + c * 0.05);
        if (c >= 2) {
            this.emitShootingStar();
            this.emitSunBurst(this.burstCount(0.12 + c * 0.06, 60 + 28 * c));
        }
        // From the third wave a halo leaves the sun, each one brighter than the last.
        if (c >= 3) this.triggerHolo(0.5 + 0.12 * c);
    }

    onLevelUp() {
        const t = this.time;
        this.sunSwell.hit(0.8, t);
        this.glitch = Math.min(1, this.glitch + 0.6);
        this.triggerRing(1.0, 1.25);
        this.triggerHolo(1.2);
        this.triggerHolo(1.0, 0.4);
        this.triggerContour(1.2, 1.1);
        this.emitShootingStar();
        this.emitSunBurst(this.burstCount(0.4, 180));
        this.surge.levelUp(t);
    }

    /**
     * A T-spin: a spun halo, its dashes wheeling round the sun (it turns the clear's own halo
     * when they leave together). One that clears nothing still turns a small one.
     */
    onTSpin(lineCount = 0) {
        const t = this.time;
        const n = Math.max(0, lineCount | 0);
        this.triggerHolo(n > 0 ? 0.7 + 0.15 * n : 0.45, 0, { spin: n > 0 ? 8 : 6 });
        this.sunSwell.hit(n > 0 ? 0.15 : 0.08, t);
        if (n === 0) this.emitRisingPixels(this.burstCount(0.03, 14));
        const k = n > 0 ? 1 : 0.5;
        this.surge.punch.hit(SURGE_WEIGHTS.punch.tspin * k, t);
        this.surge.level.hit(SURGE_WEIGHTS.heat.tspin * k, t);
    }

    /**
     * Back-to-back: twin halos wheeling opposite ways and a double laser sweep through the
     * ranges, each streak brighter than the last.
     */
    onB2B(active = true) {
        if (active === false) {
            this.b2bStreak = 0;
            return;
        }
        const t = this.time;
        this.b2bStreak += 1;
        const k = 1 + 0.25 * Math.min(4, this.b2bStreak - 1);
        this.triggerHolo(0.85 * k, 0.05, { spin: 5, join: false });
        this.triggerHolo(0.85 * k, 0.2, { spin: -5, join: false });
        this.triggerContour(0.9 * k, 1.12);
        this.triggerContour(0.9 * k, 1.12, 0.22);
        this.sunSwell.hit(0.3 * k, t);
        this.surge.punch.hit(SURGE_WEIGHTS.punch.b2b, t);
        this.surge.level.hit(SURGE_WEIGHTS.heat.b2b, t);
    }

    /**
     * The perfect clear (it comes ~0.36 s after the clear's last wave): a crown on the clear
     * still playing, not a new clear. The slits close and the whole disc burns gold, halos
     * fill the sky, every range lights up, and the glass breathes the light back out to the
     * horizon as it lets go.
     */
    onPerfectClear() {
        const t = this.time;
        this.crownSwell.hit(1, t);
        this.sunSwell.hit(0.5, t);
        this.triggerHolo(1.4, 0, { spin: 2 });
        this.triggerHolo(1.1, 0.45, { spin: -2 });
        this.triggerContour(1.6, 1.25);
        this.triggerRing(1.0, 0.5, { out: true });
        this.emitShootingStar();
        this.emitShootingStar();
        this.emitSunBurst(this.burstCount(0.35, 160));
        this.surge.punch.hit(SURGE_WEIGHTS.punch.perfect, t);
        this.surge.level.hit(SURGE_WEIGHTS.heat.perfect, t);
    }

    /**
     * After a lock that cleared nothing, a chain of three or more is over: the glass exhales,
     * a soft wave running out to the horizon (the palette eases back by itself).
     */
    checkChain() {
        if (this.lastLockCleared || !(this.time > this.lastLockAt)) return;
        this.lastLockCleared = true;
        const chain = this.chainLen;
        this.chainLen = 0;
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
     * A shooting star across the visible upper sky, falling away from the sun. It takes a dead
     * slot, else the star furthest through its streak.
     */
    emitShootingStar(t0 = this.time, r = this.rand) {
        let slot = 0;
        for (let i = 1; i < this.shoots.length; i += 1) {
            if (this.shoots[i].t0 < this.shoots[slot].t0) slot = i;
        }
        this.shoots[slot].t0 = t0;
        const uni = this.shootU[slot];
        const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.lens.vfov) / 2) * this.lens.aspect);
        const az = this.yaw + (r() * 2 - 1) * halfH * 0.75;
        const el = 0.22 + r() * 0.22;
        // Heading in (azimuth, elevation) space: across and down.
        const across = az > this.yaw ? 1 : -1;
        const heading = Math.atan2(-(0.35 + r() * 0.4), across * (0.8 + r() * 0.4));
        uni.value.set(az, el, heading, 0);
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
     * A neon pixel burst (combos, Tetris, level up): pixels leave the sun's face and fly to their
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

    /** Hide everything but the named parts (sky mountains floor fx) — iteration aid. */
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
        this.reflection?.dispose?.();
        this.reflection = null;
        this.fx?.dispose();
        this.parts = {};
    }
}
