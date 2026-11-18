/**
 * Pyrestorm — one shared world (the theme and the playground mount the same one).
 *
 * The eruption at night seen from the tephra ridge: the land (plain, volcano, lava) and the charred
 * snags on the eye's own slope, the sky with its moon, the anvil, the column's ash, the lightning,
 * the fountain and the fissure's curtain, the fire whirls, the bombs and the motes; and everything
 * gameplay does to them. The volcano answers the board, each event with a shape of its own:
 *
 *   lock        a Strombolian burst: the crater throws incandescent bombs (as many as the piece
 *               has cells, more on a hard drop) that arc out leaning the way the piece locked
 *               (left columns left, right columns right) and splash where they land on the cone,
 *               tinted a little by the piece's colour
 *   hard drop   a bigger burst, the crust shaken open along every channel (a tremor), and spatter
 *               leaping off the near rivers where they pass the ridge
 *   clear       one cloud-to-ground bolt per line out of the column, staggered; a higher row
 *               strikes higher up the cone, the floor rows strike the plain; each strike scorches
 *               the ground and lights the column from inside; the fountain kicks. Three lines: the
 *               fissure answers too, its three vents jetting together
 *   chain       the storm charges: spider lightning crawls along the anvil's underside, more
 *               often as the chain grows, the fountain climbs, the column's foot burns hotter;
 *               when a long chain breaks, the charge goes in one great branched discharge from
 *               the anvil to the summit
 *   four lines  a Vulcanian blast: the crater flashes, a shock front races out through the
 *               column and the anvil, the crater throws its bombs steeply out of its whole width
 *               (each drawing its parabola), the fountain jets, a thermal of glowing ash climbs the
 *               column, flows of ash pour down the cone hugging its ground, then the discharge
 *               and the storm's answer on the cone's shoulders
 *   twist       the crater blows a glowing vortex ring that rises and widens beside the column,
 *               and the hot air over the near lava winds up into a whirl of fire on the side the
 *               piece turned in on (on both rivers for a twist of two lines or more)
 *   b2b         sulphur catches: blue fire in tongues along the lava's banks, low along the
 *               fissure and round the crater's mouth, higher with every step of the run
 *   perfect     sheet lightning sweeps the whole anvil from the head downwind, a crown of bolts
 *               round the summit, and a wave of fire runs down both rivers from their sources to
 *               the eye, the lava gilded behind it
 *   level up    the night moves on a watch and the eruption a phase (both also drift with the
 *               clock alone), a surge of fresh lava runs down every channel, and a flank vent tears
 *               open on the cone's face: a line of fountains and a fresh stream down the fall line
 *   game over   the eruption sinks to a glow with a last breath of ash: the column thins, the
 *               rivers crust over, the ash comes down; the next run wakes it with a burst
 *
 * Beside play the mountain lives by itself (pyrestorm-phases.js): the eruption turns through five
 * phases on its own clock (strombolian, paroxysm, ash storm, effusive, the glow), each a different
 * fountain, column, anvil and lava; and every twenty seconds or so it does something of its own
 * (a lone bomb, a glowing rockfall, a shooting star, a gust of embers, a vent jetting, a stroke
 * of the storm, the lava lake turning over, a pour of lava), softly, uncounted as play.
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
 * The ridge feels it (pyrestorm-shake.js): a hard drop thuds through the ground, every stroke's
 * thunder cracks a beat after its flash (louder the nearer it struck), the blast's air wave knocks
 * the view, a twist's ring and a perfect clear's sheet roll it, and fresh lava makes the mountain
 * groan. Small turns of the view, added up like the light, and none under reduced motion.
 *
 * Lifecycle: `await PyrestormWorld.prepare(quality, { signal })` bakes the land and the lava in
 * slices; `new PyrestormWorld({ ..., prepared }).build()` makes the scene objects; each frame
 * `updateCamera` → `update` → the post renders.
 */
import * as THREE from 'three/webgpu';
import {
    ANVIL, CRATER, DEG, EYE, FISSURE, RIG, RIVERS, TAU, TIMING, VOLCANO, approach, clamp, clamp01, columnPoint, fireTint, hexToLinear,
    landHeight, mulberry32, rigFor, smooth,
} from './pyrestorm-core.js';
import {
    WATCHES, WatchWheel, createWatchLight, watchAt,
} from './pyrestorm-hours.js';
import {
    HAPPEN_SECONDS, createPhaseState, happeningAt, phaseAt, phaseIndexOf, phasePlace,
} from './pyrestorm-phases.js';
import { tierFor } from './pyrestorm-quality.js';
import {
    bakeBillows, bakeCrust, bakeLattice, bakeNoise, lavaFieldSteps,
} from './pyrestorm-bake.js';
import {
    BLUE_FIRE, FLANK_VENTS, HITS, LIGHTS, createBillowTexture, createCrustTexture, createLatticeTexture, createLavaTextures, createNoiseTexture,
    createUniforms,
} from './pyrestorm-tsl.js';
import { createLand, landSteps } from './pyrestorm-land.js';
import { createSnags } from './pyrestorm-snags.js';
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
import { drainSteps } from '../shared/build-steps.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { RidgeShake } from './pyrestorm-shake.js';
import {
    WHIRL_LIFE, WHIRL_SLOTS, createWhirls, whirlEnvelope,
} from './pyrestorm-whirl.js';
import { FANS_PER_VENT, createFans } from './pyrestorm-fans.js';

export const PYRESTORM_PARTS = Object.freeze(['land', 'snags', 'sky', 'anvil', 'ash', 'bolts', 'jets', 'fans', 'whirls', 'bombs', 'motes']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = ['locks', 'hardDrops', 'clears', 'lines', 'bolts', 'quads', 'twists', 'perfects', 'chainSteps', 'discharges', 'spiders', 'b2bSteps', 'levelUps', 'gameOvers', 'wakes',
    'whirls', 'vents', 'flows', 'happenings'];
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
/** From the eye to the crater (m): how far the blast's air wave travels to the ridge. */
const CRATER_DISTANCE = Math.hypot(CRATER.x - EYE.x, CRATER.y - EYE.y, CRATER.z - EYE.z);
/** The fever's own strokes and pours shake the ridge this much of what play's would. */
const FEVER_THUNDER = 0.5;
const FEVER_GROAN = 0.5;
/** The line from the volcano to the eye (radians in the xz plane): bearings are measured from it. */
const TO_EYE = Math.atan2(EYE.z - VOLCANO.z, EYE.x - VOLCANO.x);
/**
 * Where a level-up's flank vent opens, one after another: radians round the cone from the line to
 * the eye (positive = the screen's left, the face the card does not cover), in the gaps between the
 * cone's own streams (which run 0.05, 0.32 and 0.59 round from that line on this side).
 */
const VENT_BEARINGS = Object.freeze([0.19, 0.82, 0.455, 1.02, -0.09]);
/** The blast's bombs: the deep orange of rock already cooling as it flies (a fire tint). */
const BLAST_TINT = Object.freeze([1, 0.74, 0.5]);
/** A flank vent's fountains play this long (s); its stream reaches its length in about a third of that. */
const VENT_FOUNTAIN = 11;
/** Its fans of fire: metres down the vent from its head, and how tall each stands at its height (m). */
const VENT_FANS = Object.freeze([[40, 620], [300, 470], [560, 330]]);
/** A back-to-back run's wisps of blue fire: their colour as the particles carry it. */
const WISP_TINT = Object.freeze(BLUE_FIRE.map((c) => c * 1.5));
/** How far above a card lightning keeps clear (screen heights): the next pieces stand there. */
const BOLT_CLEAR_ABOVE = 0.12;
/** A perfect clear's wave of fire runs down the rivers this fast (km/s) and its gold burns this long (s). */
const WAVE_SPEED = 6.5;
const GILD_SECONDS = 5.5;
/** Four lines: the thermal climbs the column for this long (s). */
const THERMAL_SECONDS = 9;

/**
 * The rivers as the events need them: points down the two that pass the eye (the main river on
 * its left, the fissure's on its right), each (x, y, z, km from the source), every 180 m or so.
 * From the baked channels when the bake kept them, else from the authored control points.
 */
function riverRuns(channels) {
    const runs = { left: [], right: [] };
    const take = (side, id) => {
        const channel = Array.isArray(channels) ? channels.find((c) => c && c.id === id) : null;
        const pts = [];
        if (channel?.pts?.length > 1) {
            let last = -1e9;
            for (let i = 0; i < channel.pts.length; i++) {
                const at = channel.s[i];
                if (at - last < 180) continue;
                last = at;
                pts.push([channel.pts[i][0], channel.pts[i][1], ((channel.arc0 || 0) + at) / 1000]);
            }
        } else {
            const river = RIVERS.find((r) => r.id === id);
            let at = 0;
            for (let i = 0; river && i < river.points.length - 1; i++) {
                const a = river.points[i];
                const b = river.points[i + 1];
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                const n = Math.max(1, Math.round(len / 180));
                for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, (at + (len * k) / n) / 1000]);
                at += len;
            }
        }
        for (const p of pts) runs[side].push([p[0], landHeight(p[0], p[1]) + 3, p[1], p[2]]);
    };
    take('left', 'main');
    take('right', 'fissure');
    return runs;
}

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

/** How long a slice of the prepare works before it breathes (ms), on a page quick to give it back. */
const BAKE_SLICE_MS = 10;
/** A breath longer than this (three 60 Hz frames) is a slow page's: past it the slices grow. */
const SLOW_BREATH_MS = 50;

/**
 * How long to work before the next breath (ms), from how long the last one took: BAKE_SLICE_MS
 * while the page gives the thread back within a few frames, so the theme still playing keeps its
 * frames (a floor of 24 ms, and twice a frame-long breath, held a first-visit switch 23-31 ms a
 * slice, 2026-10-31); past SLOW_BREATH_MS twice the excess, so a page slow to give the thread back
 * (a software renderer drawing the previous theme) costs the bake a few breaths, never one per slice.
 * Only when the work runs changes: the steps are the same.
 */
export function bakeSliceMs(lastBreathMs) {
    const slow = (Number(lastBreathMs) || 0) - SLOW_BREATH_MS;
    return Math.max(BAKE_SLICE_MS, Math.min(2000, slow * 2));
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
        /** The eruption's phase now (pyrestorm-phases.js), and the happening being waited for. */
        this.phase = createPhaseState();
        this._happening = {};
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
        /** Captures and tests may hold the night, hold the eruption's phase, and keep the mountain's own happenings off. */
        this.overrides = { watch: null, phase: null, happenings: true };
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
        /** Flank vents (a level-up tears one open): the CPU's mirror of the shader's rows. */
        this.vents = Array.from({ length: FLANK_VENTS }, () => ({
            born: -1e6, cos: 1, sin: 0, head: 0, reach: 0, width: 0, seed: 0, fans: VENT_FANS.map(() => [0, 0, 0]),
        }));
        /** Fire whirls (a twist raises one off the near lava). */
        this.whirlSlots = Array.from({ length: WHIRL_SLOTS }, () => ({
            born: -1e6, power: 0, x: 0, y: 0, z: 0,
        }));
        /** The rivers' own points (riverRuns), filled when the world is built. */
        this.rivers = { left: [], right: [] };
        // Envelopes that accumulate (shared/swell.js): a new event adds to what is still lit and
        // never restarts it. The crater's glow after a burst (it swells in fast and fades), the
        // fountain's kick, the crust's tremor, the frame's flash (a blast), the glare of a perfect
        // clear's sheet (it rises, never strobes), a back-to-back's corona flare, and the twist
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
        /** A gust of embers off the near rivers, and a vent of the fissure jetting (both ease in). */
        this.gust = new Swell({
            attack: 1.2, release: 4.5, ceiling: 3, knee: 2,
        });
        this.fissureKick = new Swell({
            attack: 0.35, release: 2.4, ceiling: 2, knee: 1.4,
        });
        /** A perfect clear's light on the whole land: it swells in a quarter second and sinks over two. */
        this.stormGlow = new Swell({
            attack: 0.25, release: 1.7, ceiling: 1.3, knee: 1,
        });
        /** The mountain's unrest: how hot play runs, sampled once a frame on the world's clock. */
        this.unrest = new GameplaySurge();
        /**
         * The ridge shakes (pyrestorm-shake.js): a hard drop's thud, the thunder of every stroke,
         * the blast's air wave, the lava's groan, felt as small turns of the view.
         */
        this.ridge = new RidgeShake();
        this._shake = { x: 0, y: 0, roll: 0 };
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
        this.gust.reset();
        this.fissureKick.reset();
        this.stormGlow.reset();
        this.wispClock = 0;
        if (this.fans) for (const row of this.fans.tables) row.set(0, -1e5, 0, 0);
        this.unrest.reset();
        this.ridge.reset();
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
        this.lastLockU = 0.5;
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
        for (const v of this.vents) v.born = -1e6;
        this.ventCursor = 0;
        this.ventCount = 0;
        this.ventClock = 0;
        for (const w of this.whirlSlots) {
            w.born = -1e6;
            w.power = 0;
        }
        this.whirlCursor = 0;
        if (this.whirls) for (const row of this.whirls.tables) row.set(0, -1e5, 0, -1e6);
        /** A back-to-back run's blue fire (eased), the perfect clear's wave of fire, the blast's thermal. */
        this.blue = 0;
        this.waveAt = -1e6;
        this.waveCursor = [0, 0];
        this.gildGain = 1;
        this.thermalAt = -1e6;
        this.thermalPower = 1;
        /** The storm's own strokes in an ash phase, and the next of the mountain's happenings. */
        this.stormClock = 0;
        this.nextHappening = Math.floor(Math.max(0, time) / HAPPEN_SECONDS);
        this.happenFrom = time;
        this.smoke?.clear();
        this.bombs?.clear();
        if (this.bolts) for (const row of this.bolts.tables) row.set(0, 0, 0, 0);
    }

    build() {
        return drainSteps(this.buildSteps());
    }

    /**
     * The build as steps, a few parts to a step (the theme breathes between them:
     * shared/build-steps.js), the same work in the same order: the textures and the land, the sky
     * and the ash, the fire. Built in one task it held a first-visit switch frame 13 ms of its 17.5
     * (2026-10-31). A part is added in the step that makes it, so a build stopped between steps
     * leaves dispose() everything it made.
     */
    * buildSteps() {
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
        // The charred snags on the eye's own slope (the picture's near plane).
        this.addPart('snags', createSnags(u, t));
        yield 'land';
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
        yield 'sky and ash';
        this.bolts = createBolts(u, tier);
        this.addPart('bolts', this.bolts);
        this.addPart('jets', createJets(u, tier, t));
        this.fans = createFans(u, t);
        this.addPart('fans', this.fans);
        this.whirls = createWhirls(u, t);
        this.addPart('whirls', this.whirls);
        this.rivers = riverRuns(bakes.lava.channels);
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

    setReducedMotion(value) {
        this.reducedMotion = value === true;
        // Reduced motion: the ridge holds still (nothing is recorded, so nothing resumes after).
        this.ridge.setEnabled(!this.reducedMotion);
    }

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
        this.applyShake(camera);
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /**
     * The ridge's shake on top of the pose and the breath: the view turns (and rolls a little) by
     * screen fractions, so it is the same size at every aspect and lens. pose() set the rotation
     * afresh this frame, so it never winds up.
     */
    applyShake(camera) {
        const s = this.ridge.sample(this.time, this._shake);
        if (s.x === 0 && s.y === 0 && s.roll === 0) return;
        const span = 2 * Math.tan((Number.isFinite(camera.fov) && camera.fov > 0 ? camera.fov : 44) * DEG * 0.5);
        camera.rotateY(-Math.atan(s.x * span));
        camera.rotateX(Math.atan(s.y * span));
        camera.rotateZ(s.roll);
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

    /**
     * How much of a bolt from A to B would be drawn behind the board or the HUD: the number of
     * five points along it that fall inside either (padded; above a card by BOLT_CLEAR_ABOVE,
     * where the next pieces are shown). 0 = clear. A thin bright line behind the interface reads
     * as a crack in it.
     */
    boltBehindBoard(A, B) {
        const card = cardUnion(this.layout);
        const { hud } = this.layout;
        const p = this._bp || (this._bp = [0, 0, 0]);
        const scr = this._bs || (this._bs = { x: 0, y: 0 });
        let inside = 0;
        for (let k = 0; k <= 4; k++) {
            const f = k / 4;
            p[0] = A[0] + (B[0] - A[0]) * f;
            p[1] = A[1] + (B[1] - A[1]) * f;
            p[2] = A[2] + (B[2] - A[2]) * f;
            const at = this.screenOf(p, scr);
            if (!at) continue;
            const m = 0.035;
            if (card && at.x > card.x0 - m && at.x < card.x1 + m && at.y > card.y0 - BOLT_CLEAR_ABOVE && at.y < card.y1 + m) inside++;
            else if (hud && at.x > hud.x0 - m && at.x < hud.x1 + m && at.y > hud.y0 - m && at.y < hud.y1 + m) inside++;
        }
        return inside;
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
        this.lastLockU = clamp01(Number.isFinite(context.u) ? context.u : 0.5);
        if (this.activityTarget < 1) this.onSessionStart();
        const cells = Array.isArray(context.cells) ? Math.max(1, Math.floor(context.cells.length / 2)) : 4;
        const drop = clamp01((context.distance || 0) / 18);
        const lean = clamp(Number.isFinite(context.u) ? context.u : 0.5, 0, 1) - 0.5;
        const tint = this.tintOf(context.color);
        const count = Math.round(cells * (hard ? 3.6 + drop * 2.2 : 3));
        this.unrest.lock(context, this.time);
        this.burst(this.time, count, lean, tint, hard ? 1.15 + drop * 0.15 : 1);
        if (hard) {
            this.quake.hit(0.65 + drop * 0.35, this.time);
            this.kick.hit(0.13, this.time);
            // The slam thuds through the ground under the eye.
            this.ridge.hardDrop(drop, this.time);
            // And the near rivers jump: spatter leaps off the lava where it passes the ridge.
            this.spatter(this.time, drop, lean);
        }
        // A twist that cleared nothing still blows a small ring.
        if (context.twist) this.onTwist({ lines: 0 });
    }

    /**
     * One bomb from `o` to a landing point: it climbs `apex` metres over the vent under the
     * bombs' time-lapsed gravity and falls onto the land, where an ember of it lies cooling
     * (`trail`: seconds of its arc it draws, its own by default). Returns its flight (s).
     */
    throwBomb(o, land, apex, born, tint, px, glow = 4.5, trail = 0) {
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
            trail: trail > 0 ? trail : 0.7 + r() * 0.6,
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
            const apex = (120 + radius * (0.22 + r() * 0.2)) * power * reach;
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
        // Three lines: the fissure answers, its three vents jetting together.
        if (lines === 3) this.fissureKick.hit(1.1, t);
        else if (lines === 2) this.fissureKick.hit(0.3, t);
        if (lines === 4) this.onQuad();
        if (context.twist) this.onTwist(context);
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    /**
     * A bolt out of the column (or the anvil's head) to the ground: `row` 0 strikes high on the
     * cone, 19 out on the plain; a strike is placed where it shows (outside the card and HUD).
     */
    strikeFrom(time, kind, row = 12, power = 1, aim = 0, thunder = 1, wild = false) {
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
            const toEye = Math.atan2(-VOLCANO.z, -VOLCANO.x);
            const f = clamp(row, 0, 19) / 19;
            // Of a few tries, the first stroke that strikes where it shows and runs clear of the
            // board and the HUD all its way (else the one least behind them). The column leans in
            // behind the card as it climbs, so where the stroke leaves it is tried too: lower down
            // each time.
            const a0 = this._sa || (this._sa = [0, 0, 0]);
            const b0 = this._sb || (this._sb = [0, 0, 0]);
            let least = Infinity;
            for (let k = 0; k < 10 && least > 0; k++) {
                columnPoint(0.3 + r() * 0.42 * (1 - k / 12), a0);
                a0[0] += (r() - 0.5) * 900;
                a0[2] += (r() - 0.5) * 900;
                const bearing = aim ? toEye + aim + (r() - 0.5) * 0.3 : toEye + (r() - 0.5) * 2.2;
                const radius = 900 + f * 5200 + r() * 700;
                this.groundFromCrater(bearing, radius, b0);
                const score = this.boltBehindBoard(a0, b0) + (this.seen(b0) ? 0 : 3);
                if (score < least) {
                    least = score;
                    for (let c = 0; c < 3; c++) {
                        A[c] = a0[c];
                        B[c] = b0[c];
                    }
                }
            }
        }
        this.strike(time, kind, A, B, power, this.light.bolt);
        if (!wild) this.counts.bolts++;
        if (kind !== BOLT.spider) {
            this.addHit(B, time + TIMING.leader, [0.9, 0.75, 0.9], 1, 3);
            // Its thunder reaches the ridge once the sound has crossed the plain: louder the
            // nearer it struck (`thunder` scales it: the fever's own strokes are softer, and a
            // stroke the storm throws by itself shakes nothing).
            const distance = Math.hypot(B[0] - EYE.x, B[1] - EYE.y, B[2] - EYE.z);
            if (!wild && thunder > 0) {
                this.ridge.thunder(distance, power, time + TIMING.leader, {
                    discharge: kind === BOLT.discharge, share: thunder,
                });
            }
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
        // A crawler behind the board or the HUD reads as a crack in the interface: of a few
        // tries the first that is clear of both is taken (else the one least behind them).
        let A = null;
        let B = null;
        let least = Infinity;
        for (let k = 0; k < 10 && least > 0; k++) {
            const along = -0.92 + r() * 0.5;
            const across = (r() - 0.5) * 0.6;
            const a0 = toWorld(along, across, ANVIL.base - 120);
            const len = 4000 + r() * 6000;
            // Across the view (east or west), give or take thirty degrees: it crawls, it does not hang.
            const turn = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 1.0;
            // The far end, pulled back inside the anvil's near reaches if it would leave the cloud.
            const bx = a0[0] + Math.cos(turn) * len;
            const bz = a0[2] + Math.sin(turn) * len * 0.6;
            const rel = [bx - ANVIL.x, bz - ANVIL.z];
            const bal = Math.max(-0.95, Math.min(-0.3, (rel[0] * ca + rel[1] * sa) / ANVIL.along));
            const bac = Math.max(-0.4, Math.min(0.4, (rel[1] * ca - rel[0] * sa) / ANVIL.across));
            const b0 = toWorld(bal, bac, ANVIL.base - 200 + r() * 120);
            const behind = this.boltBehindBoard(a0, b0);
            if (behind < least) {
                least = behind;
                A = a0;
                B = b0;
            }
        }
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
        this.kick.hit(1.8, t);
        this.fissureKick.hit(0.6, t);
        // A thermal of glowing ash climbs the column (one still climbing is fed, not restarted).
        if (t - this.thermalAt > THERMAL_SECONDS * 0.6 || t < this.thermalAt) {
            this.thermalAt = t;
            this.thermalPower = 1;
        } else this.thermalPower = Math.min(1.5, this.thermalPower + 0.25);
        // A ring of bombs in every direction.
        const r = this.random;
        const o = [CRATER.x, CRATER.y + 40, CRATER.z];
        const land = this._p;
        const room = this.bombs ? this.bombs.room() : Infinity;
        const n = Math.min(70, Math.floor(this.tier.bombs / 8), Math.max(8, Math.floor(room / 2)));
        for (let i = 0; i < n; i++) {
            const bearing = (i / n) * TAU + r() * 0.2;
            const range = 700 + r() * 2700;
            this.groundFromCrater(bearing, range, land);
            const born = t + r() * r() * 1.1;
            // An eruption, not a firework's shell: thrown steeply (the further it lands, the higher
            // it climbed), out of the whole crater's width instead of one point, over most of a
            // second, each drawing most of its parabola in the deep orange of cooling rock.
            const from = r() * TAU;
            const off = Math.sqrt(r()) * VOLCANO.crater * 0.7;
            o[0] = CRATER.x + Math.cos(from) * off;
            o[2] = CRATER.z + Math.sin(from) * off;
            const apex = range * (0.5 + r() * 0.45) + 150;
            // (Thin, and no two alike: a few thick clots among many fine ones, long trails and short.)
            const flight = this.throwBomb(o, land, apex, born, BLAST_TINT, 1.3 + r() ** 3 * 2.6, 7, 0.8 + r() * 1.6);
            if (i % 5 === 0) this.schedule(born + flight, 'splash', 1, 1, 0, land[0], land[1], land[2]);
        }
        this.puff(t, 2.2);
        this.burstGlow.hit(1.3, t);
        this.schedule(t + 0.3, 'surge');
        this.schedule(t + 1.25, 'bolt', BOLT.discharge, 0, 1.5);
        // The storm round the column answers: strokes onto the cone's shoulders after the discharge.
        this.schedule(t + 1.7, 'bolt', BOLT.ground, 2, 1.0, 0.7);
        this.schedule(t + 2.05, 'bolt', BOLT.ground, 5, 0.95, -0.25);
    }

    /** The blast itself: the frame's flash, the crater's flash and the shock front, at `power`. */
    blast(time, power) {
        this.blastAt = time;
        this.blastPower = power;
        this.craterFlashAt = time;
        this.flash.hit(power, time);
        // The ground jolts at once; the blast's air wave knocks the ridge when it arrives.
        this.ridge.blast(power, CRATER_DISTANCE, time);
    }

    /**
     * The blast's surge: glowing ash pouring down the cone, hugging its ground (pyrestorm-smoke's
     * flows). One runs down the breach and two down the face the eye sees; each is a string of
     * heaps, its head the fastest and the hottest, slowing and swelling as it runs out.
     */
    surge(time) {
        if (!this.smoke) return;
        const r = this.random;
        this.counts.flows++;
        const tongues = [VOLCANO.breach, TO_EYE + 0.78, TO_EYE + 0.3];
        const heaps = Math.max(6, Math.min(14, Math.round(this.tier.eventPuffs / 14)));
        for (let j = 0; j < tongues.length; j++) {
            for (let i = 0; i < heaps; i++) {
                const a = tongues[j] + (r() - 0.5) * 0.14;
                const speed = (560 - i * 28) * (0.85 + r() * 0.3);
                this.smoke.spawn({
                    x: VOLCANO.x + Math.cos(a) * 400,
                    y: CRATER.y,
                    z: VOLCANO.z + Math.sin(a) * 400,
                    vx: Math.cos(a) * speed,
                    vy: 0,
                    vz: Math.sin(a) * speed,
                    born: time + j * 0.3 + i * 0.1,
                    life: TIMING.surge + r() * 3,
                    radius: 120 + i * 9 + r() * 70,
                    grow: 46 + r() * 30,
                    kind: PUFF.flow,
                    heat: Math.max(0.04, 0.5 - i * 0.09),
                    variant: Math.floor(r() * 16),
                });
            }
        }
    }

    onTwist(context = {}) {
        this.counts.twists++;
        if (!this.smoke) return;
        const t = this.time;
        const r = this.random;
        // A twist that cleared nothing blows a small ring; rings still climbing lift the next one
        // above them and make it wider (twist after twist stack up the column).
        const small = !(context.lines > 0);
        const stack = Math.min(2, this.rings.valueAt(t));
        this.rings.hit(small ? 0.5 : 1, t);
        // (1.7 × the first build's ring: at fifteen kilometres that one was twenty pixels wide.)
        const size = (small ? 0.62 : 1) * (1 + 0.16 * stack) * 1.7;
        const share = small ? 0.4 : 1;
        // A torus: two concentric rings of many small, jittered puffs (a hot inner edge, a sooty
        // outer one), the ring several times wider than its puffs so the hole reads; tipped toward
        // the eye so from below it reads as an ellipse. It leaves on the column's near, upwind side
        // (where it shows against the clear sky), hot, and greys as it climbs.
        const base = [CRATER.x - 420, CRATER.y + 420 + stack * 380, CRATER.z + 520];
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
                    radius: R.radius * size * (0.72 + r() * 0.36),
                    grow: R.grow * 1.5,
                    kind: PUFF.ring,
                    heat: R.heat,
                    variant: Math.floor(r() * 16),
                });
            }
        }
        this.kick.hit(small ? 0.15 : 0.35, t);
        this.ridge.ring(small, t);
        // And the hot air over the near lava winds up into a whirl of fire, on the side the piece
        // turned in on; a twist that cleared two lines or more raises one on the other river too.
        const u01 = Number.isFinite(context.u) ? clamp01(context.u) : this.lastLockU;
        const side = u01 < 0.5 ? 'left' : 'right';
        this.whirl(t, side, small ? 0.6 : 1);
        if (context.lines >= 2) this.whirl(t + 0.35, side === 'left' ? 'right' : 'left', 0.8);
    }

    /**
     * A point of a near river that shows beside the card (within `reach` metres of the eye), or
     * null when none does. `pick` 0..1 chooses among them.
     */
    riverPoint(side, pick, reach = 3200) {
        const run = this.rivers[side] || [];
        let found = null;
        let n = 0;
        let roll = pick;
        for (let i = 0; i < run.length; i++) {
            const p = run[i];
            if (Math.hypot(p[0] - EYE.x, p[2] - EYE.z) > reach || !this.seen(p)) continue;
            n++;
            // Reservoir pick: every candidate equally likely, one pass, no list.
            if (found === null || roll * n < 1) found = p;
            roll = (roll * 7.13 + 0.37) % 1;
        }
        return found;
    }

    /** A whirl of fire off a near river (pyrestorm-whirl.js), with a spray of sparks at its foot. */
    whirl(time, side, scale = 1) {
        const r = this.random;
        const p = this.riverPoint(side, r(), 2600) || this.riverPoint(side === 'left' ? 'right' : 'left', r(), 2600);
        if (!p || !this.whirls) return;
        // The slot whose whirl is spent, else the oldest.
        let i = 0;
        let oldest = Infinity;
        for (let k = 0; k < WHIRL_SLOTS; k++) {
            const j = (this.whirlCursor + k) % WHIRL_SLOTS;
            const { born } = this.whirlSlots[j];
            if (time - born >= WHIRL_LIFE || time < born) {
                i = j;
                break;
            }
            if (born < oldest) {
                oldest = born;
                i = j;
            }
        }
        this.whirlCursor = (i + 1) % WHIRL_SLOTS;
        const height = (250 + r() * 110) * scale;
        const slot = this.whirlSlots[i];
        slot.born = time;
        slot.power = 0.75 + 0.25 * scale;
        slot.x = p[0];
        slot.y = p[1];
        slot.z = p[2];
        this.whirls.tables[i * 2].set(p[0], p[1], p[2], time);
        this.whirls.tables[i * 2 + 1].set(height, height * 0.2, slot.power, r());
        this.counts.whirls++;
        for (let k = 0; k < 14; k++) {
            const a = r() * TAU;
            const out = 30 + r() * 70;
            this.bombs?.spawn({
                x: p[0], y: p[1] + 4, z: p[2], vx: Math.cos(a) * out, vy: 110 + r() * 190, vz: Math.sin(a) * out, born: time + r() * 0.6, life: 0.9 + r() * 0.8, tint: [1, 1, 1], px: 1.7, kind: BOMB.spark, g: 150, drag: 1.1,
            });
        }
        this.gust.hit(0.7 * scale, time);
    }

    /** A hard drop: spatter leaps off the near rivers (more, and off both, the further it fell). */
    spatter(time, drop, lean) {
        const r = this.random;
        const load = this.bombs ? this.bombs.load : 0;
        if (load > 0.9) return;
        const sides = drop > 0.6 ? ['left', 'right'] : [lean < 0 ? 'left' : 'right'];
        const places = Math.round(2 + drop * 4);
        for (const side of sides) {
            for (let n = 0; n < places; n++) {
                const p = this.riverPoint(side, r(), 2400);
                if (!p) break;
                const sparks = Math.round((10 + drop * 14) * (1 - smooth(0.5, 0.9, load) * 0.7));
                for (let k = 0; k < sparks; k++) {
                    const a = r() * TAU;
                    const out = 20 + r() * 55;
                    this.bombs?.spawn({
                        x: p[0] + (r() - 0.5) * 40, y: p[1] + 2, z: p[2] + (r() - 0.5) * 40, vx: Math.cos(a) * out, vy: (90 + r() * 170) * (0.7 + 0.5 * drop), vz: Math.sin(a) * out, born: time + 0.04 + r() * 0.1, life: 0.8 + r() * 0.8, tint: [1, 1, 1], px: 2.3 + r() * 0.8, kind: BOMB.splash, g: 170, drag: 0.9,
                    });
                }
            }
        }
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
        this.fissureKick.hit(1.2, t);
        // The whole storm lights at once: the land stands in its light for a breath.
        this.stormGlow.hit(1, t);
        // A wave of fire runs down both rivers from their sources to the eye, the lava gilded
        // behind it (a wave still running burns brighter instead of starting over).
        if (t - this.waveAt > GILD_SECONDS || t < this.waveAt) {
            this.waveAt = t + 0.15;
            this.waveCursor[0] = 0;
            this.waveCursor[1] = 0;
            this.gildGain = 1;
        } else this.gildGain = Math.min(1.5, this.gildGain + 0.25);
        // The sheet's long thunder: the ground swells into a slow roll under the crown's cracks.
        this.ridge.sheet(t);
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
            this.openVent(time);
            this.kick.hit(0.85, time);
            this.unrest.levelUp(time);
            // The mountain groans as the fresh lava surges down its channels.
            this.ridge.surge(time);
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

    /**
     * A flank vent tears open on the cone's face (a level-up): a line of fountains at its head for
     * a few seconds, and a fresh stream that runs down the fall line from it and then cools. Two
     * may burn at once; a third takes the older one's place.
     */
    openVent(time) {
        const r = this.random;
        const v = this.vents[this.ventCursor];
        this.ventCursor = (this.ventCursor + 1) % FLANK_VENTS;
        const bearing = TO_EYE + VENT_BEARINGS[this.ventCount % VENT_BEARINGS.length] + (r() - 0.5) * 0.1;
        this.ventCount++;
        v.born = time;
        v.cos = Math.cos(bearing);
        v.sin = Math.sin(bearing);
        v.head = 1250 + r() * 600;
        v.reach = 3000 + r() * 1500;
        v.width = 34 + r() * 12;
        v.seed = r();
        VENT_FANS.forEach(([down], k) => {
            const out = v.head + down;
            const x = VOLCANO.x + v.cos * out;
            const z = VOLCANO.z + v.sin * out;
            v.fans[k][0] = x;
            v.fans[k][1] = landHeight(x, z);
            v.fans[k][2] = z;
        });
        this.counts.vents++;
        this.burstGlow.hit(0.5, time);
    }

    /** The flank vents each frame: their rows for the land, and their fountains while they play. */
    updateVents(time, dt) {
        const rows = this.u.tables.flank;
        const r = this.random;
        for (let i = 0; i < FLANK_VENTS; i++) {
            const v = this.vents[i];
            const age = time - v.born;
            // Its fans of fire: up in half a second, each breathing on its own beat, dying down.
            const playing = age >= 0 && age < VENT_FOUNTAIN
                ? smooth(0, 0.5, age) * (1 - smooth(VENT_FOUNTAIN * 0.45, VENT_FOUNTAIN, age)) * (0.5 + 0.5 * this.activity)
                : 0;
            for (let k = 0; this.fans && k < FANS_PER_VENT; k++) {
                const row = (i * FANS_PER_VENT + k) * 2;
                const breath = 0.82 + 0.18 * Math.sin(time * (2.3 + k * 0.7) + v.seed * 40 + k * 2.1);
                this.fans.tables[row].set(v.fans[k][0], v.fans[k][1], v.fans[k][2], VENT_FANS[k][1] * (0.35 + 0.65 * playing) * breath);
                this.fans.tables[row + 1].set(playing, (v.seed + k * 0.37) % 1, 0, 0);
            }
            if (!(age >= 0) || age > 150) {
                rows[i * 2].set(1, 0, 0, 0);
                rows[i * 2 + 1].set(0, 0, 0, 0);
                continue;
            }
            const front = v.head + v.reach * (1 - Math.exp(-age / 4.2));
            // Fresh for ten seconds, then it cools to a dull thread and, in time, goes out.
            const heat = (0.4 + 0.6 * Math.exp(-Math.max(0, age - 10) / 40)) * (1 - smooth(90, 150, age)) * (0.5 + 0.5 * this.activity);
            rows[i * 2].set(v.cos, v.sin, v.head, front);
            rows[i * 2 + 1].set(v.width, heat, v.seed, 0);
            if (age < VENT_FOUNTAIN && this.bombs && this.bombs.load < 0.85) {
                // A curtain of fire along the vent's first few hundred metres, dying down.
                this.ventClock += dt * 80 * (1 - age / VENT_FOUNTAIN) * Math.min(1, this.tier.bombs / 512);
                while (this.ventClock >= 1) {
                    this.ventClock -= 1;
                    const out = v.head + r() * 620;
                    const x = VOLCANO.x + v.cos * out;
                    const z = VOLCANO.z + v.sin * out;
                    const a = r() * TAU;
                    const side = 15 + r() * 45;
                    this.bombs.spawn({
                        x, y: landHeight(x, z) + 4, z, vx: Math.cos(a) * side, vy: (230 + r() * 300) * (1 - (age / VENT_FOUNTAIN) * 0.5), vz: Math.sin(a) * side, born: time, life: 1.1 + r() * 0.9, tint: [1, 1, 1], px: 2.4 + r() * 1.1, kind: BOMB.spark, g: 210, drag: 0.35,
                    });
                }
            }
        }
    }

    /**
     * A back-to-back run: wisps of blue fire rise off the near rivers, the fissure and the crater's
     * rim for as long as the run lasts, more of them with every step of it.
     */
    updateWisps(time, dt) {
        const blue = this.u.blue.value;
        if (!(blue > 0.04) || !this.bombs || this.bombs.load > 0.8) return;
        const r = this.random;
        this.wispClock += dt * blue * 34 * Math.min(1, this.tier.bombs / 640);
        while (this.wispClock >= 1) {
            this.wispClock -= 1;
            const where = r();
            let x;
            let y;
            let z;
            if (where < 0.62) {
                const p = this.riverPoint(r() < 0.5 ? 'left' : 'right', r(), 2800);
                if (!p) continue;
                x = p[0] + (r() - 0.5) * 90;
                y = p[1];
                z = p[2] + (r() - 0.5) * 90;
            } else if (where < 0.86) {
                const f = r();
                x = FISSURE.a[0] + (FISSURE.b[0] - FISSURE.a[0]) * f;
                y = 62;
                z = FISSURE.a[1] + (FISSURE.b[1] - FISSURE.a[1]) * f;
            } else {
                const a = r() * TAU;
                x = CRATER.x + Math.cos(a) * VOLCANO.crater * 0.9;
                y = CRATER.y + 150;
                z = CRATER.z + Math.sin(a) * VOLCANO.crater * 0.9;
            }
            // Buoyant: it leaves slowly and climbs faster, leaning a little downwind.
            this.bombs.spawn({
                x, y: y + 2, z, vx: 8 + (r() - 0.5) * 16, vy: 26 + r() * 44, vz: (r() - 0.5) * 16, born: time, life: 1.2 + r() * 1.4, tint: WISP_TINT, px: 5.5 + r() * 4.5, kind: BOMB.wisp, g: -40, drag: 0.4,
            });
        }
    }

    /**
     * The perfect clear's wave of fire: as its front passes each point of a river (km from the
     * source at WAVE_SPEED), spatter fountains up there; bigger near the eye, where it is seen.
     */
    updateWave(time) {
        const age = time - this.waveAt;
        const strength = age >= 0 ? smooth(0, 0.25, age) * (1 - smooth(GILD_SECONDS * 0.55, GILD_SECONDS, age)) * this.gildGain : 0;
        this.u.gild.value.set(Math.max(0, age) * WAVE_SPEED, strength);
        if (!(age >= 0) || age > 4 || !this.bombs) return;
        const r = this.random;
        const front = age * WAVE_SPEED;
        const share = Math.min(1, this.tier.bombs / 640);
        ['left', 'right'].forEach((side, s) => {
            const run = this.rivers[side];
            // The main river's source is the breach, 3.6 km down its arc: start it with the fissure's.
            const from = run.length ? run[0][3] : 0;
            while (this.waveCursor[s] < run.length && run[this.waveCursor[s]][3] - from <= front) {
                const p = run[this.waveCursor[s]];
                this.waveCursor[s]++;
                if (this.bombs.load > 0.88) continue;
                const near = 1 - smooth(1500, 6000, Math.hypot(p[0] - EYE.x, p[2] - EYE.z));
                // Unevenly: every place its own strength (a few jet high, some barely stir), set
                // anywhere along its stretch of river, so the wave is surf, never a comb's teeth.
                const jet = 0.25 + r() ** 2 * 1.5;
                const sparks = Math.round((3 + near * 13) * share * jet);
                const along = this.waveCursor[s] < run.length ? run[this.waveCursor[s]] : p;
                const shift = r();
                const x0 = p[0] + (along[0] - p[0]) * shift;
                const z0 = p[2] + (along[2] - p[2]) * shift;
                for (let k = 0; k < sparks; k++) {
                    const a = r() * TAU;
                    const out = 14 + r() * 50;
                    this.bombs.spawn({
                        x: x0 + (r() - 0.5) * 70, y: p[1] + 2, z: z0 + (r() - 0.5) * 70, vx: Math.cos(a) * out, vy: (90 + r() * 230 + near * 60) * (0.6 + 0.5 * jet), vz: Math.sin(a) * out, born: time + r() * 0.3, life: 0.9 + r() * 0.9, tint: [1.15, 1, 0.8], px: 1.3 + near * (0.5 + r() * 1.1), kind: BOMB.spark, g: 190, drag: 0.6,
                    });
                }
            }
        });
    }

    // ── The mountain's own happenings (pyrestorm-phases.js) ───────────────────────────

    /** The phase that owns the wheel at a time (what a happening is weighted by). */
    phaseIndexAt(time) {
        const place = this.overrides.phase !== null ? this.overrides.phase : phasePlace(time, this.wheel.offset(time));
        return phaseIndexOf(place);
    }

    /** Fire every happening whose moment has come since the last frame (none while the eruption sleeps). */
    updateHappenings(time) {
        const pick = this._phaseIndexAt || (this._phaseIndexAt = (at) => this.phaseIndexAt(at));
        for (let guard = 0; guard < 8; guard++) {
            const h = happeningAt(this.nextHappening, pick, this._happening);
            if (h.at > time) return;
            this.nextHappening++;
            // One whose moment passed before this world began (a seek) is not replayed.
            if (h.kind && h.at > this.happenFrom && this.activity > 0.6 && this.overrides.happenings !== false) this.happen(h);
        }
    }

    /** One happening: the mountain doing something by itself. Soft, uncounted as play, never a shake. */
    happen(h) {
        const t = h.at;
        this.counts.happenings++;
        if (h.kind === 'bomb') {
            // A lone great bomb, thrown far out onto the plain where it shows.
            const land = this._p;
            let found = false;
            for (let k = 0; k < 8 && !found; k++) {
                this.groundFromCrater(TO_EYE + (h.a - 0.5) * 2 + k * 0.37, 2600 + h.b * 2600, land);
                found = this.seen(land);
            }
            const o = [CRATER.x, CRATER.y + 30, CRATER.z];
            const flight = this.throwBomb(o, land, 900 + h.c * 700, t, [1, 1, 1], 5.5, 9);
            this.schedule(t + flight, 'splash', 1, 1, 0, land[0], land[1], land[2]);
            this.burstGlow.hit(0.35, t);
            this.kick.hit(0.1, t);
        } else if (h.kind === 'rockfall') this.rockfall(t, h);
        else if (h.kind === 'meteor') this.meteor(t, h);
        else if (h.kind === 'embers') this.gust.hit(1.4 + h.a, t);
        else if (h.kind === 'jet') this.fissureKick.hit(0.75 + h.a * 0.5, t);
        else if (h.kind === 'stroke') this.strikeFrom(t, BOLT.ground, 2 + Math.floor(h.a * 10), 0.7, 0, 0, true);
        else if (h.kind === 'lake') {
            this.burstGlow.hit(0.9, t);
            this.puff(t, 1.3);
        } else if (h.kind === 'pour') this.feedPulse(t, 0.55);
    }

    /** A glowing rockfall: blocks break off high on the cone and run down a gully, cooling where they stop. */
    rockfall(time, h) {
        if (!this.bombs || this.bombs.room() < 40) return;
        const r = this.random;
        const bearing = TO_EYE + (h.a - 0.25) * 1.5;
        const length = 1300 + h.b * 1100;
        const blocks = 22;
        const p = this._p;
        for (let i = 0; i < blocks; i++) {
            const f = i / (blocks - 1);
            this.groundFromCrater(bearing + Math.sin(f * 9 + h.c * 6) * 0.025, 620 + f * length + (r() - 0.5) * 50, p);
            this.bombs.spawn({
                x: p[0], y: p[1] + 3, z: p[2], vx: 0, vy: 0, vz: 0, born: time + f * 2.6 + r() * 0.15, life: 2.4 + r() * 3.2, tint: [1, 0.92, 0.85], px: 2 + r() * 1.6, kind: BOMB.ember, g: 0,
            });
        }
    }

    /** A shooting star over the clear, upwind sky (drawn by the bombs' own trail, without gravity). */
    meteor(time, h) {
        if (!this.bombs) return;
        const far = 42000;
        const az = (-41 + h.a * 12) * DEG;
        const el = (13 + h.b * 6) * DEG;
        const from = [EYE.x + Math.sin(az) * Math.cos(el) * far, EYE.y + Math.sin(el) * far, EYE.z - Math.cos(az) * Math.cos(el) * far];
        // Down and across the sky, toward the volcano's side or away from it.
        const way = h.c < 0.5 ? 1 : -1;
        const speed = 9500 + h.c * 4000;
        const v = [way * speed * 0.86, -speed * 0.5, speed * 0.1];
        const life = 0.75 + h.b * 0.3;
        if (!this.seen(from) && !this.seen([from[0] + v[0] * life, from[1] + v[1] * life, from[2] + v[2] * life])) return;
        this.bombs.spawn({
            x: from[0], y: from[1], z: from[2], vx: v[0], vy: v[1], vz: v[2], born: time, life, tint: [0.7, 0.85, 1.35], px: 1.8, kind: BOMB.bomb, g: 0, trail: 0.32,
        });
    }

    /**
     * The run is over: the eruption sinks to a glow. A last breath of dark ash rolls out of the
     * crater, the column thins, the rivers crust over and the ash that hung in the air comes down.
     */
    onGameOver() {
        this.counts.gameOvers++;
        if (this.activityTarget >= 1) this.puff(this.time, 1.8);
        this.activityTarget = 0.3;
    }

    /** A new run: a mountain that had sunk to a glow wakes with a burst out of the crater. */
    onSessionStart() {
        if (this.activityTarget < 1) {
            this.counts.wakes++;
            this.burstGlow.hit(0.9, this.time);
            this.kick.hit(0.7, this.time);
            this.puff(this.time, 1.4);
        }
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
        this.updateMoon(L);

        // The eruption's phase: the same wheel offset as the watches (a level-up moves it one on).
        const E = phaseAt(this.overrides.phase !== null ? this.overrides.phase : phasePlace(time, this.wheel.offset(time)), this.phase);
        // (A mountain sunk to a glow at a run's end: its column thins, its channels shrink back and
        // the ash that hung under the anvil comes down.)
        const asleep = 1 - clamp01((this.activity - 0.3) / 0.7);
        u.plume.value.set(E.body * (1 - 0.4 * asleep), E.girth * (1 - 0.15 * asleep), E.tone);
        u.cover.value = E.cover;
        u.lavaFlux.value = E.flux * (1 - 0.14 * asleep);
        u.ashFall.value = Math.min(1.2, E.fall + asleep * 0.8);

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
        // The hotter play runs, the harder the ridge feels each new hit (nothing shakes on its own).
        this.ridge.setFever(fever * this.activity);
        const warm = smooth(0.18, 0.55, level);
        const hot = smooth(0.45, 0.85, level);
        // The lava runs hotter with it: brighter rivers, a thinner crust.
        u.lavaHeat.value = L.lavaHeat * E.lava * (1 + warm * 0.05 + hot * 0.06 + fever * 0.08);

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
        const fountainAsk = Math.min(3.6, E.fountain + this.charge * 0.55 + kick + warm * 0.3 + hot * 0.3 + fever * 0.5);
        this.fountainLevel += (fountainAsk - this.fountainLevel) * approach(fountainAsk > this.fountainLevel ? 3.5 : 0.9, dt);
        // The crust tears open with each hard drop; hot play keeps it open along every channel.
        this.tremor = this.quake.valueAt(time);
        this.corona += (this.b2b / 4 - this.corona) * approach(1.2, dt);
        // A quiet fountain leaves the lava lake to light the crater: its glow breathes, slowly,
        // through everything a burst's glow lights (the column's foot, the air, the cloud).
        const breath = 0.5 + 0.5 * Math.sin(time * 0.83 + Math.sin(time * 0.31) * 1.4);
        const lake = E.lake * (0.3 + 0.7 * breath * breath) * 0.85;
        u.burst.value = (this.burstGlow.valueAt(time) + lake) * this.activity;
        u.embers.value = E.embers * (0.4 + 0.6 * this.activity) + this.gust.valueAt(time);
        u.activity.value = this.activity;
        u.charge.value = this.charge;
        u.fountain.value = this.fountainLevel;
        u.fissure.value = Math.min(3.4, E.fissure * (0.72 + 0.28 * Math.min(2, this.fountainLevel / Math.max(0.3, E.fountain)))
            + kick * 0.25 + this.fissureKick.valueAt(time));
        u.tremor.value = Math.min(1, this.tremor + (hot * 0.1 + fever * 0.2) * this.activity);
        u.corona.value = Math.min(1.4, this.corona + this.flare.valueAt(time));
        u.time.value = time;
        // The lava flows at a constant rate (the clock times a constant, wrapped).
        u.flow.value = time % 2000;

        // The storm at rest: now and then the cloud flashes from inside (one crawler, softly).
        if (this.activity > 0.5) {
            // (More often the stormier the phase: hardly ever in a lull, every few seconds in the ash.)
            this.ambientClock += (dt / this.ambientGap) * (0.35 + E.storm * 2.95);
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
                const row = 8 + Math.floor(this.random() * 12);
                this.strikeFrom(time, BOLT.ground, row, 0.75 + fever * 0.3, 0, FEVER_THUNDER);
            }
            if (fever > 0.6 && time - this.pulseAt > PULSE_FEED) {
                this.feedPulse(time, 0.75);
                this.ridge.surge(time, FEVER_GROAN);
            }
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

        // A back-to-back run: sulphur catches and burns blue, higher with every step of the run.
        this.blue += (this.b2b / 4 - this.blue) * approach(this.b2b / 4 > this.blue ? 2.2 : 0.7, dt);
        u.blue.value = Math.min(1.3, this.blue * 1.05 + this.flare.valueAt(time) * 0.5) * this.activity;
        // Four lines: the thermal climbs the column, slowing, and burns out.
        const tAge = time - this.thermalAt;
        const thermal = tAge >= 0 && tAge < THERMAL_SECONDS
            ? smooth(0, 0.3, tAge) * Math.exp(-tAge / 3.2) * 1.5 * this.thermalPower * fs
            : 0;
        u.thermal.value.set(0.03 + 0.6 * (1 - Math.exp(-Math.max(0, tAge) / 3.4)), thermal);
        // A perfect clear: the land in the storm's own light.
        const glow = this.stormGlow.valueAt(time) * 0.95 * fs;
        u.stormLight.value.set(this.light.bolt[0] * glow, this.light.bolt[1] * glow, this.light.bolt[2] * glow);
        this.updateWisps(time, dt);
        this.updateVents(time, dt);
        this.updateWave(time);
        // The storm strikes by itself in an ash phase, and the mountain's own happenings.
        if (E.storm > 0.5 && this.activity > 0.6) {
            this.stormClock += dt * (E.storm - 0.5) * 0.26 * fs;
            while (this.stormClock >= 1) {
                this.stormClock -= 1;
                this.strikeFrom(time, BOLT.ground, 1 + Math.floor(this.random() * 9), 0.62, 0, 0, true);
            }
        }
        this.updateHappenings(time);

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

    /**
     * The moon by the watch: where its disc stands on the sky, and the night's key light (the
     * afterglow's at dusk, the moon's after), which rakes the land from further left and a little
     * higher than the disc so every slope that turns to it shows.
     */
    updateMoon(L) {
        const { u } = this;
        const el = L.moonEl * DEG;
        const az = L.moonAz * DEG;
        const d = u.moonDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
        const r = u.moonRight.value.set(-d.z, 0, d.x).normalize();
        u.moonUp.value.crossVectors(r, d).normalize();
        const rakeEl = Math.max(el, 4 * DEG) + 9 * DEG;
        const rakeAz = az - 26 * DEG;
        u.rake.value.set(Math.sin(rakeAz) * Math.cos(rakeEl), Math.sin(rakeEl), -Math.cos(rakeAz) * Math.cos(rakeEl));
        u.moon.value.fromArray(L.moon);
        u.moonTint.value.fromArray(L.moonTint);
        u.moonShow.value = smooth(-1.5, 2.5, L.moonEl);
        u.milky.value = L.milky;
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
        // A flank vent's fountains and a fire whirl light the land round them.
        for (const v of this.vents) {
            const age = time - v.born;
            if (!(age >= 0) || age > VENT_FOUNTAIN + 3) continue;
            const e = smooth(0, 0.4, age) * (1 - smooth(VENT_FOUNTAIN * 0.5, VENT_FOUNTAIN + 3, age)) * 1.1;
            const out = v.head + 200;
            list.push({
                x: VOLCANO.x + v.cos * out, y: CRATER.y - 300, z: VOLCANO.z + v.sin * out, radius: 1500, r: e, g: e * 0.44, b: e * 0.14, w: e * 0.8,
            });
        }
        for (const w of this.whirlSlots) {
            const e = whirlEnvelope(time - w.born) * w.power * 0.9;
            if (e < 0.02) continue;
            list.push({
                x: w.x, y: w.y + 120, z: w.z, radius: 520, r: e, g: e * 0.5, b: e * 0.17, w: e * 0.7,
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
            phase: {
                place: this.phase.place, from: this.phase.from, to: this.phase.to, mix: this.phase.mix,
            },
            blue: this.blue,
            /** Flank vents burning: each stream's head and front (m out from the volcano's axis) and heat. */
            vents: this.u.tables.flank.filter((_, i) => i % 2 === 0).map((row, i) => ({ head: row.z, front: row.w, heat: this.u.tables.flank[i * 2 + 1].y })),
            activity: this.activity,
            tremor: this.tremor,
            /** The ridge's shake on the last camera update: view turns (viewport heights), roll (rad). */
            shake: { ...this._shake },
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
