/**
 * High Coast — the old pine on the knoll left of the eye.
 *
 * An old Scots pine as the High Coast grows them on bare granite: a trunk that leans out toward
 * the light, grey-brown and furrowed into long plates low down, thin orange-red flaking bark
 * higher up; limbs that run out level and turn up at their ends, each splitting into side shoots;
 * and the foliage as flat-topped plates of needle tufts at the shoots' ends, with sky between them.
 *
 *  - Wood: one mesh of tapering tubes carrying bark coordinates (metres round the stem, metres
 *    along it), shaded as plates and furrows (low) or papery flakes (high) from the shared Voronoi.
 *    The coordinates' seam is turned to the side the eye never sees.
 *  - Needles: each tuft is two crossed cards with a bottlebrush shoot drawn here, alpha-tested; the
 *    texture's mip chain keeps the needles' coverage, so plates do not thin out with distance. A
 *    tuft carries its plate's dome normal (the plate is lit as a mass: top bright, underside dark),
 *    its depth in the plate and how open it is to the sky (traced on the CPU against the other
 *    plates), so each plate shades as a volume; with the sun behind, its thin edge glows.
 *  - Shadow: a patch of the summit round the tree, laid on the land and multiplied into it. The
 *    sun's ray from each point is tested against the plates (flattened spheres) and the trunk: a
 *    soft shadow that follows the hour, plus the darkening at the trunk's foot and under the crown.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    int,
    length,
    mix,
    modelWorldMatrix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    step,
    texture,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { EYE, mulberry32 } from './high-coast-core.js';
import { hcCells, outcropRelief } from './high-coast-land.js';
import { aerial } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';

// ── The tree's plan (metres from its foot, in its own frame) ──────────────────────────

/** The trunk's centre line: it leans out toward the view and the light. */
const TRUNK = [[0, -0.6, 0], [0.12, 3, 0.05], [0.45, 6, -0.1], [1.0, 9, -0.25], [1.7, 11.8, -0.3], [2.3, 14.2, -0.2]];
/** Living limbs: where on the trunk (0..1), the way they run, how long they are. */
const LIMBS = [
    [0.5, 1, 0.12, 0.3, 6.2], [0.55, 0.8, 0.18, -0.45, 4.6], [0.6, -0.7, 0.3, 0.35, 3.2], [0.66, 0.6, 0.16, 0.8, 5.4],
    [0.72, 1, 0.1, -0.1, 7.0], [0.78, -0.4, 0.45, -0.6, 3.0], [0.84, 0.85, 0.3, 0.3, 4.8], [0.9, 0.3, 0.55, 0.6, 3.6],
    [0.95, 0.9, 0.4, -0.3, 3.4], [0.62, 0.95, 0.05, 0.05, 5.8],
];
/** Dead lower branches: grey stubs. */
const DEAD = [[0.3, -0.6, -0.25, 0.4, 0.55], [0.38, 0.7, -0.3, 0.5, 0.7], [0.44, -0.3, -0.2, -0.8, 0.45], [0.24, 0.5, -0.35, -0.6, 0.35]];

/**
 * The foliage: plate thickness over width; tufts per square metre of plate by props tier; the
 * needle cards' length (metres); how much light a plate lets through in the shadow.
 */
export const PINE_FOLIAGE = Object.freeze({
    flat: 0.5, density: [12, 20, 28], card: [0.55, 0.9], porous: 0.25,
});

/** Where bark turns from plates to flakes (metres up the trunk). */
const BARK_TURN = [6.0, 9.0];

const up = new THREE.Vector3(0, 1, 0);

/** The pine's frame in the world: where its foot stands and how it is turned. */
export function pineFrame(footX, footY, footZ, yaw = 0.35) {
    const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(footX, footY, footZ),
        new THREE.Quaternion().setFromAxisAngle(up, yaw),
        new THREE.Vector3(1, 1, 1),
    );
    return {
        matrix, inverse: matrix.clone().invert(), foot: new THREE.Vector3(footX, footY, footZ), yaw,
    };
}

// ── Geometry ──────────────────────────────────────────────────────────────────────────

/**
 * A tapering tube along points (a Catmull-Rom curve), indexed, with analytic normals, bark
 * coordinates (`aBark`: metres round from the seam, metres along) and a part id. `away` is the
 * direction the seam faces (a local direction, or a function of the ring's centre).
 */
function tube(points, {
    r0, r1, rings, sides, flare = 0, wobble = 0, seed = 1, part = 0, away = up,
}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const frames = curve.computeFrenetFrames(rings, false);
    const total = curve.getLength();
    const random = mulberry32(seed);
    const bumps = Array.from({ length: sides }, () => 1 + (random() - 0.5) * wobble);
    const pos = [];
    const nrm = [];
    const bark = [];
    const index = [];
    const n = new THREE.Vector3();
    const a = new THREE.Vector3();
    for (let i = 0; i <= rings; i++) {
        const s = i / rings;
        const c = curve.getPointAt(s);
        const N = frames.normals[i];
        const B = frames.binormals[i];
        const r = r0 + (r1 - r0) * s ** 0.85 + flare * Math.max(0, 1 - s / 0.07) ** 2;
        // The seam's angle on this ring: the way `away` points, projected into the ring's plane.
        if (typeof away === 'function') a.copy(away(c));
        else a.copy(away);
        const a0 = Math.atan2(a.dot(B), a.dot(N));
        for (let k = 0; k <= sides; k++) {
            const ang = a0 + (k / sides) * Math.PI * 2;
            n.set(0, 0, 0).addScaledVector(N, Math.cos(ang)).addScaledVector(B, Math.sin(ang)).normalize();
            const kk = k % sides;
            const rr = r * bumps[kk] * (1 + 0.05 * Math.sin(s * 31 + kk * 2.1));
            pos.push(c.x + n.x * rr, c.y + n.y * rr, c.z + n.z * rr);
            nrm.push(n.x, n.y, n.z);
            bark.push((k / sides) * Math.PI * 2 * r, s * total);
        }
    }
    const row = sides + 1;
    for (let i = 0; i < rings; i++) {
        for (let k = 0; k < sides; k++) {
            const p0 = i * row + k;
            const p1 = p0 + 1;
            const p2 = p0 + row;
            const p3 = p2 + 1;
            index.push(p0, p2, p1, p1, p2, p3);
        }
    }
    return {
        pos, nrm, bark, index, part, curve,
    };
}

/** Merge tube pieces into one indexed geometry with `aBark` and `aPart`. */
function woodGeometry(pieces) {
    const pos = [];
    const nrm = [];
    const bark = [];
    const part = [];
    const index = [];
    for (const p of pieces) {
        const base = pos.length / 3;
        pos.push(...p.pos);
        nrm.push(...p.nrm);
        bark.push(...p.bark);
        for (let i = 0; i < p.pos.length / 3; i++) part.push(p.part);
        for (const i of p.index) index.push(base + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aBark', new THREE.Float32BufferAttribute(bark, 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    g.computeBoundingSphere();
    return g;
}

/** Rotate `v` about the unit axis `k` by `angle` (Rodrigues). */
function rotateAbout(v, k, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const cross = new THREE.Vector3().crossVectors(k, v);
    return v.clone().multiplyScalar(c).add(cross.multiplyScalar(s)).addScaledVector(k, k.dot(v) * (1 - c));
}

/**
 * The tree's plan: the wood (trunk, limbs, side shoots, dead stubs) and the foliage plates (centre,
 * radius, the way the shoot that carries it points). Deterministic. `eyeLocal` is the eye in the
 * tree's own frame (the trunk's seam faces away from it).
 */
export function pinePlan(eyeLocal = new THREE.Vector3(8, 6, 19), groundLocal = () => 0.6) {
    const random = mulberry32(0x7a1e);
    const wood = [];
    const plates = [];
    const trunkCurve = new THREE.CatmullRomCurve3(TRUNK.map((p) => new THREE.Vector3(...p)));
    const at = (s) => trunkCurve.getPointAt(s);
    wood.push(tube(TRUNK, {
        r0: 0.36,
        r1: 0.08,
        rings: 56,
        sides: 18,
        flare: 0.5,
        wobble: 0.12,
        seed: 3,
        part: 0,
        away: (c) => new THREE.Vector3().subVectors(c, eyeLocal).normalize(),
    }));
    // Roots running out over the granite from the flare, sunk a little into the rock as they go.
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.4 + random() * 0.5;
        const len = 1.3 + random() * 1.2;
        const pts = [[Math.cos(a) * 0.18, 0.45, Math.sin(a) * 0.18]];
        for (const f of [0.35, 0.7, 1]) {
            const x = Math.cos(a + (random() - 0.5) * 0.3) * len * f;
            const z = Math.sin(a + (random() - 0.5) * 0.3) * len * f;
            pts.push([x, groundLocal(x, z) - 0.05 - 0.05 * f, z]);
        }
        wood.push(tube(pts, {
            r0: 0.17, r1: 0.035, rings: 9, sides: 7, part: 0, seed: 70 + k, wobble: 0.15,
        }));
    }
    for (const [s, dx, dy, dz, len] of DEAD) {
        const o = at(s);
        const d = new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(len);
        wood.push(tube([[o.x, o.y, o.z], [o.x + d.x * 0.5, o.y + d.y * 0.5 - 0.1, o.z + d.z * 0.5], [o.x + d.x, o.y + d.y - 0.18, o.z + d.z]], {
            r0: 0.085, r1: 0.055, rings: 4, sides: 7, part: 2, seed: 9,
        }));
    }
    for (const [s, dx, dy, dz, len] of LIMBS) {
        const o = at(s);
        const d = new THREE.Vector3(dx, dy, dz).normalize();
        const flat = new THREE.Vector3(d.x, 0, d.z).normalize();
        // Out nearly level, sagging a little, then turning up at the end (an old pine's limb).
        const p1 = o.clone().addScaledVector(d, len * 0.32).add(new THREE.Vector3(0, -0.12, 0));
        const p2 = o.clone().addScaledVector(flat, len * 0.68).add(new THREE.Vector3(0, d.y * len * 0.4 - 0.05, 0));
        const end = o.clone().addScaledVector(flat, len).add(new THREE.Vector3(0, d.y * len * 0.45 + 0.35 + random() * 0.4, 0));
        const limb = tube([[o.x, o.y, o.z], [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z], [end.x, end.y, end.z]], {
            r0: 0.07 + len * 0.008, r1: 0.028, rings: 14, sides: 8, part: 1, seed: Math.round(s * 100), wobble: 0.1,
        });
        wood.push(limb);
        // The limb's own plate at its end, the largest.
        plates.push({ c: end.clone().add(new THREE.Vector3(0, 0.18, 0)), R: 1.15 + random() * 0.45 + len * 0.03, dir: flat.clone() });
        // Side shoots along the outer part, alternating sides, each ending in a plate.
        const shoots = 2 + Math.floor(len * 0.45);
        for (let k = 0; k < shoots; k++) {
            const f = 0.38 + (0.52 * (k + 0.5 + (random() - 0.5) * 0.4)) / shoots;
            const from = limb.curve.getPointAt(f);
            const side = (k % 2 ? 1 : -1) * (0.7 + random() * 0.55);
            const dir = rotateAbout(flat, up, side).setY(0.25 + random() * 0.4).normalize();
            const l = (0.9 + random() * 0.8) * (0.75 + len / 14);
            const tip = from.clone().addScaledVector(dir, l).add(new THREE.Vector3(0, 0.15 + random() * 0.25, 0));
            const mid = from.clone().addScaledVector(dir, l * 0.5).add(new THREE.Vector3(0, -0.05, 0));
            wood.push(tube([[from.x, from.y, from.z], [mid.x, mid.y, mid.z], [tip.x, tip.y, tip.z]], {
                r0: 0.032, r1: 0.012, rings: 5, sides: 5, part: 1, seed: 40 + plates.length,
            }));
            plates.push({ c: tip.clone().add(new THREE.Vector3(0, 0.12, 0)), R: 0.7 + random() * 0.45 + len * 0.025, dir: new THREE.Vector3(dir.x, 0, dir.z).normalize() });
        }
    }
    // The leader: a crown of three plates on the trunk's top.
    const top = at(1);
    const lean = new THREE.Vector3().subVectors(at(1), at(0.9)).setY(0).normalize();
    plates.push({ c: top.clone().add(new THREE.Vector3(0, 0.45, 0)), R: 1.25, dir: lean.clone() });
    for (let k = 0; k < 2; k++) {
        const dir = rotateAbout(lean, up, k ? 1.9 : -1.6);
        plates.push({ c: top.clone().addScaledVector(dir, 1.1).add(new THREE.Vector3(0, -0.15, 0)), R: 0.9, dir });
    }
    return { wood, plates };
}

/** Ray against a plate's flattened sphere: true if `o + t·d` (t > 0) passes inside it. */
function hitsPlate(o, d, plate, flat) {
    const sy = 1 / flat;
    const ox = (o.x - plate.c.x) / plate.R;
    const oy = ((o.y - plate.c.y) / plate.R) * sy;
    const oz = (o.z - plate.c.z) / plate.R;
    const dx = d.x / plate.R;
    const dy = (d.y / plate.R) * sy;
    const dz = d.z / plate.R;
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (ox * dx + oy * dy + oz * dz);
    const c = ox * ox + oy * oy + oz * oz - 1;
    if (c < 0) return true;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    return (-b - Math.sqrt(disc)) / (2 * a) > 0;
}

/** Sky directions the tufts are traced along (the upper hemisphere and a little below level). */
const SKY_DIRS = (() => {
    const out = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
        const y = 0.05 + 0.95 * ((i + 0.5) / n);
        const r = Math.sqrt(1 - y * y);
        const a = i * 2.39996;
        out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    return out;
})();

/**
 * The needle tufts: two crossed cards per tuft, in plates. Attributes: `uv` (the card), `aTuft`
 * (the plate's dome normal at the tuft, local; sky openness), `aSeed` (hash, depth in the plate,
 * height in the crown, 0).
 */
export function needleGeometry(plates, { density = PINE_FOLIAGE.density[1], seed = 0x9e3d } = {}) {
    const random = mulberry32(seed);
    const { flat, card } = PINE_FOLIAGE;
    const tufts = [];
    let lo = Infinity;
    let hi = -Infinity;
    plates.forEach((plate, pi) => {
        const count = Math.max(6, Math.round(density * Math.PI * plate.R * plate.R));
        for (let k = 0; k < count; k++) {
            // A point on (mostly near) the plate's shell; the underside flatter than the top.
            const zz = 2 * random() - 1;
            const ph = random() * Math.PI * 2;
            const rr = Math.sqrt(1 - zz * zz);
            const dirS = new THREE.Vector3(rr * Math.cos(ph), zz, rr * Math.sin(ph));
            const shell = 1 - random() ** 2 * 0.5;
            const off = new THREE.Vector3(dirS.x * plate.R * shell, dirS.y * plate.R * flat * shell, dirS.z * plate.R * shell);
            if (off.y < 0) off.y *= 0.7;
            const p = plate.c.clone().add(off);
            // The dome's normal at that point (the ellipsoid's gradient).
            const nrm = new THREE.Vector3(off.x / plate.R ** 2, off.y / (plate.R * flat) ** 2, off.z / plate.R ** 2).normalize();
            const depth = (1 - shell) / 0.5;
            // The shoot points outward from the plate's middle and toward its branch's way, tilted up.
            const outward = new THREE.Vector3(off.x, 0, off.z);
            if (outward.lengthSq() < 1e-6) outward.copy(plate.dir);
            outward.normalize().addScaledVector(plate.dir, 0.45).normalize();
            const tilt = off.y < 0 ? -0.15 + random() * 0.35 : 0.25 + random() * 0.65;
            const twig = outward.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt)).normalize();
            tufts.push({
                p, nrm, depth, twig, plate: pi, len: card[0] + random() * (card[1] - card[0]), spin: random() * Math.PI, hash: random(),
            });
            lo = Math.min(lo, p.y);
            hi = Math.max(hi, p.y);
        }
    });
    // How open each tuft is to the sky: rays against the other plates (they let a little through).
    const o = new THREE.Vector3();
    for (const tf of tufts) {
        o.copy(tf.p).addScaledVector(tf.nrm, 0.08);
        let open = 0;
        for (const d of SKY_DIRS) {
            let pass = 1;
            for (let j = 0; j < plates.length; j++) {
                if (j === tf.plate) continue;
                if (hitsPlate(o, d, plates[j], flat)) pass *= PINE_FOLIAGE.porous;
                if (pass < 0.02) break;
            }
            open += pass;
        }
        tf.open = open / SKY_DIRS.length;
    }
    const n = tufts.length * 8;
    const pos = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const tuftA = new Float32Array(n * 4);
    const seedA = new Float32Array(n * 4);
    const index = new Uint32Array(tufts.length * 12);
    let v = 0;
    let ix = 0;
    const side0 = new THREE.Vector3();
    for (const tf of tufts) {
        const w = tf.len * 0.82;
        side0.crossVectors(tf.twig, up);
        if (side0.lengthSq() < 1e-6) side0.set(1, 0, 0);
        side0.normalize();
        const sideA = rotateAbout(side0, tf.twig, tf.spin);
        const sideB = new THREE.Vector3().crossVectors(tf.twig, sideA).normalize();
        const base = tf.p.clone().addScaledVector(tf.twig, -tf.len * 0.3);
        const tip = base.clone().addScaledVector(tf.twig, tf.len);
        const hf = (tf.p.y - lo) / Math.max(1e-3, hi - lo);
        for (const side of [sideA, sideB]) {
            const corners = [
                [base, -0.5, 0, 0], [base, 0.5, 1, 0], [tip, 0.5, 1, 1], [tip, -0.5, 0, 1],
            ];
            const first = v;
            for (const [anchor, k, cu, cv] of corners) {
                pos[v * 3] = anchor.x + side.x * w * k;
                pos[v * 3 + 1] = anchor.y + side.y * w * k;
                pos[v * 3 + 2] = anchor.z + side.z * w * k;
                uvs[v * 2] = cu;
                uvs[v * 2 + 1] = cv;
                tuftA.set([tf.nrm.x, tf.nrm.y, tf.nrm.z, tf.open], v * 4);
                seedA.set([tf.hash, tf.depth, hf, 0], v * 4);
                v++;
            }
            index.set([first, first + 1, first + 2, first, first + 2, first + 3], ix);
            ix += 6;
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('aTuft', new THREE.BufferAttribute(tuftA, 4));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 4));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    return { geometry: g, tufts: tufts.length };
}

// ── The needle texture ───────────────────────────────────────────────────────────────

/**
 * A bottlebrush shoot drawn into an RGBA8 texture: R the needles' own tone, G the twig, A the
 * coverage. Its mip chain is averaged on the CPU and each level's alpha is rescaled so the share
 * of texels an alpha test keeps stays what it is at full size (alpha-tested foliage otherwise
 * thins to nothing at a distance).
 */
export function bakeNeedleTexture(size = 128, seed = 0x5e1) {
    const random = mulberry32(seed);
    const cov = new Float32Array(size * size);
    const tone = new Float32Array(size * size);
    const twig = new Float32Array(size * size);
    const line = (x0, y0, x1, y1, w, t, isTwig) => {
        const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w - 1));
        const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + w + 1));
        const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w - 1));
        const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + w + 1));
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len2 = Math.max(1e-6, dx * dx + dy * dy);
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5;
                const py = y + 0.5;
                const h = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
                const d = Math.hypot(px - (x0 + dx * h), py - (y0 + dy * h));
                const a = Math.max(0, Math.min(1, w + 0.5 - d));
                if (a <= 0) continue;
                const i = y * size + x;
                tone[i] = tone[i] * (1 - a) + t * a;
                twig[i] = twig[i] * (1 - a) + (isTwig ? 1 : 0) * a;
                cov[i] = Math.max(cov[i], a);
            }
        }
    };
    const S = size;
    // The shoot: a twig up the card's middle, curving a little.
    const twigAt = (v) => [S * (0.5 + 0.03 * Math.sin(v * 3.1)), S * (0.03 + 0.9 * v)];
    for (let k = 0; k < 24; k++) {
        const [x0, y0] = twigAt(k / 24);
        const [x1, y1] = twigAt((k + 1) / 24);
        line(x0, y0, x1, y1, S * (0.012 - 0.006 * (k / 24)), 0.35, true);
    }
    // Needles in pairs along it, sweeping toward the tip, denser and shorter near the tip.
    const count = 44;
    for (let k = 0; k < count; k++) {
        const v = 0.1 + 0.88 * (k / count) ** 0.8 + (random() - 0.5) * 0.02;
        const [bx, by] = twigAt(Math.min(0.99, v));
        for (const sideSign of [-1, 1]) {
            const ang = (0.6 + random() * 0.6 - v * 0.3) * sideSign;
            // Seen from the side a bottlebrush's needles point every way: foreshortened lengths.
            const len = S * (0.24 + random() * 0.16) * (0.35 + 0.65 * random() ** 0.6) * (1 - (0.35 * Math.max(0, v - 0.75)) / 0.25);
            // A needle bends a little toward the tip: two segments.
            const mx = bx + Math.sin(ang) * len * 0.55;
            const my = by + Math.cos(ang) * len * 0.55;
            const ang2 = ang * 0.8;
            const tx = mx + Math.sin(ang2) * len * 0.45;
            const ty = my + Math.cos(ang2) * len * 0.45;
            const t = 0.55 + random() * 0.45;
            line(bx, by, mx, my, S * 0.0048, t * 0.85, false);
            line(mx, my, tx, ty, S * 0.004, t, false);
        }
    }
    // The tip's brush: a few short needles straight out of the end.
    const [ex, ey] = twigAt(0.97);
    for (let k = 0; k < 7; k++) {
        const ang = (k / 6 - 0.5) * 0.9;
        line(ex, ey, ex + Math.sin(ang) * S * 0.07, ey + Math.cos(ang) * S * 0.07, S * 0.005, 0.95, false);
    }
    // Texels the needles do not cover take the mean tone (no dark fringe where filtering reaches them).
    let mean = 0;
    let wsum = 0;
    for (let i = 0; i < S * S; i++) {
        mean += tone[i] * cov[i];
        wsum += cov[i];
    }
    mean /= Math.max(1e-6, wsum);
    const level0 = new Float32Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
        const c = cov[i];
        level0[i * 4] = c > 0 ? tone[i] : mean;
        level0[i * 4 + 1] = c > 0 ? twig[i] : 0;
        level0[i * 4 + 2] = 0;
        level0[i * 4 + 3] = c;
    }
    const kept = (lv) => {
        let k = 0;
        for (let i = 3; i < lv.length; i += 4) if (lv[i] > 0.5) k++;
        return k / (lv.length / 4);
    };
    const target = kept(level0);
    const mipmaps = [];
    const coverage = [];
    let lv = level0;
    let w = S;
    for (;;) {
        const bytes = new Uint8Array(lv.length);
        for (let i = 0; i < lv.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, lv[i])) * 255);
        mipmaps.push({ data: bytes, width: w, height: w });
        coverage.push(kept(lv));
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const o = (y * nw + x) * 4;
                let a = 0;
                let r = 0;
                let g = 0;
                for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                    const i = ((y * 2 + sy) * w + (x * 2 + sx)) * 4;
                    const aa = lv[i + 3] + 1e-4;
                    a += lv[i + 3];
                    r += lv[i] * aa;
                    g += lv[i + 1] * aa;
                    next[o + 2] += aa;
                }
                next[o] = r / next[o + 2];
                next[o + 1] = g / next[o + 2];
                next[o + 2] = 0;
                next[o + 3] = a / 4;
            }
        }
        // Keep the alpha test's share: scale this level's alpha until as many texels pass.
        {
            let s0 = 1;
            let s1 = 6;
            for (let it = 0; it < 18; it++) {
                const sm = (s0 + s1) / 2;
                let k = 0;
                for (let i = 3; i < next.length; i += 4) if (next[i] * sm > 0.5) k++;
                if (k / (nw * nw) < target) s0 = sm;
                else s1 = sm;
            }
            for (let i = 3; i < next.length; i += 4) next[i] = Math.min(1, next[i] * s1);
        }
        lv = next;
        w = nw;
    }
    const tex = new THREE.DataTexture(mipmaps[0].data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'high-coast-pine-needles';
    tex.needsUpdate = true;
    return { texture: tex, coverage };
}

// ── Materials ────────────────────────────────────────────────────────────────────────

/**
 * The crown's breath in the wind, the same field for wood and needles so they stay together:
 * nothing at the foot, more up the tree and out along the limbs.
 */
function sway(u, p) {
    const axis = vec2(p.y.mul(0.16), p.y.mul(-0.015));
    const out = length(p.xz.sub(axis));
    const reach = clamp(p.y.sub(5.5).div(9.0), 0.0, 1.0).mul(clamp(out.div(5.0), 0.0, 1.0).mul(0.75).add(0.25));
    const a = sin(u.time.mul(0.55).add(p.x.mul(0.22))).mul(0.075)
        .add(sin(u.time.mul(1.45).add(p.z.mul(0.7)).add(p.y.mul(0.5))).mul(0.028));
    return vec3(a, a.mul(0.25), a.mul(0.6)).mul(reach);
}

/** Bark (0), limb and shoot wood (1) and dead wood (2). */
function woodMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastPineWood';
    material.fog = false;
    const bark = attribute('aBark', 'vec2');
    const part = attribute('aPart', 'float');
    material.positionNode = Fn(() => positionLocal.add(sway(u, positionLocal)))();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const h = positionGeometry.y;
        const around = bark.x;
        const along = bark.y;
        const isTrunk = float(1.0).sub(step(0.5, part));
        const isDead = step(1.5, part);
        // Low on the trunk: long plates parted by deep furrows, each plate its own grey-brown.
        const warp = texture(t.noise, vec2(around.div(1.6), along.div(6.0))).g.sub(0.5);
        const plates = hcCells(vec2(around.add(warp.mul(0.09)).div(0.1), along.div(0.55)));
        const wide = texture(t.noise, vec2(around.div(0.8), along.div(2.5))).b;
        const furrow = float(1.0).sub(smoothstep(wide.mul(0.08).add(0.04), wide.mul(0.3).add(0.2), plates.y.sub(plates.x)));
        const streak = texture(t.noise, vec2(around.div(0.9), along.div(5.0))).a;
        const rough = texture(t.noise, vec2(around.div(0.35), along.div(0.7))).a;
        const plateTone = mix(vec3(0.085, 0.078, 0.07), vec3(0.15, 0.13, 0.112), plates.z).mul(streak.mul(0.3).add(0.75))
            .mul(rough.mul(0.35).add(0.82));
        const low = mix(plateTone, vec3(0.03, 0.018, 0.012), furrow.mul(0.95));
        // Higher: thin papery flakes, orange-red, a few silvered; each flake's edge a dark line.
        const flakes = hcCells(vec2(around.div(0.075), along.div(0.055)));
        const flakeTone = mix(vec3(0.26, 0.105, 0.05), vec3(0.44, 0.21, 0.1), flakes.z)
            .mul(streak.mul(0.25).add(0.85));
        const silver = smoothstep(0.76, 0.82, flakes.z);
        const edge = float(1.0).sub(smoothstep(0.0, 0.08, flakes.y.sub(flakes.x)));
        const high = mix(mix(flakeTone, vec3(0.3, 0.27, 0.24), silver.mul(0.8)), vec3(0.12, 0.045, 0.02), edge.mul(0.75));
        const turn = texture(t.noise, vec2(around.div(2.4), along.div(3.0))).r.sub(0.5).mul(2.4);
        const toHigh = smoothstep(BARK_TURN[0], BARK_TURN[1], h.add(turn)).mul(isTrunk).add(float(1.0).sub(isTrunk));
        const wood = mix(low, high, toHigh).toVar();
        // Limbs and shoots: the same flakes, greyer and finer toward their ends.
        wood.assign(mix(wood, vec3(0.2, 0.15, 0.115), float(1.0).sub(isTrunk).mul(smoothstep(0.5, 4.0, along).mul(0.55).add(0.25))));
        // Dead wood: silvered, split along its grain.
        const grain = hcCells(vec2(around.div(0.025), along.div(0.5)));
        const dead = mix(vec3(0.1, 0.092, 0.084), vec3(0.035, 0.03, 0.027), float(1.0).sub(smoothstep(0.0, 0.12, grain.y.sub(grain.x))).mul(0.7));
        const albedo = mix(wood, dead, isDead);
        // Light: the sun (the crown shades the upper trunk and the limbs inside it), the sky, a rim.
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(0.25).div(1.25), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const inCrown = smoothstep(7.5, 10.5, h).mul(0.6).add(float(1.0).sub(isTrunk).mul(0.25)).mul(float(1.0).sub(isDead));
        const direct = u.sun.mul(wrap).mul(shadow).mul(u.sunUp).mul(float(1.0).sub(inCrown));
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65)).mul(float(1.0).sub(inCrown.mul(0.45)));
        const view = normalize(P.sub(u.eye));
        const grazing = float(1.0).sub(abs(dot(n, view)));
        const rim = grazing.mul(grazing).mul(grazing).mul(clamp(dot(view, L), 0.0, 1.0)).mul(shadow);
        const lit = albedo.mul(direct.add(sky).add(u.bounce.mul(0.55)))
            .add(u.sun.mul(u.sunUp).mul(albedo).mul(rim).mul(1.2));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

/**
 * The needle tufts: alpha-tested crossed cards shaded as the plate they belong to. With
 * `coverage` (a multisampled scene pass) the test is three's alpha-to-coverage one: the same
 * threshold, sharpened to a pixel, so each needle's edge covers some of the pixel's samples
 * instead of all or none.
 */
function needleMaterial(u, t, needles, coverage = false) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastPineNeedles';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const tuft = attribute('aTuft', 'vec4');
    const seed = attribute('aSeed', 'vec4');
    const card = texture(needles, uv());
    material.positionNode = Fn(() => {
        const p = positionLocal;
        // The shoots flutter a little at their tips on top of the crown's sway.
        const flutter = sin(u.time.mul(3.1).add(seed.x.mul(40.0))).mul(0.018).mul(uv().y);
        return p.add(sway(u, p)).add(vec3(flutter, flutter.mul(0.5), flutter.mul(0.7)));
    })();
    if (coverage) {
        material.alphaTest = 0.5;
        material.alphaToCoverage = true;
    } else {
        material.maskNode = card.a.greaterThan(0.5);
    }
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(modelWorldMatrix.mul(vec4(tuft.xyz, 0.0)).xyz);
        const open = tuft.w;
        const depth = seed.y;
        const hash = seed.x;
        // Needles: dark blue-green to a lighter grass-green tuft by tuft, the twig brown, the
        // plate's inner needles older and browner.
        const green = mix(vec3(0.015, 0.028, 0.023), vec3(0.036, 0.058, 0.034), hash);
        const needle = green.mul(card.r.mul(0.85).add(0.45));
        const aged = mix(needle, vec3(0.05, 0.042, 0.022), depth.mul(0.35));
        const albedo = mix(aged, vec3(0.08, 0.045, 0.025), card.g.mul(0.8));
        // The plate as a mass: wrap light on its dome, shaded inside, open to the sky above.
        const L = u.sunDir;
        const lambert = clamp(dot(n, L).mul(0.75).add(0.25), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const inside = float(1.0).sub(depth.mul(0.7));
        const direct = u.sun.mul(lambert).mul(shadow).mul(u.sunUp).mul(mix(float(0.3), float(1.0), open))
            .mul(inside);
        const sky = u.fill.mul(n.y.mul(0.5).add(0.5)).mul(mix(float(0.15), float(1.0), open)).mul(float(1.0).sub(depth.mul(0.6)))
            .mul(0.75);
        const bounce = u.bounce.mul(float(1.0).sub(n.y).mul(0.2).add(0.05));
        const lit = albedo.mul(direct.add(sky).add(bounce)).toVar();
        // Backlit, the plate's thin edge glows: sunlight through the needles, yellow-green.
        const view = normalize(P.sub(u.eye));
        const forward = clamp(dot(view, L), 0.0, 1.0);
        const f2 = forward.mul(forward);
        const edge = float(1.0).sub(abs(dot(n, view)));
        const through = f2.mul(f2).mul(f2).mul(float(1.0).sub(depth)).mul(edge.mul(0.65).add(0.35))
            .mul(open.mul(0.5).add(0.5));
        lit.addAssign(u.sun.mul(u.sunUp).mul(shadow).mul(vec3(0.3, 0.4, 0.1)).mul(through)
            .mul(card.r.mul(0.6).add(0.6)));
        // Under alpha-to-coverage the card's alpha is the needle's coverage of the pixel.
        return vec4(aerial(u, P, lit), coverage ? card.a : 1.0);
    })();
    return material;
}

// ── The shadow on the summit ─────────────────────────────────────────────────────────

/** The summit patch the pine's shadow is laid on (world metres) and its post spacing. */
export const PINE_SHADOW = Object.freeze({
    x0: -26, x1: 10, z0: -36, z1: -4, step: 0.7, floor: 139, rows: 96,
});

/**
 * The shadow's casters in the world: each plate (centre, radius; flattened by PINE_FOLIAGE.flat)
 * and spheres along the trunk and the limbs' inner halves (negative radius: round, nearly opaque).
 */
export function shadowCasters(plan, frame) {
    const rows = [];
    const v = new THREE.Vector3();
    for (const plate of plan.plates) {
        v.copy(plate.c).applyMatrix4(frame.matrix);
        rows.push(new THREE.Vector4(v.x, v.y, v.z, plate.R * 0.92));
    }
    const trunk = plan.wood[0].curve;
    for (let k = 0; k <= 18; k++) {
        const s = k / 18;
        v.copy(trunk.getPointAt(s)).applyMatrix4(frame.matrix);
        rows.push(new THREE.Vector4(v.x, v.y, v.z, -(0.34 - 0.24 * s)));
    }
    return rows.slice(0, PINE_SHADOW.rows);
}

/**
 * The patch: the summit's ground round the pine (posts below the summit's floor dropped), raised
 * by the land's own relief, multiplied into the land under it.
 */
function shadowPatch(u, t, ground, casters, frame) {
    const {
        x0, x1, z0, z1, step: d,
    } = PINE_SHADOW;
    const nx = Math.round((x1 - x0) / d) + 1;
    const nz = Math.round((z1 - z0) / d) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const keep = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const x = x0 + i * d;
            const z = z0 + j * d;
            const y = ground(x, z);
            const o = j * nx + i;
            pos.set([x, y, z], o * 3);
            keep[o] = y > PINE_SHADOW.floor ? 1 : 0;
        }
    }
    const index = [];
    for (let j = 0; j < nz - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const a = j * nx + i;
            const b = a + 1;
            const c = a + nx;
            const e = c + 1;
            if (keep[a] && keep[b] && keep[c] && keep[e]) index.push(a, c, b, b, c, e);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const rows = uniformArray(casters, 'vec4');
    const count = casters.length;
    // The crown's bounding sphere: a sun ray that misses it skips the casters altogether.
    const box = new THREE.Box3();
    for (const c of casters) box.expandByPoint(new THREE.Vector3(c.x, c.y, c.z));
    const centre = box.getCenter(new THREE.Vector3());
    let radius = 0;
    for (const c of casters) radius = Math.max(radius, centre.distanceTo(new THREE.Vector3(c.x, c.y, c.z)) + Math.abs(c.w));
    const crownC = vec3(centre.x, centre.y, centre.z);
    const foot = vec2(frame.foot.x, frame.foot.z);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastPineShadow';
    material.fog = false;
    material.transparent = true;
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.ZeroFactor;
    material.blendDst = THREE.SrcColorFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.positionNode = Fn(() => {
        const p = positionLocal;
        return p.add(vec3(0.0, outcropRelief(u, t, p.xz, p.y).add(0.04), 0.0));
    })();
    const flat = 1 / PINE_FOLIAGE.flat;
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const L = u.sunDir;
        const lit = float(1.0).toVar();
        If(u.sunUp.greaterThan(0.01).and(L.y.greaterThan(0.004)), () => {
            const rel = crownC.sub(P);
            const along = dot(rel, L);
            const miss = length(rel.sub(L.mul(along)));
            If(along.greaterThan(0.0).and(miss.lessThan(radius)), () => {
                Loop({
                    start: int(0), end: int(count), type: 'int', condition: '<', name: 'ci',
                }, ({ ci }) => {
                    const row = rows.element(ci);
                    const round = step(row.w, 0.0);
                    const R = abs(row.w);
                    const s = mix(float(flat), float(1.0), round);
                    const r = row.xyz.sub(P);
                    const rs = vec3(r.x, r.y.mul(s), r.z);
                    const ds = normalize(vec3(L.x, L.y.mul(s), L.z));
                    const tt = dot(rs, ds);
                    const c = length(rs.sub(ds.mul(tt)));
                    const dense = mix(float(1.0 - PINE_FOLIAGE.porous), float(0.95), round);
                    const o = float(1.0).sub(smoothstep(R.mul(0.4), R, c)).mul(step(0.0, tt)).mul(dense);
                    lit.mulAssign(float(1.0).sub(o));
                });
            });
        });
        // Under the crown the sky is partly covered; at the trunk's foot, darker still.
        const toFoot = length(P.xz.sub(foot));
        const footAo = float(1.0).sub(exp(toFoot.mul(toFoot).div(-2.2)).mul(0.5));
        const under = length(P.xz.sub(crownC.xz));
        const canopy = float(1.0).sub(exp(under.mul(under).div(-30.0)).mul(0.24));
        const sunShare = u.sunUp.mul(0.62).mul(shadowAt(t.shadow, P.xz));
        const f = float(1.0).sub(float(1.0).sub(lit).mul(sunShare)).mul(footAo).mul(canopy);
        return vec4(f, f, f, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'HighCoastPineShadow';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return { mesh, geometry, material };
}

// ── The tree ─────────────────────────────────────────────────────────────────────────

/**
 * The old pine: `ground(x, z)` gives the summit's height (the land's own sampling), `foot` where
 * the trunk stands. Returns its meshes (wood, needles, and on props tiers ≥ 1 the shadow patch).
 */
export function createPine(u, t, tier, ground, foot, { coverage = false } = {}) {
    const frame = pineFrame(foot.x, foot.y, foot.z);
    const eyeLocal = new THREE.Vector3(EYE.x, EYE.y, EYE.z).applyMatrix4(frame.inverse);
    const w = new THREE.Vector3();
    const groundLocal = (x, z) => {
        w.set(x, 0, z).applyMatrix4(frame.matrix);
        return ground(w.x, w.z) - frame.foot.y;
    };
    const plan = pinePlan(eyeLocal, groundLocal);
    const level = Math.min(2, Math.max(0, tier.props ?? 1));
    const woodGeo = woodGeometry(plan.wood);
    const woodMat = woodMaterial(u, t);
    const wood = new THREE.Mesh(woodGeo, woodMat);
    wood.name = 'HighCoastPineWood';
    const { texture: needleTex } = bakeNeedleTexture(level > 0 ? 128 : 64);
    const { geometry: needleGeo, tufts } = needleGeometry(plan.plates, { density: PINE_FOLIAGE.density[level] });
    const needleMat = needleMaterial(u, t, needleTex, coverage);
    const needles = new THREE.Mesh(needleGeo, needleMat);
    needles.name = 'HighCoastPineNeedles';
    const group = new THREE.Group();
    group.name = 'HighCoastOldPine';
    group.position.copy(frame.foot);
    group.rotation.y = frame.yaw;
    for (const m of [wood, needles]) {
        m.frustumCulled = false;
        m.renderOrder = 3;
        group.add(m);
    }
    const meshes = [group];
    const disposables = [woodGeo, woodMat, needleTex, needleGeo, needleMat];
    if (level > 0) {
        const patch = shadowPatch(u, t, ground, shadowCasters(plan, frame), frame);
        meshes.push(patch.mesh);
        disposables.push(patch.geometry, patch.material);
    }
    return {
        group,
        meshes,
        plan,
        tufts,
        dispose() {
            for (const d of disposables) d.dispose();
        },
    };
}
