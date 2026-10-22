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
 *
 * Play builds the light instead of restarting it (src/themes/shared/gameplay-surge.js). Every
 * event's light is a Swell that adds to what is still lit; the light waves are a procession of
 * RING_SLOTS bands, a new one taking the slot with the least light left. The heat of play goes
 * into the world's own light, locally, never into the air: as play warms, the flight quickens
 * and the sun's fan of beams sharpens; hot, the towers' crowns catch fire and the glare path on
 * the deck turns molten; in a fever the air clears (the frame-wide glow gives way), the beams
 * blaze in a turning gold crown and the camera skims low and fast over the heads. A perfect
 * clear lights every tower crown at once and sends a great wave rolling OUT to the horizon: the
 * world exhales.
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
import { SEA_SHADOW_TAPS, createCloudSea } from './nimbus-veil-cloudsea.js';
import { createCumulus } from './nimbus-veil-cumulus.js';
import { NimbusFx } from './nimbus-veil-fx.js';
import { applyCameraBreath, easedMotion } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

/** Per-tier content. Every tier keeps the composition; tiers trade detail, not layout. */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        rings: 90, segments: 100, towers: 3, billows: 22, motes: 0, sparkles: 120, veils: 0, cirrus: false,
    },
    Low: {
        rings: 120, segments: 130, towers: 4, billows: 28, motes: 40, sparkles: 200, veils: 1, cirrus: true,
    },
    Medium: {
        rings: 150, segments: 150, towers: 5, billows: 34, motes: 80, sparkles: 300, veils: 1, cirrus: true,
    },
    High: {
        rings: 180, segments: 180, towers: 7, billows: 44, motes: 120, sparkles: 450, veils: 2, cirrus: true,
    },
    Ultra: {
        rings: 200, segments: 200, towers: 7, billows: 50, motes: 160, sparkles: 600, veils: 2, cirrus: true,
    },
    Extreme: {
        rings: 220, segments: 220, towers: 7, billows: 56, motes: 200, sparkles: 800, veils: 2, cirrus: true,
    },
});

/**
 * Per-tier cloud-sea and sky detail: self-shadow taps toward the sun, the cauliflower and finest
 * octaves in the deck's light, and the distant cumulus banks on the horizon.
 */
export const SEA_DETAIL = Object.freeze({
    Minimal: {
        seaShadow: 'none', cauliflower: false, fine: false, banks: false,
    },
    Low: {
        seaShadow: 'one', cauliflower: true, fine: false, banks: true,
    },
    Medium: {
        seaShadow: 'two', cauliflower: true, fine: false, banks: true,
    },
    High: {
        seaShadow: 'four', cauliflower: true, fine: true, banks: true,
    },
    Ultra: {
        seaShadow: 'four', cauliflower: true, fine: true, banks: true,
    },
    Extreme: {
        seaShadow: 'four', cauliflower: true, fine: true, banks: true,
    },
});

const GLINT_COLORS = [0xfff1c9, 0xffd88f, 0xffc2a8, 0xf3dcff, 0xffffff].map((h) => new THREE.Color(h));

/** Camera-space depth the combo burst floats at: past the near veil, well before the towers. */
const BURST_DEPTH = 60;

/** Where a light wave starts (distance from the camera): beyond the farthest tower. */
const RING_START = 1100;

/**
 * Light-wave slots: enough for a procession (a clear every ~0.6 s with each wave ~3 s long, or a
 * cascade's waves 0.36 s apart) to show every band at once. The cloud sea and the towers each
 * read them all (one exp per slot).
 */
export const RING_SLOTS = 6;

/** Seconds after a lock with no clear before the chain it carried counts as ended. */
const CHAIN_GRACE = 0.25;

/** How a light wave travels: in from beyond the towers, in and halting mid-deck, or out. */
const RING_IN = 0;
const RING_HOLD = 1;
const RING_OUT = 2;

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
        env = Math.min(1, age / 0.25) * (1 - smooth01(dur - 0.5, dur + 0.2, age));
    }
    o.radius = radius;
    o.invWidth = 1 / ((5 + radius * 0.06) * ring.widthK);
    o.energy = ring.energy * env;
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
        /** Light waves: (radius, 1/width, energy, heat 0..1: gold → molten amber). */
        rings: Array.from({ length: RING_SLOTS }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
        /**
         * The heat of play spent locally: x the sun's fan of beams (contrast, reach, gold), y the
         * towers' burning crowns and rims, z the molten glare path on the deck, w every tower
         * crown lit at once (perfect clear, back-to-back).
         */
        blaze: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The turn of the sun's fan of beams (a T-spin turns it; a fever turns it slowly). */
        beamTurn: uniform(0),
        /** The flight clock: the veils and motes drift on it; it runs faster as play heats. */
        flight: uniform(0),
        /** The motes' brightness (1 at rest). */
        moteGlow: uniform(1),
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

        /**
         * The air's glow (sky, haze, the sun's aureole) and the deck's warmth: frame-wide, so
         * they stay low (a single reads as it always has; a frenzy never washes the frame) and
         * Reduce flashing holds them back (ADR-0021). Every hit adds to what is still lit.
         */
        this.glow = new Swell({ release: 1.0, ceiling: 0.45, knee: 0.3 });
        this.warmth = new Swell({ release: 1.25, ceiling: 0.6, knee: 0.35 });
        /** The sun's flare (a quad, a T-spin, a perfect clear): its beams and the towers' rims. */
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
        /** How fast a T-spin turns the sun's fan of beams (rad/s). */
        this.spin = new Swell({ release: 0.7, ceiling: 1.6, knee: 1 });
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
        this.flight = 0;
        this.seaLead = 0;
        this.beamTurn = 0;
        this.hardDropPending = false;
        /** A chain that ends unless the lock just made clears something (see onPieceLock). */
        this.chainWatch = 0;
        this.chainWatchAt = -1e6;
        this.b2bStreak = 0;
        this.b2bAt = -1e6;
        this._post = { bloomBoost: 0, rays: 1, exposure: 1 };

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
        this.parts.sky = createSky(u, { cirrus: q.cirrus, banks: detail.banks });
        this.parts.sea = createCloudSea(u, {
            rings: q.rings,
            segments: q.segments,
            shadowTaps: SEA_SHADOW_TAPS[detail.seaShadow],
            cauliflower: detail.cauliflower,
            fine: detail.fine,
            towers: q.towers,
        });
        this.parts.cumulus = createCumulus(u, { rand, towers: q.towers, billowsPerTower: q.billows });
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
        u.moteGlow.value = 1 + level * 0.7 + fever * 0.9;

        // Light waves: a procession of bands rolling in over the deck, past the towers (which
        // light as each goes through them).
        const ringOut = this._ring;
        this.rings.forEach((ring, i) => {
            const s = ringState(ring, t - ring.t0, ringOut);
            u.rings[i].value.set(s.radius, s.invWidth, s.energy, ring.heat);
        });

        // The post: rays toward the sun lengthen with the beams; the iris closes a little as
        // play heats, so the colours stay saturated and the deep sky stays deep.
        const post = this._post;
        post.bloomBoost = Math.min(1, this.sunPulse * 0.9 + flare * fs * 0.25 + fever * 0.15);
        post.rays = 1 + u.blaze.value.x * 0.55;
        post.exposure = 1 - Math.max(0, level - 0.2) * 0.1 - fever * 0.08;
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

    /** What the post stack reads this frame (bloom boost, rays, exposure). */
    postState() {
        return this._post;
    }

    seek(time) {
        this.time = time;
        this.sunPulse = 0;
        this.seaGlow = 0;
        for (const swell of [this.glow, this.warmth, this.flare, this.crownLight, this.dip, this.spin]) swell.reset();
        this.surge.reset();
        this.heatAt = Number.NaN;
        this.rings.forEach((r) => { r.t0 = -1e6; r.energy = 0; });
        this.flight = time;
        this.seaLead = 0;
        this.beamTurn = 0;
        this.hardDropPending = false;
        this.chainWatch = 0;
        this.b2bStreak = 0;
        this.b2bAt = -1e6;
        this.fx?.clear();
    }

    // ── Events ───────────────────────────────────────────────────────────────
    // Each adds to what is lit; none restarts it. `at` is the world clock of the last frame.

    /** Same tick as, and just before, the PIECE_LOCK of the same piece. */
    onHardDrop() {
        this.hardDropPending = true;
    }

    /**
     * A piece locked. `chain` is the true combo it carries in (ComboTracker): when it is a chain
     * of two or more and no clear follows within CHAIN_GRACE, the chain has ended (see update()).
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
        // A few glints lift off the heads; more the quicker the hand.
        const glints = Math.round((hard ? 3 : 1) + 7 * this.heat.level);
        if (glints > 0) this.emitRisingSparkles(glints);
    }

    /**
     * A wave of a line clear. `cascade` is the wave's depth (1 = the lock's own clear), `combo`
     * the true consecutive-clear combo (ComboTracker), `chainStep` true on the wave that
     * advanced it. Each cascade wave builds on the last: brighter, wider, faster, hotter.
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
        this.triggerRing({
            energy: (0.45 + 0.18 * n) * (1 + 0.3 * deep) * (1 + 0.05 * steps),
            dur: 3 / (1 + 0.12 * deep),
            widthK: (1 + 0.15 * deep + 0.04 * steps) / (1 + 1.1 * level + 0.6 * fever),
            heat: Math.min(1, 0.2 * deep + 0.07 * steps + 0.5 * fever + 0.3 * level),
        });
        this.glow.hit(0.15 * n, at);
        this.warmth.hit(0.25 * n, at);
        this.emitRisingSparkles(this.burstCount(0.06 * n + 0.01 * deep, 24 * n + 8 * deep));
        // A chain's every new step sheds glints from the sun, more the longer it runs.
        if (chainStep && chain >= 3) {
            this.emitHeavenlyBurst(this.burstCount(0.03 + 0.012 * steps, 24 + 8 * steps));
        }
        if (n >= 4) {
            this.glow.hit(0.2, at);
            this.flare.hit(0.8, at);
            this.crownLight.hit(0.3, at);
            this.emitHeavenlyBurst(this.burstCount(0.45, 220));
        }
    }

    /** COMBO: the CASCADE depth of one lock (ADR-0011), from its second wave. */
    onCombo(count = 1) {
        const c = Math.max(0, count | 0);
        const at = this.time;
        this.glow.hit(0.12, at);
        this.warmth.hit(0.2, at);
        // Each wave flares the sun a little more than the last.
        this.flare.hit(0.06 + 0.05 * Math.min(c, 10), at);
        if (c >= 2) this.emitHeavenlyBurst(this.burstCount(0.08 + c * 0.04, 40 + 20 * c));
    }

    /** A T-spin turns the sun's fan of beams; one that cleared nothing turns it a little. */
    onTSpin(lines = 0) {
        const at = this.time;
        const cleared = (lines | 0) > 0;
        if (cleared) this.surge.tspin(at);
        else this.surge.spin(at);
        this.spin.hit(cleared ? 0.9 : 0.45, at);
        this.flare.hit(cleared ? 0.5 : 0.18, at);
        this.emitHeavenlyBurst(this.burstCount(cleared ? 0.08 : 0.03, cleared ? 70 : 24));
    }

    /**
     * Back-to-back: a gold tide line rolls in fast and halts mid-deck, lingering, and the
     * towers' crowns light. Each B2B in a streak sets its line nearer and brighter.
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
        this.crownLight.hit(0.3 + 0.1 * k, at);
        this.flare.hit(0.2, at);
    }

    /**
     * A perfect clear settles ~360 ms after its clear's last wave: the crown on that clear,
     * layered on its light, never a new clear. Every tower crown lights at once and a great
     * wave rolls OUT from under the camera to the horizon: the release.
     */
    onPerfectClear() {
        const at = this.time;
        this.surge.crown(at);
        this.crownLight.hit(1.0, at);
        this.flare.hit(0.5, at);
        this.triggerRing({
            mode: RING_OUT, dur: 3.4, energy: 0.9, widthK: 0.9, heat: 0.85,
        });
        this.emitHeavenlyBurst(this.burstCount(0.5, 260));
    }

    /** A chain of clears ended (a lock that cleared nothing): the world breathes out. */
    onChainEnd(chain = 2) {
        const steps = Math.min(9, Math.max(1, chain | 0) - 1);
        this.triggerRing({
            mode: RING_OUT, dur: 3.8, energy: 0.35 + 0.05 * steps, widthK: 1.3, heat: 0.1,
        });
        this.emitRisingSparkles(this.burstCount(0.04 + 0.01 * steps, 20 + 6 * steps));
    }

    onLevelUp() {
        const at = this.time;
        this.surge.levelUp(at);
        this.glow.hit(0.4, at);
        this.warmth.hit(0.5, at);
        this.crownLight.hit(0.25, at);
        this.triggerRing({ energy: 1.0, heat: 0.3 });
        this.emitHeavenlyBurst(this.burstCount(0.4, 180));
    }

    /**
     * Start a light wave in the slot with the least light left (a finished one first), so a
     * wave still crossing the deck is never pulled back to the horizon while a weaker one waits.
     */
    triggerRing({
        energy, dur = 3, widthK = 1, heat = 0, mode = RING_IN, hold = 0, linger = 1,
    }) {
        const t = this.time;
        let slot = 0;
        let least = Infinity;
        this.rings.forEach((ring, i) => {
            const age = t - ring.t0;
            const s = ringState(ring, age, this._ring);
            // What it still has to show: its light now, weighted by the life it has left.
            const left = s.energy > 0 ? s.energy * (1 + Math.max(0, ring.dur - age)) : 0;
            if (left < least) {
                least = left;
                slot = i;
            }
        });
        Object.assign(this.rings[slot], {
            t0: t, energy, dur, widthK, heat, mode, hold, linger,
        });
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
