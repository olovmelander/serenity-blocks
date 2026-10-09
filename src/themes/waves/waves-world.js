/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the green room: the world.
 *
 * The rider's eye is inside the tube of a breaking wave at the end of the day. Everything is
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
 *               evening toward gold, lets the barrel breathe a little wider, and calls the
 *               dolphins: one at three clears, two at five, three at seven (the first of them
 *               thrown across the sun), four at nine.
 *   perfect     the whole pod, and the sky goes to gold.
 *   level up    a set wave runs through the tube.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    DEG, FLOW, WAVE, approach, castRay, clamp01, crestDistance, landingDistance, lerp, lipAngle, pieceLight, smooth,
    surfaceAt,
} from './waves-core.js';
import { tierFor } from './waves-quality.js';
import {
    REST_RIG, boardFor, boardPoint, cardFor, fallbackLayout, fovForAspect, viewFor,
} from './waves-composition.js';
import {
    SUN, createWaterNoise, createWaveShape, sunDirection,
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

/** Dolphins are not sent more often than this (seconds of the world's clock). */
const LEAP_COOLDOWN = 1.7;

/** How far a chain of `combo` clears holds the barrel open (0..1). */
export function openForCombo(combo) {
    return combo > 1 ? 1 - Math.exp(-(combo - 1) * 0.3) : 0;
}

/** The clock's speed `age` seconds into a hold: the throw flies a moment, then down fast, back slowly. */
export function holdScale(age) {
    if (!(age >= 0) || age >= HOLD_SECONDS) return 1;
    const held = smooth(0.3, 0.5, age) - smooth(HOLD_SECONDS - 0.8, HOLD_SECONDS, age);
    return 1 - (1 - HOLD_SCALE) * held;
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
     * @param {{azimuth?: number, elevation?: number}} [p.sun]
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 187, sun = null,
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

        this.sunDir = sunDirection(sun?.azimuth ?? SUN.azimuth, sun?.elevation ?? SUN.elevation);
        this.U = {
            time: uniform(0),
            sun: uniform(this.sunDir.clone()),
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
        this.bandCursor = 0;
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
            /** Seconds into a hold of the clock, or -1. */
            holdAge: -1,
            /** The set wave: seconds since it entered, or -1. */
            setAge: -1,
            setHeight: 0,
            lastLeap: -100,
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

    /** Put the world at `time` with nothing in flight. */
    seek(time) {
        this.time = Math.max(0, time);
        this.clock = this.time;
        this.resetSession();
        const s = this.state;
        s.yaw = null;
        s.pitch = null;
    }

    /** A new run: the barrel back at rest, every table empty, nothing in the air. */
    resetSession() {
        const s = this.state;
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
        s.setAge = -1;
        s.lastLeap = -100;
        s.level = 1;
        s.locks = 0;
        s.clears = 0;
        s.leaps = 0;
        this.ringCount = 0;
        this.ribbonCount = 0;
        this.dripCount = 0;
        this.bandCursor = 0;
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
        // The rider's sway: slow, small, never a shake.
        const sway = still * (Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.23 + 1.3) * 0.4);
        const heave = still * (Math.sin(t * 0.31 + 0.6) * 0.6 + Math.sin(t * 0.19) * 0.4);
        const px = still * (sim.pointerX || 0);
        const py = still * (sim.pointerY || 0);
        const yaw = (s.yaw + sway * 0.55 + px * 2.4) * DEG;
        const pitch = (s.pitch + heave * 0.35 - py * 1.6) * DEG;
        camera.position.set(
            REST_RIG.eye.x + sway * 0.05 + px * 0.12,
            REST_RIG.eye.y + heave * 0.045,
            REST_RIG.eye.z,
        );
        camera.up.set(Math.sin(sway * 0.012), 1, 0).normalize();
        tmpRay.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(camera.position.x + tmpRay.x, camera.position.y + tmpRay.y, camera.position.z + tmpRay.z);
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

    /** `twist` (metres of z per radian round the tube) turns the ring into a screw of light. */
    addBand(strength, width, delay = 0, twist = 0) {
        this.bandRows[this.bandCursor].set(this.clock + delay, strength, width, twist);
        this.bandCursor = (this.bandCursor + 1) % BAND_SLOTS;
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
        if (wall.kind === 'wall' && lipU > wall.u && this.dripCount < this.drips.length) {
            const wait = (lipU - wall.u) / RIBBON_VELOCITY.u;
            const drip = this.drips[this.dripCount];
            this.dripCount += 1;
            drip.at = this.clock + wait;
            drip.d = wall.d - RIBBON_VELOCITY.z * wait;
            drip.n = hard ? 30 : 18;
            drip.rgb[0] = tmpTint[0];
            drip.rgb[1] = tmpTint[1];
            drip.rgb[2] = tmpTint[2];
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
            s.glow = Math.max(s.glow, 0.25);
            s.flash = Math.max(s.flash, 0.12);
            s.tear = Math.max(s.tear, 0.25);
        }
    }

    /** Lines cleared: { player, rows, lines, combo, cascade, tspin, perfect, b2b, screen }. */
    onClear(c) {
        if (!this.spray) return;
        const s = this.state;
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
        const open = this.U.open.value;
        const twist = c.tspin ? 2.4 : 0;
        for (let i = 0; i < lines; i += 1) this.addBand(0.75 + lines * 0.12, 0.85 + lines * 0.1, i * 0.26, twist);
        s.openKick = Math.min(0.5, s.openKick + 0.1 + lines * 0.06);
        s.glow = Math.min(1, s.glow + 0.25 + lines * 0.16);
        s.tear = Math.min(1, s.tear + 0.3 + lines * 0.17);
        s.flash = Math.max(s.flash, 0.1 + lines * 0.06);
        // The lip throws: a sheet of spray off its whole falling edge.
        this.spray.throwLip(this.clock, open, {
            from: landingDistance(open) - 0.5,
            to: crestDistance(open) - 2,
            n: Math.round((this.spray.count / 16) * (0.7 + lines * 0.55)),
            beads: 0.03,
            speed: [0.7 + lines * 0.12, 1.5 + lines * 0.4],
            size: 0.028 + lines * 0.003,
        });
        if (c.tspin) {
            this.spray.swirl(this.clock, open, { d: landingDistance(open) + 2.5, n: Math.round(this.spray.count / 5) });
            s.tear = 1;
        }
        if (big) {
            // The wave holds, with the biggest throw of all in the air round the eye.
            s.holdAge = 0;
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
        if (c.perfect) this.sendPod(this.pod.count, true);
    }

    /** The longest chain any board is holding (0 = it broke). */
    onCombo(combo) {
        const s = this.state;
        const next = Math.max(0, combo | 0);
        if (next > s.combo) this.sendPod(leapersFor(next), next >= 7);
        s.combo = next;
    }

    /** Send `n` dolphins over the water, one after another. */
    sendPod(n, hero) {
        const s = this.state;
        if (n <= 0 || !this.pod || this.clock - s.lastLeap < LEAP_COOLDOWN) return;
        s.lastLeap = this.clock;
        const open = this.U.open.value;
        const count = Math.min(n, this.pod.count);
        for (let i = 0; i < count; i += 1) {
            this.pod.leap(this.clock + 0.3 + i * 0.6, open, {
                hero: hero && i === 0,
                d: hero && i === 0 ? 12.5 : null,
            });
        }
        s.leaps += count;
    }

    levelUp(level, { silent = false } = {}) {
        const s = this.state;
        s.level = Math.max(1, level | 0);
        if (silent) return;
        s.setAge = 0;
        s.setHeight = 0.085;
        s.tear = Math.max(s.tear, 0.5);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    update(sim, camera) {
        if (!this.pod) return;
        const dt = Math.max(0, sim.delta);
        this.time = sim.time;
        const { U } = this;
        const s = this.state;

        // The world's own clock: four lines hold it for a breath.
        let scale = 1;
        if (s.holdAge >= 0) {
            scale = this.reducedMotion ? 1 : holdScale(s.holdAge);
            s.holdAge += dt;
            if (s.holdAge >= HOLD_SECONDS) s.holdAge = -1;
        }
        this.clock += dt * scale;
        U.time.value = this.clock;

        // Tables: drop what has run its course (rows stay in order of birth).
        while (this.ringCount > 0 && this.clock - this.ringRows[0].z > RING_LIFE) {
            for (let i = 1; i < this.ringCount; i += 1) this.ringRows[i - 1].copy(this.ringRows[i]);
            this.ringCount -= 1;
        }
        while (this.ribbonCount > 0 && this.clock - this.ribbonRows[0].z > RIBBON_LIFE) {
            for (let i = 2; i < this.ribbonCount * 2; i += 1) this.ribbonRows[i - 2].copy(this.ribbonRows[i]);
            this.ribbonCount -= 1;
        }
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

        // The barrel opens to a chain and to each clear, and closes slowly when the chain breaks.
        const held = openForCombo(s.combo);
        s.openHeld += (held - s.openHeld) * approach(held > s.openHeld ? 1.5 : 0.4, dt);
        s.openKick *= Math.exp(-0.7 * dt);
        U.open.value = clamp01(s.openHeld + s.openKick);
        s.radiance += (held - s.radiance) * approach(held > s.radiance ? 1.2 : 0.5, dt);
        const warm = Math.min(1, s.combo / 9) * 0.55;
        s.warm += (warm - s.warm) * approach(0.8, dt);
        s.warmKick *= Math.exp(-0.35 * dt);
        U.warm.value = clamp01(s.warm + s.warmKick);
        s.glow *= Math.exp(-1.1 * dt);
        s.tear *= Math.exp(-1.3 * dt);
        s.flash *= Math.exp(-4.5 * dt);
        U.glow.value = Math.min(1.6, s.glow + s.radiance * 0.9);
        // A chain keeps the lip throwing.
        U.tear.value = Math.max(s.tear, s.radiance * 0.45);

        // A set wave runs the length of the tube, from ahead to behind the eye.
        const bulge = U.bulge.value;
        if (s.setAge >= 0) {
            s.setAge += dt * scale;
            const run = s.setAge / 3.4;
            if (run >= 1) {
                s.setAge = -1;
                bulge.y = 0;
            } else {
                bulge.x = lerp(-46, 9, run);
                bulge.y = s.setHeight * Math.sin(Math.PI * run);
                bulge.z = 6.5;
            }
        } else {
            bulge.y = 0;
        }
        bulge.w = U.open.value * 0.03;

        this.pod.update(this.clock, this.splash);

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

    /** What the post stack should know this frame. */
    getPostState() {
        const s = this.state;
        return {
            flash: s.flash,
            bloomBoost: s.glow * 0.5 + s.radiance * 0.3,
            warm: this.U.warm.value,
            sunX: this.sunScreen.x,
            sunY: this.sunScreen.y,
            shafts: this.sunScreen.visible * (0.55 + s.radiance * 0.5 + s.glow * 0.35),
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
            open: this.U.open.value,
            landing: landingDistance(this.U.open.value),
            warm: this.U.warm.value,
            glow: this.U.glow.value,
            rings: this.ringCount,
            ribbons: this.ribbonCount,
            airborne: this.pod?.airborne ?? 0,
            holding: s.holdAge >= 0,
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
