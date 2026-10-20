/**
 * Sunbraid — the spires' shapes (three-free, deterministic by variant).
 *
 * The valley's stones are towers and buttes of pale bedded sandstone: sheer, flat-sided cliffs
 * (a polygonal section, so every face is a plane), stepping in at a setback or two, standing on an
 * apron of scree and capped flat, where a pale turf grows. A plane lit by three coloured suns is one
 * clean colour, so each face of a tower is a block of the colour of the suns it faces, and its
 * corners are where those colours meet.
 *
 * Drawn at unit height as a surface swept round the axis (radius by bearing and height), scaled to a
 * tower's height and turned about its axis at runtime. The shadows come from flat-topped cylinders
 * that follow the same tiers (spireProxies), so a tower's shadow on the valley is as blocky as it is.
 */
import { TAU, mulberry32, smooth } from './sunbraid-core.js';
import { noiseAt } from './sunbraid-noise.js';

/** How many shapes the towers share (each instanced). */
export const SPIRE_VARIANTS = 8;
/** The surface starts this far below the foot (unit heights), so a tower never floats. */
export const SPIRE_BURY = 0.05;

/**
 * The kinds: slender towers (several tiers), buttes (broad, one or two tiers, flat-topped) and
 * "mittens" (a butte's shoulder with a tower rising off one side). Variant v is KINDS[v].
 */
const KINDS = Object.freeze(['tower', 'butte', 'tower', 'mitten', 'tower', 'butte', 'tower', 'mitten']);

export function spireKind(v) {
    return KINDS[((v % KINDS.length) + KINDS.length) % KINDS.length];
}

/** The numbers that make variant `v` what it is. */
export function spireRecipe(v) {
    const random = mulberry32(0x5b1d00 + v * 7919);
    const r = () => random();
    const kind = spireKind(v);
    const sides = 5 + Math.floor(r() * 4);
    // Corners round the section: their bearings and how far out each stands.
    const corners = [];
    for (let i = 0; i < sides; i++) {
        corners.push({
            at: ((i + (r() - 0.5) * 0.55) / sides) * TAU,
            out: 0.8 + r() * 0.4,
            drift: (r() - 0.5) * 0.18,
        });
    }
    corners.sort((a, b) => a.at - b.at);
    const BASES = { butte: [0.36, 0.18], mitten: [0.26, 0.1], tower: [0.085, 0.045] };
    const base = BASES[kind][0] + r() * BASES[kind][1];
    // Tiers: where the cliff steps in, and to how much of its width.
    const tiers = [];
    if (kind === 'tower') {
        const n = 1 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) tiers.push({ at: 0.32 + (i / n) * 0.5 + r() * 0.08, keep: 0.72 + r() * 0.16 });
    } else if (kind === 'butte') {
        tiers.push({ at: 0.5 + r() * 0.2, keep: 0.66 + r() * 0.14 });
        if (r() < 0.5) tiers.push({ at: 0.82 + r() * 0.08, keep: 0.6 + r() * 0.2 });
    } else {
        // A mitten: the shoulder ends low and a tower carries on from one side of it.
        tiers.push({ at: 0.3 + r() * 0.12, keep: 0.3 + r() * 0.08, offset: 0.5 + r() * 0.2 });
    }
    return {
        variant: v,
        kind,
        sides,
        corners,
        base,
        tiers,
        offsetTurn: r() * TAU,
        apron: kind === 'butte' ? 0.22 + r() * 0.14 : 0.32 + r() * 0.22,
        apronTop: kind === 'butte' ? 0.12 + r() * 0.06 : 0.07 + r() * 0.05,
        taper: kind === 'tower' ? 0.1 + r() * 0.2 : 0.1 + r() * 0.08,
        crown: 0.99,
        beds: 34 + Math.floor(r() * 24),
        swell: 0.02 + r() * 0.03,
        caprock: kind === 'tower' && r() < 0.6 ? 0.1 + r() * 0.14 : 0,
        tint: r(),
    };
}

/** The section's radius at bearing theta (a polygon through the corners, corners a little round). */
function polygonRadius(rec, theta, drift) {
    const { corners } = rec;
    const n = corners.length;
    const a = ((theta % TAU) + TAU) % TAU;
    let i = n - 1;
    for (let k = 0; k < n; k++) {
        if (corners[k].at > a) {
            i = k - 1;
            break;
        }
    }
    const c0 = corners[(i + n) % n];
    const c1 = corners[(i + 1) % n];
    const a0 = i < 0 ? c0.at - TAU : c0.at;
    const a1 = i + 1 >= n ? c1.at + TAU : c1.at;
    const r0 = c0.out * (1 + c0.drift * drift);
    const r1 = c1.out * (1 + c1.drift * drift);
    // The straight edge from corner 0 to corner 1, met by the ray at bearing a.
    const p0 = [Math.cos(a0) * r0, Math.sin(a0) * r0];
    const p1 = [Math.cos(a1) * r1, Math.sin(a1) * r1];
    const d = [Math.cos(a), Math.sin(a)];
    const e = [p1[0] - p0[0], p1[1] - p0[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    const s = Math.abs(den) > 1e-9 ? (p0[0] * e[1] - p0[1] * e[0]) / den : (r0 + r1) / 2;
    // Round each corner a touch (blend toward the circle through the two corners).
    const u = (a - a0) / Math.max(1e-6, a1 - a0);
    const corner = Math.exp(-((Math.min(u, 1 - u) / 0.035) ** 2));
    return s * (1 - 0.035 * corner);
}

/** How much of the base width the tower keeps at height t (the setbacks), and its sideways shift. */
function tierAt(rec, t) {
    let keep = 1;
    let shift = 0;
    for (const tier of rec.tiers) {
        const step = smooth(tier.at - 0.004, tier.at + 0.004, t);
        keep *= 1 - (1 - tier.keep) * step;
        if (tier.offset) shift += tier.offset * step;
    }
    return { keep, shift };
}

/** The radius (unit heights) at height t and bearing theta, and the axis offset at t. */
export function spireRadius(rec, t, theta) {
    const tc = Math.max(0, t);
    const { keep } = tierAt(rec, t);
    let r = rec.base * keep * (1 - rec.taper * tc) * polygonRadius(rec, theta, tc);
    // The beds: thin layers that each stand out a little at their top (a ledge every few metres).
    const bedT = tc * rec.beds + 0.6 * Math.sin(tc * 5.3 + rec.tint * 9);
    const u = bedT - Math.floor(bedT);
    r *= 1 + 0.026 * smooth(0.0, 0.18, u) * smooth(1.0, 0.7, u) - 0.012;
    // Irregular swelling and waisting up the column.
    r *= 1 + rec.swell * Math.sin(tc * 6.1 + rec.tint * 4.0) * Math.sin(tc * 2.7 + theta * 0.5 + rec.tint * 7.0);
    // The faces are never ruler-straight: a slow waviness, and vertical cracks cut into them.
    const around = theta / TAU;
    r *= 1 + 0.06 * (noiseAt(around, tc * 0.9 + rec.tint * 3.7, 1) - 0.5);
    const crackField = noiseAt(around * 2 + 0.31, tc * 0.18 + rec.tint, 2);
    const crack = smooth(0.86, 0.96, 1 - Math.abs(crackField * 2 - 1));
    r *= 1 - 0.02 * crack;
    // A cap rock: the hardest bed at the top overhangs the neck below it.
    if (rec.caprock) {
        const neck = Math.exp(-(((t - (rec.crown - 0.14)) / 0.04) ** 2));
        r *= 1 + rec.caprock * smooth(rec.crown - 0.09, rec.crown - 0.07, t) - 0.08 * rec.caprock * neck;
    }
    // The scree apron: a rough concave skirt round the foot.
    const apron = smooth(rec.apronTop, 0, tc);
    const rough = 0.85 + 0.3 * noiseAt(around * 3 + 0.7, tc * 3.0 + rec.tint, 2);
    r *= 1 + rec.apron * apron * apron * rough;
    // The top: the cliff breaks off unevenly round the rim before the flat cap.
    const jag = 0.5 + 0.5 * Math.sin(theta * 5 + rec.tint * 13) * Math.sin(theta * 2 + rec.tint * 3);
    const lip = rec.crown - 0.03 * jag;
    if (t > lip) r *= 1 - 0.22 * smooth(lip, 1, t);
    return Math.max(0, r);
}

/** The axis at height t (a mitten's tower stands off to one side): [x, z] in unit heights. */
export function spireAxis(rec, t, out = [0, 0]) {
    const { shift } = tierAt(rec, t);
    const reach = shift * rec.base;
    out[0] = Math.cos(rec.offsetTurn) * reach;
    out[1] = Math.sin(rec.offsetTurn) * reach;
    return out;
}

/**
 * The mesh of variant `v` at unit height: `segs` bearings × `rings` heights, capped flat on top.
 * Attributes: position, normal, and aSpire (height fraction, ambient occlusion).
 */
export function buildSpireMesh(v, segs = 64, rings = 140) {
    const rec = spireRecipe(v);
    const cols = segs + 1;
    // Rings crowd round the setbacks and the foot so the steps stay sharp.
    const heights = [];
    for (let j = 0; j < rings; j++) heights.push(-SPIRE_BURY + (1 + SPIRE_BURY) * (j / (rings - 1)));
    rec.tiers.forEach((tier) => [-0.006, -0.002, 0.002, 0.006].forEach((dt) => heights.push(tier.at + dt)));
    heights.sort((a, b) => a - b);
    const R = heights.length;
    const count = cols * R + 1;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const spire = new Float32Array(count * 2);
    const axis = [0, 0];
    for (let j = 0; j < R; j++) {
        const t = heights[j];
        spireAxis(rec, t, axis);
        for (let i = 0; i < cols; i++) {
            const theta = (i / segs) * TAU;
            const r = spireRadius(rec, t, theta);
            const k = j * cols + i;
            position[k * 3] = axis[0] + Math.cos(theta) * r;
            position[k * 3 + 1] = Math.min(t, 1);
            position[k * 3 + 2] = axis[1] + Math.sin(theta) * r;
            spire[k * 2] = t;
        }
    }
    // The flat top's centre.
    const top = cols * R;
    spireAxis(rec, 1, axis);
    position[top * 3] = axis[0];
    position[top * 3 + 1] = 1.004;
    position[top * 3 + 2] = axis[1];
    spire[top * 2] = 1;

    const index = new Uint32Array((segs * (R - 1) * 2 + segs) * 3);
    let n = 0;
    for (let j = 0; j < R - 1; j++) {
        for (let i = 0; i < segs; i++) {
            const a = j * cols + i;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            // Outward: (c − a) × (b − a) with theta rising toward +z.
            index[n++] = a;
            index[n++] = c;
            index[n++] = b;
            index[n++] = b;
            index[n++] = c;
            index[n++] = d;
        }
    }
    const last = (R - 1) * cols;
    for (let i = 0; i < segs; i++) {
        index[n++] = last + i;
        index[n++] = top;
        index[n++] = last + i + 1;
    }

    // Normals: area-weighted from the faces, the seam welded (first column = last).
    const acc = new Float64Array(count * 3);
    for (let f = 0; f < index.length; f += 3) {
        const ia = index[f] * 3;
        const ib = index[f + 1] * 3;
        const ic = index[f + 2] * 3;
        const ux = position[ib] - position[ia];
        const uy = position[ib + 1] - position[ia + 1];
        const uz = position[ib + 2] - position[ia + 2];
        const vx = position[ic] - position[ia];
        const vy = position[ic + 1] - position[ia + 1];
        const vz = position[ic + 2] - position[ia + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const v3 of [ia, ib, ic]) {
            acc[v3] += nx;
            acc[v3 + 1] += ny;
            acc[v3 + 2] += nz;
        }
    }
    for (let j = 0; j < R; j++) {
        const a = j * cols * 3;
        const b = (j * cols + segs) * 3;
        for (let c = 0; c < 3; c++) {
            const s = acc[a + c] + acc[b + c];
            acc[a + c] = s;
            acc[b + c] = s;
        }
    }
    for (let k = 0; k < count; k++) {
        const x = acc[k * 3];
        const y = acc[k * 3 + 1];
        const z = acc[k * 3 + 2];
        const len = Math.hypot(x, y, z) || 1;
        normal[k * 3] = x / len;
        normal[k * 3 + 1] = y / len;
        normal[k * 3 + 2] = z / len;
    }

    // Ambient occlusion: the foot sits in its own scree, the inner corner of a setback is shaded.
    for (let j = 0; j < R; j++) {
        const t = heights[j];
        let shade = 0.32 * smooth(0.1, -0.04, t);
        rec.tiers.forEach((tier) => {
            shade += 0.28 * smooth(0.06, 0, t - tier.at) * (t >= tier.at ? 1 : 0);
        });
        for (let i = 0; i < cols; i++) spire[(j * cols + i) * 2 + 1] = Math.max(0.3, 1 - shade);
    }
    spire[top * 2 + 1] = 1;
    return {
        position, normal, spire, index, recipe: rec,
    };
}

/**
 * The flat-topped cylinders that cast the tower's shadow, at unit height: { t0, t1, r, x, z }
 * (one per tier, its radius the section's mean a little inside the cliffs, x/z its axis offset).
 */
export function spireProxies(v) {
    const rec = spireRecipe(v);
    const cuts = [-SPIRE_BURY, ...rec.tiers.map((tier) => tier.at), 1];
    const axis = [0, 0];
    const out = [];
    for (let k = 0; k < cuts.length - 1; k++) {
        const t0 = cuts[k];
        const t1 = cuts[k + 1];
        // The apron is broad but low: give the bottom tier the cliff's width above the scree.
        const from = k === 0 ? Math.max(t0, rec.apronTop) : t0 + 0.006;
        let sum = 0;
        let count = 0;
        for (let s = 0; s <= 6; s++) {
            const t = from + ((t1 - from) * s) / 6;
            for (let i = 0; i < 16; i++) {
                sum += spireRadius(rec, Math.min(t, rec.crown), (i / 16) * TAU);
                count += 1;
            }
        }
        spireAxis(rec, (t0 + t1) / 2, axis);
        out.push({
            t0, t1, r: (sum / count) * 0.94, x: axis[0], z: axis[1],
        });
    }
    return out;
}
