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
 *            the two great crystals let go of what they were holding. In a chain they let go of
 *            only part of it and the wave pours more in: the Apex, against the open sky, keeps
 *            the chain's light (up to nearly twice its resting fill) until it burns like a star;
 *            the Halcyon, before the sun, pours half back each time and keeps its resting fill.
 *            Each wave of a cascade runs stronger, with one more front, and rings the lagoon
 *            further out than the last.
 *   combo    the sanctuary lifts: pair by pair the ley shards rise off their plinths, the stones'
 *            crystals follow, drops of the lagoon bead up into the air, the splinters round the
 *            great crystals swing wider and faster, the clouds part.
 *   four     the sanctuary holds its breath — every light sinks for a fifth of a second; mid-
 *            fever it only inhales — then everything fires: a ring of light opens over the sky,
 *            everything that floats is thrown up, and as the wave reaches each great crystal it
 *            empties all it held into a beacon that stands into the sky, as tall as what it held.
 *   perfect  the crown on the clear still playing (physics settles it a moment after the clear):
 *            a second ring over the sky, both crystals pour out into their pillars, the flock is
 *            thrown again. Never a second hush, never a second wave.
 *   b2b      the two great crystals answer each other: a pillar stands on each, a second ring
 *            opens over the sky, and the wave burns in sunfire whatever it cleared.
 *   end      the chain is over: the great crystals pour out what it gave them (a pillar each, as
 *            tall as what they kept), and what it lifted drifts back down over several seconds.
 *
 * Under it all runs the heat of play (src/themes/shared/gameplay-surge.js): every event adds to
 * what is still lit and nothing restarts. Calm play looks as it always did. A quick hand wakes
 * the sanctuary (the ley and the crystals glow, the lagoon's wind rises, the first shards leave
 * their plinths); hot play lifts it (shards and stones aloft, beads streaming up, the splinters
 * swinging wide, the flock climbing, the light the crystals hold leaning to the hour's crystal
 * hue); a fever takes it into the air entire: the ley lines burn gold against the crystals' own
 * colour, the zenith and the deep water darken, the iris closes so the colours stay deep. When
 * the hands rest it breathes back to calm over a few seconds.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the lagoon mirrors; 1 = what only the camera sees (wisps, row beams).
 */

import * as THREE from 'three/webgpu';
import { float, shadow } from 'three/tsl';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell, softCeiling } from '../shared/gameplay-surge.js';
import {
    CLEAR_AFTERGLOW,
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
    PULSE_AFTERGLOW,
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
    smooth,
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
/** Seconds after a clear's wave leaves that the camera takes the blow. */
export const CLEAR_KICK_DELAY = 0.12;
/**
 * What a great crystal lets go of leaves it at this rate (1/s): the light pours out over a
 * quarter of a second as its sparks fly, instead of vanishing in a frame.
 */
export const POUR_RATE = 6;
/**
 * How much more than HOLD_MAX each great crystal holds at the height of a chain (a chain of nine):
 * the Apex, against the open sky, stores the chain and becomes a star; the Halcyon hangs before
 * the sun, where more light would only whiten the glare, so it keeps its resting fill.
 */
export const HOLD_CHAIN = Object.freeze([0.85, 0]);
/** The Halcyon's pillar stands before the sun: it burns this much of the Apex's light and width. */
export const HALCYON_PILLAR = Object.freeze([0.3, 0.25]);
/**
 * In a chain, the share of what it keeps that each great crystal spends as a clear's wave passes:
 * the Apex hoards, the Halcyon pours half of it back into the lagoon every time.
 */
export const CHAIN_SPEND = Object.freeze([0.2, 0.5]);
/** The most the overdrive of stacked four-line clears and crowns rises to. */
const OVERDRIVE_CEILING = 2.0;

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
        // ── Envelopes that accumulate (src/themes/shared/swell.js): a new event adds to what is
        //    still lit and never restarts it, so a weak one after a strong one never cuts the light ──
        /** The overdrive after a four-line clear (a perfect clear, a crown, a back-to-back add to it). */
        this.overdrive = new Swell({ release: SURGE_COOL, ceiling: OVERDRIVE_CEILING, knee: 1.4 });
        /** The camera's blow and the post's flash. */
        this.kicks = new Swell({ release: 0.16, ceiling: 1.2, knee: 0.8 });
        this.flashes = new Swell({ release: 0.25, ceiling: 0.35, knee: 0.25 });
        /** The swell of light after a clear (the sun's shafts, the bloom, the iris). */
        this.afterglow = new Swell({ release: 0.7, ceiling: 1.3, knee: 0.85 });
        /** Each great crystal's beacon: the pillar's light, and the burst of width it stands up with. */
        this.blaze = [0, 1].map(() => new Swell({ release: 1 / 0.9, ceiling: 2.2, knee: 1.5 }));
        this.flare = [0, 1].map(() => new Swell({ release: 1 / 7, ceiling: 1.4, knee: 1 }));
        /** How hot play runs: punch, level, fever and the act (calm, warm, hot, fever). */
        this.gameplay = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
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
        /** How deep the last four-line clear's hush goes (1 from cold; mid-fever it only inhales). */
        this.hushDepth = 1;
        this.lockCursor = 0;
        /**
         * What the Apex [0] and the Halcyon [1] hold (what they show, including what is still
         * pouring out of them), what is pouring out, and its colour.
         */
        this.held = [0, 0];
        this.outflow = [0, 0];
        this.heldColor = [[1, 1, 1], [1, 1, 1]];
        this.arrivals.length = 0;
        this.counts = {
            locks: 0, clears: 0, quads: 0, crowns: 0, spins: 0, wisps: 0, pulses: 0,
        };
        this.overdrive.reset();
        this.kicks.reset();
        this.flashes.reset();
        this.afterglow.reset();
        this.blaze.forEach((swell) => swell.reset());
        this.flare.forEach((swell) => swell.reset());
        this.gameplay.reset();
        Object.assign(this.heat, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
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
            this.u.shock.value.set(-100, 0, -100, 0);
            this.u.beacon.value.set(0, 0, 0, 0);
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
        // The shared breath (shared/camera-breath.js) on top of the drift above: an eye-level
        // view out across the lagoon, so it only turns. Off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
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

    /** Fold an arrival into one already queued for the same crystal. */
    static fold(queued, entry) {
        if (entry.kind === 'hold') {
            queued.amount = Math.min(HOLD_MAX, queued.amount + entry.amount);
            queued.rgb = entry.rgb;
            return;
        }
        queued.amount = Math.max(queued.amount, entry.amount);
        queued.quad = queued.quad || entry.quad;
        queued.spend = Math.max(queued.spend ?? 1, entry.spend ?? 1);
        queued.feed = Math.max(queued.feed ?? 0, entry.feed ?? 0);
        queued.pillar = Math.max(queued.pillar ?? 0, entry.pillar ?? 0);
        queued.pour = Math.max(queued.pour ?? 0, entry.pour ?? 0);
    }

    /**
     * Something that happens later on the world clock. The queue is kept in time order. What
     * would land on the same crystal at the same moment is folded into what is already queued
     * (a flood of locks is a handful of arrivals); once the queue is full, what comes after is
     * folded into the nearest arrival on the same crystal, so no light is ever lost.
     */
    schedule(entry) {
        const { arrivals } = this;
        let nearest = null;
        for (let k = 0; k < arrivals.length; k++) {
            const queued = arrivals[k];
            if (queued.kind !== entry.kind || queued.line !== entry.line) continue;
            const gap = Math.abs(queued.time - entry.time);
            if (gap <= ARRIVAL_FOLD) {
                HalcyonApexWorld.fold(queued, entry);
                return;
            }
            if (!nearest || gap < Math.abs(nearest.time - entry.time)) nearest = queued;
        }
        if (arrivals.length >= ARRIVALS_MAX) {
            if (nearest) HalcyonApexWorld.fold(nearest, entry);
            return;
        }
        let i = arrivals.length;
        while (i > 0 && arrivals[i - 1].time > entry.time) i -= 1;
        arrivals.splice(i, 0, entry);
    }

    /**
     * The pulse slot a new packet takes: a free one (its packet home and its warmth spent), else
     * the one that reached its crystal longest ago; while every packet is still on its way, the
     * one nearest home (it has the least road left to show).
     */
    pulseSlot() {
        const { pulseA } = this.u;
        let best = 0;
        let bestDone = -Infinity;
        for (let i = 0; i < PULSE_SLOTS; i++) {
            const A = pulseA[i].value;
            if (!(A.z > 0)) return i;
            const length = A.y < 0.5 ? LEY_A.length : LEY_B.length;
            const done = this.time - (A.x + length / PULSE_SPEED);
            if (done > PULSE_AFTERGLOW) return i;
            if (done > bestDone) {
                bestDone = done;
                best = i;
            }
        }
        return best;
    }

    /**
     * Send a pulse up ley line `line` (0 = the causeway, 1 = the dial) so that its packet is at
     * arc length `s0` at `time`. Its crystal keeps the light when the pulse arrives.
     */
    sendPulse(line, s0, time, rgb, strength) {
        const slot = this.pulseSlot();
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
        this.strike(hardDrop ? 0.5 : 0.1, hardDrop ? 0.1 : 0.02, this.time);
        this.gameplay.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * A blow for the camera and a flash for the post at `at` (a moment ahead is fine), added to
     * whatever is still lit: under a quick hand they ride on a floor instead of flickering.
     */
    strike(kick, flash, at) {
        this.kicks.hit(kick, at);
        this.flashes.hit(flash, at);
        if (at <= this.time) {
            this.kick = this.kicks.valueAt(this.time);
            this.flash = this.flashes.valueAt(this.time);
        }
    }

    /** The overdrive takes `amount` more at `at`. */
    addOverdrive(amount, at) {
        this.overdrive.hit(amount, at);
        if (at <= this.time) this.surge = this.overdrive.valueAt(this.time);
    }

    /**
     * A ring of light over the sky from the Apex, born at `birth`. Two can be open at once: a new
     * one takes the slot with less light left, so a level's faint ring never cuts a four-line
     * clear's, and a second four-line clear opens beside the first instead of pulling it back.
     */
    shockRing(birth, strength) {
        const s = this.u.shock.value;
        const left = (born, k) => (k > 0 ? k * Math.exp(-Math.max(0, this.time - born) * 1.5) : 0);
        if (left(s.x, s.y) <= left(s.z, s.w)) {
            s.x = birth;
            s.y = strength;
        } else {
            s.z = birth;
            s.w = strength;
        }
    }

    /**
     * The clear slot a new wave takes: a free one, else the one with the least light left (its
     * afterglow furthest gone), so a wave still running out through the sanctuary is never cut.
     */
    clearSlot() {
        const { clearA } = this.u;
        let best = 0;
        let least = Infinity;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = clearA[i].value;
            const age = this.time - A.x;
            if (!(A.z > 0) || age > CLEAR_LIVE) return i;
            const left = A.z * Math.exp(-Math.max(0, age) / CLEAR_AFTERGLOW);
            if (left < least) {
                least = left;
                best = i;
            }
        }
        return best;
    }

    /** What great crystal `line` can hold now: a chain raises its fill (the Apex's to nearly twice HOLD_MAX). */
    holdCap(line) {
        return HOLD_MAX * (1 + HOLD_CHAIN[line] * clamp01((this.combo - 1) / 8));
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b`; `cascade` = the deepest wave of the
     * lock's cascade (1 = its first), `combo` = the true chain this clear belongs to.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, b2b = false, cascade = 1, combo = 1, player = 0,
        screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.crystals) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const back = b2b === true;
        /** Waves of a cascade past its first, and steps of the chain past its first clear. */
        const deeper = Math.max(0, Math.min(9, Math.round(Number(cascade) || 1) - 1));
        const chain = Math.max(1, Math.round(Number(combo) || 1));
        const steps = Math.min(LIFT_MAX, chain - 1);
        const p = this._palette;
        // One line answers in the ley's light, two in the crystal's, three in both at once.
        // A back-to-back burns in sunfire like a four-line clear: the second difficult clear is
        // gold whatever it cleared.
        const fire = quad || back;
        let rgb;
        if (fire) rgb = [...SUNFIRE];
        else if (n === 1) rgb = [...p.ley];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.crystal[c] * 0.7 + p.glow[c] * 0.45);
        else rgb = [0, 1, 2].map((c) => p.ley[c] * 0.6 + p.glow[c] * 0.6 + 0.15);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        // Deeper waves (a cascade's later ones) and longer chains run stronger, in their own colour.
        const strength = Math.min(1.5, 0.62 + 0.14 * n + (quad ? 0.25 : 0) + 0.07 * deeper + 0.02 * steps
            + (back ? 0.1 : 0));
        const birth = quad ? this.time + HUSH_HOLD : this.time;

        // ── The wave leaves the foot of the board ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const heart = screen
            ? this.screenToLagoon(screen.x, Math.max(screen.y, 0.72))
            : this.screenToLagoon(board ? (board.x0 + board.x1) * 0.5 : 0.5, board ? Math.max(board.y1, 0.74) : 0.94);
        const slot = this.clearSlot();
        uniforms.clearH[slot].value.set(heart.x, heart.z);
        // A cascade's later waves carry one front more (up to four).
        const fronts = perfect ? 4 : Math.min(4, n + (deeper > 0 ? 1 : 0));
        uniforms.clearA[slot].value.set(birth, fronts, strength, fire ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        this.afterglow.hit(0.3 + 0.12 * n + 0.06 * deeper, birth);

        // ── The two great crystals as the wave reaches them ──
        // A clear on its own: they let go of everything they hold. In a chain (or a cascade's
        // later waves) they spend a little of it and the wave pours more in: they build. A
        // four-line clear (or a perfect clear) is the payoff: everything they hold goes up their
        // beacons, as tall as what they held. A back-to-back stands a pillar on each as well.
        const building = !quad && (chain >= 2 || deeper > 0);
        const spend = (line) => (building ? CHAIN_SPEND[line] : 1);
        const feed = building ? 0.45 + 0.2 * n + 0.25 * deeper + (back ? 0.4 : 0) : 0;
        let pillar = 0;
        if (quad) pillar = (perfect ? 1.3 : 1) + (back ? 0.3 : 0);
        else if (back) pillar = 0.45;
        const { apex } = this.plan;
        [[apex[0], apex[2]], [this.halcyon[0], this.halcyon[2]]].forEach(([hx, hz], line) => {
            this.schedule({
                kind: 'release',
                time: birth + clearPassTime(Math.hypot(hx - heart.x, hz - heart.z)),
                line,
                rgb,
                amount: strength,
                quad,
                spend: spend(line),
                feed,
                pillar,
                pour: quad ? 0.07 : 0,
            });
        });
        this.stir = Math.max(this.stir, Math.min(1.4, 0.3 + 0.16 * n + (quad ? 0.4 : 0) + 0.1 * deeper));
        // The camera takes the blow a beat after the wave leaves (added to whatever still rings).
        const blow = birth + CLEAR_KICK_DELAY;
        const kick = 0.22 + 0.1 * n + 0.05 * deeper;
        this.strike(kick, kick * 0.5, blow);
        this.gameplay.clear({
            lines: n, cascade: deeper + 1, combo: chain, tspin, perfect, b2b: back,
        }, blow);

        // ── Every crystal on the lines rings as the wave passes it ──
        const share = this.sparks.count / 512;
        const { gems } = this.crystals;
        const chime = (quad ? 6 : 3) + Math.min(3, deeper) + (back ? 2 : 0);
        for (let i = 0; i < gems.length; i++) {
            const g = gems[i];
            // Every stone's crystal, and the nearest pairs of shards (the far ones are specks).
            if (g.kind !== GEM.dial && !(g.kind === GEM.shard && g.index < CHIME_PAIRS)) continue;
            const at = this.crystals.positionOf(i);
            this.sparks.emit({
                x: at[0],
                y: at[1],
                z: at[2],
                n: Math.max(1, Math.round(chime * share)),
                rgb,
                time: birth + clearPassTime(Math.hypot(at[0] - heart.x, at[2] - heart.z)),
                out: [0.5, 2.6],
                up: [1.2, 4.2],
                life: [0.7, 1.5],
                size: 0.05 + g.half * 0.02,
            });
        }
        // A cascade's later waves ring the lagoon from the board's foot in the ley's light, each
        // one reaching further than the last.
        if (deeper > 0) {
            const strong = Math.min(0.8, 0.35 + 0.1 * deeper);
            this.ring(heart.x, heart.z, birth, strong, p.ley, Math.min(1.6, 0.6 + 0.15 * deeper));
        }

        // ── The cleared rows leave the card as blades of light ──
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.5, 0.7 + 0.18 * n + 0.08 * deeper));
        }

        if (quad) {
            // The sanctuary holds its breath (as deep as play is cold: in a fever it only
            // inhales), then everything fires.
            this.hushUntil = this.time + HUSH_HOLD;
            this.hushDepth = 1 - 0.8 * this.heat.level;
            this.addOverdrive(perfect ? 1.3 : 1, this.time);
            this.shockRing(birth, this.reducedMotion ? 0.5 : 1);
            this.birds?.scatter(birth);
            this.counts.quads += 1;
        }
        if (back) {
            // The second difficult clear: the two great crystals answer each other (a pillar on
            // each as the wave reaches it), a second ring opens over the sky, the overdrive rises.
            this.addOverdrive(0.35, this.time);
            this.shockRing(birth + 0.18, this.reducedMotion ? 0.3 : 0.6);
        }
        if (tspin) {
            // Everything that floats turns on its axis.
            this.twist = Math.max(this.twist, 1);
            this.stir = Math.max(this.stir, 0.9);
            this.ring(heart.x, heart.z, this.time, 0.9, rgb, 0.7);
            this.ring(heart.x, heart.z, this.time + 0.16, 0.7, rgb, 0.45);
        }
        this.counts.clears += 1;
    }

    /**
     * A perfect clear that settled after its clear (physics sends it ~360 ms after the last wave):
     * the crown on the clear still playing. No hush and no new wave: a second ring over the sky,
     * both great crystals pour out everything into their pillars, the flock is thrown again.
     */
    onCrown() {
        if (!this.u || !this.crystals) return;
        const at = this.time;
        this.addOverdrive(0.5, at);
        this.shockRing(at, this.reducedMotion ? 0.4 : 0.8);
        this.birds?.scatter(at, 0.6);
        this.stir = Math.max(this.stir, 1.2);
        this.strike(0.3, 0.12, at);
        this.afterglow.hit(0.5, at);
        this.gameplay.crown(at);
        const rgb = [...SUNFIRE];
        [0, 1].forEach((line) => {
            this.schedule({
                kind: 'release',
                time: at + 0.06 + line * 0.08,
                line,
                rgb,
                amount: 1.2,
                quad: true,
                spend: 1,
                feed: 0,
                pillar: 0.6,
                pour: 0.07,
            });
        });
        this.counts.crowns += 1;
    }

    /** A T-spin that cleared nothing: the floating things turn a little, a ring leaves the board's foot. */
    onSpin({ player = 0, screen = null } = {}) {
        if (!this.u || !this.crystals) return;
        const board = boardFor(this.layout, player);
        const heart = screen
            ? this.screenToLagoon(screen.x, Math.max(screen.y, 0.72))
            : this.screenToLagoon(board ? (board.x0 + board.x1) * 0.5 : 0.5, board ? Math.max(board.y1, 0.74) : 0.94);
        this.twist = Math.max(this.twist, 0.55);
        this.stir = Math.max(this.stir, 0.45);
        this.ring(heart.x, heart.z, this.time, 0.7, this._palette.ley, 0.55);
        this.strike(0.12, 0.03, this.time);
        this.gameplay.spin(this.time);
        this.counts.spins += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 2) {
            // The chain is over: the great crystals pour out everything it gave them (a pillar
            // each, as tall as what they kept), the sanctuary sighs (barely, if play still runs
            // hot), and what it lifted drifts back down over several seconds.
            this.dip = Math.max(this.dip, 0.1 * (1 - this.heat.level));
            [0, 1].forEach((line) => {
                const c = this.heldColor[line];
                const rgb = [0, 1, 2].map((k) => c[k] * 0.6 + SUNFIRE[k] * 0.4);
                this.schedule({
                    kind: 'release',
                    time: this.time + 0.05 + line * 0.1,
                    line,
                    rgb,
                    amount: 1,
                    quad: false,
                    spend: 1,
                    feed: 0,
                    pillar: 0,
                    pour: 0.09,
                });
            });
        }
        this.combo = n;
    }

    /** A new level: the hour changes. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % HALCYON_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.stir = Math.max(this.stir, 0.8);
            this.strike(0, 0.14, this.time);
            if (this.u) this.shockRing(this.time, 0.4);
            this.gameplay.levelUp(this.time);
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
            // What the crystal shows is what it keeps plus what is still pouring out of it.
            const out = this.outflow[a.line];
            const kept = Math.max(0, this.held[a.line] - out);
            const c = this.heldColor[a.line];
            if (a.kind === 'hold') {
                // The crystal keeps the pulse: its colour leans to the newest light it took. A
                // chain lets it hold more; what it already holds is never taken back.
                const now = Math.max(kept, Math.min(this.holdCap(a.line), kept + a.amount));
                const mixK = a.amount / Math.max(now, 1e-3);
                for (let k = 0; k < 3; k++) c[k] += (a.rgb[k] - c[k]) * Math.min(1, mixK * 1.4);
                this.held[a.line] = now + out;
                this.sparks?.emit({
                    x: where[0], y: where[1], z: where[2], n: Math.round(10 * share), rgb: a.rgb, time: a.time, out: [1.5, 7], up: [-1, 5], life: [0.8, 1.7], size: 0.3,
                });
            } else if (a.kind === 'release') {
                // It lets go of its share (all of it, or in a chain a little), which pours out
                // over a moment as its sparks fly; a chain's wave pours light back in.
                const spent = kept * (a.spend ?? 1);
                const stays = kept - spent;
                const fed = Math.max(stays, Math.min(this.holdCap(a.line), stays + (a.feed ?? 0)));
                if (fed > stays) {
                    const mixK = (fed - stays) / Math.max(fed, 1e-3);
                    for (let k = 0; k < 3; k++) c[k] += (a.rgb[k] - c[k]) * Math.min(1, mixK);
                }
                this.held[a.line] = fed + out + spent;
                this.outflow[a.line] = out + spent;
                const rgb = kept > 0.2 ? [0, 1, 2].map((k) => c[k] * 0.6 + a.rgb[k] * 0.4) : a.rgb;
                this.sparks?.emit({
                    x: where[0],
                    y: where[1],
                    z: where[2],
                    n: Math.round((14 + Math.min(spent, 8) * 10 + (a.quad ? 40 : 0) + (fed - stays) * 6) * share),
                    rgb,
                    time: a.time,
                    out: [3, 13 + Math.min(spent, 8) * 2],
                    up: [0, 11],
                    life: [1.2, 2.6],
                    size: 0.36,
                });
                this.stir = Math.max(this.stir, Math.min(1.4, 0.4 + spent * 0.12));
                // What it lets go of on a four-line clear, a crown or the end of a chain goes up
                // its beacon: a pillar as tall as what it held, added to any pillar still standing.
                const pillar = (a.pillar ?? 0) + (a.pour ?? 0) * spent;
                if (pillar > 0.01) {
                    this.blaze[a.line].hit(pillar, a.time);
                    this.flare[a.line].hit(Math.min(1.2, pillar), a.time);
                }
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

        // ── How hot play runs (src/themes/shared/gameplay-surge.js): calm, warm, hot, fever ──
        const sampled = this.gameplay.sample(t);
        const { heat } = this;
        heat.punch = sampled.punch;
        heat.level = sampled.level;
        heat.fever = sampled.fever;
        heat.stage = sampled.stage;
        const { level, fever } = heat;
        /** A quick hand wakes the sanctuary (0 under casual play), a fever fills it. */
        const awake = smooth(0.18, 0.8, level);

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.55, dt);
        // The sanctuary leaves the ground with the chain and stays aloft while play runs hot: a
        // quick hand lifts the first shards, a fever all of them. When it cools (or the chain
        // ends) what it lifted drifts back down over several seconds.
        const ascent = LIFT_MAX * (0.3 * smooth(0.35, 0.85, level) + 0.7 * fever);
        const liftTarget = Math.max(Math.min(LIFT_MAX, this.combo), ascent);
        this.lift += (liftTarget - this.lift) * approach(liftTarget > this.lift ? 2.6 : 0.5, dt);
        this.surge = this.overdrive.valueAt(t);
        this.stir *= Math.exp(-dt / 1.7);
        this.flash = this.flashes.valueAt(t);
        this.kick = this.kicks.valueAt(t);
        this.dip *= Math.exp(-dt / 0.35);
        this.twist *= Math.exp(-dt / 0.7);
        const fade = Math.exp(-dt / HOLD_FADE);
        for (let line = 0; line < 2; line++) {
            this.held[line] *= fade;
            let out = this.outflow[line] * fade;
            if (out > 0 && dt > 0) {
                // What a crystal lets go of pours out of it over a moment (the last of it at once).
                const go = out < 0.02 ? out : out * approach(POUR_RATE, dt);
                this.held[line] = Math.max(0, this.held[line] - go);
                out -= go;
            }
            this.outflow[line] = out;
        }
        // The hush: as deep as play was cold when the four-line clear came.
        const hush = t < this.hushUntil ? this.hushDepth : 0;
        const breathTarget = hush > 0 ? 1 - 0.85 * hush : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush > 0 ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(0.8, dt));

        // ── The slow clocks ──
        // Under reduced motion the sky and the crystals keep their own slow pace whatever the board
        // does; the beads still answer a chain (they are its feedback, and they are small). Hot
        // play hurries the sky, swings the splinters and streams the beads up; a fever more so.
        const still = this.reducedMotion ? 0 : 1;
        const { power, stir, surge } = this;
        this.cloudDrift += dt * motion * (1 + (power * 2.5 + stir * 3 + surge * 5 + awake * 1.2 + fever * 2.5) * still);
        this.spin += dt * motion
            * (0.22 + (power * 1.5 + stir * 0.8 + surge * 3 + this.twist * 7 + awake * 0.5 + fever * 1.1) * still);
        this.beadLift += dt * motion * (0.6 + power * 2.6 + surge * 4 + stir * 0.8 + awake * 1.2 + fever * 2.2);
        this.placeCrystals(dt);
        // The flock climbs and widens its circle while play runs hot.
        this.birds?.update(t, dt, (0.3 * smooth(0.5, 0.9, level) + 0.5 * fever) * (this.reducedMotion ? 0.3 : 1));

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
        // The charge the materials see: the chain's, and the heat of play under it (a quick hand
        // wakes the ley and the crystals, the wind on the lagoon, the clouds part in a fever).
        const charge = this.power + (1 - this.power) * (0.38 * awake + 0.3 * fever);
        u.power.value = charge;
        u.lift.value = this.lift;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.cloudDrift.value = this.cloudDrift;
        u.spin.value = this.spin;
        u.beadLift.value = this.beadLift;
        u.held.value.set(this.held[0], this.held[1], 0, 0);
        // What the great crystals hold shows in the pieces' colours; as play runs hot it leans to
        // the hour's crystal hue, so a crystal that holds a chain burns as a coloured star (the
        // Halcyon a teal one before the gold sun), never a white blot.
        const lean = Math.min(0.85, 0.6 * awake + 0.3 * fever);
        const heldTo = (node, c) => {
            const q = this._palette.crystal;
            node.value.set(c[0] + (q[0] - c[0]) * lean, c[1] + (q[1] - c[1]) * lean, c[2] + (q[2] - c[2]) * lean);
        };
        heldTo(u.heldA, this.heldColor[0]);
        heldTo(u.heldB, this.heldColor[1]);
        const blazeA = this.blaze[0].valueAt(t);
        const blazeB = this.blaze[1].valueAt(t);
        u.beacon.value.set(
            blazeA,
            this.flare[0].valueAt(t),
            blazeB * HALCYON_PILLAR[0],
            this.flare[1].valueAt(t) * HALCYON_PILLAR[1],
        );
        const p = this._palette;
        // The overdrive and the fever turn the ley to sunfire gold while the crystals keep their own
        // hue: two saturated colours against each other at the payoff, never a pale mix of the two.
        const warmth = { crystal: 0, ley: clamp01(this.surge * 0.9 + fever * 0.8 + awake * 0.08) };
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            const k = warmth[key];
            node.value.set(
                (c[0] + (SUNFIRE[0] - c[0]) * k) * gain,
                (c[1] + (SUNFIRE[1] - c[1]) * k) * gain,
                (c[2] + (SUNFIRE[2] - c[2]) * k) * gain,
            );
        };
        const plain = (key, node, gain = 1) => node.value.set(p[key][0] * gain, p[key][1] * gain, p[key][2] * gain);
        // The sky answers the chain alone (as it always has): hot play wakes the sanctuary's own
        // lights, not more glare round the sun.
        // In a fever the darks deepen (the zenith, the clouds' shade, the deep water), so the
        // sanctuary's own lights carry the colour.
        plain('sun', u.sun, 1 + this.power * 0.12);
        plain('zenith', u.zenith, 1 - 0.4 * fever);
        plain('horizon', u.horizon, 1 + this.power * 0.1);
        plain('glow', u.glow, 1 + this.power * 0.25 + Math.min(this.stir, 0.5) * 0.1);
        plain('rose', u.rose, 1 - 0.2 * fever);
        plain('cloud', u.cloud);
        plain('cloudShade', u.cloudShade, 1 - 0.25 * fever);
        plain('shallow', u.shallow);
        plain('deep', u.deep, 1 - 0.3 * fever);
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
        const swell = this.afterglow.valueAt(t);
        // The pillars' glare, softened: two pillars standing at once never wash the frame out.
        const blaze = softCeiling(blazeA + blazeB * HALCYON_PILLAR[0], 1, 2);
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        // The sun's shafts thin as play runs hot and while the overdrive burns: at the payoff the
        // light is the pillars' and the rings', carried where they stand, never a veil of glare
        // dragged across the frame.
        const open = ((0.42 + this.power * 0.2 + swell * 0.15) * (1 - 0.35 * fever)) / (1 + 0.7 * this.surge);
        post.shafts = open + (0.06 - open) * hush;
        post.bloomBoost = this.surge * 0.04 + swell * 0.1;
        // The iris closes as the sanctuary flares, and further as play runs hot, so its colours
        // survive the surge and the frame keeps its depth.
        post.exposure = 1 / (1 + this.surge * 0.85 + swell * 0.35 + charge * 0.14 + this.stir * 0.08 + blaze * 0.12
            + awake * 0.12 + fever * 0.3);
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
            /** How hot play runs: the level (0..1), the fever (0..1) and the act (0 calm .. 3 fever). */
            heat: { level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage },
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
