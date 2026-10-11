/**
 * Ocean — the reef's colonies.
 *
 * Six kinds, each one mesh grown in code and drawn once for every colony of its kind:
 * branching coral (a thicket of fingers), table coral (a plate on a stalk), brain coral (a dome
 * whose maze is drawn per pixel), tube sponges, sea fans (lace, broadside to the viewer) and
 * anemones (a crown of tentacles that never keeps still).
 *
 * Every mesh carries its own outward normals and two numbers per vertex: `tip` (0 at the root,
 * 1 where it is growing) and `ao` (how much of the sea's light reaches into it). The tips are
 * where a colony fluoresces as the light goes, and where it holds the colour of a piece.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    fract,
    max,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, mulberry32, ocFog, ocLight, ocMax3, ocPart, ocRings, ocStains, ocSway, ocTurnY,
} from './ocean-tsl.js';

// ── Growing a mesh ──────────────────────────────────────────────────────────────

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
    const n = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / n, a[1] / n, a[2] / n];
};

/** A mesh under construction: positions, outward normals, (tip, ao) and a spare pair per vertex. */
export class Shape {
    constructor() {
        this.p = [];
        this.n = [];
        this.s = [];
        this.t = [];
        this.i = [];
    }

    vert(p, n, tip, ao, a = 0, b = 0) {
        const k = this.p.length / 3;
        this.p.push(p[0], p[1], p[2]);
        this.n.push(n[0], n[1], n[2]);
        this.s.push(tip, ao);
        this.t.push(a, b);
        return k;
    }

    /** A triangle, wound so that its face looks the way its corners' normals do. */
    tri(a, b, c) {
        const { p, n } = this;
        const ux = p[b * 3] - p[a * 3];
        const uy = p[b * 3 + 1] - p[a * 3 + 1];
        const uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3];
        const vy = p[c * 3 + 1] - p[a * 3 + 1];
        const vz = p[c * 3 + 2] - p[a * 3 + 2];
        const facing = (uy * vz - uz * vy) * (n[a * 3] + n[b * 3] + n[c * 3])
            + (uz * vx - ux * vz) * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1])
            + (ux * vy - uy * vx) * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
        if (facing < 0) this.i.push(a, c, b);
        else this.i.push(a, b, c);
    }

    quad(a, b, c, d) {
        this.tri(a, b, c);
        this.tri(a, c, d);
    }

    get triangles() {
        return this.i.length / 3;
    }

    /** @param {boolean} spare  keep the spare pair as `uv` */
    geometry(spare = false) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
        g.setAttribute('aShape', new THREE.BufferAttribute(new Float32Array(this.s), 2));
        if (spare) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.t), 2));
        g.setIndex(this.i);
        return g;
    }
}

/**
 * A tube along a path. `points`: [{ p, r, tip, ao, a?, b? }]. `cap` closes its far end with a
 * rounded point; `inward` turns the wall to face its own axis (the inside of a sponge).
 */
export function tube(shape, points, sides, { cap = true, inward = false } = {}) {
    const rings = [];
    let tangent = unit(add(points[1].p, points[0].p, -1));
    let across = unit(cross(tangent, Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    for (let j = 0; j < points.length; j++) {
        const before = points[Math.max(0, j - 1)].p;
        const after = points[Math.min(points.length - 1, j + 1)].p;
        tangent = unit(add(after, before, -1));
        // Carry the frame along the path, so the tube does not twist.
        const lean = across[0] * tangent[0] + across[1] * tangent[1] + across[2] * tangent[2];
        across = unit(add(across, tangent, -lean));
        const other = cross(tangent, across);
        const point = points[j];
        const ring = [];
        for (let k = 0; k < sides; k++) {
            const a = (k / sides) * TAU;
            const out = add([across[0] * Math.cos(a), across[1] * Math.cos(a), across[2] * Math.cos(a)], other, Math.sin(a));
            const normal = inward ? [-out[0], -out[1], -out[2]] : out;
            ring.push(shape.vert(add(point.p, out, point.r), normal, point.tip, point.ao, point.a || 0, point.b || 0));
        }
        rings.push(ring);
    }
    for (let j = 0; j < rings.length - 1; j++) {
        for (let k = 0; k < sides; k++) {
            const k1 = (k + 1) % sides;
            shape.quad(rings[j][k], rings[j][k1], rings[j + 1][k1], rings[j + 1][k]);
        }
    }
    if (cap) {
        const last = points[points.length - 1];
        const apex = shape.vert(add(last.p, tangent, last.r * 0.9), tangent, last.tip, last.ao, last.a || 0, last.b || 0);
        const ring = rings[rings.length - 1];
        for (let k = 0; k < sides; k++) shape.tri(ring[k], ring[(k + 1) % sides], apex);
    }
    return rings;
}

/** A thicket of fingers, about a metre tall: five stems, each forking twice. */
export function branchingCoral(seed = 11) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    const DEEPEST = 2;
    const grow = (origin, heading, length, radius, depth) => {
        const points = [];
        let p = origin;
        let d = heading;
        const SEGMENTS = 2;
        for (let s = 0; s <= SEGMENTS; s++) {
            const tip = (depth + s / SEGMENTS) / (DEEPEST + 1);
            points.push({
                p, r: radius * (1 - 0.3 * (s / SEGMENTS)), tip, ao: 0.38 + 0.62 * tip,
            });
            if (s < SEGMENTS) {
                // It reaches for the light, never quite straight.
                d = unit(add(d, [(rand() - 0.5) * 0.55, 0.4, (rand() - 0.5) * 0.55]));
                p = add(p, d, length / SEGMENTS);
            }
        }
        tube(shape, points, depth === 0 ? 5 : 4, { cap: depth === DEEPEST });
        if (depth === DEEPEST) return;
        const forks = 2 + (rand() < 0.45 ? 1 : 0);
        const turn = rand() * TAU;
        const side = unit(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
        const fore = cross(d, side);
        for (let f = 0; f < forks; f++) {
            const a = turn + (f / forks) * TAU + (rand() - 0.5) * 0.7;
            const splay = 0.65 + rand() * 0.45;
            const child = unit(add(add(d, side, Math.cos(a) * splay), fore, Math.sin(a) * splay));
            grow(p, child, length * (0.68 + rand() * 0.14), radius * 0.68, depth + 1);
        }
    };
    const STEMS = 5;
    for (let s = 0; s < STEMS; s++) {
        const a = (s / STEMS) * TAU + rand() * 0.6;
        const out = 0.5 + rand() * 0.45;
        grow(
            [Math.cos(a) * 0.1, -0.04, Math.sin(a) * 0.1],
            unit([Math.cos(a) * out, 1, Math.sin(a) * out]),
            0.4 + rand() * 0.1,
            0.07,
            0,
        );
    }
    return shape;
}

/** A plate on a stalk, two metres across at scale 1: its rim lobed, its top a shallow dish. */
export function tableCoral(seed = 23) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    const s1 = rand() * TAU;
    const s2 = rand() * TAU;
    tube(shape, [
        {
            p: [0, -0.05, 0], r: 0.2, tip: 0, ao: 0.4,
        },
        {
            p: [0, 0.3, 0], r: 0.15, tip: 0.1, ao: 0.35,
        },
        {
            p: [0, 0.5, 0], r: 0.3, tip: 0.2, ao: 0.3,
        },
    ], 7, { cap: false });
    const RINGS = 5;
    const SEGMENTS = 22;
    const rim = (a) => 1 + 0.1 * Math.sin(3 * a + s1) + 0.06 * Math.sin(7 * a + s2);
    const top = [];
    const under = [];
    for (let i = 1; i <= RINGS; i++) {
        const r = i / RINGS;
        const upper = [];
        const lower = [];
        for (let k = 0; k < SEGMENTS; k++) {
            const a = (k / SEGMENTS) * TAU;
            const reach = r * rim(a);
            const x = Math.cos(a) * reach;
            const z = Math.sin(a) * reach;
            const y = 0.52 + 0.11 * r * r + 0.025 * Math.sin(5 * a + s2) * r;
            upper.push(shape.vert([x, y, z], unit([-0.22 * x, 1, -0.22 * z]), r, 0.72 + 0.28 * r, r, a / TAU));
            lower.push(shape.vert([x, y - (0.2 - 0.14 * r), z], unit([0.3 * x, -1, 0.3 * z]), r * 0.6, 0.3, r, a / TAU));
        }
        top.push(upper);
        under.push(lower);
    }
    const crown = shape.vert([0, 0.52, 0], [0, 1, 0], 0, 0.72);
    for (let k = 0; k < SEGMENTS; k++) {
        const k1 = (k + 1) % SEGMENTS;
        shape.tri(crown, top[0][k], top[0][k1]);
        for (let i = 0; i < RINGS - 1; i++) {
            shape.quad(top[i][k], top[i][k1], top[i + 1][k1], top[i + 1][k]);
            shape.quad(under[i][k], under[i][k1], under[i + 1][k1], under[i + 1][k]);
        }
        // The rim: the growing edge, its own normals pointing outward.
        const a = (k / SEGMENTS) * TAU;
        const a1 = (k1 / SEGMENTS) * TAU;
        const outer = RINGS - 1;
        const edge = (ring, angle) => {
            const src = ring[outer][angle === a ? k : k1];
            return shape.vert(
                [shape.p[src * 3], shape.p[src * 3 + 1], shape.p[src * 3 + 2]],
                [Math.cos(angle), 0, Math.sin(angle)],
                1,
                0.85,
                1,
                angle / TAU,
            );
        };
        shape.quad(edge(top, a), edge(top, a1), edge(under, a1), edge(under, a));
    }
    return shape;
}

/** A dome, two metres across at scale 1. Its maze is drawn in the fragment stage. */
export function brainCoral(seed = 37) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    const s1 = rand() * TAU;
    const s2 = rand() * TAU;
    const BANDS = 7;
    const SEGMENTS = 18;
    const rings = [];
    for (let i = 1; i <= BANDS; i++) {
        const lat = (i / BANDS) * (Math.PI / 2 + 0.3);
        const ring = [];
        for (let k = 0; k < SEGMENTS; k++) {
            const a = (k / SEGMENTS) * TAU;
            const dir = [Math.sin(lat) * Math.cos(a), Math.cos(lat), Math.sin(lat) * Math.sin(a)];
            const lump = 1 + 0.1 * Math.sin(3 * a + s1) * Math.sin(lat) + 0.07 * Math.sin(5 * lat + 2 * a + s2);
            ring.push(shape.vert(
                [dir[0] * lump, dir[1] * lump * 0.72, dir[2] * lump],
                unit([dir[0], dir[1] / 0.72, dir[2]]),
                0.5,
                0.45 + 0.55 * Math.max(0, Math.cos(lat)),
            ));
        }
        rings.push(ring);
    }
    const crown = shape.vert([0, 0.72, 0], [0, 1, 0], 0.5, 1);
    for (let k = 0; k < SEGMENTS; k++) {
        const k1 = (k + 1) % SEGMENTS;
        shape.tri(crown, rings[0][k], rings[0][k1]);
        for (let i = 0; i < BANDS - 1; i++) shape.quad(rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]);
    }
    return shape;
}

/** A cluster of tube sponges, the tallest about a metre: open at the top, dark inside. */
export function spongeCluster(seed = 53) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    const TUBES = 6;
    for (let t = 0; t < TUBES; t++) {
        const a = (t / TUBES) * TAU + rand() * 0.8;
        const out = t === 0 ? 0 : 0.14 + rand() * 0.2;
        const height = (t === 0 ? 1.05 : 0.45 + rand() * 0.5);
        const radius = 0.1 + rand() * 0.06;
        const lean = unit([Math.cos(a) * out * 1.3, 1, Math.sin(a) * out * 1.3]);
        const base = [Math.cos(a) * out, -0.04, Math.sin(a) * out];
        const profile = [0.75, 1.0, 1.12, 1.05, 0.95];
        const wall = profile.map((k, j) => {
            const s = j / (profile.length - 1);
            return {
                p: add(base, lean, height * s), r: radius * k, tip: s, ao: 0.5 + 0.5 * s,
            };
        });
        tube(shape, wall, 7, { cap: false });
        // The lip, and the dark of the inside.
        const mouth = add(base, lean, height);
        const inner = [
            {
                p: mouth, r: radius * 0.95, tip: 1, ao: 0.6,
            },
            {
                p: add(mouth, lean, -0.02), r: radius * 0.7, tip: 0.8, ao: 0.22,
            },
            {
                p: add(mouth, lean, -height * 0.35), r: radius * 0.6, tip: 0.3, ao: 0.06,
            },
        ];
        tube(shape, inner, 7, { cap: false, inward: true });
    }
    return shape;
}

/** A sea fan, about a metre and a half tall: a lobed sheet on a short stem, drawn as lace. */
export function seaFan(seed = 71) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    const s1 = rand() * TAU;
    const s2 = rand() * TAU;
    const s3 = rand() * TAU;
    tube(shape, [
        {
            p: [0, -0.05, 0], r: 0.04, tip: 0, ao: 0.5,
        },
        {
            p: [0, 0.2, 0], r: 0.03, tip: 0.1, ao: 0.6,
        },
    ], 4, { cap: false });
    const RINGS = 7;
    const SPOKES = 16;
    const SPREAD = 78 * (Math.PI / 180);
    const grid = [];
    for (let i = 0; i <= RINGS; i++) {
        const r = 0.1 + 0.9 * (i / RINGS);
        const row = [];
        for (let k = 0; k <= SPOKES; k++) {
            const f = (k / SPOKES) * 2 - 1;
            const a = f * SPREAD;
            const edge = 1 + 0.16 * Math.sin(a * 5 + s1) + 0.1 * Math.sin(a * 11 + s2) - 0.28 * f * f;
            const reach = r * edge * 1.35;
            row.push(shape.vert(
                [Math.sin(a) * reach, 0.16 + Math.cos(a) * reach, 0.1 * Math.sin(r * 3 + a * 2 + s3) * r],
                [0, 0, 1],
                r,
                0.55 + 0.45 * r,
                r,
                f,
            ));
        }
        grid.push(row);
    }
    for (let i = 0; i < RINGS; i++) {
        for (let k = 0; k < SPOKES; k++) shape.quad(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
    }
    return shape;
}

/** An anemone, most of a metre across: a column, and a crown of tentacles (spare = (which, how far along)). */
export function anemone(seed = 89) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    tube(shape, [
        {
            p: [0, -0.05, 0], r: 0.3, tip: 0, ao: 0.5, a: 0, b: 0,
        },
        {
            p: [0, 0.2, 0], r: 0.34, tip: 0.05, ao: 0.55, a: 0, b: 0,
        },
        {
            p: [0, 0.3, 0], r: 0.42, tip: 0.1, ao: 0.5, a: 0, b: 0,
        },
        {
            p: [0, 0.31, 0], r: 0.05, tip: 0.1, ao: 0.4, a: 0, b: 0,
        },
    ], 9, { cap: false });
    const TENTACLES = 64;
    for (let t = 0; t < TENTACLES; t++) {
        const reach = 0.4 * Math.sqrt((t + 0.5) / TENTACLES);
        const a = t * 2.39996323;
        const base = [Math.cos(a) * reach, 0.3, Math.sin(a) * reach];
        const splay = 0.25 + reach * 1.9;
        const up = unit([Math.cos(a) * splay, 1, Math.sin(a) * splay]);
        const length = 0.4 + rand() * 0.26;
        const which = rand();
        const points = [];
        const STEPS = 4;
        for (let s = 0; s <= STEPS; s++) {
            const k = s / STEPS;
            const p = add(add(base, up, length * k), [Math.cos(a), -0.25, Math.sin(a)], k * k * 0.14);
            points.push({
                // A little bulb at the end of each.
                p, r: 0.034 * (1 - 0.5 * k) * (s === STEPS ? 1.5 : 1), tip: k, ao: 0.5 + 0.5 * k, a: which, b: k,
            });
        }
        tube(shape, points, 4, { cap: true });
    }
    return shape;
}

// ── Drawing them ────────────────────────────────────────────────────────────────

/**
 * A sea fan's lace: a net of fine threads (where two slow fields cross their contours), with
 * the thicker veins that fork outward from the stem running through it. Plain node expressions
 * (no vars), so the colour and the mask can share them.
 */
function fanLace(u, aSeed) {
    const r = uv().x;
    const f = uv().y;
    const q = vec2(f.mul(r.mul(1.6).add(0.4)), r).mul(2.2).add(aSeed.x.mul(5.0));
    const a = u.noise(q.mul(0.9)).r;
    const b = u.noise(q.mul(0.9).add(vec2(0.31, 0.57))).g;
    const thread = (n) => float(1.0).sub(smoothstep(0.04, 0.12, abs(fract(n.mul(9.0)).sub(0.5))));
    const net = max(thread(a), thread(b));
    const spokes = abs(fract(f.mul(4.5).add(sin(r.mul(5.0).add(aSeed.x.mul(9.0))).mul(0.25)).mul(r.mul(1.6).add(1.0)))
        .sub(0.5));
    const vein = float(1.0).sub(smoothstep(0.03, 0.09, spokes));
    // Near the stem the net is solid: a fan grows out of a trunk, not out of a hole.
    const stem = float(1.0).sub(smoothstep(0.08, 0.2, r));
    return { lace: clamp(net.add(vein).add(stem), 0.0, 1.0), vein };
}

/** One mesh, many colonies: (x, y, z, yaw), (r, g, b, scale) and (seed, _, _, _) per colony. */
export function instanceColonies(base, items) {
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(base.attributes).forEach((name) => geometry.setAttribute(name, base.attributes[name]));
    geometry.setIndex(base.index);
    const count = Math.max(1, items.length);
    const place = new Float32Array(count * 4);
    const tint = new Float32Array(count * 4);
    const seed = new Float32Array(count * 4);
    items.forEach((it, i) => {
        place.set([it.x, it.y, it.z, it.yaw], i * 4);
        tint.set([it.tint[0], it.tint[1], it.tint[2], it.scale], i * 4);
        seed.set([it.seed, 0, 0, 0], i * 4);
    });
    // (Nothing of a kind at this tier: one colony of no size, so the draw stays valid.)
    if (!items.length) tint.set([0, 0, 0, 0], 0);
    geometry.setAttribute('aPlace', new THREE.InstancedBufferAttribute(place, 4));
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geometry.instanceCount = count;
    return geometry;
}

/**
 * The colonies' material. `style`:
 *   pattern   'plain' | 'brain' | 'table' | 'fan' | 'anemone'
 *   wrap      how far the light wraps round it (lace and tentacles take it from all sides)
 *   sway      how far it bends with the water (0 = stone)
 *   pale      how much paler the growing tips are
 *   glow      how strongly the tips fluoresce
 */
export function createColonyMaterial(u, name, style) {
    const {
        pattern = 'plain', wrap = 0.45, sway = 0, pale = 0.45, glow = 1, side = THREE.FrontSide,
    } = style;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.side = side;
    material.fog = false;
    material.toneMapped = false;

    const aPlace = attribute('aPlace', 'vec4');
    const aTint = attribute('aTint', 'vec4');
    const aSeed = attribute('aSeed', 'vec4');
    const aShape = attribute('aShape', 'vec2');
    const turnS = sin(aPlace.w);
    const turnC = cos(aPlace.w);
    /** Where the colony stands in the world (its root), for what the board lays on the reef. */
    const rootXZ = vec2(aPlace.x.mul(u.squeeze), aPlace.z);

    material.positionNode = Fn(() => {
        const local = positionGeometry.mul(aTint.w).toVar();
        if (pattern === 'anemone') {
            // Every tentacle waves on its own: `uv` = (which tentacle, how far along it).
            const which = uv().x;
            const along = uv().y;
            const flex = along.mul(along).mul(aTint.w);
            const t = u.sway;
            local.x.addAssign(sin(t.mul(1.7).add(which.mul(40.0)).add(along.mul(2.0))).mul(0.11).mul(flex));
            local.z.addAssign(cos(t.mul(1.3).add(which.mul(23.0)).add(along.mul(1.6))).mul(0.11).mul(flex));
            local.y.addAssign(sin(t.mul(0.9).add(which.mul(31.0))).mul(0.03).mul(flex));
        }
        const stood = ocTurnY(local, turnS, turnC).add(aPlace.xyz).toVar();
        if (sway > 0) {
            // It bends from its root, more the higher it stands.
            const reach = max(positionGeometry.y, 0.0);
            const flex = reach.mul(reach).mul(aTint.w).mul(sway);
            const bend = ocSway(u, aPlace.x, aSeed.x);
            stood.x.addAssign(bend.x.mul(flex));
            stood.z.addAssign(bend.y.mul(flex));
        }
        return stood;
    })();

    const fan = pattern === 'fan' ? fanLace(u, aSeed) : null;
    // The holes in a fan's lace are holes.
    if (fan) material.maskNode = fan.lace.greaterThan(0.45);

    const vNormal = varying(ocTurnY(normalGeometry, turnS, turnC), `v${name}N`);
    const vHeld = varying(Fn(() => ocStains(u, rootXZ))(), `v${name}Held`);
    const vRing = varying(Fn(() => ocRings(u, rootXZ))(), `v${name}Ring`);

    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal).toVar();
        const tip = clamp(aShape.x, 0.0, 1.0);
        const ao = clamp(aShape.y, 0.0, 1.0);
        const hue = aTint.rgb;
        const own = positionGeometry;
        /** Where the colony is growing: its tips, a brain's ridges, a fan's veins. */
        const growing = smoothstep(0.55, 1.0, tip).toVar();
        const albedo = hue.mul(tip.mul(pale).add(1.0 - pale * 0.5)).toVar();

        if (pattern === 'brain') {
            // The maze: ridges where a slow field crosses its middle, valleys between.
            const field = u.noise(own.xz.mul(0.42).add(own.y.mul(0.27)).add(aSeed.x.mul(3.0))).r;
            const fold = u.noise(own.zy.mul(0.9).add(own.x.mul(0.31)).add(aSeed.x.mul(7.0))).g;
            const ridge = abs(fract(field.mul(5.0).add(fold.mul(1.4))).mul(2.0).sub(1.0));
            const valley = float(1.0).sub(smoothstep(0.1, 0.5, ridge));
            albedo.mulAssign(valley.mul(-0.55).add(1.05));
            N.assign(normalize(N.add(vec3(ridge.sub(0.5), 0.0, fold.sub(0.5)).mul(0.5))));
            growing.assign(valley);
        } else if (pattern === 'table') {
            // Ribs running out to the rim, and the rim itself pale where it is growing.
            const angle = uv().y.mul(TAU);
            const rib = sin(angle.mul(34.0).add(sin(uv().x.mul(9.0)).mul(1.2))).mul(0.5).add(0.5);
            albedo.mulAssign(rib.mul(0.22).mul(uv().x).add(0.9));
            growing.assign(smoothstep(0.82, 1.0, tip));
        } else if (pattern === 'fan') {
            albedo.mulAssign(fan.vein.mul(0.25).add(0.85));
            growing.assign(fan.lace.mul(smoothstep(0.35, 1.0, uv().x)));
        } else if (pattern === 'sponge') {
            // Pores: dark pits in the wall, and fine vertical ridges.
            const pores = u.noise(own.xz.mul(5.0).add(own.y.mul(3.1)).add(aSeed.x.mul(11.0))).b;
            const pit = smoothstep(0.62, 0.72, pores);
            const ridge = sin(own.y.mul(40.0).add(pores.mul(6.0))).mul(0.06).add(0.94);
            albedo.mulAssign(float(1.0).sub(pit.mul(0.6)).mul(ridge));
            growing.assign(smoothstep(0.75, 1.0, tip).mul(float(1.0).sub(pit)));
        } else if (pattern === 'anemone') {
            growing.assign(smoothstep(0.35, 1.0, uv().y));
        }

        const light = ocLight(u, { N, P, wrap });
        const col = albedo.mul(light).mul(ao).toVar();
        // A soft thing lets the light through: seen against the sun, its edges glow.
        if (wrap > 0.6) {
            const through = clamp(dot(normalize(P.sub(cameraPosition)), u.sunDir), 0.0, 1.0);
            col.addAssign(hue.mul(u.sun).mul(through.mul(through)).mul(growing.mul(0.5).add(0.25)).mul(0.5)
                .mul(u.breath));
        }
        // The reef's own light: the tips fluoresce as the day goes, and with the charge.
        const peak = max(ocMax3(hue), 1e-3);
        const fire = mix(hue.div(peak), u.glow, 0.45);
        col.addAssign(fire.mul(growing).mul(u.fluor).mul(glow * 0.6).mul(u.breath));
        // What the board lays on it: the colour it holds, and a ring passing.
        col.addAssign(vHeld.mul(growing.mul(1.1).add(0.18)).mul(1.35).mul(u.breath));
        col.addAssign(albedo.mul(vRing).mul(1.5).add(vRing.mul(growing.mul(0.9).add(0.25))).mul(u.breath));
        return vec4(ocFog(u, col, P), 1.0);
    })();
    return material;
}

const KINDS = Object.freeze({
    branching: {
        build: branchingCoral,
        seed: 11,
        spare: false,
        order: 4,
        style: {
            pattern: 'plain', wrap: 0.5, pale: 0.6, glow: 1.2,
        },
    },
    tables: {
        build: tableCoral,
        seed: 23,
        spare: true,
        order: 4,
        style: {
            pattern: 'table', wrap: 0.4, pale: 0.5, glow: 0.9,
        },
    },
    brains: {
        build: brainCoral,
        seed: 37,
        spare: false,
        order: 4,
        style: {
            pattern: 'brain', wrap: 0.4, pale: 0, glow: 1.1,
        },
    },
    sponges: {
        build: spongeCluster,
        seed: 53,
        spare: false,
        order: 4,
        style: {
            pattern: 'sponge', wrap: 0.5, pale: 0.35, glow: 0.7,
        },
    },
    fans: {
        build: seaFan,
        seed: 71,
        spare: true,
        order: 5,
        style: {
            pattern: 'fan', wrap: 0.85, pale: 0.2, glow: 0.9, sway: 0.16, side: THREE.DoubleSide,
        },
    },
    anemones: {
        build: anemone,
        seed: 89,
        spare: true,
        order: 5,
        style: {
            pattern: 'anemone', wrap: 0.8, pale: 0.9, glow: 2.2,
        },
    },
});

export const COLONY_KINDS = Object.freeze(Object.keys(KINDS));

/**
 * Every colony of one kind as a scene part.
 * @param {object} u
 * @param {string} kind    one of COLONY_KINDS
 * @param {Array} items    the plan's list for that kind
 */
export function createColonies(u, kind, items) {
    const spec = KINDS[kind];
    const shape = spec.build(spec.seed);
    const base = shape.geometry(spec.spare);
    const geometry = instanceColonies(base, items);
    const name = `Ocean${kind[0].toUpperCase()}${kind.slice(1)}`;
    const material = createColonyMaterial(u, name, spec.style);
    const part = ocPart(name, geometry, material, spec.order);
    part.count = items.length;
    part.triangles = shape.triangles;
    return part;
}
