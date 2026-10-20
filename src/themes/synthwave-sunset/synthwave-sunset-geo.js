/**
 * Synthwave Sunset — small geometry builders shared by the wheel, the pier and the promenade.
 *
 * Everything is pushed into one `out` record ({ position, normal, meta, index }) per merged mesh,
 * so each part is one draw. `meta` is a vec4 per vertex (the part's own attribute: kind, and
 * whatever its shader needs). Faces are wound counter-clockwise seen from outside, with outward
 * normals (a front-side material draws them).
 */

import * as THREE from 'three/webgpu';

export function makeOut() {
    return {
        position: [], normal: [], meta: [], index: [],
    };
}

const _t = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _ref = new THREE.Vector3();
const _off = new THREE.Vector3();

/**
 * A tube along a polyline (closed = a ring). `meta` is a vec4 or a function (i, k) → vec4 for
 * per-vertex values (i = path point, k = side).
 */
export function tube(out, points, radius, sides, closed, meta) {
    const base = out.position.length / 3;
    const n = points.length;
    for (let i = 0; i < n; i += 1) {
        const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
        const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        _t.copy(next).sub(prev).normalize();
        _ref.set(0, 0, 1);
        if (Math.abs(_t.dot(_ref)) > 0.9) _ref.set(0, 1, 0);
        _n1.crossVectors(_t, _ref).normalize();
        _n2.crossVectors(_t, _n1).normalize();
        const r = typeof radius === 'function' ? radius(i) : radius;
        for (let k = 0; k < sides; k += 1) {
            const a = (k / sides) * Math.PI * 2;
            _off.copy(_n1).multiplyScalar(Math.cos(a)).addScaledVector(_n2, Math.sin(a));
            out.position.push(points[i].x + _off.x * r, points[i].y + _off.y * r, points[i].z + _off.z * r);
            out.normal.push(_off.x, _off.y, _off.z);
            const m = typeof meta === 'function' ? meta(i, k) : meta;
            out.meta.push(m[0], m[1], m[2], m[3]);
        }
    }
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i += 1) {
        const i1 = (i + 1) % n;
        for (let k = 0; k < sides; k += 1) {
            const k1 = (k + 1) % sides;
            const a = base + i * sides + k;
            const b = base + i1 * sides + k;
            const c = base + i * sides + k1;
            const d = base + i1 * sides + k1;
            // With n2 = t × n1 the ring runs clockwise about t: (a, c, b) faces outward.
            out.index.push(a, c, b, c, d, b);
        }
    }
}

/** A straight strut from A to B. */
export function strut(out, A, B, radius, sides, meta) {
    tube(out, [A, B], radius, sides, false, meta);
}

/** The world axes as a basis. */
export const WORLD_BASIS = Object.freeze({
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
});

/**
 * A box centred at c with half extents h along a RIGHT-HANDED basis {x, y, z} (x × y = z), so
 * the winding below stays counter-clockwise from outside. `meta` is a vec4 or a function
 * (face, corner, point) → vec4.
 */
export function box(out, c, h, meta, basis = WORLD_BASIS) {
    const { x: ax, y: ay, z: az } = basis;
    const faces = [
        [ax, 1, ay, az], [ax, -1, ay, az],
        [ay, 1, az, ax], [ay, -1, az, ax],
        [az, 1, ax, ay], [az, -1, ax, ay],
    ];
    const hOf = (axis) => {
        if (axis === ax) return h.x;
        if (axis === ay) return h.y;
        return h.z;
    };
    const p = new THREE.Vector3();
    faces.forEach(([nAxis, sign, uAxis, vAxis], f) => {
        const base = out.position.length / 3;
        // For sign −1 the in-face axes swap so (u × v) still points along the outward normal.
        const U = sign > 0 ? uAxis : vAxis;
        const V = sign > 0 ? vAxis : uAxis;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        corners.forEach(([su, sv], k) => {
            p.copy(c).addScaledVector(nAxis, sign * hOf(nAxis))
                .addScaledVector(U, su * hOf(U))
                .addScaledVector(V, sv * hOf(V));
            out.position.push(p.x, p.y, p.z);
            out.normal.push(nAxis.x * sign, nAxis.y * sign, nAxis.z * sign);
            const m = typeof meta === 'function' ? meta(f, k, p) : meta;
            out.meta.push(m[0], m[1], m[2], m[3]);
        });
        out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
}

/**
 * A surface of revolution about the vertical through `c`: `profile` is [[radius, height], …]
 * from the bottom up. `meta(angleFrac, heightFrac, point)` → vec4.
 */
export function lathe(out, c, profile, segments, meta) {
    const base = out.position.length / 3;
    const rows = profile.length;
    const nrm = new THREE.Vector3();
    for (let i = 0; i < rows; i += 1) {
        const [r, y] = profile[i];
        const [r0, y0] = profile[Math.max(0, i - 1)];
        const [r1, y1] = profile[Math.min(rows - 1, i + 1)];
        // Profile tangent (dr, dy) → outward normal (dy, −dr) in the (radial, up) plane.
        const dr = r1 - r0;
        const dy = y1 - y0;
        const len = Math.hypot(dr, dy) || 1;
        for (let k = 0; k <= segments; k += 1) {
            const a = (k / segments) * Math.PI * 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const px = c.x + ca * r;
            const pz = c.z + sa * r;
            out.position.push(px, c.y + y, pz);
            nrm.set(ca * (dy / len), -dr / len, sa * (dy / len)).normalize();
            out.normal.push(nrm.x, nrm.y, nrm.z);
            const m = meta(k / segments, i / (rows - 1), new THREE.Vector3(px, c.y + y, pz));
            out.meta.push(m[0], m[1], m[2], m[3]);
        }
    }
    for (let i = 0; i < rows - 1; i += 1) {
        for (let k = 0; k < segments; k += 1) {
            const a = base + i * (segments + 1) + k;
            const b = a + segments + 1;
            // Angle grows from +x toward +z, which turns clockwise seen from above: (a, b, a+1)
            // faces outward.
            out.index.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
}

/**
 * The outline of a rectangle with rounded corners, in a plan frame (a = along, c = across), centred
 * on the origin: `w` × `d`, corner radii [aLow·cLow, aHigh·cLow, aHigh·cHigh, aLow·cHigh] (0 =
 * sharp). It runs from the start of the cLow side toward +a, so the arc length along that side is
 * a + w/2 − r0. Consecutive duplicates are dropped (a radius of half the depth makes a round end).
 */
export function roundedRectOutline(w, d, radii, segments = 6) {
    const hw = w / 2;
    const hd = d / 2;
    const [r0, r1, r2, r3] = radii.map((r) => Math.max(0, Math.min(r, hw, hd)));
    const pts = [[-hw + r0, -hd]];
    const arc = (ca, cc, r, from) => {
        if (r <= 0) {
            pts.push([ca, cc]);
            return;
        }
        const n = Math.max(1, segments);
        for (let i = 0; i <= n; i += 1) {
            const t = from + (i / n) * (Math.PI / 2);
            pts.push([ca + r * Math.cos(t), cc + r * Math.sin(t)]);
        }
    };
    arc(hw - r1, -hd + r1, r1, -Math.PI / 2);
    arc(hw - r2, hd - r2, r2, 0);
    arc(-hw + r3, hd - r3, r3, Math.PI / 2);
    arc(-hw + r0, -hd + r0, r0, Math.PI);
    const clean = [];
    pts.forEach((q) => {
        const last = clean[clean.length - 1];
        if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-4) clean.push(q);
    });
    const f = clean[0];
    const l = clean[clean.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-4) clean.pop();
    return clean;
}

/**
 * A vertical prism on a CONVEX plan outline (a closed loop of [a, c] points running with a toward
 * c, as `roundedRectOutline` makes them) between heights y0 and y1, placed at `base` in a
 * right-handed basis {x: along, y: up, z: across}. Walls take smooth normals across gentle turns
 * (an arc) and sharp ones at corners; a top cap is added unless `cap` is false. `meta(u, y, n)`
 * gives each vertex its vec4 (u = arc length along the outline from its first point, n the world
 * normal). Every triangle is wound from its geometric normal, so it faces out whatever the basis.
 */
export function prism(out, base, B, outline, y0, y1, meta, { cap = true, smooth = 0.6 } = {}) {
    const n = outline.length;
    const world = (q, y) => new THREE.Vector3().copy(base).addScaledVector(B.x, q[0]).addScaledVector(B.z, q[1])
        .setY(base.y + y);
    const edgeN = [];
    for (let i = 0; i < n; i += 1) {
        const a = outline[i];
        const b = outline[(i + 1) % n];
        const da = b[0] - a[0];
        const dc = b[1] - a[1];
        const len = Math.hypot(da, dc) || 1;
        edgeN.push([dc / len, -da / len]);
    }
    const toWorldN = (m) => new THREE.Vector3().addScaledVector(B.x, m[0]).addScaledVector(B.z, m[1]).normalize();
    const vertexN = (i, e) => {
        // At vertex i, shared by edges i-1 and i: average them when they turn gently.
        const prev = edgeN[(i - 1 + n) % n];
        const next = edgeN[i % n];
        if (prev[0] * next[0] + prev[1] * next[1] < Math.cos(smooth)) return toWorldN(edgeN[e]);
        return toWorldN([prev[0] + next[0], prev[1] + next[1]]);
    };
    const push = (p, nrm, m) => {
        out.position.push(p.x, p.y, p.z);
        out.normal.push(nrm.x, nrm.y, nrm.z);
        out.meta.push(m[0], m[1], m[2], m[3]);
        return out.position.length / 3 - 1;
    };
    const tri = (i0, i1, i2, want) => {
        const p = (i) => new THREE.Vector3().fromArray(out.position, i * 3);
        const g = p(i1).sub(p(i0)).cross(p(i2).sub(p(i0)));
        if (g.dot(want) >= 0) out.index.push(i0, i1, i2);
        else out.index.push(i0, i2, i1);
    };
    let u = 0;
    for (let i = 0; i < n; i += 1) {
        const qa = outline[i];
        const qb = outline[(i + 1) % n];
        const len = Math.hypot(qb[0] - qa[0], qb[1] - qa[1]);
        const na = vertexN(i, i);
        const nb = vertexN((i + 1) % n, i);
        const v0 = push(world(qa, y0), na, meta(u, y0, na));
        const v1 = push(world(qb, y0), nb, meta(u + len, y0, nb));
        const v2 = push(world(qb, y1), nb, meta(u + len, y1, nb));
        const v3 = push(world(qa, y1), na, meta(u, y1, na));
        const want = toWorldN(edgeN[i]);
        tri(v0, v1, v2, want);
        tri(v0, v2, v3, want);
        u += len;
    }
    if (cap) {
        const up = new THREE.Vector3(0, 1, 0);
        let ca = 0;
        let cc = 0;
        outline.forEach((q) => { ca += q[0] / n; cc += q[1] / n; });
        const centre = push(world([ca, cc], y1), up, meta(0, y1, up));
        const ring = outline.map((q) => push(world(q, y1), up, meta(0, y1, up)));
        for (let i = 0; i < n; i += 1) tri(centre, ring[i], ring[(i + 1) % n], up);
    }
}

/** Points round a circle in the xy plane (the wheel's local frame) at depth z. */
export const ringPoints = (r, z, n) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
});

/** One merged BufferGeometry from an `out` record; `metaName` is the vec4 attribute's name. */
export function toGeometry(out, metaName) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
    geometry.setAttribute(metaName, new THREE.Float32BufferAttribute(out.meta, 4));
    geometry.setIndex(out.index);
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * The mean of normal·(vertex − centroid) over every vertex: positive when the normals point out
 * of a closed part (a test for winding, see the koi-pond gotcha in the TSL skill).
 */
export function outwardness(out) {
    const n = out.position.length / 3;
    let cx = 0; let cy = 0; let cz = 0;
    for (let i = 0; i < n; i += 1) {
        cx += out.position[i * 3]; cy += out.position[i * 3 + 1]; cz += out.position[i * 3 + 2];
    }
    cx /= n; cy /= n; cz /= n;
    let s = 0;
    for (let i = 0; i < n; i += 1) {
        s += out.normal[i * 3] * (out.position[i * 3] - cx)
            + out.normal[i * 3 + 1] * (out.position[i * 3 + 1] - cy)
            + out.normal[i * 3 + 2] * (out.position[i * 3 + 2] - cz);
    }
    return s / n;
}
