/**
 * Bioluminescence — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (bioluminescence-theme.js) and the playground effect
 * (src/playground/effects/bioluminescence.effect.js), so what is iterated there ships.
 *
 * The grotto is one organism, wired by mycelium, and the board feeds it:
 *
 *   lock     the piece's light dives into the pool under the board (a ring of plankton sparks in
 *            its colour) and swims to a mushroom on that side. It climbs the stem, the cap blooms
 *            in the piece's colour, puffs spores and keeps the colour. A hard drop sends three
 *            swimmers and hits harder.
 *   clear    the cleared rows leave the card as jets of spores, and a wave of plankton light
 *            rolls out across the pool, one front per line: every mushroom answers as it passes
 *            and breathes out the colour it was holding, the vault's glow-worms ripple.
 *   combo    the grotto wakes: jellies rise out of the pool, fairy rings sprout along the shore,
 *            the glow-worms kindle, the mycelium fills with light, everything beats faster.
 *   four     the Great Bloom. The grotto holds its breath — every light sinks for a quarter of a
 *            second — then the elder mushroom at the heart of the cave erupts: a fountain of
 *            spores to the vault, a ring across the pool, every cap and every jelly at once.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the pool mirrors; 1 = what only the camera sees (swimmers, row jets).
 */

import * as THREE from 'three/webgpu';
import {
    BIOLUM_PALETTES,
    BLOOM_LIFE,
    CLEAR_SLOTS,
    DEG,
    ELDER,
    EMITTER_MAX,
    HUSH_HOLD,
    LOCK_SLOTS,
    NOISE_SIZE,
    PALETTE_KEYS,
    RUNNER_FLIGHT,
    STARSPORE,
    approach,
    bakeNoise,
    clamp01,
    createGrottoUniforms,
    createHeightTexture,
    createNoiseTexture,
    jelliesForCombo,
    mulberry32,
    pieceColor,
    powerForCombo,
    smooth,
} from './bioluminescence-tsl.js';
import { PARASOL, buildPlan, capCentre } from './bioluminescence-layout.js';
import { tierFor } from './bioluminescence-quality.js';
import {
    createBackdrop, createFloor, createIslets, createSpikes, createVault,
} from './bioluminescence-cavern.js';
import { createMushrooms } from './bioluminescence-mushrooms.js';
import { createPads, createWater } from './bioluminescence-water.js';
import { createCrystals } from './bioluminescence-crystals.js';
import {
    createJellies, createMotes, createVines, createWorms,
} from './bioluminescence-air.js';
import { createRowJets, createRunners, createSpores } from './bioluminescence-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './bioluminescence-composition.js';

/** The rest camera: standing in the shallows, looking down the pool and a little up at the caps. */
export const REST_RIG = Object.freeze({
    height: 1.7,
    pitch: 6.5 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 80,
    minFov: 44,
    maxFov: 76,
    near: 0.2,
    far: 700,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Seconds the overdrive after the Great Bloom takes to cool to 1/e. */
export const SURGE_COOL = 3.4;
/** Seconds a ring / a clear wave stays in the grotto (the shaders skip their loops after). */
const RING_LIVE = 5.5;
const CLEAR_LIVE = 8;
/** Lamp strength per square metre of cap, and the elder's share of it (it is far and huge). */
const LAMP_GAIN = 3.2;
/** The lowest cap (metres over the water) a swimmer is sent to. */
export const MIN_TARGET_HEIGHT = 3;
/**
 * Spores an event throws at High (a tier scales them by its pool). The worst frame — a hard drop
 * that clears four lines with every court holding colour — must fit the pool, or the ring that
 * recycles it overwrites the first of them before they are born:
 *   hard drop 16 + 3 caps (28 + 2 × 18) · clear 8 jets × 8 + holders 100 · bloom 240 + 8 caps × 14
 *   = 596 of 640.
 */
const SPORE_BUDGET = Object.freeze({
    splash: 10, splashHard: 16, jet: 8, holders: 150, holdersGreat: 100, elder: 240, court: 14,
});
/** Growth of the fairy rings per second while a chain holds, and their retreat when it breaks. */
const SPROUT_RISE = 0.9;
const SPROUT_FALL = 0.45;

const PARTS = [
    'backdrop', 'vault', 'floor', 'islets', 'spikes', 'water', 'pads', 'elder', 'parasols', 'bells', 'globes', 'crystals',
    'worms', 'threads', 'vines', 'motes', 'jellies', 'spores', 'runners', 'jets',
];

export class BioluminescenceWorld {
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
        this.root.name = 'Bioluminescence';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.reflection = null;
        this.mushrooms = null;
        this.crystals = null;
        this.jellies = null;
        this.spores = null;
        this.runners = null;
        this.jets = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The elder's cap on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.5, y: 0.2 };
        this.targets = { left: [], right: [] };
        /** How near the middle the courts are drawn (1 in landscape; see the `squeeze` uniform). */
        this.squeeze = 1;
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._strike = { x: 0, z: -8 };
        this._from = [0, 0, 0];
        this._cap = [0, 0, 0];
        this._rgb = [0, 0, 0];
        this._rgb2 = [0, 0, 0];
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...BIOLUM_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart, flash: 0, kick: 0, shafts: 0.12, bloomBoost: 0, exposure: 1,
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
        this.swirl = 0;
        this.breath = 1;
        this.sprout = 0;
        this.wake = 0.35;
        this.hushUntil = -1;
        this.lockCursor = 0;
        this.clearCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.pendingSurge = { time: Infinity, amount: 0 };
        this.bloomAt = -100;
        this.counts = {
            locks: 0, clears: 0, blooms: 0, swimmers: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.pulse = time * 0.16;
        this.moteLift = time * motion;
        this.mushrooms?.reset();
        this.crystals?.reset?.();
        this.jellies?.reset(time);
        this.spores?.reset();
        this.runners?.reset();
        this.jets?.reset();
        if (this.u) {
            for (let i = 0; i < LOCK_SLOTS; i++) this.u.lockA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
            this.u.shock.value.set(-100, 0);
        }
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        const heights = createHeightTexture(this.plan.heights);
        this.textures.push(noise, heights);
        const { tier, plan } = this;
        const u = createGrottoUniforms({ noise, heights }, {
            lamps: Math.min(tier.lamps, plan.emitters.length),
            scatter: Math.min(tier.scatter, plan.emitters.length),
        });
        this.u = u;

        this.addPart('backdrop', createBackdrop(u));
        this.addPart('vault', createVault(u, plan));
        this.addPart('floor', createFloor(u, plan));
        this.addPart('islets', createIslets(u, plan));
        this.addPart('spikes', createSpikes(u, plan, tier.spikes));
        const water = createWater(u, plan, { reflectionScale: tier.reflection, sparkle: tier.sparkle });
        this.addPart('water', water);
        if (water.reflectorTarget) this.root.add(water.reflectorTarget);
        this.reflection = water.reflection;
        if (tier.pads > 0) this.addPart('pads', createPads(u, plan, tier.pads));

        this.mushrooms = createMushrooms(u, plan, { count: tier.mushrooms, sprouts: tier.sprouts });
        this.mushrooms.parts.forEach(([name, part]) => this.addPart(name, part));
        this.crystals = createCrystals(u, plan, { count: tier.crystals });
        this.addPart('crystals', this.crystals);

        const worms = createWorms(u, plan, tier.worms, tier.threads);
        this.addPart('worms', worms.worms);
        if (worms.threads) this.addPart('threads', worms.threads);
        if (tier.vines > 0) this.addPart('vines', createVines(u, plan, tier.vines));
        if (tier.motes > 0) this.addPart('motes', createMotes(u, tier.motes));
        this.jellies = createJellies(u, plan, tier.jellies);
        this.addPart('jellies', this.jellies);

        // ── Gameplay effects (pools, always drawn) ──
        this.spores = createSpores(u, tier.spores);
        this.addPart('spores', this.spores);
        this.runners = createRunners(u);
        this.addPart('runners', this.runners, { reflected: false });
        this.jets = createRowJets(u);
        this.addPart('jets', this.jets, { reflected: false });

        this.applyPalette(1);
        this.compose();
        this.findTargets();
        this.jellies.reset(this.time);
        this.updateLamps(this.time);
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
            this.compose();
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
            this.compose();
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

    /** A new run: the grotto back at rest (its slow clocks keep turning). */
    resetSession() {
        const { time, pulse, moteLift } = this;
        this.resetState(time);
        Object.assign(this, { pulse, moteLift });
        // (The palette is not snapped: the frame eases back to the first level's colours.)
    }

    /**
     * The camera sees layer 1 (swimmers, row jets); the pool's mirror must not. Called once the
     * camera that will render the world is known.
     */
    bindCamera(camera) {
        camera.layers.enable(1);
        if (this.reflection) {
            const mirror = this.reflection.reflector.getVirtualCamera(camera);
            mirror.layers.set(0);
        }
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
        cam.position.set(0, REST_RIG.height, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, REST_RIG.height + Math.tan(REST_RIG.pitch) * 10, -10);
        cam.updateMatrixWorld();
        return cam;
    }

    /**
     * An upright screen is too narrow to see where the courts stand: everything rooted in the
     * water is drawn nearer the middle of the pool there.
     */
    compose() {
        this.squeeze = 0.46 + 0.54 * smooth(0.62, 1.25, this.aspect);
        if (this.u) this.u.squeeze.value = this.squeeze;
    }

    /** How far across the pool a planned mushroom is drawn from where the plan put it. */
    shift(m) {
        return m && m.court ? m.x * (this.squeeze - 1) : 0;
    }

    /**
     * How far a court's mushroom that stood on a bank is lowered to stand in the water it is
     * drawn in on an upright screen (≤ 0). The twin of the shader's `moved` term.
     */
    drop(m) {
        if (!m || !m.court) return 0;
        const moved = Math.max(0, Math.min(1, (1 - this.squeeze) / 0.54));
        return (Math.min(m.y, -0.12) - m.y) * moved;
    }

    /** Where a planned mushroom's foot is drawn across the pool. */
    drawnX(m) {
        return m.x + this.shift(m);
    }

    /**
     * Which mushrooms a swimmer can be sent to: the ones that stand tall enough to read, that the
     * rest camera sees clear of the card, split by the side of the card they stand on, nearest
     * first.
     */
    findTargets() {
        const left = [];
        const right = [];
        if (this.mushrooms) {
            const cam = this.restCamera();
            const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
            const centre = (card.x0 + card.x1) * 0.5;
            const { list } = this.mushrooms;
            for (let i = 1; i < list.length; i++) {
                const m = list[i];
                if (m.kind === 'sprout' || m.species !== PARASOL) continue;
                // The heroes carry a lamp, so their bloom lights the court round them; of the rest
                // only the tall ones read.
                if (m.kind !== 'hero' && m.height < MIN_TARGET_HEIGHT) continue;
                capCentre(m, this._cap);
                this._vec.set(this._cap[0] + this.shift(m), this._cap[1] + this.drop(m), this._cap[2]).project(cam);
                if (this._vec.z > 1 || Math.abs(this._vec.x) > 0.95 || this._vec.y > 1.1 || this._vec.y < -0.9) continue;
                const sx = this._vec.x * 0.5 + 0.5;
                if (sx > card.x0 - 0.02 && sx < card.x1 + 0.02) continue;
                // How much of the picture the cap is: a lock mostly feeds the caps you can see best.
                const size = m.capR / Math.max(4, Math.hypot(m.x, m.z));
                const entry = { index: i, weight: size * size * (m.kind === 'hero' ? 1 : 0.3) };
                (sx < centre ? left : right).push(entry);
            }
            const byWeight = (a, b) => b.weight - a.weight;
            left.sort(byWeight);
            right.sort(byWeight);
        }
        this.targets = { left, right };
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.7 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of someone standing in the water, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.11) * 0.36 + Math.sin(t * 0.063 + 1.3) * 0.26) * calm;
        const swayY = (Math.sin(t * 0.17 + 0.7) * 0.045 + Math.sin(t * 0.079) * 0.035) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(swayX + px * 0.7, REST_RIG.height + swayY - py * 0.22 - this.kick * 0.04 * calm, 0);
        const yaw = (Math.sin(t * 0.083 + 2.1) * 0.012 - px * 0.03) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.097) * 0.006 - py * 0.018) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            -10,
        );
        camera.up.set(Math.sin(t * 0.07) * 0.004 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
        // The elder's cap on screen: where the shafts come from.
        this._ray.set(ELDER.x, ELDER.height + 1, ELDER.z).project(camera);
        this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
        this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
    }

    /**
     * Where a ray through a screen point (fractions, y down) meets the water. Points above the
     * horizon (or absurdly far) land `far` metres ahead instead.
     */
    screenToWater(sx, sy, out = this._strike, far = 9) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0;
            out.z = -far;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : Infinity;
        const dist = Math.hypot(this._ray.x, this._ray.z) * t;
        if (!Number.isFinite(dist) || dist > 40) {
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

    /**
     * Pick the mushroom a lock on `side` (−1 left, +1 right) feeds: by weight, so the great caps
     * of that court answer most often. Nothing in `avoid` (a Set) is picked: a hard drop's
     * three swimmers go to three caps.
     */
    pickTarget(side, salt = 0, avoid = null) {
        let list = side < 0 ? this.targets.left : this.targets.right;
        if (!list.length) list = side < 0 ? this.targets.right : this.targets.left;
        if (!list.length) return -1;
        let total = 0;
        for (let i = 0; i < list.length; i++) if (!avoid?.has(list[i].index)) total += list[i].weight;
        if (!(total > 0)) return -1;
        let at = mulberry32(0x2b1d + (this.counts.locks + 1) * 2654435761 + salt * 97)() * total;
        for (let i = 0; i < list.length; i++) {
            if (avoid?.has(list[i].index)) continue;
            at -= list[i].weight;
            if (at <= 0) return list[i].index;
        }
        return list[list.length - 1].index;
    }

    /**
     * A cap sheds: spores fall out of its gills in `rgb` from `time`, a slow shower under the
     * whole cap, down to the water.
     */
    puff(index, rgb, time, amount, most = Infinity) {
        const m = this.mushrooms.list[index];
        if (!m || !this.spores) return;
        capCentre(m, this._cap);
        const share = this.spores.count / 640;
        this.spores.emit({
            x: this._cap[0] + this.shift(m),
            y: this._cap[1] + this.drop(m) - m.capR * 0.05,
            z: this._cap[2],
            // (`most` keeps a whole grotto shedding at once inside the pool: see SPORE_BUDGET.)
            n: Math.round(Math.min(10 + 14 * amount, most) * share),
            rgb,
            time,
            spread: m.capR * 0.92,
            out: [0.02, 0.3],
            up: [-0.5 - amount * 0.5, -0.1],
            life: [1.6, 3.2 + m.height * 0.16],
            size: 0.034 + m.capR * 0.008,
            stagger: 0.55,
            gravity: 0.16,
        });
    }

    /** Send one swimmer from a point on the water to the foot of mushroom `index`. Returns its bloom time. */
    sendSwimmer(index, from, rgb, amount, salt = 0) {
        const m = this.mushrooms.list[index];
        if (!m) return this.time;
        const tx = this.drawnX(m);
        const dist = Math.hypot(tx - from.x, m.z - from.z);
        const flight = this.reducedMotion ? 0.12 : RUNNER_FLIGHT * (0.6 + Math.min(1.6, dist / 16));
        const arrive = this.time + flight;
        this.runners?.launch({
            from: [from.x, from.z],
            to: [tx, m.z],
            rgb,
            time: this.time,
            flight,
            bow: (salt % 2 ? -1 : 1) * (tx < from.x ? -1 : 1) * dist * (0.12 + 0.05 * salt),
            size: 0.26 + amount * 0.1,
        });
        const bloom = this.mushrooms.strike(index, rgb, arrive, amount, this.time);
        this.puff(index, rgb, bloom, amount);
        this.counts.swimmers += 1;
        return arrive;
    }

    /** Send a ring out over the pool from (x, z) at `time`; `reach` is a fraction of RING_REACH. */
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
        if (!uniforms || !this.mushrooms) return;
        const rgb = pieceColor(color);
        // (Nothing that is not a number may reach the uniforms: it would never leave.)
        const col = Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : 0.5;
        const point = screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
        // ── The dive: the piece's light enters the pool under the foot of the board ──
        let fx = 0.5;
        let fy = 0.93;
        let side = col < 0.5 ? -1 : 1;
        if (Math.abs(col - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (point) {
            fx = point.x;
            fy = Math.max(point.y, 0.7);
            side = point.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            if (board) {
                const mid = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                const row = Number.isFinite(mid) ? mid : 19;
                boardPoint(board, col, row, this._point);
                fx = this._point.x;
                fy = Math.max(board.y1, 0.74);
            }
        }
        const strike = this.screenToWater(fx, fy);
        const sx = strike.x;
        const sz = strike.z;
        this.ring(sx, sz, this.time, hardDrop ? 1.25 : 0.8, rgb, hardDrop ? 1 : 0.8);
        // A splash of sparks where it goes in.
        if (this.spores) {
            const share = this.spores.count / 640;
            this.spores.emit({
                x: sx,
                y: 0.05,
                z: sz,
                n: Math.round((hardDrop ? SPORE_BUDGET.splashHard : SPORE_BUDGET.splash) * share),
                rgb,
                time: this.time,
                spread: 0.25,
                out: [0.4, hardDrop ? 3.2 : 1.8],
                up: [0.8, hardDrop ? 4.2 : 2.4],
                life: [0.5, 1.3],
                size: 0.028,
                gravity: 4.5,
            });
        }

        // ── The swim: it crosses the water to a mushroom, climbs it, and the cap blooms ──
        const from = { x: sx, z: sz };
        const target = this.pickTarget(side);
        if (target >= 0) {
            const arrive = this.sendSwimmer(target, from, rgb, hardDrop ? 1.3 : 0.85);
            const m = this.mushrooms.list[target];
            this.ring(this.drawnX(m), m.z, arrive, hardDrop ? 0.9 : 0.6, rgb, 0.3);
            if (hardDrop) {
                const taken = new Set([target]);
                for (let k = 1; k <= 2; k++) {
                    const other = this.pickTarget(side, k, taken);
                    if (other < 0) break;
                    taken.add(other);
                    this.sendSwimmer(other, from, rgb, 0.6, k);
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
        if (!uniforms || !this.mushrooms) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const great = n >= 4 || perfect;
        const p = this._palette;
        // One line answers in the plankton's light, two in the caps', three in both and the accent;
        // four in all of them at once (never white: a white wave bleaches every cap it lights).
        let rgb;
        if (great) rgb = [0, 1, 2].map((c) => p.primary[c] * 0.55 + p.plankton[c] * 0.55 + p.accent[c] * 0.4);
        else if (n === 1) rgb = [...p.plankton];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.primary[c] * 0.8 + p.plankton[c] * 0.3);
        else rgb = [0, 1, 2].map((c) => p.primary[c] * 0.5 + p.accent[c] * 0.6 + 0.15);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        const strength = Math.min(1.5, 0.62 + 0.14 * n + (great ? 0.25 : 0));
        const birth = great ? this.time + HUSH_HOLD : this.time;

        // ── The wave leaves the foot of the board ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const point = screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
        const heart = point
            ? this.screenToWater(point.x, Math.max(point.y, 0.7))
            : this.screenToWater(board ? (board.x0 + board.x1) * 0.5 : 0.5, board ? Math.max(board.y1, 0.74) : 0.93);
        const hx = heart.x;
        const hz = heart.z;
        const slot = this.clearCursor % CLEAR_SLOTS;
        this.clearCursor += 1;
        // Each clear keeps its own origin: a second one must not re-centre a wave still rolling.
        uniforms.heart.value.set(hx, hz);
        uniforms.clearH[slot].value.set(hx, hz);
        uniforms.clearA[slot].value.set(birth, perfect ? 4 : n, strength, great ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        this.lastClear = { time: birth, lines: n };

        // ── Every mushroom breathes out what it holds as the wave passes it ──
        const holders = [];
        const { list } = this.mushrooms;
        for (let i = 0; i < list.length && holders.length < 14; i++) {
            if (this.mushrooms.heldAt(i, birth) > 0.12) holders.push([i, this.mushrooms.heldColor(i, birth, [0, 0, 0])]);
        }
        const { released, passes } = this.mushrooms.release(birth, hx, hz, rgb, strength, { squeeze: this.squeeze });
        const each = (great ? SPORE_BUDGET.holdersGreat : SPORE_BUDGET.holders) / Math.max(1, holders.length);
        for (let k = 0; k < holders.length; k++) {
            const [i, held] = holders[k];
            const hp = Math.max(held[0], held[1], held[2], 1e-4);
            this.puff(i, held.map((c) => c / hp), passes[i], great ? 2.2 : 1.5, each);
        }
        this.storm = Math.max(this.storm, Math.min(1.4, 0.3 + 0.14 * n + released * 0.06 + (great ? 0.4 : 0)));
        this.pendingKick = { time: birth + 0.12, amount: 0.22 + 0.1 * n };
        this.jellies?.flash(birth + 0.25, 0.6 + 0.15 * n);

        // ── The cleared rows leave the card as jets of spores ──
        if (board && card && this.layoutLive && !point) {
            const given = Array.isArray(rows) ? rows.filter((r) => Number.isFinite(r)) : [];
            const listRows = given.length ? given : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < listRows.length && i < 4; i++) ys.push(boardPoint(board, 0.5, listRows[i], this._point).y);
            this.jets?.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
            if (this.spores) {
                const share = this.spores.count / 640;
                for (let i = 0; i < ys.length; i++) {
                    for (let s = -1; s <= 1; s += 2) {
                        const at = this.screenToWorld(s < 0 ? card.x0 : card.x1, ys[i], 5.5);
                        this.spores.emit({
                            x: at[0],
                            y: at[1],
                            z: at[2],
                            n: Math.round(SPORE_BUDGET.jet * share),
                            rgb,
                            time: this.time,
                            spread: 0.12,
                            push: [s * 3.4, 0.2, -0.6],
                            out: [0.1, 1.1],
                            up: [-0.3, 0.9],
                            life: [0.9, 2.4],
                            size: 0.022,
                            stagger: 0.12,
                        });
                    }
                }
            }
        }

        if (great) this.greatBloom(birth, perfect);
        else if (n === 3) this.crystals?.chime?.(birth + 0.1, 0.7);
        if (tspin) {
            // The air itself turns, and the crystals ring.
            this.swirl = 1;
            this.storm = Math.max(this.storm, 0.85);
            this.crystals?.chime?.(this.time, 1);
        }
        this.counts.clears += 1;
    }

    /** Four lines (or a perfect clear): the elder erupts. */
    greatBloom(birth, perfect) {
        const { u: uniforms } = this;
        this.hushUntil = this.time + HUSH_HOLD;
        // The overdrive starts when the elder blooms, not while the grotto holds its breath.
        this.pendingSurge = { time: birth, amount: perfect ? 1.3 : 1 };
        this.bloomAt = birth;
        uniforms.shock.value.set(birth, this.reducedMotion ? 0.5 : 1);
        this.mushrooms.fire(0, [STARSPORE[0] * 1.3, STARSPORE[1] * 1.3, STARSPORE[2] * 1.3], birth, 1);
        this.jellies?.flash(birth, 1.6);
        this.crystals?.chime?.(birth, 1.2);
        if (this.spores) {
            const elder = this.mushrooms.list[0];
            capCentre(elder, this._cap);
            const share = this.spores.count / 640;
            // The shower: out of the elder's gills, the whole width of its cap, in every colour
            // the grotto has, down onto the pool.
            const p = this._palette;
            const colours = [STARSPORE, p.primary, p.accent, p.secondary, p.plankton, STARSPORE];
            for (let k = 0; k < colours.length; k++) {
                this.spores.emit({
                    x: this._cap[0],
                    y: this._cap[1] - 0.5,
                    z: this._cap[2],
                    n: Math.round((SPORE_BUDGET.elder / colours.length) * share),
                    rgb: colours[k],
                    time: birth + k * 0.07,
                    spread: elder.capR * 0.96,
                    push: [0, 0, 2.5],
                    out: [0.2, 2.4],
                    up: [-5.5, -0.8],
                    life: [2.6, BLOOM_LIFE + 2.4],
                    size: 0.42,
                    stagger: 1.4,
                    gravity: 0.5,
                });
            }
            // And every cap in the two courts answers.
            for (let i = 1; i < Math.min(this.plan.heroCount, 9); i++) {
                this.puff(i, STARSPORE, birth + 0.25 + i * 0.05, 1.1, SPORE_BUDGET.court);
            }
        }
        this.counts.blooms += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the grotto lets its breath go.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.28);
        this.combo = n;
        this.jellies?.setTarget(jelliesForCombo(n, this.jellies.count), this.time);
    }

    /** A new level: the grotto changes its colours. */
    levelUp(level, { silent = false } = {}) {
        const asked = Number(level);
        this.level = Number.isFinite(asked) ? Math.max(1, Math.round(asked)) : 1;
        this.paletteIndex = (this.level - 1) % BIOLUM_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.storm = Math.max(this.storm, 0.75);
            this.flash = Math.max(this.flash, 0.14);
            this.jellies?.flash(this.time, 1);
            this.crystals?.chime?.(this.time + 0.1, 0.8);
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = BIOLUM_PALETTES[this.paletteIndex];
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] += (target[key][c] - p[key][c]) * k;
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    /** The lamps the rock, the caps, the water and the mist evaluate: where, how bright, what colour. */
    updateLamps(t) {
        const { u, plan, mushrooms } = this;
        if (!u) return;
        const p = this._palette;
        const rows = u.lampRows;
        const count = Math.min(EMITTER_MAX, plan.emitters.length);
        const wake = 1 + this.power * 0.4;
        const heat = clamp01(this.surge * 0.5);
        for (let k = 0; k < EMITTER_MAX; k++) {
            const pos = rows[k * 2];
            const col = rows[k * 2 + 1];
            if (k >= count) {
                pos.set(0, -1000, 0, 1);
                col.set(0, 0, 0, 0);
                continue;
            }
            const e = plan.emitters[k];
            const rooted = e.kind === 'cap' ? mushrooms?.list[e.source] : null;
            // A cap's lamp moves with its mushroom; the crystals stand in the pool and always do.
            pos.set(rooted ? e.x + this.shift(rooted) : e.x * this.squeeze, e.y + this.drop(rooted), e.z, e.radius);
            let base = p.crystal;
            if (e.family < 0.5) base = p.primary;
            else if (e.family < 1.5) base = p.secondary;
            else if (e.family < 2.5) base = p.accent;
            const rgb = this._rgb;
            rgb[0] = base[0];
            rgb[1] = base[1];
            rgb[2] = base[2];
            let gain = e.gain * LAMP_GAIN * wake * this.breath;
            let extra = null;
            if (rooted && mushrooms) {
                const { seed } = rooted;
                gain *= 0.84 + 0.16 * Math.sin(t * 0.62 + seed * 0.71);
                // What the cap holds colours its lamp, as it colours the cap.
                const held = mushrooms.heldColor(e.source, t, this._rgb2);
                const mag = Math.max(held[0], held[1], held[2]);
                if (mag > 1e-3) {
                    const k2 = Math.min(0.95, mag * 2.2);
                    for (let c = 0; c < 3; c++) rgb[c] += (held[c] / mag - rgb[c]) * k2;
                }
                extra = mushrooms.flashAt(e.source, t, this._rgb2);
            }
            // The elder burns in its own spores' colour while the Great Bloom lasts.
            if (k === 0) for (let c = 0; c < 3; c++) rgb[c] += (STARSPORE[c] - rgb[c]) * heat;
            const flare = extra ? e.gain * LAMP_GAIN * 0.32 * this.breath : 0;
            col.set(
                rgb[0] * gain + (extra ? extra[0] * flare : 0),
                rgb[1] * gain + (extra ? extra[1] * flare : 0),
                rgb[2] * gain + (extra ? extra[2] * flare : 0),
                0,
            );
        }
    }

    update(sim) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;

        // ── How awake the grotto is ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.storm *= Math.exp(-dt / 1.7);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.swirl *= Math.exp(-dt / 0.9);
        if (t >= this.pendingSurge.time) {
            this.surge = Math.max(this.surge, this.pendingSurge.amount);
            this.pendingSurge.time = Infinity;
        }
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.5);
            this.pendingKick.time = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.12 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;

        // Fairy rings rise with a chain (from its second step) and retreat when it breaks.
        const sproutTarget = clamp01((this.combo - 1) / 7);
        const rate = sproutTarget > this.sprout ? SPROUT_RISE : SPROUT_FALL;
        this.sprout += Math.sign(sproutTarget - this.sprout) * Math.min(Math.abs(sproutTarget - this.sprout), rate * dt);
        if (dt === 0) this.sprout = sproutTarget;
        const wakeTarget = Math.min(1, 0.35 + this.power * 0.55 + this.surge * 0.4 + this.storm * 0.15);
        this.wake += (wakeTarget - this.wake) * approach(wakeTarget > this.wake ? 2.5 : 0.6, dt);
        this.applyPalette(approach(0.8, dt));

        // ── The slow clocks ──
        this.pulse += dt * motion * (0.16 + this.power * 0.5 + this.surge * 0.5);
        this.moteLift += dt * motion * (1 + this.power * 3.5 + this.surge * 5 + this.storm * 2);

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
        u.pulse.value = this.pulse;
        u.moteLift.value = this.moteLift;
        u.wake.value = this.wake;
        u.sprout.value = this.sprout;
        u.swirl.value = this.swirl * motion;
        const p = this._palette;
        PALETTE_KEYS.forEach((key) => {
            u[key].value.set(p[key][0], p[key][1], p[key][2]);
        });
        this.updateLamps(t);
        this.jellies?.update(t);

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.shafts = hush ? 0.03 : 0.1 + this.power * 0.1 + this.surge * 0.75 + swell * 0.12;
        post.bloomBoost = this.surge * 0.06 + swell * 0.05;
        // The iris closes as the grotto flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 0.5 + swell * 0.3 + this.power * 0.22 + this.storm * 0.1);
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
            sprout: this.sprout,
            wake: this.wake,
            level: this.level,
            palette: BIOLUM_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            held: this.mushrooms ? this.mushrooms.totalHeld(this.time) : 0,
            mushrooms: this.mushrooms ? this.mushrooms.count : 0,
            targets: { left: this.targets.left.length, right: this.targets.right.length },
            favourite: { left: this.targets.left[0]?.index ?? -1, right: this.targets.right[0]?.index ?? -1 },
            jellies: this.jellies ? this.jellies.up : 0,
            crystals: this.crystals ? this.crystals.count : 0,
            spores: this.spores ? this.spores.count : 0,
            reflection: this.tier.reflection,
            squeeze: this.squeeze,
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
        this.reflection?.dispose?.();
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.reflection = null;
        this.mushrooms = null;
        this.crystals = null;
        this.jellies = null;
        this.spores = null;
        this.runners = null;
        this.jets = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as BIOLUMINESCENCE_PARTS };
