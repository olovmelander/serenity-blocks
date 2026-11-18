/**
 * Spring — birds over the valley: whooper swans and cranes, the two great birds a Norrland spring
 * brings back.
 *
 *   swans   white, long necks straight out, feet tucked: they come over the fall's brink from
 *           behind it, drop to the river and fly low along it past the knoll, against the dark
 *           water, then climb away down the valley and out of the lens on the right
 *   cranes  grey, black-tipped, necks out and legs trailing: a long skein high across the valley
 *           from the left to the right, or lower over the fall's rim toward the fells
 *
 * A perfect clear calls the swans, a level-up and a fever the cranes; and both come by on their
 * own, by the clock (VISITS: a pair of swans along the river, a few cranes high up), so the valley
 * has birds in it whatever the hands do.
 *
 * A flight flies its route edge to edge at one pace, whole: every bird of it is already on the
 * route behind its leader when the leader sets out from out of sight (behind the brink, or beyond
 * the lens's edge), and it leaves through the lens's edge; no bird is ever grown or shrunk in
 * view. A route is a curve through waypoints, walked by arc length; each bird stands at its own
 * place in the formation behind and beside the leader, banks into the route's turns and pitches
 * with its climb.
 *
 * One mesh a kind of bird, every bird an instance placed by three vectors the CPU writes while a
 * flight is out (where, which way, which way is up). The vertex stage beats the wings: each wing
 * is an arm and a hand hinged at the wrist, the hand a little behind the arm, so the stroke rolls
 * out to the tips; the body rises a little on each downstroke.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    float,
    max,
    min,
    normalize,
    positionGeometry,
    sign,
    sin,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { TAU, clamp as clampJs, mulberry32 } from './spring-core.js';
import { aerial, sunShare } from './spring-light.js';

/** The most birds in one flight. */
export const FLIGHT_MOST = 9;

/**
 * The kinds of bird: wingspan (m), how many fly together when an event calls them, how fast they
 * fly (m/s) and beat their wings (beats/s), the formation's spacing (m back and out a rank), and
 * how much larger than life they are drawn (a hundred metres off a crane is a dozen pixels).
 */
export const BIRDS = Object.freeze({
    swan: Object.freeze({
        id: 0, span: 2.4, count: 7, speed: 16, beat: 1.75, back: 3.9, out: 2.7, drawn: 1.15,
    }),
    crane: Object.freeze({
        id: 1, span: 2.25, count: 9, speed: 14, beat: 1.45, back: 4.4, out: 3.2, drawn: 1.35,
    }),
});
const KINDS = Object.freeze([BIRDS.swan, BIRDS.crane]);

/** A kind's build (wingspans): its body's length and girth, its neck's reach, and where its wings are hung. */
export function birdBuild(kind) {
    const swan = kind.id === BIRDS.swan.id;
    const girth = swan ? 0.06 : 0.047;
    return {
        swan, length: swan ? 0.3 : 0.24, girth, neck: swan ? 0.28 : 0.23, shoulder: girth * 0.7,
    };
}

/**
 * The wingbeat (radians): the arm's rest lift and its stroke, the hand's stroke about the wrist
 * and how far behind the arm it runs, where the wrist stands along the wing (share of it), and
 * how far the body rises and sinks (wingspans).
 */
export const WINGBEAT = Object.freeze({
    lift: 0.1, arm: 0.5, hand: 0.48, lag: 1.05, wrist: 0.44, bob: 0.014,
});

/**
 * The routes (world metres: x, height, z), each a curve through its waypoints.
 *   river  over the brink from behind the fall, down to the water, low along the river past the
 *          knoll, and away up and out to the right
 *   high   a long line high over the valley, from beyond the lens's left edge to beyond its right
 *   rim    lower, in over the gorge's rim on the left and away toward the fells on the right
 * Each starts just out of sight (behind the brink, or a few seconds' flight beyond the widest
 * lens's left edge), so the birds an event calls are in the picture within three or four seconds.
 */
export const ROUTES = Object.freeze({
    river: Object.freeze([
        [-50, 34.3, -140], [-44, 36.5, -114], [-39, 27, -94], [-31, 14, -68], [-18, 7.8, -45],
        [0, 6.2, -36], [20, 6.8, -43], [42, 9.5, -74], [78, 16, -122], [150, 30, -176], [280, 52, -212],
        [460, 80, -240],
    ]),
    high: Object.freeze([[-119, 35.5, -100], [-40, 37, -112], [90, 38, -114], [300, 44, -78]]),
    rim: Object.freeze([[-122, 32.5, -80], [-40, 35.5, -106], [60, 38, -138], [330, 46, -205]]),
});

/**
 * Birds by the clock: a visit about every `gap` seconds (`jitter` either way), the first `first`
 * seconds in; each one of `kinds` (a bird, a route, how many), dealt by the visit's number.
 */
export const VISITS = Object.freeze({
    first: 34,
    gap: 118,
    jitter: 26,
    kinds: Object.freeze([
        Object.freeze({ bird: 'swan', route: 'river', count: 2 }),
        Object.freeze({ bird: 'crane', route: 'high', count: 5 }),
        Object.freeze({ bird: 'swan', route: 'rim', count: 3 }),
        Object.freeze({ bird: 'crane', route: 'rim', count: 3 }),
    ]),
});

const hash01 = (n, salt) => {
    const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
};

/** When the clock's visit number k sets out (s), and what it is. */
export function visitAt(k) {
    const n = Math.max(0, Math.floor(k));
    return {
        at: VISITS.first + n * VISITS.gap + (hash01(n, 1) * 2 - 1) * VISITS.jitter,
        ...VISITS.kinds[Math.floor(hash01(n, 2) * VISITS.kinds.length) % VISITS.kinds.length],
    };
}

// ── The routes as walked curves ───────────────────────────────────────────────────

function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return p1.map((_, c) => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t
        + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
}

/** A route's curve sampled every `step` metres or so, with the arc length to each sample. */
export function walkRoute(points, step = 3) {
    const samples = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        const span = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
        const n = Math.max(2, Math.ceil(span / step));
        for (let k = 0; k < n; k++) samples.push(catmull(p0, p1, p2, p3, k / n));
    }
    samples.push([...points[points.length - 1]]);
    const along = new Float32Array(samples.length);
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        along[i] = along[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    return { samples, along, length: along[along.length - 1] };
}

/**
 * The point `s` metres along a walked route, into `out` (x, y, z); before its start and past its
 * end the route runs on straight, so a formation's last birds have somewhere to be.
 */
export function routePoint(route, s, out) {
    const { samples, along, length } = route;
    const last = samples.length - 1;
    if (s <= 0 || s >= length) {
        const a = s <= 0 ? samples[0] : samples[last - 1];
        const b = s <= 0 ? samples[1] : samples[last];
        const span = (s <= 0 ? along[1] : length - along[last - 1]) || 1;
        const k = s <= 0 ? s / span : 1 + (s - length) / span;
        for (let c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * k;
        return out;
    }
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (along[mid] <= s) lo = mid;
        else hi = mid;
    }
    const k = (s - along[lo]) / Math.max(1e-6, along[hi] - along[lo]);
    for (let c = 0; c < 3; c++) out[c] = samples[lo][c] + (samples[hi][c] - samples[lo][c]) * k;
    return out;
}

// ── The birds ─────────────────────────────────────────────────────────────────────

/**
 * One bird (unit wingspan; x across, y up, z the way it flies). `aWing` is the wing's side (−1 the
 * left, +1 the right, 0 the body) times how far out along the wing the vertex stands, from 0 at
 * the shoulder to 1 at the tip. `color` is its plumage.
 */
export function birdGeometry(kind = BIRDS.swan) {
    const {
        swan, length: len, girth, neck, shoulder,
    } = birdBuild(kind);
    const position = [];
    const wing = [];
    const colour = [];
    const index = [];
    const vertex = (p, tone, w = 0) => {
        position.push(p[0], p[1], p[2]);
        wing.push(w);
        colour.push(tone[0], tone[1], tone[2]);
        return position.length / 3 - 1;
    };
    const quad = (a, b, c, d) => index.push(a, b, c, a, c, d);
    const WHITE = [0.8, 0.8, 0.77];
    const GREY = [0.36, 0.37, 0.4];
    const DARK = [0.035, 0.035, 0.04];
    const body = swan ? WHITE : GREY;
    /** A tube of rings round a spine: [z, y, radius across, radius up, tone]. */
    const tube = (rings, sides) => {
        const start = position.length / 3;
        for (const [z, y, rx, ry, tone] of rings) {
            for (let k = 0; k < sides; k++) {
                const a = (k / sides) * TAU;
                vertex([Math.cos(a) * rx, y + Math.sin(a) * ry, z], tone);
            }
        }
        for (let r = 0; r < rings.length - 1; r++) {
            for (let k = 0; k < sides; k++) {
                const a = start + r * sides + k;
                const b = start + r * sides + ((k + 1) % sides);
                quad(a, a + sides, b + sides, b);
            }
        }
    };
    // The body, tail to chest, running on into the neck, the head and the bill.
    const z0 = -len * 0.55;
    const chest = len * 0.45;
    tube([
        [z0 - 0.045, 0.004, 0.004, 0.003, body],
        [z0, 0.0, girth * 0.42, girth * 0.3, body],
        [z0 + len * 0.3, -0.004, girth * 0.95, girth * 0.82, body],
        [z0 + len * 0.62, -0.006, girth, girth * 0.92, body],
        [chest, 0.0, girth * 0.72, girth * 0.7, body],
        [chest + neck * 0.14, 0.006, girth * 0.3, girth * 0.3, body],
        [chest + neck * 0.55, 0.012, girth * 0.2, girth * 0.2, swan ? body : DARK],
        [chest + neck * 0.9, 0.014, girth * 0.2, girth * 0.2, swan ? body : [0.78, 0.78, 0.76]],
        [chest + neck, 0.016, girth * 0.3, girth * 0.27, swan ? body : DARK],
        [chest + neck + 0.022, 0.012, girth * 0.19, girth * 0.16, swan ? [0.92, 0.66, 0.08] : [0.42, 0.4, 0.3]],
        [chest + neck + 0.058, 0.006, 0.002, 0.002, swan ? DARK : [0.42, 0.4, 0.3]],
    ], 6);
    // A crane trails its legs out behind it.
    if (!swan) {
        tube([
            [z0 - 0.02, -0.012, 0.007, 0.006, DARK],
            [z0 - 0.17, -0.004, 0.005, 0.004, DARK],
            [z0 - 0.26, 0.0, 0.007, 0.003, DARK],
        ], 4);
    }
    // The wings: five stations out from the shoulder, the leading edge, the middle (a little
    // cambered) and the trailing edge at each; the tips taper (a swan's) or stay broad and
    // dark-fingered (a crane's).
    const stations = [0, 0.16, 0.32, WINGBEAT.wrist, 0.62, 0.82, 1];
    const chord0 = swan ? 0.17 : 0.2;
    for (const side of [-1, 1]) {
        const start = position.length / 3;
        for (const t of stations) {
            const x = side * (shoulder + t * (0.5 - shoulder));
            const taper = swan
                ? 1 - 0.18 * t - (0.62 * Math.max(0, t - 0.7)) / 0.3
                : 1 - 0.1 * t - (0.3 * Math.max(0, t - 0.82)) / 0.18;
            const chord = chord0 * Math.max(0.12, taper);
            // The leading edge runs forward to the wrist and sweeps back along the hand.
            const lead = len * 0.2 + 0.03 * Math.sin(Math.min(1, t / WINGBEAT.wrist) * Math.PI * 0.5)
                - 0.07 * Math.max(0, t - WINGBEAT.wrist);
            const tone = !swan && t > 0.6 ? DARK : body;
            const rear = !swan && t > 0.3 ? DARK : body;
            vertex([x, 0.012, lead], tone, side * t);
            vertex([x, 0.02 - 0.008 * t, lead - chord * 0.45], tone, side * t);
            vertex([x, 0.008, lead - chord], rear, side * t);
        }
        for (let s = 0; s < stations.length - 1; s++) {
            for (let c = 0; c < 2; c++) {
                const a = start + s * 3 + c;
                if (side > 0) quad(a, a + 3, a + 4, a + 1);
                else quad(a, a + 1, a + 4, a + 3);
            }
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
}

export class Flights {
    constructor(u, { slots = 3, seed = 0xb1d5 } = {}) {
        this.u = u;
        this.random = mulberry32(seed);
        this.per = FLIGHT_MOST;
        this.slots = Array.from({ length: slots }, () => ({
            kind: null, born: -1e6, phase: 0, route: 'rim', count: 0,
        }));
        this.cursor = 0;
        this.routes = Object.fromEntries(Object.entries(ROUTES).map(([name, points]) => [name, walkRoute(points)]));
        this.meshes = KINDS.map((kind) => {
            const geometry = birdGeometry(kind);
            const count = this.per * slots;
            // Where the bird is and its wingbeat's phase; which way it flies and its size; which
            // way is up for it (banked into its turn).
            const live = (size) => new THREE.InstancedBufferAttribute(new Float32Array(count * size), size)
                .setUsage(THREE.DynamicDrawUsage);
            const place = live(4);
            const heading = live(4);
            const zenith = live(3);
            geometry.setAttribute('aPlace', place);
            geometry.setAttribute('aHeading', heading);
            geometry.setAttribute('aZenith', zenith);
            geometry.instanceCount = count;
            const mesh = new THREE.Mesh(geometry, this.createMaterial(kind));
            mesh.name = `SpringFlight ${kind === BIRDS.swan ? 'swans' : 'cranes'}`;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            mesh.renderOrder = 12;
            mesh.userData.kind = kind;
            mesh.userData.attributes = { place, heading, zenith };
            return mesh;
        });
        this._p = [0, 0, 0];
        this._a = [0, 0, 0];
        this._b = [0, 0, 0];
        this.clear();
    }

    createMaterial(kind) {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'SpringFlight';
        const { shoulder } = birdBuild(kind);
        const wing = attribute('aWing', 'float');
        const place = attribute('aPlace', 'vec4');
        const heading = attribute('aHeading', 'vec4');
        const zenith = attribute('aZenith', 'vec3');
        const vWorld = varying(vec3(0.0), 'spBirdWorld');
        const vNormal = varying(vec3(0.0, 1.0, 0.0), 'spBirdNormal');
        const vTone = varying(vec4(0.0), 'spBirdTone'); // plumage rgb, how far out the wing
        material.vertexNode = Fn(() => {
            const scale = heading.w;
            const fwd = normalize(heading.xyz);
            const right = normalize(cross(zenith, fwd));
            const up = cross(fwd, right);
            // The wingbeat: the arm about the shoulder, the hand about the wrist a little behind it.
            const beat = u.time.mul(kind.beat * TAU).add(place.w.mul(TAU)).toVar();
            const side = sign(wing);
            const out = abs(wing).toVar();
            const arm = sin(beat).mul(WINGBEAT.arm).add(WINGBEAT.lift).toVar();
            const hand = arm.add(sin(beat.sub(WINGBEAT.lag)).mul(WINGBEAT.hand)).toVar();
            // (How far out from the shoulder the vertex stands at rest, in wingspans.)
            const reach = out.mul(0.5 - shoulder);
            const wrist = (0.5 - shoulder) * WINGBEAT.wrist;
            const inner = min(reach, wrist);
            const outer = max(reach.sub(wrist), 0.0);
            const flapX = cos(arm).mul(inner).add(cos(hand).mul(outer));
            const flapY = sin(arm).mul(inner).add(sin(hand).mul(outer));
            const onWing = out.greaterThan(0.0);
            const bob = sin(beat).mul(-WINGBEAT.bob);
            const local = vec3(
                onWing.select(side.mul(flapX.add(shoulder)), positionGeometry.x),
                positionGeometry.y.add(onWing.select(flapY, float(0.0))).add(bob),
                positionGeometry.z,
            );
            const stood = right.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z));
            const world = place.xyz.add(stood.mul(scale)).toVar();
            // A wing's face turns with its stroke; the body keeps its own normals.
            const tilt = out.greaterThan(WINGBEAT.wrist).select(hand, arm);
            const n = attribute('normal', 'vec3');
            const nLocal = onWing.select(vec3(side.mul(sin(tilt)).negate(), cos(tilt), 0.0), n);
            vNormal.assign(right.mul(nLocal.x).add(up.mul(nLocal.y)).add(fwd.mul(nLocal.z)));
            vWorld.assign(world);
            vTone.assign(vec4(attribute('color', 'vec3'), out));
            // A bird not out is clipped away whole (its size is 0).
            return scale.greaterThan(0.0)
                .select(cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0))), vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = Fn(() => {
            const P = vWorld;
            const N = normalize(vNormal);
            const L = u.sunDir;
            const albedo = vTone.xyz;
            const sun = u.sun.mul(sunShare(u, P));
            // Feathers scatter: a wide wrap, either face of a wing.
            const wrap = clamp(dot(N, L).abs().mul(0.7).add(0.2), 0.0, 1.0);
            const sky = u.fill.mul(N.y.mul(0.35).add(1.0)).add(u.bounce.mul(float(0.5).sub(N.y.mul(0.5))));
            // Seen against the light, the wings glow through toward their tips.
            const V = normalize(P.sub(u.eye));
            const back = clamp(dot(V, L), 0.0, 1.0);
            const through = back.mul(back).mul(vTone.w).mul(0.16);
            const lit = albedo.mul(sun.mul(wrap.mul(0.6)).add(sky.mul(1.25))).add(albedo.mul(sun).mul(through));
            return vec4(aerial(u, P, lit), 1.0);
        })();
        return material;
    }

    clear() {
        for (const slot of this.slots) {
            slot.kind = null;
            slot.born = -1e6;
        }
        for (const mesh of this.meshes) {
            const { heading } = mesh.userData.attributes;
            heading.array.fill(0);
            heading.needsUpdate = true;
        }
        this.live = this.meshes.map(() => 0);
        this.drawn = false;
    }

    /**
     * A flight sets out at time t: `kind` 'swan' or 'crane', along `route` (ROUTES; the kind's own
     * by default), `count` birds (the kind's own). It takes a free slot, else the one furthest
     * along its way (a flight never erases one still crossing the valley while a slot is free).
     */
    launch(kind, time, { route = null, count = null } = {}) {
        let pick = -1;
        for (let k = 0; k < this.slots.length; k++) {
            const i = (this.cursor + k) % this.slots.length;
            if (!this.slots[i].kind) {
                pick = i;
                break;
            }
            if (pick < 0 || this.slots[i].born < this.slots[pick].born) pick = i;
        }
        const slot = this.slots[pick];
        this.cursor = (pick + 1) % this.slots.length;
        slot.kind = BIRDS[kind] || BIRDS.swan;
        const own = slot.kind === BIRDS.swan ? 'river' : 'high';
        slot.route = this.routes[route] ? route : own;
        slot.count = clampJs(Math.round(count ?? slot.kind.count), 1, this.per);
        slot.born = time;
        slot.phase = this.random();
        return slot;
    }

    /** How far along its way a flight is at an age (m). */
    flown(kind, age) {
        return age * kind.speed;
    }

    /** How far behind its leader bird b of a flight flies (m) and how far out to a side (signed m). */
    station(kind, b) {
        const rank = Math.ceil(b / 2);
        let side = 0;
        if (b > 0) side = b % 2 ? -1 : 1;
        return { back: rank * kind.back, out: side * rank * kind.out };
    }

    update(time) {
        // No flight out and none drawn last frame: every bird is already clipped away.
        if (!this.drawn && !this.slots.some((slot) => slot.kind)) return;
        const live = this.meshes.map(() => 0);
        for (const mesh of this.meshes) mesh.userData.attributes.heading.array.fill(0);
        this.slots.forEach((slot, s) => {
            if (!slot.kind) return;
            const { kind } = slot;
            const route = this.routes[slot.route];
            const age = time - slot.born;
            const deepest = this.station(kind, slot.count - 1).back;
            const lead = this.flown(kind, age);
            // Over when its last bird has flown the route out.
            if (age < 0 || lead - deepest > route.length + 20) {
                slot.kind = null;
                return;
            }
            const mesh = this.meshes[kind.id];
            const { place, heading, zenith } = mesh.userData.attributes;
            const p = this._p;
            const a = this._a;
            const b = this._b;
            for (let n = 0; n < slot.count; n++) {
                const { back, out } = this.station(kind, n);
                const at = lead - back;
                routePoint(route, at, p);
                routePoint(route, at - 4, a);
                routePoint(route, at + 4, b);
                let fx = b[0] - a[0];
                let fy = b[1] - a[1];
                let fz = b[2] - a[2];
                const fl = Math.hypot(fx, fy, fz) || 1;
                fx /= fl;
                fy /= fl;
                fz /= fl;
                // Level across the way it flies.
                const rl = Math.hypot(fx, fz) || 1;
                const rx = fz / rl;
                const rz = -fx / rl;
                // How hard the route turns here banks the bird into the turn.
                const turn = ((b[0] - p[0]) * (p[2] - a[2]) - (b[2] - p[2]) * (p[0] - a[0])) / 16;
                const bank = clampJs(turn * kind.speed * kind.speed * 0.012, -0.55, 0.55);
                const drift = Math.sin(time * 0.7 + n * 1.9 + slot.phase * 6) * 0.45;
                const i = s * this.per + n;
                place.array[i * 4] = p[0] - rx * out;
                place.array[i * 4 + 1] = p[1] + drift + Math.abs(out) * 0.06;
                place.array[i * 4 + 2] = p[2] - rz * out;
                place.array[i * 4 + 3] = (slot.phase + n * 0.137) % 1;
                heading.array[i * 4] = fx;
                heading.array[i * 4 + 1] = fy;
                heading.array[i * 4 + 2] = fz;
                heading.array[i * 4 + 3] = kind.span * kind.drawn * (0.94 + ((n * 37) % 10) * 0.012);
                zenith.array[i * 3] = rx * Math.sin(bank);
                zenith.array[i * 3 + 1] = Math.cos(bank);
                zenith.array[i * 3 + 2] = rz * Math.sin(bank);
            }
            live[kind.id] += slot.count;
            place.needsUpdate = true;
            zenith.needsUpdate = true;
        });
        for (const mesh of this.meshes) mesh.userData.attributes.heading.needsUpdate = true;
        this.live = live;
        this.drawn = live.some((n) => n > 0);
    }

    dispose() {
        for (const mesh of this.meshes) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
    }
}
