/**
 * Ocean — the large animals: humpback whales, manta rays and green turtles.
 *
 * Each kind is one mesh grown in code (nose along +z), drawn once for every animal of its kind
 * that may be in the water at once. Where each one is comes from the world (a pass through the
 * canyon: ocean-core.js `passAt`), written each frame as two rows per animal:
 *   (x, y, z, yaw), (pitch, bank, its own clock, scale)    — scale 0 = not in the water.
 * The vertex stage swims it: a whale's tail beats up and down and its long white flippers
 * wave, a manta's wings fly, a turtle rows with its front flippers.
 *
 * aShape = (how far along the body: 0 at the nose, which part), uv = (two numbers per part).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    float,
    fract,
    int,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, mulberry32, ocFog, ocLight, ocPart, ocSong,
} from './ocean-tsl.js';
import { Shape } from './ocean-reef.js';

const smoothCpu = (lo, hi, v) => {
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};

// ── The shapes ──────────────────────────────────────────────────────────────────

/** Parts, as the number the shaders read. */
const BODY = 0;
const FIN = 1;
const TAIL = 2;
const HEAD = 3;

/** A flat sheet between two edges (each a list of points), with a normal; `span` 0..1 across its length. */
function sheet(shape, lead, trail, normal, part, along) {
    const rows = [];
    for (let i = 0; i < lead.length; i++) {
        const span = i / (lead.length - 1);
        rows.push([
            shape.vert(lead[i], normal, along, part, span, 0),
            shape.vert(trail[i], normal, along, part, span, 1),
        ]);
    }
    for (let i = 0; i < rows.length - 1; i++) shape.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
}

/**
 * A humpback a unit long: a body of revolution flattened below, a small dorsal hump, the long
 * white flippers and the flukes. uv = (how far up the flank −1..1, how far out a fin 0..1).
 */
export function whaleShape() {
    const shape = new Shape();
    const RINGS = 18;
    const SIDES = 12;
    const grid = [];
    for (let j = 0; j <= RINGS; j++) {
        const s = j / RINGS;
        const z = 0.5 - s;
        const front = Math.sqrt(Math.sin(Math.min(1, s / 0.3) * Math.PI * 0.5));
        const back = 1 - 0.9 * smoothCpu(0.3, 1.0, s) ** 1.1;
        const r = 0.105 * (s < 0.3 ? front : back) + 0.004;
        const ring = [];
        for (let k = 0; k < SIDES; k++) {
            const a = (k / SIDES) * TAU;
            const up = Math.cos(a);
            const hump = 0.018 * Math.exp(-(((s - 0.66) / 0.035) ** 2)) * Math.max(0, up) ** 4;
            const x = Math.sin(a) * r * 1.08;
            const y = up * r * (up > 0 ? 0.86 : 0.78) + hump - 0.012 * (1 - s);
            const n = [Math.sin(a) / 1.08, up / (up > 0 ? 0.86 : 0.78), 0.18 * (s < 0.3 ? 1 : -0.6)];
            const len = Math.hypot(n[0], n[1], n[2]);
            ring.push(shape.vert([x, y, z], [n[0] / len, n[1] / len, n[2] / len], s, BODY, up, 0));
        }
        grid.push(ring);
    }
    const nose = shape.vert([0, -0.004, 0.505], [0, 0, 1], 0, BODY, 0, 0);
    for (let k = 0; k < SIDES; k++) {
        const k1 = (k + 1) % SIDES;
        shape.tri(nose, grid[0][k], grid[0][k1]);
        for (let j = 0; j < RINGS; j++) shape.quad(grid[j][k], grid[j][k1], grid[j + 1][k1], grid[j + 1][k]);
    }
    // The flippers: a third of the body long, swept back and down, knobbed along the leading edge.
    [-1, 1].forEach((side) => {
        const lead = [];
        const trail = [];
        const STEPS = 8;
        for (let i = 0; i <= STEPS; i++) {
            const f = i / STEPS;
            const x = side * (0.085 + f * 0.31);
            const y = -0.035 - f * 0.08;
            const z = 0.2 - f * 0.13;
            const chord = 0.06 * (1 - f * 0.65) + 0.008;
            const knob = Math.sin(f * 22) * 0.004;
            lead.push([x, y, z + knob]);
            trail.push([x - side * chord * 0.15, y + 0.004, z - chord]);
        }
        sheet(shape, lead, trail, [0, 1, 0], FIN, 0.3);
    });
    // The flukes: wide, swept, notched in the middle.
    [-1, 1].forEach((side) => {
        const lead = [];
        const trail = [];
        const STEPS = 6;
        for (let i = 0; i <= STEPS; i++) {
            const f = i / STEPS;
            const x = side * f * 0.17;
            const sweep = f * f * 0.06;
            lead.push([x, 0, -0.47 - sweep]);
            trail.push([x, 0, -0.52 - sweep * 0.7 - Math.sin(f * Math.PI) * 0.025 + (1 - f) * 0.012]);
        }
        sheet(shape, lead, trail, [0, 1, 0], TAIL, 1);
    });
    return shape;
}

/**
 * A manta a unit across the wings: a flat diamond, thickest over the body, the horns of its
 * cephalic fins and a whip of a tail. uv = (how far back across the chord 0..1, 1 on its back).
 */
export function mantaShape() {
    const shape = new Shape();
    const SPAN = 14;
    const CHORD = 6;
    [1, -1].forEach((face) => {
        const grid = [];
        for (let i = 0; i <= SPAN; i++) {
            const uS = (i / SPAN) * 2 - 1;
            const a = Math.abs(uS);
            const front = 0.2 - 0.3 * a ** 1.15;
            const back = -0.22 + 0.13 * a ** 0.8;
            const row = [];
            for (let j = 0; j <= CHORD; j++) {
                const v = j / CHORD;
                const z = front + (back - front) * v;
                const thick = (0.05 * (1 - uS * uS) ** 1.5 * Math.sin(Math.PI * v) ** 0.7 + 0.003) * (face > 0 ? 1 : 0.7);
                const n = [-uS * 0.15 * face, face, (0.5 - v) * 0.25 * face];
                const len = Math.hypot(n[0], n[1], n[2]);
                row.push(shape.vert([uS * 0.5, thick * face, z], [n[0] / len, n[1] / len, n[2] / len], a, BODY, v, face > 0 ? 1 : 0));
            }
            grid.push(row);
        }
        for (let i = 0; i < SPAN; i++) {
            for (let j = 0; j < CHORD; j++) shape.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        }
    });
    // The horns, curled down in front of the mouth.
    [-1, 1].forEach((side) => {
        sheet(shape, [[side * 0.07, 0, 0.2], [side * 0.08, -0.02, 0.27]], [[side * 0.11, 0, 0.17], [side * 0.1, -0.025, 0.25]], [0, 1, 0], FIN, 0);
    });
    // The tail.
    const tail = [];
    const tailB = [];
    for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        tail.push([-0.006 * (1 - f), 0, -0.2 - f * 0.4]);
        tailB.push([0.006 * (1 - f), 0, -0.2 - f * 0.4]);
    }
    sheet(shape, tail, tailB, [0, 1, 0], TAIL, 0);
    return shape;
}

/**
 * A green turtle a unit long: a domed shell over a flat plastron, a head, two long front
 * flippers and two small rear ones. uv = (where on the shell: angle 0..1 or a fin's span, 1 on top).
 */
export function turtleShape(seed = 3) {
    const rand = mulberry32(seed);
    const shape = new Shape();
    const RINGS = 6;
    const SIDES = 18;
    [1, -1].forEach((face) => {
        const rows = [];
        for (let j = 1; j <= RINGS; j++) {
            const rho = j / RINGS;
            const row = [];
            for (let k = 0; k < SIDES; k++) {
                const a = (k / SIDES) * TAU;
                const x = Math.sin(a) * 0.3 * rho;
                const z = Math.cos(a) * 0.4 * rho * (Math.cos(a) > 0 ? 1 : 1.08);
                const y = face > 0 ? 0.15 * (1 - rho * rho) ** 0.6 + 0.005 : -0.05 * (1 - rho * rho) ** 0.5 - 0.005;
                const n = face > 0 ? [Math.sin(a) * rho * 0.8, 1, Math.cos(a) * rho * 0.6] : [0, -1, 0];
                const len = Math.hypot(n[0], n[1], n[2]);
                row.push(shape.vert([x, y, z], [n[0] / len, n[1] / len, n[2] / len], rho, BODY, k / SIDES, face > 0 ? 1 : 0));
            }
            rows.push(row);
        }
        const top = shape.vert([0, face > 0 ? 0.155 : -0.055, 0], [0, face, 0], 0, BODY, 0, face > 0 ? 1 : 0);
        for (let k = 0; k < SIDES; k++) {
            const k1 = (k + 1) % SIDES;
            shape.tri(top, rows[0][k], rows[0][k1]);
            for (let j = 0; j < RINGS - 1; j++) shape.quad(rows[j][k], rows[j][k1], rows[j + 1][k1], rows[j + 1][k]);
        }
    });
    // The head: a small blunt egg.
    const head = [];
    for (let j = 0; j <= 4; j++) {
        const f = j / 4;
        head.push({
            p: [0, 0.01 - f * 0.005, 0.37 + f * 0.13], r: 0.055 * Math.sin(Math.PI * (0.25 + 0.7 * f)) + 0.01, tip: 0.9, ao: HEAD,
        });
    }
    tubeInto(shape, head, 7);
    // Flippers.
    [-1, 1].forEach((side) => {
        const lead = [];
        const trail = [];
        for (let i = 0; i <= 6; i++) {
            const f = i / 6;
            const x = side * (0.22 + f * 0.5);
            const z = 0.2 - f * 0.22 - f * f * 0.08;
            const chord = 0.13 * (1 - f * 0.7) + 0.02;
            lead.push([x, 0.0 - f * 0.03, z]);
            trail.push([x - side * chord * 0.2, 0.0 - f * 0.03, z - chord]);
        }
        sheet(shape, lead, trail, [0, 1, 0], FIN, 0.2);
        const rl = [];
        const rt = [];
        for (let i = 0; i <= 3; i++) {
            const f = i / 3;
            rl.push([side * (0.16 + f * 0.14), -0.01, -0.33 - f * 0.1]);
            rt.push([side * (0.13 + f * 0.13), -0.01, -0.38 - f * 0.11 - rand() * 0.002]);
        }
        sheet(shape, rl, rt, [0, 1, 0], TAIL, 0.9);
    });
    return shape;
}

/** A tube whose vertices carry the given (tip, ao) as (along, part), uv (0, 1). */
function tubeInto(shape, points, sides) {
    const rings = points.map((pt) => {
        const ring = [];
        for (let k = 0; k < sides; k++) {
            const a = (k / sides) * TAU;
            const n = [Math.sin(a), Math.cos(a), 0];
            ring.push(shape.vert([pt.p[0] + n[0] * pt.r, pt.p[1] + n[1] * pt.r, pt.p[2]], n, pt.tip, pt.ao, 0, 1));
        }
        return ring;
    });
    for (let j = 0; j < rings.length - 1; j++) {
        for (let k = 0; k < sides; k++) {
            const k1 = (k + 1) % sides;
            shape.quad(rings[j][k], rings[j][k1], rings[j + 1][k1], rings[j + 1][k]);
        }
    }
    const last = points[points.length - 1];
    const apex = shape.vert([last.p[0], last.p[1], last.p[2] + last.r], [0, 0, 1], last.tip, last.ao, 0, 1);
    for (let k = 0; k < sides; k++) shape.tri(rings[rings.length - 1][k], rings[rings.length - 1][(k + 1) % sides], apex);
}

// ── Swimming them ───────────────────────────────────────────────────────────────

/** How each kind swims, given its shape attributes and its own clock `T`: a local offset. */
const SWIM = {
    whale: (p, along, part, w, T) => {
        // The tail beats up and down, from the middle of the body back; the flippers wave slowly.
        const beat = T.mul(0.95);
        const tail = sin(beat.sub(along.mul(4.2))).mul(0.034).mul(smoothstep(0.28, 1.0, along).mul(smoothstep(0.28, 1.0, along)));
        const isFin = step(0.5, part).mul(float(1.0).sub(step(1.5, part)));
        const isTail = step(1.5, part).mul(float(1.0).sub(step(2.5, part)));
        const flipper = sin(T.mul(0.55)).mul(0.07).mul(w.x.mul(w.x)).mul(isFin);
        const fluke = cos(beat.sub(4.2)).mul(0.035).mul(abs(p.z.add(0.47)).mul(12.0)).mul(isTail);
        return vec3(0.0, tail.add(flipper).add(fluke), 0.0);
    },
    manta: (p, along, part, w, T) => {
        // The wings fly: a beat that runs out to the tips, and a ripple back across the chord.
        const beat = T.mul(1.25);
        const isBody = float(1.0).sub(step(0.5, part));
        const flap = sin(beat.sub(along.mul(1.2))).mul(0.2).mul(along.mul(along).mul(along.add(0.4)));
        const ripple = sin(beat.sub(w.x.mul(2.6)).sub(along)).mul(0.025).mul(along).mul(isBody);
        const isTail = step(1.5, part);
        const whip = sin(T.mul(2.0).add(p.z.mul(9.0))).mul(0.02).mul(isTail).mul(p.z.add(0.2).negate().mul(3.0));
        return vec3(whip, flap.mul(isBody).add(ripple), 0.0);
    },
    turtle: (p, along, part, w, T) => {
        // The front flippers row: down and back, up and forward; the rear ones steer.
        const stroke = T.mul(1.5);
        const isFin = step(0.5, part).mul(float(1.0).sub(step(1.5, part)));
        const isRear = step(1.5, part).mul(float(1.0).sub(step(2.5, part)));
        const isHead = step(2.5, part);
        const reach = w.x.mul(w.x);
        const row = vec3(0.0, sin(stroke).mul(0.24).mul(reach), cos(stroke).mul(0.09).mul(reach)).mul(isFin);
        const steer = vec3(0.0, sin(stroke.add(1.2)).mul(0.035).mul(w.x), 0.0).mul(isRear);
        const nod = vec3(0.0, sin(stroke.mul(0.5)).mul(0.012), 0.0).mul(isHead);
        return row.add(steer).add(nod);
    },
};

/** How each kind is coloured: its albedo at a point of its shape. */
const SKIN = {
    whale: (u, along, part, w, own) => {
        const isBody = float(1.0).sub(step(0.5, part));
        const up = w.x;
        const back = vec3(0.03, 0.04, 0.055);
        const belly = vec3(0.42, 0.45, 0.47);
        // The throat's grooves run under the head; the flippers and the flukes' undersides are white.
        const grooves = sin(own.x.mul(260.0)).mul(0.5).add(0.5).mul(step(along, 0.45))
            .mul(step(up, -0.35));
        const body = mix(belly.mul(float(1.0).sub(grooves.mul(0.35))), back, smoothstep(-0.55, 0.05, up));
        const mottle = u.noise(own.xz.mul(14.0)).r;
        const fin = mix(vec3(0.62, 0.64, 0.64), vec3(0.06, 0.07, 0.08), smoothstep(0.45, 0.62, mottle).mul(0.7));
        return mix(fin, body, isBody).mul(mottle.mul(0.3).add(0.85));
    },
    manta: (u, along, part, w) => {
        const topSide = w.y;
        // White shoulder patches on the black back, a white belly with a dark rim.
        const shoulder = smoothstep(0.12, 0.2, along).mul(float(1.0).sub(smoothstep(0.36, 0.5, along)))
            .mul(smoothstep(0.15, 0.3, w.x)).mul(float(1.0).sub(smoothstep(0.45, 0.6, w.x)));
        const back = mix(vec3(0.018, 0.02, 0.025), vec3(0.55, 0.57, 0.58), shoulder.mul(0.8));
        const belly = mix(vec3(0.72, 0.74, 0.74), vec3(0.08, 0.09, 0.1), smoothstep(0.82, 0.98, along.max(w.x)));
        return mix(belly, back, topSide);
    },
    turtle: (u, along, part, w, own) => {
        const isBody = float(1.0).sub(step(0.5, part));
        const topSide = w.y;
        // The scutes: five rings of plates round a row down the middle, dark seams between,
        // streaks that radiate from each plate's growth point.
        const a = w.x.mul(TAU);
        const costal = abs(fract(w.x.mul(10.0)).sub(0.5));
        const seam = float(1.0).sub(smoothstep(0.02, 0.06, costal)).mul(step(0.45, along))
            .max(float(1.0).sub(smoothstep(0.015, 0.05, abs(along.sub(0.5)))));
        const streak = sin(a.mul(40.0).add(along.mul(30.0))).mul(0.5).add(0.5);
        const shell = mix(vec3(0.22, 0.14, 0.05), vec3(0.42, 0.3, 0.12), streak.mul(0.6).add(u.noise(own.xz.mul(6.0)).g.mul(0.4)))
            .mul(float(1.0).sub(seam.mul(0.65)));
        const plastron = vec3(0.55, 0.5, 0.3);
        const skin = mix(vec3(0.16, 0.18, 0.13), vec3(0.42, 0.42, 0.33), smoothstep(0.45, 0.7, u.noise(own.xz.mul(30.0)).b));
        return mix(skin, mix(plastron, shell, topSide), isBody);
    },
};

/**
 * Every animal of one kind, as a scene part.
 * @param {object} u
 * @param {'whale'|'manta'|'turtle'} kind
 * @param {Shape} shape
 * @param {number} slots     how many may be in the water at once
 * @param {number} metres    metres the unit shape stands for at scale 1
 */
function createKind(u, kind, shape, slots, metres) {
    const base = shape.geometry(true);
    const geometry = new THREE.InstancedBufferGeometry();
    Object.keys(base.attributes).forEach((k) => geometry.setAttribute(k, base.attributes[k]));
    geometry.setIndex(base.index);
    const slotData = new Float32Array(slots);
    for (let i = 0; i < slots; i++) slotData[i] = i;
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slotData, 1));
    geometry.instanceCount = slots;
    const rows = Array.from({ length: slots * 2 }, () => new THREE.Vector4(0, -100, 0, 0));
    const table = uniformArray(rows, 'vec4');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = `Ocean${kind[0].toUpperCase()}${kind.slice(1)}s`;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const slot = int(attribute('aSlot', 'float').add(0.5));
    const aShape = attribute('aShape', 'vec2');
    const vNormal = varying(vec3(0.0, 1.0, 0.0), `v${kind}N`);
    const vAlong = varying(aShape.x, `v${kind}Along`);
    const vPart = varying(aShape.y, `v${kind}Part`);
    const vW = varying(uv(), `v${kind}W`);
    material.positionNode = Fn(() => {
        const A = table.element(slot.mul(2));
        const B = table.element(slot.mul(2).add(1));
        const local = positionGeometry.add(SWIM[kind](positionGeometry, aShape.x, aShape.y, uv(), B.z)).toVar();
        const f = vec3(sin(A.w).mul(cos(B.x)), sin(B.x), cos(A.w).negate().mul(cos(B.x))).toVar();
        const r0 = normalize(vec3(f.z.negate(), 0.0, f.x).add(vec3(1e-4, 0.0, 0.0)));
        const u0 = cross(r0, f);
        const right = r0.mul(cos(B.y)).add(u0.mul(sin(B.y)));
        const up = u0.mul(cos(B.y)).sub(r0.mul(sin(B.y)));
        const n = attribute('normal', 'vec3');
        vNormal.assign(normalize(right.mul(n.x).add(up.mul(n.y)).add(f.mul(n.z))));
        const size = B.w.mul(metres);
        return A.xyz.add(right.mul(local.x).add(up.mul(local.y)).add(f.mul(local.z)).mul(size));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal).toVar();
        // (Fins are single sheets: lit from whichever side the eye sees.)
        const view = normalize(cameraPosition.sub(P));
        N.assign(N.mul(step(0.0, dot(N, view)).mul(2.0).sub(1.0)));
        const albedo = SKIN[kind](u, vAlong, vPart, vW, positionGeometry);
        const lit = ocLight(u, { N, P, wrap: 0.35 });
        // A rim of the water's own light round the silhouette, so a far animal still has a shape.
        const rim = float(1.0).sub(clamp(dot(N, view), 0.0, 1.0));
        const col = albedo.mul(lit).add(u.halo.mul(rim.mul(rim).mul(rim)).mul(0.25)).toVar();
        // The whale's song lights the water round it, and the animal in it.
        if (kind === 'whale') col.addAssign(u.glow.mul(ocSong(u, P)).mul(0.25));
        return vec4(ocFog(u, col, P), 1.0);
    })();
    const part = ocPart(material.name, geometry, material, 8);
    part.rows = rows;
    part.slots = slots;
    part.triangles = shape.triangles;
    /** Stand animal `i` at a pose (null = out of the water). */
    part.set = (i, pose, time = 0, scale = 1) => {
        if (i < 0 || i >= slots) return;
        if (!pose || !(scale > 0)) {
            rows[i * 2].set(0, -100, 0, 0);
            rows[i * 2 + 1].set(0, 0, 0, 0);
            return;
        }
        rows[i * 2].set(pose.x, pose.y, pose.z, pose.yaw);
        rows[i * 2 + 1].set(pose.pitch || 0, pose.bank || 0, time, scale);
    };
    part.live = () => {
        let n = 0;
        for (let i = 0; i < slots; i++) if (rows[i * 2 + 1].w > 0) n += 1;
        return n;
    };
    return part;
}

/** Metres each kind is long (a manta: across its wings). */
export const GIANT_LENGTH = Object.freeze({ whale: 13, manta: 5, turtle: 1.25 });
/** How many of each may be in the water at once. */
export const GIANT_SLOTS = Object.freeze({ whale: 3, manta: 4, turtle: 2 });

/**
 * All three kinds. Returns { parts: { whales, mantas, turtles }, setWhale, setManta, setTurtle, commit, live }.
 * @param {object} u
 */
export function createGiants(u) {
    const whales = createKind(u, 'whale', whaleShape(), GIANT_SLOTS.whale, GIANT_LENGTH.whale);
    const mantas = createKind(u, 'manta', mantaShape(), GIANT_SLOTS.manta, GIANT_LENGTH.manta);
    const turtles = createKind(u, 'turtle', turtleShape(), GIANT_SLOTS.turtle, GIANT_LENGTH.turtle);
    return {
        parts: { whales, mantas, turtles },
        setWhale: (i, pose, t, scale) => whales.set(i, pose, t, scale),
        setManta: (i, pose, t, scale) => mantas.set(i, pose, t, scale),
        setTurtle: (i, pose, t, scale) => turtles.set(i, pose, t, scale),
        /** (The rows are read straight from the arrays every frame: nothing to flush.) */
        commit() {},
        live: () => ({ whales: whales.live(), mantas: mantas.live(), turtles: turtles.live() }),
    };
}
