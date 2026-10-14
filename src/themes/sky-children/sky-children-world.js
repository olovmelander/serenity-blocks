/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: the world.
 *
 * The eye stands on a travertine overlook at the edge of the high country with the sun low BEHIND
 * it. Ahead, the other half of the sky; left of the card the Spring Isle's white terraces and the
 * Mother Fall pouring into the Deep; right of the HUD the Twin Isle and its broken aqueduct; far off
 * the Far Gate and an archipelago in haze; below everything the Deep, bottomless, with the isles'
 * shadows converging on the antisolar point. Everything is built here and shared with the playground
 * effect (src/playground/effects/sky-children.effect.js), so what is iterated there ships.
 *
 * Parts (showOnlyParts names): sky, sea, cumulus, isles, falls, spray, pools, gliders, fx.
 *
 * What the board does to it:
 *   lock        a light-copy of the piece melts into a thread of light-water that a pool HOLDS
 *   hard drop   a straight jet, a double crown, the pool brims; the eye dips
 *   clear       each cleared row pours off both sides of the card; one surge down every fall per
 *               line; the oldest held colours RIDE DOWN the white falls as coloured ribbons
 *               (3 per line, all on four); two lines run the broken span and bank the flock; three
 *               raise a tower of spray with a bow standing in it
 *   combo       the children paint the bow, one stroke per link, until from this height it closes
 *               into a full circle; the secondary follows; the bows breathe, then sing
 *   four lines  the hush (the falls thin, the spray hangs, the children stop dead), then the glory
 *               opens at the tip of our own shadow, one ring per line, and the great pour
 *   perfect     the same, eight rings, and the Far Gate's spillway runs for the only time
 *   T-spin      the falls are wrung, two children rise in a double helix, the colours turn
 *   B2B         the pools stay brimming; the long-wing keeps station on the bow
 *   level up    the bell tolls the hour: every pool rings, a flight of children sails out, and the
 *               light turns one place round the wheel
 * and the clock turns the same wheel by itself (HOUR_SECONDS per hour), in every mode.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    DEG, approach, bakeOpticsLut, bakePuff, bakeSeaField, bakeSkyNoise, bakeStoneNoise, clamp, clamp01, fallPoint, hexToLinear,
    pieceLight, smooth,
} from './sky-children-core.js';
import { tierFor } from './sky-children-quality.js';
import {
    REST_RIG, bowPoint, fovForAspect, frameFor, nominalLayout, project, recutStrokes, unproject,
} from './sky-children-frame.js';
import { COLOUR_ROWS, HourWheel, hourAt } from './sky-children-hours.js';
import {
    createFieldTexture, createLight, createLutTexture, createNoiseTexture, createSpriteTexture, tune,
} from './sky-children-tsl.js';
import { createSky } from './sky-children-sky.js';
import { createSea } from './sky-children-sea.js';
import { createCumulus, cumulusPlan } from './sky-children-cumulus.js';
import { PLAN, placePlan } from './sky-children-plan.js';
import { createIsles, entryToWorld, outletAt } from './sky-children-isles.js';
import { createPools } from './sky-children-water.js';
import { GliderFlock } from './sky-children-flock.js';
import { createGliders } from './sky-children-gliders.js';
import {
    FALL_KIND, FALL_SLOT, FALL_SLOTS, HAIRLINES, HORSETAILS, PACKET_SLOTS, clearFall, createFallTable, createFalls, createPacketTable,
    fallHalfWidth, writeFall,
} from './sky-children-falls.js';
import {
    GLOW, SPRAY_ROLE, createGlows, createSpray,
} from './sky-children-fx.js';
import { EventEffects, LOCK, SPARKS } from './sky-children-events.js';
import { FlashGovernor } from './sky-children-flash.js';
import { boardFor } from './sky-children-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';

export { REST_RIG, fovForAspect };

/** The parts a capture can show alone. */
export const SKY_CHILDREN_PARTS = Object.freeze(['sky', 'sea', 'cumulus', 'isles', 'falls', 'spray', 'pools', 'gliders', 'fx']);

/** The scalar rows the shaders read (HOUR_SCALARS names → uniforms). */
const SCALAR_UNIFORMS = Object.freeze([
    'keyGain', 'twilight', 'polar', 'stars', 'milky', 'bowGain', 'bowSat', 'fogbow', 'bowRest', 'bowSunset', 'hearth',
    'gliderGlow', 'cloud', 'spray', 'shadowDepth', 'albedoSat', 'coulisse', 'term', 'cloudGain',
]);

/** Strokes the chain paints (7 primary + 5 secondary) and the cap of the dial. */
export const STROKES = 12;
export const DIAL_MAX = 13;
/** Casters (isle shadows across the Deep). */
export const CASTERS = 8;

/**
 * How a stroke's ends are ramped (radians of arc, half the ramp's width): the brush's head while
 * it paints, an end left in open sky (a brushed end of ~3.5°), an end joined to a painted
 * neighbour, and how far an end the card (or the frame) hides runs on under it.
 */
export const STROKE_END = Object.freeze({
    head: 0.013, free: 0.03, tight: 0.004, calm: 0.044, edge: 0.12,
});
/** Arc (radians) a neighbour's brush must cover before the joint it leaves pulls tight. */
export const JOIN_ARC = 0.05;
/** Seconds the brush's glint lingers on a stroke once it is laid. */
export const HEAD_FADE = 1.2;

/**
 * The convex outline (counter-clockwise) of frame points [[x, y], …], drawn `shrink` of the way
 * in toward its middle: a set piece's silhouette as the stroke cut treats it (a little inside its
 * true edge, so a stroke never stops short of where the bow shows).
 */
export function hullOf(points, shrink = 0) {
    if (points.length < 3) return null;
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    let hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    // Clipped to a little round the frame (a vertex near the eye's plane projects far off it).
    const clipTo = (poly, inside, cut) => {
        const kept = [];
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            if (inside(a)) kept.push(a);
            if (inside(a) !== inside(b)) kept.push(cut(a, b));
        }
        return kept;
    };
    for (const [axis, bound, keepBelow] of [[0, -0.1, false], [0, 1.1, true], [1, -0.1, false], [1, 1.1, true]]) {
        if (hull.length < 3) return null;
        hull = clipTo(
            hull,
            (q) => (keepBelow ? q[axis] <= bound : q[axis] >= bound),
            (a, b) => {
                const t = (bound - a[axis]) / (b[axis] - a[axis]);
                return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            },
        );
    }
    if (hull.length < 3) return null;
    const cx = hull.reduce((sum, p) => sum + p[0], 0) / hull.length;
    const cy = hull.reduce((sum, p) => sum + p[1], 0) / hull.length;
    return hull.map(([x, y]) => [x + (cx - x) * shrink, y + (cy - y) * shrink]);
}

/** Seconds a stroke takes to paint; withdrawal spacing on a break; the B2B grace. */
const STROKE_SECONDS = 1.0;
const UNWIND_SECONDS = 0.35;
/**
 * The paint's own light, in the glow layer (metres out the bow's lights stand, behind the near isles;
 * seconds a laid stroke glitters; seconds the sweep runs along a bow that has just closed).
 */
const PAINT = Object.freeze({
    depth: 1600, glitter: 1.8, sweep: 1.3, glints: 16,
});
const B2B_GRACE = 4;
/** How far in front of the eye the lock's copy and the clear's sheets are drawn (metres). */
const NEAR_DEPTH = 42;
/** Pools released per line (FINAL §2.2). */
const RELEASE_PER_LINE = 3;
/** The hush before the four-line set piece (seconds) and the perfect clear's. */
const HUSH = 0.33;
const HUSH_PERFECT = 0.4;
/** The glory: when each ring opens (seconds after the hush ends), how long it holds. */
const GLORY_HOLD = 7.6;
/** The falls' slots (the Mother, the span, the Twin's horsetails, the far hairlines, the spillway). */
const SLOT = FALL_SLOT;

/** A hard drop's jet time (its light lands this long after the lock). */
const LOCK_JET = LOCK.jet;

/** Where on the Spring Isle's lowest lip the Mother Fall leaves (radians, + toward the leg). */
const MOTHER_BEARING = 0.62;
/**
 * The Mother Fall: how she leaves her lip (m/s), her width there (m) and how fast it grows (m/s),
 * the glass over her lip (s), her curtain's arc (rad); her life in shares of the drop the frame
 * shows (the sheet breaks into horsetails at `breakH` of it, they go to mist at `mistH`, and what
 * is drawn runs on to `tail` times the time it takes to fall it, so she never ends hard).
 */
const MOTHER = Object.freeze({
    v0: 5.2, width: 26, spread: 3.4, lipT: 1.0, form: 0.9, breakH: 0.38, mistH: 0.8, tail: 1.22,
});
/**
 * The span's fall (sheet-lite) and the Twin's horsetails, the same way, except that a thin fall
 * goes to mist above the frame's edge (it ends in a breath of spray, never runs out of the frame
 * like a cable), and a horsetail's drop is told over at most `most` seconds (a phone's tall frame
 * would draw it as a line). Each horsetail leaves at its own speed, so no two hang parallel.
 */
const SPAN = Object.freeze({
    v0: 3.0, width: 6.5, spread: 1.6, lipT: 0.6, form: 0.45, breakH: 0.25, mistH: 0.62, tail: 1.0, most: 7.5,
});
const HORSE = Object.freeze({
    v0: Object.freeze([1.3, 2.3, 1.7]), spread: 0.9, breakH: 0.2, mistH: 0.6, tail: 0.98, most: 6.5,
});
/**
 * The spray, per fall, by role: `h` the share of the visible drop it leaves from (0 the lip, 1
 * where the frame's lower edge cuts the fall), `share` of the spray's capacity, `across` how far
 * out from the centre line it starts (half-widths) and `out` how fast it billows out (m/s), its
 * `size` (m), `rise` and wind `drift` (m/s), `life` (s), `density`, and `bow` the promise of the bow
 * it carries at rest. The Mother's plume holds most of it; the Twin's threads only end in a breath.
 * The Mother's brink throws none (a real one throws little: her glass, her crest and her torn edges
 * tell it); the span's broken masonry does, beads riding down its corners with the water (`ride`).
 * The veil keeps to the curtain's open side, where it shows against the sky, a third of it out past
 * her edge (`past`).
 */
const SPRAY = Object.freeze({
    mother: [
        {
            role: SPRAY_ROLE.veil, share: 0.24, h: [0.12, 0.75], across: [0.6, 1.0], out: 0.4, size: [8, 15], rise: 0.25, drift: 0.6, life: [5, 8], density: 0.9, bow: 0.2, past: [1.0, 1.5],
        },
        {
            role: SPRAY_ROLE.plume, share: 0.36, h: [0.68, 1.05], across: [0, 1.0], out: 0.75, size: [6, 14], rise: 1.5, drift: 2.0, life: [5, 8], density: 1.3, bow: 0.25,
        },
    ],
    span: [
        {
            role: SPRAY_ROLE.lip, share: 0.03, h: [0.01, 0.06], across: [0.7, 1.05], out: 0.4, size: [1.5, 3], rise: 0, drift: 0.5, life: [1.6, 2.4], density: 1.2, bow: 0.05, ride: 0.8,
        },
        {
            role: SPRAY_ROLE.foot, share: 0.07, h: [0.55, 0.98], across: [0, 0.8], out: 0.45, size: [6, 11], rise: -0.6, drift: 0.6, life: [4, 7], density: 1.0, bow: 0.1,
        },
    ],
    horse: [
        {
            role: SPRAY_ROLE.foot, share: 0.06, h: [0.55, 0.95], across: [0, 0.8], out: 0.35, size: [4, 8], rise: -0.6, drift: 0.6, life: [4, 7], density: 0.9, bow: 0.08,
        },
    ],
});
/** Every emitter, flat (the fall's slot and its role), built once: nothing is allocated per frame. */
const SPRAY_EMITTERS = Object.freeze(Object.entries(SPRAY).flatMap(([name, roles]) => {
    const slots = name === 'horse' ? [FALL_SLOT.horse, FALL_SLOT.horse + 1, FALL_SLOT.horse + 2] : [FALL_SLOT[name]];
    return slots.flatMap((slot) => roles.map((e) => Object.freeze({ ...e, slot, mother: slot === FALL_SLOT.mother })));
}));
/**
 * What is thrown up out of the Mother's plume: a long hard drop's `swell` (the plume heaves a
 * little as the jet lands) and a three-line clear's `tower` (a column of spray with the bow
 * standing in it): how high (m), how long it stands (s), how much bow it adds (a tower asks the
 * flash governor first). Another one while one stands carries it on, never throws it again; under
 * reduced motion nothing is thrown, the plume only thickens, slowly.
 */
const SPRAY_BURST = Object.freeze({
    swell: Object.freeze({ height: 12, length: 2.4, bow: 0 }),
    tower: Object.freeze({ height: 55, length: 4.5, bow: 0.9 }),
    /** How many may stand at once (a tower and a quick run of drops on top of it). */
    most: 16,
});
/**
 * The Far Gate's spillway (a perfect clear): its life (s of fall: it breaks, goes to mist, and how
 * much is drawn), and how much faster than its water it unrolls.
 */
const SPILLWAY = Object.freeze({
    breakAt: 11, mistAt: 17, duration: 24, unroll: 2.2,
});
/** Columns across the frame the falls' lower edge is kept in (fallEdge). */
const FALL_EDGE_BINS = 64;
/**
 * How much of the frame the spray may cover (screens: every puff's quad summed, the overdraw) for
 * a capacity: a tier with more puffs makes finer ones, never a heavier fill, and a layout that
 * brings the plume near (a phone, two boards) thins and shrinks its puffs to fit.
 */
export const sprayFill = (capacity) => 0.5 + capacity / 1100;

/** How the eye breathes at rest (degrees, seconds) and the bob (metres, seconds). */
const BREATH = Object.freeze({
    yaw: 0.15, yawPeriod: 47, pitch: 0.1, pitchPeriod: 61, bob: 0.4, bobPeriod: 9,
});
/** Pointer parallax (degrees per unit of pointer). */
const PARALLAX = Object.freeze({ yaw: 0.8, pitch: 0.4 });

/** Each piece's cells in its spawn orientation (centred, y up) for locks that carry no cells. */
const SPAWN_CELLS = Object.freeze({
    I: [-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0],
    O: [-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5],
    T: [-1, -0.5, 0, -0.5, 1, -0.5, 0, 0.5],
    S: [0, 0.5, 1, 0.5, -1, -0.5, 0, -0.5],
    Z: [-1, 0.5, 0, 0.5, 0, -0.5, 1, -0.5],
    J: [-1, 0.5, -1, -0.5, 0, -0.5, 1, -0.5],
    L: [1, 0.5, -1, -0.5, 0, -0.5, 1, -0.5],
});

/** A clear's accent for its k-th line: two lines take the warm second, three alternate. */
function lineAccent(lines, k, accentA, accentB) {
    if (lines === 3) return k % 2 ? accentB : accentA;
    return lines === 2 ? accentB : accentA;
}

const frac = (x) => x - Math.floor(x);
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);

function createUniforms() {
    const rows = uniformArray(COLOUR_ROWS.map(() => new THREE.Vector4(0, 0, 0, 1)), 'vec4');
    const U = {
        rows,
        light: createLight(rows),
        time: uniform(0),
        key: uniform(new THREE.Vector3(0, 0.25, 0.97).normalize()),
        A: uniform(new THREE.Vector3(0, -0.25, -0.97).normalize()),
        bowDown: uniform(new THREE.Vector3(0, -1, 0)),
        bowRight: uniform(new THREE.Vector3(1, 0, 0)),
        /** R1, R2, Rfog (radians), dial (0..13, eased). */
        bow: uniform(new THREE.Vector4(42 * DEG, 51 * DEG, 39 * DEG, 0)),
        /** The storm wall: centre bearing, half width, base elevation, the core's height (rad). */
        shower: uniform(new THREE.Vector4(-0.3, 0.26, 0.17, 0.2)),
        showerAmt: uniform(0.85),
        /**
         * The sky's calm zones, seen through the frame's own camera: its rows (screen units of the
         * frame's height, y down, centred) and two boxes (centre, half size): the cards' union and
         * the HUD. A negative half size is no box.
         */
        calmView: uniform(new THREE.Matrix3()),
        calmA: uniform(new THREE.Vector4(0, 0, -1, -1)),
        calmB: uniform(new THREE.Vector4(0, 0, -1, -1)),
        /** The sky's own numbers from the hour: the anticrepuscular rays' depth, the cirrus' cover. */
        rays: uniform(0),
        cirrus: uniform(0),
        /**
         * The Far Gate's hull in the sky (centre bearing, half width, top elevation: radians; w 1
         * when placed): the altocumulus deck keeps clear of it, so the gate stands on open sky.
         */
        gateSky: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The light the forms are shaded in: the key turned by the hour (U.key stays −A). */
        shadeKey: uniform(new THREE.Vector3(0, 0.26, 0.97)),
        /** The Earth's shadow's terminator: A's level direction (xz), its rise, its height at the eye (m). */
        termLine: uniform(new THREE.Vector4(0, -1, 0, 0)),
        /** The widest free band of sky the altocumulus deck could lie in (frame widths): under
         * about a tenth it is not drawn at all (a deck squeezed to a cell reads as a sticker). */
        deckRoom: uniform(1),
        /**
         * 12 × (phi0, phi1, progress, fade), then 12 × (the link's r, g, b, its tint 0..1), then
         * 12 × the painted part's ends (start centre, start half width, end centre, end half
         * width: radians along the stroke from phi0).
         */
        strokes: uniformArray(Array.from({ length: STROKES * 3 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
        /** The brush's head: φ, which bow (0, 1), strength, the way it paints (±1); its colour. */
        bowHead: uniform(new THREE.Vector4(0, 0, 0, 1)),
        bowHeadColour: uniform(new THREE.Vector4(1, 1, 1, 0)),
        /** The Mother Fall's spray against the Deep: bearing, half width, top, bottom elevation (rad). */
        sprayColumn: uniform(new THREE.Vector4(0, 0.05, -0.2, -0.6)),
        /**
         * How much of the chain's drops hang under the horizon: far down, and just under it (the
         * leg plan thins them toward the near Deep; the smile, all of it under the horizon, keeps them).
         */
        bowDeep: uniform(new THREE.Vector2(0.35, 0.7)),
        /** Glory: strength, reveal radius (deg), opposition boost, the opposition glow at rest. */
        glory: uniform(new THREE.Vector4(0, 0, 0, 1)),
        /** 12 × (pos.xyz, radius) (rgb, strength): held pools lighting the stone. */
        lamps: uniformArray(Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
        /** 8 × (a.xyz, radius) (b.xyz, weight). */
        casters: uniformArray(Array.from({ length: CASTERS * 2 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
        falls: createFallTable(),
        packets: createPacketTable(),
        /** x packets alive, y, z, w unused. */
        counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** x the falls' rate, y their width (the hush thins them, the pour swells them). */
        flow: uniform(new THREE.Vector2(1, 1)),
        /** The bell's toll through every pool: x time it rang, y strength. */
        toll: uniform(new THREE.Vector2(-1e4, 0)),
        /** The T-spin's wring: x water clock it began, y its strength. */
        wring: uniform(new THREE.Vector2(-1e4, 0)),
        /** Radians per buffer pixel (things that must stay a few pixels across). */
        pixelAngle: uniform(0.001),
        drift: uniform(new THREE.Vector2(0, 0)),
        mistClock: uniform(0),
        waterClock: uniform(0),
        sprayClock: uniform(0),
        starTurn: uniform(0),
    };
    SCALAR_UNIFORMS.forEach((name) => { U[name] = uniform(0); });
    return U;
}

export class SkyChildrenWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]  deterministic capture (the eye does not breathe)
     * @param {number} [p.seed=33]
     * @param {number|null} [p.hour]       pin the wheel at a place (playground)
     * @param {object|null} [p.tune]       TUNE overrides (playground)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 33, hour = null, tune: overrides = null,
    } = {}) {
        tune(overrides);
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.U = createUniforms();
        this.root = new THREE.Group();
        this.root.name = 'sky-children-world';
        this.parts = {};
        this.textures = [];
        this.built = false;

        this.time = 0;
        this.flightClock = 0;
        this.wheel = new HourWheel();
        if (Number.isFinite(hour)) this.wheel.pin(hour);
        this.hour = hourAt(0, {});

        this.aspect = 16 / 9;
        this.viewport = { width: 1600, height: 900 };
        this.layout = null;
        this.frame = frameFor(this.aspect, null, {});
        this.placement = placePlan(this.frame, {});
        this.reduced = false;
        this.dip = { x: 0, v: 0 };

        // The chain.
        this.combo = 0;
        this.dial = 0;
        this.dialTarget = 0;
        this.links = Array.from({ length: STROKES }, () => [1, 1, 1]);
        this.linkShapes = new Array(STROKES).fill(null);
        this.lastLock = new Map(); // player → { rgb, shape }
        this.b2b = false;
        this.graceUntil = -1e4;
        this.bowFlashUntil = -1e4;
        this.trueBowAt = -1e4;
        /** The brush's head: where it last painted and when (the glint lingers a moment). */
        this.head = {
            phi: 0, bow: 0, sense: 1, rgb: [1, 1, 1], at: -1e4, dial: 0,
        };
        /** When each stroke was last laid whole (it glitters a moment), and when each bow closed. */
        this.laidAt = new Float64Array(STROKES).fill(-1e4);
        this.laid = new Float64Array(STROKES);
        this.closedAt = [-1e4, -1e4];

        // The set pieces.
        /** Every flare asks first (WCAG 2.3.1: at most 3 onsets a second, a luminance allowance). */
        this.flashes = new FlashGovernor();
        this.hush = {
            at: -1e4, length: HUSH, rings: 0, perfect: false,
        };
        this.pourAt = -1e4;
        this.spillwayAt = -1e4;
        this.burstAt = -1e4;
        this.spanAt = -1e4;
        this.oppRest = 1;

        // What the pools hold (index = pool slot).
        this.poolSlots = [];
        this.held = [];
        /** How many packet slots have ever been written since the last seek (the shader's loop). */
        this.packetUsed = 0;
        this.fallCpu = [];

        this.post = {
            flash: 0,
            iris: 1,
            bloomBoost: 0,
            glow: 0,
            exposure: 1,
            hush: 0,
            gradeShadow: [0.93, 0.98, 1.09],
            gradeLight: [1.05, 1.01, 0.94],
            flare: [0.5, 0.5, 0.2, 0],
            flareTint: [1, 0.95, 0.85],
        };
        this.scratch = {
            a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], rgb: [0, 0, 0], p: { x: 0, y: 0, front: false },
        };
        this.trails = null;
    }

    /** Bake, build every part, add them to the scene. Returns this. */
    build() {
        const { tier, U } = this;
        const noise = createNoiseTexture(bakeSkyNoise(tier.skyNoise, this.seed), tier.skyNoise, 'sky-children-sky-noise');
        const stone = createNoiseTexture(bakeStoneNoise(tier.stoneNoise, this.seed + 1), tier.stoneNoise, 'sky-children-stone-noise');
        const lut = createLutTexture(bakeOpticsLut(tier.lutWidth), tier.lutWidth);
        const puff = createSpriteTexture(bakePuff(128), 128, 'sky-children-puff');
        const seaSize = tier.seaField ?? 256;
        const sea = createFieldTexture(bakeSeaField(seaSize, this.seed + 3), seaSize, 'sky-children-sea-field');
        this.textures.push(noise, stone, lut, puff, sea);
        this.tex = {
            noise, stone, lut, puff, sea,
        };

        this.parts.sky = createSky({ tier, U, tex: this.tex });
        this.root.add(this.parts.sky.mesh);
        this.parts.sea = createSea({ tier, U, tex: this.tex });
        this.root.add(this.parts.sea.mesh);
        this.parts.cumulus = createCumulus({ tier, U, tex: this.tex });
        this.root.add(this.parts.cumulus.mesh);
        this.parts.isles = createIsles({
            plan: PLAN, tier, U, tex: this.tex,
        });
        this.parts.isles.meshes.forEach((m) => this.root.add(m));
        this.parts.pools = createPools({ capacity: tier.pools, U, tex: this.tex });
        this.root.add(this.parts.pools.mesh);
        this.held = Array.from({ length: tier.pools }, () => ({
            at: -1e4, rgb: [1, 1, 1], released: true, releasedAt: -1e4, silent: false,
        }));
        this.flock = new GliderFlock(tier.gliders, this.seed);
        this.parts.gliders = createGliders({ capacity: tier.gliders, U });
        this.root.add(this.parts.gliders.mesh);
        for (let i = 0; i < FALL_SLOTS; i++) clearFall(U.falls, i);
        this.parts.falls = createFalls({ tier, U, tex: this.tex });
        this.root.add(this.parts.falls.mesh);
        this.parts.spray = createSpray({ capacity: tier.spray, U, tex: this.tex });
        this.parts.spray.meshes = [this.parts.spray.mesh];
        this.root.add(this.parts.spray.mesh);
        const glows = createGlows({ capacity: tier.glows, U });
        this.parts.fx = { glows, mesh: glows.mesh, dispose: () => glows.dispose() };
        this.root.add(glows.mesh);
        this.effects = new EventEffects({
            threads: tier.threads, droplets: tier.droplets, crowns: 16, sheets: 48,
        });
        this.trails = Array.from({ length: tier.gliders }, () => ({
            pts: new Float32Array(tier.trailSamples * 3), n: 0, head: 0,
        }));

        this.scene.add(this.root);
        this.applyFrame();
        this.applyHour(0);
        this.built = true;
        return this;
    }

    bindCamera(camera) {
        this.camera = camera;
        camera.near = REST_RIG.near;
        camera.far = REST_RIG.far;
        camera.fov = this.frame.vfov;
        camera.updateProjectionMatrix();
    }

    /** Draw only the named parts (capture flag). */
    showOnlyParts(names) {
        const keep = new Set(names || SKY_CHILDREN_PARTS);
        Object.entries(this.parts).forEach(([name, part]) => {
            const on = keep.has(name);
            (part.meshes || [part.mesh]).forEach((m) => { if (m) m.visible = on; });
        });
    }

    setViewport(width, height, aspect) {
        this.viewport.width = width;
        this.viewport.height = height;
        const a = Number.isFinite(aspect) && aspect > 0 ? aspect : width / Math.max(1, height);
        this.aspect = a;
        this.applyFrame();
    }

    /** The live layout rects (screen fractions) or null (menus, boot): the frame is re-solved. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        this.applyFrame();
    }

    setReducedMotion(on) {
        this.reduced = Boolean(on);
        this.flashes.setReducedMotion(this.reduced);
    }

    /** Solve the frame and write everything that follows from it. */
    applyFrame() {
        const f = frameFor(this.aspect, this.layout, this.frame);
        const { U } = this;
        U.A.value.set(f.A[0], f.A[1], f.A[2]);
        U.key.value.set(-f.A[0], -f.A[1], -f.A[2]);
        U.bowDown.value.set(f.basis.down[0], f.basis.down[1], f.basis.down[2]);
        U.bowRight.value.set(f.basis.right[0], f.basis.right[1], f.basis.right[2]);
        U.bow.value.x = f.R1;
        U.bow.value.y = f.R2;
        U.bow.value.z = f.Rfog;
        // In a smile frame A sits just under the card: its glow at rest is halved there.
        this.oppRest = f.plan === 'smile' ? 0.45 : 1;
        U.glory.value.w = this.oppRest;
        // The storm wall stands behind the bow's leg, its dark core between the Mother Fall and the
        // card (the bow and the white falls burn against it), its heart rising past the tower's
        // crown, its flank behind the Spring Isle lifted to a lit veil; the world's cumulus tower in
        // front of it is the storm's crown. Its heart never hides behind the card. A smile frame
        // shows only a strip of sky: there the storm stands small beside the Spring Isle (frame
        // x 0.1), its top under the frame's edge, its rain a narrow veil.
        const smile = f.plan === 'smile';
        const bearingAt = (x, y) => {
            const d = unproject(x, y, f.cam, [0, 0, -1]);
            return { bearing: Math.atan2(d[0], -d[2]), el: Math.asin(Math.max(-1, Math.min(1, d[1]))) };
        };
        if (smile) {
            // (Its body would only be a slab on the top edge: the rain falls from above the frame.)
            U.shower.value.x = bearingAt(0.1, f.horizon).bearing;
            U.shower.value.y = 0.12;
            U.shower.value.z = Math.max(0.01, bearingAt(0.1, 0.01).el);
            U.shower.value.w = 0;
        } else {
            const foot = bearingAt(Math.min(0.9, Math.max(0.05, f.foot.x)), f.horizon).bearing;
            const card = bearingAt(f.free?.left ?? 0.4, f.horizon).bearing;
            U.shower.value.x = Math.min(foot + 3 * DEG, card - 0.3 * 0.4);
            U.shower.value.y = 0.3;
            U.shower.value.z = 0.06;
            U.shower.value.w = 0.26;
        }
        this.showerScale = smile ? 0.4 : 1;
        U.showerAmt.value = (this.showerHour ?? 0.85) * this.showerScale;
        this.parts.cumulus?.place(f, U.shower.value.x);
        this.writeCalm(f);
        U.bowDeep.value.set(f.plan === 'smile' ? 0.9 : 0.35, f.plan === 'smile' ? 0.9 : 0.7);
        if (this.camera) {
            this.camera.fov = f.vfov;
            this.camera.updateProjectionMatrix();
        }
        U.pixelAngle.value = (f.vfov * DEG) / Math.max(1, this.viewport.height);
        placePlan(f, this.placement);
        // ── The sky's own: the Far Gate's hull as the dome sees it ──
        {
            const g = this.placement.gate;
            const p = PLAN.gate;
            if (g) {
                const dist = Math.hypot(g.pos[0], g.pos[2]) || p.dist;
                U.gateSky.value.set(
                    g.bearing,
                    Math.atan((p.width * g.scale) / 2 / dist),
                    Math.atan((g.pos[1] + (p.height - p.sink) * g.scale) / dist),
                    1,
                );
            } else {
                U.gateSky.value.set(0, 0, 0, 0);
            }
            U.deckRoom.value = this.deckRoom(f);
        }
        if (this.parts.isles) this.parts.isles.place(this.placement);
        // The strokes are cut again round what stands in front of the bows, now it is placed: no
        // link paints an arc the player cannot see (once per solve: the same screen and rects keep
        // the solve, its plan and its cut).
        if (this.cutFor !== f.solvedFor || !f.solvedFor) {
            recutStrokes(f, this.layout, this.bowHides(f));
            this.cutFor = f.solvedFor;
        }
        const rows = U.strokes.array;
        for (let i = 0; i < STROKES; i++) {
            const s = i < 7 ? f.strokes1[i] : f.strokes2[i - 7];
            rows[i].x = s ? s.phi0 : 0;
            rows[i].y = s ? s.phi1 : 0;
        }
        if (this.parts.falls) this.writeStaticFalls();
        this.placeSprayColumn();
        if (this.parts.pools && this.parts.isles) this.placePools();
        this.flock?.setThermals(this.placement.thermals);
        this.bowInfo = {
            A: f.A, basis: f.basis, R1: f.R1, R2: f.R2, strokes: [...f.strokes1, ...f.strokes2], dial: 0, links: this.links,
        };
    }

    /**
     * What stands in front of the bows on screen, for the stroke cut (frame.js recutStrokes): the
     * Spring Isle and the overlook's parapet (each its outline from its own vertices, as placed),
     * and the congestus tower behind the isle (its sunlit cloud shows no bow). Frame polygons.
     */
    bowHides(f) {
        const hides = [];
        const meshes = this.parts.isles?.meshes || [];
        const p = { x: 0, y: 0, front: false };
        const d = [0, 0, 0];
        for (const name of ['sky-children-spring', 'sky-children-cornerL', 'sky-children-cornerR']) {
            const mesh = meshes.find((m) => m.name === name);
            const pos = mesh?.geometry?.attributes?.position;
            if (!pos) continue;
            const e = mesh.matrixWorld.elements;
            const step = Math.max(1, Math.floor(pos.count / 1500));
            const pts = [];
            for (let v = 0; v < pos.count; v += step) {
                const x = pos.getX(v);
                const y = pos.getY(v);
                const z = pos.getZ(v);
                d[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
                d[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
                d[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
                const l = Math.hypot(d[0], d[1], d[2]) || 1;
                d[0] /= l; d[1] /= l; d[2] /= l;
                project(d, f.cam, p);
                if (p.front) pts.push([p.x, p.y]);
            }
            const hull = hullOf(pts, 0.03);
            if (hull) hides.push(hull);
        }
        // The tower: wide at its base, narrowing to its crown (cumulus.js builds it so).
        const tower = cumulusPlan(f, this.U.shower.value.x).find((c) => c.kind === 0);
        if (tower) {
            const len = Math.hypot(tower.x, tower.z) || 1;
            const ax = -tower.z / len;
            const az = tower.x / len;
            const pts = [];
            for (const [h, half] of [[0.05, 0.3], [0.45, 0.27], [0.85, 0.2], [1.0, 0.1]]) {
                for (const side of [-1, 1]) {
                    const u = side * half * tower.W;
                    d[0] = tower.x + ax * u; d[1] = tower.y + h * tower.H; d[2] = tower.z + az * u;
                    const l = Math.hypot(d[0], d[1], d[2]) || 1;
                    d[0] /= l; d[1] /= l; d[2] /= l;
                    project(d, f.cam, p);
                    if (p.front) pts.push([p.x, p.y]);
                }
            }
            const hull = hullOf(pts, 0.08);
            if (hull) hides.push(hull);
        }
        return hides;
    }

    /**
     * The Mother Fall's spray as the Deep sees it (U.sprayColumn): the bearing of its lower half, the
     * half width its skirt of spray spreads to at that distance, and the elevations it hangs
     * between (from half way down the fall, where the spray begins, to below its foot). The bow
     * stands in it at rest, the real drops under the horizon.
     */
    placeSprayColumn() {
        const fall = this.fallCpu[SLOT.mother];
        const v = this.U.sprayColumn.value;
        if (!fall) {
            v.set(0, 0.05, -2, -2);
            return;
        }
        const top = fallPoint(fall, 0.45 * fall.duration, this.scratch.a);
        const foot = fallPoint(fall, fall.duration, this.scratch.b);
        const mid = [(top[0] + foot[0]) / 2, (top[2] + foot[2]) / 2];
        const across = Math.hypot(mid[0], mid[1]);
        const elevation = (p) => Math.atan2(p[1], Math.hypot(p[0], p[2]));
        v.set(
            Math.atan2(mid[0], -mid[1]),
            (fall.width * 0.5 + 40) / Math.max(across, 1),
            elevation(top),
            elevation(foot) - 0.03,
        );
    }

    /**
     * Where the Mother Fall leaves the Spring Isle's lowest lip: its right shoulder, toward the
     * bow's leg; in a smile frame its outer (left) shoulder, where the margin can show it.
     */
    motherBearing() {
        if (Number.isFinite(this.motherTh)) return this.motherTh;
        return this.frame?.plan === 'smile' ? -MOTHER_BEARING : MOTHER_BEARING;
    }

    /**
     * The sky's calm zones from the live layout (none without one): the frame camera's rows and
     * the boxes of the cards' union and the HUD, in units of the frame's height round its centre.
     */
    writeCalm(f) {
        const { U } = this;
        const { r, u, f: fw } = f.cam.basis;
        const k = 0.5 / f.cam.tanY;
        U.calmView.value.set(
            r[0] * k,
            r[1] * k,
            r[2] * k,
            -u[0] * k,
            -u[1] * k,
            -u[2] * k,
            fw[0],
            fw[1],
            fw[2],
        );
        const cards = this.layout?.cards || [];
        const box = (rect, out) => {
            if (!rect) {
                out.set(0, 0, -1, -1);
                return;
            }
            const a = f.cam.aspect;
            out.set(((rect.x0 + rect.x1) / 2 - 0.5) * a, (rect.y0 + rect.y1) / 2 - 0.5, ((rect.x1 - rect.x0) / 2) * a, (rect.y1 - rect.y0) / 2);
        };
        const union = cards.length ? cards.reduce((acc, c) => ({
            x0: Math.min(acc.x0, c.x0), y0: Math.min(acc.y0, c.y0), x1: Math.max(acc.x1, c.x1), y1: Math.max(acc.y1, c.y1),
        }), {
            x0: 1, y0: 1, x1: 0, y1: 0,
        }) : null;
        box(union, U.calmA.value);
        box(this.layout?.hud || null, U.calmB.value);
    }

    /** Where a world direction lands on screen (fractions, y down), through the solved camera. */
    screenOf(dir, out = { x: 0, y: 0, front: false }) {
        return project(dir, this.frame.cam, out);
    }

    /** The world point `depth` metres out through a frame point. */
    worldAt(x, y, depth, out = [0, 0, 0]) {
        unproject(x, y, this.frame.cam, out);
        out[0] *= depth;
        out[1] *= depth;
        out[2] *= depth;
        return out;
    }

    /** A point in an isle's local space, in the world (as the placement turned and moved it). */
    isleToWorld(name, x, y, z, out = [0, 0, 0]) {
        return entryToWorld(this.placement[name], x, y, z, out);
    }

    /** A local horizontal direction (dx, dz) turned into the world. */
    isleDir(name, dx, dz, out = [0, 0]) {
        const e = this.placement[name];
        const c = Math.cos(e.yaw);
        const sn = Math.sin(e.yaw);
        out[0] = c * dx + sn * dz;
        out[1] = -sn * dx + c * dz;
        return out;
    }

    /**
     * The pools the isles hold, by screen side and height, as many as the tier draws: the basins in
     * the corners first, then the terraces from the lowest (nearest the eye's level) up.
     */
    placePools() {
        const { pools } = this.parts;
        const all = this.parts.isles.pools;
        const scr = { x: 0, y: 0, front: false };
        const layout = this.layout || nominalLayout(this.aspect);
        const rects = [...(layout.cards || []), ...(layout.hud ? [layout.hud] : [])];
        // Where each pool lands on screen, and whether a lock's thread could be seen landing there
        // (on screen, outside every card and the HUD).
        const seen = all.map((q) => {
            const d = Math.hypot(q.world[0], q.world[1], q.world[2]) || 1;
            this.screenOf([q.world[0] / d, q.world[1] / d, q.world[2] / d], scr);
            const on = scr.front && scr.x > 0.01 && scr.x < 0.99 && scr.y > 0.01 && scr.y < 0.99;
            const hidden = rects.some((r) => scr.x > r.x0 - 0.01 && scr.x < r.x1 + 0.01 && scr.y > r.y0 - 0.01 && scr.y < r.y1 + 0.01);
            return {
                q, x: scr.x, y: scr.y, visible: on && !hidden,
            };
        });
        // Visible first; within each, the lowest terraces first; the isles share the slots by
        // their pool counts (round-robin weighted), so a small tier still has pools on both sides.
        const byIsle = new Map();
        seen.forEach((s) => {
            if (!byIsle.has(s.q.isle)) byIsle.set(s.q.isle, []);
            byIsle.get(s.q.isle).push(s);
        });
        byIsle.forEach((list) => list.sort((a, b) => (Number(b.visible) - Number(a.visible)) || (b.q.level - a.q.level)));
        const queues = [...byIsle.values()];
        const total = all.length || 1;
        const order = [];
        const taken = queues.map(() => 0);
        while (order.length < all.length) {
            // The isle furthest behind its share goes next.
            let pick = -1;
            let lag = -Infinity;
            queues.forEach((list, k) => {
                if (taken[k] >= list.length) return;
                const owed = ((order.length + 1) * list.length) / total - taken[k];
                if (owed > lag) { lag = owed; pick = k; }
            });
            if (pick < 0) break;
            order.push(queues[pick][taken[pick]]);
            taken[pick] += 1;
        }
        order.sort((a, b) => Number(b.visible) - Number(a.visible));
        // Where enough pools can be seen (a phone hides half an isle), only those are handed out.
        const visible = order.filter((o) => o.visible).length;
        if (visible >= Math.min(4, order.length)) order.length = visible;
        this.poolSlots.length = 0;
        const n = Math.min(pools.capacity, order.length);
        for (let k = 0; k < n; k++) {
            const { q, x, y } = order[k];
            const e = this.placement[q.isle];
            pools.set(k, q.world, q.radius * (e?.scale ?? 1), k, e?.pitch ?? 0.21);
            this.poolSlots.push({
                slot: k,
                isle: q.isle,
                level: q.level,
                world: q.world,
                x,
                y,
                visible: order[k].visible,
                fall: q.isle === 'spring' ? SLOT.mother : SLOT.span,
            });
        }
    }

    /**
     * The frame's lower edge as the falls see it (frame y across FALL_EDGE_BINS + 1 columns): 1,
     * raised wherever the overlook's parapet stands in front, so a fall that pours behind it tells
     * its life above it. Each edge of the parapet's triangles is walked across the columns it
     * spans (a long rail has vertices only at its ends).
     */
    fallEdge() {
        const bins = this.fallEdgeBins ?? new Float32Array(FALL_EDGE_BINS + 1);
        this.fallEdgeBins = bins;
        bins.fill(1);
        const meshes = this.parts.isles?.meshes ?? [];
        const a = { x: 0, y: 0, front: false };
        const b = { x: 0, y: 0, front: false };
        const v = [0, 0, 0];
        const toScreen = (m, pos, i, out) => {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            v[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
            v[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
            v[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
            const d = Math.hypot(v[0], v[1], v[2]) || 1;
            v[0] /= d;
            v[1] /= d;
            v[2] /= d;
            return this.screenOf(v, out);
        };
        for (const mesh of meshes) {
            if (!/corner[LR]$/.test(mesh.name)) continue;
            const { geometry } = mesh;
            const pos = geometry.attributes.position;
            const index = geometry.index ? geometry.index.array : null;
            const tris = index ? index.length / 3 : pos.count / 3;
            const m = mesh.matrixWorld.elements;
            for (let k = 0; k < tris * 3; k++) {
                const i0 = index ? index[k] : k;
                const i1 = index ? index[k - (k % 3) + ((k + 1) % 3)] : k - (k % 3) + ((k + 1) % 3);
                if (!toScreen(m, pos, i0, a).front || !toScreen(m, pos, i1, b).front) continue;
                const c0 = Math.max(0, Math.ceil(Math.min(a.x, b.x) * FALL_EDGE_BINS));
                const c1 = Math.min(FALL_EDGE_BINS, Math.floor(Math.max(a.x, b.x) * FALL_EDGE_BINS));
                for (let c = c0; c <= c1; c++) {
                    const w = Math.abs(b.x - a.x) > 1e-9 ? (c / FALL_EDGE_BINS - a.x) / (b.x - a.x) : 0;
                    bins[c] = Math.min(bins[c], a.y + (b.y - a.y) * Math.min(1, Math.max(0, w)));
                }
            }
        }
        return bins;
    }

    /** The falls' lower edge (fallEdge) at a frame x. */
    edgeAt(x) {
        const bins = this.fallEdgeBins;
        if (!bins) return 1;
        const c = Math.min(FALL_EDGE_BINS, Math.max(0, x * FALL_EDGE_BINS));
        const i = Math.min(FALL_EDGE_BINS - 1, Math.floor(c));
        return Math.min(bins[i] + (bins[i + 1] - bins[i]) * (c - i), 1);
    }

    /**
     * When (seconds of fall) a fall's centre line crosses the frame's lower edge (or the parapet in
     * front of it, fallEdge) through the solved camera (14 halvings); `hi` if it is still on screen
     * then, or never was.
     */
    frameCrossing(fall, hi = 12) {
        const p = [0, 0, 0];
        const scr = { x: 0, y: 0, front: false };
        const plain = { lip: fall.lip, dir: fall.dir, v0: fall.v0 };
        const below = (t) => {
            fallPoint(plain, t, p);
            const d = Math.hypot(p[0], p[1], p[2]) || 1;
            p[0] /= d;
            p[1] /= d;
            p[2] /= d;
            this.screenOf(p, scr);
            return !scr.front || scr.y >= this.edgeAt(scr.x);
        };
        if (below(0) || !below(hi)) return hi;
        let lo = 0;
        let top = hi;
        for (let i = 0; i < 14; i++) {
            const mid = 0.5 * (lo + top);
            if (below(mid)) top = mid;
            else lo = mid;
        }
        return 0.5 * (lo + top);
    }

    /**
     * The Mother Fall's bearing on the Spring Isle's rim. In a landscape frame her right shoulder,
     * toward the bow's leg (MOTHER_BEARING), unless the frame hides her there; in a smile frame (a
     * phone, the isle half out of the frame) wherever on the front the frame shows most of her
     * outside the card and the HUD, the front face first.
     */
    solveMotherBearing() {
        const { outlets } = this.parts.isles;
        const smile = this.frame?.plan === 'smile';
        const prefer = smile ? 0 : MOTHER_BEARING;
        const layout = this.layout || nominalLayout(this.aspect);
        const rects = [...(layout.cards || []), ...(layout.hud ? [layout.hud] : [])];
        const p = [0, 0, 0];
        const scr = { x: 0, y: 0, front: false };
        const { r: right } = this.frame.cam.basis;
        /** Whether a world point is seen: in the frame, above the parapet, outside every card and the HUD. */
        const seenAt = (q, dx = 0, dz = 0) => {
            p[0] = q[0] + dx;
            p[1] = q[1];
            p[2] = q[2] + dz;
            const d = Math.hypot(p[0], p[1], p[2]) || 1;
            p[0] /= d;
            p[1] /= d;
            p[2] /= d;
            this.screenOf(p, scr);
            const on = scr.front && scr.x > 0.02 && scr.x < 0.98 && scr.y > 0 && scr.y < this.edgeAt(scr.x);
            const hidden = rects.some((r) => scr.x > r.x0 - 0.005 && scr.x < r.x1 + 0.005 && scr.y > r.y0 - 0.005 && scr.y < r.y1 + 0.005);
            return on && !hidden;
        };
        const q = [0, 0, 0];
        const score = (th) => {
            const o = outletAt(outlets.spring, th);
            const spec = { lip: this.isleToWorld('spring', o.x, o.y, o.z), dir: this.isleDir('spring', o.nx, o.nz), v0: MOTHER.v0 };
            let seen = 0;
            for (let k = 0; k <= 6; k++) if (seenAt(fallPoint(spec, k, q))) seen += 1;
            // Her plume, where the frame's edge cuts her and downwind of it, must be seen too (on
            // two boards it would otherwise boil up behind a card).
            fallPoint(spec, clamp(this.frameCrossing(spec), 2.5, 10) * 0.85, q);
            if (seenAt(q)) seen += 2;
            if (seenAt(q, right[0] * 25, right[2] * 25)) seen += 2;
            return seen - Math.abs(o.th - prefer) * (smile ? 1.5 : 4);
        };
        let best = prefer;
        let bestScore = score(prefer);
        if (!smile && bestScore >= 9) return best;
        outlets.spring.forEach((o) => {
            if (Math.abs(o.th) > 1.2) return;
            const sc = score(o.th);
            if (sc > bestScore + 1e-9) {
                best = o.th;
                bestScore = sc;
            }
        });
        return best;
    }

    /**
     * The falls that always pour: their lips follow the isles as a layout places them, and each
     * one's life is solved against the live frame (where its lower edge cuts the fall), so the
     * sheet breaks into horsetails and goes to mist on screen in every layout.
     */
    writeStaticFalls() {
        const { U } = this;
        const { isles } = this.parts;
        if (!isles) return;
        this.fallEdge();
        /** Write a fall whose life is told in shares of the drop the frame shows of it. */
        const put = (slot, spec, life = null, lo = 2.5, hi = 10) => {
            const fall = { ...spec, phase: slot * 1.7 };
            let schedule = {};
            if (life) {
                // The drop grows as t², so a share h of the visible drop is reached at tFrame·√h.
                const tFrame = clamp(this.frameCrossing(fall), lo, hi);
                fall.tFrame = tFrame;
                fall.duration = tFrame * life.tail;
                schedule = { breakAt: tFrame * Math.sqrt(life.breakH), mistAt: tFrame * Math.sqrt(life.mistH) };
            } else {
                fall.tFrame = fall.duration;
            }
            writeFall(U.falls, slot, { ...fall, ...schedule });
            this.fallCpu[slot] = {
                lip: fall.lip.slice(),
                dir: fall.dir.slice(),
                v0: fall.v0,
                duration: fall.duration,
                width: fall.width,
                spread: fall.spread ?? 0.6,
                kind: fall.kind,
                phase: fall.phase,
                tFrame: fall.tFrame,
                breakAt: schedule.breakAt ?? fall.breakAt,
                mistAt: schedule.mistAt ?? fall.mistAt,
            };
        };
        // The Mother Fall: off the Spring Isle's lowest lip on its right shoulder, past the root.
        this.motherTh = this.solveMotherBearing();
        const m = outletAt(isles.outlets.spring, this.motherTh);
        put(SLOT.mother, {
            lip: this.isleToWorld('spring', m.x, m.y, m.z),
            dir: this.isleDir('spring', m.nx, m.nz),
            v0: MOTHER.v0,
            width: MOTHER.width,
            spread: MOTHER.spread,
            flow: 1,
            kind: FALL_KIND.sheet,
            lipT: MOTHER.lipT,
            form: MOTHER.form,
        }, MOTHER);
        // Which of her edges is open to the sky (the other lies over the isle's root): her veil keeps to it.
        this.fallCpu[SLOT.mother].open = this.openSide(this.fallCpu[SLOT.mother], this.isleToWorld('spring', 0, m.y, 0));
        // The broken span's fall, from the aqueduct's break toward the card: a narrow curtain.
        const sl = isles.anchors.spanLip;
        put(SLOT.span, {
            lip: this.isleToWorld('twin', sl.x, sl.y, sl.z),
            dir: this.isleDir('twin', -0.8, 0.6),
            v0: SPAN.v0,
            width: SPAN.width,
            spread: SPAN.spread,
            flow: 1,
            kind: FALL_KIND.sheet,
            lipT: SPAN.lipT,
            form: SPAN.form,
        }, SPAN, 2.5, SPAN.most);
        // The Twin Isle's horsetails, off its lowest lip: threads that fan into strands.
        [-0.45, 0.05, 0.5].slice(0, HORSETAILS).forEach((th, i) => {
            const o = outletAt(isles.outlets.twin, th);
            put(SLOT.horse + i, {
                lip: this.isleToWorld('twin', o.x, o.y, o.z),
                dir: this.isleDir('twin', o.nx, o.nz),
                v0: HORSE.v0[i],
                width: 1.3 + (i % 2) * 0.7,
                spread: HORSE.spread,
                flow: 1,
                kind: FALL_KIND.horsetail,
            }, HORSE, 2.5, HORSE.most);
        });
        // Hairlines off the archipelago's nearest isles (every third is on its nearest layer).
        const hairs = Math.min(HAIRLINES, this.tier.hairlineFalls);
        for (let i = 0; i < HAIRLINES; i++) {
            const e = this.placement.archipelago?.[i * 3];
            if (i >= hairs || !e) {
                clearFall(U.falls, SLOT.hair + i);
                this.fallCpu[SLOT.hair + i] = undefined;
                continue;
            }
            const r = e.scale * 200;
            put(SLOT.hair + i, {
                lip: [e.pos[0] + Math.sin(e.bearing) * r * 0.3, e.pos[1] - e.scale * 20, e.pos[2] + Math.cos(e.bearing) * r * 0.3],
                dir: [-Math.sin(e.bearing), Math.cos(e.bearing)],
                v0: 1,
                width: 3 + e.scale * 12,
                spread: 0.6,
                duration: 9,
                breakAt: 3,
                mistAt: 7,
                flow: 1,
                kind: FALL_KIND.hairline,
            });
        }
        this.fitSpray();
    }

    /**
     * Which way along a fall's lip (+1 its tangent, left of its heading; −1 the other) the frame
     * shows open sky beside it rather than its isle (`axis`, the isle's axis at the lip's height).
     */
    openSide(fall, axis) {
        const scr = this.scratch.p;
        const p = [0, 0, 0];
        const at = (q) => {
            const d = Math.hypot(q[0], q[1], q[2]) || 1;
            p[0] = q[0] / d;
            p[1] = q[1] / d;
            p[2] = q[2] / d;
            return this.screenOf(p, scr).x;
        };
        const [dx, dz] = fall.dir;
        const [lx, ly, lz] = fall.lip;
        const ax = at(axis);
        const left = at([lx + dz * 20, ly, lz - dx * 20]);
        const right = at([lx - dz * 20, ly, lz + dx * 20]);
        return Math.abs(left - ax) >= Math.abs(right - ax) ? 1 : -1;
    }

    /**
     * Put the world at a moment: no event has happened yet, except the run's turn of the wheel
     * when a rebuild carries one over (`hours`, a HourWheel snapshot at the same clock).
     * @param {number} time
     * @param {{hours?: object|null}} [options]
     */
    seek(time, { hours = null } = {}) {
        this.time = time;
        this.flightClock = time;
        this.combo = 0;
        this.dial = 0;
        this.dialTarget = 0;
        this.dip.x = 0;
        this.dip.v = 0;
        this.b2b = false;
        this.graceUntil = -1e4;
        this.bowFlashUntil = -1e4;
        this.head.at = -1e4;
        this.head.dial = 0;
        this.laidAt.fill(-1e4);
        this.laid.fill(0);
        this.closedAt[0] = -1e4;
        this.closedAt[1] = -1e4;
        this.hush.at = -1e4;
        this.pourAt = -1e4;
        this.spillwayAt = -1e4;
        this.burstAt = -1e4;
        this.spanAt = -1e4;
        if (this.flock) {
            this.flock.longWing = false;
            this.flock.helixAt = -1e4;
            this.flock.launchAt = -1e4;
            this.flock.bankFlash = -1e4;
        }
        this.pourDone = false;
        this.wheel.reset?.(time);
        if (hours) this.wheel.restore?.(hours);
        const { U } = this;
        U.waterClock.value = time;
        U.sprayClock.value = time;
        U.mistClock.value = time;
        U.glory.value.set(0, 0, 0, this.oppRest);
        U.toll.value.set(-1e4, 0);
        U.wring.value.set(-1e4, 0);
        U.counts.value.x = 0;
        this.packetUsed = 0;
        U.packets.array.forEach((row, k) => row.set(k % 2 ? 0 : -1, 0, 0, 0));
        this.effects?.reset();
        this.flashes.reset();
        this.held.forEach((h) => { h.at = -1e4; h.released = true; });
        this.parts.pools?.clearAll();
        if (this.parts.falls) clearFall(U.falls, SLOT.spillway);
        this.trails?.forEach((t) => { t.n = 0; t.head = 0; });
        this.integrate(0);
        this.applyHour(time);
        this.writeStrokes();
    }

    resetSession() {
        this.wheel.newRun?.(this.time);
        this.onCombo(0);
        this.b2b = false;
        if (this.flock) this.flock.longWing = false;
        // Held pools drain softly.
        this.held.forEach((h, i) => {
            if (!h.released) {
                h.released = true;
                h.releasedAt = this.time;
                this.parts.pools?.release(i, this.time);
            }
        });
    }

    onGameOver() {
        this.onCombo(0);
        this.graceUntil = -1e4;
    }

    restCamera() {
        this.dip.x = 0;
        this.dip.v = 0;
    }

    updateCamera(camera, sim) {
        this.time = sim.time;
        const f = this.frame;
        const still = this.reduced || this.capture;
        const t = sim.time;
        const breatheYaw = still ? 0 : Math.sin((t / BREATH.yawPeriod) * 2 * Math.PI) * BREATH.yaw;
        const breathePitch = still ? 0 : Math.sin((t / BREATH.pitchPeriod) * 2 * Math.PI + 1.3) * BREATH.pitch;
        const bob = still ? 0 : Math.sin((t / BREATH.bobPeriod) * 2 * Math.PI) * BREATH.bob;
        const px = this.reduced ? 0 : clamp(sim.pointerX ?? 0, -1, 1);
        const py = this.reduced ? 0 : clamp(sim.pointerY ?? 0, -1, 1);
        // The hard drop's dip: a critically damped spring on the pitch.
        const dt = Math.max(0, sim.delta ?? 0);
        if (dt > 0) {
            const w = 9;
            const a = -w * w * this.dip.x - 2 * w * this.dip.v;
            this.dip.v += a * dt;
            this.dip.x += this.dip.v * dt;
        }
        const yaw = (breatheYaw + px * PARALLAX.yaw) * DEG;
        const pitch = f.pitch + (breathePitch - py * PARALLAX.pitch - this.dip.x) * DEG;
        camera.position.set(0, bob, 0);
        camera.rotation.set(pitch, -yaw, 0, 'YXZ');
        if (Math.abs(camera.fov - f.vfov) > 1e-6) {
            camera.fov = f.vfov;
            camera.updateProjectionMatrix();
        }
        // The shared breath (shared/camera-breath.js) on top of the breathing above, after the
        // lens is set (it reads the fov): the view only turns, and holds still when that does.
        applyCameraBreath(camera, t, { scale: still ? 0 : 1 });
        camera.updateMatrixWorld();
    }

    // ── What the pools hold ──

    /** A pool on `side` ('left' | 'right') for a lock at frame height y: unlit near y first. */
    choosePool(side, y, below = false) {
        let best = -1;
        let bestScore = Infinity;
        const cardMid = this.cardMid ?? 0.5;
        for (const p of this.poolSlots) {
            const onSide = side === 'left' ? p.x < cardMid : p.x >= cardMid;
            if (!onSide) continue;
            const h = this.held[p.slot];
            const lit = !h.released && this.time - h.at < 24;
            const age = lit ? this.time - h.at : 1e3;
            // A hard drop's light goes down: pools above the row cost more.
            const up = below && p.y < y ? 0.35 : 0;
            const score = Math.abs(p.y - y) + up + (lit ? 1 - Math.min(1, age / 24) + 0.3 : 0);
            if (score < bestScore) {
                bestScore = score;
                best = p.slot;
            }
        }
        if (best < 0 && this.poolSlots.length) best = this.poolSlots[0].slot;
        return best;
    }

    holdPool(slot, rgb, at, silent) {
        if (slot < 0 || !this.held[slot]) return;
        const h = this.held[slot];
        h.at = at;
        h.rgb[0] = rgb[0]; h.rgb[1] = rgb[1]; h.rgb[2] = rgb[2];
        h.released = false;
        h.silent = silent;
        this.parts.pools.hold(slot, rgb, at, silent);
    }

    /** Let the n oldest held colours go down the falls (Infinity: all of them). */
    releaseOldest(n, at, stagger = 0.4) {
        const live = [];
        this.held.forEach((h, slot) => { if (!h.released && at - h.at < 40) live.push(slot); });
        live.sort((a, b) => this.held[a].at - this.held[b].at);
        const count = Math.min(live.length, n);
        for (let k = 0; k < count; k++) {
            const slot = live[k];
            const h = this.held[slot];
            h.released = true;
            h.releasedAt = at;
            this.parts.pools.release(slot, at);
            const info = this.poolSlots.find((p) => p.slot === slot);
            const fall = info ? info.fall : SLOT.mother;
            // The colour runs down the terraces (0.4 s a hop), then rides the fall at water speed.
            const hops = info ? Math.max(1, (info.level ?? 0) + 1) : 1;
            // Spaced a band apart, so a great pour runs down as stripes of the held colours.
            this.packet(fall, this.U.waterClock.value + hops * stagger * 0.5 + k * 0.5, 0.35, 1.0, h.rgb, 0);
        }
        return count;
    }

    /**
     * A packet on a fall: colour ribbon (kind 0) or surge front (kind 1). It takes a free slot, or
     * one whose packet has run off the foot of its fall; failing that the oldest surge (a white
     * front is missed less than a colour), and only then the oldest ribbon.
     */
    packet(fall, bornWater, width, strength, rgb, kind) {
        const rows = this.U.packets.array;
        const water = this.U.waterClock.value;
        let free = -1;
        let surge = -1;
        let oldest = -1;
        for (let k = 0; k < PACKET_SLOTS; k++) {
            const a = rows[k * 2];
            const run = a.x >= 0 ? this.fallCpu[a.x]?.duration ?? 0 : -Infinity;
            if (water - a.y > run + 3 * a.z) {
                free = k;
                break;
            }
            if (rows[k * 2 + 1].w === 1 && (surge < 0 || a.y < rows[surge * 2].y)) surge = k;
            if (oldest < 0 || a.y < rows[oldest * 2].y) oldest = k;
        }
        let i = free;
        if (i < 0) i = surge >= 0 ? surge : oldest;
        rows[i * 2].set(fall, bornWater, width, strength);
        rows[i * 2 + 1].set(rgb[0], rgb[1], rgb[2], kind);
        this.packetUsed = Math.max(this.packetUsed, i + 1);
        this.U.counts.value.x = this.packetUsed;
    }

    // ── Events ──

    /** The card a board sits in, and its board, for a player. */
    cardOf(player = 0) {
        const board = this.layout ? boardFor(this.layout, player) : null;
        const cards = this.layout?.cards || [];
        let card = null;
        if (board) {
            for (const c of cards) {
                if (board.x0 >= c.x0 - 0.01 && board.x1 <= c.x1 + 0.01) card = c;
            }
        }
        if (!card) card = cards[0] || null;
        if (!card) {
            // No layout yet: the nominal solo card.
            card = {
                x0: 0.41, x1: 0.59, y0: 0.15, y1: 0.85,
            };
        }
        const b = board || {
            x0: card.x0 + (card.x1 - card.x0) * 0.08, x1: card.x1 - (card.x1 - card.x0) * 0.08, y0: card.y0 + (card.y1 - card.y0) * 0.17, y1: card.y1 - 0.02,
        };
        this.cardMid = (card.x0 + card.x1) / 2;
        return { card, board: b };
    }

    /**
     * Where an event came from: its player's card and board, or, for a meditation click (`screen`,
     * no board), the point clicked: a card no wider than the point, every row at its height, and a
     * nominal board's width so a light-copy keeps a cell's size.
     */
    sourceOf(c) {
        if (!c.screen) return this.cardOf(c.player ?? 0);
        const x = clamp(Number(c.screen.x) || 0, 0, 1);
        const y = clamp(Number(c.screen.y) || 0, 0, 1);
        const half = 0.0756;
        this.cardMid = x;
        return {
            card: {
                x0: x, x1: x, y0: y, y1: y,
            },
            board: {
                x0: x - half, x1: x + half, y0: y, y1: y,
            },
        };
    }

    onLock(c) {
        if (!c) return;
        const rgb = pieceLight(c.color || '#ffffff', 0.35, [0, 0, 0]);
        this.lastLock.set(c.player ?? 0, { rgb: rgb.slice(), shape: c.shape ?? null });
        const { card, board } = this.sourceOf(c);
        const rows = c.rows && c.rows.length ? c.rows : [10];
        let rowMid = 0;
        for (let i = 0; i < rows.length; i++) rowMid += rows[i];
        rowMid /= rows.length;
        const y = board.y0 + ((rowMid + 0.5) / 20) * (board.y1 - board.y0);
        // A click picks its side by the half of the screen it was made in.
        const side = (c.screen ? c.screen.x : c.u ?? 0.5) < 0.5 ? 'left' : 'right';
        const slot = this.choosePool(side, y, Boolean(c.hardDrop));
        if (slot < 0) return;
        if (c.silent) {
            this.holdPool(slot, rgb, this.time, true);
            return;
        }
        // The copy: just outside the card's edge, at the rows' height (in the card–HUD gap when the
        // right side's row is in the HUD's band).
        const hud = this.layout?.hud;
        let x = side === 'left' ? card.x0 - 0.025 : card.x1 + 0.025;
        let scale = 0.9;
        if (!c.screen && side === 'right' && hud && y > hud.y0 - 0.02 && y < hud.y1 + 0.02 && hud.x0 > card.x1) {
            x = (card.x1 + hud.x0) / 2;
            scale = 0.6;
        }
        const from = this.worldAt(x, y, NEAR_DEPTH, [0, 0, 0]);
        const pool = this.poolSlots.find((p) => p.slot === slot);
        const to = pool ? pool.world : from;
        const cellFrac = (board.x1 - board.x0) / 10;
        const cellSize = cellFrac * 2 * this.frame.cam.tanX * NEAR_DEPTH * scale;
        const { r: right, u: up } = this.frame.cam.basis;
        const hard = Boolean(c.hardDrop);
        const flight = (this.reduced ? 1.4 : 1) * (0.85 + Math.min(0.25, Math.hypot(to[0], to[2]) / 4000));
        const cells = c.cells || (c.shape && SPAWN_CELLS[c.shape]) || null;
        this.effects.setCamera(this.frame.cam);
        // Beside the HUD the lock's sparks keep off it: up and down in the gap, up above it, down
        // below it.
        let sparks = SPARKS.round;
        if (hud && side === 'right' && x > hud.x0 - 0.03 && x < hud.x1 + 0.03) {
            if (scale < 0.8) sparks = SPARKS.vertical;
            else if (y < hud.y0) sparks = SPARKS.up;
            else if (y > hud.y1) sparks = SPARKS.down;
        }
        // Nothing crosses the HUD: a thread bound past it goes round its nearer corner.
        let via = null;
        if (hud && pool && side === 'right' && pool.x > hud.x0 && x < hud.x1) {
            const above = y < (hud.y0 + hud.y1) / 2;
            const clearY = above ? hud.y0 - 0.05 : hud.y1 + 0.05;
            const inBand = y > hud.y0 - 0.05 && y < hud.y1 + 0.05;
            // From inside the HUD's band: along the card–HUD gap out of it first, then past its corner.
            via = inBand ? [x, clearY, hud.x1 + 0.03, clearY] : [hud.x1 + 0.03, clearY];
        }
        this.effects.lock(this.time, {
            from,
            to,
            right,
            up,
            cells,
            cellSize,
            colour: rgb,
            hardDrop: hard,
            flight,
            pool: slot,
            fromScreen: [x, y],
            toScreen: pool ? [pool.x, pool.y] : [x, y],
            viaScreen: via,
            sparks,
        });
        if (hard && !this.reduced) this.dip.v += 0.6 * 9;
        // A long drop (12 rows or more) bursts the Mother Fall's spray as it lands.
        if (hard && (c.dropRows ?? 0) >= 12) this.burstAt = Math.max(this.burstAt, this.time + LOCK_JET);
    }

    onClear(c) {
        if (!c) return;
        const lines = Math.max(1, Math.min(4, c.lines || 1));
        const t = this.time;
        const h = this.hour;
        const accentA = h.colour.accent;
        const { accentB } = h.colour;
        // The clear carries its own link number (combo(0) arrives a lock late).
        if (c.combo > 0) {
            const last = this.lastLock.get(c.player ?? 0);
            if (last) this.noteLink(c.combo, last.rgb, last.shape);
            this.onCombo(Math.max(this.combo, c.combo));
        }
        if (c.b2b) {
            this.b2b = true;
            if (this.flock) this.flock.longWing = true;
        } else if (c.b2b === false && this.b2b) {
            // A clear that does not continue the back-to-back ends it: the long-wing lands.
            this.b2b = false;
            if (this.flock) this.flock.longWing = false;
        }
        // ── The rows leave the card horizontally, off both sides ──
        const { card, board } = this.sourceOf(c);
        const rows = c.rows && c.rows.length ? c.rows : [19];
        const { r: right } = this.frame.cam.basis;
        const left = [-right[0], -right[1], -right[2]];
        rows.forEach((row, k) => {
            const y = board.y0 + ((row + 0.5) / 20) * (board.y1 - board.y0);
            const accent = lineAccent(lines, k, accentA, accentB);
            const col = [0.6 + accent[0] * 1.4, 0.55 + accent[1] * 1.4, 0.45 + accent[2] * 1.4];
            this.effects.sheet(t + k * 0.04, this.worldAt(card.x0 - 0.012, y, NEAR_DEPTH), left, col, {
                speed: 26, length: 12, size: 0.85, leap: 10,
            });
            // Beside the HUD the right-hand pour drops straight down the card–HUD gap (no leap: it
            // would rise into the HUD).
            const hud = this.layout?.hud;
            const inBand = hud && hud.x0 > card.x1 && y > hud.y0 - 0.03 && y < hud.y1 + 0.03;
            this.effects.sheet(t + k * 0.04, this.worldAt(card.x1 + 0.012, y, NEAR_DEPTH), right, col, {
                speed: inBand ? 5 : 26, length: 12, size: 0.85, leap: inBand ? 0 : 10,
            });
        });
        if (lines >= 4 || c.perfect) {
            this.beginHush(c.perfect === true, lines);
            return;
        }
        // ── One surge down every fall per line ──
        for (let k = 0; k < lines; k++) {
            const accent = lineAccent(lines, k, accentA, accentB);
            // The five standing falls (the far hairlines are too thin to carry a front).
            for (let f = 0; f < SLOT.hair; f++) {
                if (!this.fallCpu[f]) continue;
                this.packet(f, this.U.waterClock.value + 0.15 + k * 0.3, 0.5, 1.2, accent, 1);
            }
        }
        // ── Release: the oldest held colours ride down the falls ──
        const n = RELEASE_PER_LINE * lines;
        const released = this.releaseOldest(this.b2b ? Math.ceil(n / 2) : n, t);
        if (!released) {
            // Nothing held: the Mother Fall and the span still carry the accent, so a clear answers.
            this.packet(SLOT.mother, this.U.waterClock.value + 0.3, 0.4, 1.0, accentA, 0);
            this.packet(SLOT.span, this.U.waterClock.value + 0.3, 0.4, 1.0, accentA, 0);
        }
        if (lines >= 2) {
            this.spanAt = t;
            this.flock?.bank(this.flightClock);
        }
        if (lines >= 3) this.burstAt = t;
        if (c.tspin) this.tspin(c);
        this.flare(0.27, 0.62, 0.22, 0.35 + lines * 0.12, accentA);
    }

    /** A T-spin: the falls are wrung, two children rise, the link colours turn, the bell swings. */
    tspin(c) {
        this.U.wring.value.set(this.U.waterClock.value, this.reduced ? 0.5 : 1);
        const { card, board } = this.sourceOf(c);
        const row = c.rows && c.rows.length ? c.rows[0] : 15;
        const y = board.y0 + ((row + 0.5) / 20) * (board.y1 - board.y0);
        this.flock?.helix(this.worldAt(card.x0 - 0.06, y, 120), this.flightClock);
        this.parts.isles?.swing(0.9);
        // The colours turn: each link's colour rolls one stroke along.
        const n = Math.min(STROKES, Math.max(1, Math.ceil(this.dial)));
        if (n > 1) {
            const last = this.links[n - 1].slice();
            for (let i = n - 1; i > 0; i--) this.links[i] = this.links[i - 1].slice();
            this.links[0] = last;
            this.bowInfo.links = this.links;
        }
    }

    /** The hush, then the glory and the great pour (four lines; a perfect clear is bigger). */
    beginHush(perfect, lines) {
        this.hush.at = this.time;
        this.hush.length = perfect ? HUSH_PERFECT : HUSH;
        this.hush.perfect = perfect;
        this.hush.rings = perfect ? 8 : Math.max(4, lines);
        this.pourAt = this.time + this.hush.length + 1.27;
        if (perfect) this.spillwayAt = this.time + this.hush.length + 1.6;
        this.bowFlashUntil = this.pourAt + 5;
    }

    /** A flare lift at a frame point (fractions), governed: never more than the post can carry. */
    flare(x, y, radius, strength, tint, kind = 'routine') {
        // The governor grants how strong it may be now; a flare it would have to queue, or one past
        // the allowance, is not played (the event's own light still is).
        const wanted = Math.min(1.2, strength);
        const area = Math.min(1, Math.PI * radius * radius);
        const grant = this.flashes.request(kind, wanted, area, 0, this.time);
        if (!(grant.strength > 0) || grant.at > this.time + 1e-3) return;
        const f = this.post.flare;
        const s = Math.min(wanted, grant.strength);
        if (s >= f[3]) {
            f[0] = x; f[1] = y; f[2] = radius; f[3] = s;
            this.post.flareTint[0] = 0.6 + tint[0] * 0.6;
            this.post.flareTint[1] = 0.6 + tint[1] * 0.6;
            this.post.flareTint[2] = 0.6 + tint[2] * 0.6;
        }
        this.post.iris = Math.min(this.post.iris, 1 / (1 + 0.6 * s * 0.5));
    }

    /** The colour of the lock that made link n (1-based). */
    noteLink(n, color, shape = null) {
        if (!(n >= 1 && n <= STROKES)) return;
        const rgb = Array.isArray(color) ? color : pieceLight(color, 0.35, [0, 0, 0]);
        this.links[n - 1] = rgb.slice();
        this.linkShapes[n - 1] = shape;
        if (n === 7) {
            const shapes = new Set(this.linkShapes.slice(0, 7).filter(Boolean));
            if (shapes.size === 7) this.trueBowAt = this.time;
        }
    }

    /** The longest chain on any board (0 = broken). */
    onCombo(n) {
        const combo = Math.max(0, Math.floor(Number(n) || 0));
        if (combo === 0 && this.combo > 0 && this.b2b) this.graceUntil = this.time + B2B_GRACE;
        if (combo === 0) {
            this.b2b = false;
            // The long-wing lands with the back-to-back.
            if (this.flock) this.flock.longWing = false;
        }
        this.combo = combo;
        this.dialTarget = Math.min(DIAL_MAX, combo);
    }

    levelUp(level, { silent = false } = {}) {
        this.wheel.levelUp?.(Math.max(1, Math.round(level)), this.time, { silent });
        if (silent) return;
        this.U.toll.value.set(this.time, 1);
        this.parts.isles?.swing(0.6);
        const crown = this.isleToWorld('spring', 0, PLAN.spring.top + 10, PLAN.spring.radius * 0.3);
        this.flock?.launch(crown, this.flightClock);
    }

    // ── Frame ──

    /** Clocks that change rate (the hush, the pour) are integrated, never time × speed. */
    integrate(dt) {
        const { U } = this;
        const t = this.time;
        const hushAge = t - this.hush.at;
        const hushing = hushAge >= 0 && hushAge < this.hush.length;
        const pourAge = t - this.pourAt;
        const pour = pourAge >= 0 && pourAge < 3 ? 1 + 1.2 * (1 - smooth(0, 3, pourAge)) : 1;
        const waterRate = hushing ? 0.15 : 1;
        const sprayRate = hushing ? 0.05 : 1;
        let flightRate = this.reduced ? 0.6 : 1;
        if (hushing) flightRate = 0.05;
        U.time.value = t;
        U.waterClock.value += dt * waterRate * pour;
        U.sprayClock.value += dt * sprayRate;
        U.mistClock.value += dt;
        this.flightClock += dt * flightRate;
        // The falls' width: thin in the hush, swollen in the pour, wide with the chain.
        const chain = 1 + 0.05 * Math.min(this.dial, 7);
        U.flow.value.y = (hushing ? 0.35 : 1) * (pourAge >= 0 && pourAge < 3 ? 1 + 0.4 * (1 - smooth(0, 3, pourAge)) : 1) * chain;
        U.flow.value.x = waterRate;
        U.drift.value.set(t * 0.0011, t * 0.0004);
        U.starTurn.value = t * 0.004;
        this.post.hush = hushing ? smooth(0, 0.08, hushAge) : Math.max(0, this.post.hush - dt * 6);
    }

    /** The hour's colours and numbers into the uniforms. */
    applyHour(time) {
        const place = this.wheel.placeAt(time);
        const h = hourAt(place, this.hour);
        const { U } = this;
        const rows = U.rows.array;
        COLOUR_ROWS.forEach((name, i) => {
            const c = h.colour[name];
            rows[i].set(c[0], c[1], c[2], 1);
        });
        SCALAR_UNIFORMS.forEach((name) => {
            if (U[name] && h.scalar[name] !== undefined) U[name].value = h.scalar[name];
        });
        // The light the forms are shaded in: the key from behind the eye turned by the hour (its
        // azimuth swung, its elevation nudged), so each hour models the stone its own way; the bows
        // and the wedges keep the true antisolar geometry (U.key).
        {
            const { A } = this.frame;
            const el = Math.asin(clamp(-A[1], -1, 1)) + (h.scalar.keyNudge ?? 0) * DEG;
            const az = Math.atan2(-A[0], -A[2]) + (h.scalar.keySwing ?? 0);
            U.shadeKey.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
            const level = Math.hypot(A[0], A[2]) || 1;
            U.termLine.value.set(A[0] / level, A[2] / level, h.scalar.termRise ?? 0, (h.scalar.termY ?? 0) * 1000);
        }
        this.showerHour = h.scalar.shower ?? 0.85;
        U.showerAmt.value = this.showerHour * (this.showerScale ?? 1);
        // The sky's own numbers.
        U.rays.value = h.scalar.rays ?? 0;
        U.cirrus.value = h.scalar.cirrus ?? 0;
        this.post.exposure = h.scalar.exposure ?? 1;
        this.post.glow = h.scalar.glow ?? 0;
        this.post.gradeShadow = h.gradeShadow;
        this.post.gradeLight = h.gradeLight;
    }

    /** The dial eases toward the chain; strokes paint and withdraw one by one. */
    stepDial(dt) {
        const target = this.time < this.graceUntil ? Math.max(this.dialTarget, this.dial) : this.dialTarget;
        if (this.dial < target) {
            const backlog = target - this.dial;
            const rate = Math.max(1 / STROKE_SECONDS, backlog / 0.8);
            this.dial = Math.min(target, this.dial + rate * dt);
        } else if (this.dial > target) {
            this.dial = Math.max(target, this.dial - dt / UNWIND_SECONDS);
        }
        // The great pour flashes the whole primary for a while.
        const flash = this.time < this.bowFlashUntil && this.time > this.pourAt ? 1 : 0;
        this.U.bow.value.w = Math.max(this.dial, flash ? 7 : 0);
    }

    /**
     * The strokes into U.strokes each frame: how far each is painted, its link's colour (melted to
     * the spectrum a while after a true bow), the ramps of its two ends, and the brush's head.
     * An end joined to a neighbour (found by the frame) pulls tight only while the neighbour is
     * painted there, the two ramped alike about the joint so they add up to one; an end the card or
     * the frame hides runs on under it; an end in open sky is brushed out over ~3.5°.
     */
    writeStrokes() {
        const rows = this.U.strokes.array;
        const f = this.frame;
        const flash = this.time < this.bowFlashUntil && this.time > this.pourAt;
        const trueBow = this.time - this.trueBowAt;
        const z = this.strokeZ || (this.strokeZ = new Float64Array(STROKES));
        const lens = this.strokeLen || (this.strokeLen = new Float64Array(STROKES));
        const strokeAt = (i) => (i < 7 ? f.strokes1[i] : f.strokes2[i - 7]);
        for (let i = 0; i < STROKES; i++) {
            const progress = clamp01(this.dial - i);
            // A stroke laid whole glitters a moment; the last of a bow closes it (the sweep).
            if (progress >= 1 && this.laid[i] < 1) {
                this.laidAt[i] = this.time;
                if (i === 6 || i === STROKES - 1) this.closeBow(i === 6 ? 0 : 1);
            }
            this.laid[i] = progress;
            const flashOn = flash && i < 7 ? 1 : 0;
            rows[i].z = Math.max(progress, flashOn);
            rows[i].w = Math.max(progress > 0 ? 1 : 0, flashOn * 1.4);
            z[i] = rows[i].z;
            const s = strokeAt(i);
            lens[i] = s ? Math.abs(s.phi1 - s.phi0) : 0;
            const link = this.links[i];
            // A true bow melts its colours into the spectrum.
            const tint = trueBow >= 0 && trueBow < 60 && i < 7 ? 1 - smooth(0, 2, trueBow) : 1;
            rows[STROKES + i].set(link[0], link[1], link[2], tint);
        }
        // How tight a stroke's side of a joint is: a start once its brush has left it, an end once
        // the stroke is laid.
        const side = (i, end) => {
            if (end) return z[i] >= 1 ? 1 : 0;
            return smooth(0, JOIN_ARC, z[i] * lens[i]);
        };
        const E = STROKE_END;
        // How far a hidden end runs on: none, under the card or HUD, out of the frame.
        const RUN_ON = [0, E.calm, E.edge];
        for (let i = 0; i < STROKES; i++) {
            const s = strokeAt(i);
            const row = rows[STROKES * 2 + i];
            if (!s || !(z[i] > 0)) {
                row.set(0, E.free, 0, E.free);
                continue;
            }
            const base = i < 7 ? 0 : 7;
            const len = lens[i];
            const joins = s.joins || [null, null];
            const hides = s.hides || [0, 0];
            const runOn = (h) => RUN_ON[h] || 0;
            // The start.
            let c0 = 0;
            let h0 = E.free;
            if (joins[0]) {
                const t = side(i, 0) * side(base + joins[0].k, joins[0].end);
                h0 = E.free + (E.tight - E.free) * t;
            } else if (hides[0]) {
                c0 = -runOn(hides[0]) / 2;
                h0 = runOn(hides[0]) / 2;
            }
            // The end: the brush's head while it paints (running on under a hiding card), then
            // the laid end.
            let c1;
            let h1;
            const endRun = joins[1] ? 0 : runOn(hides[1]);
            if (z[i] < 1) {
                c1 = z[i] * (len + endRun);
                h1 = E.head;
            } else if (joins[1]) {
                const t = side(i, 1) * side(base + joins[1].k, joins[1].end);
                c1 = len;
                h1 = E.free + (E.tight - E.free) * t;
            } else if (endRun > 0) {
                c1 = len + endRun / 2;
                h1 = endRun / 2;
            } else {
                c1 = len;
                h1 = E.free;
            }
            row.set(c0, h0, c1, h1);
        }
        // The brush's head: the stroke the dial is painting now (never while it unwinds), its
        // glint lingering HEAD_FADE s on the stroke just laid.
        const { head } = this;
        const n = Math.floor(this.dial);
        const part = this.dial - n;
        if (part > 1e-4 && n < STROKES && this.dial > head.dial && !flash) {
            const s = strokeAt(n);
            if (s) {
                const hides = s.hides || [0, 0];
                const sense = s.phi1 < s.phi0 ? -1 : 1;
                const endRun = s.joins?.[1] ? 0 : RUN_ON[hides[1]] || 0;
                head.phi = s.phi0 + sense * part * (lens[n] + endRun);
                head.bow = n < 7 ? 0 : 1;
                head.sense = sense;
                const link = this.links[n];
                head.rgb[0] = link[0]; head.rgb[1] = link[1]; head.rgb[2] = link[2];
                head.at = this.time;
            }
        }
        head.dial = this.dial;
        const strength = 1 - smooth(0, HEAD_FADE, this.time - head.at);
        this.U.bowHead.value.set(head.phi, head.bow, strength, head.sense);
        this.U.bowHeadColour.value.set(head.rgb[0], head.rgb[1], head.rgb[2], 0);
    }

    /**
     * The widest free band of sky right of the board's card and the HUD (with their calm fade),
     * split by the Far Gate's hull: the room the altocumulus deck has to lie in as a field.
     */
    deckRoom(f) {
        const { layout } = this;
        const cards = layout?.cards || [];
        if (!cards.length && !layout?.hud) return 1;
        let left = 0;
        for (const c of cards) left = Math.max(left, c.x1);
        if (layout.hud) left = Math.max(left, layout.hud.x1);
        left += 0.05;
        const g = this.placement.gate;
        if (!g) return Math.max(0, 0.98 - left);
        const dist = Math.hypot(g.pos[0], g.pos[2]) || PLAN.gate.dist;
        const half = Math.atan((PLAN.gate.width * g.scale) / 2 / dist);
        const d = this.scratch.roomDir || (this.scratch.roomDir = [0, 0, -1]);
        const scr = this.scratch.roomScr || (this.scratch.roomScr = { x: 0, y: 0, front: false });
        const xAt = (b) => {
            d[0] = Math.sin(b);
            d[1] = 0;
            d[2] = -Math.cos(b);
            return project(d, f.cam, scr).x;
        };
        const g0 = Math.min(xAt(g.bearing - half), xAt(g.bearing + half));
        const g1 = Math.max(xAt(g.bearing - half), xAt(g.bearing + half));
        return Math.max(0, g0 - 0.02 - left, 0.98 - Math.max(left, g1 + 0.02));
    }

    /** A bow has closed: a run of light sweeps along it, and the sky flares a little (governed). */
    closeBow(bow) {
        this.closedAt[bow] = this.time;
        const f = this.frame;
        const strokes = bow ? f.strokes2 : f.strokes1;
        if (!strokes?.length) return;
        const mid = (strokes[0].phi0 + strokes[strokes.length - 1].phi1) / 2;
        const d = this.scratch.paintDir || (this.scratch.paintDir = [0, 0, 0]);
        const scr = this.scratch.paintScr || (this.scratch.paintScr = { x: 0, y: 0, front: false });
        this.screenOf(bowPoint(f.A, f.basis, bow ? f.R2 : f.R1, mid, d), scr);
        if (scr.front) this.flare(scr.x, scr.y, 0.25, bow ? 0.4 : 0.32, this.hour.colour.key);
    }

    /**
     * The paint's own light, for the glow layer: the brush's head as a comet of its link's colour
     * on the bow where the child paints; glitter twinkling down off each stroke just laid; and,
     * when a bow closes, a run of light sweeping along its whole arc. Only where the bow is seen
     * (never under a card or the HUD).
     */
    emitPaint(push) {
        const f = this.frame;
        if (!f?.strokes1) return;
        const D = PAINT.depth;
        const d = this.scratch.paintDir || (this.scratch.paintDir = [0, 0, 0]);
        const scr = this.scratch.paintScr || (this.scratch.paintScr = { x: 0, y: 0, front: false });
        const cards = this.layout?.cards || [];
        const hud = this.layout?.hud;
        const inside = (r) => scr.x > r.x0 - 0.01 && scr.x < r.x1 + 0.01 && scr.y > r.y0 - 0.01 && scr.y < r.y1 + 0.01;
        // A light at φ on a bow, `off` radians across it: pushed if it is seen.
        const at = (bow, phi, off, drop, radius, r, g, b, shape) => {
            bowPoint(f.A, f.basis, (bow ? f.R2 : f.R1) + off, phi, d);
            d[1] -= drop;
            this.screenOf(d, scr);
            if (!scr.front || scr.x < 0 || scr.x > 1 || scr.y < 0 || scr.y > this.edgeAt(scr.x)) return;
            if (hud && inside(hud)) return;
            for (let k = 0; k < cards.length; k++) if (inside(cards[k])) return;
            push(d[0] * D, d[1] * D, d[2] * D, radius * D, r, g, b, shape);
        };
        const white = (c, k) => c * (1 - k) + k;
        // The brush's head, while it paints (and a moment after): a hot core in a halo of the link's
        // colour, a few glints trailing it along the arc.
        const { head } = this;
        const strength = (1 - smooth(0, HEAD_FADE, this.time - head.at)) * (this.reduced ? 0.6 : 1);
        if (strength > 0.02) {
            const [lr, lg, lb] = head.rgb;
            const peak = Math.max(lr, lg, lb, 1e-3);
            const cr = lr / peak;
            const cg = lg / peak;
            const cb = lb / peak;
            at(head.bow, head.phi, 0, 0, 0.016, cr * 1.6 * strength, cg * 1.6 * strength, cb * 1.6 * strength, GLOW.soft);
            at(head.bow, head.phi, 0, 0, 0.005, white(cr, 0.6) * 5 * strength, white(cg, 0.6) * 5 * strength, white(cb, 0.6) * 5 * strength, GLOW.glow);
            for (let k = 1; k <= 6; k++) {
                const tw = 0.55 + 0.45 * Math.sin(this.time * 23 + k * 2.7);
                const b = (1 - k / 7) * 2.6 * strength * tw;
                const across = (hash(k * 3.3 + head.at) - 0.5) * 0.012;
                at(head.bow, head.phi - head.sense * k * 0.022, across, 0, 0.0035, white(cr, 0.5) * b, white(cg, 0.5) * b, white(cb, 0.5) * b, GLOW.glint);
            }
        }
        // Glitter off each stroke just laid: points of its colour across the band, twinkling and
        // drifting down off the bow as they fade.
        for (let i = 0; i < STROKES; i++) {
            const age = this.time - this.laidAt[i];
            if (age < 0 || age > PAINT.glitter) continue;
            const s = i < 7 ? f.strokes1[i] : f.strokes2[i - 7];
            if (!s) continue;
            const bow = i < 7 ? 0 : 1;
            const link = this.links[i];
            const peak = Math.max(link[0], link[1], link[2], 1e-3);
            const fade = (1 - age / PAINT.glitter) ** 1.5;
            for (let k = 0; k < PAINT.glints; k++) {
                const h0 = hash(i * 17.3 + k * 1.618);
                const h1 = hash(i * 5.1 + k * 3.7 + 0.5);
                const phi = s.phi0 + (s.phi1 - s.phi0) * h0;
                const tw = this.reduced ? 0.8 : 0.5 + 0.5 * Math.sin(this.time * (14 + h1 * 12) + h0 * 40);
                const b = fade * tw * 2.4;
                const drop = age * age * 0.006 * (0.5 + h1);
                const lr = white(link[0] / peak, 0.45) * b;
                const lg = white(link[1] / peak, 0.45) * b;
                const lb = white(link[2] / peak, 0.45) * b;
                at(bow, phi, (h1 - 0.5) * 0.026, drop, 0.003 + h1 * 0.002, lr, lg, lb, k % 3 === 0 ? GLOW.glint : GLOW.glow);
            }
        }
        // The sweep: a bow just closed is run along end to end by a band of light and its glints.
        for (let bow = 0; bow < 2; bow++) {
            const age = this.time - this.closedAt[bow];
            if (age < 0 || age > PAINT.sweep) continue;
            const strokes = bow ? f.strokes2 : f.strokes1;
            if (!strokes?.length) continue;
            const a = strokes[0].phi0;
            const b = strokes[strokes.length - 1].phi1;
            const run = smooth(0, PAINT.sweep * 0.8, age);
            const fade = 1 - smooth(PAINT.sweep * 0.6, PAINT.sweep, age);
            const { key } = this.hour.colour;
            const kp = Math.max(key[0], key[1], key[2], 1e-3);
            const phi = a + (b - a) * run;
            at(bow, phi, 0, 0, 0.022, (key[0] / kp) * 2.2 * fade, (key[1] / kp) * 2.2 * fade, (key[2] / kp) * 2.2 * fade, GLOW.soft);
            at(bow, phi, 0, 0, 0.006, 5 * fade, 5 * fade, 5 * fade, GLOW.glow);
            for (let k = 1; k <= 10; k++) {
                const back = phi - Math.sign(b - a) * k * 0.03;
                if ((back - a) * Math.sign(b - a) < 0) break;
                const tw = 0.5 + 0.5 * Math.sin(this.time * 31 + k * 1.9 + bow);
                const bb = (1 - k / 11) * 2.8 * fade * tw;
                at(bow, back, (hash(k * 7.7 + bow) - 0.5) * 0.02, k * 0.0008, 0.0035, bb, bb, bb, GLOW.glint);
            }
        }
    }

    /** The glory: one ring per line after the hush, holding, then sinking into the mist. */
    stepGlory() {
        const { U } = this;
        const age = this.time - this.hush.at - this.hush.length;
        if (this.hush.at < -1e3 || age < -this.hush.length) {
            U.glory.value.set(0, 0, 0, this.oppRest);
            return;
        }
        const ringGap = this.hush.perfect ? 0.35 : 0.35;
        const firstRing = 0.07;
        let rings = 0;
        for (let k = 0; k < this.hush.rings; k++) if (age >= firstRing + k * ringGap) rings = k + 1;
        const opening = clamp01((age - firstRing - (rings - 1) * ringGap) / 0.5);
        const reveal = rings > 0 ? 1.2 + (rings - 1 + opening) * 1.05 : 0;
        const hold = this.hush.perfect ? GLORY_HOLD + 0.4 : GLORY_HOLD;
        const strength = age < 0 ? 0 : (1 - smooth(hold, hold + 4, age)) * smooth(0, 0.3, age);
        const opposition = age < 0 ? 0 : (1 - smooth(1, 6, age)) * 2;
        U.glory.value.set(strength, reveal, opposition, this.oppRest);
        // The wedges deepen while it holds.
        U.shadowDepth.value = Math.min(0.85, U.shadowDepth.value + 0.35 * strength);
        // The light behind us flares as the hush ends (governed).
        if (age >= 0 && age < 0.05) {
            const A = this.frame.Ascreen;
            this.flare(A.x, A.y, 0.25, 0.9, this.hour.colour.key, 'set');
        }
        // The great pour: every held colour goes down at once.
        if (this.pourAt > -1e3 && this.time >= this.pourAt && !this.pourDone) {
            this.pourDone = true;
            this.releaseOldest(Infinity, this.time, 0.1);
        }
        if (this.time < this.pourAt) this.pourDone = false;
    }

    /** The Far Gate's spillway (perfect clear only): a curtain unrolling from its threshold. */
    stepSpillway() {
        const age = this.time - this.spillwayAt;
        const { U } = this;
        if (age < 0 || age > 16) {
            clearFall(U.falls, SLOT.spillway);
            return;
        }
        const p = PLAN.gate;
        const flow = age < 13 ? 1 : 1 - smooth(13, 16, age);
        const { weir } = this.parts.isles.anchors;
        // Sized to its notch (a fifteenth of the gate's width) at the gate's own scale in this layout.
        const scale = this.placement?.gate?.scale ?? 1;
        writeFall(U.falls, SLOT.spillway, {
            // From the attic's weir: a thread widening into a curtain through the opening, down most
            // of the arch's height (the gate is two kilometres tall), going to mist inside it.
            lip: this.isleToWorld('gate', weir.x, weir.y, weir.z),
            dir: this.isleDir('gate', 0, 1),
            v0: 9,
            width: p.width * 0.15 * scale * (0.45 + 0.5 * smooth(0, 2, age)),
            spread: 7 * scale,
            duration: SPILLWAY.duration,
            breakAt: SPILLWAY.breakAt,
            mistAt: SPILLWAY.mistAt,
            flow,
            kind: FALL_KIND.pour,
            // Thirteen kilometres off, a kilometre of fall would take the whole beat to unroll at
            // water speed: it unrolls faster than its water falls (no one can time it from here).
            bornAt: U.waterClock.value - age * SPILLWAY.unroll,
            // It hangs across its notch as a curtain (lit on its face), glass over the weir; its
            // flanks barely arc back, so they never fall behind the sill into the drape.
            form: 0.25,
            lipT: 1.2,
        });
    }

    /**
     * The bursts standing in the Mother's plume now (into `out`): how high they throw it (m), how
     * much they thicken it, and the bow a tower adds. A long drop's swell is armed for when its jet
     * lands (ahead of the clock), a three-line clear's tower at once; one armed while another
     * stands carries it on (every envelope is kept, the plume takes the most of them, so a quick
     * run of drops never throws it down and up again), and a seek forgets them. A tower's bow asks
     * the flash governor first. Under reduced motion nothing is thrown: the plume thickens slowly.
     */
    sprayBursts(out) {
        if (!this.sprayArms) {
            this.sprayArms = [];
            this.sprayArm = -1e4;
        }
        const arms = this.sprayArms;
        const arm = this.burstAt;
        if (arm < this.sprayArm) arms.length = 0;
        if (arm !== this.sprayArm) {
            this.sprayArm = arm;
            if (arm > -1e3) {
                const kind = arm > this.time + 1e-6 ? SPRAY_BURST.swell : SPRAY_BURST.tower;
                let grant = null;
                if (kind.bow > 0) {
                    // About a twentieth of the frame brightened by a third, held while it stands.
                    const g = this.flashes.request('routine', 0.35, 0.05, 0, arm, kind.length * 0.45);
                    grant = { at: g.at, ramp: g.ramp, gain: Math.min(1, g.strength / 0.35) };
                }
                // Keep every one still standing (a crowd of drops lets its oldest swell go first).
                for (let i = arms.length - 1; i >= 0; i--) if (this.time - arms[i].at >= arms[i].kind.length) arms.splice(i, 1);
                if (arms.length >= SPRAY_BURST.most) {
                    const swell = arms.findIndex((a) => a.kind === SPRAY_BURST.swell);
                    arms.splice(Math.max(0, swell), 1);
                }
                arms.push({ at: arm, kind, grant });
            }
        }
        out.lift = 0;
        out.thick = 0;
        out.bow = 0;
        const ramp = this.reduced ? 1.2 : 0.3;
        for (let i = 0; i < arms.length; i++) {
            const { at, kind, grant } = arms[i];
            const age = this.time - at;
            if (age < 0 || age >= kind.length) continue;
            const env = smooth(0, ramp, age) * (1 - smooth(kind.length * 0.45, kind.length, age));
            if (!this.reduced) out.lift = Math.max(out.lift, kind.height * (1 - Math.exp(-age / 0.7)) * env);
            out.thick = Math.max(out.thick, env * (kind === SPRAY_BURST.tower ? 0.8 : 0.4));
            if (grant && grant.gain > 0) {
                const g = this.time - grant.at;
                const lit = g > 0 ? smooth(0, Math.max(ramp, grant.ramp), g) * (1 - smooth(kind.length * 0.45, kind.length, age)) : 0;
                out.bow = Math.max(out.bow, kind.bow * grant.gain * lit);
            }
        }
        return out;
    }

    /**
     * Every puff of spray at a spray clock, handed to `put` (x, y, z, radius, density, spin, tint,
     * bow, out x, out z, height, role), each in a role (SPRAY): the Mother Fall's lip (beads off her
     * corners riding down with her), the veil the wind tears off her open edge as she falls, and
     * the plume she boils into where the frame's lower edge cuts her (her life is solved against
     * it, so the plume always stands on screen); the span's break and its foot; a little at each
     * horsetail's end. `burst` (sprayBursts) throws part of the plume up as a tower.
     */
    sprayPuffs(clock, water, burst, put) {
        const { U } = this;
        const rows = U.falls.array;
        const flow = U.flow.value.y;
        const cap = this.parts.spray.capacity;
        const level = (this.hour.scalar.spray ?? 1) * (1 + 0.3 * Math.min(this.dial, 7)) * (0.5 + 0.5 * Math.min(1, flow));
        // What the layout lets it cover: fewer puffs, and smaller.
        const fit = this.sprayFit ?? 1;
        const fitN = Math.sqrt(fit);
        const fitR = Math.sqrt(fitN);
        const p = this.scratch.a;
        const { r: right, f: ahead } = this.frame.cam.basis;
        // Across the view and toward it, on the ground (a heap is wider across than it is deep).
        const al = Math.hypot(ahead[0], ahead[2]) || 1;
        const fx = ahead[0] / al;
        const fz = ahead[2] / al;
        // A small tier gives its few puffs to the plume first.
        const lean = cap < 400 ? 0.6 : 1;
        let id = 0;
        for (const e of SPRAY_EMITTERS) {
            const fall = this.fallCpu[e.slot];
            if (!fall) continue;
            // The flow its row carries now (the span runs broad after a clear): the width drawn.
            fall.flow = rows[e.slot * 3 + 2].z;
            const tFrame = fall.tFrame ?? fall.duration;
            // The lip's heading (its tangent, left of the heading, is (dz, −dx)), on the ground.
            const dx = fall.dir[0];
            const dz = fall.dir[1];
            const n = Math.floor(cap * e.share * (e.role === SPRAY_ROLE.plume ? 2 - lean : lean) * fitN);
            const thrown = e.mother && e.role === SPRAY_ROLE.plume ? burst : null;
            const heaped = e.role === SPRAY_ROLE.plume || e.role === SPRAY_ROLE.foot;
            const veil = e.role === SPRAY_ROLE.veil;
            for (let k = 0; k < n; k++, id++) {
                const h0 = hash(id + 0.13);
                const h1 = hash(id * 1.7 + 4.1);
                const h2 = hash(id * 2.3 + 9.7);
                const h3 = hash(id * 3.1 + 2.9);
                const life = e.life[0] + (e.life[1] - e.life[0]) * h1;
                const phase = frac(clock / life + h0);
                const age = phase * life;
                // Where on the fall it leaves from (a share of the drop the frame shows); a lip's
                // bead rides down with the water. (A plume heaps up from its foot: most of it low,
                // its biggest billows lowest.)
                // (Only the plume gathers low: a thread's breath spreads evenly down its last stretch.)
                const low = e.role === SPRAY_ROLE.plume ? Math.sqrt(h2) : h2;
                const hh = e.h[0] + (e.h[1] - e.h[0]) * low;
                const t = tFrame * Math.sqrt(hh) + (e.ride ?? 0) * age;
                fallPoint(fall, t, p, water);
                const half = fallHalfWidth(fall, t, flow);
                // Out from the centre line: the lip off both corners, the veil off the open edge
                // (some of it out past it), a heap all round the column, wider across the view
                // than toward it; each puff at its own pace, so the heap has no wall.
                const side = veil && fall.open ? fall.open : Math.sign(h3 - 0.5) || 1;
                const past = e.past && frac(h3 * 3.7) < 0.34;
                const [a0, a1] = past ? e.past : e.across;
                const pace = heaped ? 0.45 + 1.1 * frac(h3 * 5.9) : 1;
                const reach = (a0 + (a1 - a0) * frac(h3 * 7.3)) * half + e.out * age * pace;
                let ox;
                let oz;
                if (heaped) {
                    const ang = h1 * Math.PI * 2;
                    const ca = Math.cos(ang);
                    const sa = Math.sin(ang) * 0.5;
                    ox = right[0] * ca - fx * sa;
                    oz = right[2] * ca - fz * sa;
                } else {
                    const ang = (side < 0 ? Math.PI : 0) + (h0 - 0.5) * 0.9;
                    const ca = Math.cos(ang);
                    // The veil hangs in front of the curtain (never between it and the stone).
                    const sa = veil ? Math.abs(Math.sin(ang)) * 0.8 : Math.sin(ang) * (Math.sin(ang) < 0 ? 0.45 : 0.8);
                    // Along the tangent (dz, −dx) and the heading (dx, dz).
                    ox = dz * ca + dx * sa;
                    oz = -dx * ca + dz * sa;
                }
                const wind = e.drift * age * (heaped ? 0.6 + 0.8 * frac(h2 * 3.3) : 1);
                let lift = e.rise * age * (0.6 + 0.8 * h2);
                let size = (e.size[0] + (e.size[1] - e.size[0]) * frac(h2 * 5.3 + h1)) * (0.55 + 0.9 * phase) * (0.6 + 0.6 * low) * fitR;
                let density = e.density * Math.sin(Math.PI * Math.min(1, phase * 1.15)) * Math.min(2, level) * (0.6 + 0.4 * h1);
                let { bow } = e;
                if (thrown) {
                    density *= 1 + 0.5 * thrown.thick;
                    // The tower: half the plume is thrown up out of it, the bow standing in it; its
                    // crown tapers into wisps and the curtain still shows through it.
                    if (h0 < 0.55 && (thrown.lift > 0 || thrown.bow > 0)) {
                        const up = thrown.lift * (0.25 + 0.75 * frac(h0 * 9.1));
                        const s = up / SPRAY_BURST.tower.height;
                        lift += up;
                        size *= 1 - 0.45 * Math.min(1, s);
                        density = Math.min(density, 0.75 / Math.max(0.35, s));
                        bow += thrown.bow;
                    }
                }
                // Spray behind the curtain is seen through it.
                if (oz * dz + ox * dx < 0 && !heaped) density *= 0.5;
                const x = p[0] + ox * reach + right[0] * wind;
                const y = p[1] + lift;
                const z = p[2] + oz * reach + right[2] * wind;
                // How far up its plume (its crown takes the light from above).
                const height = clamp01(1 - (hh - e.h[0]) / Math.max(1e-3, e.h[1] - e.h[0]) + lift / Math.max(1, half * 4));
                put(x, y, z, size, density, h0 * 6.28 + phase * 0.6, h2, bow, ox, oz, height, e.role);
            }
        }
    }

    /** Spray, closed form in the spray clock (sprayPuffs), laid far to near. */
    emitSpray() {
        const { spray } = this.parts;
        if (!spray) return;
        spray.begin();
        this.sprayPuffs(this.U.sprayClock.value, this.U.waterClock.value, this.sprayBursts(this.scratch.burst ??= {}), spray.push);
        // Far to near (the eye is at the origin, give or take its breath).
        spray.sort(0, 0, 0);
        spray.end();
    }

    /**
     * How much of the frame the spray covers at rest in this layout (screens of quads, the mean of
     * a few moments), and the share of its puffs' fill the layout may keep (sprayFill): the world
     * calls this when a layout places the falls.
     */
    fitSpray() {
        if (!this.parts.spray) return 1;
        this.sprayFit = 1;
        const { basis: { f, r, u }, tanX, tanY } = this.frame.cam;
        const still = { lift: 0, thick: 0, bow: 0 };
        let area = 0;
        const span = (c, h) => Math.max(0, Math.min(1, c + h) - Math.max(0, c - h));
        const add = (x, y, z, radius) => {
            const zf = x * f[0] + y * f[1] + z * f[2];
            if (zf < 1) return;
            const cx = 0.5 + (0.5 * (x * r[0] + y * r[1] + z * r[2])) / (zf * tanX);
            const cy = 0.5 - (0.5 * (x * u[0] + y * u[1] + z * u[2])) / (zf * tanY);
            area += span(cx, (0.5 * radius) / (zf * tanX)) * span(cy, (0.5 * radius) / (zf * tanY));
        };
        const moments = 6;
        for (let k = 0; k < moments; k++) this.sprayPuffs(k * 1.618, k * 1.618, still, add);
        area /= moments;
        this.sprayFit = Math.min(1, sprayFill(this.parts.spray.capacity) / Math.max(area, 1e-6));
        this.sprayArea = area * this.sprayFit;
        return this.sprayFit;
    }

    /** The newest held pools light the stone round them (the shader reads `tier.lamps` rows). */
    writeLamps() {
        const rows = this.U.lamps.array;
        const n = Math.min(12, this.tier.lamps);
        const live = [];
        this.held.forEach((h, slot) => {
            const age = this.time - h.at;
            if (age < 0 || age > 30) return;
            live.push(slot);
        });
        live.sort((a, b) => this.held[b].at - this.held[a].at);
        for (let i = 0; i < 12; i++) {
            const slot = i < n ? live[i] : undefined;
            if (slot === undefined) {
                rows[i * 2].set(0, -1e5, 0, 1);
                rows[i * 2 + 1].set(0, 0, 0, 0);
                continue;
            }
            const h = this.held[slot];
            const info = this.poolSlots.find((p) => p.slot === slot);
            const age = this.time - h.at;
            const env = smooth(0, 0.3, age) * (age < 18 ? 1 : Math.exp(-(age - 18) / 6))
                * (h.released ? Math.max(0, 1 - (this.time - h.releasedAt) / 0.8) : 1);
            const w = info ? info.world : [0, -1e5, 0];
            rows[i * 2].set(w[0], w[1] - 3, w[2], 9);
            rows[i * 2 + 1].set(h.rgb[0], h.rgb[1], h.rgb[2], env);
        }
    }

    /** The glows: event effects, trails and brush heads, the sleepers in the grotto. */
    emitGlows() {
        const { fx } = this.parts;
        if (!fx) return;
        const g = fx.glows;
        g.begin();
        const push = g.push.bind(g);
        this.effects.emit(this.time, push);
        // The landed locks fill their pools.
        const landed = this.effects.landed(this.time);
        for (const r of landed) {
            if (r.pool >= 0) {
                this.holdPool(r.pool, r.colour, this.time, false);
                this.parts.pools.ring(r.pool, this.time, r.hard ? 1.7 : 1);
                const d = Math.hypot(r.to[0], r.to[1], r.to[2]);
                const size = Math.max(1.2, d * 0.006);
                this.effects.crown(this.time, r.to, r.colour, {
                    count: r.hard ? 24 : 14, size, speed: size * 5, flash: true,
                });
                // The landing flares where it lands (read even with bloom off).
                const p = this.screenOf([r.to[0] / d, r.to[1] / d, r.to[2] / d], this.scratch.p);
                this.flare(p.x, p.y, 0.035, r.hard ? 0.7 : 0.45, r.colour);
            }
        }
        // Each held pool is a jewel: a soft glow of its colour over the water, readable from here.
        for (let i = 0; i < this.poolSlots.length; i++) {
            const info = this.poolSlots[i];
            const h = this.held[info.slot];
            if (!h || h.at < -1e3) continue;
            const age = this.time - h.at;
            if (age < 0) continue;
            const env = smooth(0, h.silent ? 1.5 : 0.25, age) * (age < 18 ? 1 : Math.exp(-(age - 18) / 6))
                * (h.released ? Math.max(0, 1 - (this.time - h.releasedAt) / 0.8) : 1);
            if (env < 0.02) continue;
            const w = info.world;
            const d = Math.hypot(w[0], w[1], w[2]);
            const r = Math.max(4.5, d * 0.012);
            // A soft halo of the colour over the water and a hot heart in it, breathing slowly
            // (each pool at its own pace): a jewel set in the white stone, read from the overlook.
            const breath = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(this.time * (1.3 + 0.4 * hash(info.slot)) + info.slot * 2.1);
            const b = 0.7 * env * breath;
            push(w[0], w[1] + 1, w[2], r, h.rgb[0] * b, h.rgb[1] * b, h.rgb[2] * b, GLOW.soft);
            const peak = Math.max(h.rgb[0], h.rgb[1], h.rgb[2], 1e-3);
            const hb = 1.6 * env * breath;
            push(
                w[0],
                w[1] + 0.6,
                w[2],
                Math.max(1.4, d * 0.0035),
                ((h.rgb[0] / peak) * 0.7 + 0.3) * hb,
                ((h.rgb[1] / peak) * 0.7 + 0.3) * hb,
                ((h.rgb[2] / peak) * 0.7 + 0.3) * hb,
                GLOW.glow,
            );
        }
        // The toll: a gold pulse at the bell as the hour turns.
        const tollAge = this.time - this.U.toll.value.x;
        if (tollAge >= 0 && tollAge < 1.4 && this.parts.isles) {
            const a = this.parts.isles.anchors.bell;
            const bw = this.isleToWorld('spring', a.x, a.y - 4, a.z, this.scratch.c);
            const k = (1 - tollAge / 1.4) ** 2;
            const { key } = this.hour.colour;
            push(bw[0], bw[1], bw[2], 9 + tollAge * 12, key[0] * 4 * k, key[1] * 3.6 * k, key[2] * 2.6 * k, GLOW.glow);
        }
        // The children's trails and the brush heads.
        const poses = this.flock?.poses || [];
        for (let i = 0; i < poses.length; i++) {
            const pz = poses[i];
            const tr = this.trails[i];
            if (!tr) continue;
            const m = tr.pts.length / 3;
            if (pz.trail > 0 && pz.scale > 0) {
                tr.pts[tr.head * 3] = pz.pos[0];
                tr.pts[tr.head * 3 + 1] = pz.pos[1];
                tr.pts[tr.head * 3 + 2] = pz.pos[2];
                tr.head = (tr.head + 1) % m;
                tr.n = Math.min(m, tr.n + 1);
                const d = Math.hypot(pz.pos[0], pz.pos[1], pz.pos[2]);
                for (let k = 0; k < tr.n; k++) {
                    const j = (tr.head - 1 - k + m * 2) % m;
                    const f = 1 - k / m;
                    const b = 2.2 * f * pz.trail;
                    push(
                        tr.pts[j * 3],
                        tr.pts[j * 3 + 1],
                        tr.pts[j * 3 + 2],
                        d * 0.0035 * (0.5 + f * 0.6),
                        pz.colour[0] * b,
                        pz.colour[1] * b,
                        pz.colour[2] * b,
                        GLOW.glow,
                    );
                }
                if (pz.mode === 1) {
                    // The painter: a small warm mark of the link's colour (the bow brightens at the
                    // brush head itself, in optics: this only marks the child).
                    push(pz.pos[0], pz.pos[1], pz.pos[2], d * 0.006, pz.colour[0] * 1.5, pz.colour[1] * 1.5, pz.colour[2] * 1.5, GLOW.glow);
                }
            } else {
                tr.n = 0;
            }
        }
        // The paint's own light on the bows.
        this.emitPaint(push);
        // The sleepers in the grotto: a breathing warm heap behind the Mother Fall (night, dawn).
        const hearth = this.hour.scalar.hearth ?? 0;
        if (hearth > 0.02 && this.placement.spring) {
            const m = outletAt(this.parts.isles.outlets.spring, this.motherBearing());
            const n = Math.round(this.tier.sleepers * hearth);
            const base = this.isleToWorld('spring', m.x + m.nx * 3, m.y - 12, m.z + m.nz * 3, this.scratch.b);
            const warm = this.hour.colour.hearth;
            // Behind the water the falls carry the grotto's warmth themselves: the heap is only a
            // glimmer through the curtain, and the wide glow (an orange lump on the fall's head) goes.
            // (The glow layer draws over the transparent curtain, so a sprite "behind" the water
            // would sit on its face: behind the veil only the falls' own grotto glimmer shows.)
            const veiled = Boolean(this.parts.falls?.mesh?.visible);
            const through = veiled ? 0 : 1;
            for (let k = 0; k < (veiled ? 0 : n); k++) {
                const h0 = hash(k + 101);
                const h1 = hash(k * 3.1 + 7);
                const breathe = 0.7 + 0.3 * Math.sin((this.time * (0.25 + h1 * 0.2) + h0) * Math.PI * 2);
                const x = base[0] + (h0 - 0.5) * 14;
                const y = base[1] + h1 * 5 - 2;
                const z = base[2] + (hash(k * 5.7) - 0.5) * 6;
                const b = hearth * breathe * 1.6 * through;
                push(x, y, z, 1.6 + h1 * 1.2, warm[0] * b, warm[1] * b, warm[2] * b, GLOW.glow);
            }
            // The grotto's own warmth: one wide, dim glow round the heap (the night's warm note).
            if (!veiled) {
                const w = hearth * (0.55 + 0.1 * Math.sin(this.time * 0.6));
                push(base[0], base[1] + 2, base[2], 22, warm[0] * w, warm[1] * w * 0.85, warm[2] * w * 0.6, GLOW.soft);
            }
        }
        g.end();
    }

    update(sim, camera) {
        const dt = Math.max(0, sim.delta ?? 0);
        this.time = sim.time;
        this.integrate(dt);
        this.applyHour(this.time);
        this.stepDial(dt);
        this.writeStrokes();
        this.stepGlory();
        this.stepSpillway();
        // The broken span runs (two lines): it pours broad for 3 s.
        const spanAge = this.time - this.spanAt;
        if (this.fallCpu[SLOT.span]) {
            const rows = this.U.falls.array;
            rows[SLOT.span * 3 + 2].z = spanAge >= 0 && spanAge < 3.5 ? 1 + 1.2 * (1 - smooth(0.5, 3.5, spanAge)) : 1;
        }
        this.parts.isles?.update(dt, this.time);
        if (this.flock && this.parts.gliders) {
            this.bowInfo.dial = this.dial;
            this.parts.gliders.write(this.flock.sample(this.flightClock, this.bowInfo, this.hour.scalar.aloft ?? 1));
        }
        this.emitSpray();
        this.emitGlows();
        this.writeLamps();
        if (camera) this.parts.sky?.follow(camera);
        // The lens recovers.
        this.post.iris += (1 - this.post.iris) * approach(1.5, dt);
        this.post.flash *= Math.exp(-dt * 4);
        this.post.bloomBoost *= Math.exp(-dt * 2);
        this.post.flare[3] *= Math.exp(-dt * 2.5);
    }

    getPostState() {
        return this.post;
    }

    getState() {
        return {
            quality: this.quality,
            plan: this.frame.plan,
            place: this.wheel.placeAt(this.time),
            hour: this.hour.from,
            combo: this.combo,
            dial: this.dial,
            held: this.held.filter((h) => !h.released).length,
            A: { x: this.frame.Ascreen.x, y: this.frame.Ascreen.y },
            sunElevation: Math.asin(clamp(-this.frame.A[1], -1, 1)) / DEG,
        };
    }

    dispose() {
        Object.values(this.parts).forEach((part) => part.dispose?.());
        this.parts = {};
        this.textures.forEach((t) => t.dispose());
        this.textures = [];
        this.scene?.remove(this.root);
        this.root.clear();
        this.built = false;
    }
}

export { hexToLinear };
