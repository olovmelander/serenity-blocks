/**
 * Grainfields — the herd's life on the near field (CPU, three-free).
 *
 * A lead mare and her band: they graze, each horse at its own business (head down in the barley,
 * a step or two to the next mouthful, head up to look round, a tail swished at the flies, a hind
 * leg rested, a foal at its mother's side), and every so often the band moves on: a walk to new
 * grass, a trot, a canter round a loop, or a gallop that leaves the picture over the crest, past
 * a side of the frame or behind the eye, and comes back in again somewhere else a little later.
 * A chain sets them running, a T-spin wheels them round.
 *
 * The lead mare follows a route (a polyline of waypoints); the others follow her trail, each a
 * few lengths behind and a little to one side, so the band strings out as she sets off, flows
 * round her turns and closes up when she stops. Each horse steers like an animal with a mass:
 * it accelerates, brakes and turns as hard as a horse can (the faster, the wider the turn), keeps
 * its own space from the others and goes round the shelterbelts. How it moves its legs, back,
 * neck, head, ears and tail for its speed and its business is grainfields-horse-motion.js's.
 *
 * Where it is visible comes from the view (bearings, degrees right of the view axis: the frame's
 * edges and the stretches the board covers), set by the world: new grazing grounds are picked in
 * the open, routes leave and re-enter through the frame's edges and the crest.
 */
import {
    DEG, EYE, PLACES, TAU, clamp, mulberry32, pointAt, smooth,
} from './grainfields-core.js';
import { BELTS, PATH_POINTS } from './grainfields-plan.js';

/** The band's numbers (metres, m/s, seconds). */
export const HERD = Object.freeze({
    /** Paces the lead mare sets. */
    paces: Object.freeze({
        walk: 1.45, trot: 3.8, canter: 6.6, gallop: 11.8,
    }),
    /** How far behind each other the band follows, and how far to the side. */
    spacing: 3.3,
    abreast: 1.7,
    /** Each horse's own space. */
    personal: 2.4,
    /** A horse's acceleration, braking and the sideways pull it can turn with. */
    accel: 2.6,
    brake: 4.2,
    grip: 7,
    /** The grazing ground's radius; how long the band grazes (s). */
    grazeRadius: 10,
    grazeTime: Object.freeze([18, 52]),
    /**
     * The stage: where grazing grounds are picked (distance from the eye), and the crest. From an
     * eye a metre and a half over a metre of barley a horse shows its back, neck and head over the
     * stand: near enough to read, it grazes within about fifty metres.
     */
    near: 14,
    far: 52,
    crest: 104,
});

/** The landscape view (bearings, degrees): the frame's edges, and what the board covers. */
export const DEFAULT_VIEW = Object.freeze({
    left: -37.5,
    right: 33.5,
    blocked: Object.freeze([Object.freeze([-11, 7]), Object.freeze([9, 16])]),
});

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The shelterbelts' stretches within reach of the band, as flat numbers (ax, az, bx, bz, half
 * width): the plan's own beltAt walks every belt to the far vale, far too slow to ask each step.
 */
const NEAR_BELTS = (() => {
    const out = [];
    BELTS.forEach((belt) => {
        for (let i = 0; i + 1 < belt.points.length; i++) {
            const [ax, az] = belt.points[i];
            const [bx, bz] = belt.points[i + 1];
            if (Math.min(Math.hypot(ax - EYE.x, az - EYE.z), Math.hypot(bx - EYE.x, bz - EYE.z)) < 600) {
                out.push(ax, az, bx, bz, belt.width);
            }
        }
    });
    return out;
})();

/** How deep in a shelterbelt a point is (0..1), as the plan's beltAt, near the band only. */
export function beltCover(x, z) {
    let cover = 0;
    for (let k = 0; k < NEAR_BELTS.length; k += 5) {
        const ax = NEAR_BELTS[k];
        const az = NEAR_BELTS[k + 1];
        const vx = NEAR_BELTS[k + 2] - ax;
        const vz = NEAR_BELTS[k + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
        const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
        const w = NEAR_BELTS[k + 4];
        cover = Math.max(cover, 1 - smooth(w * 0.35, w * 0.5, d));
    }
    return cover;
}
const point = (bearing, distance) => {
    const [x, z] = pointAt(bearing, distance);
    return { x, z };
};

/** The open stretches of a view (bearings), the board's covered ones and a margin taken out. */
export function openBearings(view = DEFAULT_VIEW, margin = 3) {
    let spans = [[view.left + margin, view.right - margin]];
    (view.blocked || []).forEach(([a, b]) => {
        const next = [];
        spans.forEach(([lo, hi]) => {
            if (b + margin <= lo || a - margin >= hi) next.push([lo, hi]);
            else {
                if (a - margin > lo) next.push([lo, a - margin]);
                if (b + margin < hi) next.push([b + margin, hi]);
            }
        });
        spans = next;
    });
    const open = spans.filter(([lo, hi]) => hi - lo > 2);
    return open.length ? open : [[view.left + margin, view.right - margin]];
}

/** A bearing in the open stretches, `u` (0..1) across their total width. */
function openBearing(view, u) {
    const spans = openBearings(view);
    const total = spans.reduce((sum, [lo, hi]) => sum + hi - lo, 0);
    let rest = clamp(u, 0, 0.9999) * total;
    for (const [lo, hi] of spans) {
        if (rest <= hi - lo) return lo + rest;
        rest -= hi - lo;
    }
    return spans[0][0];
}

/** Whether a point is in the frame and before the crest (where the band can be seen). */
export function onStage(x, z, view = DEFAULT_VIEW) {
    const dx = x - EYE.x;
    const dz = z - EYE.z;
    const distance = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, -dz) / DEG;
    return dz < 0 && distance > 6 && distance < HERD.crest && bearing > view.left - 2 && bearing < view.right + 2;
}

// ── Routes ──────────────────────────────────────────────────────────────────────────

/** A polyline with its arc length, and the point and direction at a length along it. */
function makeRoute(points) {
    const pts = points.map((p) => ({ x: p.x, z: p.z }));
    const lengths = [0];
    for (let i = 1; i < pts.length; i++) {
        lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    return { points: pts, lengths, total: lengths[lengths.length - 1] };
}

function routeAt(route, s, out = {}) {
    const { points, lengths } = route;
    const at = clamp(s, 0, route.total);
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < at) i++;
    const a = points[i - 1];
    const b = points[Math.min(i, points.length - 1)];
    const span = Math.max(1e-6, lengths[i] - lengths[i - 1]);
    const t = clamp((at - lengths[i - 1]) / span, 0, 1);
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
}

/** The length along a route nearest a point, searched forward from `from`. */
function routeProject(route, x, z, from) {
    let best = from;
    let bestD = Infinity;
    const probe = {};
    for (let s = from; s <= Math.min(route.total, from + 30); s += 0.75) {
        routeAt(route, s, probe);
        const d = (probe.x - x) ** 2 + (probe.z - z) ** 2;
        if (d < bestD) {
            bestD = d;
            best = s;
        }
    }
    return best;
}

/** A grazing ground in the open: a bearing in the open stretches, a distance on the stage. */
function grazingGround(rng, view, near = HERD.near, far = HERD.far) {
    // Now and then the verge of the path, where the barley gives way to the low white flowers
    // (where the verge is in the picture).
    if (rng() < 0.35) {
        for (let k = 0; k < 4; k++) {
            const i = 2 + Math.floor(rng() * 6);
            const [x, z] = PATH_POINTS[i];
            const side = rng() < 0.5 ? -1 : 1;
            const spot = { x: x + side * (2 + rng() * 2.5), z: z + (rng() - 0.5) * 4, verge: true };
            if (onStage(spot.x, spot.z, view)) return spot;
        }
    }
    const bearing = openBearing(view, rng());
    const distance = near + (far - near) * rng();
    return point(bearing, distance);
}

/** Smooth a route's corners (one round of corner cutting, the ends kept). */
function soften(points) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1];
        const b = points[i];
        const c = points[i + 1];
        out.push({ x: b.x * 0.5 + a.x * 0.25 + c.x * 0.25, z: b.z * 0.5 + a.z * 0.25 + c.z * 0.25 });
    }
    out.push(points[points.length - 1]);
    return out;
}

/**
 * Points round the eye from one bearing to another (degrees, the long way when asked by the sign
 * of the span), at a distance easing from `distance` to `distanceTo`, about every `step` degrees.
 */
function arc(from, to, distance, step = 15, distanceTo = distance) {
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / step));
    return Array.from({ length: n + 1 }, (_, k) => point(from + ((to - from) * k) / n, distance + ((distanceTo - distance) * k) / n));
}

/**
 * The band's next move from where its leader stands. Returns { pace, points, settle, name }: the
 * pace it sets off at, the route, and the pace it eases into for the last stretch (or null).
 */
export function planMove(kind, from, rng, view = DEFAULT_VIEW) {
    const here = { x: from.x, z: from.z };
    const side = from.x > EYE.x ? 1 : -1;
    const ground = grazingGround(rng, view);
    if (kind === 'walk' || kind === 'trot') {
        // To new grass, worth the walk (a trot farther) but not across the whole field.
        const [lo, hi] = kind === 'walk' ? [14, 45] : [22, 60];
        let pick = ground;
        for (let k = 0; k < 6; k++) {
            const d = Math.hypot(pick.x - here.x, pick.z - here.z);
            if (d >= lo && d <= hi) break;
            pick = grazingGround(rng, view);
        }
        return {
            name: kind, pace: kind, points: [here, pick], settle: 'walk',
        };
    }
    if (kind === 'canter') {
        // A loop on the stage, through two open points, to new grass.
        const a = grazingGround(rng, view, 24, 70);
        const b = grazingGround(rng, view, 16, 55);
        return {
            name: 'canter', pace: 'canter', points: soften([here, a, b, ground]), settle: 'trot',
        };
    }
    if (kind === 'wheel') {
        // Round the band's ground at a canter, a lap and a bit, the way it is facing.
        const r = 16;
        const cx = from.x - Math.sin(from.heading + Math.PI / 2) * r * from.turn;
        const cz = from.z - Math.cos(from.heading + Math.PI / 2) * r * from.turn;
        const a0 = Math.atan2(from.x - cx, from.z - cz);
        const pts = [];
        for (let k = 0; k <= 20; k++) {
            const a = a0 + from.turn * k * ((TAU * 1.3) / 20);
            pts.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r });
        }
        return {
            name: 'wheel', pace: 'canter', points: pts, settle: 'trot',
        };
    }
    // A gallop. At a gallop a horse turns no tighter than about twenty metres, so the routes are
    // arcs round the eye and long curves, not corners.
    // ('gallop' is any of them; 'gallop-out' one that leaves the picture and comes back.)
    const exits = kind === 'gallop-out' ? ['round', 'crest', 'path'] : ['round', 'crest', 'path', 'loop'];
    const exit = kind === 'gallop' || kind === 'gallop-out' ? exits[Math.floor(rng() * exits.length)] : kind.replace('gallop-', '');
    const b0 = clamp(from.bearing || 0, -80, 80);
    if (exit === 'crest') {
        // Away over the crest and out of sight behind it, round, and back over it somewhere else.
        const b1 = clamp(-b0 * 0.6 + (rng() - 0.5) * 30, -28, 28);
        const pts = [here, point(b0 * 0.7, 62), point(b0 * 0.5, 150),
            ...arc(b0 * 0.4, b1, 200, 12), point(b1, 120), point(openBearing(view, rng()), 70), ground];
        return {
            name: 'gallop-crest', pace: 'gallop', points: soften(pts), settle: 'canter',
        };
    }
    if (exit === 'path') {
        // Out to the path's far end, down it toward the eye, off the left edge close by, round
        // behind the eye and back in on the right.
        const pts = [here];
        for (let i = 10; i >= 3; i--) pts.push({ x: PATH_POINTS[i][0], z: PATH_POINTS[i][1] });
        pts.push(...arc(-40, -200, 22, 16), ...arc(160, 62, 24, 16), point(42, 30), ground);
        return {
            name: 'gallop-path', pace: 'gallop', points: soften(pts), settle: 'canter',
        };
    }
    if (exit === 'loop') {
        // A great loop on the stage, out toward the crest and back across the near field.
        const near = 20 + rng() * 8;
        const pts = [here, ...arc(b0, -side * 30, 70, 12), ...arc(-side * 34, side * 30, near, 12, near + 4), ground];
        return {
            name: 'gallop-loop', pace: 'gallop', points: soften(pts), settle: 'canter',
        };
    }
    // Round: across the frame in front of the eye, off the far edge, round behind the eye and in
    // again on the first side.
    const lane = 23 + rng() * 6;
    const pts = [here, point(b0 - side * 6, lane), ...arc(b0 - side * 12, -side * 180, lane, 15),
        ...arc(side * 180 - side * 15, side * 55, lane + 2, 15), ground];
    return {
        name: 'gallop-round', pace: 'gallop', points: soften(pts), settle: 'canter',
    };
}

// ── The band ────────────────────────────────────────────────────────────────────────

/** Coats (indices into the herd's coat table), spread so neighbours differ. */
const COAT_ORDER = [0, 2, 1, 3, 4, 0, 1, 2, 3];

/**
 * Each horse's quiet business while the band grazes: how long it lasts (s) and how often it comes
 * up, for a grown horse (`weight`) and a foal (`foal`). Grazing creeps on a step at a time; a step
 * walks to the next mouthful; a horse looks up, dozes on a cocked hind, swats at the flies with its
 * head and tail, shakes its head and neck, stamps a fore at a fly, yawns. A foal nurses at its
 * mother's flank and now and then frolics round her, bucking as it sets off.
 */
const BUSINESS = Object.freeze({
    graze: Object.freeze({ time: [5, 16], weight: 6, foal: 3 }),
    step: Object.freeze({ time: [1.5, 3.5], weight: 3, foal: 2 }),
    look: Object.freeze({ time: [3, 8], weight: 2, foal: 1.5 }),
    rest: Object.freeze({ time: [10, 24], weight: 1, foal: 0 }),
    swat: Object.freeze({ time: [1.2, 2.4], weight: 1, foal: 0.4 }),
    shake: Object.freeze({ time: [1.2, 1.8], weight: 0.5, foal: 0.3 }),
    stamp: Object.freeze({ time: [0.9, 1.4], weight: 0.6, foal: 0.2 }),
    yawn: Object.freeze({ time: [2.2, 3.2], weight: 0.25, foal: 0.1 }),
    nurse: Object.freeze({ time: [6, 14], weight: 0, foal: 3 }),
    frolic: Object.freeze({ time: [3.5, 7], weight: 0, foal: 1.2 }),
});
const BUSINESS_KEYS = Object.keys(BUSINESS);
const BUSINESS_TOTAL = BUSINESS_KEYS.reduce((sum, key) => sum + BUSINESS[key].weight, 0);
const FOAL_TOTAL = BUSINESS_KEYS.reduce((sum, key) => sum + BUSINESS[key].foal, 0);

function pickBusiness(rng, foal = false) {
    const field = foal ? 'foal' : 'weight';
    let r = rng() * (foal ? FOAL_TOTAL : BUSINESS_TOTAL);
    for (const key of BUSINESS_KEYS) {
        r -= BUSINESS[key][field];
        if (r <= 0 && BUSINESS[key][field] > 0) return key;
    }
    return 'graze';
}

/** How fast a grazing horse creeps on (m/s), and how a frolicking foal circles (radius m, speed m/s). */
const CREEP = 0.09;
const FROLIC = Object.freeze({ radius: [3.5, 6], speed: [3.4, 5.2] });

const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();
/** The band's last one or two horses are foals: theirs are the third and fourth mares. */
const motherOf = (i, n, foal) => {
    if (!foal) return -1;
    return i === n - 1 ? 2 : 3;
};
/** How much room a horse keeps from another: a foal and its mother close, any foal closer. */
const roomFor = (kin, foal) => {
    if (kin) return 0.55;
    return foal ? 0.85 : 1;
};
/** The lineup's front row: the first stands looking, the rest are on the move. */
const frontBusiness = (k) => (k === 0 ? 'look' : 'travel');
/** Ease a value toward a goal at `rate` per second. */
const follow = (value, goal, rate, dt) => value + (goal - value) * (1 - Math.exp(-rate * dt));

/**
 * The herd: `count` horses (0..9). `seed` fixes their personalities and their life's choices.
 * Returns { horses, update(time, dt), run(time), wheel(time), startle(time), reset(time),
 * setView(view), setCalm(calm), plan }.
 */
export function createHerdSim({ count = 9, seed = 0x40e5, view = DEFAULT_VIEW } = {}) {
    const n = Math.max(0, Math.min(9, Math.round(count)));
    let rng = mulberry32(seed);
    let stage = view;
    let calm = false;
    let lineup = null;
    let script = [];
    let horses = [];
    const band = {
        plan: null, // { name, route, pace, settle, s }
        grazeUntil: 0,
        centre: { x: 0, z: 0 },
        drift: { x: 0, z: 0 },
        trail: [],
        trailLength: 0,
        nextRun: null,
        nextWheel: null,
        time: 0,
    };

    const place = () => {
        rng = mulberry32(seed);
        // The first grazing ground: right of the board (the frame opens on the band).
        const home = { x: PLACES.herd.x, z: PLACES.herd.z };
        band.centre = { x: home.x, z: home.z };
        band.drift = { x: (rng() - 0.5) * 0.12, z: (rng() - 0.5) * 0.12 };
        band.plan = null;
        band.grazeUntil = range(rng, HERD.grazeTime) * 0.6;
        band.trail = [];
        band.trailLength = 0;
        band.nextRun = null;
        band.nextWheel = null;
        horses = Array.from({ length: n }, (_, i) => {
            const foal = n >= 6 && i >= n - (n >= 8 ? 2 : 1);
            const a = rng() * TAU;
            const r = Math.sqrt(rng()) * PLACES.herd.radius;
            const x = home.x + Math.cos(a) * r;
            const z = home.z + Math.sin(a) * r * 0.7;
            const heading = rng() * TAU;
            return {
                i,
                foal,
                mother: motherOf(i, n, foal),
                x,
                z,
                heading,
                speed: 0,
                yawRate: 0,
                accel: 0,
                coat: COAT_ORDER[i % COAT_ORDER.length],
                scale: foal ? 0.6 + rng() * 0.07 : 0.95 + rng() * 0.1,
                pace: foal ? 1.04 : 0.95 + rng() * 0.1,
                rank: i,
                side: i === 0 ? 0 : ((i % 2) * 2 - 1) * (0.6 + rng() * 0.8),
                seed: rng(),
                // The quiet business, its spot and its clock; whether it grazes the verge's grass.
                business: 'graze',
                businessSince: 0,
                businessUntil: rng() * 8,
                spotX: x,
                spotZ: z,
                lookYaw: 0,
                verge: false,
                // Startled (1), easing back to calm (0).
                alert: 0,
            };
        });
        band.time = 0;
    };

    /** The band's centre (the grazing ground it is on). */
    const centreOf = () => {
        let x = 0;
        let z = 0;
        horses.forEach((h) => {
            x += h.x;
            z += h.z;
        });
        return { x: x / Math.max(1, horses.length), z: z / Math.max(1, horses.length) };
    };

    const start = (kind, time) => {
        const lead = horses[0];
        if (!lead) return;
        const from = {
            x: lead.x,
            z: lead.z,
            heading: lead.heading,
            turn: rng() < 0.5 ? 1 : -1,
            bearing: Math.atan2(lead.x - EYE.x, -(lead.z - EYE.z)) / DEG,
        };
        const move = planMove(kind, from, rng, stage);
        band.plan = {
            name: move.name,
            route: makeRoute(move.points),
            pace: move.pace,
            settle: move.settle,
            s: 0,
            at: time,
            verge: Boolean(move.points[move.points.length - 1]?.verge),
        };
        band.trail = [{ x: lead.x, z: lead.z, s: 0 }];
        band.trailLength = 0;
        horses.forEach((h) => { h.business = 'travel'; });
    };

    /** What the band does next when it has grazed long enough. */
    const nextMove = () => {
        const r = rng();
        if (calm) return r < 0.75 ? 'walk' : 'trot';
        if (r < 0.28) return 'walk';
        if (r < 0.45) return 'trot';
        if (r < 0.67) return 'canter';
        return 'gallop';
    };

    const arrive = (time) => {
        const c = centreOf();
        band.centre = c;
        const verge = Boolean(band.plan?.verge);
        band.drift = { x: (rng() - 0.5) * 0.12, z: (rng() - 0.5) * 0.12 };
        band.plan = null;
        band.grazeUntil = time + range(rng, HERD.grazeTime);
        horses.forEach((h) => {
            h.business = 'step';
            h.businessUntil = time + 2 + rng() * 3;
            const a = rng() * TAU;
            const r = Math.sqrt(rng()) * HERD.grazeRadius * (h.foal ? 0.3 : 1);
            h.spotX = (h.foal ? h.x : c.x) + Math.cos(a) * r;
            h.spotZ = (h.foal ? h.z : c.z) + Math.sin(a) * r * 0.7;
            h.verge = verge;
        });
    };

    // ── Steering ──
    const probe = {};
    const steer = (h, tx, tz, speedGoal, dt) => {
        // Toward the goal (a direction: how far it is does not drown out the rest).
        const tdx = tx - h.x;
        const tdz = tz - h.z;
        const reach = Math.hypot(tdx, tdz);
        let dx = reach > 1e-4 ? tdx / reach : Math.sin(h.heading);
        let dz = reach > 1e-4 ? tdz / reach : Math.cos(h.heading);
        // Keep out of each other's space: shy away, and the one behind eases off.
        let brake = 1;
        let pressed = 0;
        const fx = Math.sin(h.heading);
        const fz = Math.cos(h.heading);
        horses.forEach((o) => {
            if (o === h) return;
            const ox = h.x - o.x;
            const oz = h.z - o.z;
            const d = Math.hypot(ox, oz);
            const kin = o.mother === h.i || h.mother === o.i;
            // (A foal at the teat comes right in under its mother.)
            const suckling = kin && (h.business === 'nurse' || o.business === 'nurse');
            const room = HERD.personal * (suckling ? 0.2 : roomFor(kin, h.foal || o.foal));
            if (d < room && d > 1e-4) {
                const press = (room - d) / room;
                dx += (ox / d) * press * 2.5;
                dz += (oz / d) * press * 2.5;
                pressed = Math.max(pressed, press);
                if (-(ox * fx + oz * fz) / d > 0.3) brake = Math.min(brake, 1 - press * 0.85);
            }
        });
        // Round the shelterbelts: look ahead, and turn toward the clearer side.
        const look = 4 + h.speed * 1.2;
        const ahead = Math.max(beltCover(h.x + fx * look, h.z + fz * look), beltCover(h.x, h.z) * 1.5);
        if (ahead > 0.02) {
            const leftC = beltCover(h.x + Math.sin(h.heading + 0.6) * look, h.z + Math.cos(h.heading + 0.6) * look);
            const rightC = beltCover(h.x + Math.sin(h.heading - 0.6) * look, h.z + Math.cos(h.heading - 0.6) * look);
            const a = h.heading + (leftC < rightC ? 0.9 : -0.9);
            dx += Math.sin(a) * ahead * 3;
            dz += Math.cos(a) * ahead * 3;
        }
        const want = Math.atan2(dx, dz);
        const turn = wrapAngle(want - h.heading);
        // As hard as a horse can turn: slow, it can pivot; fast, its grip bounds the turn.
        const maxRate = Math.min(1.5, HERD.grip / Math.max(0.6, h.speed));
        const rate = clamp(turn * 2.4, -maxRate, maxRate);
        h.yawRate += (rate - h.yawRate) * (1 - Math.exp(-8 * dt));
        h.heading = wrapAngle(h.heading + h.yawRate * dt);
        // A horse slows for a hard turn and for one close in front; crowded standing, it steps aside.
        let goal = speedGoal * brake * (1 - 0.45 * smooth(0.6, 1.6, Math.abs(turn)));
        if (pressed > 0.3 && goal < 0.7) goal = 0.7;
        const dv = clamp(goal - h.speed, -HERD.brake * dt, HERD.accel * dt);
        h.accel = dt > 0 ? dv / dt : 0;
        h.speed = Math.max(0, h.speed + dv);
        h.x += Math.sin(h.heading) * h.speed * dt;
        h.z += Math.cos(h.heading) * h.speed * dt;
    };

    // ── The lead mare on her route; the band on her trail ──
    const travel = (time, dt) => {
        const { plan } = band;
        const lead = horses[0];
        const pace = HERD.paces[plan.pace];
        const settle = HERD.paces[plan.settle] || pace;
        plan.s = routeProject(plan.route, lead.x, lead.z, plan.s);
        const left = plan.route.total - plan.s;
        const look = Math.max(5, lead.speed * 1.1);
        routeAt(plan.route, plan.s + look, probe);
        // Ease into the settling pace over the last stretch, and to a stand at the end.
        const stretch = smooth(10, 45, left);
        const leadGoal = Math.min(settle + (pace - settle) * stretch, Math.sqrt(2 * HERD.brake * 0.55 * Math.max(0, left - 1)));
        steer(lead, probe.x, probe.z, leadGoal, dt);
        // The trail behind her.
        const last = band.trail[band.trail.length - 1];
        const step = Math.hypot(lead.x - last.x, lead.z - last.z);
        if (step > 0.4) {
            band.trailLength += step;
            band.trail.push({ x: lead.x, z: lead.z, s: band.trailLength });
            if (band.trail.length > 900) band.trail.splice(0, band.trail.length - 900);
        }
        for (let k = 1; k < horses.length; k++) {
            const h = horses[k];
            const mother = h.mother >= 0 ? horses[h.mother] : null;
            // Its place in the band: rows of two behind the mare, a little to its side (a foal at its
            // mother's flank).
            const back = mother ? HERD.spacing * (Math.floor(mother.rank / 2) + 1.4) : HERD.spacing * (Math.floor((k + 1) / 2) + 0.2 * h.seed);
            const target = band.trailLength - back;
            let tx = h.x;
            let tz = h.z;
            let ahead = 0;
            if (target > 0 && band.trail.length > 1) {
                // The trail point at that length, and the trail's direction there.
                let j = band.trail.length - 1;
                while (j > 0 && band.trail[j].s > target) j--;
                const a = band.trail[j];
                const b = band.trail[Math.min(j + 1, band.trail.length - 1)];
                const span = Math.max(1e-4, b.s - a.s);
                const t = clamp((target - a.s) / span, 0, 1);
                const px = a.x + (b.x - a.x) * t;
                const pz = a.z + (b.z - a.z) * t;
                const dirX = (b.x - a.x) / span;
                const dirZ = (b.z - a.z) / span;
                const sideOff = (mother ? (mother.side >= 0 ? -1 : 1) * 1.1 : h.side * HERD.abreast);
                tx = px - dirZ * sideOff + dirX * 2.5;
                tz = pz + dirX * sideOff + dirZ * 2.5;
                ahead = (tx - h.x) * Math.sin(h.heading) + (tz - h.z) * Math.cos(h.heading);
            }
            const gap = Math.hypot(tx - h.x, tz - h.z);
            const own = pace * 1.12 * h.pace;
            const speedGoal = gap < 0.6 ? lead.speed * 0.6 : clamp(lead.speed + 0.9 * (ahead - 2.5) + (gap > 12 ? 2 : 0), 0, own);
            steer(h, tx, tz, target > 0 ? speedGoal : 0, dt);
        }
        if (left < 1.5 && lead.speed < 0.6) arrive(time);
    };

    // ── Grazing: each horse at its own business round the band's ground ──
    const graze = (time, dt) => {
        band.centre.x += band.drift.x * dt;
        band.centre.z += band.drift.z * dt;
        horses.forEach((h) => {
            if (time >= h.businessUntil) {
                h.business = pickBusiness(rng, h.foal);
                // (A foal only nurses or frolics round a mother it has.)
                if (h.mother < 0 && (h.business === 'nurse' || h.business === 'frolic')) h.business = 'graze';
                // (Calm: no foal careering about.)
                if (calm && h.business === 'frolic') h.business = 'graze';
                h.businessSince = time;
                h.businessUntil = time + range(rng, BUSINESS[h.business].time);
                if (h.business === 'frolic') {
                    h.frolicRadius = range(rng, FROLIC.radius);
                    h.frolicSpeed = range(rng, FROLIC.speed);
                    h.frolicTurn = rng() < 0.5 ? -1 : 1;
                }
                if (h.business === 'step') {
                    // The next mouthful a few metres on, kept round the band's ground (a foal round its mother).
                    const anchor = h.mother >= 0 ? horses[h.mother] : band.centre;
                    const a = h.heading + (rng() - 0.5) * 1.6;
                    const reach = 1.5 + rng() * 3;
                    let sx = h.x + Math.sin(a) * reach;
                    let sz = h.z + Math.cos(a) * reach;
                    const limit = h.mother >= 0 ? 3.5 : HERD.grazeRadius;
                    const ox = sx - anchor.x;
                    const oz = sz - anchor.z;
                    const d = Math.hypot(ox, oz);
                    if (d > limit) {
                        sx = anchor.x + (ox / d) * limit * 0.8;
                        sz = anchor.z + (oz / d) * limit * 0.8;
                    }
                    h.spotX = sx;
                    h.spotZ = sz;
                }
                if (h.business === 'look') h.lookYaw = (rng() - 0.5) * 1.6;
            }
            const mother = h.mother >= 0 ? horses[h.mother] : null;
            if (mother && h.business === 'nurse') {
                // To its mother's flank, behind her elbow, and stand there beside her, head under her belly.
                const across = (h.x - mother.x) * Math.cos(mother.heading) - (h.z - mother.z) * Math.sin(mother.heading);
                const side = across >= 0 ? 1 : -1;
                const fx = Math.sin(mother.heading);
                const fz = Math.cos(mother.heading);
                const sx = mother.x + fz * side * 0.62 * mother.scale - fx * 0.35 * mother.scale;
                const sz = mother.z - fx * side * 0.62 * mother.scale - fz * 0.35 * mother.scale;
                const gap = Math.hypot(sx - h.x, sz - h.z);
                if (gap > 0.35) steer(h, sx, sz, clamp(gap * 1.1, 0, HERD.paces.walk), dt);
                else steer(h, h.x + fx * 5, h.z + fz * 5, 0, dt);
                h.nursingSide = side;
                // She stands for it.
                if (gap < 1.5 && mother.business !== 'rest') {
                    mother.business = 'graze';
                    mother.businessUntil = Math.max(mother.businessUntil, h.businessUntil);
                    mother.nursed = time;
                }
                return;
            }
            if (mother && h.business === 'frolic') {
                // A loop round its mother at a trot or a canter.
                const a = Math.atan2(h.x - mother.x, h.z - mother.z) + h.frolicTurn * 0.7;
                const rx = mother.x + Math.sin(a) * h.frolicRadius;
                const rz = mother.z + Math.cos(a) * h.frolicRadius;
                steer(h, rx, rz, h.frolicSpeed, dt);
                return;
            }
            const toX = h.spotX - h.x;
            const toZ = h.spotZ - h.z;
            const far = Math.hypot(toX, toZ);
            const walking = h.business === 'step' || far > 3.5;
            // A walk to the spot; the last half-metre at a creep.
            const goal = walking ? clamp(far * 0.8, 0, far > 8 ? HERD.paces.trot : HERD.paces.walk * 0.9) : 0;
            if (walking && far > 0.3) steer(h, h.spotX, h.spotZ, goal, dt);
            else if (h.business === 'graze' && !(h.nursed > time - 0.5)) {
                // Grazing creeps on, the head swinging from side to side for the next mouthful.
                const wander = h.heading + 0.5 * Math.sin(time * 0.17 + h.seed * 13);
                const creep = CREEP * (0.6 + 0.4 * Math.sin(time * 0.31 + h.seed * 7));
                steer(h, h.x + Math.sin(wander) * 5, h.z + Math.cos(wander) * 5, creep, dt);
            } else steer(h, h.x + Math.sin(h.heading) * 5, h.z + Math.cos(h.heading) * 5, 0, dt);
            if (!walking && h.business === 'step') h.businessUntil = Math.min(h.businessUntil, time + 0.5);
        });
        if (time >= band.grazeUntil) start(nextMove(), time);
    };

    /** Startled horses calm down. */
    const calmDown = (h, dt) => {
        h.alert = follow(h.alert, 0, 0.35, dt);
    };

    /** The gaits side by side on the spot (captures). */
    const arrange = () => {
        // The front row: a stand, a walk, a trot, a canter, a gallop; behind it, the quiet business.
        const speeds = [0, HERD.paces.walk, HERD.paces.trot, HERD.paces.canter, HERD.paces.gallop];
        const quiet = ['graze', 'rest', 'swat', 'graze'];
        horses.forEach((h, i) => {
            const front = i < speeds.length;
            const k = front ? i : i - speeds.length;
            h.x = front ? -9 + k * 4.5 : -7 + k * 4.5;
            h.z = EYE.z - lineup.distance - (front ? 0 : 7);
            h.heading = front || k % 2 ? Math.PI / 2 : -Math.PI / 2;
            h.lineupSpeed = front ? speeds[k] : 0;
            // On the spot: the ground runs back under its hooves (grainfields-horse-motion.js).
            h.treadmill = true;
            h.business = front ? frontBusiness(k) : quiet[k % quiet.length];
            h.businessUntil = Infinity;
            h.lookYaw = 0;
        });
    };

    place();

    const sim = {
        get horses() { return horses; },
        get plan() { return band.plan; },
        get centre() { return band.centre; },
        get calm() { return calm; },
        /** The view the stage is picked in (bearings, degrees): { left, right, blocked }. */
        setView(next) {
            if (next && Number.isFinite(next.left) && Number.isFinite(next.right)) stage = next;
        },
        /** Calm (reduced motion): no gallops, no wheels; a walk or a trot to new grass. */
        setCalm(on) { calm = Boolean(on); },
        /** A chain breaks the storm: the band gallops, out of the picture and back. */
        run(time) {
            if (calm || !horses.length) return;
            if (band.plan && band.plan.pace === 'gallop' && time - band.plan.at < 20) return;
            band.nextRun = time;
        },
        /** A T-spin: the band wheels round its ground at a canter. */
        wheel(time) {
            if (calm || !horses.length) return;
            if (band.plan?.name === 'wheel') return;
            band.nextWheel = time;
        },
        /**
         * Captures: the gaits side by side on the spot (a stand, a walk, a trot, a canter, a gallop),
         * facing +x in a row across the view `distance` metres out, the rest of the band away.
         */
        lineup(on, distance = 16) {
            lineup = on ? { distance } : null;
            if (lineup) arrange();
            else horses.forEach((h) => { h.treadmill = false; });
        },
        /** Captures: moves the band makes at set times ([{ at, kind }]), replayed by a seek too. */
        setScript(moves) {
            script = (moves || []).filter((m) => Number.isFinite(m?.at) && typeof m.kind === 'string')
                .map((m) => ({ at: m.at, kind: m.kind }));
        },
        /** A hard drop: heads up. */
        startle() {
            horses.forEach((h) => { h.alert = Math.max(h.alert, 0.8 + 0.2 * h.seed); });
        },
        /** A seek: the band's life replayed from the start to `time` (captures). */
        reset(time = 0) {
            place();
            const until = Math.min(900, Math.max(0, time));
            // In the live step (1/30 s), so a seek lands the band exactly where a run that long would
            // have it, each horse at the same business (captures film a moment by its time).
            const step = 1 / 30;
            const steps = Math.round(until / step);
            for (let k = 1; k <= steps; k++) sim.update(k * step, step);
            band.time = time;
            if (lineup) arrange();
        },
        update(time, dt, maxStep = 1 / 30) {
            const d = Math.max(0, Math.min(0.25, dt || 0));
            const before = band.time;
            band.time = time;
            script.forEach((m) => {
                if (m.at > before && m.at <= time) start(m.kind, time);
            });
            if (band.nextWheel !== null) {
                start('wheel', time);
                band.nextWheel = null;
            } else if (band.nextRun !== null) {
                // The storm breaking sends the band out of the picture and back.
                start('gallop-out', time);
                band.nextRun = null;
            }
            // Sub-steps keep the steering stable on a long frame.
            const steps = Math.max(1, Math.ceil(d / maxStep - 1e-6));
            const h = d / steps;
            for (let k = 0; k < steps; k++) {
                if (lineup) {
                    horses.forEach((horse) => {
                        horse.speed = horse.lineupSpeed || 0;
                        horse.yawRate = 0;
                        horse.accel = 0;
                    });
                } else if (band.plan) travel(time, h);
                else graze(time, h);
                horses.forEach((horse) => calmDown(horse, h));
            }
        },
    };
    return sim;
}
