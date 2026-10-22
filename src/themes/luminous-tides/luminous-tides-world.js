/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — the glowing shore: the world.
 *
 * The eye stands on wet sand at the edge of the swash on a night beach. The sea in front of it is
 * full of plankton that flash blue when the water is shaken: the surf breaks in lines of light, the
 * bores run in glowing, the swash runs up the sand with a burning edge and drains back leaving lace,
 * and everything else is dark water mirroring the night. Low over the sea on the left a far coast
 * glows warm and lays the streaks of its lamps on the water; on the right the beach curves away
 * under palms to a forested headland. Everything is built here and shared with the playground
 * effect (src/playground/effects/luminous-tides.effect.js), so what is iterated there ships.
 *
 * Parts (showOnlyParts names): sky, shore, land, glows, rain.
 *
 * What the board does to it:
 *   lock        a drop of the piece's colour falls out of the night into the surf beside the card
 *               (lower pieces nearer, higher pieces further out) and bursts in a crown of glowing
 *               droplets; the water round it flares blue and its sparks die away.
 *   hard drop   the drop falls from higher and lands hard: a taller crown, a wider flare.
 *   clear       the sea throws a wave of light for every line: it stands up glowing beside the card,
 *               breaks, the break running along the shore both ways, and its bore and swash run in
 *               and up the sand toward the eye.
 *   T-spin      a shoal of fish darts through the shallows, each streaking light behind it.
 *   four lines  a great set wave stands up out in the bay, glowing from within, breaks along the
 *               whole shore and floods the beach to the eye's feet.
 *   perfect     the same, and the whole bay lights to the horizon for a while.
 *   combo       a chain brings rain: a sprinkle, a shower, a downpour, every drop a spark on the sea.
 *   level up    the night turns on (the wheel below), and the bay shimmers once.
 *   cascade     each wave of a cascade throws a bigger, brighter, faster wave than the last; one
 *               right on the heels of the last feeds the wave still standing up instead.
 *   back-to-back  the wave peels along the shore half again as fast and the whole bay shimmers,
 *               more for every back-to-back in a row.
 *   T-spin, no lines  a small school of fish darts through the shallows.
 *
 * Nothing the board does restarts what is already lit: a full table of waves makes room by
 * fading out the faintest (one that has run up the sand and is draining), never a great set wave
 * mid-run, and when every wave is still bright the new one's light feeds the youngest instead; a
 * splash makes room the same way; a crown never takes a droplet still in the air; a T-spin while
 * every school is running sends more fish after the youngest. A perfect clear that settles after
 * its clear (the game sends it a moment later) crowns the great wave still running (it swells and
 * burns brighter, and the bay lights) instead of throwing a second one.
 *
 * And the play builds (src/themes/shared/gameplay-surge.js): the hotter the hands, the more the
 * sea is shaken. Calm: as it is. Warm: the surf's own breakers burn brighter and the waves the
 * board throws stand a little taller. Hot: the calm water between the breakers sparks where its
 * ripples tip, the squall's rain stops dimming the night and lights the sea instead. Fever: the
 * whole bay burns, the downpour doubles into a rain of sparks, and the cloud thins over the
 * stars. A perfect clear crowns it; when the hands rest the sea breathes back to dark.
 *
 * And the clock turns the night by itself (NIGHTS in the core: six nights on a wheel, one every
 * NIGHT_SECONDS, resting a little on each), in every mode, the ones that never level included; a
 * level carries it one night further on top, eased. Nothing turns it back.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    DEG, EYE, NIGHTS, NIGHT_COLOURS, NIGHT_SECONDS, SURF, TURN_SECONDS, approach, clamp, clamp01, fromShore, lerp,
    lightAt, mulberry32, pieceLight, runup, sandHeight, smooth, surfHeight, toShore, turnOffset,
} from './luminous-tides-core.js';
import { tierFor } from './luminous-tides-quality.js';
import {
    REST_RIG, boardFor, boardPoint, cardFor, fallbackLayout, fovForAspect,
} from './luminous-tides-composition.js';
import { aimClear, aimLanding, frameFor } from './luminous-tides-frame.js';
import {
    createLight, createSeaNoise, createSkyNoise, tune,
} from './luminous-tides-tsl.js';
import { createSky } from './luminous-tides-sky.js';
import { createShore } from './luminous-tides-shore.js';
import { createLand } from './luminous-tides-land.js';
import { createGlows, createRain } from './luminous-tides-glows.js';
import { writeSpray } from './luminous-tides-spray.js';

export { REST_RIG, fovForAspect };

/** The parts a capture can show alone. */
export const LUMINOUS_TIDES_PARTS = Object.freeze(['sky', 'shore', 'land', 'glows', 'rain']);

/** A drop falls this long from the night into the surf. */
export const FALL_SECONDS = 0.42;
/** A splash lights the water this long. */
const SPLASH_LIFE = 9;
/** A crown's droplets fall back within this long. */
const DROP_LIFE = 1.3;
/** Gravity for the droplets (metres a second squared). */
const GRAVITY = 9.81;
/** How long a fish shoal takes to cross. */
const SHOAL_SECONDS = 3.4;
/** The wet sand the drops may land on reaches this far up the beach (metres from the waterline). */
const WET_REACH = runup(SURF.height) * 0.85;
/** A wave of light or a splash that has to make room fades out over this long instead of vanishing. */
const RETIRE_SECONDS = 0.8;
/** Rows the shaders' tables keep beyond the tier, for what is fading out. */
export const SPARE_BREAKERS = 2;
export const SPARE_SPLASHES = 3;
/** A wave makes room for a new one only once it has run this long (until then a new one feeds it). */
const RETIRE_AFTER = 1.2;
/** A clear this soon after the last wave was thrown (a cascade's next wave) feeds that wave instead. */
const JOIN_SECONDS = 0.45;
/** The most a wave of light can be fed up to: its strength, and how tall a wave or a great wave grows. */
const WAVE_STRENGTH_CAP = 1.9;
const WAVE_H_CAP = 1.45;
const GREAT_H_CAP = 2.9;
/** A wave fed by one that found no room takes this share of its light (the rest goes into its size). */
const FEED_SHARE = 0.22;
/** A wave fed this tall counts as a great set wave (it is never retired mid-run). */
const GREAT_H = 1.6;
/** Schools of fish in the shallows at once, and how many times the tier's fish one can grow to. */
const SCHOOLS = 2;
const SCHOOL_GROWTH = 2;
/** A school is gone this long after its last fish set off (the slowest crosses in 1.25 × SHOAL_SECONDS, after a lag of up to 0.9 s). */
const SCHOOL_LIFE = SHOAL_SECONDS * 1.25 + 0.95;

/** How hard the rain falls for a chain of `combo` clears (0..1): none below two. */
export function rainForCombo(combo) {
    if (combo < 2) return 0;
    return clamp01(0.2 + (combo - 2) * 0.17);
}

/** Seconds a wave of light thrown `s0` metres out at `speed` lives, swash and all, for its height. */
function waveLife(s0, speed, H) {
    const top = Math.sqrt((2 * runup(H * 1.6)) / 0.73);
    return s0 / speed + 2 * top + 3;
}

/** 1 while a wave or a splash is lit, easing to 0 over RETIRE_SECONDS once it is retired. */
function fadeOf(item, now) {
    return item.retireAt === Infinity ? 1 : 1 - smooth(item.retireAt, item.retireAt + RETIRE_SECONDS, now);
}

/** Remove `list[i]` in place (no new array). */
function removeAt(list, i) {
    for (let k = i; k < list.length - 1; k += 1) list[k] = list[k + 1];
    list.length -= 1;
}

const tmpRay = new THREE.Vector3();
const shoreTmp = { a: 0, s: 0 };
const shoalTmp = { a: 0, s: 0 };
const worldTmp = { x: 0, z: 0 };

export class LuminousTidesWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]   built for a deterministic capture (reported in getState)
     * @param {number} [p.seed]
     * @param {number} [p.night]   hold the wheel at this place (0..6: 0 afterglow, 1 harbour, 2 starfield,
     *                             3 deep, 4 blue hour, 5 sea mist; fractions are on the way)
     * @param {object} [p.tune]    overrides for TUNE (the playground's P.<name>=)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 31, night = null, tune: overrides = null,
    }) {
        tune(overrides);
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.seed = seed;
        this.rand = mulberry32(seed);
        this.group = new THREE.Group();
        this.group.name = 'luminous-tides-world';
        this.parts = {};
        this.camera = null;
        this.aspect = 16 / 9;
        this.viewport = { w: 1920, h: 1080 };
        this.layout = null;
        this.reducedMotion = false;
        /** The frame's time (the camera breathes on it) and the world's own clock. */
        this.time = 0;
        this.clock = 0;
        this.frame = frameFor(this.aspect, null);
        /** How far the levels have turned the wheel: eased from `from` to `to` over `seconds` from `at`. */
        this.turn = {
            from: 0, to: 0, at: -100, seconds: TURN_SECONDS, pin: Number.isFinite(night) ? night : null,
        };
        this.light = lightAt(0);
        this.lightRows = NIGHT_COLOURS.map(() => new THREE.Vector4(0, 0, 0, 0));
        this.U = {
            time: uniform(0),
            light: createLight(uniformArray(this.lightRows, 'vec4')),
            /** Toward the far coast's glow (unit, level). */
            warmDir: uniform(new THREE.Vector3(-0.47, 0, -0.88)),
            warmth: uniform(1),
            stars: uniform(0.5),
            milky: uniform(0),
            cover: uniform(0.5),
            haze: uniform(0.15),
            /** How far the night sky has turned (radians). */
            starTurn: uniform(0),
            drift: uniform(new THREE.Vector2(0, 0)),
            /** 1 clear; under rain the sky and the air dim. */
            squallDim: uniform(1),
            /** How hard the rain falls (0..1). */
            rain: uniform(0),
            /** A perfect clear lights the whole bay (0..1); so does a fever, in part. */
            bayBloom: uniform(0),
            glowPower: uniform(1),
            /** How shaken the sea is by the play (0 calm): the surf burns brighter, the calm water sparks. */
            stir: uniform(0),
            /** Radians a pixel spans. */
            pixelAngle: uniform(0.0008),
            /** x: live splashes, y: live waves of light. */
            counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        };
        // Each table keeps a few spare rows for what is fading out to make room.
        const splashRows = (this.tier.splashes + SPARE_SPLASHES) * 2;
        const breakerRows = (this.tier.breakers + SPARE_BREAKERS) * 2;
        this.splashRows = Array.from({ length: splashRows }, () => new THREE.Vector4(0, 0, -100, 0));
        this.breakerRows = Array.from({ length: breakerRows }, () => new THREE.Vector4(0, 0, -100, 0));
        this.rows = {
            splashes: uniformArray(this.splashRows, 'vec4'),
            breakers: uniformArray(this.breakerRows, 'vec4'),
        };
        /** Splashes: { x, y, z, t0 (impact), strength, radius, rgb, height (of the fall), retireAt }. */
        this.splashes = [];
        /**
         * Waves of light: { a0, s0, t0, strength, H, Hto (it grows toward), speed, sBreak, peel, life,
         * great, born (when thrown), retireAt, fade }.
         */
        this.breakers = [];
        /** Droplets: [x, y, z, vx, vy, vz, born, r, g, b] each; a crown takes only the ones that have fallen. */
        this.drops = new Float32Array(this.tier.drops * 10).fill(-100);
        this.dropCursor = 0;
        /**
         * The schools of fish a T-spin sends: when each set off, where it runs (shore a, s), and when
         * each of its fish set off (fish join a running school from where it started).
         */
        this.schools = Array.from({ length: SCHOOLS }, () => ({
            at: -100,
            until: -100,
            a0: 0,
            a1: 0,
            s0: 8,
            s1: 4,
            seed: 0,
            n: 0,
            glow: 1,
            start: new Float32Array(this.tier.fish * SCHOOL_GROWTH),
        }));
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), as of the last frame; the post's
         * flash (every clear adds to what is still lit); the bay's sigh when a long chain ends.
         */
        this.surge = new GameplaySurge();
        this.heat = this.surge.sample(-100);
        this.flash = new Swell({ release: 1 / 3.5, ceiling: 0.5, knee: 0.32 });
        this.exhale = new Swell({ attack: 0.5, release: 3.5, ceiling: 0.45 });
        /** How far the squall's rain has stopped dimming the night (0: it dims as ever). */
        this.clearing = 0;
        /** The eye's kick, eased from the surge's punch. */
        this.kick = 0;
        /** Back-to-backs in a row. */
        this.b2bRun = 0;
        this.state = {
            combo: 0,
            level: 1,
            rain: 0,
            bloom: 0,
            rainClock: 0,
            locks: 0,
            clears: 0,
            waves: 0,
            shoals: 0,
            pitch: null,
            yaw: null,
        };
        this._point = { x: 0.5, y: 0.5 };
        this._landing = { x: 0.5, y: 0.9 };
        this._aim = { x: 0.2, y: 0.6 };
        this._hit = { x: 0, y: 0, z: 0 };
        this._jitter = [0, 0];
        this._rgb = [0.2, 0.62, 1];
        this._sprayCount = 0;
        this._pushSpray = (x, y, z, r, red, green, blue, vx, vy, vz) => {
            this.parts.glows.push(x, y, z, r, red, green, blue, 0, vx, vy, vz, 0.03);
        };
        this.applyNight();
    }

    build() {
        const { tier, U } = this;
        this.skyNoise = createSkyNoise(tier.skyNoise);
        const sea = createSeaNoise(tier.seaNoise);
        this.seaNoise = sea.map;
        this.parts.sky = createSky({ tier, noise: this.skyNoise, U });
        this.parts.shore = createShore({
            tier, U, rows: this.rows, skyNoise: this.skyNoise, seaNoise: this.seaNoise, seaVariance: sea.variance,
        });
        this.parts.land = createLand({ tier, U, skyNoise: this.skyNoise });
        // Glows: every droplet, a falling drop's streak and flash per splash, the schools (a head and
        // a tail a fish, each school grown to its fullest), the spray.
        const glowCapacity = tier.drops + (tier.splashes + SPARE_SPLASHES) * 3 + tier.fish * 2 * SCHOOL_GROWTH * SCHOOLS
            + tier.spray;
        this.parts.glows = createGlows({ capacity: glowCapacity, U });
        this.parts.rain = createRain({ count: tier.streaks, U, seed: this.seed + 5 });
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

    /** Put the world at `time` with nothing in flight, at the place on the wheel the clock alone gives. */
    seek(time) {
        this.time = Math.max(0, time);
        this.clock = this.time;
        this.resetSession();
        this.restoreWheel(0);
        this.state.pitch = null;
        this.state.yaw = null;
        this.applyNight();
    }

    /**
     * A new run: nothing in the air or on the water, no chain, no rain. The clock runs on, and with
     * it the night, from where the last run left it: nothing turns it back.
     */
    resetSession() {
        const s = this.state;
        s.combo = 0;
        s.level = 1;
        s.rain = 0;
        s.bloom = 0;
        s.locks = 0;
        s.clears = 0;
        s.waves = 0;
        s.shoals = 0;
        this.splashes.length = 0;
        this.breakers.length = 0;
        this.drops.fill(-100);
        this.dropCursor = 0;
        this.schools.forEach((school) => {
            school.at = -100;
            school.until = -100;
            school.n = 0;
        });
        this.surge.reset();
        this.heat = this.surge.sample(this.clock);
        this.flash.reset();
        this.exhale.reset();
        this.clearing = 0;
        this.kick = 0;
        this.b2bRun = 0;
        this.U.rain.value = 0;
        this.U.bayBloom.value = 0;
        this.U.stir.value = 0;
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const s = this.state;
        const fov = fovForAspect(this.aspect);
        const tanV = Math.tan((fov * DEG) / 2);
        const pitchTarget = Math.atan((2 * this.frame.horizon - 1) * tanV) / DEG;
        const yawTarget = this.frame.yaw;
        if (s.pitch === null) {
            s.pitch = pitchTarget;
            s.yaw = yawTarget;
        } else {
            const k = approach(1.2, sim.delta);
            s.pitch += (pitchTarget - s.pitch) * k;
            s.yaw += (yawTarget - s.yaw) * k;
        }
        const t = sim.time;
        const still = this.reducedMotion ? 0 : 1;
        // Standing: a breath lifts the eye a little, the head drifts a hair.
        const breath = still * Math.sin(t * 1.4) * 0.012;
        const drift = still * (Math.sin(t * 0.17) * 0.6 + Math.sin(t * 0.11 + 1.3) * 0.4);
        const px = still * (sim.pointerX || 0);
        const py = still * (sim.pointerY || 0);
        // Every hit of play lifts the eye a touch, eased (a quick rise, the surge's fall): under a
        // quick hand it rides a little higher instead of jolting.
        this.kick += (this.heat.punch - this.kick) * approach(14, sim.delta);
        const kick = still * Math.min(1.2, this.kick);
        const yaw = (s.yaw + drift * 0.3 + px * 1.6) * DEG;
        const pitch = (s.pitch + drift * 0.08 - py * 0.9 + kick * 0.18) * DEG;
        camera.position.set(EYE.x + px * 0.15, EYE.y + breath + kick * 0.025, EYE.z);
        camera.up.set(0, 1, 0);
        tmpRay.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(camera.position.x + tmpRay.x, camera.position.y + tmpRay.y, camera.position.z + tmpRay.z);
        // The shared breath (shared/camera-breath.js) on top of the drift above: off under reduced motion.
        applyCameraBreath(camera, t, { scale: still });
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }

    /** A screen point (fractions, y down) → the world ray through it (unit). */
    screenRay(x, y, out = tmpRay) {
        const { camera } = this;
        return out.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    }

    /**
     * Where a screen point's ray meets the ground or the still water (clamped to `near`..`far`
     * metres out), as world (x, y, z) with its shore (a, s).
     */
    castShore(x, y, near = 2.5, far = 90, out = this._hit) {
        const { camera } = this;
        const ray = this.screenRay(x, y);
        const p = camera.position;
        let t = ray.y < -1e-4 ? -p.y / ray.y : far * 4;
        for (let i = 0; i < 3; i += 1) {
            const hx = p.x + ray.x * t;
            const hz = p.z + ray.z * t;
            toShore(hx, hz, shoreTmp);
            const ground = Math.max(0, sandHeight(shoreTmp.s));
            if (ray.y < -1e-4) t = (ground - p.y) / ray.y;
        }
        const flat = Math.hypot(ray.x, ray.z) * t;
        if (flat > far) t *= far / flat;
        if (flat < near) t *= near / Math.max(flat, 1e-3);
        out.x = p.x + ray.x * t;
        out.z = p.z + ray.z * t;
        toShore(out.x, out.z, shoreTmp);
        out.a = shoreTmp.a;
        out.s = shoreTmp.s;
        out.y = Math.max(0, sandHeight(out.s));
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

    /** A piece's colour as the light its drop falls with. */
    rgbOf(color) {
        return pieceLight(color, [0.2, 0.62, 1]);
    }

    /** How much light a splash still has at `now` (its burst, its glow, its slow tail). */
    splashLight(sp, now) {
        const age = now - sp.t0;
        if (age < 0) return sp.strength * 4; // still falling: it has all of it to come
        const left = 1.8 * Math.exp(-age / 0.18) + 0.7 * Math.exp(-age / 1.6) + 0.12 * Math.exp(-age / 5);
        return sp.strength * left * fadeOf(sp, now);
    }

    /** A drop lands at (x, z) at `at` (its fall has started FALL_SECONDS before). */
    addSplash(x, z, at, strength, radius, rgb, height) {
        const { clock, splashes } = this;
        // Full: the faintest splash still lit makes room by fading out (never the newest's light).
        let live = 0;
        let faint = null;
        for (let i = 0; i < splashes.length; i += 1) {
            const sp = splashes[i];
            if (sp.retireAt !== Infinity || clock - sp.t0 > SPLASH_LIFE) continue;
            live += 1;
            if (!faint || this.splashLight(sp, clock) < this.splashLight(faint, clock)) faint = sp;
        }
        if (live >= this.tier.splashes && faint) faint.retireAt = clock;
        // No row free: the one furthest through its fade (all but gone) leaves now.
        if (splashes.length >= this.splashRows.length / 2) {
            let gone = -1;
            for (let i = 0; i < splashes.length; i += 1) {
                const light = this.splashLight(splashes[i], clock);
                if (gone < 0 || light < this.splashLight(splashes[gone], clock)) gone = i;
            }
            removeAt(splashes, gone);
        }
        toShore(x, z, shoreTmp);
        const y = Math.max(sandHeight(shoreTmp.s) + 0.01, surfHeight(shoreTmp.a, shoreTmp.s, at) + 0.02);
        splashes.push({
            x, y, z, t0: at, strength, radius, rgb: [rgb[0], rgb[1], rgb[2]], height, retireAt: Infinity,
        });
        this.crown(x, y, z, at, strength, rgb);
    }

    /**
     * The next droplet slot that is free (its droplet has fallen back, or never flew), or -1 when
     * every droplet is still in the air: a crown never takes one mid-flight, it throws fewer.
     */
    freeDrop() {
        const cap = this.drops.length / 10;
        const { clock, drops } = this;
        for (let tries = 0; tries < cap; tries += 1) {
            const k = this.dropCursor * 10;
            this.dropCursor = (this.dropCursor + 1) % cap;
            const age = clock - drops[k + 6];
            if (age > DROP_LIFE) return k;
            // Fallen back below where it was thrown from: drawn no more.
            if (age >= 0 && drops[k + 4] * age - 0.5 * GRAVITY * age * age < -0.15) return k;
        }
        return -1;
    }

    /** A crown of droplets thrown up from (x, y, z) at `at`, and the jet that climbs out of its middle. */
    crown(x, y, z, at, strength, rgb) {
        const cap = this.drops.length / 10;
        const n = Math.round(clamp(cap / 10, 8, 40) * clamp(strength, 0.4, 2));
        const sea = this.light.glow;
        for (let i = 0; i < n + 3; i += 1) {
            const k = this.freeDrop();
            if (k < 0) break;
            const jet = i >= n;
            const ang = this.rand() * Math.PI * 2;
            const out = jet ? 0.05 * this.rand() : (0.5 + this.rand() * 0.9) * Math.sqrt(strength);
            const up = jet ? (2.0 + (i - n) * 0.3 + this.rand() * 0.3) * Math.sqrt(strength) : 1.1 + this.rand() * 1.5 * strength;
            this.drops[k] = x;
            this.drops[k + 1] = y;
            this.drops[k + 2] = z;
            this.drops[k + 3] = Math.cos(ang) * out;
            this.drops[k + 4] = up;
            this.drops[k + 5] = Math.sin(ang) * out;
            this.drops[k + 6] = at + (jet ? 0.12 + (i - n) * 0.03 : this.rand() * 0.04);
            // The piece's colour in the first droplets, the sea's own blue in the rest.
            const own = jet ? 0.25 : 0.55 * this.rand();
            this.drops[k + 7] = lerp(sea[0], rgb[0], own);
            this.drops[k + 8] = lerp(sea[1], rgb[1], own);
            this.drops[k + 9] = lerp(sea[2], rgb[2], own);
        }
    }

    /**
     * How much light a wave of light still has at `now`: all of it while it comes in and breaks,
     * then its swash running up the sand and draining away.
     */
    waveLight(b, now) {
        const age = now - b.t0;
        const ashore = b.s0 / b.speed;
        const lit = age <= ashore ? 1 : Math.exp(-(age - ashore) / 3.5);
        return b.strength * lit * fadeOf(b, now);
    }

    /** Whether a wave is still lit and not already making room. */
    waveLive(b, now) {
        return b.retireAt === Infinity && now - b.t0 <= b.life;
    }

    /**
     * Feed a live wave: it burns brighter (`amount`) and grows (`grow` metres taller, eased in over
     * a moment, and a little faster along its peel). It only ever gains.
     */
    feedBreaker(b, amount, grow) {
        b.strength = Math.min(WAVE_STRENGTH_CAP, b.strength + Math.max(0, amount));
        const cap = b.great ? GREAT_H_CAP : Math.max(WAVE_H_CAP, b.Hto);
        b.Hto = Math.max(b.Hto, Math.min(cap, b.Hto + Math.max(0, grow)));
        b.peel = Math.min(44, b.peel + 2);
        b.life = Math.max(b.life, waveLife(b.s0, b.speed, b.Hto));
    }

    /** The live wave thrown last (of a clear's waves, the last to set off), or null. */
    youngestBreaker(now = this.clock) {
        let best = null;
        for (let i = 0; i < this.breakers.length; i += 1) {
            const b = this.breakers[i];
            if (!this.waveLive(b, now)) continue;
            if (!best || b.born > best.born || (b.born === best.born && b.t0 > best.t0)) best = b;
        }
        return best;
    }

    /**
     * The live wave furthest through its run (thrown first: its bore is in, its swash is up the
     * sand and draining, the least of its light is left): a wave of the board's before a great
     * set wave.
     */
    oldestBreaker(now = this.clock) {
        let best = null;
        let bestGreat = null;
        for (let i = 0; i < this.breakers.length; i += 1) {
            const b = this.breakers[i];
            if (!this.waveLive(b, now)) continue;
            if (b.great) {
                if (!bestGreat || b.t0 < bestGreat.t0) bestGreat = b;
            } else if (!best || b.t0 < best.t0) best = b;
        }
        return best || bestGreat;
    }

    /**
     * A wave of light is thrown: it starts `s0` metres out at `a0` along the shore at `at`. Nothing
     * still lit vanishes for it: a full table makes room by fading out the wave furthest through
     * its run (its swash sinking into the sand), never a great set wave for one of the board's;
     * when every wave is still standing up (a burst of clears) or every spare row is busy fading,
     * the new one's light feeds the youngest instead. Returns the wave that carries it.
     */
    addBreaker(a0, s0, at, strength, {
        H = 0.9, speed = 4.4, sBreak = s0 - 2.6, peel = 22, great = false,
    } = {}) {
        const { clock, breakers } = this;
        const rows = this.breakerRows.length / 2;
        let live = 0;
        let held = 0; // rows taken: lit, or still fading out
        for (let i = 0; i < breakers.length; i += 1) {
            const b = breakers[i];
            if (this.waveLive(b, clock)) live += 1;
            if (clock - b.t0 <= b.life && fadeOf(b, clock) > 0) held += 1;
        }
        // Full, or every spare row is busy with a wave fading out: the oldest makes room once it
        // has come in (it fades as its swash sinks away); otherwise the new wave's light feeds the
        // youngest. A great set wave always stands up on its own: one of the board's makes room.
        if (live >= this.tier.breakers || held >= rows) {
            const faint = live >= this.tier.breakers ? this.oldestBreaker(clock) : null;
            const room = (held < rows || great) && faint && !(faint.great && !great)
                && (great || clock - faint.t0 > RETIRE_AFTER);
            if (!room) {
                const host = this.youngestBreaker(clock);
                if (host) {
                    this.feedBreaker(host, strength * FEED_SHARE, great ? 0.5 : 0.08);
                    if (great) host.great = true;
                    return host;
                }
                if (held >= rows) return null;
            }
            if (faint && room) faint.retireAt = clock;
        }
        // A row taken by a wave that is spent (gone since the last frame) is free again; a great
        // set wave with no row free takes the one furthest through its fade.
        if (breakers.length >= rows) {
            for (let i = breakers.length - 1; i >= 0; i -= 1) {
                const b = breakers[i];
                if (clock - b.t0 > b.life || fadeOf(b, clock) <= 0) removeAt(breakers, i);
            }
            if (breakers.length >= rows) {
                let gone = -1;
                for (let i = 0; i < breakers.length; i += 1) {
                    const b = breakers[i];
                    if (b.retireAt === Infinity) continue;
                    if (gone < 0 || this.waveLight(b, clock) < this.waveLight(breakers[gone], clock)) gone = i;
                }
                if (gone < 0) return null;
                removeAt(breakers, gone);
            }
        }
        const wave = {
            a0,
            s0,
            t0: at,
            strength: Math.min(WAVE_STRENGTH_CAP, strength),
            H,
            Hto: H,
            speed,
            sBreak,
            peel,
            life: waveLife(s0, speed, H),
            great,
            born: clock,
            retireAt: Infinity,
            fade: 1,
        };
        breakers.push(wave);
        return wave;
    }

    /** The wave thrown just now (a cascade's last wave) that a clear at `a` could feed, or null. */
    joinable(a) {
        const host = this.youngestBreaker(this.clock);
        if (!host || host.great || this.clock - host.born > JOIN_SECONDS || Math.abs(host.a0 - a) > 8) return null;
        return host;
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /** Where a lock's drop falls (world), from the layout or a meditation click. */
    aimDrop(c) {
        let landX = 0.22;
        let landY = 0.8;
        if (c.screen) {
            landX = c.screen.x;
            landY = Math.max(c.screen.y, this.frame.horizon + 0.08);
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
                landX = this._landing.x;
                landY = this._landing.y;
            }
        }
        const hit = this.castShore(landX, landY, 4.5, 45);
        // Keep it on water or on the wet sand: dry sand has no light in it.
        if (hit.s < -WET_REACH) {
            fromShore(hit.a, -WET_REACH * (0.55 + 0.35 * this.rand()), worldTmp);
            hit.x = worldTmp.x;
            hit.z = worldTmp.z;
            hit.s = -WET_REACH * 0.7;
        }
        return hit;
    }

    /** A piece locked: { player, rows, u, hardDrop, color, screen }. */
    onLock(c) {
        if (!this.camera) return;
        const s = this.state;
        s.locks += 1;
        const hard = c.hardDrop === true;
        const rgb = pieceLight(c.color, this._rgb);
        const hit = this.aimDrop(c);
        // The hotter the play, the harder the drops land.
        const { level } = this.heat;
        const strength = (hard ? 1.75 : 1) * (1 + 0.2 * level);
        const radius = (hard ? 0.7 : 0.45) * (1 + 0.2 * level);
        this.addSplash(hit.x, hit.z, this.clock + FALL_SECONDS, strength, radius, rgb, hard ? 9 : 6);
        this.surge.lock(c, this.clock);
    }

    /** Lines cleared: { player, rows, lines, combo, cascade, tspin, perfect, b2b, screen }. */
    onClear(c) {
        if (!this.camera) return;
        const s = this.state;
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
        const depth = Math.max(1, Math.min(12, Math.round(Number(c.cascade)) || 1));
        // The play as it stood before this clear (the clear itself builds on it from here).
        const { level } = this.heat;
        this.surge.clear(c, this.clock);
        if (c.b2b) this.b2bRun += 1;
        else if (depth === 1 && lines < 4 && !c.tspin) this.b2bRun = 0;
        // Where along the shore the waves are thrown from: beside the card at the cleared rows.
        let y = 0.62;
        let x = 0.2;
        if (c.screen) {
            ({ x } = c.screen);
            y = Math.max(c.screen.y, this.frame.horizon + 0.08);
        } else {
            const layout = this.aimLayout();
            const board = boardFor(layout, c.player || 0);
            if (board) {
                const rows = c.rows?.length ? c.rows : [19];
                let sum = 0;
                for (let i = 0; i < rows.length; i += 1) sum += rows[i];
                boardPoint(board, 0.5, sum / rows.length, this._point);
                const card = cardFor(layout, board) || board;
                aimClear(layout, card, clamp(this._point.y, this.frame.horizon + 0.1, 0.9), this._aim);
                ({ x, y } = this._aim);
            }
        }
        const hit = this.castShore(x, y, 8, 120);
        const a0 = hit.a;
        const { clock } = this;
        // A back-to-back throws harder, more for every one in a row; the deeper the cascade and the
        // hotter the play, the bigger, brighter and faster the waves.
        const run = Math.min(4, Math.max(0, this.b2bRun - 1));
        const b2b = c.b2b ? 1.25 + 0.12 * run : 1;
        const strength = b2b * (1 + 0.1 * (depth - 1) + 0.1 * level);
        const grow = 1 + 0.08 * (depth - 1) + 0.2 * level;
        const pace = 1 + 0.06 * (depth - 1);
        const peel = (c.b2b ? 1.5 : 1) * (1 + 0.08 * (depth - 1));
        const host = big ? null : this.joinable(a0);
        if (host) {
            // Right on the heels of the last wave (a cascade's next): it feeds the wave still
            // coming in, which stands up taller and burns brighter for it.
            this.feedBreaker(host, FEED_SHARE * lines * strength, 0.06 * lines + 0.05 * (depth - 1));
            this.flash.hit(0.03 + lines * 0.02, clock);
        } else if (big) {
            this.addBreaker(a0, 16, clock, 1.6 * strength, {
                H: 2.6 * (1 + 0.05 * level), speed: 4.2, sBreak: 9.5, peel: 30 * peel, great: true,
            });
            s.waves += 1;
            this.flash.hit(0.3, clock);
            // The whole bay lights: a frame-wide flash, so Reduce flashing scales it (ADR-0021).
            if (c.perfect) s.bloom = Math.max(s.bloom, flashScale());
        } else {
            for (let i = 0; i < lines; i += 1) {
                this.addBreaker(a0 - i * 3, 13 + i * 2.2, clock + (i * 0.5) / pace, strength, {
                    H: Math.min(WAVE_H_CAP, 0.85 * grow), speed: 4.2 * pace, sBreak: 10.8 + i * 2.2, peel: 22 * peel,
                });
                s.waves += 1;
            }
            this.flash.hit(0.04 + lines * 0.03, clock);
        }
        // A back-to-back: the whole bay shimmers, brighter for every one in a row.
        if (c.b2b) s.bloom = Math.max(s.bloom, (0.3 + 0.08 * run) * flashScale());
        if (c.tspin) this.sendShoal(1);
    }

    /**
     * A perfect clear that settled after its clear (the game sends it a moment after the last
     * wave): the crown on the great wave still running, not a second one. It swells taller and
     * burns brighter, and the whole bay lights.
     */
    onPerfect() {
        if (!this.camera) return;
        const { clock } = this;
        let host = null;
        for (let i = 0; i < this.breakers.length; i += 1) {
            const b = this.breakers[i];
            if (b.great && this.waveLive(b, clock) && (!host || b.born > host.born)) host = b;
        }
        host = host || this.youngestBreaker(clock);
        if (!host) {
            // No wave left running to crown: the sea throws the great one now.
            this.onClear({ lines: 4, perfect: true, rows: [19, 18, 17, 16] });
            return;
        }
        this.surge.crown(clock);
        this.state.bloom = Math.max(this.state.bloom, flashScale());
        this.flash.hit(0.22, clock);
        const grow = host.great ? 0.25 : Math.max(0.6, GREAT_H - host.Hto);
        host.great = true;
        this.feedBreaker(host, 0.5, grow);
    }

    /** A T-spin that cleared nothing: a small school darts through the shallows. */
    onSpin() {
        if (!this.camera) return;
        this.surge.spin(this.clock);
        this.flash.hit(0.03, this.clock);
        this.sendShoal(0.45);
    }

    /**
     * A school of fish darts through the shallows; `size` of a T-spin's full school. While every
     * school is still running, more fish set off after the youngest from where it started.
     */
    sendShoal(size = 1) {
        const s = this.state;
        const { clock } = this;
        s.shoals += 1;
        const count = Math.max(3, Math.round(this.tier.fish * size));
        let sh = null;
        let youngest = null;
        for (let i = 0; i < this.schools.length; i += 1) {
            const school = this.schools[i];
            if (clock >= school.until) {
                if (!sh) sh = school;
            } else if (!youngest || school.at > youngest.at) youngest = school;
        }
        if (!sh) {
            const to = Math.min(youngest.start.length, youngest.n + count);
            for (let i = youngest.n; i < to; i += 1) youngest.start[i] = clock;
            youngest.n = to;
            youngest.until = clock + SCHOOL_LIFE;
            youngest.glow = Math.min(1.6, youngest.glow + 0.15 * size);
            return;
        }
        const layout = this.aimLayout();
        const card = layout?.cards?.[0];
        const inner = card ? Math.max(0.06, card.x0 - 0.04) : 0.36;
        const from = this.castShore(0.02, 0.78 + this.rand() * 0.06, 2.5, 30);
        const fromA = from.a;
        const fromS = clamp(from.s, 2, 9);
        const to = this.castShore(inner, 0.9, 2.5, 30);
        sh.at = clock;
        sh.until = clock + SCHOOL_LIFE;
        sh.seed = this.rand();
        sh.a0 = fromA;
        sh.s0 = fromS;
        sh.a1 = to.a;
        sh.s1 = clamp(to.s, 1.4, 6);
        sh.n = Math.min(sh.start.length, count);
        sh.start.fill(clock, 0, sh.n);
        sh.glow = 1;
    }

    /**
     * The longest chain any board is holding (0 = it broke). A long chain's end is felt: the bay
     * sighs out a soft light as its rain eases off.
     */
    onCombo(combo) {
        const next = Math.max(0, combo | 0);
        const was = this.state.combo;
        if (next === 0 && was >= 4) this.exhale.hit((0.12 + 0.02 * Math.min(was, 12)) * flashScale(), this.clock);
        this.state.combo = next;
    }

    /**
     * A new level: the wheel turns one night further for every level gained, from where the last
     * turn was headed (never back). `silent`: it simply is that level.
     */
    levelUp(level, { silent = false } = {}) {
        const s = this.state;
        const { turn } = this;
        const next = Math.max(1, level | 0);
        if (silent) {
            this.restoreWheel(next - 1);
        } else if (next > s.level) {
            turn.from = this.turnOffset();
            turn.to += next - s.level;
            turn.at = this.clock;
            turn.seconds = TURN_SECONDS;
            s.bloom = Math.max(s.bloom, 0.28 * flashScale());
            this.surge.levelUp(this.clock);
        }
        s.level = next;
        this.applyNight();
    }

    // ── the night ───────────────────────────────────────────────────────────────

    /** How far the levels have turned the wheel (nights; eased while it turns). */
    turnOffset() {
        const { turn } = this;
        return turnOffset(turn.from, turn.to, this.clock - turn.at, turn.seconds);
    }

    /** Where a turn is headed: what a rebuild in place hands to the new world (restoreWheel). */
    wheelTarget() {
        return this.turn.to;
    }

    /** Stand the wheel on an offset at once (a rebuild in place picks the night up where it was). */
    restoreWheel(offset) {
        const { turn } = this;
        turn.from = Number.isFinite(offset) ? offset : 0;
        turn.to = turn.from;
        turn.at = -100;
        turn.seconds = TURN_SECONDS;
    }

    /** Where the night stands on its wheel (nights): the clock's own turn plus what the levels added. */
    wheel() {
        return this.turn.pin ?? this.clock / NIGHT_SECONDS + this.turnOffset();
    }

    /** Hand the night's light to the shaders. */
    applyNight() {
        const { U } = this;
        const light = lightAt(this.wheel(), this.light);
        for (let i = 0; i < NIGHT_COLOURS.length; i += 1) {
            const colour = light[NIGHT_COLOURS[i]];
            this.lightRows[i].set(colour[0], colour[1], colour[2], 0);
        }
        const { rain } = this.state;
        const { level, fever } = this.heat;
        // The squall dims the night only while play is cold: under a hot chain its rain stops
        // greying the sky and lights the sea instead, and in a fever the cloud thins over the
        // stars and the whole sea burns brighter.
        this.clearing = clamp01(smooth(0.2, 0.7, level) * 0.75 + fever * 0.4);
        const squall = rain * (1 - this.clearing);
        U.stars.value = light.stars * (1 - squall * 0.8) * (1 + 0.35 * fever);
        U.milky.value = light.milky * (1 - squall);
        U.cover.value = Math.min(1, light.cover + squall * 0.45) * (1 - 0.3 * fever);
        U.haze.value = light.haze + squall * 0.2;
        U.warmth.value = light.warmth * (1 - squall * 0.3);
        U.glowPower.value = light.glowPower * (1 + 0.05 * level + 0.1 * fever);
        U.squallDim.value = 1 - squall * 0.32;
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    update(sim, camera) {
        if (!this.parts.shore) return;
        const dt = Math.max(0, sim.delta);
        this.time = sim.time;
        const { U } = this;
        const s = this.state;
        this.clock += dt;
        U.time.value = this.clock;
        // How hot play runs, once a frame on the world's clock.
        const heat = this.surge.sample(this.clock);
        this.heat = heat;
        const { level, fever } = heat;

        // The rain follows the chain: it comes on in a few seconds and eases off slower. The
        // hotter the play, the more of its drops crown on the water, and the harder (past the
        // chain's own cap the downpour keeps growing with the heat).
        const want = rainForCombo(s.combo);
        s.rain += (want - s.rain) * approach(want > s.rain ? 0.9 : 0.32, dt);
        if (s.rain < 1e-3) s.rain = 0;
        U.rain.value = s.rain;
        if (this.camera && s.rain > 0.15) {
            s.rainClock += dt * s.rain * 9 * (1 + 0.5 * level + 1.1 * fever);
            const hard = 0.32 * (1 + 0.6 * fever);
            while (s.rainClock >= 1) {
                s.rainClock -= 1;
                const left = this.rand() < 0.62;
                const sx = left ? 0.02 + this.rand() * 0.34 : 0.74 + this.rand() * 0.24;
                const sy = 0.6 + this.rand() * 0.37;
                const hit = this.castShore(sx, sy, 2.5, 30);
                if (hit.s > -WET_REACH) this.crown(hit.x, hit.y + 0.01, hit.z, this.clock, hard, this.light.glow);
            }
        } else {
            s.rainClock = 0;
        }
        s.bloom *= Math.exp(-0.22 * dt);
        // The bay: a perfect clear's light, a fever's sea of fire under it, a long chain's sigh.
        U.bayBloom.value = s.bloom + (1 - Math.min(1, s.bloom)) * Math.min(1, this.exhale.valueAt(this.clock));
        // The sea is shaken by the play: its own surf burns brighter, the open bay sparks and in a
        // fever burns (the shore's stir).
        U.stir.value = 0.25 * level + 0.75 * fever;
        this.applyNight();
        // The night sky turns slowly; the cloud drifts in off the sea.
        U.starTurn.value = (this.clock * 0.0016) % (Math.PI * 2);
        U.drift.value.set(-this.clock * 0.0009, this.clock * 0.0003);

        this.writeRows(dt);
        this.updateGlows();
        if (camera) this.parts.sky.follow(camera);
    }

    /**
     * The live splashes and waves of light (and the ones fading out to make room), compacted into
     * the shaders' tables; what is spent leaves the lists. A fed wave grows toward its new height.
     */
    writeRows(dt = 0) {
        const { clock, splashes, breakers } = this;
        let n = 0;
        for (let i = 0; i < splashes.length; i += 1) {
            const sp = splashes[i];
            const fade = fadeOf(sp, clock);
            if (clock - sp.t0 > SPLASH_LIFE || fade <= 0) continue;
            splashes[n] = sp;
            this.splashRows[n * 2].set(sp.x, sp.z, sp.t0, sp.strength * fade);
            this.splashRows[n * 2 + 1].set(sp.rgb[0], sp.rgb[1], sp.rgb[2], sp.radius);
            n += 1;
        }
        splashes.length = n;
        let m = 0;
        const grow = approach(2.4, dt);
        for (let i = 0; i < breakers.length; i += 1) {
            const b = breakers[i];
            b.fade = fadeOf(b, clock);
            if (clock - b.t0 > b.life || b.fade <= 0) continue;
            b.H += (b.Hto - b.H) * grow;
            breakers[m] = b;
            this.breakerRows[m * 2].set(b.a0, b.s0, b.t0, b.strength * b.fade);
            this.breakerRows[m * 2 + 1].set(b.H, b.speed, b.sBreak, b.peel);
            m += 1;
        }
        breakers.length = m;
        this.U.counts.value.set(n, m, 0, 0);
    }

    /** The droplets, the falling drops, the shoal. */
    updateGlows() {
        const { glows } = this.parts;
        const { clock } = this;
        glows.begin();
        // The night's glow power, as the play has raised it.
        const power = this.U.glowPower.value;
        // The drops falling out of the night, in their pieces' colours.
        for (let i = 0; i < this.splashes.length; i += 1) {
            const sp = this.splashes[i];
            const left = sp.t0 - clock;
            if (left < 0 && left > -0.3) {
                // The flash where it goes in: the drop's colour in the sea's blue.
                const f = 0.9 * Math.exp(left / 0.06) * sp.strength * power;
                const sea = this.light.glow;
                glows.push(
                    sp.x,
                    sp.y + 0.06,
                    sp.z,
                    0.11 * sp.strength,
                    lerp(sea[0], sp.rgb[0], 0.5) * f,
                    lerp(sea[1], sp.rgb[1], 0.5) * f,
                    lerp(sea[2], sp.rgb[2], 0.5) * f,
                );
            }
            if (left < 0 || left > FALL_SECONDS) continue;
            const u = 1 - left / FALL_SECONDS;
            const y = sp.y + sp.height * (1 - u * u);
            const v = (2 * sp.height * u) / FALL_SECONDS;
            const c = 1.3 * (0.6 + 0.4 * u);
            glows.push(sp.x, y, sp.z, 0.03, sp.rgb[0] * c, sp.rgb[1] * c, sp.rgb[2] * c, 0, 0, -v, 0, 0.06);
        }
        // The droplets of the crowns, flung up and falling back, streaked by their speed.
        const nd = this.drops.length / 10;
        for (let i = 0; i < nd; i += 1) {
            const k = i * 10;
            const age = clock - this.drops[k + 6];
            if (age < 0 || age > DROP_LIFE) continue;
            const vy = this.drops[k + 4] - GRAVITY * age;
            const y = this.drops[k + 1] + this.drops[k + 4] * age - 0.5 * GRAVITY * age * age;
            if (y < this.drops[k + 1] - 0.15) continue;
            const fade = (1 - smooth(DROP_LIFE * 0.45, DROP_LIFE, age)) * (0.55 + 0.45 * Math.exp(-age * 3));
            const c = 2.0 * fade * power;
            glows.push(
                this.drops[k] + this.drops[k + 3] * age,
                y,
                this.drops[k + 2] + this.drops[k + 5] * age,
                0.024,
                this.drops[k + 7] * c,
                this.drops[k + 8] * c,
                this.drops[k + 9] * c,
                0,
                this.drops[k + 3],
                vy,
                this.drops[k + 5],
                0.022,
            );
        }
        // The spray off every breaking lip, and off the board's waves along their peel.
        const { glow } = this.light;
        this._sprayCount = writeSpray(clock, glow, power, this.breakers, this.tier.spray, this._pushSpray);
        // The schools: each fish a streak of light just under the surface, darting along the
        // shallows from when it set off (fish that joined a running school chase it from its start).
        for (let k = 0; k < this.schools.length; k += 1) this.drawSchool(this.schools[k], glows, power, glow);
        glows.end();
    }

    /** One school's fish into the glows. */
    drawSchool(sh, glows, power, glow) {
        const { clock } = this;
        if (clock < sh.at || clock >= sh.until) return;
        const bright = power * sh.glow;
        for (let i = 0; i < sh.n; i += 1) {
            const r = (k) => {
                const v = Math.sin((i + 1) * 12.9898 + k * 78.233 + sh.seed * 37.719) * 43758.5453;
                return v - Math.floor(v);
            };
            const lag = r(1) * 0.9;
            const pace = SHOAL_SECONDS * (0.75 + r(2) * 0.5);
            const u = clamp01((clock - sh.start[i] - lag) / pace);
            if (u <= 0 || u >= 1) continue;
            const along = (r(3) - 0.5) * 6;
            const across = (r(4) - 0.5) * 3.2;
            const wiggle = 0.9 + r(5) * 1.6;
            const phase = r(6) * 6.28;
            const at = (q) => {
                const e = q * q * (3 - 2 * q);
                shoalTmp.a = lerp(sh.a0, sh.a1, e) + along + Math.sin(e * 9 * wiggle + phase) * 0.35;
                shoalTmp.s = lerp(sh.s0, sh.s1, e) + across + Math.sin(e * 5 * wiggle + phase) * 0.9;
                return shoalTmp;
            };
            const here = at(u);
            const ha = here.a;
            const hs = Math.max(0.8, here.s);
            fromShore(ha, hs, worldTmp);
            const hx = worldTmp.x;
            const hz = worldTmp.z;
            const next = at(Math.min(1, u + 0.01));
            fromShore(next.a, Math.max(0.8, next.s), worldTmp);
            const vx = (worldTmp.x - hx) / (0.01 * pace);
            const vz = (worldTmp.z - hz) / (0.01 * pace);
            const yy = surfHeight(ha, hs, clock) + 0.02;
            const fade = smooth(0, 0.06, u) * (1 - smooth(0.8, 1, u));
            const head = 2.2 * fade * bright;
            const tail = 1.0 * fade * bright;
            glows.push(hx, yy, hz, 0.035, glow[0] * head, glow[1] * head, glow[2] * head);
            glows.push(hx, yy, hz, 0.02, glow[0] * tail, glow[1] * tail, glow[2] * tail, 0, vx, 0, vz, -0.16);
        }
    }

    /** What the post stack should know this frame. */
    getPostState() {
        const s = this.state;
        const L = this.light;
        const { level, fever, punch } = this.heat;
        const post = this._post || (this._post = {
            flash: 0, bloomBoost: 0, exposure: 1, rain: 0, gradeShadow: [0.92, 0.98, 1.1], gradeLight: [1.02, 1, 0.98],
        });
        // Every clear adds to the lift still lit; the play's punch rides under it.
        post.flash = this.flash.valueAt(this.clock) + punch * 0.05;
        // The bloom swells a little with the heat (the sea's own sparks carry the rest: a haze
        // over everything would wash the blues out).
        post.bloomBoost = s.bloom * 0.5 + s.rain * 0.15 + 0.1 * fever;
        // An iris: it closes a little as the sea burns hotter, so the blues stay deep and the night dark.
        post.exposure = L.exposure * (1 - 0.1 * Math.max(0, level - 0.2) - 0.06 * fever);
        // The lens greys only under a cold squall: a hot chain's rain is a rain of sparks.
        post.rain = s.rain * (1 - this.clearing);
        return post;
    }

    getState() {
        const s = this.state;
        const { clock } = this;
        let drops = 0;
        for (let i = 0; i < this.drops.length; i += 10) {
            const age = clock - this.drops[i + 6];
            if (age >= 0 && age <= DROP_LIFE) drops += 1;
        }
        return {
            quality: this.quality,
            capture: this.capture,
            time: this.time,
            clock,
            combo: s.combo,
            level: s.level,
            night: this.light.name,
            nightFrom: this.light.from,
            nightTo: this.light.to,
            nightMix: this.light.mix,
            nights: NIGHTS.length,
            wheel: this.wheel(),
            horizon: this.frame.horizon,
            rain: s.rain,
            bloom: s.bloom,
            splashes: this.U.counts.value.x,
            waves: this.U.counts.value.y,
            drops,
            shoal: this.schools.some((sh) => clock >= sh.at && clock < sh.until),
            fish: this.schools.reduce((n, sh) => n + (clock >= sh.at && clock < sh.until ? sh.n : 0), 0),
            surge: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            locks: s.locks,
            clears: s.clears,
            thrown: s.waves,
            shoals: s.shoals,
            spray: this._sprayCount,
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
