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
 * The evening runs on one number, `dusk` (0..1). It rests at DUSK.rest in the menus; while a game
 * is played it deepens with the clock and steps on each level, so the sun sinks into the sea and
 * the pier's lights come on from the land end out to the wheel.
 *
 * Gameplay:
 *   lock         two bands of the piece's colour run round the wheel's rims from the side of its
 *                column and meet at the top
 *   line clear   one firework shell per line from the barge off the pier; four lines, a finale
 *   chain        the coaster climbs the lift hill a notch per link (its lift's bulbs fill like a
 *                meter); when the chain breaks after three or more it goes once round the
 *                circuit into the station
 *   level up     the evening steps on, the wheel's neon ring changes colour, two shells
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { RIG, SUN } from './synthwave-sunset-tsl.js';
import { createSky } from './synthwave-sunset-sky.js';
import { createSea } from './synthwave-sunset-sea.js';
import { WHEEL, createWheel } from './synthwave-sunset-wheel.js';
import { createPier } from './synthwave-sunset-pier.js';
import { createCoaster } from './synthwave-sunset-coaster.js';
import { createPromenade } from './synthwave-sunset-promenade.js';
import { createPalms } from './synthwave-sunset-palms.js';
import { FIREWORK_COLORS, Fireworks } from './synthwave-sunset-fireworks.js';
import { SYNTHWAVE_SUNSET_TETROMINOS } from './synthwave-sunset-tetrominos.js';
import { applyCameraBreath, easedMotion, prefersReducedMotion } from '../shared/camera-breath.js';
import { flashScale, prefersReducedFlashing } from '../../utils/photosensitivity.js';

/**
 * The layer the sea's reflection pass renders: everything that stands in the scene and should be
 * mirrored (the wheel, the pier, the coaster, the town, the fireworks). The main camera sees it.
 */
export const MIRROR_LAYER = 3;

/** The parts, in build order (the playground's `parts=` names). */
export const SYNTHWAVE_PARTS = Object.freeze(['sky', 'sea', 'wheel', 'pier', 'coaster', 'promenade', 'palms', 'fireworks']);

/** Per-tier content. Every tier keeps the full composition; tiers trade detail, not layout. */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        cloudOctaves: 0,
        stars: true,
        shooting: false,
        seaTrains: 4,
        seaClouds: 0,
        swash: false,
        mirrorScale: 0,
        palms: 6,
        fireworks: 900,
        stars0: 70,
        finale: 3,
    },
    Low: {
        cloudOctaves: 2,
        stars: true,
        shooting: true,
        seaTrains: 5,
        seaClouds: 0,
        swash: true,
        mirrorScale: 0.25,
        palms: 10,
        fireworks: 1400,
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
        fireworks: 2000,
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
        fireworks: 2600,
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
        fireworks: 3200,
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
        fireworks: 4000,
        stars0: 200,
        finale: 8,
    },
});

/** The evening: its rest value, how long a game takes to reach full dusk, a level's step. */
export const DUSK = Object.freeze({
    rest: 0.14,
    fullAfter: 480,
    levelStep: 0.08,
    /** Play counts as ongoing for this long after the last gameplay event (s). */
    activeFor: 25,
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

/** Lock chases running round the wheel at once. */
const CHASE_SLOTS = 3;

export function createWorldUniforms() {
    const u = {
        time: uniform(0),
        sunDir: uniform(new THREE.Vector3(0, 0, -1)),
        sunRight: uniform(new THREE.Vector3(1, 0, 0)),
        sunUp: uniform(new THREE.Vector3(0, 1, 0)),
        /** The sun's bearing on the horizontal plane (x, z), unit length. */
        sunAz: uniform(new THREE.Vector2(0, -1)),
        sunRadius: uniform(Math.sin(SUN.radius)),
        sunTan: uniform(Math.tan(SUN.radius)),
        /** The evening: 0 = the sun on the sea, 1 = afterglow, the sun gone. */
        dusk: uniform(0),
        /** The ferris wheel: its angle (rad), how bright its lights burn, the neon ring's hue. */
        wheelAngle: uniform(0),
        wheelGlow: uniform(1),
        wheelNeonMix: uniform(0),
        /** The pier: how far its lights have come on (0..1, from the land end), how bright. */
        pierPower: uniform(1),
        pierGlow: uniform(1),
        /** The town round the bay: its windows, neon and house lights (0..1). */
        townLights: uniform(0.6),
        /** The coaster: its lift meter (track parameter lit up to) and how hard it is riding. */
        coasterMeter: uniform(0),
        coasterRide: uniform(0),
        coasterTrain: uniform(0),
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
        this.dusk = DUSK.rest;
        this.duskTarget = DUSK.rest;
        this.duskBase = DUSK.rest;
        this.duskHeld = false;
        this.lastPlayed = -1e6;
        this.setDusk(DUSK.rest);

        // Reactive state
        this.chases = Array.from({ length: CHASE_SLOTS }, () => ({ t0: -1e6 }));
        this.chaseCursor = 0;
        this.lastLockColor = new THREE.Color(FIREWORK_COLORS[0]);
        this.neonTarget = 0;
        this.coaster = {
            mode: 'idle', t: 0, notch: 0, lapped: false,
        };
        this.bloomBoost = 0;
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
        this.parts.sea = createSea(u, {
            trains: q.seaTrains, clouds: q.seaClouds, swash: q.swash, mirrorScale: q.mirrorScale,
        });
        this.reflection = this.parts.sea.userData.reflection ?? null;
        if (this.reflection) this.root.add(this.reflection.target);
        this.parts.wheel = createWheel(u, { mirrorLayer: MIRROR_LAYER });
        this.parts.pier = createPier(u, { mirrorLayer: MIRROR_LAYER });
        this.parts.coaster = createCoaster(u, { mirrorLayer: MIRROR_LAYER });
        this.parts.promenade = createPromenade(u, { rand, mirrorLayer: MIRROR_LAYER });
        this.parts.palms = createPalms(u, { rand, count: q.palms });
        this.fireworks = new Fireworks(u, { capacity: q.fireworks, rand, mirrorLayer: MIRROR_LAYER });
        this.parts.fireworks = this.fireworks.mesh;
        this.track = this.parts.coaster.userData;
        this.coaster.t = this.track.marks.station;
        for (const part of Object.values(this.parts)) {
            if (part) this.root.add(part);
        }
        this.scene.add(this.root);
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
     * Set the evening (0..1) at once. The sun sinks from its rest height on the sea to below the
     * horizon (SUN.lift → SUN.setLift, in disc radii); the sky's colours follow `u.dusk`.
     */
    setDusk(value, { hold = false } = {}) {
        const dusk = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
        this.dusk = dusk;
        this.duskTarget = dusk;
        this.duskBase = dusk;
        if (hold) this.duskHeld = true;
        this.applyDusk();
    }

    applyDusk() {
        const { dusk } = this;
        this.u.dusk.value = dusk;
        const lift = SUN.lift + (SUN.setLift - SUN.lift) * dusk ** 1.15;
        const elev = SUN.radius * lift;
        this.sunDir.set(0, Math.sin(elev), -Math.cos(elev));
        this.sunUp.set(0, Math.cos(elev), Math.sin(elev));
        this.u.sunDir.value.copy(this.sunDir);
        this.u.sunUp.value.copy(this.sunUp);
        this.u.sunRight.value.copy(this.sunRight);
        this.u.sunAz.value.set(this.sunDir.x, this.sunDir.z).normalize();
        // The pier lights come on from the land end as the evening deepens; the town too.
        this.u.pierPower.value = THREE.MathUtils.clamp(0.42 + dusk * 0.85, 0, 1);
        this.u.wheelGlow.value = 0.85 + dusk * 0.5;
        this.u.pierGlow.value = 0.85 + dusk * 0.5;
        this.u.townLights.value = 0.5 + dusk * 0.5;
    }

    /** Mark the game as being played (any gameplay event). */
    notePlay() {
        this.lastPlayed = this.time;
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

        // The wheel turns on the clock (a seek lands right); reduced motion slows it to a crawl.
        this.wheelLag = (this.wheelLag ?? 0) + dt * (1 - motion) * 0.85;
        u.wheelAngle.value = ((t - this.wheelLag) * (Math.PI * 2)) / WHEEL.period;
        u.wheelNeonMix.value += (this.neonTarget - u.wheelNeonMix.value) * approach(0.8, dt);

        // The evening deepens while a game is being played, and eases toward its target.
        if (!this.duskHeld) {
            if (t - this.lastPlayed < DUSK.activeFor) this.duskTarget = Math.min(1, this.duskTarget + dt / DUSK.fullAfter);
            this.dusk += (this.duskTarget - this.dusk) * approach(0.6, dt);
            this.applyDusk();
        }

        this.updateCoaster(dt, motion);

        // Fireworks: bursts arriving, the sky glows round them (held back under Reduce flashing).
        this.fireworks.update(t);
        const calm = prefersReducedFlashing();
        u.fireworkCalm.value = calm ? 1 : 0;
        u.fireworkLevel.value = calm ? 0.6 : 1;
        this.fireworks.writeGlows(t, flashScale());
        this.bloomBoost = Math.max(u.burst0.value.w, u.burst1.value.w) * 0.6;

        // Shooting stars, now and then.
        if (this.q.shooting && t >= this.nextAmbientShoot && !prefersReducedMotion()) {
            this.spawnShootingStar(0.7);
            this.nextAmbientShoot = t + 22 + this.rand() * 30;
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
     * The coaster: on the lift it climbs to the notch its chain has earned; released, a tyre
     * drive takes it over the crest and it rides the circuit on its own speed (energy from the
     * crest's height), brakes on the return and rolls into the station, having gone once round.
     */
    updateCoaster(dt, motion) {
        const c = this.coaster;
        const { curve, marks } = this.track;
        if (!curve || !marks) return;
        const length = curve.getLength();
        const pace = 0.5 + 0.5 * motion;
        const notchT = marks.liftFoot + (marks.liftTop - marks.liftFoot) * (Math.min(c.notch, 8) / 8);
        if (c.mode === 'lift' || c.mode === 'idle') {
            const target = c.mode === 'lift' ? notchT : marks.station;
            const step = (3.2 * pace * dt) / length;
            c.t += THREE.MathUtils.clamp(target - c.t, -step, step);
            this.u.coasterRide.value *= Math.exp(-dt * 1.5);
        } else if (c.mode === 'ride') {
            let v;
            if (!c.lapped && c.t < marks.liftTop) {
                v = 5 * pace; // the tyre drive up to the crest
            } else {
                const crest = curve.getPointAt(marks.liftTop).y;
                const h = curve.getPointAt(c.t).y;
                v = Math.sqrt(Math.max(0, 2 * 9.81 * (crest - h)) + 9) * pace;
                // The brakes on the return, then a slow roll round the last turn into the station.
                if (c.lapped || c.t >= marks.returnStart) v = Math.min(v, 8 * pace);
                if (c.lapped) v = Math.min(v, 3.5 * pace);
            }
            c.t += (v * dt) / length;
            if (c.t >= 1) {
                c.t -= 1;
                c.lapped = true;
            }
            this.u.coasterRide.value = Math.min(1, v / 18);
            if (c.lapped && c.t >= marks.station) {
                c.t = marks.station;
                c.mode = 'idle';
                c.lapped = false;
            }
        }
        this.u.coasterMeter.value = c.mode === 'lift' ? c.t : 0;
        this.u.coasterTrain.value = c.t;
        this.track.placeTrain(c.t);
    }

    /**
     * Seek (deterministic captures): no events in flight, the train at the station, the evening
     * back where it was set (a capture replays its events on every frame).
     */
    seek(time) {
        this.time = time;
        this.u.time.value = time;
        this.lastPlayed = -1e6;
        this.dusk = this.duskBase;
        this.duskTarget = this.duskBase;
        this.applyDusk();
        this.chases.forEach((ch, i) => {
            ch.t0 = -1e6;
            this.u[`chase${i}`].value.x = -1e6;
        });
        this.coaster.mode = 'idle';
        this.coaster.t = this.track?.marks?.station ?? 0;
        this.coaster.notch = 0;
        this.coaster.lapped = false;
        this.u.coasterMeter.value = 0;
        this.u.coasterRide.value = 0;
        this.shoots.forEach((s) => { s.t0 = -1e6; });
        this.nextAmbientShoot = time + 12 + this.rand() * 18;
        this.fireworks?.clear();
        this.track?.placeTrain?.(this.coaster.t);
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * A piece locked: two bands of its colour run round the wheel's rims from its column's side
     * (left columns start left of the bottom, right columns right of it) and meet at the top.
     */
    onPieceLock(piece) {
        this.notePlay();
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
        const start = -Math.PI / 2 + ((column - 4.5) / 4.5) * 0.7;
        const slot = this.chaseCursor;
        this.chaseCursor = (slot + 1) % CHASE_SLOTS;
        this.chases[slot].t0 = this.time;
        this.u[`chase${slot}`].value.set(this.time, start, 0, 0);
        this.u[`chaseCol${slot}`].value.copy(color);
    }

    /** Lines cleared: one shell per line, the first in the locking piece's colour; four, a finale. */
    onLineClear(lines = 1) {
        this.notePlay();
        const n = Math.max(1, Math.min(4, lines | 0));
        const t = this.time;
        const fw = this.fireworks;
        const r = this.rand;
        const reduced = (this.motion ?? 1) < 0.5;
        const stars = Math.round(this.q.stars0 * (reduced ? 0.6 : 1));
        const pick = () => new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]);
        if (n < 4) {
            const kinds = ['peony', 'ring', 'chrys'];
            for (let k = 0; k < n; k += 1) {
                fw.launch(t, {
                    color: k === 0 ? this.lastLockColor : pick(), kind: kinds[k % 3], scale: 0.85 + n * 0.08, delay: k * 0.32, stars,
                });
            }
            this.duskTarget = Math.min(1, this.duskTarget + 0.004 * n);
            return;
        }
        // The finale: a volley over a second and a half, a gold willow to close.
        const shells = reduced ? Math.min(3, this.q.finale) : this.q.finale;
        const kinds = ['chrys', 'peony', 'ring', 'peony', 'chrys', 'ring', 'peony', 'chrys'];
        for (let k = 0; k < shells; k += 1) {
            fw.launch(t, {
                color: k === 0 ? this.lastLockColor : pick(), kind: kinds[k], scale: 1.05 + r() * 0.2, delay: k * 0.24, stars,
            });
        }
        fw.launch(t, {
            kind: 'willow', scale: 1.3, delay: shells * 0.24 + 0.2, stars: Math.round(stars * 1.3),
        });
        this.duskTarget = Math.min(1, this.duskTarget + 0.02);
    }

    /**
     * The true combo (consecutive clearing locks; 0 when the chain broke). Each link lifts the
     * train a notch; a chain of three or more that breaks sends it once round the circuit.
     */
    onChain(count) {
        this.notePlay();
        const c = this.coaster;
        const n = Math.max(0, count | 0);
        if (n > 0) {
            if (c.mode === 'ride') return;
            c.mode = 'lift';
            c.notch = n;
            return;
        }
        if (c.mode !== 'lift') return;
        c.mode = c.notch >= 3 ? 'ride' : 'idle';
        c.notch = 0;
    }

    /** Cascade depth (bus COMBO): the gravity waves already fire their own shells. */
    onCombo() {
        this.notePlay();
    }

    /** A level: the evening steps on, the neon ring turns, two shells go up. */
    onLevelUp() {
        this.notePlay();
        this.duskTarget = Math.min(1, this.duskTarget + DUSK.levelStep);
        this.neonTarget = this.neonTarget > 0.5 ? 0 : 1;
        const t = this.time;
        this.fireworks.launch(t, {
            kind: 'ring', color: new THREE.Color(FIREWORK_COLORS[1]), scale: 1.1, stars: this.q.stars0,
        });
        this.fireworks.launch(t, {
            kind: 'peony', color: new THREE.Color(FIREWORK_COLORS[0]), scale: 1.1, delay: 0.3, stars: this.q.stars0,
        });
    }

    /** A streak across the upper sky, in (azimuth, elevation) space around the current view. */
    spawnShootingStar(intensity = 1) {
        if (!this.q.shooting) return;
        const s = this.shoots[this.shootCursor];
        const slot = this.shootCursor;
        this.shootCursor = (this.shootCursor + 1) % this.shoots.length;
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
    }

    /** Hide everything but the named parts (see SYNTHWAVE_PARTS) — iteration aid. */
    showOnlyParts(names) {
        const keep = new Set(names);
        for (const [name, part] of Object.entries(this.parts)) {
            if (part) part.visible = keep.has(name);
        }
    }

    dispose() {
        this.root.removeFromParent();
        this.reflection?.dispose?.();
        this._camera?.layers?.disable?.(MIRROR_LAYER);
        this.reflection = null;
        for (const part of Object.values(this.parts)) {
            part?.traverse((object) => {
                object.geometry?.dispose();
                object.material?.dispose();
            });
        }
        this.fireworks = null;
        this.parts = {};
    }
}
