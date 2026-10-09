/**
 * Geode — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (geode-theme.js) and the playground effect
 * (src/playground/effects/geode.effect.js), so what is iterated there ships.
 *
 * The camera floats inside a great hollow geode, looking down its long axis at the heart: a
 * window of backlit agate. The geode is an instrument of crystal and the board plays it:
 *
 *   lock     a ring of the piece's colour leaves the heart and runs out through the agate's
 *            bands into the lining, waking its glitter; a spark of the same colour leaves the
 *            card and flies into a hero crystal, which flashes from root to point, keeps some of
 *            that light, and sends a ripple over the wall round its foot. A hard drop sends
 *            three sparks and hits harder.
 *   clear    the cleared rows leave the card as blades of light, and a wave runs from the heart
 *            down the wall toward the viewer, one front per line: every crystal answers as it
 *            passes and lets go of the colour it was holding.
 *   combo    the geode GROWS: for every step of the chain a ring of crystals shoots out of the
 *            wall, each ring further from the heart and in the next colour of the spectrum; the
 *            heart brightens, the dust quickens. When the chain breaks the crown shatters.
 *   four     the geode holds its breath — every light sinks for a fifth of a second — then the
 *            lining fractures with light from the heart outward, every cluster's tallest crystal
 *            throws a prismatic lance, and a ring crosses the frame splitting it into colours.
 *   level    the geode recrystallises as the next mineral.
 *
 * And with no help from the board it turns through the same minerals by the clock: it rests on
 * one, then melts into the next over most of a minute (mineralDrift). A level is a step on top
 * of wherever the clock has brought it.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    CAVITY,
    CLEAR_SLOTS,
    CROWN_COLORS,
    CROWN_RINGS,
    DEG,
    FRACTURE_HEAL,
    FRACTURE_TRAVEL,
    GEODEFIRE,
    GEODE_PALETTES,
    HUSH_HOLD,
    MINERALS,
    NOISE_SIZE,
    PALETTE_KEYS,
    PULSE_SLOTS,
    STRIKE_SLOTS,
    WISP_FLIGHT,
    approach,
    bakeNoise,
    clamp01,
    createGeodeUniforms,
    createNoiseTexture,
    crownForCombo,
    mineralDrift,
    mulberry32,
    paletteAt,
    pieceColor,
    powerForCombo,
    sampleNoise,
} from './geode-tsl.js';
import { buildPlan } from './geode-layout.js';
import { tierFor } from './geode-quality.js';
import { createShell } from './geode-shell.js';
import { createCrystals, createDruzy } from './geode-crystals.js';
import {
    createAir, createRowBeams, createShards, createWisps,
} from './geode-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './geode-composition.js';

/** The rest camera: floating on the cavity's axis, looking at the heart. */
export const REST_RIG = Object.freeze({
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 92,
    minFov: 46,
    maxFov: 78,
    near: 0.3,
    far: 400,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.2;
/** How far along the view ray (spans) a spark leaves the card. */
export const SPARK_DEPTH = 17;
/** Seconds a ring / a ripple / a clear wave stays in the geode (the shaders skip their loops after). */
const PULSE_LIVE = 5;
const STRIKE_LIVE = 4.5;
const CLEAR_LIVE = 7.5;
const FRACTURE_LIVE = FRACTURE_TRAVEL + FRACTURE_HEAL * 1.6;
/** A struck crystal sets this many of its cluster chiming, this far apart, at this share of its light. */
const CHIME_VOICES = 7;
const CHIME_GAP = 0.045;
const CHIME_SHARE = 0.42;
/** One notch of the agate's fortification: a T-spin turns the bands this far. */
const TWIST_NOTCH = 1 / 7;

const PARTS = ['shell', 'druzy', 'crystals', 'glints', 'beams', 'air', 'shards', 'wisps', 'rowBeams'];

export class GeodeWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.noiseField = bakeNoise();
        const field = this.noiseField;
        this.plan = buildPlan((x, y, c) => sampleNoise(field, NOISE_SIZE, x, y, c), {
            seed,
            crownPerRing: this.tier.crownPerRing,
            druzy: this.tier.druzy,
            stars: this.tier.stars,
        });
        this.list = this.plan.crystalsFor(this.tier.heroes);
        /** Which drawn crystals stand in each hero cluster (a struck crystal sets its cluster chiming). */
        this.clusterMembers = this.plan.clusters.map(() => []);
        this.list.forEach((c, i) => {
            if (c.ring === 0 && c.cluster >= 0) this.clusterMembers[c.cluster].push(i);
        });
        this.root = new THREE.Group();
        this.root.name = 'Geode';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.rowBeams = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The heart on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.5, y: 0.5 };
        this.targets = { left: [], right: [] };
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._rest = new THREE.PerspectiveCamera(60, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._palette = {};
        this._target = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...GEODE_PALETTES[0][key]];
            this._target[key] = [...GEODE_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            shafts: 0.3,
            bloomBoost: 0,
            exposure: 1,
            prism: { radius: 0, strength: 0 },
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.storm = 0;
        this.level = 1;
        this.mineralStep = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.crown = 0;
        this.twistTarget = 0;
        this.twist = 0;
        this.hushUntil = -1;
        this.pulseCursor = 0;
        this.strikeCursor = 0;
        this.clearCursor = 0;
        this.shock = { time: -100, strength: 0 };
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0, shatters: 0,
        };
        // The slow clock is a function of the world clock until gameplay bends it.
        this.drift = time * (this.reducedMotion ? 0.3 : 1);
        this.crystals?.reset();
        this.shards?.reset();
        this.wisps?.reset();
        this.rowBeams?.reset();
        if (this.u) {
            for (let i = 0; i < PULSE_SLOTS; i++) this.u.pulseA[i].value.set(-100, 0, 1, 0);
            for (let i = 0; i < STRIKE_SLOTS; i++) this.u.strikeA[i].value.set(0, 0, 0, -100);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
            this.u.shock.value.set(-100, 0);
        }
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        this.textures.push(noise);
        const u = createGeodeUniforms({ noise });
        this.u = u;
        const { tier, plan } = this;

        this.addPart('shell', createShell(u, plan, { glitter: tier.glitter, fracture: tier.fracture }));
        this.addPart('druzy', createDruzy(u, plan.druzy, tier.druzy, { caustics: tier.caustics }));
        const stones = createCrystals(u, this.list, { dispersion: tier.dispersion });
        this.crystals = stones.crystals;
        this.addPart('crystals', stones.crystals);
        this.addPart('glints', stones.glints);
        if (stones.beams) this.addPart('beams', stones.beams);
        this.addPart('air', createAir(u, plan.stars, { motes: tier.motes, stars: tier.stars }));

        // ── Gameplay effects (pools, always drawn) ──
        this.shards = createShards(u, tier.shards);
        this.addPart('shards', this.shards);
        this.wisps = createWisps(u);
        this.addPart('wisps', this.wisps);
        this.rowBeams = createRowBeams(u);
        this.addPart('rowBeams', this.rowBeams);

        this.applyPalette(1);
        this.findTargets();
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = keep.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            // With no board on screen the events aim at where the solo board would be in THIS frame.
            if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
            this.findTargets();
        }
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        this.findTargets();
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
    }

    /** A new run: the geode back at rest (the dust keeps drifting). */
    resetSession() {
        const { time, drift } = this;
        this.resetState(time);
        this.drift = drift;
        this.applyPalette(1);
    }

    /** The camera that will render the world (kept for symmetry with the other worlds). */
    bindCamera(camera) {
        this._camera = camera;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, 0, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, -10);
        cam.updateMatrixWorld();
        return cam;
    }

    /**
     * Which hero crystals a spark can be sent to: the ones the rest camera sees clear of the
     * card, split by the side of the card they stand on, those nearest the card first.
     */
    findTargets() {
        const left = [];
        const right = [];
        if (this.crystals) {
            const cam = this.restCamera();
            const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
            const centre = (card.x0 + card.x1) * 0.5;
            for (let i = 0; i < this.crystals.heroes; i++) {
                const c = this.list[i];
                // A spark needs a crystal big enough to be seen ringing.
                if (c.height < 4) continue;
                const reach = c.height * 0.7;
                this._vec.set(c.x + c.axis[0] * reach, c.y + c.axis[1] * reach, c.z + c.axis[2] * reach).project(cam);
                if (this._vec.z > 1 || Math.abs(this._vec.x) > 0.96 || Math.abs(this._vec.y) > 0.94) continue;
                const sx = this._vec.x * 0.5 + 0.5;
                if (sx > card.x0 - 0.01 && sx < card.x1 + 0.01) continue;
                const entry = { index: i, dist: sx < centre ? card.x0 - sx : sx - card.x1 };
                (sx < centre ? left : right).push(entry);
            }
            const byDist = (a, b) => a.dist - b.dist;
            left.sort(byDist);
            right.sort(byDist);
        }
        this.targets = { left: left.map((e) => e.index), right: right.map((e) => e.index) };
    }

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.9 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow float, as of something weightless in the hollow, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.13) * 1.5 + Math.sin(t * 0.071 + 1.3) * 1.0) * calm;
        const swayY = (Math.sin(t * 0.17 + 0.7) * 0.9 + Math.sin(t * 0.083) * 0.6) * calm;
        const swayZ = (Math.sin(t * 0.058 + 2.2) * 1.8) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(swayX + px * 2.4, swayY - py * 1.5, swayZ + this.kick * 0.5 * calm);
        const yaw = (Math.sin(t * 0.09 + 2.1) * 0.012 - px * 0.03) * calm;
        const pitch = (Math.sin(t * 0.11) * 0.008 - py * 0.02) * calm;
        this._look.set(
            camera.position.x * 0.55 + Math.sin(yaw) * 60,
            camera.position.y * 0.55 + Math.tan(pitch) * 60,
            -60,
        );
        // It turns a little about the axis as it floats.
        camera.up.set(Math.sin(t * 0.047) * 0.035 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
        // The heart on screen: where the shafts come from.
        if (this.u) {
            this._ray.copy(this.u.heartPos.value).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        }
    }

    /** The world point `depth` spans along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = 0;
            out[2] = -depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * The crystals a lock on `side` (−1 left, +1 right) can strike. A side with fewer than three
     * (a narrow screen at a low tier) borrows the other side's, so a hard drop still finds three.
     */
    targetsOn(side) {
        const own = side < 0 ? this.targets.left : this.targets.right;
        const other = side < 0 ? this.targets.right : this.targets.left;
        return own.length >= 3 ? own : [...own, ...other];
    }

    /** Pick the crystal a lock on `side` (−1 left, +1 right) strikes; those by the card more often. */
    pickTarget(side, salt = 0) {
        const list = this.targetsOn(side);
        if (!list.length) return -1;
        const rand = mulberry32(0x1f3d + (this.counts.locks + 1) * 2654435761 + salt * 97)();
        return list[Math.min(list.length - 1, Math.floor(rand ** 1.6 * list.length))];
    }

    /** Send a ring out from the heart at `time`. */
    pulse(time, strength, rgb, reach = 1) {
        const slot = this.pulseCursor % PULSE_SLOTS;
        this.pulseCursor += 1;
        this.u.pulseA[slot].value.set(time, strength, reach, 0);
        this.u.pulseC[slot].value.set(rgb[0] * 1.4, rgb[1] * 1.4, rgb[2] * 1.4);
    }

    /** Send one spark from a world point into crystal `index`. Returns its arrival time. */
    sendWisp(index, from, rgb, amount, salt = 0) {
        const c = this.list[index];
        if (!c || !this.wisps) return this.time;
        // It enters the stone somewhere in its upper half.
        const f = 0.5 + 0.38 * mulberry32(index * 31 + this.counts.wisps * 7 + salt)();
        const to = [c.x + c.axis[0] * c.height * f, c.y + c.axis[1] * c.height * f, c.z + c.axis[2] * c.height * f];
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const flight = this.reducedMotion ? 0.12 : WISP_FLIGHT * (0.75 + Math.min(1.4, dist / 40));
        const arrive = this.time + flight;
        // The arc bows toward the viewer and away from the axis.
        const out = Math.hypot(to[0], to[1]) || 1;
        this.wisps.launch({
            from,
            to,
            rgb,
            time: this.time,
            flight,
            size: 0.5 + amount * 0.34,
            bow: [(to[0] / out) * dist * 0.1, (to[1] / out) * dist * 0.1 + dist * 0.05, dist * 0.14],
        });
        this.crystals.strike(index, rgb, arrive, amount, this.time);
        // The cluster chimes: its other crystals answer one after another, more faintly.
        const members = this.clusterMembers[c.cluster] || [];
        let step = 0;
        for (let k = 0; k < members.length && step < CHIME_VOICES; k++) {
            if (members[k] === index) continue;
            step += 1;
            const share = CHIME_SHARE * (1 - step / (CHIME_VOICES + 2));
            this.crystals.strike(members[k], rgb, arrive + step * CHIME_GAP, amount * share, this.time);
        }
        // A ripple runs over the wall from the crystal's foot when the spark arrives.
        const slot = this.strikeCursor % STRIKE_SLOTS;
        this.strikeCursor += 1;
        this.u.strikeA[slot].value.set(c.x, c.y, c.z, arrive);
        this.u.strikeC[slot].value.set(rgb[0] * 1.3, rgb[1] * 1.3, rgb[2] * 1.3, 0.55 + amount * 0.45);
        const share = this.shards.count / 512;
        this.shards.emit({
            x: to[0],
            y: to[1],
            z: to[2],
            n: Math.round((8 + 14 * amount) * share),
            rgb,
            time: arrive,
            dir: c.axis,
            out: [0.6, 4.5 + amount * 3.5],
            along: [0.5, 5 + amount * 3],
            size: 0.05 + c.height * 0.004,
        });
        this.counts.wisps += 1;
        return arrive;
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.crystals) return;
        const rgb = pieceColor(color);
        // ── The ring: the heart answers in the piece's colour ──
        this.pulse(this.time, hardDrop ? 1.15 : 0.75, rgb, hardDrop ? 1.12 : 0.92);

        // ── The spark: the piece's light flies into a crystal ──
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            wx = screen.x;
            wy = screen.y;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                // The spark leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        const from = this.screenToWorld(wx, wy, SPARK_DEPTH);
        const target = this.pickTarget(side);
        if (target >= 0) {
            this.sendWisp(target, from, rgb, hardDrop ? 1.3 : 0.85);
            if (hardDrop) {
                // Two more, into the next two crystals on that side.
                const list = this.targetsOn(side);
                const at = list.indexOf(target);
                for (let k = 1; k <= 2 && k < list.length; k++) {
                    this.sendWisp(list[(at + k) % list.length], from, rgb, 0.6, k);
                }
            }
        }
        this.kick = Math.max(this.kick, hardDrop ? 0.5 : 0.1);
        this.flash = Math.max(this.flash, hardDrop ? 0.1 : 0.02);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.crystals) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const p = this._palette;
        // One line answers in the agate's first band, two in the heart's light, three in the lining's.
        let rgb;
        if (quad) rgb = [...GEODEFIRE];
        else if (n === 1) rgb = [...p.band0];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.heart[c] * 0.8 + p.band3[c] * 0.3);
        else rgb = [0, 1, 2].map((c) => p.druzy[c] * 0.7 + p.heart[c] * 0.5);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        const strength = Math.min(1.5, 0.62 + 0.14 * n + (quad ? 0.25 : 0));
        const birth = quad ? this.time + HUSH_HOLD : this.time;

        // ── The wave leaves the heart ──
        const slot = this.clearCursor % CLEAR_SLOTS;
        this.clearCursor += 1;
        // (the wave that was in this slot is no longer drawn: the crystals forget it too)
        const forget = uniforms.clearA[slot].value.x;
        uniforms.clearA[slot].value.set(birth, perfect ? 4 : n, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        this.lastClear = { time: birth, lines: n };

        // ── Every crystal lets go of what it holds as the wave passes it ──
        const { released, passes, amounts } = this.crystals.release(birth, rgb, strength, {
            beam: quad ? 1 : 0, now: this.time, forget,
        });
        const holders = [];
        for (let i = 0; i < this.crystals.heroes && holders.length < 16; i++) {
            if (amounts[i] > 0.12) holders.push(i);
        }
        const share = this.shards.count / 512;
        for (let k = 0; k < holders.length; k++) {
            const i = holders[k];
            const c = this.list[i];
            this.shards.emit({
                x: c.tip[0],
                y: c.tip[1],
                z: c.tip[2],
                n: Math.round((quad ? 20 : 12) * share),
                rgb,
                time: passes[i],
                dir: c.axis,
                out: [0.8, 6],
                along: [1.5, 9],
                life: [1.0, 2.2],
                size: 0.05 + c.height * 0.004,
            });
        }
        this.storm = Math.max(this.storm, Math.min(1.4, 0.3 + 0.14 * n + released * 0.06 + (quad ? 0.4 : 0)));
        this.pendingKick = { time: birth + 0.12, amount: 0.22 + 0.1 * n };

        // ── The cleared rows leave the card as blades of light ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.rowBeams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
        }

        if (quad) {
            // The geode holds its breath, then everything fires.
            this.hushUntil = this.time + HUSH_HOLD;
            this.surge = perfect ? 1.3 : 1;
            this.shock = { time: birth, strength: this.reducedMotion ? 0.5 : 1 };
            uniforms.shock.value.set(birth, this.shock.strength);
            // Every cluster's tallest point throws dust with its lance.
            for (let i = 0; i < this.crystals.heroes; i++) {
                const c = this.list[i];
                if (!c.main) continue;
                this.shards.emit({
                    x: c.tip[0],
                    y: c.tip[1],
                    z: c.tip[2],
                    n: Math.round(14 * share),
                    rgb: GEODEFIRE,
                    time: passes[i],
                    dir: c.axis,
                    out: [0.5, 5],
                    along: [3, 16],
                    life: [1.2, 2.6],
                    size: 0.07,
                    stagger: 0.3,
                });
            }
            this.counts.quads += 1;
        }
        if (tspin) {
            // The agate itself turns a notch.
            this.twistTarget += TWIST_NOTCH;
            this.storm = Math.max(this.storm, 0.85);
            // …and a faint prism ring crosses the frame (no fracture).
            if (!quad) this.shock = { time: this.time, strength: 0.42 };
        }
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 2) {
            // The chain broke: the crown shatters and the geode lets its breath go.
            this.dip = Math.max(this.dip, 0.28);
            this.shatterCrown();
        } else if (n > this.combo && crownForCombo(n) > crownForCombo(this.combo) && this.u) {
            // A new ring of the crown: the heart announces it in the ring's colour.
            this.pulse(this.time, 0.85, CROWN_COLORS[crownForCombo(n) - 1], 1.05);
        }
        this.combo = n;
    }

    /** The crown's standing rings burst into dust in their own colours. */
    shatterCrown() {
        const { plan } = this;
        if (!this.shards || !plan.crown.length) return;
        const standing = Math.min(CROWN_RINGS, Math.ceil(this.crown - 0.05));
        if (standing <= 0) return;
        const share = this.shards.count / 512;
        // Every third crystal throws: the pool is shared with the strikes.
        const stride = Math.max(2, Math.round(3 / Math.max(0.3, share)));
        for (let i = 0; i < plan.crown.length; i += stride) {
            const c = plan.crown[i];
            if (c.ring > standing) continue;
            this.shards.emit({
                x: c.tip[0],
                y: c.tip[1],
                z: c.tip[2],
                n: 5,
                rgb: CROWN_COLORS[c.ring - 1],
                time: this.time + (standing - c.ring) * 0.04,
                dir: c.axis,
                out: [0.6, 5],
                along: [-2, 6],
                life: [0.9, 2.0],
                size: 0.07,
            });
        }
        this.counts.shatters += 1;
    }

    /** A new level: the geode recrystallises as the next mineral. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        if (silent) this.applyPalette(1);
        else {
            this.storm = Math.max(this.storm, 0.75);
            this.flash = Math.max(this.flash, 0.14);
            // A pale wave carries the new mineral down the wall.
            const next = paletteAt(this.mineralPhase(), this._target);
            const slot = this.clearCursor % CLEAR_SLOTS;
            this.clearCursor += 1;
            const forget = this.u ? this.u.clearA[slot].value.x : null;
            this.u?.clearA[slot].value.set(this.time, 2, 0.8, 0);
            const pale = next.heart.map((c) => c * 0.7 + 0.3);
            this.u?.clearC[slot].value.set(pale[0], pale[1], pale[2]);
            this.lastClear = { time: this.time, lines: 2 };
            // It is a wave like any other: every crystal lets go of what it holds as it passes.
            this.crystals?.release(this.time, pale, 0.8, { now: this.time, forget });
        }
    }

    /**
     * Where the geode is heading in its cycle of minerals: one step per level, turned on by the
     * clock. The whole part names a mineral, the fraction is how far it has melted into the next.
     */
    mineralPhase() {
        return (this.level - 1) + mineralDrift(this.time);
    }

    /**
     * Set the live palette. The clock's turn is exact (a function of the time alone, so a seek
     * and a replay agree); the level's step eases in by `k` (1 snaps).
     */
    applyPalette(k) {
        const step = this.level - 1;
        this.mineralStep += (step - this.mineralStep) * k;
        if (Math.abs(step - this.mineralStep) < 1e-4) this.mineralStep = step;
        paletteAt(this.mineralStep + mineralDrift(this.time), this._palette);
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.storm *= Math.exp(-dt / 1.7);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.5);
            this.pendingKick.time = Infinity;
        }
        this.crystals?.tick(t);
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.12 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;

        // One ring of the crown for every step of the chain past the first; it shatters at once.
        const crownTarget = crownForCombo(this.combo);
        this.crown += (crownTarget - this.crown) * approach(crownTarget > this.crown ? 4.2 : 9, dt);
        if (Math.abs(crownTarget - this.crown) < 1e-3) this.crown = crownTarget;
        this.twist += (this.twistTarget - this.twist) * approach(3.2, dt);
        this.applyPalette(approach(0.8, dt));

        // ── The slow clock ──
        this.drift += dt * motion * (1 + this.power * 3 + this.surge * 5 + this.storm * 2);

        // ── Uniforms ──
        let pulseLive = 0;
        for (let i = 0; i < PULSE_SLOTS; i++) {
            if (t - u.pulseA[i].value.x < PULSE_LIVE) pulseLive = 1;
        }
        let strikeLive = 0;
        for (let i = 0; i < STRIKE_SLOTS; i++) {
            if (t - u.strikeA[i].value.w < STRIKE_LIVE) strikeLive = 1;
        }
        let clearLive = 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            if (t - u.clearA[i].value.x < CLEAR_LIVE) clearLive = 1;
        }
        const shockAge = t - u.shock.value.x;
        u.live.value.set(pulseLive, strikeLive, clearLive, shockAge >= 0 && shockAge < FRACTURE_LIVE ? 1 : 0);
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.drift.value = this.drift;
        u.twist.value = this.twist;
        u.crown.value = this.crown;
        const p = this._palette;
        const heat = clamp01(this.surge * 0.5);
        // The heart breathes, slowly.
        const lift = (1 + this.power * 0.25 + this.storm * 0.12) * (1 + Math.sin(t * 0.8) * 0.045 * motion);
        u.heart.value.set(
            (p.heart[0] + (GEODEFIRE[0] - p.heart[0]) * heat) * lift,
            (p.heart[1] + (GEODEFIRE[1] - p.heart[1]) * heat) * lift,
            (p.heart[2] + (GEODEFIRE[2] - p.heart[2]) * heat) * lift,
        );
        u.fill.value.set(p.fill[0], p.fill[1], p.fill[2]);
        u.rock.value.set(p.rock[0], p.rock[1], p.rock[2]);
        u.druzy.value.set(p.druzy[0], p.druzy[1], p.druzy[2]);
        for (let i = 0; i < 4; i++) {
            const c = p[`band${i}`];
            u.bands[i].value.set(c[0], c[1], c[2]);
        }
        for (let i = 0; i < MINERALS; i++) {
            const c = p[`m${i}`];
            u.minerals[i].value.set(c[0], c[1], c[2]);
        }

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.shafts = hush ? 0.05 : 0.3 + this.power * 0.16 + swell * 0.22;
        post.bloomBoost = this.surge * 0.1 + swell * 0.1;
        // The iris closes as the geode flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 1.15 + swell * 0.4 + this.power * 0.22 + this.storm * 0.16);
        // The prism ring leaves the heart with the fracture.
        const ringAge = t - this.shock.time;
        const ringOn = ringAge >= 0 && ringAge < 2.2;
        post.prism.radius = ringOn ? ringAge * 1.25 + 0.02 : 0;
        post.prism.strength = ringOn ? this.shock.strength * Math.exp(-ringAge / 0.75) : 0;
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            surge: this.surge,
            storm: this.storm,
            breath: this.breath,
            crown: this.crown,
            twist: this.twist,
            level: this.level,
            // (the mineral it is heading for, and where in the cycle it is showing now)
            palette: GEODE_PALETTES[Math.round(this.mineralPhase()) % GEODE_PALETTES.length].name,
            mineral: this.mineralStep + mineralDrift(this.time),
            counts: { ...this.counts },
            held: this.crystals ? this.crystals.totalHeld(this.time) : 0,
            crystals: this.crystals ? this.crystals.count : 0,
            heroes: this.crystals ? this.crystals.heroes : 0,
            druzy: this.parts.druzy ? this.parts.druzy.count : 0,
            targets: { left: this.targets.left.length, right: this.targets.right.length },
            motes: this.parts.air ? this.parts.air.motes : 0,
            stars: this.parts.air ? this.parts.air.stars : 0,
            shards: this.shards ? this.shards.count : 0,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.rowBeams = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as GEODE_PARTS, CAVITY };
