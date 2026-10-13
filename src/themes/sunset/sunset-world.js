/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the lantern sea: the world.
 *
 * The eye floats a little above an open sea, and the whole day turns in front of it: the sun
 * comes up out of the sea right of the card, climbs out of the top of the picture, comes back in
 * at the top left and sets into the water left of the card; the moon comes up on the right as
 * the sun sets, rides over the picture in the night and comes down on the left before dawn.
 * Over the eye a deck of cloud runs in toward the place the sky goes down, lit from beneath while
 * a body is on the horizon. Everything is built here and shared with the playground effect
 * (src/playground/effects/sunset.effect.js), so what is iterated there ships.
 *
 * Parts (showOnlyParts names): sky, sea, lanterns, glows, birds.
 *
 * What the board does to it:
 *   lock        a light of the piece's colour leaves the card's edge at the piece's height and
 *               comes down to the sea beside the card (lower pieces nearer, higher pieces further
 *               out), where it becomes a paper lantern afloat in that colour; a ring runs out
 *               from it and the water mirrors it on a streak of its own light.
 *   hard drop   the lantern is set down hard: a splash of drops in its light, a wider ring.
 *   clear       for every line the oldest lantern on the water lifts off, and the evening wind
 *               carries it away toward the place the sun goes down; a 22-degree halo blooms
 *               round the sun (the moon at night) and the sun's road on the sea flares.
 *   T-spin      the lanterns that lift go up turning round where they rose.
 *   four lines  every lantern on the water lifts at once, the sky fires, and the sun, if it is
 *               low, shows the green flash.
 *   perfect     the same, and the sky stays on fire a while.
 *   combo       a chain sets the sky on fire: the clouds burn brighter and further across the
 *               sky with every clear held, the sea's road with them; from three a flock crosses
 *               the light, from five it is a great one.
 *   level up    the day runs on an eighth of itself: the sun, the moon and the stars are seen
 *               to run across the sky.
 *
 * And the clock turns the same day by itself (sunset-hours.js: one day in DAY_SECONDS, lingering
 * at dawn and dusk), in every mode, the ones that never level included.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    DEG, EYE_HEIGHT, approach, azElDirection, clamp01, discSquash, lerp, mulberry32, pieceLight, seaHeight, smooth,
} from './sunset-core.js';
import { tierFor } from './sunset-quality.js';
import {
    REST_RIG, aimLanding, aimLeave, boardFor, boardPoint, cardFor, fallbackLayout, fovForAspect, frameFor,
} from './sunset-composition.js';
import {
    HOUR_COLOURS, LEVEL_SECONDS, MOON_LAG, MOON_PEAK, STATIONS, SUN_PEAK, arcAt, dayHourAt, hourAngle, levelOffset,
    lightAt, turnSeconds,
} from './sunset-hours.js';
import {
    TUNE, createLight, createSeaNoise, createSkyNoise, tune,
} from './sunset-tsl.js';
import { createSky } from './sunset-sky.js';
import { createSea } from './sunset-sea.js';
import { LanternPool, MOTE_SECONDS, moteAt } from './sunset-lantern-pool.js';
import { createGlows, createLanterns } from './sunset-lanterns.js';
import { createFlock } from './sunset-birds.js';

export { REST_RIG, fovForAspect };

/** The parts a capture can show alone. */
export const SUNSET_PARTS = Object.freeze(['sky', 'sea', 'lanterns', 'glows', 'birds']);

/** The sun's and the moon's angular radius (degrees): larger than life, as a long lens sees them. */
export const SUN_RADIUS = 1.45;
export const MOON_RADIUS = 1.2;

/** Seconds a ring stays on the water. */
const RING_LIFE = 7;
/** A clear's halo: how long it takes to run out to its place, its radius (degrees), how long it lasts. */
const HALO_RISE = 1.1;
const HALO_RADIUS = 22;
const HALO_LIFE = 4.2;
/** A splash's drops fall back within this long. */
const DROP_LIFE = 0.9;
/** The trail a light leaves in flight: points, and seconds between them. */
const MOTE_TRAIL = 16;
const MOTE_STEP = 0.009;

/** How far a chain of `combo` clears sets the sky on fire (0..1). */
export function fireForCombo(combo) {
    return combo > 1 ? 1 - Math.exp(-(combo - 1) * 0.32) : 0;
}

/** How many birds a chain calls: none below three clears. */
export function birdsForCombo(combo, most) {
    if (combo < 3) return 0;
    return Math.min(most, 5 + (combo - 3) * 4);
}

const tmpRay = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpSun = new THREE.Vector3();
const tmpKey = new THREE.Vector3();

export class SunsetWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]   built for a deterministic capture (reported in getState)
     * @param {number} [p.seed]
     * @param {number} [p.hour]   hold the day at this hour (0..24: 6 sunrise, 12 noon, 18 sunset,
     *                            18.4 afterglow, 0 midnight)
     * @param {object} [p.tune]   overrides for TUNE (the playground's P.<name>=)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 29, hour = null, tune: overrides = null,
    }) {
        tune(overrides);
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.seed = seed;
        this.rand = mulberry32(seed);
        this.group = new THREE.Group();
        this.group.name = 'sunset-world';
        this.parts = {};
        this.camera = null;
        this.aspect = 16 / 9;
        this.viewport = { w: 1920, h: 1080 };
        this.layout = null;
        this.reducedMotion = false;
        /** The frame's time (the camera sways on it) and the world's own clock. */
        this.time = 0;
        this.clock = 0;
        /** Where the horizon is for this frame shape, and where the sky sets and rises. */
        this.frame = frameFor(this.aspect, null);
        this.setAz = this.frame.setAz;
        this.riseAz = this.frame.riseAz;
        this.pitch = this.frame.pitch;
        /**
         * How far the levels have carried the day on (seconds of the timetable; see
         * sunset-hours.js): eased from `from` to `to` over `seconds` from `at`.
         */
        this.day = {
            from: 0, to: 0, at: -100, seconds: 1, pin: Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : null,
        };
        this.light = lightAt(12);
        /** Where the sun and the moon stand: { az, el } in degrees. */
        this.sunArc = { az: 0, el: 0 };
        this.moonArc = { az: 0, el: 0 };
        this.lightRows = HOUR_COLOURS.map(() => new THREE.Vector4(0, 0, 0, 0));
        this.U = {
            time: uniform(0),
            light: createLight(uniformArray(this.lightRows, 'vec4')),
            sun: uniform(new THREE.Vector3(0, 0.1, -1)),
            sunRight: uniform(new THREE.Vector3(1, 0, 0)),
            sunTop: uniform(new THREE.Vector3(0, 1, 0)),
            sunSize: uniform(Math.sin(SUN_RADIUS * DEG)),
            sunSquash: uniform(1),
            sunLow: uniform(0),
            sunPower: uniform(20),
            /** 0..1: how much of the sun's disc stands over the sea. */
            sunUp: uniform(1),
            moon: uniform(new THREE.Vector3(0, -0.5, -1)),
            moonRight: uniform(new THREE.Vector3(1, 0, 0)),
            moonTop: uniform(new THREE.Vector3(0, 1, 0)),
            moonSize: uniform(Math.sin(MOON_RADIUS * DEG)),
            moonSquash: uniform(1),
            moonPower: uniform(1.7),
            moonUp: uniform(0),
            /** How far the moon's face is turned as it crosses the sky (radians). */
            moonTilt: uniform(0),
            /** 0: the sun lights the clouds; 1: the moon does. */
            moonKey: uniform(0),
            stars: uniform(0),
            /** How far the night sky has turned round its pole with the hours (radians). */
            starTurn: uniform(0),
            cover: uniform(0.5),
            /** 0: clouds lit from above (day); 1: from beneath (the sun on the horizon). */
            fire: uniform(0.5),
            /** 0..1: a chain or a clear sets the sky on fire. */
            skyFire: uniform(0),
            /** The key light's way across the deck, in the deck's noise coordinates. */
            keyFlat: uniform(new THREE.Vector2(1, 0)),
            /** The cloud streets run toward this (xz, unit), and how far the deck has drifted. */
            street: uniform(new THREE.Vector2(0, -1)),
            drift: uniform(new THREE.Vector2(0, 0)),
            /** A clear's halo: (cosine of its radius, its width as a cosine, its strength), and its centre. */
            pulse: uniform(new THREE.Vector3(1, 0.02, 0)),
            pulseDir: uniform(new THREE.Vector3(0, 0, -1)),
            /** The green flash (0..1). */
            green: uniform(0),
            /** A clear flares the sun (0 at rest). */
            flare: uniform(0),
            /** The sun's road flares (0 at rest). */
            glint: uniform(0),
            /** Radians a pixel spans (the sea and the glows size themselves by it). */
            pixelAngle: uniform(0.0008),
            /** x: live rings, z: lanterns the water mirrors. */
            counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        };

        this.ringRows = Array.from({ length: this.tier.rings * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.lampRows = Array.from({ length: this.tier.lit * 2 }, () => new THREE.Vector4(0, 0, 0, 0));
        this.rows = {
            rings: uniformArray(this.ringRows, 'vec4'),
            lamps: uniformArray(this.lampRows, 'vec4'),
        };
        this.ringCount = 0;

        this.pool = new LanternPool({ capacity: this.tier.lanterns, seed: seed + 3 });
        /** Splash drops: [x, y, z, vx, vy, vz, born, r, g, b] each, in a ring buffer. */
        this.drops = new Float32Array(this.tier.drops * 10).fill(-100);
        this.dropCursor = 0;

        this.state = {
            combo: 0,
            level: 1,
            fire: 0,
            fireKick: 0,
            glint: 0,
            flare: 0,
            flash: 0,
            green: 0,
            greenAge: 10,
            pulseAt: -100,
            pulseStrength: 0,
            flockAt: -100,
            flockSize: 0,
            pitch: null,
            locks: 0,
            clears: 0,
            lifted: 0,
            flocks: 0,
        };
        this.sunScreen = { x: 0.25, y: 0.5, visible: 0 };
        this._point = { x: 0.5, y: 0.5 };
        this._landing = { x: 0.5, y: 0.9 };
        this._leave = { x: 0.5, y: 0.5 };
        this._lantern = {};
        this._mote = { x: 0, y: 0, z: 0 };
        this._to = { x: 0, y: 0, z: 0 };
        this._lamps = [];
        this._lifted = [];
        this._jitter = [0, 0];
        this.applyHour();
    }

    build() {
        const { tier, U } = this;
        this.skyNoise = createSkyNoise(tier.skyNoise);
        const sea = createSeaNoise(tier.seaNoise);
        this.seaNoise = sea.map;
        this.parts.sky = createSky({ tier, noise: this.skyNoise, U });
        this.parts.sea = createSea({
            tier, U, skyNoise: this.skyNoise, seaNoise: this.seaNoise, seaVariance: sea.variance, rows: this.rows,
        });
        this.parts.lanterns = createLanterns({ capacity: tier.lanterns, U });
        const glowCapacity = tier.lanterns + tier.motes * MOTE_TRAIL + tier.drops;
        this.parts.glows = createGlows({ capacity: glowCapacity, U });
        this.parts.birds = createFlock({ count: tier.birds, U, seed: this.seed });
        Object.values(this.parts).forEach((part) => this.group.add(part.mesh));
        this.scene.add(this.group);
        return this;
    }

    bindCamera(camera) {
        this.camera = camera;
        camera.near = REST_RIG.near;
        camera.far = REST_RIG.far;
        camera.fov = fovForAspect(this.aspect);
        camera.updateProjectionMatrix();
        this.updateCamera(camera, {
            time: this.time, delta: 0, pointerX: 0, pointerY: 0,
        });
    }

    /** Drawing-buffer size (pixels) and the CSS aspect. */
    setViewport(bufferWidth, bufferHeight, aspect) {
        this.viewport.w = Math.max(1, bufferWidth);
        this.viewport.h = Math.max(1, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        const fov = fovForAspect(this.aspect);
        this.U.pixelAngle.value = (2 * Math.tan((fov * DEG) / 2)) / this.viewport.h;
        if (this.camera) {
            this.camera.fov = fov;
            this.camera.aspect = this.aspect;
            this.camera.updateProjectionMatrix();
        }
        frameFor(this.aspect, this.layout, this.frame);
    }

    /** The live gameplay rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        frameFor(this.aspect, this.layout, this.frame);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Draw only the named parts (captures). */
    showOnlyParts(names) {
        const wanted = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = wanted.has(name);
        });
    }

    // ── time ────────────────────────────────────────────────────────────────────

    /** Put the world at `time` with nothing in flight, at the hour the clock alone gives. */
    seek(time) {
        this.time = Math.max(0, time);
        this.clock = this.time;
        this.resetSession();
        this.restoreDay(0);
        this.state.pitch = null;
        this.setAz = this.frame.setAz;
        this.riseAz = this.frame.riseAz;
        this.applyHour();
    }

    /**
     * A new run: no lantern, no chain, nothing in the air. The clock runs on, and with it the
     * day, from where the last run left it: nothing turns it back.
     */
    resetSession() {
        const s = this.state;
        s.combo = 0;
        s.level = 1;
        s.fire = 0;
        s.fireKick = 0;
        s.glint = 0;
        s.flare = 0;
        s.flash = 0;
        s.green = 0;
        s.pulseAt = -100;
        s.pulseStrength = 0;
        s.flockAt = -100;
        s.flockSize = 0;
        s.locks = 0;
        s.clears = 0;
        s.lifted = 0;
        s.flocks = 0;
        this.ringCount = 0;
        this.pool.reset();
        this.drops.fill(-100);
        this.dropCursor = 0;
        this.parts.birds?.reset();
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const s = this.state;
        const target = this.frame.pitch;
        if (s.pitch === null) s.pitch = target;
        else s.pitch += (target - s.pitch) * approach(1.2, sim.delta);
        const t = sim.time;
        const still = this.reducedMotion ? 0 : 1;
        // Afloat: the swell lifts the eye a little and rolls it a hair.
        const heave = still * seaHeight(0, -3, this.clock) * 0.35;
        const sway = still * (Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.13 + 1.3) * 0.4);
        const px = still * (sim.pointerX || 0);
        const py = still * (sim.pointerY || 0);
        const yaw = (sway * 0.45 + px * 1.6) * DEG;
        const pitch = (s.pitch + sway * 0.12 - py * 0.9) * DEG;
        camera.position.set(px * 0.18, EYE_HEIGHT + heave, 0);
        camera.up.set(Math.sin(sway * 0.004), 1, 0).normalize();
        tmpRay.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(camera.position.x + tmpRay.x, camera.position.y + tmpRay.y, camera.position.z + tmpRay.z);
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }

    /** A screen point (fractions, y down) → the world ray through it (unit). */
    screenRay(x, y, out = tmpRay) {
        const { camera } = this;
        return out.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    }

    /** Where a screen point's ray meets the still sea (clamped to `near`..`far` metres out). */
    castSea(x, y, near = 7, far = 160, out = this._to) {
        const { camera } = this;
        const ray = this.screenRay(x, y);
        const p = camera.position;
        let t = ray.y < -1e-4 ? -p.y / ray.y : far * 4;
        const flat = Math.hypot(ray.x, ray.z) * t;
        if (flat > far) t *= far / flat;
        if (flat < near) t *= near / Math.max(flat, 1e-3);
        out.x = p.x + ray.x * t;
        out.z = p.z + ray.z * t;
        out.y = 0;
        return out;
    }

    /**
     * The layout events aim at: the live one, else the stylesheet's solo layout for a window of
     * this shape (asked for a 1000 px tall window: its formulas are in CSS pixels).
     */
    aimLayout() {
        return this.layout || fallbackLayout(this.aspect * 1000, 1000);
    }

    // ── tables ──────────────────────────────────────────────────────────────────

    /** A piece's colour as the light its lantern burns with. */
    rgbOf(color) {
        return pieceLight(color, [1, 0.72, 0.36]);
    }

    /** A ring on the water at (x, z), born at `at` (it may be in the future). */
    addRing(x, z, at, strength, rgb, light) {
        const cap = this.ringRows.length / 2;
        if (this.ringCount >= cap) {
            for (let i = 2; i < this.ringCount * 2; i += 1) this.ringRows[i - 2].copy(this.ringRows[i]);
            this.ringCount -= 1;
        }
        const k = this.ringCount * 2;
        this.ringRows[k].set(x, z, at, strength);
        this.ringRows[k + 1].set(rgb[0], rgb[1], rgb[2], light);
        this.ringCount += 1;
    }

    /** A crown of `n` drops thrown up from (x, z) at `at`, in the light `rgb`. */
    splash(x, z, at, n, rgb) {
        const cap = this.drops.length / 10;
        for (let i = 0; i < n; i += 1) {
            const k = this.dropCursor * 10;
            this.dropCursor = (this.dropCursor + 1) % cap;
            const a = this.rand() * Math.PI * 2;
            const out = 0.5 + this.rand() * 1.1;
            this.drops[k] = x;
            this.drops[k + 1] = 0.05;
            this.drops[k + 2] = z;
            this.drops[k + 3] = Math.cos(a) * out;
            this.drops[k + 4] = 1.4 + this.rand() * 1.6;
            this.drops[k + 5] = Math.sin(a) * out;
            this.drops[k + 6] = at + this.rand() * 0.05;
            this.drops[k + 7] = lerp(rgb[0], 1, 0.35);
            this.drops[k + 8] = lerp(rgb[1], 0.9, 0.35);
            this.drops[k + 9] = lerp(rgb[2], 0.75, 0.35);
        }
    }

    /** A halo blooms round the sun (the moon by night). */
    sendPulse(strength) {
        const s = this.state;
        s.pulseAt = this.clock;
        s.pulseStrength = Math.max(strength, s.pulseStrength * Math.exp(-(this.clock - s.pulseAt)));
        this.U.pulseDir.value.copy(this.light.moonKey > 0.5 ? this.U.moon.value : this.U.sun.value);
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /** A piece locked: { player, rows, u, hardDrop, color, screen }. */
    onLock(c) {
        if (!this.camera) return;
        const s = this.state;
        s.locks += 1;
        const hard = c.hardDrop === true;
        const rgb = pieceLight(c.color, [1, 0.72, 0.36]);
        let landX = 0.25;
        let landY = 0.85;
        let leaveX = 0.5;
        let leaveY = 0.5;
        if (c.screen) {
            landX = c.screen.x;
            landY = Math.max(c.screen.y, this.frame.horizon + 0.06);
            leaveX = c.screen.x;
            leaveY = c.screen.y;
        } else {
            const layout = this.aimLayout();
            const board = boardFor(layout, c.player || 0);
            if (board) {
                const rows = c.rows?.length ? c.rows : [19];
                const row = rows[Math.floor(rows.length / 2)];
                const u = clamp01(c.u ?? 0.5);
                boardPoint(board, u, row, this._point);
                const card = cardFor(layout, board) || board;
                this._jitter[0] = this.rand() * 2 - 1;
                this._jitter[1] = this.rand() * 2 - 1;
                aimLanding(layout, card, this._point, u, row, this.frame.horizon, this._jitter, this._landing);
                aimLeave(card, this._point, this._landing, this._leave);
                landX = this._landing.x;
                landY = this._landing.y;
                leaveX = this._leave.x;
                leaveY = this._leave.y;
            }
        }
        const to = this.castSea(landX, landY);
        const ray = this.screenRay(leaveX, leaveY, tmpV);
        const p = this.camera.position;
        const from = { x: p.x + ray.x * 5.5, y: p.y + ray.y * 5.5, z: p.z + ray.z * 5.5 };
        const record = this.pool.send(this.clock, from, to.x, to.z, rgb, {
            hard,
            windAzimuth: this.setAz * DEG,
        });
        this.addRing(to.x, to.z, record.t0, hard ? 1.7 : 1, rgb, hard ? 1.6 : 1);
        if (hard) {
            this.splash(to.x, to.z, record.t0, Math.round(this.tier.drops / 14), rgb);
            s.flash = Math.max(s.flash, 0.06);
        }
    }

    /** Lines cleared: { player, rows, lines, combo, cascade, tspin, perfect, b2b, screen }. */
    onClear(c) {
        const s = this.state;
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
        // Lanterns go up: one a line, more in a chain, all of them for four lines.
        const chain = Math.min(3, Math.floor(Math.max(0, s.combo - 1) / 2));
        const count = big ? this.pool.capacity : lines + chain;
        const lifted = this._lifted;
        lifted.length = 0;
        const went = this.pool.lift(this.clock, count, {
            gap: big ? 0.16 : 0.32, spiral: c.tspin ? 1.25 : 0, out: lifted,
        });
        s.lifted += went;
        // Each leaves a ring where it rose from the water.
        for (let i = 0; i < lifted.length; i += 1) {
            const r = lifted[i];
            this.addRing(r.xr, r.zr, r.tr, 1.2, r.rgb, 0.8);
        }
        this.sendPulse(0.5 + lines * 0.18);
        s.glint = Math.min(2.5, s.glint + 0.6 + lines * 0.3);
        s.flare = Math.min(1.5, s.flare + 0.35 + lines * 0.15);
        s.fireKick = Math.min(1, s.fireKick + 0.18 + lines * 0.1);
        s.flash = Math.max(s.flash, 0.08 + lines * 0.05);
        if (big) {
            s.fireKick = 1;
            s.flash = Math.max(s.flash, 0.4);
            s.green = this.U.sunUp.value > 0.05 && this.U.sunLow.value > 0.4 ? 1 : 0;
            s.greenAge = 0;
            if (c.perfect) this.sendFlock(this.parts.birds?.count ?? 0);
        }
    }

    /** The longest chain any board is holding (0 = it broke). */
    onCombo(combo) {
        const s = this.state;
        const next = Math.max(0, combo | 0);
        if (next > s.combo && next >= 3) this.sendFlock(birdsForCombo(next, this.parts.birds?.count ?? 0));
        s.combo = next;
    }

    /** Send a flock of `n` birds across the light. */
    sendFlock(n) {
        const s = this.state;
        if (!this.parts.birds || n <= 0 || this.clock - s.flockAt < 6) return;
        s.flockAt = this.clock;
        s.flockSize = n;
        s.flocks += 1;
        const target = this.light.moonKey > 0.5 ? this.U.moon.value : this.U.sun.value;
        this.parts.birds.send(this.clock, n, target, this.rand());
    }

    /**
     * A new level: the day runs on LEVEL_SECONDS of its timetable for every level gained, from
     * where the last turn was headed (never back). `silent`: it simply is that level.
     */
    levelUp(level, { silent = false } = {}) {
        const s = this.state;
        const { day } = this;
        const next = Math.max(1, level | 0);
        if (silent) {
            this.restoreDay((next - 1) * LEVEL_SECONDS);
        } else if (next > s.level) {
            day.from = this.dayOffset();
            day.to += (next - s.level) * LEVEL_SECONDS;
            day.at = this.clock;
            day.seconds = turnSeconds(day.to - day.from);
        }
        s.level = next;
        this.applyHour();
    }

    // ── the day ─────────────────────────────────────────────────────────────────

    /** Seconds of the timetable the levels have carried the day on (eased while it turns). */
    dayOffset() {
        const { day } = this;
        return levelOffset(day.from, day.to, this.clock - day.at, day.seconds);
    }

    /** Where a turn is headed: what a rebuild in place hands to the new world (restoreDay). */
    dayTarget() {
        return this.day.to;
    }

    /** Stand the day on an offset at once (a rebuild in place picks the day up where it was). */
    restoreDay(offset) {
        const { day } = this;
        day.from = Number.isFinite(offset) ? offset : 0;
        day.to = day.from;
        day.at = -100;
        day.seconds = 1;
    }

    /** Where the day stands on its timetable (seconds): the clock plus what the levels added. */
    wheel() {
        return this.clock + this.dayOffset();
    }

    /** The hour of the day (0..24). */
    dayHour() {
        return this.day.pin ?? dayHourAt(this.wheel());
    }

    /** Hand the hour's light to the shaders, and put the sun and the moon where the hour has them. */
    applyHour() {
        const { U } = this;
        const hour = this.dayHour();
        const light = lightAt(hour, this.light);
        for (let i = 0; i < HOUR_COLOURS.length; i += 1) {
            const colour = light[HOUR_COLOURS[i]];
            this.lightRows[i].set(colour[0], colour[1], colour[2], 0);
        }
        U.stars.value = light.stars;
        U.cover.value = light.cover;
        U.fire.value = light.fire;
        U.moonKey.value = light.moonKey;
        // The night sky turns about its pole with the hours, the same way the sun and the moon go
        // (right to left in front of the eye); at midnight it stands as the shader places it.
        U.starTurn.value = -(hour / 24) * Math.PI * 2;

        // The sun.
        const sun = arcAt(hourAngle(hour), SUN_PEAK, this.setAz, this.riseAz, this.sunArc);
        azElDirection(sun.az, sun.el, U.sun.value);
        this.bodyFrame(U.sun.value, U.sunRight.value, U.sunTop.value);
        U.sunUp.value = smooth(-SUN_RADIUS, SUN_RADIUS, sun.el);
        U.sunLow.value = 1 - smooth(1.5, 11, sun.el);
        U.sunSquash.value = discSquash(sun.el);
        // Near the sea a body looks larger than it does high up.
        U.sunSize.value = Math.sin(SUN_RADIUS * DEG) * (1 + 0.1 * (1 - smooth(0, 15, sun.el)));
        // A low sun is a coal seen through a long way of air; a high one is white.
        U.sunPower.value = lerp(9, 28, smooth(0, 13, sun.el) ** 1.4);
        // The moon, its face turning as it crosses the sky.
        const angle = hourAngle(hour, MOON_LAG);
        const moon = arcAt(angle, MOON_PEAK, this.setAz, this.riseAz, this.moonArc);
        azElDirection(moon.az, moon.el, U.moon.value);
        this.bodyFrame(U.moon.value, U.moonRight.value, U.moonTop.value);
        U.moonUp.value = smooth(-MOON_RADIUS, MOON_RADIUS, moon.el);
        U.moonSquash.value = discSquash(moon.el);
        U.moonSize.value = Math.sin(MOON_RADIUS * DEG) * (1 + 0.22 * (1 - smooth(0, 18, moon.el)));
        U.moonPower.value = lerp(0.8, 1.05, smooth(0, 8, moon.el));
        U.moonTilt.value = -0.45 * Math.sin(angle * DEG);

        // The key light's way across the cloud deck, and the streets running in toward the place
        // the sky goes down.
        const street = U.street.value;
        street.set(Math.sin(this.setAz * DEG), -Math.cos(this.setAz * DEG));
        const key = tmpKey.copy(U.sun.value).lerp(U.moon.value, light.moonKey);
        const kx = key.x;
        const kz = key.z;
        const kl = Math.hypot(kx, kz);
        if (kl > 1e-3) {
            const along = (kx * street.x + kz * street.y) / kl;
            const across = (kx * -street.y + kz * street.x) / kl;
            const l = Math.hypot(along * TUNE.deckAlong, across * TUNE.deckAcross) || 1;
            U.keyFlat.value.set((along * TUNE.deckAlong) / l, (across * TUNE.deckAcross) / l);
        }
    }

    /** A body's right and up axes on the sky (for its disc). */
    bodyFrame(dir, right, top) {
        right.set(-dir.z, 0, dir.x);
        if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
        right.normalize();
        // A body behind the eye: keep its right hand on the right as the eye sees it.
        if (dir.z > 0) right.negate();
        top.crossVectors(right, dir).normalize();
        if (top.y < 0) top.negate();
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    update(sim, camera) {
        if (!this.parts.sea) return;
        const dt = Math.max(0, sim.delta);
        this.time = sim.time;
        const { U } = this;
        const s = this.state;
        this.clock += dt;
        U.time.value = this.clock;
        // The places the sky sets and rises follow the frame (a board arriving, a resize).
        const k = approach(0.9, dt);
        this.setAz += (this.frame.setAz - this.setAz) * k;
        this.riseAz += (this.frame.riseAz - this.riseAz) * k;
        this.applyHour();

        // Rings run their course.
        while (this.ringCount > 0 && this.clock - this.ringRows[0].z > RING_LIFE) {
            for (let i = 2; i < this.ringCount * 2; i += 1) this.ringRows[i - 2].copy(this.ringRows[i]);
            this.ringCount -= 1;
        }

        // The fire in the sky: the chain holds it, each clear kicks it.
        const held = fireForCombo(s.combo);
        s.fire += (held - s.fire) * approach(held > s.fire ? 1.4 : 0.35, dt);
        s.fireKick *= Math.exp(-0.45 * dt);
        U.skyFire.value = clamp01(s.fire + s.fireKick);
        s.glint *= Math.exp(-0.9 * dt);
        s.flare *= Math.exp(-1.3 * dt);
        U.flare.value = s.flare;
        U.glint.value = s.glint + s.fire * 0.6;
        s.flash *= Math.exp(-4 * dt);
        s.greenAge += dt;
        U.green.value = s.green * smooth(0, 0.25, s.greenAge) * (1 - smooth(1.6, 2.8, s.greenAge));
        // The halo: it runs out from the disc to its place, holds, and fades.
        const pAge = this.clock - s.pulseAt;
        if (pAge >= 0 && pAge < HALO_LIFE) {
            const reach = (0.15 + 0.85 * smooth(0, HALO_RISE, pAge)) * HALO_RADIUS * DEG;
            const strength = s.pulseStrength * smooth(0, 0.25, pAge) * (1 - smooth(HALO_RISE, HALO_LIFE, pAge));
            const width = (0.0075 * Math.sin(reach)) / Math.sin(HALO_RADIUS * DEG) + 0.0012;
            U.pulse.value.set(Math.cos(reach), width, strength);
        } else {
            U.pulse.value.z = 0;
        }
        // The cloud deck drifts in toward the sun.
        U.drift.value.set(-this.clock * 0.0011, this.clock * 0.00023);

        this.updateLanterns(camera);
        this.parts.birds.update(this.clock);
        U.counts.value.set(this.ringCount, 0, this._lampCount ?? 0, 0);

        if (camera) {
            this.parts.sky.follow(camera);
            // Where the sun stands on screen (the post draws its shafts from there).
            const body = this.light.moonKey > 0.5 ? U.moon.value : U.sun.value;
            tmpSun.copy(body).multiplyScalar(1000).add(camera.position).project(camera);
            const ahead = tmpRay.set(0, 0, -1).transformDirection(camera.matrixWorld).dot(body);
            this.sunScreen.x = tmpSun.x * 0.5 + 0.5;
            this.sunScreen.y = 0.5 - tmpSun.y * 0.5;
            // The moon draws no shafts: they would comb the stars into streaks. Nor does a sun
            // high over the picture: they would rake down from its top edge.
            const up = U.sunUp.value * (1 - this.light.moonKey) * (1 - smooth(18, 34, this.sunArc.el));
            this.sunScreen.visible = ahead > 0.2 ? up : 0;
        }
    }

    /** The lanterns, their halos, the lights in flight, the splashes, and the lamps the sea mirrors. */
    updateLanterns(camera) {
        const { pool, clock } = this;
        const { lanterns } = this.parts;
        const { glows } = this.parts;
        lanterns.begin();
        glows.begin();
        pool.sweep(clock);
        const lamps = this._lamps;
        lamps.length = 0;
        const st = this._lantern;
        const eye = camera ? camera.position : { x: 0, y: EYE_HEIGHT, z: 0 };
        for (let i = 0; i < pool.records.length; i += 1) {
            const r = pool.records[i];
            pool.stateOf(r, clock, st);
            if (!st.phase) continue;
            if (st.phase === 'mote') {
                // The light in flight, and its trail.
                this._to.x = r.x0;
                this._to.z = r.z0;
                this._to.y = seaHeight(r.x0, r.z0, r.t0) + 0.3;
                for (let j = 0; j < MOTE_TRAIL; j += 1) {
                    const s = st.mote - (j * MOTE_STEP) / MOTE_SECONDS;
                    if (s < 0) break;
                    moteAt({ x: r.fromX, y: r.fromY, z: r.fromZ }, this._to, s, this._mote);
                    const fade = (1 - j / MOTE_TRAIL) ** 1.5;
                    const hot = j === 0 ? 3 : 1;
                    glows.push(
                        this._mote.x,
                        this._mote.y,
                        this._mote.z,
                        (j === 0 ? 0.24 : 0.13) * fade + 0.03,
                        r.rgb[0] * 4 * fade * hot,
                        r.rgb[1] * 4 * fade * hot,
                        r.rgb[2] * 4 * fade * hot,
                    );
                }
                continue;
            }
            lanterns.push(st.x, st.y, st.z, st.tiltX, st.tiltZ, st.scale, r.rgb, st.glow, r.seed);
            // The halo round its flame: a soft glow a little larger than the lantern.
            const fy = st.y + 0.26 * st.scale;
            const air = st.phase === 'air';
            const halo = st.glow * 0.42;
            glows.push(st.x, fy, st.z, air ? 0.75 : 0.62, r.rgb[0] * halo, r.rgb[1] * halo, r.rgb[2] * halo);
            const dx = st.x - eye.x;
            const dz = st.z - eye.z;
            const far = Math.hypot(dx, dz);
            const score = (st.glow / (1 + far * 0.03)) * (fy < 40 ? 1 : 0.25);
            lamps.push({
                x: st.x, y: fy, z: st.z, glow: st.glow, rgb: r.rgb, score,
            });
        }
        // The drops of a splash: thrown up, falling back.
        const nd = this.drops.length / 10;
        for (let i = 0; i < nd; i += 1) {
            const k = i * 10;
            const age = clock - this.drops[k + 6];
            if (age < 0 || age > DROP_LIFE) continue;
            const y = this.drops[k + 1] + this.drops[k + 4] * age - 4.9 * age * age;
            if (y < -0.05) continue;
            const fade = 1 - smooth(DROP_LIFE * 0.5, DROP_LIFE, age);
            glows.push(
                this.drops[k] + this.drops[k + 3] * age,
                y,
                this.drops[k + 2] + this.drops[k + 5] * age,
                0.022,
                this.drops[k + 7] * 2.2 * fade,
                this.drops[k + 8] * 2.2 * fade,
                this.drops[k + 9] * 2.2 * fade,
                1,
            );
        }
        lanterns.end();
        glows.end();
        // The lamps the sea mirrors: the brightest and nearest.
        lamps.sort((a, b) => b.score - a.score);
        const n = Math.min(lamps.length, this.lampRows.length / 2);
        for (let i = 0; i < n; i += 1) {
            const l = lamps[i];
            this.lampRows[i * 2].set(l.x, l.y, l.z, l.glow * 55);
            this.lampRows[i * 2 + 1].set(l.rgb[0], l.rgb[1], l.rgb[2], 0);
        }
        this._lampCount = n;
    }

    /** What the post stack should know this frame. */
    getPostState() {
        const s = this.state;
        const L = this.light;
        return {
            flash: s.flash,
            bloomBoost: this.U.skyFire.value * 0.4 + s.glint * 0.1,
            warm: this.U.skyFire.value,
            sunX: this.sunScreen.x,
            sunY: this.sunScreen.y,
            shafts: this.sunScreen.visible * (0.42 + this.U.skyFire.value * 0.4),
            // Copies: the hour's arrays are rewritten every frame.
            shaftTint: [L.shaft[0], L.shaft[1], L.shaft[2]],
            gradeShadow: [L.gradeShadow[0], L.gradeShadow[1], L.gradeShadow[2]],
            gradeLight: [L.gradeLight[0], L.gradeLight[1], L.gradeLight[2]],
            exposure: L.exposure,
        };
    }

    getState() {
        const s = this.state;
        const { pool, clock } = this;
        return {
            quality: this.quality,
            capture: this.capture,
            time: this.time,
            clock,
            combo: s.combo,
            level: s.level,
            hour: this.light.name,
            hourNext: this.light.next,
            hourMix: this.light.mix,
            dayHour: this.dayHour(),
            wheel: this.wheel(),
            stations: STATIONS.length,
            sunHeight: this.sunArc.el,
            moonHeight: this.moonArc.el,
            sunAz: this.sunArc.az,
            moonAz: this.moonArc.az,
            setAz: this.setAz,
            riseAz: this.riseAz,
            horizon: this.frame.horizon,
            floating: pool.floating(clock),
            flying: pool.flying(clock),
            rings: this.ringCount,
            lamps: this._lampCount ?? 0,
            fire: this.U.skyFire.value,
            green: this.U.green.value,
            locks: s.locks,
            clears: s.clears,
            lifted: s.lifted,
            flocks: s.flocks,
            birds: this.parts.birds?.airborne?.(clock) ?? 0,
            sun: { ...this.sunScreen },
        };
    }

    get combo() {
        return this.state.combo;
    }

    dispose() {
        Object.values(this.parts).forEach((part) => part.dispose());
        this.parts = {};
        this.group.removeFromParent();
        this.skyNoise?.dispose();
        this.seaNoise?.dispose();
        this.skyNoise = null;
        this.seaNoise = null;
        this.camera = null;
    }
}
