/**
 * Spring — the valley's ground (CPU only, three-free).
 *
 * One height function from the river's plan: the bed under the water, the banks, the granite
 * step the fall pours over at the head of a short gorge, the meadows and the forested slopes
 * rising either side, the wooded tongue between the river's two arms, the knoll under the eye,
 * and the fells closing the valley far off. It is baked once into three grids (the near valley
 * at a metre and a quarter, the river's way down the valley at ~6 m, the far country at ~86 m)
 * that the land mesh, the trees, the flowers and the rocks all read, so everything stands on
 * the same ground.
 */
import {
    clamp, lerp, smooth,
} from './spring-core.js';
import {
    EYE, EYE_GROUND, S_LIP, S_POOL, courseAt, depthAt, levelAt, riverNearest,
} from './spring-plan.js';

// ── Noise (deterministic, CPU) ────────────────────────────────────────────────────

function hash(ix, iz, seed) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x, z, seed = 0) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = hash(ix, iz, seed);
    const b = hash(ix + 1, iz, seed);
    const c = hash(ix, iz + 1, seed);
    const d = hash(ix + 1, iz + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

/** Fractal sum, roughly in [−1, 1]. */
export function fbm(x, z, octaves = 4, seed = 0) {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * (valueNoise(x * f, z * f, seed + o * 17) * 2 - 1);
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return sum / norm;
}

/** Ridged fractal in [0, 1]: sharp crests, rounded hollows (the fells' shoulders). */
export function ridged(x, z, octaves = 5, seed = 0) {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
        let v = 1 - Math.abs(valueNoise(x * f, z * f, seed + o * 31) * 2 - 1);
        v *= v;
        v *= weight;
        weight = clamp(v * 1.6, 0, 1);
        sum += amp * v;
        norm += amp;
        amp *= 0.5;
        f *= 2.1;
    }
    return sum / norm;
}

// ── The height function ──────────────────────────────────────────────────────────

/**
 * The ground either side of a reach, by bank: `bank` the lip of soil over the water, a meadow
 * `meadow` metres wide rising `meadowRise` per metre, then the valley side rising toward
 * `wallTop` (steepness `wall`). The outer bank (the river's right as it runs: the fall's side of
 * the upper reach, the knoll, the far side of the river leaving right) is steeper than the inner
 * one (the wooded tongue between the arms); the river above the fall lies in a shallow valley.
 */
const BANKS = Object.freeze({
    outer: Object.freeze({
        bank: 1.2, meadow: 30, meadowRise: 0.14, wall: 0.45, wallTop: 110,
    }),
    inner: Object.freeze({
        bank: 1.0, meadow: 16, meadowRise: 0.1, wall: 0.34, wallTop: 30,
    }),
    upper: Object.freeze({
        bank: 0.8, meadow: 70, meadowRise: 0.05, wall: 0.25, wallTop: 60,
    }),
    /**
     * Beside the lip the river has cut its notch: rock shoulders rise either side of it (lower on
     * the river's right, the eye's left, where the evening sun goes down behind them).
     */
    notchRight: Object.freeze({
        bank: 1.4, meadow: 3, meadowRise: 0.3, wall: 0.6, wallTop: 7,
    }),
    notchLeft: Object.freeze({
        bank: 1.6, meadow: 2.5, meadowRise: 0.3, wall: 0.85, wallTop: 11,
    }),
    /** Both sides of the short gorge below the fall: steep wooded slopes climbing to the plateau. */
    gorge: Object.freeze({
        bank: 1.2, meadow: 2, meadowRise: 0.3, wall: 1.7, wallTop: 32,
    }),
});

/**
 * Where the gorge below the fall opens into the valley: metres from the plunge pool's middle
 * (from, to). Measured from a point, not along the river, so the walls never jump where the
 * nearest water changes from the pool to the river leaving right.
 */
const GORGE_OPENS = Object.freeze([34, 62]);

/**
 * The granite step the river falls over: within `span` metres of the river above it (fading over
 * `fade`) the valley below the fall does not reach upstream of the step. The ground's own drop
 * lies well behind the lip (`from` … `to` metres along the river from it), hidden behind the
 * step's sculpted face (spring-fall.js), which stands in front of it and caps it.
 */
export const STEP = Object.freeze({
    span: 22, fade: 22, from: -10, to: -7.5,
});
/** The notch's shoulders reach this far up the river from the lip (m: fully, then fading out). */
const NOTCH = Object.freeze([25, 110]);

/**
 * The knoll the eye stands on: a granite dome on the outside of the bend. Its top is an ellipse
 * (radii `rx`, `rz`, centred `back` metres behind the eye) whose front edge stands about eleven
 * metres ahead of the eye; beyond the edge it drops steeply to the water swinging round under it.
 */
export const KNOLL = Object.freeze({
    rx: 17, rz: 13, back: 2, slope: 1.15,
});

/** The fells: how far out they begin and how high they rise over the valley. */
const FELLS = Object.freeze({
    near: 3000, full: 7000, height: 1300, scale: 3600,
});

const upHit = {};
const downHit = {};
const LIP = courseAt(S_LIP, {});
const POOL = courseAt(S_POOL + 8, {});

/** The ground above the water at e metres from the water's edge of a reach (bank, meadow, wall). */
function bankRise(level, e, side) {
    let h = level + side.bank * smooth(0, 4, e);
    h += side.meadowRise * Math.min(e, side.meadow);
    const wallE = Math.max(0, e - side.meadow);
    return h + side.wallTop * (1 - Math.exp(-(wallE * side.wall) / side.wallTop));
}

/** The bed under the water at a reach point (rounded, deepest mid-stream, rough). */
function bedAt(x, z, r, level) {
    const f = clamp(Math.abs(r.n) / r.halfWidth, 0, 1);
    const bed = level - depthAt(r.s) * (1 - f * f) ** 0.6 - 0.15;
    return bed + 0.6 * (valueNoise(x * 0.35, z * 0.35, 3) - 0.5) * (1 - f);
}

/** How far (m) a point lies outside the knoll's top (negative inside), its rim made uneven. */
export function knollOutside(x, z) {
    const dx = (x - EYE.x) / KNOLL.rx;
    const dz = (z - EYE.z - KNOLL.back) / KNOLL.rz;
    const a = Math.atan2(dz, dx);
    const rim = 1 + 0.07 * Math.sin(a * 5 + 1.3) + 0.045 * Math.sin(a * 11 + 0.4);
    return (Math.hypot(dx, dz) - rim) * Math.min(KNOLL.rx, KNOLL.rz);
}

/**
 * One reach's ground at (x, z): the bed under its water, its banks rising beyond, hills away.
 * `gorge` (0..1) turns both banks into the gorge's walls.
 */
function reachGround(x, z, r, level, inner, outer, gorge = 0) {
    const e = Math.abs(r.n) - r.halfWidth;
    if (e < 0) return bedAt(x, z, r, level);
    let h = bankRise(level, e, r.n >= 0 ? outer : inner);
    if (gorge > 0) h = lerp(h, bankRise(level, e, BANKS.gorge), gorge);
    // Hills and hummocks, quiet near the water.
    h += 26 * fbm(x / 210, z / 210, 4, 11) * smooth(12, 220, e);
    h += 3.2 * fbm(x / 38, z / 38, 3, 23) * smooth(3, 40, e);
    h += 0.7 * fbm(x / 7, z / 7, 2, 29) * smooth(1, 10, e);
    return h;
}

/** Smooth minimum (polynomial, blend width k metres). */
function smin(a, b, k) {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return lerp(b, a, h) - k * h * (1 - h);
}

/**
 * The ground's height at (x, z) (m), before any baking. The river above the fall and the river
 * below it each carve their own valley; the ground is the lower of the two, except that the
 * valley below does not reach upstream past the lip's line near the river above, so the river
 * falls over a granite step there. The knoll under the eye, and the fells far off. `out`
 * (optional) receives the distance from the nearest water's edge (`edge`, m, negative under
 * water) and that water's level (`level`).
 */
export function terrainHeight(x, z, out = null) {
    const up = riverNearest(x, z, upHit, 0, S_LIP);
    const down = riverNearest(x, z, downHit, S_POOL, Infinity);
    const upLevel = levelAt(up.s);
    const downLevel = levelAt(down.s);
    const eUp = Math.abs(up.n) - up.halfWidth;
    const eDown = Math.abs(down.n) - down.halfWidth;
    let U = reachGround(x, z, up, upLevel, BANKS.upper, BANKS.upper);
    // Near the lip the banks are the notch's rock shoulders.
    const notch = 1 - smooth(NOTCH[0], NOTCH[1], S_LIP - up.s);
    if (notch > 0) U = lerp(U, reachGround(x, z, up, upLevel, BANKS.notchLeft, BANKS.notchRight), notch);
    const gorge = 1 - smooth(GORGE_OPENS[0], GORGE_OPENS[1], Math.hypot(x - POOL.x, z - POOL.z));
    const D = reachGround(x, z, down, downLevel, BANKS.inner, BANKS.outer, gorge);
    let h = smin(U, D, 4);
    // The step: upstream of the step's line, near the river above, the ground stays the upper
    // valley's (its drop hidden behind the step's own face).
    const along = (x - LIP.x) * LIP.tx + (z - LIP.z) * LIP.tz;
    const block = (1 - smooth(STEP.from, STEP.to, along)) * (1 - smooth(STEP.span, STEP.span + STEP.fade, up.dist));
    if (block > 0 && U > h) h = lerp(h, U, block);
    // Which valley holds the point decides the water it is measured from.
    const upHolds = U < D || block > 0.5;
    if (out) {
        out.edge = upHolds ? eUp : eDown;
        out.level = upHolds ? upLevel : downLevel;
    }
    // The knoll under the eye: a granite dome on the outside of the bend, dropping to the water.
    const outside = knollOutside(x, z);
    if (outside < 30) {
        const r2 = ((x - EYE.x) / KNOLL.rx) ** 2 + ((z - EYE.z - KNOLL.back) / KNOLL.rz) ** 2;
        const top = EYE_GROUND + 0.3 * fbm(x / 5, z / 5, 2, 31) - 0.9 * Math.min(r2, 1.4);
        const shoulder = top - KNOLL.slope * Math.max(0, outside) ** 1.15
            + 0.45 * fbm(x / 2.5, z / 2.5, 2, 37) * smooth(0, 1.5, outside);
        h = Math.max(h, lerp(h, shoulder, smooth(26, 8, outside)));
    }
    // The fells far off: rounded massifs with ridged shoulders.
    const far = Math.hypot(x - EYE.x, z - EYE.z);
    const rise = smooth(FELLS.near, FELLS.full, far);
    if (rise > 0) {
        const massif = ridged(x / FELLS.scale + 3.7, z / FELLS.scale - 1.3, 5, 41);
        h += rise * FELLS.height * (0.35 + 0.65 * massif) * (0.6 + 0.4 * valueNoise(x / 9000, z / 9000, 43));
    }
    return h;
}

// ── The bake ──────────────────────────────────────────────────────────────────────

/** The three grids: the near valley, the river's way down the valley, the far country (square, metres). */
export const GRIDS = Object.freeze({
    near: Object.freeze({
        x0: -330, z0: -590, size: 660, res: 528,
    }),
    /** The river leaving down the valley and the slopes round it, out to three kilometres. */
    mid: Object.freeze({
        x0: -1500, z0: -2900, size: 3000, res: 512,
    }),
    far: Object.freeze({
        x0: -22000, z0: -40000, size: 44000, res: 512,
    }),
});

function bakeGrid(spec, layers = false) {
    const { res } = spec;
    const h = new Float32Array(res * res);
    const edge = layers ? new Float32Array(res * res) : null;
    const level = layers ? new Float32Array(res * res) : null;
    const step = spec.size / (res - 1);
    const info = {};
    for (let j = 0; j < res; j++) {
        const z = spec.z0 + j * step;
        for (let i = 0; i < res; i++) {
            const k = j * res + i;
            h[k] = terrainHeight(spec.x0 + i * step, z, info);
            if (layers) {
                edge[k] = info.edge;
                level[k] = info.level;
            }
        }
    }
    return {
        ...spec, step, h, edge, level,
    };
}

/** Bake the grids (synchronous). The near and mid grids also keep each point's water edge and level. */
export function bakeTerrain() {
    return {
        near: bakeGrid(GRIDS.near, true),
        mid: bakeGrid(GRIDS.mid, true),
        far: bakeGrid(GRIDS.far, false),
    };
}

// ── The baked valley as an asset ──────────────────────────────────────────────────

/**
 * The bake shipped as one file (scripts/spring/bake-valley.mjs writes assets/spring-valley.bin;
 * the theme reads it instead of baking at start): every layer quantised to sixteen bits over its
 * own range, each row stored as differences from its left neighbour (smooth ground compresses
 * well), the whole deflated (zlib). This is the inside, before deflating: a little-endian Uint32
 * header length, the header as JSON, then the layers in the header's order.
 */
export const VALLEY_SCHEMA = 1;
const LAYERS = Object.freeze([
    ['near', 'h'], ['near', 'edge'], ['near', 'level'],
    ['mid', 'h'], ['mid', 'edge'], ['mid', 'level'],
    ['far', 'h'],
]);
/** Edge distances are kept within this range (beyond it nothing reads them). */
const EDGE_RANGE = Object.freeze([-80, 3000]);

/** The bake as bytes (not yet deflated). */
export function encodeValley(baked) {
    const layers = [];
    for (const [grid, key] of LAYERS) {
        const src = baked[grid][key];
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < src.length; i++) {
            const v = key === 'edge' ? clamp(src[i], EDGE_RANGE[0], EDGE_RANGE[1]) : src[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        layers.push({
            grid, key, lo, hi, count: src.length,
        });
    }
    const grids = Object.fromEntries(['near', 'mid', 'far'].map((name) => {
        const {
            x0, z0, size, res,
        } = baked[name];
        return [name, {
            x0, z0, size, res,
        }];
    }));
    const header = new TextEncoder().encode(JSON.stringify({ schema: VALLEY_SCHEMA, grids, layers }));
    const total = layers.reduce((n, l) => n + l.count, 0);
    const bytes = new Uint8Array(4 + header.length + total * 2);
    new DataView(bytes.buffer).setUint32(0, header.length, true);
    bytes.set(header, 4);
    let o = 4 + header.length;
    for (const layer of layers) {
        const src = baked[layer.grid][layer.key];
        const { res } = baked[layer.grid];
        const scale = 65535 / Math.max(1e-6, layer.hi - layer.lo);
        for (let j = 0; j < res; j++) {
            let previous = 0;
            for (let i = 0; i < res; i++) {
                const value = src[j * res + i];
                const raw = layer.key === 'edge' ? clamp(value, EDGE_RANGE[0], EDGE_RANGE[1]) : value;
                const q = Math.round((raw - layer.lo) * scale);
                const delta = (q - previous) & 0xffff;
                previous = q;
                bytes[o] = delta & 255;
                bytes[o + 1] = delta >> 8;
                o += 2;
            }
        }
    }
    return bytes;
}

/** The bake from its bytes (already inflated): the same shape bakeTerrain returns. */
export function decodeValley(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = view.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
    if (header.schema !== VALLEY_SCHEMA) {
        throw new Error(`[Spring] valley schema ${header.schema}; expected ${VALLEY_SCHEMA}`);
    }
    const out = {};
    for (const [name, spec] of Object.entries(header.grids)) {
        const n = spec.res * spec.res;
        out[name] = {
            ...spec, step: spec.size / (spec.res - 1), h: new Float32Array(n), edge: null, level: null,
        };
    }
    let o = 4 + headerLength;
    for (const layer of header.layers) {
        const grid = out[layer.grid];
        const { res } = grid;
        const dst = new Float32Array(layer.count);
        const scale = (layer.hi - layer.lo) / 65535;
        for (let j = 0; j < res; j++) {
            let q = 0;
            for (let i = 0; i < res; i++) {
                q = (q + (bytes[o] | (bytes[o + 1] << 8))) & 0xffff;
                o += 2;
                dst[j * res + i] = layer.lo + q * scale;
            }
        }
        grid[layer.key] = dst;
    }
    return out;
}

function sampleGrid(g, x, z, layer = g.h) {
    const fx = clamp((x - g.x0) / g.step, 0, g.res - 1.0001);
    const fz = clamp((z - g.z0) / g.step, 0, g.res - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const r = g.res;
    const a = layer[j * r + i];
    const b = layer[j * r + i + 1];
    const c = layer[(j + 1) * r + i];
    const d = layer[(j + 1) * r + i + 1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** How much of the near grid's say a point has (fades out over its last 40 m). */
function nearShare(g, x, z) {
    const m = 40;
    const dx = Math.min(x - g.x0, g.x0 + g.size - x);
    const dz = Math.min(z - g.z0, g.z0 + g.size - z);
    return smooth(0, m, Math.min(dx, dz));
}

/** The baked ground's height at (x, z): the finest grid that reaches, blended over its margin. */
export function groundHeight(baked, x, z) {
    const k = nearShare(baked.near, x, z);
    if (k >= 1) return sampleGrid(baked.near, x, z);
    const m = nearShare(baked.mid, x, z);
    let h = sampleGrid(baked.far, x, z);
    if (m > 0) h = lerp(h, sampleGrid(baked.mid, x, z), m);
    return k > 0 ? lerp(h, sampleGrid(baked.near, x, z), k) : h;
}

/** The baked ground's normal at (x, z) (unit, y up), by central differences `d` metres apart. */
export function groundNormal(baked, x, z, out = [0, 1, 0], d = 0.8) {
    const hx = groundHeight(baked, x + d, z) - groundHeight(baked, x - d, z);
    const hz = groundHeight(baked, x, z + d) - groundHeight(baked, x, z - d);
    const nx = -hx;
    const ny = 2 * d;
    const nz = -hz;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l;
    out[1] = ny / l;
    out[2] = nz / l;
    return out;
}

const inGrid = (g, x, z) => x > g.x0 && z > g.z0 && x < g.x0 + g.size && z < g.z0 + g.size;

/**
 * The water edge distance (m, negative under water) and water level at (x, z) from the finest
 * grid that keeps them (near, then mid), or far from the river (outside both) a large distance.
 */
export function waterEdge(baked, x, z, out = {}) {
    let g = null;
    if (inGrid(baked.near, x, z)) g = baked.near;
    else if (baked.mid?.edge && inGrid(baked.mid, x, z)) g = baked.mid;
    out.edge = g ? sampleGrid(g, x, z, g.edge) : 1000;
    out.level = g ? sampleGrid(g, x, z, g.level) : 0;
    return out;
}

// ── What grows where ──────────────────────────────────────────────────────────────

/** The barn's meadow stays open round it (m). */
const BARN_CLEARING = 70;

/**
 * How much the ground at (x, z) belongs to the steep woods round the fall (0..1): the gorge's
 * slopes below it and the rim beside and above its lip, where the spruce grows to the edge and
 * on slopes steeper than elsewhere.
 */
export function steepWoods(x, z) {
    const gorge = 1 - smooth(GORGE_OPENS[0], GORGE_OPENS[1], Math.hypot(x - POOL.x, z - POOL.z));
    const rim = 1 - smooth(45, 95, Math.hypot(x - LIP.x, z - LIP.z));
    return Math.max(gorge, rim);
}

/** The least upward share of a slope's normal a tree will stand on at (x, z). */
export const standable = (x, z) => 0.66 - 0.16 * steepWoods(x, z);
/** Where the forest thins out on the fells (m): the spruce stops first, then the birch. */
export const TREELINE = Object.freeze({ spruce: 380, birch: 540 });

/**
 * How much of the ground at (x, z) is under forest (0 open … 1 closed canopy), given its water
 * edge distance and height: open meadows along the river, clearings in the woods, the barn's
 * meadow, and the treeline on the fells. `clearings: false` leaves the woods' clearings out (the
 * far canopy, whose bogs the land's material draws at its own scale).
 */
export function forestCover(x, z, edge, h, barn = null, { clearings = true } = {}) {
    if (edge < 2) return 0;
    // Nothing grows in the step's own face or under its cap (spring-fall.js draws the rock there).
    const along = (x - LIP.x) * LIP.tx + (z - LIP.z) * LIP.tz;
    const across = (x - LIP.x) * -LIP.tz + (z - LIP.z) * LIP.tx;
    if (along > -12.5 && along < 2 && Math.abs(across) < 47) return 0;
    // Open ground along the water: a strip of meadow, wider where the noise clears it; round the
    // fall the spruce comes down the gorge's slopes nearly to the water, and stands at the brink.
    const tight = steepWoods(x, z);
    const strip = (6 + 26 * valueNoise(x / 120, z / 120, 49)) * (1 - tight) + 3 * tight;
    const meadow = 1 - smooth(strip, strip + 18, edge);
    const clearing = clearings ? smooth(0.6, 0.72, valueNoise(x / 170, z / 170, 51)) * (1 - tight) : 0;
    let cover = (1 - meadow) * (1 - clearing);
    // The knoll's top is a flowering meadow.
    cover *= smooth(2, 9, knollOutside(x, z));
    if (barn) cover *= smooth(BARN_CLEARING * 0.6, BARN_CLEARING, Math.hypot(x - barn.x, z - barn.z));
    cover *= 1 - smooth(TREELINE.spruce, TREELINE.birch, h);
    return clamp(cover, 0, 1);
}

/** The birch's share of the trees at (x, z): by the meadows' edges, and toward the treeline. */
export function birchShare(x, z, edge, h) {
    // Spruce holds the slopes; birches gather at the meadows' and the water's edges, in drifts,
    // and toward the treeline.
    const b = 0.12 + 0.42 * (1 - smooth(30, 160, edge)) + 0.7 * smooth(300, 440, h)
        + 0.55 * (valueNoise(x / 90, z / 90, 57) - 0.5);
    return clamp(b, 0, 1);
}
