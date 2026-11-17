/**
 * Stillwater — wings over the tarn.
 *
 * Two birds, each a small mesh built here from numbers, with real wings that fold at the shoulder
 * and the wrist in the vertex stage:
 *
 *   owl    a great grey owl: a big round head, a short body and tail, broad rounded wings with
 *          the fingered tips an owl flies on; slow deep beats, then a long silent glide. It crosses
 *          the sky past the moon now and then (stillwater-night.js).
 *   duck   a mallard: a long neck and a bill, pointed wings, quick shallow beats. A flight of them
 *          gets up off the far water and goes out over the wood as the hour turns.
 *
 * The bird's own frame: metres at real size, z forward, y up, x to its LEFT. Every vertex carries
 * `aWing` = (side: +1 its left wing, -1 its right, 0 its body; how much the shoulder moves it; how
 * much the wrist moves it; how far toward the wing's tip it is). `foldWing()` below is the CPU twin
 * of the vertex stage's fold, line for line.
 */

import * as THREE from 'three/webgpu';

/** Where the wings hinge (metres out from the body's middle line): the shoulder and the wrist. */
export const BIRDS = Object.freeze({
    owl: Object.freeze({ shoulder: 0.07, wrist: 0.36, span: 1.62 }),
    duck: Object.freeze({ shoulder: 0.05, wrist: 0.19, span: 0.9 }),
});

/** smoothstep */
const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/**
 * A wing as a strip of quads between its leading and trailing edges at stations out along it
 * (x: metres from the middle line; le, te: z of the edges there; y: how far the wing rises there).
 */
function addWing(out, stations, kind, side) {
    const { shoulder, wrist } = BIRDS[kind];
    const tip = stations[stations.length - 1].x;
    const base = out.pos.length / 3;
    const chord = 4;
    stations.forEach((s) => {
        for (let c = 0; c <= chord; c++) {
            const k = c / chord;
            const z = s.le + (s.te - s.le) * k;
            // (A wing is cambered: thickest a third of the way back, its trailing edge thin.)
            const y = (s.y || 0) + Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.012 * (1 - s.x / (tip * 1.2));
            out.pos.push(side * s.x, y, z);
            out.nor.push(0, 1, 0);
            const arm = smooth(shoulder - 0.01, shoulder + 0.04, s.x);
            const hand = smooth(wrist - 0.05, wrist + 0.05, s.x);
            out.wing.push(side, arm, hand, s.x / tip);
        }
    });
    for (let i = 0; i < stations.length - 1; i++) {
        for (let c = 0; c < chord; c++) {
            const a = base + i * (chord + 1) + c;
            const b = a + 1;
            const d = a + chord + 1;
            const e = d + 1;
            if (side > 0) out.idx.push(a, d, b, b, d, e);
            else out.idx.push(a, b, d, b, e, d);
        }
    }
}

/** A flight feather of the hand: a narrow blade from `root` out to `tip`, `w` wide at its root. */
function addFeather(out, kind, side, root, tip, w) {
    const { shoulder, wrist } = BIRDS[kind];
    const base = out.pos.length / 3;
    const dx = tip[0] - root[0];
    const dz = tip[1] - root[1];
    const len = Math.hypot(dx, dz) || 1;
    // Square to the feather, in the wing's plane.
    const nx = -dz / len;
    const nz = dx / len;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const x = root[0] + dx * k;
        const z = root[1] + dz * k;
        // (Rounded at the end, as a primary's tip is.)
        const half = (w / 2) * (k < 0.7 ? 1 - k * 0.25 : (1 - 0.7 * 0.25) * Math.sqrt(Math.max(0, 1 - ((k - 0.7) / 0.3) ** 2)));
        [-1, 1].forEach((s) => {
            out.pos.push(side * (x + nx * half * s), 0.004 * (1 - k), z + nz * half * s);
            out.nor.push(0, 1, 0);
            out.wing.push(side, smooth(shoulder - 0.01, shoulder + 0.04, x), smooth(wrist - 0.05, wrist + 0.05, x), 1);
        });
    }
    for (let i = 0; i < steps; i++) {
        const a = base + i * 2;
        if (side > 0) out.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else out.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
}

/**
 * A body of revolution along z: rings of an ellipse whose half-width and half-height follow the
 * profile [z, width, height, y] (metres).
 */
function addBody(out, profile, segments = 10) {
    const base = out.pos.length / 3;
    profile.forEach(([z, w, h, y]) => {
        for (let s = 0; s < segments; s++) {
            const a = (s / segments) * Math.PI * 2;
            const cx = Math.cos(a);
            const cy = Math.sin(a);
            out.pos.push(cx * w, y + cy * h, z);
            const l = Math.hypot(cx / Math.max(w, 1e-3), cy / Math.max(h, 1e-3)) || 1;
            out.nor.push(cx / Math.max(w, 1e-3) / l, cy / Math.max(h, 1e-3) / l, 0);
            out.wing.push(0, 0, 0, 0);
        }
    });
    for (let r = 0; r < profile.length - 1; r++) {
        for (let s = 0; s < segments; s++) {
            const a = base + r * segments + s;
            const b = base + r * segments + ((s + 1) % segments);
            const c = a + segments;
            const d = b + segments;
            out.idx.push(a, b, c, b, d, c);
        }
    }
}

/** A flat fan of a tail behind the body: from `root` (z) back `length`, `w0` to `w1` wide. */
function addTail(out, root, length, w0, w1, y = 0, notch = 0) {
    const base = out.pos.length / 3;
    const pts = [[-w0, root], [w0, root], [w1, root - length], [0, root - length + notch], [-w1, root - length]];
    pts.forEach(([x, z]) => {
        out.pos.push(x, y, z);
        out.nor.push(0, 1, 0);
        out.wing.push(0, 0, 0, 0);
    });
    out.idx.push(base, base + 1, base + 3, base + 1, base + 2, base + 3, base, base + 3, base + 4);
}

/** The bird's mesh (BufferGeometry: position, normal, aWing), in its own frame. */
export function birdGeometry(kind) {
    const out = {
        pos: [], nor: [], wing: [], idx: [],
    };
    if (kind === 'owl') {
        // A short, deep body and a big round head carried close; a short rounded tail.
        addBody(out, [
            [-0.24, 0.035, 0.03, 0.0], [-0.17, 0.07, 0.06, 0.0], [-0.06, 0.1, 0.09, 0.005],
            [0.04, 0.11, 0.1, 0.01], [0.11, 0.1, 0.095, 0.02], [0.16, 0.13, 0.12, 0.035],
            [0.23, 0.145, 0.13, 0.04], [0.3, 0.13, 0.115, 0.035], [0.35, 0.085, 0.08, 0.025], [0.375, 0.02, 0.02, 0.015],
        ]);
        addTail(out, -0.2, 0.2, 0.06, 0.1, 0.0, 0.0);
        const stations = [
            { x: 0.06, le: 0.11, te: -0.17 }, { x: 0.14, le: 0.125, te: -0.21 }, { x: 0.24, le: 0.14, te: -0.23 },
            { x: 0.34, le: 0.145, te: -0.22 }, { x: 0.44, le: 0.135, te: -0.2 }, { x: 0.54, le: 0.11, te: -0.17 },
            { x: 0.62, le: 0.08, te: -0.13 },
        ];
        [1, -1].forEach((side) => {
            addWing(out, stations, 'owl', side);
            // The fingered tip: five primaries splayed out from the hand.
            for (let k = 0; k < 5; k++) {
                const root = [0.55 + 0.012 * k, 0.07 - 0.045 * k];
                const tip = [0.8 - 0.02 * Math.abs(k - 1.2), 0.07 - 0.075 * k];
                addFeather(out, 'owl', side, root, tip, 0.06 - 0.004 * k);
            }
        });
    } else {
        // A mallard: a long body, the neck stretched out, a round head, a flat bill.
        addBody(out, [
            [-0.22, 0.02, 0.02, 0.0], [-0.15, 0.06, 0.05, 0.0], [-0.04, 0.08, 0.07, 0.0], [0.06, 0.075, 0.07, 0.005],
            [0.13, 0.05, 0.05, 0.015], [0.2, 0.03, 0.03, 0.025], [0.27, 0.028, 0.028, 0.03], [0.3, 0.04, 0.042, 0.035],
            [0.34, 0.04, 0.04, 0.035], [0.37, 0.025, 0.018, 0.028], [0.42, 0.018, 0.008, 0.024], [0.43, 0.004, 0.004, 0.024],
        ], 8);
        addTail(out, -0.18, 0.09, 0.03, 0.045, 0.0, 0.03);
        const stations = [
            { x: 0.05, le: 0.06, te: -0.1 }, { x: 0.12, le: 0.065, te: -0.11 }, { x: 0.19, le: 0.06, te: -0.1 },
            { x: 0.27, le: 0.035, te: -0.09 }, { x: 0.34, le: 0.0, te: -0.085 }, { x: 0.4, le: -0.04, te: -0.09 },
            { x: 0.45, le: -0.085, te: -0.1 },
        ];
        [1, -1].forEach((side) => addWing(out, stations, 'duck', side));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(out.wing, 4));
    geometry.setIndex(out.idx);
    return geometry;
}

/**
 * The wings' angles at a moment of the beat: (shoulder, wrist) in radians, + raising the wing.
 * `phase` runs 0..1 over a beat; `glide` 0..1 holds them out level (an owl between its beats).
 */
export function wingAngles(kind, phase, glide = 0) {
    const a = phase * Math.PI * 2;
    const owl = kind === 'owl';
    // Down fast, up slower; the hand lags the arm and folds on the upstroke.
    const beat = Math.sin(a) * (owl ? 0.62 : 0.5) + (owl ? 0.08 : 0.12);
    const hand = Math.sin(a - 0.7) * (owl ? 0.45 : 0.32) - (owl ? 0.05 : 0.0);
    const g = Math.max(0, Math.min(1, glide));
    // Gliding: a shallow V, the hands a little dropped.
    return [beat * (1 - g) + 0.1 * g, hand * (1 - g) - 0.06 * g];
}

/** The CPU twin of the vertex stage's fold: where a vertex of the wing is at these angles. */
export function foldWing(kind, p, wing, angles, out = [0, 0, 0]) {
    const { shoulder, wrist } = BIRDS[kind];
    const [side, arm, hand] = wing;
    let [x, y] = p;
    // The hand about the wrist, then all of the wing about the shoulder.
    const turn = (px, py, cx, ang) => {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const dx = px - cx;
        return [cx + dx * c - py * s, dx * s + py * c];
    };
    [x, y] = turn(x, y, side * wrist, side * angles[1] * hand);
    [x, y] = turn(x, y, side * shoulder, side * angles[0] * arm);
    out[0] = x;
    out[1] = y;
    out[2] = p[2];
    return out;
}
