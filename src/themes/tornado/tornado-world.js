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
 *   onClear  the funnel lets its ribbons go (they flare and shoot up into the cloud, which
 *            lights from inside), and lightning comes down beside the card, one channel per
 *            line, each with a ring through the wheat. Four lines or a perfect clear: the funnel
 *            swells into a wedge and a dust front rolls out across the field and over the lens.
 *   onCombo  the chain is the storm's fury: the funnel thickens and spins up, more debris
 *            lifts, the wheat lies down, the cloud winds faster and turns green at its heart,
 *            the cloud flickers more often. It lets go slowly when the chain breaks.
 *   levelUp  the hour turns one step (the light also turns by itself, one hour every
 *            HOUR_SECONDS: golden hour → ember dusk → green sky → blue hour → round again).
 *
 * Everything is a function of the storm's clock and the events' start times, so a seek() that
 * replays the same events gives the same frame.
 */
import * as THREE from 'three/webgpu';
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

/** Seconds a ribbon takes to reach the wall cloud, holds, and takes to leave. */
const RIBBON_CLIMB = 5.5;
const RIBBON_HOLD = 17;
const RIBBON_LEAVE = 12;
/** Seconds the sparks need to reach the funnel: the ribbon lights when they arrive. */
const SPARK_FLIGHT = 1.5;
const DEFAULT_SPARK = Object.freeze([1.0, 0.72, 0.32]);
const STRIKE_SLOTS = Object.freeze([0.05, 0.12, 0.19, 0.27, 0.34, 0.66, 0.73, 0.8, 0.9, 0.95]);

const strokeLight = (age) => {
    if (age < 0 || age > 0.55) return 0;
    let light = Math.exp(-age / 0.04);
    if (age > 0.08) light = Math.max(light, 0.75 * Math.exp(-(age - 0.08) / 0.035));
    if (age > 0.17) light = Math.max(light, 0.5 * Math.exp(-(age - 0.17) / 0.05));
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
        this.swell = 0;
        this.spinKick = 0;
        this.releaseAt = -100;
        this.raysBoost = 0;
        this.shockAt = -100;
        this.shake = 0;
        this.kick = 0;
        this.lensFlash = 0;
        this.nextFlicker = time + 2.5;
        this.scheduled = [];
        this.ribbons = Array.from({ length: RIBBONS }, () => ({
            on: false, t0: 0, rgb: [1, 1, 1], phase: 0, turns: 3, power: 1, released: -1,
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

    /** A new run: the storm back at rest, the funnel empty. */
    resetSession() {
        this.combo = 0;
        this.furyTarget = 0;
        this.level = 1;
        this.hourShift = 0;
        this.scheduled.length = 0;
        this.ribbons.forEach((r) => {
            if (r.on && r.released < 0) r.released = this.time;
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
            if (this.shake > 1e-4) {
                yaw += this.shake * Math.sin(t * 61.3) * Math.cos(t * 23.1);
                pitch += this.shake * Math.sin(t * 47.9 + 1.0);
            }
            // A long chain buffets the lens.
            const buffet = this.fury * 0.0016;
            yaw += buffet * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1.7);
            pitch += buffet * Math.sin(t * 6.1 + 0.4) * Math.cos(t * 3.7);
        }
        const fov = this.fov();
        if (camera.fov !== fov) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
            this.updatePixelAngle();
        }
        camera.position.set(x, y, z);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
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

    ring(x, z, rgb, {
        speed = 26, life = 1.7, strength = 0.9, width = 2.2,
    } = {}) {
        const slot = this.rings[this.cursor.ring % RINGS];
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

    /** Light inside the cloud above (x, z). */
    flash(x, z, power, reach = 460, life = 0.6) {
        const slot = this.flashes[this.cursor.flash % FLASHES];
        this.cursor.flash += 1;
        slot.on = true;
        slot.t0 = this.time;
        slot.x = x;
        slot.z = z;
        slot.power = power;
        slot.reach = reach;
        slot.life = life;
    }

    /** A channel of lightning down beside the card. */
    strike(power = 1) {
        const layout = this.layoutNow();
        const card = cardUnion(layout);
        const { hud } = layout;
        const open = STRIKE_SLOTS.filter((sx) => !(card && sx > card.x0 - 0.02 && sx < card.x1 + 0.02)
            && !(hud && sx > hud.x0 - 0.015 && sx < hud.x1 + 0.015)
            && Math.abs(sx - this.funnelScreenX) > 0.045);
        const pool = open.length ? open : STRIKE_SLOTS;
        const sx = pool[Math.floor(this.rand() * pool.length) % pool.length];
        const az = this.azimuthOf(sx);
        const range = 520 + this.rand() * 900;
        const x = Math.sin(az) * range;
        const z = -Math.cos(az) * range;
        const index = this.cursor.bolt % BOLTS;
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
        this.lensFlash = Math.max(this.lensFlash, 0.55 * power);
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
        const ribbon = this.ribbons[this.cursor.ribbon % RIBBONS];
        this.cursor.ribbon += 1;
        ribbon.on = true;
        ribbon.t0 = this.time + SPARK_FLIGHT;
        ribbon.phase = this.rand();
        ribbon.turns = 2.2 + this.rand() * 2.6;
        ribbon.power = power;
        ribbon.released = -1;
        ribbon.rgb[0] = rgb[0];
        ribbon.rgb[1] = rgb[1];
        ribbon.rgb[2] = rgb[2];

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
            this.shake = Math.max(this.shake, 0.004);
            this.kick = Math.max(this.kick, 0.5);
            this.flash(this.u.axis.value.x, this.u.axis.value.z, 0.5, 380, 0.4);
        }
    }

    onClear(c = {}) {
        const lines = clamp(Math.round(c.lines || 1), 1, 4);
        const big = lines >= 4 || c.perfect === true;
        // The funnel lets its ribbons go.
        this.releaseAt = this.time;
        this.ribbons.forEach((r) => {
            if (r.on && r.released < 0) {
                r.released = Math.max(this.time, r.t0);
            }
        });
        const { axis } = this.u;
        this.flash(axis.value.x, axis.value.z, big ? 1.3 : 0.8 + lines * 0.15, 480, big ? 1.1 : 0.7);
        for (let i = 0; i < lines; i += 1) {
            this.schedule(this.time + 0.1 + i * 0.11, () => this.strike(big ? 1.25 : 1));
        }
        if (c.tspin) this.spinKick = Math.max(this.spinKick, 1);
        this.kick = Math.max(this.kick, 0.3 + lines * 0.15);
        if (big) {
            this.swell = 1;
            this.shockAt = this.time + 0.2;
            this.shake = Math.max(this.shake, 0.009);
            this.raysBoost = Math.max(this.raysBoost, c.perfect ? 1.8 : 0.9);
        } else {
            this.swell = Math.max(this.swell, 0.16 * lines);
        }
    }

    /** The true combo (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(combo || 0));
        if (n === 0 && this.combo >= 3) this.raysBoost = Math.max(this.raysBoost, 0.6);
        this.combo = n;
        this.furyTarget = furyFor(n);
    }

    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(level || 1));
        if (silent) {
            this.hourShift = this.level - 1;
            this.applyPalette();
            return;
        }
        this.schedule(this.time + 0.05, () => this.strike(1.2));
        this.raysBoost = Math.max(this.raysBoost, 1.2);
        this.swell = Math.max(this.swell, 0.35);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    wheel() {
        return this.time / HOUR_SECONDS + this.hourShift;
    }

    applyPalette() {
        const p = paletteAt(this.wheel(), this._palette);
        const { u, live } = this;
        const set = (key) => {
            const c = p[key];
            const tinted = TINTED.includes(key);
            u[key].value.set(
                c[0] * (tinted ? live.tint[0] : 1),
                c[1] * (tinted ? live.tint[1] : 1),
                c[2] * (tinted ? live.tint[2] : 1),
            );
        };
        ['sun', 'gapLow', 'gapHigh', 'skyTop', 'cloudDark', 'cloudMid', 'cloudLit', 'cloudRim', 'wheatLit',
            'wheatShade', 'haze', 'funnelLit', 'funnelShade', 'dust', 'bolt'].forEach(set);
        u.sunPower.value = p.sunPower;
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
        for (let i = 0; i < RIBBONS; i += 1) {
            const r = this.ribbons[i];
            const shape = tables.ribbons[i * 2];
            const age = time - r.t0;
            if (!r.on || age < 0) {
                shape.set(0, 0, 0, 0);
                continue;
            }
            let head = clamp(age / RIBBON_CLIMB, 0, 1) * 0.92;
            let tail = clamp((age - RIBBON_HOLD) / RIBBON_LEAVE, 0, 1) * 0.92;
            let light = r.power * smooth01(age / 0.5) * (1 - smooth01((age - RIBBON_HOLD) / RIBBON_LEAVE));
            if (r.released >= 0) {
                const gone = time - r.released;
                head = Math.min(1.02, head + gone * 2.4);
                tail = Math.min(1.02, tail + Math.max(0, gone - 0.08) * 1.5);
                light *= 1 + 2.2 * Math.exp(-gone * 3.5);
                if (tail >= 1) r.on = false;
            }
            if (!r.on || light <= 0.001) {
                r.on = r.on && age < RIBBON_HOLD + RIBBON_LEAVE;
                shape.set(0, 0, 0, 0);
                continue;
            }
            shape.set(r.phase, head, tail, light);
            tables.ribbons[i * 2 + 1].set(r.rgb[0], r.rgb[1], r.rgb[2], r.turns);
        }
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
            const stutter = 0.55 + 0.45 * Math.abs(Math.sin(age * 71 + i * 2.1));
            row.set(f.x, f.z, f.power * Math.exp((-age * 4) / f.life) * stutter, f.reach);
        }
        for (let i = 0; i < BOLTS; i += 1) {
            const b = this.bolts[i];
            const light = b.on ? strokeLight(time - b.t0) * b.power : 0;
            if (b.on && time - b.t0 > 0.6) b.on = false;
            tables.bolts[i].set(light, 0, 0, 0);
        }
    }

    update(sim, camera = this._camera) {
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const { u, live } = this;
        const { time } = this;

        // Staged events whose moment has come.
        if (this.scheduled.length) {
            const due = this.scheduled.filter((s) => s.time <= time);
            if (due.length) {
                this.scheduled = this.scheduled.filter((s) => s.time > time);
                due.sort((a, b) => a.time - b.time).forEach((s) => s.run());
            }
        }

        // The chain.
        this.fury += (this.furyTarget - this.fury) * approach(this.furyTarget > this.fury ? 1.5 : 0.45, dt);
        this.hourShift += ((this.level - 1) - this.hourShift) * approach(0.35, dt);
        this.swell *= Math.exp(-dt / 1.3);
        this.spinKick *= Math.exp(-dt / 0.7);
        this.raysBoost *= Math.exp(-dt / 2.4);
        this.shake *= Math.exp(-dt / 0.35);
        this.kick *= Math.exp(-dt / 0.3);
        this.lensFlash *= Math.exp(-dt / 0.16);
        const { fury, swell } = this;
        const { speed } = live;

        // The clocks.
        u.time.value = time;
        u.spin.value += dt * speed * 0.11 * (1 + fury * 1.5 + swell * 0.8 + this.spinKick * 3);
        u.flow.value += dt * speed * 0.16 * (1 + fury * 1.2 + swell);
        u.wind.value += dt * speed * (1 + fury * 0.6);
        u.deck.value += (dt * speed * (1 + fury * 1.3)) / 46;
        u.deckTurn.value += dt * speed * 0.006 * (1 + fury);
        this.gustTravel += dt * speed * 14 * (1 + fury * 1.2);
        // The gust field travels toward the funnel: the inflow.
        const ax = u.axis.value.x;
        const az = u.axis.value.z;
        const reach = Math.hypot(ax, az) || 1;
        const travelled = this.gustTravel / 95;
        u.gust.value.set((-ax / reach) * travelled, (-az / reach) * travelled);

        // The funnel's shape.
        u.fury.value = fury;
        if (this.funnel) {
            const circling = fury > 0.28;
            for (let i = 0; i < this.funnel.children.length; i += 1) this.funnel.children[i].visible = circling;
        }
        u.girth.value = live.girth * (1 + fury * 1.0 + swell * 0.7);
        u.flare.value = live.flare * (1 + fury * 0.25 + swell * 0.3);
        u.rope.value = 20 * live.rope * (1 - fury * 0.4) * (this.reduced ? 0.4 : 1);
        const wander = this.reduced ? 0.3 : 1;
        u.lean.value.set(
            Math.sin(u.wind.value * 0.07) * 46 * wander + live.lean * 120,
            Math.cos(u.wind.value * 0.05) * 28 * wander,
        );
        const k = this.capture ? 1 : approach(1.2, dt);
        u.axis.value.x += (this.axisTarget.x - u.axis.value.x) * k;
        u.axis.value.z += (this.axisTarget.y - u.axis.value.z) * k;

        // The light of the hour.
        const palette = this.applyPalette();
        u.rays.value = 0.32 + this.raysBoost;
        const sinceRelease = time - this.releaseAt;
        u.release.value = sinceRelease >= 0 ? Math.exp(-sinceRelease / 0.45) : 0;

        // The dust front of a four-line clear.
        const sinceShock = time - this.shockAt;
        const post = this._post;
        if (sinceShock >= 0 && sinceShock < 5) {
            const strength = (1 - sinceShock / 5) ** 1.5;
            u.shock.value.set(sinceShock * 300, strength, 0, 0);
            if (this.funnel) this.funnel.front.visible = true;
            post.ripple.x = this.funnelScreenX;
            post.ripple.y = 0.66;
            post.ripple.radius = sinceShock * 0.5;
            post.ripple.strength = this.reduced ? 0 : strength * clamp01(1.6 - sinceShock * 0.45);
            // It reaches the lens.
            const arrival = WORLD.distance / 300;
            if (sinceShock > arrival && sinceShock - dt <= arrival) this.shake = Math.max(this.shake, 0.012);
        } else {
            u.shock.value.set(0, 0, 0, 0);
            if (this.funnel) this.funnel.front.visible = false;
            post.ripple.strength = 0;
        }

        // The cloud flickers by itself, more often as the chain builds and as the light goes.
        if (time >= this.nextFlicker) {
            const turn = this.rand() * TAU;
            const out = 300 + this.rand() * 1500;
            const power = 0.45 + this.rand() * 0.6 + fury * 0.5;
            const spread = 380 + this.rand() * 320;
            const life = 0.35 + this.rand() * 0.45;
            this.flash(ax + Math.cos(turn) * out, az + Math.sin(turn) * out * 0.6, power, spread, life);
            const rate = palette.flicker * (1 + fury * 5);
            this.nextFlicker = time + Math.max(0.25, -Math.log(1 - this.rand() * 0.999) / Math.max(0.01, rate));
        }

        this.writeTables();
        if (camera) this.sky?.update(camera);

        post.flash = this.lensFlash;
        post.kick = this.kick;
        post.bloomBoost = u.release.value * 0.35 + swell * 0.2;
        post.exposure = 1 - 0.22 * clamp01(this.lensFlash);
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
