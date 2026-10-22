/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the green room: the world.
 *
 * The rider's eye is inside the tube of a breaking wave. It is the end of the day when a run
 * begins, and the hours turn from there (waves-hours.js). Everything is
 * built here and shared with the playground effect (src/playground/effects/waves.effect.js), so
 * what is iterated there ships.
 *
 * Parts (showOnlyParts names): sky, water, dolphins, mist, rain, spray.
 *
 * The world is a function of its clock plus a little eased state (how far the barrel has
 * opened, how warm the light is, where the lens points) and the event tables the water reads:
 * rings, ribbons and bands of light, each stamped with the moment it began. Nothing is
 * simulated on the GPU and nothing is loaded. The clock is the world's own: four lines slow it
 * almost to a stop for a breath, and everything that moves (the flow, every drop in the air,
 * every ribbon) holds with it.
 *
 * What the board does to it:
 *   lock        the piece falls into the trough under its column (a crown of drops in its own
 *               colour, refracting rings that spread and climb the walls) and stains the wave
 *               over it: an arc of its colour that runs across the roof above the board and down
 *               the falling lip, and drips from the lip's edge as rain of that colour.
 *   hard drop   the same, struck harder.
 *   clear       the lip throws a sheet of spray and a band of light runs down the tube for
 *               every line; the barrel opens a little and the water lights from inside.
 *   T-spin      the bands of light come down the tube as a screw, and a wheel of spray turns
 *               off the walls and is flung ahead.
 *   four lines  the wave holds: the clock slows to a tenth, the biggest throw of all hangs in
 *               the air around the eye, then everything runs on.
 *   combo       a chain lights the water from inside and keeps the lip throwing, leans the
 *               evening toward gold, lets the barrel breathe a little wider, and grows the pod
 *               beside the rider: one dolphin in the air at three clears, two at five, three at
 *               seven (the first of them thrown across the sun), four at nine, more in a fever.
 *               A call is never dropped: when every dolphin is in the air it waits for one.
 *   cascade     each wave of it comes deeper than the last: a wider, brighter band of light, a
 *               bigger throw.
 *   back-to-back  a set wave rolls through the tube behind the clear, and the lip throws again.
 *   T-spin, no lines   a small screw of light and a little wheel of spray.
 *   perfect     the whole pod, and the sky goes to gold. Settled after its clear (the crown),
 *               it draws the hold out and pours gold through the lip; it never throws again.
 *   level up    a set wave runs through the tube and the hour turns with it: golden hour,
 *               sunset, afterglow, moonrise, first light, the trade-wind day, and round again.
 *
 * And how hot play runs (shared/gameplay-surge.js). Nothing is restarted by the next event: the
 * light, the tearing and the pod add to what is still playing, and the wave remembers the pace.
 * Calm play looks as it always did. Warm: the water begins to glow from inside, its glass glitters
 * sharper and the rider sways a little more. Hot: the tube swells and heaves, the lip tears longer
 * and keeps throwing sheets of spray, the low sun burns brighter through everything it lights and
 * its shafts climb in the spray. Fever: the green room becomes a cathedral of gold, the barrel
 * breathes wide, the lip throws without pause and the pod rides alongside. When the hands rest it
 * all breathes back over a few seconds.
 *
 * And what the clock does by itself, in every mode (the ones that never level included): it
 * turns the same wheel of hours slowly (waves-hours.js: one hour in HOUR_SECONDS), moves the sun
 * with it, and half-way through each hour sends a set wave of its own down the tube.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import {
    DEG, FLOW, WAVE, approach, castRay, clamp01, crestDistance, landingDistance, lerp, lipAngle, pieceLight, smooth,
    surfaceAt,
} from './waves-core.js';
import { tierFor } from './waves-quality.js';
import {
    REST_RIG, boardFor, boardPoint, cardFor, fallbackLayout, fovForAspect, viewFor,
} from './waves-composition.js';
import {
    HOURS, HOUR_COLOURS, HOUR_SECONDS, SET_SECONDS, hourAt, levelPlace, restPlace, tideSetAge,
} from './waves-hours.js';
import {
    SUN, createLight, createWaterNoise, createWaveShape, sunDirection,
} from './waves-tsl.js';
import { createSky } from './waves-sky.js';
import {
    BAND_SLOTS, BAND_SPEED, BAND_START, RIBBON_VELOCITY, createWater,
} from './waves-water.js';
import { SprayPool, createLipRain, createMist } from './waves-spray.js';
import { WavesPod, leapersFor } from './waves-life.js';

export { REST_RIG, fovForAspect };

/** Seconds a ring, a ribbon and a band of light stay in their tables. */
const RING_LIFE = 4.5;
const RIBBON_LIFE = 7.5;
const BAND_LIFE = (BAND_START + 12) / BAND_SPEED + 0.6;

/** Four lines: the clock runs at this share of its speed, for this long. */
export const HOLD_SCALE = 0.1;
export const HOLD_SECONDS = 2.5;
/** Big clears landing inside a hold draw it out, up to this long; a crown adds this much. */
const HOLD_LONGEST = HOLD_SECONDS + 2.2;
const CROWN_HOLD = 1.1;

/**
 * Dolphins break the surface at least this far apart, the first of a call this long after it
 * (seconds of the world's clock). A call is never dropped: it waits for a dolphin to come down.
 */
const LEAP_SPACING = 0.6;
const LEAP_LEAD = 0.3;

/** How far a set wave swells the tube: a level's, a back-to-back's, the clock's own, the most. */
const LEVEL_SET_HEIGHT = 0.085;
const B2B_SET_HEIGHT = 0.075;
const TIDE_SET_HEIGHT = 0.06;
const SET_HEIGHT_MAX = 0.13;

/** Two bands born together are one, this bright at most. */
const BAND_STRONGEST = 2;

/** The hour's colour row the low sun lights everything with (hot play burns it brighter). */
const FIRE_ROW = HOUR_COLOURS.indexOf('fireTint');

/** How far a chain of `combo` clears holds the barrel open (0..1). */
export function openForCombo(combo) {
    return combo > 1 ? 1 - Math.exp(-(combo - 1) * 0.3) : 0;
}

/**
 * The clock's speed `age` seconds into a hold of `length` seconds: the throw flies a moment, then
 * down fast, back slowly.
 */
export function holdScale(age, length = HOLD_SECONDS) {
    if (!(age >= 0) || age >= length) return 1;
    const held = smooth(0.3, 0.5, age) - smooth(length - 0.8, length, age);
    return 1 - (1 - HOLD_SCALE) * held;
}

/** The inverse of smoothstep on 0..1: where it reads `h`. */
function unsmooth(h) {
    const v = Math.max(0, Math.min(1, h));
    return 0.5 - Math.sin(Math.asin(1 - 2 * v) / 3);
}

/**
 * Where on screen a locked piece's colour enters the water (screen fractions, y down). The card
 * hides what is behind it and on most screens leaves little above it, so the stain starts on
 * the roof beside the card's left edge, over the eye of the barrel: from there it runs the whole
 * arc of the roof and down the falling lip in plain view. The piece's column moves the start
 * along the roof and its row moves it down the tube, so no two pieces draw the same arc. With
 * no room beside the card (a tall screen) it starts over the card, or, failing that, behind the
 * piece itself.
 */
export function aimStain(card, piece, u, row, out = { x: 0.5, y: 0.5 }) {
    const depth = clamp01(row / 19);
    if (card.x0 > 0.14) {
        out.x = card.x0 - 0.022 - (1 - u) * 0.055;
        out.y = Math.max(0.035, Math.min(card.y0 + 0.2, 0.06 + depth * 0.1 + (1 - u) * 0.03));
    } else if (card.y0 > 0.075) {
        out.x = piece.x;
        out.y = card.y0 - 0.035;
    } else {
        out.x = piece.x;
        out.y = piece.y;
    }
    return out;
}

/**
 * Where a locked piece falls into the trough: under its column when the card leaves a strip of
 * water below it, otherwise beside the card's foot, on the side its column is nearer.
 */
export function aimPlunge(card, piece, u, out = { x: 0.5, y: 0.5 }) {
    if (card.y1 < 0.9) {
        out.x = piece.x;
        out.y = Math.min(0.97, card.y1 + 0.04);
    } else if (card.x0 > 0.14) {
        out.x = u < 0.5 ? card.x0 - 0.03 - (0.5 - u) * 0.08 : card.x1 + 0.03 + (u - 0.5) * 0.08;
        out.y = 0.9;
    } else {
        out.x = piece.x;
        out.y = Math.min(0.985, card.y1 + 0.03);
    }
    return out;
}

const tmpRay = new THREE.Vector3();
const tmpSun = new THREE.Vector3();
const tmpLight = [1, 1, 1];
const tmpTint = [1, 1, 1];
const WHITE = [1, 0.95, 0.86];

export class WavesWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]   built for a deterministic capture (reported in getState)
     * @param {number} [p.seed]
     * @param {{azimuth?: number, elevation?: number}} [p.sun]   hold the sun there (the hours
     *                                                           no longer move it)
     * @param {number} [p.hour]   hold the light at this place on the wheel of hours (0 golden
     *                            hour, 1 sunset, ... 3.5 half-way from moonrise to first light)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 187, sun = null, hour = null,
    }) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.seed = seed;
        this.group = new THREE.Group();
        this.group.name = 'waves-world';
        this.parts = {};
        this.camera = null;
        this.aspect = 16 / 9;
        this.viewport = { w: 1920, h: 1080 };
        this.layout = null;
        this.hasBoard = false;
        this.reducedMotion = false;
        /** The frame's time (the camera sways on it) and the world's own clock. */
        this.time = 0;
        this.clock = 0;

        /** A sun held in place (a capture), or null: the hours move it. */
        this.sunPin = sun ? { azimuth: sun.azimuth ?? SUN.azimuth, elevation: sun.elevation ?? SUN.elevation } : null;
        this.sunDir = sunDirection(this.sunPin?.azimuth ?? SUN.azimuth, this.sunPin?.elevation ?? SUN.elevation);
        /**
         * The hour: the place the level holds on the wheel (eased from `from` to `to` since the
         * clock read `at`), and a place the whole light is held at, or null.
         */
        this.hour = {
            from: 0, to: 0, at: -100, pin: Number.isFinite(hour) ? hour : null,
        };
        this.light = hourAt(0);
        this.lightRows = HOUR_COLOURS.map(() => new THREE.Vector4(0, 0, 0, 0));
        /**
         * How hot play runs (shared/gameplay-surge.js), sampled once a frame on the frame's time
         * (like the light it drives: a hold slows the water, not the player's pace). `warmth` is
         * the level above casual play (0 under it), `crown` a perfect clear's gold.
         */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0, warmth: 0, crown: 0,
        };
        this.heatAt = Number.NaN;
        /** The water lit from inside by clears: every clear adds to what is still lit. */
        this.glowSwell = new Swell({ release: 1 / 1.1, ceiling: 1, knee: 0.7 });
        /** A perfect clear's crown: gold pouring through the lip, rising, then slowly letting go. */
        this.crownSwell = new Swell({
            attack: 0.25, release: 1.8, ceiling: 1.2, knee: 0.9,
        });
        this.U = {
            time: uniform(0),
            sun: uniform(this.sunDir.clone()),
            /** The hour's colours (waves-tsl.js createLight) and how far its stars are out. */
            light: createLight(uniformArray(this.lightRows, 'vec4')),
            stars: uniform(0),
            /** 0..1: a chain of clears leans the whole evening toward gold. */
            warm: uniform(0),
            /** 0..1: how far the lip's touchdown has come back toward the eye. */
            open: uniform(0),
            /** (z, height, width, breath): a set wave in the tube; how far the tube has swelled. */
            bulge: uniform(new THREE.Vector4(-60, 0, 5, 0)),
            /** x: live rings, y: live ribbons. */
            counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
            /** 0..1: the lip is throwing (its edge tears further, its rain leaves harder). */
            tear: uniform(0),
            /** Ripple strength (1 at rest). */
            ripple: uniform(1),
            /** 0..1: the water lit from inside (a clear; a chain holds it). */
            glow: uniform(0),
            /** 0..1: how hot play runs (0 at rest): the bands of light burn brighter. */
            heat: uniform(0),
        };

        this.ringRows = Array.from({ length: this.tier.rings }, () => new THREE.Vector4(0, 0, -100, 0));
        this.ribbonRows = Array.from({ length: this.tier.ribbons * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.bandRows = Array.from({ length: BAND_SLOTS }, () => new THREE.Vector4(-100, 0, 4, 0));
        this.rows = {
            rings: uniformArray(this.ringRows, 'vec4'),
            ribbons: uniformArray(this.ribbonRows, 'vec4'),
            bands: uniformArray(this.bandRows, 'vec4'),
        };
        this.ringCount = 0;
        this.ribbonCount = 0;
        /** Ribbons on their way to the lip: when each arrives, where, and what falls from it. */
        this.drips = Array.from({ length: this.tier.ribbons }, () => ({
            at: 0, d: 0, n: 0, rgb: [1, 1, 1],
        }));
        this.dripCount = 0;

        this.state = {
            combo: 0,
            level: 1,
            /** Eased: the barrel's opening held by the chain, and the kick each clear adds. */
            openHeld: 0,
            openKick: 0,
            warm: 0,
            warmKick: 0,
            glow: 0,
            radiance: 0,
            tear: 0,
            flash: 0,
            /** Seconds into a hold of the clock, or -1, and how long this hold lasts. */
            holdAge: -1,
            holdLength: HOLD_SECONDS,
            /** The set wave: seconds since it entered, or -1; how tall it is to be, and is. */
            setAge: -1,
            setHeight: 0,
            setShown: 0,
            /**
             * The pod: dolphins called and not yet sent (they wait for one to come down), whether
             * the next is thrown across the sun, when the last breaks the surface, and whether this
             * chain has had its hero.
             */
            owed: 0,
            heroOwed: false,
            nextLeap: -100,
            heroInChain: false,
            /** Hot play keeps the lip throwing: how far toward its next sheet. */
            throwDebt: 0,
            yaw: null,
            pitch: null,
            locks: 0,
            clears: 0,
            leaps: 0,
        };
        this.view = { yaw: 0, pitch: 0 };
        this.sunScreen = { x: 0.25, y: 0.42, visible: 1 };
        this._hit = {};
        this._foot = {};
        this._point = { x: 0.5, y: 0.5 };
        this._stain = { x: 0.5, y: 0.5 };
        this._plunge = { x: 0.5, y: 0.5 };
        this.splash = (x, y, z, strength) => this.onSplash(x, y, z, strength);
        this.applyHour();
    }

    build() {
        const { tier, U } = this;
        this.noise = createWaterNoise(tier.noise);
        this.shape = createWaveShape(U);
        this.parts.water = createWater({
            tier, noise: this.noise, U, shape: this.shape, rows: this.rows,
        });
        this.pod = new WavesPod({
            tier, U, sun: this.sunDir, eye: REST_RIG.eye, seed: this.seed,
        });
        this.parts.dolphins = this.pod;
        this.parts.sky = createSky({ tier, noise: this.noise, U });
        this.parts.mist = createMist({
            tier, U, shape: this.shape, noise: this.noise, seed: this.seed,
        });
        this.parts.rain = createLipRain({
            tier, U, shape: this.shape, seed: this.seed,
        });
        this.spray = new SprayPool({ tier, U, seed: this.seed });
        this.parts.spray = this.spray;
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
        if (this.camera) {
            this.camera.fov = fovForAspect(this.aspect);
            this.camera.aspect = this.aspect;
            this.camera.updateProjectionMatrix();
        }
    }

    /** The live gameplay rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        this.hasBoard = Boolean(rects);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
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
        const s = this.state;
        s.yaw = null;
        s.pitch = null;
        this.hour.from = 0;
        this.hour.at = -100;
        this.applyHour();
    }

    /**
     * A new run: the barrel back at rest, every table empty, nothing in the air. The clock
     * runs on, and with it the hour; what the last run's levels added to it turns back.
     */
    resetSession() {
        const s = this.state;
        const { hour } = this;
        hour.from = restPlace(this.levelPlace());
        hour.to = 0;
        hour.at = this.clock;
        s.combo = 0;
        s.openHeld = 0;
        s.openKick = 0;
        s.warm = 0;
        s.warmKick = 0;
        s.glow = 0;
        s.radiance = 0;
        s.tear = 0;
        s.flash = 0;
        s.holdAge = -1;
        s.holdLength = HOLD_SECONDS;
        s.setAge = -1;
        s.setHeight = 0;
        s.setShown = 0;
        s.owed = 0;
        s.heroOwed = false;
        s.nextLeap = -100;
        s.heroInChain = false;
        s.throwDebt = 0;
        s.level = 1;
        s.locks = 0;
        s.clears = 0;
        s.leaps = 0;
        this.surge.reset();
        this.glowSwell.reset();
        this.crownSwell.reset();
        const { heat } = this;
        heat.punch = 0;
        heat.level = 0;
        heat.fever = 0;
        heat.stage = 0;
        heat.warmth = 0;
        heat.crown = 0;
        this.heatAt = Number.NaN;
        this.ringCount = 0;
        this.ribbonCount = 0;
        this.dripCount = 0;
        this.bandRows.forEach((row) => row.set(-100, 0, 4, 0));
        this.spray?.reset();
        this.pod?.reset();
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const s = this.state;
        const target = viewFor(this.aspect, this.hasBoard, this.view);
        if (s.yaw === null) {
            s.yaw = target.yaw;
            s.pitch = target.pitch;
        } else {
            const k = approach(1.4, sim.delta);
            s.yaw += (target.yaw - s.yaw) * k;
            s.pitch += (target.pitch - s.pitch) * k;
        }
        const t = sim.time;
        const still = this.reducedMotion ? 0 : 1;
        // The rider's sway: slow, small, never a shake. Hot play rides harder (a wider sway and a
        // quicker roll under it), and each event dips the lens a touch as the board hits the water
        // (the heat as of the last frame: the camera moves before the world; the dip is read at
        // this frame's time).
        const { warmth, fever } = this.heat;
        const ride = 1 + warmth * 0.45 + fever * 0.6;
        const roll = still * (warmth * 0.25 + fever * 0.45) * Math.sin(t * 0.83 + 0.4);
        const dip = still * this.surge.punch.valueAt(t);
        const sway = still * ride * (Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.23 + 1.3) * 0.4);
        const heave = still * ride * (Math.sin(t * 0.31 + 0.6) * 0.6 + Math.sin(t * 0.19) * 0.4);
        const px = still * (sim.pointerX || 0);
        const py = still * (sim.pointerY || 0);
        const yaw = (s.yaw + sway * 0.55 + roll * 0.4 + px * 2.4) * DEG;
        const pitch = (s.pitch + heave * 0.35 - dip * 0.22 - py * 1.6) * DEG;
        camera.position.set(
            REST_RIG.eye.x + sway * 0.05 + px * 0.12,
            REST_RIG.eye.y + heave * 0.045 - dip * 0.02,
            REST_RIG.eye.z,
        );
        camera.up.set(Math.sin(sway * 0.012 + roll * 0.01), 1, 0).normalize();
        tmpRay.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(camera.position.x + tmpRay.x, camera.position.y + tmpRay.y, camera.position.z + tmpRay.z);
        // The shared breath (shared/camera-breath.js) on top of the sway above: off under reduced motion.
        applyCameraBreath(camera, t, { scale: still });
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }

    /** A screen point (fractions, y down) → where its ray meets the wave. */
    castScreen(x, y, out = this._hit) {
        const { camera } = this;
        tmpRay.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        return castRay(
            camera.position.x,
            camera.position.y,
            camera.position.z,
            tmpRay.x,
            tmpRay.y,
            tmpRay.z,
            this.U.open.value,
            out,
        );
    }

    /**
     * The layout events aim at: the live one, else the stylesheet's solo layout for a window of
     * this shape (its formulas are in CSS pixels, so it is asked for a 1000 px tall window, not for
     * the drawing buffer).
     */
    aimLayout() {
        return this.layout || fallbackLayout(this.aspect * 1000, 1000);
    }

    // ── tables ──────────────────────────────────────────────────────────────────

    addRing(u, z, strength) {
        if (this.ringCount >= this.ringRows.length) {
            // Drop the oldest: the rows stay in order of birth.
            for (let i = 1; i < this.ringCount; i += 1) this.ringRows[i - 1].copy(this.ringRows[i]);
            this.ringCount -= 1;
        }
        this.ringRows[this.ringCount].set(u, z, this.clock, strength);
        this.ringCount += 1;
    }

    addRibbon(u, z, strength, light, tail) {
        const cap = this.ribbonRows.length / 2;
        if (this.ribbonCount >= cap) {
            for (let i = 2; i < this.ribbonCount * 2; i += 1) this.ribbonRows[i - 2].copy(this.ribbonRows[i]);
            this.ribbonCount -= 1;
        }
        const at = this.ribbonCount * 2;
        this.ribbonRows[at].set(u, z, this.clock, strength);
        this.ribbonRows[at + 1].set(light[0], light[1], light[2], tail);
        this.ribbonCount += 1;
    }

    /**
     * `twist` (metres of z per radian round the tube) turns the ring into a screw of light. A band
     * takes a free row, else the one furthest down the tube (by then behind the eye): never one
     * still on its way. Two born together are one band, brighter and wider. With many on their way
     * each new one is a little softer, so a long chain is a procession of rings down the tube, not
     * a wall washed out by light.
     */
    addBand(strength, width, delay = 0, twist = 0) {
        const birth = this.clock + delay;
        let free = -1;
        let oldest = -1;
        let live = 0;
        // (the bands of this same clear do not count: a quad on its own looks as it always did)
        for (let i = 0; i < BAND_SLOTS; i += 1) {
            if (this.bandRows[i].y > 0 && this.bandRows[i].x < this.clock) live += 1;
        }
        const soft = strength / (1 + 0.1 * live);
        for (let i = 0; i < BAND_SLOTS; i += 1) {
            const row = this.bandRows[i];
            if (!(row.y > 0)) {
                if (free < 0) free = i;
            } else if (Math.abs(row.x - birth) < 0.05 && row.w === twist) {
                row.y = Math.min(BAND_STRONGEST, row.y + soft * 0.5);
                row.z = Math.max(row.z, width);
                return;
            } else if (oldest < 0 || row.x < this.bandRows[oldest].x) {
                oldest = i;
            }
        }
        this.bandRows[free >= 0 ? free : oldest].set(birth, soft, width, twist);
    }

    /** Something broke the surface at a point in the world: a crown and a ring. */
    onSplash(x, y, z, strength = 1) {
        this.spray.crown(this.clock, x, Math.max(0, y), z, {
            n: Math.round(26 * strength), out: [0.2, 0.75], up: [0.4, 1.15], size: 0.04, rgb: WHITE, radius: 0.35,
        });
        this.addRing(surfaceAt(x, y, z), z, 1.1 * strength);
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /** A piece locked: { player, rows, u, hardDrop, color, screen }. */
    onLock(c) {
        if (!this.camera) return;
        const s = this.state;
        s.locks += 1;
        const layout = this.aimLayout();
        const board = boardFor(layout, c.player || 0);
        const hard = c.hardDrop === true;
        const light = pieceLight(c.color, tmpLight);
        let stainX = 0.5;
        let stainY = 0.5;
        let footX = 0.5;
        let footY = 0.9;
        if (c.screen) {
            stainX = c.screen.x;
            stainY = c.screen.y;
            footX = stainX;
            footY = stainY;
        } else if (board) {
            const rows = c.rows?.length ? c.rows : [19];
            const mid = rows[Math.floor(rows.length / 2)];
            const u = clamp01(c.u ?? 0.5);
            boardPoint(board, u, mid, this._point);
            const card = cardFor(layout, board) || board;
            aimStain(card, this._point, u, mid, this._stain);
            stainX = this._stain.x;
            stainY = this._stain.y;
            aimPlunge(card, this._point, u, this._plunge);
            footX = this._plunge.x;
            footY = this._plunge.y;
        }
        // The stain: the piece's colour, carried over the roof and down the falling lip.
        const wall = this.castScreen(stainX, stainY);
        this.addRibbon(wall.u, wall.z, hard ? 1.5 : 1, light, hard ? 2.8 : 1.9);
        tmpTint[0] = lerp(light[0], 1, 0.3);
        tmpTint[1] = lerp(light[1], 0.95, 0.3);
        tmpTint[2] = lerp(light[2], 0.86, 0.3);
        // When it reaches the lip's edge it falls from it as rain of that colour.
        const lipU = lipAngle(wall.d, this.U.open.value) * WAVE.rho;
        if (wall.kind === 'wall' && lipU > wall.u) {
            const wait = (lipU - wall.u) / RIBBON_VELOCITY.u;
            const at = this.clock + wait;
            const n = hard ? 30 : 18;
            if (this.dripCount < this.drips.length) {
                const drip = this.drips[this.dripCount];
                this.dripCount += 1;
                drip.at = at;
                drip.d = wall.d - RIBBON_VELOCITY.z * wait;
                drip.n = n;
                drip.rgb[0] = tmpTint[0];
                drip.rgb[1] = tmpTint[1];
                drip.rgb[2] = tmpTint[2];
            } else {
                // Every one is still on its way: this rain joins the one that falls nearest it in
                // time (more drops, the two colours mixed), never dropped.
                let near = this.drips[0];
                for (let i = 1; i < this.dripCount; i += 1) {
                    if (Math.abs(this.drips[i].at - at) < Math.abs(near.at - at)) near = this.drips[i];
                }
                near.n = Math.min(64, near.n + n);
                near.rgb[0] = lerp(near.rgb[0], tmpTint[0], 0.5);
                near.rgb[1] = lerp(near.rgb[1], tmpTint[1], 0.5);
                near.rgb[2] = lerp(near.rgb[2], tmpTint[2], 0.5);
            }
        }
        // The plunge: in the trough under the piece's column. Its crown is thrown toward the eye,
        // out from under the card.
        const foot = this.castScreen(footX, footY, this._foot);
        this.addRing(foot.u, foot.z, hard ? 1.5 : 0.9);
        this.spray.crown(this.clock, foot.x, foot.y, foot.z, {
            n: hard ? 44 : 20,
            out: hard ? [0.25, 1.0] : [0.15, 0.6],
            up: hard ? [0.3, 0.9] : [0.2, 0.6],
            size: hard ? 0.034 : 0.03,
            rgb: tmpTint,
            toward: hard ? 0.55 : 0.4,
        });
        if (hard) {
            this.glowSwell.hit(0.16, this.time);
            s.flash = Math.max(s.flash, 0.12);
            s.tear = Math.max(s.tear, 0.25);
        }
        this.surge.lock(c, this.time);
    }

    /**
     * Lines cleared: { player, rows, lines, combo, cascade, tspin, perfect, b2b, crown, screen }.
     * `crown`: a perfect clear settled after the clear it crowns (waves-director.js).
     */
    onClear(c) {
        if (!this.spray) return;
        if (c.crown === true) {
            this.crownClear();
            return;
        }
        const s = this.state;
        const at = this.time;
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
        // Each wave of a cascade comes deeper than the last: wider and brighter bands of light, a
        // bigger, harder throw, more light in the water.
        const depth = Math.max(0, Math.min(8, Math.round(Number(c.cascade) || 1) - 1));
        const open = this.U.open.value;
        const twist = c.tspin ? 2.4 : 0;
        const strength = 0.75 + lines * 0.12 + depth * 0.08;
        const width = (0.85 + lines * 0.1) * (1 + depth * 0.14);
        for (let i = 0; i < lines; i += 1) this.addBand(strength, width, i * 0.26, twist);
        s.openKick = Math.min(0.5, s.openKick + 0.1 + lines * 0.06 + depth * 0.04);
        this.glowSwell.hit(0.25 + lines * 0.16 + depth * 0.12, at);
        s.tear = Math.min(1, s.tear + 0.3 + lines * 0.17);
        s.flash = Math.max(s.flash, 0.1 + lines * 0.06);
        // The lip throws: a sheet of spray off its whole falling edge (heavier the hotter play runs).
        const { warmth, fever } = this.heat;
        const heavier = 1 + depth * 0.3 + warmth * 0.4 + fever * 0.6;
        this.spray.throwLip(this.clock, open, {
            from: landingDistance(open) - 0.5,
            to: crestDistance(open) - 2,
            n: Math.round((this.spray.count / 16) * (0.7 + lines * 0.55) * heavier),
            beads: 0.03,
            speed: [0.7 + lines * 0.12 + depth * 0.1, 1.5 + lines * 0.4 + depth * 0.25],
            size: 0.028 + lines * 0.003,
        });
        if (c.tspin) {
            this.spray.swirl(this.clock, open, { d: landingDistance(open) + 2.5, n: Math.round(this.spray.count / 5) });
            s.tear = 1;
        }
        if (c.b2b === true) this.backToBack(open);
        if (big) {
            // The wave holds, with the biggest throw of all in the air round the eye.
            this.hold(0);
            s.flash = Math.max(s.flash, 0.5);
            s.warmKick = Math.min(1, s.warmKick + (c.perfect ? 0.8 : 0.45));
            this.spray.throwLip(this.clock, open, {
                from: landingDistance(open) - 1.5,
                to: crestDistance(open) - 3,
                n: Math.round(this.spray.count / 2),
                speed: [0.35, 4.2],
                size: 0.026,
                delay: 0.14,
                flown: 3.0,
                spread: 1,
                beads: 0.085,
                prism: 0.42,
                life: [3.4, 5.2],
            });
        }
        if (c.perfect) {
            this.crownSwell.hit(0.8, at);
            this.sendPod(this.pod.count, true);
        }
        this.surge.clear(c, at);
    }

    /**
     * A perfect clear settled after the clear it crowns: no second throw, band or hold of its own.
     * The hold still playing is drawn out, gold pours through the lip, the beads hanging in the
     * air catch the sun in colours, and the whole pod comes over the water, the first across the sun.
     */
    crownClear() {
        const s = this.state;
        const open = this.U.open.value;
        this.hold(CROWN_HOLD);
        s.warmKick = Math.min(1, s.warmKick + 0.6);
        this.crownSwell.hit(1, this.time);
        this.spray.throwLip(this.clock, open, {
            from: landingDistance(open) - 1,
            to: crestDistance(open) - 3,
            n: Math.round(this.spray.count / 7),
            speed: [0.25, 1.6],
            size: 0.022,
            delay: 0.3,
            flown: 1.2,
            spread: 1.2,
            beads: 0.05,
            prism: 0.85,
            life: [3.2, 4.6],
        });
        this.sendPod(this.pod.count, true);
        this.surge.crown(this.time);
    }

    /**
     * A back-to-back: a set wave rolls through the tube behind the clear (taller if one is already
     * coming), the barrel opens a little more and the lip throws a second sheet, further ahead.
     */
    backToBack(open) {
        const s = this.state;
        this.startSet(B2B_SET_HEIGHT);
        s.openKick = Math.min(0.5, s.openKick + 0.12);
        this.spray.throwLip(this.clock, open, {
            from: landingDistance(open) + 1,
            to: crestDistance(open) - 1,
            n: Math.round(this.spray.count / 12),
            speed: [1.0, 2.6],
            size: 0.03,
            delay: 0.55,
            flown: 0.3,
            beads: 0.05,
        });
    }

    /** A T-spin that cleared nothing: a small screw of light down the tube, a little wheel of spray. */
    onSpin() {
        if (!this.spray) return;
        const s = this.state;
        const open = this.U.open.value;
        this.addBand(0.5, 0.7, 0, 2.4);
        this.spray.swirl(this.clock, open, {
            d: landingDistance(open) + 2.5, n: Math.round(this.spray.count / 14), turn: 1.5, life: [2, 3],
        });
        s.tear = Math.max(s.tear, 0.45);
        this.surge.spin(this.time);
    }

    /**
     * Four lines (or a perfect clear) hold the wave. One that lands inside a hold draws it out
     * (`extra` seconds more for a crown), never starts it again: a hold already letting go comes
     * back down from the speed it has reached.
     */
    hold(extra) {
        const s = this.state;
        const age = s.holdAge;
        if (age < 0) {
            s.holdAge = 0;
            s.holdLength = Math.min(HOLD_LONGEST, HOLD_SECONDS + extra);
            return;
        }
        const length = s.holdLength;
        if (age >= length - 0.8) {
            const held = (1 - holdScale(age, length)) / (1 - HOLD_SCALE);
            s.holdAge = 0.3 + 0.2 * unsmooth(held);
            s.holdLength = Math.min(HOLD_LONGEST, HOLD_SECONDS + extra);
        } else {
            s.holdLength = Math.min(HOLD_LONGEST, Math.max(length, Math.max(age, 0.5) + HOLD_SECONDS - 0.5) + extra);
        }
    }

    /** A set wave of `height` into the tube; one already coming through grows, it never starts again. */
    startSet(height) {
        const s = this.state;
        if (s.setAge >= 0) {
            s.setHeight = Math.min(SET_HEIGHT_MAX, Math.max(s.setHeight, height) + height * 0.3);
            return;
        }
        s.setAge = 0;
        s.setHeight = height;
        s.setShown = height;
    }

    /**
     * The longest chain any board is holding (0 = it broke). The pod grows with it: each step tops
     * the dolphins in the air up to what the chain is worth (more in a fever), the first past seven
     * thrown across the sun.
     */
    onCombo(combo) {
        const s = this.state;
        const next = Math.max(0, combo | 0);
        if (next > s.combo && this.pod) {
            const call = leapersFor(next);
            const want = call > 0 ? Math.min(this.pod.count, call + Math.round(this.heat.fever * 2)) : 0;
            const add = want - this.pod.live() - s.owed;
            if (add > 0) {
                const hero = next >= 7 && !s.heroInChain;
                if (hero) s.heroInChain = true;
                this.sendPod(add, hero);
            }
        }
        if (next === 0) s.heroInChain = false;
        s.combo = next;
    }

    /**
     * Call `n` dolphins over the water, one after another (`hero`: the first across the sun). The
     * call is kept until a dolphin is free to answer it: never dropped, never one taken out of the air.
     */
    sendPod(n, hero) {
        const s = this.state;
        if (!this.pod) return;
        const count = Math.min(Math.max(0, Math.floor(Number(n)) || 0), this.pod.count);
        if (count <= 0) return;
        s.owed = Math.min(this.pod.count, s.owed + count);
        if (hero) s.heroOwed = true;
        this.launchOwed();
    }

    /** Send what is owed, as dolphins come free: each breaks the surface LEAP_SPACING after the last. */
    launchOwed() {
        const s = this.state;
        while (s.owed > 0) {
            const slot = this.pod.freeSlot(this.clock);
            if (slot < 0) return;
            const at = Math.max(this.clock + LEAP_LEAD, s.nextLeap + LEAP_SPACING);
            const hero = s.heroOwed;
            this.pod.leap(at, this.U.open.value, { hero, d: hero ? 12.5 : null, slot });
            s.heroOwed = false;
            s.nextLeap = at;
            s.owed -= 1;
            s.leaps += 1;
        }
    }

    /** A new level: a set wave, and the hour turns with it (`silent`: it simply is that level). */
    levelUp(level, { silent = false } = {}) {
        const s = this.state;
        const { hour } = this;
        s.level = Math.max(1, level | 0);
        hour.from = silent ? s.level - 1 : this.levelPlace();
        hour.to = s.level - 1;
        hour.at = silent ? -100 : this.clock;
        if (silent) {
            this.applyHour();
            return;
        }
        this.startSet(LEVEL_SET_HEIGHT);
        s.tear = Math.max(s.tear, 0.5);
        this.surge.levelUp(this.time);
    }

    // ── the hour ────────────────────────────────────────────────────────────────

    /** The place the level holds on the wheel of hours right now (eased while it turns). */
    levelPlace() {
        const { hour } = this;
        return levelPlace(hour.from, hour.to, this.clock - hour.at);
    }

    /** Where the light stands on the wheel: the level's place plus what the clock has turned. */
    hourPlace() {
        return this.hour.pin ?? this.levelPlace() + this.clock / HOUR_SECONDS;
    }

    /**
     * Hand the hour's light to the shaders, and put the sun where that hour has it. Hot play (and a
     * perfect clear's crown) burns the low sun brighter in everything it lights: the lip's torn
     * edge, the spray, the dolphins' wet backs.
     */
    applyHour() {
        const light = hourAt(this.hourPlace(), this.light);
        const { warmth, fever, crown } = this.heat;
        const burn = 1 + warmth * 0.08 + fever * 0.2 + crown * 0.3;
        for (let i = 0; i < HOUR_COLOURS.length; i += 1) {
            const colour = light[HOUR_COLOURS[i]];
            const k = i === FIRE_ROW ? burn : 1;
            this.lightRows[i].set(colour[0] * k, colour[1] * k, colour[2] * k, 0);
        }
        this.U.stars.value = light.stars;
        if (!this.sunPin) {
            sunDirection(SUN.azimuth, light.elevation, this.sunDir);
            this.U.sun.value.copy(this.sunDir);
        }
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    /**
     * How hot play runs at the frame's time (read once a frame; everything this frame reads it).
     * A frame of no time reads nothing new: the world stands still on it.
     */
    sampleHeat() {
        const { heat } = this;
        if (this.time !== this.heatAt) {
            this.heatAt = this.time;
            const sample = this.surge.sample(this.time);
            heat.level = sample.level;
            heat.fever = sample.fever;
            heat.stage = sample.stage;
            // Nothing under casual play: the wave looks as it always did until the hands quicken.
            heat.warmth = clamp01((sample.level - 0.15) / 0.7);
        }
        heat.punch = this.surge.punch.valueAt(this.time);
        heat.crown = this.crownSwell.valueAt(this.time);
        return heat;
    }

    update(sim, camera) {
        if (!this.pod) return;
        const dt = Math.max(0, sim.delta);
        this.time = sim.time;
        const { U } = this;
        const s = this.state;
        const {
            punch, fever, warmth, crown,
        } = this.sampleHeat();
        const still = this.reducedMotion ? 0 : 1;

        // The world's own clock: four lines hold it for a breath.
        let scale = 1;
        if (s.holdAge >= 0) {
            scale = this.reducedMotion ? 1 : holdScale(s.holdAge, s.holdLength);
            s.holdAge += dt;
            if (s.holdAge >= s.holdLength) s.holdAge = -1;
        }
        this.clock += dt * scale;
        U.time.value = this.clock;
        this.applyHour();

        // Tables: drop what has run its course (rows stay in order of birth). A full table lets its
        // oldest go softly: it fades over a few tenths of a second before a new one takes its row,
        // instead of vanishing mid-spread.
        while (this.ringCount > 0 && this.clock - this.ringRows[0].z > RING_LIFE) {
            for (let i = 1; i < this.ringCount; i += 1) this.ringRows[i - 1].copy(this.ringRows[i]);
            this.ringCount -= 1;
        }
        while (this.ribbonCount > 0 && this.clock - this.ribbonRows[0].z > RIBBON_LIFE) {
            for (let i = 2; i < this.ribbonCount * 2; i += 1) this.ribbonRows[i - 2].copy(this.ribbonRows[i]);
            this.ribbonCount -= 1;
        }
        if (this.ringCount >= this.ringRows.length) this.ringRows[0].w *= Math.exp(-5 * dt);
        if (this.ribbonCount * 2 >= this.ribbonRows.length) this.ribbonRows[0].w *= Math.exp(-5 * dt);
        for (let i = 0; i < BAND_SLOTS; i += 1) {
            const row = this.bandRows[i];
            if (row.y > 0 && this.clock - row.x > BAND_LIFE) row.set(-100, 0, 4, 0);
        }
        U.counts.value.set(this.ringCount, this.ribbonCount, 0, 0);
        // Ribbons that have reached the lip fall from it.
        for (let i = 0; i < this.dripCount; i += 1) {
            const drip = this.drips[i];
            if (drip.at > this.clock) continue;
            this.spray.throwLip(this.clock, U.open.value, {
                from: drip.d - 0.5,
                to: drip.d + 0.5,
                n: drip.n,
                speed: [0.5, 1.4],
                size: 0.03,
                rgb: drip.rgb,
                flown: 0.2,
            });
            this.dripCount -= 1;
            const last = this.drips[this.dripCount];
            this.drips[this.dripCount] = drip;
            this.drips[i] = last;
            i -= 1;
        }

        // The barrel opens to a chain and to each clear, and closes slowly when the chain breaks;
        // hot play lets it breathe a little wider.
        const held = openForCombo(s.combo);
        s.openHeld += (held - s.openHeld) * approach(held > s.openHeld ? 1.5 : 0.4, dt);
        s.openKick *= Math.exp(-0.7 * dt);
        U.open.value = clamp01(s.openHeld + s.openKick + warmth * 0.08 + fever * 0.06);
        s.radiance += (held - s.radiance) * approach(held > s.radiance ? 1.2 : 0.5, dt);
        // The evening leans toward gold with the chain, the heat and a perfect clear's crown.
        const warm = Math.min(1, s.combo / 9) * 0.55;
        s.warm += (warm - s.warm) * approach(0.8, dt);
        s.warmKick *= Math.exp(-0.35 * dt);
        U.warm.value = clamp01(s.warm + s.warmKick + warmth * 0.05 + fever * 0.12 + crown * 0.25);
        s.glow = this.glowSwell.valueAt(this.time);
        s.tear *= Math.exp(-1.3 * dt);
        s.flash *= Math.exp(-4.5 * dt);
        // The water lit from inside: each clear, the chain, and the heat of play, which holds it lit.
        U.glow.value = Math.min(1.6, s.glow + s.radiance * 0.9 + warmth * 0.2 + fever * 0.2 + crown * 0.2);
        // The glass glitters sharper as play heats and the bands of light burn a little brighter;
        // each event sends a shiver over it.
        U.ripple.value = Math.min(1.4, 1 + warmth * 0.1 + fever * 0.08 + punch * 0.15);
        U.heat.value = Math.min(1, warmth * 0.45 + fever * 0.55 + crown * 0.2);
        // A set wave runs the length of the tube, from ahead to behind the eye: a new level's or a
        // back-to-back's, or else the one the clock sends half-way through every hour.
        const bulge = U.bulge.value;
        const tide = tideSetAge(this.clock);
        let run = -1;
        let height = 0;
        if (s.setAge >= 0) {
            s.setAge += dt * scale;
            s.setShown += (s.setHeight - s.setShown) * approach(2.5, dt);
            if (s.setAge >= SET_SECONDS) {
                s.setAge = -1;
            } else {
                run = s.setAge / SET_SECONDS;
                height = s.setShown;
            }
        }
        if (run < 0 && tide >= 0) {
            run = tide / SET_SECONDS;
            height = TIDE_SET_HEIGHT;
        }
        if (run >= 0) {
            bulge.x = lerp(-46, 9, run);
            bulge.y = height * Math.sin(Math.PI * run);
            bulge.z = 6.5;
        } else {
            bulge.y = 0;
        }
        // The tube swells with the barrel's opening, and with hot play it swells and heaves.
        const swell = warmth * 0.012 + fever * 0.022;
        bulge.w = U.open.value * 0.03 + swell * (1 + 0.35 * still * Math.sin(this.clock * 0.9));
        // A chain keeps the lip throwing, and so does a set wave as it comes through, and hot play:
        // the lip tears longer and its standing rain leaves harder.
        U.tear.value = Math.max(
            s.tear,
            s.radiance * 0.45,
            tide >= 0 ? 0.4 * Math.exp(-1.3 * tide) : 0,
            warmth * 0.4 + fever * 0.5,
        );

        this.pod.update(this.clock, this.splash);
        this.launchOwed();
        this.keepThrowing(dt * scale, warmth, fever);

        if (camera) {
            this.parts.sky.follow(camera);
            // Where the sun stands on screen (the post draws its shafts from there).
            tmpSun.copy(this.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
            const ahead = tmpRay.set(0, 0, -1).transformDirection(camera.matrixWorld).dot(this.sunDir);
            this.sunScreen.x = tmpSun.x * 0.5 + 0.5;
            this.sunScreen.y = 0.5 - tmpSun.y * 0.5;
            this.sunScreen.visible = ahead > 0.15 ? 1 : 0;
        }
    }

    /**
     * Hot play keeps the lip throwing: a sheet of spray off its edge every so often (`dt` on the
     * world's clock, so it holds with a hold), more often the hotter it runs, without pause in a fever.
     */
    keepThrowing(dt, warmth, fever) {
        const s = this.state;
        const rate = Math.max(0, warmth - 0.45) * 1.8 + fever * 2.2;
        if (!(rate > 0)) {
            s.throwDebt = 0;
            return;
        }
        s.throwDebt += dt * rate;
        const open = this.U.open.value;
        while (s.throwDebt >= 1) {
            s.throwDebt -= 1;
            this.spray.throwLip(this.clock, open, {
                from: landingDistance(open) - 0.5,
                to: crestDistance(open) - 2,
                n: Math.round(this.spray.count / 36),
                beads: 0.035,
                speed: [0.8, 2.0],
                size: 0.027,
                delay: 0.25,
                flown: 0.5,
                life: [2.0, 3.4],
            });
        }
    }

    /** What the post stack should know this frame. */
    getPostState() {
        const s = this.state;
        const { shaft } = this.light;
        const { warmth, fever, crown } = this.heat;
        return {
            flash: s.flash,
            // The bloom swells only a little with heat (emission carries it: haze would wash the
            // green out); the shafts climb in the spray, and a crown pours gold through the lip.
            bloomBoost: s.glow * 0.5 + s.radiance * 0.3 + fever * 0.12 + crown * 0.25,
            warm: this.U.warm.value,
            sunX: this.sunScreen.x,
            sunY: this.sunScreen.y,
            shafts: this.sunScreen.visible
                * (0.55 + s.radiance * 0.5 + s.glow * 0.35 + warmth * 0.15 + fever * 0.3 + crown * 0.7),
            // A copy: the hour's own array is rewritten every frame.
            shaftTint: [shaft[0], shaft[1], shaft[2]],
            // An iris: it closes a little as heat adds light, so the colours stay deep.
            exposure: this.light.exposure * (1 - Math.min(0.15, warmth * 0.07 + fever * 0.05 + crown * 0.03)),
        };
    }

    getState() {
        const s = this.state;
        return {
            quality: this.quality,
            capture: this.capture,
            time: this.time,
            clock: this.clock,
            combo: s.combo,
            level: s.level,
            /** The hour the light stands nearest to, the one it is crossing to or from, how far. */
            hour: this.light.name,
            hourNext: this.light.next,
            hourMix: this.light.mix,
            hourPlace: this.hourPlace(),
            hours: HOURS.length,
            sunElevation: this.sunPin?.elevation ?? this.light.elevation,
            setWave: this.U.bulge.value.y > 0,
            open: this.U.open.value,
            landing: landingDistance(this.U.open.value),
            warm: this.U.warm.value,
            glow: this.U.glow.value,
            rings: this.ringCount,
            ribbons: this.ribbonCount,
            airborne: this.pod?.airborne ?? 0,
            holding: s.holdAge >= 0,
            /** How hot play runs: the level, the fever and the act (calm, warm, hot, fever). */
            heat: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            owed: s.owed,
            locks: s.locks,
            clears: s.clears,
            leaps: s.leaps,
            sun: { ...this.sunScreen },
            flow: FLOW,
            drips: this.dripCount,
            ribbonVelocity: RIBBON_VELOCITY,
            tube: { a: WAVE.a, b: WAVE.b },
        };
    }

    get combo() {
        return this.state.combo;
    }

    dispose() {
        Object.values(this.parts).forEach((part) => part.dispose());
        this.parts = {};
        this.pod = null;
        this.spray = null;
        this.group.removeFromParent();
        this.noise?.dispose();
        this.noise = null;
        this.camera = null;
    }
}
