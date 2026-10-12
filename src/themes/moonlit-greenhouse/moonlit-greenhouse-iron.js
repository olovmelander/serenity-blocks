/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the iron of the house: the arched lattice ribs, the colonnade, the spring
 * beams, the ridge and its vent, the brick plinth walls and the far end's frame.
 *
 * The house is read almost entirely in silhouette: the glass behind the iron glows with the moon
 * and the mist, so what has to be right is the iron's outline and the thin lines of light on its
 * edges. Each main rib is a Victorian lattice girder that follows the pointed arch: an outer
 * chord standing just inside the glass, an inner chord 0.3 m below it, and between them a web
 * of cast rings. Near the spring the girder deepens into a haunch whose rings swell to twice
 * their size (each with a quatrefoil inside), and under the spring a quarter-round bracket ties
 * the haunch down onto its column. The chords are geometry (chamfered flanges, so their edges
 * catch the light); the web is ONE flat plate a rib whose rings are cut by a distance field in
 * the plate's own coordinates (cells as long as the web is deep, so every ring stays round as the
 * haunch swells), cut hard: a bar is never finer than a pixel and a cell only a few pixels
 * across goes solid, so the far ribs close into dark girders instead of breaking up.
 *
 * The columns are lathes: a square plinth, an Attic base, a slender fluted shaft (the flutes are
 * a turn of the normal, not geometry), an astragal, a bell capital with two rows of leaves and a
 * square abacus under the spring beam's ogee cornice. The ridge carries a box beam, the louvred
 * underside of its lantern vent, and a cast drop under every rib's apex.
 *
 * Everything is lit by mgSurface (the moon through the glazing and the palms, the sky, the
 * lanterns, the blooms, the fireflies) on near-black green paint, plus what painted iron does
 * at night: it mirrors the glowing glass at grazing angles (Fresnel), so every edge that turns
 * toward the vault draws a cold line, and the moon itself glints where an edge faces it.
 *
 * The chain grows bioluminescent moss up the colonnade (U.moss metres, a step a link): patchy,
 * with a bright front where it is growing that reads as a line being written up every column at
 * once, and past the spring it climbs the ribs' haunches. At rest only a few specks glow at the
 * columns' feet.
 *
 * Three draw calls: the solid iron, the lattice webs, the brick.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cross, dot, exp, faceDirection, float, floor, fract, fwidth, length, max,
    min, mix, normalWorldGeometry, normalize, positionWorld, reflect, select, sin, smoothstep, texture, vec2, vec3,
    vec4,
} from 'three/tsl';
import {
    ARC, HOUSE, clamp01, vaultHeightAt,
} from './moonlit-greenhouse-core.js';
import { mgHash21, mgMoonVis, mgSurface } from './moonlit-greenhouse-tsl.js';

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────

/**
 * The main ribs (metres):
 *   depth        the girder's depth under the glass (outer face to the inner chord's soffit)
 *   inset        the outer chord's face stands this far inside the glass
 *   flange       the outer chord's width along the house; innerFlange the inner chord's
 *   thick        both chords' thickness; chamfer their edges
 *   haunch       the girder's depth at the spring, easing back to `depth` over `haunchReach`
 *   foot         height at which the bracket under the spring lands on its column
 *   wall         the bracket's outer edge below the spring (|x|)
 *   plateTop     the web plate's outer edge below the glass; plateUnder how far its inner edge
 *                runs up inside the inner chord
 *   bar          the web's ring bars; edge the solid stems along both chords
 */
export const RIB = Object.freeze({
    depth: 0.3,
    inset: 0.006,
    flange: 0.13,
    innerFlange: 0.11,
    thick: 0.028,
    chamfer: 0.008,
    haunch: 0.62,
    haunchReach: 3.0,
    foot: 3.85,
    wall: 6.97,
    plateTop: 0.03,
    plateUnder: 0.018,
    bar: 0.024,
    edgeOuter: 0.016,
    edgeInner: 0.026,
});

/**
 * The cast-iron columns (metres): the plinth block, the moulded base, the fluted shaft (radius
 * at its foot and head), the astragal, the bell capital and its abacus, the impost under the
 * spring beam.
 */
export const COLUMN = Object.freeze({
    plinthFrom: 0.22,
    plinthTo: 0.62,
    plinthHalf: 0.17,
    shaftFrom: 0.805,
    shaftTo: 4.24,
    radiusFoot: 0.088,
    radiusHead: 0.074,
    capitalFrom: 4.312,
    capitalTo: 4.62,
    abacusTo: 4.69,
    abacusHalf: 0.18,
    impostTo: 4.82,
    impostHalf: 0.15,
    flutes: 16,
});

/** The ridge: the beam's half-width and soffit, the vent's louvred boards out to |x| = vent. */
export const RIDGE = Object.freeze({
    half: 0.1,
    soffit: 12.62,
    vent: 0.36,
});

/** Brick plinth walls: the inner face (|x|), its foot (under the soil) and the sill. */
export const PLINTH = Object.freeze({
    face: 6.95,
    from: 0.28,
    sill: 0.72,
});

/** What a vertex of the solid iron is: the shader's pattern for it. */
const KIND = Object.freeze({
    plain: 0, shaft: 1, louvre: 2, round: 3,
});

/** A climb that the moss never reaches (the ridge, the end frame). */
const NO_MOSS = 99;

// ── A small mesh builder (the floor and the lanterns use it too) ───────────────────────────

/**
 * Collects indexed triangles with positions, normals and named float attributes. Triangles are
 * wound by their vertices' normals (the face looks the way its normals do), so a builder only
 * has to get the normals right.
 */
export class HouseMesh {
    /** @param {Record<string, number>} attributes  name → item size */
    constructor(attributes = {}) {
        this.sizes = { ...attributes };
        this.keys = Object.keys(this.sizes);
        this.position = [];
        this.normal = [];
        this.data = Object.fromEntries(this.keys.map((k) => [k, []]));
        this.index = [];
    }

    get vertexCount() {
        return this.position.length / 3;
    }

    get triangleCount() {
        return this.index.length / 3;
    }

    /** Add a vertex; `values` maps attribute names to arrays (missing → zeros). */
    vertex(p, n, values = {}) {
        const at = this.vertexCount;
        this.position.push(p[0], p[1], p[2]);
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        this.normal.push(n[0] / l, n[1] / l, n[2] / l);
        for (let k = 0; k < this.keys.length; k += 1) {
            const key = this.keys[k];
            const v = values[key];
            const size = this.sizes[key];
            const out = this.data[key];
            for (let i = 0; i < size; i += 1) out.push(v && Number.isFinite(v[i]) ? v[i] : 0);
        }
        return at;
    }

    tri(a, b, c) {
        const P = this.position;
        const N = this.normal;
        const e1x = P[b * 3] - P[a * 3];
        const e1y = P[b * 3 + 1] - P[a * 3 + 1];
        const e1z = P[b * 3 + 2] - P[a * 3 + 2];
        const e2x = P[c * 3] - P[a * 3];
        const e2y = P[c * 3 + 1] - P[a * 3 + 1];
        const e2z = P[c * 3 + 2] - P[a * 3 + 2];
        const fx = e1y * e2z - e1z * e2y;
        const fy = e1z * e2x - e1x * e2z;
        const fz = e1x * e2y - e1y * e2x;
        if (fx * fx + fy * fy + fz * fz < 1e-16) return;
        const nx = N[a * 3] + N[b * 3] + N[c * 3];
        const ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
        const nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
        if (fx * nx + fy * ny + fz * nz < 0) this.index.push(a, c, b);
        else this.index.push(a, b, c);
    }

    quad(a, b, c, d) {
        this.tri(a, b, c);
        this.tri(a, c, d);
    }

    /** Two rows of vertex indices (same length) joined into a strip of quads. */
    strip(rowA, rowB) {
        for (let i = 0; i + 1 < rowA.length; i += 1) this.quad(rowA[i], rowA[i + 1], rowB[i + 1], rowB[i]);
    }

    geometry() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
        this.keys.forEach((key) => {
            g.setAttribute(key, new THREE.Float32BufferAttribute(this.data[key], this.sizes[key]));
        });
        g.setIndex(this.index);
        g.computeBoundingSphere();
        return g;
    }
}

/**
 * Sweep an open profile along a path. `path` is a list of frames { o, ea, eb, values }: the
 * profile's point (a, b) lands at o + ea·a + eb·b. The profile is walked with the solid on its
 * LEFT, so each edge's outward normal is (db, −da) in (a, b); every edge is its own flat strip
 * unless `smooth` (then neighbouring edges share their averaged normal: a rounded moulding).
 */
export function sweep(mesh, path, profile, { smooth = false } = {}) {
    const edges = [];
    for (let k = 0; k + 1 < profile.length; k += 1) {
        const da = profile[k + 1][0] - profile[k][0];
        const db = profile[k + 1][1] - profile[k][1];
        const l = Math.hypot(da, db) || 1;
        edges.push([db / l, -da / l]);
    }
    const normalAt = (k) => {
        const a = edges[Math.max(0, k - 1)];
        const b = edges[Math.min(edges.length - 1, k)];
        const x = a[0] + b[0];
        const y = a[1] + b[1];
        const l = Math.hypot(x, y) || 1;
        return [x / l, y / l];
    };
    const place = (f, a, b) => [
        f.o[0] + f.ea[0] * a + f.eb[0] * b, f.o[1] + f.ea[1] * a + f.eb[1] * b, f.o[2] + f.ea[2] * a + f.eb[2] * b,
    ];
    const dir = (f, n) => [
        f.ea[0] * n[0] + f.eb[0] * n[1], f.ea[1] * n[0] + f.eb[1] * n[1], f.ea[2] * n[0] + f.eb[2] * n[1],
    ];
    if (smooth) {
        const rows = profile.map((pt, k) => {
            const n = normalAt(k);
            return path.map((f) => mesh.vertex(place(f, pt[0], pt[1]), dir(f, n), f.values));
        });
        for (let k = 0; k + 1 < rows.length; k += 1) mesh.strip(rows[k], rows[k + 1]);
        return;
    }
    for (let k = 0; k + 1 < profile.length; k += 1) {
        const n = edges[k];
        const a = path.map((f) => mesh.vertex(place(f, profile[k][0], profile[k][1]), dir(f, n), f.values));
        const b = path.map((f) => mesh.vertex(place(f, profile[k + 1][0], profile[k + 1][1]), dir(f, n), f.values));
        mesh.strip(a, b);
    }
}

/**
 * A lathe about a vertical axis through (cx, cz): `profile` is a list of [r, y] (bottom to top;
 * an entry with a third element `true` is a crease, where the surface's normal breaks), turned
 * through `segments`. `modulate(phi, t)` (optional) adds to the radius round the turn (t is the
 * row's place 0..1 along the profile). `values(phi, y, row)` gives each vertex's attributes.
 * Normals are the surface's own: y_t·e_r − r_t·up − (y_t·r_φ / r)·e_φ.
 */
export function lathe(mesh, cx, cz, profile, segments, { modulate = null, values = () => ({}), start = 0 } = {}) {
    // Split at creases into smooth runs; each run is its own band of rows.
    const runs = [];
    let run = [];
    profile.forEach((pt, i) => {
        run.push(pt);
        if (pt[2] === true && i > 0 && i < profile.length - 1) {
            runs.push(run);
            run = [pt];
        }
    });
    if (run.length > 1) runs.push(run);
    const total = profile.length - 1;
    let rowBase = 0;
    runs.forEach((pts) => {
        const rows = [];
        for (let j = 0; j < pts.length; j += 1) {
            const prev = pts[Math.max(0, j - 1)];
            const next = pts[Math.min(pts.length - 1, j + 1)];
            const rt = next[0] - prev[0];
            const yt = next[1] - prev[1];
            const t = (rowBase + j) / Math.max(1, total);
            const row = [];
            for (let i = 0; i <= segments; i += 1) {
                const phi = start + (i / segments) * Math.PI * 2;
                const c = Math.cos(phi);
                const s = Math.sin(phi);
                const dr = modulate ? modulate(phi, t) : 0;
                const r = Math.max(0, pts[j][0] + dr);
                let rPhi = 0;
                if (modulate) {
                    const e = 1e-3;
                    rPhi = (modulate(phi + e, t) - modulate(phi - e, t)) / (2 * e);
                }
                // Radius change along the profile includes the modulation's change with t.
                let rtm = rt;
                if (modulate) {
                    const tp = (rowBase + Math.min(pts.length - 1, j + 1)) / Math.max(1, total);
                    const tm = (rowBase + Math.max(0, j - 1)) / Math.max(1, total);
                    rtm += modulate(phi, tp) - modulate(phi, tm);
                }
                const tangential = r > 1e-5 ? (yt * rPhi) / r : 0;
                let nx = yt * c - (-s) * tangential;
                let ny = -rtm;
                let nz = yt * s - c * tangential;
                if (Math.hypot(nx, ny, nz) < 1e-9) {
                    nx = 0;
                    ny = rt <= 0 ? 1 : -1;
                    nz = 0;
                }
                const p = [cx + r * c, pts[j][1], cz + r * s];
                row.push(mesh.vertex(p, [nx, ny, nz], values(phi, pts[j][1], rowBase + j, r)));
            }
            rows.push(row);
        }
        for (let j = 0; j + 1 < rows.length; j += 1) mesh.strip(rows[j], rows[j + 1]);
        rowBase += pts.length - 1;
    });
}

/** An axis-aligned box (only the faces named in `faces`: px nx py ny pz nz), flat normals. */
export function box(mesh, min3, max3, values = {}, faces = 'px nx py ny pz nz') {
    const [x0, y0, z0] = min3;
    const [x1, y1, z1] = max3;
    const face = (name, corners, n) => {
        if (!faces.includes(name)) return;
        const ids = corners.map((p) => mesh.vertex(p, n, values));
        mesh.quad(ids[0], ids[1], ids[2], ids[3]);
    };
    face('px', [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
    face('nx', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    face('py', [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0]);
    face('ny', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
    face('pz', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    face('nz', [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1]);
}

// ── The arch ────────────────────────────────────────────────────────────────────────────────

/** A point on side `side`'s arc (−1 left, +1 right) at arc length s from its spring, radius r. */
export function archPoint(side, s, r) {
    const th = s / ARC.radius;
    return [-side * ARC.offset + side * r * Math.cos(th), HOUSE.spring + r * Math.sin(th)];
}

/** The arc's outward normal (toward the glass) at arc length s. */
export function archOut(side, s) {
    const th = s / ARC.radius;
    return [side * Math.cos(th), Math.sin(th)];
}

/** The girder's depth at arc length s from the spring: the haunch easing into the rib. */
export function ribDepth(s) {
    const u = clamp01(s / RIB.haunchReach);
    return RIB.depth + (RIB.haunch - RIB.depth) * (1 - u) * (1 - u) * (1 + 2 * u);
}

/** The bracket's foot on its column's shaft (|x| of the shaft's face at the foot's height). */
function columnFace() {
    const plan = Math.abs(HOUSE.halfSpan - 0.22);
    const t = (RIB.foot - COLUMN.shaftFrom) / (COLUMN.shaftTo - COLUMN.shaftFrom);
    return plan - (COLUMN.radiusFoot + (COLUMN.radiusHead - COLUMN.radiusFoot) * t);
}

/**
 * One half of a rib, as samples from the bracket's foot up to the apex. Each carries the inner
 * chord's soffit point `inner` and its normal `n` (toward the nave), the web plate's outer edge
 * `outer`, the moss's climb (metres up the column, then along the rib) and `s` (arc length; the
 * bracket's samples carry negative heights below the spring).
 */
export function ribSamples(side, arcSegments, bracketSegments) {
    const out = [];
    const R = ARC.radius;
    const cf = columnFace();
    const ax = cf - (HOUSE.halfSpan - RIB.haunch);
    const ay = HOUSE.spring - RIB.foot;
    for (let i = 0; i < bracketSegments; i += 1) {
        const phi = (Math.PI / 2) * (1 - i / bracketSegments);
        const c = Math.cos(phi);
        const sn = Math.sin(phi);
        const inner = [side * (cf - ax * c), HOUSE.spring - ay * sn];
        let nx = (-side * c) / ax;
        let ny = -sn / ay;
        const l = Math.hypot(nx, ny);
        nx /= l;
        ny /= l;
        out.push({
            inner, n: [nx, ny], outer: [side * RIB.wall, inner[1]], climb: inner[1], s: inner[1] - HOUSE.spring,
        });
    }
    const innerAt = (s) => archPoint(side, s, R - ribDepth(s));
    for (let i = 0; i <= arcSegments; i += 1) {
        const s = ARC.length * (i / arcSegments) ** 1.2;
        const e = 1e-3;
        const a = innerAt(Math.max(0, s - e));
        const b = innerAt(s + e);
        let nx = b[1] - a[1];
        let ny = -(b[0] - a[0]);
        const o = archOut(side, s);
        if (nx * o[0] + ny * o[1] > 0) {
            nx = -nx;
            ny = -ny;
        }
        const l = Math.hypot(nx, ny);
        out.push({
            inner: innerAt(s),
            n: [nx / l, ny / l],
            outer: archPoint(side, s, R - RIB.plateTop),
            climb: HOUSE.spring + s,
            s,
        });
    }
    return out;
}

// The chords' cross-sections, walked with the solid on the left: (a, b) = (along the frame's
// first axis, along the house).
function outerChordProfile(chamfer) {
    const { thick: T, flange: W } = RIB;
    const ch = chamfer ? RIB.chamfer : 0;
    const pts = [[0, -W / 2], [T - ch, -W / 2]];
    if (ch) pts.push([T, -W / 2 + ch]);
    pts.push([T, W / 2 - ch]);
    if (ch) pts.push([T - ch, W / 2]);
    pts.push([0, W / 2]);
    return pts;
}

function innerChordProfile(chamfer) {
    const { thick: T, innerFlange: W } = RIB;
    const ch = chamfer ? RIB.chamfer : 0;
    const pts = [[-T, -W / 2], [-ch, -W / 2]];
    if (ch) pts.push([0, -W / 2 + ch]);
    pts.push([0, W / 2 - ch]);
    if (ch) pts.push([-ch, W / 2]);
    pts.push([-T, W / 2]);
    return pts;
}

/** Add one rib at z0: both chords (solid) and the web plate (lattice). */
function addRib(solid, lattice, z0, detail) {
    const R = ARC.radius;
    [-1, 1].forEach((side) => {
        const samples = ribSamples(side, detail.arc, detail.bracket);
        // The inner chord: along the bracket and the whole arch.
        const innerPath = samples.map((sm) => ({
            o: [sm.inner[0], sm.inner[1], z0],
            ea: [sm.n[0], sm.n[1], 0],
            eb: [0, 0, 1],
            values: { aIron: [KIND.plain, sm.s, sm.inner[0] * side, sm.climb] },
        }));
        sweep(solid, innerPath, innerChordProfile(detail.chamfer));
        // The outer chord: the arch only (below the spring the column takes over).
        const arch = samples.filter((sm) => sm.s >= 0);
        const outerPath = arch.map((sm) => {
            const o = archPoint(side, sm.s, R - RIB.inset);
            const n = archOut(side, sm.s);
            return {
                o: [o[0], o[1], z0],
                ea: [-n[0], -n[1], 0],
                eb: [0, 0, 1],
                values: { aIron: [KIND.plain, sm.s, o[0] * side, sm.climb] },
            };
        });
        sweep(solid, outerPath, outerChordProfile(detail.chamfer));
        // The web plate: rows at its outer edge and just inside the inner chord, its cells as
        // long as the web is deep (integrated along its middle line), a whole number of rings
        // a side so the two halves meet ring to ring at the apex.
        const rows = samples.map((sm) => {
            const inner = [sm.inner[0] - sm.n[0] * RIB.plateUnder, sm.inner[1] - sm.n[1] * RIB.plateUnder];
            const w = Math.hypot(sm.outer[0] - inner[0], sm.outer[1] - inner[1]);
            return {
                outer: sm.outer,
                inner,
                w,
                mid: [(sm.outer[0] + inner[0]) / 2, (sm.outer[1] + inner[1]) / 2],
                climb: sm.climb,
            };
        });
        let c = 0;
        const cells = [0];
        for (let i = 1; i < rows.length; i += 1) {
            const ds = Math.hypot(rows[i].mid[0] - rows[i - 1].mid[0], rows[i].mid[1] - rows[i - 1].mid[1]);
            const wi = Math.max(0.06, (rows[i].w + rows[i - 1].w) / 2 - RIB.edgeOuter - RIB.edgeInner);
            c += ds / wi;
            cells.push(c);
        }
        const scale = Math.max(1, Math.round(c)) / Math.max(c, 1e-6);
        const a = [];
        const b = [];
        rows.forEach((row, i) => {
            const cell = cells[i] * scale;
            a.push(lattice.vertex([row.outer[0], row.outer[1], z0], [0, 0, 1], { aLat: [cell, 0, row.w, row.climb] }));
            b.push(lattice.vertex([row.inner[0], row.inner[1], z0], [0, 0, 1], {
                aLat: [cell, row.w, row.w, row.climb],
            }));
        });
        lattice.strip(a, b);
    });
    // A cast drop under the apex.
    lathe(solid, 0, z0, [
        [0.0, RIDGE.soffit - 0.34, true], [0.012, RIDGE.soffit - 0.325], [0.028, RIDGE.soffit - 0.29],
        [0.03, RIDGE.soffit - 0.26], [0.016, RIDGE.soffit - 0.225], [0.014, RIDGE.soffit - 0.2],
        [0.04, RIDGE.soffit - 0.16], [0.048, RIDGE.soffit - 0.12], [0.036, RIDGE.soffit - 0.07],
        [0.024, RIDGE.soffit - 0.03], [0.05, RIDGE.soffit - 0.01], [0.05, RIDGE.soffit, true],
    ], detail.drop, { values: (phi, y) => ({ aIron: [KIND.plain, phi * 0.04, y, NO_MOSS] }) });
}

/** The capital's leaves: a row of eight broad leaves and a lower row of eight between them. */
function capitalLeaves(phi, t) {
    const lobe = (a) => {
        const c = 0.5 + 0.5 * Math.cos(a);
        return c * Math.sqrt(c);
    };
    const upper = 0.034 * Math.sin(Math.PI * Math.min(1, t / 0.9)) ** 0.7 + 0.022 * Math.max(0, (t - 0.72) / 0.28) ** 2;
    const lower = 0.022 * Math.max(0, Math.sin(Math.PI * Math.min(1, t / 0.55)));
    return upper * lobe(8 * phi) + lower * lobe(8 * phi + Math.PI);
}

/** Add one column at (x, z): plinth, base, fluted shaft, astragal, capital, abacus, impost. */
function addColumn(solid, x, z, detail) {
    const C = COLUMN;
    const climbAt = (y) => y;
    const plain = (y) => ({ aIron: [KIND.plain, (x + z) * 0.37, y, climbAt(y)] });
    // The plinth block (its foot is under the soil).
    const h = C.plinthHalf;
    box(solid, [x - h, C.plinthFrom, z - h], [x + h, C.plinthTo, z + h], plain(0.4), 'px nx py pz nz');
    // The Attic base, the shaft, the astragal: one lathe.
    const shaftProfile = [
        [0.15, C.plinthTo], [0.156, 0.64], [0.158, 0.66], [0.152, 0.68], [0.14, 0.696],
        [0.122, 0.706], [0.112, 0.72], [0.114, 0.734], [0.124, 0.744], [0.129, 0.756], [0.124, 0.769], [0.11, 0.779],
        [0.097, 0.786, true], [0.097, 0.8, true], [C.radiusFoot, C.shaftFrom, true],
        [(C.radiusFoot + C.radiusHead) / 2, (C.shaftFrom + C.shaftTo) / 2], [C.radiusHead, C.shaftTo, true],
        [0.08, C.shaftTo + 0.006], [0.092, C.shaftTo + 0.022], [0.097, C.shaftTo + 0.04], [0.092, C.shaftTo + 0.058],
        [0.078, C.capitalFrom, true],
    ];
    lathe(solid, x, z, shaftProfile, detail.shaft, {
        values: (phi, y) => {
            const shaft = y > C.shaftFrom - 1e-4 && y < C.shaftTo + 1e-4;
            return { aIron: [shaft ? KIND.shaft : KIND.round, phi, y, climbAt(y)] };
        },
    });
    // The bell capital with its leaves.
    const rows = detail.capitalRows;
    const bell = [];
    for (let j = 0; j <= rows; j += 1) {
        const t = j / rows;
        bell.push([0.078 + 0.07 * t ** 1.6, C.capitalFrom + (C.capitalTo - C.capitalFrom) * t]);
    }
    bell[rows].push(true);
    bell.push([0, C.capitalTo, true]);
    lathe(solid, x, z, bell, detail.capital, {
        modulate: (phi, t) => {
            if (t > rows / (rows + 1) + 1e-6) return 0;
            return capitalLeaves(phi, Math.min(1, t * ((rows + 1) / rows)));
        },
        values: (phi, y) => ({ aIron: [KIND.round, phi, y, climbAt(y)] }),
    });
    // The abacus and the impost.
    const ah = C.abacusHalf;
    box(solid, [x - ah, C.capitalTo, z - ah], [x + ah, C.abacusTo, z + ah], plain(C.abacusTo), 'px nx ny pz nz');
    const ih = C.impostHalf;
    box(solid, [x - ih, C.abacusTo, z - ih], [x + ih, C.impostTo, z + ih], plain(C.impostTo), 'px nx ny pz nz');
}

/** The spring beams: an ogee-corniced box girder along each side at the spring. */
function addSpringBeams(solid) {
    const profile = [
        [0.0, 4.82], [0.24, 4.82], [0.27, 4.85], [0.27, 4.975], [0.284, 4.99], [0.305, 5.005], [0.305, 5.045],
        [0.24, 5.08], [0.0, 5.11],
    ];
    [-1, 1].forEach((side) => {
        const path = [HOUSE.near, HOUSE.far].map((z) => ({
            o: [side * HOUSE.halfSpan, 0, z],
            ea: [-side, 0, 0],
            eb: [0, 1, 0],
            values: { aIron: [KIND.plain, z, 0, 4.95] },
        }));
        sweep(solid, path, profile);
    });
}

/** The ridge: the box beam, a bead under it, and the louvred boards of the vent either side. */
function addRidge(solid) {
    const { half, soffit, vent } = RIDGE;
    const top = vaultHeightAt(half) - 0.005;
    const beam = [
        [-half, top], [-half, soffit + 0.04], [-half + 0.02, soffit],
        [half - 0.02, soffit], [half, soffit + 0.04], [half, top],
    ];
    const path = [HOUSE.near, HOUSE.far].map((z) => ({
        o: [0, 0, z], ea: [1, 0, 0], eb: [0, 1, 0], values: { aIron: [KIND.plain, z, 0, NO_MOSS] },
    }));
    sweep(solid, path, beam);
    // The louvres: a board each side from the beam up to the glass, facing down into the nave.
    [-1, 1].forEach((side) => {
        const outer = [side * vent, vaultHeightAt(vent) - 0.01];
        const inner = [side * half, soffit + 0.1];
        const board = side < 0 ? [outer, inner] : [inner, outer];
        const louvre = [HOUSE.near, HOUSE.far].map((z) => ({
            o: [0, 0, z], ea: [1, 0, 0], eb: [0, 1, 0], values: { aIron: [KIND.louvre, z, 0, NO_MOSS] },
        }));
        sweep(solid, louvre, board);
    });
}

/** The far end's frame: a heavier solid arch against the end screen and a door case. */
function addEndFrame(solid, detail) {
    const z0 = HOUSE.far + 0.06;
    const R = ARC.radius;
    const W = 0.12;
    [-1, 1].forEach((side) => {
        const path = [];
        for (let i = 0; i <= detail.arc; i += 1) {
            const s = (ARC.length * i) / detail.arc;
            const o = archPoint(side, s, R - RIB.inset);
            const n = archOut(side, s);
            path.push({
                o: [o[0], o[1], z0],
                ea: [-n[0], -n[1], 0],
                eb: [0, 0, 1],
                values: { aIron: [KIND.plain, s, 0, NO_MOSS] },
            });
        }
        sweep(solid, path, [[0, -W / 2], [0.42, -W / 2], [0.42, W / 2], [0, W / 2]]);
        // A post down the wall under the arch's spring, and the door's jamb.
        box(
            solid,
            [side * HOUSE.halfSpan - 0.12 * (side > 0 ? 1 : 0), 0, z0 - W / 2],
            [side * HOUSE.halfSpan + 0.12 * (side < 0 ? 1 : 0), HOUSE.spring, z0 + W / 2],
            { aIron: [KIND.plain, 0, 0, NO_MOSS] },
            side < 0 ? 'px pz' : 'nx pz',
        );
        box(
            solid,
            [side * 1.25 - 0.07, 0, z0 - W / 2],
            [side * 1.25 + 0.07, 3.1, z0 + W / 2],
            { aIron: [KIND.plain, 0, 0, NO_MOSS] },
            'px nx pz',
        );
    });
    box(solid, [-1.32, 3.1, z0 - W / 2], [1.32, 3.26, z0 + W / 2], { aIron: [KIND.plain, 0, 0, NO_MOSS] }, 'ny py pz');
}

/** The brick plinth walls along both sides, with their stone sill. */
function addPlinth(brick) {
    [-1, 1].forEach((side) => {
        const path = [HOUSE.near, HOUSE.far].map((z) => ({
            o: [side * HOUSE.halfSpan, 0, z], ea: [-side, 0, 0], eb: [0, 1, 0], values: { aBrick: [0, z, 0, 0] },
        }));
        const face = HOUSE.halfSpan - PLINTH.face;
        sweep(brick, path, [[face, PLINTH.from], [face, PLINTH.sill]]);
        const sill = path.map((f) => ({ ...f, values: { aBrick: [1, f.o[2], 0, 0] } }));
        sweep(brick, sill, [
            [face, PLINTH.sill], [face + 0.07, PLINTH.sill], [face + 0.09, PLINTH.sill + 0.02],
            [face + 0.09, PLINTH.sill + 0.055],
            [face + 0.065, PLINTH.sill + 0.075], [0, HOUSE.plinth + 0.04],
        ]);
    });
}

/** How finely a tier draws the iron. */
export function ironDetail(tier) {
    const f = tier?.frond ?? 12;
    return {
        arc: Math.max(22, Math.min(52, Math.round(f * 2.6))),
        bracket: f >= 12 ? 10 : 6,
        shaft: f >= 12 ? 16 : 12,
        capital: f >= 12 ? 32 : 16,
        capitalRows: f >= 12 ? 9 : 6,
        drop: f >= 12 ? 12 : 8,
        chamfer: f >= 10,
    };
}

/**
 * The iron's geometry for a plan and a tier: { solid, lattice, brick } as HouseMesh builders
 * (call .geometry() for three's) and the detail used.
 */
export function buildIronMeshes(plan, tier) {
    const detail = ironDetail(tier);
    const solid = new HouseMesh({ aIron: 4 });
    const lattice = new HouseMesh({ aLat: 4 });
    const brick = new HouseMesh({ aBrick: 4 });
    plan.ribs.forEach((z) => addRib(solid, lattice, z, detail));
    plan.columns.forEach((c) => addColumn(solid, c.x, c.z, detail));
    addSpringBeams(solid);
    addRidge(solid);
    addEndFrame(solid, detail);
    addPlinth(brick);
    return {
        solid, lattice, brick, detail,
    };
}

// ── Shading ─────────────────────────────────────────────────────────────────────────────────

/** Near-black painted iron with the faintest green in it. */
const PAINT = [0.03, 0.037, 0.033];

/** A pixel's footprint in metres at p (the lattice's shadow edges and the patterns' AA). */
export function footprint(p) {
    return max(max(fwidth(p.x), fwidth(p.y)), fwidth(p.z));
}

/**
 * The glow of the glass seen along `r` (unit): the condensation's halo round the moon and the
 * night's air, as bright as the glass shader paints them. What polished or wet surfaces mirror.
 */
export function glassGlow(r, U) {
    const { night } = U;
    const toMoon = clamp(dot(r, U.moon), 0.0, 1.0);
    const away = float(1.0).sub(toMoon);
    const halo = exp(away.mul(-1.0 / 0.06)).mul(0.55).add(exp(away.mul(-1.0 / 0.3)).mul(0.16)).add(0.025);
    const up = smoothstep(-0.25, 0.35, r.y);
    const air = mix(night.horizon, night.zenith, clamp(r.y, 0.0, 1.0)).mul(0.9);
    return night.glassFog.mul(halo).add(air).mul(U.moonLight).mul(up);
}

/**
 * Painted iron at p (normal n): the house's light (mgSurface), the glass mirrored at grazing
 * angles (Fresnel), and the moon's own glint through the glazing.
 */
function ironLight(p, n, albedo, foot, U, { ao = float(1.0), gloss = float(1.0) } = {}) {
    const { night } = U;
    const vis = mgMoonVis(p, U, foot).toVar();
    const base = mgSurface(p, n, albedo, U, { soft: foot, ao, vis });
    const v = normalize(p.sub(cameraPosition));
    const r = reflect(v, n);
    const cosV = clamp(dot(n, v).negate(), 0.0, 1.0);
    const f1 = float(1.0).sub(cosV);
    const f2 = f1.mul(f1);
    const fres = f2.mul(f2).mul(f1).mul(0.24).add(0.04);
    const toMoon = clamp(dot(r, U.moon), 0.0, 1.0);
    const t2 = toMoon.mul(toMoon);
    const t4 = t2.mul(t2);
    const t8 = t4.mul(t4);
    const t16 = t8.mul(t8);
    const lobe = t16.mul(t16).mul(t16).mul(t16);
    const glint = night.moonlight.mul(U.moonLight).mul(vis).mul(lobe).mul(fres.mul(2.2).add(0.15));
    return base.add(glassGlow(r, U).mul(fres).mul(gloss)).add(glint.mul(gloss));
}

/**
 * The moss on the colonnade at a surface point: `uv` metres over the surface, `climb` metres up
 * the column (then along the rib). Returns { glow, cover } (scene-linear light, 0..1 cover).
 */
function mossAt(uv, climb, U, noise) {
    // Clumps a hand across, the grain of the cushions, and the spores' round dots.
    const n1 = texture(noise, uv.mul(2.2));
    const n2 = texture(noise, uv.mul(6.0).add(vec2(0.37, 0.71)));
    const beads = texture(noise, uv.mul(9.5).add(vec2(0.13, 0.29))).y;
    const ragged = n1.x.sub(0.5).mul(0.36).add(n2.w.sub(0.5).mul(0.12));
    const below = U.moss.add(ragged).sub(climb).toVar();
    const growing = smoothstep(0.04, 0.3, U.moss);
    // Patchy cushions, thicker the further below the front they are.
    const clump = n1.z.mul(0.6).add(n2.x.mul(0.4));
    const patch = smoothstep(0.47, 0.57, clump.add(clamp(below, 0.0, 1.5).mul(0.09)));
    const cover = smoothstep(-0.01, 0.04, below).mul(patch).mul(growing);
    // The front: a thin bright ragged line being written up the iron, pulsing as it climbs,
    // with a breath of light on the bare iron just ahead of it.
    const line = exp(below.mul(below).mul(-1.0 / 0.0007)).mul(smoothstep(0.4, 0.52, clump.add(0.1)));
    const pulse = sin(U.time.mul(2.6).sub(climb.mul(3.2)).add(uv.x.mul(9.0))).mul(0.3).add(0.85);
    const ahead = exp(max(below.negate(), 0.0).mul(-1.0 / 0.1)).mul(smoothstep(0.02, -0.01, below));
    // Spores: glowing dots in the cushions, and a few drifting just ahead of the front.
    const dots = smoothstep(0.62, 0.86, beads);
    const spores = dots.mul(cover.add(ahead.mul(0.5)));
    // At rest: a few specks at the columns' feet.
    const feet = dots.mul(float(1.0).sub(smoothstep(0.5, 0.95, climb))).mul(smoothstep(0.5, 0.62, clump));
    const level = U.mossGlow.add(0.6).mul(float(1.0).sub(U.hush.mul(0.7)));
    const glow = U.night.glow.mul(level).mul(
        cover.mul(0.032).add(spores.mul(0.6)).add(line.mul(pulse).mul(3.2)).add(ahead.mul(0.07))
            .mul(growing)
            .add(feet.mul(0.28)),
    );
    return { glow, cover };
}

/**
 * The iron part. ctx = { tier, U, noise, plan }.
 */
export function createIron({
    tier, U, noise, plan,
}) {
    const built = buildIronMeshes(plan, tier);
    const group = new THREE.Group();
    group.name = 'moonlit-greenhouse-iron';
    const geometries = [];
    const materials = [];
    const paint = vec3(PAINT[0], PAINT[1], PAINT[2]);

    // ── The solid iron.
    {
        const geometry = built.solid.geometry();
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'moonlit-greenhouse-iron';
        const A = attribute('aIron', 'vec4');
        material.colorNode = Fn(() => {
            const p = positionWorld;
            const foot = footprint(p);
            const kind = A.x;
            const n0 = normalWorldGeometry.toVar();
            // The flutes: the shaft's normal turned round it (a concave flute between arrises).
            const around = normalize(cross(vec3(0.0, 1.0, 0.0), n0).add(vec3(1e-5, 0.0, 0.0)));
            const fluted = n0.sub(around.mul(sin(A.y.mul(COLUMN.flutes)).mul(0.38)));
            const isShaft = kind.greaterThan(0.5).and(kind.lessThan(1.5));
            const n = normalize(select(isShaft, fluted, n0)).toVar();
            // The louvres of the ridge vent: slats with the night between them.
            const isLouvre = kind.greaterThan(1.5).and(kind.lessThan(2.5));
            const slat = fract(A.y.div(0.07));
            const gap = smoothstep(0.62, 0.7, slat).mul(float(1.0).sub(smoothstep(0.92, 0.99, slat)))
                .mul(float(1.0).sub(smoothstep(0.02, 0.07, foot)));
            // Moss over the surface in world metres: a lathe's own angle would tear the cushions
            // and the climbing front along its seam, on the side of the column the eye sees.
            const moss = mossAt(vec2(p.x.add(p.z.mul(0.61)), p.y), A.w, U, noise);
            const albedo = mix(paint, vec3(0.02, 0.05, 0.03), moss.cover.mul(0.8));
            const lit = ironLight(p, n, albedo, foot, U, { gloss: float(1.0).sub(moss.cover.mul(0.8)) });
            const night = U.night.zenith.mul(1.6).add(U.night.moonlight.mul(U.moonLight).mul(0.006));
            const louvre = select(isLouvre, night.mul(gap), vec3(0.0));
            return vec4(lit.add(moss.glow).add(louvre), 1.0);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'moonlit-greenhouse-iron-solid';
        mesh.frustumCulled = false;
        mesh.renderOrder = 8;
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    }

    // ── The lattice webs.
    {
        const geometry = built.lattice.geometry();
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'moonlit-greenhouse-iron-lattice';
        const L = attribute('aLat', 'vec4');
        const coverage = Fn(() => {
            const c = L.x;
            const vm = L.y;
            const w = L.z;
            const wi = max(w.sub(RIB.edgeOuter + RIB.edgeInner), 0.06);
            const q = vec2(fract(c).sub(0.5).mul(wi), vm.sub(RIB.edgeOuter).sub(wi.mul(0.5)));
            const len = length(q);
            const fw = max(fwidth(c).mul(wi), fwidth(vm)).add(1e-4);
            // A bar is never drawn finer than a pixel (it would break up), and a cell only a few
            // pixels across goes solid. (No alpha-to-coverage, even with MSAA: drivers dither
            // partial coverage into a stipple, which greyed the far ribs into a screen door.)
            const bar = max(float(RIB.bar), fw.mul(1.15));
            const rho = wi.mul(0.5).sub(bar.mul(0.5));
            const ring = abs(len.sub(rho)).sub(bar.mul(0.5));
            const stems = min(vm.sub(RIB.edgeOuter), w.sub(RIB.edgeInner).sub(vm));
            // In the haunch's big rings, a quatrefoil and a boss.
            const cos2 = q.x.mul(q.x).sub(q.y.mul(q.y)).div(max(len.mul(len), 1e-6));
            const cos4 = cos2.mul(cos2).mul(2.0).sub(1.0);
            const foilR = rho.mul(cos4.mul(0.13).add(0.6));
            const foil = abs(len.sub(foilR)).sub(bar.mul(0.42));
            const boss = len.sub(bar.mul(0.85));
            const big = smoothstep(0.27, 0.33, wi);
            const ornament = mix(float(1.0), min(foil, boss), big);
            const sdf = min(min(ring, stems), ornament);
            const sharp = clamp(sdf.negate().div(fw).add(0.5), 0.0, 1.0);
            return max(sharp, smoothstep(wi.mul(0.16), wi.mul(0.3), fw));
        });
        const alpha = coverage().toVar('mgLatticeAlpha');
        material.colorNode = Fn(() => {
            const p = positionWorld;
            const foot = footprint(p);
            const n = normalWorldGeometry.mul(faceDirection);
            const moss = mossAt(vec2(p.x.add(p.z.mul(0.61)), p.y), L.w, U, noise);
            const albedo = mix(paint, vec3(0.02, 0.05, 0.03), moss.cover.mul(0.8));
            const lit = ironLight(p, n, albedo, foot, U, { gloss: float(0.7) });
            return vec4(lit.add(moss.glow), 1.0);
        })();
        material.maskNode = alpha.greaterThan(0.5);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'moonlit-greenhouse-iron-lattice';
        mesh.frustumCulled = false;
        mesh.renderOrder = 8;
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    }

    // ── The brick plinth walls and their sill.
    {
        const geometry = built.brick.geometry();
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'moonlit-greenhouse-iron-brick';
        const B = attribute('aBrick', 'vec4');
        material.colorNode = Fn(() => {
            const p = positionWorld;
            const foot = footprint(p);
            const n0 = normalWorldGeometry;
            const isSill = B.x.greaterThan(0.5);
            const u = p.z;
            const v = p.y;
            // English garden-wall bond: courses 75 mm, bricks 225 mm, each course half a brick on.
            const course = floor(v.div(0.075));
            const bu = u.div(0.225).add(course.mul(0.5));
            const cell = floor(bu);
            const fu = fract(bu);
            const fv = fract(v.div(0.075));
            const du = min(fu, float(1.0).sub(fu)).mul(0.225);
            const dv = min(fv, float(1.0).sub(fv)).mul(0.075);
            const mortar = float(1.0).sub(smoothstep(float(0.0055).sub(foot), float(0.0055).add(foot), min(du, dv)));
            const h = mgHash21(vec2(cell, course.add(p.x.mul(3.0))));
            const fired = mix(vec3(0.11, 0.042, 0.028), vec3(0.17, 0.07, 0.042), h);
            const burnt = mix(fired, vec3(0.06, 0.035, 0.03), smoothstep(0.82, 0.9, h));
            const grain = texture(noise, vec2(u, v).mul(1.7));
            const damp = smoothstep(0.62, 0.42, v.add(grain.x.sub(0.5).mul(0.2)));
            const brickCol = mix(burnt.mul(grain.w.mul(0.4).add(0.8)), vec3(0.075, 0.07, 0.06), mortar);
            const mossy = mix(brickCol, vec3(0.025, 0.042, 0.022), damp.mul(smoothstep(0.4, 0.62, grain.z)).mul(0.85));
            const stone = vec3(0.15, 0.145, 0.13).mul(grain.w.mul(0.3).add(0.75));
            const albedo = select(isSill, stone, mossy.mul(float(1.0).sub(damp.mul(0.35))));
            const lit = mgSurface(p, n0, albedo, U, { soft: foot, ao: float(1.0).sub(mortar.mul(0.4)) });
            return vec4(lit, 1.0);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'moonlit-greenhouse-iron-brick';
        mesh.frustumCulled = false;
        mesh.renderOrder = 8;
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    }

    return {
        mesh: group,
        triangles: built.solid.triangleCount + built.lattice.triangleCount + built.brick.triangleCount,
        dispose() {
            group.removeFromParent();
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
            geometries.length = 0;
            materials.length = 0;
        },
    };
}
