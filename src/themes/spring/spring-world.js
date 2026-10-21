/**
 * Spring — one shared world (the theme and the playground mount the same one).
 *
 * A Norrland river in its spring flood, seen from a flowering granite knoll at the outside of a
 * bend: the fall up to the left pouring over its granite step into the plunge pool at the head
 * of a short gorge, the rapids coming down to the knoll, the river swinging round under it and
 * away down the valley to the right through spruce and birch toward the snow-patched fells; and
 * everything gameplay does to them:
 *
 *   lock          a patch of the piece's own flower bursts into bloom on the knoll where it
 *                 landed, opening outward from the spot (a splash where it lands on the water)
 *   clear         one surge of white water down the rapids from the pool, the bigger the more
 *                 lines; the whole knoll flushes into bloom
 *   chain         the spring flood rises with each link: the river swells, runs whiter and faster
 *                 and the fall's mist thickens; when the chain breaks it falls back
 *   four lines    the great surge, and the last of the winter's ice goes out on it
 *   T-spin        the pool turns in a whirl where it drains
 *   back-to-back  the river glitters while the run lasts
 *   perfect       two surges, and whooper swans come over the valley
 *   level up      the day steps a station forward (it also turns with the clock alone); cranes pass
 *   game over     the light falls to dusk; it comes back with the next run
 *
 * and the air over it all (spring-air.js, spring-motes.js): willow down and pollen drift on the
 * breeze; a lock shakes the piece's own pollen out of its patch and puffs the air round it; a
 * clear lifts pollen and down off the knoll in the cleared rows' colours and sends a breath out
 * across the valley; each link of a chain spins up a little whirlwind beside the card, the air
 * thickens and two gyres turn it, and a broken chain lets its down go; a T-spin whirls too; back-
 * to-back strikes glints off the river; a level up sends willow down drifting over from upwind;
 * a perfect clear stills the air and showers it gold.
 *
 * Lifecycle: `await SpringWorld.prepare(quality, { signal })` reads the valley's baked ground and
 * the authored trees and granite (once a session; none depend on the tier); `new SpringWorld({
 * ..., prepared }).build()` makes the scene objects; each frame `updateCamera` → `update` →
 * `prerender(renderer)` → the post renders.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { drainSteps } from '../shared/build-steps.js';
import {
    DEG, PIECE_COLORS, TAU, TIMING, approach, clamp, hexToLinear, mulberry32, smooth,
} from './spring-core.js';
import {
    EYE, RIG, S_POOL, levelAt, pointAt, riverNearest, rigFor,
} from './spring-plan.js';
import { bakeTerrain, groundHeight, waterEdge } from './spring-terrain.js';
import {
    HOURS, HourWheel, blendLight, copyLight, createLight, lightAt,
} from './spring-hours.js';
import { tierFor } from './spring-quality.js';
import {
    EVENT_ROWS, PALETTE_ROWS, PATCHES, SURGES, createLatticeTexture, createNoiseTexture, createUniforms,
} from './spring-tsl.js';
import { SPRING_FLOWERS, springFlowerSlotForPiece } from './spring-flowers.js';
import { SpringMeadow } from './spring-meadow.js';
import { createLand } from './spring-land.js';
import { WHIRL, WHIRL_CENTRE_AT, createRiver } from './spring-river.js';
import { createPour, createStepFace } from './spring-fall.js';
import { createRocks } from './spring-rocks.js';
import { SpringForest } from './spring-forest.js';
import { createWoods } from './spring-woods.js';
import { ImpostorAtlas } from './spring-impostors.js';
import { loadSpringAssets, loadSpringValley } from './spring-assets.js';
import { createSky } from './spring-sky.js';
import { createCumulus } from './spring-cumulus.js';
import { MOTE_KIND, Motes } from './spring-motes.js';
import { AIR, SpringAir } from './spring-air.js';
import { Mist } from './spring-mist.js';
import { Floes } from './spring-floes.js';
import { Flights } from './spring-flights.js';
import { cardUnion, fallbackLayout } from './spring-composition.js';

export const SPRING_PARTS = Object.freeze(['land', 'river', 'rocks', 'trees', 'woods', 'meadow', 'fx', 'sky']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'releases', 'b2bSteps',
    'levelUps', 'gameOvers', 'mornings',
];
/** How long ago (s) an event row's moment was (Infinity before it). */
const time0 = (now, born) => (now >= born ? now - born : Infinity);
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'flood', 'foamBoost', 'flowClock', 'perfectAt', 'duskFrom', 'duskTarget',
    'duskAt', 'gloryShown', 'surgeCursor', 'patchCursor', 'lastLockAt', 'levelUpAt', 'clearAt', 'clearPower',
    'airClock', 'airGyre', 'stir', 'airWaveAt', 'airWavePower', 'burstSide', 'lastLockU',
]);

/**
 * A lock's patch of bloom: how wide it opens (radius m, wider for a hard drop) and how far, and
 * how far from the eye it blooms on the knoll when the lock landed on the water (m).
 */
export const BLOOM_PATCH = Object.freeze({
    radius: 3.2, hardRadius: 5, soft: 0.85, hard: 1, onKnoll: 8.5,
});
/** Four lines: how many floes the ice going out sends down the river. */
export const ICE_OUT = Object.freeze({ floes: 24 });
/** A line clear's flush of bloom over the whole knoll: rise, hold and fall (s). */
export const FLUSH = Object.freeze({ rise: 0.6, hold: 2.2, fall: 3.5 });

/**
 * The air (spring-air.js): how much faster a full chain runs it down the breeze, how fast its gyres
 * turn at a full chain (rad/s), the chain that stirs it fully (links), its pace under reduced
 * motion, and a clear's breath (its speed m/s; its power per line, from `wave`).
 */
export const AIR_MOTION = Object.freeze({
    hurry: 1.3, gyre: 0.45, fullChain: 8, reduced: 0.4, waveSpeed: 11, wave: 0.45, wavePerLine: 0.18,
});
/** A perfect clear's still, golden air: in, held, out (s from the clear). */
export const STILL = Object.freeze({ rise: 2.5, hold: 10, fall: 18 });
/** Linear RGB of each piece code (the meadow's flowers). */
const PIECE_RGB = PIECE_COLORS.map((hex) => hexToLinear(hex));
const GOLD = Object.freeze([1.0, 0.8, 0.42]);
const DOWN_WHITE = Object.freeze([1.0, 0.98, 0.94]);

/** The flood: how high each link of a chain lifts the river (m), and the most it rises. */
export const FLOOD = Object.freeze({
    perLink: 0.14, most: 0.9, foamPerLink: 0.09, foamMost: 0.6,
});

let BAKED = null;
/**
 * The valley's ground, the same for every tier: the shipped bake once it has been read
 * (SpringWorld.prepare), else baked here (unit tests, a failed read).
 */
export function valleyGround() {
    if (!BAKED) BAKED = bakeTerrain();
    return BAKED;
}

/** Hand the world an already decoded valley (tools and tests that read the asset themselves). */
export function useValleyGround(baked) {
    if (baked?.near?.h && baked.mid?.h && baked.far?.h) BAKED = baked;
}

function prepareData(quality, assets = null) {
    return { quality, ground: valleyGround(), assets };
}

export class SpringWorld {
    /**
     * Read the valley's baked ground and load the trees and the granite (once a session each),
     * yielding to the page first.
     */
    static async prepare(quality = 'High', { signal } = {}) {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const [assets, ground] = await Promise.all([
            loadSpringAssets({ signal }).catch((error) => {
                if (error?.name === 'AbortError') throw error;
                console.warn('[Spring] The trees and the granite could not be loaded; the valley goes without.', error);
                return null;
            }),
            loadSpringValley({ signal }).catch((error) => {
                if (error?.name === 'AbortError') throw error;
                console.warn('[Spring] The baked valley could not be read; baking it here.', error);
                return null;
            }),
        ]);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (ground && !BAKED) BAKED = ground;
        const prepared = prepareData(quality, assets);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return prepared;
    }

    /** The same, synchronously (unit tests). */
    static prepareSync(quality = 'High') {
        return prepareData(quality);
    }

    constructor({
        scene, quality = 'High', capture = false, seed = 0x5b12, prepared = null, samples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.prepared = prepared;
        this.samples = samples;
        this.root = new THREE.Group();
        this.root.name = 'Spring';
        this.parts = {};
        this.partList = [];
        this.u = createUniforms();
        // The palette: the seven flowers' colours (linear).
        const linear = new THREE.Color();
        SPRING_FLOWERS.forEach((flower, k) => {
            linear.setHex(flower.petal);
            this.u.tables.palette[PALETTE_ROWS.colour + k].set(linear.r, linear.g, linear.b, 0);
        });
        this.wheel = new HourWheel();
        this.light = createLight();
        this._hourLight = createLight();
        this._duskLight = lightAt(3.55);
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this.reducedMotion = false;
        this.disposed = false;
        this._camera = null;
        this._ray = new THREE.Vector3();
        this._sunScreen = new THREE.Vector3();
        this._sunWorld = new THREE.Vector3();
        this._hit = {
            x: 0, y: 0, z: 0, distance: 0,
        };
        this._near = {};
        this._edge = {};
        this._post = {
            exposure: 1,
            bloomBoost: 0,
            sun: {
                x: 0.2, y: 0.2, onScreen: 0, strength: 0,
            },
            shaftColour: [1, 0.9, 0.75],
            flash: 0,
            flashColour: [1, 0.95, 0.85],
            saturation: 1.1,
        };
        this.overrides = { hour: null };
        this.ground = null;
        this.placeGyres();
        this.resetState(0);
    }

    resetState(time) {
        this.time = time;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.counts = emptyCounts();
        this.wheel.reset();
        this.flood = 0;
        this.foamBoost = 0;
        this.flowClock = time;
        this.perfectAt = -1e6;
        this.duskFrom = 0;
        this.duskTarget = 0;
        this.duskAt = -1e6;
        this.dusk = 0;
        this.gloryShown = 0;
        this.surgeCursor = 0;
        this.patchCursor = 0;
        this.lastLockAt = -1e6;
        this.levelUpAt = -1e6;
        this.clearAt = -1e6;
        this.clearPower = 0;
        this.airClock = time;
        this.airGyre = 0;
        this.stir = 0;
        this.airWaveAt = -1e6;
        this.airWavePower = 0;
        this.burstSide = 1;
        this.lastLockU = 0.5;
        this.lastRgb = [...GOLD];
        const { events } = this.u.tables;
        for (let k = 0; k < SURGES; k++) events[EVENT_ROWS.surge + k].set(-1e6, 0, 0, 0);
        for (let k = 0; k < PATCHES; k++) {
            events[EVENT_ROWS.patch + k * 2].set(0, 0, -1e6, 0);
            events[EVENT_ROWS.patch + k * 2 + 1].set(-1, 1, 0, 0);
        }
        this.u.whirl.value.set(-1e6, 0);
        this.random = mulberry32(this.seed ^ 0x51ab);
        this.parts?.fx?.reset?.();
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /** The build as steps, a part to a step (shared/build-steps.js breathes between them). */
    * buildSteps() {
        if (this.root.parent) return;
        const prepared = this.prepared || SpringWorld.prepareSync(this.quality);
        this.prepared = null;
        this.ground = prepared.ground;
        const { tier } = this;
        this.textures = {
            noise: createNoiseTexture(),
            lattice: createLatticeTexture(),
        };
        // The ground, and the granite step the river falls over (its own sheer face).
        const land = createLand(this.u, this.textures, tier, this.ground);
        const face = createStepFace(this.u, this.textures, tier, this.ground);
        this.addPart('land', {
            mesh: land.mesh,
            meshes: [land.mesh, face.mesh],
            dispose: () => {
                land.dispose();
                face.dispose();
            },
        });
        yield 'land';
        // The river's surface, and the fall's water pouring over the step.
        const river = createRiver(this.u, this.textures, tier, this.ground);
        const pour = createPour(this.u, this.textures, tier);
        this.addPart('river', {
            mesh: river.mesh,
            meshes: [river.mesh, pour.mesh],
            dispose: () => {
                river.dispose();
                pour.dispose();
            },
        });
        yield 'river';
        this.addPart('rocks', createRocks(this.u, this.textures, prepared.assets, this.ground, tier));
        yield 'rocks';
        if (prepared.assets) {
            const forest = new SpringForest(this.u, this.textures, prepared.assets, tier).build(this.ground);
            this.forest = forest;
            this.addPart('trees', {
                mesh: forest.group, meshes: [forest.group], stats: forest.stats, dispose: () => forest.dispose(),
            });
        } else {
            this.addPart('trees', { mesh: null, meshes: [], dispose() {} });
        }
        yield 'trees';
        // The woods: cards of the modelled trees, from an atlas bakeImpostors() draws once (the
        // simple trees when the models could not be loaded).
        this.impostors = prepared.assets
            ? new ImpostorAtlas(this.u, this.textures, prepared.assets, { cellPixels: tier.impostorCell ?? 256 })
            : null;
        const woods = createWoods(this.u, this.textures, tier, this.ground, {
            atlas: this.impostors, samples: this.samples,
        });
        this.addPart('woods', {
            ...woods,
            dispose: () => {
                woods.dispose();
                this.impostors?.dispose();
                this.impostors = null;
            },
        });
        yield 'woods';
        const meadow = new SpringMeadow(this.u, this.textures, tier, this.ground);
        yield* meadow.buildSteps();
        this.meadow = meadow;
        this.addPart('meadow', {
            mesh: meadow.group, meshes: [meadow.group], stats: meadow.stats, dispose: () => meadow.dispose(),
        });
        yield 'meadow';
        // The effects: the fall's mist, the air's down and pollen, what gameplay throws into the air,
        // the ice going out, birds.
        this.motes = new Motes(this.u, tier.motes);
        this.air = new SpringAir(this.u, tier.air);
        // Bursts are sized to the tier's ring of motes (gently: a burst must still read on Minimal),
        // so a busy moment does not eat its own start.
        this.burstScale = clamp(Math.sqrt(tier.motes / 1280), 0.55, 1.35);
        this.mist = new Mist(this.u, this.textures, tier.mist);
        this.floes = new Floes(this.u, tier.floes);
        this.flights = new Flights(this.u);
        this.addPart('fx', {
            mesh: this.motes.mesh,
            meshes: [this.mist.mesh, this.air.mesh, this.motes.mesh, this.floes.mesh, ...this.flights.meshes],
            reset: () => {
                this.motes.clear();
                this.floes.clear();
                this.flights.clear();
            },
            dispose: () => {
                this.motes.dispose();
                this.air.dispose();
                this.mist.dispose();
                this.floes.dispose();
                this.flights.dispose();
            },
        });
        yield 'fx';
        const sky = createSky(this.u, this.textures, tier);
        const banks = createCumulus(this.u, this.textures, tier, tier.banks);
        this.addPart('sky', {
            mesh: sky.mesh,
            meshes: [sky.mesh, banks.mesh],
            dispose: () => {
                sky.dispose();
                banks.dispose();
            },
        });
        this.scene.add(this.root);
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.partList.push(part);
        const meshes = part.meshes || [part.mesh];
        for (const mesh of meshes) if (mesh) this.root.add(mesh);
    }

    showOnlyParts(names) {
        const keep = new Set(names);
        for (const name of Object.keys(this.parts)) {
            const part = this.parts[name];
            for (const mesh of part.meshes || [part.mesh]) if (mesh) mesh.visible = keep.has(name);
        }
    }

    bindCamera(camera) { this._camera = camera; }

    setReducedMotion(value) { this.reducedMotion = value === true; }

    setCaptureOverrides(overrides) { Object.assign(this.overrides, overrides); }

    setViewport(width, height, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.u.aspect.value = this.aspect;
        this.viewportHeight = Math.max(1, height);
        if (!this.layoutLive) this.layout = fallbackLayout(width, height);
        this.placeGyres();
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(1920, 1920 / Math.max(0.2, this.aspect));
        this.placeGyres();
    }

    /**
     * Where the chain's gyres (and its whirlwinds) stand: on the knoll's top in the middle of the
     * free strip left of the card and right of it (or of the HUD beside it), at the lens at rest.
     */
    placeGyres() {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const { hud } = this.layout;
        const rightEdge = hud && hud.x0 > card.x1 && hud.x0 - card.x1 < 0.1 ? hud.x1 : card.x1;
        const rig = rigFor(this.aspect);
        const across = Math.tan((rig.fov * DEG) / 2) * this.aspect;
        const bearingAt = (sx) => rig.yaw + Math.atan((sx * 2 - 1) * across) / DEG;
        const left = pointAt(bearingAt(Math.max(0.03, card.x0 * 0.45)), AIR.gyre.distance);
        const right = pointAt(bearingAt(Math.min(0.97, rightEdge + (1 - rightEdge) * 0.55)), AIR.gyre.distance);
        this.gyres = [left, right];
        this.u.airGyres.value.set(left.x, left.z, right.x, right.z);
    }

    /** The rest pose plus a slow drift of the lens and the pointer's parallax. */
    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.set(EYE.x, EYE.y, EYE.z);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 83) * 0.35 + clamp(pointerX, -1, 1) * 0.8);
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 61) * 0.12 - clamp(pointerY, -1, 1) * 0.25);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        if (rig.shift) {
            camera.projectionMatrix.elements[9] = -rig.shift;
            camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        }
        camera.updateMatrixWorld();
    }

    restCamera(camera) {
        this.pose(camera, 0, 0, 0);
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        // The shared breath (shared/camera-breath.js) on top of pose()'s drift. Off under reduced motion.
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Where on the valley an event happens ─────────────────────────────────────

    /**
     * The surface (ground or water) under a screen point (fractions, y down): marched along the
     * view ray over the baked ground and the river's level. Null when the ray meets nothing within
     * `far` metres. `water` is true when it met the river.
     */
    surfaceAt(sx, sy, out = this._hit, far = 600) {
        const camera = this._camera;
        if (!camera || !this.ground) return null;
        camera.updateMatrixWorld();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const o = camera.position;
        const d = this._ray;
        if (d.y > 0.05) return null;
        // The surface: the river's where the baked edge says there is water, else the ground.
        const w = this._edge;
        const surface = (x, z) => {
            const ground = groundHeight(this.ground, x, z);
            waterEdge(this.ground, x, z, w);
            return w.edge < 0 ? Math.max(ground, w.level + this.flood) : ground;
        };
        let prev = 0.5;
        for (let t = 0.5; t < far; t += Math.max(0.25, t * 0.02)) {
            if (o.y + d.y * t <= surface(o.x + d.x * t, o.z + d.z * t) + 0.05) {
                // Halve back to the surface.
                let a = prev;
                let b = t;
                for (let k = 0; k < 8; k++) {
                    const m = (a + b) / 2;
                    if (o.y + d.y * m <= surface(o.x + d.x * m, o.z + d.z * m) + 0.05) b = m;
                    else a = m;
                }
                out.x = o.x + d.x * b;
                out.z = o.z + d.z * b;
                const ground = groundHeight(this.ground, out.x, out.z);
                out.y = surface(out.x, out.z);
                out.water = out.y > ground + 0.02;
                out.s = riverNearest(out.x, out.z, this._near).s;
                out.distance = Math.hypot(out.x - EYE.x, out.z - EYE.z);
                return out;
            }
            prev = t;
        }
        return null;
    }

    /**
     * The screen point a lock at board column `u` and row `row` happens at: the valley on that
     * side of the card (column 0 far left … column 1 far right), the floor rows nearest the eye.
     */
    sitePoint(u = 0.5, row = 14) {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const f = clamp(row, 0, 19) / 19;
        if (this.aspect < 0.75) {
            const left = Math.max(0.02, card.x0 * 0.45);
            const right = Math.min(0.98, card.x1 + (1 - card.x1) * 0.55);
            return { x: u < 0.5 ? left : right, y: 0.2 + 0.22 * f };
        }
        const { hud } = this.layout;
        let lo;
        let hi;
        let k;
        if (u < 0.5) {
            lo = 0.06;
            hi = card.x0 - 0.025;
            k = u / 0.5;
        } else {
            lo = card.x1 + 0.025;
            hi = 0.95;
            if (hud && hud.x0 > card.x1 && hud.x1 < hi && hud.y1 > 0.55) {
                if (0.95 - hud.x1 > hud.x0 - lo) lo = hud.x1 + 0.02;
                else hi = hud.x0 - 0.02;
            }
            k = (u - 0.5) / 0.5;
        }
        return { x: lo + (hi - lo) * clamp(k, 0, 1), y: 0.55 + 0.4 * f };
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────────

    onLock(context = {}) {
        if (this.disposed) return;
        this.counts.locks++;
        const hard = Boolean(context.hardDrop);
        if (hard) this.counts.hardDrops++;
        this.lastLockAt = this.time;
        if (this.duskTarget > 0) this.onSessionStart();
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : [14];
        const row = rows.reduce((a, b) => a + b, 0) / rows.length;
        const p = this.sitePoint(context.u ?? 0.5, row);
        const site = this.surfaceAt(p.x, p.y);
        // A patch of the piece's own flower bursts into bloom where it landed (the anemones for
        // a shape the meadow has no flower for); on the water it splashes, and the patch opens
        // on the knoll's near edge at the same bearing.
        const kind = springFlowerSlotForPiece(context.shape);
        const slot = kind >= 0 ? kind : SPRING_FLOWERS.find((f) => f.id === 'anemone').slot;
        const radius = hard ? BLOOM_PATCH.hardRadius : BLOOM_PATCH.radius;
        const power = hard ? BLOOM_PATCH.hard : BLOOM_PATCH.soft;
        const onKnoll = site && !site.water && site.distance < 40;
        if (!onKnoll && site?.water) this.spray(site, hard ? 1 : 0.5);
        const b = onKnoll ? 0
            : Math.atan2(site ? site.x - EYE.x : (context.u ?? 0.5) - 0.5, site ? -(site.z - EYE.z) : 1);
        const x = onKnoll ? site.x : EYE.x + Math.sin(b) * BLOOM_PATCH.onKnoll;
        const z = onKnoll ? site.z : EYE.z - Math.cos(b) * BLOOM_PATCH.onKnoll;
        this.bloomPatch(x, z, slot, power, radius);
        // The piece's own pollen shaken out of the patch as it opens (its flower's colour).
        const rgb = typeof context.color === 'string' ? hexToLinear(context.color, [0, 0, 0]) : null;
        const tone = rgb && rgb[0] + rgb[1] + rgb[2] > 0.05
            ? rgb : this.u.tables.palette[PALETTE_ROWS.colour + slot].toArray().slice(0, 3);
        this.lastRgb = tone;
        this.lastLockU = clamp(Number(context.u ?? 0.5), 0, 1);
        this.pollenBurst(x, z, tone, hard, radius);
    }

    /** True when gameplay may throw motes into the air (not under reduced motion). */
    canBurst() {
        return Boolean(this.motes) && !this.reducedMotion && Boolean(this.ground);
    }

    /** The surface's height at (x, z): the ground, or the river's where it runs (the knoll's with no ground). */
    floorAt(x, z) {
        if (!this.ground) return EYE.y - 1.6;
        const ground = groundHeight(this.ground, x, z);
        waterEdge(this.ground, x, z, this._edge);
        return this._edge.edge < 0 ? Math.max(ground, this._edge.level + this.flood) : ground;
    }

    /**
     * A lock's pollen: specks of the piece's colour (and a little gold) shaken up out of its patch
     * of bloom in an arc, drifting off on the breeze, and glints on the cups as they open; a hard
     * drop shakes out more and higher, and knocks a ring of down off the plants.
     */
    pollenBurst(x, z, rgb, hard, radius) {
        if (!this.canBurst()) return;
        const r = this.random;
        const y = this.floorAt(x, z) + 0.25;
        const count = Math.round((hard ? 96 : 60) * this.burstScale);
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const at = Math.sqrt(r()) * radius * 0.55;
            const out = 0.2 + r() * 0.6;
            const gold = r() < 0.2;
            this.motes.spawn({
                x: x + Math.cos(a) * at,
                y: y + r() * 0.3,
                z: z + Math.sin(a) * at,
                vx: Math.cos(a) * out,
                vy: (hard ? 2.0 : 1.4) * (0.5 + r()),
                vz: Math.sin(a) * out,
                born: this.time + r() * 0.5,
                life: 5 + r() * 3,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: gold ? GOLD : rgb,
                kind: MOTE_KIND.pollen,
                seed: r(),
                drift: 0.25,
                gravity: -0.25,
            });
        }
        const glints = Math.round(10 * this.burstScale);
        for (let i = 0; i < glints; i++) {
            const a = r() * TAU;
            const at = Math.sqrt(r()) * radius * 0.8;
            this.motes.spawn({
                x: x + Math.cos(a) * at,
                y: y + 0.05 + r() * 0.2,
                z: z + Math.sin(a) * at,
                born: this.time + r() * 0.9,
                life: 0.35 + r() * 0.5,
                size: 0.06,
                rgb: [1.0, 0.97, 0.9],
                kind: MOTE_KIND.glint,
                seed: r(),
            });
        }
        if (!hard) return;
        const ring = Math.round(14 * this.burstScale);
        for (let i = 0; i < ring; i++) {
            const a = (i / ring) * TAU + r() * 0.3;
            this.motes.spawn({
                x: x + Math.cos(a) * 0.4,
                y: y + 0.1,
                z: z + Math.sin(a) * 0.4,
                vx: Math.cos(a) * (1.1 + r() * 0.6),
                vy: 0.4 + r() * 0.5,
                vz: Math.sin(a) * (1.1 + r() * 0.6),
                born: this.time + r() * 0.15,
                life: 6 + r() * 3,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: DOWN_WHITE,
                kind: MOTE_KIND.down,
                seed: r(),
                drift: 0.4,
                gravity: -0.06,
            });
        }
    }

    /**
     * A clear: pollen and down lift off the knoll either side of the card in the colours of the
     * rows that went (each side the colours of its half of the board), three puffs a side running
     * out from the card, the more the more lines.
     */
    clearDrift(lines, rowCodes) {
        if (!this.canBurst()) return;
        const r = this.random;
        const codes = Array.isArray(rowCodes) || ArrayBuffer.isView(rowCodes) ? Array.from(rowCodes) : [];
        const sideColour = (left) => {
            const sum = [0, 0, 0];
            let n = 0;
            for (let k = 0; k < codes.length; k++) {
                const column = k % 10;
                const code = codes[k];
                if ((column < 5) !== left || !(code >= 0 && code < 7)) continue;
                sum[0] += PIECE_RGB[code][0];
                sum[1] += PIECE_RGB[code][1];
                sum[2] += PIECE_RGB[code][2];
                n += 1;
            }
            return n ? sum.map((v) => v / n) : [...this.lastRgb];
        };
        const perPuff = Math.round((12 + 7 * lines) * this.burstScale);
        for (const side of [-1, 1]) {
            const rgb = sideColour(side < 0);
            for (let k = 0; k < 3; k++) {
                const p = pointAt(side * (22 + k * 9), 9 + k * 1.5);
                const y = this.floorAt(p.x, p.z) + 0.3;
                for (let i = 0; i < perPuff; i++) {
                    const a = r() * TAU;
                    const at = Math.sqrt(r()) * 2.2;
                    const down = r() < 0.3;
                    this.motes.spawn({
                        x: p.x + Math.cos(a) * at,
                        y: y + r() * 0.4,
                        z: p.z + Math.sin(a) * at,
                        vx: Math.cos(a) * 0.5 + AIR.breeze[0] * 0.4,
                        vy: (0.9 + 0.15 * lines) * (0.5 + r()),
                        vz: Math.sin(a) * 0.5 + AIR.breeze[1] * 0.4,
                        born: this.time + k * 0.22 + r() * 0.3,
                        life: 5 + r() * 3,
                        size: (down ? 0.075 : 0.05) * (0.7 + r() * 0.6),
                        rgb: down ? DOWN_WHITE : rgb,
                        kind: down ? MOTE_KIND.down : MOTE_KIND.pollen,
                        seed: r(),
                        drift: 0.3,
                        gravity: down ? -0.04 : 0,
                    });
                }
            }
        }
    }

    /**
     * A little whirlwind of pollen and down beside the card (on side -1 left, 1 right), `strength`
     * 1 for a chain's second link and more for each after it.
     */
    whirlwind(side, strength, rgb) {
        if (!this.canBurst()) return;
        const r = this.random;
        const g = this.gyres[side < 0 ? 0 : 1];
        const turnWay = AIR.gyre.turn[side < 0 ? 0 : 1];
        const y = this.floorAt(g.x, g.z) + 0.15;
        const count = Math.round(Math.min(240, 44 + 22 * strength) * this.burstScale);
        const radius = Math.min(1.7, 0.55 + 0.12 * strength);
        const climb = Math.min(1.8, 0.65 + 0.1 * strength);
        const turn = Math.min(5, 2.4 + 0.25 * strength) * turnWay;
        for (let i = 0; i < count; i++) {
            const down = r() < 0.3;
            const gold = r() < 0.3;
            // A funnel: narrow at the foot, the circle widening as the mote climbs.
            const rise = climb * (0.55 + r() * 0.9);
            this.motes.whirl({
                x: g.x,
                y: y + r() * 0.3,
                z: g.z,
                radius: radius * (0.15 + r() * 0.3),
                climb: rise,
                turn: turn * (0.8 + r() * 0.4),
                grow: rise * (0.3 + r() * 0.15),
                born: this.time + r() * 0.9,
                life: 3.2 + r() * 2.6,
                size: (down ? 0.075 : 0.05) * (0.7 + r() * 0.6),
                rgb: (down && DOWN_WHITE) || (gold && GOLD) || rgb,
                seed: r(),
            });
        }
    }

    /** A broken chain lets go of its down: tufts lift off the whole knoll and drift away. */
    exhale(peak) {
        if (!this.canBurst()) return;
        const r = this.random;
        const count = Math.round(Math.min(190, 22 * peak) * this.burstScale);
        for (let i = 0; i < count; i++) {
            const p = pointAt(-48 + r() * 92, 4 + r() * 11);
            this.motes.spawn({
                x: p.x,
                y: this.floorAt(p.x, p.z) + 0.2 + r() * 0.6,
                z: p.z,
                vx: AIR.breeze[0] * 0.5 * r(),
                vy: 0.5 + r() * 0.9,
                vz: AIR.breeze[1] * 0.5 * r(),
                born: this.time + r() * 1.4,
                life: 6 + r() * 4,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: r() < 0.2 ? GOLD : DOWN_WHITE,
                kind: r() < 0.2 ? MOTE_KIND.pollen : MOTE_KIND.down,
                seed: r(),
                drift: 0.4,
                gravity: -0.03,
            });
        }
    }

    /** Back-to-back: glints struck off the river's ripples in front of the knoll, more each level. */
    riverGlints(level) {
        if (!this.canBurst() || !this._camera) return;
        const r = this.random;
        const hits = [];
        for (let k = 0; k < 10; k++) {
            const sx = k < 5 ? 0.04 + k * 0.065 : 0.66 + (k - 5) * 0.065;
            const site = this.surfaceAt(sx, 0.56 + r() * 0.08);
            if (site?.water) hits.push({ ...site });
        }
        if (!hits.length) return;
        const count = Math.round(Math.min(90, 22 * level) * this.burstScale);
        for (let i = 0; i < count; i++) {
            const h = hits[Math.floor(r() * hits.length)];
            const spread = 1.5 + h.distance * 0.12;
            this.motes.spawn({
                x: h.x + (r() - 0.5) * spread * 2,
                y: h.y + 0.05,
                z: h.z + (r() - 0.5) * spread * 2,
                born: this.time + r() * 1.6,
                life: 0.35 + r() * 0.45,
                size: 0.045 * clamp(h.distance / 14, 0.7, 3),
                rgb: [1.0, 0.97, 0.9],
                kind: MOTE_KIND.glint,
                seed: r(),
            });
        }
    }

    /** A level up: willow down drifting over from the birches upwind, across the knoll. */
    downDrift() {
        if (!this.canBurst()) return;
        const r = this.random;
        const count = Math.round(110 * this.burstScale);
        for (let i = 0; i < count; i++) {
            const p = pointAt(-52 + r() * 34, 10 + r() * 12);
            this.motes.spawn({
                x: p.x,
                y: EYE.y + 0.5 + r() * 4.5,
                z: p.z,
                vx: AIR.breeze[0] * (0.5 + r() * 0.5),
                vy: 0.1 + r() * 0.3,
                vz: AIR.breeze[1] * (0.5 + r() * 0.5),
                born: this.time + r() * 2.5,
                life: 9 + r() * 4,
                size: 0.075 * (0.7 + r() * 0.6),
                rgb: DOWN_WHITE,
                kind: MOTE_KIND.down,
                seed: r(),
                drift: 0.5,
                gravity: -0.04,
            });
        }
    }

    /** A perfect clear: gold pollen and down showering slowly over the knoll and the river. */
    goldShower() {
        if (!this.canBurst()) return;
        const r = this.random;
        const count = Math.round(200 * this.burstScale);
        for (let i = 0; i < count; i++) {
            const p = pointAt(-46 + r() * 90, 6 + r() * 20);
            const down = r() < 0.35;
            this.motes.spawn({
                x: p.x,
                y: EYE.y + 2 + r() * 6,
                z: p.z,
                vx: (r() - 0.5) * 0.3,
                vy: 0.15 * r(),
                vz: (r() - 0.5) * 0.3,
                born: this.time + r() * 2.2,
                life: 8 + r() * 4,
                size: (down ? 0.075 : 0.05) * (0.7 + r() * 0.6),
                rgb: down ? DOWN_WHITE : GOLD,
                kind: down ? MOTE_KIND.down : MOTE_KIND.pollen,
                seed: r(),
                drift: 0.3,
                gravity: -0.12,
            });
        }
    }

    /** A patch of one kind of flower bursting into bloom round (x, z). */
    bloomPatch(x, z, slot, power, radius) {
        const k = this.patchCursor % PATCHES;
        this.patchCursor = (this.patchCursor + 1) % (PATCHES * 1000);
        this.u.tables.events[EVENT_ROWS.patch + k * 2].set(x, z, this.time, power);
        this.u.tables.events[EVENT_ROWS.patch + k * 2 + 1].set(slot, radius, 0, 0);
    }

    /** Spray thrown up from the water (or dew off the ground) at a site. */
    spray(site, power) {
        if (!this.motes) return;
        const r = this.random;
        const scale = clamp(site.distance / 14, 0.7, 3);
        const count = Math.round(18 + 30 * power);
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const out = (0.6 + r() * 1.8) * power;
            this.motes.spawn({
                x: site.x + Math.cos(a) * r() * 0.8,
                y: site.y + 0.1,
                z: site.z + Math.sin(a) * r() * 0.8,
                vx: Math.cos(a) * out,
                vy: 2.2 + r() * 3.2 * power,
                vz: Math.sin(a) * out,
                born: this.time + r() * 0.08,
                life: 0.9 + r() * 0.7,
                size: 0.03 * scale,
                rgb: [0.9, 0.95, 1.0],
                kind: MOTE_KIND.dew,
                seed: r(),
                drift: 0,
                gravity: -9.8,
            });
        }
    }

    /** A surge of white water down the rapids from the pool (power ~1 a line). */
    surge(power, delay = 0) {
        const slot = this.surgeCursor % SURGES;
        this.surgeCursor = (this.surgeCursor + 1) % (SURGES * 1000);
        this.u.tables.events[EVENT_ROWS.surge + slot].set(this.time + delay, power, 0, 0);
    }

    onClear(context = {}) {
        if (this.disposed) return;
        if (context.perfect) {
            this.onPerfect();
            return;
        }
        const lines = clamp(Math.round(context.lines || 1), 1, 4);
        this.counts.clears++;
        this.counts.lines += lines;
        // One surge down the rapids, the bigger the more lines; the whole knoll flushes into bloom,
        // its pollen and down lift off it, and a breath runs out through the air.
        this.surge(0.55 + lines * 0.3, 0);
        this.clearAt = this.time;
        this.clearPower = Math.min(1, 0.45 + lines * 0.15);
        this.airWaveAt = this.time;
        this.airWavePower = Math.min(1.25, AIR_MOTION.wave + AIR_MOTION.wavePerLine * lines);
        this.clearDrift(lines, context.rowCodes);
        if (lines === 4) this.onQuad();
        if (context.tspin) this.onTSpin(context);
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    /** Four lines: the clear's surge is the great one, and the last of the winter's ice goes out on it. */
    onQuad() {
        this.counts.quads++;
        this.floes?.breakUp(this.time + 1.6, ICE_OUT.floes);
        this._post.flashKick = 0.5;
    }

    /** A T-spin: the plunge pool turns in a whirl, and so does the air beside the card on its side. */
    onTSpin() {
        this.counts.tspins++;
        this.u.whirl.value.set(this.time, 1);
        this.whirlSpray();
        this.whirlwind(this.lastLockU < 0.5 ? -1 : 1, 5, PIECE_RGB[1]);
    }

    /** Spray flung off the whirl's rim as it spins up: it turns, seen even edge-on. */
    whirlSpray() {
        if (!this.motes) return;
        const r = this.random;
        const c = WHIRL_CENTRE_AT;
        const level = levelAt(S_POOL + WHIRL.at) + this.flood;
        for (let i = 0; i < 90; i++) {
            const a = r() * TAU;
            const rim = WHIRL.radius * (0.35 + r() * 0.5);
            // Tangential (the whirl turns anticlockwise seen from above), a little outward and up.
            const speed = 2.5 + r() * 3.5;
            this.motes.spawn({
                x: c.x + Math.cos(a) * rim,
                y: level + 0.15,
                z: c.z + Math.sin(a) * rim,
                vx: -Math.sin(a) * speed + Math.cos(a) * 0.6,
                vy: 1.6 + r() * 2.6,
                vz: Math.cos(a) * speed + Math.sin(a) * 0.6,
                born: this.time + 0.4 + r() * 2.6,
                life: 0.9 + r() * 0.8,
                size: 0.09,
                rgb: [0.92, 0.96, 1.0],
                kind: MOTE_KIND.dew,
                seed: r(),
                drift: 0,
                gravity: -9.8,
            });
        }
    }

    /** A perfect clear: the river surges twice, and whooper swans come over the valley. */
    onPerfect() {
        this.counts.perfects++;
        this.perfectAt = this.time;
        this.surge(1.4, 0);
        this.surge(1.4, 1.2);
        this.flights?.launch('swan', this.time);
        this.goldShower();
    }

    onCombo(value) {
        const n = clamp(Math.round(value) || 0, 0, 1000);
        if (n === this.combo) return;
        if (n > this.combo && n >= 2) {
            this.counts.chainSteps++;
            // Each link spins up a whirlwind beside the card, on alternate sides, stronger each time.
            this.burstSide = -this.burstSide;
            this.whirlwind(this.burstSide, n - 1, this.lastRgb);
        }
        if (n === 0 && this.peak >= 3) {
            this.counts.releases++;
            this.exhale(this.peak);
        }
        this.combo = n;
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
    }

    onB2B(value) {
        const n = clamp(Math.round(value) || 0, 0, 4);
        if (n > this.b2b) {
            this.counts.b2bSteps++;
            this.riverGlints(n);
        }
        this.b2b = n;
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n === this.level) return;
        const up = n > this.level;
        this.wheel.levelUp(n, time, silent || this.reducedMotion);
        this.level = n;
        if (up && !silent) {
            this.counts.levelUps++;
            this.levelUpAt = time;
            // The day steps on, cranes pass over on their way north, and willow down drifts over.
            this.flights?.launch('crane', time);
            this.downDrift();
        }
    }

    onGameOver() {
        this.counts.gameOvers++;
        this.duskFrom = this.dusk;
        this.duskTarget = 1;
        this.duskAt = this.time;
    }

    onSessionStart() {
        if (this.duskTarget > 0) this.counts.mornings++;
        this.duskFrom = this.dusk;
        this.duskTarget = 0;
        this.duskAt = this.time;
    }

    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.level = 1;
        this.wheel.newRun();
    }

    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const { time, u } = this;
        const dt = Math.max(0, Math.min(0.25, sim.delta || 0));
        this.dusk = this.duskFrom + (this.duskTarget - this.duskFrom)
            * smooth(0, this.duskTarget ? TIMING.dusk : TIMING.dawn, time - this.duskAt);
        const place = this.overrides.hour !== null ? this.overrides.hour : this.wheel.place(time);
        lightAt(place, this._hourLight);
        const L = this.dusk > 0.001
            ? blendLight(this._hourLight, this._duskLight, this.dusk * 0.85, this.light)
            : copyLight(this._hourLight, this.light);
        u.sunDir.value.set(L.dir[0], L.dir[1], L.dir[2]);
        u.sunUp.value = L.sunUp;
        u.sunEl.value = L.el;
        u.skyline.value = L.skyline;
        u.sun.value.set(L.sun[0], L.sun[1], L.sun[2]);
        u.fill.value.set(L.fill[0], L.fill[1], L.fill[2]);
        u.bounce.value.set(L.bounce[0], L.bounce[1], L.bounce[2]);
        u.zenith.value.set(L.zenith[0], L.zenith[1], L.zenith[2]);
        u.horizon.value.set(L.horizon[0], L.horizon[1], L.horizon[2]);
        u.glow.value.set(L.glow[0], L.glow[1], L.glow[2]);
        u.haze.value.set(L.haze[0], L.haze[1], L.haze[2]);
        u.mist.value.set(L.mist[0], L.mist[1], L.mist[2]);
        u.cloudLit.value.set(L.cloudLit[0], L.cloudLit[1], L.cloudLit[2]);
        u.cloudShade.value.set(L.cloudShade[0], L.cloudShade[1], L.cloudShade[2]);
        u.water.value.set(L.water[0], L.water[1], L.water[2]);
        u.hazeDensity.value = L.hazeDensity;
        u.mistDensity.value = L.mistDensity;
        u.cloudCover.value = L.cover;
        u.open.value = L.open * (1 - this.dusk * 0.8);
        u.dew.value = L.dew;
        u.dusk.value = this.dusk;
        u.day.value = L.day;
        u.time.value = time;
        u.wind.value.set(time * 6.5, time * -2.2);
        u.gust.value = 1 + 0.1 * Math.min(this.combo, 6);

        // ── The air: a chain stirs it (it eases in and settles slowly), a perfect clear stills it ──
        const stirAsk = clamp((this.combo - 1) / (AIR_MOTION.fullChain - 1), 0, 1);
        this.stir += (stirAsk - this.stir) * approach(stirAsk > this.stir ? 1.2 : 0.3, dt);
        const stillAge = time - this.perfectAt;
        const still = stillAge < 0 ? 0
            : smooth(0, STILL.rise, stillAge) * (1 - smooth(STILL.hold, STILL.fall, stillAge));
        const pace = this.reducedMotion ? AIR_MOTION.reduced : 1;
        this.airClock += dt * (1 + AIR_MOTION.hurry * this.stir) * (1 - 0.85 * still) * pace;
        this.airGyre += dt * this.stir * AIR_MOTION.gyre * pace;
        u.air.value.set(this.airClock, this.airGyre, this.stir, still);
        u.airWave.value.set(this.airWaveAt, this.airWavePower, AIR_MOTION.waveSpeed, 0);

        // ── The spring flood: each link of a chain lifts the river; it falls back after ──
        const link = Math.max(0, this.combo - 1);
        const floodAsk = this.combo >= 2 ? Math.min(FLOOD.most, FLOOD.perLink * link) : 0;
        const foamAsk = this.combo >= 2 ? Math.min(FLOOD.foamMost, FLOOD.foamPerLink * link) : 0;
        this.flood += (floodAsk - this.flood) * approach(floodAsk > this.flood ? 1.4 : 0.35, dt);
        this.foamBoost += (foamAsk - this.foamBoost) * approach(foamAsk > this.foamBoost ? 1.8 : 0.4, dt);
        u.flood.value = this.flood;
        u.foamBoost.value = this.foamBoost;
        // The water's own clock runs faster as the flood rises (integrated: never a jump).
        this.flowClock += dt * (1 + this.flood * 0.6);
        u.flowClock.value = this.flowClock;
        // ── The meadow: a clear's flush of bloom ──
        const flushAge = time - this.clearAt;
        u.flush.value = flushAge < 0 ? 0 : this.clearPower * smooth(0, FLUSH.rise, flushAge)
            * (1 - smooth(FLUSH.rise + FLUSH.hold, FLUSH.rise + FLUSH.hold + FLUSH.fall, flushAge));
        // ── Back-to-back: the river glitters while the run lasts ──
        this.gloryShown += (this.b2b / 3 - this.gloryShown) * approach(1.2, dt);
        u.glory.value = clamp(this.gloryShown, 0, 1);

        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, this.viewportHeight || 1080);
        }
        this.updatePost(camera, dt);
        this.motes?.update();
        this.floes?.update(time, this.flood);
        this.flights?.update(time);
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    updatePost(camera, dt) {
        const post = this._post;
        const L = this.light;
        post.exposure = L.exposure;
        post.shaftColour = L.glow;
        post.saturation = 1.1;
        post.bloomBoost = Math.min(1, this.gloryShown * 0.2 + this.foamBoost * 0.3);
        post.flashKick = Math.max(0, (post.flashKick || 0) - dt * 1.6);
        post.flash = post.flashKick * post.flashKick * 0.3;
        post.flashColour = L.glow;
        post.sun.strength = 0;
        if (camera) {
            this._sunWorld.set(EYE.x + L.dir[0] * 1000, EYE.y + L.dir[1] * 1000, EYE.z + L.dir[2] * 1000);
            this._sunScreen.copy(this._sunWorld).project(camera);
            const inFront = this._sunScreen.z < 1;
            post.sun.x = this._sunScreen.x * 0.5 + 0.5;
            post.sun.y = 0.5 - this._sunScreen.y * 0.5;
            const margin = Math.max(Math.abs(post.sun.x - 0.5), Math.abs(post.sun.y - 0.5));
            post.sun.onScreen = inFront ? 1 - smooth(0.5, 0.9, margin) : 0;
            // The shafts outlast the disc a little: rays fan out from behind the rim it sank behind.
            post.sun.strength = post.sun.onScreen * smooth(-2.5, 1.5, L.el - L.skyline) * smooth(-1.2, 2, L.el)
                * (1 - smooth(18, 34, L.el));
        }
    }

    /**
     * Draw the woods' impostor atlas, once, before the first frame: its materials compiled off
     * the main thread where the backend can, then its two passes (drawn again on the next frames'
     * prerender until every tree is in it).
     */
    async bakeImpostors(renderer) {
        if (!renderer || !this.impostors || this.impostors.ready || this.impostors.failed) return;
        try {
            await this.impostors.bake(renderer);
        } catch (error) {
            // Not given up on here (a compile that failed while the app was busy): the next frames'
            // prerender draws the atlas again, and only a draw that throws there leaves the woods
            // without their cards.
            console.warn('[Spring] The woods\' impostors were not drawn yet; drawing them on the next frame.', error);
        }
    }

    /** Before the frame: the impostor atlas, until it holds every tree. */
    prerender(renderer) {
        const atlas = this.impostors;
        if (!renderer || !atlas || atlas.ready || atlas.failed) return;
        try {
            atlas.draw(renderer);
        } catch (error) {
            atlas.failed = true;
            console.warn('[Spring] The woods\' impostors could not be drawn.', error);
        }
    }

    getPostState() { return this._post; }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            hour: {
                place: this.light.place,
                from: this.light.from,
                to: this.light.to,
                mix: this.light.mix,
                az: this.light.az,
                el: this.light.el,
                name: HOURS[this.light.from].name,
            },
            counts: { ...this.counts },
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            flood: this.flood,
            foamBoost: this.foamBoost,
            glory: this.gloryShown,
            open: this.u.open.value,
            patches: Array.from({ length: PATCHES }, (_, k) => this.u.tables.events[EVENT_ROWS.patch + k * 2])
                .filter((row) => time0(this.time, row.z) < 24).length,
            flush: this.u.flush.value,
            whirlAge: this.u.whirl.value.y > 0 ? this.time - this.u.whirl.value.x : null,
            floes: this.floes?.live ?? 0,
            air: { clock: this.airClock, gyre: this.airGyre, stir: this.stir },
            // The woods' impostor atlas: kept (every tree drawn into it), and the bakes it took.
            woods: this.impostors ? {
                baked: this.impostors.ready, failed: this.impostors.failed === true, attempts: this.impostors.attempts,
            } : null,
            birds: (this.flights?.live || []).reduce((a, b) => a + b, 0),
            dusk: this.dusk,
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            parts: Object.keys(this.parts),
        };
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT) scalars[key] = this[key];
        return {
            scalars,
            wheel: this.wheel.exportState(),
            counts: { ...this.counts },
            events: this.u.tables.events.map((v) => v.toArray()),
        };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.wheel.importState(state.wheel);
        this.counts = { ...emptyCounts(), ...state.counts };
        if (Array.isArray(state.events)) state.events.forEach((row, k) => this.u.tables.events[k]?.fromArray(row));
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        if (this.textures) {
            this.textures.noise.dispose();
            this.textures.lattice.dispose();
        }
        this.root.clear();
        this.partList.length = 0;
    }
}
