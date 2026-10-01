/**
 * Synthwave Sunset — the world: builds every part, solves the composition, drives the camera
 * and turns gameplay events into light.
 *
 * Composition. The sun sits at azimuth 0 (straight down −z) and the grid scrolls toward it, so
 * the grid's vanishing point is the sun. The gameplay board covers the middle of the screen, so
 * the camera YAWS until the sun lands in the centre of the free zone left of the board (the HUD
 * sits right of it). With no board on screen (menus) the camera faces the sun: the classic
 * centred outrun shot. Layout changes ease in as a slow pan. The lens is Hor+ (fixed vertical
 * FOV, horizontal capped), and the pitch puts the horizon at RIG.horizonFrac.
 *
 * Draws: sky, floor, mountains, city, palms, cells, sparks, motes — 8 in total at High.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    GRID_SPACING,
    RIG,
    SCROLL_SPEED,
    SCROLL_WRAP,
    SUN,
} from './synthwave-sunset-tsl.js';
import { createSky } from './synthwave-sunset-sky.js';
import { createFloor } from './synthwave-sunset-floor.js';
import { createCity, createMountains } from './synthwave-sunset-skyline.js';
import { createPalms } from './synthwave-sunset-palms.js';
import { SynthwaveFx } from './synthwave-sunset-fx.js';

/** Per-tier content. Every tier keeps the full composition; tiers trade detail, not layout. */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        cloudOctaves: 0,
        stars: true,
        shooting: false,
        reflection: false,
        cityDensity: 0.55,
        windowGlow: 0.85,
        palms: 2,
        cells: 30,
        sparks: 160,
        motes: 0,
    },
    Low: {
        cloudOctaves: 2,
        stars: true,
        shooting: true,
        reflection: true,
        cityDensity: 0.7,
        windowGlow: 0.9,
        palms: 2,
        cells: 40,
        sparks: 240,
        motes: 0,
    },
    Medium: {
        cloudOctaves: 2,
        stars: true,
        shooting: true,
        reflection: true,
        cityDensity: 0.85,
        windowGlow: 1,
        palms: 3,
        cells: 60,
        sparks: 400,
        motes: 80,
    },
    High: {
        cloudOctaves: 3,
        stars: true,
        shooting: true,
        reflection: true,
        cityDensity: 1,
        windowGlow: 1,
        palms: 5,
        cells: 80,
        sparks: 640,
        motes: 150,
    },
    Ultra: {
        cloudOctaves: 3,
        stars: true,
        shooting: true,
        reflection: true,
        cityDensity: 1.15,
        windowGlow: 1,
        palms: 5,
        cells: 100,
        sparks: 900,
        motes: 200,
    },
    Extreme: {
        cloudOctaves: 3,
        stars: true,
        shooting: true,
        reflection: true,
        cityDensity: 1.3,
        windowGlow: 1,
        palms: 5,
        cells: 150,
        sparks: 1200,
        motes: 260,
    },
});

/** The theme's tetromino palette (synthwave-sunset-tetrominos.js), for the grid cells. */
const PIECE_COLORS = {
    I: new THREE.Color(0xff0066),
    O: new THREE.Color(0xff4500),
    T: new THREE.Color(0xb000ff),
    S: new THREE.Color(0xff006e),
    Z: new THREE.Color(0xff5e78),
    J: new THREE.Color(0x00d4ff),
    L: new THREE.Color(0xffff00),
};

const PIECE_SHAPES = {
    I: [[0, 0], [1, 0], [2, 0], [3, 0]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
    O: [[0, 0], [1, 0], [0, 1], [1, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};

const EMBER_COLORS = [0xff2a7a, 0xff6a3d, 0xffa04a, 0xb04dff].map((h) => new THREE.Color(h));
const CORONA_COLORS = [0xffd24a, 0xff9a2e, 0xff5a3a, 0xff3a8a].map((h) => new THREE.Color(h));

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

export function createWorldUniforms() {
    return {
        time: uniform(0),
        scroll: uniform(0),
        sunDir: uniform(new THREE.Vector3(0, 0, -1)),
        sunRight: uniform(new THREE.Vector3(1, 0, 0)),
        sunUp: uniform(new THREE.Vector3(0, 1, 0)),
        sunRadius: uniform(Math.sin(SUN.radius)),
        sunPulse: uniform(0),
        horizonFlash: uniform(0),
        comboShift: uniform(0),
        cityPulse: uniform(0),
        cellTwinkle: uniform(0),
        ring0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        ring1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        shoot0A: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shoot0B: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shoot1A: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shoot1B: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
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

        // Sun frame (fixed in world)
        const elev = Math.asin(Math.sin(SUN.radius)) * SUN.lift;
        this.sunDir = new THREE.Vector3(0, Math.sin(elev), -Math.cos(elev));
        this.sunUp = new THREE.Vector3(0, Math.cos(elev), Math.sin(elev));
        this.sunRight = new THREE.Vector3(1, 0, 0);
        this.u.sunDir.value.copy(this.sunDir);
        this.u.sunUp.value.copy(this.sunUp);
        this.u.sunRight.value.copy(this.sunRight);

        // Reactive state
        this.sunPulse = 0;
        this.horizonFlash = 0;
        this.comboShift = 0;
        this.cityPulse = 0;
        this.cellTwinkle = 0;
        this.rings = [{ t0: -1e6, energy: 0 }, { t0: -1e6, energy: 0 }];
        this.ringCursor = 0;
        this.shoots = [{ t0: -1e6, life: 1 }, { t0: -1e6, life: 1 }];
        this.shootCursor = 0;
        this.nextAmbientShoot = 12 + this.rand() * 18;

        this._camRest = new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        this._fwd = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._target = new THREE.Vector3();
    }

    build() {
        const { q, u, rand } = this;
        this.parts.sky = createSky(u, { cloudOctaves: q.cloudOctaves, stars: q.stars, shootingStars: q.shooting });
        this.parts.floor = createFloor(u, { reflection: q.reflection });
        this.parts.mountains = createMountains(u, { rand });
        this.parts.city = createCity(u, { rand, density: q.cityDensity, windowGlow: q.windowGlow });
        this.parts.palms = createPalms(u, { rand, count: q.palms });
        this.fx = new SynthwaveFx(u, {
            cells: q.cells, sparks: q.sparks, motes: q.motes, rand,
        });
        for (const part of Object.values(this.parts)) {
            if (part) this.root.add(part);
        }
        this.root.add(this.fx.group);
        this.scene.add(this.root);
        return this;
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
        const driftX = Math.sin(t * 0.031) * 1.0 + Math.sin(t * 0.017 + 1.3) * 0.45;
        const driftY = Math.sin(t * 0.023 + 0.7) * 0.26;
        const px = (sim.pointerX ?? 0) * 1.5;
        const py = -(sim.pointerY ?? 0) * 0.55;
        camera.position.copy(this._camRest)
            .addScaledVector(this._right, driftX + px);
        camera.position.y += driftY + py;
        // A distant look target: the far scene (sun, mountains) stays put, near palms parallax.
        this._target.copy(this._camRest).addScaledVector(this._fwd, 1500);
        camera.lookAt(this._target);
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
        u.scroll.value = (t * SCROLL_SPEED) % SCROLL_WRAP;

        const k = (rate) => Math.exp(-rate * dt);
        this.sunPulse *= k(1.1);
        this.horizonFlash *= k(1.6);
        this.comboShift *= k(0.9);
        this.cityPulse *= k(1.3);
        this.cellTwinkle *= k(2.2);
        u.sunPulse.value = Math.min(1.2, this.sunPulse);
        u.horizonFlash.value = Math.min(1.2, this.horizonFlash);
        u.comboShift.value = Math.min(1, this.comboShift);
        u.cityPulse.value = Math.min(1.5, this.cityPulse);
        u.cellTwinkle.value = Math.min(1.5, this.cellTwinkle);

        // Sonar rings: in from 170 units to past the camera in ~2.3 s, strongest mid-field.
        this.rings.forEach((ring, i) => {
            const age = t - ring.t0;
            const uni = i === 0 ? u.ring0 : u.ring1;
            if (age < 0 || age > 2.4 || ring.energy <= 0) {
                uni.value.z = 0;
                return;
            }
            const radius = Math.max(0, 170 - age * 78);
            const width = 1.6 + radius * 0.03;
            const env = Math.min(1, age / 0.15) * (1 - THREE.MathUtils.smoothstep(age, 1.7, 2.4));
            uni.value.set(radius, 1 / width, ring.energy * env, 0);
        });

        // Shooting stars.
        if (this.q.shooting && t >= this.nextAmbientShoot) {
            this.spawnShootingStar(0.8);
            this.nextAmbientShoot = t + 18 + this.rand() * 26;
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

    /** Seek (deterministic captures): no events in flight, cells and sparks cleared. */
    seek(time) {
        this.time = time;
        this.sunPulse = 0;
        this.horizonFlash = 0;
        this.comboShift = 0;
        this.cityPulse = 0;
        this.cellTwinkle = 0;
        this.rings.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.shoots.forEach((s) => { s.t0 = -1e6; });
        this.nextAmbientShoot = time + 12 + this.rand() * 18;
        this.fx?.clear();
    }

    // ── Events ───────────────────────────────────────────────────────────────

    onPieceLock(piece) {
        const t = this.time;
        const type = piece?.type;
        const color = PIECE_COLORS[type] || PIECE_COLORS.J;
        const shape = PIECE_SHAPES[type] || PIECE_SHAPES.T;
        const column = Number.isFinite(piece?.x) ? piece.x : this.rand() * 9;
        const rotation = Number.isFinite(piece?.rotation)
            ? ((piece.rotation % 4) + 4) % 4
            : Math.floor(this.rand() * 4);

        // Place the cells ahead of the camera, spread across the view by the piece's column.
        const rel = THREE.MathUtils.clamp((column - 4.5) / 4.5, -1, 1) * 0.62;
        const az = this.yaw + rel;
        const dist = 26 + this.rand() * 14;
        const wx = RIG.x + Math.sin(az) * dist;
        const wz = RIG.z - Math.cos(az) * dist;
        const S = GRID_SPACING;
        const scroll = (t * SCROLL_SPEED) % SCROLL_WRAP;
        const cx = (Math.floor(wx / S) + 0.5) * S;
        const cz = scroll + (Math.floor((wz - scroll) / S) + 0.5) * S;
        for (const [bx0, by0] of shape) {
            let bx = bx0;
            let by = by0;
            for (let r = 0; r < rotation; r += 1) {
                const tmp = bx;
                bx = -by;
                by = tmp;
            }
            this.fx.spawnCell(cx + bx * S, cz - by * S, t, color, 1.0);
        }
        this.cellTwinkle = Math.max(this.cellTwinkle, 0.25);
        this.cityPulse = Math.min(1.5, this.cityPulse + 0.05);
    }

    onLineClear(lines = 1) {
        const n = Math.max(1, Math.min(4, lines | 0));
        this.triggerRing(0.55 + 0.2 * n);
        this.horizonFlash = Math.min(1.2, this.horizonFlash + 0.35 + 0.15 * n);
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.12 * n);
        this.cityPulse = Math.min(1.5, this.cityPulse + 0.3 * n);
        this.emitEmbers(22 * n);
        if (n >= 4) {
            this.sunPulse = 1.2;
            this.spawnShootingStar(1.2);
            this.emitCorona(90);
        }
    }

    onCombo(count = 1) {
        const c = Math.max(0, count | 0);
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.3);
        this.cityPulse = Math.min(1.5, this.cityPulse + 0.4);
        this.comboShift = Math.min(1, Math.max(this.comboShift, c * 0.15));
        this.cellTwinkle = Math.min(1.5, 0.5 + c * 0.2);
        if (c >= 2) this.emitCorona(Math.min(120, 18 * c));
        if (c >= 3 && this.rand() < Math.min(0.75, 0.3 + c * 0.1)) this.spawnShootingStar(1.0);
    }

    onLevelUp() {
        this.horizonFlash = 1.2;
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.5);
        this.triggerRing(1.0);
        this.spawnShootingStar(1.2);
        this.emitCorona(60);
    }

    triggerRing(energy) {
        const ring = this.rings[this.ringCursor];
        this.ringCursor = (this.ringCursor + 1) % this.rings.length;
        ring.t0 = this.time;
        ring.energy = energy;
    }

    /** A streak across the upper sky, in (azimuth, elevation) space around the current view. */
    spawnShootingStar(intensity = 1) {
        if (!this.q.shooting) return;
        const s = this.shoots[this.shootCursor];
        const slot = this.shootCursor;
        this.shootCursor = (this.shootCursor + 1) % this.shoots.length;
        const r = this.rand;
        const az0 = this.yaw + (r() * 2 - 1) * 0.55;
        const e0 = 0.24 + r() * 0.16;
        const dirSign = r() < 0.5 ? -1 : 1;
        const speed = 0.55 + r() * 0.35; // rad/s
        const vAz = dirSign * speed * 0.9;
        const vE = -speed * (0.25 + r() * 0.25);
        s.t0 = this.time;
        s.life = 0.9 + r() * 0.5;
        s.len = 0.09 + r() * 0.06;
        s.intensity = intensity;
        (slot === 0 ? this.u.shoot0A : this.u.shoot1A).value.set(az0, e0, vAz, vE);
    }

    /** Embers rising off the valley horizon under the sun (line clears). */
    emitEmbers(count) {
        const t = this.time;
        const r = this.rand;
        for (let i = 0; i < count; i += 1) {
            const phi = (r() * 2 - 1) * 0.26;
            const d = 260 + r() * 160;
            const x = Math.sin(phi) * d;
            const z = RIG.z - Math.cos(phi) * d;
            const scale = d / 60;
            this.fx.spawnSpark(
                t + r() * 0.25,
                x,
                1 + r() * 6,
                z,
                (r() - 0.5) * 2 * scale,
                (4 + r() * 5) * scale,
                (r() - 0.5) * scale,
                1.3 + r() * 0.9,
                EMBER_COLORS[Math.floor(r() * EMBER_COLORS.length)],
                5 + r() * 6,
            );
        }
    }

    /** Sparks thrown off the sun's upper rim (combos, Tetris, level up). */
    emitCorona(count) {
        const t = this.time;
        const r = this.rand;
        const D = 820;
        const rimR = D * Math.tan(SUN.radius);
        const cx = RIG.x + this.sunDir.x * D;
        const cy = RIG.height + this.sunDir.y * D;
        const cz = RIG.z + this.sunDir.z * D;
        for (let i = 0; i < count; i += 1) {
            const a = r() * Math.PI;
            const ox = Math.cos(a);
            const oy = Math.sin(a);
            const px = cx + ox * rimR * this.sunRight.x;
            const py = cy + ox * rimR * this.sunRight.y + oy * rimR * this.sunUp.y;
            const pz = cz + oy * rimR * this.sunUp.z;
            const speed = D * (0.06 + r() * 0.08);
            this.fx.spawnSpark(
                t + r() * 0.15,
                px,
                py,
                pz,
                ox * speed,
                oy * speed * this.sunUp.y,
                oy * speed * this.sunUp.z,
                1.1 + r() * 0.9,
                CORONA_COLORS[Math.floor(r() * CORONA_COLORS.length)],
                4 + r() * 4,
            );
        }
    }

    /** Hide everything but the named parts (sky floor mountains city palms fx) — iteration aid. */
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
