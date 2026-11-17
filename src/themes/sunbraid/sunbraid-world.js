/**
 * Sunbraid — one shared world (the theme and the playground mount the same one).
 *
 * The white valley, its towers and gliders, the sky and the three suns; and everything gameplay
 * does to them.
 *
 * Lifecycle: `await SunbraidWorld.prepare(quality, { signal })` lays the land out;
 * `new SunbraidWorld({ ..., prepared }).build()` makes the scene objects; each frame
 * `updateCamera` → `update` → the post renders.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { breathe, drainSteps } from '../shared/build-steps.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    BRAID, DEG, LIGHT_GAIN, PIECE_COLORS, RIG, SUNS, TAU, azElOf, clamp, clusterCentre, hexToLinear, lerp, rigFor,
    smooth, sunDirection, sunVector,
} from './sunbraid-core.js';
import { PulseTable } from './sunbraid-pulses.js';
import {
    MOON, angleBetween, discCover, moonAt, moonSeen, weatherAt,
} from './sunbraid-weather.js';
import { tierFor } from './sunbraid-quality.js';
import { EYE_ALTITUDE, eyePosition, spireCasters } from './sunbraid-plan.js';
import { noiseData } from './sunbraid-noise.js';
import {
    MAX_PULSES, createNoiseTexture, createUniforms, writeCasters,
} from './sunbraid-tsl.js';
import { createSky } from './sunbraid-sky.js';
import { createLandSteps } from './sunbraid-land.js';
import { createSpiresSteps } from './sunbraid-spires.js';
import { createGliders } from './sunbraid-gliders.js';
import { WHEEL } from './sunbraid-glide.js';
import {
    DUST_RINGS, TWISTER, TWISTERS, createDust,
} from './sunbraid-dust.js';
import {
    boardFor, cardUnion, fallbackLayout, outsideKeepOut,
} from './sunbraid-composition.js';
import { BRAID_EVENTS, Braid } from './sunbraid-braid.js';

export const SUNBRAID_PARTS = Object.freeze(['sky', 'land', 'spires', 'gliders', 'dust']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

/** The braid's phase at clock 0: the coral sun rides lowest, a little past the bottom of the circle. */
export const PHASE0 = -100 * DEG;

/**
 * The post's answers to the braid: the one white sun's glare (bloom boost) and flash (scaled by
 * the photosensitivity setting in the post), noon's glare and how far the iris closes, and the
 * grade's saturation at rest and its lift at a full chain's ribbons.
 */
export const POST_EVENTS = Object.freeze({
    whiteGlare: 1.1,
    whiteFlash: 0.45,
    whiteIris: 0.2,
    noonGlare: 0.5,
    noonIris: 0.12,
    saturation: 1.08,
    chainSaturation: 0.12,
});

/**
 * How the valley answers the heat of play (src/themes/shared/gameplay-surge.js: `level` 0..1,
 * `fever` 0..1, `punch` the momentary hit). Below `from` the world looks exactly as it always has,
 * so casual play changes nothing. Above it the triple star spirals in: the suns draw together
 * (`pull`, a share of their spread, on top of the chain's own draw; sunbraid-braid.js) and sink a
 * little toward the rim, so every tower's fan of coloured shadows stretches toward the eye; their
 * tight halos blaze and their discs swell, the sky's glow round them and on the horizon under them
 * deepens, the ribbons braided between them brighten, swing wider and wind faster, the towers'
 * coloured wedges stand a little stronger in the valley air, the high cloud and the gliders
 * quicken, and the iris closes a little so the colours keep their depth. Four lines are the peak:
 * the suns join as one white sun and part wide, letting go of the whole pull at once (the release).
 */
export const SURGE_LOOK = Object.freeze({
    from: 0.2,
    pull: Object.freeze({ level: 0.16, fever: 0.08 }),
    /** The coronas (gain over 1): the heat, every clear's shine, the white sun's brilliance. */
    blaze: Object.freeze({
        level: 0.6, fever: 0.8, shine: 0.5, brilliance: 0.6,
    }),
    /** The sky's glow round each sun and on the horizon below it (gain over 1). */
    glow: Object.freeze({ level: 0.3, fever: 0.4, shine: 0.25 }),
    /**
     * The suns sink toward the rim (degrees): the sundial's shadows stretch toward the eye and the
     * horizon under them glows; the crown of a perfect clear lifts them from there.
     */
    sink: Object.freeze({ level: 1.6, fever: 1.4 }),
    /** The discs swell (a share of their radius); the one white sun swells further. */
    disc: Object.freeze({ level: 0.08, fever: 0.1, white: 0.1 }),
    /** The ribbons between the suns, over a chain's: the heat's, a back-to-back's flare. */
    ribbon: Object.freeze({ level: 0.45, fever: 0.65, flare: 1.1 }),
    /**
     * The valley mist's density (gain over 1) and the post's light in the air: a touch only (the
     * three suns' light in the mist is white; more of it is a veil, not colour).
     */
    mist: Object.freeze({ level: 0.08, fever: 0.1 }),
    air: Object.freeze({ level: 0.06, fever: 0.1, shine: 0.08 }),
    /**
     * The iris closes this much (exposure) so the added glare keeps the colours deep (a little:
     * the sinking suns already light the floor less).
     */
    iris: Object.freeze({ level: 0.01, fever: 0.03 }),
    /** The glare on the suns (bloom boost): the heat's, and every clear's shine. */
    glare: Object.freeze({ level: 0.06, fever: 0.1, shine: 0.25 }),
    /** The air runs ahead of the clock: extra seconds of drift per second (cloud, gliders, ribbons). */
    stir: Object.freeze({ level: 1.2, fever: 1.0 }),
    /** A hit: the lens dips (degrees), the suns glare, and a big one flashes past `flashFrom`. */
    kick: 0.3,
    punchGlare: 0.35,
    punchFlash: 0.12,
    flashFrom: 0.3,
});

/**
 * What play writes on the valley beside the braid's own answers (sunbraid-braid.js). Distances are
 * metres on the plain, times seconds.
 *  - lock: a ripple beside the board in the piece's colour, along the crust's ridges alone (the
 *    commonest event is the quietest: light along the cracks, never a flood of colour by the
 *    card): how far it spreads, how long it lives, the ring's width, its light;
 *  - drop: a hard drop's ripple, wider with the rows it fell (`perRow`, up to `rows`);
 *  - clear: a ring a line from under the board across the plain: its speed, its life by lines,
 *    its width, the beat between rings;
 *  - b2b: a back-to-back's ring in the sky: a ring round each sun runs out from `from` to `reach`
 *    (radians) and is gone in `life` s;
 *  - perfect: the crown's great rings, split into the suns' three colours: how many, their speed
 *    and how they gather pace, their life, width and how it widens, the beat between them; the
 *    rings round the suns open over `open` s and stand for `stand` s;
 *  - front: the front that brings the colour back after four lines: where it starts (metres out
 *    under the suns), its speed and how it gathers pace, how long it takes the valley, how soft its
 *    edge is, the ring of light that rides it;
 *  - arms: a chain's spiral arms: their strength a step, the most, their reach a step, how fast
 *    they follow the chain;
 *  - wake: a level-up's light climbing the towers: how long it runs.
 */
export const VALLEY_EVENTS = Object.freeze({
    lock: Object.freeze({
        reach: 36, life: 0.9, width: 11, gain: 0.9,
    }),
    drop: Object.freeze({
        reach: 58, life: 1.1, width: 14, gain: 1.1, perRow: 2.0, rows: 16,
    }),
    clear: Object.freeze({
        speed: 430, life: Object.freeze([0, 1.25, 1.55, 1.85, 2.1]), width: 15, gap: 0.085, gain: 0.95,
    }),
    b2b: Object.freeze({
        life: 1.15, from: 0.03, reach: 0.3, gain: 1.25,
    }),
    perfect: Object.freeze({
        rings: 3, speed: 760, gather: 240, life: 3.6, width: 48, widen: 46, gap: 0.32, gain: 1.4, open: 1.2, stand: 5.2,
    }),
    front: Object.freeze({
        origin: 1500, speed: 1100, gather: 900, life: 3.0, soft: 240, width: 95, gain: 1.05,
    }),
    arms: Object.freeze({
        step: 0.3, most: 1.7, reach: 0.34, ease: 0.9,
    }),
    wake: Object.freeze({ life: 6.5 }),
    /**
     * A twist's twister on the plain beside the board: its height (and more a line), waist radius,
     * life, how far out from the eye it stands (`range`, metres); a twist that cleared nothing
     * raises a small one. `gale`: the wind weather's own, far
     * out: how often one may rise (s), from how much wind, its height and radius.
     */
    twister: Object.freeze({
        height: 96, perLine: 26, radius: 8.5, life: 9.5, small: 0.55, range: Object.freeze([300, 440]),
    }),
    gale: Object.freeze({
        every: 31, from: 0.6, height: 210, radius: 17, life: 15,
    }),
    /** A hard drop's ring of dust: how high it stands (and more a row fallen), its life. */
    dustRing: Object.freeze({
        height: 7, perRow: 0.45, life: 1.7, power: 0.85,
    }),
    /**
     * The gliders gather round the triple star: from a chain of `from` steps, all of them by
     * `full`; a perfect clear calls them for `crown` s; how fast they answer (s).
     */
    gather: Object.freeze({
        from: 2, full: 6, crown: 7, ease: 2.4,
    }),
});

/** The pieces' colours as light (linear RGB), by piece code; the last is a pale stand-in. */
const PIECE_LIGHT = Object.freeze(PIECE_COLORS.map((hex, code) => (
    code === 7 ? Object.freeze([0.9, 0.9, 0.96]) : Object.freeze(hexToLinear(hex)))));
const HEX = /^#[0-9a-f]{6}$/i;

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'twists', 'perfects', 'chainSteps', 'b2bSteps', 'levelUps',
    'gameOvers', 'mornings',
];
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze(['time', 'level', 'combo', 'peak', 'b2b', 'stir', 'gust']);
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));

export class SunbraidWorld {
    /**
     * The land plan with a breath before each of its steps (prepareSteps), so none of it shares a
     * task with the renderer's setup: in one task it held Sunbraid's first-visit switch ~23 ms
     * (2026-10-31). Resolves null when `signal` is aborted meanwhile (the build then lays the
     * plan out itself, should it still run).
     */
    static async prepare(quality = 'High', { signal } = {}) {
        const steps = SunbraidWorld.prepareSteps(quality);
        for (;;) {
            // eslint-disable-next-line no-await-in-loop
            await breathe();
            if (signal?.aborted) return null;
            const next = steps.next();
            if (next.done) return next.value;
        }
    }

    static prepareSync(quality = 'High') {
        return drainSteps(SunbraidWorld.prepareSteps(quality));
    }

    /** The plan as steps: the baked noise the valley's heights read (once a page), then the towers' casters. */
    static* prepareSteps(quality = 'High') {
        noiseData();
        yield 'noise';
        return { quality, casters: spireCasters() };
    }

    constructor({
        scene, quality = 'High', capture = false, prepared = null, samples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.samples = samples;
        this.prepared = prepared;
        this.root = new THREE.Group();
        this.root.name = 'SunbraidWorld';
        this.parts = {};
        this.partList = [];
        this.disposed = false;
        this.reducedMotion = false;
        /** Captures: hold the braid's phase, a weather (its index), the moon's own clock (seconds; false = no moon). */
        this.overrides = { phase: null, weather: -1, moon: null };
        /** This frame's weather (sunbraid-weather.js), one object, reused. */
        this.weather = weatherAt(0);
        /** How much of each sun the moon hides (0..1), and where the moon stands. */
        this.eclipse = [0, 0, 0];
        this._moon = {
            az: 0, el: 0, pass: 0, phase: 0,
        };
        this._moonDir = [0, 0, 0];
        this._centre = [0, 0];
        /** The wheel the gliders gather on: its centre (world) and its two axes (sunbraid-glide.js wheelAt). */
        this.wheel = { c: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0] };
        this.aspect = 16 / 9;
        this.viewportHeight = 1080;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this._camera = null;
        this.u = createUniforms();
        /** The mist as the valley holds it at rest (the heat of play thickens and raises it). */
        this.mistRest = { density: this.u.mistDensity.value };
        this.hazeRest = this.u.hazeDensity.value;
        this.braid = new Braid();
        /** The pulses of light in the crust (sunbraid-pulses.js). */
        this.pulses = new PulseTable(MAX_PULSES);
        /** The twisters and dust rings standing on the plain (fixed slots; sunbraid-dust.js draws them). */
        this.twisters = Array.from({ length: TWISTERS }, () => ({
            at: -1e9, life: 1, x: 0, z: 0, wx: 0, wz: 0, height: 100, radius: 9, spin: 1, power: 0,
        }));
        this.dustRings = Array.from({ length: DUST_RINGS }, () => ({
            at: -1e9, life: 1, x: 0, z: 0, reach: 60, height: 7, power: 0,
        }));
        this._pt = { x: 0, z: 0 };
        this._spot = { x: 0.5, y: 0.5 };
        this._rgb = [1, 1, 1];
        /** How hot play runs (sampled once a frame on the world's clock). */
        this.surge = new GameplaySurge();
        /** Every clear's light on the suns' coronas: hits add, so rapid clears build a shimmer. */
        this.shine = new Swell({ release: 1.4, ceiling: 1.5, knee: 1 });
        /** Four lines' brilliance: the white sun swells as the suns close (a second quad adds). */
        this.brilliance = new Swell({
            attack: 0.5, release: 2.4, ceiling: 1.6, knee: 1.1,
        });
        /** The ribbons' flare: a back-to-back's, a spin's, a perfect clear's crown. */
        this.flare = new Swell({
            attack: 0.12, release: 1.6, ceiling: 1.4, knee: 1,
        });
        /** This frame's reading of all of it (one object, reused). */
        this.look = {
            punch: 0, level: 0, fever: 0, stage: 0, warm: 0, shine: 0, brilliance: 0, flare: 0,
        };
        this.textures = null;
        const eye = eyePosition();
        this.eyeVector = new THREE.Vector3(eye[0], eye[1], eye[2]);
        this._az = [0, 0];
        this._dir = [0, 0, 0];
        this._post = {
            exposure: 1, bloomBoost: 0, flash: 0, flashColour: [1, 1, 1], saturation: 1.08, air: 1,
        };
        this.resetState();
    }

    resetState() {
        /** Counts every reset (a seek, a new sitting): parts that remember a frame start afresh. */
        this.epoch = (this.epoch || 0) + 1;
        this.time = 0;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.phase = PHASE0;
        this.spread = 1;
        this.white = 0;
        this.dusk = 0;
        /** Extra seconds the air has drifted ahead of the clock (the heat of play stirs it). */
        this.stir = 0;
        /** The lens's dip for a hit (degrees). */
        this.kick = 0;
        /** How far the heat of play has sunk the suns (radians). */
        this.sink = 0;
        /** How far the ground wind has blown the dust (metres). */
        this.gust = 0;
        /** A chain's spiral arms (their strength now) and the level-up's light on the towers. */
        this.arms = 0;
        this.wakeAt = -1e9;
        /** When the colour's front last set out (the release of four lines). */
        this.frontAt = -1e9;
        /** When a back-to-back's ring last set out. */
        this.b2bAt = -1e9;
        /** How far the gliders have gathered round the suns (0 on their loops .. 1 wheeling). */
        this.gather = 0;
        /** The wind weather's last gale slot (one twister a slot at most). */
        this.galeSlot = -1;
        for (const d of this.twisters) d.power = 0;
        for (const d of this.dustRings) d.power = 0;
        this.pulses.reset();
        this.braid.reset(0, PHASE0);
        this.surge.reset();
        this.shine.reset();
        this.brilliance.reset();
        this.flare.reset();
        for (const key of Object.keys(this.look)) this.look[key] = 0;
        this.counts = emptyCounts();
    }

    // ── Build ─────────────────────────────────────────────────────────────────────

    * buildSteps() {
        const prepared = this.prepared || SunbraidWorld.prepareSync(this.quality);
        this.prepared = prepared;
        this.textures = { noise: createNoiseTexture() };
        const { u, textures: t, tier } = this;
        writeCasters(u, prepared.casters);
        u.eye.value.copy(this.eyeVector);
        u.groundY.value = 0;
        const land = yield* createLandSteps(u, t, tier);
        this.addPart('land', land);
        yield 'land';
        const spires = yield* createSpiresSteps(u, t, tier, prepared.casters);
        this.addPart('spires', spires);
        yield 'spires';
        this.addPart('gliders', createGliders(u, t, tier.gliders));
        this.addPart('dust', createDust(u, t));
        this.addPart('sky', createSky(u, t));
        this.scene.add(this.root);
        return this;
    }

    build() {
        drainSteps(this.buildSteps());
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

    // ── Camera ────────────────────────────────────────────────────────────────────

    pose(camera, time, pointerX = 0, pointerY = 0, kick = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.copy(this.eyeVector);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 89) * 0.35 + clamp(pointerX, -1, 1) * 0.8);
        // A hit dips the lens a touch (it rides on a floor under rapid locks, never a shake).
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 67) * 0.12 - clamp(pointerY, -1, 1) * 0.25 - kick);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    restCamera(camera) {
        this.pose(camera, 0, 0, 0);
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0, this.kick);
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Where on the plain a thing can be seen ───────────────────────────────────

    /**
     * The point of the plain under a point of the screen (fractions, y down), through the lens at
     * rest (its sway is a third of a degree): world x and z. A sight line that never meets the
     * plain (at or above the rim) is taken `far` metres out.
     */
    floorPoint(sx, sy, out = this._pt, far = 2600) {
        const rig = rigFor(this.aspect);
        const tanV = Math.tan((rig.fov * DEG) / 2);
        const x = (sx * 2 - 1) * tanV * this.aspect;
        const y = (1 - sy * 2) * tanV;
        // The lens is turned pitch about x, then yaw about y (camera.rotation 'YXZ').
        const p = rig.pitch * DEG;
        const a = -rig.yaw * DEG;
        const y1 = y * Math.cos(p) + Math.sin(p);
        const z1 = y * Math.sin(p) - Math.cos(p);
        const dx = x * Math.cos(a) + z1 * Math.sin(a);
        const dz = -x * Math.sin(a) + z1 * Math.cos(a);
        const run = Math.hypot(dx, dz) || 1;
        const reach = y1 < -1e-4 ? Math.min(far, (EYE_ALTITUDE / -y1) * run) : far;
        out.x = this.eyeVector.x + (dx / run) * reach;
        out.z = this.eyeVector.z + (dz / run) * reach;
        return out;
    }

    /**
     * A place on the plain beside the board for a lock at column `col` (0..1) and depth `depth`
     * (0 a high row .. 1 the floor): left of the card for the board's left half, right of it and
     * the HUD for its right; under the card where there is no room beside it (a phone held upright).
     * `n` varies the spot from lock to lock; `spread` is how far from the card's edge the lane
     * reaches (a share of the screen's width).
     */
    lanePoint(col, depth, n = 0, player = 0, out = this._pt, spread = 0.2) {
        const { layout } = this;
        const board = boardFor(layout, player);
        const card = cardUnion(layout) || {
            x0: 0.39, y0: 0.08, x1: 0.61, y1: 0.92,
        };
        const jitter = ((n * 0.6180339) % 1);
        const sy = lerp(0.6, 0.93, clamp(depth, 0, 1));
        const spot = this._spot;
        const left = col < 0.5;
        const b = board || card;
        const beside = (toLeft) => {
            const right = Math.max(b.x1, layout?.hud?.x1 ?? b.x1);
            spot.x = toLeft ? b.x0 - 0.075 - spread * jitter : right + 0.05 + spread * 0.8 * jitter;
            spot.y = sy;
            return spot.x > 0.02 && spot.x < 0.98 && outsideKeepOut(layout, spot, 0.01);
        };
        if (!beside(left) && !beside(!left)) {
            // No lane beside the card: the strip of floor under it.
            spot.x = 0.12 + 0.76 * clamp(col, 0, 1);
            spot.y = Math.min(0.985, card.y1 + 0.015 + 0.06 * jitter);
        }
        return this.floorPoint(spot.x, spot.y, out);
    }

    /** The point of the plain under the foot of a player's board (the rings of a clear start there). */
    boardFoot(player = 0, out = this._pt) {
        const board = boardFor(this.layout, player);
        const sx = board ? (board.x0 + board.x1) / 2 : 0.5;
        const sy = board ? Math.min(0.985, board.y1 + 0.01) : 0.9;
        return this.floorPoint(sx, sy, out);
    }

    /** A piece's colour as light: its own hex, else its shape's, else pale. */
    pieceLight(c) {
        if (typeof c?.color === 'string' && HEX.test(c.color)) return hexToLinear(c.color);
        return PIECE_LIGHT[7];
    }

    /** The colour a cleared row lights the plain in: the piece most of its cells were. */
    rowLight(rowCodes, k) {
        if (!Array.isArray(rowCodes) || rowCodes.length < (k + 1) * 10) {
            return PIECE_LIGHT[(k * 3 + this.counts.clears) % 7];
        }
        const tally = [0, 0, 0, 0, 0, 0, 0, 0];
        for (let cidx = 0; cidx < 10; cidx++) tally[clamp(Math.round(rowCodes[k * 10 + cidx]), 0, 7)] += 1;
        let best = 7;
        for (let code = 0; code < 7; code++) {
            if (tally[code] > 0 && (best === 7 || tally[code] > tally[best])) best = code;
        }
        return PIECE_LIGHT[best];
    }

    // ── Gameplay: everything is said by the suns (sunbraid-braid.js) ─────────────

    /** A lock ticks the braid a notch (a hard drop further): play winds the sundial. */
    onLock(c) {
        this.counts.locks += 1;
        if (c?.hardDrop) this.counts.hardDrops += 1;
        this.braid.tick(c?.hardDrop === true && !this.reducedMotion, this.time);
        this.surge.lock(c, this.time);
        this.strikeLock(c, this.time);
    }

    /** A lock's ripple of tiles beside the board, in the piece's colour (a hard drop's wider). */
    strikeLock(c, at) {
        const E = VALLEY_EVENTS;
        const hard = c?.hardDrop === true;
        const row = Array.isArray(c?.rows) && c.rows.length ? Number(c.rows[0]) : 12;
        const depth = clamp((Number.isFinite(row) ? row : 12) / 19, 0, 1);
        const col = Number.isFinite(c?.u) ? c.u : 0.5;
        const spot = c?.screen && Number.isFinite(c.screen.x)
            ? this.floorPoint(c.screen.x, Math.max(0.5, c.screen.y))
            : this.lanePoint(col, depth, this.counts.locks, c?.player || 0);
        const e = hard ? E.drop : E.lock;
        const fell = hard ? Math.min(E.drop.rows, Math.max(0, Number(c?.distance) || 0)) : 0;
        const reach = e.reach + fell * (hard ? E.drop.perRow : 0);
        this.pulses.add({
            at,
            x: spot.x,
            z: spot.z,
            speed: (2 * reach) / e.life,
            gather: -reach / (e.life * e.life),
            width: e.width,
            life: e.life,
            colour: this.pieceLight(c),
            gain: e.gain,
            ridge: true,
        });
        if (hard && !this.reducedMotion) {
            const R = E.dustRing;
            this.throwDust({
                at,
                x: spot.x,
                z: spot.z,
                reach: reach * 1.05,
                life: R.life,
                height: R.height + fell * R.perRow,
                power: R.power,
            });
        }
    }

    /** The slot a new thing takes: a spent one, else the one that has lived longest. */
    freeSlot(slots, at) {
        let best = slots[0];
        for (const d of slots) {
            if (d.power <= 0 || at >= d.at + d.life) return d;
            if (d.at < best.at) best = d;
        }
        return best;
    }

    /** A ring of dust thrown up off the plain. */
    throwDust({
        at, x, z, reach, life, height, power,
    }) {
        const d = this.freeSlot(this.dustRings, at);
        Object.assign(d, {
            at, x, z, reach, life, height, power,
        });
    }

    /** A twister: a column of dust that stands, turns, and walks downwind. */
    raiseTwister({
        at, x, z, height, radius, life, power = 1, spin = 1,
    }) {
        const d = this.freeSlot(this.twisters, at);
        const along = this.u.gustAlong.value;
        Object.assign(d, {
            at, x, z, height, radius, life, power, spin, wx: along.x * TWISTER.walk, wz: along.y * TWISTER.walk,
        });
    }

    /** A twist's twister on the plain beside the board (a side each in turn). */
    strikeTwist(lines, at, player = 0) {
        const E = VALLEY_EVENTS.twister;
        const n = this.counts.twists;
        // Along the lane beside the card, but a fixed way out on the plain: a point of the screen
        // is a few dozen metres from the lens on a phone held upright (the lens looks down), and
        // a twister that near stood over the whole frame.
        const lane = this.lanePoint(n % 2 ? 0.9 : 0.1, 0.3, n + 3, player, this._pt, 0.06);
        const dx = lane.x - this.eyeVector.x;
        const dz = lane.z - this.eyeVector.z;
        const run = Math.hypot(dx, dz) || 1;
        const out = E.range[0] + (E.range[1] - E.range[0]) * ((n * 0.37) % 1);
        const spot = { x: this.eyeVector.x + (dx / run) * out, z: this.eyeVector.z + (dz / run) * out };
        const size = lines > 0 ? 1 : E.small;
        this.raiseTwister({
            at,
            x: spot.x,
            z: spot.z,
            height: (E.height + E.perLine * lines) * size,
            radius: E.radius * (0.8 + 0.2 * size),
            life: E.life * (0.6 + 0.4 * size),
            power: 0.7 + 0.3 * size,
            spin: n % 2 ? -1 : 1,
        });
    }

    /**
     * A clear draws the suns together for a breath (each cascade wave deeper, winding the sundial
     * further) and lights their coronas (hits add: rapid clears build a shimmer); four lines bring
     * them into one white sun and part them wide (a second four lines feeds the one in flight); a
     * Twist twists the braid a third of a turn per spin-turn; a back-to-back flares the ribbons
     * between the suns; a perfect clear riding on it crowns it.
     */
    onClear(c) {
        const lines = Math.max(1, Math.min(4, Math.round(Number(c?.lines) || 1)));
        const wave = Math.max(1, Math.min(12, Math.round(Number(c?.cascade) || 1)));
        const at = this.time;
        this.counts.clears += 1;
        this.counts.lines += lines;
        if (lines >= 4) this.counts.quads += 1;
        if (c?.twist) this.counts.twists += 1;
        if (c?.perfect) this.counts.perfects += 1;
        this.surge.clear(c, at);
        if (lines >= 4) {
            this.braid.conjoin(at);
            this.brilliance.hit(1, at);
        } else {
            this.braid.breathe(lines, at, wave);
        }
        if (wave > 1) this.braid.wave(wave, at);
        if (c?.twist) {
            this.braid.twist(this.reducedMotion ? 1 : lines, at);
            this.strikeTwist(lines, at, c?.player || 0);
        }
        this.shine.hit(0.18 + 0.1 * lines + 0.12 * (wave - 1) + (c?.twist ? 0.25 : 0), at);
        // A back-to-back: the braid itself flares, harder the longer the run (its level steps
        // after this clear, so the run this clear extends is one more than the one held).
        if (c?.b2b) this.flare.hit(0.45 + 0.15 * Math.min(4, this.b2b + 1), at);
        this.strikeClear(c, lines, at);
        if (c?.perfect) this.crown(at, false);
    }

    /**
     * A clear's rings: one a line, out from under the board across the plain, each in the colour
     * of the pieces its row was made of; a back-to-back sends a thin fast ring ahead of them.
     */
    strikeClear(c, lines, at) {
        const E = VALLEY_EVENTS;
        const spot = c?.screen && Number.isFinite(c.screen.x)
            ? this.floorPoint(c.screen.x, Math.max(0.5, c.screen.y))
            : this.boardFoot(c?.player || 0);
        const { x, z } = spot;
        const life = E.clear.life[lines];
        for (let k = 0; k < lines; k++) {
            this.pulses.add({
                at: at + k * E.clear.gap,
                x,
                z,
                radius: 24,
                speed: E.clear.speed,
                width: E.clear.width,
                widen: 6,
                life,
                colour: this.rowLight(c?.rowCodes, k),
                gain: E.clear.gain,
            });
        }
        // A back-to-back: a ring round each sun runs out across the sky (writeWeather).
        if (c?.b2b) this.b2bAt = at;
    }

    /**
     * A perfect clear on its own frame (it settles after its clear's last wave): the crown on the
     * clear still playing, never a clear of its own.
     */
    onPerfect() {
        this.counts.perfects += 1;
        this.crown(this.time, true);
    }

    /** The crown: a joined sun holds a beat longer and the cluster climbs; the braid flares. */
    crown(at, own) {
        this.braid.crown(at);
        this.brilliance.hit(0.7, at);
        this.flare.hit(0.9, at);
        this.shine.hit(0.6, at);
        if (own) this.surge.crown(at);
        // The crown's great rings: white light come apart into the three suns' colours, out from
        // under the board to the rim (held back under Reduce flashing: they take the whole plain).
        const E = VALLEY_EVENTS.perfect;
        const spot = this.boardFoot(0);
        const { x, z } = spot;
        const gain = E.gain * (0.45 + 0.55 * flashScale());
        for (let k = 0; k < E.rings; k++) {
            this.pulses.add({
                at: at + k * E.gap,
                x,
                z,
                radius: 30,
                speed: E.speed,
                gather: E.gather,
                width: E.width,
                widen: E.widen,
                life: E.life,
                rise: 0.2,
                gain,
                split: 1,
            });
        }
    }

    /** A twist that cleared nothing: the braid turns a twelfth and its ribbons flicker. */
    onSpin() {
        this.counts.twists += 1;
        this.braid.spin(this.time);
        this.flare.hit(0.35, this.time);
        this.shine.hit(0.15, this.time);
        this.surge.spin(this.time);
        this.strikeTwist(0, this.time);
    }

    /** A chain turns the braid faster and opens it wider; a break lets it ease back. */
    onCombo(n) {
        const next = Math.max(0, Math.round(Number(n) || 0));
        if (next >= 2 && next > this.combo) this.counts.chainSteps += 1;
        this.combo = next;
        this.peak = Math.max(this.peak, next);
        this.braid.setCombo(next);
    }

    onB2B(level) {
        const next = Math.max(0, Math.round(Number(level) || 0));
        if (next > this.b2b) this.counts.b2bSteps += 1;
        this.b2b = next;
        this.braid.setB2B(next);
    }

    /** A level-up winds the braid on a sixth of a turn (the clock keeps turning it as well). */
    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n > this.level && !silent) {
            this.counts.levelUps += 1;
            this.braid.levelUp(n - this.level, time);
            this.surge.levelUp(time);
            this.wakeAt = time;
        }
        this.level = n;
    }

    /** Game over: the suns set below the rim. */
    onGameOver() {
        this.counts.gameOvers += 1;
        this.braid.setDusk(true, this.time);
    }

    /** A new run after a game over: the suns rise again. */
    onSessionStart() {
        if (this.braid.duskTo > 0) {
            this.counts.mornings += 1;
            this.braid.setDusk(false, this.time);
        }
    }

    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.level = 1;
        this.braid.setCombo(0);
        this.braid.setB2B(0);
    }

    /** Jump the clock (captures): everything in flight is dropped, the braid stands where the clock puts it. */
    seek(time) {
        const t = Math.max(0, Number(time) || 0);
        this.resetState();
        this.braid.reset(t, PHASE0);
        this.time = t;
        this.gust = t * 13;
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT) scalars[key] = this[key];
        const { surge } = this;
        return {
            scalars,
            braid: this.braid.exportState(),
            counts: { ...this.counts },
            // The heat of play and what it lights: a rebuild in place carries on mid-surge.
            surge: surge.exportState(),
            swells: {
                shine: this.shine.exportState(),
                brilliance: this.brilliance.exportState(),
                flare: this.flare.exportState(),
            },
        };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.braid.importState(state.braid);
        this.braid.time = this.time;
        this.counts = { ...emptyCounts(), ...state.counts };
        if (state.surge) this.surge.importState(state.surge);
        this.shine.importState(state.swells?.shine);
        this.brilliance.importState(state.swells?.brilliance);
        this.flare.importState(state.swells?.flare);
    }

    /** The post marches the light in the air: the land then leaves the sunlit air to it. */
    setAirMarch(on) {
        this.airMarch = on === true;
        this.u.airMarch.value = this.airMarch ? 1 : 0;
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    /** Where the suns stand and what light they give: written into the uniforms. */
    writeSuns(time) {
        const { u } = this;
        const phase = this.overrides.phase !== null ? this.overrides.phase : this.phase;
        // Dusk sets the cluster, a perfect clear's crown lifts it, the heat of play sinks it a little.
        const duskDrop = this.dusk * 16 * DEG - (this.lift || 0) + (this.sink || 0);
        // The heat of play: the suns' glow in the sky brightens and their discs swell; the one white
        // sun of four lines swells further with its brilliance.
        const L = SURGE_LOOK;
        const { warm, fever } = this.look;
        // The dome's own colours away from the suns: cobalt-violet overhead, rose-mauve low.
        const night = 1 - 0.78 * this.dusk;
        // (Deep cobalt-violet overhead: the dome's top is the frame's darkest, saturated field.)
        const zen = [0.022 * night + 0.012 * this.dusk, 0.026 * night, 0.17 * night + 0.02 * this.dusk];
        const hor = [0.27 * night + 0.16 * this.dusk, 0.17 * night + 0.04 * this.dusk, 0.25 * night + 0.1 * this.dusk];
        const lit = [0, 0, 0];
        const share = [0, 0, 0];
        const disc = [0, 0, 0];
        const pen = [0, 0, 0];
        const glowGain = 1 + L.glow.level * warm + L.glow.fever * fever + L.glow.shine * this.look.shine;
        const swell = 1 + L.disc.level * warm + L.disc.fever * fever
            + L.disc.white * this.white * Math.min(1.2, 0.6 + 0.4 * this.look.brilliance);
        // The braid's own frame in the sky (the spiral arms and the rays are drawn in it), sunk
        // or lifted with the cluster.
        const [caz, cel0] = clusterCentre(time, this._centre);
        const cel = cel0 - duskDrop;
        const cc = Math.cos(cel);
        u.centre.value.set(Math.sin(caz) * cc, Math.sin(cel), -Math.cos(caz) * cc);
        u.east.value.set(Math.cos(caz), 0, Math.sin(caz));
        u.north.value.set(-Math.sin(caz) * Math.sin(cel), Math.cos(cel), Math.cos(caz) * Math.sin(cel));
        // The wheel the gliders gather on: out along the sight line to the cluster, facing the
        // eye and leaning back from it.
        const { wheel } = this;
        const ce = u.centre.value;
        const no = u.north.value;
        const ea = u.east.value;
        const lean = Math.sin(WHEEL.lean);
        const upright = Math.cos(WHEEL.lean);
        wheel.c[0] = this.eyeVector.x + ce.x * WHEEL.range;
        wheel.c[1] = this.eyeVector.y + ce.y * WHEEL.range;
        wheel.c[2] = this.eyeVector.z + ce.z * WHEEL.range;
        wheel.e1[0] = ea.x;
        wheel.e1[1] = ea.y;
        wheel.e1[2] = ea.z;
        wheel.e2[0] = no.x * upright + ce.x * lean;
        wheel.e2[1] = no.y * upright + ce.y * lean;
        wheel.e2[2] = no.z * upright + ce.z * lean;
        u.braidAngle.value = ((phase % TAU) + TAU) % TAU;
        u.braidRadius.value = Math.tan(BRAID.spread * DEG * Math.max(0, this.spread));
        // The moon: where it stands on its pass, and how much of each sun it hides.
        const moonClock = typeof this.overrides.moon === 'number' ? this.overrides.moon : time;
        const moon = moonAt(moonClock, caz, cel, this._moon);
        const seen = this.overrides.moon === false ? 0 : moonSeen(moon.phase) * (1 - this.dusk);
        const md = sunDirection(moon.az, moon.el, this._moonDir);
        u.moon.value.set(md[0], md[1], md[2], Math.cos(MOON.radius));
        u.moonSeen.value = seen;
        this.toLens(md, MOON.radius, u.moonAt.value);
        for (let k = 0; k < 3; k++) {
            const dir = sunVector(phase, k, time, this.spread, this._dir);
            if (duskDrop !== 0) {
                // The cluster sinks: tilt the direction down toward the rim.
                const [az0, el0] = azElOf(dir, this._az);
                const lowered = el0 - duskDrop;
                const c = Math.cos(lowered);
                dir[0] = Math.sin(az0) * c;
                dir[1] = Math.sin(lowered);
                dir[2] = -Math.cos(az0) * c;
            }
            const [azk, el] = azElOf(dir, this._az);
            const sun = SUNS[k];
            this.toLens(dir, sun.radius * swell, u[`disc${k}`].value);
            // An eclipse: the moon takes the light of the sun it covers (never the one white sun's).
            const hidden = discCover(angleBetween(azk, el, moon.az, moon.el), sun.radius * swell, MOON.radius)
                * seen * (1 - this.white);
            this.eclipse[k] = hidden;
            const past = 1 - MOON.depth * hidden;
            // Low suns lose some light in the long air (and set below the rim).
            const through = smooth(-1.5 * DEG, 5 * DEG, el) * (0.82 + 0.18 * smooth(4 * DEG, 24 * DEG, el));
            // The one white sun of a conjunction: each sun's colour pales toward white as they meet.
            const power = sun.power * through * LIGHT_GAIN * past;
            const c = sun.rgb.map((v) => (v + (0.62 - v) * this.white) * power);
            u[`sat${k}`].value.set(sun.rgb[0] * power, sun.rgb[1] * power, sun.rgb[2] * power);
            u[`pale${k}`].value.setScalar(0.62 * power);
            u[`sun${k}`].value.set(dir[0], dir[1], dir[2]);
            u[`col${k}`].value.set(c[0], c[1], c[2]);
            // The glow outlives the light: a set sun keeps a band of its colour on the horizon.
            const after = smooth(-9 * DEG, 0, el) * (1 + 1.6 * this.dusk * smooth(1 * DEG, -4 * DEG, el));
            const glowing = sun.power * LIGHT_GAIN * Math.max(through, after * 0.7) * glowGain * (1 - 0.55 * hidden);
            const g = sun.rgb.map((v) => (v + (0.62 - v) * this.white) * glowing);
            u[`glow${k}`].value.set(g[0], g[1], g[2]);
            disc[k] = Math.cos(sun.radius * swell);
            // A crisp penumbra: graphic edges are the point of a coloured shadow.
            pen[k] = 0.42 * DEG;
            share[k] = 0.25 + 1.4 * (1 - smooth(6 * DEG, 32 * DEG, el));
            const high = Math.max(0, Math.sin(el));
            for (let i = 0; i < 3; i++) {
                zen[i] += (c[i] / LIGHT_GAIN) * 0.012 * (0.4 + high);
                hor[i] += (c[i] / LIGHT_GAIN) * 0.05;
                lit[i] += c[i] * high;
            }
        }
        // (At dusk the suns are gone: their afterglow in the dome lights the crust, so the tiles stay.)
        const g0 = u.glow0.value;
        const g1 = u.glow1.value;
        const g2 = u.glow2.value;
        const linger = 0.011 * this.dusk;
        u.afterglow.value.set(g0.x + g1.x + g2.x, g0.y + g1.y + g2.y, g0.z + g1.z + g2.z).multiplyScalar(linger);
        u.discCos.value.set(disc[0], disc[1], disc[2]);
        u.penumbra.value.set(pen[0], pen[1], pen[2]);
        u.glowShare.value.set(share[0], share[1], share[2]);
        u.zenith.value.set(zen[0], zen[1], zen[2]);
        u.horizon.value.set(hor[0], hor[1], hor[2]);
        u.groundLit.value.set(lit[0], lit[1], lit[2]);
    }

    /**
     * The lens's axes (the sky draws the suns' discs and the moon's in its image plane, so they
     * are round wherever they stand in the frame): the camera's, or the rest rig's with none bound.
     */
    writeLens(camera) {
        const { u } = this;
        if (camera?.matrixWorld) {
            camera.updateMatrixWorld();
            u.lensRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
            u.lensUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
            u.lensAhead.value.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
            return;
        }
        const rig = rigFor(this.aspect);
        const p = rig.pitch * DEG;
        const a = -rig.yaw * DEG;
        u.lensRight.value.set(Math.cos(a), 0, -Math.sin(a));
        u.lensUp.value.set(Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a));
        u.lensAhead.value.set(-Math.cos(p) * Math.sin(a), Math.sin(p), -Math.cos(p) * Math.cos(a));
    }

    /**
     * Where a direction (a unit triple) stands in the lens's image plane, and how wide a disc of
     * angular radius `radius` is there: (x, y, radius) in tangent units from the view axis. Behind
     * the lens it is put far off the frame.
     */
    toLens(dir, radius, out) {
        const { u } = this;
        const R = u.lensRight.value;
        const U = u.lensUp.value;
        const F = u.lensAhead.value;
        const ahead = dir[0] * F.x + dir[1] * F.y + dir[2] * F.z;
        if (!(ahead > 0.05)) return out.set(99, 99, Math.tan(radius));
        return out.set(
            (dir[0] * R.x + dir[1] * R.y + dir[2] * R.z) / ahead,
            (dir[0] * U.x + dir[1] * U.y + dir[2] * U.z) / ahead,
            Math.tan(radius) / ahead,
        );
    }

    /**
     * The weather (sunbraid-weather.js): a pure function of the clock, melted between the weather
     * it is leaving and the one it turns into; the air's drift runs ahead of it as play heats.
     */
    writeWeather(time, drift) {
        const { u } = this;
        const w = weatherAt(time, this.overrides.weather, this.weather);
        u.cirrus.value = w.cirrus;
        u.banks.value = w.banks;
        u.veil.value = w.veil;
        u.rain.value = w.rain;
        u.cloudShade.value = w.shade;
        // The cloud whose shadows cross the land: more of it as the banks build.
        u.cloudCover.value = 0.66 - 0.26 * w.banks;
        u.hazeDensity.value = this.hazeRest * w.haze;
        // The streets of ice cloud run along the wind, which blows toward the suns' bearing and
        // swings a little either side of it.
        const bearing = BRAID.azimuth * DEG + 0.13 * Math.sin((TAU * time) / 211);
        u.windAlong.value.set(Math.sin(bearing), -Math.cos(bearing));
        u.windAcross.value.set(Math.cos(bearing), Math.sin(bearing));
        u.cirrusDrift.value = (drift * 48) % 5796000;
        u.bankDrift.value = (drift * 0.0016) % 100;
        // The ice veil stands a pillar of light over each sun and ghosts a ring round it.
        // A perfect clear's crown: the rings open round the suns and their pillars stand.
        const P = VALLEY_EVENTS.perfect;
        const crowned = time - this.braid.noonAt;
        const crown = crowned >= 0 ? smooth(0, 0.5, crowned) * (1 - smooth(P.stand, P.stand + 2.6, crowned)) : 0;
        const opened = crowned >= 0 ? smooth(0, P.open, crowned) : 1;
        // A back-to-back's ring runs out from the suns and is gone (a crown's rings stand instead).
        const B = VALLEY_EVENTS.b2b;
        const ran = (time - this.b2bAt) / B.life;
        const ring = ran >= 0 && ran < 1 && crown < 0.05 ? B.gain * (1 - ran) ** 1.4 * smooth(0, 0.08, ran) : 0;
        u.pillar.value = Math.min(1.3, 0.9 * w.veil + crown);
        u.halo.value = Math.min(1.5, Math.max(0.2 * w.veil + 1.3 * crown, ring));
        if (crown > 0) u.haloRadius.value = 0.03 + 0.13 * opened;
        else if (ring > 0) u.haloRadius.value = B.from + (B.reach - B.from) * (1 - (1 - ran) * (1 - ran));
        else u.haloRadius.value = 0.15;
        u.stars.value = this.dusk * this.dusk;
        // The film of water and the ground wind's dust.
        u.wet.value = w.wet;
        u.rippleDrift.value.set((time * 0.0083) % 10, (time * 0.0061) % 10);
        u.sunTurn.value.set((time * 0.0021) % 1, (time * 0.0013) % 1);
        u.wind.value = Math.min(1.2, w.wind + 0.25 * this.look.warm);
        const swing = 62 * DEG + 0.14 * Math.sin((TAU * time) / 157);
        u.gustAlong.value.set(Math.sin(swing), -Math.cos(swing));
        u.gustAcross.value.set(Math.cos(swing), Math.sin(swing));
        u.gustDrift.value = this.gust % 22100;
    }

    /**
     * Four lines' colour front and everything else play lights in the valley this frame: the
     * pulses in the crust, the spiral arms of a chain, the one white sun's rays, the towers' wake.
     */
    writeValley(time, dt, prev) {
        const { u, braid } = this;
        const E = VALLEY_EVENTS;
        // The colour's front: the land is the one white sun's while the suns close and stay
        // joined; on their release the colour comes back behind a front that crosses the valley
        // from under the suns (and a ring of light rides it).
        const released = time - braid.conj.holdUntil;
        const az = BRAID.azimuth * DEG;
        const ox = Math.sin(az) * E.front.origin;
        const oz = -Math.cos(az) * E.front.origin;
        if (released < 0) {
            u.whiteLand.value = this.white;
            u.flood.value.set(ox, oz, 0, E.front.soft);
        } else if (released < E.front.life) {
            u.whiteLand.value = 1;
            u.flood.value.set(ox, oz, E.front.speed * released + E.front.gather * released * released, E.front.soft);
            if (prev - braid.conj.holdUntil < 0 || this.frontAt < braid.conj.holdUntil) {
                this.frontAt = time;
                this.pulses.add({
                    at: braid.conj.holdUntil,
                    x: ox,
                    z: oz,
                    speed: E.front.speed,
                    gather: E.front.gather,
                    width: E.front.width,
                    widen: 34,
                    life: E.front.life,
                    rise: 0.12,
                    gain: E.front.gain * (0.45 + 0.55 * flashScale()),
                    split: 1,
                });
            }
        } else {
            u.whiteLand.value = 0;
            u.flood.value.set(ox, oz, 0, E.front.soft);
        }
        u.pulseCount.value = this.pulses.write(u.pulseRows, time);
        // A chain's spiral arms: each step lengthens and brightens them; they ease back when it breaks.
        const steps = braid.chainSteps();
        const want = Math.min(E.arms.most, steps * E.arms.step + 0.5 * this.look.fever);
        this.arms += (want - this.arms) * (1 - Math.exp(-Math.max(0, dt) / E.arms.ease));
        u.arms.value = this.reducedMotion ? this.arms * 0.6 : this.arms;
        u.armReach.value = Math.min(1.4, 0.4 + 0.16 * steps + 0.3 * this.look.fever);
        // The one white sun's rays.
        u.rays.value = this.white * Math.min(1.5, 0.75 + 0.35 * this.look.brilliance);
        u.rayTurn.value = (time * (this.reducedMotion ? 0.004 : 0.014)) % 1;
        // A level-up's light climbing the towers.
        const woke = time - this.wakeAt;
        u.wake.value = woke >= 0 && woke < E.wake.life ? woke : -1;
        // The wind weather raises a twister of its own far out now and then.
        const slot = Math.floor(time / E.gale.every);
        if (slot !== this.galeSlot) {
            const first = this.galeSlot < 0;
            this.galeSlot = slot;
            const h = Math.sin(slot * 127.1 + 311.7) * 43758.5453;
            const pick = h - Math.floor(h);
            if (!first && this.weather.wind > E.gale.from && pick < 0.75 && !this.reducedMotion) {
                const bearing = (-40 + 80 * ((pick * 7.3) % 1)) * DEG;
                const range = 800 + 900 * ((pick * 3.1) % 1);
                this.raiseTwister({
                    at: time,
                    x: Math.sin(bearing) * range,
                    z: -Math.cos(bearing) * range,
                    height: E.gale.height * (0.8 + 0.4 * pick),
                    radius: E.gale.radius,
                    life: E.gale.life,
                    power: 0.8,
                    spin: pick < 0.4 ? -1 : 1,
                });
            }
        }
        // The twisters stand in three suns' light: each throws a faint shadow per sun (a cylinder
        // that lets most of the light past), written after the towers' rows.
        const rows = u.casterRows;
        const solid = u.solidCount.value;
        let cast = 0;
        for (const d of this.twisters) {
            const age = time - d.at;
            if (!(d.power > 0) || age < 0 || age >= d.life || (solid + cast + 1) * 2 > rows.length) continue;
            const grown = smooth(0, TWISTER.rise, age) * (1 - smooth(d.life - TWISTER.fade, d.life, age));
            const x = d.x + d.wx * age;
            const z = d.z + d.wz * age;
            const at = (solid + cast) * 2;
            rows[at].set(x, 0, z, d.radius * TWISTER.girth);
            rows[at + 1].set(d.height * (0.25 + 0.6 * grown), 1 - TWISTER.shade * d.power * grown, 0, 0);
            cast += 1;
        }
        // (The rows a twister has left go back to rest.)
        for (let k = cast; k < TWISTERS && (solid + k + 1) * 2 <= rows.length; k++) {
            rows[(solid + k) * 2].set(0, -1e5, 0, 0);
            rows[(solid + k) * 2 + 1].set(0, -1e5, 0, 0);
        }
        u.casterCount.value = solid + cast;
        // The gliders answer a chain: they leave their loops and wheel round the triple star (a
        // perfect clear calls them all).
        const G = E.gather;
        const crowned = time - braid.noonAt;
        const called = crowned >= 0 && crowned < G.crown ? 1 : 0;
        const wantGather = Math.max(called, smooth(G.from, G.full, steps));
        this.gather += (wantGather - this.gather) * (1 - Math.exp(-Math.max(0, dt) / G.ease));
    }

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        const prev = this.time;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const dt = Math.max(0, Math.min(0.25, sim.delta ?? this.time - prev));
        const { time, u } = this;
        const look = this.sampleSurge(time);
        const L = SURGE_LOOK;
        const { warm, fever } = look;
        this.braid.step(time, dt);
        this.phase = this.braid.phaseNow();
        this.spread = this.braid.spreadNow();
        this.white = this.braid.whiteNow();
        this.dusk = this.braid.duskLevel(time);
        this.lift = this.braid.liftNow();
        // The air runs ahead of the clock as play heats (the drift integrates the stir, so it
        // never jumps back when play cools).
        const calm = this.reducedMotion ? 0.3 : 1;
        this.stir += dt * (L.stir.level * warm + L.stir.fever * fever) * calm;
        this.glideTime = time + this.stir * 0.6;
        const ribbon = this.braid.ribbon + L.ribbon.level * warm + L.ribbon.fever * fever + L.ribbon.flare * look.flare;
        u.ribbon.value = this.reducedMotion ? ribbon * 0.6 : ribbon;
        u.ribbonWind.value = ((time + 1.5 * this.stir) * 0.7) % (TAU * 512);
        u.blaze.value = 1 + L.blaze.level * warm + L.blaze.fever * fever + L.blaze.shine * look.shine
            + L.blaze.brilliance * look.brilliance;
        u.mistDensity.value = this.mistRest.density * (1 + L.mist.level * warm + L.mist.fever * fever);
        u.time.value = time % 4096;
        // The high cloud drifts on a steady wind (closed form at rest: the clock times a constant).
        const drift = time + this.stir;
        u.cloudDrift.value.set((drift * 7.5) % 160000, (drift * -3.1) % 160000);
        this.writeWeather(time, drift);
        // The ground wind (it never blows back: the drift integrates its speed).
        this.gust += dt * (9 + 20 * this.weather.wind) * (1 + 0.5 * warm) * calm;
        this.writeLens(camera);
        this.writeSuns(time);
        this.writeValley(time, dt, prev);
        this.writePost();
        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
        }
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    /**
     * What the gameplay does to the picture (POST_EVENTS): the one white sun of four lines glares and
     * floods the frame with white; noon (a perfect clear) blazes and the iris closes a little so the
     * floor keeps its crust; a chain's braid deepens the colour.
     */
    writePost() {
        const post = this._post;
        const P = POST_EVENTS;
        const L = SURGE_LOOK;
        const {
            warm, fever, punch, shine, brilliance,
        } = this.look;
        const white = clamp(this.white || 0, 0, 1);
        const noon = clamp((this.lift || 0) / BRAID_EVENTS.noon.lift, 0, 1);
        const ribbon = clamp(this.braid.ribbon || 0, 0, 1);
        // The white sun glares as it always has, brighter for every four lines that fed it; the
        // heat of play and every clear's shine add to the glare on the suns; a hit kicks it (a
        // momentary kick: held back under Reduce flashing, as the post holds the flash).
        post.bloomBoost = P.whiteGlare * white * (1 + 0.25 * Math.min(1.2, Math.max(0, brilliance - 1)))
            + P.noonGlare * noon
            + L.glare.level * warm + L.glare.fever * fever + L.glare.shine * shine
            + flashScale() * L.punchGlare * punch;
        post.flash = P.whiteFlash * white + L.punchFlash * Math.max(0, punch - L.flashFrom);
        // The iris closes a little as heat adds light, so the fans keep their colour.
        // (And for the one white sun: its light is every colour at once, and a white valley
        // held at full exposure was two seconds of glare round the board.)
        post.exposure = 1 - P.noonIris * noon - P.whiteIris * white - L.iris.level * warm - L.iris.fever * fever;
        post.saturation = P.saturation + P.chainSaturation * ribbon;
        // The mist's light in the air (the towers' coloured wedges) rises with the heat.
        post.air = 1 + L.air.level * warm + L.air.fever * fever + L.air.shine * shine;
    }

    /**
     * Where play stands (once a frame, on the world's clock): the surge, every clear's shine, the
     * white sun's brilliance and the ribbons' flare; and how close the heat draws the suns.
     */
    sampleSurge(time) {
        const L = SURGE_LOOK;
        const s = this.surge.sample(time);
        const { look } = this;
        look.punch = s.punch;
        look.level = s.level;
        look.fever = s.fever;
        look.stage = s.stage;
        // Nothing below `from`: casual play leaves the valley as it is.
        look.warm = smooth(L.from, 1, s.level);
        look.shine = this.shine.valueAt(time);
        look.brilliance = this.brilliance.valueAt(time);
        look.flare = this.flare.valueAt(time);
        this.braid.pull = L.pull.level * look.warm + L.pull.fever * look.fever;
        this.kick = L.kick * look.punch;
        this.sink = (L.sink.level * look.warm + L.sink.fever * look.fever) * DEG;
        return look;
    }

    prerender() {}

    getPostState() { return this._post; }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            phase: this.phase,
            spread: this.spread,
            white: this.white,
            dusk: this.dusk,
            sink: this.sink,
            heat: {
                punch: this.look.punch, level: this.look.level, fever: this.look.fever, stage: this.look.stage,
            },
            counts: { ...this.counts },
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
        this.textures?.noise?.dispose();
        this.root.clear();
        this.partList.length = 0;
    }
}
