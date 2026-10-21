/**
 * Spring — the fall's plan (CPU only, three-free).
 *
 * The river does not pour over a weir. It has cut a notch into its granite step and comes over
 * in tongues: the main one, thick and glassy at the brink, leaps free from a recess it has worn
 * under the lip; to its left the water runs down a stair of slabs and risers, whitening at every
 * step; to its right a thinner tongue leaps ledge to ledge; ribs of dark wet rock part them, and
 * threads spill over the ribs and at the ends. Beside the river the step's dry face climbs to
 * the shoulders of rock the notch is cut between.
 *
 * One description serves everything that must agree: the rock face (where the granite is, at
 * every height, across the step), the water (each column's path over the lip and down the face,
 * found by letting it fall: free, sliding down a slab, landing on a ledge and running off it),
 * the boil where the tongues meet the pool, and where the spray is thrown up.
 *
 * The fall's frame: `along` metres downstream of the lip's line (the river's direction at the
 * lip), `across` metres to the river's right there (seen from the eye, to the LEFT: the fall
 * faces the eye), heights in world metres.
 */
import { clamp, smooth } from './spring-core.js';
import { FALL, S_LIP, courseAt } from './spring-plan.js';

const LIP_COURSE = courseAt(S_LIP, {});

/** The lip's middle, the river's direction there (t) and across it (r, the river's right). */
export const FALL_FRAME = Object.freeze({
    x: LIP_COURSE.x,
    z: LIP_COURSE.z,
    tx: LIP_COURSE.tx,
    tz: LIP_COURSE.tz,
    rx: -LIP_COURSE.tz,
    rz: LIP_COURSE.tx,
    halfWidth: LIP_COURSE.halfWidth,
});

/** World x, z of a point in the fall's frame. */
export function fallToWorld(along, across, out = {}) {
    out.x = FALL_FRAME.x + FALL_FRAME.tx * along + FALL_FRAME.rx * across;
    out.z = FALL_FRAME.z + FALL_FRAME.tz * along + FALL_FRAME.rz * across;
    return out;
}

/** The fall's frame of a world point. */
export function worldToFall(x, z, out = {}) {
    const dx = x - FALL_FRAME.x;
    const dz = z - FALL_FRAME.z;
    out.along = dx * FALL_FRAME.tx + dz * FALL_FRAME.tz;
    out.across = dx * FALL_FRAME.rx + dz * FALL_FRAME.rz;
    return out;
}

/** The river's level above the lip, the pool's under it (m). */
export const LIP_Y = FALL.lip;
export const POOL_Y = FALL.pool;
const GRAVITY = FALL.gravity;

// ── The water over the lip ───────────────────────────────────────────────────────────

/**
 * The tongues: where across the lip each pours (m), its half-width (m) and how deep the water
 * runs over the rock there (m). Between them the rock stands dry or nearly.
 */
export const TONGUES = Object.freeze([
    Object.freeze({ at: -0.6, half: 5.0, depth: 1.3 }), // the main tongue, leaping free from its notch
    Object.freeze({ at: 12.6, half: 4.6, depth: 0.62 }), // left: down the stair of slabs
    Object.freeze({ at: -12.8, half: 4.2, depth: 0.5 }), // right: ledge to ledge
    Object.freeze({ at: 6.2, half: 0.4, depth: 0.1 }), // threads over the left rib
    Object.freeze({ at: -7.0, half: 0.6, depth: 0.15 }), // and over the right one
    Object.freeze({ at: 17.9, half: 0.5, depth: 0.16 }), // at the ends
    Object.freeze({ at: -17.9, half: 0.45, depth: 0.12 }),
]);
/** The ribs of rock between the tongues: where (m across), how wide (half, m), how far they stand out (m). */
export const RIBS = Object.freeze([
    Object.freeze({ at: 6.2, half: 1.9, out: 1.5 }),
    Object.freeze({ at: -7.0, half: 1.5, out: 1.2 }),
]);
/** The deepest water over the lip (the main tongue's): flow and speed are measured against it. */
export const DEEPEST = 1.3;

/** How deep the water runs over the lip at `across` (m; 0 where the rock stands dry). */
export function lipDepth(across) {
    let depth = 0;
    TONGUES.forEach((tongue, k) => {
        // Ragged edges: each tongue's sides wander a little.
        const ragged = 0.07 * Math.sin(across * 2.3 + k * 1.9) + 0.05 * Math.sin(across * 5.3 + k);
        const x = Math.abs(across - tongue.at) / tongue.half + ragged;
        const core = 0.9 + 0.1 * Math.sin(across * 1.7 + k * 0.6);
        depth = Math.max(depth, tongue.depth * core * (1 - smooth(0.7, 1.0, x)));
    });
    return depth;
}

/** The share of the river a column carries (0 dry … 1 the main tongue's core). */
export const lipFlow = (across) => clamp((lipDepth(across) / DEEPEST) ** 1.2, 0, 1);

/** The water's speed as it leaves the lip (m/s): thick water comes over faster. */
export const launchSpeed = (depth) => 0.8 + 2.8 * Math.sqrt(clamp(depth / DEEPEST, 0, 1));

/** How far the water's surface has dropped at the brink (m): it accelerates over the lip. */
export const drawdown = (across) => 0.25 * lipDepth(across);

/** The lip's line (m along): the main tongue's notch is worn back, the rest wanders a little. */
export function lipAlong(across) {
    const notch = 1 - smooth(4.6, 7.2, Math.abs(across + 0.6));
    return -1.1 * notch + 0.25 * Math.sin(across * 0.9 + 0.4) + 0.15 * Math.sin(across * 2.7);
}

/** The rock's crest at the lip (m): under the water by its depth, standing a little over it dry. */
export function lipCrest(across) {
    const depth = lipDepth(across);
    if (depth > 0.02) return LIP_Y - depth;
    return LIP_Y + 0.55 + 0.35 * Math.sin(across * 1.3 + 0.7) + 0.2 * Math.sin(across * 3.1);
}

// ── The rock face ───────────────────────────────────────────────────────────────────

/** Small deterministic hashing for the face's blocks. */
const hash = (i, j) => {
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const noise1 = (x, seed) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
};

/**
 * The rock's bedding: the step is dark schist laid down in layers (0.6–2.4 m thick, dipping a few
 * degrees), each standing a little in or out of the face, so the face climbs in ledges; cracks
 * cut through the layers every few metres. Precomputed crack positions across the step and layer
 * heights up it.
 */
const COLUMNS = (() => {
    const out = [-70];
    let k = 0;
    while (out[out.length - 1] < 70) {
        out.push(out[out.length - 1] + 3 + hash(k, 911) * 6);
        k++;
    }
    return Object.freeze(out);
})();
const SHEETS = (() => {
    const out = [-8];
    let k = 0;
    while (out[out.length - 1] < 75) {
        out.push(out[out.length - 1] + 0.6 + hash(k, 913) ** 1.5 * 1.8);
        k++;
    }
    return Object.freeze(out);
})();
/** The layers dip this much (m per m across), and wave a little. */
const DIP = 0.07;

/** Index of the last edge at or below v in a sorted table. */
function edgeBelow(table, v) {
    let lo = 0;
    let hi = table.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (table[mid] <= v) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/**
 * The block a face point lies in: its offset out of (or into) the face (about −0.5 … 0.5), and
 * how far the point is from the nearest joint (m), for bevelling the blocks' edges.
 */
export function faceBlock(across, y, out = {}) {
    // The cracks lean and wander as they climb.
    const u = across + 0.1 * (y - 20) + 0.9 * (noise1(y / 5.5, 17) - 0.5);
    const column = edgeBelow(COLUMNS, u);
    // The layers dip across the step and wave: folded a metre or two over tens of metres, so no
    // band runs level along the face like a course of masonry.
    const v = y + DIP * across + 0.35 * (noise1(across / 13, 19) - 0.5) + 2.6 * (noise1(across / 23, 21) - 0.5)
        + 0.7 * (noise1(across / 6.5, 23) - 0.5);
    const sheet = edgeBelow(SHEETS, v);
    // Each layer stands in or out along its length, broken where a crack crosses it: most nearly
    // flush, now and then one standing well out as a ledge or worn back under one.
    const h = hash(sheet, 923) - 0.5;
    const sheetOffset = 2 * h * Math.abs(h);
    const blockOffset = hash(column * 37 + sheet, 925) - 0.5;
    out.offset = sheetOffset * 0.9 + blockOffset * 0.35;
    const crack = Math.min(u - COLUMNS[column], COLUMNS[column + 1] - u) * 0.6;
    out.joint = Math.min(crack, v - SHEETS[sheet], SHEETS[sheet + 1] - v);
    out.band = sheet;
    out.column = column;
    return out;
}

/** The face's zones across the step: their weights at `across` (sum 1). */
function zoneWeights(across, out) {
    const left = smooth(6.0, 7.8, across) * (1 - smooth(17.6, 21.5, across));
    const right = (1 - smooth(-8.6, -7.0, across)) * smooth(-21.5, -17.6, across);
    const dry = smooth(17.6, 21.5, Math.abs(across));
    out.left = left;
    out.right = right;
    out.dry = dry;
    out.main = Math.max(0, 1 - left - right - dry);
    return out;
}

/**
 * The left stair: slab, riser, slab, riser (drop below the lip, m → metres out of the lip's line).
 * The water slides down each slab, leaps the riser below it and lands on the next.
 */
export const STAIR = Object.freeze({
    slabA: Object.freeze({ to: 6, out: 0.72 }),
    riserA: Object.freeze({ to: 13, out: -0.06 }),
    slabB: Object.freeze({ to: 19.5, out: 0.82 }),
    riserB: Object.freeze({ out: -0.05 }),
});
/** The right side's ledges: their drop below the lip (m) and how far they stand out (m). */
export const LEDGE_STEPS = Object.freeze([
    Object.freeze({ drop: 8.5, out: 4.3 }),
    Object.freeze({ drop: 17.5, out: 8.6 }),
]);
/** The main tongue's recess: the face leans back under the lip this much per metre down. */
export const UNDERCUT = 0.17;

function stairProfile(dz) {
    const a = STAIR.slabA.to * STAIR.slabA.out;
    if (dz < STAIR.slabA.to) return Math.max(0, dz) * STAIR.slabA.out;
    const b = a + (STAIR.riserA.to - STAIR.slabA.to) * STAIR.riserA.out;
    if (dz < STAIR.riserA.to) return a + (dz - STAIR.slabA.to) * STAIR.riserA.out;
    const c = b + (STAIR.slabB.to - STAIR.riserA.to) * STAIR.slabB.out;
    if (dz < STAIR.slabB.to) return b + (dz - STAIR.riserA.to) * STAIR.slabB.out;
    return c + (dz - STAIR.slabB.to) * STAIR.riserB.out;
}

function ledgeProfile(dz) {
    let out = -0.08 * Math.max(0, dz);
    let previous = 0;
    for (const step of LEDGE_STEPS) {
        // Each ledge's top is a rounded shelf, not a knife edge.
        out += (step.out - previous) * smooth(step.drop - 0.25, step.drop + 0.25, dz);
        previous = step.out;
    }
    return out;
}

const zones = {};
const block = {};

/**
 * Where the rock face stands at (across, y): metres along (downstream) of the lip's line. Above
 * the crest there is no face (the plateau and the shoulders are the valley's ground).
 */
export function faceAlong(across, y) {
    zoneWeights(across, zones);
    const dz = LIP_Y - y;
    const lip = lipAlong(across);
    // The main tongue's recess: the brink's rock rounds back, then the face leans in under the lip.
    const main = lip - 0.5 * smooth(0, 2.5, dz) - UNDERCUT * Math.max(0, dz - 1);
    const left = lip + stairProfile(dz);
    const right = lip + ledgeProfile(dz);
    // Beside the river: a broken face standing forward of the lip at its foot, leaning back as it
    // climbs (more in some places than others), bulging and hollowed on the scale of a house, in
    // buttresses and the gullies between them.
    const bulge = noise1(across / 9, 3) - 0.5 + 0.6 * (noise1(across / 4.2 + y / 11, 5) - 0.5);
    const buttress = noise1(across / 6.5, 41) - 0.5;
    const lean = 0.14 + 0.16 * noise1(across / 15, 43);
    const dry = lip + 2.2 + 2.2 * bulge + 3.2 * buttress * smooth(1, 6, dz) + lean * dz;
    let at = zones.main * main + zones.left * left + zones.right * right + zones.dry * dry;
    // The ribs between the tongues stand proud of the water either side, down to the boil.
    for (const rib of RIBS) {
        const k = 1 - smooth(0.55, 1, Math.abs(across - rib.at) / rib.half);
        at += k * rib.out * smooth(0.4, 3, dz) * (1 - smooth(9, 16, dz)) * (0.8 + 0.4 * noise1(y / 3.3, 29));
    }
    // The jointed blocks stand in and out; under the water they are worn nearly smooth.
    faceBlock(across, y, block);
    const bevel = smooth(0, 0.2, block.joint);
    const wet = lipDepth(across) > 0.02 ? 0.12 : 0.9;
    at += block.offset * wet * (0.35 + 0.65 * bevel);
    return at;
}

/** The face's slope at (across, y): metres out per metre down (by a central difference). */
export function faceSlope(across, y, h = 0.12) {
    return (faceAlong(across, y - h) - faceAlong(across, y + h)) / (2 * h);
}

// ── The water's paths ───────────────────────────────────────────────────────────────

/** Water's motion: free in the air, sliding on a slab, running off a ledge. */
export const POUR = Object.freeze({ free: 0, slide: 1, run: 2 });
/** The water film's thickness over the rock it runs on (m; the sheet's rows are a chord apart). */
const FILM = 0.3;
/** A surface sloping out more than this (m per m down) is a ledge's top, not a slab. */
const LEDGE_TOP = 2.4;
/** Turbulent drag on a slab (per metre): the speed a slide settles to is about √(g / k). */
const SLAB_DRAG = 0.045;
/** Paths are traced this long at most (s), in steps of this (s). */
export const POUR_TIME = 4.6;
const STEP = 0.004;

/**
 * One column's path from the lip to under the pool's surface: samples every STEP seconds of
 * { along, y, t, mode, white (the last impact's burst, 0..1, fading), speed }. Null for a dry
 * column. `extraDepth` deepens the water (the flood, in tests).
 */
export function pourPath(across, extraDepth = 0) {
    const depth = lipDepth(across) + extraDepth;
    if (depth <= 0.02) return null;
    const out = [];
    // The water's face starts a film's thickness out from the rock's edge.
    let x = lipAlong(across) + FILM + 0.02;
    let y = LIP_Y - 0.25 * depth;
    let vx = launchSpeed(depth);
    let vy = 0;
    let mode = POUR.free;
    let t = 0;
    let burst = 0;
    let burstAt = -10;
    const push = () => {
        const white = burst * Math.exp(-(t - burstAt) / 0.45);
        out.push({
            along: x, y, t, mode, white, speed: Math.hypot(vx, vy),
        });
    };
    push();
    // A slab's tangent (down the slab, unit): (s, −1) / √(1 + s²).
    let guard = 0;
    while (t < POUR_TIME && y > POOL_Y - 1.4 && guard++ < 4000) {
        t += STEP;
        if (mode === POUR.free) {
            vy -= GRAVITY * STEP;
            const nx = x + vx * STEP;
            const ny = y + vy * STEP;
            const face = faceAlong(across, ny);
            if (nx >= face + FILM) {
                x = nx;
                y = ny;
            } else {
                const speed = Math.hypot(vx, vy);
                const slope = faceSlope(across, ny);
                if (slope > LEDGE_TOP) {
                    // It lands on a ledge's top: a burst of white, then it runs out over the edge.
                    burst = Math.max(burst * Math.exp(-(t - burstAt) / 0.45), clamp(speed / 11, 0.3, 1));
                    burstAt = t;
                    mode = POUR.run;
                    vx = clamp(0.25 * speed, 1.8, 4);
                    vy = 0;
                    x = nx;
                    y = ny;
                    // Onto the shelf's top: up out of the rock its rounded edge reaches into.
                    for (let climb = 0; climb < 40 && faceAlong(across, y) > x - FILM; climb += 1) y += 0.025;
                } else if (slope < 0.12) {
                    // A glancing touch on a face that does not lean out: pushed off it, it falls on.
                    x = face + FILM;
                    y = ny;
                    vx = Math.max(vx, 0.3);
                } else {
                    // It meets a slab: the part of its speed into the rock is lost in a burst.
                    const l = Math.hypot(slope, 1);
                    const tx = slope / l;
                    const ty = -1 / l;
                    const along = vx * tx + vy * ty;
                    const into = Math.abs(vx * ty - vy * tx);
                    burst = Math.max(burst * Math.exp(-(t - burstAt) / 0.45), clamp(into / 9, 0.15, 1));
                    burstAt = t;
                    const v = Math.max(1.5, along * 0.85);
                    vx = v * tx;
                    vy = v * ty;
                    mode = POUR.slide;
                    y = ny;
                    x = face + FILM;
                }
            }
        } else if (mode === POUR.slide) {
            const slope = faceSlope(across, y);
            const l = Math.hypot(slope, 1);
            let v = Math.hypot(vx, vy);
            v += (GRAVITY / l - SLAB_DRAG * v * v) * STEP;
            const ny = y - (v * STEP) / l;
            const nextSlope = faceSlope(across, ny);
            if (nextSlope < slope - 0.45 || nextSlope < 0) {
                // The slab ends over a riser: the water leaps on as it was moving.
                mode = POUR.free;
                vx = (v * slope) / l;
                vy = -v / l;
            } else {
                vx = (v * slope) / l;
                vy = -v / l;
                y = ny;
                x = faceAlong(across, y) + FILM;
            }
        } else {
            // Running out over a ledge's top toward its edge, a little downhill.
            x += vx * STEP;
            y -= 0.04 * vx * STEP;
            if (x > faceAlong(across, y - 0.35) + FILM) {
                mode = POUR.free;
                vy = -0.4;
            }
        }
        push();
    }
    return out;
}

/** A path's sample at time t (s; linear between steps, held at the end). */
export function pathAt(path, t, out = {}) {
    const f = clamp(t / STEP, 0, path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f));
    const k = f - i;
    const a = path[i];
    const b = path[Math.min(path.length - 1, i + 1)];
    out.along = a.along + (b.along - a.along) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.mode = k < 0.5 ? a.mode : b.mode;
    out.white = a.white + (b.white - a.white) * k;
    out.speed = a.speed + (b.speed - a.speed) * k;
    out.ended = t >= path[path.length - 1].t;
    return out;
}

// ── Where the water lands ─────────────────────────────────────────────────────────

/** The table of landings, one entry every LANDING_STEP m across the lip. */
const LANDING_STEP = 0.5;
const LANDING_SPAN = 21;

/**
 * Where each column's water meets the pool (m along), how hard (0..1: its share of the river
 * times how fast it falls), and the bursts on the face on its way down (along, y, power).
 */
export const LANDINGS = Object.freeze((() => {
    const rows = [];
    for (let across = -LANDING_SPAN; across <= LANDING_SPAN + 1e-6; across += LANDING_STEP) {
        const path = pourPath(across);
        if (!path) {
            rows.push(Object.freeze({ across, along: 0, power: 0 }));
            continue;
        }
        let hit = path[path.length - 1];
        for (const p of path) {
            if (p.y <= POOL_Y) {
                hit = p;
                break;
            }
        }
        rows.push(Object.freeze({
            across, along: hit.along, power: lipFlow(across) * clamp(hit.speed / 18, 0.25, 1),
        }));
    }
    return rows;
})());

/** The bursts on the face (where water lands on a ledge or a slab), for the spray. */
export const BURSTS = Object.freeze((() => {
    const out = [];
    for (let across = -18.5; across <= 18.5; across += 1.0) {
        const path = pourPath(across);
        if (!path) continue;
        let last = 0;
        for (const p of path) {
            if (p.white > 0.5 && p.white > last + 0.2 && p.y > POOL_Y + 1) {
                out.push(Object.freeze({
                    across, along: p.along, y: p.y, power: p.white * lipFlow(across),
                }));
            }
            last = p.white;
        }
    }
    return out;
})());

/**
 * The boil on the pool at (along, across) in the fall's frame (0..1): white where the tongues
 * land, rolling out downstream and thinning.
 */
export function poolBoil(along, across) {
    const f = (across + LANDING_SPAN) / LANDING_STEP;
    let boil = 0;
    // The landings within a couple of metres across spread their boil sideways.
    for (let k = Math.floor(f) - 4; k <= Math.ceil(f) + 4; k++) {
        if (k < 0 || k >= LANDINGS.length) continue;
        const row = LANDINGS[k];
        if (row.power <= 0) continue;
        const side = Math.exp(-(((row.across - across) / 1.8) ** 2));
        const d = along - row.along;
        const ring = Math.exp(-((d / 5) ** 2));
        const rolled = d > 0 ? Math.exp(-d / 26) * 0.95 : Math.exp(d / 2.5) * 0.6;
        boil = Math.max(boil, row.power * side * Math.max(ring, rolled));
    }
    return clamp(boil * 1.25, 0, 1);
}
