/**
 * High Coast — the things near the eye: the old pine, the trail sign, boulders and heath.
 *
 *  - The old Scots pine on the knoll left of the eye: a leaning, tapering trunk, grey-brown and
 *    furrowed below, orange-red and flaking above; a few dead lower branches; a crown of tufted
 *    needle clumps that reaches out over the top left of the view (it stands on rock the frame
 *    shows, its roots gripping the granite).
 *  - The trail sign beside it: a weathered post with a board carved HÖGA KUSTEN and an arrow
 *    board VÄRLDSARV pointing out over the coast (the letters a baked distance field).
 *  - Lichen-crusted granite boulders on the summit, and tufts of heather, crowberry and reindeer
 *    lichen in its hollows.
 *
 * Everything stands on the land it is drawn over (its base sunk a little into the rock), is lit
 * like the land (sun, the terrain's shadow, sky fill) and read through the same air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    fwidth,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EYE, PLACES, mulberry32 } from './high-coast-core.js';
import { groundHeight } from './high-coast-field.js';
import { aerial } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';
import { bakeSignField } from './high-coast-sign.js';
import { simplex } from './high-coast-plan.js';

// ── Geometry helpers ──────────────────────────────────────────────────────────────

/**
 * A tapering tube along points (a Catmull-Rom curve), `rings` × `sides`, radius from `r0` to
 * `r1` (a flare at the foot when `flare` > 0). Non-indexed, with normals and a part id.
 */
export function taperedTube(points, {
    r0 = 0.4, r1 = 0.05, rings = 24, sides = 9, flare = 0, part = 0, wobble = 0, seed = 1,
} = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const frames = curve.computeFrenetFrames(rings, false);
    const pos = [];
    const nrm = [];
    const ring = [];
    const random = mulberry32(seed);
    const bumps = Array.from({ length: sides }, () => 1 + (random() - 0.5) * wobble);
    for (let i = 0; i <= rings; i++) {
        const s = i / rings;
        const c = curve.getPointAt(s);
        const N = frames.normals[i];
        const B = frames.binormals[i];
        const r = r0 + (r1 - r0) * s ** 0.85 + flare * Math.max(0, 1 - s / 0.06) ** 2;
        const row = [];
        for (let k = 0; k < sides; k++) {
            const a = (k / sides) * Math.PI * 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const n = new THREE.Vector3().addScaledVector(N, ca).addScaledVector(B, sa).normalize();
            const rr = r * bumps[k] * (1 + 0.06 * Math.sin(s * 37 + k * 2.1));
            row.push([c.x + n.x * rr, c.y + n.y * rr, c.z + n.z * rr, n.x, n.y, n.z]);
        }
        ring.push(row);
    }
    for (let i = 0; i < rings; i++) {
        for (let k = 0; k < sides; k++) {
            const a = ring[i][k];
            const b = ring[i][(k + 1) % sides];
            const c = ring[i + 1][k];
            const d = ring[i + 1][(k + 1) % sides];
            for (const v of [a, c, b, b, c, d]) {
                pos.push(v[0], v[1], v[2]);
                nrm.push(v[3], v[4], v[5]);
            }
        }
    }
    return { pos, nrm, part };
}

/** A tufted clump: an icosphere pushed in and out by noise (its outline ragged like needles). */
export function tuftClump(cx, cy, cz, rx, ry, rz, seed, part = 1, detail = 2) {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const p = geo.attributes.position;
    const out = [];
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const n = 0.72 + 0.26 * simplex(x * 2.3 + seed, y * 2.3 + z * 1.7 - seed) + 0.18 * Math.abs(simplex(x * 7.1 - seed, z * 7.1 + y * 3.3));
        out.push([cx + x * rx * n, cy + y * ry * n, cz + z * rz * n]);
    }
    geo.dispose();
    const pos = [];
    const nrm = [];
    for (let i = 0; i < out.length; i += 3) {
        const a = new THREE.Vector3(...out[i]);
        const b = new THREE.Vector3(...out[i + 1]);
        const c = new THREE.Vector3(...out[i + 2]);
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        // Blend with the clump's radial normal so a clump reads round, not faceted.
        const centre = new THREE.Vector3(cx, cy, cz);
        for (const v of [a, b, c]) {
            const radial = new THREE.Vector3().subVectors(v, centre).normalize();
            const m = radial.multiplyScalar(0.6).addScaledVector(n, 0.4).normalize();
            pos.push(v.x, v.y, v.z);
            nrm.push(m.x, m.y, m.z);
        }
    }
    return { pos, nrm, part };
}

function geometryOf(pieces) {
    const pos = [];
    const nrm = [];
    const part = [];
    for (const p of pieces) {
        pos.push(...p.pos);
        nrm.push(...p.nrm);
        for (let i = 0; i < p.pos.length / 3; i++) part.push(p.part);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    g.computeBoundingSphere();
    return g;
}

// ── The old pine ──────────────────────────────────────────────────────────────────

/** The hero pine's shape (metres, relative to its foot): trunk, branches and crown clumps. */
export function heroPineGeometry() {
    const random = mulberry32(0x7a1e);
    const pieces = [];
    // The trunk leans out toward the view and right, as coast pines lean toward the light.
    const trunk = [[0, -0.6, 0], [0.12, 3, 0.05], [0.45, 6, -0.1], [1.0, 9, -0.25], [1.7, 11.8, -0.3], [2.3, 14.2, -0.2]];
    pieces.push(taperedTube(trunk, {
        r0: 0.36, r1: 0.08, rings: 34, sides: 11, flare: 0.3, wobble: 0.14, seed: 3,
    }));
    const at = (s) => {
        const c = new THREE.CatmullRomCurve3(trunk.map((p) => new THREE.Vector3(...p)));
        return c.getPointAt(s);
    };
    // Dead lower branches: grey stubs and twigs.
    for (const [s, dx, dy, dz, len] of [[0.3, -0.6, 0.15, 0.4, 1.4], [0.38, 0.7, 0.05, 0.5, 1.8], [0.44, -0.3, 0.2, -0.8, 1.3]]) {
        const o = at(s);
        const d = new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(len);
        pieces.push(taperedTube([[o.x, o.y, o.z], [o.x + d.x * 0.5, o.y + d.y * 0.5 - 0.1, o.z + d.z * 0.5], [o.x + d.x, o.y + d.y - 0.15, o.z + d.z]], {
            r0: 0.06, r1: 0.012, rings: 6, sides: 5, part: 2, seed: 9,
        }));
    }
    // Living branches, sweeping out and up, mostly toward the view (+x) and the eye (+z).
    const limbs = [
        [0.5, 1, 0.12, 0.3, 6.2], [0.55, 0.8, 0.18, -0.45, 4.6], [0.6, -0.7, 0.3, 0.35, 3.2], [0.66, 0.6, 0.16, 0.8, 5.4],
        [0.72, 1, 0.1, -0.1, 7.0], [0.78, -0.4, 0.45, -0.6, 3.0], [0.84, 0.85, 0.3, 0.3, 4.8], [0.9, 0.3, 0.55, 0.6, 3.6],
        [0.95, 0.9, 0.4, -0.3, 3.4], [0.62, 0.95, 0.05, 0.05, 5.8],
    ];
    const tips = [];
    for (const [s, dx, dy, dz, len] of limbs) {
        const o = at(s);
        const d = new THREE.Vector3(dx, dy, dz).normalize();
        const mid = o.clone().addScaledVector(d, len * 0.5).add(new THREE.Vector3(0, -0.25, 0));
        const end = o.clone().addScaledVector(d, len).add(new THREE.Vector3(0, 0.2 + random() * 0.4, 0));
        pieces.push(taperedTube([[o.x, o.y, o.z], [mid.x, mid.y, mid.z], [end.x, end.y, end.z]], {
            r0: 0.09, r1: 0.025, rings: 10, sides: 6, part: 0, seed: Math.round(s * 100),
        }));
        tips.push([end, d, len]);
    }
    // The crown: tufted clumps at the ends and along the outer half of each branch, flat-topped.
    let seed = 1;
    for (const [end, d, len] of tips) {
        const clumps = 3 + Math.round(len * 0.8);
        for (let k = 0; k < clumps; k++) {
            const back = (k / clumps) * len * 0.7;
            const c = end.clone().addScaledVector(d, -back);
            c.x += (random() - 0.5) * 0.9;
            c.y += (random() - 0.3) * 0.5;
            c.z += (random() - 0.5) * 0.9;
            const r = 0.8 + random() * 0.75;
            // A clump is a cluster of small tufts: a lumpy, fluffy mass with gaps, never a slab.
            const tufts = 5 + Math.floor(random() * 4);
            for (let k2 = 0; k2 < tufts; k2++) {
                const a2 = random() * Math.PI * 2;
                const reach2 = r * (0.25 + random() * 0.75);
                const rr = r * (0.38 + random() * 0.3);
                pieces.push(tuftClump(
                    c.x + Math.cos(a2) * reach2,
                    c.y + (random() - 0.35) * r * 0.55,
                    c.z + Math.sin(a2) * reach2,
                    rr * 1.15,
                    rr * (0.6 + random() * 0.35),
                    rr,
                    seed++,
                    1,
                    1,
                ));
            }
        }
    }
    // The leader's own tuft at the top.
    const top = at(1);
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        pieces.push(tuftClump(top.x + Math.cos(a) * 0.8, top.y + 0.2 + random() * 0.6, top.z + Math.sin(a) * 0.8, 0.75, 0.5, 0.7, seed++, 1, 1));
    }
    return geometryOf(pieces);
}

/** Bark (0), needles (1) and dead wood (2), for the old pine. */
function pineMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastOldPine';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const part = attribute('aPart', 'float');
    // The crown breathes in the wind (a constant rate; more at the branch ends).
    material.positionNode = Fn(() => {
        const p = positionLocal;
        const reach = clamp(p.y.sub(6.0).div(10.0), 0.0, 1.0).mul(part.equal(1.0).select(1.0, 0.4));
        const sway = sin(u.time.mul(0.6).add(p.x.mul(0.3))).mul(0.06).mul(reach)
            .add(sin(u.time.mul(1.7).add(p.z.mul(0.9).add(p.y))).mul(0.025).mul(reach));
        return p.add(vec3(sway, 0.0, sway.mul(0.6)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const h = positionLocal.y;
        // Bark: furrowed plates, grey-brown low, flaking orange-red higher.
        const plates = texture(t.noise, vec2(P.x.add(P.z).mul(1.6), P.y.mul(0.5))).a;
        const furrow = smoothstep(0.35, 0.6, plates);
        const low = mix(vec3(0.05, 0.04, 0.035), vec3(0.17, 0.13, 0.1), furrow);
        const high = mix(vec3(0.1, 0.045, 0.025), vec3(0.28, 0.11, 0.045), furrow);
        const bark = mix(low, high, smoothstep(5.0, 9.0, h));
        const dead = vec3(0.24, 0.22, 0.2);
        // Needles: clumps of dark and sunlit green, fine needle-scale variation.
        const fine = texture(t.noise, P.xz.mul(2.6).add(P.y.mul(1.3))).a;
        const needles = mix(vec3(0.02, 0.04, 0.018), vec3(0.08, 0.12, 0.035), smoothstep(0.3, 0.75, fine));
        const albedo = mix(mix(bark, dead, part.equal(2.0).select(1.0, 0.0)), needles, part.equal(1.0).select(1.0, 0.0));
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(0.3).div(1.3), 0.0, 1.0);
        const view = normalize(P.sub(u.eye));
        const rim = float(1.0).sub(clamp(dot(n, view.negate()), 0.0, 1.0));
        const through = clamp(dot(view, L), 0.0, 1.0).pow(5.0).mul(rim).mul(1.2)
            .mul(part.equal(1.0).select(1.0, 0.0));
        const shadow = shadowAt(t.shadow, P.xz);
        // Inside the crown it is darker (the clumps shade each other).
        const deep = part.equal(1.0).select(clamp(n.y.mul(0.35).add(0.75), 0.4, 1.0), float(1.0).sub(smoothstep(8.0, 11.0, h).mul(0.75)));
        const direct = u.sun.mul(wrap.add(through)).mul(shadow).mul(u.sunUp).mul(deep);
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65)).mul(deep);
        const lit = albedo.mul(direct.add(sky).add(u.bounce.mul(0.6)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

// ── The trail sign ────────────────────────────────────────────────────────────────

/** Board sizes (metres) and their texts. */
export const SIGN = Object.freeze({
    post: { w: 0.12, h: 2.05 },
    boards: Object.freeze([
        Object.freeze({
            text: 'HÖGA KUSTEN', w: 1.46, h: 0.3, y: 1.62, arrow: 0,
        }),
        Object.freeze({
            text: 'VÄRLDSARV', w: 1.12, h: 0.24, y: 1.2, arrow: 0.18,
        }),
    ]),
    texture: { w: 512, h: 96 },
});

function signTexture() {
    const { w, h } = SIGN.texture;
    const data = new Uint8Array(w * h * 2 * 4);
    SIGN.boards.forEach((b, k) => {
        const field = bakeSignField(b.text, w, h);
        for (let i = 0; i < w * h; i++) {
            data[(k * w * h + i) * 4] = field[i];
            data[(k * w * h + i) * 4 + 3] = 255;
        }
    });
    const tex = new THREE.DataTexture(data, w, h * 2, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'high-coast-sign';
    tex.needsUpdate = true;
    return tex;
}

/** A board's outline (a rectangle, or with an arrow point on the right) as an extruded shape. */
function boardGeometry(board) {
    const s = new THREE.Shape();
    const { w, h, arrow } = board;
    s.moveTo(0, 0);
    s.lineTo(w - arrow, 0);
    if (arrow > 0) s.lineTo(w, h / 2);
    s.lineTo(w - arrow, h);
    s.lineTo(0, h);
    s.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(s, {
        depth: 0.045, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1,
    });
    geo.translate(-0.08, -h / 2, 0.06);
    return geo;
}

function signMaterial(u, t, letters, k = 0) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = `HighCoastSign${k}`;
    material.fog = false;
    const board = k >= 0 ? SIGN.boards[k] : null;
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const grain = texture(t.noise, vec2(P.x.add(P.z).mul(1.2), P.y.mul(24.0))).a;
        const plank = mix(vec3(0.12, 0.08, 0.05), vec3(0.24, 0.17, 0.1), grain);
        // Weathered: silver-grey toward the edges and on the top, where the rain sits.
        const silver = mix(plank, vec3(0.3, 0.29, 0.27), smoothstep(0.55, 0.9, texture(t.noise, P.xz.mul(3.0).add(P.y)).g).mul(0.6));
        let albedo = silver;
        if (board) {
            // An extruded shape keeps its shape coordinates as uv (metres along the board, up it).
            const st = uv();
            const bu = st.x.div(board.w);
            const bv = st.y.div(board.h);
            const front = smoothstep(0.5, 0.8, dot(n, normalize(u.eye.sub(P))));
            const sample = texture(letters, vec2(bu, bv.add(k).div(2.0))).r;
            const w = fwidth(sample).max(0.004);
            const ink = smoothstep(float(0.5).sub(w), float(0.5).add(w), sample).mul(front);
            // Carved and painted: cream letters with a darker groove edge.
            const edge = smoothstep(0.35, 0.5, sample).sub(ink).max(0.0);
            albedo = mix(silver.mul(float(1.0).sub(edge.mul(0.6))), vec3(0.72, 0.68, 0.56), ink);
        }
        const L = u.sunDir;
        const ndl = clamp(dot(n, L), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const lit = albedo.mul(u.sun.mul(ndl).mul(shadow).mul(u.sunUp).add(u.fill.mul(n.y.mul(0.3).add(0.7)))
            .add(u.bounce.mul(0.5)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

// ── Boulders and heath ────────────────────────────────────────────────────────────

/** Where the boulders and heath tufts lie: on the summit rock the frame shows. */
export function nearSites(fields, { boulders = 34, tufts = 240, seed = 0xb01d } = {}) {
    const random = mulberry32(seed);
    const rocks = [];
    const heath = [];
    const keepClear = (x, z, r) => Math.hypot(x - PLACES.pine.x, z - PLACES.pine.z) < 1.4 + r
        || Math.hypot(x - PLACES.sign.x, z - PLACES.sign.z) < 1.2 + r;
    let tries = 0;
    while (rocks.length < boulders && tries++ < boulders * 80) {
        const a = (random() * 2 - 1) * 46 * (Math.PI / 180);
        const d = 7 + 40 * random() ** 1.4;
        const x = EYE.x + Math.sin(a) * d;
        const z = EYE.z - Math.cos(a) * d;
        const y = groundHeight(fields, x, z, true);
        const r = 0.22 + random() ** 2.4 * 0.95;
        if (y < 138 || keepClear(x, z, r)) continue;
        if (rocks.some((b) => Math.hypot(b.x - x, b.z - z) < (b.r + r) * 1.15)) continue;
        rocks.push({
            x, y, z, r, seed: random(), yaw: random() * 6.283, squash: 0.55 + random() * 0.3,
        });
    }
    tries = 0;
    // Heath grows in drifts: pick a few centres, then tufts round them.
    const centres = Array.from({ length: 16 }, () => {
        const a = (random() * 2 - 1) * 48 * (Math.PI / 180);
        const d = 6 + 34 * random();
        return [EYE.x + Math.sin(a) * d, EYE.z - Math.cos(a) * d];
    });
    while (heath.length < tufts && tries++ < tufts * 40) {
        const c = centres[Math.floor(random() * centres.length)];
        const x = c[0] + (random() - 0.5) * 7;
        const z = c[1] + (random() - 0.5) * 7;
        const y = groundHeight(fields, x, z, true);
        if (y < 138 || keepClear(x, z, 0.2)) continue;
        if (Math.hypot(x - EYE.x, z - EYE.z) < 5) continue;
        if (rocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 0.9)) continue;
        heath.push({
            x, y, z, r: 0.25 + random() * 0.55, kind: random(), seed: random(),
        });
    }
    return { rocks, heath };
}

function boulderGeometry() {
    const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 4));
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        // Glacier-rounded, a little blocky: two scales of lumps and a flattened base.
        const n = 1 + 0.16 * simplex(x * 1.4 + 3.1, z * 1.4 + y * 0.9) + 0.06 * simplex(x * 3.7 - y * 2.1, z * 3.7);
        p.setXYZ(i, x * n, (y < 0 ? y * 0.55 : y) * n, z * n);
    }
    geo.computeVertexNormals();
    return geo;
}

function nearMaterial(u, t, kind) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = kind === 'rock' ? 'HighCoastBoulders' : 'HighCoastHeath';
    material.fog = false;
    const inst = attribute('aNear', 'vec4');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        let albedo;
        if (kind === 'rock') {
            const N1 = texture(t.noise, P.xz.mul(0.7).add(P.y.mul(0.31)));
            const N2 = texture(t.noise, P.xz.mul(3.1).add(P.y.mul(1.7)));
            const base = mix(vec3(0.3, 0.2, 0.16), vec3(0.32, 0.31, 0.28), smoothstep(0.35, 0.7, N1.r));
            // Lichen: pale crust on the tops, yellow-green map lichen in patches, a dark underside.
            const crust = smoothstep(0.55, 0.7, N2.b).mul(smoothstep(-0.2, 0.6, n.y));
            const map = smoothstep(0.66, 0.72, N2.g).mul(smoothstep(0.0, 0.7, n.y));
            albedo = mix(mix(base, vec3(0.5, 0.5, 0.45), crust.mul(0.7)), vec3(0.3, 0.37, 0.08), map.mul(0.7))
                .mul(smoothstep(-0.8, 0.2, n.y).mul(0.45).add(0.55)).mul(inst.w.mul(0.25).add(0.88));
        } else {
            // Heather (purple-brown, pink in flower), crowberry (dark green), reindeer lichen (pale).
            const fine = texture(t.noise, P.xz.mul(9.0).add(P.y.mul(4.0))).a;
            const heather = mix(vec3(0.07, 0.045, 0.05), vec3(0.36, 0.1, 0.24), smoothstep(0.55, 0.75, fine));
            const crowberry = mix(vec3(0.018, 0.03, 0.015), vec3(0.05, 0.075, 0.03), fine);
            const reindeer = mix(vec3(0.38, 0.4, 0.34), vec3(0.55, 0.57, 0.5), fine);
            const k = inst.z;
            albedo = mix(mix(heather, crowberry, smoothstep(0.45, 0.55, k)), reindeer, smoothstep(0.82, 0.88, k));
        }
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(kind === 'rock' ? 0.05 : 0.3).div(kind === 'rock' ? 1.05 : 1.3), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const lit = albedo.mul(u.sun.mul(wrap).mul(shadow).mul(u.sunUp).add(u.fill.mul(n.y.mul(0.4).add(0.6)))
            .add(u.bounce.mul(0.6)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

// ── The part ──────────────────────────────────────────────────────────────────────

export function createProps(u, t, tier, fields) {
    const meshes = [];
    const disposables = [];
    const ground = (x, z) => groundHeight(fields, x, z, true);

    // The old pine.
    const pineGeo = heroPineGeometry();
    const pineMat = pineMaterial(u, t);
    const pine = new THREE.Mesh(pineGeo, pineMat);
    pine.name = 'HighCoastOldPine';
    pine.position.set(PLACES.pine.x, ground(PLACES.pine.x, PLACES.pine.z) - 0.6, PLACES.pine.z);
    pine.rotation.y = 0.35;
    pine.frustumCulled = false;
    pine.renderOrder = 3;
    meshes.push(pine);
    disposables.push(pineGeo, pineMat);

    // The trail sign: a post, two boards turned toward the eye (a little to the right).
    const letters = signTexture();
    disposables.push(letters);
    const sign = new THREE.Group();
    sign.name = 'HighCoastSign';
    const baseY = ground(PLACES.sign.x, PLACES.sign.z);
    sign.position.set(PLACES.sign.x, baseY - 0.45, PLACES.sign.z);
    sign.rotation.y = Math.atan2(EYE.x - PLACES.sign.x, EYE.z - PLACES.sign.z) - 0.3;
    const postGeo = new THREE.BoxGeometry(SIGN.post.w, SIGN.post.h, SIGN.post.w);
    postGeo.translate(0, SIGN.post.h / 2, 0);
    const postMat = signMaterial(u, t, letters, -1);
    const post = new THREE.Mesh(postGeo, postMat);
    sign.add(post);
    disposables.push(postGeo, postMat);
    SIGN.boards.forEach((b, k) => {
        const geo = boardGeometry(b);
        const mat = signMaterial(u, t, letters, k);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, b.y, 0);
        sign.add(mesh);
        disposables.push(geo, mat);
    });
    sign.traverse((o) => {
        o.frustumCulled = false;
        o.renderOrder = 3;
    });
    meshes.push(sign);

    // Boulders and heath.
    const sites = nearSites(fields, { boulders: tier.props > 0 ? 34 : 18, tufts: 0 });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (const [list, geoFn, kind] of [[sites.rocks, boulderGeometry, 'rock']]) {
        const geo = geoFn();
        const data = new Float32Array(Math.max(1, list.length) * 4);
        list.forEach((s, i) => data.set([s.r, s.seed, s.kind ?? 0, s.seed], i * 4));
        geo.setAttribute('aNear', new THREE.InstancedBufferAttribute(data, 4));
        const mat = nearMaterial(u, t, kind);
        const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
        mesh.name = kind === 'rock' ? 'HighCoastBoulders' : 'HighCoastHeath';
        list.forEach((s, i) => {
            e.set(0, s.yaw ?? s.seed * 6.283, 0);
            q.setFromEuler(e);
            if (kind === 'rock') {
                sc.set(s.r * 1.2, s.r * s.squash, s.r);
                pos.set(s.x, s.y - 0.32 + s.r * s.squash * 0.22, s.z);
            } else {
                sc.set(s.r * 1.3, s.r, s.r * 1.2);
                pos.set(s.x, s.y - 0.04, s.z);
            }
            m.compose(pos, q, sc);
            mesh.setMatrixAt(i, m);
        });
        mesh.count = Math.max(1, list.length);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        meshes.push(mesh);
        disposables.push(geo, mat);
    }

    return {
        mesh: meshes[0],
        meshes,
        sites,
        update() {},
        dispose() {
            for (const d of disposables) d.dispose();
            for (const mesh of meshes) mesh.dispose?.();
        },
    };
}

export { max };
