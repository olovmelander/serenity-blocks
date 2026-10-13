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
 *
 * And the clock turns the night by itself (NIGHTS in the core: six nights on a wheel, one every
 * NIGHT_SECONDS, resting a little on each), in every mode, the ones that never level included; a
 * level carries it one night further on top, eased. Nothing turns it back.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
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

/** How hard the rain falls for a chain of `combo` clears (0..1): none below two. */
export function rainForCombo(combo) {
    if (combo < 2) return 0;
    return clamp01(0.2 + (combo - 2) * 0.17);
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
            /** A perfect clear lights the whole bay (0..1). */
            bayBloom: uniform(0),
            glowPower: uniform(1),
            /** Radians a pixel spans. */
            pixelAngle: uniform(0.0008),
            /** x: live splashes, y: live waves of light. */
            counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        };
        this.splashRows = Array.from({ length: this.tier.splashes * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.breakerRows = Array.from({ length: this.tier.breakers * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.rows = {
            splashes: uniformArray(this.splashRows, 'vec4'),
            breakers: uniformArray(this.breakerRows, 'vec4'),
        };
        /** Splashes: { x, y, z, t0 (impact), strength, radius, rgb, height (of the fall) } in a ring. */
        this.splashes = [];
        /** Waves of light: { a0, s0, t0, strength, H, speed, sBreak, peel, life }. */
        this.breakers = [];
        /** Droplets: [x, y, z, vx, vy, vz, born, r, g, b] each, in a ring buffer. */
        this.drops = new Float32Array(this.tier.drops * 10).fill(-100);
        this.dropCursor = 0;
        /** The fish shoal: when it set off and where it runs (shore a, s). */
        this.shoal = {
            at: -100, a0: 0, a1: 0, s0: 8, s1: 4, seed: 0,
        };
        this.state = {
            combo: 0,
            level: 1,
            rain: 0,
            bloom: 0,
            flash: 0,
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
        // Glows: every droplet, a falling drop's streak and flash per splash, the shoal (a head and a
        // tail a fish), the spray.
        const glowCapacity = tier.drops + tier.splashes * 3 + tier.fish * 2 + tier.spray;
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
        s.flash = 0;
        s.locks = 0;
        s.clears = 0;
        s.waves = 0;
        s.shoals = 0;
        this.splashes.length = 0;
        this.breakers.length = 0;
        this.drops.fill(-100);
        this.dropCursor = 0;
        this.shoal.at = -100;
        this.U.rain.value = 0;
        this.U.bayBloom.value = 0;
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
        const yaw = (s.yaw + drift * 0.3 + px * 1.6) * DEG;
        const pitch = (s.pitch + drift * 0.08 - py * 0.9) * DEG;
        camera.position.set(EYE.x + px * 0.15, EYE.y + breath, EYE.z);
        camera.up.set(0, 1, 0);
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

    /** A drop lands at (x, z) at `at` (its fall has started FALL_SECONDS before). */
    addSplash(x, z, at, strength, radius, rgb, height) {
        if (this.splashes.length >= this.tier.splashes) this.splashes.shift();
        toShore(x, z, shoreTmp);
        const y = Math.max(sandHeight(shoreTmp.s) + 0.01, surfHeight(shoreTmp.a, shoreTmp.s, at) + 0.02);
        this.splashes.push({
            x, y, z, t0: at, strength, radius, rgb: [rgb[0], rgb[1], rgb[2]], height,
        });
        this.crown(x, y, z, at, strength, rgb);
    }

    /** A crown of droplets thrown up from (x, y, z) at `at`, and the jet that climbs out of its middle. */
    crown(x, y, z, at, strength, rgb) {
        const cap = this.drops.length / 10;
        const n = Math.round(clamp(cap / 10, 8, 40) * clamp(strength, 0.4, 2));
        const sea = this.light.glow;
        for (let i = 0; i < n + 3; i += 1) {
            const k = this.dropCursor * 10;
            this.dropCursor = (this.dropCursor + 1) % cap;
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

    /** A wave of light is thrown: it starts `s0` metres out at `a0` along the shore at `at`. */
    addBreaker(a0, s0, at, strength, {
        H = 0.9, speed = 4.4, sBreak = s0 - 2.6, peel = 22,
    } = {}) {
        if (this.breakers.length >= this.tier.breakers) this.breakers.shift();
        const top = Math.sqrt((2 * runup(H * 1.6)) / 0.73);
        this.breakers.push({
            a0, s0, t0: at, strength, H, speed, sBreak, peel, life: s0 / speed + 2 * top + 3,
        });
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
        const strength = hard ? 1.75 : 1;
        this.addSplash(hit.x, hit.z, this.clock + FALL_SECONDS, strength, hard ? 0.7 : 0.45, rgb, hard ? 9 : 6);
    }

    /** Lines cleared: { player, rows, lines, combo, cascade, tspin, perfect, b2b, screen }. */
    onClear(c) {
        if (!this.camera) return;
        const s = this.state;
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
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
        const strength = c.b2b ? 1.25 : 1;
        if (big) {
            this.addBreaker(a0, 16, this.clock, 1.6 * strength, {
                H: 2.6, speed: 4.2, sBreak: 9.5, peel: 30,
            });
            s.waves += 1;
            s.flash = Math.max(s.flash, 0.3);
            if (c.perfect) s.bloom = 1;
        } else {
            for (let i = 0; i < lines; i += 1) {
                this.addBreaker(a0 - i * 3, 13 + i * 2.2, this.clock + i * 0.5, strength, {
                    H: 0.85, speed: 4.2, sBreak: 10.8 + i * 2.2, peel: 22,
                });
                s.waves += 1;
            }
            s.flash = Math.max(s.flash, 0.04 + lines * 0.03);
        }
        if (c.tspin) this.sendShoal();
    }

    /** A shoal of fish darts through the shallows from `a0` along the shore. */
    sendShoal() {
        const s = this.state;
        const sh = this.shoal;
        const layout = this.aimLayout();
        const card = layout?.cards?.[0];
        const inner = card ? Math.max(0.06, card.x0 - 0.04) : 0.36;
        const from = this.castShore(0.02, 0.78 + this.rand() * 0.06, 2.5, 30);
        const fromA = from.a;
        const fromS = clamp(from.s, 2, 9);
        const to = this.castShore(inner, 0.9, 2.5, 30);
        sh.at = this.clock;
        sh.seed = this.rand();
        sh.a0 = fromA;
        sh.s0 = fromS;
        sh.a1 = to.a;
        sh.s1 = clamp(to.s, 1.4, 6);
        s.shoals += 1;
    }

    /** The longest chain any board is holding (0 = it broke). */
    onCombo(combo) {
        this.state.combo = Math.max(0, combo | 0);
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
            s.bloom = Math.max(s.bloom, 0.28);
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
        U.stars.value = light.stars * (1 - rain * 0.8);
        U.milky.value = light.milky * (1 - rain);
        U.cover.value = Math.min(1, light.cover + rain * 0.45);
        U.haze.value = light.haze + rain * 0.2;
        U.warmth.value = light.warmth * (1 - rain * 0.3);
        U.glowPower.value = light.glowPower;
        U.squallDim.value = 1 - rain * 0.32;
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

        // The rain follows the chain: it comes on in a few seconds and eases off slower.
        const want = rainForCombo(s.combo);
        s.rain += (want - s.rain) * approach(want > s.rain ? 0.9 : 0.32, dt);
        if (s.rain < 1e-3) s.rain = 0;
        U.rain.value = s.rain;
        if (this.camera && s.rain > 0.15) {
            s.rainClock += dt * s.rain * 9;
            while (s.rainClock >= 1) {
                s.rainClock -= 1;
                const left = this.rand() < 0.62;
                const sx = left ? 0.02 + this.rand() * 0.34 : 0.74 + this.rand() * 0.24;
                const sy = 0.6 + this.rand() * 0.37;
                const hit = this.castShore(sx, sy, 2.5, 30);
                if (hit.s > -WET_REACH) this.crown(hit.x, hit.y + 0.01, hit.z, this.clock, 0.32, this.light.glow);
            }
        } else {
            s.rainClock = 0;
        }
        s.bloom *= Math.exp(-0.22 * dt);
        U.bayBloom.value = s.bloom;
        s.flash *= Math.exp(-3.5 * dt);
        this.applyNight();
        // The night sky turns slowly; the cloud drifts in off the sea.
        U.starTurn.value = (this.clock * 0.0016) % (Math.PI * 2);
        U.drift.value.set(-this.clock * 0.0009, this.clock * 0.0003);

        this.writeRows();
        this.updateGlows();
        if (camera) this.parts.sky.follow(camera);
    }

    /** The live splashes and waves of light, compacted into the shaders' tables. */
    writeRows() {
        const { clock } = this;
        let n = 0;
        for (let i = 0; i < this.splashes.length; i += 1) {
            const sp = this.splashes[i];
            if (clock - sp.t0 > SPLASH_LIFE) continue;
            this.splashRows[n * 2].set(sp.x, sp.z, sp.t0, sp.strength);
            this.splashRows[n * 2 + 1].set(sp.rgb[0], sp.rgb[1], sp.rgb[2], sp.radius);
            n += 1;
        }
        while (this.splashes.length && clock - this.splashes[0].t0 > SPLASH_LIFE) this.splashes.shift();
        let m = 0;
        for (let i = 0; i < this.breakers.length; i += 1) {
            const b = this.breakers[i];
            if (clock - b.t0 > b.life) continue;
            this.breakerRows[m * 2].set(b.a0, b.s0, b.t0, b.strength);
            this.breakerRows[m * 2 + 1].set(b.H, b.speed, b.sBreak, b.peel);
            m += 1;
        }
        while (this.breakers.length && clock - this.breakers[0].t0 > this.breakers[0].life) this.breakers.shift();
        this.U.counts.value.set(n, m, 0, 0);
    }

    /** The droplets, the falling drops, the shoal. */
    updateGlows() {
        const { glows } = this.parts;
        const { clock } = this;
        glows.begin();
        const power = this.light.glowPower;
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
        // The shoal: each fish a streak of light just under the surface, darting along the shallows.
        const sh = this.shoal;
        const age = clock - sh.at;
        if (age >= 0 && age < SHOAL_SECONDS + 1.5) {
            const { fish } = this.tier;
            for (let i = 0; i < fish; i += 1) {
                const r = (k) => {
                    const v = Math.sin((i + 1) * 12.9898 + k * 78.233 + sh.seed * 37.719) * 43758.5453;
                    return v - Math.floor(v);
                };
                const lag = r(1) * 0.9;
                const pace = SHOAL_SECONDS * (0.75 + r(2) * 0.5);
                const u = clamp01((age - lag) / pace);
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
                const head = 2.2 * fade * power;
                const tail = 1.0 * fade * power;
                glows.push(hx, yy, hz, 0.035, glow[0] * head, glow[1] * head, glow[2] * head);
                glows.push(hx, yy, hz, 0.02, glow[0] * tail, glow[1] * tail, glow[2] * tail, 0, vx, 0, vz, -0.16);
            }
        }
        glows.end();
    }

    /** What the post stack should know this frame. */
    getPostState() {
        const s = this.state;
        const L = this.light;
        const post = this._post || (this._post = {
            flash: 0, bloomBoost: 0, exposure: 1, rain: 0, gradeShadow: [0.92, 0.98, 1.1], gradeLight: [1.02, 1, 0.98],
        });
        post.flash = s.flash;
        post.bloomBoost = s.bloom * 0.5 + s.rain * 0.15;
        post.exposure = L.exposure;
        post.rain = s.rain;
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
            shoal: clock - this.shoal.at < SHOAL_SECONDS + 1.5 && clock >= this.shoal.at,
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
