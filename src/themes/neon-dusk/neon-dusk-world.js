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
import { createSky } from './neon-dusk-sky.js';
import { createMountains } from './neon-dusk-mountains.js';
import { createFloor } from './neon-dusk-floor.js';
import { DIRECT_ONLY_LAYER, NeonDuskFx } from './neon-dusk-fx.js';

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
const PIECE_COLORS = {
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
        /** Floor light waves from the horizon: (radius, 1/width, energy, 0). */
        ring0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        ring1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        /** The last piece lock's ripple in the glass: (x, z, radius, energy). */
        ripple: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** Hologram rings out of the sun: (radius in sun radii, 1/width, energy, 0). */
        holo0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        holo1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        /** Shooting stars: (azimuth, elevation, heading, normalised age; ≥ 1 = dead). */
        shoot0: uniform(new THREE.Vector4(0, 0, 0, 2)),
        shoot1: uniform(new THREE.Vector4(0, 0, 0, 2)),
        /** A wave of light rolling through the ranges toward the camera: (distance, energy). */
        contourWave: uniform(new THREE.Vector2(0, 0)),
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

        this.sunPulse = 0;
        this.comboShift = 0;
        this.comboTarget = 0;
        this.glitch = 0;
        this.rings = [{ t0: -1e6, energy: 0 }, { t0: -1e6, energy: 0 }];
        this.ringCursor = 0;
        this.holos = [{ t0: -1e6, energy: 0 }, { t0: -1e6, energy: 0 }];
        this.holoCursor = 0;
        this.shoots = [{ t0: -1e6 }, { t0: -1e6 }];
        this.shootCursor = 0;
        this.ripple = {
            t0: -1e6, x: 0, z: 0, energy: 0,
        };
        this.contour = { t0: -1e6, energy: 0 };

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
        this.yaw += (this.targetYaw - this.yaw) * approach(1.2, dt);
        if (camera.fov !== this.lens.vfov || camera.aspect !== this.lens.aspect) {
            camera.fov = this.lens.vfov;
            camera.aspect = this.lens.aspect;
            camera.updateProjectionMatrix();
        }
        const t = sim.time ?? this.time;
        const { fwd, right } = this.viewBasis();
        const driftX = Math.sin(t * 0.05) * 1.4 + Math.sin(t * 0.023 + 1.1) * 0.6;
        const driftY = Math.sin(t * 0.07 + 0.4) * 0.35 + Math.sin(t * 0.019) * 0.2;
        const px = (sim.pointerX ?? 0) * 1.6;
        const py = -(sim.pointerY ?? 0) * 0.6;
        camera.position.copy(this._camRest).addScaledVector(right, driftX + px);
        camera.position.y = Math.max(2, camera.position.y + driftY + py);
        this._target.copy(this._camRest).addScaledVector(fwd, 2000);
        camera.lookAt(this._target);
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
        u.scroll.value = (t * SCROLL_SPEED) % SCROLL_WRAP;
        this.sunPulse *= Math.exp(-1.1 * dt);
        this.glitch *= Math.exp(-3.5 * dt);
        this.comboTarget *= Math.exp(-0.35 * dt);
        this.comboShift += (this.comboTarget - this.comboShift) * approach(2.5, dt);
        u.sunPulse.value = Math.min(1.2, this.sunPulse);
        u.comboShift.value = THREE.MathUtils.clamp(this.comboShift, 0, 1);

        // Floor light waves: in from 700 units to past the camera in ~2.8 s.
        this.rings.forEach((ring, i) => {
            const age = t - ring.t0;
            const uni = i === 0 ? u.ring0 : u.ring1;
            if (age < 0 || age > 3 || ring.energy <= 0) {
                uni.value.z = 0;
                return;
            }
            const radius = Math.max(0, 700 - age * 250);
            const width = 5 + radius * 0.05;
            const env = Math.min(1, age / 0.15) * (1 - THREE.MathUtils.smoothstep(age, 2.2, 3));
            uni.value.set(radius, 1 / width, ring.energy * env, 0);
        });

        // Hologram halos: out of the sun's rim to ~three radii in 2.2 s, fading as they go.
        this.holos.forEach((holo, i) => {
            const age = t - holo.t0;
            const uni = i === 0 ? u.holo0 : u.holo1;
            if (age < 0 || age > 2.2 || holo.energy <= 0) {
                uni.value.z = 0;
                return;
            }
            const k = age / 2.2;
            const radius = 1.04 + 1.9 * (1 - (1 - k) ** 2);
            const width = 0.08 + k * 0.2;
            const env = Math.min(1, age / 0.1) * (1 - k) ** 1.5;
            uni.value.set(radius, 1 / width, holo.energy * env, 0);
        });

        // Shooting stars live 0.9 s.
        this.shoots.forEach((shoot, i) => {
            const uni = i === 0 ? u.shoot0 : u.shoot1;
            uni.value.w = Math.max(0, (t - shoot.t0) / 0.9);
        });

        // The lock ripple spreads at 46 units/s and fades over 1.8 s.
        const rAge = t - this.ripple.t0;
        if (rAge >= 0 && rAge < 1.8) {
            const env = Math.min(1, rAge / 0.08) * (1 - rAge / 1.8) ** 1.5;
            u.ripple.value.set(this.ripple.x, this.ripple.z, 2 + rAge * 46, this.ripple.energy * env);
        } else {
            u.ripple.value.w = 0;
        }

        // The scan wave rolls in from behind the far range (3000 → 350 units) in 1.5 s.
        const cAge = t - this.contour.t0;
        if (cAge >= 0 && cAge < 1.6) {
            const env = Math.min(1, cAge / 0.12) * (1 - THREE.MathUtils.smoothstep(cAge, 1.2, 1.6));
            u.contourWave.value.set(3000 - cAge * 1770, this.contour.energy * env);
        } else {
            u.contourWave.value.y = 0;
        }
    }

    seek(time) {
        this.time = time;
        this.sunPulse = 0;
        this.glitch = 0;
        this.comboShift = 0;
        this.comboTarget = 0;
        this.rings.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.holos.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.shoots.forEach((s) => { s.t0 = -1e6; });
        this.ripple.t0 = -1e6;
        this.contour.t0 = -1e6;
        this.fx?.clear();
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * A piece lock lights its shape in the glass: tetromino tiles in the piece's colour on the
     * floor beside the board (left of it for pieces that landed in the board's left half), a
     * ripple ring spreading out from them and a few pixels rising off them.
     */
    onPieceLock(piece) {
        const r = this.rand;
        const type = piece?.type && TETROMINO_SHAPES[piece.type] ? piece.type : 'T';
        const color = new THREE.Color(PIECE_COLORS[type]);
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
        for (const [px, py] of cells) {
            this.fx.spawnTile(this.time, cx + px * S, cz - py * S, color);
        }
        this.ripple.t0 = this.time;
        this.ripple.x = cx;
        this.ripple.z = cz;
        this.ripple.energy = 1;
        for (let i = 0; i < 6; i += 1) {
            const [px, py] = cells[i % cells.length];
            this.fx.spawnPixel(
                this.time + r() * 0.2,
                cx + px * S + (r() - 0.5) * S,
                0.5,
                cz - py * S + (r() - 0.5) * S,
                (r() - 0.5) * 1.5,
                5 + r() * 5,
                (r() - 0.5) * 1.5,
                1.4 + r() * 0.8,
                color,
                4 + r() * 3,
                {
                    drag: 0.8, lift: 0.5, flicker: 10 + r() * 10, phase: r() * 6.28,
                },
            );
        }
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.06);
    }

    onLineClear(lines = 1) {
        const n = Math.max(1, Math.min(4, lines | 0));
        this.triggerRing(0.5 + 0.2 * n, 1.25);
        this.contour.t0 = this.time;
        this.contour.energy = 0.5 + 0.15 * n;
        if (n >= 2) this.triggerHolo(0.6 + 0.15 * n);
        if (n >= 4) this.triggerHolo(1.2, 0.35);
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.12 * n);
        this.emitRisingPixels(this.burstCount(0.05 * n, 22 * n));
        if (n >= 4) {
            this.sunPulse = 1.2;
            this.glitch = Math.min(1, this.glitch + 0.5);
            this.emitSunBurst(this.burstCount(0.45, 220));
        }
    }

    onCombo(count = 1) {
        const c = Math.max(0, count | 0);
        this.comboTarget = Math.min(1, Math.max(this.comboTarget, c * 0.16));
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.2);
        this.glitch = Math.min(1, this.glitch + 0.3 + c * 0.05);
        if (c >= 2) {
            this.emitShootingStar();
            this.emitSunBurst(this.burstCount(0.12 + c * 0.06, 60 + 28 * c));
        }
        if (c >= 4) this.triggerHolo(0.8);
    }

    onLevelUp() {
        this.sunPulse = 1.2;
        this.glitch = Math.min(1, this.glitch + 0.6);
        this.triggerRing(1.0, 1.25);
        this.triggerHolo(1.2);
        this.triggerHolo(1.0, 0.4);
        this.contour.t0 = this.time;
        this.contour.energy = 1.2;
        this.emitShootingStar();
        this.emitSunBurst(this.burstCount(0.4, 180));
    }

    triggerRing(energy, delay = 0) {
        const ring = this.rings[this.ringCursor];
        this.ringCursor = (this.ringCursor + 1) % this.rings.length;
        ring.t0 = this.time + delay;
        ring.energy = energy;
    }

    triggerHolo(energy, delay = 0) {
        const holo = this.holos[this.holoCursor];
        this.holoCursor = (this.holoCursor + 1) % this.holos.length;
        holo.t0 = this.time + delay;
        holo.energy = energy;
    }

    /** A shooting star across the visible upper sky, falling away from the sun. */
    emitShootingStar() {
        const r = this.rand;
        const slot = this.shootCursor;
        this.shootCursor = (slot + 1) % this.shoots.length;
        this.shoots[slot].t0 = this.time;
        const uni = slot === 0 ? this.u.shoot0 : this.u.shoot1;
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
    emitSunBurst(count) {
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
