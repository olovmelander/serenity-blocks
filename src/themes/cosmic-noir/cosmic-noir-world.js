/**
 * Cosmic Noir — the world.
 *
 * Owns the shared uniforms, the smoke and its backdrop, the camera rig and the choreography.
 * Shared by the theme (cosmic-noir-theme.js) and the playground effect
 * (src/playground/effects/cosmic-noir.effect.js), so what is iterated there ships.
 *
 * "Smoke in the searchlight": a pulsar turns inside the derelict shutter cage of a lantern beside
 * the board, and its two beams sweep like a lighthouse's through drifting smoke. Where a beam
 * crosses the slats it is cut into a fan of shafts; a beam that looks toward us blazes and the
 * lens glares. The picture is a black-and-white print, toned by one film stock at a time.
 *
 *   lock     smoke billows out of the card's edge at the piece's height, lit from inside by a
 *            dying ember, and drifts off (a hard drop puffs harder).
 *   clear    the pulsar flares and a light echo per line leaves it: shells of light that expand
 *            through the smoke and draw its shape in rings.
 *   combo    each step of a chain spins the lighthouse up (the sweep quickens) and opens the
 *            blinds (the slats turn edge-on: wider shafts); a broken chain lets them close.
 *   four     the flashbulb: the print turns to its own negative for a moment, the pulsar flares,
 *            four echoes leave it, and the cage's slats spin.
 *   T-spin   the cage spins on its axis: the shafts wheel round the lantern.
 *   level    a reel change: two cue marks flash at the corner of the picture, and the print turns
 *            to the next film stock on the line (cyanotype, silver, selenium, sepia, platinum).
 *   time     by itself, with no level change, the print drifts along the same line: one stock
 *            every STOCK_STEP seconds, there and back. The two simply add.
 *
 * Nothing is created at event time: events write numbers into preallocated slots and a small queue
 * of timed moments, so seek(t) plus a fixed-step replay reproduces any frame. What a rate changes
 * (the beams' spin, the cage's turn, the wind's drift) is integrated, never clock × rate.
 */

import * as THREE from 'three/webgpu';
import {
    CAGE,
    DEG,
    ECHO_LIFE,
    ECHO_SLOTS,
    PULSAR,
    PUFF_LIFE,
    PUFF_SLOTS,
    SMOKE,
    SMOKE_SEED,
    TAU,
    approach,
    bakeSmokeNoise,
    beamDirection,
    beamLight,
    cageTransmit,
    createNoirUniforms,
    createSmokeTexture,
    cueAt,
    echoRadius,
    negativeAt,
    pulsarAnchor,
    smooth,
    spinBasis,
    stockAt,
    stockName,
    stockPhase,
    stockPlace,
    supportsFloatTargets,
} from './cosmic-noir-tsl.js';
import { tierFor } from './cosmic-noir-quality.js';
import { createSmoke } from './cosmic-noir-volume.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './cosmic-noir-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';

/** The rest camera. */
export const REST_RIG = Object.freeze({
    near: 0.05,
    far: 200,
    /** The widest horizontal lens a very wide frame gets (degrees). */
    maxHFov: 104,
});

/** Vertical field of view (degrees) for an aspect ratio (Hor+, capped wide). */
export function fovForAspect(aspect) {
    const a = Math.max(0.3, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = pulsarAnchor(a).vFov;
    const h = (2 * Math.atan(Math.tan((v * DEG) / 2) * a)) / DEG;
    if (h <= REST_RIG.maxHFov) return v;
    return (2 * Math.atan(Math.tan((REST_RIG.maxHFov * DEG) / 2) / a)) / DEG;
}

/** The beams' turn at rest (rad/s), and how much each step of a chain adds (share of it). */
export const SPIN_REST = TAU / PULSAR.period;
export const SPIN_PER_COMBO = 0.32;
export const SPIN_MAX_COMBO = 9;
/** The cage's own slow turn (rad/s, the other way), and how a spin impulse dies away. */
export const CAGE_TURN = -TAU / CAGE.period;
const CAGE_SPIN_FADE = 0.8;
/** The slow field's own drift (tiles/s): the smoke curls as it moves. */
const CURL_RATE = Object.freeze([0.011, 0.006, 0.009]);
/** How far in front of the camera a lock's puff leaves the card (scene units). */
const PUFF_DEPTH = 9;

const PARTS = ['sky', 'smoke'];

export class CosmicNoirWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {boolean} [params.floatTarget]    paint the smoke into a half-float target (default: ask the renderer)
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, floatTarget,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.floatTarget = floatTarget ?? supportsFloatTargets(renderer);
        this.root = new THREE.Group();
        this.root.name = 'CosmicNoir';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.smoke = null;
        this.smokeOn = true;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.anchor = pulsarAnchor(this.aspect);
        this.basis = spinBasis();
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._f = new THREE.Vector3(0, 0, -1);
        this._r = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._ray = new THREE.Vector3();
        this._v = new THREE.Vector3();
        this._basis = new THREE.Matrix4();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._beam = [1, 0, 0];
        this._stock = {};
        this._post = {
            flash: 0,
            negative: 0,
            cue: 0,
            cuePos: { x: 0.88, y: 0.17 },
            bloomBoost: 0,
            exposure: 1,
            stock: this._stock,
        };
        this.echoSlots = Array.from({ length: ECHO_SLOTS }, () => ({ birth: -1e6, strength: 0, width: 1 }));
        this.puffSlots = Array.from({ length: PUFF_SLOTS }, () => ({
            birth: -1e6, from: [0, 0, 0], vel: [0, 0, 0], smoke: 0, ember: 0,
        }));
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.level = 1;
        /** The steps the level-ups have taken (a level-up adds one), and the same eased (the print turns). */
        this.levelSteps = 0;
        this.levelPlace = 0;
        this.flash = 0;
        this.flare = 0;
        this.negativeBirth = -1e6;
        this.negativeAmp = 0;
        this.cueBirth = -1e6;
        this.queue = [];
        this.echoCursor = 0;
        this.puffCursor = 0;
        this.counts = {
            locks: 0, clears: 0, quads: 0, levels: 0,
        };
        // The clocks a rate drives: closed form until gameplay bends them.
        const motion = this.reducedMotion ? 0.4 : 1;
        this.spinRate = SPIN_REST * motion;
        this.spinPhase = (SPIN_REST * motion * time) % TAU;
        this.cageSpin = 0;
        this.cageTurn = (CAGE_TURN * motion * time) % TAU;
        this.cageFill = CAGE.fillClosed;
        this.drift = SMOKE.wind.map((w) => w * motion * time);
        this.curl = CURL_RATE.map((c) => c * motion * time);
        this.echoSlots.forEach((slot) => {
            slot.birth = -1e6;
            slot.strength = 0;
        });
        this.puffSlots.forEach((slot) => {
            slot.birth = -1e6;
            slot.smoke = 0;
            slot.ember = 0;
        });
    }

    build() {
        const { tier } = this;
        const baked = bakeSmokeNoise(SMOKE_SEED, tier.noise);
        const smoke = createSmokeTexture(baked.near, tier.noise);
        const smokeFar = createSmokeTexture(baked.far, baked.farSize, 'cosmic-noir-smoke-far');
        const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        placeholder.needsUpdate = true;
        this.textures.push(smoke, smokeFar, placeholder);
        const u = createNoirUniforms({
            smoke, smokeFar, target: placeholder, floatTarget: this.floatTarget,
        });
        this.u = u;
        const { a, e1, e2 } = this.basis;
        u.spin.value.set(a[0], a[1], a[2]);
        u.spinE1.value.set(e1[0], e1[1], e1[2]);
        u.spinE2.value.set(e2[0], e2[1], e2[2]);
        u.pulsar.value.set(0, 0, -PULSAR.depth);

        this.smoke = createSmoke(u, {
            march: tier.march, taps: tier.taps, detail: tier.detail, skyLayers: tier.skyLayers,
        });
        this.parts.sky = this.smoke;
        this.root.add(this.smoke.mesh);
        this.disposables.push(this.smoke);

        this.resetState(this.time);
        this.applyStock(1);
        this.compose();
        this.scene.add(this.root);
        return this;
    }

    /** Draw only the named parts (captures, bisecting a look): `sky` (always drawn), `smoke`. */
    showOnlyParts(names) {
        const keep = new Set(names);
        this.smokeOn = keep.has('smoke');
        if (!this.smokeOn && this.smoke) {
            // Paint the target clear once (no smoke, full transmittance).
            this._clearTarget = true;
        }
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) {
            this.u.viewport.value.set(bufferWidth, bufferHeight);
            this.smoke?.resize(bufferWidth, bufferHeight, this.tier.scale);
        }
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
        this.updatePixelAngle();
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
            this.updatePixelAngle();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        // The reel change's cue mark sits top right of the picture, clear of the HUD.
        const hud = this.layout?.hud;
        this._post.cuePos.x = Math.min(0.93, Math.max(0.86, hud ? hud.x1 + 0.08 : 0.88));
        this._post.cuePos.y = this.aspect < 0.9 ? 0.07 : 0.17;
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. The level's steps are kept. */
    seek(time) {
        const { levelSteps, level } = this;
        this.resetState(Math.max(0, time));
        this.levelSteps = levelSteps;
        this.levelPlace = levelSteps;
        this.level = level;
        this.applyStock(1);
    }

    /**
     * A new run: no chain in flight. The clock, the print's stock and where the lighthouse stands
     * run on: a new run never turns the colours back.
     */
    resetSession() {
        this.combo = 0;
        this.level = 1;
        this.queue = [];
    }

    /** Nothing here is layered; kept so the theme and the playground bind every world alike. */
    bindCamera(camera) {
        this._camera = camera;
    }

    updatePixelAngle() {
        if (!this.u) return;
        const height = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / height;
    }

    // ── The lantern's place in the frame ────────────────────────────────────────

    /**
     * Turn a camera at the origin so that the pulsar (on −Z) hangs at the anchor for this aspect:
     * it looks aside by exactly what puts the pulsar there, with no roll.
     */
    aim(camera, fov, yawOff = 0, pitchOff = 0, roll = 0) {
        const a = this.anchor;
        const tanV = Math.tan((fov * DEG) / 2);
        const tanH = tanV * this.aspect;
        const nx = a.x * 2 - 1;
        const ny = 1 - a.y * 2;
        const pitch = Math.atan(-ny * tanV) + pitchOff;
        const yaw = Math.atan(-nx * tanH * Math.cos(pitch)) + yawOff;
        const f = this._f.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const r = this._r.set(Math.cos(yaw), 0, Math.sin(yaw));
        const up = this._up.copy(r).cross(f).normalize();
        if (roll) {
            const c = Math.cos(roll);
            const s = Math.sin(roll);
            const rx = r.x * c + up.x * s;
            const ry = r.y * c + up.y * s;
            const rz = r.z * c + up.z * s;
            up.set(up.x * c - r.x * s, up.y * c - r.y * s, up.z * c - r.z * s);
            r.set(rx, ry, rz);
        }
        this._ray.copy(f).negate();
        this._basis.makeBasis(r, up, this._ray);
        camera.quaternion.setFromRotationMatrix(this._basis);
    }

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, 0, 0);
        this.aim(cam, cam.fov);
        cam.updateMatrixWorld();
        return cam;
    }

    /** Where the composition wants the pulsar for this aspect. */
    compose() {
        this.anchor = pulsarAnchor(this.aspect);
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect);
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of a camera on a dolly in a still room, and the pointer leaning the
        // view: the near smoke slides against the lantern.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(
            (Math.sin(t * 0.041) * 0.32 + Math.sin(t * 0.017 + 1.3) * 0.18 + px * 0.35) * calm,
            (Math.sin(t * 0.033 + 0.7) * 0.18 + Math.sin(t * 0.013) * 0.1 - py * 0.22) * calm,
            Math.sin(t * 0.021 + 2.0) * 0.4 * calm,
        );
        const yaw = (Math.sin(t * 0.027 + 2.1) * 0.006 - px * 0.012) * calm;
        const pitch = (Math.sin(t * 0.023) * 0.004 + py * 0.008) * calm;
        const roll = Math.sin(t * 0.019) * 0.006 * calm;
        this.aim(camera, fov, yaw, pitch, roll);
        // The shared breath (shared/camera-breath.js) on top, turning the view only: off under
        // reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** The world point `depth` in front of the camera along a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = 0;
            out[2] = -depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const fwd = this._v.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const k = depth / Math.max(0.2, this._ray.dot(fwd));
        out[0] = camera.position.x + this._ray.x * k;
        out[1] = camera.position.y + this._ray.y * k;
        out[2] = camera.position.z + this._ray.z * k;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /** The card a board sits in (several boards: each has its own), else every card as one. */
    cardFor(board) {
        const cards = this.layout?.cards;
        if (board && cards?.length > 1) {
            const cx = (board.x0 + board.x1) * 0.5;
            const cy = (board.y0 + board.y1) * 0.5;
            for (let i = 0; i < cards.length; i++) {
                const c = cards[i];
                if (cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1) return c;
            }
        }
        return cardUnion(this.layout);
    }

    /**
     * Do something at `time`, which may be a moment ahead: the frame that reaches it fires it,
     * stamped with its own moment. Two events that fall in the same frame both happen.
     */
    schedule(time, kind, data = null) {
        const q = this.queue;
        let i = q.length;
        while (i > 0 && q[i - 1].time > time) i -= 1;
        q.splice(i, 0, { time, kind, data });
    }

    /** Fire everything the clock has reached. */
    drain(t) {
        const q = this.queue;
        while (q.length && q[0].time <= t) {
            const { time, kind, data } = q.shift();
            if (kind === 'echo') this.echo(time, data);
        }
    }

    /** A light echo leaves the pulsar. */
    echo(time, { strength, width }) {
        const slot = this.echoSlots[this.echoCursor % ECHO_SLOTS];
        this.echoCursor += 1;
        slot.birth = time;
        slot.strength = strength;
        slot.width = width;
    }

    /**
     * A piece locked: smoke billows out of the card's edge at its height, lit from inside by a dying
     * ember. `u` = its column as a fraction of the board width, `rows` = the visible rows it covers;
     * `screen` (fractions) replaces the board point (the meditation mode's clicks).
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        let px = 0.5;
        let py = 0.6;
        let side = -1;
        if (screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)) {
            px = screen.x;
            py = screen.y;
            side = px < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = this.cardFor(board);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                py = this._point.y;
                // The puff leaves the card's nearer side edge.
                side = u < 0.5 ? -1 : 1;
                px = this._point.x;
                if (card) px = side < 0 ? card.x0 : card.x1;
            }
        }
        const t = this.time;
        const slot = this.puffSlots[this.puffCursor % PUFF_SLOTS];
        this.puffCursor += 1;
        const from = this.screenToWorld(px, py, PUFF_DEPTH, [0, 0, 0]);
        const out = this.screenToWorld(px + side * 0.06, py - 0.015, PUFF_DEPTH, [0, 0, 0]);
        const speed = (hardDrop ? 1.6 : 1.1) * (this.reducedMotion ? 0.4 : 1);
        const len = Math.hypot(out[0] - from[0], out[1] - from[1], out[2] - from[2]) || 1;
        slot.birth = t;
        slot.from = from;
        slot.vel = [((out[0] - from[0]) / len) * speed, ((out[1] - from[1]) / len) * speed + 0.12, ((out[2] - from[2]) / len) * speed];
        slot.smoke = hardDrop ? 1.0 : 0.75;
        // Each puff its own billows (a fixed spread: a replay is the same puff).
        slot.seed = ((this.puffCursor * 0.618034) % 1) * 7.0;
        slot.ember = hardDrop ? 5.5 : 3.6;
        this.counts.locks += 1;
    }

    /** Lines cleared: the pulsar flares and an echo per line leaves it. Four lines: the flashbulb. */
    onClear({
        lines = 1, tspin = false, perfect = false,
    } = {}) {
        if (!this.u) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const t = this.time;
        const echoes = quad ? 4 : n;
        for (let i = 0; i < echoes; i++) {
            this.schedule(t + i * (quad ? 0.09 : 0.14), 'echo', {
                // Dim: the masses are mostly unlit and thick, so any light at all shows all of them.
                strength: quad ? 0.8 : 0.25 + 0.08 * n, width: quad ? 1.3 : 1.0,
            });
        }
        this.flare = Math.max(this.flare, quad ? 1.6 : 0.5 + 0.15 * n);
        this.flash = Math.max(this.flash, quad ? 0.3 : 0.08 + 0.04 * n);
        if (quad) {
            if (this.reducedMotion) {
                this.flash = Math.max(this.flash, 0.45);
            } else {
                this.negativeBirth = t;
                this.negativeAmp = perfect ? 1 : 0.92;
            }
            this.cageSpin += 1.4;
            this.counts.quads += 1;
        }
        if (tspin) this.cageSpin += 3.2;
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        this.combo = Math.max(0, Math.round(Number(combo) || 0));
    }

    /**
     * A new level: a reel change. The cue marks flash and the print turns one stock along the line
     * (it also drifts there by itself, a stock every STOCK_STEP seconds). A level jump counts at
     * most three steps; a LOWER level is a new game, whose first level-up is one step: a new run
     * never turns the print back.
     */
    levelUp(level, { silent = false } = {}) {
        const next = Math.max(1, Math.round(Number(level) || 1));
        let gained = 0;
        if (next > this.level) gained = Math.min(3, next - this.level);
        else if (next < this.level) gained = Math.min(1, next - 1);
        this.level = next;
        this.levelSteps += gained;
        if (silent) {
            this.levelPlace = this.levelSteps;
            this.applyStock(1);
            return;
        }
        this.cueBirth = this.time;
        this.flare = Math.max(this.flare, 0.5);
        this.echo(this.time, { strength: 0.45, width: 1.4 });
        this.counts.levels += 1;
    }

    /**
     * The live toning: the level's steps, eased (k = 1 snaps), plus the clock's own drift. The PLACE
     * is eased, never the colours, so once a reel change has settled the print is a pure function of
     * the steps and the clock.
     */
    applyStock(k) {
        const target = this.levelSteps;
        this.levelPlace += (target - this.levelPlace) * Math.min(1, k);
        if (Math.abs(target - this.levelPlace) < 1e-3) this.levelPlace = target;
        stockAt(stockPlace(this.levelPlace, this.time), this._stock);
    }

    /** Hand a rebuilt world (quality change, lost GPU) where this one stood. */
    getCarry() {
        return {
            level: this.level, levelSteps: this.levelSteps,
        };
    }

    takeCarry(carry) {
        if (!carry) return;
        this.level = Math.max(1, Math.round(carry.level || 1));
        this.levelSteps = Math.max(0, Number(carry.levelSteps) || 0);
        this.levelPlace = this.levelSteps;
        this.applyStock(1);
    }

    /** Write the echoes and the puffs as they stand at this moment. */
    writeEvents() {
        const { u } = this;
        const t = this.time;
        const { echoes } = u.tables;
        let live = 0;
        for (let i = 0; i < ECHO_SLOTS; i++) {
            const slot = this.echoSlots[i];
            const age = t - slot.birth;
            if (age < 0 || age > ECHO_LIFE || slot.strength <= 0) continue;
            const radius = echoRadius(age);
            const gain = slot.strength * smooth(0, 0.06, age) * (1 - smooth(ECHO_LIFE * 0.5, ECHO_LIFE, age));
            echoes[live].set(radius, slot.width * (1 + radius * 0.035), gain, 0);
            live += 1;
        }
        u.echoCount.value = live;
        this.echoesLive = live;

        const { puffs } = u.tables;
        let count = 0;
        for (let i = 0; i < PUFF_SLOTS; i++) {
            const slot = this.puffSlots[i];
            const age = t - slot.birth;
            if (age < 0 || age > PUFF_LIFE || slot.smoke <= 0) continue;
            // It drifts off as it slows, and spreads.
            const travel = 1.4 * (1 - Math.exp(-age / 1.4));
            const x = slot.from[0] + slot.vel[0] * travel;
            const y = slot.from[1] + slot.vel[1] * travel;
            const z = slot.from[2] + slot.vel[2] * travel;
            const radius = 0.55 + 1.5 * (1 - Math.exp(-age / 1.1));
            const smoke = slot.smoke * (1 - Math.exp(-age / 0.12)) * Math.exp(-age / 1.9);
            const ember = slot.ember * Math.exp(-age / 0.32);
            puffs[count * 2].set(x, y, z, radius);
            puffs[count * 2 + 1].set(smoke, ember, slot.seed || 0, 0);
            count += 1;
        }
        u.puffCount.value = count;
        this.puffsLive = count;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const calm = this.reducedMotion;
        const motion = calm ? 0.4 : 1;

        this.flash *= Math.exp(-dt / 0.3);
        this.flare *= Math.exp(-dt / 0.6);
        this.cageSpin *= Math.exp(-dt / CAGE_SPIN_FADE);
        this.drain(t);

        // ── The lighthouse: spin up with the chain (integrated), open the blinds ──
        const chain = Math.min(SPIN_MAX_COMBO, Math.max(0, this.combo - 1));
        const spinTarget = SPIN_REST * (1 + (calm ? 0.25 : 1) * SPIN_PER_COMBO * chain) * motion;
        this.spinRate += (spinTarget - this.spinRate) * approach(spinTarget > this.spinRate ? 1.4 : 0.5, dt);
        if (dt === 0) this.spinRate = spinTarget;
        this.spinPhase = (this.spinPhase + this.spinRate * dt) % TAU;
        this.cageTurn = (this.cageTurn + (CAGE_TURN * motion + this.cageSpin * (calm ? 0.25 : 1)) * dt) % TAU;
        const fillTarget = CAGE.fillClosed - (CAGE.fillClosed - CAGE.fillOpen) * Math.min(1, chain / 6);
        this.cageFill += (fillTarget - this.cageFill) * approach(1.2, dt);
        if (dt === 0) this.cageFill = fillTarget;
        for (let k = 0; k < 3; k++) {
            this.drift[k] += SMOKE.wind[k] * motion * dt;
            this.curl[k] += CURL_RATE[k] * motion * dt;
        }
        this.applyStock(approach(1.1, dt));

        // ── Uniforms ──
        const beam = beamDirection(this.spinPhase, this.basis, this._beam);
        u.time.value = t;
        u.beam.value.set(beam[0], beam[1], beam[2]);
        u.cageTurn.value = this.cageTurn;
        u.cageFill.value = this.cageFill;
        // The drift wraps where the tile comes round (the noise is periodic per tile).
        const wrapX = SMOKE.tile * SMOKE.stretch * 64;
        const wrapY = SMOKE.tile * 64;
        const wrapZ = SMOKE.tile * 1.4 * 64;
        u.drift.value.set(this.drift[0] % wrapX, this.drift[1] % wrapY, this.drift[2] % wrapZ);
        u.curl.value.set(this.curl[0] % 64, this.curl[1] % 64, this.curl[2] % 64);
        const { flare } = this;
        u.beamGain.value = PULSAR.beamGain * (1 + flare * 0.7 + Math.min(0.5, (this.combo - 1) * 0.06) * (this.combo > 1 ? 1 : 0));
        u.coreGain.value = PULSAR.coreGain * (1 + flare * 1.2);
        u.spikes.value = 1 + flare * 2.2;
        this.writeEvents();

        // What follows the camera: its frame for the smoke's target, the pulsar on screen, and
        // whether a beam is looking at us.
        if (camera) {
            const e = camera.matrixWorld.elements;
            u.camPos.value.copy(camera.position);
            u.camRight.value.set(e[0], e[1], e[2]);
            u.camUp.value.set(e[4], e[5], e[6]);
            u.camFwd.value.set(-e[8], -e[9], -e[10]);
            const tanV = Math.tan((camera.fov * DEG) / 2);
            const tanH = tanV * (camera.aspect || this.aspect);
            u.tanHalf.value.set(tanH, tanV);
            const p = this._v.set(0, 0, -PULSAR.depth).project(camera);
            u.pulsarUv.value.set(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
            const toCam = [camera.position.x, camera.position.y, camera.position.z + PULSAR.depth];
            const len = Math.hypot(toCam[0], toCam[1], toCam[2]) || 1;
            const v = [toCam[0] / len, toCam[1] / len, toCam[2] / len];
            const through = cageTransmit(v, this.cageTurn, this.cageFill, this.basis);
            u.coreSeen.value = through;
            this.glare = beamLight(v, beam) * through * (1 + flare);
            u.glare.value = this.glare * 1.1;
        }

        // ── Post ──
        const post = this._post;
        post.flash = this.flash;
        post.negative = negativeAt(t - this.negativeBirth) * this.negativeAmp;
        post.cue = cueAt(t - this.cueBirth);
        post.bloomBoost = flare * 0.5 + this.flash;
        post.exposure = 1 / (1 + this.glare * 0.12);

        // Paint the smoke for this frame.
        if (this.smoke && sim.draw !== false) {
            if (this.smokeOn) this.smoke.render(this.renderer);
            else if (this._clearTarget) this.clearTarget();
        }
    }

    /** With the smoke switched off (parts), the target holds no light and lets everything through. */
    clearTarget() {
        const { renderer } = this;
        const target = this.smoke?.target?.();
        if (!renderer || !target || typeof renderer.setRenderTarget !== 'function') return;
        const previous = renderer.getRenderTarget?.() ?? null;
        const clear = new THREE.Color();
        renderer.getClearColor(clear);
        const alpha = renderer.getClearAlpha();
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, false, false);
        renderer.setClearColor(clear, alpha);
        renderer.setRenderTarget(previous);
        this._clearTarget = false;
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const place = stockPlace(this.levelPlace, this.time);
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            level: this.level,
            levelSteps: this.levelSteps,
            stock: stockName(place),
            stockMix: stockPhase(place).mix,
            stockPlace: place,
            spinPeriod: this.spinRate > 0 ? TAU / this.spinRate : null,
            spinPhase: this.spinPhase,
            cageFill: this.cageFill,
            glare: this.glare || 0,
            coreSeen: this.u ? this.u.coreSeen.value : null,
            echoes: this.echoesLive || 0,
            puffs: this.puffsLive || 0,
            negative: this._post.negative,
            cue: this._post.cue,
            counts: { ...this.counts },
            queued: this.queue.length,
            march: this.tier.march,
            floatTarget: this.u ? this.u.floatTarget : null,
            layoutLive: this.layoutLive,
            pulsarUv: this.u ? { x: this.u.pulsarUv.value.x, y: this.u.pulsarUv.value.y } : null,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.dispose?.();
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.smoke = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as COSMIC_NOIR_PARTS };
