/**
 * Painted Ages — where and when the bearded vultures fly (numbers only, three-free:
 * painted-ages-vultures.js draws them; the tests run this in plain Node).
 *
 * Two kinds of visit, both laid in real metres over the land (the eye never moves, only turns, so
 * a bird holds still against the hills while the lens breathes):
 *
 *   the thermal   two to four birds circling in a rising column that drifts slowly downwind. Each
 *                 glides in on a straight line from beyond the frame's edge, banks into its own
 *                 circle (its own radius, height, phase and pace), climbs through a turn and a
 *                 half or so and glides out again the way it came, with a few slow deep flaps as
 *                 it sets off.
 *   the pass      one bird past the overlook's shoulder, close: a hairpin beside the card. In over
 *                 the frame's side on the far branch, swinging toward the card as it nears, then
 *                 peeling away past the eye with its rust underside turned to it (or the same
 *                 flown the other way, in past the shoulder and away).
 *
 * One path serves both: a straight glide, an arc of a circle, a straight glide, the lines being
 * the circle's own tangents where the bird joins and leaves it (so the heading never jumps). It is
 * a closed form of the visit's age: a seek lands where play would have, nothing is integrated from
 * frame to frame, and the vertex stage evaluates the very same expressions (`vulturePlace` and
 * `vultureWings` are its twins).
 *
 * When they fly is the clock's alone (`vultureThermalAt`, `vulturePassAt`): a cycle of
 * VULTURE_TIMES.cycle seconds holds one thermal and, in most cycles, one pass, each at a seeded
 * moment, on a seeded side, with seeded birds. Whether they are SEEN is the light's
 * (`vultureDaylight`): they fly only while the sun is up.
 *
 * Where they may be is found by numbers: every visit is walked through the rest lens of each
 * frame the theme is shown in (`watchVultureVisit`), against the board card and the HUD
 * (`vultureKeepOut`), and the tests hold every visit of the timetable to it: in over an edge and
 * out over an edge of the widest frame, never over the card or the HUD.
 */
import {
    DEG, EYE, TAU, clamp, rigFor, smooth,
} from './painted-ages-core.js';
import { fallbackLayout } from './painted-ages-composition.js';

/** A bearded vulture's span, wingtip to wingtip (m): the model's (the tests hold them equal). */
export const VULTURE_SPAN = 2.729;
/** Birds in the largest thermal (the largest tier's), and the pass's own bird after them. */
export const VULTURE_MOST = 4;
/** vec4 rows a bird takes in the table the vertex stage reads. */
export const VULTURE_ROWS = 5;

export const VULTURE_SEED = 0x1a44e9;

/**
 * A chance in 0..1 from a seed and two counters: a hash, not a sequence, so a visit's choices are
 * the same whenever and in whatever order they are asked for.
 */
export function vultureChance(seed, a = 0, b = 0) {
    let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ── The lens ─────────────────────────────────────────────────────────────────

/** The framings the theme has (painted-ages-core.js: rigFor), and the widest frame each is shown in. */
export const VULTURE_FRAMES = Object.freeze({
    landscape: Object.freeze({ aspect: 16 / 9, widest: 2.1 }),
    wide: Object.freeze({ aspect: 21 / 9, widest: 32 / 9 }),
    portrait: Object.freeze({ aspect: 390 / 844, widest: 0.74 }),
});

/** Which framing an aspect ratio is seen in. */
export function vultureFraming(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    if (a < 0.75) return 'portrait';
    return a > 2.1 ? 'wide' : 'landscape';
}

/**
 * The rest lens of a frame `aspect` wide: `project(x, y, z)` gives a world point's place on screen
 * (x right, y down, fractions; `depth` metres along the view, 0 or less behind the eye) and
 * `radians` the angle one frame height spans at the centre. `pose()`'s twin without its breath.
 */
export function vultureLens(aspect) {
    const rig = rigFor(aspect);
    const yaw = rig.yaw * DEG;
    const pitch = rig.pitch * DEG;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const tanV = Math.tan((rig.fov * DEG) / 2);
    const tanH = tanV * aspect;
    return {
        aspect,
        tanV,
        tanH,
        project(x, y, z, out = { x: 0, y: 0, depth: 0 }) {
            const dx = x - EYE.x;
            const dy = y - EYE.y;
            const dz = z - EYE.z;
            const x1 = cy * dx + sy * dz;
            const z1 = -sy * dx + cy * dz;
            const y2 = cp * dy + sp * z1;
            const depth = sp * dy - cp * z1;
            const d = Math.max(depth, 1e-3);
            /* eslint-disable no-param-reassign */
            out.x = 0.5 + (x1 / (d * tanH)) * 0.5;
            out.y = 0.5 - (y2 / (d * tanV)) * 0.5;
            out.depth = depth;
            /* eslint-enable no-param-reassign */
            return out;
        },
    };
}

/**
 * What a bird keeps off in a frame `width` × `height` (screen fractions, y down): the board card
 * and the HUD as the solo layout stands them (painted-ages-composition.js). In a landscape frame
 * the card is taken for the frame's whole height (its head and foot are a few dozen pixels of sky
 * and land no bird should thread), and the HUD for the middle half.
 */
export function vultureKeepOut(width, height) {
    const layout = fallbackLayout(width, height);
    const card = layout.cards[0];
    if (width / height < 0.75) return [{ ...card }];
    const rects = [{
        x0: card.x0, x1: card.x1, y0: 0, y1: 1,
    }];
    if (layout.hud && layout.hud.x0 < 1) {
        rects.push({
            x0: layout.hud.x0, x1: layout.hud.x1, y0: Math.min(0.25, layout.hud.y0), y1: Math.max(0.75, layout.hud.y1),
        });
    }
    return rects;
}

// ── A bird's path ────────────────────────────────────────────────────────────

/**
 * How a bird flies and holds itself (radians, seconds; angles + up): the soaring pose (the arm a
 * touch raised, the hand lowered: wings a little bowed), how the hand and the arm breathe on the
 * air, the roll it rocks with and how the tail answers it; and the slow deep flaps: beats a
 * second, beats in a burst, the shoulder's and the wrist's swing (the hand trails by `lag`) and the
 * body's heave against the stroke (m at life size). `ease`: the seconds over which a bird rolls
 * into and out of its bank where a glide meets the circle.
 */
export const VULTURE_FLIGHT = Object.freeze({
    arm: 0.05,
    hand: -0.13,
    flex: Object.freeze([0.05, 0.83, 0.03, 2.1]),
    lift: Object.freeze([0.025, 0.61]),
    rock: Object.freeze([0.045, 0.9, 0.03, 0.37]),
    fan: Object.freeze([-0.6, 0.8, 0.15, 0.5]),
    twist: Object.freeze([-2.6, 0.16]),
    beat: 1.25,
    beats: 3,
    stroke: Object.freeze([0.4, 0.28, 0.95]),
    heave: 0.05,
    ease: 1.6,
});

/** Somewhere to keep a bird (every field a number; a visit reuses its birds). */
export function createVultureBird() {
    return {
        cx: 0,
        cz: 0,
        radius: 1,
        omega: 0.1,
        phi: 0,
        y: 0,
        tIn: 0,
        tOut: 0,
        driftX: 0,
        driftZ: 0,
        climb: 0,
        sink: 0,
        size: 1,
        bank: 0,
        seed: 0,
        from: 0,
        until: 0,
        flapA: -1e3,
        flapB: -1e3,
    };
}

/** Somewhere to keep a visit: its kind, its number in the timetable, when it begins, its birds. */
export function createVultureVisit() {
    return {
        kind: 'none',
        number: -1,
        side: -1,
        framing: 'landscape',
        epoch: 0,
        count: 0,
        from: 0,
        until: 0,
        route: null,
        birds: Array.from({ length: VULTURE_MOST }, createVultureBird),
    };
}

/** The share of its bank a bird holds at `age`: 0 on the glides, 1 on the arc, eased where they meet. */
export function vultureOnArc(bird, age) {
    const e = VULTURE_FLIGHT.ease;
    return smooth(bird.tIn - e, bird.tIn + e, age) * (1 - smooth(bird.tOut - e, bird.tOut + e, age));
}

/** How far through a burst of flaps begun at `at` a bird is at `age` (0..1; 0 before, 1 after). */
function burst(at, age) {
    return clamp(((age - at) * VULTURE_FLIGHT.beat) / VULTURE_FLIGHT.beats, 0, 1);
}

/** The wings' beat at `age`: (envelope 0..1, phase in radians) of whichever burst is running. */
function beatAt(bird, age, out) {
    const a = burst(bird.flapA, age);
    const b = burst(bird.flapB, age);
    const p = a > 0 && a < 1 ? a : b;
    /* eslint-disable no-param-reassign */
    out[0] = smooth(0, 0.18, p) * (1 - smooth(0.82, 1, p));
    out[1] = TAU * VULTURE_FLIGHT.beats * p;
    /* eslint-enable no-param-reassign */
    return out;
}

const _beat = [0, 0];

/** The slow roll a bird rocks with on the air at `age` (radians). */
function rockAt(bird, age) {
    const [wide, rate, small, slow] = VULTURE_FLIGHT.rock;
    return wide * Math.sin(rate * age + bird.seed * 40) + small * Math.sin(slow * age + bird.seed * 11);
}

/**
 * Where a bird is at `age` seconds into its visit: its place (out[0..2], metres), its unit heading
 * (out[3..5]) and its roll (out[6], radians, + the left wing up). The vertex stage's twin.
 */
export function vulturePlace(bird, age, out = [0, 0, 0, 0, 0, 0, 0]) {
    const F = VULTURE_FLIGHT;
    const turn = bird.omega < 0 ? -1 : 1;
    const held = clamp(age, bird.tIn, bird.tOut);
    const phi = bird.phi + bird.omega * (held - bird.tIn);
    const speed = Math.abs(bird.omega) * bird.radius;
    const off = age - held;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const tx = -sin * turn;
    const tz = cos * turn;
    const on = vultureOnArc(bird, age);
    const rise = -bird.sink + (bird.climb + bird.sink) * on;
    const level = 1 / Math.hypot(speed, rise);
    beatAt(bird, age, _beat);
    const rock = rockAt(bird, age);
    /* eslint-disable no-param-reassign */
    out[0] = bird.cx + bird.driftX * age + bird.radius * cos + tx * speed * off;
    out[1] = bird.y + bird.climb * (held - bird.tIn)
        + bird.sink * (Math.max(bird.tIn - age, 0) - Math.max(age - bird.tOut, 0))
        - F.heave * bird.size * _beat[0] * Math.sin(_beat[1]);
    out[2] = bird.cz + bird.driftZ * age + bird.radius * sin + tz * speed * off;
    out[3] = tx * speed * level;
    out[4] = rise * level;
    out[5] = tz * speed * level;
    out[6] = bird.bank * turn * on + rock;
    /* eslint-enable no-param-reassign */
    return out;
}

/**
 * How a bird holds its wings and tail at `age`: the shoulder's and the wrist's turn (out[0], out[1]),
 * the tail's fan (out[2], -1 closed .. 1 wide) and its twist (out[3]). The vertex stage's twin.
 */
export function vultureWings(bird, age, out = [0, 0, 0, 0]) {
    const F = VULTURE_FLIGHT;
    const on = vultureOnArc(bird, age);
    beatAt(bird, age, _beat);
    const rock = rockAt(bird, age);
    const turn = bird.omega < 0 ? -1 : 1;
    /* eslint-disable no-param-reassign */
    out[0] = F.arm + F.lift[0] * Math.sin(F.lift[1] * age + bird.seed * 29)
        + _beat[0] * F.stroke[0] * Math.sin(_beat[1]);
    out[1] = F.hand + F.flex[0] * Math.sin(F.flex[1] * age + bird.seed * 6.3)
        + F.flex[2] * Math.sin(F.flex[3] * age + bird.seed * 17)
        + _beat[0] * F.stroke[1] * Math.sin(_beat[1] - F.stroke[2]);
    out[2] = F.fan[0] + (F.fan[1] - F.fan[0]) * on + F.fan[2] * Math.sin(F.fan[3] * age + bird.seed * 23);
    out[3] = F.twist[0] * rock + F.twist[1] * turn * on;
    /* eslint-enable no-param-reassign */
    return out;
}

// ── The routes ───────────────────────────────────────────────────────────────

/** A thermal's site from its numbers, in the order the note below gives them. */
const column = (side, x, z, radius, base, step, size, period, climb, dx, dz, comes, leaves, spread) => Object.freeze({
    side,
    x,
    z,
    radius,
    base,
    step,
    size,
    period,
    climb,
    drift: Object.freeze([dx, dz]),
    comes,
    leaves,
    spread,
});

/**
 * Where a thermal stands, per framing (metres; the eye at (0, 172, 0) looks down -z): the
 * column's foot (x, z) when its first bird joins, the circles' radius, the height the lowest bird
 * joins at and how far apart the birds join (`step`), how large a bird is drawn (larger than
 * life, as far birds are in every theme here: at life size a vulture half a kilometre off is six
 * pixels), a turn's seconds, how fast they climb, how the column drifts (m/s, downwind), and the
 * bearings they come from and leave to (radians from +x toward +z: 0 flies east, to the right;
 * π west), each bird a little off them (`spread`). Landscape: over the pavilion's hill and beyond
 * it in the left third, over the valley in the right third. Portrait: in the strip of sky above
 * the card, and high in it (an upright frame 736 px tall leaves 69 px there; one under about
 * 700 px leaves less than a bird's span, and a wing may then reach over the card's top edge).
 * (The wide framing flies the landscape's.)
 */
export const VULTURE_THERMALS = Object.freeze({
    landscape: Object.freeze([
        column(-1, -212, -486, 62, 212, 13, 5, 23, 1.25, 0.38, -0.13, 0, Math.PI, 0.3),
        column(-1, -372, -820, 96, 236, 20, 7, 27, 1.7, 0.5, -0.17, 0, Math.PI, 0.26),
        column(1, 356, -690, 70, 262, 15, 6, 24, 1.3, 0.4, -0.14, Math.PI, 0, 0.3),
        column(1, 470, -960, 100, 300, 20, 8, 28, 1.8, 0.5, -0.17, Math.PI, 0, 0.26),
    ]),
    portrait: Object.freeze([
        column(-1, 24, -560, 42, 345, 3, 6.5, 21, 0.2, 0.25, -0.08, 0, Math.PI, 0.2),
        column(1, 52, -560, 42, 345, 3, 6.5, 21, 0.2, 0.25, -0.08, Math.PI, 0, 0.2),
    ]),
});

/** A pass's arc from its numbers, in the order the note below gives them. */
const arc = (side, x, z, radius, turn, from, sweep, y, rise, speed, bank, size) => Object.freeze({
    side,
    x,
    z,
    radius,
    turn,
    from,
    sweep,
    y,
    rise,
    speed,
    bank,
    size,
    back: true,
});

/**
 * The close passes, per framing. A pass is an arc of one circle, seen from outside it: its middle
 * (x, z), its radius, which way the bird turns on it, where on it the bird begins to bank
 * (`from`, radians: 0 the circle's east, π/2 its side nearest the eye) and how far round it goes
 * (`sweep`), the height it begins at and how it rises (m/s), its pace (m/s), how steeply it banks
 * and how large it is drawn. `back`: the same arc flown the other way is a pass too.
 *
 * Landscape: a hairpin beside the card, its circle's middle beyond the frame's edge. The bird
 * comes in over that edge on the far branch, small and turned back-to-the-eye, swings toward the
 * card as it nears, and peels away past the overlook's shoulder on the near branch, large, its
 * rust underside turned to the eye (it banks away from an eye that stands outside its circle).
 * Portrait: the near arc of a wide circle, across the strip of sky above the card.
 */
export const VULTURE_PASSES = Object.freeze({
    landscape: Object.freeze([
        arc(-1, -45.4, -34.4, 35, 1, -1.31, 2.97, 176.2, 0.22, 8.6, 0.52, 3),
        arc(1, 50.5, -26.4, 35, -1, Math.PI + 1.31, 2.97, 176.2, 0.22, 7.6, 0.52, 3),
    ]),
    portrait: Object.freeze([
        arc(-1, 11, -163, 87, -1, Math.PI / 2 + 0.42, 0.84, 194.6, 0, 6.2, 0.4, 1.6),
    ]),
});

/** The routes a framing flies (the wide framing the landscape's). */
const routesOf = (table, framing) => table[framing === 'portrait' ? 'portrait' : 'landscape'];

// ── The timetable ────────────────────────────────────────────────────────────

/**
 * When they fly (seconds on the theme's clock). Each `cycle` holds a thermal, whose first bird
 * joins its circle `thermal[0]` to `thermal[0] + thermal[1]` seconds in, and, in `passShare` of
 * the cycles, a pass, whose bird begins its bank `pass[0]` to `pass[0] + pass[1]` seconds in.
 * `thermalWindow` / `passWindow`: the longest a visit's birds may be in the air before and after
 * that moment (a visit is looked for only inside that window, and the windows of two cycles never
 * meet).
 */
export const VULTURE_TIMES = Object.freeze({
    cycle: 180,
    thermal: Object.freeze([34, 14]),
    pass: Object.freeze([128, 22]),
    passShare: 0.7,
    thermalWindow: Object.freeze([46, 112]),
    passWindow: Object.freeze([16, 30]),
});

/** The cycle whose visit window holds `time` given a visit's place in a cycle, or -1. */
function cycleAt(time, [at, jitter], [before, after], seed, salt) {
    const T = VULTURE_TIMES;
    const k = Math.floor(time / T.cycle);
    for (let n = Math.max(0, k - 1); n <= k + 1; n += 1) {
        const epoch = n * T.cycle + at + jitter * vultureChance(seed, salt, n);
        if (time >= epoch - before && time <= epoch + after) return n;
    }
    return -1;
}

/** When thermal `number` (a cycle) has its first bird join its circle. */
export function vultureThermalEpoch(number, seed = VULTURE_SEED) {
    const T = VULTURE_TIMES;
    return number * T.cycle + T.thermal[0] + T.thermal[1] * vultureChance(seed, 1, number);
}

/** When pass `number` (a cycle) has its bird begin to bank, or -1 in a cycle without a pass. */
export function vulturePassEpoch(number, seed = VULTURE_SEED) {
    const T = VULTURE_TIMES;
    if (vultureChance(seed, 3, number) >= T.passShare) return -1;
    return number * T.cycle + T.pass[0] + T.pass[1] * vultureChance(seed, 2, number);
}

/** The thermal whose window holds `time` (its number), or -1. A pure function of the clock. */
export function vultureThermalAt(time, seed = VULTURE_SEED) {
    return cycleAt(time, VULTURE_TIMES.thermal, VULTURE_TIMES.thermalWindow, seed, 1);
}

/** The pass whose window holds `time` (its number), or -1. A pure function of the clock. */
export function vulturePassAt(time, seed = VULTURE_SEED) {
    const n = cycleAt(time, VULTURE_TIMES.pass, VULTURE_TIMES.passWindow, seed, 2);
    return n >= 0 && vulturePassEpoch(n, seed) >= 0 ? n : -1;
}

/**
 * How much of the birds the hour's light shows (0..1): all of them while the sun is up, none in
 * the blue hour or under a game-over dusk. `sunUp` and `dusk` are the world's own (u.sunUp, u.dusk).
 */
export function vultureDaylight(sunUp, dusk) {
    return smooth(0.5, 0.95, sunUp) * (1 - smooth(0.02, 0.5, dusk));
}

// ── Laying a visit ───────────────────────────────────────────────────────────

const _place = [0, 0, 0, 0, 0, 0, 0];
const _at = { x: 0, y: 0, depth: 0 };

/** True while a bird's whole span may show in a frame `aspect` wide (with `margin`, screen fractions). */
function inFrame(lens, bird, age, margin) {
    vulturePlace(bird, age, _place);
    lens.project(_place[0], _place[1], _place[2], _at);
    if (!(_at.depth > 0.5)) return false;
    const reach = (0.5 * VULTURE_SPAN * bird.size) / _at.depth;
    const rx = reach / (2 * lens.tanH) + margin;
    const ry = reach / (2 * lens.tanV) + margin;
    return _at.x > -rx && _at.x < 1 + rx && _at.y > -ry && _at.y < 1 + ry;
}

/**
 * From when until when a bird must be drawn: walked out along its two glides from the arc until
 * it has been out of the framing's widest frame for a while (or the timetable's window ends).
 */
function boundVulture(bird, lens, [before, after]) {
    const step = 0.5;
    const clear = 3;
    let out = 0;
    let from = bird.tIn;
    for (let a = bird.tIn; a >= -before; a -= step) {
        out = inFrame(lens, bird, a, 0.03) ? 0 : out + step;
        from = a;
        if (out >= clear) break;
    }
    out = 0;
    let until = bird.tOut;
    for (let a = bird.tOut; a <= after; a += step) {
        out = inFrame(lens, bird, a, 0.03) ? 0 : out + step;
        until = a;
        if (out >= clear) break;
    }
    /* eslint-disable no-param-reassign */
    bird.from = from;
    bird.until = until;
    /* eslint-enable no-param-reassign */
}

function closeVisit(visit, lens, window) {
    let from = Infinity;
    let until = -Infinity;
    for (let i = 0; i < visit.count; i += 1) {
        boundVulture(visit.birds[i], lens, window);
        from = Math.min(from, visit.birds[i].from);
        until = Math.max(until, visit.birds[i].until);
    }
    /* eslint-disable no-param-reassign */
    visit.from = from;
    visit.until = until;
    /* eslint-enable no-param-reassign */
    return visit;
}

/**
 * Lay thermal `number` into `visit` for a framing: `most` birds at most (the tier's), on the side
 * `side` (-1 left, 1 right; 0: the timetable's own). Ages count from when its first bird joins.
 */
export function layVultureThermal(visit, number, framing, most = VULTURE_MOST, side = 0, seed = VULTURE_SEED) {
    const own = (seed ^ Math.imul(number + 1, 0x632be5ab)) >>> 0;
    const sites = routesOf(VULTURE_THERMALS, framing);
    const wanted = side || (vultureChance(own, 1) < 0.5 ? -1 : 1);
    const onSide = sites.filter((s) => s.side === wanted);
    const pool = onSide.length ? onSide : sites;
    const site = pool[Math.floor(vultureChance(own, 2) * pool.length) % pool.length];
    const top = clamp(Math.round(most), 1, VULTURE_MOST);
    const count = top <= 2 ? top : 2 + Math.floor(vultureChance(own, 3) * (top - 1));
    const turn = vultureChance(own, 4) < 0.5 ? -1 : 1;
    const lens = vultureLens((VULTURE_FRAMES[framing] || VULTURE_FRAMES.landscape).widest);
    /* eslint-disable no-param-reassign */
    visit.kind = 'thermal';
    visit.number = number;
    visit.side = site.side;
    visit.framing = VULTURE_FRAMES[framing] ? framing : 'landscape';
    visit.epoch = vultureThermalEpoch(number, seed);
    visit.count = Math.min(count, top);
    visit.route = site;
    let joins = 0;
    for (let i = 0; i < visit.count; i += 1) {
        const bird = visit.birds[i];
        const c = (k) => vultureChance(own, 10 + k, i);
        const radius = site.radius * (0.84 + 0.3 * c(0));
        const period = site.period * (radius / site.radius) ** 0.6 * (0.96 + 0.08 * c(1));
        const comes = site.comes + (c(2) * 2 - 1) * site.spread;
        const leaves = site.leaves + (c(3) * 2 - 1) * site.spread;
        bird.omega = (turn * TAU) / period;
        bird.tIn = joins;
        joins += 4 + 2.5 * c(4);
        // Where on its circle it joins, heading as it comes; the circle's middle is the column's.
        bird.phi = comes - turn * (Math.PI / 2);
        bird.radius = radius;
        bird.cx = site.x + (c(5) - 0.5) * 0.3 * site.radius;
        bird.cz = site.z + (c(6) - 0.5) * 0.3 * site.radius;
        // It leaves where its heading is the way out: a turn and a half or so later (the first
        // to come now and then a turn more).
        const swing = ((((leaves - comes) * turn) % TAU) + TAU) % TAU;
        const turns = swing / TAU + (i === 0 && c(7) < 0.3 ? 2 : 1);
        bird.tOut = bird.tIn + turns * period;
        bird.driftX = site.drift[0];
        bird.driftZ = site.drift[1];
        bird.y = site.base + i * site.step + (c(8) - 0.5) * site.step * 0.6;
        bird.climb = site.climb * (0.85 + 0.3 * c(9));
        bird.sink = site.climb * 0.55;
        bird.size = site.size * (0.94 + 0.12 * c(10));
        bird.bank = 0.5 * (0.9 + 0.2 * c(11));
        bird.seed = c(12);
        bird.flapA = bird.tIn - 4.5 - 2 * c(13);
        bird.flapB = bird.tOut + 0.6 + 1.5 * c(14);
    }
    /* eslint-enable no-param-reassign */
    return closeVisit(visit, lens, VULTURE_TIMES.thermalWindow);
}

/**
 * Lay pass `number` into `visit` for a framing, on the side `side` (0: the timetable's own), flown
 * `way` (1 as the route is written, -1 back along it, 0: the timetable's own). Ages count from when
 * the bird begins its bank.
 */
export function layVulturePass(visit, number, framing, side = 0, way = 0, seed = VULTURE_SEED) {
    const own = (seed ^ Math.imul(number + 1, 0x2545f491)) >>> 0;
    const routes = routesOf(VULTURE_PASSES, framing);
    const wanted = side || (vultureChance(own, 1) < 0.5 ? -1 : 1);
    const onSide = routes.filter((r) => r.side === wanted);
    const pool = onSide.length ? onSide : routes;
    const route = pool[Math.floor(vultureChance(own, 2) * pool.length) % pool.length];
    const back = way ? way < 0 : route.back && vultureChance(own, 3) < 0.5;
    const lens = vultureLens((VULTURE_FRAMES[framing] || VULTURE_FRAMES.landscape).widest);
    const bird = visit.birds[0];
    /* eslint-disable no-param-reassign */
    visit.kind = 'pass';
    visit.number = number;
    visit.side = route.side;
    visit.framing = VULTURE_FRAMES[framing] ? framing : 'landscape';
    visit.epoch = vulturePassEpoch(number, seed);
    visit.count = 1;
    visit.route = route;
    bird.omega = (route.turn * route.speed) / route.radius;
    bird.tIn = 0;
    bird.tOut = (route.sweep * route.radius) / route.speed;
    bird.phi = route.from;
    bird.radius = route.radius;
    bird.cx = route.x;
    bird.cz = route.z;
    bird.driftX = 0;
    bird.driftZ = 0;
    bird.y = route.y;
    bird.climb = route.rise;
    bird.sink = -route.rise;
    if (back) {
        // The same arc the other way: it begins where the forward bird left off, heading back
        // along it, and sinks where that one rose.
        bird.y = route.y + route.rise * bird.tOut;
        bird.phi = route.from + bird.omega * bird.tOut;
        bird.omega = -bird.omega;
        bird.climb = -route.rise;
        bird.sink = route.rise;
    }
    bird.size = route.size;
    bird.bank = route.bank;
    bird.seed = vultureChance(own, 5);
    bird.flapA = -1e3;
    bird.flapB = -1e3;
    /* eslint-enable no-param-reassign */
    return closeVisit(visit, lens, VULTURE_TIMES.passWindow);
}

// ── Walking a visit through a frame ──────────────────────────────────────────

/**
 * Walk a laid visit through the rest lens of a frame `width` × `height` pixels, every `step`
 * seconds, and say what is seen: `seen` the seconds any bird's middle is in the frame; `least`
 * and `most` a bird's span there (pixels); `begins` / `ends`: true when every bird is out of the
 * frame (wings and all) at the visit's first and last moments; `over`: the seconds any bird's span
 * reaches over the card or the HUD while it is in the frame, and `where` the first place it does.
 */
export function watchVultureVisit(visit, width, height, step = 0.25) {
    const lens = vultureLens(width / height);
    const rects = vultureKeepOut(width, height);
    const pixels = height / (2 * lens.tanV);
    const report = {
        seen: 0, least: Infinity, most: 0, begins: true, ends: true, over: 0, where: null, lowest: Infinity,
    };
    for (let age = visit.from; age <= visit.until + 1e-9; age += step) {
        let any = false;
        let hit = false;
        for (let i = 0; i < visit.count; i += 1) {
            const bird = visit.birds[i];
            if (age < bird.from || age > bird.until) continue;
            vulturePlace(bird, age, _place);
            lens.project(_place[0], _place[1], _place[2], _at);
            if (!(_at.depth > 0.5)) continue;
            const reach = (0.5 * VULTURE_SPAN * bird.size) / _at.depth;
            const rx = reach / (2 * lens.tanH);
            const ry = reach / (2 * lens.tanV);
            const shows = _at.x > -rx && _at.x < 1 + rx && _at.y > -ry && _at.y < 1 + ry;
            if (!shows) continue;
            if (age <= bird.from + 1e-9) report.begins = false;
            if (age >= bird.until - step + 1e-9) report.ends = false;
            report.lowest = Math.min(report.lowest, _place[1]);
            if (_at.x >= 0 && _at.x <= 1 && _at.y >= 0 && _at.y <= 1) {
                any = true;
                const span = 2 * reach * pixels;
                report.least = Math.min(report.least, span);
                report.most = Math.max(report.most, span);
            }
            for (const r of rects) {
                if (_at.x + rx > r.x0 && _at.x - rx < r.x1 && _at.y + ry > r.y0 && _at.y - ry < r.y1) {
                    hit = true;
                    if (!report.where) {
                        report.where = {
                            age, bird: i, x: _at.x, y: _at.y,
                        };
                    }
                }
            }
        }
        if (any) report.seen += step;
        if (hit) report.over += step;
    }
    return report;
}

/** The bird of a visit as the table's rows (VULTURE_ROWS vec4s, 20 numbers) at `offset` of `rows`. */
export function vultureRows(visit, i, rows, offset = 0) {
    const b = visit.birds[i];
    const live = i < visit.count;
    const values = [
        b.cx, b.cz, b.radius, b.omega,
        b.phi, b.y, b.tIn, b.tOut,
        b.driftX, b.driftZ, b.climb, b.sink,
        visit.epoch, b.size, b.bank, b.seed,
        live ? b.from : 1, live ? b.until : 0, b.flapA, b.flapB,
    ];
    // eslint-disable-next-line no-param-reassign
    for (let k = 0; k < values.length; k += 1) rows[offset + k] = values[k];
    return rows;
}
