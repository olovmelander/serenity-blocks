/**
 * Spring — fish in the river: Atlantic salmon leaping at the fall and up the rapids' ledges, and
 * brown trout jumping in the quieter water of the pool's tail and the runs below the bend.
 *
 *   salmon  steel-blue back, mirror-silver flanks, white belly: in the plunge pool they leap high
 *           toward the falling water and drop back, often turning onto their side; at a ledge
 *           they leap up the step out of the pool below its chute
 *   trout   olive back, golden flanks: short quick jumps in the calmer water, the tail working,
 *           sometimes flopping back sideways
 *
 * Each lane of the river has its own leaps by the clock (LANES, leapAt): a pure function of the
 * time, so any moment shows the same fish in the air. The heat of play brings the salmon run on:
 * more salmon leap at the fall and up the ledges (Fish.update's `run`).
 *
 * A leap is an arc of the fish's middle from under the surface to under it again: `height` metres
 * over the line between the water's level where it leaves and where it falls back, flown in
 * T = sqrt(8 · height / g) at real gravity, the nose along the flight. Its middle starts just deep
 * enough that the nose breaks the surface first, and the water (drawn before it, depth-tested)
 * hides whatever of it is still under. Through the leap it curls and rolls; the tail beats.
 *
 * Everywhere the river is in sight it runs nearly along the line of sight (toward the eye down the
 * rapids, away from it below the bend), so a fish leaping straight up or down it would be seen end
 * on: the leaps head well off the stream's line, and the fish are drawn larger than life (as the
 * birds are), or fifty metres off a trout is a few pixels.
 *
 * The fish are modelled in Blender (scripts/blender/spring_fish.py writes spring-fish-hulls.js):
 * a salmon and a brown trout, each a lofted body with its fins and eyes, and per vertex how far
 * along the fish it is, how far up its side, how free (a fin's edge) and what it is (body, fin,
 * eye). Both hulls are one geometry and one instanced mesh: each fish keeps its own kind's hull
 * and folds the other away. Per fish, four rows the CPU writes while any is in the air (one
 * interleaved buffer): where its middle is and the tail's phase; which way its nose points and
 * its drawn length (0: no fish); which way its back faces and its kind; its curl and the tail's
 * stroke. The vertex stage bends the body, beats the tail and trails the fins; the fragment shades
 * a wet, countershaded skin whose flank catches the sky and flashes in the sun, the salmon's few
 * black spots and the trout's many, red among them, the eye, the jaw and the gill cover.
 *
 * Where a fish breaks the water, leaving and falling back, a ring of foam spreads and drifts off
 * on the current (a second instanced mesh, light that adds: each ring written once, as its leap
 * leaves the water, and moved in closed form on the clock). From the knoll the ring and the
 * splash are what catch the eye first.
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
    exp,
    float,
    floor,
    fract,
    length,
    mix,
    normalize,
    positionGeometry,
    reflect,
    sin,
    smoothstep,
    sqrt,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { TAU, clamp as clampJs, mulberry32 } from './spring-core.js';
import { SPRING_FISH_HULLS } from './spring-fish-hulls.js';
import {
    aerial, airClarity, skyColour, sunShare,
} from './spring-light.js';
import {
    LEDGES, LEDGE_LENGTH, S_OUTLET, S_POOL, courseAt, levelAt, speedAt,
} from './spring-plan.js';

export const GRAVITY = 9.81;

/**
 * The kinds: real length (m, least … most), how often a big one leaps (the length's share is a
 * 0..1 draw to this power: under 1 favours the big), how much larger than life they are drawn
 * (fifty metres off, a trout is a few pixels), the tail's beats a second in the air and its stroke
 * (share of the length, at the tip). Each kind's build is its hull's (spring-fish-hulls.js).
 */
export const FISH = Object.freeze({
    salmon: Object.freeze({
        id: 0, length: Object.freeze([0.65, 1.05]), big: 0.8, drawn: 1.6, beat: 4.2, stroke: 0.1,
    }),
    trout: Object.freeze({
        id: 1, length: Object.freeze([0.32, 0.55]), big: 1.3, drawn: 1.6, beat: 6.5, stroke: 0.09,
    }),
});
const KIND_BY_ID = Object.freeze([FISH.salmon, FISH.trout]);

/**
 * The ledges salmon leap up (by their place in LEDGES), each with how far across the river they
 * leap there (a share of the half-width, the far bank −, the near +) and how often (`weight`, the
 * nearer more): those in sight beside the board, kept clear of the lens's edges and of the board's
 * card (the one under the knoll is not in sight at all; below the bend the near bank is out of
 * the lens).
 */
export const LEAP_LEDGES = Object.freeze([
    Object.freeze({ ledge: 0, across: Object.freeze([-0.7, 0.4]), weight: 1 }),
    Object.freeze({ ledge: 1, across: Object.freeze([-0.7, 0.35]), weight: 1 }),
    Object.freeze({ ledge: 2, across: Object.freeze([-0.7, 0.3]), weight: 1 }),
    Object.freeze({ ledge: 3, across: Object.freeze([-0.6, 0.3]), weight: 1.5 }),
    Object.freeze({ ledge: 4, across: Object.freeze([0.05, 0.5]), weight: 2 }),
    Object.freeze({ ledge: 6, across: Object.freeze([-0.7, 0.05]), weight: 1.5 }),
    Object.freeze({ ledge: 7, across: Object.freeze([-0.7, 0.1]), weight: 0.6 }),
]);

/**
 * The lanes fish leap in by the clock. Each: its kind; a leap about every `gap` seconds (`jitter`
 * either way, the first `first` seconds in); the reaches it leaps in (metres along the river,
 * `from` … `to`, and `across` the river, a share of the half-width from the far bank, −, to the
 * near, +: one reach is picked by its `weight`, the nearer more often, then a place in it; below
 * the bend the near bank is out of the lens); how high (m over the water) and how fast over it (m/s), least … most; how far off
 * straight upstream it heads (rad, least … most, to either side: toward mid-river when it leaves
 * near a bank); how far it may roll over (rad) and curl (share of its length the tips stand off
 * the middle's line).
 *   fall    salmon in the plunge pool, leaping toward the falling water (past the thickest of
 *           its boil and mist, which would hide them)
 *   ledges  salmon leaping up the rapids' steps, out of the pool at each chute's foot
 *   runs    trout in the pool's tail and the calmer runs below the bend, jumping across the stream
 */
const reach = (from, to, across, weight = 1) => Object.freeze({
    from, to, across: Object.freeze(across), weight,
});

export const LANES = Object.freeze([
    Object.freeze({
        name: 'fall',
        kind: 'salmon',
        first: 6,
        gap: 13,
        jitter: 5,
        reaches: Object.freeze([reach(S_POOL + 9, S_POOL + 20, [-0.6, 0.6])]),
        height: Object.freeze([1.5, 2.7]),
        speed: Object.freeze([1.0, 2.2]),
        heading: Object.freeze([0.35, 1.0]),
        roll: 1.5,
        curl: 0.08,
    }),
    Object.freeze({
        name: 'ledges',
        kind: 'salmon',
        first: 9,
        gap: 15,
        jitter: 6,
        reaches: Object.freeze(LEAP_LEDGES.map(({ ledge, across, weight }) => {
            const foot = S_OUTLET + LEDGES[ledge].at + LEDGE_LENGTH * 0.5;
            return reach(foot + 0.5, foot + 3.5, across, weight);
        })),
        height: Object.freeze([0.8, 1.5]),
        speed: Object.freeze([2.4, 3.8]),
        heading: Object.freeze([0.3, 0.75]),
        roll: 0.6,
        curl: 0.06,
    }),
    Object.freeze({
        name: 'runs',
        kind: 'trout',
        first: 4,
        gap: 7,
        jitter: 3,
        reaches: Object.freeze([
            reach(S_POOL + 12, S_OUTLET - 5, [-0.6, 0.45], 1),
            reach(S_OUTLET + 74, S_OUTLET + 94, [-0.45, 0.02], 2),
            reach(S_OUTLET + 108, S_OUTLET + 146, [-0.75, 0.02], 1),
        ]),
        height: Object.freeze([0.3, 0.7]),
        speed: Object.freeze([0.8, 2.0]),
        heading: Object.freeze([0.5, Math.PI - 0.5]),
        roll: 1.6,
        curl: 0.12,
    }),
]);
export const LANE_INDEX = Object.freeze(Object.fromEntries(LANES.map((lane, k) => [lane.name, k])));

/** The longest any leap is in the air (s). */
export const LONGEST = Math.sqrt((8 * Math.max(...LANES.map((lane) => lane.height[1]))) / GRAVITY);

const hash01 = (n, salt) => {
    const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
};
const between = (range, f) => range[0] + (range[1] - range[0]) * f;

/**
 * Shape a leap of `lane` from a source of 0..1 numbers `rnd(salt)`: where it leaves the water and
 * which way it heads, how big the fish is, how high and far it flies, how it rolls and curls.
 */
function shapeLeap(out, laneIndex, rnd) {
    const lane = LANES[laneIndex];
    const kind = FISH[lane.kind];
    let pick = rnd(3) * lane.reaches.reduce((sum, candidate) => sum + candidate.weight, 0);
    let where = lane.reaches[lane.reaches.length - 1];
    for (const candidate of lane.reaches) {
        pick -= candidate.weight;
        if (pick < 0) {
            where = candidate;
            break;
        }
    }
    out.lane = laneIndex;
    out.kind = kind.id;
    out.length = between(kind.length, rnd(4) ** kind.big) * kind.drawn;
    out.s0 = where.from + (where.to - where.from) * rnd(5);
    courseAt(out.s0, out.course || (out.course = {}));
    out.n0 = between(where.across, rnd(6)) * out.course.halfWidth;
    out.height = between(lane.height, rnd(7));
    out.T = Math.sqrt((8 * out.height) / GRAVITY);
    out.speed = between(lane.speed, rnd(8));
    // Toward mid-river from near a bank; else either way.
    let side = rnd(15) < 0.5 ? -1 : 1;
    if (Math.abs(out.n0) > 0.35 * out.course.halfWidth) side = -Math.sign(out.n0);
    out.yaw = side * between(lane.heading, rnd(9));
    // (Upstream is −s; the yaw turns it toward +n or −n.)
    out.ds = -Math.cos(out.yaw) * out.speed;
    out.dn = Math.sin(out.yaw) * out.speed;
    out.s1 = out.s0 + out.ds * out.T;
    out.n1 = out.n0 + out.dn * out.T;
    out.level0 = levelAt(out.s0);
    out.level1 = levelAt(out.s1);
    // Rolls toward its side through the second half (a salmon falling back, a trout flopping).
    out.roll = (rnd(10) < 0.5 ? -1 : 1) * lane.roll * rnd(11) ** 1.5;
    out.curl = (rnd(12) * 2 - 1) * lane.curl;
    out.phase = rnd(13) * TAU;
    out.seed = Math.floor(rnd(14) * 0x7fffffff);
    // How deep its middle starts: deep enough that the nose breaks the surface first.
    const rise = (4 * out.height) / out.T + (out.level1 - out.level0) / out.T;
    out.sink = 0.5 * out.length * (rise / Math.hypot(rise, out.speed)) + 0.03;
    return out;
}

/** Lane `lane`'s k-th leap by the clock: when it leaves the water (s), and its shape. */
export function leapAt(lane, k, out = {}) {
    const index = clampJs(Math.round(lane), 0, LANES.length - 1);
    const L = LANES[index];
    const n = Math.max(0, Math.floor(k));
    const rnd = (salt) => hash01(n * 7 + index * 101 + 13, salt);
    out.k = n;
    out.at = L.first + n * L.gap + (rnd(1) * 2 - 1) * L.jitter;
    out.clock = true;
    return shapeLeap(out, index, rnd);
}

/** The first of a lane's leaps not yet back in the water at `time`. */
export function firstLeapAfter(lane, time) {
    const L = LANES[lane];
    let k = Math.max(0, Math.floor((time - L.first - L.jitter - LONGEST) / L.gap) - 1);
    const leap = {};
    while (leapAt(lane, k, leap).at + leap.T <= time) k += 1;
    return k;
}

/**
 * Where a leap is at `age` seconds into its flight, into `out`: its middle (x, y, z), its nose's
 * heading (fx, fy, fz) and its back's (ux, uy, uz), rolled. `flood` lifts the river.
 */
export function leapPose(leap, age, flood = 0, out = {}) {
    const t = clampJs(age, 0, leap.T);
    const p = t / leap.T;
    const s = leap.s0 + leap.ds * t;
    const n = leap.n0 + leap.dn * t;
    const c = courseAt(s, out.course || (out.course = {}));
    out.x = c.x - c.tz * n;
    out.z = c.z + c.tx * n;
    out.y = leap.level0 + (leap.level1 - leap.level0) * p + flood - leap.sink + 4 * leap.height * p * (1 - p);
    // Its velocity: over the water along its heading, and up (the arc, and the step it leaps).
    const hx = c.tx * leap.ds - c.tz * leap.dn;
    const hz = c.tz * leap.ds + c.tx * leap.dn;
    const vy = (leap.level1 - leap.level0) / leap.T + (4 * leap.height * (1 - 2 * p)) / leap.T;
    const v = Math.hypot(hx, vy, hz) || 1;
    out.fx = hx / v;
    out.fy = vy / v;
    out.fz = hz / v;
    // Its right, level (from its heading over the water), and its back: up from the nose.
    const h = Math.hypot(hx, hz) || 1;
    const rx = -hz / h;
    const rz = hx / h;
    // back = right × forward
    let ux = -rz * out.fy;
    let uy = rz * out.fx - rx * out.fz;
    let uz = rx * out.fy;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    // Rolled about its nose through the second half of the flight.
    const roll = leap.roll * smoothJs(0.3, 1, p);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    out.ux = ux * cr + rx * sr;
    out.uy = uy * cr;
    out.uz = uz * cr + rz * sr;
    // It curls most at the top of the leap; the tail beats from its own phase.
    out.curl = leap.curl * Math.sin(Math.PI * p);
    out.tail = (leap.phase + KIND_BY_ID[leap.kind].beat * TAU * t) % TAU;
    return out;
}

function smoothJs(lo, hi, v) {
    const t = clampJs((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
}

// ── The fish ──────────────────────────────────────────────────────────────────────

/** What a hull's vertex is (`code` = hull × 4 + region; spring_fish.py). */
export const REGION = Object.freeze({
    body: 0, fin: 1, eye: 2, paleFin: 3,
});
/** The hulls, in kind order (a fish's kind is its hull). */
export const HULL_NAMES = Object.freeze(['salmon', 'trout']);

const decodeBase64 = (text) => {
    const bytes = typeof atob === 'function'
        ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
        : Uint8Array.from(Buffer.from(text, 'base64'));
    return bytes.buffer;
};

/** One hull's arrays, decoded from the generated module. */
export function decodeFishHull(name) {
    const h = SPRING_FISH_HULLS[name];
    return {
        hull: h.hull,
        vertexCount: h.vertexCount,
        triangleCount: h.triangleCount,
        bodyTriangleCount: h.bodyTriangleCount,
        positions: new Float32Array(decodeBase64(h.positions)),
        normals: new Float32Array(decodeBase64(h.normals)),
        parts: new Float32Array(decodeBase64(h.parts)),
        index: new Uint16Array(decodeBase64(h.index)),
    };
}

/**
 * Both fish in one indexed, instanced geometry (the salmon's vertices first): position, normal
 * and `aFishPart` (s along the fish 0 nose … 1 tail tips, d dorsal share 0 belly … 1 back, flex 0
 * root … 1 a fin's free edge, code = hull × 4 + region). One fish long, nose +z, back +y.
 */
export function fishGeometry() {
    const hulls = HULL_NAMES.map((name) => decodeFishHull(name));
    const vertices = hulls.reduce((n, h) => n + h.vertexCount, 0);
    const triangles = hulls.reduce((n, h) => n + h.triangleCount, 0);
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const part = new Float32Array(vertices * 4);
    const index = new Uint16Array(triangles * 3);
    let v = 0;
    let t = 0;
    for (const h of hulls) {
        position.set(h.positions, v * 3);
        normal.set(h.normals, v * 3);
        part.set(h.parts, v * 4);
        for (let i = 0; i < h.index.length; i++) index[t * 3 + i] = h.index[i] + v;
        v += h.vertexCount;
        t += h.triangleCount;
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aFishPart', new THREE.BufferAttribute(part, 4));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
}

/**
 * Round spots on a jittered grid over the skin's (s, d): `cells` across the fish's length and
 * round its side (about square cells on the flank), a spot in a share `fill` of the cells, of
 * radius `size` (a share of a cell, at most a quarter, so no spot reaches its cell's edge). Inline
 * TSL; s and d come in non-negative, so each cell is an exact integer pair for the hash.
 */
function spotField(s, d, cells, fill, size, salt) {
    const at = vec2(s.mul(cells[0]), d.mul(cells[1]));
    const cell = floor(at);
    const h1 = fract(sin(dot(cell, vec2(12.9898, 78.233)).add(salt)).mul(43758.5453));
    const h2 = fract(sin(dot(cell, vec2(39.3468, 11.135)).add(salt)).mul(24634.6345));
    const h3 = fract(sin(dot(cell, vec2(73.156, 52.235)).add(salt)).mul(13758.937));
    const centre = cell.add(vec2(h2, h3).mul(0.5).add(0.25));
    const r = length(at.sub(centre));
    return step(h1, fill).mul(float(1.0).sub(smoothstep(size * 0.7, size, r))).toVar();
}

/** Floats a fish's instance record holds (four vec4 rows). */
export const FISH_STRIDE = 16;

/**
 * The ring of foam where a fish breaks the water: its widest (m, a share of the fish's drawn
 * length, and at least `least`), its life (s), how much more a fall back throws than a leaving,
 * how fast it drifts off against the current's speed, and how far over the water's level it lies
 * (m, so the surface's own small waves do not swallow it).
 */
export const RING = Object.freeze({
    widest: 1.6, least: 0.9, life: 2.2, fallBack: 1.35, drift: 0.8, lift: 0.07,
});
/** Floats a ring's instance record holds (two vec4 rows: where and when; its drift, size, life). */
export const RING_STRIDE = 8;

export class Fish {
    /**
     * @param {object} u  the world's uniforms
     * @param {object} [options]
     * @param {number} [options.count]   fish in the air at once (the tier's)
     * @param {Function} [options.onLeap]  called with each leap as it leaves the water (its splash)
     */
    constructor(u, { count = 6, onLeap = null, seed = 0xf15e } = {}) {
        this.u = u;
        this.count = Math.max(1, Math.round(count));
        this.onLeap = onLeap;
        this.seed = seed;
        this.data = new Float32Array(this.count * FISH_STRIDE);
        this.geometry = fishGeometry();
        const buffer = new THREE.InstancedInterleavedBuffer(this.data, FISH_STRIDE, 1);
        buffer.setUsage(THREE.DynamicDrawUsage);
        this.buffer = buffer;
        this.geometry.setAttribute('aFishPlace', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
        this.geometry.setAttribute('aFishAxis', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
        this.geometry.setAttribute('aFishBack', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
        this.geometry.setAttribute('aFishFlex', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
        this.geometry.instanceCount = this.count;
        this.material = this.createMaterial();
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = 'SpringFish';
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        // A solid, after the river it leaps out of (the water hides what of it is still under).
        this.mesh.renderOrder = 5;
        // The rings: two a leap (leaving, falling back), and room for the next leap's.
        this.ringCount = this.count * 2 + 2;
        this.ringData = new Float32Array(this.ringCount * RING_STRIDE);
        const ringGeometry = new THREE.InstancedBufferGeometry();
        ringGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1,
        ], 3));
        ringGeometry.setIndex([0, 2, 1, 1, 2, 3]);
        const ringBuffer = new THREE.InstancedInterleavedBuffer(this.ringData, RING_STRIDE, 1);
        ringBuffer.setUsage(THREE.DynamicDrawUsage);
        this.ringBuffer = ringBuffer;
        ringGeometry.setAttribute('aRingA', new THREE.InterleavedBufferAttribute(ringBuffer, 4, 0));
        ringGeometry.setAttribute('aRingB', new THREE.InterleavedBufferAttribute(ringBuffer, 4, 4));
        ringGeometry.instanceCount = this.ringCount;
        this.rings = new THREE.Mesh(ringGeometry, this.createRingMaterial());
        this.rings.name = 'SpringFishRings';
        this.rings.frustumCulled = false;
        this.rings.matrixAutoUpdate = false;
        // Light on the water: after the solids, under the fall's mist and the motes.
        this.rings.renderOrder = 7;
        this.meshes = [this.mesh, this.rings];
        this._pose = {};
        this._leap = {};
        this.flood = 0;
        this.reset(0);
    }

    /** The rings' material: foam lit by the hour, added to the water, spreading and fading. */
    createRingMaterial() {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
        material.name = 'SpringFishRings';
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.premultipliedAlpha = true;
        material.fog = false;
        const A = attribute('aRingA', 'vec4');
        const B = attribute('aRingB', 'vec4');
        // Where on the ring's square (−1 … 1 of its widest) and how far through its life.
        const vRing = varying(vec3(0.0), 'spRingAt');
        const vWorld = varying(vec3(0.0), 'spRingWorld');
        material.vertexNode = Fn(() => {
            const age = u.time.sub(A.w).toVar();
            const life = B.w;
            const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
            const a = age.max(0.0);
            const p = positionGeometry;
            const centre = A.xyz.add(vec3(B.x, 0.0, B.y).mul(a));
            const world = centre.add(vec3(p.x, 0.0, p.z).mul(B.z)).toVar();
            vRing.assign(vec3(p.x, p.z, a.div(life)));
            vWorld.assign(world);
            const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
            return alive.select(clip, vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const P = vWorld;
            const r = length(vec2(vRing.x, vRing.y));
            const t = clamp(vRing.z, 0.0, 1.0);
            const f = float(1.0).sub(t);
            // The ring runs out fast and slows; it thins and fades as it widens.
            const radius = float(1.0).sub(f.mul(f)).mul(0.8).add(0.12);
            const width = t.mul(0.09).add(0.045);
            const d = r.sub(radius).div(width);
            const ring = exp(d.mul(d).negate()).mul(f.mul(f).mul(0.8).add(f.mul(0.2)));
            // The white boil where it broke, gone in the first part of the ring's life.
            const boil = exp(r.mul(r).mul(-12.0)).mul(float(1.0).sub(smoothstep(0.0, 0.35, t)));
            const edge = float(1.0).sub(smoothstep(0.86, 1.0, r));
            const foam = ring.mul(0.8).add(boil.mul(1.2)).mul(edge);
            const light = u.sun.mul(sunShare(u, P)).mul(0.3).add(u.fill.mul(1.3)).add(u.bounce.mul(0.25));
            return vec4(light.mul(foam).mul(airClarity(u, P)).mul(0.55), 0.0);
        })();
        return material;
    }

    createMaterial() {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'SpringFish';
        const place = attribute('aFishPlace', 'vec4');
        const axis = attribute('aFishAxis', 'vec4');
        const back = attribute('aFishBack', 'vec4');
        const motion = attribute('aFishFlex', 'vec4');
        const part = attribute('aFishPart', 'vec4');
        const vWorld = varying(vec3(0.0), 'spFishWorld');
        const vNormal = varying(vec3(0.0, 1.0, 0.0), 'spFishNormal');
        // How far along, how far up its side, how free, what it is (the hull's own parts).
        const vPart = varying(vec4(0.0), 'spFishPart');
        material.vertexNode = Fn(() => {
            const drawn = axis.w;
            const fwd = normalize(axis.xyz);
            const up = normalize(back.xyz);
            const right = cross(up, fwd);
            const kind = back.w;
            const s = part.x.toVar();
            const code = part.w;
            const hull = step(3.5, code);
            const region = code.sub(hull.mul(4.0));
            // Its own kind's hull; the other is folded away.
            const mine = abs(hull.sub(kind)).lessThan(0.5);
            const p = positionGeometry;
            // The tail's stroke: a wave running back down the body, growing toward the tail; and
            // the whole body curled (a C: both ends off the middle's line to one side).
            const wave = place.w.sub(s.mul(4.0)).toVar();
            const stroke = s.mul(s).mul(motion.y);
            // The fins trail: their free edges flutter behind the stroke (not the eyes' rims).
            const finning = abs(region.sub(REGION.eye)).greaterThan(0.5).select(part.z, float(0.0));
            const flutter = sin(place.w.mul(1.7).add(s.mul(9.0))).mul(finning).mul(0.012);
            const off = sin(wave).mul(stroke).add(motion.x.mul(p.z.mul(p.z).mul(4.0).sub(0.33))).add(flutter);
            // (Its slope along the body turns the skin's normals with the bend; s runs against z.)
            const slope = motion.x.mul(p.z).mul(8.0)
                .sub(motion.y.mul(s.mul(2.0).mul(sin(wave)).sub(s.mul(s).mul(4.0).mul(cos(wave)))));
            const local = vec3(p.x.add(off), p.y, p.z);
            const stood = right.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z));
            const world = place.xyz.add(stood.mul(drawn)).toVar();
            const n = attribute('normal', 'vec3');
            const bend = float(1.0).div(sqrt(slope.mul(slope).add(1.0)));
            const nLocal = vec3(n.x.add(n.z.mul(slope)).mul(bend), n.y, n.z.sub(n.x.mul(slope)).mul(bend));
            vNormal.assign(right.mul(nLocal.x).add(up.mul(nLocal.y)).add(fwd.mul(nLocal.z)));
            vWorld.assign(world);
            vPart.assign(part);
            // A fish not in the air is clipped away whole (its length is 0), and so is the hull
            // that is not its own.
            const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
            return drawn.greaterThan(0.0).and(mine).select(clip, vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = Fn(() => {
            const P = vWorld;
            const s = vPart.x;
            const d = vPart.y;
            const flex = vPart.z;
            const code = vPart.w;
            const kind = step(3.5, code).toVar();
            const region = code.sub(kind.mul(4.0)).toVar();
            const isFin = float(1.0).sub(step(0.5, abs(region.sub(REGION.fin)))).toVar();
            const isPale = float(1.0).sub(step(0.5, abs(region.sub(REGION.paleFin)))).toVar();
            const isEye = float(1.0).sub(step(0.5, abs(region.sub(REGION.eye)))).toVar();
            const anyFin = isFin.add(isPale).toVar();
            const isBody = float(1.0).sub(anyFin).sub(isEye).max(0.0)
                .toVar();
            const V = normalize(u.eye.sub(P)).toVar();
            const N0 = normalize(vNormal);
            // A fin's two faces light alike: turned toward the eye.
            const facing = dot(N0, V).greaterThanEqual(0.0).select(float(1.0), float(-1.0));
            const N = mix(N0, N0.mul(facing), anyFin).toVar();
            // Countershaded: dark on the back, the flank, pale on the belly.
            // (A salmon's silver is its mirror, not a pale skin: against the white water of the
            // fall and the rapids it reads dark, and flashes.)
            const onBack = smoothstep(0.58, 0.86, d).toVar();
            const onBelly = float(1.0).sub(smoothstep(0.2, 0.42, d)).toVar();
            const backTone = mix(vec3(0.018, 0.026, 0.036), vec3(0.04, 0.036, 0.016), kind);
            const flankTone = mix(vec3(0.2, 0.215, 0.23), vec3(0.25, 0.18, 0.065), kind);
            const bellyTone = mix(vec3(0.62, 0.62, 0.6), vec3(0.58, 0.5, 0.3), kind);
            const skin = mix(mix(flankTone, backTone, onBack), bellyTone, onBelly).toVar();
            // A salmon's few small black spots, above the lateral line toward the head and on the
            // gill cover; a trout's many, over its back and flanks, and red ones haloed in pale
            // round the lateral line.
            const salmonSpots = spotField(s, d, [40, 10], 0.28, 0.16, 3.1)
                .mul(smoothstep(0.56, 0.64, d)).mul(float(1.0).sub(smoothstep(0.58, 0.7, s)));
            const troutBlack = spotField(s, d, [32, 9], 0.55, 0.21, 7.3)
                .mul(smoothstep(0.4, 0.5, d)).mul(float(1.0).sub(smoothstep(0.8, 0.86, s)));
            const troutRed = spotField(s, d, [26, 8], 0.4, 0.15, 11.9)
                .mul(smoothstep(0.26, 0.32, d)).mul(float(1.0).sub(smoothstep(0.5, 0.56, d)))
                .mul(smoothstep(0.16, 0.22, s))
                .mul(float(1.0).sub(smoothstep(0.76, 0.82, s)));
            const troutHalo = spotField(s, d, [26, 8], 0.4, 0.23, 11.9)
                .mul(smoothstep(0.26, 0.32, d)).mul(float(1.0).sub(smoothstep(0.5, 0.56, d)))
                .mul(smoothstep(0.16, 0.22, s))
                .mul(float(1.0).sub(smoothstep(0.76, 0.82, s)));
            const black = mix(salmonSpots, troutBlack, kind).toVar();
            skin.assign(mix(skin, vec3(0.62, 0.56, 0.42), troutHalo.mul(kind).mul(0.7)));
            skin.assign(mix(skin, vec3(0.32, 0.04, 0.02), troutRed.mul(kind)));
            skin.assign(mix(skin, vec3(0.012, 0.01, 0.01), black.mul(0.92)));
            // The jaw's line back from the snout, and the gill cover's edge.
            const jawEnd = mix(float(0.075), float(0.095), kind);
            const jaw = float(1.0).sub(smoothstep(0.012, 0.03, abs(d.sub(0.36))))
                .mul(float(1.0).sub(smoothstep(jawEnd.sub(0.012), jawEnd, s)));
            const gill = float(1.0).sub(smoothstep(0.003, 0.008, abs(s.sub(mix(float(0.19), float(0.215), kind)))))
                .mul(smoothstep(0.2, 0.3, d)).mul(float(1.0).sub(smoothstep(0.78, 0.86, d)));
            skin.assign(skin.mul(float(1.0).sub(jaw.mul(0.6)).sub(gill.mul(0.35))));
            // The fins: a salmon's dark over its back and tail, pale under it; a trout's olive and
            // amber, the adipose tipped orange.
            const darkFin = mix(vec3(0.035, 0.045, 0.055), vec3(0.11, 0.085, 0.04), kind);
            const adipose = smoothstep(0.69, 0.71, s).mul(float(1.0).sub(smoothstep(0.78, 0.8, s)))
                .mul(step(0.85, d)).mul(smoothstep(0.3, 0.9, flex))
                .mul(kind);
            const finTone = mix(
                mix(darkFin, vec3(0.42, 0.11, 0.02), adipose),
                mix(vec3(0.27, 0.28, 0.29), vec3(0.34, 0.22, 0.06), kind),
                isPale,
            );
            // The eye: a black pupil in a silver (a trout's, gold) iris.
            const pupil = float(1.0).sub(smoothstep(0.45, 0.58, flex));
            const eyeTone = mix(mix(vec3(0.42, 0.43, 0.44), vec3(0.5, 0.36, 0.1), kind), vec3(0.006), pupil);
            const albedo = skin.mul(isBody).add(finTone.mul(anyFin)).add(eyeTone.mul(isEye));
            const L = u.sunDir;
            const sun = u.sun.mul(sunShare(u, P)).toVar();
            const wrap = clamp(dot(N, L).mul(0.75).add(0.25), 0.0, 1.0);
            const ambient = u.fill.mul(N.y.mul(0.35).add(1.0)).add(u.bounce.mul(float(0.5).sub(N.y.mul(0.5))));
            const diffuse = albedo.mul(sun.mul(wrap.mul(0.65)).add(ambient.mul(1.2)));
            // Wet: the sky in the flank (a salmon's is a mirror; a trout's flashes bronze) and the
            // sun's highlight on it; the fins and the spots are matte, the eye glassy.
            const silver = mix(float(0.26), float(0.14), kind).mul(float(1.0).sub(onBack.mul(0.8)))
                .mul(isBody).mul(float(1.0).sub(black))
                .add(isEye.mul(0.2))
                .toVar();
            const nv = clamp(dot(N, V), 0.0, 1.0);
            const f = float(1.0).sub(nv);
            const f2 = f.mul(f);
            const fresnel = f2.mul(f2).mul(f).mul(0.96).add(0.04);
            const R = reflect(V.negate(), N).toVar();
            // (Looking down off the flank it meets the river's dark water, not the sky.) The mirror
            // is guanine, not glass: it gives back the sky's light more than its blue.
            const sky = skyColour(u, R, { withSun: false });
            const grey = dot(sky, vec3(0.2126, 0.7152, 0.0722));
            const seen = mix(u.water.mul(2.0), mix(sky, vec3(grey), 0.65), smoothstep(-0.3, 0.08, R.y));
            const tint = mix(vec3(1.0), vec3(1.0, 0.84, 0.58), kind);
            const H = normalize(L.add(V));
            const nh = clamp(dot(N, H), 0.0, 1.0);
            const nh2 = nh.mul(nh);
            const nh4 = nh2.mul(nh2);
            const nh8 = nh4.mul(nh4);
            const nh16 = nh8.mul(nh8);
            const glint = nh16.mul(nh16).mul(nh16).mul(0.55).add(nh8.mul(0.05));
            const wet = float(1.0).sub(anyFin.mul(0.7));
            const lit = diffuse
                .add(seen.mul(tint).mul(silver.add(fresnel.mul(0.4).mul(wet))))
                .add(sun.mul(tint).mul(glint).mul(silver.add(0.3)).mul(wet));
            return vec4(aerial(u, P, lit), 1.0);
        })();
        return material;
    }

    /** Back to `time`: the clock's leaps from there on, no salmon run, nothing in the air. */
    reset(time = 0) {
        this.next = LANES.map((_, lane) => firstLeapAfter(lane, time));
        this.random = mulberry32(this.seed);
        this.runDebt = 0;
        this.runs = [];
        this.airborne = 0;
        this.drawn = true;
        this.data.fill(0);
        this.buffer.needsUpdate = true;
        for (let i = 0; i < this.ringCount; i++) this.ringData[i * RING_STRIDE + 3] = -1e6;
        this.ringCursor = 0;
        this.ringBuffer.needsUpdate = true;
    }

    /** One ring of foam spreading from (x, y, z) from time `born`, drifting (vx, vz) m/s. */
    ring(x, y, z, born, vx, vz, size, life) {
        const o = this.ringCursor * RING_STRIDE;
        this.ringCursor = (this.ringCursor + 1) % this.ringCount;
        const { ringData } = this;
        ringData[o] = x;
        ringData[o + 1] = y;
        ringData[o + 2] = z;
        ringData[o + 3] = born;
        ringData[o + 4] = vx;
        ringData[o + 5] = vz;
        ringData[o + 6] = size;
        ringData[o + 7] = life;
        this.ringBuffer.needsUpdate = true;
    }

    /**
     * A leap leaves the water: the rings where it breaks the surface, leaving and falling back
     * (the second still to come), each drifting off on the current; then its splash.
     */
    leaveWater(leap) {
        const pose = this._pose;
        const size = Math.max(RING.least, leap.length * RING.widest);
        const ends = [[0, leap.s0, leap.level0, 1], [leap.T, leap.s1, leap.level1, RING.fallBack]];
        for (const [age, s, level, more] of ends) {
            leapPose(leap, age, this.flood, pose);
            const c = pose.course;
            const v = speedAt(s) * RING.drift;
            this.ring(
                pose.x,
                level + this.flood + RING.lift,
                pose.z,
                leap.at + age,
                c.tx * v,
                c.tz * v,
                size * more,
                RING.life * Math.sqrt(more),
            );
        }
        this.onLeap?.(leap);
    }

    /** A salmon of the run leaps now, at the fall or up a ledge (heat of play). */
    launch(time, lane = null) {
        const r = this.random;
        const pick = lane ?? (r() < 0.6 ? LANE_INDEX.fall : LANE_INDEX.ledges);
        const salts = new Map();
        const leap = shapeLeap({}, pick, (salt) => {
            if (!salts.has(salt)) salts.set(salt, r());
            return salts.get(salt);
        });
        leap.at = time;
        leap.clock = false;
        this.runs.push(leap);
        // (Never more of the run in the air than there are fish to draw.)
        if (this.runs.length > this.count) this.runs.shift();
        this.leaveWater(leap);
        return leap;
    }

    /**
     * Place the fish in the air at `time` and write their rows. `flood` lifts the river; `run` is
     * the salmon run's extra leaps a second (the heat of play), over the frame's `dt`.
     */
    update(time, flood = 0, run = 0, dt = 0) {
        this.flood = flood;
        // The clock's leaps, each breaking the water as it leaves it (also one caught mid-flight
        // by a seek: its rings and splash are thrown where they would be by now).
        for (let lane = 0; lane < LANES.length; lane++) {
            for (let leap = leapAt(lane, this.next[lane], this._leap); leap.at <= time;
                leap = leapAt(lane, this.next[lane], this._leap)) {
                if (time < leap.at + leap.T) this.leaveWater({ ...leap, course: { ...leap.course } });
                this.next[lane] += 1;
            }
        }
        if (run > 0 && dt > 0) {
            this.runDebt += run * dt;
            while (this.runDebt >= 1) {
                this.runDebt -= 1;
                this.launch(time);
            }
        }
        this.runs = this.runs.filter((leap) => time < leap.at + leap.T);
        const flying = [];
        for (let lane = 0; lane < LANES.length; lane++) {
            const L = LANES[lane];
            const lo = Math.max(0, Math.floor((time - L.first - L.jitter - LONGEST) / L.gap));
            const hi = Math.floor((time - L.first + L.jitter) / L.gap) + 1;
            for (let k = lo; k <= hi; k++) {
                const leap = leapAt(lane, k);
                if (leap.at <= time && time < leap.at + leap.T) flying.push(leap);
            }
        }
        for (const leap of this.runs) if (leap.at <= time) flying.push(leap);
        // Nothing in the air now nor drawn last frame: every row already holds no fish.
        if (!flying.length && !this.drawn) {
            this.airborne = 0;
            return;
        }
        const { data } = this;
        data.fill(0);
        const pose = this._pose;
        const shown = Math.min(flying.length, this.count);
        for (let i = 0; i < shown; i++) {
            const leap = flying[i];
            leapPose(leap, time - leap.at, flood, pose);
            const kind = KIND_BY_ID[leap.kind];
            const o = i * FISH_STRIDE;
            data[o] = pose.x;
            data[o + 1] = pose.y;
            data[o + 2] = pose.z;
            data[o + 3] = pose.tail;
            data[o + 4] = pose.fx;
            data[o + 5] = pose.fy;
            data[o + 6] = pose.fz;
            data[o + 7] = leap.length;
            data[o + 8] = pose.ux;
            data[o + 9] = pose.uy;
            data[o + 10] = pose.uz;
            data[o + 11] = leap.kind;
            data[o + 12] = pose.curl;
            data[o + 13] = kind.stroke;
        }
        this.buffer.needsUpdate = true;
        this.airborne = shown;
        this.drawn = shown > 0;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.rings.geometry.dispose();
        this.rings.material.dispose();
    }
}
