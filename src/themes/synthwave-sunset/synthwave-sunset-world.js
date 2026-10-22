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
 *                column and meet at the top (a hard drop's band burns brighter; bands that pile
 *                up under rapid locks add their light instead of cutting each other off)
 *   line clear   one firework shell per line from the barge off the pier; four lines, a finale
 *                closed by a gold willow. The show has memory: a longer chain and hotter play
 *                fire more and bigger shells, glitter and then willows join the volley, and each
 *                cascade wave bursts higher and fuller than the last
 *   T-spin       the wheel whirls round and a lilac ring bursts (with no lines, the whirl alone
 *                and a lilac band round the rims)
 *   back-to-back a salute: a row of rings bursting together in the wheel's neon colours (one more
 *                for each back-to-back in a row), and both rims ring round
 *   perfect      the crown, over the clear still in the air: a curtain of gold willows across
 *                the free sky and the whole bay at full blaze
 *   chain        the coaster climbs the lift hill a notch per link (its lift's bulbs fill like a
 *                meter, past eight links ever closer to the crest and ever brighter); when the
 *                chain breaks after three or more it goes round the circuit into the station
 *                (faster and with a longer trail for a longer chain, twice round from ten), and
 *                the lemon drains down the lift instead of going dark. A chain built during a
 *                ride charges the lift ahead of the train, which climbs it on its return
 *   level up     the evening steps on, the wheel's neon ring turns on to its next colour, two
 *                shells
 *
 * The crescendo (src/themes/shared/gameplay-surge.js, sampled once a frame on the world's clock):
 * as play heats, the pleasure pier powers up ahead of the evening. Warm: the pier's lights race
 * out to the wheel, the bulbs burn brighter, more hotel rooms switch on and the chase lights
 * quicken. Hot: the wheel turns faster, the sea breeze stirs the palms, the shells grow and the
 * sky stays lit between them. Fever: the midway at full blaze, the barge firing a volley of its
 * own between the player's shells, the wheel spinning and shooting stars over the bay. When
 * the hands rest it all breathes back to the quiet evening over a few seconds.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import { RIG, SUN } from './synthwave-sunset-tsl.js';
import { createSky } from './synthwave-sunset-sky.js';
import { createSea } from './synthwave-sunset-sea.js';
import { WHEEL, createWheel } from './synthwave-sunset-wheel.js';
import { createPier } from './synthwave-sunset-pier.js';
import { createCoaster } from './synthwave-sunset-coaster.js';
import { createPromenade } from './synthwave-sunset-promenade.js';
import { createPalms } from './synthwave-sunset-palms.js';
import { createGulls } from './synthwave-sunset-gulls.js';
import { FIREWORK_COLORS, Fireworks, WILLOW_GOLD } from './synthwave-sunset-fireworks.js';
import { SYNTHWAVE_SUNSET_TETROMINOS } from './synthwave-sunset-tetrominos.js';
import { applyCameraBreath, easedMotion, prefersReducedMotion } from '../shared/camera-breath.js';
import { flashScale, prefersReducedFlashing } from '../../utils/photosensitivity.js';

/**
 * The layer the sea's reflection pass renders: everything that stands in the scene and should be
 * mirrored (the wheel, the pier, the coaster, the town, the fireworks). The main camera sees it.
 */
export const MIRROR_LAYER = 3;

/** The parts, in build order (the playground's `parts=` names). */
export const SYNTHWAVE_PARTS = Object.freeze(['sky', 'sea', 'wheel', 'pier', 'coaster', 'promenade', 'palms', 'gulls', 'fireworks']);

/** Per-tier content. Every tier keeps the full composition; tiers trade detail, not layout. */
export const WORLD_QUALITY = Object.freeze({
    Minimal: {
        cloudOctaves: 0,
        stars: true,
        shooting: false,
        seaTrains: 4,
        seaClouds: 0,
        swash: false,
        sandDetail: false,
        mirrorScale: 0,
        palms: 6,
        gulls: 3,
        fireworks: 1200,
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
        sandDetail: false,
        mirrorScale: 0.25,
        palms: 10,
        gulls: 4,
        fireworks: 1800,
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
        gulls: 5,
        fireworks: 2600,
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
        gulls: 7,
        fireworks: 3400,
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
        gulls: 8,
        fireworks: 4200,
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
        gulls: 9,
        fireworks: 5200,
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

/**
 * Lock chases running round the wheel at once (a band meets at the top at 1.25 s, gone by 1.6 s:
 * four keep up with a lock every 0.3 s). A new lock takes the oldest band once it has started to
 * fade (CHASE_FADE); faster than that it joins the newest band (brighter, its colour blended)
 * instead of cutting one off halfway round.
 */
export const CHASE_SLOTS = 4;
const CHASE_FADE = 1.15;

/** Rim angles: the bottom of the wheel (where a lock's bands leave from) and its top. */
const RIM_BOTTOM = -Math.PI / 2;

/**
 * How far up the lift (0 foot .. 1 crest) a chain of `notch` links lifts the train: an eighth a
 * link to six, then ever closer to the crest (a twenty-chain still climbs where an eight-chain
 * stood).
 */
export function liftShare(notch) {
    const n = Math.max(0, notch);
    if (n <= 6) return n / 8;
    return 0.75 + 0.25 * (1 - Math.exp(-(n - 6) / 4));
}

/** Colours the reactions use (linear, from the fireworks' palette). */
const MINT = new THREE.Color(FIREWORK_COLORS[0]);
const PINK = new THREE.Color(FIREWORK_COLORS[1]);
const LEMON = new THREE.Color(FIREWORK_COLORS[2]);
const LILAC = new THREE.Color(FIREWORK_COLORS[3]);

/** Chain lengths that send a shooting star over the bay. */
const SHOOT_MILESTONES = new Set([5, 8, 10, 12, 15, 20, 25, 30]);

/** CPU smoothstep on 0..1. */
const ease01 = (x) => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
};

export function createWorldUniforms() {
    const u = {
        time: uniform(0),
        /** The gulls' clock: the scene's, held back under reduced motion (they glide slower). */
        gullTime: uniform(0),
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
        /** The midway's chase clock: the bulbs' chase programmes run on it, quicker as play heats. */
        chaseTime: uniform(0),
        /** The sea breeze on the palms (1 at rest). */
        breeze: uniform(1),
        /** The coaster: its lift meter (track parameter lit up to) and how hard it is riding. */
        coasterMeter: uniform(0),
        /** The meter's charge: how bright the lemon burns (0 dark, 1 a chain, more for a long one). */
        coasterCharge: uniform(0),
        coasterRide: uniform(0),
        coasterTrain: uniform(0),
        /** The ride's trail: its fall-off along the track (smaller is longer). */
        coasterTrail: uniform(34),
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
        /**
         * What play adds to the bay's lights this frame (updateSurge writes it, applyDusk folds it
         * in): the pier's light front, the bulbs' glow, the town's lights; and the wheel's extra
         * turn, the chase lights' pace and the breeze. All rest at 0 (1 for the paces).
         */
        this.bay = {
            power: 0, glow: 0, town: 0, spin: 0, chase: 1, breeze: 1,
        };
        this.setDusk(DUSK.rest);

        // Reactive state
        this.chases = Array.from({ length: CHASE_SLOTS }, () => ({ t0: -1e6, strength: 0 }));
        this.lastLockColor = new THREE.Color(FIREWORK_COLORS[0]);
        /** The neon ring's colour walk: each level turns it on to the next colour, never back. */
        this.neonTarget = 0;
        this.neonPhase = 0;
        /**
         * The coaster. `notch` is the live chain; `meter`/`charge` what the lift shows (eased: it
         * drains, never snaps); on a ride `lap` counts the wraps of `laps`, `launch` is the crest
         * speed (m/s) and `trail` the trail's fall-off, both from the chain that sent it.
         */
        this.coaster = {
            mode: 'idle', t: 0, notch: 0, lap: 0, laps: 1, launch: 3, trail: 34, meter: 0, charge: 0, ride: 0,
        };
        this.bloomBoost = 0;
        /** The iris for the post stack (1 open): it closes a little as the bay blazes. */
        this.exposure = 1;
        this.shoots = [{ t0: -1e6, life: 1 }, { t0: -1e6, life: 1 }];
        /** Shooting stars waiting for a free slot (never one cut off mid-streak). */
        this.pendingShoots = 0;
        this.nextAmbientShoot = 12 + this.rand() * 18;
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js) on the world's clock, and its
         * reading this frame; the perfect clear's crown; a T-spin's whirl of the wheel.
         */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.crown = new Swell({
            attack: 0.3, release: 2.8, ceiling: 1.2, knee: 0.85,
        });
        this.spin = new Swell({
            attack: 0.12, release: 0.9, ceiling: 2.5, knee: 1.6,
        });
        /** Back-to-back difficult clears in a row (the salute grows with it). */
        this.b2bStreak = 0;
        /** The fever volley's next shell, and the fever's next shooting star. */
        this.nextVolleyAt = -1e6;
        this.nextFeverShoot = -1e6;
        this.nextQueuedShoot = -1e6;
        this.chaseClock = 0;

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
            trains: q.seaTrains, clouds: q.seaClouds, swash: q.swash, mirrorScale: q.mirrorScale, sandDetail: q.sandDetail !== false,
        });
        this.reflection = this.parts.sea.userData.reflection ?? null;
        if (this.reflection) this.root.add(this.reflection.target);
        this.parts.wheel = createWheel(u, { mirrorLayer: MIRROR_LAYER });
        this.parts.pier = createPier(u, { mirrorLayer: MIRROR_LAYER });
        this.parts.coaster = createCoaster(u, { mirrorLayer: MIRROR_LAYER });
        this.parts.promenade = createPromenade(u, { rand, mirrorLayer: MIRROR_LAYER });
        this.parts.palms = createPalms(u, { rand, count: q.palms });
        this.parts.gulls = createGulls(u, { count: q.gulls });
        this.fireworks = new Fireworks(u, { capacity: q.fireworks, rand, mirrorLayer: MIRROR_LAYER });
        this.parts.fireworks = this.fireworks.mesh;
        this.track = this.parts.coaster.userData;
        this.coaster.t = this.track.marks.station;
        this.coaster.meter = this.track.marks.liftFoot;
        this.crestY = this.track.curve.getPointAt(this.track.marks.liftTop).y;
        this._trackPoint = new THREE.Vector3();
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
        // The pier lights come on from the land end as the evening deepens; the town too. Play
        // powers them up ahead of the evening (this.bay: 0 at rest and under casual play).
        const { bay } = this;
        this.u.pierPower.value = THREE.MathUtils.clamp(0.42 + dusk * 0.85 + bay.power, 0, 1);
        this.u.wheelGlow.value = (0.85 + dusk * 0.5) * (1 + bay.glow);
        this.u.pierGlow.value = (0.85 + dusk * 0.5) * (1 + bay.glow * 0.8);
        this.u.townLights.value = Math.min(1.35, 0.5 + dusk * 0.5 + bay.town);
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

        // How hot play runs, and what the bay makes of it (applyDusk folds it into the lights).
        this.updateSurge(t);
        const { bay } = this;

        // The wheel turns on the clock (a seek lands right); reduced motion slows it to a crawl,
        // play turns it faster and a T-spin whirls it (all through the lag: it never jumps).
        this.wheelLag = (this.wheelLag ?? 0) + dt * ((1 - motion) * 0.85 - bay.spin * motion);
        u.wheelAngle.value = ((t - this.wheelLag) * (Math.PI * 2)) / WHEEL.period;
        this.gullLag = (this.gullLag ?? 0) + dt * (1 - motion) * 0.6;
        u.gullTime.value = t - this.gullLag;
        // The neon ring walks on to its next colour (pink, mint, pink…), never back.
        this.neonPhase += (this.neonTarget - this.neonPhase) * approach(0.8, dt);
        u.wheelNeonMix.value = 0.5 - 0.5 * Math.cos(Math.PI * this.neonPhase);
        // The chase lights run on their own clock, quicker with play (not under reduced motion);
        // the breeze on the palms freshens with it.
        this.chaseClock += dt * (1 + (bay.chase - 1) * motion);
        u.chaseTime.value = this.chaseClock;
        u.breeze.value = 1 + (bay.breeze - 1) * motion;

        // The evening deepens while a game is being played, and eases toward its target.
        if (!this.duskHeld) {
            if (t - this.lastPlayed < DUSK.activeFor) this.duskTarget = Math.min(1, this.duskTarget + dt / DUSK.fullAfter);
            this.dusk += (this.duskTarget - this.dusk) * approach(0.6, dt);
        }
        this.applyDusk();

        this.updateCoaster(dt, motion);

        // Fireworks: bursts arriving, the sky glows round them (held back under Reduce flashing).
        this.fireworks.update(t);
        const calm = prefersReducedFlashing();
        u.fireworkCalm.value = calm ? 1 : 0;
        u.fireworkLevel.value = calm ? 0.6 : 1;
        const flash = flashScale();
        this.fireworks.writeGlows(t, flash);
        const w0 = u.burst0.value.w;
        const w1 = u.burst1.value.w;
        // The bloom swells with the sky's gathered glow and a little with the heat of play; the
        // iris closes about as much, so the bay's colours stay saturated and the dusk stays deep.
        this.bloomBoost = Math.max(w0, w1) * 0.45 + (w0 + w1) * 0.1
            + bay.hot * 0.05 + bay.fever * 0.08 + (bay.crown * 0.15 + this.heat.punch * 0.08) * flash;
        this.exposure = 1 - bay.hot * 0.03 - bay.fever * 0.05 - bay.crown * 0.05 * flash
            - Math.min(0.05, (w0 + w1) * 0.02);

        // Shooting stars: now and then, on chain milestones and through a fever. A star waits for
        // a free slot rather than cutting one off mid-streak.
        const still = prefersReducedMotion();
        if (this.q.shooting && t >= this.nextAmbientShoot && !still) {
            this.nextAmbientShoot = this.spawnShootingStar(0.7) ? t + 22 + this.rand() * 30 : t + 1;
        }
        if (this.pendingShoots > 0) {
            if (still || !this.q.shooting) this.pendingShoots = 0;
            else if (t >= this.nextQueuedShoot && this.spawnShootingStar(1)) {
                this.pendingShoots -= 1;
                this.nextQueuedShoot = t + 0.4;
            }
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
     * How hot play runs, made into the bay (this.bay, folded into the lights by applyDusk). All of
     * it rests at nothing under casual play, so the evening looks as it always did:
     *   warm   the pier powers up ahead of the evening: its light front races out to the wheel,
     *          the bulbs burn brighter, the hotels switch more rooms on, the chases quicken;
     *   hot    the wheel turns faster, the sea breeze stirs the palms, the shells grow;
     *   fever  the midway at full blaze: the barge fires a volley of its own between the player's
     *          shells, shooting stars cross the bay;
     *   crown  a perfect clear lifts it all to full blaze for a few seconds.
     * Every hit's punch makes the bulbs throb a little (riding on a floor under rapid locks).
     */
    updateSurge(t) {
        const heat = this.surge.sample(t);
        const H = this.heat;
        H.punch = heat.punch;
        H.level = heat.level;
        H.fever = heat.fever;
        H.stage = heat.stage;
        const { fever } = heat;
        const warm = ease01((heat.level - 0.12) / 0.43);
        const hot = ease01((heat.level - 0.45) / 0.45);
        const crown = this.crown.valueAt(t);
        const kick = heat.punch * flashScale();
        const { bay } = this;
        bay.warm = warm;
        bay.hot = hot;
        bay.fever = fever;
        bay.crown = crown;
        bay.power = 0.6 * warm + 0.4 * fever + crown;
        bay.glow = 0.1 * warm + 0.1 * hot + 0.14 * fever + 0.15 * crown + 0.12 * kick;
        bay.town = 0.3 * warm + 0.15 * hot + 0.2 * fever + 0.3 * crown;
        bay.spin = 0.7 * warm + 1.1 * hot + 1.8 * fever + 7 * this.spin.valueAt(t);
        bay.chase = 1 + 0.9 * warm + 1.1 * hot + 1.4 * fever + crown;
        bay.breeze = 1 + 0.5 * warm + 0.4 * hot + 0.6 * fever;
        this.feverVolley(t, fever);
        if (fever > 0.5 && t >= this.nextFeverShoot) {
            this.queueShootingStars(1);
            this.nextFeverShoot = t + 2.2 + this.rand() * 1.6;
        }
    }

    /**
     * The fever's volley: the barge fires shells of its own between the player's, quicker the
     * hotter the fever (halved under reduced motion), as a display builds to its finale.
     */
    feverVolley(t, fever) {
        if (fever < 0.3) {
            this.nextVolleyAt = Math.max(this.nextVolleyAt, t + 0.3);
            return;
        }
        if (t < this.nextVolleyAt) return;
        const r = this.rand;
        const reduced = (this.motion ?? 1) < 0.5;
        const kinds = ['chrys', 'ring', 'peony', 'chrys', 'willow'];
        const kind = kinds[Math.floor(r() * kinds.length)];
        const stars = Math.round(this.q.stars0 * (reduced ? 0.6 : 1) * (kind === 'willow' ? 0.55 : 0.8));
        this.fireworks.launch(t, {
            kind,
            color: new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]),
            scale: 0.95 + 0.25 * fever,
            stars,
            high: 0.4 * r(),
        });
        const gap = THREE.MathUtils.lerp(1.3, 0.55, Math.min(1, fever)) * (reduced ? 2 : 1);
        this.nextVolleyAt = t + gap * (0.8 + 0.4 * r());
    }

    /**
     * The coaster: on the lift it climbs to the notch its chain has earned; released, a tyre
     * drive takes it over the crest and it rides the circuit on its own speed (energy from the
     * crest's height and its launch, which a longer chain makes faster), brakes on the return and
     * rolls into the station, having gone round once (twice from a ten-chain).
     *
     * The lift's meter is lit from the foot up to the train while a chain lifts it; a chain built
     * during a ride charges the lift ahead of the train (which climbs it on its return); a chain
     * that let go drains down the lift and fades instead of going dark in one frame.
     */
    updateCoaster(dt, motion) {
        const c = this.coaster;
        const { curve, marks } = this.track;
        if (!curve || !marks) return;
        const length = curve.getLength();
        const pace = 0.5 + 0.5 * motion;
        const notchT = marks.liftFoot + (marks.liftTop - marks.liftFoot) * liftShare(c.notch);
        const climb = (3.2 * pace * dt) / length;
        let ride = 0;
        if (c.mode === 'lift' || c.mode === 'idle') {
            const target = c.mode === 'lift' ? notchT : marks.station;
            c.t += THREE.MathUtils.clamp(target - c.t, -climb, climb);
        } else if (c.mode === 'ride') {
            // Home: past its last wrap, rolling round the last turn into the station.
            const home = c.lap >= c.laps;
            let v;
            if (!home && c.t < marks.liftTop) {
                v = 5 * pace; // the tyre drive up to the crest
            } else {
                const h = curve.getPointAt(c.t, this._trackPoint).y;
                v = Math.sqrt(Math.max(0, 2 * 9.81 * (this.crestY - h)) + c.launch * c.launch) * pace;
                // The brakes on the return, then a slow roll round the last turn into the station.
                if (home || c.t >= marks.returnStart) v = Math.min(v, 8 * pace);
                if (home) v = Math.min(v, 3.5 * pace);
            }
            c.t += (v * dt) / length;
            if (c.t >= 1) {
                c.t -= 1;
                c.lap += 1;
            }
            ride = Math.min(1, v / 18);
            if (c.lap >= c.laps && c.t >= marks.station) {
                c.t = marks.station;
                // A chain built during the ride: the train climbs the lift it charged.
                c.mode = c.notch > 0 ? 'lift' : 'idle';
            }
        }
        // The ride's light eases in and out (it never starts at full strength in one frame).
        c.ride += (ride - c.ride) * approach(c.mode === 'ride' ? 4 : 1.5, dt);

        const rest = marks.liftFoot - 0.012;
        if (c.notch > 0) {
            if (c.mode === 'lift') c.meter = Math.max(c.t, Math.min(c.meter, notchT));
            else c.meter += THREE.MathUtils.clamp(notchT - c.meter, -climb, climb);
        } else {
            c.meter += (rest - c.meter) * approach(1.4, dt);
        }
        // A long chain's lemon burns brighter than a short one's.
        const charge = c.notch > 0 ? Math.min(1.6, 1 + Math.max(0, c.notch - 6) * 0.06) : 0;
        c.charge += (charge - c.charge) * approach(c.notch > 0 ? 4 : 1.5, dt);

        this.u.coasterMeter.value = c.meter;
        this.u.coasterCharge.value = c.charge;
        this.u.coasterRide.value = c.ride;
        this.u.coasterTrail.value = c.trail;
        this.u.coasterTrain.value = c.t;
        this.track.placeTrain(c.t);
    }

    /**
     * Seek (deterministic captures): no events in flight, the train at the station, the evening
     * back where it was set (a capture replays its events on every frame), play cold.
     */
    seek(time) {
        this.time = time;
        this.u.time.value = time;
        this.u.gullTime.value = time - (this.gullLag ?? 0);
        this.lastPlayed = -1e6;
        this.surge.reset();
        this.crown.reset();
        this.spin.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        Object.assign(this.bay, {
            power: 0, glow: 0, town: 0, spin: 0, chase: 1, breeze: 1, warm: 0, hot: 0, fever: 0, crown: 0,
        });
        this.b2bStreak = 0;
        this.nextVolleyAt = -1e6;
        this.nextFeverShoot = -1e6;
        this.chaseClock = time;
        this.u.chaseTime.value = time;
        this.dusk = this.duskBase;
        this.duskTarget = this.duskBase;
        this.applyDusk();
        this.chases.forEach((ch, i) => {
            ch.t0 = -1e6;
            ch.strength = 0;
            this.u[`chase${i}`].value.set(-1e6, 0, 0, 0);
        });
        const c = this.coaster;
        c.mode = 'idle';
        c.t = this.track?.marks?.station ?? 0;
        c.notch = 0;
        c.lap = 0;
        c.laps = 1;
        c.meter = (this.track?.marks?.liftFoot ?? 0) - 0.012;
        c.charge = 0;
        c.ride = 0;
        this.u.coasterMeter.value = c.meter;
        this.u.coasterCharge.value = 0;
        this.u.coasterRide.value = 0;
        this.shoots.forEach((s) => { s.t0 = -1e6; });
        this.pendingShoots = 0;
        this.nextAmbientShoot = time + 12 + this.rand() * 18;
        this.fireworks?.clear();
        this.track?.placeTrain?.(c.t);
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * A piece locked: two bands of its colour run round the wheel's rims from its column's side
     * (left columns start left of the bottom, right columns right of it) and meet at the top. A
     * hard drop's bands burn brighter.
     */
    onPieceLock(piece, { hardDrop = false } = {}) {
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
        const start = RIM_BOTTOM + ((column - 4.5) / 4.5) * 0.7;
        this.runChase(start, color, hardDrop ? 1.25 : 1);
        this.surge.lock({ hardDrop }, this.time);
    }

    /**
     * Send two bands round the rims from `start`. The oldest band gives way once it has begun to
     * fade; while every band is still running, the newest takes this one in (brighter, its colour
     * blended), so rapid locks build the light instead of cutting a band off halfway round.
     */
    runChase(start, color, strength = 1) {
        const now = this.time;
        let oldest = 0;
        let newest = 0;
        for (let i = 1; i < CHASE_SLOTS; i += 1) {
            if (this.chases[i].t0 < this.chases[oldest].t0) oldest = i;
            if (this.chases[i].t0 > this.chases[newest].t0) newest = i;
        }
        if (now - this.chases[oldest].t0 >= CHASE_FADE) {
            const ch = this.chases[oldest];
            ch.t0 = now;
            ch.strength = strength;
            this.u[`chase${oldest}`].value.set(now, start, strength, 0);
            this.u[`chaseCol${oldest}`].value.copy(color);
            return;
        }
        const ch = this.chases[newest];
        this.u[`chaseCol${newest}`].value.lerp(color, strength / (ch.strength + strength));
        ch.strength = Math.min(2.2, ch.strength + strength * 0.5);
        this.u[`chase${newest}`].value.z = ch.strength;
    }

    /**
     * Lines cleared (one call per cascade wave): one shell per line from the barge, the first in
     * the locking piece's colour; four lines, a finale closed by a gold willow. The show has
     * memory: the chain (`combo`), the wave's depth and the heat of play add shells, size and
     * stars, graduate their kinds (glitter, then willows) and tighten the volley, and each wave
     * bursts higher and fuller than the last. A T-spin whirls the wheel under a lilac ring; a
     * back-to-back fires the salute.
     * @param {number} [lines]
     * @param {{ cascade?: number, combo?: number, tspin?: boolean, b2b?: boolean }} [info]
     */
    onLineClear(lines = 1, {
        cascade = 1, combo = 0, tspin = false, b2b = false,
    } = {}) {
        this.notePlay();
        const n = Math.max(1, Math.min(4, lines | 0));
        const depth = Math.max(1, cascade | 0);
        const t = this.time;
        const fw = this.fireworks;
        const r = this.rand;
        this.surge.clear({
            lines: n, cascade: depth, combo, tspin, b2b,
        }, t);
        const { level } = this.heat;
        const reduced = (this.motion ?? 1) < 0.5;
        const wave = Math.min(depth - 1, 4);
        const chain = Math.max(0, (combo | 0) - 1);
        const stars = Math.round(this.q.stars0 * (reduced ? 0.6 : 1) * (1 + 0.25 * level + 0.05 * wave));
        const high = wave * 0.22;
        const pick = () => new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]);
        if (b2b) this.b2bStreak += 1;
        else if (depth === 1 && n < 4 && !tspin) this.b2bStreak = 0;
        if (tspin) {
            this.spin.hit(1, t);
            this.runChase(RIM_BOTTOM, LILAC, 1.2);
        }
        if (n < 4) {
            const kinds = ['peony', 'ring', 'chrys'];
            // The chain and the cascade add shells to the volley (none to a plain clear): a
            // cascade's deeper waves always fire more than its first, however long the chain.
            const extra = reduced ? 0 : Math.min(3, Math.floor(chain / 3)) + Math.min(wave, 2);
            const shells = n + extra;
            const gap = 0.32 - 0.1 * level;
            const scale = 0.85 + n * 0.08 + 0.12 * level + 0.06 * wave;
            for (let k = 0; k < shells; k += 1) {
                let kind = kinds[k % 3];
                if (k >= n) kind = chain >= 5 && k === shells - 1 ? 'willow' : 'chrys';
                let color = k === 0 ? this.lastLockColor : pick();
                if (tspin && k === 0) {
                    kind = 'ring';
                    color = LILAC;
                }
                fw.launch(t, {
                    color,
                    kind,
                    scale,
                    delay: k * gap,
                    stars: kind === 'willow' ? Math.round(stars * 0.6) : stars,
                    high,
                });
            }
            this.duskTarget = Math.min(1, this.duskTarget + 0.004 * n);
        } else {
            // The finale: a volley over a second and a half (fuller and quicker as play heats), a
            // gold willow to close (its sky glow gold too).
            const shells = reduced ? Math.min(3, this.q.finale) : this.q.finale + Math.round(level * 2);
            const gap = 0.24 - 0.06 * level;
            const kinds = ['chrys', 'peony', 'ring', 'peony', 'chrys', 'ring', 'peony', 'chrys'];
            for (let k = 0; k < shells; k += 1) {
                fw.launch(t, {
                    color: k === 0 ? this.lastLockColor : pick(),
                    kind: kinds[k % kinds.length],
                    scale: 1.05 + r() * 0.2 + 0.1 * level,
                    delay: k * gap,
                    stars,
                    high,
                });
            }
            fw.launch(t, {
                kind: 'willow',
                color: WILLOW_GOLD,
                scale: 1.3,
                delay: shells * gap + 0.2,
                stars: Math.round(stars * 1.3),
            });
            this.duskTarget = Math.min(1, this.duskTarget + 0.02);
        }
        if (b2b) this.salute(stars);
        // Each cascade wave past the first sends a band round the rims, brighter the deeper.
        if (wave > 0) this.runChase(RIM_BOTTOM, this.lastLockColor, 1 + 0.25 * wave);
    }

    /**
     * Back-to-back: the salute. A row of rings across the free sky bursting together in the
     * wheel's neon colours, one more for each back-to-back in a row (two to five), and both rims
     * ringing round.
     */
    salute(stars) {
        const rings = Math.min(5, 1 + this.b2bStreak);
        for (let k = 0; k < rings; k += 1) {
            this.fireworks.launch(this.time, {
                kind: 'ring',
                color: k % 2 ? MINT : PINK,
                scale: 1.15,
                delay: 0.12,
                rise: 1.2,
                x: -0.42 + (0.84 * k) / (rings - 1),
                high: 0.5,
                stars: Math.round(stars * 0.8),
            });
        }
        this.runChase(RIM_BOTTOM, PINK, 1.3);
        this.runChase(RIM_BOTTOM + Math.PI, MINT, 1.3);
    }

    /** A T-spin that cleared nothing: the wheel whirls a little and a lilac band runs round. */
    onTSpin() {
        this.notePlay();
        this.spin.hit(0.5, this.time);
        this.runChase(RIM_BOTTOM, LILAC, 1.2);
        this.surgeBonus('tspin', 0.45);
    }

    /**
     * The perfect clear: the crown over the clear still in the air (physics sends it ~0.36 s after
     * the clear's last wave), never a second clear. A curtain of gold willows across the free
     * sky, the rims ringing round in gold, the whole bay at full blaze, shooting stars.
     */
    onPerfectClear() {
        this.notePlay();
        const t = this.time;
        this.crown.hit(1, t);
        this.surgeBonus('perfect');
        const reduced = (this.motion ?? 1) < 0.5;
        const count = reduced ? 2 : Math.min(5, Math.max(3, this.q.finale - 2));
        const stars = Math.round(this.q.stars0 * (reduced ? 0.6 : 1) * 0.9);
        for (let k = 0; k < count; k += 1) {
            this.fireworks.launch(t, {
                kind: 'willow',
                color: WILLOW_GOLD,
                scale: 1.2,
                delay: 0.25 + k * 0.07,
                rise: 1.3,
                x: -0.45 + (0.9 * k) / (count - 1),
                high: 0.7,
                stars,
            });
        }
        this.runChase(RIM_BOTTOM, WILLOW_GOLD, 1.3);
        this.runChase(RIM_BOTTOM + Math.PI, WILLOW_GOLD, 1.3);
        this.queueShootingStars(2);
    }

    /** One event's own worth added to the surge (an event whose clear already counted its lines). */
    surgeBonus(kind, scale = 1) {
        const punch = SURGE_WEIGHTS.punch[kind] * scale;
        const heat = SURGE_WEIGHTS.heat[kind] * scale;
        if (punch > 0) this.surge.punch.hit(punch, this.time);
        if (heat > 0) this.surge.level.hit(heat, this.time);
    }

    /**
     * The true combo (consecutive clearing locks; 0 when the chain broke). Each link lifts the
     * train a notch (milestones send shooting stars over the bay); a chain built during a ride
     * charges the lift for the train's return. A chain of three or more that breaks sends it
     * round the circuit, faster and with a longer trail for a longer chain, twice round from
     * ten, the wheel's rims ringing round with the riders' cheer.
     */
    onChain(count) {
        this.notePlay();
        const c = this.coaster;
        const n = Math.max(0, count | 0);
        if (n > 0) {
            if (n > c.notch && SHOOT_MILESTONES.has(n)) this.queueShootingStars(n >= 10 ? 2 : 1);
            c.notch = n;
            if (c.mode !== 'ride') c.mode = 'lift';
            return;
        }
        const chain = c.notch;
        c.notch = 0;
        if (c.mode === 'ride') {
            // A chain built and broken during a ride: its energy sends the train round again.
            if (chain >= 3) {
                c.laps = Math.min(c.laps + 1, c.lap + 2);
                this.cheer(chain);
            }
            return;
        }
        if (c.mode !== 'lift') return;
        if (chain >= 3) {
            c.mode = 'ride';
            c.lap = 0;
            c.laps = chain >= 10 ? 2 : 1;
            c.launch = 3 + Math.min(chain - 3, 9) * 0.5;
            c.trail = Math.max(12, 34 - (chain - 3) * 2.5);
            this.cheer(chain);
        } else {
            c.mode = 'idle';
        }
    }

    /** The riders' cheer as the train is let go: the wheel's rims ring round in sympathy. */
    cheer(chain) {
        const strength = Math.min(1.5, 0.9 + chain * 0.05);
        this.runChase(RIM_BOTTOM, LEMON, strength);
        if (chain >= 6) this.runChase(RIM_BOTTOM + Math.PI, MINT, strength);
    }

    /** Cascade depth (bus COMBO): each wave's own clear already builds on the last. */
    onCombo() {
        this.notePlay();
    }

    /** A level: the evening steps on, the neon ring turns on to its next colour, two shells go up. */
    onLevelUp() {
        this.notePlay();
        this.duskTarget = Math.min(1, this.duskTarget + DUSK.levelStep);
        // Always forward: a second level mid-turn carries it on to the colour after.
        this.neonTarget = Math.floor(this.neonTarget + 1e-6) + 1;
        this.surge.levelUp(this.time);
        const t = this.time;
        this.fireworks.launch(t, {
            kind: 'ring', color: new THREE.Color(FIREWORK_COLORS[1]), scale: 1.1, stars: this.q.stars0,
        });
        this.fireworks.launch(t, {
            kind: 'peony', color: new THREE.Color(FIREWORK_COLORS[0]), scale: 1.1, delay: 0.3, stars: this.q.stars0,
        });
    }

    /** Shooting stars to send as soon as a slot is free (none under reduced motion). */
    queueShootingStars(count) {
        if (!this.q.shooting) return;
        this.pendingShoots = Math.min(4, this.pendingShoots + count);
    }

    /**
     * A streak across the upper sky, in (azimuth, elevation) space around the current view, in a
     * free slot (false when both are still streaking: a star is never cut off mid-flight).
     */
    spawnShootingStar(intensity = 1) {
        if (!this.q.shooting) return false;
        let slot = -1;
        for (let i = 0; i < this.shoots.length; i += 1) {
            const age = this.time - this.shoots[i].t0;
            if (age < 0 || age > this.shoots[i].life) {
                slot = i;
                break;
            }
        }
        if (slot < 0) return false;
        const s = this.shoots[slot];
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
        return true;
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
