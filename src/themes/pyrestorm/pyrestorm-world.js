/**
 * Pyrestorm — one shared world (the theme and the playground mount the same one).
 *
 * The eruption at night seen from the tephra ridge: the land (plain, volcano, lava), the sky, the
 * anvil, the column's ash, the lightning, the fountain and the fissure's curtain, the bombs and
 * the motes; and everything gameplay does to them. The volcano answers the board:
 *
 *   lock        a Strombolian burst: the crater throws incandescent bombs (as many as the piece
 *               has cells, more on a hard drop) that arc out leaning the way the piece locked
 *               (left columns left, right columns right) and splash where they land on the cone,
 *               tinted a little by the piece's colour; a hard drop also shakes the crust open
 *               along every channel (a tremor) and throws sparks
 *   clear       one cloud-to-ground bolt per line out of the column, staggered; a higher row
 *               strikes higher up the cone, the floor rows strike the plain; each strike scorches
 *               the ground and lights the column from inside; the fountain kicks
 *   chain       the storm charges: spider lightning crawls along the anvil's underside, more
 *               often as the chain grows, the fountain climbs, the column's foot burns hotter;
 *               when a long chain breaks, the charge goes in one great branched discharge from
 *               the anvil to the summit
 *   four lines  a Vulcanian blast: the crater flashes, a shock front races out through the
 *               column and the anvil (a pale ring of condensation), a ring of bombs, the fountain
 *               jets to twice its height, a glowing surge rolls down the breach, and the bolts
 *   T-spin      the crater blows a glowing vortex ring that rises and widens over the column
 *   b2b         St Elmo's fire: a violet corona on the summit while the run lasts
 *   perfect     sheet lightning sweeps the whole anvil from the head downwind, a crown of bolts
 *               round the summit, the fountain at its highest
 *   level up    the night moves on a watch (it also drifts with the clock alone: a watch every
 *               100 s, wheel = clock / 100 + level − 1) and a surge of fresh lava runs down every
 *               channel from the vents
 *   game over   the eruption sinks to a glow; it wakes with the next run
 *
 * The mountain's unrest (shared/gameplay-surge.js) is how hot play runs, and the eruption builds
 * with it instead of answering each event alone: every burst, kick, tremor and flash ADDS to what
 * is still burning (a weak lock after a quad never cuts its light), and the unrest wakes the whole
 * volcano. Calm: as at rest. Warm: the fountain climbs and the rivers run brighter. Hot: the crust
 * tears open along every channel and the storm charges from the fire itself (spiders crawl the
 * anvil without a chain). Fever: the summit fountains, fresh lava pours down the channels again
 * and again, and the storm breaks (strokes onto the plain on their own). A chain's end and a
 * perfect clear spend the charge in a discharge (the storm goes quiet), then the mountain settles.
 *
 * Lifecycle: `await PyrestormWorld.prepare(quality, { signal })` bakes the land and the lava in
 * slices; `new PyrestormWorld({ ..., prepared }).build()` makes the scene objects; each frame
 * `updateCamera` → `update` → the post renders.
 */
import * as THREE from 'three/webgpu';
import {
    ANVIL, CRATER, DEG, EYE, RIG, TAU, TIMING, VOLCANO, approach, clamp, clamp01, columnPoint, fireTint, hexToLinear,
    landHeight, mulberry32, rigFor, smooth,
} from './pyrestorm-core.js';
import {
    WATCHES, WatchWheel, createWatchLight, watchAt,
} from './pyrestorm-hours.js';
import { tierFor } from './pyrestorm-quality.js';
import {
    bakeBillows, bakeCrust, bakeLattice, bakeNoise, lavaFieldSteps,
} from './pyrestorm-bake.js';
import {
    HITS, LIGHTS, createBillowTexture, createCrustTexture, createLatticeTexture, createLavaTextures, createNoiseTexture, createUniforms,
} from './pyrestorm-tsl.js';
import { createLand, landSteps } from './pyrestorm-land.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { createSky } from './pyrestorm-sky.js';
import { createAnvil } from './pyrestorm-anvil.js';
import { PUFF, Smoke } from './pyrestorm-smoke.js';
import { createPlume } from './pyrestorm-plume.js';
import { createFume } from './pyrestorm-fume.js';
import {
    BOLT, BOLT_LIFE, BOLT_SLOTS, boltLightEnvelope, createBolts,
} from './pyrestorm-bolts.js';
import {
    BOMB, BOMB_G, Bombs, createJets, createMotes,
} from './pyrestorm-fire.js';
import { cardUnion, fallbackLayout } from './pyrestorm-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

export const PYRESTORM_PARTS = Object.freeze(['land', 'sky', 'anvil', 'ash', 'bolts', 'jets', 'bombs', 'motes']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = ['locks', 'hardDrops', 'clears', 'lines', 'bolts', 'quads', 'tspins', 'perfects', 'chainSteps', 'discharges', 'spiders', 'b2bSteps', 'levelUps', 'gameOvers', 'wakes'];
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/**
 * The shortest gap between two frame-wide flashes (a blast, a perfect clear's sheet), seconds. A
 * four-line clear inside it is not dropped: its blast waits for the gap and goes as one stronger.
 */
export const FLASH_GAP = 1.2;
/** A level-up's surge of lava: its front runs this fast (km/s) and a later one feeds it this long. */
const PULSE_SPEED = 2.6;
const PULSE_FEED = 5;
/** Timed beats in flight (splashes, staggered bolts); hard-drop spam stays well inside it. */
const QUEUE = 256;

/** Bakes that do not depend on the tier: made once per page, shared by every rebuild. */
let sharedBakes = null;
/**
 * The first visit bakes them one at a time, a step each, so the sliced prepare breathes between
 * them (all four at once were one long task before the first yield). Later visits reuse them.
 */
function* bakeSteps() {
    if (sharedBakes) return sharedBakes;
    const lava = yield* lavaFieldSteps();
    yield 'lava';
    const noise = bakeNoise();
    yield 'noise';
    const lattice = bakeLattice();
    yield 'lattice';
    const billows = bakeBillows();
    yield 'billows';
    const crust = bakeCrust();
    sharedBakes = {
        lava, noise, lattice, billows, crust,
    };
    return sharedBakes;
}

/**
 * The first visit's four bakes in a module Worker (shared/bake-worker-client.js): the theme starts
 * this before its renderer, and a prepare given the promise does the land meanwhile, then takes the
 * bakes from here instead of baking them on the page's thread. A later visit has them already.
 */
export function pyrestormBakes() {
    return bakeInWorker({
        jobs: [{ kind: 'all', args: [] }],
        keyOf: () => 'pyrestorm:bakes',
        isReady: () => sharedBakes !== null,
        accept: (job, value) => {
            if (!sharedBakes) sharedBakes = value;
        },
        createWorker: () => new Worker(new URL('./pyrestorm-bake.worker.js', import.meta.url), { type: 'module' }),
    });
}

/** The land first (it needs no bake), then the bakes; 'land' marks the point between them. */
function* prepareSteps(quality) {
    const tier = tierFor(quality);
    const land = yield* landSteps(tier);
    yield 'land';
    const bakes = yield* bakeSteps();
    return { quality, bakes, land };
}

const breathe = () => new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden) {
        requestAnimationFrame(() => resolve());
    } else setTimeout(resolve, 0);
});

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * How long to work before the next breath (ms), from how long the last one took: at least a
 * frame's worth, and twice the breath, so a page slow to give the thread back (a software renderer
 * drawing the previous theme) costs the bake a few breaths, never one per slice.
 */
export function bakeSliceMs(lastBreathMs) {
    return Math.max(24, Math.min(2000, (Number(lastBreathMs) || 0) * 2));
}

async function prepareData(quality, { signal, bakesReady = null } = {}) {
    const steps = prepareSteps(quality);
    let budget = bakeSliceMs(0);
    let sliceStart = now();
    for (;;) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const next = steps.next();
        if (next.done) return next.value;
        if (next.value === 'land' && bakesReady) {
            // The worker's bakes, if it is still at them: the steps after this take them as kept.
            // eslint-disable-next-line no-await-in-loop
            await bakesReady;
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            sliceStart = now();
        }
        if (now() - sliceStart >= budget) {
            const before = now();
            // eslint-disable-next-line no-await-in-loop
            await breathe();
            budget = bakeSliceMs(now() - before);
            sliceStart = now();
        }
    }
}

function prepareDataSync(quality) {
    const steps = prepareSteps(quality);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

export class PyrestormWorld {
    /**
     * Bake the land and the lava, yielding to the page between slices. `bakesReady`: a
     * pyrestormBakes() promise, awaited after the land (the lava, noise and billows then come from
     * the worker).
     */
    static prepare(quality = 'High', { signal, bakesReady = null } = {}) {
        return prepareData(quality, { signal, bakesReady });
    }

    /** The same, synchronously (unit tests). */
    static prepareSync(quality = 'High') {
        return prepareDataSync(quality);
    }

    constructor({
        scene, quality = 'High', capture = false, seed = 0x9e7a, prepared = null,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.prepared = prepared;
        this.root = new THREE.Group();
        this.root.name = 'Pyrestorm';
        this.parts = {};
        this.partList = [];
        this.u = createUniforms();
        this.wheel = new WatchWheel();
        this.light = createWatchLight();
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this.reducedMotion = false;
        this.disposed = false;
        this.viewportHeight = 1080;
        this._camera = null;
        this._rig = { fov: 44, yaw: -4, pitch: 2.5 };
        this._v = new THREE.Vector3();
        this._p = [0, 0, 0];
        this._tint = [1, 1, 1];
        this._rgb = [0, 0, 0];
        this._post = {
            exposure: 1,
            bloomBoost: 0,
            flash: 0,
            flashColour: [1, 0.8, 0.6],
            heat: 1,
            saturation: 1.05,
        };
        this.overrides = { watch: null };
        // Bolt slots (CPU mirror of the shader's rows) and the timed queue.
        this.boltSlots = Array.from({ length: BOLT_SLOTS }, () => ({
            kind: 0, born: -1e6, power: 0, a: [0, 0, 0], b: [0, 0, 0], rgb: [1, 1, 1],
        }));
        this.boltCursor = 0;
        this.queue = Array.from({ length: QUEUE }, () => ({
            at: Infinity, kind: '', a: 0, b: 0, c: 0, x: 0, y: 0, z: 0,
        }));
        this.hitList = Array.from({ length: HITS }, () => ({
            x: 0, y: 0, z: 0, born: -1e6, rgb: [0, 0, 0], kind: 0, life: 0,
        }));
        this.hitCursor = 0;
        // Envelopes that accumulate (shared/swell.js): a new event adds to what is still lit and
        // never restarts it. The crater's glow after a burst (it swells in fast and fades), the
        // fountain's kick, the crust's tremor, the frame's flash (a blast), the glare of a perfect
        // clear's sheet (it rises, never strobes), a back-to-back's corona flare, and the T-spin
        // rings still climbing (each new one stacks above them).
        this.burstGlow = new Swell({
            attack: 0.08, release: 0.55, ceiling: 1.6, knee: 1.1,
        });
        this.kick = new Swell({ release: 1.25, ceiling: 2, knee: 1.3 });
        this.quake = new Swell({ release: 0.385, ceiling: 1, knee: 0.75 });
        this.flash = new Swell({ release: 0.35, ceiling: 1.3, knee: 1 });
        this.glare = new Swell({
            attack: 0.12, release: 0.3, ceiling: 1, knee: 0.75,
        });
        this.flare = new Swell({
            attack: 0.15, release: 2.2, ceiling: 0.9, knee: 0.6,
        });
        this.rings = new Swell({ release: 6, ceiling: 3, knee: 2 });
        /** The mountain's unrest: how hot play runs, sampled once a frame on the world's clock. */
        this.unrest = new GameplaySurge();
        this.play = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.resetState(0);
    }

    resetState(time) {
        this.time = time;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.counts = emptyCounts();
        this.random = mulberry32(this.seed);
        this.wheel.reset();
        this.activity = 1;
        this.activityTarget = 1;
        this.charge = 0;
        this.fountainLevel = 1;
        this.tremor = 0;
        this.corona = 0;
        this.burstGlow.reset();
        this.kick.reset();
        this.quake.reset();
        this.flash.reset();
        this.glare.reset();
        this.flare.reset();
        this.rings.reset();
        this.unrest.reset();
        this.play.punch = 0;
        this.play.level = 0;
        this.play.fever = 0;
        this.play.stage = 0;
        this.spiderClock = 0;
        this.ambientClock = 0;
        this.ambientGap = 6;
        /** The storm breaking in a fever: a phase for the strokes it throws onto the plain. */
        this.feverClock = 0;
        /** The blast now crossing the sky (its start and strength), and one waiting for the gap. */
        this.blastAt = -1e6;
        this.blastPower = 1;
        this.blastDue = Infinity;
        this.blastDuePower = 0;
        /** The perfect clear's sheet: its start, its strength, and what it carried over from the last. */
        this.sheetAt = -1e6;
        this.sheetGain = 1;
        this.sheetCarry = 0;
        /** The surge of fresh lava: its start, strength, and how long a later feed holds it. */
        this.pulseAt = -1e6;
        this.pulseGain = 1;
        this.pulseHold = 0;
        this.craterFlashAt = -1e6;
        this.lastLockAt = -1e6;
        /** When the storm last spent its charge (a chain's end, a perfect clear): it recharges slowly. */
        this.spentAt = -1e6;
        for (const s of this.boltSlots) {
            s.born = -1e6;
            s.power = 0;
        }
        this.boltCursor = 0;
        for (const q of this.queue) q.at = Infinity;
        for (const h of this.hitList) h.born = -1e6;
        this.hitCursor = 0;
        this.smoke?.clear();
        this.bombs?.clear();
        if (this.bolts) for (const row of this.bolts.tables) row.set(0, 0, 0, 0);
    }

    build() {
        if (this.root.parent) return this;
        const prepared = this.prepared || PyrestormWorld.prepareSync(this.quality);
        this.prepared = null;
        const { tier, u } = this;
        const { bakes } = prepared;
        this.textures = {
            lava: { near: createLavaTextures(bakes.lava.near), far: createLavaTextures(bakes.lava.far) },
            noise: createNoiseTexture(bakes.noise),
            lattice: createLatticeTexture(bakes.lattice),
            billows: createBillowTexture(bakes.billows),
            crust: createCrustTexture(bakes.crust),
        };
        const t = this.textures;
        this.addPart('land', createLand(u, t, tier, prepared.land));
        this.addPart('sky', createSky(u, t));
        this.addPart('anvil', createAnvil(u, t, tier));
        this.smoke = new Smoke(u, t, tier);
        // The eruption's cloud: the column (a volume) and the event puffs. The blast's shock front
        // shows where it passes through them (and through the anvil), never as a shell in clear air.
        this.plume = createPlume(u, t, tier);
        // The fissure's fume: its vents' gas, lit from below (sheets, not puffs).
        this.fume = createFume(u, t);
        this.addPart('ash', {
            mesh: this.smoke.mesh,
            meshes: [this.plume.mesh, this.smoke.mesh, ...this.fume.meshes],
            dispose: () => {
                this.plume.dispose();
                this.smoke.dispose();
                this.fume.dispose();
            },
        });
        this.bolts = createBolts(u, tier);
        this.addPart('bolts', this.bolts);
        this.addPart('jets', createJets(u, tier));
        this.bombs = new Bombs(u, tier.bombs);
        this.addPart('bombs', { mesh: this.bombs.mesh, dispose: () => this.bombs.dispose() });
        this.addPart('motes', createMotes(u, tier.motes));
        this.scene.add(this.root);
        return this;
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
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(1920, 1920 / Math.max(0.2, this.aspect));
    }

    /** The rest pose, a slow breath of the lens, and the pointer's parallax. */
    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = rigFor(this.aspect, this._rig);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.set(EYE.x, EYE.y, EYE.z);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 83) * 0.3 + clamp(pointerX, -1, 1) * 0.7);
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 61) * 0.1 - clamp(pointerY, -1, 1) * 0.22);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    /** The rest pose (no breath, no pointer): what a still frame of the theme looks like. */
    restCamera(camera) {
        const keep = this.reducedMotion;
        this.reducedMotion = true;
        this.pose(camera, 0, 0, 0);
        this.reducedMotion = keep;
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        // The shared breath (shared/camera-breath.js) on top of the pose, turning the view
        // only (a look out from the ridge at the volcano): off under reduced motion. Events aim
        // through the camera before update() runs, so its matrix is refreshed here.
        applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Where things happen ──────────────────────────────────────────────────────────

    /** A world point on screen (fractions, y down), or null behind the eye. */
    screenOf(p, out = { x: 0, y: 0 }) {
        const camera = this._camera;
        if (!camera) return null;
        this._v.set(p[0], p[1], p[2]).project(camera);
        if (this._v.z > 1) return null;
        out.x = this._v.x * 0.5 + 0.5;
        out.y = 0.5 - this._v.y * 0.5;
        return out;
    }

    /** True if a world point shows on screen outside the card and the HUD. */
    seen(p) {
        const s = this.screenOf(p, this._seen || (this._seen = { x: 0, y: 0 }));
        if (!s || s.x < 0.02 || s.x > 0.98 || s.y < 0.02 || s.y > 0.98) return false;
        const card = cardUnion(this.layout);
        const m = 0.03;
        if (card && s.x > card.x0 - m && s.x < card.x1 + m && s.y > card.y0 - m && s.y < card.y1 + m) return false;
        const { hud } = this.layout;
        if (hud && s.x > hud.x0 - m && s.x < hud.x1 + m && s.y > hud.y0 - m && s.y < hud.y1 + m) return false;
        return true;
    }

    /** A ground point at a bearing (radians in the xz plane) and distance from the crater. */
    groundFromCrater(bearing, radius, out = [0, 0, 0]) {
        out[0] = VOLCANO.x + Math.cos(bearing) * radius;
        out[2] = VOLCANO.z + Math.sin(bearing) * radius;
        out[1] = landHeight(out[0], out[2]);
        return out;
    }

    tintOf(color, out = this._tint) {
        hexToLinear(typeof color === 'string' ? color : '#FF6A1F', this._rgb);
        fireTint(this._rgb, out, 0.34);
        return out;
    }

    // ── The queue (timed beats inside one event; replayable) ────────────────────────

    schedule(at, kind, a = 0, b = 0, c = 0, x = 0, y = 0, z = 0) {
        let slot = null;
        for (const q of this.queue) {
            if (q.at === Infinity) {
                slot = q;
                break;
            }
        }
        if (!slot) {
            // Full: the soonest-due beat goes now, its place is reused.
            slot = this.queue.reduce((m, q) => (q.at < m.at ? q : m), this.queue[0]);
            this.run(slot);
        }
        slot.at = at;
        slot.kind = kind;
        slot.a = a;
        slot.b = b;
        slot.c = c;
        slot.x = x;
        slot.y = y;
        slot.z = z;
    }

    drain(time) {
        for (;;) {
            let next = null;
            for (const q of this.queue) if (q.at <= time && (!next || q.at < next.at)) next = q;
            if (!next) return;
            this.run(next);
        }
    }

    run(q) {
        const { at } = q;
        const { kind } = q;
        q.at = Infinity;
        if (kind === 'splash') this.splash(at, [q.x, q.y, q.z], q.a, q.b);
        else if (kind === 'bolt') this.strikeFrom(at, q.a, q.b, q.c, q.x);
        else if (kind === 'spider') this.spider(at);
        else if (kind === 'surge') this.surge(at);
        else if (kind === 'spend') this.spend(at);
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────────

    onLock(context = {}) {
        if (this.disposed) return;
        this.counts.locks++;
        const hard = Boolean(context.hardDrop);
        if (hard) this.counts.hardDrops++;
        this.lastLockAt = this.time;
        if (this.activityTarget < 1) this.onSessionStart();
        const cells = Array.isArray(context.cells) ? Math.max(1, Math.floor(context.cells.length / 2)) : 4;
        const drop = clamp01((context.distance || 0) / 18);
        const lean = clamp(Number.isFinite(context.u) ? context.u : 0.5, 0, 1) - 0.5;
        const tint = this.tintOf(context.color);
        const count = Math.round(cells * (hard ? 5 + drop * 3 : 3));
        this.unrest.lock(context, this.time);
        this.burst(this.time, count, lean, tint, hard ? 1.25 + drop * 0.2 : 1);
        if (hard) {
            this.quake.hit(0.65 + drop * 0.35, this.time);
            this.kick.hit(0.13, this.time);
        }
        // A T-spin that cleared nothing still blows a small ring.
        if (context.tspin) this.onTSpin({ lines: 0 });
    }

    /**
     * One bomb from `o` to a landing point: it climbs `apex` metres over the vent under the
     * bombs' time-lapsed gravity and falls onto the land, where an ember of it lies cooling.
     * Returns its flight (s).
     */
    throwBomb(o, land, apex, born, tint, px, glow = 4.5) {
        const r = this.random;
        const g = BOMB_G;
        const vy = Math.sqrt(2 * g * apex);
        const drop = Math.max(1, o[1] + apex - land[1]);
        const flight = vy / g + Math.sqrt((2 * drop) / g);
        this.bombs?.spawn({
            x: o[0],
            y: o[1],
            z: o[2],
            vx: (land[0] - o[0]) / flight,
            vy,
            vz: (land[2] - o[2]) / flight,
            born,
            life: flight,
            tint,
            px,
            kind: BOMB.bomb,
            g,
            trail: 0.7 + r() * 0.6,
        });
        this.bombs?.spawn({
            x: land[0], y: land[1] + 2, z: land[2], vx: 0, vy: 0, vz: 0, born: born + flight, life: glow * (0.7 + r() * 0.6), tint, px: px * 0.8, kind: BOMB.ember, g: 0,
        });
        return flight;
    }

    /**
     * A Strombolian burst: `count` bombs from the crater, leaning by `lean` (−0.5 left … 0.5
     * right on screen), each on its own arc to a landing point on the cone, where it splashes and
     * lies glowing; a spray of sparks out of the mouth, a puff of hot ash, and the crater glows.
     */
    burst(time, count, lean, tint, power = 1) {
        const r = this.random;
        // A pool filling up (hard drops faster than the bombs land) sheds sparks, and a burst throws
        // no more bombs than the pool can keep in flight: fewer under fast play, and every bomb
        // thrown lands and lies as an ember (each holds two slots, itself and its ember).
        const load = this.bombs ? this.bombs.load : 0;
        const thin = 1 - smooth(0.5, 0.95, load) * 0.75;
        const room = this.bombs ? this.bombs.room() : Infinity;
        const thrown = Math.max(1, Math.min(count, Math.floor(room / 2)));
        // The hotter play runs, the higher the mountain throws.
        const reach = 1 + this.play.level * 0.18;
        const toEye = Math.atan2(-VOLCANO.z, -VOLCANO.x);
        // The screen's left is the eye's left of the volcano: bearing toEye + 90° is screen-left.
        const bias = toEye - lean * 1.5;
        const o = [CRATER.x, CRATER.y + 30, CRATER.z];
        const land = this._p;
        for (let i = 0; i < thrown; i++) {
            const bearing = bias + (r() - 0.5) * 1.5;
            const radius = (600 + r() ** 0.8 * 1800) * (0.75 + 0.25 * power);
            this.groundFromCrater(bearing, radius, land);
            // A wide parabola: the higher it climbs, the further out it falls.
            const apex = (130 + radius * (0.24 + r() * 0.24)) * power * reach;
            const delay = r() * 0.22;
            const flight = this.throwBomb(o, land, apex, time + delay, tint, 3.2 + r() * 2.2);
            if (i < 4) this.schedule(time + delay + flight, 'splash', tint[0] * 0.5 + 0.5, 0, 0, land[0], land[1], land[2]);
        }
        // Sparks out of the mouth: fast, dragged to a stop within a few hundred metres.
        const sparks = Math.round((10 + count) * thin);
        for (let i = 0; i < sparks; i++) {
            const a = r() * TAU;
            const up = 0.35 + r() * 0.65;
            const s = (520 + r() * 900) * power;
            this.bombs?.spawn({
                x: o[0],
                y: o[1],
                z: o[2],
                vx: Math.cos(a) * s * Math.sqrt(1 - up * up),
                vy: s * up,
                vz: Math.sin(a) * s * Math.sqrt(1 - up * up),
                born: time + r() * 0.12,
                life: 0.9 + r() * 0.7,
                tint,
                px: 1.6 + r() * 0.7,
                kind: BOMB.spark,
                g: 220,
                drag: 2.3,
            });
        }
        this.puff(time, power);
        // The crater's glow and the fountain's kick add to what the last bursts left burning.
        this.burstGlow.hit(0.5 + 0.35 * power + count * 0.01, time);
        this.kick.hit(0.12 * power, time);
    }

    /** A burst's puff of ash out of the crater: hot at first, it climbs and joins the column. */
    puff(time, power = 1) {
        if (!this.smoke) return;
        const r = this.random;
        const n = Math.max(2, Math.round((this.tier.eventPuffs / 42) * (0.7 + 0.3 * power)));
        for (let i = 0; i < n; i++) {
            const a = r() * TAU;
            const out = 25 + r() * 45;
            this.smoke.spawn({
                x: CRATER.x + Math.cos(a) * 60,
                y: CRATER.y + 60 + r() * 60,
                z: CRATER.z + Math.sin(a) * 60,
                vx: Math.cos(a) * out,
                vy: (130 + r() * 110) * (0.8 + 0.2 * power),
                vz: Math.sin(a) * out,
                born: time + i * 0.05,
                life: 6 + r() * 3,
                radius: (90 + r() * 70) * (0.8 + 0.2 * power),
                grow: 34 + r() * 22,
                kind: PUFF.burst,
                heat: 0.75 + r() * 0.2,
                variant: Math.floor(r() * 16),
            });
        }
    }

    /** Where a bomb lands: a splash of spatter and a glowing spot on the cone. */
    splash(time, p, glow = 1, big = 0) {
        const r = this.random;
        const load = this.bombs ? this.bombs.load : 0;
        const spatter = Math.round((6 + big * 10) * (1 - smooth(0.5, 0.95, load) * 0.7));
        for (let i = 0; i < spatter; i++) {
            const a = r() * TAU;
            const s = 40 + r() * 70;
            this.bombs?.spawn({
                x: p[0], y: p[1] + 4, z: p[2], vx: Math.cos(a) * s, vy: 50 + r() * 70, vz: Math.sin(a) * s, born: time, life: 0.7 + r() * 0.6, tint: [1, 1, 1], px: 1.4, kind: BOMB.splash, g: 160, drag: 1.2,
            });
        }
        this.addHit(p, time, [glow, glow * 0.95, glow * 0.9], 0, 6);
    }

    /**
     * A glow on the ground: the first row whose glow is gone, else the one nearest its end (a
     * landing glow is never cut while an older one is fading out).
     */
    addHit(p, born, rgb, kind, life) {
        let pick = this.hitCursor;
        let left = Infinity;
        for (let k = 0; k < HITS; k++) {
            const i = (this.hitCursor + k) % HITS;
            const g = this.hitList[i];
            const rest = g.born + g.life - this.time;
            if (rest <= 0) {
                pick = i;
                break;
            }
            if (rest < left) {
                left = rest;
                pick = i;
            }
        }
        const h = this.hitList[pick];
        this.hitCursor = (pick + 1) % HITS;
        h.x = p[0];
        h.y = p[1];
        h.z = p[2];
        h.born = born;
        h.rgb[0] = rgb[0];
        h.rgb[1] = rgb[1];
        h.rgb[2] = rgb[2];
        h.kind = kind;
        h.life = life;
    }

    onClear(context = {}) {
        if (this.disposed) return;
        const t = this.time;
        if (context.perfect) {
            // The perfect clear lands a moment after its clear's last wave, on its own: a crown on
            // the clear still playing, never a second clear. (Rows with it are a clear of their own.)
            this.unrest.clear(context, t);
            this.onPerfect();
            if (!(Array.isArray(context.rows) && context.rows.length)) return;
        } else this.unrest.clear(context, t);
        const lines = clamp(Math.round(context.lines || 1), 1, 4);
        this.counts.clears++;
        this.counts.lines += lines;
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : [19, 18, 17, 16];
        // A cascade builds wave on wave: each strikes harder than the last, with a stroke more from
        // the third wave on (higher up the cone each time), and the crater answers every one.
        const deeper = clamp(Math.round(context.cascade || 1), 1, 12) - 1;
        const surge = 1 + 0.12 * Math.min(6, deeper);
        for (let k = 0; k < lines; k++) {
            const row = clamp(rows[Math.min(k, rows.length - 1)] ?? 19 - k, 0, 19);
            if (lines === 4 && k === 3) continue;
            const at = t + k * TIMING.boltStagger + (lines === 4 ? 0.35 : 0);
            this.schedule(at, 'bolt', BOLT.ground, row, (lines === 4 ? 0.85 : 1) * surge);
        }
        if (deeper >= 2) {
            const row = Math.max(0, 8 - deeper * 2);
            this.schedule(t + lines * TIMING.boltStagger * 0.5, 'bolt', BOLT.ground, row, surge);
        }
        if (deeper > 0) this.burstGlow.hit(0.25 * Math.min(5, deeper), t);
        this.kick.hit(0.25 + lines * 0.08 + 0.1 * Math.min(5, deeper), t);
        // Back-to-back: St Elmo's fire flares on the summit and the storm strikes the mountain itself.
        if (context.b2b) {
            this.flare.hit(0.45 + 0.1 * Math.min(4, this.b2b + 1), t);
            this.schedule(t + 0.2, 'bolt', BOLT.ground, 1, 1.15, 0.05);
        }
        if (lines === 4) this.onQuad();
        if (context.tspin) this.onTSpin(context);
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    /**
     * A bolt out of the column (or the anvil's head) to the ground: `row` 0 strikes high on the
     * cone, 19 out on the plain; a strike is placed where it shows (outside the card and HUD).
     */
    strikeFrom(time, kind, row = 12, power = 1, aim = 0) {
        const r = this.random;
        const A = [0, 0, 0];
        const B = [0, 0, 0];
        if (kind === BOLT.discharge) {
            // From the cloud on the column's upwind flank (left of the card) down to the summit.
            columnPoint(0.58, A);
            A[0] -= 1500;
            A[2] += 600;
            A[1] = ANVIL.base - 1100;
            B[0] = CRATER.x + 120;
            B[1] = CRATER.y + 90;
            B[2] = CRATER.z + 160;
        } else {
            columnPoint(0.3 + r() * 0.42, A);
            A[0] += (r() - 0.5) * 900;
            A[2] += (r() - 0.5) * 900;
            const toEye = Math.atan2(-VOLCANO.z, -VOLCANO.x);
            const f = clamp(row, 0, 19) / 19;
            let found = false;
            for (let k = 0; k < 8 && !found; k++) {
                const bearing = aim ? toEye + aim + (r() - 0.5) * 0.3 : toEye + (r() - 0.5) * 2.2;
                const radius = 900 + f * 5200 + r() * 700;
                this.groundFromCrater(bearing, radius, B);
                found = this.seen(B);
            }
        }
        this.strike(time, kind, A, B, power, this.light.bolt);
        this.counts.bolts++;
        if (kind !== BOLT.spider) {
            this.addHit(B, time + TIMING.leader, [0.9, 0.75, 0.9], 1, 3);
            // Sparks where it strikes.
            for (let i = 0; i < 10; i++) {
                const a = r() * TAU;
                const s = 15 + r() * 30;
                this.bombs?.spawn({
                    x: B[0], y: B[1] + 4, z: B[2], vx: Math.cos(a) * s * 3, vy: 60 + r() * 90, vz: Math.sin(a) * s * 3, born: time + TIMING.leader, life: 0.8 + r() * 0.6, tint: [0.75, 0.8, 1.2], px: 1.4, kind: BOMB.spark, g: 120, drag: 2.2,
                });
            }
        }
    }

    /**
     * Write one bolt into a slot: the first one whose channel is dark, else the one with the least
     * light left (a spider's counts at half: the cloud is full of them), so a clear's bolt never
     * cuts a stroke still glowing while a crawler is fading.
     */
    strike(time, kind, A, B, power, rgb) {
        let i = this.boltCursor;
        let least = Infinity;
        for (let k = 0; k < BOLT_SLOTS; k++) {
            const j = (this.boltCursor + k) % BOLT_SLOTS;
            const s = this.boltSlots[j];
            const left = s.born + BOLT_LIFE[s.kind] - time;
            if (s.power <= 0 || left <= 0) {
                i = j;
                break;
            }
            const score = left * s.power * (s.kind === BOLT.spider ? 0.5 : 1);
            if (score < least) {
                least = score;
                i = j;
            }
        }
        const slot = this.boltSlots[i];
        this.boltCursor = (i + 1) % BOLT_SLOTS;
        slot.kind = kind;
        slot.born = time;
        slot.power = power;
        for (let c = 0; c < 3; c++) {
            slot.a[c] = A[c];
            slot.b[c] = B[c];
            slot.rgb[c] = rgb[c];
        }
        const rows = this.bolts?.tables;
        if (rows) {
            rows[i * 3].set(A[0], A[1], A[2], time);
            rows[i * 3 + 1].set(B[0], B[1], B[2], power);
            rows[i * 3 + 2].set(rgb[0], rgb[1], rgb[2], kind + this.random() * 0.98);
        }
    }

    /** Spider lightning: a crawler along the anvil's underside. */
    spider(time, power = 0.7 + this.charge * 0.5) {
        const r = this.random;
        const ca = Math.cos(ANVIL.heading);
        const sa = Math.sin(ANVIL.heading);
        // The near reaches of the anvil (its head and first third), where the underside shows.
        const toWorld = (al, ac, y) => [ANVIL.x + ca * al * ANVIL.along - sa * ac * ANVIL.across, y, ANVIL.z + sa * al * ANVIL.along + ca * ac * ANVIL.across];
        const along = -0.92 + r() * 0.5;
        const across = (r() - 0.5) * 0.6;
        const A = toWorld(along, across, ANVIL.base - 120);
        const len = 4000 + r() * 6000;
        // Across the view (east or west), give or take thirty degrees: it crawls, it does not hang.
        const turn = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 1.0;
        // The far end, pulled back inside the anvil's near reaches if it would leave the cloud.
        const bx = A[0] + Math.cos(turn) * len;
        const bz = A[2] + Math.sin(turn) * len * 0.6;
        const rel = [bx - ANVIL.x, bz - ANVIL.z];
        const bal = Math.max(-0.95, Math.min(-0.3, (rel[0] * ca + rel[1] * sa) / ANVIL.along));
        const bac = Math.max(-0.4, Math.min(0.4, (rel[1] * ca - rel[0] * sa) / ANVIL.across));
        const B = toWorld(bal, bac, ANVIL.base - 200 + r() * 120);
        this.strike(time, BOLT.spider, A, B, power, this.light.bolt);
        this.counts.spiders++;
    }

    onQuad() {
        this.counts.quads++;
        const t = this.time;
        // The flash and the shock front at most once per FLASH_GAP (photosensitivity: meditation
        // taps can arrive as four-line clears several times a second); the bombs and bolts always.
        // A blast inside the gap waits for it and goes as one, stronger for every quad it holds:
        // a second quad is never the weaker one.
        if (t - this.blastAt >= FLASH_GAP || t < this.blastAt) this.blast(t, 1);
        else {
            this.blastDue = this.blastAt + FLASH_GAP;
            this.blastDuePower = Math.min(1.45, this.blastDuePower > 0 ? this.blastDuePower + 0.2 : 1.15);
        }
        this.kick.hit(1.1, t);
        // A ring of bombs in every direction.
        const r = this.random;
        const o = [CRATER.x, CRATER.y + 40, CRATER.z];
        const land = this._p;
        const room = this.bombs ? this.bombs.room() : Infinity;
        const n = Math.min(70, Math.floor(this.tier.bombs / 8), Math.max(8, Math.floor(room / 2)));
        for (let i = 0; i < n; i++) {
            const bearing = (i / n) * TAU + r() * 0.2;
            this.groundFromCrater(bearing, 700 + r() * 2200, land);
            const born = t + r() * 0.15;
            const flight = this.throwBomb(o, land, 550 + r() * 800, born, [1, 1, 1], 3 + r() * 2, 7);
            if (i % 5 === 0) this.schedule(born + flight, 'splash', 1, 1, 0, land[0], land[1], land[2]);
        }
        this.puff(t, 2.2);
        this.burstGlow.hit(1.3, t);
        this.schedule(t + 0.3, 'surge');
        this.schedule(t + 1.25, 'bolt', BOLT.discharge, 0, 1.5);
    }

    /** The blast itself: the frame's flash, the crater's flash and the shock front, at `power`. */
    blast(time, power) {
        this.blastAt = time;
        this.blastPower = power;
        this.craterFlashAt = time;
        this.flash.hit(power, time);
    }

    /** The blast's surge: glowing ash rolling down the breach. */
    surge(time) {
        if (!this.smoke) return;
        const r = this.random;
        const down = VOLCANO.breach;
        for (let i = 0; i < 14; i++) {
            const a = down + (r() - 0.5) * 0.7;
            const speed = 120 + r() * 90;
            this.smoke.spawn({
                x: CRATER.x + Math.cos(a) * 200,
                y: CRATER.y - 80,
                z: CRATER.z + Math.sin(a) * 200,
                vx: Math.cos(a) * speed,
                vy: -speed * 0.38,
                vz: Math.sin(a) * speed,
                born: time + i * 0.12,
                life: TIMING.surge + r() * 3,
                radius: 160 + r() * 90,
                grow: 55 + r() * 30,
                kind: PUFF.surge,
                heat: 0.9,
                variant: Math.floor(r() * 16),
            });
        }
    }

    onTSpin(context = {}) {
        this.counts.tspins++;
        if (!this.smoke) return;
        const t = this.time;
        const r = this.random;
        // A T-spin that cleared nothing blows a small ring; rings still climbing lift the next one
        // above them and make it wider (T-spin after T-spin stack up the column).
        const small = !(context.lines > 0);
        const stack = Math.min(2, this.rings.valueAt(t));
        this.rings.hit(small ? 0.5 : 1, t);
        const size = (small ? 0.62 : 1) * (1 + 0.16 * stack);
        const share = small ? 0.4 : 1;
        // A torus: two concentric rings of many small, jittered puffs (a hot inner edge, a sooty
        // outer one), the ring several times wider than its puffs so the hole reads; tipped toward
        // the eye so from below it reads as an ellipse. It leaves on the column's near, upwind side
        // (where it shows against the clear sky), hot, and greys as it climbs.
        const base = [CRATER.x - 260, CRATER.y + 320 + stack * 240, CRATER.z + 380];
        const drift = [-22, 0, 16];
        const tilt = 0.3;
        const cosT = Math.sqrt(1 - tilt * tilt);
        const out = 70;
        const rings = [
            {
                n: 40, ring: 235, radius: 66, grow: 8, heat: 0.95,
            },
            {
                n: 40, ring: 300, radius: 80, grow: 10, heat: 0.25,
            },
        ];
        for (const R of rings) {
            const n = Math.round(R.n * share);
            for (let k = 0; k < n; k++) {
                const a = (k / n) * TAU + (r() - 0.5) * 0.08;
                const rr = R.ring * size * (0.94 + r() * 0.12);
                const cx = Math.cos(a);
                const sz = Math.sin(a);
                this.smoke.spawn({
                    x: base[0] + cx * rr,
                    y: base[1] + sz * rr * tilt + (r() - 0.5) * 20,
                    z: base[2] + sz * rr * cosT,
                    vx: cx * out + drift[0],
                    vy: 88 + sz * out * tilt,
                    vz: sz * out * cosT + drift[2],
                    born: t,
                    life: TIMING.ring * (small ? 0.6 : 1),
                    radius: R.radius * size * (0.8 + r() * 0.4),
                    grow: R.grow,
                    kind: PUFF.ring,
                    heat: R.heat,
                    variant: Math.floor(r() * 16),
                });
            }
        }
        this.kick.hit(small ? 0.15 : 0.35, t);
    }

    /** The sheet's strength at `time` (before Reduce flashing). */
    sheetStrength(time) {
        const age = time - this.sheetAt;
        if (!(age >= 0)) return 0;
        const fade = 1 - smooth(TIMING.sheet, TIMING.sheet + TIMING.sheetFade, age);
        const own = smooth(0, 0.2, age) * fade * this.sheetGain;
        return Math.max(own, this.sheetCarry * (1 - smooth(0, 1.5, age)));
    }

    /**
     * A perfect clear: the crown on the clear still playing. Sheet lightning sweeps the anvil (a
     * sweep still crossing burns brighter instead of starting over; a later one takes over from
     * what is lit), the sky's glare swells, a crown of bolts round the summit, the fountain at its
     * highest, and the storm's charge is spent in a discharge: then it goes quiet.
     */
    onPerfect() {
        this.counts.perfects++;
        const t = this.time;
        const age = t - this.sheetAt;
        if (age >= 0 && age < TIMING.sheet) this.sheetGain = Math.min(1.5, this.sheetGain + 0.3);
        else {
            this.sheetCarry = this.sheetStrength(t);
            this.sheetAt = t;
            this.sheetGain = 1;
        }
        this.glare.hit(0.8, t);
        this.kick.hit(1.3, t);
        // A crown of bolts round the summit from the anvil's head.
        const crown = [-0.95, 0.85, -0.35, 0.3];
        for (let k = 0; k < crown.length; k++) this.schedule(t + 0.25 + k * 0.2, 'bolt', BOLT.ground, 3 + k, 1.1, crown[k]);
        if (this.charge > 0.15) this.schedule(t + 1.15, 'bolt', BOLT.discharge, 0, 1.2 + this.charge * 0.4);
        this.schedule(t + 1.2, 'spend');
    }

    /** The storm spends its charge (a discharge went): it falls quiet and recharges slowly. */
    spend(time) {
        this.charge *= 0.35;
        this.spentAt = time;
    }

    onCombo(value) {
        const n = clamp(Math.round(value) || 0, 0, 1000);
        if (n === this.combo) return;
        if (n > this.combo && n >= 2) this.counts.chainSteps++;
        if (n === 0 && this.peak >= 3) {
            // The chain's end: the charge goes in one great discharge, more strokes after it the
            // longer the chain ran, and the fountain heaves once; then the storm is quiet.
            const t = this.time;
            const peak = Math.min(12, this.peak);
            this.counts.discharges++;
            this.schedule(t + 0.05, 'bolt', BOLT.discharge, 0, 1.05 + peak * 0.04);
            const strokes = 1 + Math.min(3, Math.floor((peak - 3) / 2));
            for (let k = 0; k < strokes; k++) this.schedule(t + 0.4 + k * 0.28, 'bolt', BOLT.ground, 6 + k * 4, 0.9);
            this.kick.hit(0.3 + peak * 0.06, t);
            this.schedule(t + 0.1, 'spend');
        }
        this.combo = n;
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
    }

    onB2B(value) {
        const n = clamp(Math.round(value) || 0, 0, 4);
        if (n > this.b2b) this.counts.b2bSteps++;
        this.b2b = n;
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n === this.level) return;
        const up = n > this.level;
        if (up) this.wheel.levelUp(n, time, silent || this.reducedMotion);
        else this.wheel.setLevel(n);
        this.level = n;
        if (up && !silent) {
            this.counts.levelUps++;
            this.feedPulse(time, 1);
            this.kick.hit(0.85, time);
            this.unrest.levelUp(time);
        }
    }

    /**
     * Fresh lava from the vents: a surge whose front is still on the channels is fed (it burns
     * brighter and holds on longer); otherwise a new one leaves the vents.
     */
    feedPulse(time, gain) {
        const age = time - this.pulseAt;
        if (age >= 0 && age < PULSE_FEED) {
            this.pulseGain = Math.min(1.7, this.pulseGain + gain * 0.35);
            this.pulseHold = age;
        } else {
            this.pulseAt = time;
            this.pulseGain = gain;
            this.pulseHold = 0;
        }
    }

    onGameOver() {
        this.counts.gameOvers++;
        this.activityTarget = 0.3;
    }

    onSessionStart() {
        if (this.activityTarget < 1) this.counts.wakes++;
        this.activityTarget = 1;
    }

    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        // The next run starts at level 1; the night keeps the watch it has reached.
        this.level = 1;
        this.wheel.newRun();
    }

    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
    }

    // ── Frame ────────────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const { time, u } = this;
        const dt = Math.max(0, Math.min(0.25, sim.delta || 0));
        this.drain(time);

        // The watch of the night.
        const place = this.overrides.watch !== null ? this.overrides.watch : this.wheel.place(time);
        const L = watchAt(place, this.light);
        u.zenith.value.fromArray(L.zenith);
        u.horizon.value.fromArray(L.horizon);
        u.dusk.value.fromArray(L.dusk);
        u.haze.value.fromArray(L.haze);
        u.ambient.value.fromArray(L.ambient);
        u.ash.value.fromArray(L.ash);
        u.bolt.value.fromArray(L.bolt);
        u.fireColour.value.fromArray(L.fire);
        u.stars.value = L.stars;
        u.hazeDensity.value = L.hazeDensity;
        u.duskBearing.value = L.duskBearing;

        // A blast that waited out the flash gap goes now.
        if (this.blastDue <= time) {
            const due = this.blastDue;
            this.blastDue = Infinity;
            this.blast(due, this.blastDuePower);
            this.blastDuePower = 0;
        }

        // The mountain's unrest: how hot play runs, in three overlapping acts (warm, hot, fever).
        const play = this.unrest.sample(time);
        this.play.punch = play.punch;
        this.play.level = play.level;
        this.play.fever = play.fever;
        this.play.stage = play.stage;
        const { level, fever } = play;
        const warm = smooth(0.18, 0.55, level);
        const hot = smooth(0.45, 0.85, level);
        // The lava runs hotter with it: brighter rivers, a thinner crust.
        u.lavaHeat.value = L.lavaHeat * (1 + warm * 0.05 + hot * 0.06 + fever * 0.08);

        // The eruption's state: activity (game over), the storm's charge (the chain, and the fire
        // itself once play runs hot), the fountain.
        this.activity += (this.activityTarget - this.activity) * approach(this.activityTarget < this.activity ? 3 / TIMING.sink : 3 / TIMING.wake, dt);
        const chainAsk = this.combo >= 2 ? clamp01((this.combo - 1) / 6) : 0;
        const fireAsk = (hot * 0.4 + fever * 0.5) * this.activityTarget;
        // A spent storm (a discharge just went) takes a few seconds before it charges again.
        const chargeAsk = Math.max(chainAsk, fireAsk) * smooth(0, 5, time - this.spentAt);
        this.charge += (chargeAsk - this.charge) * approach(chargeAsk > this.charge ? TIMING.chargeRise : TIMING.chargeFall, dt);
        if (time - this.lastLockAt > TIMING.idle && this.combo === 0) this.charge *= 1 - approach(0.5, dt);
        // The fountain climbs with the unrest (the summit fountaining in a fever) and every kick
        // adds to what the last ones left.
        const kick = this.kick.valueAt(time);
        const fountainAsk = Math.min(3.4, 1 + this.charge * 0.55 + kick + warm * 0.3 + hot * 0.3 + fever * 0.5);
        this.fountainLevel += (fountainAsk - this.fountainLevel) * approach(fountainAsk > this.fountainLevel ? 3.5 : 0.9, dt);
        // The crust tears open with each hard drop; hot play keeps it open along every channel.
        this.tremor = this.quake.valueAt(time);
        this.corona += (this.b2b / 4 - this.corona) * approach(1.2, dt);
        u.burst.value = this.burstGlow.valueAt(time) * this.activity;
        u.activity.value = this.activity;
        u.charge.value = this.charge;
        u.fountain.value = this.fountainLevel;
        u.tremor.value = Math.min(1, this.tremor + (hot * 0.1 + fever * 0.2) * this.activity);
        u.corona.value = Math.min(1.4, this.corona + this.flare.valueAt(time));
        u.time.value = time;
        // The lava flows at a constant rate (the clock times a constant, wrapped).
        u.flow.value = time % 2000;

        // The storm at rest: now and then the cloud flashes from inside (one crawler, softly).
        if (this.activity > 0.5) {
            this.ambientClock += dt / this.ambientGap;
            if (this.ambientClock >= 1) {
                this.ambientClock = 0;
                this.ambientGap = 4 + this.random() * 5;
                this.spider(time, 0.38);
            }
        }
        // Spider lightning while the storm is charged: a phase integrated at a rate that follows
        // the charge (never the clock times a moving rate).
        if (this.charge > 0.04 && this.activity > 0.5) {
            this.spiderClock += dt * (0.35 + this.charge * 2.2);
            while (this.spiderClock >= 1) {
                this.spiderClock -= 1;
                this.spider(time);
            }
        }
        // Reduce flashing (ADR-0021) holds back every frame-wide light: the shock front, the sheet,
        // the crater's flash, and the storm breaking in a fever.
        const fs = flashScale();
        // A fever: the storm breaks (strokes onto the plain on their own, a phase that follows
        // the fever) and fresh lava keeps pouring from the vents.
        if (fever > 0.3 && this.activity > 0.5) {
            this.feverClock += dt * (fever - 0.3) * 1.3 * fs;
            while (this.feverClock >= 1) {
                this.feverClock -= 1;
                this.strikeFrom(time, BOLT.ground, 8 + Math.floor(this.random() * 12), 0.75 + fever * 0.3);
            }
            if (fever > 0.6 && time - this.pulseAt > PULSE_FEED) this.feedPulse(time, 0.75);
        }

        // Four lines: the shock front; perfect: the sheet; level-up: the surge.
        const bAge = time - this.blastAt;
        const front = Math.exp(-Math.max(0, bAge) / 0.42) * smooth(0, 0.05, bAge) * (bAge < 1.5 ? 1 : 0);
        u.shock.value.set(300 + Math.max(0, bAge) * 3000, front * 0.9 * Math.min(1.15, this.blastPower) * fs, bAge);
        const sAge = time - this.sheetAt;
        u.sheet.value.set(clamp01(sAge / TIMING.sheet), this.sheetStrength(time) * fs);
        const pAge = time - this.pulseAt;
        const hold = this.pulseHold;
        const pulse = smooth(0, 0.3, pAge) * (1 - smooth(6 + hold, 10 + hold, pAge)) * 1.6 * this.pulseGain;
        u.pulse.value.set(pAge * PULSE_SPEED, pulse);

        this.updateLights(time, fs);
        this.updateHits(time);

        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, this.viewportHeight || 1080);
        }
        this.smoke?.update(time, u.eye.value, u.camFwd.value);
        this.bombs?.update(time);
        this.updatePost(time, warm, hot);
    }

    /** The lights the land and the cloud read: live bolts and the blast's flash, strongest first. */
    updateLights(time, fs = 1) {
        const rows = this.u.tables.lights;
        const list = this._lightList || (this._lightList = []);
        list.length = 0;
        for (const s of this.boltSlots) {
            const age = time - s.born;
            if (s.power <= 0 || age < 0 || age > BOLT_LIFE[s.kind]) continue;
            const env = boltLightEnvelope(s.kind, age) * s.power;
            if (env < 0.01) continue;
            // The light sits a third of the way down the channel (in the cloud's base).
            const k = s.kind === BOLT.spider ? 0.5 : 0.3;
            list.push({
                x: s.a[0] + (s.b[0] - s.a[0]) * k,
                y: s.a[1] + (s.b[1] - s.a[1]) * k,
                z: s.a[2] + (s.b[2] - s.a[2]) * k,
                radius: s.kind === BOLT.spider ? 4800 : 3600,
                r: s.rgb[0] * env * 0.55,
                g: s.rgb[1] * env * 0.55,
                b: s.rgb[2] * env * 0.55,
                w: env,
            });
        }
        // The storm's slow life: a dim glow wandering inside the cloud near the column's head.
        if (this.activity > 0.5) {
            const cycle = 1.7;
            const k = Math.floor(time / cycle);
            const f = time / cycle - k;
            const h = (n) => {
                const x = Math.sin((k + 1) * 12.9898 + n * 78.233) * 43758.5453;
                return x - Math.floor(x);
            };
            const head = columnPoint(0.82 + h(1) * 0.16, this._p);
            const e = Math.sin(Math.PI * f) ** 2 * (0.12 + h(2) * 0.16) * (0.6 + this.charge * 0.8);
            if (e > 0.01) {
                list.push({
                    x: head[0] + (h(3) - 0.5) * 6000,
                    y: ANVIL.base - 400,
                    z: head[2] + (h(4) - 0.5) * 4000,
                    radius: 5200,
                    r: this.light.bolt[0] * e,
                    g: this.light.bolt[1] * e,
                    b: this.light.bolt[2] * e,
                    w: e * 0.5,
                });
            }
        }
        // A burst: the crater's mouth glows up through the foot of the column and on the cone.
        const glow = this.u.burst.value;
        if (glow > 0.02) {
            const e = glow * 1.2;
            list.push({
                x: CRATER.x, y: CRATER.y + 260, z: CRATER.z, radius: 2600, r: e * 1.0, g: e * 0.46, b: e * 0.16, w: e * 0.9,
            });
        }
        // The blast: the crater flashes (once per blast, as strong as the blast).
        const fAge = time - this.craterFlashAt;
        if (fAge >= 0 && fAge < 2.5) {
            const e = Math.exp(-fAge / 0.35) * 1.6 * Math.min(1.3, this.blastPower) * fs;
            list.push({
                x: CRATER.x, y: CRATER.y + 300, z: CRATER.z, radius: 2600, r: e * 1.0, g: e * 0.52, b: e * 0.2, w: e,
            });
        }
        list.sort((a, b) => b.w - a.w);
        const n = Math.min(LIGHTS, list.length);
        for (let i = 0; i < LIGHTS; i++) {
            if (i < n) {
                const L = list[i];
                rows[i * 2].set(L.x, L.y, L.z, L.radius);
                rows[i * 2 + 1].set(L.r, L.g, L.b, 0);
            } else {
                rows[i * 2].set(0, -1e5, 0, 1);
                rows[i * 2 + 1].set(0, 0, 0, 0);
            }
        }
        this.u.lightCount.value = n;
    }

    updateHits(time) {
        const rows = this.u.tables.hits;
        let n = 0;
        for (const h of this.hitList) {
            const age = time - h.born;
            if (age < -0.001 || age > h.life) continue;
            rows[n * 2].set(h.x, h.y, h.z, h.born);
            rows[n * 2 + 1].set(h.rgb[0], h.rgb[1], h.rgb[2], h.kind);
            n++;
        }
        for (let i = n; i < HITS; i++) {
            rows[i * 2].set(0, -1e5, 0, -1e6);
            rows[i * 2 + 1].set(0, 0, 0, 0);
        }
        this.u.hitCount.value = n;
    }

    updatePost(time, warm = 0, hot = 0) {
        const post = this._post;
        const { level, fever } = this.play;
        // The blast's flash and the perfect clear's glare (it rises: never a second strobe),
        // added; below a visible step it is nothing. The post applies Reduce flashing.
        const f = this.flash.valueAt(time) + this.glare.valueAt(time) * 0.85;
        const flash = Math.min(0.5, f * f * 0.45);
        post.flash = flash > 0.003 ? flash : 0;
        post.flashColour = this.light.fire;
        const kick = Math.min(1, this.kick.valueAt(time));
        post.bloomBoost = Math.min(1, this.charge * 0.35 + kick * 0.2 + hot * 0.06 + fever * 0.1);
        // An iris: the eruption's heat adds light, so it closes a little and the fire keeps its
        // colour and the night its dark.
        post.exposure = 1 - Math.max(0, level - 0.25) * 0.08 - fever * 0.06;
        // The air over the lava shimmers harder as the mountain heats (not under reduced motion).
        const shimmer = (warm * 0.1 + hot * 0.15 + fever * 0.2) * (this.reducedMotion ? 0 : 1);
        post.heat = (0.6 + 0.4 * this.activity) * (1 + shimmer);
        post.saturation = 1.04 + this.charge * 0.06 + level * 0.03;
    }

    getPostState() { return this._post; }

    /** What a rebuild in place carries over: the wheel, the level, the eruption's state. */
    exportSessionState() {
        return {
            wheel: this.wheel.exportState(),
            level: this.level,
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            activity: this.activity,
            activityTarget: this.activityTarget,
            charge: this.charge,
            corona: this.corona,
        };
    }

    importSessionState(state) {
        if (!state || typeof state !== 'object') return;
        this.wheel.importState(state.wheel);
        const num = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);
        this.level = Math.max(1, Math.round(num(state.level, 1, 1e6, 1)));
        this.combo = Math.round(num(state.combo, 0, 1000, 0));
        this.peak = Math.round(num(state.peak, 0, 1000, 0));
        this.b2b = Math.round(num(state.b2b, 0, 4, 0));
        this.activity = num(state.activity, 0, 1, 1);
        this.activityTarget = num(state.activityTarget, 0, 1, 1);
        this.charge = num(state.charge, 0, 1, 0);
        this.corona = num(state.corona, 0, 1, 0);
    }

    getState() {
        let liveBolts = 0;
        for (const s of this.boltSlots) if (s.power > 0 && this.time - s.born >= 0 && this.time - s.born <= BOLT_LIFE[s.kind]) liveBolts++;
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            watch: {
                place: this.light.place, from: this.light.from, to: this.light.to, mix: this.light.mix, name: WATCHES[this.light.from].name,
            },
            counts: { ...this.counts },
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            charge: this.charge,
            fountain: this.fountainLevel,
            activity: this.activity,
            tremor: this.tremor,
            liveBolts,
            lights: this.u.lightCount.value,
            hits: this.u.hitCount.value,
            bombs: this.bombs ? this.bombs.live(this.time) : 0,
            eventPuffs: this.smoke ? this.smoke.liveEvents(this.time) : 0,
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            parts: Object.keys(this.parts),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        if (this.textures) {
            for (const f of ['near', 'far']) {
                this.textures.lava[f].a.dispose();
                this.textures.lava[f].b.dispose();
            }
            this.textures.noise.dispose();
            this.textures.lattice.dispose();
            this.textures.billows.dispose();
            this.textures.crust.dispose();
        }
        this.root.clear();
        this.partList.length = 0;
    }
}

export { BOLT };
