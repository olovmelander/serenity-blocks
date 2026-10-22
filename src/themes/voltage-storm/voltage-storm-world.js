/**
 * Voltage Storm — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (voltage-storm-theme.js) and the playground effect
 * (src/playground/effects/voltage-storm.effect.js), so what is iterated there ships.
 *
 * A supercell hangs low over a flooded plain at dusk; under its far edge a strip of clear sky
 * still glows. A line of collector towers stands in the water either side of the board. The
 * board charges them and the storm answers:
 *
 *   lock     the piece's charge leaps from the card's edge, at the piece's own height, to a tower
 *            on that side as an arc in the piece's colour. The tower's capacitor rings light in
 *            that colour from the bottom up and keep it, and the cloud above flickers back. A
 *            hard drop throws a heavier arc and a second one, sparks and a ring across the water.
 *   clear    the cleared rows discharge out of both edges of the card, and a beat later the sky
 *            answers: one bolt per line, from the cloud onto the towers that hold the most. A
 *            struck tower goes white, throws what it held as sparks of that colour and, from
 *            cold, goes dark; the cloud lights from inside and a ring crosses the water. A
 *            cascade's waves walk out into the storm (each strikes the pair of towers a row
 *            further out, harder); a back-to-back is answered twice (both heroes at once).
 *   combo    the storm builds: lightning crawls through the cloud more often, an arc stands
 *            between neighbouring tower tops for every step of the chain, corona burns on the
 *            electrodes, the rain thickens and leans.
 *   four     the storm holds its breath (every light sinks, the rain hangs), then a superbolt
 *            strikes the hero tower with five return strokes, every other tower is struck in
 *            turn, sheet lightning runs out through the cloud and the picture ripples. A perfect
 *            clear on a frame of its own crowns it: the whole field lets go of its charge.
 *   T-spin   the cloud over the hero tower winds up and springs back, and an arc climbs the mast.
 *   level    the storm's light steps one palette on; and by itself, level or no level, it drifts
 *            slowly round the same wheel of six palettes as the clock runs.
 *
 * How hot play runs (shared/gameplay-surge.js) builds the storm instead of restarting it: under a
 * quick hand a struck tower keeps a share of its charge and the arcs leap further down the rows,
 * so the field fills; the wind, the rain and the corona rise, a glow gathers inside the cell, the
 * strip of clear sky closes and the storm's light deepens toward its own hue; in a fever the
 * towers arc to each other by themselves, and a four only inhales. Every envelope an event lights
 * accumulates (shared/swell.js). The storm grows in power, not in flicker: the cloud flashes by
 * itself at most every FLICKER_GAP (the rest joins its glow), and under Reduce flashing (ADR-0021)
 * the lightning holds still from the first frame and lights the storm with a trace of its light.
 *
 * Every bolt is a slot in a table and every delayed consequence a dated entry in a queue, so
 * seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    ANSWER_DELAY,
    ANSWER_GAP,
    DEG,
    FLASH_SLOTS,
    HELD_MAX,
    HUSH_HOLD,
    MAX_CHAIN_ARCS,
    PALETTE_DRIFT,
    PALETTE_KEYS,
    RIPPLE_SPEED,
    SHOCK_FADE,
    SHOCK_SLOTS,
    SHOCK_SPEED,
    STORM,
    TOWER,
    TOWER_MAX,
    VOLTAGE_STORM_PALETTES,
    WHITE_HOT,
    addHeld,
    approach,
    bakeCloudNoise,
    bakeNoise,
    createCloudTexture,
    createNoiseTexture,
    createStormUniforms,
    hash2,
    heldAt,
    mulberry32,
    paletteAt,
    paletteMix,
    palettePhase,
    pieceColor,
    powerForCombo,
    smooth,
    stormAnchors,
    supportsFloatTargets,
} from './voltage-storm-tsl.js';
import { tierFor } from './voltage-storm-quality.js';
import { createSky } from './voltage-storm-sky.js';
import { createWater } from './voltage-storm-water.js';
import { createTowerGlows, createTowers } from './voltage-storm-towers.js';
import { BoltTable, createBoltMesh } from './voltage-storm-bolts.js';
import { createRain, createSparks } from './voltage-storm-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './voltage-storm-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { CLOUD_SEED } from './voltage-storm-bake.js';
import { flashScale, prefersReducedFlashing } from '../../utils/photosensitivity.js';

/** The rest camera: a moderately wide lens a few metres over the water. */
export const REST_RIG = Object.freeze({
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 62,
    minFov: 30,
    maxFov: 62,
    near: 0.5,
    far: 42000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Seconds between the storm's own flickers at rest (a chain shortens it). */
export const AMBIENT_BEAT = 4.6;
/** Seconds the overdrive after a superbolt takes to cool to 1/e. */
export const SURGE_COOL = 3.2;
/** The cloud's twist: how hard it springs back, how fast it settles, radians per unit. */
const TWIST_STIFFNESS = 26;
const TWIST_DAMPING = 4.6;
const TWIST_REACH = 0.9;
/** Seconds a struck tower's white takes to fade to 1/e. */
const STRIKE_FADE = 0.2;
/** How many locks' worth of charge fills a tower's rings. */
const RINGS_FULL = 1.5;
/** A ring weaker than this (strength after its fade) no longer shows on the water. */
const SHOCK_ALIVE = 1e-3;
/** Tower pairs a chain's standing arcs join, in the order they are raised (nearest-first indices). */
const CHAIN_PAIRS = Object.freeze([[0, 2], [1, 3], [0, 1], [2, 4], [3, 5]]);
/** Standing arcs let go one after another when a chain ends: this many a second. */
const CHAIN_LET_GO = 3;

// ── How the storm builds with play (src/themes/shared/gameplay-surge.js) ──────────
/**
 * The cloud flashes on its own (the storm's beat, a lock's answer, a level's) at most once in
 * this many seconds: under three a second, ADR-0021's limit for frame-wide flashes. A flash held
 * back is never dropped: its bolt still crawls, and its light joins the cloud's held glow.
 */
export const FLICKER_GAP = 0.34;
/** The storm's own lightning quickens with a chain, up to this many times its pace at rest. */
export const AMBIENT_MAX_RATE = 4.5;
/** The most a struck tower keeps of what it held, once play runs hot (at rest it empties). */
export const KEEP_MAX = 0.72;
/** Superbolts stack their overdrive up to this. */
const SURGE_MAX = 1.6;
/** What a held-back flash gives the cloud's glow, per unit of its power. */
const GLOW_FOLD = 0.35;
/**
 * The cloud's thunder-light: its gain at the height of a fever, on what it holds back, and on
 * the light of bolts the flash table had no room for. Small: a light inside the lobes, not a
 * wash over the cell (the cloud's own darks are the storm).
 */
const GLOW_HEAT = 0.3;
const GLOW_HELD = 0.3;
const GLOW_SPILL = 0.25;
/** How far the storm's light deepens toward its own hue at the height of a fever (0: never). */
const ELECTRIC = 1.1;
/** The sheet lightning's fade (per second; the sky's shader fades it the same) and the ripple's (seconds). */
const SHEET_FADE = 0.85;
const RIPPLE_FADE = 0.8;
/** A lock's pulse climbs the rings for this long, fading at this rate (the towers' shader agrees). */
const PULSE_CLIMB = 0.3;
const PULSE_FADE = 2.2;

const byTime = (a, b) => a.time - b.time;
const NO_LIGHTS = Object.freeze([]);
const NO_SPILL = Object.freeze({
    k: 0, r: 0, g: 0, b: 0,
});

const PARTS = ['sky', 'water', 'towers', 'towerMirror', 'boltMirror', 'glows', 'bolts', 'sparks', 'rain'];

export class VoltageStormWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]  paints the sky target each frame
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     * @param {boolean} [params.floatSky]  paint the sky into a half-float target (default: ask the
     *                                     renderer; false gives the 8-bit target a WebGL2 context
     *                                     without float colour buffers gets)
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 0x57a7, floatSky,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.floatSky = floatSky ?? supportsFloatTargets(renderer);
        this.root = new THREE.Group();
        this.root.name = 'VoltageStorm';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.sky = null;
        this.bolts = null;
        this.sparks = null;
        this.towerMesh = null;
        this.towerMirror = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.anchors = stormAnchors(this.aspect);
        /** The collectors, nearest first; index 0 is the hero. */
        this.towers = [];
        /** The hero's finial on screen (fractions, y down): where the post's ripple comes from. */
        this.heart = { x: 0.2, y: 0.4 };
        this.targets = { left: [], right: [] };
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(30, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._look = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._fwd = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        /** The level's place on the wheel of palettes, eased (0 = the first palette). */
        this.wheelPlace = 0;
        /** The live palette, a scratch palette (where a new level is heading) and a scratch mix. */
        this._wheel = {};
        this._mix = {};
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...VOLTAGE_STORM_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            bloomBoost: 0,
            exposure: 1,
            streak: 0,
            ripple: {
                x: 0.5, y: 0.5, radius: 0, strength: 0,
            },
        };
        this.queue = [];
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), fed by every lock, clear and
         * level: the field charges up (a struck tower keeps more of its charge, the arcs leap
         * further down the rows), the cloud holds a glow of its own, the rain thickens and leans,
         * the wind quickens, corona burns on every electrode, and in a fever the towers arc to
         * each other and the strip of clear sky closes. `heat` is the frame's reading.
         */
        this.pace = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** Calm 0 → a fever 1: the one number the storm's weather is driven by. */
        this.drive = 0;
        /**
         * The cloud's held glow: flashes held back under fast play (and the dimmest bolts' light
         * when the sky has more than the flash table holds) join it; it rises and falls slowly.
         */
        this.glow = new Swell({
            attack: 0.3, release: 1.8, ceiling: 1.6, knee: 1,
        });
        /** The lens's kick: every thunderclap adds to what is still shaking. */
        this.kickSwell = new Swell({ release: 0.2, ceiling: 1, knee: 0.6 });
        /** The cloud's glow, written into the flash table as one wide light. */
        this.glowLight = {
            x: 0, y: STORM.cloudBase, z: -900, reach: 600, r: 1, g: 1, b: 1, k: 0,
        };
        /** The colour the field holds (each tower's tint by its charge) and how much it holds. */
        this._heldTint = [0, 0, 0];
        this._heldTotal = 0;
        this.resetState(0);
    }

    /**
     * Everything the choreography remembers. `keepHeat`: the weather play raised (the drive and
     * the cloud's held glow) eases away (a new run) instead of being forgotten (a seek); the
     * reading of play itself always starts again.
     */
    resetState(time, keepHeat = false) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.level = 1;
        this.kick = 0;
        this.kickSwell.reset();
        this.dip = 0;
        this.breath = 1;
        this.twist = 0;
        this.twistVelocity = 0;
        this.hushUntil = -1;
        /** How deep the hush before a superbolt goes (1 from cold; shallow once play runs hot). */
        this.hushDepth = 1;
        this.chainArcs = 0;
        /** The standing arcs held, eased down one by one when a chain ends. */
        this.chainHold = 0;
        /** Before this moment the cloud's own flashes are held back (FLICKER_GAP). */
        this.flickerFree = -Infinity;
        /** Difficult clears in a row that were back-to-back. */
        this.b2bRun = 0;
        /** The light of the bolts the flash table had no room for, smoothed. */
        this.spillGlow = 0;
        this.pace.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        if (!keepHeat) {
            this.glow.reset();
            this.drive = 0;
        }
        this.glowLight.k = 0;
        if (this.ripple) {
            this.ripple.birth = -100;
            this.ripple.strength = 0;
            this.ripple.x = 0.5;
            this.ripple.y = 0.5;
        } else {
            this.ripple = {
                birth: -100, strength: 0, x: 0.5, y: 0.5,
            };
        }
        this.counts = {
            locks: 0, clears: 0, quads: 0, arcs: 0, strikes: 0, flickers: 0, crowns: 0,
        };
        this.queue.length = 0;
        // The slow clocks are functions of the world clock until gameplay bends them.
        this.stormClock = time;
        this.rainClock = time;
        this.churn = time;
        this.driftX = STORM.drift[0] * time;
        this.driftZ = STORM.drift[2] * time;
        this.beat = Math.floor(time / AMBIENT_BEAT);
        this.bolts?.reset();
        this.sparks?.reset();
        for (let i = 0; i < this.towers.length; i++) {
            const tower = this.towers[i];
            tower.epoch = -1e9;
            tower.tint = [0.4, 0.6, 1.0];
            tower.strike = 0;
            tower.pulseTime = -100;
            tower.pulseStrength = 0;
        }
        if (this.u) {
            const { tables } = this.u;
            for (let i = 0; i < SHOCK_SLOTS; i++) {
                tables.shocks[i * 2].set(0, 0, -100, 0);
                tables.shocks[i * 2 + 1].set(1, 1, 1, SHOCK_SPEED);
            }
            for (let i = 0; i < FLASH_SLOTS * 2; i++) tables.flashes[i].set(0, 0, 0, 1);
            this.u.flashCount.value = 0;
            this.u.shockCount.value = 0;
            this.u.sheet.value.set(0, 0, -100, 0);
            this.u.veil.value.set(0, 0, 0);
        }
    }

    build() {
        const { tier } = this;
        const noise = createNoiseTexture(bakeNoise());
        const cloud = createCloudTexture(bakeCloudNoise(CLOUD_SEED, tier.noise3d), tier.noise3d);
        const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        placeholder.needsUpdate = true;
        this.textures.push(noise, cloud, placeholder);
        const u = createStormUniforms({
            noise, cloud, sky: placeholder, floatSky: this.floatSky,
        });
        this.u = u;
        this.bolts = new BoltTable(u.tables.bolts);
        // Under Reduce flashing from the very first bolt, not from the first strike.
        this.bolts.calm = this.stillFlash();

        this.sky = createSky(u, { march: tier.march, detail: tier.detail, flashSteps: tier.flashSteps });
        this.addPart('sky', this.sky);
        this.addPart('water', createWater(u, { rings: tier.rain >= 1800 }));

        this.compose();
        this.towerMesh = createTowers(u, this.towers);
        this.addPart('towers', this.towerMesh);
        if (tier.mirror) {
            this.towerMirror = createTowers(u, this.towers, { mirror: true });
            this.addPart('towerMirror', this.towerMirror);
            this.addPart('boltMirror', createBoltMesh(u, { detail: Math.min(1, tier.boltDetail), mirror: true }));
        }
        this.addPart('glows', createTowerGlows(u, this.towers.length, { images: tier.mirror }));
        this.addPart('bolts', createBoltMesh(u, { detail: tier.boltDetail }));
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);
        this.addPart('rain', createRain(u, tier.rain));

        this.resetState(0);
        this.applyPalette(1);
        this.writeTowers();
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
        if (this.u && bufferWidth > 0 && bufferHeight > 0) {
            this.u.viewport.value.set(bufferWidth, bufferHeight);
            this.sky?.resize(bufferWidth, bufferHeight, this.tier.skyScale);
        }
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
        this.updatePixelAngle();
        this.findTargets();
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
        this.findTargets();
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
        // (Turning reduced motion off leaves the bolts calm while Reduce flashing is on.)
        if (this.bolts) this.bolts.calm = this.stillFlash();
    }

    /**
     * Reduced motion or Reduce flashing (ADR-0021, read live): every bolt has one stroke, a
     * standing arc holds a steady light and the beacons burn steady.
     */
    stillFlash() {
        return this.reducedMotion || prefersReducedFlashing();
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
        this.writeTowers();
    }

    /** A new run: the towers empty, no chain, the storm back at rest (it keeps drifting). */
    resetSession() {
        const keep = {
            stormClock: this.stormClock,
            rainClock: this.rainClock,
            churn: this.churn,
            driftX: this.driftX,
            driftZ: this.driftZ,
            beat: this.beat,
            // The charge and the overdrive ease away (a cut would jump the camera and the iris),
            // and so does how hot play ran (the weather it raised settles over a few seconds).
            power: this.power,
            surge: this.surge,
        };
        this.resetState(this.time, true);
        Object.assign(this, keep);
        // The palette eases back to the first level's in update().
        this.writeTowers();
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

    // ── Composition ─────────────────────────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, STORM.eye, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, STORM.eye + this.restPitchTan() * 10, -10);
        cam.updateMatrixWorld();
        return cam;
    }

    /** tan of the rest camera's pitch: what puts the horizon where the composition wants it. */
    restPitchTan() {
        const tanV = Math.tan((fovForAspect(this.aspect) * DEG) / 2);
        return (1 - 2 * this.anchors.horizon) * tanV;
    }

    /** Stand the towers where the composition wants them for this aspect. */
    compose() {
        this.anchors = stormAnchors(this.aspect);
        const cam = this.restCamera();
        const horizonY = 2 * this.anchors.horizon - 1;
        const plan = [...this.anchors.towers].sort((a, b) => a.dist - b.dist)
            .slice(0, Math.min(TOWER_MAX, this.tier.towers));
        const rand = mulberry32(this.seed);
        const previous = this.towers;
        this.towers = plan.map((anchor, index) => {
            this._ray.set(anchor.sx * 2 - 1, horizonY, 0.5).unproject(cam).sub(cam.position);
            this._ray.y = 0;
            this._ray.normalize();
            const old = previous[index];
            return {
                index,
                x: cam.position.x + this._ray.x * anchor.dist,
                z: cam.position.z + this._ray.z * anchor.dist,
                height: anchor.height,
                yaw: rand() * Math.PI * 0.5,
                side: anchor.side,
                row: anchor.row,
                dist: anchor.dist,
                epoch: old ? old.epoch : -1e9,
                tint: old ? old.tint : [0.4, 0.6, 1.0],
                strike: old ? old.strike : 0,
                pulseTime: old ? old.pulseTime : -100,
                pulseStrength: old ? old.pulseStrength : 0,
                sx: 0.5,
                sy: 0.5,
            };
        });
        // Arcs standing between tower tops would point at where the towers stood: drop them
        // (the chain raises them again on the next frame).
        this.bolts?.clear('chain');
        this.towerMesh?.place(this.towers);
        this.towerMirror?.place(this.towers);
        // Where each electrode stands on screen at rest.
        this.towers.forEach((tower) => {
            this._vec.set(tower.x, tower.height * TOWER.toroid, tower.z).project(cam);
            tower.sx = this._vec.x * 0.5 + 0.5;
            tower.sy = 0.5 - this._vec.y * 0.5;
        });
        if (this.u) {
            this.u.twist.value.x = this.towers[0].x;
            this.u.twist.value.y = this.towers[0].z - 120;
        }
        this.findTargets();
        this.writeTowers();
    }

    /**
     * Which towers an arc can be thrown to: those whose electrode the rest camera sees clear of
     * the card and the HUD, by the side of the card they are on, nearest first.
     */
    findTargets() {
        const left = [];
        const right = [];
        const card = cardUnion(this.layout) || {
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        };
        const { hud } = this.layout;
        const centre = (card.x0 + card.x1) * 0.5;
        const inside = (r, sx, sy, pad) => r
            && sx > r.x0 - pad && sx < r.x1 + pad && sy > r.y0 - pad && sy < r.y1 + pad;
        for (let i = 0; i < this.towers.length; i++) {
            const tower = this.towers[i];
            if (tower.sx < 0.01 || tower.sx > 0.99 || tower.sy < 0.01 || tower.sy > 0.99) continue;
            if (inside(card, tower.sx, tower.sy, 0.01) || inside(hud, tower.sx, tower.sy, 0.006)) continue;
            (tower.sx < centre ? left : right).push(i);
        }
        this.targets = { left, right };
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.5 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow sway, as of someone standing in the wind; the pointer leans the view; thunder
        // shakes it.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        const shake = this.kick * calm;
        const swayX = (Math.sin(t * 0.083) * 0.55 + Math.sin(t * 0.031 + 1.3) * 0.35) * calm;
        const swayY = (Math.sin(t * 0.057 + 0.7) * 0.16 + Math.sin(t * 0.023) * 0.1) * calm;
        camera.position.set(
            swayX + px * 2.2 + Math.sin(t * 61) * shake * 0.11,
            Math.max(2.5, STORM.eye + swayY - py * 0.9 + Math.sin(t * 47 + 1.1) * shake * 0.09),
            // The chain and the heat of play draw the eye in toward the field.
            -(this.power * 3.5 + this.drive * 1.6) * calm,
        );
        const yaw = (Math.sin(t * 0.041 + 2.1) * 0.006 - px * 0.016) * calm;
        const pitch = this.restPitchTan() + (Math.sin(t * 0.035) * 0.004 - py * 0.012) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + pitch * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.027) * 0.006 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the sway above: the view only
        // turns (an eye over the water, looking out to the horizon), off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** The world point `depth` along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera || this.restCamera();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        // Never under the water: a ray that dips is cut short just above it.
        let reach = depth;
        if (this._ray.y < -1e-4) reach = Math.min(reach, (camera.position.y - 0.7) / -this._ray.y);
        out[0] = camera.position.x + this._ray.x * reach;
        out[1] = camera.position.y + this._ray.y * reach;
        out[2] = camera.position.z + this._ray.z * reach;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /** The card a board sits in (the one that holds its middle), else all the cards together. */
    cardOf(board) {
        const { cards } = this.layout;
        const x = (board.x0 + board.x1) * 0.5;
        const y = (board.y0 + board.y1) * 0.5;
        for (let i = 0; i < (cards ? cards.length : 0); i++) {
            const c = cards[i];
            if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) return c;
        }
        return cardUnion(this.layout) || board;
    }

    /** Do `run` when the world clock reaches `time`. */
    schedule(time, run) {
        this.queue.push({ time, run });
    }

    /** The tower a lock on `side` (−1 left, +1 right) charges: usually the nearest clear one. */
    pickTower(side, salt = 0) {
        let list = side < 0 ? this.targets.left : this.targets.right;
        if (!list.length) list = side < 0 ? this.targets.right : this.targets.left;
        if (!list.length) return this.towers.length ? salt % this.towers.length : -1;
        const roll = hash2(this.counts.locks + 1, 91 + salt * 13);
        let pick = 0;
        if (roll > 0.93 && list.length > 2) pick = 2;
        else if (roll > 0.7 && list.length > 1) pick = 1;
        // The hotter play runs, the further down the row the charge leaps: under a quick hand
        // the whole field fills, not just the nearest towers. (Read from the swell, a pure
        // function of the clock, so where an arc goes does not depend on how frames were cut.)
        const reach = Math.max(0, this.pace.level.valueAt(this.time) - 0.15) * 3.6;
        if (reach > 0) pick += Math.floor(hash2(this.counts.locks + 1, 57 + salt * 7) * (reach + 1));
        return list[Math.min(list.length - 1, pick + salt)];
    }

    /** The point of a tower's electrode nearest to a world point. */
    electrodePoint(tower, toward, out = [0, 0, 0]) {
        const dx = toward[0] - tower.x;
        const dz = toward[2] - tower.z;
        const d = Math.max(1e-3, Math.hypot(dx, dz));
        const r = tower.height * (TOWER.toroidRadius + TOWER.toroidTube);
        out[0] = tower.x + (dx / d) * r;
        out[1] = tower.height * TOWER.toroid;
        out[2] = tower.z + (dz / d) * r;
        return out;
    }

    /** Throw an arc from a screen point to a tower. Returns the moment it lands. */
    throwArc(towerIndex, sx, sy, rgb, {
        power = 0.6, width = 2.4, branches = 0.6, leader = 0.06, strokes = 2, time = this.time,
    } = {}) {
        const tower = this.towers[towerIndex];
        if (!tower || !this.bolts) return time;
        const start = [...this.screenToWorld(sx, sy, tower.dist * 0.94)];
        const end = this.electrodePoint(tower, start);
        this.bolts.fire({
            kind: 'arc',
            start,
            end,
            rgb,
            time,
            reach: 0.05,
            width,
            power,
            leader: this.reducedMotion ? 0.02 : leader,
            strokes,
            branches,
            glow: 150,
            glowGain: 1.2,
            now: this.time,
        });
        this.counts.arcs += 1;
        return time + (this.reducedMotion ? 0.02 : leader);
    }

    /** A tower takes a lock's charge: its rings light in that colour and a pulse climbs them. */
    charge(towerIndex, rgb, amount, hard) {
        const tower = this.towers[towerIndex];
        if (!tower) return;
        const before = heldAt(tower.epoch, this.time);
        const share = Math.max(0.4, amount / Math.max(1e-3, before + amount));
        tower.tint = tower.tint.map((c, k) => c + (rgb[k] - c) * share);
        tower.epoch = addHeld(tower.epoch, this.time, amount);
        // A pulse climbs the rings. One still climbing takes this charge with it (brighter, not
        // started again from the bottom: a soft lock never cuts a hard drop's pulse short).
        const strength = hard ? 1 : 0.62;
        const climbing = this.time - tower.pulseTime;
        if (climbing >= 0 && climbing < PULSE_CLIMB) {
            const back = Math.exp(climbing * PULSE_FADE);
            tower.pulseStrength = Math.min(tower.pulseStrength + strength * 0.6 * back, 1.6 * back);
        } else {
            tower.pulseTime = this.time;
            tower.pulseStrength = strength;
        }
        // The electrode flares as the arc lands, and a ring leaves the tower's foot.
        tower.strike = Math.max(tower.strike, hard ? 0.42 : 0.2);
        if (!hard) this.shock(tower.x, tower.z, this.time, 0.3, rgb);
        const pool = this.sparks ? this.sparks.count / 448 : 0;
        this.sparks?.emit({
            x: tower.x,
            y: tower.height * TOWER.toroid,
            z: tower.z,
            n: (hard ? 18 : 7) * pool,
            rgb,
            time: this.time,
            out: [10, hard ? 52 : 34],
            life: [0.35, 0.9],
            size: 0.24,
        });
    }

    /** A ring across the water from a point of the plain. */
    shock(x, z, time, strength, rgb = WHITE_HOT) {
        if (!this.u) return;
        // It takes the place of the weakest ring on the water (never one still in its prime).
        const rows = this.u.tables.shocks;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < SHOCK_SLOTS; i++) {
            const row = rows[i * 2];
            const left = row.w * Math.exp(-Math.max(0, time - row.z) * SHOCK_FADE);
            if (left < weakest) {
                weakest = left;
                slot = i;
            }
        }
        this.u.tables.shocks[slot * 2].set(x, z, time, strength);
        this.u.tables.shocks[slot * 2 + 1].set(rgb[0], rgb[1], rgb[2], SHOCK_SPEED);
    }

    /** One past the last ring slot whose ring still shows on the water (0 when none does). */
    liveShockSlots(time) {
        const rows = this.u.tables.shocks;
        let count = 0;
        for (let i = 0; i < SHOCK_SLOTS; i++) {
            const row = rows[i * 2];
            if (row.w * Math.exp(-Math.max(0, time - row.z) * SHOCK_FADE) > SHOCK_ALIVE) count = i + 1;
        }
        return count;
    }

    /**
     * May the cloud flash by itself at `time`? At most once every FLICKER_GAP (the storm's own
     * beat, a lock's answer and a level's share the allowance; the player's strikes take their
     * turn too). One held back is not lost: its light joins the cloud's held glow.
     */
    mayFlash(time, power) {
        if (time < this.flickerFree) {
            this.glow.hit(power * GLOW_FOLD, time);
            return false;
        }
        this.flickerFree = time + FLICKER_GAP;
        return true;
    }

    /** A flash the player asked for (a strike, a chain's step) lights at `time`: the cloud waits its turn after it. */
    tookFlash(time) {
        this.flickerFree = Math.max(this.flickerFree, time + FLICKER_GAP);
    }

    /**
     * Lightning inside the cloud over a point of the plain: a crawler and its glow. `lit` false:
     * the crawler runs through the cloud without lighting it (a flash held back).
     */
    flicker(x, z, rgb, power, time = this.time, salt = 0, lit = true) {
        if (!this.bolts) return;
        const rand = mulberry32(0x3c1 + this.counts.flickers * 131 + salt);
        this.counts.flickers += 1;
        // In the cloud's lowest lobes, and well inside the cell (far out it would hang in clear air).
        const y = STORM.cloudBase - STORM.cloudSag + 14 + rand() * 40;
        const run = (rand() < 0.5 ? -1 : 1) * (240 + rand() * 620);
        const cx = Math.max(-1300, Math.min(1300, x));
        const cz = Math.max(-1500, Math.min(-380, z));
        this.bolts.fire({
            kind: 'crawler',
            start: [cx - run * 0.5, y, cz + (rand() - 0.5) * 240],
            end: [cx + run * 0.5, y + (rand() - 0.5) * 30, cz + (rand() - 0.5) * 380],
            rgb,
            time,
            reach: 0.06,
            width: 2.0,
            power,
            leader: 0.14 + rand() * 0.1,
            strokes: 2 + Math.floor(rand() * 2),
            branches: 1,
            glow: 300,
            glowGain: lit ? 2.2 : 0,
            now: this.time,
        });
    }

    /** The cloud flickers by itself (a lock's answer, a level's): lit only when its turn has come. */
    cloudFlicker(x, z, rgb, power, time = this.time, salt = 0) {
        this.flicker(x, z, rgb, power, time, salt, this.mayFlash(time, power));
    }

    /**
     * The sky strikes a tower: a leader comes down from the cloud beyond it, and when it connects
     * the tower goes white and lets go of what it holds, all but the share `keep`. `light` scales
     * the light the bolt throws on the cloud (0: the channel only).
     */
    strike(towerIndex, time, {
        power = 1, strokes = 3, width = 3.3, leader = 0.1, superbolt = false, keep = 0, light = 1,
    } = {}) {
        const tower = this.towers[towerIndex];
        if (!tower || !this.bolts) return;
        const rand = mulberry32(0x8b1 + this.counts.strikes * 977 + towerIndex * 31);
        this.counts.strikes += 1;
        // It leaves the cloud's underside where that meets the top of the frame (or, for a far
        // tower, a little beyond the tower), leaning in toward the middle of the picture, so the
        // channel crosses the open sky beside the card.
        const eyeX = this._rest.position.x;
        const eyeZ = this._rest.position.z;
        const under = STORM.cloudBase - STORM.cloudSag + 10;
        const topTan = this.restPitchTan() + Math.tan((fovForAspect(this.aspect) * DEG) / 2) * 0.96;
        const meets = (under - STORM.eye) / Math.max(0.15, topTan);
        const reach = Math.max(meets, tower.dist + 60 + rand() * 200);
        const bearing = Math.atan2(tower.x - eyeX, -(tower.z - eyeZ)) - tower.side * (0.06 + rand() * 0.11);
        const startX = eyeX + Math.sin(bearing) * reach;
        const startZ = eyeZ - Math.cos(bearing) * reach;
        const lead = this.reducedMotion ? 0.03 : leader;
        // Reduced motion or Reduce flashing: one stroke, no flicker (the bolts' own beat too).
        const stillFlash = this.reducedMotion || prefersReducedFlashing();
        if (this.bolts) this.bolts.calm = stillFlash;
        const flashes = stillFlash ? 1 : strokes;
        const { bolt } = this._palette;
        this.bolts.fire({
            kind: 'strike',
            start: [startX, under, startZ],
            end: [tower.x, tower.height * TOWER.tip, tower.z],
            rgb: superbolt ? [bolt[0] * 0.6 + 0.4, bolt[1] * 0.6 + 0.4, bolt[2] * 0.6 + 0.4] : bolt,
            time,
            reach: 0.04 + rand() * 0.022,
            width,
            power,
            leader: lead,
            strokes: flashes,
            branches: 1,
            glow: superbolt ? 400 : 270,
            glowGain: (superbolt ? 4.2 : 3.0) * light,
            now: this.time,
        });
        if (light > 0) this.tookFlash(time + lead);
        this.schedule(time + lead, () => this.connect(towerIndex, power, superbolt, keep));
    }

    /** A leader has reached a tower's finial: it lets go of all it holds but the share `keep`. */
    connect(towerIndex, power, superbolt, keep = 0) {
        const tower = this.towers[towerIndex];
        if (!tower) return;
        const held = heldAt(tower.epoch, this.time);
        const kept = held * Math.max(0, Math.min(1, keep));
        const lost = held - kept;
        tower.strike = Math.max(tower.strike, Math.min(1.6, power));
        const pool = this.sparks ? this.sparks.count / 448 : 0;
        const rgb = lost > 0.2 ? tower.tint : this._palette.flash;
        this.sparks?.emit({
            x: tower.x,
            y: tower.height * TOWER.toroid,
            z: tower.z,
            n: (10 + lost * 22 + (superbolt ? 40 : 0)) * pool,
            rgb,
            time: this.time,
            out: [16, 58 + lost * 26 + (superbolt ? 40 : 0)],
            life: [0.45, superbolt ? 1.7 : 1.25],
            size: 0.3,
            stagger: 0.1,
        });
        // It lets go of what it held: all of it from cold; under a quick hand it keeps a share,
        // so lock after lock the field fills instead of being wiped at every clear.
        tower.epoch = kept > 1e-3 ? addHeld(-1e9, this.time, kept) : -1e9;
        this.shock(tower.x, tower.z, this.time, Math.min(1.5, 0.45 + power * 0.45));
        // Every thunderclap adds to the shake still running.
        this.kickSwell.hit(Math.min(1, 0.22 + power * 0.3) * 0.75, this.time);
        if (superbolt) {
            // A second superbolt drives the overdrive on; it does not start it again.
            this.surge = Math.min(SURGE_MAX, this.surge + 1);
            this.sheetPush(tower.x, tower.z - 160, this.reducedMotion ? 0.5 : 1);
            this.ripplePush(this.reducedMotion ? 0.25 : 1);
        }
    }

    /**
     * Sheet lightning runs out through the cloud from (x, z). While one is still running, a new
     * one drives it brighter instead of pulling its front back to the start.
     */
    sheetPush(x, z, strength) {
        const sheet = this.u.sheet.value;
        // Frame-wide light through the whole cloud: Reduce flashing keeps a trace of it.
        const s = strength * flashScale();
        const age = this.time - sheet.z;
        const left = age >= 0 ? sheet.w * Math.exp(-age * SHEET_FADE) : 0;
        if (age >= 0 && age < 1.2 && left > s * 0.35) {
            const back = Math.exp(age * SHEET_FADE);
            sheet.w = Math.min(sheet.w + s * back, Math.max(sheet.w, 1.5 * back));
        } else sheet.set(x, z, this.time, s);
    }

    /** The picture ripples from the hero's finial; a ripple still spreading is driven on, not restarted. */
    ripplePush(strength) {
        const r = this.ripple;
        const age = this.time - r.birth;
        const left = age >= 0 ? r.strength * Math.exp(-age / RIPPLE_FADE) : 0;
        if (age >= 0 && left > strength * 0.4) {
            const back = Math.exp(age / RIPPLE_FADE);
            r.strength = Math.min(r.strength + strength * back, Math.max(r.strength, 1.4 * back));
        } else {
            r.birth = this.time;
            r.strength = strength;
            r.x = this.heart.x;
            r.y = this.heart.y;
        }
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.bolts) return;
        const rgb = pieceColor(color);
        const point = screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
        const board = point ? null : boardFor(this.layout, player);
        const edges = board ? this.cardOf(board) : null;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        // With several boards on screen a board throws its arcs outward, away from the others.
        if (edges && this.layout.cards.length > 1) {
            const middle = (edges.x0 + edges.x1) * 0.5;
            if (Math.abs(middle - 0.5) > 0.06) side = middle < 0.5 ? -1 : 1;
        }
        if (point) side = point.x < 0.5 ? -1 : 1;
        // No tower stands clear on that side of the card: the arc leaves by the other edge.
        if (!(side < 0 ? this.targets.left : this.targets.right).length) side = -side;
        let wx = side < 0 ? 0.4 : 0.6;
        let wy = 0.6;
        if (point) {
            wx = point.x;
            wy = point.y;
        } else if (board) {
            const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
            boardPoint(board, u, row, this._point);
            wx = side < 0 ? edges.x0 : edges.x1;
            wy = this._point.y;
        }
        const target = this.pickTower(side);
        if (target >= 0) {
            const tower = this.towers[target];
            const land = this.throwArc(target, wx, wy, rgb, hardDrop
                ? {
                    power: 1, width: 3.6, branches: 1, leader: 0.05, strokes: 3,
                }
                : { power: 0.6, width: 2.4, branches: 0.55 });
            this.schedule(land, () => this.charge(target, rgb, hardDrop ? 0.9 : 0.55, hardDrop));
            // The cloud above it flickers back in the piece's colour (under fast play, at most
            // a few times a second: the rest glows in the cloud instead).
            const tint = rgb.map((c) => c * 0.75 + 0.25);
            this.schedule(land + 0.07, () => this.cloudFlicker(tower.x, tower.z - 130, tint, hardDrop ? 0.34 : 0.2));
            if (hardDrop) {
                const other = this.pickTower(side, 1);
                if (other >= 0 && other !== target) {
                    const landed = this.throwArc(other, wx, wy, rgb, { power: 0.55, width: 2.2, branches: 0.4 });
                    this.schedule(landed, () => this.charge(other, rgb, 0.4, false));
                }
                this.schedule(land, () => this.shock(tower.x, tower.z, this.time, 0.75, rgb));
            }
        }
        this.kickSwell.hit(hardDrop ? 0.3 : 0.05, this.time);
        this.pace.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b` (the second difficult clear in a
     * row); `cascade` = which wave of one lock's cascade this is (1: the lock's own clear);
     * `combo` = the true combo; `rows` = the visible rows that went.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, b2b = false, cascade = 1, combo = 1,
        player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.bolts || !this.towers.length) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const wave = Math.max(1, Math.min(12, Math.round(Number(cascade) || 1)));
        const p = this._palette;
        const now = this.time;
        // How hot play ran before this clear (the swell is a pure function of the clock): from
        // cold a struck tower lets go of everything, as it always did; under a quick hand it
        // keeps a share, so the field fills lock by lock, and the sky's answer is heavier.
        const before = this.pace.level.valueAt(now);
        const hot = smooth(0.12, 0.85, before);
        const keep = KEEP_MAX * hot;
        this.pace.clear({
            lines: n, cascade: wave, combo, tspin, perfect, b2b,
        }, quad ? now + HUSH_HOLD : now);
        if (b2b) this.b2bRun += 1;
        else if (quad || tspin) this.b2bRun = 0;

        // ── The cleared rows discharge out of both edges of the card ──
        const board = boardFor(this.layout, player);
        const card = board ? this.cardOf(board) : null;
        if (board && card && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const rgb = [0, 1, 2].map((k) => p.bolt[k] * 0.5 + 0.5);
            for (let i = 0; i < list.length && i < 4; i++) {
                const { y } = boardPoint(board, 0.5, list[i], this._point);
                // One arc per row, to either side in turn.
                const side = (i + this.counts.clears) % 2 ? 1 : -1;
                const target = this.pickTower(side, 0);
                if (target < 0) continue;
                this.throwArc(target, side < 0 ? card.x0 : card.x1, y, rgb, {
                    power: 0.5 + 0.1 * n,
                    width: 1.9 + 0.15 * n,
                    branches: 0.4,
                    leader: 0.045,
                    // Four lines hold their charge through the hush and let go with the superbolt.
                    time: (quad ? now + HUSH_HOLD : now) + i * 0.022,
                });
            }
        }

        // ── The sky answers: the towers that hold the most are struck ──
        const order = this.towers.map((tower) => tower.index)
            .sort((a, b) => (heldAt(this.towers[b].epoch, now) - heldAt(this.towers[a].epoch, now))
                || (this.towers[a].dist - this.towers[b].dist));
        const twin = b2b && this.towers.length > 1;
        let answered = now + ANSWER_DELAY + n * ANSWER_GAP;
        if (quad) {
            // The storm holds its breath; then the hero tower takes a superbolt and the rest follow.
            // From cold it holds it fully; the hotter play already runs the shallower the hush, so
            // a four in the middle of a fever inhales instead of putting the storm out.
            const birth = now + HUSH_HOLD;
            this.hushUntil = birth;
            this.hushDepth = Math.max(0.15, 1 - 0.85 * before);
            answered = birth;
            this.strike(0, birth, {
                power: perfect ? 1.6 : 1.4,
                strokes: 5,
                width: 6.4 + hot * 1.2,
                leader: 0.07,
                superbolt: true,
                keep: keep * 0.5,
            });
            // The four nearest others follow (a bolt on every far mast would only tangle the sky).
            let turn = 0;
            for (let i = 0; i < order.length; i++) {
                if (order[i] === 0 || order[i] > 4 || (twin && order[i] === 1)) continue;
                turn += 1;
                this.strike(order[i], birth + 0.16 + turn * 0.075, {
                    power: 0.95 - turn * 0.04, strokes: 3, width: 3.6, leader: 0.08, keep: keep * 0.5,
                });
            }
            // Lightning runs off through the cloud: the first crawler lights it, the others take
            // their turn (they fall within the superbolt's own flash: their light joins the glow).
            this.schedule(birth + 0.3, () => {
                for (let k = 0; k < 3; k++) {
                    const tower = this.towers[(k * 3) % this.towers.length];
                    const at = this.time + k * 0.12;
                    if (k === 0) {
                        this.flicker(tower.x * 1.6, tower.z - 300 - k * 260, p.flash, 0.7, at, k);
                        this.tookFlash(at);
                    } else this.cloudFlicker(tower.x * 1.6, tower.z - 300 - k * 260, p.flash, 0.7, at, k);
                }
            });
            this.counts.quads += 1;
        } else if (wave >= 2) {
            // A cascade's waves walk out into the storm: each strikes the pair of towers one row
            // further down the field than the last, harder, and the cloud lights deeper.
            let deepest = 0;
            for (let i = 0; i < this.towers.length; i++) deepest = Math.max(deepest, this.towers[i].row);
            const row = Math.min(deepest, wave - 1);
            let turn = 0;
            const strikeWave = (index) => {
                this.strike(index, now + ANSWER_DELAY + turn * 0.06, {
                    power: Math.min(1.35, 0.8 + 0.09 * wave + 0.15 * hot),
                    strokes: 2 + Math.min(3, wave >> 1),
                    width: 3.4 + 0.3 * wave,
                    keep,
                });
                turn += 1;
            };
            for (let i = 0; i < this.towers.length; i++) if (this.towers[i].row === row) strikeWave(i);
            // The wave's lines are answered too: any beyond the pair go to the towers holding the most.
            for (let i = 0; i < order.length && turn < Math.max(n, 2); i++) {
                if (this.towers[order[i]].row !== row) strikeWave(order[i]);
            }
            answered = now + ANSWER_DELAY + turn * 0.06;
            this.glow.hit(0.1 * wave * (1 + hot), now + ANSWER_DELAY);
        } else {
            for (let i = 0; i < n && i < order.length; i++) {
                this.strike(order[i], now + ANSWER_DELAY + i * ANSWER_GAP, {
                    power: 0.75 + 0.1 * n + 0.15 * hot, strokes: 2 + n, width: 3.6 + 0.3 * n + 0.6 * hot, keep,
                });
            }
            if (n === 3) {
                const hero = this.towers[0];
                this.schedule(now + 0.4, () => {
                    this.flicker(hero.x, hero.z - 420, p.flash, 0.6);
                    this.tookFlash(this.time);
                });
            }
        }
        if (twin) {
            // Back-to-back: the sky answers twice. Both heroes, either side of the board, are
            // struck at the same instant (in a four, the second beside the superbolt) and a sheet
            // runs out between them, harder with every back-to-back in a row.
            const run = Math.min(4, this.b2bRun);
            const at = quad ? answered : answered + 0.04;
            const hit = {
                power: 1.15 + 0.1 * run,
                strokes: 4,
                width: 4.6 + 0.5 * run,
                leader: 0.07,
                keep: keep * 0.5,
                // (Beside a superbolt: their channels carry the moment, not more light on the cloud.)
                light: 0.7,
            };
            if (!quad) this.strike(0, at, hit);
            this.strike(1, at, hit);
            const [a, b] = this.towers;
            this.schedule(at + hit.leader + 0.02, () => {
                const sheet = (this.reducedMotion ? 0.35 : 0.7) + 0.1 * run;
                this.sheetPush((a.x + b.x) * 0.5, Math.min(a.z, b.z) - 160, sheet);
                this.ripplePush((this.reducedMotion ? 0.15 : 0.5) + 0.1 * run);
            });
        }
        if (tspin) {
            // The cell winds up over the hero tower and an arc climbs its mast.
            this.twistVelocity += 3.2;
            this.climbMast(0.8, 3, 2.6);
            const hero = this.towers[0];
            this.schedule(now + 0.3, () => this.cloudFlicker(hero.x, hero.z - 140, p.chain, 0.5));
        }
        this.counts.clears += 1;
    }

    /** An arc climbs the hero tower's mast from the water to its electrode (a T-spin). */
    climbMast(power, strokes, width) {
        const hero = this.towers[0];
        if (!hero || !this.bolts) return;
        this.bolts.fire({
            kind: 'arc',
            start: [hero.x, 1, hero.z],
            end: [hero.x, hero.height * TOWER.toroid, hero.z],
            rgb: this._palette.chain,
            time: this.time,
            reach: 0.05,
            width,
            power,
            leader: this.reducedMotion ? 0.03 : 0.3,
            strokes,
            branches: 0.4,
            glow: 130,
            glowGain: 1.6,
            now: this.time,
        });
    }

    /**
     * A perfect clear that came on a frame of its own (physics sends it after the last wave of the
     * clear that emptied the board): the crown on the clear still playing, never a second hush.
     * The whole field lets go of everything it holds: walking out from the hero down both rows,
     * every tower holding charge throws it as sparks of its colours and the fullest are struck;
     * the cloud lights from within in one slow swell (not a barrage of flashes), the sheet
     * lightning and the ripple still running are driven on, and then the storm breathes out.
     */
    onPerfect({ b2b = false } = {}) {
        if (!this.u || !this.bolts || !this.towers.length) return;
        const now = this.time;
        this.pace.clear({ lines: 1, perfect: true, b2b }, now);
        const holding = (i) => heldAt(this.towers[i].epoch, now);
        const order = this.towers.map((tower) => tower.index)
            .filter((i) => holding(i) > 0.02)
            .sort((a, b) => this.towers[a].dist - this.towers[b].dist);
        // The fullest six take a bolt each (the strike pool is shared with the clear still in
        // the air); every holder lets go.
        const fullest = [...order].sort((a, b) => holding(b) - holding(a)).slice(0, 6);
        order.forEach((index, turn) => {
            const at = now + 0.05 + turn * 0.07;
            if (fullest.includes(index)) {
                // Their light is the glow's: a walking barrage of flashes would strobe the frame.
                this.strike(index, at, {
                    power: 0.95, strokes: 2, width: 3.6, leader: 0.06, keep: 0, light: 0,
                });
            } else this.schedule(at + 0.06, () => this.connect(index, 0.7, false, 0));
        });
        const hero = this.towers[0];
        this.glow.hit(1.3, now);
        this.surge = Math.min(SURGE_MAX, this.surge + 0.6);
        this.sheetPush(hero.x, hero.z - 160, this.reducedMotion ? 0.4 : 0.8);
        this.ripplePush(this.reducedMotion ? 0.2 : 0.6);
        this.kickSwell.hit(0.3, now);
        this.counts.crowns += 1;
    }

    /** A T-spin that cleared nothing: the cell turns a little over the hero, a small arc climbs its mast. */
    onTSpin() {
        if (!this.u || !this.bolts || !this.towers.length) return;
        this.twistVelocity += 1.4;
        this.climbMast(0.45, 2, 1.9);
        this.kickSwell.hit(0.06, this.time);
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const count = Number(combo);
        const n = Number.isFinite(count) ? Math.max(0, Math.min(999, Math.round(count))) : 0;
        // The chain broke: the storm breathes out (a slow, shallow dip; the standing arcs let go
        // one after another, see holdChain).
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.16);
        if (n >= 2 && n > this.combo && this.towers.length) {
            // Another step: the cloud answers at once.
            const tower = this.towers[n % this.towers.length];
            this.flicker(tower.x, tower.z - 200, this._palette.chain, Math.min(0.8, 0.28 + 0.07 * n));
            this.tookFlash(this.time);
        }
        this.combo = n;
    }

    /** A new level: the storm's light steps one palette on from wherever it has drifted to. */
    levelUp(level, { silent = false } = {}) {
        const asked = Number(level);
        this.level = Number.isFinite(asked) ? Math.max(1, Math.min(9999, Math.round(asked))) : 1;
        if (silent) this.applyPalette(1);
        else if (this.towers.length) {
            const next = paletteAt(palettePhase(this.level, this.time), this._wheel);
            for (let k = 0; k < 2; k++) {
                const tower = this.towers[(k * 2 + 1) % this.towers.length];
                this.cloudFlicker(tower.x, tower.z - 260, next.flash, 0.6, this.time + k * 0.18, k);
            }
            this.pace.levelUp(this.time);
        }
    }

    /** Where the storm's light stands on the wheel now: the eased level's place plus the clock's drift. */
    wheelPhase() {
        return this.wheelPlace + Math.max(0, this.time) / PALETTE_DRIFT;
    }

    /**
     * Set the live palette to where the storm's light stands now: the level's place on the wheel
     * of palettes plus the slow drift of the clock, so the storm changes its light by itself as a
     * run goes on and steps on when a level is reached. What is eased (by `k`; 1 snaps) is the
     * level's PLACE on the wheel, the short way round, never the colours: a new level's light
     * arrives through the same clean mixes the drift passes, and at rest the palette is a pure
     * function of the clock.
     */
    applyPalette(k) {
        const n = VOLTAGE_STORM_PALETTES.length;
        const want = (this.level - 1) % n;
        if (k >= 1) this.wheelPlace = want;
        else {
            let gap = want - this.wheelPlace;
            gap -= Math.round(gap / n) * n;
            // Settled: exactly on the place, so the drift alone moves the light from here.
            this.wheelPlace = Math.abs(gap) < 1e-4 ? want : (((this.wheelPlace + gap * k) % n) + n) % n;
        }
        paletteAt(this.wheelPhase(), this._palette);
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    /** The storm's own lightning, on its own clock. */
    ambient(beat) {
        const p = this._palette;
        const roll = hash2(beat, 7);
        const power = 0.3 + this.power * 0.5 + hash2(beat, 3) * 0.25;
        // Its light waits its turn behind the player's flashes and its own: held back, the bolt
        // still runs and its light joins the cloud's glow.
        const lit = this.mayFlash(this.time, power);
        if (roll < 0.26) {
            // Far off, in the clear strip: a thin strike onto the plain.
            const x = (hash2(beat, 17) - 0.42) * 4200;
            const z = -(2300 + hash2(beat, 19) * 1100);
            this.bolts.fire({
                kind: 'strike',
                start: [x + (hash2(beat, 23) - 0.5) * 500, STORM.cloudBase - STORM.cloudSag + 10, z - 200],
                end: [x, 0, z],
                rgb: p.bolt,
                time: this.time,
                reach: 0.045,
                width: 1.5,
                power: 0.5 + power * 0.4,
                leader: 0.12,
                strokes: 2 + Math.floor(hash2(beat, 29) * 3),
                branches: 0.9,
                glow: 420,
                glowGain: lit ? 2.0 : 0,
                now: this.time,
            });
        } else {
            const x = (hash2(beat, 31) - 0.5) * 2600;
            const z = -(450 + hash2(beat, 37) * 950);
            this.flicker(x, z, p.flash, power, this.time, beat, lit);
            if (roll > 0.8) this.cloudFlicker(x * 0.5 + 300, z - 500, p.flash, power * 0.7, this.time + 0.21, beat + 1);
        }
    }

    /**
     * Raise or let go of the standing arcs: one for every step of a chain past the first, and in a
     * fever the field arcs to itself whatever the chain. When the chain ends they let go one
     * after another, the last raised first, instead of all on the same frame.
     */
    holdChain(dt) {
        const cap = this.reducedMotion ? 2 : MAX_CHAIN_ARCS;
        const fever = Math.floor(this.heat.fever * (MAX_CHAIN_ARCS + 0.99));
        const target = Math.min(cap, Math.max(0, this.combo - 1, fever));
        this.chainHold = target >= this.chainHold ? target : Math.max(target, this.chainHold - dt * CHAIN_LET_GO);
        const want = this.chainHold > 1e-6 ? Math.ceil(this.chainHold - 1e-6) : 0;
        const p = this._palette;
        for (let i = 0; i < MAX_CHAIN_ARCS; i++) {
            const pair = CHAIN_PAIRS[i];
            const a = this.towers[pair[0]];
            const b = this.towers[pair[1]];
            if (!a || !b) continue;
            const live = this.bolts.isLive('chain', i);
            if (i < want && !live) {
                this.bolts.fire({
                    kind: 'chain',
                    index: i,
                    held: true,
                    start: [a.x, a.height * TOWER.tip, a.z],
                    end: [b.x, b.height * TOWER.tip, b.z],
                    rgb: p.chain,
                    time: this.time,
                    reach: 0.035,
                    width: 1.9,
                    power: 0.8,
                    branches: 0.5,
                    glow: 200,
                    glowGain: 0.8,
                });
            } else if (i >= want && live) {
                this.bolts.release('chain', i, this.time);
            } else if (live) {
                // A standing arc follows the storm's light as a level changes it.
                this.bolts.tint('chain', i, p.chain);
            }
        }
        this.chainArcs = want;
    }

    /** Write every tower's row of the table (and gather the colour the field holds). */
    writeTowers() {
        if (!this.u) return;
        const rows = this.u.tables.towers;
        // St Elmo's fire: a chain, a superbolt's overdrive and the heat of play all feed it.
        const corona = Math.min(1.3, this.power * 0.95 + this.surge * 0.5 + this.drive * 0.7);
        const mix = this._heldTint;
        mix[0] = 0;
        mix[1] = 0;
        mix[2] = 0;
        let total = 0;
        for (let i = 0; i < TOWER_MAX; i++) {
            const tower = this.towers[i];
            if (!tower) {
                rows[i * 3].set(0, -5000, 1, 0);
                rows[i * 3 + 1].set(0, 0, 0, 0);
                rows[i * 3 + 2].set(0, -100, 0, 0);
                continue;
            }
            const held = heldAt(tower.epoch, this.time);
            rows[i * 3].set(tower.x, tower.z, tower.height, 1);
            rows[i * 3 + 1].set(tower.tint[0], tower.tint[1], tower.tint[2], Math.min(1, held / RINGS_FULL));
            rows[i * 3 + 2].set(
                tower.strike,
                tower.pulseTime,
                tower.pulseStrength,
                Math.min(1.4, corona + held * 0.14 * (1 + this.drive) + 0.05),
            );
            mix[0] += tower.tint[0] * held;
            mix[1] += tower.tint[1] * held;
            mix[2] += tower.tint[2] * held;
            total += held;
        }
        this._heldTotal = total;
    }

    /**
     * The cloud's own thunder-light: one wide, slow light low in the cell over the field, as bright
     * as play runs hot, plus every flash held back and the light of the bolts the flash table had
     * no room for, in the colours the towers hold. It drifts along the cell and breathes (under
     * half a beat a second); under Reduce flashing it holds steady. Written into `glowLight`
     * (k 0: dark). A light that grows instead of strobing: the storm's power, not its flicker.
     */
    thunderLight(t, dt, spill) {
        const L = this.glowLight;
        const reduced = prefersReducedFlashing();
        const steady = this.stillFlash();
        // The spilled light flickers with its bolts: the glow it feeds is smoothed.
        if (dt > 0) this.spillGlow += (spill.k - this.spillGlow) * approach(3, dt);
        // A light inside the cloud, not a wash over it: it lights the lobes it hangs in.
        const held = this.glow.valueAt(t) * GLOW_HELD * (reduced ? 0.4 : 1);
        const base = this.drive * GLOW_HEAT + this.surge * 0.04;
        const breathe = steady ? 1 : 0.8 + 0.2 * Math.sin(t * 2.1) * Math.sin(t * 0.83 + 1.7);
        const k = (base * (reduced ? 0.8 : 1) + held + this.spillGlow * GLOW_SPILL * (reduced ? 0.4 : 1))
            * breathe * (0.3 + 0.7 * this.breath);
        if (!(k > 0.004)) {
            L.k = 0;
            return L;
        }
        const roll = t * 0.17;
        L.x = Math.sin(roll * 1.3) * 700;
        L.y = STORM.cloudBase - 20;
        L.z = -(780 + 280 * Math.sin(roll * 0.9 + 1.1));
        L.reach = 380 + 160 * this.drive;
        // The cloud glows in the storm's light, leaning to the colours the field holds (and to
        // those of the bolts whose light it carries).
        const p = this._palette;
        const total = this._heldTotal;
        const tint = this._heldTint;
        const lean = total > 1e-6 ? 0.45 * Math.min(1, total / 4) : 0;
        const perHeld = total > 1e-6 ? lean / total : 0;
        const spilled = spill.k > 1e-6 ? Math.min(0.5, spill.k / (spill.k + 1)) : 0;
        const perSpill = spill.k > 1e-6 ? spilled / spill.k : 0;
        L.r = (p.flash[0] * (1 - lean) + tint[0] * perHeld) * (1 - spilled) + spill.r * perSpill;
        L.g = (p.flash[1] * (1 - lean) + tint[1] * perHeld) * (1 - spilled) + spill.g * perSpill;
        L.b = (p.flash[2] * (1 - lean) + tint[2] * perHeld) * (1 - spilled) + spill.b * perSpill;
        // Deeper in colour the hotter play runs, as the strokes are (see update()).
        const sat = 1 + ELECTRIC * this.drive;
        const m = Math.max(L.r, L.g, L.b);
        L.r = Math.max(0, m + (L.r - m) * sat);
        L.g = Math.max(0, m + (L.g - m) * sat);
        L.b = Math.max(0, m + (L.b - m) * sat);
        L.k = k;
        return L;
    }

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        // Reduced motion or Reduce flashing, from the first frame and live (ADR-0021).
        if (this.bolts) this.bolts.calm = this.stillFlash();

        // What gameplay kicked decays first, so a consequence that lands this frame starts whole.
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.dip *= Math.exp(-dt / 0.8);
        for (let i = 0; i < this.towers.length; i++) this.towers[i].strike *= Math.exp(-dt / STRIKE_FADE);

        // ── What was due ──
        // Each entry runs AT its own moment (the clock is set back to it for the call), so an arc
        // lands and a leader connects at the same time whatever frame notices it.
        if (this.queue.length) {
            this.queue.sort(byTime);
            while (this.queue.length && this.queue[0].time <= t) {
                const due = this.queue.shift();
                this.time = Math.min(t, due.time);
                // The storm's light as it was at that moment too (it drifts with the clock).
                paletteAt(this.wheelPhase(), this._palette);
                due.run();
            }
            this.time = t;
        }

        // ── How hot play runs ──
        const heat = this.pace.sample(t);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        // Calm 0 → a fever 1. It rises with play at once and settles back over a moment (a new
        // run starts the reading again; the weather it raised eases away).
        const driveTo = smooth(0.1, 0.9, heat.level) * 0.65 + heat.fever * 0.35;
        if (driveTo >= this.drive || this.drive - driveTo < 1e-4) this.drive = driveTo;
        else this.drive += (driveTo - this.drive) * approach(2, dt);
        const { drive } = this;
        this.kick = this.kickSwell.valueAt(t);

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.7, dt);
        // The hush before a superbolt, as deep as it was struck (shallow once play runs hot).
        const hush = t < this.hushUntil ? this.hushDepth : 0;
        const breathTarget = hush > 0 ? 1 - 0.86 * hush : 1 - this.dip;
        // It sinks fast into a hush; a broken chain's breath goes out slowly.
        let breathRate = 12;
        if (hush > 0) breathRate = 40;
        else if (breathTarget < this.breath) breathRate = 4;
        this.breath += (breathTarget - this.breath) * approach(breathRate, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(0.8, dt));

        // The cloud's twist (semi-implicit, in small steps so a long frame cannot blow it up).
        let left = Math.min(dt, 0.1);
        while (left > 1e-5) {
            const h = Math.min(left, 1 / 120);
            this.twistVelocity += (-TWIST_STIFFNESS * this.twist - TWIST_DAMPING * this.twistVelocity) * h;
            this.twist += this.twistVelocity * h;
            left -= h;
        }

        // ── The slow clocks ──
        // The wind and the rain answer the chain, the overdrive and the heat of play; the storm's
        // own lightning quickens with them, but never past AMBIENT_MAX_RATE (its flashes take
        // their turn behind the player's anyway: the storm grows in power, not in flicker).
        const hurry = this.reducedMotion ? 0.3 : 1;
        const gust = 1 + (this.power * 1.6 + this.surge * 1.2 + drive * 1.3) * hurry;
        this.driftX += STORM.drift[0] * dt * gust;
        this.driftZ += STORM.drift[2] * dt * gust;
        this.churn += dt * gust;
        this.rainClock += dt * (1 - 0.95 * hush) * (1 + this.power * 0.3 + drive * 0.4);
        const stormRate = (1 - hush)
            * (1 + Math.min(AMBIENT_MAX_RATE - 1, (this.power * 6.5 + this.surge * 3 + drive * 2) * hurry));
        const stormBefore = this.stormClock;
        this.stormClock += dt * stormRate;
        const beat = Math.floor(this.stormClock / AMBIENT_BEAT);
        if (beat !== this.beat) {
            this.beat = beat;
            if (dt > 0 && this.bolts) {
                // At the moment the beat fell, not at the frame that noticed it.
                // (Rounded to a microsecond: the clock is a running sum, and its last bits depend
                // on how the frames were cut.)
                const into = (beat * AMBIENT_BEAT - stormBefore) / Math.max(1e-6, dt * stormRate);
                this.time = Math.round((t - dt * (1 - Math.max(0, Math.min(1, into)))) * 1e6) / 1e6;
                paletteAt(this.wheelPhase(), this._palette);
                this.ambient(beat);
                this.time = t;
                paletteAt(this.wheelPhase(), this._palette);
            }
        }
        if (this.bolts) this.holdChain(dt);

        // ── Towers ──
        this.writeTowers();

        // ── Lightning, and the light it throws ──
        // Reduce flashing keeps a trace of the bolts' light on the cloud, the water and the rain
        // (the channels themselves still draw); the hotter play runs the more of the cloud's light
        // is the held glow and the less each stroke adds on top (a fever is heavier weather, not
        // a strobe). A superbolt keeps its whole light.
        const lights = this.bolts ? this.bolts.update(t, FLASH_SLOTS - 1) : NO_LIGHTS;
        const { flashes } = u.tables;
        const eye = camera ? camera.position : this._rest.position;
        const flashK = flashScale();
        const busy = 1 / (1 + 1.5 * drive);
        // And the storm turns electric: its light deepens toward its own hue (more colour, less
        // white), so a fever is saturated rather than washed.
        const sat = 1 + ELECTRIC * drive;
        const own = (0.3 + 0.7 * this.breath) * (this.reducedMotion ? 0.6 : 1) * flashK;
        let vr = 0;
        let vg = 0;
        let vb = 0;
        let count = 0;
        for (let i = 0; i < lights.length; i++) {
            const light = lights[i];
            const k = light.level * light.gain * own * (light.gain >= 4 ? 1 : busy);
            const m = Math.max(light.r, light.g, light.b);
            const r = Math.max(0, m + (light.r - m) * sat);
            const g = Math.max(0, m + (light.g - m) * sat);
            const b = Math.max(0, m + (light.b - m) * sat);
            flashes[i * 2].set(light.x, light.y, light.z, light.reach);
            flashes[i * 2 + 1].set(r * k, g * k, b * k, 0);
            const dx = light.x - eye.x;
            const dy = light.y - eye.y;
            const dz = light.z - eye.z;
            const fall = 1 / (1 + (dx * dx + dy * dy + dz * dz) / (light.reach * light.reach * 2.5));
            vr += r * k * fall;
            vg += g * k * fall;
            vb += b * k * fall;
            count += 1;
        }
        const strokeVeil = Math.max(vr, vg, vb);
        // The cloud's held glow takes the last row (it lights the rain and the iris, not the lens).
        const glow = this.thunderLight(t, dt, this.bolts ? this.bolts.spill : NO_SPILL);
        if (glow.k > 0) {
            flashes[count * 2].set(glow.x, glow.y, glow.z, glow.reach);
            flashes[count * 2 + 1].set(glow.r * glow.k, glow.g * glow.k, glow.b * glow.k, 0);
            const dx = glow.x - eye.x;
            const dy = glow.y - eye.y;
            const dz = glow.z - eye.z;
            const fall = 1 / (1 + (dx * dx + dy * dy + dz * dz) / (glow.reach * glow.reach * 2.5));
            vr += glow.r * glow.k * fall * 0.15;
            vg += glow.g * glow.k * fall * 0.15;
            vb += glow.b * glow.k * fall * 0.15;
            count += 1;
        }
        u.flashCount.value = count;
        u.veil.value.set(vr, vg, vb);
        // The water loops over its ring slots up to the last one still on it: none at rest.
        u.shockCount.value = this.liveShockSlots(t);

        // ── Uniforms ──
        u.time.value = t;
        // The towers' red beacons pulse; under reduced motion or Reduce flashing they burn steady.
        u.blink.value = this.reducedMotion || prefersReducedFlashing() ? 0 : 1;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.drift.value.set(this.driftX, 0, this.driftZ);
        u.churn.value = this.churn;
        u.rainClock.value = this.rainClock;
        // The rain thickens and leans into the wind as the storm builds (and the water roughens
        // with it: its rings follow the rain's weight).
        u.rainLean.value.set(
            0.16 + this.power * 0.2 + this.surge * 0.12 + drive * 0.16,
            0.05 + this.power * 0.05 + drive * 0.04,
        );
        u.rainGain.value = 0.85 + this.power * 0.8 + this.surge * 0.5 + drive * 0.9;
        u.twist.value.z = this.twist * TWIST_REACH * (this.reducedMotion ? 0.25 : 1);
        const p = this._palette;
        // The chain lifts the clear strip; the heat of play closes the cell over it (the storm
        // gathers: the evening light behind it dims, the lit towers and the strokes stand out).
        const lift = 1 + this.power * 0.18 * (1 - drive) - drive * 0.42;
        u.horizon.value.set(p.horizon[0] * lift, p.horizon[1] * lift, p.horizon[2] * lift);
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            if (key !== 'horizon') u[key].value.set(p[key][0], p[key][1], p[key][2]);
        }

        // ── What follows the camera ──
        if (camera) {
            camera.matrixWorld.extractBasis(this._right, this._up, this._fwd);
            u.camPos.value.copy(camera.position);
            u.camRight.value.copy(this._right);
            u.camUp.value.copy(this._up);
            u.camFwd.value.copy(this._fwd).negate();
            const tanV = Math.tan((camera.fov * DEG) / 2);
            u.tanHalf.value.set(tanV * camera.aspect, tanV);
            // The horizon in the frame: a point at eye level, far ahead.
            const eyeAt = camera.position;
            this._vec.set(eyeAt.x - this._fwd.x * 1e5, eyeAt.y, eyeAt.z - this._fwd.z * 1e5).project(camera);
            u.horizonV.value = 0.5 - this._vec.y * 0.5;
            const hero = this.towers[0];
            if (hero) {
                this._vec.set(hero.x, hero.height * TOWER.tip, hero.z).project(camera);
                this.heart.x = Math.max(-0.5, Math.min(1.5, this._vec.x * 0.5 + 0.5));
                this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._vec.y * 0.5));
            }
        }

        // ── The sky target (a replay toward a seek point steps without drawing) ──
        if (this.sky && this.sky.mesh.visible && sim.draw !== false) this.sky.render(this.renderer);

        // ── Post ──
        const veil = Math.max(vr, vg, vb);
        const post = this._post;
        post.flash = Math.min(1.5, strokeVeil * 0.5);
        post.kick = this.reducedMotion ? 0 : this.kick;
        // The bloom swells a little with the heat; the glow of the cloud carries most of it.
        post.bloomBoost = this.surge * 0.2 + drive * 0.1;
        post.streak = Math.min(1, strokeVeil * 0.35 + this.surge * 0.2);
        // The iris closes on a stroke, so the cloud it lights keeps its shape, and a little as the
        // storm builds, so its colours stay deep.
        post.exposure = 1 / (1 + veil * 0.3 + this.surge * 0.25 + this.power * 0.12 + drive * 0.1);
        const rippleAge = t - this.ripple.birth;
        post.ripple.x = this.ripple.x;
        post.ripple.y = this.ripple.y;
        post.ripple.radius = Math.max(0, rippleAge) * RIPPLE_SPEED;
        post.ripple.strength = rippleAge >= 0
            ? this.ripple.strength * Math.exp(-rippleAge / RIPPLE_FADE) * smooth(0, 0.1, rippleAge)
            : 0;
    }

    /**
     * The named palette the storm's light stands nearest to by its level and its clock (where it
     * is heading while a new level's step is still easing in).
     */
    paletteNow() {
        const mix = paletteMix(palettePhase(this.level, this.time), this._mix);
        return VOLTAGE_STORM_PALETTES[mix.mix < 0.5 ? mix.from : mix.to];
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    /** Everything the towers hold right now, in locks' worth of charge. */
    totalHeld() {
        let sum = 0;
        for (let i = 0; i < this.towers.length; i++) sum += heldAt(this.towers[i].epoch, this.time);
        return sum;
    }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            surge: this.surge,
            breath: this.breath,
            twist: this.twist,
            level: this.level,
            // The palette the light stands nearest to, the one it is drifting toward, and how far.
            palette: this.paletteNow().name,
            paletteNext: VOLTAGE_STORM_PALETTES[this._mix.to].name,
            paletteMix: this._mix.mix,
            counts: { ...this.counts },
            held: this.totalHeld(),
            heldMax: HELD_MAX,
            towers: this.towers.length,
            targets: { left: this.targets.left.length, right: this.targets.right.length },
            bolts: this.bolts ? this.bolts.liveCount() : 0,
            chainArcs: this.chainArcs,
            flashes: this.u ? this.u.flashCount.value : 0,
            // How hot play runs, the weather it drives, and the cloud's held glow (the last row
            // of the flash table while it is lit).
            heat: {
                level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage, drive: this.drive,
            },
            glow: this.glowLight.k,
            queued: this.queue.length,
            march: this.tier.march,
            floatSky: this.u ? this.u.floatSky : null,
            rain: this.parts.rain ? this.parts.rain.count : 0,
            sparks: this.sparks ? this.sparks.count : 0,
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
            part.dispose?.();
        });
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.queue.length = 0;
        this.sky = null;
        this.bolts = null;
        this.sparks = null;
        this.towerMesh = null;
        this.towerMirror = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as VOLTAGE_STORM_PARTS };
