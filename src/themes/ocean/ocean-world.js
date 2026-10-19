/**
 * Ocean — the world.
 *
 * Owns the shared uniforms, the light pattern, every scene part, the camera rig and the
 * choreography. Shared by the theme (ocean-theme.js) and the playground effect
 * (src/playground/effects/ocean.effect.js), so what is iterated there ships.
 *
 * The viewer rests in the mouth of a reef canyon, looking out and a little upward. Overhead the
 * surface rolls; the sun stands somewhere above the frame and its light comes down through the
 * water in shafts that wander over sand and coral. A garden of coral rises on either side, kelp
 * climbs the shoulders behind, a silver school streams through the canyon and, now and then,
 * something large comes out of the blue and passes (ocean-visits.js: a humpback and her calf, a
 * blue whale, a whale shark, mantas, eagle rays, a turtle, hammerheads, dolphins, a sunfish, at
 * irregular times). The board stands in the canyon's mouth:
 *
 *   lock     the piece's light sinks from the card to the reef on its side: where it lands a
 *            ring of its colour runs out over sand and coral, bubbles go up, the fish nearby
 *            dart away, and the colonies round that place light up in the piece's colour and
 *            hold it. A hard drop lands harder: a ring of pressure crosses the picture.
 *   clear    a current crosses the canyon: kelp and grass lean as its front passes, the school
 *            draws out into a ribbon and streams across at the height of the cleared rows, the
 *            shafts flare, and every colony holding a colour lets it go as the front reaches
 *            it — a slow upward snow of beads in the colours of the pieces that fed it.
 *   combo    the sea's large animals are called in from the blue, one more with each step of a
 *            chain: a turtle, then mantas, then a whale far out, and at the top the whale comes
 *            through the canyon over the board, its shadow cutting the shafts, and sings.
 *   four     the sea holds its breath; then one great shaft of light comes down over the board,
 *            the school winds itself round it, and the whole reef spawns at once.
 *   level    the light turns to its next hour (six of them on a wheel) and a long swell passes
 *            overhead.
 *
 * The light also moves on by itself, whatever the level: an hour every 100 s of the world's
 * clock, so the colour of the water is never quite the same twice.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import {
    CALLS,
    DEG,
    EYE,
    HOURS,
    HOUR_COLOURS,
    HOUR_SECONDS,
    HOUR_TURN,
    HUSH_HOLD,
    LANES,
    MOUNDS,
    NEVER,
    NOISE_SIZE,
    PASS_SECONDS,
    RING_LIVE,
    RING_SLOTS,
    SCARE_LIVE,
    SCARE_SLOTS,
    SCHOOL_PACE,
    SCHOOL_REST,
    SCHOOL_SPAN,
    SHADE_SLOTS,
    SONG_LIVE,
    SONG_SLOTS,
    STAIN_FADE,
    STAIN_SLOTS,
    SURFACE,
    SURGE_COOL,
    SURGE_LIVE,
    SURGE_SLOTS,
    TAU,
    VORTEX,
    VORTEX_HOLD,
    approach,
    bakeNoise,
    clamp01,
    createLightPass,
    createNoiseTexture,
    createOceanUniforms,
    fovForAspect,
    hourAt,
    hourPlace,
    lerp,
    mulberry32,
    nearestTurn,
    pieceColor,
    powerForCombo,
    refractToAir,
    seabedHeight,
    skyDirection,
    smooth,
    squeezeFor,
    surgePassTime,
} from './ocean-tsl.js';
import { tierFor } from './ocean-quality.js';
import { createBackdrop, createSurface } from './ocean-surface.js';
import { createSeabed } from './ocean-seabed.js';
import {
    gardensOf, planGrass, planKelp, planReef, planReefFish,
} from './ocean-plan.js';
import { COLONY_KINDS, createColonies } from './ocean-reef.js';
import { createGrass, createKelp } from './ocean-flora.js';
import { createJellies, createReefFish, createSchool } from './ocean-fauna.js';
import { createGiants } from './ocean-giants.js';
import { creaturesLoaded, loadCreatures } from './ocean-creatures.js';
import {
    CAST, KINDS, laneVisit, makeVisit, planVisits, poseOnRoute,
} from './ocean-visits.js';
import { createMotes, createPool } from './ocean-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './ocean-composition.js';

/** The rest camera's lens (the theme builds its camera from it). */
export const REST_RIG = Object.freeze({
    hFov: EYE.hFov,
    minFov: EYE.minFov,
    maxFov: EYE.maxFov,
    near: EYE.near,
    far: EYE.far,
});

export { fovForAspect };

/** Pressure rings the post can show at once. */
const SHOCKS = 2;

/** The school drawn out into a ribbon while a clear's current runs: its shape, and how long it holds. */
const RIBBON = Object.freeze({
    wide: 17, swing: 0.3, back: -5.5, deep: 2.4, hold: 3.4,
});

/** The large animals' parts: one per kind (giant:humpback, giant:manta, ...). */
const GIANT_PARTS = KINDS.map((kind) => `giant:${kind}`);

const PARTS = [
    'backdrop', 'surface', 'seabed', 'branching', 'tables', 'brains', 'sponges', 'fans', 'anemones', 'kelp', 'grass',
    'school', 'reefFish', ...GIANT_PARTS, 'jellies', 'motes', 'pool',
];

const copyShape = (shape) => ({
    wide: shape.wide, high: shape.high, swing: shape.swing, back: shape.back, deep: shape.deep,
});

export class OceanWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {object} [params.creatures]  the large animals' bodies (ocean-creatures.js); without
     *        it the world uses the pack once the page has it, or loads it and lets them in after
     * @param {number} [params.visitSeed]  which of the sea's schedules of visits this world
     *        keeps (captures: 1; otherwise a new one, unless a rebuild hands its last one on)
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, creatures = null, visitSeed = null,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.creaturesPack = creatures;
        /** Resolves once the large animals are in the water (or the pack could not be had). */
        this.creaturesReady = Promise.resolve(null);
        this._onlyParts = null;
        // (A capture keeps one schedule; a session draws its own, unless a rebuild hands one on.)
        let seed = capture ? 1 : Math.floor(Math.random() * 1e9) + 1;
        if (Number.isFinite(visitSeed)) seed = visitSeed;
        this.visitSeed = seed;
        this.visits = planVisits(seed);
        /** Visits a capture asks for by name, besides the sea's own (playground). */
        this.extraVisits = [];
        this.visitsOn = true;
        this._live = [];
        this._giantCounts = Object.fromEntries(KINDS.map((k) => [k, 0]));
        /** World space: the water, the surface, the animals and everything gameplay throws about. */
        this.root = new THREE.Group();
        this.root.name = 'Ocean';
        /** Stage space: the canyon and all that grows on it, drawn in on a narrow frame. */
        this.stage = new THREE.Group();
        this.stage.name = 'OceanStage';
        this.root.add(this.stage);
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.light = null;
        this.backdrop = null;
        this.pool = null;
        this.giants = null;
        /** Stage points the reef's colonies gather round: where the reef spawns from. */
        this.gardens = MOUNDS.slice(0, 8).map((m) => [m[0], m[1]]);
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.squeeze = 1;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.hourDrift = true;
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._sun = [0, 1, 0];
        this._air = [0, 1, 0];
        this._hour = hourAt(0);
        this._pose = {};
        this._post = {
            flash: 0,
            kick: 0,
            shafts: 1,
            bloomBoost: 0,
            exposure: 1,
            shade: [0.004, 0.03, 0.07],
            shocks: Array.from({ length: SHOCKS }, () => ({
                x: 0.5, y: 0.5, radius: 0, strength: 0,
            })),
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.level = 1;
        /** The level's place on the wheel of hours, turning from one to the next. */
        this.turn = { from: 0, to: 0, time: -100 };
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.lift = 0;
        this.flare = 0;
        this.swell = 1;
        this.current = 0.25;
        this.hushUntil = -1;
        this.rings = [];
        /** Colonies holding a colour: { x, y, z, rgb, birth, gain, release }. */
        this.stains = [];
        this.surges = [];
        this.scares = [];
        this.songs = [];
        this.shocks = [];
        this.surgeDir = -1;
        this.lastLanding = null;
        this.beam = {
            x: 0, z: 0, time: -100, strength: 0,
        };
        // The school: where it is on its loop, the shape it is easing to, the vortex.
        this.school = {
            phase: time * SCHOOL_PACE * (this.reducedMotion ? 0.4 : 1),
            shape: copyShape(SCHOOL_REST),
            ribbon: { from: -100, until: -100, high: SCHOOL_REST.high },
            ribbonK: 0,
            vortexUntil: -100,
            vortexFrom: -100,
            vortex: 0,
            spin: 0,
            tight: 1,
            excite: 0,
        };
        /** Passes the board has called for: { start, side } per animal, null when none. */
        this.calls = {
            turtle: null, mantas: [null, null, null], whale: null,
        };
        this.counts = {
            locks: 0, clears: 0, quads: 0, stains: 0, released: 0, passes: 0,
        };
        // The slow clock and the flora's own phase are functions of the world clock until gameplay bends them.
        this.drift = time * (this.reducedMotion ? 0.3 : 1);
        this.sway = time * 0.975;
        this.pool?.reset();
        if (this.u) {
            this.u.counts.value.set(0, 0, 0, 0);
            this.u.counts2.value.set(0, 0, 0, 0);
            this.u.beam.value.w = 0;
        }
    }

    build() {
        const noise = createNoiseTexture(bakeNoise(), NOISE_SIZE);
        this.textures.push(noise);
        const u = createOceanUniforms({ noise, light: null });
        this.u = u;
        const { tier } = this;
        // The light pattern needs the uniforms (it reads the slow clock and the noise) and they need its texture.
        this.light = createLightPass(u, tier.light);
        u.lightTex = this.light.texture;

        this.backdrop = createBackdrop(u);
        this.addPart('backdrop', this.backdrop);
        this.addPart('surface', createSurface(u, { waves: tier.waves, clouds: tier.clouds }));
        this.addPart('seabed', createSeabed(u, { detail: tier.seabed }), { stage: true });

        // ── What grows on the canyon ──
        const reef = planReef(tier.corals);
        this.reef = reef;
        this.gardens = gardensOf(reef);
        COLONY_KINDS.forEach((kind) => this.addPart(kind, createColonies(u, kind, reef[kind]), { stage: true }));
        this.addPart('kelp', createKelp(u, planKelp(tier.kelp), tier.blades), { stage: true });
        this.addPart('grass', createGrass(u, planGrass(tier.grass)), { stage: true });

        // ── What lives in the water (world space: each places itself with the squeeze) ──
        this.addPart('school', createSchool(u, tier.school, { glints: tier.glints }));
        this.addPart('reefFish', createReefFish(u, planReefFish(reef, tier.reefFish)));
        const pack = this.creaturesPack || creaturesLoaded();
        if (pack) this.attachCreatures(pack);
        else {
            this.creaturesReady = loadCreatures().then((loaded) => {
                if (loaded && !this.disposed && !this.giants) this.attachCreatures(loaded);
                return loaded;
            });
        }
        if (tier.jellies > 0) this.addPart('jellies', createJellies(u, tier.jellies));
        this.addPart('motes', createMotes(u, tier.motes));
        this.pool = createPool(u, tier.pool);
        this.addPart('pool', this.pool);

        this.applySqueeze();
        this.applyHour();
        this.scene.add(this.root);
        return this;
    }

    /** Add a part. `stage` parts belong to the canyon and are drawn in with it on a narrow frame. */
    addPart(name, part, { stage = false } = {}) {
        if (!part) return;
        this.parts[name] = part;
        (stage ? this.stage : this.root).add(part.mesh);
        this.disposables.push(part);
    }

    /** Let the large animals in: one part per kind, all sharing one material. */
    attachCreatures(pack) {
        if (!this.u || this.giants || !pack) return;
        this.giants = createGiants(this.u, pack);
        Object.entries(this.giants.parts).forEach(([kind, part]) => this.addPart(`giant:${kind}`, part));
        if (this._onlyParts) this.showOnlyParts(this._onlyParts);
        this.placeGiants();
    }

    /** Draw only the named parts (captures, bisecting a look). */
    showOnlyParts(names) {
        this._onlyParts = [...names];
        const keep = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = keep.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) {
            this.u.viewport.value.set(bufferWidth, bufferHeight);
        }
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            // With no board on screen the events aim at where the solo board would be in THIS frame.
            if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
            this.applySqueeze();
        }
    }

    /** The frame's width decides how far the stage is drawn in. */
    applySqueeze() {
        this.squeeze = squeezeFor(this.aspect);
        this.stage.scale.x = this.squeeze;
        this.stage.updateMatrixWorld(true);
        if (this.u) this.u.squeeze.value = this.squeeze;
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.applySqueeze();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Let the light move on by itself (the default), or hold it at the level's own hour. */
    setHourDrift(drifting) {
        this.hourDrift = drifting !== false;
    }

    /** Hold the light at a place on the wheel of hours (captures). */
    holdHour(place) {
        const p = Number.isFinite(place) ? place : 0;
        this.hourDrift = false;
        this.turn = { from: p, to: p, time: -100 };
        this.applyHour();
    }

    /**
     * Where the light stands on the wheel now: the level's place (turning for a few seconds
     * after a level-up), plus how far the clock has moved it on.
     */
    hourNow() {
        const k = smooth(0, 1, (this.time - this.turn.time) / HOUR_TURN);
        return hourPlace(this.turn.from + (this.turn.to - this.turn.from) * k, this.time, this.hourDrift);
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        const { level } = this;
        this.resetState(Math.max(0, time));
        this.level = level;
        this.turn = { from: level - 1, to: level - 1, time: -100 };
        this.applyHour();
    }

    /**
     * A new run. The sea goes back to rest the way it would by itself: a chain still standing
     * breaks, every colony lets its colour go, the school leaves the board. What is already in
     * the water runs out; the hour stays.
     */
    resetSession() {
        if (this.combo > 0) this.onCombo(0);
        this.combo = 0;
        this.hushUntil = -1;
        this.school.vortexUntil = Math.min(this.school.vortexUntil, this.time);
        this.releaseAll(this.time, 0.6, 0.5);
        this.counts = {
            locks: 0, clears: 0, quads: 0, stains: 0, released: 0, passes: 0,
        };
        // A new run is at level one again, but the light stays where the clock and the last run
        // left it: the next level-up steps on from there.
        this.level = 1;
    }

    /** The run ended: the chain breaks, the reef lets its colours go. */
    onGameOver() {
        if (this.combo > 0) this.onCombo(0);
        this.releaseAll(this.time, 1.2, 1);
    }

    bindCamera(camera) {
        this._camera = camera;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        if (this.disposed) return;
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.5 * calm;
        if (camera.fov !== fov || camera.near !== EYE.near || camera.far !== EYE.far) {
            camera.fov = fov;
            camera.near = EYE.near;
            camera.far = EYE.far;
            camera.updateProjectionMatrix();
        }
        // The viewer hangs in the water and is rocked by it; the pointer leans the view.
        const swayX = (Math.sin(t * 0.17) * 0.13 + Math.sin(t * 0.083 + 1.3) * 0.08) * calm;
        const swayY = (Math.sin(t * 0.23 + 0.7) * 0.07 + Math.sin(t * 0.11) * 0.04) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(
            EYE.x + swayX + px * 0.4,
            EYE.y + swayY - py * 0.15,
            EYE.z + this.kick * 0.1 * calm,
        );
        const yaw = (Math.sin(t * 0.091 + 2.1) * 0.006 + px * 0.014) * calm;
        const pitch = EYE.pitch + (Math.sin(t * 0.103) * 0.004 - py * 0.01) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 100,
            camera.position.y + Math.tan(pitch) * 100,
            camera.position.z - Math.cos(yaw) * 100,
        );
        // A slow roll: the surge rocks the diver a hair.
        const roll = Math.sin(t * 0.19 + 0.4) * 0.006 * calm;
        camera.up.set(Math.sin(roll), Math.cos(roll), 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the rocking above: the view is
        // aimed out into open water, not at a point, so it only turns. Off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        this.backdrop?.follow(camera);
    }

    /** The world point `depth` metres along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = EYE.y;
            out[2] = EYE.z - depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    /** Where a world point stands on screen (fractions, y down), into `out`. */
    worldToScreen(x, y, z, out = this._point) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0.5;
            out.y = 0.5;
            return out;
        }
        this._ray.set(x, y, z).project(camera);
        out.x = this._ray.x * 0.5 + 0.5;
        out.y = 0.5 - this._ray.y * 0.5;
        return out;
    }

    /** The seabed under a world point. */
    groundAt(x, z) {
        return seabedHeight(x / this.squeeze, z);
    }

    /**
     * Where the ray through a screen point meets the seabed (world), or null when it runs out
     * into the blue first or meets it further off than `far`.
     */
    screenToSeabed(sx, sy, out = [0, 0, 0], far = 40) {
        const camera = this._camera;
        if (!camera) return null;
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const o = camera.position;
        const d = this._ray;
        const over = (t) => o.y + d.y * t - this.groundAt(o.x + d.x * t, o.z + d.z * t);
        let prev = 1.5;
        if (over(prev) <= 0) return null;
        for (let t = 2.2; t <= far; t += 0.35 + t * 0.03) {
            if (over(t) <= 0) {
                let lo = prev;
                let hi = t;
                for (let i = 0; i < 7; i++) {
                    const mid = (lo + hi) / 2;
                    if (over(mid) > 0) lo = mid;
                    else hi = mid;
                }
                out[0] = o.x + d.x * hi;
                out[2] = o.z + d.z * hi;
                out[1] = this.groundAt(out[0], out[2]);
                return out;
            }
            prev = t;
        }
        return null;
    }

    /**
     * Where a lock's light lands: a point of the reef on the piece's side of the card, nearer
     * the viewer the lower the piece locked. `salt` gives different points for the same lock.
     */
    pickLanding(side, wy, salt = 0) {
        const rand = mulberry32(0x0cea + (this.counts.locks * 7 + salt + 1) * 2654435761);
        const card = cardUnion(this.layout);
        const hud = this.layout?.hud;
        const left = card ? card.x0 : 0.4;
        const right = Math.max(card ? card.x1 : 0.6, side > 0 && hud ? hud.x1 : 0);
        const top = card ? card.y0 : 0.1;
        const bottom = card ? card.y1 : 0.9;
        const low = clamp01((wy - top) / Math.max(1e-3, bottom - top));
        const out = [0, 0, 0];
        for (let i = 0; i < 10; i++) {
            let sx = side < 0 ? lerp(0.04, left - 0.03, rand()) : lerp(right + 0.03, 0.96, rand());
            let sy = lerp(0.54, 0.9, low) + (rand() - 0.5) * 0.14 + i * 0.012;
            // A frame with no room beside the card (a tall phone): the strip of reef under it.
            if ((side < 0 && left < 0.16) || (side > 0 && right > 0.84)) {
                sx = side < 0 ? lerp(0.08, 0.46, rand()) : lerp(0.54, 0.92, rand());
                sy = lerp(Math.min(0.97, bottom + 0.015), 0.985, rand());
            }
            const hit = this.screenToSeabed(sx, Math.max(0.4, Math.min(0.985, sy)), out, 34);
            if (hit) return hit;
        }
        const x = side * 7.5;
        out[0] = x * this.squeeze;
        out[1] = seabedHeight(x, -3);
        out[2] = -3;
        return out;
    }

    // ── What the board lays on the reef ─────────────────────────────────────────

    /** Start a ring of light on the reef at (x, z) at `time`. */
    ring(x, z, time, strength, rgb, reach = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return;
        if (this.rings.length >= RING_SLOTS) this.rings.shift();
        this.rings.push({
            x, z, time, strength, rgb: [rgb[0], rgb[1], rgb[2]], reach,
        });
    }

    /** Light the colonies round (x, z) in a colour from `time`; they hold it until a clear lets it go. */
    stain(x, z, time, rgb, gain = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return;
        if (this.stains.length >= STAIN_SLOTS) {
            // No room: the oldest one still held lets go by itself, and the oldest of all makes
            // way (a colour let go is still fading in the list: the list must not outgrow its table).
            const oldest = this.stains.find((s) => s.release === NEVER);
            if (oldest) this.release(oldest, Math.max(this.time, oldest.birth), 0.5);
            while (this.stains.length >= STAIN_SLOTS) this.stains.shift();
        }
        this.stains.push({
            x, y: this.groundAt(x, z), z, rgb: [rgb[0], rgb[1], rgb[2]], birth: time, gain, release: NEVER,
        });
        this.counts.stains += 1;
    }

    /** Let a colony's colour go at `time`: it flares, and beads of that colour rise from it. */
    release(stain, time, share = 1) {
        if (stain.release !== NEVER) return;
        stain.release = Math.max(time, stain.birth);
        this.counts.released += 1;
        this.spawn(stain.x, stain.y, stain.z, stain.rgb, stain.release, share * stain.gain);
    }

    /** Let every colony go, one after another over `over` seconds. */
    releaseAll(time, over = 0.5, share = 1) {
        const held = this.stains.filter((s) => s.release === NEVER);
        held.forEach((s, i) => this.release(s, Math.max(time, s.birth) + (over * i) / Math.max(1, held.length), share));
    }

    /** Beads rising from a place on the reef: the corals spawning. */
    spawn(x, y, z, rgb, time, share = 1) {
        if (!this.pool) return;
        this.pool.emit({
            mode: 'bead',
            at: [x, y + 0.35, z],
            n: Math.round(16 * share * this.poolShare()),
            rgb,
            time,
            vel: [this.surgeDir * 0.12, 0.42, 0],
            spread: 0.16,
            scatter: 1.5,
            life: [6.5, 11],
            size: 0.085,
            stagger: 1.6,
        });
    }

    /** Startle the fish round a world point at `time`. */
    scare(x, y, z, time, strength = 1, radius = 6) {
        if (this.scares.length >= SCARE_SLOTS) this.scares.shift();
        this.scares.push({
            x, y, z, time, strength, radius,
        });
    }

    /** A ring of pressure through the picture from a world point at `time`. */
    shock(x, y, z, time, strength) {
        const at = this.worldToScreen(x, y, z, { x: 0.5, y: 0.5 });
        if (this.shocks.length >= SHOCKS) this.shocks.shift();
        this.shocks.push({
            x: at.x, y: at.y, time, strength: this.reducedMotion ? strength * 0.4 : strength,
        });
    }

    /** How full the pool is against the tier it was tuned on (High). */
    poolShare() {
        return this.pool ? Math.min(1.6, this.pool.count / 960) : 0;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        const rgb = pieceColor(color);
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
                const middle = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, Number.isFinite(u) ? u : 0.5, Number.isFinite(middle) ? middle : 19, this._point);
                // The light leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        this.lockAt(wx, wy, side, rgb, hardDrop);
        this.kick = Math.max(this.kick, hardDrop ? 0.45 : 0.08);
        this.flash = Math.max(this.flash, hardDrop ? 0.06 : 0.012);
        this.counts.locks += 1;
    }

    /** What a lock does to the scene. (wx, wy) = where on screen the piece's light leaves the card. */
    lockAt(wx, wy, side, rgb, hardDrop) {
        const t = this.time;
        const from = this.screenToWorld(wx, wy, 6.5, [0, 0, 0]);
        const to = this.pickLanding(side, wy, 0);
        const span = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const flight = this.reducedMotion ? 0.15 : Math.min(0.95, 0.42 + span * 0.022);
        const lands = t + flight;
        const strength = hardDrop ? 1 : 0.5;
        const share = this.poolShare();
        if (this.pool) {
            // A breath of bubbles where the piece set down, at the card's edge.
            this.pool.emit({
                mode: 'bubble', at: from, n: Math.round((hardDrop ? 9 : 4) * share), rgb, time: t, vel: [side * 0.5, 0.5, 0], spread: 0.45, scatter: 0.12, life: [1.6, 3.2], size: 0.06, stagger: 0.25,
            });
            // The piece's light on its way down to the reef: a bright head with its wake behind it.
            const home = [to[0], to[1] + 0.15, to[2]];
            this.pool.emit({
                mode: 'home', at: from, home, n: 1, rgb, time: t, life: [flight, flight], size: 0.42 + strength * 0.16,
            });
            this.pool.emit({
                mode: 'home', at: from, home, n: Math.round(12 * share) + 3, rgb, time: t + 0.02, life: [flight, flight], size: 0.13 + strength * 0.05, stagger: 0.22, scatter: 0.06,
            });
            // Where it lands, the light bursts: a crown of sparks of its colour thrown up off the reef.
            this.pool.emit({
                mode: 'drift', at: [to[0], to[1] + 0.25, to[2]], n: Math.round((14 + 12 * strength) * share), rgb, time: lands, vel: [0, 1.3 + strength * 0.8, 0], spread: 1.5 + strength * 0.8, scatter: 0.15, life: [0.7, 1.6], size: 0.09,
            });
            // Bubbles go up out of the coral, and sand lifts.
            this.pool.emit({
                mode: 'bubble', at: [to[0], to[1] + 0.2, to[2]], n: Math.round((10 + 14 * strength) * share), rgb, time: lands, vel: [0, 0.9 + strength * 0.5, 0], spread: 0.7 + strength * 0.4, scatter: 0.35, life: [2.4, 5.5], size: 0.07 + strength * 0.02, stagger: 0.5,
            });
            this.pool.emit({
                mode: 'puff', at: [to[0], to[1] + 0.1, to[2]], n: Math.round((5 + 6 * strength) * share), rgb: [0.9, 0.82, 0.62], time: lands, vel: [0, 0.25, 0], spread: 0.5 + strength * 0.5, scatter: 0.3, life: [1.4, 2.6], size: 0.5 + strength * 0.25,
            });
        }
        this.ring(to[0], to[2], lands, 0.55 + strength * 0.6, rgb, 0.7 + strength * 0.5);
        this.stain(to[0], to[2], lands, rgb, hardDrop ? 1.3 : 1);
        this.scare(to[0], to[1] + 0.8, to[2], lands, 0.6 + strength * 0.5, 4.5 + strength * 3);
        this.lastLanding = [to[0], to[1], to[2]];
        if (hardDrop) {
            this.shock(to[0], to[1] + 0.3, to[2], lands, 0.8);
            this.scare(from[0], from[1], from[2], t, 0.7, 5);
        }
    }

    /** Lines cleared. `lines` 1..4; `tspin`, `perfect`. */
    onClear({
        rows = null, lines = 1, perfect = false, tspin = false, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        const t = this.time;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const share = this.poolShare();
        const { glow } = this._hour;
        const peak = Math.max(glow[0], glow[1], glow[2], 1e-4);
        const rgb = glow.map((c) => (c / peak) * 0.85 + 0.15);
        let birth = quad ? t + HUSH_HOLD : t;
        // No two currents share a birth (two boards can clear in one frame).
        for (let i = 0; i < this.surges.length; i++) {
            if (this.surges[i].time === birth) {
                birth += 1e-6;
                i = -1;
            }
        }
        this.surgeDir = -this.surgeDir;
        const dir = this.surgeDir;
        if (this.surges.length >= SURGE_SLOTS) this.surges.shift();
        this.surges.push({
            time: birth, dir, strength: Math.min(1.6, 0.6 + 0.22 * n + (quad ? 0.25 : 0)), lines: n,
        });
        this.flare = Math.max(this.flare, 0.35 + 0.15 * n);
        this.flash = Math.max(this.flash, 0.03 + 0.02 * n);

        // ── Every colony the front passes lets its colour go ──
        for (let i = 0; i < this.stains.length; i++) {
            const s = this.stains[i];
            if (s.release !== NEVER) continue;
            const pass = surgePassTime(birth, dir, s.x / this.squeeze);
            // (A light still on its way down leaves its colony for the next current.)
            if (s.birth > pass) continue;
            this.release(s, pass, 0.7 + 0.25 * n);
        }
        // The reef spawns a little by itself as the front goes by, more for more lines.
        const gardens = quad ? this.gardens.length : Math.min(this.gardens.length, n + 1);
        for (let i = 0; i < gardens; i++) {
            const g = this.gardens[(i * 3 + this.counts.clears) % this.gardens.length];
            const x = g[0] * this.squeeze;
            this.spawn(x, this.groundAt(x, g[1]), g[1], rgb, surgePassTime(birth, dir, g[0]), quad ? 1.1 : 0.45);
        }

        // ── The school draws out and streams across at the cleared rows' height ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        let { high } = SCHOOL_REST;
        if (board && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const mid = list[Math.floor(list.length / 2)];
            const { y } = boardPoint(board, 0.5, mid, this._point);
            high = Math.max(1.6, Math.min(SURFACE - 2.5, this.screenToWorld(0.5, y, 15.5, [0, 0, 0])[1]));
        }
        this.school.ribbon = { from: birth, until: birth + RIBBON.hold + 0.4 * n, high };

        // ── The cleared rows leave the card as sheets of bubbles, carried off by the current ──
        if (this.pool && board && card && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const at = [0, 0, 0];
            for (let i = 0; i < list.length && i < 4; i++) {
                const { y } = boardPoint(board, 0.5, list[i], this._point);
                [-1, 1].forEach((edge) => {
                    this.screenToWorld(edge < 0 ? card.x0 : card.x1, y, 7, at);
                    this.pool.emit({
                        mode: 'bubble', at, n: Math.round((8 + (quad ? 5 : 0)) * share), rgb, time: birth + i * 0.04, vel: [dir * 2.2 + edge * 1.1, 0.35, -0.3], spread: 0.6, scatter: 0.12, life: [1.8, 4], size: 0.06, stagger: 0.3,
                    });
                });
            }
        }

        if (quad) {
            this.hushUntil = t + HUSH_HOLD;
            this.surge = perfect ? 1.3 : 1;
            this.school.vortexFrom = birth;
            this.school.vortexUntil = birth + VORTEX_HOLD;
            // The great shaft comes down over the board.
            this.beam = {
                x: 0, z: VORTEX.z - 1, time: birth, strength: 1,
            };
            this.shock(0, 3, VORTEX.z, birth, 1);
            this.scare(0, 4, VORTEX.z, birth, 0.6, 9);
            this.counts.quads += 1;
            // The whale answers it.
            this.call('whale', birth + 0.6);
        }
        if (perfect) this.lift = 1;
        if (tspin) {
            // A ring of bubbles blown where the piece went in, widening as it climbs.
            const at = this.lastLanding || [-6 * this.squeeze, this.groundAt(-6 * this.squeeze, -2), -2];
            if (this.pool) {
                for (let i = 0; i < 2; i++) {
                    this.pool.emit({
                        mode: 'bubble', at: [at[0], at[1] + 0.4, at[2]], n: Math.round(34 * share), rgb, time: t + i * 0.45, vel: [0, 1.15, 0], spread: 0.03, ring: 0.45 + i * 0.1, ringSpeed: 0.75, life: [4.5, 6], size: 0.085, scatter: 0.02,
                    });
                }
            }
            this.ring(at[0], at[2], t, 1.1, rgb, 1.2);
            if (!quad) this.shock(at[0], at[1] + 0.5, at[2], t, 0.5);
        }
        this.counts.clears += 1;
    }

    /** Send for one of the large animals at `time` (nothing happens while it is still passing). */
    call(kind, time, far = false) {
        const member = (extra = {}) => ({
            lag: 0, off: [0, 0, 0], weave: 0, weaveRate: 0, weavePhase: 0, scale: 1, phase: 0, variant: 0.3, roll: 0, ...extra,
        });
        if (kind === 'turtle') {
            const c = this.calls.turtle;
            if (c && time < c.start + PASS_SECONDS.turtle) return false;
            const side = this.counts.passes % 2 ? 1 : -1;
            this.calls.turtle = {
                start: time, side, visit: laneVisit('turtle', LANES.turtle, time, PASS_SECONDS.turtle, side, [member({ variant: 0.2 })]),
            };
        } else if (kind === 'manta') {
            const slot = this.calls.mantas.findIndex((c) => !c || time >= c.start + PASS_SECONDS.manta);
            if (slot < 0) return false;
            const side = this.counts.passes % 2 ? -1 : 1;
            // Each further manta a little higher or lower, further out, smaller; out of step.
            const one = member({
                off: [side * slot * 2.4, (slot - 1) * 1.3, 0], scale: 1 - slot * 0.08, phase: slot * 0.9, variant: 0.2 + slot * 0.2,
            });
            this.calls.mantas[slot] = {
                start: time, side, visit: laneVisit('manta', LANES.manta, time, PASS_SECONDS.manta, side, [one]),
            };
        } else {
            const c = this.calls.whale;
            const lane = c?.far ? 'whaleFar' : 'whale';
            if (c && time < c.start + PASS_SECONDS[lane]) {
                // Already on its way far out: a louder call does not turn it round.
                return false;
            }
            const side = this.counts.passes % 2 ? 1 : -1;
            const here = far ? 'whaleFar' : 'whale';
            const members = [member({ variant: 0.55 })];
            // Over the board she brings her calf, under her flank, a little behind and nearer.
            if (!far) {
                members.push(member({
                    lag: 0.035, off: [-side * 2.6, -1.9, 0], scale: 0.46, phase: 1.7, variant: 0.7,
                }));
            }
            this.calls.whale = {
                start: time, side, far, sung: false, visit: laneVisit('humpback', LANES[here], time, PASS_SECONDS[here], side, members),
            };
        }
        this.counts.passes += 1;
        return true;
    }

    /**
     * A capture's own visitor: the named act (ocean-visits.js ACTS) starting at `time`, made the
     * way the sea's schedule makes them from `seed`, from `side` (±1). Returns it, or null.
     */
    addVisit(name, time, seed = 1, side = 1) {
        const visit = makeVisit(name, time, seed, side);
        if (visit) this.extraVisits.push(visit);
        return visit;
    }

    /** Whether the sea sends its own visitors (captures of one act switch them off). */
    setVisits(on) {
        this.visitsOn = on !== false;
    }

    /**
     * The true combo changed. A higher number sends for the next of the large animals; a lower
     * one means the chain broke (0), or broke and a new one has already begun.
     */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (!this.u) {
            this.combo = n;
            return;
        }
        if (n < this.combo) this.dip = Math.max(this.dip, 0.2);
        else if (n > this.combo) {
            if (n >= CALLS.whale) this.call('whale', this.time);
            else if (n >= CALLS.whaleFar) this.call('whale', this.time, true);
            if (n >= CALLS.mantas) this.call('manta', this.time);
            if (n >= CALLS.turtle) this.call('turtle', this.time);
        }
        this.combo = n;
    }

    /** A new level: the light turns to its next hour, and a long swell passes overhead. */
    levelUp(level, { silent = false, place = null } = {}) {
        const k = smooth(0, 1, (this.time - this.turn.time) / HOUR_TURN);
        const from = this.turn.from + (this.turn.to - this.turn.from) * k;
        const n = Number(level);
        const next = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
        if (silent) {
            // A rebuild in place: back at the place the last world had reached (or, for a world
            // that never had one, the level's own), without the ceremony.
            const to = Number.isFinite(place) ? place : nearestTurn(from, next);
            this.level = next;
            this.turn = { from: to, to, time: -100 };
            this.applyHour();
            return;
        }
        // Forward by the levels gained, from where the last turn was headed. The place is the
        // light's own, not the level's number: after a long run the next run's level 2 is one hour
        // on from wherever the light stands, never several hours back to "level 2's colours".
        const gained = next - this.level;
        this.level = next;
        if (gained <= 0) return;
        const to = this.turn.to + gained;
        this.turn = { from, to, time: this.time };
        this.swell = Math.max(this.swell, 1.9);
        this.flare = Math.max(this.flare, 0.7);
        this.flash = Math.max(this.flash, 0.1);
        this.school.excite = 1;
        // A ring of the new hour's light runs out over the whole canyon floor.
        const { glow } = hourAt(hourPlace(to, this.time, this.hourDrift));
        this.ring(0, -4, this.time, 1.3, glow, 2.6);
    }

    /** Write the hour's light into the shared uniforms. */
    applyHour() {
        const h = hourAt(this.hourNow(), this._hour);
        const { u } = this;
        if (!u) return;
        for (let i = 0; i < HOUR_COLOURS.length; i++) {
            const key = HOUR_COLOURS[i];
            u[key].value.set(h[key][0], h[key][1], h[key][2]);
        }
        // On a narrow frame the light stands nearer the middle, so its glow stays in the picture.
        const bearing = h.azimuth * DEG * Math.max(0.45, this.squeeze);
        skyDirection(bearing, h.elevation * DEG, this._sun);
        refractToAir(this._sun, this._air);
        u.sunDir.value.set(this._sun[0], this._sun[1], this._sun[2]);
        u.sunAir.value.set(this._air[0], this._air[1], this._air[2]);
        u.fluor.value = Math.min(1.4, h.fluor + this.power * 0.3 + this.surge * 0.35);
        u.night.value = h.night;
    }

    // ── The large animals ───────────────────────────────────────────────────────

    /** Stand every animal where its pass has it at the world clock, and lay their shadows. */
    placeGiants() {
        const { giants, u } = this;
        if (!giants) {
            if (u) u.counts2.value.y = 0;
            return;
        }
        const t = this.time;
        const pose = this._pose;
        let shades = 0;
        const shade = (ax, ay, az, bx, by, bz, radius, strength) => {
            if (shades >= SHADE_SLOTS) return;
            u.shadeRows[shades * 2].set(ax, ay, az, radius);
            u.shadeRows[shades * 2 + 1].set(bx, by, bz, strength);
            shades += 1;
        };
        const counts = this._giantCounts;
        KINDS.forEach((kind) => {
            counts[kind] = 0;
        });
        // Stand one member of a visit where it is now; false when it is not in the water (or
        // every slot of its kind is taken: the board's calls come first, then the sea's own).
        const place = (visit, member) => {
            const tau = t - visit.start;
            if (tau < 0 || tau > visit.seconds * (1 + member.lag) + 0.5) return false;
            poseOnRoute(visit, member, tau, this.squeeze, pose);
            if (!(pose.k >= 0 && pose.k <= 1)) return false;
            const { kind } = visit;
            const i = counts[kind];
            if (i >= CAST[kind].slots) return false;
            counts[kind] = i + 1;
            giants.set(kind, i, pose);
            return true;
        };

        // ── The board's calls: the whale (and her calf), up to three mantas, the turtle ──
        const w = this.calls.whale;
        if (w && place(w.visit, w.visit.members[0])) {
            const { fx, fy, fz } = pose;
            shade(
                pose.x - fx * 5.5,
                pose.y - fy * 5.5,
                pose.z - fz * 5.5,
                pose.x + fx * 5,
                pose.y + fy * 5,
                pose.z + fz * 5,
                1.7,
                w.far ? 0.4 : 0.85,
            );
            // She sings as she comes over the board.
            const wk = (t - w.start) / w.visit.seconds;
            if (!w.far && !w.sung && wk > 0.4) {
                w.sung = true;
                if (this.songs.length >= SONG_SLOTS) this.songs.shift();
                this.songs.push({
                    x: pose.x, y: pose.y, z: pose.z, time: w.start + 0.4 * w.visit.seconds,
                });
            }
            for (let m = 1; m < w.visit.members.length; m++) place(w.visit, w.visit.members[m]);
        }
        for (let i = 0; i < this.calls.mantas.length; i++) {
            const c = this.calls.mantas[i];
            if (c && place(c.visit, c.visit.members[0])) {
                // (Its shadow lies across its wings: along its right, heading × up.)
                const rx = pose.fy * pose.uz - pose.fz * pose.uy;
                const rz = pose.fx * pose.uy - pose.fy * pose.ux;
                shade(pose.x - rx * 1.6, pose.y, pose.z - rz * 1.6, pose.x + rx * 1.6, pose.y, pose.z + rz * 1.6, 1.3, 0.55);
            }
        }
        if (this.calls.turtle) place(this.calls.turtle.visit, this.calls.turtle.visit.members[0]);

        // ── The sea's own visitors ──
        const live = this._live;
        if (this.visitsOn) this.visits.at(t, live);
        else live.length = 0;
        for (let v = 0; v < this.extraVisits.length; v++) live.push(this.extraVisits[v]);
        for (let v = 0; v < live.length; v++) {
            const visit = live[v];
            for (let m = 0; m < visit.members.length; m++) place(visit, visit.members[m]);
        }

        KINDS.forEach((kind) => giants.clear(kind, counts[kind]));
        giants.commit(counts);
        u.counts2.value.y = shades;
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
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.lift *= Math.exp(-dt / 6);
        this.flare *= Math.exp(-dt / 1.1);
        this.swell += (1 + this.surge * 0.5 - this.swell) * approach(0.45, dt);
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.3 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);

        // ── The currents ──
        let pull = 0;
        for (let i = this.surges.length - 1; i >= 0; i--) {
            const s = this.surges[i];
            const age = t - s.time;
            if (age > SURGE_LIVE) this.surges.splice(i, 1);
            else if (age >= 0) pull = Math.max(pull, s.strength * Math.exp(-age / 2.2));
        }
        this.current += (0.25 + this.power * 0.12 - this.current) * approach(1.2, dt);
        // The slow clock, and the flora's own phase (integrated: their pace follows the water, gently).
        this.drift += dt * motion * (1 + this.power * 0.25 + this.surge * 0.5);
        this.sway += dt * motion * (0.9 + this.current * 0.4 + pull * 0.25);

        // ── The school ──
        const sc = this.school;
        const inRibbon = t >= sc.ribbon.from && t < sc.ribbon.until;
        sc.ribbonK += ((inRibbon ? 1 : 0) - sc.ribbonK) * approach(inRibbon ? 3.2 : 1.1, dt);
        const k = sc.ribbonK;
        const ask = {
            wide: lerp(SCHOOL_REST.wide, RIBBON.wide, k),
            high: lerp(SCHOOL_REST.high, sc.ribbon.high, k),
            swing: lerp(SCHOOL_REST.swing, RIBBON.swing, k),
            back: lerp(SCHOOL_REST.back, RIBBON.back, k),
            deep: lerp(SCHOOL_REST.deep, RIBBON.deep, k),
        };
        const ease = approach(2.6, dt);
        Object.keys(ask).forEach((key) => {
            sc.shape[key] += (ask[key] - sc.shape[key]) * ease;
        });
        const winding = t >= sc.vortexFrom && t < sc.vortexUntil ? 1 : 0;
        sc.vortex += (winding - sc.vortex) * approach(winding ? 1.7 : 0.8, dt);
        sc.excite += (Math.max(this.power * 0.6, k, sc.vortex) - sc.excite) * approach(1.5, dt);
        sc.tight += ((1 - 0.35 * k + 0.2 * sc.vortex) - sc.tight) * approach(2, dt);
        // (Integrated: the pace changes with the game, so the place on the loop must be summed.)
        sc.phase += dt * motion * SCHOOL_PACE * (1 + sc.excite * 0.6 + k * 2.6);
        sc.spin += dt * motion * (0.55 + sc.vortex * 1.1);
        u.schoolA.value.set(sc.shape.wide, sc.shape.high, sc.shape.swing, sc.shape.back);
        u.schoolB.value.set(sc.shape.deep, sc.phase, sc.vortex, SCHOOL_SPAN);
        u.schoolC.value.set(sc.spin, sc.tight, sc.excite, 0);

        this.applyHour();
        // The sea's visitors are planned and their routes sampled a minute ahead, a little a frame.
        if (this.visitsOn) this.visits.prepare(t + 60, this.squeeze);
        this.placeGiants();

        // ── Event tables: live rows packed at the front ──
        let rings = 0;
        for (let i = this.rings.length - 1; i >= 0; i--) {
            if (t - this.rings[i].time > RING_LIVE) this.rings.splice(i, 1);
        }
        for (let i = 0; i < this.rings.length && rings < RING_SLOTS; i++) {
            const r = this.rings[i];
            if (t - r.time < -3) continue;
            u.ringRows[rings * 2].set(r.x, r.z, r.time, r.strength);
            u.ringRows[rings * 2 + 1].set(r.rgb[0], r.rgb[1], r.rgb[2], r.reach);
            rings += 1;
        }
        let stains = 0;
        for (let i = this.stains.length - 1; i >= 0; i--) {
            if (t - this.stains[i].release > STAIN_FADE) this.stains.splice(i, 1);
        }
        for (let i = 0; i < this.stains.length && stains < STAIN_SLOTS; i++) {
            const s = this.stains[i];
            if (t - s.birth < -3) continue;
            u.stainRows[stains * 2].set(s.x, s.z, s.birth, s.gain);
            u.stainRows[stains * 2 + 1].set(s.rgb[0], s.rgb[1], s.rgb[2], s.release);
            stains += 1;
        }
        let surges = 0;
        for (let i = 0; i < this.surges.length && surges < SURGE_SLOTS; i++) {
            const s = this.surges[i];
            if (t - s.time < -3) continue;
            u.surgeRows[surges].set(s.time, s.dir, s.strength * motion, s.lines);
            surges += 1;
        }
        let scares = 0;
        for (let i = this.scares.length - 1; i >= 0; i--) {
            if (t - this.scares[i].time > SCARE_LIVE) this.scares.splice(i, 1);
        }
        for (let i = 0; i < this.scares.length && scares < SCARE_SLOTS; i++) {
            const s = this.scares[i];
            if (t - s.time < -3) continue;
            u.scareRows[scares * 2].set(s.x, s.y, s.z, s.time);
            u.scareRows[scares * 2 + 1].set(s.strength, s.radius, 0, 0);
            scares += 1;
        }
        let songs = 0;
        for (let i = this.songs.length - 1; i >= 0; i--) {
            if (t - this.songs[i].time > SONG_LIVE) this.songs.splice(i, 1);
        }
        for (let i = 0; i < this.songs.length && songs < SONG_SLOTS; i++) {
            const s = this.songs[i];
            if (t < s.time) continue;
            u.songRows[songs].set(s.x, s.y, s.z, s.time);
            songs += 1;
        }
        u.counts.value.set(rings, stains, surges, scares);
        u.counts2.value.x = songs;

        // ── The great shaft ──
        const beamAge = t - this.beam.time;
        const beamOn = beamAge >= 0 && beamAge < VORTEX_HOLD + 2.5
            ? smooth(0, 0.5, beamAge) * (1 - smooth(VORTEX_HOLD - 1, VORTEX_HOLD + 2.5, beamAge)) * this.beam.strength
            : 0;
        u.beam.value.set(this.beam.x, this.beam.z, 3.2 + beamOn * 0.8, beamOn);

        // ── Uniforms ──
        u.time.value = t;
        u.drift.value = this.drift;
        u.sway.value = this.sway;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.lift.value = clamp01(this.lift);
        u.current.value = this.current;
        u.swell.value = this.swell;

        // ── Post ──
        const h = this._hour;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.shafts = hush ? 0.25 : h.shafts * (1 + this.power * 0.35 + this.flare * 0.9 + this.surge * 0.7);
        post.bloomBoost = this.surge * 0.15 + this.flare * 0.15;
        // The iris closes a little as the sea flares, so its colours survive the surge.
        post.exposure = h.exposure / (1 + this.surge * 0.35 + this.flare * 0.12 + beamOn * 0.15);
        for (let c = 0; c < 3; c++) post.shade[c] = h.abyss[c] * 0.7 + h.deep[c] * 0.12;
        for (let i = this.shocks.length - 1; i >= 0; i--) {
            if (t - this.shocks[i].time > 2.4) this.shocks.splice(i, 1);
        }
        for (let i = 0; i < SHOCKS; i++) {
            const s = this.shocks[i];
            const row = post.shocks[i];
            const age = s ? t - s.time : -1;
            if (s && age >= 0) {
                row.x = s.x;
                row.y = s.y;
                row.radius = age * 0.85 + 0.02;
                row.strength = s.strength * Math.exp(-age / 0.65);
            } else {
                row.radius = 0;
                row.strength = 0;
            }
        }
    }

    /** Paint this frame's light pattern (after update(), before the scene is drawn). */
    paint(renderer = this.renderer) {
        if (this.disposed || !this.light) return false;
        return this.light.render(renderer);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const h = this._hour;
        const visiting = this.visitsOn ? this.visits.at(this.time, []) : [];
        const upcoming = this.visits.until(this.time + 200).find((v) => v.start > this.time);
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            surge: this.surge,
            breath: this.breath,
            level: this.level,
            hour: this.hourNow(),
            /** The levels' share of the place (without the clock's): what a rebuild in place keeps. */
            levelPlace: this.turn.to,
            hourName: h.name,
            hourNext: h.next,
            hourMix: h.mix,
            hourSeconds: HOUR_SECONDS,
            hours: HOURS.length,
            squeeze: this.squeeze,
            counts: { ...this.counts },
            rings: this.u ? this.u.counts.value.x : 0,
            stains: this.u ? this.u.counts.value.y : 0,
            surges: this.u ? this.u.counts.value.z : 0,
            scares: this.u ? this.u.counts.value.w : 0,
            songs: this.u ? this.u.counts2.value.x : 0,
            shades: this.u ? this.u.counts2.value.y : 0,
            school: {
                phase: this.school.phase, ribbon: this.school.ribbonK, vortex: this.school.vortex, excite: this.school.excite,
            },
            calls: {
                turtle: Boolean(this.calls.turtle && this.time < this.calls.turtle.start + PASS_SECONDS.turtle),
                mantas: this.calls.mantas.filter((c) => c && this.time < c.start + PASS_SECONDS.manta).length,
                whale: Boolean(this.calls.whale && this.time
                    < this.calls.whale.start + PASS_SECONDS[this.calls.whale.far ? 'whaleFar' : 'whale']),
                whaleFar: Boolean(this.calls.whale?.far),
            },
            /** The sea's own visitors in the water now (act names), and the next to come. */
            visits: visiting.map((v) => v.act),
            nextVisit: upcoming ? { act: upcoming.act, start: upcoming.start } : null,
            /** What a rebuild in place hands on, so the same visitors keep coming. */
            visitSeed: this.visitSeed,
            /** How many of each large animal are in the water (null until their bodies arrive). */
            giants: this.giants ? this.giants.live() : null,
            beam: this.u ? this.u.beam.value.w : 0,
            pool: this.pool ? this.pool.count : 0,
            parts: Object.keys(this.parts),
            layoutLive: this.layoutLive,
            sun: [...this._sun],
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
        this.giants?.dispose();
        this.light?.dispose();
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.light = null;
        this.backdrop = null;
        this.pool = null;
        this.giants = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as OCEAN_PARTS, TAU };
