/**
 * Moonlit Greenhouse — the plants' geometry (CPU only, three-free): every frond, leaf, trunk and
 * strand of the garden as plain arrays, built once from the plan.
 *
 * Almost everything green in the house is ONE kind of thing, a leaf strip: a ribbon laid along a
 * spine (a palm's rachis, a banana's midrib, a monstera's petiole running on into its blade), its
 * two halves folded off the spine into a shallow V (or hung below it in a tent, as a Kentia palm
 * hangs its leaflets), as wide as the leaf's envelope at each ring. The strip is only the leaf's
 * bounding shape; the leaf itself (a comb of leaflets, a paddle with its tears, a heart with its
 * slits and holes) is cut from it in the fragment stage (moonlit-greenhouse-flora-shading.js), so
 * a frond of forty leaflets costs a few dozen triangles. Trunks and stems are tubes.
 *
 * Every vertex carries, besides its position and normal:
 *   aLeaf  (u, along, wGeom, wEnv)   u −1..1 across the strip (0 on the spine), metres along the
 *                                    spine, the strip's half-width here, and the leaf's own
 *                                    envelope (the leaflets' length; the blade's half-width scale)
 *   aSway  (wPlant, phPlant, wLeaf, phLeaf)  how far this point moves with the whole plant and
 *                                    with its own leaf (metres of sway at full strength), and the
 *                                    phase of each, so a crown sways as one and every frond on it
 *                                    nods on its own
 *   aInfo  (L, id, age, kind)        the strip's length, an integer id (plant × 64 + leaf), the
 *                                    leaf's age 0..1 (young to old), and its kind plus 0.9 × the
 *                                    share of its length that is bare stalk (petiole, stipe)
 * Trunks use aLeaf as (around 0..1, along, radius, 0).
 *
 * Plants are laid down nearest the eye first, so each merged mesh draws front to back.
 * Normals are the triangles' own (accumulated), so they always agree with the winding: the
 * upper face of a leaf and the outside of a trunk face out (tests/unit/moonlit-greenhouse-flora.test.js).
 */
import {
    FLOOR, HOUSE, clamp, lerp, mulberry32, smooth, vaultHeightAt,
} from './moonlit-greenhouse-core.js';
import { palmCrownCentre, palmFrondAngle } from './moonlit-greenhouse-plan.js';

/** The surface under a point for the plants: the floor, a bed's soil, the canal's water. */
function groundAt(x, z) {
    const ax = Math.abs(x);
    if (ax < FLOOR.canal.half && z < FLOOR.canal.head) return FLOOR.canal.water;
    if (ax < FLOOR.path.outer) return 0;
    return FLOOR.bed.soil;
}

const TAU = Math.PI * 2;
const GOLDEN = 2.39996;
/** A frond or a leaf bends down until it hangs (it never curls back under itself). */
const HANG = -1.5;

/** The kinds a strip or tube can be (the shaders branch on them). */
export const KIND = Object.freeze({
    palmTrunk: 0,
    fernTrunk: 1,
    stem: 2,
    wire: 3,
    chain: 4,
    moss: 5,
    palm: 10,
    treeFern: 11,
    groundFern: 12,
    swordFern: 13,
    banana: 14,
    strelitzia: 15,
    monstera: 16,
    philodendron: 17,
    alocasia: 18,
    ivy: 19,
    strand: 20,
    crosier: 21,
});

// ── Small vector helpers (arrays of three) ──────────────────────────────────────────────────

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const addScaled = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/** The value of the first step whose threshold `x` reaches (steps from high to low), else `otherwise`. */
const pick = (x, steps, otherwise) => (steps.find(([at]) => x >= at) || [0, otherwise])[1];

/** A seeded stream for one plant (the plan's seed is 0..1). */
const streamFor = (seed, salt) => mulberry32(Math.floor(seed * 1e7) + salt * 7919);

// ── The batch: vertices and triangles of one merged mesh ────────────────────────────────────

export class FloraBatch {
    constructor() {
        this.position = [];
        this.normal = [];
        this.fixed = [];
        this.leaf = [];
        this.sway = [];
        this.info = [];
        this.index = [];
    }

    get vertexCount() {
        return this.position.length / 3;
    }

    /** One vertex; `n` (optional) is an explicit normal, else it is taken from the triangles. */
    vertex(p, leaf, sway, info, n = null) {
        const i = this.vertexCount;
        this.position.push(p[0], p[1], p[2]);
        this.normal.push(n ? n[0] : 0, n ? n[1] : 0, n ? n[2] : 0);
        this.fixed.push(n ? 1 : 0);
        this.leaf.push(leaf[0], leaf[1], leaf[2], leaf[3]);
        this.sway.push(sway[0], sway[1], sway[2], sway[3]);
        this.info.push(info[0], info[1], info[2], info[3]);
        return i;
    }

    /** A quad: a→b runs across (−side to +side, or round a tube), a→c along. Faces a×c's way. */
    quad(a, b, c, d) {
        this.index.push(a, b, c, b, d, c);
    }

    /** Typed arrays, with the normals that were not given accumulated from the triangles. */
    finish() {
        const count = this.vertexCount;
        const P = this.position;
        const acc = new Float64Array(count * 3);
        const I = this.index;
        for (let t = 0; t < I.length; t += 3) {
            const a = I[t] * 3;
            const b = I[t + 1] * 3;
            const c = I[t + 2] * 3;
            const ux = P[b] - P[a];
            const uy = P[b + 1] - P[a + 1];
            const uz = P[b + 2] - P[a + 2];
            const vx = P[c] - P[a];
            const vy = P[c + 1] - P[a + 1];
            const vz = P[c + 2] - P[a + 2];
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            for (const k of [a, b, c]) {
                acc[k] += nx;
                acc[k + 1] += ny;
                acc[k + 2] += nz;
            }
        }
        const normal = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
            const k = i * 3;
            if (this.fixed[i]) {
                normal[k] = this.normal[k];
                normal[k + 1] = this.normal[k + 1];
                normal[k + 2] = this.normal[k + 2];
            } else {
                const l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]);
                normal[k] = l > 0 ? acc[k] / l : 0;
                normal[k + 1] = l > 0 ? acc[k + 1] / l : 1;
                normal[k + 2] = l > 0 ? acc[k + 2] / l : 0;
            }
        }
        return {
            position: new Float32Array(P),
            normal,
            aLeaf: new Float32Array(this.leaf),
            aSway: new Float32Array(this.sway),
            aInfo: new Float32Array(this.info),
            index: count > 65535 ? new Uint32Array(I) : new Uint16Array(I),
            vertexCount: count,
            triangleCount: I.length / 3,
        };
    }
}

// ── Spines ──────────────────────────────────────────────────────────────────────────────────

/**
 * Where a spine of unit length ends that leaves its origin climbing at `pitch0` (radians) and
 * bends down by `bend` over its length, the bend gathering toward the tip (`powers` holds σ^gamma
 * at its steps) until it hangs: [h, y], h the horizontal run.
 */
function bendTip(pitch0, bend, powers) {
    let h = 0;
    let y = 0;
    for (let i = 0; i < powers.length; i += 1) {
        const a = Math.max(pitch0 - bend * powers[i], HANG);
        h += Math.cos(a);
        y += Math.sin(a);
    }
    return [h / powers.length, y / powers.length];
}

/**
 * The bend and length that carry a spine starting at `pitch0` out `reach` metres and down `drop`
 * metres (negative: up) at its tip. (The tip's slope falls as the bend grows: a bisection.)
 */
export function fitArc(pitch0, reach, drop, gamma = 1.5) {
    const target = -drop / Math.max(reach, 1e-3);
    const powers = Array.from({ length: 32 }, (_, i) => ((i + 0.5) / 32) ** gamma);
    let lo = 0;
    let hi = 14;
    for (let it = 0; it < 24; it += 1) {
        const mid = (lo + hi) / 2;
        const [h, y] = bendTip(pitch0, mid, powers);
        if (y / Math.max(h, 1e-3) > target) lo = mid;
        else hi = mid;
    }
    const bend = (lo + hi) / 2;
    const [h] = bendTip(pitch0, bend, powers);
    return { bend, length: reach / Math.max(h, 0.05) };
}

/**
 * The rings of a spine from `origin` heading `heading` (radians in x–z: along (cos, sin)),
 * climbing at `pitch0` and bending by `bend` over `length` metres, curling sideways by `curl`
 * radians, rolling its blade about itself by `roll(σ)`: `segments` + 1 frames
 * { p, t, s, n, along, sigma }. `s` is the side (horizontal, across the heading), `n` the
 * leaf's upper face.
 */
export function spineRings(origin, heading, pitch0, bend, length, segments, {
    gamma = 1.5, curl = 0, roll = () => 0, sigmaOf = (i) => i / segments,
} = {}) {
    const rings = [];
    const sub0 = 6;
    let p = origin.slice();
    let walked = 0;
    let prevSigma = 0;
    for (let i = 0; i <= segments; i += 1) {
        const sigma = sigmaOf(i);
        // Walk from the last ring to this one in small steps.
        const steps = i === 0 ? 0 : sub0;
        for (let k = 0; k < steps; k += 1) {
            const s = prevSigma + ((k + 0.5) / steps) * (sigma - prevSigma);
            const a = Math.max(pitch0 - bend * s ** gamma, HANG);
            const th = heading + curl * s;
            const ds = ((sigma - prevSigma) / steps) * length;
            p = addScaled(p, [Math.cos(a) * Math.cos(th), Math.sin(a), Math.cos(a) * Math.sin(th)], ds);
            walked += ds;
        }
        prevSigma = sigma;
        const a = Math.max(pitch0 - bend * sigma ** gamma, HANG);
        const th = heading + curl * sigma;
        const t = [Math.cos(a) * Math.cos(th), Math.sin(a), Math.cos(a) * Math.sin(th)];
        const side = [-Math.sin(th), 0, Math.cos(th)];
        const up = cross(side, t);
        const r = roll(sigma);
        const s = add(scale(side, Math.cos(r)), scale(up, Math.sin(r)));
        const n = sub(scale(up, Math.cos(r)), scale(side, Math.sin(r)));
        rings.push({
            p, t, s, n, along: walked, sigma,
        });
    }
    return rings;
}

/** The highest and outermost a set of rings reaches, and whether it stays inside the house. */
function insideHouse(rings, margin = 0.3) {
    for (const r of rings) {
        const [x, y] = r.p;
        if (Math.abs(x) > HOUSE.halfSpan - margin) return false;
        if (y > vaultHeightAt(x) - margin) return false;
    }
    return true;
}

/**
 * A point held just inside the glass: a leaflet that would touch a side wall or the vault lies
 * along it instead (the fronds are fitted to stay clear, so this only presses a few tips).
 */
function underGlass(p) {
    const limit = HOUSE.halfSpan - 0.12;
    const x = clamp(p[0], -limit, limit);
    const y = Math.min(p[1], vaultHeightAt(x) - 0.12);
    return x === p[0] && y === p[1] ? p : [x, y, p[2]];
}

/** The points a strip's edges reach at each ring (for the house check), as layStrip lays them. */
function stripInside(rings, margin = 0.2) {
    for (const r of rings) {
        const w = r.wGeom || 0;
        const f = r.fold || 0;
        for (const h of [-1, 1]) {
            const e = sub(addScaled(r.p, r.s, h * w * Math.cos(f)), scale(r.n, w * Math.sin(f)));
            if (Math.abs(e[0]) > HOUSE.halfSpan - margin || e[1] > vaultHeightAt(e[0]) - margin) return false;
        }
    }
    return insideHouse(rings, margin);
}

// ── Laying strips and tubes ─────────────────────────────────────────────────────────────────

const ACROSS = { 3: [-1, 0, 1], 5: [-1, -0.5, 0, 0.5, 1] };

/**
 * Lay a leaf strip along `rings` (each with wGeom, wEnv, fold and sway set). `fold` > 0 hangs
 * the halves below the spine (a tent), < 0 lifts them (a trough); with five vertices across the
 * halves curve, so a leaflet arches as it hangs. `info` = [L, id, age, kindPacked].
 */
export function layStrip(batch, rings, across, info) {
    const qs = ACROSS[across >= 5 ? 5 : 3];
    const base = batch.vertexCount;
    rings.forEach((r) => {
        qs.forEach((q) => {
            const h = Math.sign(q);
            const a = Math.abs(q);
            let { p } = r;
            const dirAt = (fold) => sub(scale(r.s, h * Math.cos(fold)), scale(r.n, Math.sin(fold)));
            if (a > 0 && qs.length === 5) {
                p = addScaled(p, dirAt(r.fold * 0.55), r.wGeom * 0.5);
                if (a > 0.75) p = addScaled(p, dirAt(r.fold * 1.45), r.wGeom * 0.5);
            } else if (a > 0) {
                p = addScaled(p, dirAt(r.fold), r.wGeom);
            }
            batch.vertex(underGlass(p), [q, r.along, r.wGeom, r.wEnv], r.sway, info);
        });
    });
    const w = qs.length;
    for (let i = 0; i < rings.length - 1; i += 1) {
        for (let j = 0; j < w - 1; j += 1) {
            const a = base + i * w + j;
            batch.quad(a, a + 1, a + w, a + w + 1);
        }
    }
}

/**
 * Frames along a polyline that turn as little as possible (parallel transport): each point gets
 * a tangent and two normals e1, e2 with e1 × e2 = t.
 */
export function transportFrames(points) {
    const n = points.length;
    const frames = [];
    let e1 = null;
    for (let i = 0; i < n; i += 1) {
        const a = points[Math.max(0, i - 1)];
        const b = points[Math.min(n - 1, i + 1)];
        const t = normalize(sub(b, a));
        if (!e1) {
            const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            e1 = normalize(cross(t, ref));
        } else {
            e1 = normalize(sub(e1, scale(t, dot(e1, t))));
        }
        const e2 = cross(t, e1);
        frames.push({
            p: points[i], t, e1, e2,
        });
    }
    return frames;
}

/**
 * Lay a tube along `points` with radius `radius(σ, θ)` and `sides` round. aLeaf is
 * (around 0..1, metres along, radius, σ); `swayAt(σ)` gives the ring's aSway. Faces out.
 */
export function layTube(batch, points, radius, sides, swayAt, info) {
    const frames = transportFrames(points);
    const base = batch.vertexCount;
    let along = 0;
    frames.forEach((f, i) => {
        if (i > 0) along += len(sub(f.p, frames[i - 1].p));
        const sigma = i / (frames.length - 1);
        for (let j = 0; j <= sides; j += 1) {
            const th = (j / sides) * TAU;
            const radial = add(scale(f.e1, Math.cos(th)), scale(f.e2, Math.sin(th)));
            const r = radius(sigma, th);
            batch.vertex(addScaled(f.p, radial, r), [j / sides, along, r, sigma], swayAt(sigma), info, radial);
        }
    });
    const w = sides + 1;
    for (let i = 0; i < frames.length - 1; i += 1) {
        for (let j = 0; j < sides; j += 1) {
            const a = base + i * w + j;
            batch.quad(a, a + 1, a + w, a + w + 1);
        }
    }
}

/** A trunk's top closed in a dome from σ = `from` (its last ring has no radius). */
function domeCap(sigma, from) {
    const k = smooth(from, 1.0, sigma);
    return Math.sqrt(Math.max(0, 1 - k * k));
}

/** A quadratic Bézier's points from a to c over the control b. */
function bezier(a, b, c, n) {
    const out = [];
    for (let i = 0; i <= n; i += 1) {
        const s = i / n;
        const u = 1 - s;
        out.push([
            u * u * a[0] + 2 * u * s * b[0] + s * s * c[0],
            u * u * a[1] + 2 * u * s * b[1] + s * s * c[1],
            u * u * a[2] + 2 * u * s * b[2] + s * s * c[2],
        ]);
    }
    return out;
}

/** The kind packed with its bare-stalk share (0..1), as aInfo.w carries it. */
export const packKind = (kind, stalk = 0) => kind + 0.9 * clamp(stalk, 0, 1);

/** How detailed the strips are for a tier. */
export function floraDetail(tier) {
    return {
        segments: Math.max(6, tier.frond),
        across: tier.frond >= 16 ? 5 : 3,
        sides: pick(tier.frond, [[16, 10], [12, 8]], 6),
    };
}

// ── Palms ───────────────────────────────────────────────────────────────────────────────────

/**
 * A palm frond's envelope (the leaflets' length, metres) at σ along it: a bare petiole, then the
 * leaflets lengthening to their longest a third of the way out and shortening to the tip.
 */
export function palmEnvelope(sigma, widest, stalk = 0.12) {
    return widest * smooth(stalk, stalk + 0.2, sigma) * (1 - 0.78 * smooth(0.36, 1.0, sigma));
}

/**
 * The palms: Kentia palms (the palm house's own), slender ringed trunks that lean in toward the
 * nave and curve a little, each crown a fan of arching fronds whose headings are the plan's
 * (palmFrondAngle — the canopy's shadow is computed from the same numbers), the leaflets hanging
 * from each rachis, plus the spear of the next frond standing up in the middle.
 * Returns { fronds, trunks, frondHeadings } (headings per palm, in plan order, for the tests).
 */
export function buildPalms(plan, tier) {
    const { segments, across, sides } = floraDetail(tier);
    const fronds = new FloraBatch();
    const trunks = new FloraBatch();
    const frondHeadings = plan.palms.map(() => []);
    const order = plan.palms.map((palm, i) => ({ palm, i })).sort((a, b) => b.palm.z - a.palm.z);
    order.forEach(({ palm, i }) => {
        const rand = streamFor(palm.seed, 11 + i);
        const C = palmCrownCentre(palm);
        const crown = [C.x, C.y, C.z];
        const side = Math.sign(palm.x || 1);
        const phPlant = palm.seed * 37.1;
        const swayPlant = 0.22;

        // The trunk: from below the soil to just over the crown's centre (the frond bases hide
        // the join), bowed: its foot stands straighter and the lean gathers higher up.
        const foot = [palm.x, FLOOR.bed.soil - 0.15, palm.z];
        const top = add(crown, [0, 0.18, 0]);
        const mid = add(scale(add(foot, top), 0.5), [side * (0.18 + palm.lean * 1.6), 0, (rand() - 0.5) * 0.35]);
        const points = bezier(foot, mid, top, segments + 4);
        const rFoot = lerp(0.17, 0.21, rand());
        const rTop = lerp(0.12, 0.14, rand());
        layTube(
            trunks,
            points,
            (sigma) => {
                const flare = 1 + 0.55 * Math.exp(-sigma * 22);
                const boot = 0.045 * smooth(0.9, 1.0, sigma);
                return (lerp(rFoot, rTop, sigma ** 0.6) * flare + boot) * domeCap(sigma, 0.96);
            },
            sides,
            (sigma) => [swayPlant * sigma * sigma, phPlant, 0, 0],
            [palm.height, i * 64, 0, packKind(KIND.palmTrunk)],
        );

        // The fronds.
        const widest = lerp(0.52, 0.68, rand()) * (palm.crown / 2.8);
        for (let k = 0; k < palm.fronds; k += 1) {
            const heading = palmFrondAngle(palm, k);
            frondHeadings[i].push(heading);
            // Ages spiral round the crown: the young stand high, the old hang low.
            const rank = (k * 0.618034 + palm.seed * 3.7) % 1;
            const age = 1 - rank;
            const dirX = Math.cos(heading);
            // A fountain: the young climb steeply and arch over with their tips near the crown's
            // height, the old leave it level and hang well below.
            let reach = palm.crown * lerp(0.88, 1.0, rand());
            let drop = lerp(-0.2, 2.1, age * age) + (rand() - 0.5) * 0.4;
            let pitch0 = lerp(0.0, 1.25, rank);
            // A frond heading for the side wall has less room: it shortens and hangs steeper.
            if (Math.sign(dirX) === side && Math.abs(dirX) > 0.05) {
                const room = (HOUSE.halfSpan - 0.4 - Math.abs(C.x)) / Math.abs(dirX);
                if (reach > room) {
                    drop += (reach - room) * 0.9;
                    reach = Math.max(room, palm.crown * 0.35);
                }
            }
            const origin = addScaled(crown, [dirX, 0, Math.sin(heading)], 0.06);
            let rings = null;
            const stalk = lerp(0.1, 0.16, rand());
            const phLeaf = rand() * TAU;
            const foldBase = lerp(0.18, 0.55, age);
            const foldGain = lerp(0.45, 0.75, age);
            const roll0 = (rand() - 0.5) * 0.9;
            const curl = (rand() - 0.5) * 0.3;
            // A frond (leaflets and all) must stay under the glass: one that would touch it climbs
            // less, reaches less and hangs lower until it fits.
            for (let tries = 0; tries < 14; tries += 1) {
                const { bend, length } = fitArc(pitch0, reach, drop);
                rings = spineRings(origin, heading, pitch0, bend, length, segments, {
                    curl,
                    roll: (s) => roll0 * s * s,
                    sigmaOf: (j) => (j / segments) ** 1.15,
                });
                rings.forEach((r) => {
                    r.wEnv = palmEnvelope(r.sigma, widest, stalk);
                    r.wGeom = Math.max(r.wEnv, 0.035);
                    r.fold = foldBase + r.sigma * foldGain;
                });
                if (stripInside(rings, 0.15)) break;
                pitch0 -= 0.08;
                reach *= 0.9;
                drop += 0.12;
            }
            const L = rings[rings.length - 1].along;
            rings.forEach((r) => {
                r.sway = [swayPlant, phPlant, 0.95 * r.sigma ** 1.6 * (L / 3), phLeaf + r.sigma * 1.1];
            });
            layStrip(fronds, rings, across, [L, i * 64 + k, age, packKind(KIND.palm, stalk)]);
        }

        // The spear: the next frond, still closed, standing up out of the crown.
        const spearLen = lerp(0.9, 1.4, rand());
        const spearRings = spineRings(
            add(crown, [0, 0.1, 0]),
            rand() * TAU,
            1.42,
            0.12,
            spearLen,
            Math.max(4, segments >> 2),
        );
        spearRings.forEach((r) => {
            r.wEnv = 0.06 * smooth(0.0, 0.25, r.sigma) * (1 - 0.7 * r.sigma);
            r.wGeom = Math.max(r.wEnv, 0.02);
            r.fold = 1.25;
            r.sway = [swayPlant, phPlant, 0.2 * r.sigma, rand() * TAU];
        });
        layStrip(fronds, spearRings, 3, [spearLen, i * 64 + 63, 0, packKind(KIND.palm, 0.05)]);
    });
    return { fronds: fronds.finish(), trunks: trunks.finish(), frondHeadings };
}

// ── Ferns ───────────────────────────────────────────────────────────────────────────────────

/** A fern frond's envelope: a bare stipe, then pinnae lengthening and shortening to a point. */
export function fernEnvelope(sigma, widest, stalk, peak = 0.38) {
    const rise = smooth(stalk, stalk + (peak - stalk) * 0.9, sigma);
    const fall = 1 - smooth(peak, 1.0, sigma) ** 1.3 * 0.92;
    return widest * rise * fall;
}

/**
 * The ground ferns the beds hold: the plan's rosettes, a satellite or two seeded round each (the
 * richer tiers), and a fringe of small rosettes along both bed fronts, densest by the eye, whose
 * fronds spill over the kerb onto the path. Kept clear of the trunks. Deterministic.
 */
export function understory(plan, tier) {
    const rand = mulberry32((plan.seed || 1861) * 31 + 7);
    const out = plan.groundFerns.map((f) => ({ ...f }));
    const trunks = [
        ...plan.palms.map((p) => [p.x, p.z, 0.45]),
        ...plan.treeFerns.map((p) => [p.x, p.z, 0.4]),
        ...plan.bananas.map((p) => [p.x, p.z, 0.3]),
    ];
    const clear = (x, z) => trunks.every(([tx, tz, r]) => Math.hypot(tx - x, tz - z) > r);
    const inBed = (x) => Math.abs(x) > FLOOR.bed.inner + 0.15 && Math.abs(x) < HOUSE.halfSpan - 0.35;
    const satellites = pick(tier.groundFerns, [[72, 2], [40, 1]], 0);
    plan.groundFerns.forEach((f) => {
        for (let k = 0; k < satellites; k += 1) {
            const a = rand() * TAU;
            const d = lerp(0.6, 1.0, rand());
            const x = f.x + Math.cos(a) * d;
            const z = f.z + Math.sin(a) * d;
            if (!inBed(x) || !clear(x, z)) continue;
            out.push({
                side: f.side,
                x,
                z,
                scale: f.scale * lerp(0.8, 1.05, rand()),
                fronds: 7 + Math.floor(rand() * 4),
                yaw: rand() * TAU,
                seed: rand(),
            });
        }
    });
    // The fringe along the bed fronts.
    const every = 2.2 - Math.min(1.4, tier.groundFerns / 56);
    [-1, 1].forEach((side) => {
        for (let z = 1.1; z > -26; z -= every * (1 + Math.max(0, -z) / 14)) {
            const x = side * lerp(FLOOR.bed.inner + 0.2, FLOOR.bed.inner + 0.45, rand());
            const zz = z + (rand() - 0.5) * every * 0.6;
            if (!clear(x, zz)) continue;
            out.push({
                side,
                x,
                z: zz,
                scale: lerp(0.65, 0.95, rand()),
                fronds: 7 + Math.floor(rand() * 4),
                yaw: rand() * TAU,
                seed: rand(),
            });
        }
    });
    return out;
}

/**
 * Low clumps of monstera and philodendron crowding the bed fronts where the eye is closest (the
 * beds' first dozen metres fill the picture's lower sides), clear of the plan's own monsteras and
 * of the trunks. Same fields as a plan monstera. Deterministic.
 */
export function bedFrontClumps(plan, tier) {
    const rand = mulberry32((plan.seed || 1861) * 17 + 3);
    const out = [];
    const taken = [
        ...plan.monsteras.map((p) => [p.x, p.z, 1.0]),
        ...plan.palms.map((p) => [p.x, p.z, 0.5]),
        ...plan.treeFerns.map((p) => [p.x, p.z, 0.5]),
        ...plan.bananas.map((p) => [p.x, p.z, 0.6]),
    ];
    const every = pick(tier.monsteras, [[16, 1.5], [12, 1.9]], 2.6);
    [-1, 1].forEach((side) => {
        for (let z = 0.9; z > -12; z -= every) {
            const x = side * lerp(FLOOR.bed.inner + 0.3, FLOOR.bed.inner + 0.75, rand());
            const zz = z + (rand() - 0.5) * every * 0.5;
            if (taken.some(([tx, tz, r]) => Math.hypot(tx - x, tz - zz) < r)) continue;
            taken.push([x, zz, 0.9]);
            out.push({
                side,
                x,
                z: zz,
                scale: lerp(0.7, 1.05, rand()),
                leaves: 4 + Math.floor(rand() * 3),
                yaw: rand() * TAU,
                seed: rand(),
            });
        }
    });
    return out;
}

/**
 * The ferns: tree ferns (Dicksonia: fibrous dark trunks, crowns of lacy bipinnate fronds arching
 * out and down, a few fiddleheads uncurling in the middle) and the ground ferns that carpet the
 * beds (rosettes of once-pinnate fronds whose tips reach back down to the soil; at the bed
 * fronts they spill over the kerb). Returns { fronds, trunks }.
 */
export function buildFerns(plan, tier) {
    const { segments, across, sides } = floraDetail(tier);
    const fronds = new FloraBatch();
    const trunks = new FloraBatch();
    const { soil } = FLOOR.bed;

    const tree = plan.treeFerns.map((fern, i) => ({ fern, i })).sort((a, b) => b.fern.z - a.fern.z);
    tree.forEach(({ fern, i }) => {
        const rand = streamFor(fern.seed, 211 + i);
        const id = 1000 + i;
        const lean = rand() * TAU;
        const tilt = 0.03 + rand() * 0.06;
        const foot = [fern.x, soil - 0.1, fern.z];
        const offset = fern.height * tilt;
        const top = [fern.x + Math.cos(lean) * offset, soil + fern.height, fern.z + Math.sin(lean) * offset];
        const mid = add(scale(add(foot, top), 0.5), [(rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25]);
        const points = bezier(foot, mid, top, Math.max(8, segments));
        const r0 = lerp(0.15, 0.2, rand());
        const lumpA = rand() * TAU;
        const lumpB = rand() * TAU;
        const phPlant = fern.seed * 41.3;
        const swayPlant = 0.07;
        // A shaggy column: lumps of old stipe bases and a mat of roots toward the foot, a
        // swollen crown of rusty hairs at the top.
        layTube(
            trunks,
            points,
            (sigma, th) => {
                const lumps = 0.09 * Math.sin(th * 3 + lumpA + sigma * 9) * Math.sin(sigma * 23 + lumpB + th * 2);
                const roots = 0.35 * Math.exp(-sigma * 9);
                const crownSwell = 0.45 * smooth(0.8, 0.95, sigma);
                return r0 * (1 + lumps + roots + crownSwell) * domeCap(sigma, 0.93);
            },
            sides,
            (sigma) => [swayPlant * sigma * sigma, phPlant, 0, 0],
            [fern.height, id * 64, 0, packKind(KIND.fernTrunk)],
        );

        const crownAt = add(top, [0, 0.06, 0]);
        const widest = lerp(0.3, 0.4, rand()) * (fern.crown / 2.0);
        for (let k = 0; k < fern.fronds; k += 1) {
            const heading = fern.twist + (k / fern.fronds) * TAU + (rand() - 0.5) * 0.35;
            const rank = (k * 0.618034 + fern.seed * 5.1) % 1;
            const age = 1 - rank;
            const reach = fern.crown * lerp(0.82, 1.0, rand());
            const drop = lerp(0.25, 1.1, age) + (rand() - 0.5) * 0.25;
            const pitch0 = lerp(0.3, 0.95, rank);
            const { bend, length } = fitArc(pitch0, reach, drop, 1.3);
            const roll0 = (rand() - 0.5) * 0.6;
            const origin = addScaled(crownAt, [Math.cos(heading), 0, Math.sin(heading)], 0.1);
            const rings = spineRings(origin, heading, pitch0, bend, length, segments, {
                gamma: 1.3, curl: (rand() - 0.5) * 0.35, roll: (s) => roll0 * s,
            });
            const L = rings[rings.length - 1].along;
            const stalk = lerp(0.07, 0.12, rand());
            const phLeaf = rand() * TAU;
            rings.forEach((r) => {
                r.wEnv = fernEnvelope(r.sigma, widest, stalk, 0.4);
                r.wGeom = Math.max(r.wEnv, 0.025);
                r.fold = lerp(0.05, 0.3, age) + r.sigma * 0.35;
                r.sway = [swayPlant, phPlant, 0.6 * r.sigma ** 1.5 * (L / 2), phLeaf + r.sigma];
            });
            layStrip(fronds, rings, across, [L, id * 64 + k, age, packKind(KIND.treeFern, stalk)]);
        }
        // Fiddleheads: young fronds still coiled, rising from the crown and rolling into a spiral.
        const crosiers = 2 + Math.floor(rand() * 3);
        for (let c = 0; c < crosiers; c += 1) {
            const heading = rand() * TAU;
            const lenC = lerp(0.22, 0.38, rand());
            const rings = spineRings(
                add(crownAt, [Math.cos(heading) * 0.06, 0, Math.sin(heading) * 0.06]),
                heading,
                1.45,
                5.2,
                lenC,
                10,
                { gamma: 1.8 },
            );
            rings.forEach((r) => {
                r.wEnv = 0.022 * (1 - 0.4 * r.sigma);
                r.wGeom = r.wEnv;
                r.fold = 0.8;
                r.sway = [swayPlant, phPlant, 0.05 * r.sigma, 0];
            });
            layStrip(fronds, rings, 3, [lenC, id * 64 + 40 + c, 0, packKind(KIND.crosier)]);
        }
    });

    // Ground ferns: the plan's rosettes, and the understory grown round them (see understory()).
    const fernSegments = Math.max(5, Math.round(segments * 0.55));
    const ground = understory(plan, tier).map((fern, i) => ({ fern, i })).sort((a, b) => b.fern.z - a.fern.z);
    ground.forEach(({ fern, i }) => {
        const rand = streamFor(fern.seed, 401 + i);
        const id = 2000 + i;
        const centre = [fern.x, soil + 0.04, fern.z];
        const count = Math.round(fern.fronds * 1.4);
        for (let k = 0; k < count; k += 1) {
            const heading = fern.yaw + (k / count) * TAU + (rand() - 0.5) * 0.5;
            const rank = rand();
            let reach = fern.scale * lerp(0.6, 1.0, rand());
            const pitch0 = lerp(0.55, 1.15, rank);
            // Keep clear of the side wall's plinth.
            const dirX = Math.cos(heading);
            const room = (HOUSE.halfSpan - 0.25 - Math.abs(fern.x)) / Math.max(Math.abs(dirX), 1e-3);
            if (Math.sign(dirX) === Math.sign(fern.x) && reach > room) reach = Math.max(room, 0.2);
            // Over the path, the tip hangs down past the kerb.
            const tipX = fern.x + dirX * reach;
            const drop = Math.abs(tipX) < FLOOR.bed.inner + 0.05 ? lerp(0.2, 0.35, rand()) : lerp(-0.05, 0.08, rand());
            const { bend, length } = fitArc(pitch0, reach, drop, 1.4);
            const origin = addScaled(centre, [Math.cos(heading), 0, Math.sin(heading)], 0.03);
            const roll0 = (rand() - 0.5) * 0.4;
            const rings = spineRings(origin, heading, pitch0, bend, length, fernSegments, {
                gamma: 1.4, curl: (rand() - 0.5) * 0.5, roll: (s) => roll0 * s,
            });
            const L = rings[rings.length - 1].along;
            const stalk = lerp(0.08, 0.14, rand());
            const widest = lerp(0.085, 0.12, rand()) * fern.scale;
            const phLeaf = rand() * TAU;
            const age = rand() * 0.6;
            rings.forEach((r) => {
                r.wEnv = fernEnvelope(r.sigma, widest, stalk, 0.42);
                r.wGeom = Math.max(r.wEnv, 0.012);
                r.fold = 0.15 + r.sigma * 0.4;
                r.sway = [0, 0, 0.28 * r.sigma ** 1.5 * (L / 0.6), phLeaf + r.sigma];
            });
            layStrip(fronds, rings, 3, [L, id * 64 + k, age, packKind(KIND.groundFern, stalk)]);
        }
    });
    return { fronds: fronds.finish(), trunks: trunks.finish() };
}

// ── Broad leaves: bananas, monsteras, the urns ──────────────────────────────────────────────

/** A banana's blade half-width at blade-σ b (0..1): an oblong paddle, rounded at both ends. */
export function paddleEnvelope(b, widest) {
    if (b <= 0 || b >= 1) return 0;
    const e = Math.abs(2 * b - 1);
    return widest * Math.sqrt(Math.max(0, 1 - e ** 3.2)) * (1 - 0.18 * b);
}

/**
 * A heart's half-width (share of the blade's half-width) at blade coordinate y (−lobe..1): the
 * basal lobes below the petiole's junction, widest a third of the way up, an acute tip. The
 * strip is laid this wide (plus a margin); the fragment cuts the same outline.
 */
export function heartEnvelope(y, lobe = 0.14) {
    const t = clamp((y + lobe) / (1 + lobe), 0, 1);
    return Math.sin(Math.PI * t ** 0.62);
}

/**
 * One broad leaf: a petiole of `stalkLen` running on into a blade of `bladeLen`, from `origin`
 * heading `heading`, climbing at `pitch0` and bending by `bend`. `shape` is 'paddle' or 'heart'.
 */
function broadLeaf(batch, {
    origin, heading, pitch0, bend, stalkLen, bladeLen, widest, shape, kind, id, age, segments, across, sway, rand,
    lobe = 0.14, fold = 0.3, gamma = 1.3, roll = 0,
}) {
    const length = stalkLen + bladeLen;
    const stalk = stalkLen / length;
    // Rings: a few along the petiole, most along the blade.
    const stalkRings = Math.max(2, Math.round(segments * 0.25));
    const bladeRings = Math.max(4, segments);
    const lobeShare = shape === 'heart' ? (lobe * bladeLen) / length : 0;
    const sigmaOf = (i) => {
        if (i <= stalkRings) return ((stalk - lobeShare) * i) / stalkRings;
        const b = (i - stalkRings) / bladeRings;
        return stalk - lobeShare + (1 - stalk + lobeShare) * b;
    };
    const curl = (rand() - 0.5) * 0.25;
    let rings = null;
    let bendNow = bend;
    // A leaf may not hang into the soil or out through the glass: it bends less until it fits.
    const shapeRings = () => rings.forEach((r) => {
        const b = (r.sigma - stalk) / (1 - stalk);
        if (shape === 'paddle') {
            const env = paddleEnvelope(b, widest);
            r.wEnv = env;
            r.wGeom = Math.max(env, 0.022);
        } else {
            // b is the blade coordinate: 0 at the junction, 1 at the tip, −lobe at the lobes' foot.
            r.wEnv = widest;
            r.wGeom = b >= -lobe - 1e-6 ? Math.max(widest * (heartEnvelope(b, lobe) * 1.04 + 0.02), 0.02) : 0.02;
        }
        r.fold = (b > 0 ? fold * (0.5 + 0.8 * b) : 0.6);
    });
    for (let tries = 0; tries < 8; tries += 1) {
        rings = spineRings(origin, heading, pitch0, bendNow, length, stalkRings + bladeRings, {
            gamma, curl, roll: (s) => roll * s, sigmaOf,
        });
        shapeRings();
        const lowest = Math.min(...rings.map((r) => r.p[1] - groundAt(r.p[0], r.p[2])));
        if (lowest > 0.08 && stripInside(rings, 0.15)) break;
        bendNow *= 0.82;
    }
    const L = rings[rings.length - 1].along;
    const phLeaf = rand() * TAU;
    rings.forEach((r) => {
        r.sway = [sway[0], sway[1], sway[2] * r.sigma ** 1.3, phLeaf + r.sigma * 0.8];
    });
    layStrip(batch, rings, across, [L, id, age, packKind(kind, stalk)]);
    return rings;
}

/**
 * The broad leaves: bananas and bird-of-paradise (paddles on arching petioles, torn along their
 * veins, from a pseudostem), monstera and philodendron low at the bed fronts (hearts on long
 * petioles; a mature monstera's slit and holed), and the planting of the two urns that flank the
 * canal's head — a cascade of sword fern and a few great elephant-ear leaves with pale veins,
 * leaning in over the landing: the foreground frame of the picture's lower corners.
 * Returns { leaves, fronds (the urns' ferns), stems }.
 */
export function buildLeaves(plan, tier) {
    const { segments, sides } = floraDetail(tier);
    const across = 5;
    const leaves = new FloraBatch();
    const fronds = new FloraBatch();
    const stems = new FloraBatch();
    const { soil } = FLOOR.bed;
    const leafSegments = Math.max(6, Math.round(segments * 0.75));

    // The urns first: they are nearest the eye.
    plan.urns.forEach((urn, u) => {
        const rand = mulberry32(9001 + u * 131);
        const side = Math.sign(urn.x);
        const rim = urn.height;
        const id = 4000 + u;
        // The urns stand beside the eye, out of the picture: what they hold leans in to the
        // picture's lower corner, in toward the canal and forward over the landing.
        const toFrame = Math.atan2(-0.62, -side * 0.785);
        const swords = Math.max(12, Math.round(tier.frond * 1.25));
        for (let k = 0; k < swords; k += 1) {
            const heading = (k / swords) * TAU + (rand() - 0.5) * 0.4;
            const facing = Math.max(0, Math.cos(heading - toFrame)); // 1 toward the frame
            const reach = lerp(0.5, 0.75, rand()) + facing * facing * 0.35;
            const pitch0 = lerp(0.85, 1.2, rand()) + facing * 0.12;
            const drop = lerp(0.25, 0.55, rand()) - facing * 0.35;
            const { bend, length } = fitArc(pitch0, reach, drop, 1.6);
            const origin = [urn.x + Math.cos(heading) * 0.14, rim - 0.04, urn.z + Math.sin(heading) * 0.14];
            const roll0 = (rand() - 0.5) * 0.5;
            const rings = spineRings(origin, heading, pitch0, bend, length, leafSegments, {
                gamma: 1.6, curl: (rand() - 0.5) * 0.4, roll: (s) => roll0 * s,
            });
            const L = rings[rings.length - 1].along;
            const stalk = 0.06;
            const widest = lerp(0.09, 0.115, rand()) * (1 + facing * 0.2);
            const phLeaf = rand() * TAU;
            rings.forEach((r) => {
                r.wEnv = fernEnvelope(r.sigma, widest, stalk, 0.35);
                r.wGeom = Math.max(r.wEnv, 0.012);
                r.fold = 0.1 + r.sigma * 0.5;
                r.sway = [0, 0, 0.3 * r.sigma ** 1.5, phLeaf + r.sigma];
            });
            layStrip(fronds, rings, 3, [L, id * 64 + k, rand() * 0.4, packKind(KIND.swordFern, stalk)]);
        }
        // The elephant ears: great dark hearts on tall petioles, leaning in over the landing.
        const ears = tier.frond >= 12 ? 5 : 4;
        for (let k = 0; k < ears; k += 1) {
            const fan = (k / (ears - 1)) - 0.5;
            const heading = toFrame + fan * 1.1 + (rand() - 0.5) * 0.2;
            const near = 1 - Math.abs(fan) * 1.2; // the middle leaves lean furthest in
            const scaleK = lerp(0.9, 1.1, rand());
            broadLeaf(leaves, {
                origin: [urn.x + Math.cos(heading) * 0.06, rim - 0.05, urn.z + Math.sin(heading) * 0.06],
                heading,
                pitch0: lerp(1.05, 0.82, near) + (rand() - 0.5) * 0.08,
                bend: lerp(1.5, 1.9, rand()),
                stalkLen: lerp(0.95, 1.3, near) * scaleK,
                bladeLen: lerp(0.78, 0.98, rand()) * scaleK,
                widest: lerp(0.36, 0.44, rand()) * scaleK,
                shape: 'heart',
                lobe: 0.26,
                fold: 0.3,
                gamma: 2.0,
                roll: (rand() - 0.5) * 0.7 - side * 0.25,
                kind: KIND.alocasia,
                id: id * 64 + 40 + k,
                age: rand() * 0.3,
                segments: leafSegments,
                across,
                sway: [0, 0, 0.35],
                rand,
            });
        }
    });

    // Bananas and bird-of-paradise.
    const bananas = plan.bananas.map((b, i) => ({ b, i })).sort((a, c) => c.b.z - a.b.z);
    bananas.forEach(({ b, i }) => {
        const rand = streamFor(b.seed, 601 + i);
        const id = 3000 + i;
        const strelitzia = b.seed > 0.66;
        const stemH = b.height * (strelitzia ? 0.22 : 0.42);
        const foot = [b.x, soil - 0.1, b.z];
        const top = [b.x + (rand() - 0.5) * 0.12, soil + stemH, b.z + (rand() - 0.5) * 0.12];
        const phPlant = b.seed * 29.7;
        const swayPlant = 0.09;
        const r0 = strelitzia ? 0.045 : lerp(0.075, 0.095, rand());
        layTube(
            stems,
            bezier(foot, add(scale(add(foot, top), 0.5), [0.03, 0, -0.02]), top, 6),
            (sigma) => r0 * (1.3 - 0.5 * sigma),
            Math.max(6, sides - 2),
            (sigma) => [swayPlant * sigma * sigma, phPlant, 0, 0],
            [stemH, id * 64, 0, packKind(KIND.stem)],
        );
        const count = b.leaves + (strelitzia ? 1 : 2);
        for (let k = 0; k < count; k += 1) {
            const rank = k / (count - 1); // 0 the oldest, outermost
            const heading = b.yaw + k * GOLDEN;
            const sz = (b.height / 3) * lerp(0.85, 1.05, rand());
            // Keep the blade inside the house and out of the canal.
            const dirX = Math.cos(heading);
            const bladeLen = (strelitzia ? lerp(0.9, 1.3, rand()) : lerp(1.3, 2.0, rand())) * sz;
            const stalkLen = (strelitzia ? lerp(0.7, 1.1, rand()) : lerp(0.3, 0.5, rand())) * sz;
            let pitch0 = strelitzia ? lerp(1.0, 1.4, rank) : lerp(0.55, 1.35, rank);
            let bend = strelitzia ? lerp(1.1, 0.55, rank) : lerp(2.1, 0.75, rank);
            // A banana's oldest leaf has broken at its petiole and hangs down the stem, dead.
            const broken = !strelitzia && k === 0 && count >= 8;
            if (broken) {
                pitch0 = 0.5;
                bend = 3.2;
            }
            const origin = [top[0], top[1] - 0.12 + rank * 0.18, top[2]];
            // A leaf that would reach the wall or over the canal turns steeper.
            const runOut = (stalkLen + bladeLen) * Math.cos(pitch0 * 0.5);
            const tipX = b.x + dirX * runOut;
            if (Math.abs(tipX) > HOUSE.halfSpan - 0.35 || Math.abs(tipX) < FLOOR.canal.half + 0.2) {
                pitch0 = Math.min(1.45, pitch0 + 0.35);
                bend *= 0.8;
            }
            broadLeaf(leaves, {
                origin,
                heading,
                pitch0,
                bend,
                stalkLen,
                bladeLen,
                widest: (strelitzia ? lerp(0.15, 0.2, rand()) : lerp(0.22, 0.3, rand())) * sz,
                shape: 'paddle',
                fold: strelitzia ? 0.15 : lerp(0.3, 0.6, 1 - rank),
                gamma: broken ? 0.7 : 1.4,
                roll: (rand() - 0.5) * 0.7,
                kind: strelitzia ? KIND.strelitzia : KIND.banana,
                id: id * 64 + k,
                age: broken ? 1 : (1 - rank) * 0.85,
                segments: leafSegments,
                across,
                sway: [swayPlant, phPlant, 0.5 * (bladeLen / 1.6)],
                rand,
            });
        }
    });

    // Monstera and philodendron: the plan's, and clumps crowding the bed fronts near the eye.
    const monsteras = [...plan.monsteras, ...bedFrontClumps(plan, tier)]
        .map((m, i) => ({ m, i }))
        .sort((a, c) => c.m.z - a.m.z);
    monsteras.forEach(({ m, i }) => {
        const rand = streamFor(m.seed, 801 + i);
        const id = 5000 + i;
        const philodendron = m.seed < 0.3;
        for (let k = 0; k < m.leaves; k += 1) {
            const rank = m.leaves > 1 ? k / (m.leaves - 1) : 1;
            const heading = m.yaw + k * GOLDEN;
            const sz = m.scale * lerp(0.8, 1.1, rand()) * lerp(0.75, 1.0, rank);
            const dirX = Math.cos(heading);
            // Leaves facing the path lean out over the kerb; those toward the wall stand taller.
            const outward = -Math.sign(m.x) * dirX;
            broadLeaf(leaves, {
                origin: [m.x + dirX * 0.05, soil + 0.02, m.z + Math.sin(heading) * 0.05],
                heading,
                pitch0: lerp(1.0, 1.35, rank) - Math.max(0, outward) * 0.12,
                bend: lerp(2.0, 2.7, 1 - rank),
                stalkLen: lerp(0.5, 0.95, rank) * sz,
                bladeLen: (philodendron ? lerp(0.48, 0.62, rand()) : lerp(0.55, 0.8, rand())) * sz,
                widest: (philodendron ? lerp(0.2, 0.26, rand()) : lerp(0.3, 0.38, rand())) * sz,
                shape: 'heart',
                lobe: philodendron ? 0.18 : 0.12,
                fold: lerp(0.15, 0.32, rand()),
                gamma: 2.0,
                roll: (rand() - 0.5) * 0.6,
                kind: philodendron ? KIND.philodendron : KIND.monstera,
                id: id * 64 + k,
                age: (1 - rank) * 0.7 + rand() * 0.2,
                segments: leafSegments,
                across,
                sway: [0, 0, 0.25],
                rand,
            });
        }
    });
    return { leaves: leaves.finish(), fronds: fronds.finish(), stems: stems.finish() };
}

// ── Vines and baskets ───────────────────────────────────────────────────────────────────────

/**
 * The vines and the hanging baskets: strands let down from the vault over the beds, a small
 * heart-shaped leaf every hand's breadth along them; and baskets of sword fern hung over the
 * paths on three chains from the vault, a cascade of fronds spilling over the wire.
 * Returns { leaves (the strands and their leaves), fronds (the baskets' ferns), iron (wire,
 * chains and the moss lining) }.
 */
export function buildVines(plan, tier, eye = [0, 2.05, 4.2]) {
    const { segments } = floraDetail(tier);
    const leaves = new FloraBatch();
    const fronds = new FloraBatch();
    const iron = new FloraBatch();
    const spacing = pick(tier.frond, [[16, 0.07], [12, 0.085]], 0.11);

    const vines = plan.vines.map((v, i) => ({ v, i })).sort((a, b) => b.v.z - a.v.z);
    vines.forEach(({ v, i }) => {
        const rand = streamFor(v.seed, 1001 + i);
        const id = 6000 + i;
        for (let s = 0; s < v.strands; s += 1) {
            const ox = (rand() - 0.5) * 0.5;
            const oz = (rand() - 0.5) * 0.7;
            const length = v.length * lerp(0.55, 1.0, rand());
            const anchor = [v.x + ox, v.top + 0.1, v.z + oz];
            const bow = [(rand() - 0.5) * 0.25 - Math.sign(v.x) * 0.1, (rand() - 0.5) * 0.25];
            const phPlant = rand() * TAU;
            const n = Math.max(6, Math.round(length * 3));
            const pointAt = (sigma) => [
                anchor[0] + bow[0] * Math.sin(sigma * Math.PI * 0.8),
                anchor[1] - sigma * length,
                anchor[2] + bow[1] * Math.sin(sigma * Math.PI * 0.8),
            ];
            const swayAt = (sigma) => [0.75 * sigma ** 1.3 * (length / 3), phPlant, 0, 0];
            // The strand: a thin ribbon turned to face the eye.
            const rings = [];
            for (let j = 0; j <= n; j += 1) {
                const sigma = j / n;
                const p = pointAt(sigma);
                const t = normalize(sub(pointAt(Math.min(1, sigma + 0.01)), pointAt(Math.max(0, sigma - 0.01))));
                const toEye = normalize(sub(eye, p));
                const sideV = normalize(cross(t, toEye));
                const up = cross(sideV, t);
                rings.push({
                    p,
                    t,
                    s: sideV,
                    n: up,
                    along: sigma * length,
                    sigma,
                    wGeom: 0.006,
                    wEnv: 0,
                    fold: 0,
                    sway: swayAt(sigma),
                });
            }
            layStrip(leaves, rings, 3, [length, id * 64 + s, 0, packKind(KIND.strand)]);
            // The leaves: alternate sides, each on a short stalk, hanging out and down.
            const count = Math.floor(length / spacing);
            for (let k = 1; k <= count; k += 1) {
                const sigma = clamp((k + (rand() - 0.5) * 0.4) / (count + 0.5), 0.02, 1);
                const p = pointAt(sigma);
                const heading = rand() * TAU;
                const size = lerp(0.055, 0.1, rand()) * (1 - 0.3 * sigma);
                const pitch0 = lerp(-0.2, 0.5, rand());
                const leafRings = spineRings(p, heading, pitch0, lerp(0.7, 1.4, rand()), size * 1.25, 3, {
                    sigmaOf: (j) => [0, 0.2, 0.62, 1][j],
                });
                const stalk = 0.2;
                leafRings.forEach((r) => {
                    const b = (r.sigma - stalk) / (1 - stalk);
                    r.wEnv = size * 0.42;
                    r.wGeom = b < -0.01 ? 0.004 : Math.max(size * 0.42 * (heartEnvelope(b, 0.12) + 0.08), 0.004);
                    r.fold = -0.15;
                    const sw = swayAt(sigma);
                    r.sway = [sw[0], sw[1], 0.03, rand() * TAU];
                });
                const info = [size * 1.25, id * 64 + 8 + (k % 56), rand() * 0.5, packKind(KIND.ivy, stalk)];
                layStrip(leaves, leafRings, 3, info);
            }
        }
    });

    plan.baskets.forEach((b, i) => {
        const rand = streamFor(b.seed, 1201 + i);
        const id = 7000 + i;
        const R = 0.3 * b.scale;
        const centre = [b.x, b.y, b.z];
        const phPlant = rand() * TAU;
        const reachDown = b.top - b.y;
        const swing = 0.16;
        const swayBasket = [swing, phPlant, 0, 0];
        // The wire bowl and its moss lining: two hemispheres (the bowl hangs below the rim).
        const bowl = (radius, kind) => {
            const rings = 6;
            const sides = 14;
            const base = iron.vertexCount;
            for (let r = 0; r <= rings; r += 1) {
                const phi = (r / rings) * (Math.PI / 2); // 0 at the rim, π/2 at the bottom
                for (let j = 0; j <= sides; j += 1) {
                    const th = (j / sides) * TAU;
                    const nrm = [Math.cos(th) * Math.cos(phi), -Math.sin(phi), Math.sin(th) * Math.cos(phi)];
                    iron.vertex(
                        addScaled(centre, nrm, radius),
                        [j / sides, r / rings, radius, phi],
                        swayBasket,
                        [R, id * 64, 0, packKind(kind)],
                        nrm,
                    );
                }
            }
            const w = sides + 1;
            for (let r = 0; r < rings; r += 1) {
                for (let j = 0; j < sides; j += 1) {
                    const a = base + r * w + j;
                    // Outward: round × down.
                    iron.quad(a, a + 1, a + w, a + w + 1);
                }
            }
        };
        bowl(R, KIND.wire);
        bowl(R * 0.93, KIND.moss);
        // Three chains from the rim up to the hook.
        const hook = [b.x, b.top, b.z];
        const phase0 = rand() * TAU;
        for (let c = 0; c < 3; c += 1) {
            const th = phase0 + (c / 3) * TAU;
            const from = [b.x + Math.cos(th) * R, b.y + 0.01, b.z + Math.sin(th) * R];
            const n = 6;
            const rings = [];
            for (let j = 0; j <= n; j += 1) {
                const sigma = j / n;
                const p = add(from, scale(sub(hook, from), sigma));
                const t = normalize(sub(hook, from));
                const toEye = normalize(sub(eye, p));
                const sideV = normalize(cross(t, toEye));
                rings.push({
                    p,
                    t,
                    s: sideV,
                    n: cross(sideV, t),
                    along: sigma * len(sub(hook, from)),
                    sigma,
                    wGeom: 0.011,
                    wEnv: 0,
                    fold: 0,
                    sway: [swing * (1 - sigma), phPlant, 0, 0],
                });
            }
            layStrip(iron, rings, 3, [reachDown, id * 64 + 1 + c, 0, packKind(KIND.chain)]);
        }
        // The fern: a cascade over the rim, a few long fronds hanging straight down.
        const count = Math.max(10, Math.round(tier.frond * 1.0));
        for (let k = 0; k < count; k += 1) {
            const heading = (k / count) * TAU + (rand() - 0.5) * 0.4;
            const long = rand() < 0.3;
            const reach = (long ? lerp(0.32, 0.45, rand()) : lerp(0.35, 0.6, rand())) * b.scale;
            const drop = (long ? lerp(0.9, 1.3, rand()) : lerp(0.35, 0.75, rand())) * b.scale;
            const pitch0 = lerp(0.5, 1.0, rand());
            const { bend, length } = fitArc(pitch0, reach, drop, 1.6);
            const origin = [b.x + Math.cos(heading) * R * 0.5, b.y + 0.04, b.z + Math.sin(heading) * R * 0.5];
            const roll0 = (rand() - 0.5) * 0.4;
            const rings = spineRings(origin, heading, pitch0, bend, length, Math.max(6, Math.round(segments * 0.7)), {
                gamma: 1.6, curl: (rand() - 0.5) * 0.5, roll: (s) => roll0 * s,
            });
            const L = rings[rings.length - 1].along;
            const stalk = 0.06;
            const widest = lerp(0.055, 0.075, rand()) * b.scale;
            const phLeaf = rand() * TAU;
            rings.forEach((r) => {
                r.wEnv = fernEnvelope(r.sigma, widest, stalk, 0.32);
                r.wGeom = Math.max(r.wEnv, 0.01);
                r.fold = 0.1 + r.sigma * 0.45;
                r.sway = [swing, phPlant, 0.3 * r.sigma ** 1.5, phLeaf + r.sigma];
            });
            layStrip(fronds, rings, 3, [L, id * 64 + 8 + k, rand() * 0.4, packKind(KIND.swordFern, stalk)]);
        }
    });
    return { leaves: leaves.finish(), fronds: fronds.finish(), iron: iron.finish() };
}
