/**
 * Tornado — the world: a supercell at the end of the day, and the board that plays it.
 *
 * Builds the parts (sky, ground, wheat, the power line, the funnel, its debris, the sparks, the
 * lightning), owns the scene's state and writes it to the shared uniforms once a frame. The
 * gameplay arrives already resolved by the director:
 *
 *   onLock   sparks in the piece's colour leave the card's edge at the piece's height, fly out
 *            over the field and into the funnel's foot; a moment later the funnel lights a
 *            RIBBON of that colour that climbs it and stays for about half a minute; under the
 *            board a gust ring in the piece's colour runs out through the wheat. A hard drop
 *            throws more of everything and jolts the lens.
 *   onClear  lightning comes down beside the card, one channel per line (and one more per wave
 *            of a cascade, each wave brighter and quicker), each with a ring through the wheat.
 *            The first clear of a chain lets the funnel's ribbons go (they flare and shoot up
 *            into the cloud, which lights from inside); every clear after it in the chain KEEPS
 *            its ribbons, so the chain winds the funnel up, ribbon on ribbon. Four lines: the
 *            funnel swells into a wedge and a dust front rolls out over the lens (a second one
 *            feeds the front, never restarts it). Back-to-back: channels either side of the
 *            funnel. A perfect clear crowns the clear still playing (crown()).
 *   onCombo  the chain is the storm's fury: the funnel thickens and spins up, more debris
 *            lifts, the wheat lies down, the cloud winds faster and turns green at its heart,
 *            the cloud flickers more often. When the chain ends the funnel UNWINDS: every
 *            ribbon it holds climbs off into the cloud, oldest first, and the storm breathes out.
 *   levelUp  the hour turns one step (the light also turns by itself, one hour every
 *            HOUR_SECONDS: golden hour → ember dusk → green sky → blue hour → round again).
 *
 * Every answer accumulates (shared/swell.js: two quads are more than one, a weak answer never
 * cuts a strong one's light), and the heat of play (shared/gameplay-surge.js) winds the whole
 * storm up on top of the chain: calm as authored; warm, the inflow quickens and the field
 * leans in; hot, satellites circle the foot and the wall cloud takes the colours it holds;
 * fever, a wedge, lightning by itself, the shafts through the gap blazing.
 *
 * Everything is a function of the storm's clock and the events' start times, so a seek() that
 * replays the same events gives the same frame.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    HOUR_SECONDS,
    PALETTES,
    TAU,
    WORLD,
    approach,
    clamp,
    clamp01,
    furyFor,
    hexToLinear,
    mulberry32,
    paletteAt,
    smooth01,
} from './tornado-core.js';
import { tierFor } from './tornado-quality.js';
import {
    BOLTS, FLASHES, FLIGHTS, RIBBONS, RINGS, createNoiseTexture, createUniforms,
} from './tornado-tsl.js';
import { createSky } from './tornado-sky.js';
import { createFunnel } from './tornado-funnel.js';
import { createField } from './tornado-field.js';
import { createFx } from './tornado-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './tornado-composition.js';

export const REST_RIG = Object.freeze({
    near: 0.3,
    far: 15000,
    fov: 50,
    /** The lens looks up a little: the horizon sits in the lower third. */
    pitch: 0.166,
});

/** Vertical field of view: 50° on a wide screen, opened up on a tall one so the storm still fits. */
export function fovForAspect(aspect) {
    const wide = Math.tan((REST_RIG.fov * Math.PI) / 360);
    const need = Math.tan((21 * Math.PI) / 180) / Math.max(0.3, aspect || 1);
    return Math.min(74, (Math.atan(Math.max(wide, need)) * 360) / Math.PI);
}

const PARTS = ['sky', 'ground', 'wheat', 'props', 'funnel', 'debris', 'motes', 'bolts'];

/** The settings' own values at which the live controls leave the scene as authored. */
export const LIVE_REFERENCE = Object.freeze({
    emissiveColor: '#ff8a3b',
    timeScale: 1.0,
    ribbonWidth: 1.0,
    parabolaStrength: 1.0,
    parabolaOffset: 0.35,
    parabolaAmplitude: 0.45,
});

/** Colours the storm light's tint reaches. */
const TINTED = Object.freeze(['sun', 'gapLow', 'cloudLit', 'cloudRim', 'funnelLit', 'wheatLit', 'haze']);
/** Colours that lift as a perfect clear opens the gap (with the sun's disc itself). */
const GAP_LIT = Object.freeze(['gapLow', 'cloudLit', 'cloudRim']);

/** Seconds a ribbon takes to reach the wall cloud, holds, and takes to leave. */
const RIBBON_CLIMB = 5.5;
const RIBBON_HOLD = 17;
const RIBBON_LEAVE = 12;
/** Seconds the sparks need to reach the funnel: the ribbon lights when they arrive. */
const SPARK_FLIGHT = 1.5;
/** Seconds a ribbon that lets go needs to climb off the top of the funnel. */
const RIBBON_GONE = 0.8;
/**
 * The end of a chain: seconds between its ribbons as they let go, oldest first, and how fast
 * they climb off (a clear's own release is pace 1): the funnel unwinds, it does not pop.
 */
const UNWIND_STEP = 0.11;
const UNWIND_PACE = 0.55;
const DEFAULT_SPARK = Object.freeze([1.0, 0.72, 0.32]);
const STRIKE_SLOTS = Object.freeze([0.05, 0.12, 0.19, 0.27, 0.34, 0.66, 0.73, 0.8, 0.9, 0.95]);
/** Seconds the storm holds its own lightning after a perfect clear: the release is the moment. */
const CROWN_QUIET = 3.5;

/**
 * A stroke's light: the first stroke and two return strokes; under Reduce flashing one stroke
 * and its glow (ADR-0021: lightning fires once and never flickers).
 */
const strokeLight = (age, steady = false) => {
    if (age < 0 || age > 0.55) return 0;
    let light = Math.exp(-age / 0.04);
    if (!steady && age > 0.08) light = Math.max(light, 0.75 * Math.exp(-(age - 0.08) / 0.035));
    if (!steady && age > 0.17) light = Math.max(light, 0.5 * Math.exp(-(age - 0.17) / 0.05));
    return light + 0.12 * Math.exp(-age / 0.16);
};

export class TornadoWorld {
    /**
     * @param {object} options
     * @param {THREE.Scene} options.scene
     * @param {string} [options.quality='High']
     * @param {boolean} [options.capture=false] a frozen or stepped clock: nothing eases in
     */
    constructor({ scene, quality = 'High', capture = false } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.u = createUniforms();
        this.root = new THREE.Group();
        this.root.name = 'tornado-world';
        this.parts = new Map();
        this.noise = null;
        this.sky = null;
        this.funnel = null;
        this.field = null;
        this.fx = null;
        this.reduced = false;
        this.aspect = 16 / 9;
        this.bufferHeight = 1080;
        this.layout = null;
        this.live = {
            speed: 1, girth: 1, rope: 1, lean: 0, flare: 1, tint: [1, 1, 1],
        };
        this._camera = null;
        this._pos = new THREE.Vector3(0, WORLD.eye, 0);
        this._right = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._fwd = new THREE.Vector3(0, 0, -1);
        this._point = new THREE.Vector3();
        this._rgb = [1, 1, 1];
        this._palette = {};
        this._post = {
            flash: 0,
            kick: 0,
            bloomBoost: 0,
            exposure: 1,
            ripple: {
                x: 0.5, y: 0.6, radius: 0, strength: 0,
            },
        };
        this.axisTarget = new THREE.Vector2(-300, -650);
        this.sunAzimuth = 0.5;
        this.funnelScreenX = 0.2;
        this.funnelBeside = true;
        this.composed = false;
        /** Ribbons this tier draws (the shader's loop: tornado-funnel.js). */
        this.ribbonSlots = Math.min(RIBBONS, this.tier.ribbons ?? RIBBONS);
        /**
         * Every answer to play ACCUMULATES (src/themes/shared/swell.js): a new hit adds to what is
         * still lit and never restarts it, so a weak hit after a strong one can only lift the
         * light, and two quads in a row are more than one.
         *   swell     the funnel breathes out into a wedge (a clear; a quad fully)
         *   spinKick  the funnel spins up (a T-spin, a chain's clears, an unwind)
         *   raysBoost the sun's shafts under the deck
         *   shake, kick, lensFlash   the lens: a jolt, the fringe, the iris on a stroke
         *   glint     the ribbons flare (a clear's release, a chain's winding)
         *   gapOpen   the gap opens to full light (a perfect clear)
         */
        this.swell = new Swell({ release: 1.3, ceiling: 1.5, knee: 1 });
        this.spinKick = new Swell({ release: 0.7, ceiling: 2.5, knee: 1.5 });
        this.raysBoost = new Swell({ release: 2.4, ceiling: 2.4, knee: 1.5 });
        this.shake = new Swell({ release: 0.35, ceiling: 0.016, knee: 0.01 });
        this.kick = new Swell({ release: 0.3, ceiling: 1.2, knee: 0.8 });
        this.lensFlash = new Swell({ release: 0.16, ceiling: 1.2, knee: 0.7 });
        this.glint = new Swell({ release: 0.45, ceiling: 1.5, knee: 0.9 });
        this.gapOpen = new Swell({
            attack: 0.35, release: 2.6, ceiling: 1.2, knee: 0.9,
        });
        /**
         * The storm breathes out when a chain ends or a perfect clear crowns it: the fever's hold
         * on the storm eases at once (the heat of play itself takes a few seconds to cool).
         */
        this.exhale = new Swell({
            attack: 0.4, release: 3, ceiling: 1, knee: 0.8,
        });
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), on the storm's clock. Calm: the
         * storm as it was. Warm: the inflow quickens, the field leans in, the cloud flickers more.
         * Hot: the funnel thickens and spins, satellites circle its foot, the wall cloud takes on
         * the colours it holds. Fever: the storm at full fury: a wedge, lightning by itself,
         * the deck lit from inside, the shafts through the gap blazing.
         */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** The chain's colours, eased (what u.charge carries before its light), and their weight. */
        this.chargeRgb = [0, 0, 0];
        this.chargeHeld = 0;
        /** Settings > Reduce flashing (src/utils/photosensitivity.js), read once a frame. */
        this.flashK = 1;
        this.frameDt = 0;
        this.storm = 0;
        /** How far a perfect clear has opened the gap (the hour's light lifts with it). */
        this.gapLight = 0;
        this.resetState(0);
    }

    /** The storm at rest at `time`: no chain, no ribbons, nothing in flight. */
    resetState(time) {
        this.time = time;
        this.rand = mulberry32(20261009);
        this.combo = 0;
        this.fury = 0;
        this.furyTarget = 0;
        this.level = 1;
        this.hourShift = 0;
        [this.swell, this.spinKick, this.raysBoost, this.shake, this.kick, this.lensFlash, this.glint,
            this.gapOpen, this.exhale, this.surge].forEach((envelope) => envelope.reset());
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        this.feverSeen = 0;
        this.chargeRgb.fill(0);
        this.chargeHeld = 0;
        this.storm = 0;
        this.gapLight = 0;
        /** The dust front: when it left the foot, and how much dust it carries (fed by more quads). */
        this.shockAt = -100;
        this.shockPower = 1;
        /** A perfect clear spent the chain: its end needs no second unwind. */
        this.chainSpent = false;
        /** Difficult clears in a row (back-to-back): each answers bigger. */
        this.b2bStreak = 0;
        /** The storm's own lightning in a fever, and the hush it keeps after a perfect clear. */
        this.nextStormStrike = time;
        this.quietUntil = -100;
        this.nextFlicker = time + 2.5;
        this.scheduled = [];
        this.ribbons = Array.from({ length: RIBBONS }, () => ({
            on: false,
            t0: 0,
            rgb: [1, 1, 1],
            phase: 0,
            turns: 3,
            power: 1,
            released: -1,
            pace: 1,
            // The next ribbon, waiting for this one to climb off (a chain longer than the funnel).
            queued: false,
            next: {
                at: 0, rgb: [1, 1, 1], phase: 0, turns: 3, power: 1,
            },
        }));
        this.rings = Array.from({ length: RINGS }, () => ({
            on: false, t0: 0, x: 0, z: 0, speed: 20, life: 1, rgb: [1, 1, 1], strength: 0, width: 2,
        }));
        this.flashes = Array.from({ length: FLASHES }, () => ({
            on: false, t0: 0, x: 0, z: 0, power: 0, reach: 400, life: 0.5,
        }));
        this.bolts = Array.from({ length: BOLTS }, () => ({ on: false, t0: 0, power: 1 }));
        this.cursor = {
            ribbon: 0, ring: 0, flash: 0, flight: 0, bolt: 0,
        };
        const { u } = this;
        u.tables.flights.forEach((row) => row.set(0, 0, 0, -100));
        u.tables.ribbons.forEach((row) => row.set(0, 0, 0, 0));
        u.tables.rings.forEach((row) => row.set(0, 0, 0, 0));
        u.tables.flashes.forEach((row) => row.set(0, 0, 0, 1));
        u.tables.bolts.forEach((row) => row.set(0, 0, 0, 0));
        // The clocks, as if the storm had blown at rest since zero.
        u.spin.value = time * 0.11;
        u.flow.value = time * 0.16;
        u.wind.value = time;
        u.deck.value = time / 46;
        u.deckTurn.value = time * 0.006;
        u.gust.value.set(0, 0);
        u.charge.value.set(0, 0, 0);
        this.gustTravel = time * 14;
    }

    build() {
        const { u, tier } = this;
        this.noise = createNoiseTexture(1925);
        this.sky = createSky({ u, noise: this.noise, tier });
        this.field = createField({ u, noise: this.noise, tier });
        this.funnel = createFunnel({ u, noise: this.noise, tier });
        this.fx = createFx({ u, tier });
        this.addPart('sky', this.sky.object);
        this.addPart('ground', this.field.ground);
        this.addPart('wheat', this.field.wheat);
        this.addPart('props', this.field.poles);
        this.addPart('funnel', this.funnel.object);
        this.addPart('debris', this.funnel.debris);
        this.addPart('motes', this.fx.motes);
        this.addPart('bolts', this.fx.bolts);
        this.scene.add(this.root);
        this.compose();
        this.applyPalette();
        return this;
    }

    addPart(name, object) {
        this.parts.set(name, object);
        this.root.add(object);
    }

    /** Debug: draw only the named parts. */
    showOnlyParts(names) {
        const wanted = new Set(names);
        this.parts.forEach((object, name) => {
            object.visible = wanted.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (bufferHeight > 0) this.bufferHeight = bufferHeight;
        if (aspect > 0) this.aspect = aspect;
        this.updatePixelAngle();
        this.compose();
    }

    /** The live card/board/HUD rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (aspect > 0) this.aspect = aspect;
        this.compose();
    }

    setReducedMotion(reduced) {
        this.reduced = reduced === true;
    }

    /** The Themes tab's live controls (the settings' own keys). */
    setLiveParams(params = {}) {
        const num = (key) => (Number.isFinite(Number(params[key])) ? Number(params[key]) : LIVE_REFERENCE[key]);
        const { live } = this;
        live.speed = clamp(num('timeScale'), 0.1, 3);
        live.girth = clamp(num('ribbonWidth'), 0.5, 1.5);
        live.rope = clamp(num('parabolaStrength'), 0, 4);
        live.lean = clamp(num('parabolaOffset') - LIVE_REFERENCE.parabolaOffset, -1.35, 0.65);
        live.flare = clamp(num('parabolaAmplitude') / LIVE_REFERENCE.parabolaAmplitude, 0, 3);
        const chosen = [1, 1, 1];
        const reference = [1, 1, 1];
        hexToLinear(LIVE_REFERENCE.emissiveColor, reference);
        if (hexToLinear(params.emissiveColor, chosen)) {
            const ratio = chosen.map((c, i) => (c + 0.02) / (reference[i] + 0.02));
            const top = Math.max(ratio[0], ratio[1], ratio[2]);
            for (let i = 0; i < 3; i += 1) live.tint[i] = 1 + (ratio[i] / top - 1) * 0.8;
        } else {
            live.tint[0] = 1;
            live.tint[1] = 1;
            live.tint[2] = 1;
        }
        this.applyPalette();
    }

    seek(time) {
        this.resetState(time);
        this.applyPalette();
        this.writeTables();
    }

    /**
     * A new run: the storm goes back to rest, the funnel empties. The heat of play breathes out
     * on its own (the surge is not cut): the last run's storm eases down, it does not snap.
     */
    resetSession() {
        this.combo = 0;
        this.furyTarget = 0;
        this.level = 1;
        this.hourShift = 0;
        this.chainSpent = false;
        this.b2bStreak = 0;
        this.scheduled.length = 0;
        this.ribbons.forEach((r) => {
            if (r.on && r.released < 0) r.released = this.time;
            r.queued = false;
        });
    }

    bindCamera(camera) {
        this._camera = camera;
        this.updatePixelAngle();
    }

    fov() {
        return fovForAspect(this.aspect);
    }

    updatePixelAngle() {
        const fov = this._camera?.fov ?? this.fov();
        this.u.pixelAngle.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, this.bufferHeight);
    }

    /** The layout the picture is composed for: the live one, else the stylesheet's solo layout. */
    layoutNow() {
        if (this.layout) return this.layout;
        const win = typeof window !== 'undefined' ? window : null;
        const height = win?.innerHeight || 1080;
        const width = win?.innerWidth || height * this.aspect;
        return fallbackLayout(width, height);
    }

    /** Screen x (0..1) → the azimuth of that column at rest (radians, + = right of the lens). */
    azimuthOf(sx) {
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        return Math.atan((sx * 2 - 1) * tan * this.aspect);
    }

    /**
     * Stand the funnel in the free space left of the card (behind and above it when the screen
     * is too narrow to have any), and the sun low on the right.
     */
    compose() {
        const card = cardUnion(this.layoutNow());
        const free = card ? card.x0 : 0.3;
        this.funnelBeside = free > 0.15;
        this.funnelScreenX = this.funnelBeside ? clamp(free * 0.52, 0.1, 0.3) : 0.5;
        const az = this.azimuthOf(this.funnelScreenX);
        this.axisTarget.set(Math.sin(az) * WORLD.distance, -Math.cos(az) * WORLD.distance);
        this.sunAzimuth = this.azimuthOf(this.funnelBeside ? WORLD.sunScreenX : 0.84);
        if (!this.composed || this.capture) {
            this.u.axis.value.set(this.axisTarget.x, 0, this.axisTarget.y);
            this.composed = true;
        }
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const still = this.reduced;
        let yaw = 0;
        let { pitch } = REST_RIG;
        let x = 0;
        let y = WORLD.eye;
        let z = 0;
        if (!still) {
            yaw = Math.sin(t * 0.05) * 0.02 + Math.sin(t * 0.017 + 1.3) * 0.011 - (sim.pointerX || 0) * 0.02;
            pitch += Math.sin(t * 0.037 + 0.7) * 0.006 - (sim.pointerY || 0) * 0.012;
            x = Math.sin(t * 0.031) * 0.3;
            y += Math.sin(t * 0.043) * 0.05;
            z = Math.cos(t * 0.027) * 0.2;
            const shake = this.shake.valueAt(t);
            if (shake > 1e-4) {
                yaw += shake * Math.sin(t * 61.3) * Math.cos(t * 23.1);
                pitch += shake * Math.sin(t * 47.9 + 1.0);
            }
            // A long chain buffets the lens, and a fever leans on it.
            const buffet = (this.fury + this.feverSeen * 0.8) * 0.0016;
            yaw += buffet * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1.7);
            pitch += buffet * Math.sin(t * 6.1 + 0.4) * Math.cos(t * 3.7);
            // Every impact ducks the lens a hair; under rapid play it rides low instead of bobbing.
            pitch -= this.heat.punch * 0.0035;
        }
        const fov = this.fov();
        if (camera.fov !== fov) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
            this.updatePixelAngle();
        }
        camera.position.set(x, y, z);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
        // The shared breath (shared/camera-breath.js) on top of the drift above: a rotation-only
        // rig with no look target, so it only turns. Off under reduced motion.
        applyCameraBreath(camera, t, { scale: still ? 0 : 1 });
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        this._pos.copy(camera.position);
        this._right.set(e[0], e[1], e[2]);
        this._up.set(e[4], e[5], e[6]);
        this._fwd.set(-e[8], -e[9], -e[10]);
        this.u.camRight.value.copy(this._right);
        this.u.camUp.value.copy(this._up);
    }

    /** A screen point (fractions, y down) → the ray through it, in `out` (unit). */
    screenRay(sx, sy, out = this._point) {
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        const nx = (sx * 2 - 1) * tan * this.aspect;
        const ny = (1 - sy * 2) * tan;
        return out.copy(this._fwd).addScaledVector(this._right, nx).addScaledVector(this._up, ny).normalize();
    }

    /** A screen point → the world point `depth` metres along its ray. */
    screenToWorld(sx, sy, depth, out = this._point) {
        this.screenRay(sx, sy, out);
        return out.multiplyScalar(depth).add(this._pos);
    }

    /** A screen point → where its ray meets the field (at most `reach` metres out). */
    screenToGround(sx, sy, reach, out = this._point) {
        this.screenRay(sx, sy, out);
        const along = out.y < -0.02 ? Math.min(reach, -this._pos.y / out.y) : reach;
        out.multiplyScalar(along).add(this._pos);
        out.y = 0;
        return out;
    }

    // ── events ──────────────────────────────────────────────────────────────────

    schedule(time, run) {
        this.scheduled.push({ time, run });
    }

    colourOf(hex) {
        const rgb = this._rgb;
        if (!hexToLinear(hex, rgb)) {
            rgb[0] = DEFAULT_SPARK[0];
            rgb[1] = DEFAULT_SPARK[1];
            rgb[2] = DEFAULT_SPARK[2];
        }
        // Lift a dark colour so every piece's light reads against the storm.
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
        const gain = Math.max(1, 0.8 / peak);
        rgb[0] = Math.min(1.4, rgb[0] * gain);
        rgb[1] = Math.min(1.4, rgb[1] * gain);
        rgb[2] = Math.min(1.4, rgb[2] * gain);
        return rgb;
    }

    /** What is left of a ring's light now (0 once it has run out). */
    ringLeft(r) {
        const age = this.time - r.t0;
        if (!r.on || age > r.life) return 0;
        if (age < 0) return r.strength;
        const left = 1 - age / r.life;
        return r.strength * left * left;
    }

    /** What is left of a cloud flash's light now. */
    flashLeft(f) {
        const age = this.time - f.t0;
        if (!f.on || age > f.life) return 0;
        return f.power * Math.exp((-Math.max(0, age) * 4) / f.life);
    }

    ring(x, z, rgb, {
        speed = 26, life = 1.7, strength = 0.9, width = 2.2,
    } = {}) {
        // The ring with the least light left makes room: a quad's rings and a lock's run together.
        let slot = this.rings[0];
        let least = Infinity;
        for (let i = 0; i < RINGS; i += 1) {
            const left = this.ringLeft(this.rings[i]);
            if (left < least) {
                least = left;
                slot = this.rings[i];
            }
        }
        this.cursor.ring += 1;
        slot.on = true;
        slot.t0 = this.time;
        slot.x = x;
        slot.z = z;
        slot.speed = speed;
        slot.life = life;
        slot.strength = strength;
        slot.width = width;
        slot.rgb[0] = rgb[0];
        slot.rgb[1] = rgb[1];
        slot.rgb[2] = rgb[2];
    }

    /**
     * Light inside the cloud above (x, z). The flash with the least light left makes room, so a
     * clear's great glow is never cut by its own strikes; an idle flicker that would be lost in
     * what is already lit is not drawn at all (`idle`). Under Reduce flashing it is softer and
     * steady (ADR-0021).
     */
    flash(x, z, power, reach = 460, life = 0.6, idle = false) {
        let slot = this.flashes[0];
        let least = Infinity;
        for (let i = 0; i < FLASHES; i += 1) {
            const left = this.flashLeft(this.flashes[i]);
            if (left < least) {
                least = left;
                slot = this.flashes[i];
            }
        }
        const light = power * (0.35 + 0.65 * this.flashK);
        if (idle && least > light * 0.6) return;
        this.cursor.flash += 1;
        slot.on = true;
        slot.t0 = this.time;
        slot.x = x;
        slot.z = z;
        slot.power = light;
        slot.reach = reach;
        slot.life = life;
    }

    /** Is screen x clear of the card, the HUD and the funnel? */
    openSky(sx, card, hud) {
        return !(card && sx > card.x0 - 0.02 && sx < card.x1 + 0.02)
            && !(hud && sx > hud.x0 - 0.015 && sx < hud.x1 + 0.015)
            && Math.abs(sx - this.funnelScreenX) > 0.045;
    }

    /**
     * A channel of lightning down beside the card (or at screen x `at`, `range` metres out). The
     * channel whose stroke is over (else the oldest) takes it, so a channel never jumps mid-stroke.
     * `lens` is how hard it closes the iris.
     */
    strike(power = 1, { at = null, range = null, lens = 0.55 } = {}) {
        let sx = at;
        if (sx === null) {
            const layout = this.layoutNow();
            const card = cardUnion(layout);
            const { hud } = layout;
            let open = 0;
            for (let i = 0; i < STRIKE_SLOTS.length; i += 1) if (this.openSky(STRIKE_SLOTS[i], card, hud)) open += 1;
            let pick = Math.floor(this.rand() * (open || STRIKE_SLOTS.length)) % (open || STRIKE_SLOTS.length);
            for (let i = 0; i < STRIKE_SLOTS.length; i += 1) {
                if (!open || this.openSky(STRIKE_SLOTS[i], card, hud)) {
                    if (pick === 0) {
                        sx = STRIKE_SLOTS[i];
                        break;
                    }
                    pick -= 1;
                }
            }
        }
        const az = this.azimuthOf(sx);
        const out = range ?? 520 + this.rand() * 900;
        const x = Math.sin(az) * out;
        const z = -Math.cos(az) * out;
        let index = 0;
        for (let i = 1; i < BOLTS; i += 1) {
            const b = this.bolts[i];
            const best = this.bolts[index];
            const spent = !b.on || this.time - b.t0 > 0.6;
            const bestSpent = !best.on || this.time - best.t0 > 0.6;
            if ((spent && !bestSpent) || (spent === bestSpent && b.t0 < best.t0)) index = i;
        }
        this.cursor.bolt += 1;
        this.fx?.strike(index, x, z, this.rand);
        const bolt = this.bolts[index];
        bolt.on = true;
        bolt.t0 = this.time;
        bolt.power = power;
        this.flash(x, z, 1.05 * power, 360, 0.55);
        this.ring(x, z, this._palette.bolt || [0.8, 0.86, 1], {
            speed: 95, life: 1.3, strength: 0.75 * power, width: 9,
        });
        this.lensFlash.hit(lens * power, this.time);
    }

    onLock(c = {}) {
        const layout = this.layoutNow();
        const board = boardFor(layout, c.player) || layout.cards[0];
        const card = cardUnion(layout) || board;
        const rows = c.rows?.length ? c.rows : [19];
        let row = 0;
        for (let i = 0; i < rows.length; i += 1) row += rows[i];
        const at = boardPoint(board, c.u ?? 0.5, row / rows.length);
        const rgb = this.colourOf(c.color);
        const hard = c.hardDrop === true;
        const power = hard ? 1.7 : 1;

        // The sparks leave the card's edge on the funnel's side, at the piece's own height.
        let sx = this.funnelScreenX < (card.x0 + card.x1) * 0.5 ? card.x0 : card.x1;
        let sy = at.y;
        if (!this.funnelBeside) {
            sx = at.x;
            sy = card.y0;
        }
        if (c.screen) {
            sx = c.screen.x;
            sy = c.screen.y;
        }
        const origin = this.screenToWorld(sx, sy, 46);
        const flight = this.cursor.flight % FLIGHTS;
        this.cursor.flight += 1;
        const { tables } = this.u;
        tables.flights[flight * 2].set(origin.x, origin.y, origin.z, this.time);
        tables.flights[flight * 2 + 1].set(rgb[0], rgb[1], rgb[2], power);

        // The funnel takes the colour when they arrive.
        this.feedRibbon(rgb, power);

        // A gust ring through the wheat under the piece's column.
        const foot = this.screenToGround(c.screen ? sx : at.x, Math.min(0.985, card.y1 + 0.03), 70);
        // Never under the lens: the ring starts out in the field and is seen running away.
        const fx = foot.x - this._pos.x;
        const fz = foot.z - this._pos.z;
        const near = Math.hypot(fx, fz) || 1;
        const out = Math.max(near, 12);
        foot.x = this._pos.x + (fx / near) * out;
        foot.z = this._pos.z + (fz / near) * out;
        this.ring(foot.x, foot.z, rgb, hard
            ? {
                speed: 40, life: 2.2, strength: 1.2, width: 1.9,
            }
            : {
                speed: 26, life: 1.7, strength: 0.9, width: 1.3,
            });
        if (hard) {
            this.shake.hit(0.004, this.time);
            this.kick.hit(0.5, this.time);
            this.flash(this.u.axis.value.x, this.u.axis.value.z, 0.5, 380, 0.4);
        }
        this.surge.lock(c, this.time);
    }

    /**
     * A ribbon for a piece whose sparks are on their way. A free slot takes it; else one already
     * letting go; else the oldest ribbon held lets go (it climbs off into the cloud) and the new
     * one waits for it to leave. Never a lit ribbon cut off mid-climb.
     */
    feedRibbon(rgb, power) {
        const at = this.time + SPARK_FLIGHT;
        let pick = null;
        let score = Infinity;
        for (let i = 0; i < this.ribbonSlots; i += 1) {
            const r = this.ribbons[i];
            if (r.queued) continue;
            let s = r.t0; // the oldest held
            if (!r.on) s = -Infinity; // free
            else if (r.released >= 0) s = r.released - 1e6; // already on its way out
            if (s < score) {
                score = s;
                pick = r;
            }
        }
        if (!pick) {
            // Every slot already has a ribbon waiting: the earliest wait is overtaken by this one.
            for (let i = 0; i < this.ribbonSlots; i += 1) {
                const r = this.ribbons[i];
                if (!pick || r.next.at < pick.next.at) pick = r;
            }
        }
        this.cursor.ribbon += 1;
        const phase = this.rand();
        const turns = 2.2 + this.rand() * 2.6;
        if (!pick.on && !pick.queued) {
            pick.on = true;
            pick.t0 = at;
            pick.phase = phase;
            pick.turns = turns;
            pick.power = power;
            pick.released = -1;
            pick.pace = 1;
            pick.rgb[0] = rgb[0];
            pick.rgb[1] = rgb[1];
            pick.rgb[2] = rgb[2];
            return;
        }
        if (pick.released < 0) pick.released = Math.max(this.time, pick.t0);
        const { next } = pick;
        pick.queued = true;
        next.at = Math.max(at, pick.released + RIBBON_GONE / pick.pace);
        next.phase = phase;
        next.turns = turns;
        next.power = power;
        next.rgb[0] = rgb[0];
        next.rgb[1] = rgb[1];
        next.rgb[2] = rgb[2];
    }

    /**
     * Let the ribbons held go, oldest first, `step` seconds apart, climbing at `pace` (a ribbon
     * still in the air flares as it arrives). Only those fed before `before` (seconds of
     * arrival). Returns how many.
     */
    releaseHeld(before = Infinity, { step = 0, pace = 1 } = {}) {
        let count = 0;
        for (let i = 0; i < this.ribbonSlots; i += 1) {
            const r = this.ribbons[i];
            if (!r.on || r.released >= 0 || r.t0 >= before) continue;
            let rank = 0;
            for (let j = 0; j < this.ribbonSlots; j += 1) {
                const o = this.ribbons[j];
                if (j !== i && o.on && o.released < 0 && o.t0 < before && (o.t0 < r.t0 || (o.t0 === r.t0 && j < i))) {
                    rank += 1;
                }
            }
            r.released = Math.max(this.time + rank * step, r.t0);
            r.pace = pace;
            count += 1;
        }
        return count;
    }

    /**
     * The chain is over: the funnel lets go of everything it wound on, oldest first, and the
     * storm breathes out: the cloud lights from inside as the ribbons shoot up into it, the
     * funnel spins as it unwinds, the shafts brighten. As big as the chain was long.
     */
    unwind(chain) {
        // The ribbon fed this very frame (the lock that broke the chain) stays: it starts the next.
        const held = this.releaseHeld(this.time + SPARK_FLIGHT - 1e-6, { step: UNWIND_STEP, pace: UNWIND_PACE });
        if (held === 0 && chain < 3) return;
        const k = Math.min(1, Math.max(held, chain - 1) / 8);
        const { axis } = this.u;
        const t = this.time;
        this.exhale.hit(0.6 * k, t);
        this.glint.hit(0.35 + 0.35 * k, t);
        this.spinKick.hit(0.5 + 0.9 * k, t);
        this.raysBoost.hit(0.35 + 0.6 * k, t);
        this.swell.hit(0.2 + 0.3 * k, t);
        this.flash(axis.value.x, axis.value.z, 0.85 + 0.6 * k, 480 + 420 * k, 1 + 0.5 * k);
        if (held >= 4) this.schedule(t + 0.3, () => this.strike(1 + 0.3 * k, { lens: 0.35 }));
    }

    /**
     * The dust front of a big clear. One still rolling toward the lens is FED (thicker, taller,
     * the field laid flatter), never yanked back to the funnel; once it has passed the lens a new
     * one may leave.
     */
    dustFront(power) {
        const since = this.time - this.shockAt;
        if (since > -0.25 && since < WORLD.distance / 300) {
            this.shockPower = Math.min(2.2, this.shockPower + power * 0.6);
            this.shake.hit(0.003, this.time);
            return;
        }
        this.shockAt = this.time + 0.2;
        this.shockPower = power;
    }

    onClear(c = {}) {
        const lines = clamp(Math.round(c.lines || 1), 1, 4);
        const depth = clamp(Math.round(c.cascade || 1), 1, 10);
        const combo = Math.max(1, Math.round(c.combo || 1));
        const t = this.time;
        this.surge.clear(c, t);
        // A perfect clear that arrives after its clear (physics sends it ~360 ms later): the crown
        // on the clear still playing, never a second one.
        if (c.crown === true) {
            this.crown();
            return;
        }
        const big = lines >= 4 || c.perfect === true;
        const difficult = lines >= 4 || c.tspin === true;
        if (c.b2b === true) this.b2bStreak += 1;
        else if (!difficult && depth === 1) this.b2bStreak = 0;

        // The funnel. The first clear of a chain lets go of what it held, as ever: a clear lets
        // the ribbons go. Every clear after it in the chain KEEPS its ribbons: the funnel winds
        // tighter, spins faster and its ribbons flare, so a chain builds the storm instead of
        // emptying it, until the chain ends and it lets everything go at once (onCombo).
        if (depth === 1 && combo <= 1) {
            this.chainSpent = false;
            this.releaseHeld();
            this.glint.hit(1, t);
        } else if (depth === 1) {
            this.glint.hit(0.12 + 0.015 * Math.min(combo, 10), t);
            this.spinKick.hit(0.22, t);
        } else {
            // A cascade's next wave: the ribbons flare harder each time.
            this.glint.hit(0.1 + 0.07 * depth, t);
            this.spinKick.hit(0.15 * depth, t);
        }

        // Lightning: one channel per line, and one more for every wave of a cascade, each wave
        // brighter, wider and quicker than the last.
        const wave = depth - 1;
        const { axis } = this.u;
        const glow = (big ? 1.3 : 0.8 + lines * 0.15) + 0.12 * wave;
        this.flash(axis.value.x, axis.value.z, glow, 480 + 70 * wave, big ? 1.1 : 0.7);
        const strikes = Math.min(BOLTS, lines + wave);
        const power = (big ? 1.25 : 1) * (1 + 0.12 * wave);
        const gap = 0.11 / (1 + 0.25 * wave);
        for (let i = 0; i < strikes; i += 1) {
            this.schedule(t + 0.1 + i * gap, () => this.strike(power));
        }
        if (c.tspin) this.spinKick.hit(1, t);
        this.kick.hit(0.3 + lines * 0.15 + 0.08 * wave, t);
        if (big) {
            this.swell.hit(1, t);
            this.dustFront(1);
            this.shake.hit(0.009, t);
            this.raysBoost.hit(0.9, t);
        } else {
            this.swell.hit(0.16 * lines * (1 + 0.35 * wave), t);
        }
        if (c.b2b === true) this.backToBack();
        // A perfect clear in the same frame as its rows: the crown on top of the clear.
        if (c.perfect === true) this.crown();
    }

    /**
     * Back-to-back: the storm answers the second difficult clear at its heart. Twin channels come
     * down either side of the funnel and the funnel takes the strike (it spins, its ribbons flare,
     * the wall cloud lights); every difficult clear more in the streak adds a channel.
     */
    backToBack() {
        const t = this.time;
        const streak = Math.min(4, this.b2bStreak);
        const layout = this.layoutNow();
        const card = cardUnion(layout);
        const { hud } = layout;
        const power = 1.2 + 0.15 * streak;
        const range = WORLD.distance * (0.9 + this.rand() * 0.25);
        const channels = Math.min(BOLTS - 1, 1 + streak);
        for (let i = 0; i < channels; i += 1) {
            // Alternating sides of the funnel, stepping out.
            const side = i % 2 === 0 ? -1 : 1;
            let sx = this.funnelScreenX + side * (0.055 + 0.03 * Math.floor(i / 2));
            if (!this.funnelBeside || !(sx > 0.02 && sx < 0.98) || !this.openSky(sx, card, hud)) sx = null;
            this.schedule(t + 0.04 + i * 0.07, () => this.strike(power, { at: sx, range: sx === null ? null : range }));
        }
        const { axis } = this.u;
        this.flash(axis.value.x, axis.value.z, 1.15 + 0.1 * streak, 620, 0.9);
        this.spinKick.hit(0.8 + 0.2 * streak, t);
        this.glint.hit(0.6 + 0.15 * streak, t);
        this.raysBoost.hit(0.5, t);
    }

    /**
     * The perfect clear, layered on the clear still playing (never a second quad): the funnel
     * lets go of everything it holds in one great unwind, the gap opens to full golden light, the
     * deck lights from inside, the dust front still rolling is fed. The chain is spent: the storm
     * eases out of its fury and keeps its own lightning back a moment, so this is the release.
     */
    crown() {
        const t = this.time;
        const held = this.releaseHeld(Infinity, { step: UNWIND_STEP, pace: UNWIND_PACE });
        const k = Math.min(1, held / 8);
        this.exhale.hit(1, t);
        const { axis } = this.u;
        this.gapOpen.hit(1, t);
        this.raysBoost.hit(1.4, t);
        // Each ribbon flares as it lets go: the funnel as a whole only glints, or the release
        // would be a haze instead of threads of colour climbing into the cloud.
        this.glint.hit(0.4 + 0.2 * k, t);
        this.spinKick.hit(1.2, t);
        this.swell.hit(0.4, t);
        this.flash(axis.value.x, axis.value.z, 1.2, 950, 1.5);
        this.dustFront(0.8);
        this.chainSpent = true;
        this.furyTarget = 0;
        this.quietUntil = t + CROWN_QUIET;
    }

    /** A T-spin that cleared nothing: the funnel twists up and the wall cloud glows a moment. */
    onTSpin() {
        const t = this.time;
        const { axis } = this.u;
        this.spinKick.hit(0.7, t);
        this.glint.hit(0.35, t);
        this.kick.hit(0.2, t);
        this.flash(axis.value.x, axis.value.z, 0.5, 380, 0.5);
    }

    /**
     * The true combo (0 = the chain broke). A chain that ends lets the funnel unwind; a chain a
     * perfect clear already spent does not unwind twice.
     */
    onCombo(combo) {
        const n = Math.max(0, Math.round(combo || 0));
        const was = this.combo;
        if (n < was && was >= 2 && !this.chainSpent) this.unwind(was);
        if (n < was || n === 0) this.chainSpent = false;
        this.combo = n;
        this.furyTarget = this.chainSpent ? 0 : furyFor(n);
    }

    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(level || 1));
        if (silent) {
            this.hourShift = this.level - 1;
            this.applyPalette();
            return;
        }
        this.schedule(this.time + 0.05, () => this.strike(1.2));
        this.raysBoost.hit(1.2, this.time);
        this.swell.hit(0.35, this.time);
        this.surge.levelUp(this.time);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    wheel() {
        return this.time / HOUR_SECONDS + this.hourShift;
    }

    applyPalette() {
        const p = paletteAt(this.wheel(), this._palette);
        const { u, live } = this;
        const open = 1 + 0.4 * this.gapLight;
        const set = (key) => {
            const c = p[key];
            const tinted = TINTED.includes(key);
            const lift = GAP_LIT.includes(key) ? open : 1;
            u[key].value.set(
                c[0] * (tinted ? live.tint[0] : 1) * lift,
                c[1] * (tinted ? live.tint[1] : 1) * lift,
                c[2] * (tinted ? live.tint[2] : 1) * lift,
            );
        };
        ['sun', 'gapLow', 'gapHigh', 'skyTop', 'cloudDark', 'cloudMid', 'cloudLit', 'cloudRim', 'wheatLit',
            'wheatShade', 'haze', 'funnelLit', 'funnelShade', 'dust', 'bolt'].forEach(set);
        u.sunPower.value = p.sunPower * (1 + 0.9 * this.gapLight);
        const el = p.sunElev;
        u.sunDir.value.set(
            Math.sin(this.sunAzimuth) * Math.cos(el),
            Math.sin(el),
            -Math.cos(this.sunAzimuth) * Math.cos(el),
        );
        return p;
    }

    /** The event tables, as they stand at this.time. */
    writeTables() {
        const { time, u } = this;
        const { tables } = u;
        // A wound-up storm: the ribbons it holds wind tighter (their turns rise smoothly with the
        // chain, so the helices visibly wind on, and unwind as it lets go), sit a little lower
        // under the wall cloud, and burn brighter, each a little less the more there are, so a
        // funnel full of them reads as threads of light round a column, not a lamp.
        const { fury } = this;
        const wind = 1 + 0.35 * fury;
        const crest = 0.92 - 0.07 * fury;
        const fever = this.feverSeen;
        const steady = this.flashK < 1;
        const rgb = this.chargeRgb;
        let count = 0;
        for (let i = 0; i < RIBBONS; i += 1) {
            const r = this.ribbons[i];
            if (r.queued && time >= r.next.at) {
                // The ribbon that was waiting for this slot takes it.
                const { next } = r;
                r.queued = false;
                r.on = true;
                r.t0 = next.at;
                r.phase = next.phase;
                r.turns = next.turns;
                r.power = next.power;
                r.pace = 1;
                r.released = -1;
                r.rgb[0] = next.rgb[0];
                r.rgb[1] = next.rgb[1];
                r.rgb[2] = next.rgb[2];
            }
            if (r.on && time >= r.t0 && (r.released < 0 || time < r.released)) count += 1;
        }
        const burn = (1 + 0.2 * fury + 0.25 * fever) * Math.max(1, count / 4) ** -0.4;
        let held = 0;
        let r0 = 0;
        let g0 = 0;
        let b0 = 0;
        for (let i = 0; i < RIBBONS; i += 1) {
            const r = this.ribbons[i];
            const shape = tables.ribbons[i * 2];
            const age = time - r.t0;
            if (!r.on || age < 0) {
                shape.set(0, 0, 0, 0);
                continue;
            }
            let head = clamp(age / RIBBON_CLIMB, 0, 1) * crest;
            let tail = clamp((age - RIBBON_HOLD) / RIBBON_LEAVE, 0, 1) * crest;
            let light = r.power * smooth01(age / 0.5) * (1 - smooth01((age - RIBBON_HOLD) / RIBBON_LEAVE));
            let weight = 1;
            const gone = r.released >= 0 ? time - r.released : -1;
            if (gone >= 0) {
                // Letting go, it climbs off into the cloud and flares: the cloud takes its colour
                // as it goes in. A chain's unwind climbs slower (its `pace`): the funnel unwinds.
                const p = r.pace;
                head = Math.min(1.02, head + gone * 2.4 * p);
                tail = Math.min(1.02, tail + Math.max(0, gone - 0.08 / p) * 1.5 * p);
                const flare = Math.exp(-gone * 3.5 * p);
                light *= 1 + 2.2 * flare * Math.min(1, p * 1.2);
                weight = 2.5 * flare;
                if (tail >= 1) r.on = false;
            } else {
                light *= burn;
            }
            if (!r.on || light <= 0.001) {
                r.on = r.on && age < RIBBON_HOLD + RIBBON_LEAVE;
                shape.set(0, 0, 0, 0);
                continue;
            }
            shape.set(r.phase, head, tail, light);
            tables.ribbons[i * 2 + 1].set(r.rgb[0], r.rgb[1], r.rgb[2], r.turns * wind);
            const w = weight * smooth01(age / 0.8);
            held += w;
            r0 += r.rgb[0] * w;
            g0 += r.rgb[1] * w;
            b0 += r.rgb[2] * w;
        }
        // The colours the storm is wound with, eased (a new ribbon tints it, never snaps it) and
        // kept saturated: an average of many colours alone would be a grey haze.
        if (held > 1e-3) {
            const k = this.capture ? 1 : approach(2.5, this.frameDt);
            const cr = r0 / held;
            const cg = g0 / held;
            const cb = b0 / held;
            const luma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
            rgb[0] += (Math.max(0, luma + (cr - luma) * 1.9) - rgb[0]) * k;
            rgb[1] += (Math.max(0, luma + (cg - luma) * 1.9) - rgb[1]) * k;
            rgb[2] += (Math.max(0, luma + (cb - luma) * 1.9) - rgb[2]) * k;
        }
        this.chargeHeld = held;
        for (let i = 0; i < RINGS; i += 1) {
            const r = this.rings[i];
            const shape = tables.rings[i * 2];
            const age = time - r.t0;
            if (!r.on || age < 0 || age > r.life) {
                r.on = r.on && age < r.life;
                shape.set(0, 0, 0, 0);
                continue;
            }
            const left = 1 - age / r.life;
            shape.set(r.x, r.z, r.speed * age, r.strength * left * left);
            tables.rings[i * 2 + 1].set(r.rgb[0], r.rgb[1], r.rgb[2], r.width + age * 1.4);
        }
        for (let i = 0; i < FLASHES; i += 1) {
            const f = this.flashes[i];
            const row = tables.flashes[i];
            const age = time - f.t0;
            if (!f.on || age < 0 || age > f.life) {
                f.on = f.on && age < f.life;
                row.set(f.x, f.z, 0, f.reach);
                continue;
            }
            const stutter = steady ? 0.8 : 0.55 + 0.45 * Math.abs(Math.sin(age * 71 + i * 2.1));
            row.set(f.x, f.z, f.power * Math.exp((-age * 4) / f.life) * stutter, f.reach);
        }
        for (let i = 0; i < BOLTS; i += 1) {
            const b = this.bolts[i];
            const light = b.on ? strokeLight(time - b.t0, steady) * b.power * (steady ? 0.6 : 1) : 0;
            if (b.on && time - b.t0 > 0.6) b.on = false;
            tables.bolts[i].set(light, 0, 0, 0);
        }
    }

    /** Run the staged events whose moment has come, earliest first (no allocation). */
    runScheduled(time) {
        const list = this.scheduled;
        for (;;) {
            let first = -1;
            for (let i = 0; i < list.length; i += 1) {
                if (list[i].time <= time && (first < 0 || list[i].time < list[first].time)) first = i;
            }
            if (first < 0) return;
            const { run } = list[first];
            list[first] = list[list.length - 1];
            list.pop();
            run();
        }
    }

    update(sim, camera = this._camera) {
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        this.frameDt = dt;
        this.flashK = flashScale();
        const { u, live } = this;
        const { time } = this;

        this.runScheduled(time);

        // How hot play runs, once a frame on the storm's clock.
        const heat = this.surge.sample(time);
        const H = this.heat;
        H.punch = heat.punch;
        H.level = heat.level;
        H.fever = heat.fever;
        H.stage = heat.stage;
        const { level } = H;
        // What the world wears of the fever: all of it, until a chain's end or a perfect clear
        // lets the storm breathe out ahead of the cooling heat.
        const fever = heat.fever * (1 - 0.6 * this.exhale.valueAt(time));
        this.feverSeen = fever;
        // Reduced motion: what the heat adds to the storm's motion is held back with the rest.
        const calm = this.reduced ? 0.4 : 1;

        // The chain.
        this.fury += (this.furyTarget - this.fury) * approach(this.furyTarget > this.fury ? 1.5 : 0.45, dt);
        this.hourShift += ((this.level - 1) - this.hourShift) * approach(0.35, dt);
        const { fury } = this;
        const swell = this.swell.valueAt(time);
        const spin = this.spinKick.valueAt(time);
        // The storm: the chain's fury, raised by the heat of play (nothing under casual play), so
        // a quick hand winds the storm up too and a fever blows it at full force.
        const drive = 0.45 * smooth01((level - 0.15) / 0.7) + 0.55 * fever;
        const storm = 1 - (1 - fury) * (1 - drive);
        this.storm = storm;
        const { speed } = live;

        // The clocks.
        u.time.value = time;
        u.spin.value += dt * speed * 0.11 * (1 + storm * 1.5 + swell * 0.8 + spin * 3 + fever * 0.8 * calm);
        u.flow.value += dt * speed * 0.16 * (1 + storm * 1.2 + swell + fever * 0.6 * calm);
        u.wind.value += dt * speed * (1 + storm * 0.6 + fever * 0.3 * calm);
        u.deck.value += (dt * speed * (1 + storm * 1.3 + fever * 0.6 * calm)) / 46;
        u.deckTurn.value += dt * speed * 0.006 * (1 + storm + fever * 0.5 * calm);
        this.gustTravel += dt * speed * 14 * (1 + storm * 1.2 + fever * 0.6 * calm);
        // The gust field travels toward the funnel: the inflow.
        const ax = u.axis.value.x;
        const az = u.axis.value.z;
        const reach = Math.hypot(ax, az) || 1;
        const travelled = this.gustTravel / 95;
        u.gust.value.set((-ax / reach) * travelled, (-az / reach) * travelled);

        // The funnel's shape: thicker with the chain and every clear, a wedge in a fever.
        u.fury.value = storm;
        if (this.funnel) {
            const circling = storm > 0.28;
            for (let i = 0; i < this.funnel.children.length; i += 1) this.funnel.children[i].visible = circling;
        }
        u.girth.value = live.girth * (1 + storm + swell * 0.7 + fever * 0.3);
        u.flare.value = live.flare * (1 + storm * 0.25 + swell * 0.3 + fever * 0.15);
        u.rope.value = 20 * live.rope * (1 - storm * 0.4) * (this.reduced ? 0.4 : 1);
        const wander = this.reduced ? 0.3 : 1;
        u.lean.value.set(
            Math.sin(u.wind.value * 0.07) * 46 * wander + live.lean * 120,
            Math.cos(u.wind.value * 0.05) * 28 * wander,
        );
        const k = this.capture ? 1 : approach(1.2, dt);
        u.axis.value.x += (this.axisTarget.x - u.axis.value.x) * k;
        u.axis.value.z += (this.axisTarget.y - u.axis.value.z) * k;

        // The light of the hour; a perfect clear opens the gap to full light.
        this.gapLight = this.gapOpen.valueAt(time);
        const palette = this.applyPalette();
        // The shafts through the gap blaze as the storm builds.
        u.rays.value = 0.32 + this.raysBoost.valueAt(time) + 0.2 * level + 0.35 * fever;
        const glint = this.glint.valueAt(time);
        u.release.value = glint;

        // The dust front of a big clear (more dust if more big clears fed it).
        const sinceShock = time - this.shockAt;
        const post = this._post;
        if (sinceShock >= 0 && sinceShock < 5) {
            const fade = (1 - sinceShock / 5) ** 1.5;
            u.shock.value.set(sinceShock * 300, fade * Math.min(1.6, this.shockPower), 0, 0);
            if (this.funnel) this.funnel.front.visible = true;
            post.ripple.x = this.funnelScreenX;
            post.ripple.y = 0.66;
            post.ripple.radius = sinceShock * 0.5;
            post.ripple.strength = this.reduced
                ? 0
                : fade * Math.min(1.3, this.shockPower) * clamp01(1.6 - sinceShock * 0.45);
            // It reaches the lens.
            const arrival = WORLD.distance / 300;
            if (sinceShock > arrival && sinceShock - dt <= arrival) {
                this.shake.hit(0.012 * Math.min(1.4, this.shockPower), time);
            }
        } else {
            u.shock.value.set(0, 0, 0, 0);
            if (this.funnel) this.funnel.front.visible = false;
            post.ripple.strength = 0;
        }

        // The cloud flickers by itself: more often as the storm builds and as the light goes,
        // nearly all the time in a fever (not under Reduce flashing: a flicker is a flash).
        if (time >= this.nextFlicker) {
            const turn = this.rand() * TAU;
            const out = 300 + this.rand() * 1500;
            const power = 0.45 + this.rand() * 0.6 + storm * 0.5 + fever * 0.3;
            const spread = 380 + this.rand() * 320;
            const life = 0.35 + this.rand() * 0.45;
            this.flash(ax + Math.cos(turn) * out, az + Math.sin(turn) * out * 0.6, power, spread, life, true);
            const rate = palette.flicker * (1 + storm * 5 + fever * 10 * this.flashK);
            this.nextFlicker = time + Math.max(0.25, -Math.log(1 - this.rand() * 0.999) / Math.max(0.01, rate));
        }
        // A fever: the storm brings its own lightning down, as often as every second or so.
        if (fever > 0.4 && this.flashK >= 1 && time >= this.quietUntil) {
            if (time >= this.nextStormStrike) {
                this.strike(0.75 + 0.45 * fever, { lens: 0.2 });
                this.nextStormStrike = time + 2.6 - 1.6 * fever + this.rand() * 0.7;
            }
        } else if (this.nextStormStrike < time + 0.4) {
            this.nextStormStrike = time + 0.4;
        }

        this.writeTables();
        if (camera) this.sky?.update(camera);

        // The wall cloud and the deck's heart take on the colours the funnel holds: a glow that
        // grows with the storm and the fever, and flares as the ribbons let go into the cloud.
        const wound = clamp01(this.chargeHeld / 3);
        const charge = (0.025 * storm + 0.045 * fever + 0.04 * Math.min(1, glint)) * wound;
        const rgb = this.chargeRgb;
        u.charge.value.set(rgb[0] * charge, rgb[1] * charge, rgb[2] * charge);

        const lens = this.lensFlash.valueAt(time);
        post.flash = lens;
        post.kick = this.kick.valueAt(time) + 0.3 * H.punch;
        // The bloom swells a little with the storm (the funnel's own light carries most of it).
        post.bloomBoost = Math.min(1, glint) * 0.25 + swell * 0.2 + 0.04 * level + 0.08 * fever
            + 0.12 * this.gapLight;
        // The iris closes on a stroke (as far as a flash may: Reduce flashing) and a little as the
        // storm heats, so its colours stay deep and its darks dark.
        post.exposure = 1 - 0.22 * clamp01(lens) * this.flashK - 0.06 * Math.max(0, level - 0.2) - 0.05 * fever;
    }

    getPostState() {
        return this._post;
    }

    getState() {
        const hour = PALETTES[this._palette.index ?? 0]?.name ?? null;
        let held = 0;
        for (let i = 0; i < this.ribbons.length; i += 1) {
            if (this.ribbons[i].on) held += 1;
        }
        return {
            time: this.time,
            quality: this.quality,
            combo: this.combo,
            fury: this.fury,
            level: this.level,
            hour,
            hourTurn: this._palette.turn ?? 0,
            ribbons: held,
            funnelScreenX: this.funnelScreenX,
            funnelBeside: this.funnelBeside,
            // How hot play runs (gameplay-surge.js; stage 0 calm, 1 warm, 2 hot, 3 fever).
            heat: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            storm: this.storm,
        };
    }

    dispose() {
        this.scene?.remove(this.root);
        this.sky?.dispose();
        this.field?.dispose();
        this.funnel?.dispose();
        this.fx?.dispose();
        this.noise?.dispose();
        this.root.clear();
        this.parts.clear();
        this.sky = null;
        this.field = null;
        this.funnel = null;
        this.fx = null;
        this.noise = null;
    }
}

export { PARTS as TORNADO_PARTS };
