/**
 * Summer — where the swans go (numbers only: summer-swans.js draws them).
 *
 * Both of the swans' ways are found through the rest camera at 16:9, the frame the picture is
 * composed for:
 *  - THE ROUND the family swims: the largest oval of open water that shows beside the board
 *    (deeper than 0.4 m, 18 to 70 m from the eye, clear of the card, of the spruce at the frame's
 *    left edge, of the meadow's flowers and the shore's reeds). The water left of the board is
 *    taken first: in single player the stats stand right of it. The cob leads round the oval at
 *    an even pace, the pen and the cygnets swim the same line a few seconds behind him.
 *  - A FLIGHT across the lake: candidate lines are laid through the lens (how deep they are at
 *    the frame's two edges, how they bend, how high they come in, how low they cross) and scored
 *    there. The best is seen longest in the side thirds, comes down behind the card, crosses the
 *    water left of it low under the evening sun without crossing its disc, takes 9 to 12 s from
 *    edge to edge, and begins and ends beyond the widest frame the theme is ever shown in.
 *
 * Everything is a closed form of the clock (the round) or of the seconds since a skein went up
 * (a flight): a seek to any time lands where play would have, nothing is integrated from frame
 * to frame, and nothing is allocated once a route is laid.
 */
import { summerEye, summerViewFor } from './summer-composition.js';
import { SUMMER_HOURS, summerSunDirection } from './summer-hours.js';
import { SUMMER_DEFAULT_BOARD } from './summer-stage.js';
import { summerGroundHeight, summerShores } from './summer-terrain.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** The frame the birds are sited in: the landscape rest camera at 16:9. */
export const SWAN_REST_ASPECT = 16 / 9;
/** The widest frame a flight must begin and end outside of (summer-composition.js's widest, and a little). */
const WIDEST_ASPECT = 2.6;
/** The most birds a skein can have. */
export const SWAN_SKEIN_MOST = 9;

// ── The rest camera ──────────────────────────────────────────────────────────

/**
 * The rest lens for an aspect: `project(x, y, z)` gives a world point's place on screen (x right,
 * y down, fractions; `depth` metres along the view; null behind the eye) and `point(sx, sy,
 * depth)` the world point seen there.
 */
export function summerSwanLens(aspect = SWAN_REST_ASPECT) {
    const view = summerViewFor(aspect);
    const eye = summerEye(view);
    let fx = view.target[0] - eye[0];
    let fy = view.target[1] - eye[1];
    let fz = view.target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const rl = Math.hypot(fz, fx);
    const rx = -fz / rl;
    const rz = fx / rl;
    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;
    const tanV = Math.tan((view.fov * Math.PI) / 360);
    const tanH = tanV * aspect;
    return {
        aspect,
        eye,
        tanV,
        tanH,
        project(x, y, z, out = { x: 0, y: 0, depth: 0 }) {
            const dx = x - eye[0];
            const dy = y - eye[1];
            const dz = z - eye[2];
            const depth = dx * fx + dy * fy + dz * fz;
            if (!(depth > 0.5)) return null;
            out.x = 0.5 + ((dx * rx + dz * rz) / (depth * tanH)) * 0.5;
            out.y = 0.5 - ((dx * ux + dy * uy + dz * uz) / (depth * tanV)) * 0.5;
            out.depth = depth;
            return out;
        },
        point(sx, sy, depth, out = [0, 0, 0]) {
            const across = (sx * 2 - 1) * depth * tanH;
            const high = (1 - sy * 2) * depth * tanV;
            out[0] = eye[0] + fx * depth + rx * across + ux * high;
            out[1] = eye[1] + fy * depth + uy * high;
            out[2] = eye[2] + fz * depth + rz * across + uz * high;
            return out;
        },
    };
}

/** The board card's sides in the rest frame, and what else stands in front of the lake there. */
const FRAME = Object.freeze({
    card: Object.freeze([SUMMER_DEFAULT_BOARD.x0, SUMMER_DEFAULT_BOARD.x1]),
    // The old spruce leaning in from the left edge, and the frame's own edge on the right.
    left: 0.115,
    right: 0.955,
    // In single player the stats stand right of the board (main.css: 60 px past the stage, 140 px
    // wide, half the window's height): a bird there is not counted as seen.
    stats: Object.freeze({
        x0: 0.64, x1: 0.74, y0: 0.27, y1: 0.73,
    }),
    // The weeping birch's crown in the top right.
    birch: Object.freeze({ x0: 0.66, y1: 0.3 }),
});

const lensScratch = { x: 0, y: 0, depth: 0 };

// ── The round on the water ───────────────────────────────────────────────────

/**
 * The family's water: how deep the bed must lie under a swan, how far from the eye it may swim,
 * how much of the frame is kept clear beside the card, the line on screen the meadow's flowers
 * stand up to in front of the lake (a swan's waterline must show above it: read off the theme's
 * own frame, 2026-11-17), what stands on the near land between the eye and the lake (flowers;
 * reeds at the water's edge and in its first shallows; wood on the other banks), the family's
 * pace (m/s) and its own reach around the leader's line (the search keeps that much water clear).
 */
export const SWAN_ROUND = Object.freeze({
    deep: -0.4,
    range: Object.freeze([18, 70]),
    beside: 0.02,
    meadow: 0.578,
    flowers: 1.0,
    reeds: 1.7,
    wood: 12,
    speed: 0.42,
    reach: 1.2,
});

/** True for the near meadow: the flowering land the camera stands on, between the wooded banks. */
function onMeadow(x, z) {
    const shores = summerShores(x, z);
    return shores.near > 0 && shores.homestead <= 0 && x > -20.5 && x < 18.5;
}

/** True when the land between the rest eye and a point on the lake leaves its waterline in sight. */
function sightClear(lens, x, z, groundHeight) {
    const [ex, ey, ez] = lens.eye;
    const range = Math.hypot(x - ex, z - ez);
    for (let d = 2; d < range - 1; d += d < 36 ? 2 : 4) {
        const t = d / range;
        const px = ex + (x - ex) * t;
        const pz = ez + (z - ez) * t;
        const ground = groundHeight(px, pz);
        if (ground > -0.65) {
            let stands = SWAN_ROUND.reeds;
            if (ground >= 0.3) stands = onMeadow(px, pz) ? SWAN_ROUND.flowers : SWAN_ROUND.wood;
            if (ey + (0.2 - ey) * t < Math.max(ground, 0) + stands) return false;
        }
    }
    return true;
}

/**
 * Where a swan on the lake at (x, z) shows in the rest frame: 0 nowhere (too shallow, too near
 * or far, off the frame, behind the card or the spruce, under the meadow's flowers, hidden by
 * the land), -1 in the left third, 1 in the right.
 */
export function swanWaterSide(lens, x, z, groundHeight = summerGroundHeight) {
    if (!(groundHeight(x, z) < SWAN_ROUND.deep)) return 0;
    const range = Math.hypot(x - lens.eye[0], z - lens.eye[2]);
    if (range < SWAN_ROUND.range[0] || range > SWAN_ROUND.range[1]) return 0;
    const s = lens.project(x, 0, z, lensScratch);
    if (!s || s.y < 0.08 || s.y > SWAN_ROUND.meadow) return 0;
    let side = 0;
    if (s.x >= FRAME.left && s.x <= FRAME.card[0] - SWAN_ROUND.beside) side = -1;
    else if (s.x >= FRAME.card[1] + SWAN_ROUND.beside && s.x <= FRAME.right) side = 1;
    if (side === 0) return 0;
    return sightClear(lens, x, z, groundHeight) ? side : 0;
}

/** Metres round the family's line: two straights of 2 (a - b) and two half circles of radius b. */
export function swanRoundLap(round) {
    return 4 * (round.a - round.b) + TAU * round.b;
}

/**
 * The leader's line `run` metres round it (any run: it comes round): its place (out[0], out[1] =
 * x, z) and unit heading (out[2], out[3]). A long round with half-circle ends, swum at one pace,
 * with a slow weave across it so the line is never ruler-straight.
 */
export function swanRoundPoint(round, run, out = [0, 0, 0, 0]) {
    const { a, b } = round;
    const half = a - b;
    const lap = 4 * half + TAU * b;
    const s = ((run % lap) + lap) % lap;
    let p;
    let q;
    let hp;
    let hq;
    if (s < 2 * half) {
        p = half - s;
        q = b;
        hp = -1;
        hq = 0;
    } else if (s < 2 * half + Math.PI * b) {
        const phi = (s - 2 * half) / b;
        p = -half - b * Math.sin(phi);
        q = b * Math.cos(phi);
        hp = -Math.cos(phi);
        hq = -Math.sin(phi);
    } else if (s < 4 * half + Math.PI * b) {
        p = s - 3 * half - Math.PI * b;
        q = -b;
        hp = 1;
        hq = 0;
    } else {
        const phi = (s - 4 * half - Math.PI * b) / b;
        p = half + b * Math.sin(phi);
        q = -b * Math.cos(phi);
        hp = Math.cos(phi);
        hq = Math.sin(phi);
    }
    // The weave: three slow swings a lap, across the line (its left is (hq, -hp) in these axes).
    const swing = (TAU * 3) / lap;
    const weave = round.meander * Math.sin(swing * s + 0.7);
    const lean = round.meander * swing * Math.cos(swing * s + 0.7);
    p += hq * weave;
    q -= hp * weave;
    const tp = hp + hq * lean;
    const tq = hq - hp * lean;
    const length = Math.hypot(tp, tq);
    const ct = Math.cos(round.tilt);
    const st = Math.sin(round.tilt);
    out[0] = round.x + ct * p - st * q;
    out[1] = round.z + st * p + ct * q;
    out[2] = (ct * tp - st * tq) / length;
    out[3] = (st * tp + ct * tq) / length;
    return out;
}

/**
 * A member of the family at `time`: it swims the leader's line `delay` seconds behind, a little
 * to one side (`side` metres, with a slow wander of its own). Writes x, z and the unit heading.
 */
export function swanFamilyPlace(round, member, time, out = [0, 0, 0, 0]) {
    swanRoundPoint(round, SWAN_ROUND.speed * (time + round.offset - member.delay), out);
    const aside = member.side + member.wander * Math.sin(time * member.rate + member.phase);
    // The heading's left is (hz, -hx) seen from above (x right, z toward the eye).
    out[0] += out[3] * aside;
    out[1] -= out[2] * aside;
    return out;
}

/**
 * The family, in order: the cob, the pen, then her cygnets (their delays, sides and wanders).
 * They are drawn a little larger than life (`size`), so they still read from across the lake.
 */
export function swanFamily(cygnets) {
    const members = [
        {
            kind: 'cob', delay: 0, side: 0, wander: 0.12, rate: 0.11, phase: 0.4, size: 1.28,
        },
        {
            kind: 'pen', delay: 5.6, side: -0.25, wander: 0.2, rate: 0.13, phase: 2.1, size: 1.16,
        },
    ];
    for (let i = 0; i < cygnets; i += 1) {
        members.push({
            kind: 'cygnet',
            delay: 9.2 + i * 2.1 + (i % 2) * 0.5,
            side: (i % 2 ? 0.36 : -0.32) * (1 + 0.2 * (i >> 1)),
            wander: 0.22,
            rate: 0.19 + 0.045 * i,
            phase: 1.3 + i * 2.4,
            size: 1.25 - 0.06 * (i % 3),
        });
    }
    return members;
}

/** The sizes a round is tried in, largest first: half its length and the radius of its ends (m). */
const ROUND_SIZES = Object.freeze([
    [10, 2.4], [10, 1.7], [8.5, 2.4], [8.5, 1.7], [7, 2.2], [7, 1.6], [5.5, 1.6], [4, 1.5],
]);

/** A round from where it lies (x, z), its size (a, b), its slant and its side of the board. */
export function swanRound({
    x, z, a, b, tilt, side,
}) {
    const round = {
        x, z, a, b, tilt, side, meander: Math.min(0.3, b * 0.14), offset: 9,
    };
    round.period = swanRoundLap(round) / SWAN_ROUND.speed;
    return Object.freeze(round);
}

const outline = {
    x: 0, z: 0, a: 1, b: 1, tilt: 0, meander: 0,
};
const outlinePoint = [0, 0, 0, 0];

/**
 * True when a round holds on the lake itself: its line, with the family's reach around it, shows
 * on the round's side of the board all the way round (`shows(x, z, side)`: by default the lake).
 */
export function swanRoundHolds(lens, round, groundHeight = summerGroundHeight, shows = null, points = 28) {
    Object.assign(outline, {
        x: round.x, z: round.z, a: round.a + SWAN_ROUND.reach, b: round.b + SWAN_ROUND.reach, tilt: round.tilt,
    });
    const lap = swanRoundLap(outline);
    for (let k = 0; k < points; k += 1) {
        swanRoundPoint(outline, (k / points) * lap, outlinePoint);
        const [x, z] = outlinePoint;
        const seen = shows ? shows(x, z, round.side) : swanWaterSide(lens, x, z, groundHeight) === round.side;
        if (!seen) return false;
    }
    return true;
}

/**
 * The family's round: the long round of open water that shows beside the board in the rest
 * frame, as large as the water there allows (up to 20 m long) and as near the eye as the
 * meadow's flowers let it be seen. The water left of the board is taken before the water right
 * of it (in single player the stats stand there). Null when the lake shows no such water.
 *
 * The lake is first read on a 2 m grid, where every size, place and slant of round is tried
 * cheaply; the best few of the largest size that fits are then held to the lake itself (the
 * line with the family's reach around it, point by point), and the first that holds is taken.
 */
export function planSwanRound({ aspect = SWAN_REST_ASPECT, groundHeight = summerGroundHeight } = {}) {
    const lens = summerSwanLens(aspect);
    const grid = {
        x0: -60, z0: -66, step: 2, cols: 46, rows: 29,
    };
    const sides = new Int8Array(grid.cols * grid.rows);
    for (let j = 0; j < grid.rows; j += 1) {
        for (let i = 0; i < grid.cols; i += 1) {
            const x = grid.x0 + i * grid.step;
            sides[j * grid.cols + i] = swanWaterSide(lens, x, grid.z0 + j * grid.step, groundHeight);
        }
    }
    // Open at a point, as the grid has it: the cell nearest it shows on that side.
    const open = (x, z, side) => {
        const i = Math.round((x - grid.x0) / grid.step);
        const j = Math.round((z - grid.z0) / grid.step);
        return i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && sides[j * grid.cols + i] === side;
    };
    for (const side of [-1, 1]) {
        for (const [a, b] of ROUND_SIZES) {
            const found = [];
            for (let j = 1; j < grid.rows - 1; j += 1) {
                for (let i = 1; i < grid.cols - 1; i += 1) {
                    if (sides[j * grid.cols + i] === side) {
                        const x = grid.x0 + i * grid.step;
                        const z = grid.z0 + j * grid.step;
                        for (const tilt of [0, 0.14, -0.14, 0.28, -0.28]) {
                            const round = {
                                x, z, a, b, tilt, side, score: 0,
                            };
                            if (swanRoundHolds(lens, round, groundHeight, open, 20)) {
                                // Nearer the eye is larger on screen; a level round shows the birds side on.
                                round.score = -Math.hypot(x - lens.eye[0], z - lens.eye[2]) - Math.abs(tilt) * 6;
                                found.push(round);
                            }
                        }
                    }
                }
            }
            found.sort((q, r) => r.score - q.score);
            const held = found.slice(0, 4).find((round) => swanRoundHolds(lens, round, groundHeight));
            if (held) return swanRound(held);
        }
    }
    return null;
}

// ── A flight across the lake ─────────────────────────────────────────────────

/**
 * A flight: how fast the skein flies (m/s), how long its crossing of the 16:9 frame should take
 * (s), the least it must be seen in the left third (s), how high it keeps over the water and over
 * wooded land (m), how it climbs away outside the frame (the slope, and the metres over which it
 * sets in), and the V's slots (m: each rank this far out and back from the one ahead, and a
 * little higher).
 */
export const SWAN_FLIGHT = Object.freeze({
    speed: 10,
    crossing: Object.freeze([9, 12]),
    seen: 3,
    low: 3,
    trees: 12,
    climb: 0.2,
    ease: 22,
    rank: Object.freeze({ out: 2.1, back: 2.7, up: 0.14 }),
    // Like the family, the skein is drawn a little larger than life.
    size: 1.22,
    // Wingbeats a second (slow: a swan's), each bird's own spread about it, and the stroke.
    beat: 2.3,
    spread: 0.07,
    arm: Object.freeze([0.1, 0.56]),
    hand: Object.freeze([-0.1, 0.36, 0.95]),
    heave: 0.045,
});

/**
 * Where a line meets the rest frame (screen x): its two edges, and where the skein, coming down
 * since the right edge, is down (behind the card, before it shows left of it).
 */
const MARKS = Object.freeze({ enter: 1, level: 0.41, leave: 0 });

/** Where the evening sun stands in the rest frame (screen fractions), as summer-hours.js has it. */
export function swanSunOnScreen(lens) {
    const [x, y, z] = summerSunDirection(SUMMER_HOURS[0].sunAzimuth, SUMMER_HOURS[0].sunElevation);
    return lens.project(lens.eye[0] + x * 1000, lens.eye[1] + y * 1000, lens.eye[2] + z * 1000);
}

/** Metres gained `d` metres into a climb that sets in gently (0 before it). */
const climbed = (d) => {
    if (d <= 0) return 0;
    const k = SWAN_FLIGHT.ease;
    return d < k ? (d * d) / (2 * k) : d - k / 2;
};
const climbing = (d) => (d <= 0 ? 0 : Math.min(d / SWAN_FLIGHT.ease, 1));

/**
 * The leader's place `run` metres along a flight's line (out[0..2]) and its unit heading
 * (out[3..5]). The ground track is a gentle arc from `from` through to `to` ([x, z]); the height
 * comes down from `high` to `low` between the runs `enter` and `level`, stays low across the lake,
 * and climbs away before `enter` and after `leave` (outside the 16:9 frame). Any run will do: a
 * bird behind the leader is on the line before its start.
 */
export function swanFlightPoint(route, run, out = [0, 0, 0, 0, 0, 0]) {
    const u = run / route.length;
    const v = 1 - u;
    const { from, via, to } = route;
    out[0] = v * v * from[0] + 2 * u * v * via[0] + u * u * to[0];
    out[2] = v * v * from[1] + 2 * u * v * via[1] + u * u * to[1];
    const tx = 2 * v * (via[0] - from[0]) + 2 * u * (to[0] - via[0]);
    const tz = 2 * v * (via[1] - from[1]) + 2 * u * (to[1] - via[1]);
    const flat = Math.hypot(tx, tz) || 1;
    const fall = route.level - route.enter;
    const w = clamp((run - route.enter) / fall, 0, 1);
    const drop = route.high - route.low;
    out[1] = route.low + drop * (1 - w * w * (3 - 2 * w))
        + SWAN_FLIGHT.climb * (climbed(route.enter - run) + climbed(run - route.leave));
    const slope = (-drop * 6 * w * (1 - w)) / fall
        + SWAN_FLIGHT.climb * (climbing(run - route.leave) - climbing(route.enter - run));
    const length = Math.hypot(1, slope);
    out[3] = tx / flat / length;
    out[4] = slope / length;
    out[5] = tz / flat / length;
    return out;
}

/** What stands on the land under a flight: wood nearly everywhere, flowers on the near meadow. */
function standing(x, z, ground) {
    if (!(ground > 0.15)) return 0;
    return onMeadow(x, z) ? 1.3 : SWAN_FLIGHT.trees - SWAN_FLIGHT.low;
}

/** True when a bird at a place is hidden from the rest eye by land and what grows on it. */
function behindLand(lens, x, y, z, groundHeight) {
    const [ex, ey, ez] = lens.eye;
    for (let k = 1; k <= 7; k += 1) {
        const t = 0.2 + k * 0.1;
        const px = ex + (x - ex) * t;
        const pz = ez + (z - ez) * t;
        const ground = groundHeight(px, pz);
        if (ground > 0.15 && ey + (y - ey) * t < ground + standing(px, pz, ground)) return true;
    }
    return false;
}

/**
 * Score one line through the rest lens: seconds the leader shows in each side third, how near
 * the evening sun it passes, how long its crossing takes, how large it is drawn. Null when it
 * is no flight at all (it runs into the wood, or is too briefly seen left of the board).
 */
function scoreFlight(lens, sun, route, groundHeight) {
    const point = [0, 0, 0, 0, 0, 0];
    const s = { x: 0, y: 0, depth: 0 };
    const dt = 0.4;
    let left = 0;
    let right = 0;
    let nearest = Infinity;
    let size = 0;
    for (let t = 0; t * SWAN_FLIGHT.speed <= route.length; t += dt) {
        swanFlightPoint(route, t * SWAN_FLIGHT.speed, point);
        const [x, y, z] = point;
        const ground = groundHeight(x, z);
        if (y < Math.max(ground, 0) + SWAN_FLIGHT.low + standing(x, z, ground)) return null;
        if (lens.project(x, y, z, s) && s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1) {
            nearest = Math.min(nearest, Math.hypot((s.x - sun.x) * lens.aspect, s.y - sun.y));
            const clear = s.y > 0.05 && s.y < 0.6;
            if (clear && s.x > FRAME.left && s.x < FRAME.card[0] - 0.01) {
                left += dt;
                size += dt / s.depth;
            } else if (clear && s.x > FRAME.card[1] + 0.01 && s.x < 0.97) {
                const { stats } = FRAME;
                const covered = s.x > stats.x0 && s.x < stats.x1 && s.y > stats.y0 && s.y < stats.y1;
                if (!covered && !behindLand(lens, x, y, z, groundHeight)) {
                    right += s.x > FRAME.birch.x0 && s.y < FRAME.birch.y1 ? dt * 0.4 : dt;
                }
            }
        }
    }
    if (left < SWAN_FLIGHT.seen) return null;
    const crossing = (route.leave - route.enter) / SWAN_FLIGHT.speed;
    const [quick, slow] = SWAN_FLIGHT.crossing;
    const late = Math.max(0, quick - crossing, crossing - slow);
    // Near the sun's road, never through its disc: best about an eighth of the frame's height off.
    const road = Math.exp(-(((nearest - 0.13) / 0.07) ** 2));
    const score = Math.min(left, 5.5) + 1.5 * Math.min(right, 2) + 2.2 * road - (nearest < 0.07 ? 5 : 0)
        - 2 * late + 150 * (size / Math.max(left, dt));
    return {
        score, left, right, crossing, sun: nearest,
    };
}

/**
 * The lines a skein may fly, best first: each comes from beyond the right edge of the widest
 * frame, over the homestead's wood, shows in the open sky right of the board on its way down,
 * is down behind the card, crosses the water left of it low under the evening sun and climbs
 * away past the left edge (a launch may fly it the other way). Candidates are laid through the
 * rest lens (how deep the line is at the frame's two edges, how it bends, how high it comes in
 * and how low it crosses) and scored there; `route.seen` keeps what the score read.
 */
export function planSwanFlights({ aspect = SWAN_REST_ASPECT, groundHeight = summerGroundHeight } = {}) {
    const lens = summerSwanLens(aspect);
    const sun = { ...swanSunOnScreen(lens) };
    const routes = [];
    const beyond = 0.5 * (WIDEST_ASPECT / aspect) + 0.09;
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const p = [0, 0, 0, 0, 0, 0];
    const s = { x: 0, y: 0, depth: 0 };
    // Walk a line outward from (x, z) until it is past the widest frame's edge on `side`.
    const outward = (x0, z0, dx, dz, side) => {
        for (let run = 6; run <= 160; run += 6) {
            const at = lens.project(x0 + dx * run, 6, z0 + dz * run, s);
            if (!at || (at.x - 0.5) * side > beyond) return [x0 + dx * run, z0 + dz * run];
        }
        return null;
    };
    for (const rightDepth of [44, 54]) {
        lens.point(1, 0.5, rightDepth, a);
        for (const leftDepth of [66, 78, 92]) {
            lens.point(0, 0.5, leftDepth, b);
            const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
            const dx = (b[0] - a[0]) / span;
            const dz = (b[2] - a[2]) / span;
            const from = outward(a[0], a[2], -dx, -dz, 1);
            const to = outward(b[0], b[2], dx, dz, -1);
            for (const bulge of from && to ? [0, 8, -8] : []) {
                const via = [(from[0] + to[0]) / 2 + dz * bulge, (from[1] + to[1]) / 2 - dx * bulge];
                const track = {
                    from, via, to, length: 1, low: 6, high: 6, enter: 0, level: 1, leave: 1,
                };
                // The line's length by its chords, then the runs where it meets the frame's marks.
                let length = 0;
                let px = from[0];
                let pz = from[1];
                for (let k = 1; k <= 24; k += 1) {
                    swanFlightPoint(track, k / 24, p);
                    length += Math.hypot(p[0] - px, p[2] - pz);
                    px = p[0];
                    pz = p[2];
                }
                track.length = length;
                const runs = { enter: -1, level: -1, leave: -1 };
                let edgeDepth = 0;
                for (let run = 0; run <= length; run += 2) {
                    swanFlightPoint(track, run, p);
                    const at = lens.project(p[0], 6, p[2], s);
                    if (at) {
                        for (const key of Object.keys(runs)) {
                            if (runs[key] < 0 && at.x <= MARKS[key]) {
                                runs[key] = run;
                                if (key === 'enter') edgeDepth = at.depth;
                            }
                        }
                    }
                }
                const whole = runs.enter >= 0 && runs.level > runs.enter && runs.leave > runs.level;
                for (const edgeY of whole ? [0.27, 0.32] : []) {
                    const high = lens.point(MARKS.enter, edgeY, edgeDepth, b)[1];
                    for (const low of [6, 8]) {
                        const route = {
                            from,
                            via,
                            to,
                            length,
                            low,
                            high,
                            enter: runs.enter,
                            level: runs.level,
                            leave: runs.leave,
                        };
                        const seen = scoreFlight(lens, sun, route, groundHeight);
                        if (seen) {
                            routes.push(Object.freeze({
                                ...route,
                                from: Object.freeze(from.slice()),
                                via: Object.freeze(via.slice()),
                                to: Object.freeze(to.slice()),
                                seen: Object.freeze(seen),
                            }));
                        }
                    }
                }
            }
        }
    }
    routes.sort((q, r) => r.seen.score - q.seen.score);
    return routes;
}

/** The wing's two turns and the body's heave at beat phase `theta` (0 the top of the stroke). */
export function swanWingbeat(theta, out = [0, 0, 0]) {
    // The downstroke takes longer than the upstroke: the phase is warped, monotonic.
    const phi = theta - 0.26 * (1 - Math.cos(theta));
    const [armMean, armSwing] = SWAN_FLIGHT.arm;
    const [handMean, handSwing, lag] = SWAN_FLIGHT.hand;
    out[0] = armMean + armSwing * Math.cos(phi);
    // The hand trails the arm: still up as the arm comes down, still down as it goes up.
    out[1] = handMean + handSwing * Math.cos(phi - lag);
    out[2] = -SWAN_FLIGHT.heave * Math.cos(phi);
    return out;
}

/** A small seeded generator (mulberry32), so a flight is the same flight after a seek. */
export function seededSwans(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Lay a skein of `count` birds on `route` into `flight` (its birds are reused): a shallow V or a
 * slanting line, every bird loose in its place and beating in its own time. `random` draws the
 * choices. The leader is bird 0.
 */
export function laySwanSkein(flight, route, count, random, reversed = false) {
    const line = random() < 0.38;
    const lean = random() < 0.5 ? -1 : 1;
    const { rank } = SWAN_FLIGHT;
    flight.route = route;
    flight.reversed = reversed;
    flight.count = Math.min(count, flight.birds.length);
    let behind = 0;
    for (let i = 0; i < flight.count; i += 1) {
        const bird = flight.birds[i];
        // A V fills its two arms in turn (the first arm one longer); a line trails to one side.
        // Each bird is also a place behind the one before it, so no two cover each other side on.
        const place = line ? i * 0.8 : Math.ceil(i / 2);
        const side = line || i % 2 ? lean : -lean;
        bird.out = side * place * rank.out * (0.9 + 0.2 * random());
        behind += i ? rank.back * (0.85 + 0.3 * random()) : 0;
        bird.back = behind;
        bird.up = place * rank.up + (random() - 0.5) * 0.6;
        bird.hz = SWAN_FLIGHT.beat * (1 + (random() * 2 - 1) * SWAN_FLIGHT.spread);
        bird.phase = random() * TAU;
        bird.wander = random() * TAU;
        bird.rate = 0.6 + random() * 0.5;
        bird.size = SWAN_FLIGHT.size * (0.95 + random() * 0.1);
    }
    // In the air until the last bird is past the line's end.
    flight.life = (route.length + behind + 1) / SWAN_FLIGHT.speed;
    return flight;
}

/**
 * Bird `i` of a flight `age` seconds after it went up: its place (out[0..2]), unit heading
 * (out[3..5]) and how far along the line it is as a share (out[6]: under 0 before the line's
 * start, over 1 past its end). The same for any age: nothing is integrated.
 */
export function swanFlightPlace(flight, i, age, out = [0, 0, 0, 0, 0, 0, 0]) {
    const bird = flight.birds[i];
    const { route } = flight;
    const run = age * SWAN_FLIGHT.speed - bird.back;
    swanFlightPoint(route, flight.reversed ? route.length - run : run, out);
    if (flight.reversed) {
        out[3] = -out[3];
        out[4] = -out[4];
        out[5] = -out[5];
    }
    // Its place in the skein: out to the side of the heading, a little above, loose in both.
    const flat = Math.hypot(out[3], out[5]) || 1;
    const drift = age * bird.rate + bird.wander;
    const aside = bird.out + 0.3 * Math.sin(drift);
    out[0] += (-out[5] / flat) * aside;
    out[2] += (out[3] / flat) * aside;
    out[1] += bird.up + 0.22 * Math.sin(drift * 0.7 + 1.3) + 0.35 * Math.sin(age * 0.5 + bird.wander * 0.2);
    out[6] = run / route.length;
    return out;
}

// ── The plans, kept for the session ──────────────────────────────────────────

const plans = { round: undefined, flights: null };

/**
 * The round planSwanRound() finds on the theme's own lake (the tests hold the two together). A
 * session takes it as it stands if it still holds on the lake (a few hundred heights instead of
 * the whole search, which a build would feel), and searches again only if the land has changed.
 */
export const SWAN_REST_ROUND = swanRound({
    x: -24, z: -46, a: 7, b: 1.6, tilt: -0.28, side: -1,
});

/** The round on the theme's own lake, found once a session. */
export function sessionSwanRound() {
    if (plans.round === undefined) {
        const holds = swanRoundHolds(summerSwanLens(SWAN_REST_ASPECT), SWAN_REST_ROUND);
        plans.round = holds ? SWAN_REST_ROUND : planSwanRound();
    }
    return plans.round;
}

/** The flights over the theme's own lake, found once a session (a few milliseconds of scoring). */
export function sessionSwanFlights() {
    if (!plans.flights) plans.flights = planSwanFlights();
    return plans.flights;
}
