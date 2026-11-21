/**
 * Ice Temple — the CPU bakes (three-free).
 *
 * The noise texture's mip chain and the architecture's vertices are pure functions of their seeds
 * and the plan. They are kept for the session (ice-temple-bakes.js); a first visit bakes them in a
 * module Worker (ice-temple-bake.worker.js) while the renderer comes up, ~45 + 30-50 ms that ran as
 * one long task in the world's build before (docs/THEME_FLEET_240_2026-10.md). The texture and the
 * mesh are made over them in ice-temple-tsl.js and ice-temple-architecture.js.
 */
import {
    NAVE, REST_RIG, TAU, mulberry32,
} from './ice-temple-core.js';
import { buildPlan } from './ice-temple-plan.js';
import { toHalfFloat } from '../shared/half-float.js';

export const NOISE_SIZE = 256;
export const NOISE_SEED = 7411;

// ── The noise texture ───────────────────────────────────────────────────────────

/**
 * A tileable RGBA fBm texture: four decorrelated channels of periodic gradient noise (five
 * octaves), stretched to [0, 1], half floats, with a CPU-built mip chain (the floor reads it at
 * grazing angles; generating half-float mips on the GPU is not portable to every WebGL2 device).
 * Baked once (≈ 45 ms); every veil in the ice, drift of snow and curtain ray is a fetch of it.
 */
export function bakeNoiseMips(seed = NOISE_SEED, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o++) {
            const period = 4 << o;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i++) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y++) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) base[i * 4 + c] = (field[i] - lo) * inv;
    }
    // Mip chain: 2×2 box filter down to 1×1.
    const mipmaps = [];
    let level = base;
    let w = n;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b2 = a + 4;
                const c2 = a + w * 4;
                const d2 = c2 + 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[b2 + c] + level[c2 + c] + level[d2 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    return mipmaps;
}

// ── The architecture ────────────────────────────────────────────────────────────

export const KIND = Object.freeze({
    structure: 0, shard: 1, heart: 2, icicle: 3,
});

/** Angles of the temple's module: a hexagon with bevelled corners (twelve faces). */
const BEVEL = (21 * Math.PI) / 180;
const HEX_PROFILE = (() => {
    const out = [];
    for (let i = 0; i < 6; i++) {
        out.push((i * TAU) / 6 - BEVEL, (i * TAU) / 6 + BEVEL);
    }
    return out;
})();
const polygon = (n) => Array.from({ length: n }, (_, i) => (i * TAU) / n);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotV = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Collects flat-shaded triangles with the per-vertex data the ice material reads:
 * `aSmooth` (radial normal), `aInfo` (chord radius, seed, kind, tracery) and `aSt` (metres round the
 * piece and along it; the seam of `s` faces away from the camera).
 */
class IceBuilder {
    constructor() {
        this.position = [];
        this.normal = [];
        this.smooth = [];
        this.info = [];
        this.st = [];
        this.triangles = 0;
    }

    tri(a, b, c, piece) {
        let n = crossV(sub(b.p, a.p), sub(c.p, a.p));
        const area = Math.hypot(n[0], n[1], n[2]);
        if (area < 1e-9) return;
        n = [n[0] / area, n[1] / area, n[2] / area];
        const out = [a.n[0] + b.n[0] + c.n[0], a.n[1] + b.n[1] + c.n[1], a.n[2] + b.n[2] + c.n[2]];
        let order = [a, b, c];
        if (dotV(n, out) < 0) {
            order = [a, c, b];
            n = [-n[0], -n[1], -n[2]];
        }
        for (let i = 0; i < 3; i++) {
            const v = order[i];
            this.position.push(v.p[0], v.p[1], v.p[2]);
            this.normal.push(n[0], n[1], n[2]);
            this.smooth.push(v.n[0], v.n[1], v.n[2]);
            this.info.push(piece.radius, piece.seed, piece.kind, piece.tracery ?? 0);
            this.st.push(v.s, v.t);
        }
        this.triangles += 1;
    }

    quad(a, b, c, d, piece) {
        this.tri(a, b, c, piece);
        this.tri(a, c, d, piece);
    }

    /**
     * A ring of vertices round `centre` in the plane of e1/e2.
     * @param {number[]} centre
     * @param {number[]} e1
     * @param {number[]} e2
     * @param {number} radius
     * @param {number[]} profile   angles
     * @param {number} twist       added to every angle
     * @param {number} t           metres along the piece
     * @param {number} seamAngle   the angle (in the ring's own frame) that faces the camera
     * @param {number} [slope=0]   tilt of the smooth normal along the axis (for tapers)
     * @param {number[]} [axis]
     */
    ring(centre, e1, e2, radius, profile, twist, t, seamAngle, slope = 0, axis = null) {
        const verts = [];
        for (let i = 0; i < profile.length; i++) {
            const a = profile[i] + twist;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const radial = [e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa];
            let s = a - seamAngle;
            s -= TAU * Math.round(s / TAU);
            const n = axis
                ? norm([radial[0] + axis[0] * slope, radial[1] + axis[1] * slope, radial[2] + axis[2] * slope])
                : radial;
            verts.push({
                p: [centre[0] + radial[0] * radius, centre[1] + radial[1] * radius, centre[2] + radial[2] * radius],
                n,
                s: s * Math.max(radius, 0.15),
                t,
            });
        }
        return verts;
    }

    /** Join consecutive rings with quads. */
    sweep(rings, piece) {
        for (let j = 0; j + 1 < rings.length; j++) {
            const lo = rings[j];
            const hi = rings[j + 1];
            for (let i = 0; i < lo.length; i++) {
                const k = (i + 1) % lo.length;
                this.quad(lo[i], lo[k], hi[k], hi[i], piece);
            }
        }
    }

    /** Close a ring to a point. */
    cone(ring, apex, piece) {
        for (let i = 0; i < ring.length; i++) {
            const k = (i + 1) % ring.length;
            this.tri(ring[i], ring[k], apex, piece);
        }
    }

    /** The collected vertices as typed arrays (what the geometry's attributes wrap). */
    data() {
        return {
            position: new Float32Array(this.position),
            normal: new Float32Array(this.normal),
            smooth: new Float32Array(this.smooth),
            info: new Float32Array(this.info),
            st: new Float32Array(this.st),
            triangles: this.triangles,
        };
    }
}

const UP = [0, 1, 0];
const X = [1, 0, 0];
const Z = [0, 0, 1];

/** The angle, in the x/z frame, of the direction from (x, z) to the rest camera. */
const seamToward = (x, z) => Math.atan2(REST_RIG.z - z, REST_RIG.x - x);

/** A vertical column: plinth, shaft with a little entasis, capital. Broken ones end in a snag. */
function addColumn(builder, column, rand) {
    const {
        x, z, radius: r, height: h, twist, broken,
    } = column;
    const piece = { radius: r, seed: column.seed, kind: KIND.structure };
    const seam = seamToward(x, z);
    const at = (y, radius, spin = 0, slope = 0) => builder.ring([x, y, z], X, Z, radius, HEX_PROFILE, twist + spin, y, seam, slope, UP);
    const rings = [
        at(-0.4, r * 1.52),
        at(0.55, r * 1.52),
        at(0.95, r * 1.2, 0, 0.6),
        at(1.5, r * 1.06, 0, 0.2),
    ];
    if (broken) {
        rings.push(at(h * 0.6, r * 0.99));
        builder.sweep(rings, piece);
        // The snag: the break is a slope with splinters standing on it.
        const top = rings[rings.length - 1];
        const lean = rand() * TAU;
        const snag = top.map((v) => {
            const rise = (Math.cos(Math.atan2(v.p[2] - z, v.p[0] - x) - lean) * 0.5 + 0.5) * h * 0.4;
            return {
                p: [x + (v.p[0] - x) * 0.82, h * 0.6 + rise, z + (v.p[2] - z) * 0.82], n: v.n, s: v.s, t: h * 0.6 + rise,
            };
        });
        builder.sweep([top, snag], piece);
        builder.cone(snag, {
            p: [x + Math.cos(lean) * r * 0.3, h * 0.82, z + Math.sin(lean) * r * 0.3], n: UP, s: 0, t: h,
        }, piece);
        return;
    }
    const cap = column.kind === 'aisle' ? 1.0 : 1.8;
    rings.push(
        at(h * 0.45, r * 1.0),
        at(h - cap - 0.5, r * 0.94),
        at(h - cap, r * 0.98, 0, -0.3),
        at(h - cap * 0.55, r * 1.32, 0.12, -0.7),
        at(h - cap * 0.2, r * 1.5, 0.12, -0.2),
        at(h + 0.15, r * 1.5, 0.12),
        at(h + 0.6, r * 1.08, 0.12, 0.8),
    );
    builder.sweep(rings, piece);
    builder.cone(rings[rings.length - 1], {
        p: [x, h + 1.0, z], n: UP, s: 0, t: h + 1,
    }, piece);
}

/** A crystal: a bevelled hexagonal prism along `dir`, cut to a point. */
function addCrystal(builder, crystal, rand) {
    const {
        base, dir, length: len, radius: r,
    } = crystal;
    const axis = norm(dir);
    const ref = Math.abs(axis[1]) > 0.9 ? X : UP;
    const e1 = norm(crossV(ref, axis));
    const e2 = crossV(axis, e1);
    const piece = { radius: r, seed: crystal.seed, kind: crystal.kind === 'heart' ? KIND.heart : KIND.shard };
    const twist = rand() * TAU;
    // The seam faces away from the camera, measured in the crystal's own frame.
    const toCam = norm([REST_RIG.x - base[0], REST_RIG.height - base[1], REST_RIG.z - base[2]]);
    const seam = Math.atan2(dotV(toCam, e2), dotV(toCam, e1)) - twist;
    // A cleaved blade keeps six strong faces. Only the thicker prisms need bevels.
    const blade = crystal.kind === 'shard' && r < 0.7 && crystal.seed < 0.6;
    const profile = blade ? polygon(6) : HEX_PROFILE;
    const at = (d, radius, slope = 0) => builder.ring(
        [base[0] + axis[0] * d, base[1] + axis[1] * d, base[2] + axis[2] * d],
        e1,
        e2,
        radius,
        profile,
        twist,
        d,
        seam + twist,
        slope,
        axis,
    );
    const shoulder = len * (0.74 + rand() * 0.12);
    // Some shards cleave to a single blade. A widened middle and a slanting shoulder
    // distinguish these from the heavy, regular prisms around the altar.
    // On a straight shard, base to shoulder is one unbroken crystal face.
    const rings = [at(0, r * (blade ? 0.7 : 1.04))];
    if (blade || crystal.kind === 'heart') rings.push(at(len * 0.4, r));
    rings.push(at(shoulder, r * 0.93));
    if (blade) {
        for (const [j, ring] of rings.entries()) {
            for (const v of ring) {
                const offset = sub(v.p, base);
                const width = dotV(offset, e1);
                const narrow = dotV(offset, e2);
                const nx = dotV(v.n, e1) / 1.36;
                const ny = dotV(v.n, e2) / 0.54;
                v.n = norm(e1.map((c, k) => c * nx + e2[k] * ny));
                for (let k = 0; k < 3; k++) {
                    v.p[k] += width * e1[k] * 0.36 - narrow * e2[k] * 0.46;
                    if (j === 2) v.p[k] += axis[k] * width * 0.65;
                }
            }
        }
    }
    builder.sweep(rings, piece);
    // The termination: six faces to an off-centre point, as a real crystal's is.
    const off = r * 0.22;
    const a = rand() * TAU;
    builder.cone(rings[rings.length - 1], {
        p: [
            base[0] + axis[0] * len + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * off,
            base[1] + axis[1] * len + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * off,
            base[2] + axis[2] * len + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * off,
        ],
        n: axis,
        s: 0,
        t: len,
    }, piece);
}

/** A rib: a six-sided section swept along a polyline. */
function addRib(builder, rib) {
    const { points, radius: r } = rib;
    const piece = {
        radius: r, seed: rib.seed, kind: KIND.structure, tracery: rib.tracery,
    };
    const profile = polygon(rib.tracery ? 4 : 6);
    const planeNormal = norm(rib.normal);
    const rings = [];
    let run = 0;
    for (let i = 0; i < points.length; i++) {
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const tangent = norm(sub(next, prev));
        if (i > 0) run += Math.hypot(...sub(points[i], points[i - 1]));
        // e1 lies in the arch's plane, across the rib; e2 is the plane's normal.
        const e1 = norm(crossV(planeNormal, tangent));
        const e2 = crossV(tangent, e1);
        // The seam goes on top, out of sight from below.
        const up = Math.atan2(dotV(UP, e2), dotV(UP, e1));
        rings.push(builder.ring(points[i], e1, e2, r, profile, Math.PI / 6, run, up + Math.PI));
    }
    builder.sweep(rings, piece);
}

/** An icicle: a five-sided spike hanging from a point. */
function addIcicle(builder, icicle) {
    const piece = { radius: icicle.radius, seed: icicle.seed, kind: KIND.icicle };
    const profile = polygon(5);
    const spin = icicle.seed * TAU;
    const lean = icicle.radius * 1.1;
    const dx = Math.cos(spin) * lean;
    const dz = Math.sin(spin) * lean;
    const top = builder.ring([icicle.x, icicle.y + 0.15, icicle.z], X, Z, icicle.radius * 1.23, profile, spin, 0, 0);
    const mid = builder.ring(
        [icicle.x + dx, icicle.y - icicle.length * 0.35, icicle.z + dz],
        X,
        Z,
        icicle.radius * 0.62,
        profile,
        spin + 0.16,
        icicle.length * 0.35,
        0,
    );
    builder.sweep([mid, top], piece);
    builder.cone(mid, {
        p: [icicle.x + dx * 1.6, icicle.y - icicle.length, icicle.z + dz * 1.6],
        n: [0, -1, 0],
        s: 0,
        t: icicle.length,
    }, piece);
}

/** Cusped inner moulding beneath the crown of alternate transverse arches. */
function addArchCusps(builder, arch) {
    const centre = (arch.points.length - 1) / 2;
    const [x, y, z] = arch.points[centre];
    const left = arch.points[centre - 4];
    const right = arch.points[centre + 4];
    const lower = [
        [-5.0, -2.25], [-3.45, -2.45], [-2.48, -3.35], [-2.34, -2.30],
        [-1.63, -1.53], [0, -0.27], [1.63, -1.53], [2.34, -2.30],
        [2.48, -3.35], [3.45, -2.45], [5.0, -2.25],
    ].map(([dx, dy]) => [x + dx, y + dy, z]);
    addRib(builder, {
        points: [left, ...lower, right], radius: 0.19, seed: arch.seed, normal: Z, tracery: 0.72,
    });
}

/** Raised lancets on the four faces of a nave pier. Their folded shoulders catch the
 * side light. The little double-ended stone stands clear of the pier inside each one. */
function addPierTracery(builder, column) {
    const {
        x, z, radius: r, height: h, twist, seed,
    } = column;
    const bay = Math.round((NAVE.firstZ - z) / NAVE.bay);
    for (let i = 0; i < 4; i++) {
        const a = twist + (TAU * (i + 0.5)) / 4;
        const front = [Math.cos(a), 0, Math.sin(a)];
        const tangent = [-front[2], 0, front[0]];
        const place = (s, y, outset = 1.08) => {
            const angle = a + s;
            return [x + r * outset * Math.cos(angle), y, z + r * outset * Math.sin(angle)];
        };
        const shoulder = h * (bay % 2 ? 0.20 : 0.27);
        const tip = h * (bay % 2 ? 0.33 : 0.42);
        const points = [
            place(-0.54, 0.88, 1.41), place(-0.49, 1.82), place(-0.49, shoulder),
            place(-0.40, shoulder + 0.55), place(-0.18, tip - 1.15), place(0, tip, 1.02),
            place(0.18, tip - 1.15), place(0.40, shoulder + 0.55), place(0.49, shoulder),
            place(0.49, 1.82), place(0.54, 0.88, 1.41),
        ];
        addRib(builder, {
            points, radius: r * 0.077, seed, normal: front, tracery: 0.52,
        });
        // One little votive stone faces the nave on each major pier. The minor
        // piers carry shorter, empty lancets, leaving their dark ice exposed.
        if (bay % 2 || i !== (x > 0 ? 1 : 0)) continue;
        const jewel = {
            radius: r * (bay % 4 ? 0.16 : 0.20), seed, kind: KIND.shard, tracery: 1,
        };
        const waist = place(0, shoulder, 1.18);
        const middle = builder.ring(waist, tangent, front, jewel.radius, polygon(6), 0, 0, 0);
        builder.cone(middle, {
            p: place(0, shoulder + 0.65, 1.1), n: UP, s: 0, t: 0.65,
        }, jewel);
        builder.cone(middle, {
            p: place(0, shoulder - 0.94, 1.08), n: [0, -1, 0], s: 0, t: -0.94,
        }, jewel);
    }
}

/** A wheel of six pointed lights above the altar, cut from solid ice. The sky is visible
 * through its openings and the great crystal occludes its centre from the nave. */
function addApseRose(builder) {
    const z = NAVE.heartZ - 5.7;
    const height = NAVE.heartY + 7.0;
    const radius = 11.7;
    const point = (a, d, side = 0) => [
        Math.sin(a) * d + Math.cos(a) * side, height + Math.cos(a) * d - Math.sin(a) * side, z,
    ];
    const rim = Array.from({ length: 37 }, (_, i) => point((TAU * i) / 36, radius));
    addRib(builder, {
        points: rim, radius: 0.32, seed: 0.58, normal: Z, tracery: 0.86,
    });
    for (let i = 0; i < 6; i++) {
        const a = (TAU * i) / 6;
        const outline = [[2.3, 0], [3.9, -1.3], [6.7, -2.18], [8.9, -1.65], [radius, 0],
            [8.9, 1.65], [6.7, 2.18], [3.9, 1.3], [2.3, 0]];
        const points = outline.map(([d, s]) => point(a, d, s));
        addRib(builder, {
            points, radius: 0.22, seed: i / 6, normal: Z, tracery: 1,
        });
    }
}

/**
 * The temple's ice for a plan (buildPlan): flat-shaded triangles with the per-vertex data the ice
 * material reads, as typed arrays.
 * @param {object} plan
 */
export function architectureArrays(plan) {
    const builder = new IceBuilder();
    const rand = mulberry32(0x1ce7e);
    plan.columns.forEach((column) => addColumn(builder, column, rand));
    plan.columns.filter((column) => column.kind === 'nave').forEach((column) => addPierTracery(builder, column));
    addApseRose(builder);
    plan.ribs.forEach((rib) => {
        addRib(builder, rib);
        if (rib.kind === 'transverse' && Math.round((NAVE.firstZ - rib.points[0][2]) / NAVE.bay) % 2 === 0) {
            addArchCusps(builder, rib);
        }
    });
    plan.crystals.forEach((crystal) => addCrystal(builder, crystal, rand));
    plan.icicles.forEach((icicle) => addIcicle(builder, icicle));
    return builder.data();
}

/** What the worker bakes for a plan seed (buildPlan's default when none): the plan's ice. */
export function bakeArchitectureData(...seed) {
    return architectureArrays(buildPlan(...seed));
}
