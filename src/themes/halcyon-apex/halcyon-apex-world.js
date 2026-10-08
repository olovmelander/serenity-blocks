/**
 * Halcyon Apex — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig, the sun and its shadow
 * rig, and the choreography. Shared by the theme (halcyon-apex-theme.js) and the playground
 * effect (src/playground/effects/halcyon-apex.effect.js), so what is iterated there ships.
 *
 * The sanctuary runs on first light, and what the light fills, floats. The board plays it:
 *
 *   lock     the piece's light drops into the lagoon under the board (a ring that bends the
 *            mirror and runs the piece's colour through the net of light on the bed), and a wisp
 *            carries it to the head of a ley line: the causeway on the left, the dial on the
 *            right. From there it runs the line as a pulse, shard to shard, up the stair and into
 *            the Apex (or round the stones and up into the Halcyon), which keeps it.
 *   clear    the cleared rows leave the card as blades of light, and a wave runs out through the
 *            sanctuary, one front per line: the masonry flashes as it passes, the bed floods, and
 *            the two great crystals let go of everything they were holding.
 *   combo    the sanctuary lifts: pair by pair the ley shards rise off their plinths, the stones'
 *            crystals follow, drops of the lagoon bead up into the air, the splinters round the
 *            great crystals swing wider and faster, the clouds part.
 *   four     the sanctuary holds its breath — every light sinks for a fifth of a second — then a
 *            beacon stands on the Apex and on the Halcyon, a ring of light opens over the sky,
 *            and everything that floats is thrown up and comes down as rain.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the lagoon mirrors; 1 = what only the camera sees (wisps, row beams).
 */

import * as THREE from 'three/webgpu';
import { float, shadow } from 'three/tsl';
import {
    BEACON_LIFE,
    CLEAR_SLOTS,
    DEG,
    HALCYON_PALETTES,
    HOLD_FADE,
    HOLD_MAX,
    HUSH_HOLD,
    LEY_A,
    LEY_B,
    LIFT_MAX,
    LOCK_SLOTS,
    NOISE_SIZE,
    PALETTE_KEYS,
    PULSE_SLOTS,
    PULSE_SPEED,
    SITE,
    SUNFIRE,
    WISP_FLIGHT,
    approach,
    bakeNoise,
    clamp01,
    clearPassTime,
    compositionFor,
    createNoiseTexture,
    createSanctuaryUniforms,
    mulberry32,
    pieceColor,
    powerForCombo,
    siteToWorld,
} from './halcyon-apex-tsl.js';
import { GEM, buildPlan } from './halcyon-apex-plan.js';
import { tierFor } from './halcyon-apex-quality.js';
import { createSky } from './halcyon-apex-sky.js';
import { createStone } from './halcyon-apex-stone.js';
import { createCrystals } from './halcyon-apex-crystals.js';
import { createWater } from './halcyon-apex-water.js';
import { createTerrain } from './halcyon-apex-terrain.js';
import {
    createBeads, createBirds, createMotes, createUpfall,
} from './halcyon-apex-atmosphere.js';
import {
    createBeacons, createRowBeams, createSparks, createWisps,
} from './halcyon-apex-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './halcyon-apex-composition.js';

/** The rest camera: standing in the lagoon beside the causeway, a little above the water. */
export const REST_RIG = Object.freeze({
    height: 3.2,
    pitch: 5 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 80,
    minFov: 44,
    maxFov: 74,
    near: 0.5,
    far: 20000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.0;
/** The lowest the sun is ever hung (radians over the horizon). */
export const SUN_FLOOR = 6.5 * DEG;
/** Seconds a ring / a clear wave / a ley pulse stays in the sanctuary (the shaders skip their loops after). */
const RING_LIVE = 6;
const CLEAR_LIVE = 9;
const PULSE_LIVE = 4.5;
/** Pairs of ley shards (nearest first) that throw sparks as a clear's wave passes them. */
export const CHIME_PAIRS = 8;
/** Arrivals (a pulse reaching its crystal, a wave reaching one) the world keeps in flight. */
const ARRIVALS_MAX = 24;
/** Arrivals on one crystal closer together than this (seconds) are one arrival. */
const ARRIVAL_FOLD = 0.03;

const PARTS = [
    'sky', 'ranges', 'islets', 'flora', 'water', 'site', 'siteLey', 'dial', 'dialLey', 'crystals', 'halos',
    'upfall', 'beads', 'motes', 'birds', 'sparks', 'beacons', 'wisps', 'beams',
];

export class HalcyonApexWorld {
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
        this.plan = buildPlan(seed);
        this.root = new THREE.Group();
        this.root.name = 'HalcyonApex';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.reflection = null;
        this.sun = null;
        this.shadowNode = null;
        this.shadowFrames = 0;
        this.shadowWasEnabled = null;
        this.stone = null;
        this.crystals = null;
        this.sparks = null;
        this.wisps = null;
        this.beams = null;
        this.beacons = null;
        this.birds = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The sun on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.845, y: 0.35 };
        /** Crystals a wisp can be sent to, per ley line, nearest first. */
        this.targets = { a: [], b: [] };
        this.halcyon = [70, SITE.halcyon.height, -135];
        this.dialYaw = 0;
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._sunDir = new THREE.Vector3(0.48, 0.21, -0.85).normalize();
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._strike = { x: 0, z: -12 };
        this._from = [0, 0, 0];
        this._frame = {
            time: 0, lift: 0, spin: 0, halcyon: this.halcyon, dialYaw: 0, calm: 1,
        };
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...HALCYON_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart, flash: 0, kick: 0, shafts: 0.3, bloomBoost: 0, exposure: 1,
        };
        this.arrivals = [];
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.lift = 0;
        this.surge = 0;
        this.stir = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.twist = 0;
        this.breath = 1;
        this.hushUntil = -1;
        this.lockCursor = 0;
        this.clearCursor = 0;
        this.pulseCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        /** What the Apex [0] and the Halcyon [1] hold, and its colour. */
        this.held = [0, 0];
        this.heldColor = [[1, 1, 1], [1, 1, 1]];
        this.arrivals.length = 0;
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0, pulses: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.cloudDrift = time * motion;
        this.spin = time * 0.22 * motion;
        this.beadLift = time * 0.6 * motion;
        this.crystals?.reset();
        this.sparks?.reset();
        this.wisps?.reset();
        this.beams?.reset();
        this.beacons?.reset();
        this.birds?.reset();
        if (this.u) {
            for (let i = 0; i < LOCK_SLOTS; i++) this.u.lockA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
            for (let i = 0; i < PULSE_SLOTS; i++) this.u.pulseA[i].value.set(-100, 0, 0, 0);
            this.u.shock.value.set(-100, 0);
            this.u.beacon.value.set(-100, 0);
        }
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        this.textures.push(noise);
        const u = createSanctuaryUniforms({ noise });
        this.u = u;
        const { tier, plan } = this;
        u.apexPos.value.set(plan.apex[0], plan.apex[1], plan.apex[2]);
        u.gate.value.set(plan.gate[0], plan.gate[1], plan.gate[2], plan.gate[3]);

        // ── The sun and the one shadow map every surface reads ──
        if (tier.shadowMap > 0) {
            const sun = new THREE.DirectionalLight(0xffffff, 1);
            sun.name = 'HalcyonApexSun';
            sun.castShadow = true;
            sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
            sun.shadow.bias = -0.0006;
            sun.shadow.normalBias = 0.06;
            sun.shadow.radius = 1.6;
            sun.shadow.autoUpdate = false;
            sun.shadow.needsUpdate = true;
            this.sun = sun;
            this.shadowNode = shadow(sun);
            u.sunLit = float(this.shadowNode);
            this.root.add(sun, sun.target);
            if (this.renderer?.shadowMap) {
                this.shadowWasEnabled = this.renderer.shadowMap.enabled;
                this.renderer.shadowMap.enabled = true;
            }
        }

        this.addPart('sky', createSky(u, { decks: tier.decks, lit: tier.litClouds }));
        const terrain = createTerrain(u, plan, { segments: tier.ranges, seed: plan.seed });
        this.addPart('ranges', terrain.ranges);
        this.addPart('islets', terrain.islets);
        this.addPart('flora', terrain.flora);
        const water = createWater(u, {
            reflectionScale: tier.reflection, glitter: tier.glitter, bedDetail: tier.bedDetail, islets: terrain.shore,
        });
        this.addPart('water', water);
        if (water.reflectorTarget) this.root.add(water.reflectorTarget);
        this.reflection = water.reflection;

        this.stone = createStone(u, plan, { shimmer: tier.shimmer });
        this.addPart('site', this.stone.site);
        this.addPart('siteLey', this.stone.siteLey);
        this.addPart('dial', this.stone.dial);
        this.addPart('dialLey', this.stone.dialLey);
        const gems = createCrystals(u, plan, { dispersion: tier.dispersion });
        this.crystals = gems.crystals;
        this.addPart('crystals', gems.crystals);
        this.addPart('halos', gems.halos);

        this.addPart('upfall', createUpfall(u, tier.upfall));
        this.addPart('beads', createBeads(u, tier.beads));
        if (tier.motes > 0) this.addPart('motes', createMotes(u, tier.motes));
        if (tier.birds > 0) {
            this.birds = createBirds(u, tier.birds);
            this.addPart('birds', this.birds);
        }

        // ── Gameplay effects (pools, always drawn) ──
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);
        this.beacons = createBeacons(u);
        this.addPart('beacons', this.beacons);
        this.wisps = createWisps(u);
        this.addPart('wisps', this.wisps, { reflected: false });
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams, { reflected: false });

        this.applyPalette(1);
        this.composeSky();
        this.placeCrystals();
        this.findTargets();
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part, { reflected = true } = {}) {
        this.parts[name] = part;
        if (!reflected || part.reflected === false) part.mesh.layers.set(1);
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
            this.composeSky();
            this.placeCrystals();
            this.findTargets();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.composeSky();
            this.placeCrystals();
        }
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
        this.placeCrystals();
    }

    /** A new run: the sanctuary back at rest (the sky keeps turning). */
    resetSession() {
        const {
            time, cloudDrift, spin, beadLift,
        } = this;
        this.resetState(time);
        Object.assign(this, {
            cloudDrift, spin, beadLift,
        });
        this.applyPalette(1);
    }

    /**
     * The camera sees layer 1 (wisps, row beams); the lagoon's mirror must not. Called once the
     * camera that will render the world is known.
     */
    bindCamera(camera) {
        camera.layers.enable(1);
        if (this.reflection) {
            const mirror = this.reflection.reflector.getVirtualCamera(camera);
            mirror.layers.set(0);
        }
    }

    // ── The sun, and what hangs before it ───────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        const comp = compositionFor(this.aspect);
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, REST_RIG.height, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(-Math.sin(comp.yaw) * 10, REST_RIG.height + Math.tan(comp.pitch) * 10, -Math.cos(comp.yaw) * 10);
        cam.updateMatrixWorld();
        return cam;
    }

    /** The unit direction a screen point (fractions, y down) looks along from the rest camera. */
    restDirection(sx, sy, out) {
        const cam = this.restCamera();
        return out.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    }

    /**
     * Hang the sun where the composition wants it for this aspect, the Halcyon before it, the
     * dial under the Halcyon, and frame the shadow map round everything that casts.
     */
    composeSky() {
        const { u } = this;
        if (!u) return;
        const comp = compositionFor(this.aspect);
        const dir = this.restDirection(comp.sun.x, comp.sun.y, this._sunDir);
        if (dir.y < Math.sin(SUN_FLOOR)) {
            const flat = Math.hypot(dir.x, dir.z) || 1;
            const k = Math.cos(SUN_FLOOR) / flat;
            dir.set(dir.x * k, Math.sin(SUN_FLOOR), dir.z * k);
        }
        u.sunDir.value.copy(dir);
        // The Halcyon hangs a little left of the sun's bearing, never nearer the pyramid than
        // the open lagoon to the right of the causeway.
        const bearing = Math.max(8 * DEG, Math.atan2(dir.x, -dir.z) + SITE.halcyon.bearing);
        const d = SITE.halcyon.distance;
        this.halcyon[0] = Math.sin(bearing) * d;
        this.halcyon[1] = SITE.halcyon.height;
        this.halcyon[2] = -Math.cos(bearing) * d;
        u.halcyonPos.value.set(this.halcyon[0], this.halcyon[1], this.halcyon[2]);
        this.dialYaw = Math.atan2(-this.halcyon[0], -this.halcyon[2]);
        this.stone?.placeDial(this.halcyon[0], this.halcyon[2], this.dialYaw);
        this.frameShadows();
    }

    /** Aim the shadow camera so its box holds everything that casts a shadow. */
    frameShadows() {
        const { sun } = this;
        if (!sun) return;
        const dir = this._sunDir;
        const e1 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
        const e2 = new THREE.Vector3().crossVectors(dir, e1).normalize();
        const p = SITE.pyramid;
        const points = [];
        const push = (x, y, z) => points.push(new THREE.Vector3(x, y, z));
        const w = [0, 0];
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
            siteToWorld(sx * (p.half + 4), sz * (p.half + 4), w);
            push(w[0], 0, w[1]);
        });
        push(this.plan.apex[0], this.plan.apex[1] + SITE.apex.half + 8, this.plan.apex[2]);
        siteToWorld(-45, SITE.causeway.near, w);
        push(w[0], 36, w[1]);
        siteToWorld(45, SITE.causeway.near, w);
        push(w[0], 36, w[1]);
        siteToWorld(-8, SITE.causeway.far, w);
        push(w[0], 0, w[1]);
        siteToWorld(8, SITE.causeway.far, w);
        push(w[0], 8, w[1]);
        const r = SITE.dial.radius + 24;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => push(this.halcyon[0] + sx * r, 0, this.halcyon[2] + sz * r));
        push(this.halcyon[0], this.halcyon[1] + SITE.halcyon.half + 6, this.halcyon[2]);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        points.forEach((q) => {
            const a = q.dot(e1);
            const b = q.dot(e2);
            const c = q.dot(dir);
            x0 = Math.min(x0, a);
            x1 = Math.max(x1, a);
            y0 = Math.min(y0, b);
            y1 = Math.max(y1, b);
            z0 = Math.min(z0, c);
            z1 = Math.max(z1, c);
        });
        const centre = new THREE.Vector3()
            .addScaledVector(e1, (x0 + x1) / 2)
            .addScaledVector(e2, (y0 + y1) / 2)
            .addScaledVector(dir, (z0 + z1) / 2);
        const depth = (z1 - z0) + 900;
        sun.position.copy(centre).addScaledVector(dir, (z1 - z0) / 2 + 120);
        sun.target.position.copy(centre);
        const cam = sun.shadow.camera;
        cam.left = -(x1 - x0) / 2 - 6;
        cam.right = (x1 - x0) / 2 + 6;
        cam.top = (y1 - y0) / 2 + 6;
        cam.bottom = -(y1 - y0) / 2 - 6;
        cam.near = 1;
        cam.far = depth;
        cam.updateProjectionMatrix();
        sun.updateMatrixWorld(true);
        sun.target.updateMatrixWorld(true);
        sun.shadow.needsUpdate = true;
        this.shadowFrames = 0;
    }

    /** Put every crystal where the world's clocks say it is. */
    placeCrystals(delta = 0) {
        if (!this.crystals) return;
        const f = this._frame;
        f.time = this.time;
        f.delta = delta;
        f.lift = this.lift;
        f.spin = this.spin;
        f.halcyon = this.halcyon;
        f.dialYaw = this.dialYaw;
        f.calm = this.reducedMotion ? 0.3 : 1;
        this.crystals.place(f);
    }

    /**
     * Which crystals a wisp can be sent to: the ley shards (line A) and the dial's crystals
     * (line B) the rest camera sees clear of the card, nearest first.
     */
    findTargets() {
        const a = [];
        const b = [];
        if (this.crystals) {
            const cam = this.restCamera();
            const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
            const { gems } = this.crystals;
            for (let i = 0; i < gems.length; i++) {
                const g = gems[i];
                if (g.kind !== GEM.shard && g.kind !== GEM.dial) continue;
                const at = this.crystals.positionOf(i);
                this._vec.set(at[0], at[1], at[2]).project(cam);
                if (this._vec.z > 1 || Math.abs(this._vec.x) > 0.95 || Math.abs(this._vec.y) > 0.92) continue;
                const sx = this._vec.x * 0.5 + 0.5;
                if (sx > card.x0 - 0.012 && sx < card.x1 + 0.012) continue;
                const entry = { index: i, dist: Math.hypot(at[0], at[2]) };
                (g.kind === GEM.shard ? a : b).push(entry);
            }
            const byDist = (p, q) => p.dist - q.dist;
            a.sort(byDist);
            b.sort(byDist);
            // No line head on screen (an upright phone): fall back to each line's first crystal.
            if (!a.length) a.push({ index: gems.findIndex((g) => g.kind === GEM.shard) });
            if (!b.length) b.push({ index: gems.findIndex((g) => g.kind === GEM.dial) });
        }
        this.targets = { a: a.map((e) => e.index), b: b.map((e) => e.index) };
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const comp = compositionFor(this.aspect);
        const fov = fovForAspect(this.aspect) - this.kick * 0.7 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of someone standing in the lagoon, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.11) * 0.5 + Math.sin(t * 0.063 + 1.3) * 0.34) * calm;
        const swayY = (Math.sin(t * 0.17 + 0.7) * 0.07 + Math.sin(t * 0.079) * 0.05) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(swayX + px * 0.9, REST_RIG.height + swayY - py * 0.3 - this.kick * 0.06 * calm, 0);
        const yaw = comp.yaw - (Math.sin(t * 0.083 + 2.1) * 0.008 - px * 0.026) * calm;
        const pitch = comp.pitch + (Math.sin(t * 0.097) * 0.004 - py * 0.015) * calm;
        this._look.set(
            camera.position.x - Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            -Math.cos(yaw) * 10,
        );
        camera.up.set(Math.sin(t * 0.061) * 0.003 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
        // The sun on screen: where the shafts come from.
        this._ray.copy(this._sunDir).multiplyScalar(1000).add(camera.position).project(camera);
        this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
        this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
    }

    /**
     * Where a ray through a screen point (fractions, y down) meets the lagoon. Points above the
     * horizon (or absurdly far) land `far` metres ahead instead.
     */
    screenToLagoon(sx, sy, out = this._strike, far = 14) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0;
            out.z = -far;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : Infinity;
        const dist = Math.hypot(this._ray.x, this._ray.z) * t;
        if (!Number.isFinite(dist) || dist > 80) {
            const flat = Math.hypot(this._ray.x, this._ray.z) || 1;
            out.x = camera.position.x + (this._ray.x / flat) * far;
            out.z = camera.position.z + (this._ray.z / flat) * far;
            return out;
        }
        out.x = camera.position.x + this._ray.x * t;
        out.z = camera.position.z + this._ray.z * t;
        return out;
    }

    /** The world point `depth` metres along the ray through a screen point. */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = REST_RIG.height;
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

    /** Send a ring out over the lagoon from (x, z) at `time`; `reach` is a fraction of RING_REACH. */
    ring(x, z, time, strength, rgb, reach = 1) {
        const slot = this.lockCursor % LOCK_SLOTS;
        this.lockCursor += 1;
        this.u.lockA[slot].value.set(x, z, time, strength);
        this.u.lockC[slot].value.set(rgb[0] * 1.4, rgb[1] * 1.4, rgb[2] * 1.4, reach);
    }

    /**
     * Something that happens later on the world clock. The queue is kept in time order. What
     * would land on the same crystal at the same moment is folded into what is already queued
     * (a flood of locks is a handful of arrivals), and a full queue refuses what comes after.
     */
    schedule(entry) {
        const { arrivals } = this;
        for (let k = 0; k < arrivals.length; k++) {
            const queued = arrivals[k];
            if (queued.kind !== entry.kind || queued.line !== entry.line || Math.abs(queued.time - entry.time) > ARRIVAL_FOLD) continue;
            if (entry.kind === 'hold') {
                queued.amount = Math.min(HOLD_MAX, queued.amount + entry.amount);
                queued.rgb = entry.rgb;
            } else {
                queued.amount = Math.max(queued.amount, entry.amount);
                queued.quad = queued.quad || entry.quad;
            }
            return;
        }
        if (arrivals.length >= ARRIVALS_MAX) return;
        let i = arrivals.length;
        while (i > 0 && arrivals[i - 1].time > entry.time) i -= 1;
        arrivals.splice(i, 0, entry);
    }

    /**
     * Send a pulse up ley line `line` (0 = the causeway, 1 = the dial) so that its packet is at
     * arc length `s0` at `time`. Its crystal keeps the light when the pulse arrives.
     */
    sendPulse(line, s0, time, rgb, strength) {
        const slot = this.pulseCursor % PULSE_SLOTS;
        this.pulseCursor += 1;
        const birth = time - s0 / PULSE_SPEED;
        this.u.pulseA[slot].value.set(birth, line, strength, 0);
        this.u.pulseC[slot].value.set(rgb[0], rgb[1], rgb[2]);
        const length = line === 0 ? LEY_A.length : LEY_B.length;
        this.schedule({
            kind: 'hold', time: birth + length / PULSE_SPEED, line, rgb, amount: strength,
        });
        this.counts.pulses += 1;
        return birth;
    }

    /** Send one wisp from a world point into crystal `index`. Returns its arrival time. */
    sendWisp(index, from, rgb, amount) {
        const to = this.crystals.positionOf(index);
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const flight = this.reducedMotion ? 0.12 : WISP_FLIGHT * (0.7 + Math.min(1.5, dist / 30));
        const arrive = this.time + flight;
        this.wisps.launch({
            from,
            to,
            rgb,
            time: this.time,
            flight,
            lift: 0.5 + dist * 0.06,
            size: 0.2 + amount * 0.14,
            bow: (to[0] < from[0] ? -1 : 1) * dist * 0.04,
        });
        const share = this.sparks.count / 512;
        this.sparks.emit({
            x: to[0],
            y: to[1],
            z: to[2],
            n: Math.round((8 + 12 * amount) * share),
            rgb,
            time: arrive,
            out: [0.4, 2.0 + amount * 1.8],
            up: [0.4, 2.6 + amount * 1.4],
            size: 0.03 + dist * 0.0016,
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
        const { u: uniforms } = this;
        if (!uniforms || !this.crystals) return;
        const rgb = pieceColor(color);
        // ── The ring: the piece's light drops into the lagoon under the foot of the board ──
        let fx = 0.5;
        let fy = 0.94;
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            fx = screen.x;
            fy = Math.max(screen.y, 0.72);
            wx = screen.x;
            wy = screen.y;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                fx = this._point.x;
                fy = Math.max(board.y1, 0.74);
                // The wisp leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        const strike = this.screenToLagoon(fx, fy);
        this.ring(strike.x, strike.z, this.time, hardDrop ? 1.3 : 0.8, rgb, hardDrop ? 1.2 : 1);
        const share = this.sparks.count / 512;
        if (hardDrop) {
            // A crown of spray where it struck.
            this.sparks.emit({
                x: strike.x,
                y: 0.08,
                z: strike.z,
                n: Math.round(70 * share),
                rgb: [rgb[0] * 0.6 + 0.4, rgb[1] * 0.6 + 0.4, rgb[2] * 0.6 + 0.4],
                time: this.time,
                out: [1.4, 3.6],
                up: [2.6, 6.6],
                life: [0.7, 1.4],
                size: 0.075,
            });
        }

        // ── The wisp carries it to the head of a ley line, and the line takes it from there ──
        const line = side < 0 ? 0 : 1;
        const list = line === 0 ? this.targets.a : this.targets.b;
        if (list.length) {
            const pick = mulberry32(0x2b7 + (this.counts.locks + 1) * 2654435761)();
            const index = list[Math.min(list.length - 1, Math.floor(pick ** 2.4 * Math.min(list.length, 3)))];
            const from = this.screenToWorld(wx, wy, 7);
            const amount = hardDrop ? 1.3 : 0.85;
            const arrive = this.sendWisp(index, from, rgb, amount);
            const s0 = this.crystals.gems[index].s;
            this.sendPulse(line, s0, arrive, rgb, amount);
            // A hard drop sends a second packet on the heels of the first.
            if (hardDrop) this.sendPulse(line, s0, arrive + 0.14, [rgb[0] * 0.5 + 0.5, rgb[1] * 0.5 + 0.5, rgb[2] * 0.5 + 0.5], 0.7);
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
        // One line answers in the ley's light, two in the crystal's, three in both at once.
        let rgb;
        if (quad) rgb = [...SUNFIRE];
        else if (n === 1) rgb = [...p.ley];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.crystal[c] * 0.7 + p.glow[c] * 0.45);
        else rgb = [0, 1, 2].map((c) => p.ley[c] * 0.6 + p.glow[c] * 0.6 + 0.15);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        const strength = Math.min(1.5, 0.62 + 0.14 * n + (quad ? 0.25 : 0));
        const birth = quad ? this.time + HUSH_HOLD : this.time;

        // ── The wave leaves the foot of the board ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const heart = screen
            ? this.screenToLagoon(screen.x, Math.max(screen.y, 0.72))
            : this.screenToLagoon(board ? (board.x0 + board.x1) * 0.5 : 0.5, board ? Math.max(board.y1, 0.74) : 0.94);
        const slot = this.clearCursor % CLEAR_SLOTS;
        this.clearCursor += 1;
        uniforms.clearH[slot].value.set(heart.x, heart.z);
        uniforms.clearA[slot].value.set(birth, perfect ? 4 : n, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        this.lastClear = { time: birth, lines: n };

        // ── The two great crystals let go of what they hold as the wave reaches them ──
        const { apex } = this.plan;
        [[apex[0], apex[2]], [this.halcyon[0], this.halcyon[2]]].forEach(([hx, hz], line) => {
            this.schedule({
                kind: 'release', time: birth + clearPassTime(Math.hypot(hx - heart.x, hz - heart.z)), line, rgb, amount: strength, quad,
            });
        });
        this.stir = Math.max(this.stir, Math.min(1.4, 0.3 + 0.16 * n + (quad ? 0.4 : 0)));
        this.pendingKick = { time: birth + 0.12, amount: 0.22 + 0.1 * n };

        // ── Every crystal on the lines rings as the wave passes it ──
        const share = this.sparks.count / 512;
        const { gems } = this.crystals;
        for (let i = 0; i < gems.length; i++) {
            const g = gems[i];
            // Every stone's crystal, and the nearest pairs of shards (the far ones are specks).
            if (g.kind !== GEM.dial && !(g.kind === GEM.shard && g.index < CHIME_PAIRS)) continue;
            const at = this.crystals.positionOf(i);
            this.sparks.emit({
                x: at[0],
                y: at[1],
                z: at[2],
                n: Math.max(1, Math.round((quad ? 6 : 3) * share)),
                rgb,
                time: birth + clearPassTime(Math.hypot(at[0] - heart.x, at[2] - heart.z)),
                out: [0.5, 2.6],
                up: [1.2, 4.2],
                life: [0.7, 1.5],
                size: 0.05 + g.half * 0.02,
            });
        }

        // ── The cleared rows leave the card as blades of light ──
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
        }

        if (quad) {
            // The sanctuary holds its breath, then everything fires.
            this.hushUntil = this.time + HUSH_HOLD;
            this.surge = perfect ? 1.3 : 1;
            uniforms.shock.value.set(birth, this.reducedMotion ? 0.5 : 1);
            uniforms.beacon.value.set(birth, perfect ? 1.3 : 1);
            this.birds?.scatter(birth);
            this.counts.quads += 1;
        }
        if (tspin) {
            // Everything that floats turns on its axis.
            this.twist = 1;
            this.stir = Math.max(this.stir, 0.9);
            this.ring(heart.x, heart.z, this.time, 0.9, rgb, 0.7);
            this.ring(heart.x, heart.z, this.time + 0.16, 0.7, rgb, 0.45);
        }
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the sanctuary lets its breath go, and what it lifted comes down.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.24);
        this.combo = n;
    }

    /** A new level: the hour changes. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % HALCYON_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.stir = Math.max(this.stir, 0.8);
            this.flash = Math.max(this.flash, 0.14);
            this.u?.shock.value.set(this.time, 0.4);
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = HALCYON_PALETTES[this.paletteIndex];
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] += (target[key][c] - p[key][c]) * k;
        }
    }

    /** Resolve everything whose moment has come. */
    resolveArrivals(t) {
        const { arrivals } = this;
        for (let i = 0; i < arrivals.length;) {
            const a = arrivals[i];
            if (a.time > t) {
                i += 1;
                continue;
            }
            arrivals.splice(i, 1);
            const where = a.line === 0 ? this.plan.apex : this.halcyon;
            const share = this.sparks ? this.sparks.count / 512 : 0;
            if (a.kind === 'hold') {
                // The crystal keeps the pulse: its colour leans to the newest light it took.
                const had = this.held[a.line];
                const now = Math.min(HOLD_MAX, had + a.amount);
                const mixK = a.amount / Math.max(now, 1e-3);
                const c = this.heldColor[a.line];
                for (let k = 0; k < 3; k++) c[k] += (a.rgb[k] - c[k]) * Math.min(1, mixK * 1.4);
                this.held[a.line] = now;
                this.sparks?.emit({
                    x: where[0], y: where[1], z: where[2], n: Math.round(10 * share), rgb: a.rgb, time: a.time, out: [1.5, 7], up: [-1, 5], life: [0.8, 1.7], size: 0.3,
                });
            } else if (a.kind === 'release') {
                const had = this.held[a.line];
                this.held[a.line] = 0;
                const c = this.heldColor[a.line];
                const rgb = had > 0.2 ? [c[0] * 0.6 + a.rgb[0] * 0.4, c[1] * 0.6 + a.rgb[1] * 0.4, c[2] * 0.6 + a.rgb[2] * 0.4] : a.rgb;
                this.sparks?.emit({
                    x: where[0],
                    y: where[1],
                    z: where[2],
                    n: Math.round((14 + had * 10 + (a.quad ? 40 : 0)) * share),
                    rgb,
                    time: a.time,
                    out: [3, 13 + had * 2],
                    up: [0, 11],
                    life: [1.2, 2.6],
                    size: 0.36,
                });
                this.stir = Math.max(this.stir, Math.min(1.4, 0.4 + had * 0.12));
            }
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;
        this.resolveArrivals(t);

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        const liftTarget = Math.min(LIFT_MAX, this.combo);
        this.lift += (liftTarget - this.lift) * approach(liftTarget > this.lift ? 2.6 : 1.1, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.stir *= Math.exp(-dt / 1.7);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.twist *= Math.exp(-dt / 0.7);
        const fade = Math.exp(-dt / HOLD_FADE);
        this.held[0] *= fade;
        this.held[1] *= fade;
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.5);
            this.pendingKick.time = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.15 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(0.8, dt));

        // ── The slow clocks ──
        // Under reduced motion the sky and the crystals keep their own slow pace whatever the board
        // does; the beads still answer a chain (they are its feedback, and they are small).
        const still = this.reducedMotion ? 0 : 1;
        this.cloudDrift += dt * motion * (1 + (this.power * 2.5 + this.stir * 3 + this.surge * 5) * still);
        this.spin += dt * motion * (0.22 + (this.power * 1.5 + this.stir * 0.8 + this.surge * 3 + this.twist * 7) * still);
        this.beadLift += dt * motion * (0.6 + this.power * 2.6 + this.surge * 4 + this.stir * 0.8);
        this.placeCrystals(dt);

        // ── Uniforms ──
        let ringsLive = 0;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            if (t - u.lockA[i].value.z < RING_LIVE) ringsLive = 1;
        }
        let clearLive = 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            if (t - u.clearA[i].value.x < CLEAR_LIVE) clearLive = 1;
        }
        let pulsesLive = 0;
        for (let i = 0; i < PULSE_SLOTS; i++) {
            if (t - u.pulseA[i].value.x < PULSE_LIVE) pulsesLive = 1;
        }
        u.ringsLive.value = ringsLive;
        u.clearLive.value = clearLive;
        u.pulsesLive.value = pulsesLive;
        u.time.value = t;
        u.power.value = this.power;
        u.lift.value = this.lift;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.cloudDrift.value = this.cloudDrift;
        u.spin.value = this.spin;
        u.beadLift.value = this.beadLift;
        u.held.value.set(this.held[0], this.held[1], 0, 0);
        u.heldA.value.set(this.heldColor[0][0], this.heldColor[0][1], this.heldColor[0][2]);
        u.heldB.value.set(this.heldColor[1][0], this.heldColor[1][1], this.heldColor[1][2]);
        const p = this._palette;
        const heat = clamp01(this.surge * 0.5);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            node.value.set(
                (c[0] + (SUNFIRE[0] - c[0]) * heat) * gain,
                (c[1] + (SUNFIRE[1] - c[1]) * heat) * gain,
                (c[2] + (SUNFIRE[2] - c[2]) * heat) * gain,
            );
        };
        const plain = (key, node, gain = 1) => node.value.set(p[key][0] * gain, p[key][1] * gain, p[key][2] * gain);
        plain('sun', u.sun, 1 + this.power * 0.12);
        plain('zenith', u.zenith);
        plain('horizon', u.horizon, 1 + this.power * 0.1);
        plain('glow', u.glow, 1 + this.power * 0.25 + this.stir * 0.1);
        plain('rose', u.rose);
        plain('cloud', u.cloud);
        plain('cloudShade', u.cloudShade);
        plain('shallow', u.shallow);
        plain('deep', u.deep);
        plain('stone', u.stone);
        warm('crystal', u.crystal);
        warm('ley', u.ley);

        const sky = this.parts.sky?.mesh;
        if (sky && camera) {
            sky.position.copy(camera.position);
            sky.updateMatrix();
            sky.updateMatrixWorld(true);
        }

        // ── The shadow map: redrawn over the first frames (pipelines may still be compiling),
        //    then as often as the tier allows (the crystals drift). ──
        if (this.sun) {
            this.shadowFrames += 1;
            const every = this.tier.shadowEvery;
            if (this.shadowFrames < 10 || this.shadowFrames === 45 || this.shadowFrames === 150
                || (every > 0 && this.shadowFrames % every === 0)) this.sun.shadow.needsUpdate = true;
        }

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const sinceBeacon = t - u.beacon.value.x;
        const blaze = sinceBeacon >= 0 && sinceBeacon < BEACON_LIFE ? Math.exp(-sinceBeacon / 1.1) * u.beacon.value.y : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.shafts = hush ? 0.06 : 0.42 + this.power * 0.2 + swell * 0.25 + blaze * 0.3;
        post.bloomBoost = this.surge * 0.1 + swell * 0.1;
        // The iris closes as the sanctuary flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 0.85 + swell * 0.35 + this.power * 0.14 + this.stir * 0.08);
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
            lift: this.lift,
            surge: this.surge,
            stir: this.stir,
            breath: this.breath,
            level: this.level,
            palette: HALCYON_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            held: [...this.held],
            arrivals: this.arrivals.length,
            crystals: this.crystals ? this.crystals.count : 0,
            targets: { a: this.targets.a.length, b: this.targets.b.length },
            masonry: this.stone ? this.stone.triangles : 0,
            sparks: this.sparks ? this.sparks.count : 0,
            beads: this.parts.beads ? this.parts.beads.count : 0,
            reflection: this.tier.reflection,
            shadowMap: this.tier.shadowMap,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            sun: [this._sunDir.x, this._sunDir.y, this._sunDir.z],
            halcyon: [...this.halcyon],
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
        this.reflection?.dispose?.();
        this.textures.forEach((t) => t.dispose());
        if (this.sun) {
            this.shadowNode?.dispose?.();
            this.sun.dispose?.();
        }
        if (this.renderer?.shadowMap && this.shadowWasEnabled !== null) {
            this.renderer.shadowMap.enabled = this.shadowWasEnabled;
        }
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.reflection = null;
        this.sun = null;
        this.shadowNode = null;
        this.stone = null;
        this.crystals = null;
        this.sparks = null;
        this.wisps = null;
        this.beams = null;
        this.beacons = null;
        this.birds = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as HALCYON_APEX_PARTS };
