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
 *            struck tower goes white, throws what it held as sparks of that colour and goes
 *            dark; the cloud lights from inside and a ring crosses the water.
 *   combo    the storm builds: lightning crawls through the cloud more and more often, an arc
 *            stands between neighbouring tower tops for every step of the chain, corona burns on
 *            the electrodes, the rain thickens and leans.
 *   four     the storm holds its breath (every light sinks, the rain hangs), then a superbolt
 *            strikes the hero tower with five return strokes, every other tower is struck in
 *            turn, sheet lightning runs out through the cloud and the picture ripples.
 *   T-spin   the cloud over the hero tower winds up and springs back, and an arc climbs the mast.
 *   level    the storm's light steps one palette on; and by itself, level or no level, it drifts
 *            slowly round the same wheel of six palettes as the clock runs.
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
/** Tower pairs a chain's standing arcs join, in the order they are raised (nearest-first indices). */
const CHAIN_PAIRS = Object.freeze([[0, 2], [1, 3], [0, 1], [2, 4], [3, 5]]);

const byTime = (a, b) => a.time - b.time;

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
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.level = 1;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.twist = 0;
        this.twistVelocity = 0;
        this.hushUntil = -1;
        this.chainArcs = 0;
        this.ripple = {
            birth: -100, strength: 0, x: 0.5, y: 0.5,
        };
        this.counts = {
            locks: 0, clears: 0, quads: 0, arcs: 0, strikes: 0, flickers: 0,
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
            this.u.shockCount.value = SHOCK_SLOTS;
            this.u.sheet.value.set(0, 0, -100, 0);
            this.u.veil.value.set(0, 0, 0);
        }
    }

    build() {
        const { tier } = this;
        const noise = createNoiseTexture(bakeNoise());
        const cloud = createCloudTexture(bakeCloudNoise(9001, tier.noise3d), tier.noise3d);
        const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        placeholder.needsUpdate = true;
        this.textures.push(noise, cloud, placeholder);
        const u = createStormUniforms({
            noise, cloud, sky: placeholder, floatSky: this.floatSky,
        });
        this.u = u;
        this.bolts = new BoltTable(u.tables.bolts);
        this.bolts.calm = this.reducedMotion;

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
        this.addPart('glows', createTowerGlows(u, this.towers.length));
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
        if (this.bolts) this.bolts.calm = this.reducedMotion;
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
            // The charge and the overdrive ease away (a cut would jump the camera and the iris).
            power: this.power,
            surge: this.surge,
        };
        this.resetState(this.time);
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
            -this.power * 3.5 * calm,
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
        tower.pulseTime = this.time;
        tower.pulseStrength = hard ? 1 : 0.62;
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

    /** Lightning inside the cloud over a point of the plain: a crawler and its glow. */
    flicker(x, z, rgb, power, time = this.time, salt = 0) {
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
            glowGain: 2.2,
        });
    }

    /**
     * The sky strikes a tower: a leader comes down from the cloud beyond it, and when it connects
     * the tower goes white and lets go of what it holds.
     */
    strike(towerIndex, time, {
        power = 1, strokes = 3, width = 3.3, leader = 0.1, superbolt = false,
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
        // Reduced motion: one stroke, no flicker.
        const flashes = this.reducedMotion ? 1 : strokes;
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
            glowGain: superbolt ? 4.2 : 3.0,
        });
        this.schedule(time + lead, () => this.connect(towerIndex, power, superbolt));
    }

    /** A leader has reached a tower's finial. */
    connect(towerIndex, power, superbolt) {
        const tower = this.towers[towerIndex];
        if (!tower) return;
        const held = heldAt(tower.epoch, this.time);
        tower.strike = Math.max(tower.strike, Math.min(1.6, power));
        const pool = this.sparks ? this.sparks.count / 448 : 0;
        const rgb = held > 0.2 ? tower.tint : this._palette.flash;
        this.sparks?.emit({
            x: tower.x,
            y: tower.height * TOWER.toroid,
            z: tower.z,
            n: (10 + held * 22 + (superbolt ? 40 : 0)) * pool,
            rgb,
            time: this.time,
            out: [16, 58 + held * 26 + (superbolt ? 40 : 0)],
            life: [0.45, superbolt ? 1.7 : 1.25],
            size: 0.3,
            stagger: 0.1,
        });
        // It lets go of what it held.
        tower.epoch = -1e9;
        this.shock(tower.x, tower.z, this.time, Math.min(1.5, 0.45 + power * 0.45));
        this.kick = Math.max(this.kick, Math.min(1, 0.22 + power * 0.3));
        if (superbolt) {
            this.surge = Math.max(this.surge, 1);
            this.u.sheet.value.set(tower.x, tower.z - 160, this.time, this.reducedMotion ? 0.5 : 1);
            this.ripple = {
                birth: this.time, strength: this.reducedMotion ? 0.25 : 1, x: this.heart.x, y: this.heart.y,
            };
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
            // The cloud above it flickers back in the piece's colour.
            const tint = rgb.map((c) => c * 0.75 + 0.25);
            this.schedule(land + 0.07, () => this.flicker(tower.x, tower.z - 130, tint, hardDrop ? 0.34 : 0.2));
            if (hardDrop) {
                const other = this.pickTower(side, 1);
                if (other >= 0 && other !== target) {
                    const landed = this.throwArc(other, wx, wy, rgb, { power: 0.55, width: 2.2, branches: 0.4 });
                    this.schedule(landed, () => this.charge(other, rgb, 0.4, false));
                }
                this.schedule(land, () => this.shock(tower.x, tower.z, this.time, 0.75, rgb));
            }
        }
        this.kick = Math.max(this.kick, hardDrop ? 0.34 : 0.05);
        this.counts.locks += 1;
    }

    /** Lines cleared. `lines` 1..4; `tspin`, `perfect`; `rows` = the visible rows that went. */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.bolts || !this.towers.length) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const p = this._palette;
        const now = this.time;

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
        if (quad) {
            // The storm holds its breath; then the hero tower takes a superbolt and the rest follow.
            const birth = now + HUSH_HOLD;
            this.hushUntil = birth;
            this.strike(0, birth, {
                power: perfect ? 1.6 : 1.4, strokes: 5, width: 6.4, leader: 0.07, superbolt: true,
            });
            // The four nearest others follow (a bolt on every far mast would only tangle the sky).
            let turn = 0;
            for (let i = 0; i < order.length; i++) {
                if (order[i] === 0 || order[i] > 4) continue;
                turn += 1;
                this.strike(order[i], birth + 0.16 + turn * 0.075, {
                    power: 0.95 - turn * 0.04, strokes: 3, width: 3.6, leader: 0.08,
                });
            }
            this.schedule(birth + 0.3, () => {
                for (let k = 0; k < 3; k++) {
                    const tower = this.towers[(k * 3) % this.towers.length];
                    this.flicker(tower.x * 1.6, tower.z - 300 - k * 260, p.flash, 0.7, this.time + k * 0.12, k);
                }
            });
            this.counts.quads += 1;
        } else {
            for (let i = 0; i < n && i < order.length; i++) {
                this.strike(order[i], now + ANSWER_DELAY + i * ANSWER_GAP, {
                    power: 0.75 + 0.1 * n, strokes: 2 + n, width: 3.6 + 0.3 * n,
                });
            }
            if (n === 3) {
                const hero = this.towers[0];
                this.schedule(now + 0.4, () => this.flicker(hero.x, hero.z - 420, p.flash, 0.6));
            }
        }
        if (tspin) {
            // The cell winds up over the hero tower and an arc climbs its mast.
            this.twistVelocity += 3.2;
            const hero = this.towers[0];
            this.bolts.fire({
                kind: 'arc',
                start: [hero.x, 1, hero.z],
                end: [hero.x, hero.height * TOWER.toroid, hero.z],
                rgb: p.chain,
                time: now,
                reach: 0.05,
                width: 2.6,
                power: 0.8,
                leader: this.reducedMotion ? 0.03 : 0.3,
                strokes: 3,
                branches: 0.4,
                glow: 130,
                glowGain: 1.6,
            });
            this.schedule(now + 0.3, () => this.flicker(hero.x, hero.z - 140, p.chain, 0.5));
        }
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const count = Number(combo);
        const n = Number.isFinite(count) ? Math.max(0, Math.min(999, Math.round(count))) : 0;
        // The chain broke: the storm lets its breath go.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.3);
        if (n >= 2 && n > this.combo && this.towers.length) {
            // Another step: the cloud answers at once.
            const tower = this.towers[n % this.towers.length];
            this.flicker(tower.x, tower.z - 200, this._palette.chain, Math.min(0.8, 0.28 + 0.07 * n));
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
                this.flicker(tower.x, tower.z - 260, next.flash, 0.6, this.time + k * 0.18, k);
            }
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
        const level = 0.3 + this.power * 0.5 + hash2(beat, 3) * 0.25;
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
                power: 0.5 + level * 0.4,
                leader: 0.12,
                strokes: 2 + Math.floor(hash2(beat, 29) * 3),
                branches: 0.9,
                glow: 420,
                glowGain: 2.0,
            });
        } else {
            const x = (hash2(beat, 31) - 0.5) * 2600;
            const z = -(450 + hash2(beat, 37) * 950);
            this.flicker(x, z, p.flash, level, this.time, beat);
            if (roll > 0.8) this.flicker(x * 0.5 + 300, z - 500, p.flash, level * 0.7, this.time + 0.21, beat + 1);
        }
    }

    /** Raise or let go of the chain's standing arcs. */
    holdChain() {
        const want = this.reducedMotion
            ? Math.min(2, Math.max(0, this.combo - 1))
            : Math.min(MAX_CHAIN_ARCS, Math.max(0, this.combo - 1));
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

    /** Write every tower's row of the table. */
    writeTowers() {
        if (!this.u) return;
        const rows = this.u.tables.towers;
        const corona = Math.min(1.3, this.power * 0.95 + this.surge * 0.5);
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
                Math.min(1.4, corona + held * 0.14 + 0.05),
            );
        }
    }

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;

        // What gameplay kicked decays first, so a consequence that lands this frame starts whole.
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.kick *= Math.exp(-dt / 0.2);
        this.dip *= Math.exp(-dt / 0.4);
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

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.7, dt);
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.14 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 12, dt);
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
        const hurry = this.reducedMotion ? 0.3 : 1;
        const gust = 1 + (this.power * 1.6 + this.surge * 1.2) * hurry;
        this.driftX += STORM.drift[0] * dt * gust;
        this.driftZ += STORM.drift[2] * dt * gust;
        this.churn += dt * gust;
        this.rainClock += dt * (hush ? 0.05 : 1) * (1 + this.power * 0.3);
        const stormRate = hush ? 0 : 1 + (this.power * 6.5 + this.surge * 3) * hurry;
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
        if (this.bolts) this.holdChain();

        // ── Towers ──
        this.writeTowers();

        // ── Lightning, and the light it throws ──
        const lights = this.bolts ? this.bolts.update(t) : [];
        const { flashes } = u.tables;
        const eye = camera ? camera.position : this._rest.position;
        let vr = 0;
        let vg = 0;
        let vb = 0;
        for (let i = 0; i < FLASH_SLOTS; i++) {
            const light = lights[i];
            if (!light) break;
            const k = light.level * light.gain * (0.3 + 0.7 * this.breath) * (this.reducedMotion ? 0.6 : 1);
            flashes[i * 2].set(light.x, light.y, light.z, light.reach);
            flashes[i * 2 + 1].set(light.r * k, light.g * k, light.b * k, 0);
            const dx = light.x - eye.x;
            const dy = light.y - eye.y;
            const dz = light.z - eye.z;
            const fall = 1 / (1 + (dx * dx + dy * dy + dz * dz) / (light.reach * light.reach * 2.5));
            vr += light.r * k * fall;
            vg += light.g * k * fall;
            vb += light.b * k * fall;
        }
        u.flashCount.value = Math.min(FLASH_SLOTS, lights.length);
        u.veil.value.set(vr, vg, vb);

        // ── Uniforms ──
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.drift.value.set(this.driftX, 0, this.driftZ);
        u.churn.value = this.churn;
        u.rainClock.value = this.rainClock;
        u.rainLean.value.set(0.16 + this.power * 0.2 + this.surge * 0.12, 0.05 + this.power * 0.05);
        u.rainGain.value = 0.85 + this.power * 0.8 + this.surge * 0.5;
        u.twist.value.z = this.twist * TWIST_REACH * (this.reducedMotion ? 0.25 : 1);
        const p = this._palette;
        const lift = 1 + this.power * 0.18;
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
        post.flash = Math.min(1.5, veil * 0.5);
        post.kick = this.reducedMotion ? 0 : this.kick;
        post.bloomBoost = this.surge * 0.2;
        post.streak = Math.min(1, veil * 0.35 + this.surge * 0.2);
        // The iris closes on a stroke, so the cloud it lights keeps its shape.
        post.exposure = 1 / (1 + veil * 0.3 + this.surge * 0.25 + this.power * 0.12);
        const rippleAge = t - this.ripple.birth;
        post.ripple.x = this.ripple.x;
        post.ripple.y = this.ripple.y;
        post.ripple.radius = Math.max(0, rippleAge) * RIPPLE_SPEED;
        post.ripple.strength = rippleAge >= 0
            ? this.ripple.strength * Math.exp(-rippleAge / 0.8) * smooth(0, 0.1, rippleAge)
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
