/**
 * Nimbus Veil — the world: builds every part, solves the composition, drives the camera and
 * turns gameplay events into light.
 *
 * Composition. The low sun sits at azimuth 0 over the cloud sea. The gameplay board covers the
 * middle of the screen, so the camera YAWS until the sun lands in the centre of the free zone
 * left of the board; with no board on screen (menus) it faces the sun. Layout changes ease in as
 * a slow pan. The lens is Hor+ (fixed vertical FOV, horizontal capped) and the pitch puts the
 * horizon at RIG.horizonFrac.
 *
 * Draws at High: sky, cloud sea, cumulus, two veils, motes, sparkles — seven.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    RIG,
    SEA_SPEED,
    SEA_WRAP,
    SUN,
} from './nimbus-veil-tsl.js';
import { createSky } from './nimbus-veil-sky.js';
import { createCloudSea } from './nimbus-veil-cloudsea.js';
import { createCumulus } from './nimbus-veil-cumulus.js';
import { NimbusFx } from './nimbus-veil-fx.js';

/** Per-tier content. Every tier keeps the composition; tiers trade detail, not layout. */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        rings: 90, segments: 100, towers: 3, puffs: 14, motes: 0, sparkles: 120, veils: 0, cirrus: false,
    },
    Low: {
        rings: 120, segments: 130, towers: 4, puffs: 18, motes: 40, sparkles: 200, veils: 1, cirrus: true,
    },
    Medium: {
        rings: 150, segments: 150, towers: 5, puffs: 24, motes: 80, sparkles: 300, veils: 1, cirrus: true,
    },
    High: {
        rings: 180, segments: 180, towers: 7, puffs: 30, motes: 120, sparkles: 450, veils: 2, cirrus: true,
    },
    Ultra: {
        rings: 200, segments: 200, towers: 7, puffs: 38, motes: 160, sparkles: 600, veils: 2, cirrus: true,
    },
    Extreme: {
        rings: 220, segments: 220, towers: 7, puffs: 46, motes: 200, sparkles: 800, veils: 2, cirrus: true,
    },
});

const GLINT_COLORS = [0xfff1c9, 0xffd88f, 0xffc2a8, 0xf3dcff, 0xffffff].map((h) => new THREE.Color(h));

/** Camera-space depth the combo burst floats at: past the near veil, well before the towers. */
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
        seaScroll: uniform(0),
        sunDir: uniform(new THREE.Vector3(0, 0, -1)),
        sunRight: uniform(new THREE.Vector3(1, 0, 0)),
        sunUp: uniform(new THREE.Vector3(0, 1, 0)),
        sunRadius: uniform(SUN.radius),
        sunPulse: uniform(0),
        seaGlow: uniform(0),
        ring0: uniform(new THREE.Vector4(0, 1, 0, 0)),
        ring1: uniform(new THREE.Vector4(0, 1, 0, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camBack: uniform(new THREE.Vector3(0, 0, 1)),
        invTanHalfV: uniform(1 / Math.tan(THREE.MathUtils.degToRad(RIG.vfov) / 2)),
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
        this.u.sunDir.value.copy(this.sunDir);
        this.u.sunUp.value.copy(this.sunUp);
        this.u.sunRight.value.copy(this.sunRight);

        this.sunPulse = 0;
        this.seaGlow = 0;
        this.rings = [{ t0: -1e6, energy: 0 }, { t0: -1e6, energy: 0 }];
        this.ringCursor = 0;

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
        this.parts.sky = createSky(u, { cirrus: q.cirrus });
        this.parts.sea = createCloudSea(u, { rings: q.rings, segments: q.segments });
        this.parts.cumulus = createCumulus(u, { rand, towers: q.towers, puffsPerTower: q.puffs });
        this.fx = new NimbusFx(u, {
            motes: q.motes, sparkles: q.sparkles, veils: q.veils, rand,
        });
        for (const part of Object.values(this.parts)) {
            if (part) this.root.add(part);
        }
        this.root.add(this.fx.group);
        this.scene.add(this.root);
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

    /** Camera: eased yaw, the rest pose, a slow floating drift and pointer parallax. */
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
        const driftX = Math.sin(t * 0.045) * 1.1 + Math.sin(t * 0.021 + 1.1) * 0.5;
        const driftY = Math.sin(t * 0.06 + 0.4) * 0.55 + Math.sin(t * 0.017) * 0.3;
        const px = (sim.pointerX ?? 0) * 1.2;
        const py = -(sim.pointerY ?? 0) * 0.5;
        camera.position.copy(this._camRest).addScaledVector(right, driftX + px);
        camera.position.y += driftY + py;
        this._target.copy(this._camRest).addScaledVector(fwd, 2000);
        camera.lookAt(this._target);
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
        u.seaScroll.value = (t * SEA_SPEED) % SEA_WRAP;
        this.sunPulse *= Math.exp(-1.0 * dt);
        this.seaGlow *= Math.exp(-0.8 * dt);
        u.sunPulse.value = Math.min(1.2, this.sunPulse);
        u.seaGlow.value = Math.min(1.5, this.seaGlow);
        // Light waves: in from 260 units to past the camera in ~3 s, strongest mid-field.
        this.rings.forEach((ring, i) => {
            const age = t - ring.t0;
            const uni = i === 0 ? u.ring0 : u.ring1;
            if (age < 0 || age > 3.2 || ring.energy <= 0) {
                uni.value.z = 0;
                return;
            }
            const radius = Math.max(0, 260 - age * 90);
            const width = 4 + radius * 0.06;
            const env = Math.min(1, age / 0.2) * (1 - THREE.MathUtils.smoothstep(age, 2.3, 3.2));
            uni.value.set(radius, 1 / width, ring.energy * env, 0);
        });
    }

    seek(time) {
        this.time = time;
        this.sunPulse = 0;
        this.seaGlow = 0;
        this.rings.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.fx?.clear();
    }

    // ── Events ───────────────────────────────────────────────────────────────

    onPieceLock() {
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.08);
        this.seaGlow = Math.min(1.5, this.seaGlow + 0.05);
    }

    onLineClear(lines = 1) {
        const n = Math.max(1, Math.min(4, lines | 0));
        this.triggerRing(0.45 + 0.18 * n);
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.15 * n);
        this.seaGlow = Math.min(1.5, this.seaGlow + 0.25 * n);
        this.emitRisingSparkles(this.burstCount(0.06 * n, 24 * n));
        if (n >= 4) {
            this.sunPulse = 1.2;
            this.emitHeavenlyBurst(this.burstCount(0.45, 220));
        }
    }

    onCombo(count = 1) {
        const c = Math.max(0, count | 0);
        this.sunPulse = Math.min(1.2, this.sunPulse + 0.25);
        this.seaGlow = Math.min(1.5, this.seaGlow + 0.3);
        if (c >= 2) this.emitHeavenlyBurst(this.burstCount(0.12 + c * 0.06, 60 + 28 * c));
    }

    onLevelUp() {
        this.sunPulse = 1.2;
        this.seaGlow = 1.2;
        this.triggerRing(1.0);
        this.emitHeavenlyBurst(this.burstCount(0.4, 180));
    }

    triggerRing(energy) {
        const ring = this.rings[this.ringCursor];
        this.ringCursor = (this.ringCursor + 1) % this.rings.length;
        ring.t0 = this.time;
        ring.energy = energy;
    }

    burstCount(share, cap) {
        return Math.max(16, Math.min(cap, Math.floor(this.fx.sparkleCapacity * share)));
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
     * A heavenly burst (combos, Tetris, level up): golden glints leave the sun and drift to their
     * own targets across the WHOLE screen — 70 % anywhere in the view, 30 % around the sun — then
     * float upward and twinkle out. Velocities are solved from the drag model (travel = v / drag).
     */
    emitHeavenlyBurst(count) {
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
