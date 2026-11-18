/**
 * Sakura Twilight — where the cranes fly (numbers only, three-free: sakura-cranes.js draws them,
 * the tests and scripts/sakura-crane-probe.mjs run this in plain Node).
 *
 * Now and then a small flight of red-crowned cranes crosses the garden's night sky: out of sight
 * to out of sight at one pace, as one flock. Where it flies is found by numbers. A line is laid
 * through two places picked in the landscape rest frame (one in the open sky left of the board
 * card, in front of the mountain or over its summit; one beyond the card), flown out both ways
 * until the whole skein is outside the widest frame the theme is ever shown in, and then walked
 * through BOTH rest cameras: how long the birds show in the sky each framing leaves open, how
 * long against the mountain and mirrored in the lake, how large they are drawn, how far from the
 * side they are seen (the view that shows a crane: neck out, legs trailing, the black of the
 * wing). A line that dips under the height a crane keeps here (over the lake, the wooded banks,
 * the far hills, the mountain) is no flight at all. The best line of each kind of flight is one
 * of the night's routes (CRANE_ROUTES: found by planCraneRoutes(), kept as a table so a garden
 * coming in plans nothing; the tests hold the table to the plan). A flight takes the routes in
 * turn and may fly one either way.
 *
 * Everything is a closed form of the seconds since a skein set out: a bird's place is its own run
 * along a circular arc (so its pace is the flight's, bend or no bend), its slot in the skein and
 * a slow looseness about it. A seek to any time lands where play would have, nothing is
 * integrated from frame to frame, and flying allocates nothing.
 */
import { sakuraLand, sakuraTerrainHeight } from './sakura-shape.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};

// ── The rest cameras ─────────────────────────────────────────────────────────

/**
 * The two framings the garden is seen in (sakura-composition.js: SAKURA_VIEWS; kept here so this
 * module stays three-free, and the tests hold them equal). `aspect` is the frame a route is
 * marked in, `widest` the widest frame of that framing a flight must still begin and end outside of.
 */
export const CRANE_VIEWS = Object.freeze({
    landscape: Object.freeze({
        fov: 50,
        position: Object.freeze([0, 4.3, 16]),
        target: Object.freeze([0, 4.9, -40]),
        aspect: 16 / 9,
        widest: 2.4,
    }),
    portrait: Object.freeze({
        fov: 68,
        position: Object.freeze([0, 4.6, 19]),
        target: Object.freeze([-9, 10.5, -40]),
        aspect: 540 / 1100,
        widest: 0.85,
    }),
});

/**
 * A rest lens: `project(x, y, z)` gives a world point's place on screen (x right, y down,
 * fractions; `depth` metres along the view; null behind the eye) and `point(sx, sy, depth)` the
 * world point seen there.
 */
export function craneLens(framing = 'landscape', aspect = CRANE_VIEWS[framing].aspect) {
    const view = CRANE_VIEWS[framing];
    const eye = view.position;
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
        framing,
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
            /* eslint-disable no-param-reassign */
            out.x = 0.5 + ((dx * rx + dz * rz) / (depth * tanH)) * 0.5;
            out.y = 0.5 - ((dx * ux + dy * uy + dz * uz) / (depth * tanV)) * 0.5;
            out.depth = depth;
            /* eslint-enable no-param-reassign */
            return out;
        },
        point(sx, sy, depth, out = [0, 0, 0]) {
            const across = (sx * 2 - 1) * depth * tanH;
            const high = (1 - sy * 2) * depth * tanV;
            /* eslint-disable no-param-reassign */
            out[0] = eye[0] + fx * depth + rx * across + ux * high;
            out[1] = eye[1] + fy * depth + uy * high;
            out[2] = eye[2] + fz * depth + rz * across + uz * high;
            /* eslint-enable no-param-reassign */
            return out;
        },
    };
}

/**
 * The sky each framing leaves open (screen fractions, y down). Landscape: left of the board card,
 * between the weeping cherry's garlands and the card, and the strip above the card's right
 * shoulder; the card hides the middle (sakura-stage.js: SAKURA_DEFAULT_BOARD, held equal by the
 * tests) and the old cherry's crown the right third. Portrait: the whole upper half. And `water`:
 * where the lake lies open to each camera (a bird's mirror image is counted when the eye meets it
 * on the water there).
 */
export const CRANE_SKY = Object.freeze({
    card: Object.freeze([0.385, 0.615]),
    landscape: Object.freeze([
        Object.freeze({
            x0: 0.12, x1: 0.385, y0: 0.05, y1: 0.45,
        }),
        Object.freeze({
            x0: 0.62, x1: 0.75, y0: 0, y1: 0.15,
        }),
    ]),
    portrait: Object.freeze([
        Object.freeze({
            x0: 0, x1: 1, y0: 0, y1: 0.5,
        }),
    ]),
    water: Object.freeze({
        landscape: Object.freeze({
            x0: 0.12, x1: 0.385, y0: 0.5, y1: 0.8,
        }),
        portrait: Object.freeze({
            x0: 0, x1: 1, y0: 0.5, y1: 0.75,
        }),
    }),
});

// ── What a crane keeps clear of ──────────────────────────────────────────────

/**
 * The mountain as the routes know it (sakura-composition.js: SAKURA_FUJI, and the widest reach of
 * its foot: the asset's base radius times its height), the far hills' crests (sakura-backdrop.js:
 * each a wall of land at its z) and the pagoda on the far shore.
 */
export const CRANE_MOUNTAIN = Object.freeze({
    x: -196, y: -3, z: -548, height: 140, radius: 360,
});
const HILLS = Object.freeze([[-228, 20], [-296, 32], [-386, 46]]);
const PAGODA = Object.freeze({
    x: 118, z: -166, reach: 16, top: 30,
});

/** The mountain's own height at (x, z): its cone, a little generous (the ground's level beyond its foot). */
export function craneMountainHeight(x, z) {
    const m = CRANE_MOUNTAIN;
    const r = Math.hypot(x - m.x, z - m.z) / m.radius;
    if (r >= 1) return m.y;
    const t = 1 - clamp((r - 0.04) / 0.96, 0, 1);
    return m.y + m.height * (0.76 * t ** 2.25 + 0.24 * t);
}

/** A red-crowned crane's span, wingtip to wingtip (m): the model's (sakura-crane-model.js; the tests hold them equal). */
export const CRANE_SPAN = 2.4;

/**
 * A flight (metres, seconds): the skein's pace; how large a bird is drawn (larger than life, as
 * far birds are in every theme here: at life size a crane a hundred metres off is a dozen pixels);
 * the least a crane keeps over the lake, how much more over wooded land and how far over the
 * mountain's snow; the least distance a bird may pass the eye at while it is in the frame; the
 * most and the fewest birds of a skein; the skein's slots (each bird a `step` behind the one
 * before it, so no two cover each other seen from the side; in a V the two arms take birds in
 * turn, `out` apart per rank and a touch higher; a line trails to one side at `line` of that, so
 * it reaches no further out than a V's arm; each slot is a few percent loose: `jitter`); how a bird wanders in its slot (m: across, up, along);
 * and the wingbeat: beats a second and each bird's own spread about it, the share of a beat the
 * downstroke takes, the shoulder's and the wrist's swing (mean, swing: radians, + up; the hand
 * trails the arm by `lag`), the body's heave against the stroke (m at life size), and the glide
 * a bird sets its wings in now and then (shoulder, wrist).
 */
export const CRANE_FLIGHT = Object.freeze({
    speed: 10,
    size: 2.2,
    low: 12,
    trees: 12,
    clear: 24,
    near: 40,
    most: 9,
    least: 5,
    slot: Object.freeze({
        step: 2.7, out: 3.0, up: 0.16, line: 0.5, jitter: 0.06,
    }),
    loose: Object.freeze([0.3, 0.22, 0.32]),
    beat: 2.0,
    spread: 0.045,
    downstroke: 0.58,
    arm: Object.freeze([0.06, 0.52]),
    hand: Object.freeze([-0.1, 0.36, 1.0]),
    heave: 0.05,
    glide: Object.freeze([0.1, -0.14]),
});

/** The least height a crane keeps at (x, z): over the lake, the wooded banks, the hills, the mountain. */
export function craneFloor(x, z) {
    const land = sakuraLand(x, z);
    let floor = Math.max(0, sakuraTerrainHeight(x, z)) + CRANE_FLIGHT.low + (land > -3 ? CRANE_FLIGHT.trees : 0);
    for (let i = 0; i < HILLS.length; i += 1) {
        if (z < HILLS[i][0]) floor = Math.max(floor, HILLS[i][1] + CRANE_FLIGHT.low);
    }
    if (Math.hypot(x - PAGODA.x, z - PAGODA.z) < PAGODA.reach) floor = Math.max(floor, PAGODA.top + CRANE_FLIGHT.low);
    // (Only over the mountain itself: beyond its foot there is nothing of it to keep clear of.)
    const cone = craneMountainHeight(x, z);
    return cone > CRANE_MOUNTAIN.y ? Math.max(floor, cone + CRANE_FLIGHT.clear) : floor;
}

// ── A route ──────────────────────────────────────────────────────────────────

/**
 * The leader's place `run` metres along a route (out[0..2]) and its unit heading (out[3..5]). A
 * route is a circular arc over the ground from (x, z), setting out along `heading` (radians from
 * +x toward +z) and turning `turn` radians a metre (0: a straight line), climbing evenly from
 * `from` to `to` metres over its `length`. Any run will do: a bird behind the leader is on the
 * arc before its start. A metre of run is exactly a metre flown over the ground.
 */
export function craneRoutePoint(route, run, out = [0, 0, 0, 0, 0, 0]) {
    const half = route.turn * run * 0.5;
    // sin(u) / u, by its series where u is small (a straight line is the same formula).
    const chord = Math.abs(half) < 1e-3 ? 1 - (half * half) / 6 : Math.sin(half) / half;
    const mid = route.heading + half;
    const slope = (route.to - route.from) / route.length;
    const level = 1 / Math.hypot(1, slope);
    const end = route.heading + route.turn * run;
    /* eslint-disable no-param-reassign */
    out[0] = route.x + run * chord * Math.cos(mid);
    out[1] = route.from + slope * run;
    out[2] = route.z + run * chord * Math.sin(mid);
    out[3] = Math.cos(end) * level;
    out[4] = slope * level;
    out[5] = Math.sin(end) * level;
    /* eslint-enable no-param-reassign */
    return out;
}

// ── A skein on a route ───────────────────────────────────────────────────────

/**
 * A chance in 0..1 from a seed and two counters: a hash, not a sequence, so a flight's choices
 * are the same whenever and in whatever order they are asked for, and asking allocates nothing.
 * The cranes take none of the garden's own chances.
 */
export function craneChance(seed, a = 0, b = 0) {
    let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Somewhere to keep a flight: its route, its birds (reused by every flight), how long it is in the air. */
export function createCraneFlight() {
    return {
        route: null,
        reversed: false,
        count: 0,
        life: 0,
        line: false,
        birds: Array.from({ length: CRANE_FLIGHT.most }, () => ({
            out: 0, back: 0, up: 0, hz: CRANE_FLIGHT.beat, phase: 0, wander: 0, rate: 1, size: 1, glide: 0, rest: 0,
        })),
    };
}

/**
 * Lay a skein of `count` birds on `route` into `flight`: a loose V, or one time in three a
 * slanting line, every bird a step behind the one before it, a little loose in its place and
 * beating in its own time. `seed` and `number` (which flight of the night this is) draw every
 * choice. The leader is bird 0.
 */
export function layCraneSkein(flight, route, count, seed = 0, number = 0, reversed = false) {
    const { slot, size } = CRANE_FLIGHT;
    const own = (seed + Math.imul(number + 1, 7919)) >>> 0;
    const line = craneChance(own, 1) < 0.34;
    const lean = craneChance(own, 2) < 0.5 ? -1 : 1;
    /* eslint-disable no-param-reassign */
    flight.route = route;
    flight.reversed = reversed;
    flight.line = line;
    flight.count = clamp(Math.round(count), 1, flight.birds.length);
    let behind = 0;
    for (let i = 0; i < flight.count; i += 1) {
        const bird = flight.birds[i];
        // A V's two arms take the birds in turn; a line trails them all to one side.
        const rank = line ? i * slot.line : Math.ceil(i / 2);
        const side = line || i % 2 ? lean : -lean;
        behind += i ? slot.step * size * (1 + (craneChance(own, 3, i) * 2 - 1) * slot.jitter) : 0;
        bird.out = side * rank * slot.out * size * (1 + (craneChance(own, 4, i) * 2 - 1) * slot.jitter);
        bird.back = behind;
        bird.up = rank * slot.up * size + (craneChance(own, 5, i) - 0.5) * 0.5;
        bird.hz = CRANE_FLIGHT.beat * (1 + (craneChance(own, 6, i) * 2 - 1) * CRANE_FLIGHT.spread);
        // A wave of strokes runs down the skein, each bird a little off it.
        bird.phase = i * 0.9 + craneChance(own, 7, i) * 1.6;
        bird.wander = craneChance(own, 8, i) * TAU;
        bird.rate = 0.34 + craneChance(own, 9, i) * 0.3;
        bird.size = size * (0.96 + craneChance(own, 10, i) * 0.08);
        // When it sets its wings: how often (radians a second) and where in that round it starts.
        bird.glide = TAU / (8 + craneChance(own, 11, i) * 7);
        bird.rest = craneChance(own, 12, i) * TAU;
    }
    // In the air until the last bird is past the route's end.
    flight.life = (route.length + behind) / CRANE_FLIGHT.speed;
    /* eslint-enable no-param-reassign */
    return flight;
}

/**
 * Bird `i` of a flight `age` seconds after it set out: its place (out[0..2]) and unit heading
 * (out[3..5]). The same for any age: nothing is integrated.
 */
export function craneFlightPlace(flight, i, age, out = [0, 0, 0, 0, 0, 0]) {
    const bird = flight.birds[i];
    const { route } = flight;
    const [across, up, along] = CRANE_FLIGHT.loose;
    const drift = age * bird.rate + bird.wander;
    const run = age * CRANE_FLIGHT.speed - bird.back + along * Math.sin(drift * 0.8 + 2.1);
    craneRoutePoint(route, flight.reversed ? route.length - run : run, out);
    /* eslint-disable no-param-reassign */
    if (flight.reversed) {
        out[3] = -out[3];
        out[4] = -out[4];
        out[5] = -out[5];
    }
    // Its slot: out to the side of the heading (its right is (-fz, fx) seen from above), a little
    // above, loose in both.
    const flat = Math.hypot(out[3], out[5]) || 1;
    const aside = bird.out + across * Math.sin(drift);
    out[0] += (-out[5] / flat) * aside;
    out[2] += (out[3] / flat) * aside;
    out[1] += bird.up + up * Math.sin(drift * 0.7 + 1.3);
    /* eslint-enable no-param-reassign */
    return out;
}

/**
 * A crane's downstroke is slow and its upstroke quick: the beat's phase θ (even in time) is warped
 * to the stroke's φ = θ + w (1 − cos θ), monotonic, the downstroke (φ from 0 to π) taking its share.
 */
const STROKE_WARP = (Math.PI - TAU * CRANE_FLIGHT.downstroke) / (1 - Math.cos(TAU * CRANE_FLIGHT.downstroke));

/**
 * The wing's two turns (out[0] the shoulder's, out[1] the wrist's: radians, + up) and the body's
 * heave (out[2], metres at life size) at beat phase `theta` (0 the top of the stroke), `flap` of
 * the way from the glide (0: wings set) to the full beat (1).
 */
export function craneWingbeat(theta, flap = 1, out = [0, 0, 0]) {
    const phi = theta + STROKE_WARP * (1 - Math.cos(theta));
    const [armMean, armSwing] = CRANE_FLIGHT.arm;
    const [handMean, handSwing, lag] = CRANE_FLIGHT.hand;
    const [armSet, handSet] = CRANE_FLIGHT.glide;
    const f = clamp(flap, 0, 1);
    /* eslint-disable no-param-reassign */
    out[0] = armSet + (armMean + armSwing * Math.cos(phi) - armSet) * f;
    // The hand trails the arm: still up as the arm comes down, still down as it goes up.
    out[1] = handSet + (handMean + handSwing * Math.cos(phi - lag) - handSet) * f;
    // The body rides against the stroke: lowest with the wings up, highest with them down.
    out[2] = -CRANE_FLIGHT.heave * Math.cos(phi) * f;
    /* eslint-enable no-param-reassign */
    return out;
}

/** How much of its beat bird `i` keeps `age` seconds in (1 beating, 0 gliding on set wings): a short glide now and then. */
export function craneFlap(flight, i, age) {
    const bird = flight.birds[i];
    return 1 - smooth(0.9, 0.975, 0.5 + 0.5 * Math.sin(age * bird.glide + bird.rest));
}

// ── When a flight sets out ───────────────────────────────────────────────────

/** The cranes' own seed: their chances are theirs, whatever the garden drew before them. */
export const CRANE_SEED = 0x7a9c;

/**
 * The night's timetable (seconds): the first flight sets out `first` in, each next one `gap`
 * after the one before it set out. A flight is in the air for most of a minute, a third of it in
 * the frame (it sets out, and ends, beyond the widest frame there is).
 */
export const CRANE_TIMES = Object.freeze({ first: Object.freeze([14, 40]), gap: Object.freeze([80, 150]) });

/** Seconds from flight `number` setting out to the next one (flight -1: from the night's start to the first). */
export function craneGap(seed, number) {
    const [low, high] = number < 0 ? CRANE_TIMES.first : CRANE_TIMES.gap;
    return low + (high - low) * craneChance(seed, 0x7a, number + 1);
}

/**
 * Which of `count` routes flight `number` takes (each in turn, so none comes twice running) and
 * which way it flies it.
 */
export function craneRouteFor(seed, number, count, out = { route: 0, reversed: false }) {
    const n = Math.max(1, count);
    // A stride that shares no factor with the count visits every route before any comes again.
    let stride = 1 + Math.floor(craneChance(seed, 0x51) * Math.max(1, n - 1));
    for (let tries = 0; tries < n && n > 1; tries += 1) {
        let x = stride;
        let y = n;
        while (y) [x, y] = [y, x % y];
        if (x === 1) break;
        stride = (stride % (n - 1)) + 1;
    }
    /* eslint-disable no-param-reassign */
    out.route = (Math.floor(craneChance(seed, 0x52) * n) + number * stride) % n;
    out.reversed = craneChance(seed, 0x53, number) < 0.4;
    /* eslint-enable no-param-reassign */
    return out;
}

/** How many birds flight `number` has, of the `most` a tier allows: five to nine, fewer only where the tier has fewer. */
export function craneSkeinSize(seed, number, most = CRANE_FLIGHT.most) {
    const top = clamp(Math.round(most), 1, CRANE_FLIGHT.most);
    const low = Math.min(CRANE_FLIGHT.least, top);
    return low + Math.floor(craneChance(seed, 0x54, number) * (top - low + 1));
}

// ── The night's routes ───────────────────────────────────────────────────────

/**
 * The routes, as planCraneRoutes() below finds them: the best line of each kind of flight
 * (CRANE_KINDS). Written by `node scripts/sakura-crane-probe.mjs --write`; the tests hold this
 * table to the plan, so a change to the cameras, the land or the flight asks for it to be written
 * again. See craneRoutePoint() for what the numbers are.
 */
// <routes>
export const CRANE_ROUTES = Object.freeze([
    {
        kind: 'cone',
        x: -210.2314572651995,
        z: -125.39318219007517,
        heading: 0.06095528792471556,
        turn: 0,
        from: 26.66707304686218,
        to: 26.60277820696889,
        length: 388,
    },
    {
        kind: 'summit',
        x: -211.91207558239338,
        z: -131.12714092274717,
        heading: 0.10088529607564467,
        turn: 0,
        from: 47.168777139066286,
        to: 35.78278312500991,
        length: 388,
    },
].map((route) => Object.freeze(route)));
// </routes>

// ── Marking a route through the rest cameras ─────────────────────────────────

const inWindow = (s, w) => s.x >= w.x0 && s.x <= w.x1 && s.y >= w.y0 && s.y <= w.y1;

/** True when a place on screen is in the frame, or within `metres` of it at its depth (a bird's reach, a skein's). */
function inFrame(lens, s, metres = 0) {
    if (!s) return false;
    const padX = metres / (s.depth * lens.tanH * 2) + (metres ? 0.02 : 0);
    const padY = metres / (s.depth * lens.tanV * 2) + (metres ? 0.02 : 0);
    return s.x > -padX && s.x < 1 + padX && s.y > -padY && s.y < 1 + padY;
}

/** True when the eye's line to a point ends on the mountain, or passes within `over` m above its line. */
function againstMountain(lens, x, y, z, over) {
    const [ex, ey, ez] = lens.eye;
    const m = CRANE_MOUNTAIN;
    // Where the sight line passes nearest the mountain's axis, seen from above.
    const dx = x - ex;
    const dz = z - ez;
    const t = ((m.x - ex) * dx + (m.z - ez) * dz) / (dx * dx + dz * dz);
    if (!(t > 1)) return false;
    const high = craneMountainHeight(ex + dx * t, ez + dz * t);
    return high > m.y + 1 && ey + (y - ey) * t < high + over;
}

/**
 * True when the lake shows a bird's mirror image to a lens: the place on the water where the eye
 * meets it is open water, on screen, and in a part of the frame the framing leaves open (`water`).
 */
function mirrored(lens, x, y, z, water, s) {
    const [ex, ey, ez] = lens.eye;
    // The eye's line to the image under the water meets the surface this far along.
    const t = ey / (ey + y);
    const px = ex + (x - ex) * t;
    const pz = ez + (z - ez) * t;
    if (!(sakuraLand(px, pz) < -1.5)) return false;
    const at = lens.project(px, 0, pz, s);
    return Boolean(at) && inWindow(at, water);
}

const scratch = {
    p: [0, 0, 0, 0, 0, 0], s: { x: 0, y: 0, depth: 0 }, t: { x: 0, y: 0, depth: 0 }, flight: null,
};
/** The two framings at their widest: what a flight must begin and end outside of. */
const WIDEST = Object.freeze([
    craneLens('landscape', CRANE_VIEWS.landscape.widest), craneLens('portrait', CRANE_VIEWS.portrait.widest),
]);

/**
 * The widest skein there is, laid on a route for the marking: nine birds in a V (the widest and
 * the longest a flight can be, give or take the slots' few percent).
 */
function widestSkein(route) {
    if (!scratch.flight) scratch.flight = createCraneFlight();
    return layCraneSkein(scratch.flight, route, CRANE_FLIGHT.most, 0x5eed, 0, false);
}

/**
 * What a route must do to be flown at all, and how it is marked. `reads`: the span (px, in a
 * 1280-wide landscape frame or a 540-wide portrait one) under which a bird is a speck and from
 * which it reads as a crane; a bird's second in the open sky counts by where its span lies between
 * them (`well`). The least seconds (of the whole skein's) a route must show so in each framing; the least and the most it is in
 * the landscape frame (s); how steeply it may climb; how long before the next flight may set out
 * it must be gone (s); and how unlike each other the night's routes must be (m between their
 * lines, a third, half and two thirds of the way).
 */
export const CRANE_PLAN = Object.freeze({
    reads: Object.freeze([12, 22]),
    well: Object.freeze({ landscape: 3.5, portrait: 3.5 }),
    inFrame: Object.freeze([8, 45]),
    slope: 0.1,
    spare: 6,
    unlike: 15,
});

/**
 * Walk a route's widest skein through one rest lens, bird by bird. Seconds are counted two ways:
 * while ANY bird is somewhere (`inFrame`, `seen`: how long the flight is to be watched), and by
 * the share of the skein that is there (`birds`: in the frame; `open`: in the framing's open sky;
 * `well`: there and counted by its size; `mountain`: there, counted the same way, against the
 * mountain; `mirror`: there with its mirror image on the open lake; `windows`: in each open
 * window). `side` is how far from the side the birds are seen in the open sky (1 square across
 * the line of sight, 0 head on or tail on), `span` and `least` the span a bird is drawn at there
 * (pixels of a 1280-wide landscape frame or a 540-wide portrait one), `nearest` the nearest a
 * bird comes to the eye while it is in the frame, and `born` and `gone` whether every bird is
 * outside the frame at both ends (at the framing's widest aspect). `birds` is how many of the
 * skein are walked (the planner's quick mark walks the leader and the two arms' ends).
 */
export function watchCraneRoute(route, framing, step = 0.1, birds = CRANE_FLIGHT.most) {
    const view = CRANE_VIEWS[framing];
    const lens = craneLens(framing);
    const wide = craneLens(framing, view.widest);
    const windows = CRANE_SKY[framing];
    const water = CRANE_SKY.water[framing];
    const flight = widestSkein(route);
    const { p, s } = scratch;
    const pixels = (framing === 'landscape' ? 1280 : 540) / (2 * lens.tanH);
    const [small, large] = CRANE_PLAN.reads;
    const out = {
        framing,
        inFrame: 0,
        seen: 0,
        birds: 0,
        open: 0,
        well: 0,
        mountain: 0,
        mirror: 0,
        side: 0,
        windows: windows.map(() => 0),
        span: 0,
        least: Infinity,
        nearest: Infinity,
        born: true,
        gone: true,
    };
    // Outside the widest frame, with a bird's own reach about its middle (half a span and a little).
    const outside = (age) => {
        for (let i = 0; i < flight.count; i += 1) {
            craneFlightPlace(flight, i, age, p);
            if (inFrame(wide, wide.project(p[0], p[1], p[2], s), 0.67 * CRANE_SPAN * CRANE_FLIGHT.size)) return false;
        }
        return true;
    };
    out.born = outside(0);
    out.gone = outside(flight.life);
    // The leader, then the birds from the skein's tail forward (the two arms' ends first).
    const walked = Math.min(Math.max(1, birds), flight.count);
    const each = step / walked;
    let spans = 0;
    for (let age = 0; age <= flight.life + 1e-6; age += step) {
        let framed = false;
        let shown = false;
        for (let k = 0; k < walked; k += 1) {
            craneFlightPlace(flight, k ? flight.count - k : 0, age, p);
            const at = lens.project(p[0], p[1], p[2], s);
            if (inFrame(lens, at)) {
                framed = true;
                out.birds += each;
                const range = Math.hypot(p[0] - lens.eye[0], p[1] - lens.eye[1], p[2] - lens.eye[2]);
                out.nearest = Math.min(out.nearest, range);
                let open = false;
                for (let w = 0; w < windows.length; w += 1) {
                    if (inWindow(at, windows[w])) {
                        out.windows[w] += each;
                        open = true;
                    }
                }
                if (open) {
                    const span = ((CRANE_SPAN * CRANE_FLIGHT.size) / at.depth) * pixels;
                    // A second counts in full where a bird is large enough to be a crane, and not
                    // at all where it is a speck.
                    const reads = clamp((span - small) / (large - small), 0, 1);
                    const dx = lens.eye[0] - p[0];
                    const dz = lens.eye[2] - p[2];
                    const along = (p[3] * dx + p[5] * dz) / ((Math.hypot(dx, dz) || 1) * (Math.hypot(p[3], p[5]) || 1));
                    shown = true;
                    out.open += each;
                    out.well += each * reads;
                    out.side += Math.sqrt(Math.max(0, 1 - along * along));
                    out.span += span;
                    out.least = Math.min(out.least, span);
                    spans += 1;
                    if (againstMountain(lens, p[0], p[1], p[2], 14)) out.mountain += each * reads;
                    if (mirrored(lens, p[0], p[1], p[2], water, scratch.t)) out.mirror += each;
                }
            }
        }
        if (framed) out.inFrame += step;
        if (shown) out.seen += step;
    }
    out.span = spans ? out.span / spans : 0;
    out.side = spans ? out.side / spans : 0;
    if (!spans) out.least = 0;
    if (!Number.isFinite(out.nearest)) out.nearest = 0;
    return out;
}

/**
 * How far any skein reaches about its leader's line: to either side (the outermost slot of the
 * widest V, which no line reaches past, its looseness and a bird's wander), behind (the last slot
 * of nine) and below (a bird's own lowest in its slot).
 */
export function craneSkeinReach() {
    const { slot, size, most } = CRANE_FLIGHT;
    const [across, up, along] = CRANE_FLIGHT.loose;
    const ranks = Math.max(Math.ceil((most - 1) / 2), (most - 1) * slot.line);
    return {
        aside: ranks * slot.out * size * (1 + slot.jitter) + across,
        behind: (most - 1) * slot.step * size * (1 + slot.jitter) + along,
        below: 0.25 + up,
    };
}

/**
 * True when every place a bird of any skein can be on a route, flown either way, is at the height
 * a crane keeps there (and `margin` m more): the leader's line, the skein's reach to either side
 * of it and behind it, a bird's lowest in its slot. Walked every `step` metres.
 */
export function craneRouteClear(route, step = 2.5, margin = 0) {
    const { p } = scratch;
    const { aside, behind, below } = craneSkeinReach();
    for (let run = -behind; run <= route.length + behind; run += step) {
        craneRoutePoint(route, run, p);
        const flat = Math.hypot(p[3], p[5]) || 1;
        for (let k = -2; k <= 2; k += 1) {
            const out = (k / 2) * aside;
            const floor = craneFloor(p[0] + (-p[5] / flat) * out, p[2] + (p[3] / flat) * out);
            if (p[1] - below < floor + margin) return false;
        }
    }
    return true;
}

/**
 * Mark a route (null: no flight). `fine` walks every bird in tenths of a second (the kept routes'
 * reading, the probe's and the tests'); without it the leader and the arms' ends in whole seconds,
 * with a little more height asked for: a quick mark that ranks the lines.
 */
export function scoreCraneRoute(route, fine = true) {
    if (Math.abs(route.to - route.from) / route.length > CRANE_PLAN.slope) return null;
    const birds = fine ? CRANE_FLIGHT.most : 3;
    // (The slowest skein's last bird must be gone before the next flight may set out.)
    if (widestSkein(route).life > CRANE_TIMES.gap[0] - CRANE_PLAN.spare) return null;
    if (!craneRouteClear(route, fine ? 2.5 : 10, fine ? 0 : 1)) return null;
    const step = fine ? 0.1 : 1;
    const landscape = watchCraneRoute(route, 'landscape', step, birds);
    if (!landscape.born || !landscape.gone) return null;
    if (landscape.well < CRANE_PLAN.well.landscape) return null;
    if (landscape.inFrame < CRANE_PLAN.inFrame[0] || landscape.inFrame > CRANE_PLAN.inFrame[1]) return null;
    const portrait = watchCraneRoute(route, 'portrait', step, birds);
    if (!portrait.born || !portrait.gone) return null;
    if (portrait.well < CRANE_PLAN.well.portrait) return null;
    if (Math.min(landscape.nearest || Infinity, portrait.nearest || Infinity) < CRANE_FLIGHT.near) return null;
    // Long in the landscape's open sky as birds large enough to be cranes, the more from the side
    // the better, and a little for every second any of them is there at all; then the seconds
    // against the mountain, the seconds mirrored in the lake, and the portrait sky.
    const score = Math.min(landscape.well, 12) * (0.6 + 0.4 * landscape.side) + 0.25 * Math.min(landscape.seen, 16)
        + 1.6 * Math.min(landscape.mountain, 5) + 0.4 * Math.min(landscape.mirror, 4)
        + 0.5 * Math.min(portrait.well, 12);
    return { score, landscape, portrait };
}

/**
 * Lay a line through two places and fly it out both ways until the widest skein is outside every
 * frame: the route from there to there (null when it never leaves, or would be no flight).
 * `a` and `b` are world points ([x, y, z]) the leader passes, `turn` how the line bends (rad/m).
 */
export function layCraneRoute(a, b, turn = 0) {
    const chord = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (!(chord > 20)) return null;
    // An arc through both: it sets out from `a` turned half its whole turn off the chord.
    const sweep = 2 * Math.asin(clamp((turn * chord) / 2, -1, 1));
    const between = Math.abs(turn) < 1e-9 ? chord : sweep / turn;
    const heading = Math.atan2(b[2] - a[2], b[0] - a[0]) - sweep / 2;
    const slope = (b[1] - a[1]) / between;
    const line = {
        x: a[0], z: a[2], heading, turn, from: a[1], to: a[1] + slope * 100, length: 100,
    };
    const { p, s } = scratch;
    // How far a skein reaches to either side of its leader's line, and a bird's own half span.
    const reach = craneSkeinReach().aside + 0.8 * CRANE_SPAN * CRANE_FLIGHT.size;
    // And a little past the frame's edge before the leader is born, and after the last bird is gone.
    const spare = 6;
    const beyond = (direction) => {
        // The first run in that direction from which the line stays outside every frame for good.
        let last = null;
        for (let run = 0; Math.abs(run) <= 560; run += direction * 8) {
            craneRoutePoint(line, run, p);
            let shown = false;
            for (let k = 0; k < WIDEST.length && !shown; k += 1) {
                const lens = WIDEST[k];
                const at = lens.project(p[0], p[1], p[2], s);
                // (Behind the eye is out of sight, but not within the skein's reach of it.)
                if (at) shown = inFrame(lens, at, reach);
                else shown = Math.hypot(p[0] - lens.eye[0], p[2] - lens.eye[2]) < reach;
            }
            if (shown) last = null;
            else if (last === null) last = run;
        }
        return last;
    };
    const start = beyond(-1);
    const end = beyond(1);
    if (start === null || end === null) return null;
    // The leader is born `spare` outside (the others behind it, further out still); the flight is
    // over when the last bird is that far outside at the other end.
    const first = craneRoutePoint(line, start - spare, p);
    return {
        x: first[0],
        z: first[2],
        heading: heading + turn * (start - spare),
        turn,
        from: a[1] + slope * (start - spare),
        to: a[1] + slope * (end + spare),
        length: end - start + 2 * spare,
    };
}

/** How unlike two routes are: metres between their leaders, a third, half and two thirds of the way. */
function unlike(q, r) {
    const a = [0, 0, 0, 0, 0, 0];
    const b = [0, 0, 0, 0, 0, 0];
    let sum = 0;
    for (const share of [0.3, 0.5, 0.7]) {
        craneRoutePoint(q, q.length * share, a);
        craneRoutePoint(r, r.length * share, b);
        sum += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    return sum / 3;
}

/**
 * The kinds of flight the night has, each a family of lines laid through the landscape rest frame:
 * `first` a place in the open sky left of the card (screen x, screen y, metres off: every
 * combination), `second` a place beyond it, `turn` how the line may bend (rad/m), and what the
 * kind is for (`needs`: the skein's seconds, as scoreCraneRoute reads them through the landscape
 * camera). Both cross the lake from side to side, so the birds are seen from the side, the view
 * that shows a crane (head on, as a skein flying at the eye is seen, a crane is a line with a dot
 * in it: the lines toward the eye that were tried scored longer and read worse).
 *  - cone:   level across the mountain's cone, and away behind the old cherry's crown;
 *  - summit: nearer and higher, over the mountain's summit and on through the strip of sky over
 *            the card's right shoulder: the larger birds.
 * Either is flown either way.
 */
export const CRANE_KINDS = Object.freeze([
    {
        name: 'cone',
        first: [[0.2, 0.26, 0.32], [0.3, 0.33], [118, 132]],
        second: [[0.8, 0.32, 125], [0.92, 0.32, 145]],
        turn: [0],
        needs: { mountain: 2.2 },
    },
    {
        name: 'summit',
        first: [[0.2, 0.26, 0.32], [0.2, 0.26], [115, 130]],
        second: [[0.8, 0.2, 120], [0.92, 0.24, 140]],
        turn: [0, -1 / 600],
        needs: { well: 4.5 },
    },
].map((kind) => Object.freeze({ ...kind, needs: Object.freeze(kind.needs) })));

/** True when what the landscape camera saw of a route is what its kind is for. */
function serves(kind, seen) {
    const { landscape } = seen;
    const { needs } = kind;
    return landscape.well >= (needs.well ?? 0) && landscape.mountain >= (needs.mountain ?? 0)
        && landscape.mirror >= (needs.mirror ?? 0) && landscape.windows[1] >= (needs.strip ?? 0);
}

/**
 * Find the night's routes: the best line of each kind (CRANE_KINDS, in that order; a kind none of
 * whose lines is a flight has no route). Every line is flown out to beyond every frame and given
 * a quick mark through both rest cameras; then, from the best down, each that is unlike the routes
 * already kept is walked in full (scoreCraneRoute) until one is a flight that does what its kind
 * is for. Some tens of milliseconds: the probe and the tests run it, a garden reads CRANE_ROUTES.
 */
export function planCraneRoutes() {
    const lens = craneLens('landscape');
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const routes = [];
    for (const kind of CRANE_KINDS) {
        const found = [];
        const [xs, ys, depths] = kind.first;
        for (const sx of xs) {
            for (const sy of ys) {
                for (const depth of depths) {
                    for (const [tx, ty, far] of kind.second) {
                        for (const turn of kind.turn) {
                            lens.point(sx, sy, depth, a);
                            lens.point(tx, ty, far, b);
                            const route = layCraneRoute(a, b, turn);
                            const quick = route && scoreCraneRoute(route, false);
                            if (quick) found.push({ route, quick: quick.score + (serves(kind, quick) ? 100 : 0) });
                        }
                    }
                }
            }
        }
        found.sort((q, r) => r.quick - q.quick);
        for (let i = 0; i < found.length; i += 1) {
            const { route } = found[i];
            const fresh = routes.every((kept) => unlike(kept, route) > CRANE_PLAN.unlike);
            const seen = fresh && scoreCraneRoute(route, true);
            if (seen && serves(kind, seen)) {
                routes.push(Object.freeze({ kind: kind.name, ...route }));
                break;
            }
        }
    }
    return routes;
}
