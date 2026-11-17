/**
 * Summer — where the swans go (numbers only: summer-swans.js draws them).
 *
 *  - THE VOYAGE the family swims: a long line round the whole lake, laid through places it calls
 *    at (SWAN_VOYAGE), each sited through the rest camera at 16:9: the water left of the board in
 *    the sun's road, the bay under the headland's near side, the far bay under its wood, the water
 *    off the homestead right of the board. Between them the family swims at a swan's pace and is
 *    hidden a while behind the board card, as anything on the water is; about them it slows,
 *    draws together and spreads out to feed. The cob leads, the pen and the cygnets swim his line
 *    a few metres behind him.
 *  - A FLIGHT across the lake: candidate lines are laid through the lens (how deep they are at
 *    the frame's two edges, how they bend, how high they come in, how low they cross) and scored
 *    there. The best is seen longest in the side thirds: in the open sky right of the card (over
 *    where the stats stand), then, come down behind the card, low across the water left of it
 *    under the evening sun without crossing its disc. It takes 9 to 12 s from edge to edge, and
 *    begins and ends beyond the widest frame the theme is ever shown in.
 *
 * Everything is a closed form of the clock (the voyage: a table of the seconds to each metre of
 * its line, laid once) or of the seconds since a skein went up (a flight): a seek to any time
 * lands where play would have, nothing is integrated from frame to frame, and nothing is
 * allocated once a line is laid.
 */
import { summerEye, summerViewFor } from './summer-composition.js';
import { SUMMER_HOURS, summerSunDirection } from './summer-hours.js';
import { SUMMER_DEFAULT_BOARD } from './summer-stage.js';
import { SUMMER_PLACES, summerGroundHeight, summerShores } from './summer-terrain.js';

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
    // The weeping birch's crown and hanging strands, right of the open sky beside the card.
    birch: Object.freeze({ x0: 0.7, y1: 0.47 }),
});

const lensScratch = { x: 0, y: 0, depth: 0 };

// ── The voyage round the lake ────────────────────────────────────────────────

/**
 * How a swan on the water is seen from the rest eye: how deep the bed must lie under it, how far
 * from the eye it may be and still be seen at all (`range`) and how far it still reads as a swan
 * and not a white speck (`reads`: the haze and mist take the rest; both read off the theme's own
 * frames, 2026-11-17), how much of the frame is kept clear beside the card, the line on screen the
 * meadow's flowers stand up to in front of the lake (a swan's waterline must show above it), and
 * what stands on the land between the eye and the lake (flowers on the near meadow; the lawn and
 * the low boathouse on the homestead's open tip; reeds at the water's edge and in its first
 * shallows; wood on the other banks).
 */
export const SWAN_SIGHT = Object.freeze({
    deep: -0.4,
    range: Object.freeze([18, 150]),
    reads: 110,
    beside: 0.02,
    meadow: 0.578,
    flowers: 1.0,
    yard: 1.3,
    boathouse: 3,
    reeds: 1.7,
    wood: 12,
});

/** True for the near meadow: the flowering land the camera stands on, between the wooded banks. */
function onMeadow(x, z) {
    const shores = summerShores(x, z);
    return shores.near > 0 && shores.homestead <= 0 && x > -20.5 && x < 18.5;
}

/** What stands on the land at (x, z) above its ground, as the rest eye looks over it to the water. */
function standsOn(x, z, ground) {
    if (ground < 0.3) return SWAN_SIGHT.reeds;
    if (onMeadow(x, z)) return SWAN_SIGHT.flowers;
    // The homestead's tip, short of the cottage: lawn, and the boathouse at the water.
    if (x < SUMMER_PLACES.cottage.x + 1 && summerShores(x, z).homestead > 0) {
        const { shed } = SUMMER_PLACES;
        return Math.hypot(x - shed.x, z - shed.z) < 2.6 ? SWAN_SIGHT.boathouse : SWAN_SIGHT.yard;
    }
    return SWAN_SIGHT.wood;
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
        if (ground > -0.65 && ey + (0.2 - ey) * t < Math.max(ground, 0) + standsOn(px, pz, ground)) return false;
    }
    return true;
}

/**
 * Where a swan on the lake at (x, z) shows in the rest frame: 0 nowhere (too shallow, too near
 * or too far to read, off the frame, behind the card or the spruce, under the meadow's flowers,
 * hidden by the land), -1 in the left third, 1 in the right.
 */
export function swanWaterSide(lens, x, z, groundHeight = summerGroundHeight) {
    if (!(groundHeight(x, z) < SWAN_SIGHT.deep)) return 0;
    const range = Math.hypot(x - lens.eye[0], z - lens.eye[2]);
    if (range < SWAN_SIGHT.range[0] || range > SWAN_SIGHT.range[1]) return 0;
    const s = lens.project(x, 0, z, lensScratch);
    if (!s || s.y < 0.08 || s.y > SWAN_SIGHT.meadow) return 0;
    let side = 0;
    if (s.x >= FRAME.left && s.x <= FRAME.card[0] - SWAN_SIGHT.beside) side = -1;
    else if (s.x >= FRAME.card[1] + SWAN_SIGHT.beside && s.x <= FRAME.right) side = 1;
    if (side === 0) return 0;
    return sightClear(lens, x, z, groundHeight) ? side : 0;
}

/**
 * The family's voyage round the lake, a lap of some fourteen minutes. `calls` are the places
 * (x, z) its leader's line runs through in turn and back to the first, each with the seconds the
 * family stays about it (feeding, dawdling; 0: it swims on by) and, if it is not 1, its pace from
 * there as a share of `cruise` (m/s). First a round of the near water left of the board, where a
 * swan reads best (the sun's road by the maypole, the headland's dark mirror, behind the skerry),
 * then the voyage: out along the headland and round its tip, across the far water behind the
 * board at a swan's quicker pace (nothing of them shows there), to the water off the homestead
 * between the boathouse and the cottage, and home behind the card. A stay slows the family over
 * `reach` metres of the line either side of its place (the spread of the slowing). The line is
 * eased over `ease` metres either side of every point (no corner a swan would not swim), weaves
 * gently across itself (`weave`: metres, and about how many metres a swing takes), keeps `beam`
 * metres either side of it over a bed deeper than `deep` (the family's own spread, clear of the
 * reeds of the first shallows) and is laid in samples about `step` metres apart. At the session's
 * start the leader is `start` seconds short of the first place: coming into its first stay, in
 * plain sight.
 */
export const SWAN_VOYAGE = Object.freeze({
    calls: Object.freeze([
        // The near water, round once: the sun's road by the maypole, the headland's dark mirror,
        // its near shore, behind the skerry and home.
        Object.freeze([-24, -47, 50]),
        Object.freeze([-33, -50, 0]),
        Object.freeze([-39, -57, 45]),
        Object.freeze([-44, -70, 0]),
        Object.freeze([-38, -84, 0]),
        Object.freeze([-30, -76, 0]),
        Object.freeze([-28, -62, 0]),
        Object.freeze([-21, -52, 0]),
        Object.freeze([-15, -48, 30]),
        Object.freeze([-17, -43, 0]),
        Object.freeze([-26, -45, 0]),
        // Then the voyage: out along the headland, round its tip to the far water and across it
        // behind the board (swimming with a will where nothing of them shows), down to the water
        // off the homestead, and home behind the card.
        Object.freeze([-33, -60, 0]),
        Object.freeze([-43, -84, 30]),
        Object.freeze([-31, -100, 0, 1]),
        Object.freeze([-28, -116, 0, 1.6]),
        Object.freeze([-34, -130, 0, 1.6]),
        Object.freeze([-12, -132, 0, 1.6]),
        Object.freeze([14, -116, 0, 1.6]),
        Object.freeze([31, -98, 0, 1.1]),
        Object.freeze([37, -84, 35]),
        Object.freeze([35, -70, 0, 1.2]),
        Object.freeze([22, -57, 0, 1.5]),
        Object.freeze([4, -51, 0, 1.5]),
        Object.freeze([-12, -49, 0, 1.1]),
    ]),
    cruise: 0.5,
    reach: 7,
    beam: 2.4,
    deep: -1.1,
    ease: 2.5,
    weave: Object.freeze([0.5, 32]),
    step: 0.5,
    start: -10,
});

/** How the line is drawn through the places: points of the curve between two of them. */
const VOYAGE_SUBSTEPS = 48;

/** A centripetal Catmull-Rom curve's point `u` (0..1) of the way from p1 to p2 (x, z into out). */
function catmullRom(p0, p1, p2, p3, u, out) {
    const knot = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const t = t1 + u * (t2 - t1);
    for (let c = 0; c < 2; c += 1) {
        const a1 = ((t1 - t) / t1) * p0[c] + (t / t1) * p1[c];
        const a2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
        const a3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
        const b1 = ((t2 - t) / t2) * a1 + (t / t2) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        out[c] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
    }
    return out;
}

/** A closed polyline's running lengths: one more than its points, the last the whole lap. */
function runningLengths(xy) {
    const m = xy.length / 2;
    const along = new Float64Array(m + 1);
    for (let k = 1; k <= m; k += 1) {
        const a = 2 * (k - 1);
        const b = 2 * (k % m);
        along[k] = along[k - 1] + Math.hypot(xy[b] - xy[a], xy[b + 1] - xy[a + 1]);
    }
    return along;
}

/** A closed polyline laid again in `count` even samples (`along`: its running lengths). */
function evenly(xy, along, count) {
    const m = xy.length / 2;
    const length = along[m];
    const out = new Float64Array(count * 2);
    for (let k = 0, j = 0; k < count; k += 1) {
        const s = (k * length) / count;
        while (j < m - 1 && along[j + 1] <= s) j += 1;
        const f = (s - along[j]) / Math.max(1e-9, along[j + 1] - along[j]);
        const a = 2 * j;
        const b = 2 * ((j + 1) % m);
        out[2 * k] = xy[a] + (xy[b] - xy[a]) * f;
        out[2 * k + 1] = xy[a + 1] + (xy[b + 1] - xy[a + 1]) * f;
    }
    return out;
}

/** A closed polyline eased: each point the mean of the `half` points either side of it and itself. */
function eased(xy, half) {
    const m = xy.length / 2;
    const out = new Float64Array(xy.length);
    for (let k = 0; k < m; k += 1) {
        let x = 0;
        let z = 0;
        for (let d = -half; d <= half; d += 1) {
            const j = (((k + d) % m) + m) % m;
            x += xy[2 * j];
            z += xy[2 * j + 1];
        }
        out[2 * k] = x / (2 * half + 1);
        out[2 * k + 1] = z / (2 * half + 1);
    }
    return out;
}

/** The unit heading of a closed polyline at its point `k` (from its neighbours), into out. */
function headingAt(xy, k, out) {
    const m = xy.length / 2;
    const a = 2 * ((k - 1 + m) % m);
    const b = 2 * ((k + 1) % m);
    const hx = xy[b] - xy[a];
    const hz = xy[b + 1] - xy[a + 1];
    const h = Math.hypot(hx, hz) || 1;
    out[0] = hx / h;
    out[1] = hz / h;
    return out;
}

/**
 * Lay the voyage on the lake: the leader's line in even samples (place, heading, how much the
 * family lingers there, its pace), the seconds it takes to reach each sample, and the lap. The
 * curve through the places is eased (no turn tighter than a swan swims one: `ease` metres of
 * line either side of every point) and woven. Null when the line, with the family's beam either
 * side of it, does not keep to deep water on this land.
 */
export function laySwanVoyage({ groundHeight = summerGroundHeight, voyage = SWAN_VOYAGE } = {}) {
    const { calls } = voyage;
    const n = calls.length;
    // The curve through the places, densely, and where along it each place is.
    const points = [];
    const placed = [];
    const point = [0, 0];
    for (let i = 0; i < n; i += 1) {
        placed.push(points.length / 2);
        const p0 = calls[(i - 1 + n) % n];
        const p2 = calls[(i + 1) % n];
        const p3 = calls[(i + 2) % n];
        for (let k = 0; k < VOYAGE_SUBSTEPS; k += 1) {
            catmullRom(p0, calls[i], p2, p3, k / VOYAGE_SUBSTEPS, point);
            points.push(point[0], point[1]);
        }
    }
    const dense = Float64Array.from(points);
    const first = runningLengths(dense);
    const rough = Math.max(8, Math.round(first[dense.length / 2] / voyage.step));
    // Even samples, eased twice (the corners round off), then the weave across the line.
    const half = Math.max(1, Math.round(voyage.ease / voyage.step));
    const base = eased(eased(evenly(dense, first, rough), half), half);
    const sampleOf = placed.map((k) => Math.round((first[k] / first[dense.length / 2]) * rough) % rough);
    const [weave, swing] = voyage.weave;
    const swings = Math.max(1, Math.round(first[dense.length / 2] / swing));
    const woven = new Float64Array(rough * 2);
    const h = [0, 0];
    for (let k = 0; k < rough; k += 1) {
        headingAt(base, k, h);
        const aside = weave * Math.sin((TAU * swings * k) / rough);
        // The heading's left is (hz, -hx) seen from above (x right, z toward the eye).
        woven[2 * k] = base[2 * k] + h[1] * aside;
        woven[2 * k + 1] = base[2 * k + 1] - h[0] * aside;
    }
    // Laid again in even steps along what the line has become.
    const along = runningLengths(woven);
    const length = along[rough];
    const count = Math.max(8, Math.round(length / voyage.step));
    const step = length / count;
    const even = evenly(woven, along, count);
    const line = new Float32Array(count * 4);
    for (let k = 0; k < count; k += 1) {
        headingAt(even, k, h);
        const x = even[2 * k];
        const z = even[2 * k + 1];
        // The line and the family's beam either side of it keep to deep water.
        for (const aside of [0, voyage.beam, -voyage.beam]) {
            if (!(groundHeight(x + h[1] * aside, z - h[0] * aside) < voyage.deep)) return null;
        }
        line.set([x, z, h[0], h[1]], 4 * k);
    }
    // How slowly each sample is swum (s/m): the pace of the stretch it is on (each place's own,
    // eased into the next place's), and every stay's slowing spread about its place.
    const runs = sampleOf.map((k) => along[k]);
    const paces = calls.map((call) => voyage.cruise * (call[3] > 0 ? call[3] : 1));
    const stays = calls.map((call, i) => [runs[i], call[2]]).filter(([, stay]) => stay > 0);
    const sigma = voyage.reach;
    const norm = 1 / (sigma * Math.sqrt(TAU));
    const slow = new Float64Array(count + 1);
    const linger = new Float32Array(count);
    const speed = new Float32Array(count);
    for (let k = 0, i = 0; k <= count; k += 1) {
        const s = Math.min(k * step, length);
        while (i < n - 1 && runs[i + 1] <= s) i += 1;
        const next = i + 1 < n ? runs[i + 1] : length;
        const u = (s - runs[i]) / Math.max(1e-9, next - runs[i]);
        const pace = paces[i] + (paces[(i + 1) % n] - paces[i]) * u * u * (3 - 2 * u);
        let w = 1 / pace;
        for (const [at, stay] of stays) {
            let d = Math.abs(s - at) % length;
            d = Math.min(d, length - d);
            w += stay * norm * Math.exp(-(d * d) / (2 * sigma * sigma));
        }
        slow[k] = w;
        if (k < count) {
            linger[k] = 1 - 1 / (pace * w);
            speed[k] = 1 / w;
        }
    }
    const times = new Float64Array(count + 1);
    for (let k = 1; k <= count; k += 1) times[k] = times[k - 1] + (step * (slow[k - 1] + slow[k])) / 2;
    const period = times[count];
    // The first place's own sample, and the moment the leader reaches it.
    const start = Math.round(runs[0] / step) % count;
    return {
        count,
        step,
        length,
        period,
        line,
        times,
        linger,
        speed,
        offset: times[start] + voyage.start,
        calls: Object.freeze(runs.slice()),
    };
}

/** The leader's run along its line (m, from the line's start: 0 to the length) `time` seconds into the session. */
export function swanVoyageRun(voyage, time) {
    const {
        times, period, count, step,
    } = voyage;
    const u = (((time + voyage.offset) % period) + period) % period;
    let lo = 0;
    let hi = count;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= u) lo = mid;
        else hi = mid;
    }
    const f = clamp((u - times[lo]) / (times[lo + 1] - times[lo]), 0, 1);
    return (lo + f) * step;
}

/**
 * The line `run` metres along (any run: it comes round): its place (out[0], out[1] = x, z), unit
 * heading (out[2], out[3]), how much the family lingers there (out[4]: 0 swimming on, toward 1
 * in a stay) and the pace it is swum at (out[5], m/s).
 */
export function swanVoyagePoint(voyage, run, out = [0, 0, 0, 0, 0, 0]) {
    const {
        count, step, line, linger, speed,
    } = voyage;
    const at = (((run / step) % count) + count) % count;
    const k = Math.min(Math.floor(at), count - 1);
    const f = at - k;
    const a = 4 * k;
    const b = 4 * ((k + 1) % count);
    out[0] = line[a] + (line[b] - line[a]) * f;
    out[1] = line[a + 1] + (line[b + 1] - line[a + 1]) * f;
    const hx = line[a + 2] + (line[b + 2] - line[a + 2]) * f;
    const hz = line[a + 3] + (line[b + 3] - line[a + 3]) * f;
    const h = Math.hypot(hx, hz) || 1;
    out[2] = hx / h;
    out[3] = hz / h;
    out[4] = linger[k] + (linger[(k + 1) % count] - linger[k]) * f;
    out[5] = speed[k] + (speed[(k + 1) % count] - speed[k]) * f;
    return out;
}

/** How a family loosens in a stay: how much closer it draws along the line, how much wider it spreads. */
const LOOSE = Object.freeze({ close: 0.3, spread: 2, wander: 0.5 });

/**
 * A member of the family at `time`: it swims the leader's line `gap` metres behind (closer in a
 * stay), a little to one side (`side` metres, with a slow wander of its own; wider in a stay).
 * Writes x, z, the unit heading it swims (out[0..3]), how much it lingers there (out[4]) and the
 * line's pace there (out[5]).
 */
export function swanFamilyPlace(voyage, member, time, out = [0, 0, 0, 0, 0, 0]) {
    const run = swanVoyageRun(voyage, time);
    swanVoyagePoint(voyage, run, out);
    swanVoyagePoint(voyage, run - member.gap * (1 - LOOSE.close * out[4]), out);
    const loose = out[4];
    const wander = member.wander * (1 + LOOSE.wander * loose);
    const turn = time * member.rate + member.phase;
    const aside = member.side * (1 + LOOSE.spread * loose) + wander * Math.sin(turn);
    const [hx, hz] = [out[2], out[3]];
    // The heading's left is (hz, -hx) seen from above (x right, z toward the eye).
    out[0] += hz * aside;
    out[1] -= hx * aside;
    // Headed the way it goes: along the line at the pace swum here, and across it as it wanders.
    const pace = out[5];
    const across = wander * member.rate * Math.cos(turn);
    const fx = hx * pace + hz * across;
    const fz = hz * pace - hx * across;
    const length = Math.hypot(fx, fz) || 1;
    out[2] = fx / length;
    out[3] = fz / length;
    return out;
}

/**
 * The family, in order: the cob, the pen, then her cygnets (how far behind the cob each swims
 * (m), its side and its wander). They are drawn a little larger than life (`size`), so they still
 * read from across the lake.
 */
export function swanFamily(cygnets) {
    const members = [
        {
            kind: 'cob', gap: 0, side: 0, wander: 0.12, rate: 0.11, phase: 0.4, size: 1.28,
        },
        {
            kind: 'pen', gap: 2.4, side: -0.25, wander: 0.2, rate: 0.13, phase: 2.1, size: 1.16,
        },
    ];
    for (let i = 0; i < cygnets; i += 1) {
        members.push({
            kind: 'cygnet',
            gap: 3.9 + i * 0.9 + (i % 2) * 0.2,
            side: (i % 2 ? 0.36 : -0.32) * (1 + 0.2 * (i >> 1)),
            wander: 0.22,
            rate: 0.19 + 0.045 * i,
            phase: 1.3 + i * 2.4,
            size: 1.25 - 0.06 * (i % 3),
        });
    }
    return members;
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
 * Where a line meets the rest frame (screen x): its two edges; the open sky between the card and
 * the birch, where the skein is seen on the right (its height is set there: over the stats); where
 * it starts down, going behind the card; and where it is down, left of the card.
 */
const MARKS = Object.freeze({
    enter: 1, gap: 0.66, down: 0.64, level: 0.27, leave: 0,
});

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
 * is `high` as far as the run `down`, comes down to `low` by the run `level`, stays low across
 * the lake, and climbs away before `enter` and after `leave` (outside the 16:9 frame). Any run
 * will do: a bird behind the leader is on the line before its start.
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
    const fall = route.level - route.down;
    const w = clamp((run - route.down) / fall, 0, 1);
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
                const { stats, birch } = FRAME;
                const covered = s.x > stats.x0 && s.x < stats.x1 && s.y > stats.y0 && s.y < stats.y1;
                if (!covered && !behindLand(lens, x, y, z, groundHeight)) {
                    // Through the birch's strands a bird is only glimpsed.
                    right += s.x > birch.x0 && s.y < birch.y1 ? dt * 0.25 : dt;
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
    const score = Math.min(left, 5.5) + 3 * Math.min(right, 2) + 2.2 * road - (nearest < 0.07 ? 5 : 0)
        - 2 * late + 150 * (size / Math.max(left, dt));
    return {
        score, left, right, crossing, sun: nearest,
    };
}

/**
 * The lines a skein may fly, best first: each comes from beyond the right edge of the widest
 * frame, over the homestead's wood, shows in the open sky right of the board (above where the
 * stats stand in single player), comes down behind the card, crosses the water left of it low
 * under the evening sun and climbs away past the left edge (a launch may fly it the other way).
 * Candidates are laid through the rest lens (how deep the line is at the frame's two edges, how
 * it bends, how high it comes in and how low it crosses) and scored there; `route.seen` keeps
 * what the score read.
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
                    from, via, to, length: 1, low: 6, high: 6, enter: 0, down: 0, level: 1, leave: 1,
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
                const runs = {
                    enter: -1, gap: -1, down: -1, level: -1, leave: -1,
                };
                let gapDepth = 0;
                for (let run = 0; run <= length; run += 2) {
                    swanFlightPoint(track, run, p);
                    const at = lens.project(p[0], 6, p[2], s);
                    if (at) {
                        for (const key of Object.keys(runs)) {
                            if (runs[key] < 0 && at.x <= MARKS[key]) {
                                runs[key] = run;
                                if (key === 'gap') gapDepth = at.depth;
                            }
                        }
                    }
                }
                const whole = runs.enter >= 0 && runs.down > runs.enter && runs.level > runs.down
                    && runs.leave > runs.level;
                for (const gapY of whole ? [0.21, 0.24] : []) {
                    const high = lens.point(MARKS.gap, gapY, gapDepth, b)[1];
                    for (const low of [8.5, 9.5]) {
                        const route = {
                            from,
                            via,
                            to,
                            length,
                            low,
                            high,
                            enter: runs.enter,
                            down: runs.down,
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

const plans = { voyage: undefined, flights: null };

/** The voyage on the theme's own lake, laid once a session (well under a millisecond). */
export function sessionSwanVoyage() {
    if (plans.voyage === undefined) plans.voyage = laySwanVoyage();
    return plans.voyage;
}

/** The flights over the theme's own lake, found once a session (a few milliseconds of scoring). */
export function sessionSwanFlights() {
    if (!plans.flights) plans.flights = planSwanFlights();
    return plans.flights;
}
