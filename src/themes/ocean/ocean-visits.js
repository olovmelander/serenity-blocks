/**
 * Ocean — the sea's large visitors (CPU only, three-free).
 *
 * Who comes out of the blue, and when and how: the cast (how big each animal is, how many of it
 * may be in the water at once, how fast it beats), the acts the sea puts on by itself, the routes
 * they swim, and every member's pose along its route.
 *
 * The sea's own visits follow a seeded, irregular schedule that is a pure function of the clock
 * (planVisits): a humpback far out, sometimes with her calf, or rising toward the light; a blue
 * whale at the edge of seeing; a whale shark coming up out of the deep blue; a manta, a pair of
 * them, or one turning a slow somersault; a squadron of eagle rays low over the sand; a turtle
 * rowing past or climbing to breathe; a school of hammerheads; a pod of dolphins running under the
 * surface; now and then an ocean sunfish. Gaps between them run from a few seconds to over a
 * minute, two may share the water, a kind never comes twice running, and the rare ones stay rare.
 *
 * A pose is carried as a place, a forward and an up vector (not yaw, pitch and roll), so a manta can
 * loop the loop: the up vector leans into each turn the way a body banks, from the route's own
 * acceleration (poseOnRoute).
 */

import {
    EYE, PINNACLES, SURFACE, TAU, clamp01, floorAt, mulberry32, smooth,
} from './ocean-core.js';

/** The cast, in the order the creature pack numbers them (src/themes/ocean/assets/creatures.glb). */
export const KINDS = Object.freeze([
    'humpback', 'blueWhale', 'dolphin', 'whaleShark', 'hammerhead', 'manta', 'eagleRay', 'turtle', 'sunfish',
]);

/**
 * Per kind: metres the unit animal stands for (a ray: across its wings), how many may be in the
 * water at once, seconds a stroke takes at full size, how far it leans into a turn, whether it
 * glides between strokes (0 steady .. 1 long glides), and the metres it keeps between its middle
 * and the sand (`clear`: flippers and fins hang below) and the surface (`top`).
 */
export const CAST = Object.freeze({
    humpback: Object.freeze({
        metres: 13, slots: 4, stroke: 5.2, bank: 0.55, glide: 0.8, clear: 2.8, top: 1.9,
    }),
    blueWhale: Object.freeze({
        metres: 24, slots: 1, stroke: 7.4, bank: 0.35, glide: 0.6, clear: 3.6, top: 2.4,
    }),
    dolphin: Object.freeze({
        metres: 2.6, slots: 6, stroke: 0.85, bank: 1.2, glide: 0.15, clear: 1.2, top: 0.9,
    }),
    whaleShark: Object.freeze({
        metres: 11, slots: 1, stroke: 4.4, bank: 0.45, glide: 0.2, clear: 2.4, top: 1.7,
    }),
    hammerhead: Object.freeze({
        metres: 3.4, slots: 9, stroke: 1.45, bank: 0.9, glide: 0.1, clear: 1.4, top: 1.0,
    }),
    manta: Object.freeze({
        metres: 5, slots: 5, stroke: 3.7, bank: 1.3, glide: 0.65, clear: 1.6, top: 1.1,
    }),
    eagleRay: Object.freeze({
        metres: 2.2, slots: 6, stroke: 1.9, bank: 1.2, glide: 0.45, clear: 1.1, top: 0.8,
    }),
    turtle: Object.freeze({
        metres: 1.25, slots: 2, stroke: 3.1, bank: 0.8, glide: 0.75, clear: 1.0, top: 0.7,
    }),
    sunfish: Object.freeze({
        metres: 2.4, slots: 1, stroke: 2.1, bank: 0.5, glide: 0.25, clear: 1.8, top: 1.6,
    }),
});

/** A smooth max / min (k = how soft the corner is): the floor and ceiling a route keeps. */
const softMax = (a, b, k) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) * 0.5;
const softMin = (a, b, k) => (a + b - Math.sqrt((a - b) * (a - b) + k * k)) * 0.5;

/**
 * Keep a height `clear` metres over the sand at world (x, z) and `top` under the surface, softly.
 * (The sand is the stage's: drawn in toward the middle by `squeeze` on a narrow frame.)
 */
export function keepInWater(x, y, z, clear, squeeze = 1, top = clear) {
    return softMin(softMax(y, floorAt(x / Math.max(0.34, squeeze), z) + clear, 1.6), SURFACE - top, 1.0);
}

/** The sand under the pinnacles' feet, about (what a pinnacle's own height stands on). */
const PINNACLE_FOOT = 3;

/**
 * How far (on the level) a pinnacle's rock reaches at height y, with `clear` to spare. A pinnacle
 * is a gaussian lump (ocean-core.js seabedHeight): at height y it reaches r·√ln(h / (y − foot)).
 */
function pinnacleReach(i, y, clear) {
    const [, , r, h] = PINNACLES[i];
    const above = y - clear - PINNACLE_FOOT;
    return above >= h ? 0 : r * Math.sqrt(Math.log(h / Math.max(above, 0.25))) * 1.15 + clear * 0.5;
}

/** 0..1 eased with zero slope and curvature at both ends. */
const smootherstep = (g) => g * g * g * (g * (g * 6 - 15) + 10);

/** How much of a crossing's way along is still kept going through a somersault. */
const LOOP_KEEPS = 0.06;

/**
 * How far along its crossing a somersaulting route is at `k`: through the loop it nearly stops
 * (its rate falls to LOOP_KEEPS at the loop's middle), elsewhere a little quicker, and 0 and 1
 * at the ends as always. (The rate's dip is the smootherstep's own slope, whose peak is 15/8.)
 */
function loopProgress({ at, span }, k) {
    const dip = (1 - LOOP_KEEPS) / 1.875;
    const kept = 1 - dip * span;
    return (k - dip * span * smootherstep(clamp01((k - at) / span))) / kept;
}

/** Which way a route travels (0 = x: a crossing; 2 = z: up out of the blue) and which way it swerves. */
const travelAxis = (route) => (route.type === 'emerge' ? 2 : 0);

/**
 * Settle a new route in the water: lift the whole of it (evenly, so it does not follow the sand
 * up and down) until it and the school round it clear the reef all along, without pressing it into
 * the surface; and where it would pass too near a pinnacle, give it one wide swerve round the side
 * it was passing on already (`route.bumps`: a gaussian sideways to its travel, so it neither
 * slaloms nor changes pace). Returns how far it misses fitting (0 = it fits: it neither had to
 * swerve further than a route may nor lacks room over the floor); the floor in routePoint is then
 * only a guard.
 */
export function settleRoute(route, kind, members = []) {
    // (A school spreads round its lead: the lowest of it, and its flanks over sloping ground.)
    const spread = members.reduce((m, one) => Math.max(m, -one.off[1] + 0.12 * Math.abs(one.off[0]) + one.weave * 0.5), 0);
    const wide = members.reduce((m, one) => Math.max(m, Math.abs(one.off[0]) + one.weave), 0);
    const clear = CAST[kind].clear + spread;
    const along = travelAxis(route);
    const across = 2 - along;
    const keep = route.clear;
    route.clear = 0;
    route.bumps = null;
    const raw = [];
    for (let i = 0; i <= 44; i++) raw.push(routePoint(route, -0.05 + i * 0.025, 1, [0, 0, 0]));
    const bumps = [];
    PINNACLES.forEach(([cx, cz], i) => {
        const centre = [cx, 0, cz];
        let best = Infinity;
        let at = raw[0];
        for (let j = 0; j < raw.length; j++) {
            const d = Math.hypot(raw[j][0] - cx, raw[j][2] - cz);
            if (d < best) {
                best = d;
                at = raw[j];
            }
        }
        const R = pinnacleReach(i, at[1], CAST[kind].clear) + wide * 0.5;
        const off = at[across] - centre[across];
        if (R <= 0 || Math.abs(off) >= R + 1) return;
        bumps.push({
            c: centre[along], w: Math.max(2.6 * R, 12), a: (off >= 0 ? 1 : -1) * (R + 1 - Math.abs(off)),
        });
    });
    route.bumps = bumps.length ? bumps : null;
    route.clear = keep;
    const p = [0, 0, 0];
    let short = 0;
    let room = Infinity;
    for (let i = 0; i < raw.length; i++) {
        routePoint(route, -0.05 + i * 0.025, 1, p, false);
        short = Math.max(short, floorAt(p[0], p[2]) + clear - p[1]);
        room = Math.min(room, SURFACE - CAST[kind].top - p[1]);
    }
    const lift = Math.min(Math.max(0, short + 0.3), Math.max(0, room - 0.4));
    if (lift > 0) {
        if (route.type === 'emerge') ['p0', 'p1', 'p2', 'p3'].forEach((key) => { route[key][1] += lift; });
        else route.y += lift;
    }
    // How far it misses fitting: metres short of the floor, and of swerving round rock further
    // than a route may (an emergence straight at the canyon little; a crossing a little more).
    const bend = bumps.reduce((m, b) => Math.max(m, Math.abs(b.a)), 0);
    const most = route.type === 'emerge' ? 3.5 : 7;
    return Math.max(0, short + 0.3 - lift) + Math.max(0, bend - most);
}

/** Slots in all, and where each kind's begin in the shared table. */
export const SLOT_BASE = Object.freeze(KINDS.reduce((acc, kind, i) => {
    acc[kind] = i === 0 ? 0 : acc[KINDS[i - 1]] + CAST[KINDS[i - 1]].slots;
    return acc;
}, {}));
export const SLOT_TOTAL = KINDS.reduce((n, kind) => n + CAST[kind].slots, 0);

/** Tangent of half the rest camera's horizontal field: how wide the frame is at a distance. */
const HALF_WIDE = Math.tan((EYE.hFov * Math.PI) / 360);

/**
 * How far either side a route must reach at a depth for the animal to start and end out of the
 * frame (with its own length to spare and the frame's breathing room).
 */
export function reachAt(z, metres) {
    return HALF_WIDE * Math.max(8, EYE.z - z) * 1.12 + metres * 0.6;
}

// ── Routes ──────────────────────────────────────────────────────────────────────

/**
 * A point on a route at `k` (0..1; a little either side is still smooth). Routes:
 *   cross   a slow arc from one side of the frame to the other: in from behind the far shoulder,
 *           bowing toward the viewer, out deep. { side, z, y, bow, reach, lift, climb, out,
 *           weave, weaves, phase } and optionally a somersault { loop: { at, span, radius } } or
 *           a running undulation { porpoise: { height, waves } }.
 *   emerge  up out of the deep blue toward the canyon, turning away to one side: a cubic through
 *           four points { p0, p1, p2, p3 }.
 * Every route flows round the pinnacles and (with `guard`) keeps `clear` metres over the sand and
 * under the surface. `squeeze` draws a crossing in on a narrow frame.
 */
export function routePoint(route, k, squeeze = 1, out = [0, 0, 0], guard = true) {
    let x;
    let y;
    let z;
    if (route.type === 'emerge') {
        const a = 1 - k;
        const w0 = a * a * a;
        const w1 = 3 * a * a * k;
        const w2 = 3 * a * k * k;
        const w3 = k * k * k;
        x = (route.p0[0] * w0 + route.p1[0] * w1 + route.p2[0] * w2 + route.p3[0] * w3) * Math.max(0.6, squeeze);
        y = route.p0[1] * w0 + route.p1[1] * w1 + route.p2[1] * w2 + route.p3[1] * w3;
        z = route.p0[2] * w0 + route.p1[2] * w1 + route.p2[2] * w2 + route.p3[2] * w3;
    } else {
        // (During a somersault the crossing all but stops, so the loop is a circle, not a curl; the
        // rest of the crossing goes a little faster to arrive at the same place.)
        const progress = route.loop ? loopProgress(route.loop, k) : k;
        const sweep = progress * 2 - 1;
        const reach = route.reach * Math.max(0.6, squeeze);
        x = -route.side * sweep * reach;
        y = route.y + route.climb * sweep * 0.5 + route.lift * Math.sin(Math.PI * clamp01(k))
            + route.weave * Math.sin(TAU * route.weaves * k + route.phase);
        z = route.z + route.bow - (route.bow + route.out) * sweep * sweep;
        if (route.porpoise) {
            y += route.porpoise.height * Math.sin(TAU * route.porpoise.waves * k);
        }
        if (route.loop) {
            // A somersault: the animal turns one full circle up and over (eased in and out, so it
            // flows out of the crossing and back into it), in the upright plane of its heading at
            // the loop's middle (so it does not lean out of it).
            const { at, span, radius } = route.loop;
            const theta = TAU * smootherstep(clamp01((k - at) / span));
            const mid = loopProgress(route.loop, at + span * 0.5) * 2 - 1;
            const hx = -route.side * 2 * reach;
            const hz = -4 * (route.bow + route.out) * mid;
            const h = Math.hypot(hx, hz) || 1;
            x += (hx / h) * radius * Math.sin(theta);
            z += (hz / h) * radius * Math.sin(theta);
            y += radius * (1 - Math.cos(theta));
        }
    }
    if (route.bumps) {
        // Its swerves round the pinnacles (settleRoute): sideways to its travel. (A crossing's x
        // is drawn in with the stage on a narrow frame; the pinnacles stand in the stage's x.)
        const sq = Math.max(0.34, squeeze);
        const across = travelAxis(route) === 0;
        const t = across ? x / sq : z;
        let swerve = 0;
        for (let i = 0; i < route.bumps.length; i++) {
            const b = route.bumps[i];
            const u = (t - b.c) / b.w;
            swerve += b.a * Math.exp(-u * u);
        }
        if (across) z += swerve;
        else x += swerve * sq;
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    if (guard && route.clear > 0) out[1] = keepInWater(x, y, z, route.clear, squeeze, route.top ?? route.clear);
    return out;
}

function norm3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    v[0] /= l;
    v[1] /= l;
    v[2] /= l;
    return v;
}

/** Samples along a route (and the k they span: past both ends, for members that lag). */
const FRAME_SAMPLES = 260;
const FRAME_FROM = -0.15;
const FRAME_TO = 1.15;
const FRAME_DK = (FRAME_TO - FRAME_FROM) / (FRAME_SAMPLES - 1);

const _q = [0, 0, 0];
const _warm = {};

/** A box average of the samples' x and z over ±radius samples (in place; the ends hold). */
function smoothLevel(P, n, radius) {
    const src = P.slice();
    for (let i = 0; i < n; i++) {
        let sx = 0;
        let sz = 0;
        let w = 0;
        for (let j = i - radius; j <= i + radius; j++) {
            const at = Math.max(0, Math.min(n - 1, j)) * 3;
            sx += src[at];
            sz += src[at + 2];
            w += 1;
        }
        P[i * 3] = sx / w;
        P[i * 3 + 2] = sz / w;
    }
}

/**
 * A route sampled once, kept on its visit (per squeeze): its places (P), its body's ups (U)
 * carried along it without twisting (a rotation-minimising frame, by double reflection, from
 * straight up at its start: a climb or a dive pitches the body and leaves its roll alone, and a
 * somersault carries it right over and back), each leant into the level sideways pull there
 * (only a turn tips a body over), and that pull (L). A frame's pose is read from these
 * (frameOnRoute), never from the route itself. Flat arrays, about a millisecond to make.
 */
function routeFrames(visit, squeeze, bank) {
    const key = Math.round(squeeze * 1000);
    if (visit.frames && visit.frames.key === key) return visit.frames;
    const n = FRAME_SAMPLES;
    const P = new Float64Array(n * 3);
    const T = new Float64Array(n * 3);
    const U = new Float64Array(n * 3);
    const L = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        routePoint(visit.route, FRAME_FROM + i * FRAME_DK, squeeze, _q);
        P[i * 3] = _q[0];
        P[i * 3 + 1] = _q[1];
        P[i * 3 + 2] = _q[2];
    }
    // Ease the bends round the rock over a few metres of travel (two box passes on the level), so
    // a big animal sweeps round a pinnacle instead of jinking. (Not a somersault: it keeps its loop.)
    if (!visit.route.loop) {
        let length = 0;
        for (let i = 1; i < n; i++) length += Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
        const radius = Math.max(1, Math.min(12, Math.round(3 / Math.max(length / (n - 1), 1e-3))));
        smoothLevel(P, n, radius);
        smoothLevel(P, n, radius);
    }
    for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1) * 3;
        const b = Math.min(n - 1, i + 1) * 3;
        const tx = P[b] - P[a];
        const ty = P[b + 1] - P[a + 1];
        const tz = P[b + 2] - P[a + 2];
        const l = Math.hypot(tx, ty, tz) || 1;
        T[i * 3] = tx / l;
        T[i * 3 + 1] = ty / l;
        T[i * 3 + 2] = tz / l;
    }
    // Straight up at the start, squared to the heading; then carried along by double reflection.
    {
        const ty = T[1];
        const ux = -T[0] * ty;
        const uy = 1 - ty * ty;
        const uz = -T[2] * ty;
        const l = Math.hypot(ux, uy, uz) || 1;
        U[0] = ux / l;
        U[1] = uy / l;
        U[2] = uz / l;
    }
    for (let i = 0; i < n - 1; i++) {
        const o = i * 3;
        const v1x = P[o + 3] - P[o];
        const v1y = P[o + 4] - P[o + 1];
        const v1z = P[o + 5] - P[o + 2];
        const c1 = v1x * v1x + v1y * v1y + v1z * v1z || 1e-12;
        const dr = (2 / c1) * (v1x * U[o] + v1y * U[o + 1] + v1z * U[o + 2]);
        const rx = U[o] - dr * v1x;
        const ry = U[o + 1] - dr * v1y;
        const rz = U[o + 2] - dr * v1z;
        const dtv = (2 / c1) * (v1x * T[o] + v1y * T[o + 1] + v1z * T[o + 2]);
        const v2x = T[o + 3] - (T[o] - dtv * v1x);
        const v2y = T[o + 4] - (T[o + 1] - dtv * v1y);
        const v2z = T[o + 5] - (T[o + 2] - dtv * v1z);
        const c2 = v2x * v2x + v2y * v2y + v2z * v2z;
        const d2 = c2 > 1e-14 ? (2 / c2) * (v2x * rx + v2y * ry + v2z * rz) : 0;
        const ux = rx - d2 * v2x;
        const uy = ry - d2 * v2y;
        const uz = rz - d2 * v2z;
        const l = Math.hypot(ux, uy, uz) || 1;
        U[o + 3] = ux / l;
        U[o + 4] = uy / l;
        U[o + 5] = uz / l;
    }
    // Lean each into the level sideways pull: the acceleration across the heading in the
    // horizontal plane, weighed by how level the heading is (heading straight up or down there
    // is no "sideways" to lean into). The level right of a heading t is (−t.z, 0, t.x).
    const dt = FRAME_DK * visit.seconds;
    for (let i = 0; i < n; i++) {
        const o = i * 3;
        const a = Math.max(0, i - 1) * 3;
        const b = Math.min(n - 1, i + 1) * 3;
        const ax = (P[b] - 2 * P[o] + P[a]) / (dt * dt);
        const az = (P[b + 2] - 2 * P[o + 2] + P[a + 2]) / (dt * dt);
        const tx = T[o];
        const ty = T[o + 1];
        const tz = T[o + 2];
        const lateral = ax * -tz + az * tx;
        L[i] = lateral;
        const lean = Math.atan(Math.max(-0.7, Math.min(0.7, lateral * 1.5 * bank)));
        const c = Math.cos(lean);
        const s = Math.sin(lean);
        const ux = U[o];
        const uy = U[o + 1];
        const uz = U[o + 2];
        // right = heading × up
        const rx = ty * uz - tz * uy;
        const ry = tz * ux - tx * uz;
        const rz = tx * uy - ty * ux;
        const bx = ux * c + rx * s;
        const by = uy * c + ry * s;
        const bz = uz * c + rz * s;
        const l = Math.hypot(bx, by, bz) || 1;
        U[o] = bx / l;
        U[o + 1] = by / l;
        U[o + 2] = bz / l;
    }
    visit.frames = {
        key, P, U, L,
    };
    return visit.frames;
}

/**
 * The pose of a route's lead at `k`: its place (x, y, z), which way it heads (f), its up (carried
 * along the route and leant into turns), its right, how fast it goes (m/s) and how sharply it is
 * turning sideways (1/m, + toward its right). Read from the route's samples: a Catmull-Rom
 * through the places, the up between its two samples, squared to the heading.
 */
export function frameOnRoute(visit, k, squeeze, bank, out) {
    const { P, U, L } = routeFrames(visit, squeeze, bank);
    const n = FRAME_SAMPLES;
    const at = Math.max(0, Math.min(n - 1.0001, (k - FRAME_FROM) / FRAME_DK));
    const i = Math.floor(at);
    const t = at - i;
    const a = Math.max(0, i - 1) * 3;
    const b = i * 3;
    const c = (i + 1) * 3;
    const d = Math.min(n - 1, i + 2) * 3;
    const t2 = t * t;
    const t3 = t2 * t;
    const f = out.f || (out.f = [0, 0, 0]);
    for (let j = 0; j < 3; j++) {
        const pa = P[a + j];
        const pb = P[b + j];
        const pc = P[c + j];
        const pd = P[d + j];
        const k2 = 2 * pa - 5 * pb + 4 * pc - pd;
        const k3 = 3 * pb - pa - 3 * pc + pd;
        _q[j] = 0.5 * (2 * pb + (pc - pa) * t + k2 * t2 + k3 * t3);
        f[j] = 0.5 * ((pc - pa) + 2 * k2 * t + 3 * k3 * t2);
    }
    const speed = (Math.hypot(f[0], f[1], f[2]) || 1e-6) / (FRAME_DK * visit.seconds);
    norm3(f);
    const up = out.up || (out.up = [0, 1, 0]);
    up[0] = U[b] + (U[c] - U[b]) * t;
    up[1] = U[b + 1] + (U[c + 1] - U[b + 1]) * t;
    up[2] = U[b + 2] + (U[c + 2] - U[b + 2]) * t;
    const along = up[0] * f[0] + up[1] * f[1] + up[2] * f[2];
    up[0] -= f[0] * along;
    up[1] -= f[1] * along;
    up[2] -= f[2] * along;
    norm3(up);
    const right = out.right || (out.right = [1, 0, 0]);
    right[0] = f[1] * up[2] - f[2] * up[1];
    right[1] = f[2] * up[0] - f[0] * up[2];
    right[2] = f[0] * up[1] - f[1] * up[0];
    out.x = _q[0];
    out.y = _q[1];
    out.z = _q[2];
    out.speed = speed;
    // (Slow at the top of a somersault: the bend is measured as if at a walking pace at least.
    // The pull is toward the level right; the body's own right may be the other way up.)
    const pace = Math.max(speed, 1.5);
    const lateral = L[i] + (L[i + 1] - L[i]) * t;
    out.turn = (lateral * Math.sign(right[0] * -f[2] + right[2] * f[0] || 1)) / (pace * pace);
    return out;
}

const _lead = {};

/**
 * One member's pose at `tau` seconds into its visit. `member` = { lag, off: [right, up, back],
 * weave, weaveRate, weavePhase, scale, phase, variant, roll, beat? }. Writes into `pose`:
 * x, y, z, fx, fy, fz, ux, uy, uz, scale (metres), phase (radians of its stroke), beat (0..1.3),
 * turn (its body's sideways bend), variant (0..1), presence (0..1 out of the blue), k.
 *
 * A member keeps its place in the formation in a level frame turned with its lead's heading (a
 * school's layers stay level while its lead climbs or dives; the lag is what makes it follow).
 */
export function poseOnRoute(visit, member, tau, squeeze, pose = {}) {
    const cast = CAST[visit.kind];
    const k = tau / visit.seconds - member.lag;
    frameOnRoute(visit, k, squeeze, cast.bank, _lead);
    const { f, up, right } = _lead;
    const w = member.weave * Math.sin(TAU * member.weaveRate * tau + member.weavePhase);
    const wy = member.weave * 0.45 * Math.sin(TAU * member.weaveRate * 0.7 * tau + member.weavePhase * 1.7);
    const ox = member.off[0] + w;
    const oy = member.off[1] + wy;
    const oz = member.off[2];
    const h = Math.hypot(f[0], f[2]) || 1;
    const lx = f[0] / h;
    const lz = f[2] / h;
    // (Level forward (lx, 0, lz); level right (−lz, 0, lx).)
    pose.x = _lead.x - lz * ox - lx * oz;
    pose.y = _lead.y + oy;
    pose.z = _lead.z + lx * ox - lz * oz;
    if (ox !== 0 || oy !== 0 || oz !== 0) {
        // (A member beside or under the lead keeps the water too: a calf never noses into the
        // sand. The lead's swerves round the pinnacles were made wide enough for the school.)
        const size = Math.max(0.45, member.scale);
        pose.y = keepInWater(pose.x, pose.y, pose.z, cast.clear * size, squeeze, cast.top * size);
    }
    // A member that swims tilted (a sunfish lies over a little) rolls about its heading.
    const roll = member.roll || 0;
    const c = roll ? Math.cos(roll) : 1;
    const s = roll ? Math.sin(roll) : 0;
    pose.fx = f[0];
    pose.fy = f[1];
    pose.fz = f[2];
    pose.ux = up[0] * c + right[0] * s;
    pose.uy = up[1] * c + right[1] * s;
    pose.uz = up[2] * c + right[2] * s;
    const metres = cast.metres * member.scale;
    pose.scale = metres;
    // Smaller animals beat faster (a calf, a young turtle): the stroke scales with √size.
    const stroke = cast.stroke * Math.sqrt(member.scale) * (member.pace || 1);
    pose.phase = member.phase + (TAU * tau) / stroke;
    // Strokes and glides: the beat swells and falls on a slow cycle of its own (a closed form of
    // the clock: only its strength changes, never its rate).
    const glide = cast.glide * smooth(-0.35, 0.55, Math.sin((TAU * tau) / (stroke * 3.6) + member.phase * 0.37));
    pose.beat = (1 - glide * 0.8) * (member.beat ?? 1);
    pose.turn = Math.max(-0.6, Math.min(0.6, _lead.turn * metres));
    pose.variant = member.variant;
    pose.presence = smooth(0, 0.07, k) * (1 - smooth(0.93, 1, k));
    pose.k = k;
    return pose;
}

// ── Acts ────────────────────────────────────────────────────────────────────────

const pick = (rand, [lo, hi]) => lo + (hi - lo) * rand();

function soloMember(rand, extra = {}) {
    return {
        lag: 0,
        off: [0, 0, 0],
        weave: 0,
        weaveRate: 0,
        weavePhase: 0,
        scale: 0.92 + rand() * 0.16,
        phase: rand() * TAU,
        variant: rand(),
        roll: 0,
        ...extra,
    };
}

function crossing(rand, side, kind, {
    z, y, bow = [3, 7], lift = [0.4, 1.6], climb = [-1.5, 1.5], out = 4, weave = [0, 0.6],
}) {
    const depth = pick(rand, z);
    return {
        type: 'cross',
        side,
        z: depth,
        y: pick(rand, y),
        bow: pick(rand, bow),
        reach: reachAt(depth - out, CAST[kind].metres),
        lift: pick(rand, lift),
        climb: pick(rand, climb),
        out,
        weave: pick(rand, weave),
        weaves: 1 + rand() * 1.5,
        phase: rand() * TAU,
        clear: CAST[kind].clear,
        top: CAST[kind].top,
    };
}

/**
 * Where the open water is, from the reef (16:9, the board in the middle): the kelp stands on both
 * shoulders and the card and its HUD leave two windows to the blue, the left one between the kelp
 * and the card, and on the right the band over the HUD, under the surface (as screen x). A crossing
 * is in a window only a moment; an animal swimming along a window's line of sight stays in it.
 */
export const WINDOWS = Object.freeze({
    left: Object.freeze([0.29, 0.36]),
    right: Object.freeze([0.67, 0.78]),
});

/** Over the HUD: the height (per metre from the eye) a right-window route keeps above. */
const OVER_HUD = 0.52;

/**
 * A route along a window's line of sight (an `emerge` cubic): `approach` comes up out of the blue
 * toward the viewer, growing from a shape in the fog, then turns out sideways through the kelp;
 * `depart` comes in from the side and swims away into the blue, shrinking. `far`/`near` are
 * metres from the eye; it swims at `y` far out and `drop` lower (or higher, negative) near.
 */
function windowRoute(rand, kind, {
    window = 'left', dir = 'approach', far = [55, 68], near = [14, 18], y = [11.8, 12.8], drop = [1, 2.2],
}) {
    const [lo, hi] = WINDOWS[window];
    const lateral = (lo + (hi - lo) * rand() - 0.5) * 2 * HALF_WIDE;
    const dFar = pick(rand, far);
    const dNear = pick(rand, near);
    let yFar = pick(rand, y);
    let yNear = yFar - pick(rand, drop);
    if (window === 'right') {
        // (Over the HUD all the way in: as high as the surface lets it.)
        const ceiling = SURFACE - CAST[kind].top - 0.2;
        yNear = Math.max(yNear, Math.min(ceiling, EYE.y + dNear * OVER_HUD));
        yFar = Math.max(yFar, Math.min(ceiling, EYE.y + dFar * OVER_HUD));
    }
    const at = (d, height) => [lateral * d, height, EYE.z - d];
    const out = window === 'left' ? -1 : 1;
    const zOut = EYE.z - dNear + 1;
    const exit = [out * reachAt(zOut, CAST[kind].metres), yNear + 0.4, zOut];
    const path = [
        at(dFar, yFar),
        at(dFar + (dNear - dFar) * 0.6, yFar + (yNear - yFar) * 0.45),
        at(dNear, yNear),
        exit,
    ];
    if (dir === 'depart') path.reverse();
    return {
        type: 'emerge',
        p0: path[0],
        p1: path[1],
        p2: path[2],
        p3: path[3],
        clear: CAST[kind].clear,
        top: CAST[kind].top,
    };
}

/** One of a few ways in, by weight: [[weight, make], ...] → the route. */
function oneOf(rand, choices) {
    const total = choices.reduce((n, [w]) => n + w, 0);
    let r = rand() * total;
    for (let i = 0; i < choices.length; i++) {
        r -= choices[i][0];
        if (r <= 0) return choices[i][1]();
    }
    return choices[choices.length - 1][1]();
}

/**
 * Where each act swims (data, so the lanes can be weighed against what the reef lets the eye see):
 *   mix     how often it crosses the frame, comes up a window toward the viewer, or leaves down one
 *   cross   its crossing (see crossing()): depths z, heights y, ...
 *   window  its window route (see windowRoute()): distances far/near from the eye, height y, drop
 *   right   how often its window is the narrow right one
 */
export const ACT_LANES = {
    humpback: {
        mix: [0.3, 0.45, 0.25],
        right: 0.3,
        cross: { z: [-19, -11], y: [10.6, 12.4], bow: [2, 5] },
        window: {
            far: [52, 64], near: [16, 20], y: [12, 12.8], drop: [1.5, 2.5],
        },
    },
    humpbackRise: {
        mix: [0, 1, 0],
        right: 0.3,
        window: {
            far: [44, 54], near: [15, 19], y: [8.4, 9.4], drop: [-4, -3],
        },
    },
    blueWhale: {
        mix: [0, 0.45, 0.55],
        right: 0.1,
        cross: {
            z: [-29, -23], y: [11.8, 12.6], bow: [2, 4], lift: [0.1, 0.3], climb: [-0.3, 0.3], out: 6,
        },
        window: {
            far: [56, 68], near: [16, 20], y: [12.2, 12.6], drop: [1, 2],
        },
    },
    whaleShark: {
        mix: [0.35, 0.45, 0.2],
        right: 0.3,
        cross: { z: [-18, -10], y: [10.4, 12.2] },
        window: {
            far: [62, 80], near: [15, 19], y: [11.6, 12.6], drop: [1.8, 2.6],
        },
    },
    manta: {
        mix: [0.2, 0.5, 0.3],
        right: 0.1,
        cross: {
            z: [-16, -8], y: [9.4, 12], lift: [0.4, 1.2], weave: [0.3, 1.0],
        },
        window: {
            far: [34, 42], near: [12, 14], y: [11.8, 12.8], drop: [4, 4.5],
        },
    },
    mantaLoop: {
        mix: [1, 0, 0],
        cross: {
            z: [-14, -8], y: [6.4, 7.2], lift: [0.1, 0.4], climb: [-0.3, 0.3], weave: [0, 0.3],
        },
    },
    eagleRays: {
        mix: [0.5, 0.3, 0.2],
        right: 0.3,
        cross: {
            z: [-12, -6], y: [8.4, 10.8], lift: [0.2, 0.8], climb: [-0.6, 0.8], weave: [0.1, 0.4],
        },
        window: {
            far: [36, 46], near: [12, 15], y: [11, 12.4], drop: [3, 3.8],
        },
    },
    turtle: {
        mix: [0.6, 0.25, 0.15],
        right: 0.4,
        cross: { z: [-8, -3], y: [6.6, 9.6], weave: [0.1, 0.5] },
        window: {
            far: [30, 38], near: [10, 13], y: [10.4, 12], drop: [3.2, 4],
        },
    },
    turtleRise: {
        mix: [0.2, 0.8, 0],
        right: 0.2,
        cross: {
            z: [-9, -4], y: [8, 9], climb: [3.5, 5], lift: [0, 0.5],
        },
        window: {
            far: [26, 34], near: [9, 12], y: [8.6, 9.6], drop: [-3.5, -2.5],
        },
    },
    hammerheads: {
        mix: [0.3, 0.45, 0.25],
        right: 0.25,
        cross: {
            z: [-22, -14], y: [10.2, 11.6], lift: [0.2, 0.8], weave: [0.2, 0.6], out: 5,
        },
        window: {
            far: [55, 68], near: [18, 22], y: [11.6, 12.4], drop: [0.5, 1.2],
        },
    },
    dolphins: {
        mix: [0.2, 0.5, 0.3],
        right: 0.2,
        cross: {
            z: [-14, -8], y: [11.6, 12.8], lift: [0, 0.3], climb: [-0.4, 0.4], bow: [2, 5], weave: [0, 0.2],
        },
        window: {
            far: [34, 44], near: [11, 14], y: [12.4, 13], drop: [3.5, 4.2],
        },
    },
    sunfish: {
        mix: [0.3, 0.5, 0.2],
        right: 0.15,
        cross: {
            z: [-9, -4], y: [7.6, 10], lift: [0.3, 1], weave: [0.3, 0.7],
        },
        window: {
            far: [32, 40], near: [11, 14], y: [11, 12.2], drop: [3, 3.8],
        },
    },
};

/** The route of an act: a crossing, or up or down one of the windows, by its lanes' mix. */
function laneRoute(rand, side, name, kind) {
    const lane = ACT_LANES[name];
    const [cross, approach, depart] = lane.mix;
    const window = rand() < (lane.right || 0) ? 'right' : 'left';
    return oneOf(rand, [
        [cross, () => crossing(rand, side, kind, lane.cross)],
        [approach, () => windowRoute(rand, kind, { ...lane.window, window, dir: 'approach' })],
        [depart, () => windowRoute(rand, kind, { ...lane.window, window, dir: 'depart' })],
    ]);
}

/**
 * The acts the sea puts on by itself. `weight` = how often (relative), `seconds` = how long the
 * crossing takes, `make(rand, side)` = { route, members }.
 */
export const ACTS = Object.freeze({
    humpback: Object.freeze({
        kind: 'humpback',
        weight: 2.6,
        seconds: [42, 54],
        make(rand, side) {
            const route = laneRoute(rand, side, 'humpback', 'humpback');
            const members = [soloMember(rand)];
            // Often her calf, under her flank and a little behind, beating twice as fast.
            if (rand() < 0.45) {
                members.push(soloMember(rand, {
                    scale: 0.4 + rand() * 0.06, lag: 0.012, off: [-1.6, -2.4, 3.2], weave: 0.35, weaveRate: 0.05,
                }));
            }
            return { route, members };
        },
    }),
    humpbackRise: Object.freeze({
        kind: 'humpback',
        weight: 1.0,
        seconds: [46, 56],
        make(rand, side) {
            // Up from the dim water toward the light to breathe, coming toward the reef.
            return { route: laneRoute(rand, side, 'humpbackRise', 'humpback'), members: [soloMember(rand)] };
        },
    }),
    blueWhale: Object.freeze({
        kind: 'blueWhale',
        weight: 0.7,
        seconds: [64, 76],
        make(rand, side) {
            return {
                route: laneRoute(rand, side, 'blueWhale', 'blueWhale'),
                members: [soloMember(rand, { scale: 0.9 + rand() * 0.15 })],
            };
        },
    }),
    whaleShark: Object.freeze({
        kind: 'whaleShark',
        weight: 1.4,
        seconds: [50, 60],
        make(rand, side) {
            // Most often up out of the deep blue toward the reef, growing from a shadow.
            return { route: laneRoute(rand, side, 'whaleShark', 'whaleShark'), members: [soloMember(rand)] };
        },
    }),
    manta: Object.freeze({
        kind: 'manta',
        weight: 2.2,
        seconds: [26, 34],
        make(rand, side) {
            const route = laneRoute(rand, side, 'manta', 'manta');
            const members = [soloMember(rand)];
            // Sometimes a second follows the first (a courtship train).
            if (rand() < 0.4) {
                members.push(soloMember(rand, {
                    lag: 0.035 + rand() * 0.02, off: [0.8, -0.6 + rand() * 1.2, 1.5], weave: 0.5, weaveRate: 0.07,
                }));
            }
            return { route, members };
        },
    }),
    mantaLoop: Object.freeze({
        kind: 'manta',
        weight: 0.9,
        seconds: [36, 42],
        make(rand, side) {
            // (Low enough that the top of the loop stays well under the surface.)
            const route = laneRoute(rand, side, 'mantaLoop', 'manta');
            // (Where the crossing passes the open water left of the board, not behind it.)
            const at = side < 0 ? 0.26 + rand() * 0.06 : 0.46 + rand() * 0.06;
            route.loop = { at, span: 0.24, radius: 2.6 + rand() * 0.7 };
            return { route, members: [soloMember(rand)] };
        },
    }),
    eagleRays: Object.freeze({
        kind: 'eagleRay',
        weight: 1.6,
        seconds: [24, 32],
        make(rand, side) {
            const route = laneRoute(rand, side, 'eagleRays', 'eagleRay');
            // A squadron in echelon: each a wing's length behind and beside the one before.
            const n = 3 + Math.floor(rand() * 4);
            const members = [];
            for (let i = 0; i < n; i++) {
                const rank = Math.ceil(i / 2);
                let flank = 0;
                if (i > 0) flank = i % 2 ? 1 : -1;
                members.push(soloMember(rand, {
                    lag: rank * 0.006,
                    off: [flank * rank * 2.3 + (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.9, rank * 1.8],
                    weave: 0.25,
                    weaveRate: 0.08 + rand() * 0.05,
                    weavePhase: rand() * TAU,
                    scale: 0.85 + rand() * 0.25,
                    phase: rank * 0.9 + rand() * 0.6,
                }));
            }
            return { route, members };
        },
    }),
    turtle: Object.freeze({
        kind: 'turtle',
        weight: 1.9,
        seconds: [30, 38],
        make(rand, side) {
            return { route: laneRoute(rand, side, 'turtle', 'turtle'), members: [soloMember(rand)] };
        },
    }),
    turtleRise: Object.freeze({
        kind: 'turtle',
        weight: 0.8,
        seconds: [32, 40],
        make(rand, side) {
            return { route: laneRoute(rand, side, 'turtleRise', 'turtle'), members: [soloMember(rand)] };
        },
    }),
    hammerheads: Object.freeze({
        kind: 'hammerhead',
        weight: 1.4,
        seconds: [40, 52],
        make(rand, side) {
            const route = laneRoute(rand, side, 'hammerheads', 'hammerhead');
            // A loose school in layers, all headed the same way.
            const n = 5 + Math.floor(rand() * 5);
            const members = [];
            for (let i = 0; i < n; i++) {
                members.push(soloMember(rand, {
                    lag: rand() * 0.02,
                    off: [(rand() - 0.5) * 9, (rand() - 0.5) * 3.2, rand() * 9],
                    weave: 0.6,
                    weaveRate: 0.05 + rand() * 0.06,
                    weavePhase: rand() * TAU,
                    scale: 0.82 + rand() * 0.3,
                }));
            }
            return { route, members };
        },
    }),
    dolphins: Object.freeze({
        kind: 'dolphin',
        weight: 1.4,
        seconds: [15, 20],
        make(rand, side) {
            const route = laneRoute(rand, side, 'dolphins', 'dolphin');
            if (route.type === 'cross') route.porpoise = { height: 0.6 + rand() * 0.6, waves: 3 + rand() * 2 };
            // A pod, close together, each riding its own swell.
            const n = 3 + Math.floor(rand() * 4);
            const members = [];
            for (let i = 0; i < n; i++) {
                members.push(soloMember(rand, {
                    lag: rand() * 0.04,
                    off: [(rand() - 0.5) * 3.2, (rand() - 0.5) * 1.6, rand() * 2.5],
                    weave: 0.4,
                    weaveRate: 0.2 + rand() * 0.15,
                    weavePhase: rand() * TAU,
                    scale: i === n - 1 && rand() < 0.5 ? 0.62 : 0.9 + rand() * 0.2,
                }));
            }
            return { route, members };
        },
    }),
    sunfish: Object.freeze({
        kind: 'sunfish',
        weight: 0.65,
        seconds: [40, 48],
        make(rand, side) {
            return {
                route: laneRoute(rand, side, 'sunfish', 'sunfish'),
                members: [soloMember(rand, { roll: (0.25 + rand() * 0.25) * (rand() < 0.5 ? -1 : 1) })],
            };
        },
    }),
});

export const ACT_NAMES = Object.freeze(Object.keys(ACTS));

/**
 * Make an act's route and members and settle them in the water; a route that cannot clear the
 * reef under the surface (it would have to climb over a pinnacle) is drawn again, a few times.
 */
function settledAct(act, rand, side) {
    let best = null;
    let worst = Infinity;
    for (let tries = 0; tries < 4; tries++) {
        const made = act.make(rand, side);
        const miss = settleRoute(made.route, act.kind, made.members);
        if (miss < worst) {
            best = made;
            worst = miss;
        }
        if (miss <= 0) break;
    }
    return best;
}

/** How much later than its lead (a share of its crossing) a visit's last member leaves the water. */
const linger = (members) => members.reduce((most, one) => Math.max(most, one.lag), 0);

/** Seconds into a session the first visitor comes, at the earliest and latest. */
export const FIRST_VISIT = Object.freeze([5, 12]);
/** At most this many of the sea's own visits are in the water at once. */
export const VISITS_AT_ONCE = 2;

/**
 * The sea's own visits from a seed: a plan that grows as far as it is asked about (the same seed
 * gives the same visits, whatever order the clock is read in).
 * @param {number} seed
 */
export function planVisits(seed) {
    const rand = mulberry32((seed >>> 0) * 2654435761 + 97);
    const visits = [];
    let next = pick(rand, FIRST_VISIT);
    let side = rand() < 0.5 ? 1 : -1;
    const recent = [];
    const total = ACT_NAMES.reduce((n, name) => n + ACTS[name].weight, 0);
    const extend = (until, most = Infinity) => {
        let made = 0;
        while (next <= until && made < most) {
            made += 1;
            // Never the same kind twice running, and a rare act not again within four visits.
            let name = null;
            for (let tries = 0; tries < 24 && !name; tries++) {
                let r = rand() * total;
                let candidate = ACT_NAMES[ACT_NAMES.length - 1];
                for (let i = 0; i < ACT_NAMES.length; i++) {
                    r -= ACTS[ACT_NAMES[i]].weight;
                    if (r <= 0) {
                        candidate = ACT_NAMES[i];
                        break;
                    }
                }
                const act = ACTS[candidate];
                const lastKinds = recent.slice(-2).map((n) => ACTS[n].kind);
                const rare = act.weight < 1 && recent.slice(-4).includes(candidate);
                if (!lastKinds.includes(act.kind) && !rare) name = candidate;
            }
            name = name || ACT_NAMES[Math.floor(rand() * ACT_NAMES.length)];
            const act = ACTS[name];
            const seconds = pick(rand, act.seconds);
            // Mostly they come from alternate sides; now and then twice from the same.
            side = rand() < 0.75 ? -side : side;
            const { route, members } = settledAct(act, rand, side);
            const start = next;
            visits.push({
                act: name, kind: act.kind, start, seconds, end: start + seconds * (1 + linger(members)), route, members, index: visits.length,
            });
            recent.push(name);
            // The next comes after a gap that follows this one's length: sometimes while this one
            // is still in the water, sometimes after a long empty stretch of blue.
            let gap = seconds * (0.5 + rand() * 0.9) + 3 + 22 * rand() * rand();
            if (rand() < 0.14) gap += 25 + rand() * 35;
            next = start + gap;
            // Never a third at once: wait for the one before this one to leave.
            const before = visits[visits.length - VISITS_AT_ONCE];
            if (before && visits.length >= VISITS_AT_ONCE && next < before.end) next = before.end + 2 + rand() * 6;
        }
    };
    return {
        seed,
        visits,
        /** The visits in the water at `time` (seconds of the world's clock). */
        at(time, out = []) {
            out.length = 0;
            if (!(time >= 0)) return out;
            extend(time);
            for (let i = visits.length - 1; i >= 0; i--) {
                const v = visits[i];
                if (v.end < time) {
                    // Visits are in start order and none lasts over 80 s: nothing earlier is live.
                    if (v.start < time - 120) break;
                    continue;
                }
                if (v.start <= time) out.push(v);
            }
            return out.reverse();
        },
        /** Every visit that starts before `time` (for tests and the playground). */
        until(time) {
            extend(time);
            return visits.filter((v) => v.start <= time);
        },
        /**
         * Work ahead, a little each frame: plan at most one more visit up to `until` and sample
         * at most one planned visit's route (for this `squeeze`), so neither lands all at once in
         * the frame a visitor appears. Returns whether it did anything.
         */
        prepare(until, squeeze = 1) {
            const before = visits.length;
            extend(until, 1);
            if (visits.length > before) return true;
            for (let i = visits.length - 1; i >= 0 && visits[i].end > until - 200; i--) {
                const v = visits[i];
                if (!v.frames || v.frames.key !== Math.round(squeeze * 1000)) {
                    frameOnRoute(v, 0.5, squeeze, CAST[v.kind].bank, _warm);
                    return true;
                }
            }
            return false;
        },
    };
}

/** A visit of a named act starting at `start`, made the way the schedule would (playground, tests). */
export function makeVisit(name, start, seed = 1, side = 1) {
    const act = ACTS[name];
    if (!act) return null;
    const rand = mulberry32((seed >>> 0) * 7919 + name.length * 31 + 5);
    const seconds = pick(rand, act.seconds);
    const { route, members } = settledAct(act, rand, side);
    return {
        act: name, kind: act.kind, start, seconds, end: start + seconds * (1 + linger(members)), route, members, index: -1,
    };
}

/** A crossing on one of the fixed lanes the board's calls use (ocean-core.js LANES), as a visit. */
export function laneVisit(kind, lane, start, seconds, side, members) {
    const route = {
        type: 'cross',
        side,
        z: lane.z,
        y: lane.y,
        bow: lane.bow,
        reach: lane.reach,
        lift: lane.lift,
        climb: 0,
        out: 4,
        weave: 0.25,
        weaves: 9 / TAU,
        phase: 0,
        clear: CAST[kind].clear,
        top: CAST[kind].top,
    };
    settleRoute(route, kind, members);
    return {
        act: `call:${kind}`,
        kind,
        start,
        seconds,
        end: start + seconds * (1 + linger(members)),
        route,
        members,
        index: -1,
    };
}
