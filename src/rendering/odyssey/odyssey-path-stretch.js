/**
 * THE LONGER RAIL INSIDE THE HOLE (2026-11-17; the schedule: transitions/odyssey-fold-stretch.js).
 *
 * The journey's curve with chapter 7's middle stretched in the world: between the stretch's ends
 * the rail leaves today's line along its own direction, climbs a wide spiral and comes back onto
 * today's line along its direction at the far end. Everywhere else it IS today's curve: the class
 * extends the same Catmull-Rom over the same points and hands every progress outside the stretch
 * to the inherited methods, so the dive, the exit and every other chapter read the same world to
 * the bit.
 *
 * How the parts agree:
 *  - `getPointAt` / `getTangentAt`: the section inside the stretch, today's rail outside. Progress
 *    maps onto the section by the stretch's world measure (foldStretchMeasure), so the eye's world
 *    speed for an even pace of progress eases up into the section and down out of it, never jumps.
 *  - `getLength()` stays the length of today's rail: it is the journey's scale (progress <-> world
 *    for windows authored in world units, the rail shader's patterns), not the eye's distance.
 *  - Frames: a rail frame is carried along the curve from its start (three's computeFrenetFrames,
 *    the camera's path table), so a longer middle would turn every frame after it. Outside the
 *    stretch the frames are today's (`computeFrenetFrames` takes them from the inherited method;
 *    the camera builds its table on `baseCurve`), and inside it the carried frame is twisted, a
 *    little at a time, to arrive on today's frame at the far end (`foldFrameAt`).
 *  - The rail's tube (`railSamplePlan`): more rings in the stretch, so its segments are as long in
 *    the world as anywhere else.
 */
import * as THREE from 'three/webgpu';
import {
    foldStretchArea,
    foldStretchRange,
} from './transitions/odyssey-fold-stretch.js';

export const FOLD_SPIRAL = Object.freeze({
    /** Straight lead-in (world units) along today's rail where the section leaves it. */
    leadIn: 16,
    /** Whole turns the spiral makes besides the part of one it needs to come round. */
    turns: 0,
    /** Which way it turns (+1 left, -1 right), as seen from above. */
    side: 1,
    /** The pull-up at the far end: a bend in the upright plane, this radius (world units), from
     * level flight into today's steep climb where the section rejoins it. */
    pullRadius: 34,
    /** Waypoints per turn of the spiral, and on the pull-up. */
    perTurn: 16,
    pullSteps: 5,
    /** Samples of the section's table (uniform in its arc). */
    samples: 4096,
});

const UP = new THREE.Vector3(0, 1, 0);

/** Cubic Hermite through waypoints with unit tangents scaled by the chord (G1): its points and
 * (in `out.tangents`) its unit derivative at each, so the section's direction is smooth, not the
 * polyline's. */
function hermiteChain(points, tangents, perSegment = 48) {
    const out = [];
    out.tangents = [];
    const h = new THREE.Vector3();
    const dh = new THREE.Vector3();
    for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const d = p0.distanceTo(p1);
        const m0 = tangents[i].clone().multiplyScalar(d);
        const m1 = tangents[i + 1].clone().multiplyScalar(d);
        for (let k = (i === 0 ? 0 : 1); k <= perSegment; k += 1) {
            const t = k / perSegment;
            const t2 = t * t;
            const t3 = t2 * t;
            const h00 = (2 * t3) - (3 * t2) + 1;
            const h10 = t3 - (2 * t2) + t;
            const h01 = (-2 * t3) + (3 * t2);
            const h11 = t3 - t2;
            h.set(0, 0, 0)
                .addScaledVector(p0, h00).addScaledVector(m0, h10)
                .addScaledVector(p1, h01)
                .addScaledVector(m1, h11);
            out.push(h.clone());
            dh.set(0, 0, 0)
                .addScaledVector(p0, (6 * t2) - (6 * t)).addScaledVector(m0, (3 * t2) - (4 * t) + 1)
                .addScaledVector(p1, (-6 * t2) + (6 * t))
                .addScaledVector(m1, (3 * t2) - (2 * t));
            out.tangents.push(dh.lengthSq() > 1e-12 ? dh.clone().normalize() : tangents[i].clone());
        }
    }
    return out;
}

/**
 * The section's frame of the spiral (everything but its bulge), from P_A heading T_A to P_B
 * heading T_B: a straight lead-in, a level spiral round a centre that is on the same side of both
 * ends' headings (its radius running from one end's to the other's), and a pull-up in the upright
 * plane into today's climb at P_B.
 * @returns {object|null} null when no such spiral exists for `side`
 */
function spiralFrame(pA, tA, pB, tB, side, spec = FOLD_SPIRAL) {
    const p1 = pA.clone().addScaledVector(tA, spec.leadIn);
    const hA = new THREE.Vector3(tA.x, 0, tA.z).normalize();
    const hBraw = new THREE.Vector3(tB.x, 0, tB.z);
    const hB = hBraw.lengthSq() > 1e-6 ? hBraw.normalize() : hA.clone();
    const betaB = Math.asin(Math.min(1, Math.max(-1, tB.y)));
    // The pull-up: level along hB at its start, today's direction at P_B.
    const pull = [];
    const rv = spec.pullRadius;
    for (let k = 0; k <= spec.pullSteps; k += 1) {
        const beta = (betaB * k) / spec.pullSteps;
        const point = pB.clone()
            .addScaledVector(hB, -rv * (Math.sin(betaB) - Math.sin(beta)))
            .addScaledVector(UP, -rv * (Math.cos(beta) - Math.cos(betaB)));
        const tangent = hB.clone().multiplyScalar(Math.cos(beta)).addScaledVector(UP, Math.sin(beta)).normalize();
        pull.push({ point, tangent });
    }
    const q0 = pull[0].point;
    // Centre C = p1 + R0 perpA = q0 + R1 perpB (level plane), perp = the side's normal of a heading.
    const perpA = new THREE.Vector3(hA.z, 0, -hA.x).multiplyScalar(side);
    const perpB = new THREE.Vector3(hB.z, 0, -hB.x).multiplyScalar(side);
    const dx = q0.x - p1.x;
    const dz = q0.z - p1.z;
    // R0 perpA - R1 perpB = d
    const det = (perpA.x * -perpB.z) - (-perpB.x * perpA.z);
    if (Math.abs(det) < 1e-6) return null;
    const r0 = ((dx * -perpB.z) - (-perpB.x * dz)) / det;
    const r1 = ((perpA.x * dz) - (dx * perpA.z)) / det;
    if (!(r0 > 8) || !(r1 > 8)) return null;
    const c = p1.clone().addScaledVector(perpA, r0);
    const angleOf = (v) => Math.atan2(v.z - c.z, v.x - c.x);
    const theta0 = angleOf(p1);
    // Travel round C in the sense that leaves p1 along hA.
    const dir = (-Math.sin(theta0) * hA.x) + (Math.cos(theta0) * hA.z) >= 0 ? 1 : -1;
    let theta1 = angleOf(q0);
    while ((theta1 - theta0) * dir <= 0) theta1 += dir * Math.PI * 2;
    theta1 += dir * Math.PI * 2 * spec.turns;
    return {
        p1, q0, c, r0, r1, theta0, theta1, pull, pA, tA,
    };
}

/** The waypoints of a spiral frame with its radius bulged by `bulge` mid-way (world units). */
function spiralWaypoints(frame, bulge, spec = FOLD_SPIRAL) {
    const {
        p1, q0, c, r0, r1, theta0, theta1, pull, pA, tA,
    } = frame;
    const steps = Math.max(6, Math.round((spec.perTurn * Math.abs(theta1 - theta0)) / (Math.PI * 2)));
    const points = [pA.clone(), p1.clone()];
    const tangents = [tA.clone(), tA.clone()];
    for (let j = 1; j < steps; j += 1) {
        const f = j / steps;
        const theta = theta0 + ((theta1 - theta0) * f);
        // (The bulge leaves both ends level with their radius: sin^2, flat at 0 and 1.)
        const r = r0 + ((r1 - r0) * f) + (bulge * (Math.sin(Math.PI * f) ** 2));
        const y = p1.y + ((q0.y - p1.y) * f);
        points.push(new THREE.Vector3(c.x + (r * Math.cos(theta)), y, c.z + (r * Math.sin(theta))));
        tangents.push(null);
    }
    pull.forEach(({ point, tangent }) => {
        points.push(point.clone());
        tangents.push(tangent.clone());
    });
    for (let i = 2; i < points.length; i += 1) {
        if (!tangents[i]) tangents[i] = points[i + 1].clone().sub(points[i - 1]).normalize();
    }
    return { points, tangents };
}

/** A section table, uniform in arc: positions and unit tangents. */
function tableFromPolyline(dense, samples, denseTangents) {
    const cum = new Float64Array(dense.length);
    for (let i = 1; i < dense.length; i += 1) cum[i] = cum[i - 1] + dense[i].distanceTo(dense[i - 1]);
    const length = cum[dense.length - 1];
    const positions = new Float64Array((samples + 1) * 3);
    const tangents = new Float64Array((samples + 1) * 3);
    const tv = new THREE.Vector3();
    let j = 0;
    for (let i = 0; i <= samples; i += 1) {
        const s = (length * i) / samples;
        while (j < dense.length - 2 && cum[j + 1] < s) j += 1;
        const span = cum[j + 1] - cum[j];
        const f = span > 0 ? (s - cum[j]) / span : 0;
        positions[i * 3] = dense[j].x + ((dense[j + 1].x - dense[j].x) * f);
        positions[(i * 3) + 1] = dense[j].y + ((dense[j + 1].y - dense[j].y) * f);
        positions[(i * 3) + 2] = dense[j].z + ((dense[j + 1].z - dense[j].z) * f);
        tv.copy(denseTangents[j]).lerp(denseTangents[j + 1], f).normalize();
        tangents[i * 3] = tv.x;
        tangents[(i * 3) + 1] = tv.y;
        tangents[(i * 3) + 2] = tv.z;
    }
    return { positions, tangents, length };
}

/**
 * Build the section between progress `a` and `b` of `base` (methods of today's curve), with the
 * spiral's radius solved so its length is `targetLength`.
 */
function buildSection(base, a, b, targetLength, spec = FOLD_SPIRAL) {
    const pA = base.getPointAt(a, new THREE.Vector3());
    const tA = base.getTangentAt(a, new THREE.Vector3()).normalize();
    const pB = base.getPointAt(b, new THREE.Vector3());
    const tB = base.getTangentAt(b, new THREE.Vector3()).normalize();
    const frame = spiralFrame(pA, tA, pB, tB, spec.side, spec) ?? spiralFrame(pA, tA, pB, tB, -spec.side, spec);
    if (!frame) return null;
    const measure = (bulge) => {
        const { points, tangents } = spiralWaypoints(frame, bulge, spec);
        const dense = hermiteChain(points, tangents, 160);
        let length = 0;
        for (let i = 1; i < dense.length; i += 1) length += dense[i].distanceTo(dense[i - 1]);
        return { dense, length };
    };
    // The bulge that makes the section as long as the stretch's world (its length only grows with it).
    let lo = -0.85 * Math.min(frame.r0, frame.r1);
    let hi = 600;
    for (let i = 0; i < 52; i += 1) {
        const mid = (lo + hi) / 2;
        if (measure(mid).length < targetLength) lo = mid;
        else hi = mid;
    }
    const bulge = (lo + hi) / 2;
    const radius = ((frame.r0 + frame.r1) / 2) + bulge;
    const { dense } = measure(bulge);
    const table = tableFromPolyline(dense, spec.samples, dense.tangents);
    const n = spec.samples;
    const { positions, tangents } = table;
    // Exactly today's directions at the ends.
    [[0, tA], [n, tB]].forEach(([i, t]) => {
        tangents[i * 3] = t.x;
        tangents[(i * 3) + 1] = t.y;
        tangents[(i * 3) + 2] = t.z;
    });
    // A reference frame carried along the section (rotation-minimising, as the rail's own frames
    // are): any normal at its start; `foldFrameAt` turns it to the caller's.
    const normals = new Float64Array((n + 1) * 3);
    const t0 = new THREE.Vector3(tangents[0], tangents[1], tangents[2]);
    const n0 = new THREE.Vector3().crossVectors(t0, UP);
    if (n0.lengthSq() < 1e-8) n0.set(1, 0, 0);
    n0.cross(t0).normalize().negate();
    const prevT = t0.clone();
    const curT = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const nn = n0.clone();
    const q = new THREE.Quaternion();
    for (let i = 0; i <= n; i += 1) {
        curT.set(tangents[i * 3], tangents[(i * 3) + 1], tangents[(i * 3) + 2]);
        if (i > 0) {
            axis.crossVectors(prevT, curT);
            if (axis.lengthSq() > 1e-12) {
                q.setFromUnitVectors(prevT, curT);
                nn.applyQuaternion(q);
            }
            // Keep it exactly perpendicular.
            nn.addScaledVector(curT, -nn.dot(curT)).normalize();
        }
        normals[i * 3] = nn.x;
        normals[(i * 3) + 1] = nn.y;
        normals[(i * 3) + 2] = nn.z;
        prevT.copy(curT);
    }
    return {
        positions, tangents, normals, length: table.length, samples: n, radius, bulge, frame, pA, pB, tA, tB,
    };
}

const smooth01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/**
 * The journey's curve with chapter 7's middle longer in the world (see the file header).
 */
export class OdysseyFoldStretchedCurve extends THREE.CatmullRomCurve3 {
    /**
     * @param {THREE.Vector3[]} points the journey's control points
     * @param {string} curveType
     * @param {number} tension
     * @param {number[]} chapterPositions the layout's chapter boundaries
     */
    constructor(points, curveType, tension, chapterPositions) {
        super(points, false, curveType, tension);
        this.isOdysseyFoldStretched = true;
        this.chapterPositions = Array.isArray(chapterPositions) ? chapterPositions.slice() : null;
        this.range = foldStretchRange(this.chapterPositions);
        this._section = null;
        /** Today's rail, as a plain curve over the same points (the camera builds its path table
         * on it, and today's frames come from it: three carries them along `getTangentAt`). */
        this.baseCurve = new THREE.CatmullRomCurve3(points.map((v) => v.clone()), false, curveType, tension);
        this._v = new THREE.Vector3();
        this._w = new THREE.Vector3();
        this._frameCache = null;
    }

    /** Whether progress `u` is strictly inside the stretch (today's rail at its ends). */
    inFoldStretch(u) {
        return !!this.range && u > this.range.a && u < this.range.b;
    }

    /** The section, built on first use (its spiral's radius is solved against its length). */
    section() {
        if (this._section || !this.range) return this._section;
        const { a, b } = this.range;
        const length = this.getLength();
        const extra = foldStretchArea(b, this.chapterPositions);
        const target = length * ((b - a) + extra);
        this._section = buildSection(this.baseCurve, a, b, target);
        this._section.target = target;
        return this._section;
    }

    /** Where progress `u` (inside the stretch) is along the section, as a sample index (float). */
    _sectionIndex(u) {
        const sec = this.section();
        const { a } = this.range;
        const s = this.getLength() * ((u - a) + foldStretchArea(u, this.chapterPositions));
        const f = Math.min(1, Math.max(0, s / sec.target));
        return f * sec.samples;
    }

    _lerpRow(array, x, target) {
        const sec = this._section;
        const i0 = Math.min(sec.samples - 1, Math.floor(x));
        const f = x - i0;
        const o0 = i0 * 3;
        const o1 = o0 + 3;
        return target.set(
            array[o0] + ((array[o1] - array[o0]) * f),
            array[o0 + 1] + ((array[o1 + 1] - array[o0 + 1]) * f),
            array[o0 + 2] + ((array[o1 + 2] - array[o0 + 2]) * f),
        );
    }

    getPointAt(u, target = new THREE.Vector3()) {
        if (!this.inFoldStretch(u) || !this.section()) return super.getPointAt(u, target);
        return this._lerpRow(this._section.positions, this._sectionIndex(u), target);
    }

    getTangentAt(u, target = new THREE.Vector3()) {
        if (!this.inFoldStretch(u) || !this.section()) return super.getTangentAt(u, target);
        return this._lerpRow(this._section.tangents, this._sectionIndex(u), target).normalize();
    }

    /**
     * The rail's frame at progress `u` inside the stretch, carried along the section from the
     * caller's normal `nA` at its start and twisted (eased in and out) to arrive on `nB` at its end.
     * @returns {boolean} false outside the stretch (nothing written)
     */
    foldFrameAt(u, nA, nB, outPosition, outTangent, outNormal, outRight) {
        if (!this.inFoldStretch(u) || !this.section()) return false;
        const sec = this._section;
        const x = this._sectionIndex(u);
        this._lerpRow(sec.positions, x, outPosition);
        this._lerpRow(sec.tangents, x, outTangent).normalize();
        const { phiA, psi } = this._twist(nA, nB);
        const angle = phiA + (psi * smooth01(x / sec.samples));
        const ref = this._lerpRow(sec.normals, x, this._v);
        ref.addScaledVector(outTangent, -ref.dot(outTangent)).normalize();
        const bin = this._w.crossVectors(outTangent, ref);
        outNormal.copy(ref).multiplyScalar(Math.cos(angle)).addScaledVector(bin, Math.sin(angle)).normalize();
        if (outRight) {
            outRight.crossVectors(outTangent, outNormal).normalize();
            outNormal.crossVectors(outRight, outTangent).normalize();
        }
        return true;
    }

    /** The turn of the caller's start normal from the reference, and the twist to end on `nB`. */
    _twist(nA, nB) {
        const c = this._frameCache;
        if (c && c.ax === nA.x && c.ay === nA.y && c.az === nA.z
            && c.bx === nB.x && c.by === nB.y && c.bz === nB.z) return c;
        const sec = this._section;
        const n = sec.samples;
        const angleAbout = (row, t, v) => {
            const ref = new THREE.Vector3(sec.normals[row * 3], sec.normals[(row * 3) + 1], sec.normals[(row * 3) + 2]);
            const bin = new THREE.Vector3().crossVectors(t, ref);
            return Math.atan2(v.dot(bin), v.dot(ref));
        };
        const tA = new THREE.Vector3(sec.tangents[0], sec.tangents[1], sec.tangents[2]);
        const tB = new THREE.Vector3(sec.tangents[n * 3], sec.tangents[(n * 3) + 1], sec.tangents[(n * 3) + 2]);
        const phiA = angleAbout(0, tA, nA);
        let psi = angleAbout(n, tB, nB) - phiA;
        psi = Math.atan2(Math.sin(psi), Math.cos(psi));
        this._frameCache = {
            ax: nA.x, ay: nA.y, az: nA.z, bx: nB.x, by: nB.y, bz: nB.z, phiA, psi,
        };
        return this._frameCache;
    }

    /**
     * Today's frames outside the stretch, and inside it the section's, carried and twisted to
     * meet today's at both ends.
     */
    computeFrenetFrames(segments, closed) {
        const frames = this.baseCurve.computeFrenetFrames(segments, closed);
        if (!this.range || !this.section()) return frames;
        const plan = this._planFrames(Array.from({ length: segments + 1 }, (_, i) => i / segments), frames, segments);
        return plan;
    }

    /**
     * The rail tube's rings: today's even rings, and more in the stretch so a ring is as far from
     * the next in the world as anywhere else; with their frames.
     * @param {number} segments today's ring count over the whole journey
     * @returns {{ us: number[], tangents: THREE.Vector3[], normals: THREE.Vector3[], binormals: THREE.Vector3[] }|null}
     */
    railSamplePlan(segments) {
        if (!this.range || !this.section()) return null;
        const base = this.baseCurve.computeFrenetFrames(segments, false);
        const { a, b } = this.range;
        const us = [];
        const length = this.getLength();
        const ringWorld = length / segments;
        for (let i = 0; i <= segments; i += 1) {
            const u = i / segments;
            us.push(u);
            const next = (i + 1) / segments;
            if (i < segments && next > a && u < b) {
                // Rings between u and next, by the world the stretch puts between them.
                const lo = Math.max(u, a);
                const hi = Math.min(next, b);
                const world = length * ((hi - lo) + (foldStretchArea(hi, this.chapterPositions)
                    - foldStretchArea(lo, this.chapterPositions)));
                const extra = Math.max(0, Math.ceil(world / ringWorld) - 1);
                for (let k = 1; k <= extra; k += 1) us.push(u + (((next - u) * k) / (extra + 1)));
            }
        }
        const frames = this._planFrames(us, base, segments);
        return { us, ...frames };
    }

    /** Frames at progress values `us`: today's where `u` is one of today's rings outside the stretch. */
    _planFrames(us, base, segments) {
        const { a, b } = this.range;
        const iA = Math.floor(a * segments);
        const iB = Math.ceil(b * segments);
        const nA = base.normals[iA];
        const nB = base.normals[Math.min(segments, iB)];
        const tangents = [];
        const normals = [];
        const binormals = [];
        const pos = new THREE.Vector3();
        us.forEach((u) => {
            const ring = u * segments;
            const index = Math.round(ring);
            if (!this.inFoldStretch(u) && Math.abs(ring - index) < 1e-9) {
                tangents.push(base.tangents[index].clone());
                normals.push(base.normals[index].clone());
                binormals.push(base.binormals[index].clone());
                return;
            }
            const t = new THREE.Vector3();
            const n = new THREE.Vector3();
            if (!this.foldFrameAt(u, nA, nB, pos, t, n, null)) {
                this.getTangentAt(u, t);
                n.copy(base.normals[Math.min(segments, Math.max(0, index))]);
                n.addScaledVector(t, -n.dot(t)).normalize();
            }
            tangents.push(t);
            normals.push(n);
            binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
        });
        return { tangents, normals, binormals };
    }
}

/**
 * The journey's curve with the fold's stretch (or plain today's curve without a chapter 7).
 * @param {THREE.Vector3[]} points
 * @param {string} curveType
 * @param {number} tension
 * @param {number[]} chapterPositions
 * @returns {THREE.CatmullRomCurve3}
 */
export function createOdysseyPathCurve(points, curveType, tension, chapterPositions) {
    if (!foldStretchRange(chapterPositions)) {
        const curve = new THREE.CatmullRomCurve3(points);
        curve.curveType = curveType;
        curve.tension = tension;
        return curve;
    }
    return new OdysseyFoldStretchedCurve(points, curveType, tension, chapterPositions);
}
