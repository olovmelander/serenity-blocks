/**
 * Lunara — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (lunara-theme.js) and the playground effect
 * (src/playground/effects/lunara.effect.js), so what is iterated there ships.
 *
 * The valley is an instrument of crystal under twin moons, and the board plays it:
 *
 *   lock     a wisp of the piece's colour leaves the card and flies into a spire, which flashes
 *            from root to point and keeps some of that light; a ring in the same colour runs out
 *            over the flats from under the board and wakes the veins in the bed. A hard drop
 *            sends three wisps and hits harder.
 *   clear    the cleared rows leave the card as blades of moonlight, and a wave runs out through
 *            the valley, one front per line: every spire answers as it passes and lets go of the
 *            colours it was holding, the flowers flare, the aurora surges.
 *   combo    the valley charges: a halo ring forms round the great moon for every step of the
 *            chain, veins of light open across its face, the curtains fold and climb, the motes
 *            rise faster, the companion quickens in its orbit.
 *   four     the valley holds its breath — every light sinks for a fifth of a second — then a
 *            pillar stands on every spire, a prismatic ring crosses the sky from the great moon,
 *            its veins fire, and meteors fall.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the flats mirror; 1 = what only the camera sees (wisps, row beams).
 */

import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import {
    CLEAR_SLOTS,
    DEG,
    HUSH_HOLD,
    LOCK_SLOTS,
    LUNARA_PALETTES,
    MOONFIRE,
    NOISE_SIZE,
    PALETTE_KEYS,
    TAU,
    WISP_FLIGHT,
    approach,
    bakeNoise,
    celestialAnchors,
    clamp01,
    createHeightTexture,
    createNoiseTexture,
    createPlaceholderTexture,
    createValleyUniforms,
    mulberry32,
    pieceColor,
    powerForCombo,
    smooth,
} from './lunara-tsl.js';
import { buildPlan, strikeTargets } from './lunara-layout.js';
import { tierFor } from './lunara-quality.js';
import { MAX_RINGS, createMeteors, createSky } from './lunara-sky.js';
import { MOON_DISTANCE, createMoon } from './lunara-moons.js';
import { createBanks, createRanges } from './lunara-terrain.js';
import { createCrystals } from './lunara-crystals.js';
import { createWater } from './lunara-water.js';
import { createFlowers, createMotes } from './lunara-flora.js';
import { createRowBeams, createShards, createWisps } from './lunara-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './lunara-composition.js';

/** The rest camera: standing in the flats, looking down the valley and a little up at the sky. */
export const REST_RIG = Object.freeze({
    height: 2.3,
    pitch: 5.2 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 80,
    minFov: 44,
    maxFov: 74,
    near: 0.3,
    far: 16000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** The companion's orbit: radians per second at rest, and where it starts. */
export const ORBIT_RATE = TAU / 320;
export const ORBIT_START = -1.3;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.2;
/** The lowest tip (metres over the water) a wisp is sent to. */
export const MIN_TARGET_TIP = 1.2;
/** Seconds a ring / a clear wave stays in the valley (the shaders skip their loops after). */
const RING_LIVE = 5.5;
const CLEAR_LIVE = 8;
/** The brightest the curtains ever burn (at rest they sit at 0.3). */
export const AURORA_MAX = 1.45;
/** Seconds between the valley's own shooting stars. */
export const METEOR_BEAT = 19;
/** Where the moons' light comes from: off to the right and behind the viewer. */
const SUN = new THREE.Vector3(0.9, 0.24, 0.26).normalize();
/** The moon map every moon in the fleet shares (Solar System Scope, CC BY 4.0: see CREDITS.md). */
export const MOON_MAP_URL = './textures/2k_moon.jpg';
/** Seconds the moons' faces take to fade in once the map has arrived. */
const MAP_FADE = 1.6;

const PARTS = [
    'sky', 'moon', 'companion', 'meteors', 'ranges', 'banks', 'water', 'crystals', 'glints', 'pillars',
    'flowers', 'motes', 'shards', 'wisps', 'beams',
];

export class LunaraWorld {
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
        this.plan = buildPlan(this.noiseField, NOISE_SIZE, seed);
        this.root = new THREE.Group();
        this.root.name = 'Lunara';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.reflection = null;
        this.moonMap = null;
        this.mapFade = null;
        this.mapReady = false;
        this.mapShown = 0;
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.beams = null;
        this.meteors = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The great moon on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.24, y: 0.3 };
        this.targets = { left: [], right: [] };
        /** How near the middle the spires are drawn (1 in landscape; see the `squeeze` uniform). */
        this.squeeze = 1;
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._e1 = new THREE.Vector3();
        this._e2 = new THREE.Vector3();
        this._moonDir = new THREE.Vector3(-0.3, 0.3, -0.9).normalize();
        this.moonAngle = 0.17;
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._strike = { x: 0, z: -12 };
        this._from = [0, 0, 0];
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...LUNARA_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart, flash: 0, kick: 0, shafts: 0.25, bloomBoost: 0, exposure: 1,
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
        this.paletteIndex = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.twist = 0;
        this.breath = 1;
        this.rings = 0;
        this.veins = 0;
        this.veinsFlare = 0;
        this.hushUntil = -1;
        this.lockCursor = 0;
        this.clearCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.orbit = ORBIT_START + time * ORBIT_RATE;
        this.auroraDrift = time * 0.05 * motion;
        this.moteLift = time * motion;
        this.meteorBeat = Math.floor(time / METEOR_BEAT);
        this.crystals?.reset();
        this.shards?.reset();
        this.wisps?.reset();
        this.beams?.reset();
        this.meteors?.reset();
        if (this.u) {
            for (let i = 0; i < LOCK_SLOTS; i++) this.u.lockA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
            this.u.shock.value.set(-100, 0);
        }
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        const heights = createHeightTexture(this.plan.heights);
        const blank = createPlaceholderTexture();
        this.textures.push(noise, heights, blank);
        const u = createValleyUniforms({ noise, heights });
        this.u = u;
        u.sunDir.value.copy(SUN);
        const { tier, plan } = this;

        this.addPart('sky', createSky(u, { curtains: tier.curtains, nebula: tier.nebula }));
        this.moonMap = texture(blank);
        this.mapFade = uniform(0);
        this.addPart('moon', createMoon(u, this.moonMap, this.mapFade, { relief: tier.relief }));
        this.addPart('companion', createMoon(u, this.moonMap, this.mapFade, { companion: true, relief: tier.relief }));
        this.meteors = createMeteors(u, tier.meteors);
        this.addPart('meteors', this.meteors);

        this.addPart('ranges', createRanges(u, plan));
        this.addPart('banks', createBanks(u, plan));
        const water = createWater(u, { reflectionScale: tier.reflection, glitter: tier.glitter });
        this.addPart('water', water);
        if (water.reflectorTarget) this.root.add(water.reflectorTarget);
        this.reflection = water.reflection;

        const stones = createCrystals(u, plan, { count: tier.crystals, dispersion: tier.dispersion });
        this.crystals = stones.crystals;
        this.addPart('crystals', stones.crystals);
        this.addPart('glints', stones.glints);
        if (stones.pillars) this.addPart('pillars', stones.pillars);

        if (tier.flowers > 0) this.addPart('flowers', createFlowers(u, plan, tier.flowers));
        if (tier.motes > 0) this.addPart('motes', createMotes(u, tier.motes));

        // ── Gameplay effects (pools, always drawn) ──
        this.shards = createShards(u, tier.shards);
        this.addPart('shards', this.shards);
        this.wisps = createWisps(u);
        this.addPart('wisps', this.wisps, { reflected: false });
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams, { reflected: false });

        this.applyPalette(1);
        this.composeSky();
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

    /**
     * Fetch the moon map. Never awaited by the first frame: the moons stand as smooth lit
     * spheres until it arrives, then their faces fade in.
     * @returns {Promise<boolean>} true when the map is in
     */
    loadTextures() {
        return new Promise((resolve) => {
            const arrived = (tex) => {
                if (this.disposed) {
                    tex.dispose();
                    resolve(false);
                    return;
                }
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.ClampToEdgeWrapping;
                tex.anisotropy = 4;
                tex.generateMipmaps = true;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.name = 'lunara-moon-map';
                this.textures.push(tex);
                this.moonMap.value = tex;
                this.mapReady = true;
                resolve(true);
            };
            try {
                new THREE.TextureLoader().load(MOON_MAP_URL, arrived, undefined, () => resolve(false));
            } catch {
                resolve(false); // no image decoding here (a headless host): the moons stay smooth
            }
        });
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
    }

    /** A new run: the valley back at rest (the sky keeps turning). */
    resetSession() {
        const {
            time, orbit, auroraDrift, moteLift, meteorBeat,
        } = this;
        this.resetState(time);
        Object.assign(this, {
            orbit, auroraDrift, moteLift, meteorBeat,
        });
        this.applyPalette(1);
    }

    /**
     * The camera sees layer 1 (wisps, row beams); the flats' mirror must not. Called once the
     * camera that will render the world is known.
     */
    bindCamera(camera) {
        camera.layers.enable(1);
        if (this.reflection) {
            const mirror = this.reflection.reflector.getVirtualCamera(camera);
            mirror.layers.set(0);
        }
    }

    // ── The sky's furniture ─────────────────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, REST_RIG.height, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, REST_RIG.height + Math.tan(REST_RIG.pitch) * 10, -10);
        cam.updateMatrixWorld();
        return cam;
    }

    /** The unit direction a screen point (fractions, y down) looks along from the rest camera. */
    restDirection(sx, sy, out) {
        const cam = this.restCamera();
        return out.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    }

    /**
     * Hang the great moon and the ringed world where the composition wants them for this aspect.
     */
    composeSky() {
        const { u } = this;
        if (!u) return;
        const anchors = celestialAnchors(this.aspect);
        this.squeeze = 0.5 + 0.5 * smooth(0.62, 1.25, this.aspect);
        u.squeeze.value = this.squeeze;
        const tanV = Math.tan((fovForAspect(this.aspect) * DEG) / 2);
        const moonDir = this.restDirection(anchors.moon.x, anchors.moon.y, this._moonDir);
        this.moonAngle = Math.atan(anchors.moon.radius * 2 * tanV);
        u.moonDir.value.copy(moonDir);
        this.parts.moon?.place(
            moonDir.x * MOON_DISTANCE,
            REST_RIG.height + moonDir.y * MOON_DISTANCE,
            moonDir.z * MOON_DISTANCE,
            MOON_DISTANCE * Math.sin(this.moonAngle),
        );
        this._e1.crossVectors(moonDir, this._vec.set(0, 1, 0)).normalize();
        this._e2.crossVectors(this._e1, moonDir).normalize();
        u.planetDir.value.copy(this.restDirection(anchors.planet.x, anchors.planet.y, this._vec));
        u.discs.value.set(this.moonAngle, this.moonAngle * 0.3, Math.atan(anchors.planet.radius * 2 * tanV), 0);
        this.placeCompanion();
    }

    /**
     * Move the companion along its orbit. The orbit is drawn in the sky's own plane; the
     * companion passes in front of the great moon on the lower half of its round and behind on
     * the upper (it changes shell while it stands clear beside it, which the eye cannot see).
     */
    placeCompanion() {
        const { u } = this;
        if (!u) return;
        const along = Math.cos(this.orbit) * 2.0 * this.moonAngle;
        const across = Math.sin(this.orbit) * 0.62 * this.moonAngle;
        // The orbit's long axis leans a little, up to the right (clear of the range).
        const lean = 0.35;
        const ox = along * Math.cos(lean) - across * Math.sin(lean);
        const oy = along * Math.sin(lean) + across * Math.cos(lean);
        const dir = this._vec.copy(this._moonDir).addScaledVector(this._e1, ox).addScaledVector(this._e2, oy).normalize();
        const shell = MOON_DISTANCE * (Math.sin(this.orbit) < 0 ? 0.7 : 1.3);
        u.companionDir.value.copy(dir);
        this.parts.companion?.place(
            dir.x * shell,
            REST_RIG.height + dir.y * shell,
            dir.z * shell,
            shell * Math.sin(this.moonAngle * 0.3),
        );
    }

    /**
     * Which spires a wisp can be sent to: the clustered ones the rest camera sees clear of the
     * card, split by the side of the card they stand on, nearest first.
     */
    findTargets() {
        const left = [];
        const right = [];
        if (this.crystals) {
            const cam = this.restCamera();
            const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
            const centre = (card.x0 + card.x1) * 0.5;
            const n = strikeTargets(this.plan, this.crystals.count);
            for (let i = 0; i < n; i++) {
                const c = this.plan.crystals[i];
                this._vec.set(c.tip[0] - c.x * (1 - this.squeeze), c.tip[1], c.tip[2]).project(cam);
                // A wisp needs a spire that stands clear of the water.
                if (c.tip[1] < MIN_TARGET_TIP) continue;
                if (this._vec.z > 1 || Math.abs(this._vec.x) > 0.97 || this._vec.y > 0.97 || this._vec.y < -0.9) continue;
                const sx = this._vec.x * 0.5 + 0.5;
                if (sx > card.x0 - 0.01 && sx < card.x1 + 0.01) continue;
                const entry = { index: i, dist: Math.hypot(c.x, c.z) };
                (sx < centre ? left : right).push(entry);
            }
            const byDist = (a, b) => a.dist - b.dist;
            left.sort(byDist);
            right.sort(byDist);
        }
        this.targets = { left: left.map((e) => e.index), right: right.map((e) => e.index) };
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.8 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of someone standing in the water, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.13) * 0.42 + Math.sin(t * 0.071 + 1.3) * 0.3) * calm;
        const swayY = (Math.sin(t * 0.19 + 0.7) * 0.05 + Math.sin(t * 0.083) * 0.04) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(swayX + px * 0.8, REST_RIG.height + swayY - py * 0.25 - this.kick * 0.05 * calm, 0);
        const yaw = (Math.sin(t * 0.09 + 2.1) * 0.01 - px * 0.028) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.11) * 0.005 - py * 0.016) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            -10,
        );
        camera.up.set(Math.sin(t * 0.07) * 0.004 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
        // The great moon on screen: where the shafts come from.
        if (this.u) {
            this._ray.copy(this.u.moonDir.value).multiplyScalar(1000).add(camera.position).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        }
    }

    /**
     * Where a ray through a screen point (fractions, y down) meets the flats. Points above the
     * horizon (or absurdly far) land `far` metres ahead instead.
     */
    screenToFlats(sx, sy, out = this._strike, far = 12) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0;
            out.z = -far;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : Infinity;
        const dist = Math.hypot(this._ray.x, this._ray.z) * t;
        if (!Number.isFinite(dist) || dist > 70) {
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

    /** Pick the spire a lock on `side` (−1 left, +1 right) strikes; nearer ones more often. */
    pickTarget(side, salt = 0) {
        let list = side < 0 ? this.targets.left : this.targets.right;
        if (!list.length) list = side < 0 ? this.targets.right : this.targets.left;
        if (!list.length) return -1;
        const rand = mulberry32(0x1f3d + (this.counts.locks + 1) * 2654435761 + salt * 97)();
        return list[Math.min(list.length - 1, Math.floor(rand ** 1.9 * list.length))];
    }

    /** Send one wisp from a world point into crystal `index`. Returns its arrival time. */
    sendWisp(index, from, rgb, amount, salt = 0) {
        const c = this.plan.crystals[index];
        if (!c || !this.wisps) return this.time;
        // It enters the stone somewhere in its upper half.
        const f = 0.55 + 0.35 * mulberry32(index * 31 + this.counts.wisps * 7 + salt)();
        const to = [c.x * this.squeeze + c.axis[0] * c.height * f, c.y + c.axis[1] * c.height * f, c.z + c.axis[2] * c.height * f];
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const flight = this.reducedMotion ? 0.12 : WISP_FLIGHT * (0.75 + Math.min(1.4, dist / 34));
        const arrive = this.time + flight;
        this.wisps.launch({
            from,
            to,
            rgb,
            time: this.time,
            flight,
            lift: 0.6 + dist * 0.07,
            size: 0.22 + amount * 0.16,
            bow: (to[0] < from[0] ? -1 : 1) * dist * 0.05,
        });
        this.crystals.strike(index, rgb, arrive, amount);
        const share = this.shards.count / 512;
        this.shards.emit({
            x: to[0],
            y: to[1],
            z: to[2],
            n: Math.round((8 + 14 * amount) * share),
            rgb,
            time: arrive,
            out: [0.5, 2.2 + amount * 2.2],
            up: [0.2, 2.6 + amount * 1.6],
            size: 0.022 + c.height * 0.0022,
        });
        this.counts.wisps += 1;
        return arrive;
    }

    /** Send a ring out over the flats from (x, z) at `time`; `reach` is a fraction of RING_REACH. */
    ring(x, z, time, strength, rgb, reach = 1) {
        const slot = this.lockCursor % LOCK_SLOTS;
        this.lockCursor += 1;
        this.u.lockA[slot].value.set(x, z, time, strength);
        this.u.lockC[slot].value.set(rgb[0] * 1.4, rgb[1] * 1.4, rgb[2] * 1.4, reach);
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
        // ── The ring: the piece lands in the flats under the foot of the board ──
        let fx = 0.5;
        let fy = 0.94;
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            fx = screen.x;
            fy = Math.max(screen.y, 0.7);
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
                fy = Math.max(board.y1, 0.72);
                // The wisp leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        const strike = this.screenToFlats(fx, fy);
        this.ring(strike.x, strike.z, this.time, hardDrop ? 1.25 : 0.8, rgb, 1);

        // ── The wisp: the piece's light flies into a spire ──
        const from = this.screenToWorld(wx, wy, 6.5);
        const target = this.pickTarget(side);
        if (target >= 0) {
            const arrive = this.sendWisp(target, from, rgb, hardDrop ? 1.3 : 0.85);
            // The spire rings: a smaller ripple leaves its foot when the wisp arrives.
            const c = this.plan.crystals[target];
            this.ring(c.x * this.squeeze, c.z, arrive, hardDrop ? 0.95 : 0.65, rgb, 0.36);
            if (hardDrop) {
                // Two more into its neighbours.
                for (let k = 1; k <= 2; k++) {
                    const other = this.pickTarget(side, k);
                    if (other >= 0 && other !== target) this.sendWisp(other, from, rgb, 0.6, k);
                }
            }
        }
        this.kick = Math.max(this.kick, hardDrop ? 0.5 : 0.1);
        this.flash = Math.max(this.flash, hardDrop ? 0.1 : 0.02);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `combo` = the true consecutive-clear combo; `tspin`, `perfect`.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.crystals) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const p = this._palette;
        // One line answers in the bed's light, two in the moon's glow, three in both at once.
        let rgb;
        if (quad) rgb = [...MOONFIRE];
        else if (n === 1) rgb = [...p.bed];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.glow[c] * 0.8 + p.moon[c] * 0.3);
        else rgb = [0, 1, 2].map((c) => p.auroraLow[c] * 0.6 + p.auroraHigh[c] * 0.6 + 0.2);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        const strength = Math.min(1.5, 0.62 + 0.14 * n + (quad ? 0.25 : 0));
        const birth = quad ? this.time + HUSH_HOLD : this.time;

        // ── The wave leaves the foot of the board ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const heart = screen
            ? this.screenToFlats(screen.x, Math.max(screen.y, 0.7))
            : this.screenToFlats(board ? (board.x0 + board.x1) * 0.5 : 0.5, board ? Math.max(board.y1, 0.72) : 0.94);
        uniforms.heart.value.set(heart.x, heart.z);
        const slot = this.clearCursor % CLEAR_SLOTS;
        this.clearCursor += 1;
        uniforms.clearA[slot].value.set(birth, perfect ? 4 : n, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        this.lastClear = { time: birth, lines: n };

        // ── Every spire lets go of what it holds as the wave passes it ──
        const holders = [];
        for (let i = 0; i < this.crystals.count && holders.length < 14; i++) {
            if (this.crystals.heldAt(i, birth) > 0.12) holders.push(i);
        }
        const { released, passes } = this.crystals.release(birth, heart.x, heart.z, rgb, strength, {
            pillar: quad ? 1 : 0, squeeze: this.squeeze,
        });
        const share = this.shards.count / 512;
        for (let k = 0; k < holders.length; k++) {
            const i = holders[k];
            const c = this.plan.crystals[i];
            this.shards.emit({
                x: c.tip[0] - c.x * (1 - this.squeeze),
                y: c.tip[1],
                z: c.tip[2],
                n: Math.round((quad ? 22 : 12) * share),
                rgb,
                time: passes[i],
                out: [0.6, 4.5],
                up: [1.2, 5.5],
                life: [1.0, 2.2],
                size: 0.024 + c.height * 0.0024,
            });
        }
        this.storm = Math.max(this.storm, Math.min(1.4, 0.3 + 0.14 * n + released * 0.06 + (quad ? 0.4 : 0)));
        this.pendingKick = { time: birth + 0.12, amount: 0.22 + 0.1 * n };

        // ── The cleared rows leave the card as blades of moonlight ──
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
        }

        if (quad) {
            // The valley holds its breath, then everything fires.
            this.hushUntil = this.time + HUSH_HOLD;
            this.surge = perfect ? 1.3 : 1;
            this.veinsFlare = 1.5;
            uniforms.shock.value.set(birth, this.reducedMotion ? 0.5 : 1);
            this.meteors?.emit({
                n: Math.round(this.meteors.count * 0.6), time: birth + 0.15, rgb: [1.0, 0.92, 0.8], stagger: 1.7, size: 2.6,
            });
            this.counts.quads += 1;
        } else if (n === 3) {
            this.veinsFlare = Math.max(this.veinsFlare, 0.7);
            this.meteors?.emit({
                n: 3, time: birth + 0.2, rgb: p.moon, stagger: 0.6,
            });
        }
        if (tspin) {
            // The sky itself turns: a small ring from the moon, and the curtains twist.
            uniforms.shock.value.set(this.time, 0.42);
            this.storm = Math.max(this.storm, 0.85);
            this.twist = 1;
        }
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the valley lets its breath go.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.28);
        this.combo = n;
    }

    /** A new level: the valley changes its colours. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % LUNARA_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.storm = Math.max(this.storm, 0.75);
            this.flash = Math.max(this.flash, 0.14);
            this.u?.shock.value.set(this.time, 0.36);
            this.meteors?.emit({
                n: 2, time: this.time + 0.3, rgb: LUNARA_PALETTES[this.paletteIndex].moon, stagger: 0.8,
            });
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = LUNARA_PALETTES[this.paletteIndex];
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] += (target[key][c] - p[key][c]) * k;
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

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.storm *= Math.exp(-dt / 1.7);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.twist *= Math.exp(-dt / 0.6);
        this.veinsFlare *= Math.exp(-dt / 2.4);
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.5);
            this.pendingKick.time = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.12 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;

        // One halo ring for every step of the chain past the first; veins from the third.
        const ringTarget = Math.max(0, Math.min(MAX_RINGS, this.combo - 1));
        this.rings += (ringTarget - this.rings) * approach(ringTarget > this.rings ? 5 : 1.4, dt);
        const veinTarget = smooth(0.35, 1.0, this.power) * 0.8;
        this.veins += (veinTarget - this.veins) * approach(1.6, dt);
        this.applyPalette(approach(0.8, dt));

        // ── The slow clocks ──
        this.orbit += dt * ORBIT_RATE * (1 + (this.power * 5 + this.surge * 10) * (this.reducedMotion ? 0 : 1));
        this.auroraDrift += dt * motion * (0.05 + this.power * 0.16 + this.storm * 0.38 + this.surge * 0.3 + this.twist * 1.6);
        this.moteLift += dt * motion * (1 + this.power * 4 + this.surge * 5 + this.storm * 2);
        this.placeCompanion();

        // A shooting star now and then, on the valley's own clock.
        const beat = Math.floor(t / METEOR_BEAT);
        if (beat !== this.meteorBeat) {
            this.meteorBeat = beat;
            if (dt > 0 && this.meteors) {
                this.meteors.emit({
                    n: 1, time: t + 0.2 + (beat % 3) * 0.9, rgb: this._palette.moon, size: 2.0,
                });
            }
        }

        // ── Uniforms ──
        let ringsLive = 0;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            if (t - u.lockA[i].value.z < RING_LIVE) ringsLive = 1;
        }
        let clearLive = 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            if (t - u.clearA[i].value.x < CLEAR_LIVE) clearLive = 1;
        }
        u.ringsLive.value = ringsLive;
        u.clearLive.value = clearLive;
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        // (Capped: a storm on top of a long chain must leave the sky its darks.)
        u.aurora.value = Math.min(AURORA_MAX, 0.3 + this.power * 0.6 + this.storm * 0.8 + this.surge * 0.35);
        u.auroraDrift.value = this.auroraDrift;
        u.moteLift.value = this.moteLift;
        u.rings.value = this.rings;
        u.veins.value = Math.max(this.veins, this.veinsFlare);
        const p = this._palette;
        const heat = clamp01(this.surge * 0.55);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            node.value.set(
                (c[0] + (MOONFIRE[0] - c[0]) * heat) * gain,
                (c[1] + (MOONFIRE[1] - c[1]) * heat) * gain,
                (c[2] + (MOONFIRE[2] - c[2]) * heat) * gain,
            );
        };
        warm('moon', u.moonCol);
        u.companionCol.value.set(p.companion[0], p.companion[1], p.companion[2]);
        u.zenith.value.set(p.zenith[0], p.zenith[1], p.zenith[2]);
        const lift = 1 + this.power * 0.2 + this.storm * 0.1;
        u.horizon.value.set(p.horizon[0] * lift, p.horizon[1] * lift, p.horizon[2] * lift);
        warm('glow', u.glow, lift);
        u.auroraLow.value.set(p.auroraLow[0], p.auroraLow[1], p.auroraLow[2]);
        u.auroraHigh.value.set(p.auroraHigh[0], p.auroraHigh[1], p.auroraHigh[2]);
        u.bed.value.set(p.bed[0], p.bed[1], p.bed[2]);
        u.crystal.value.set(p.crystal[0], p.crystal[1], p.crystal[2]);

        // The moons' faces fade in when the map arrives (at once in a capture).
        if (this.mapReady && this.mapShown < 1) {
            this.mapShown = this.capture ? 1 : Math.min(1, this.mapShown + dt / MAP_FADE);
            this.mapFade.value = this.mapShown * this.mapShown * (3 - 2 * this.mapShown);
        }
        const sky = this.parts.sky?.mesh;
        if (sky && camera) {
            sky.position.copy(camera.position);
            sky.updateMatrix();
            sky.updateMatrixWorld(true);
        }

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.shafts = hush ? 0.05 : 0.24 + this.power * 0.12 + swell * 0.2;
        post.bloomBoost = this.surge * 0.1 + swell * 0.1;
        // The iris closes as the valley flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 0.95 + swell * 0.4 + this.power * 0.24 + this.storm * 0.16);
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
            rings: this.rings,
            veins: Math.max(this.veins, this.veinsFlare),
            level: this.level,
            palette: LUNARA_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            held: this.crystals ? this.crystals.totalHeld(this.time) : 0,
            crystals: this.crystals ? this.crystals.count : 0,
            targets: { left: this.targets.left.length, right: this.targets.right.length },
            flowers: this.parts.flowers ? this.parts.flowers.count : 0,
            motes: this.parts.motes ? this.parts.motes.count : 0,
            shards: this.shards ? this.shards.count : 0,
            reflection: this.tier.reflection,
            mapReady: this.mapReady,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            orbit: this.orbit,
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
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.reflection = null;
        this.moonMap = null;
        this.mapFade = null;
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.beams = null;
        this.meteors = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as LUNARA_PARTS };
