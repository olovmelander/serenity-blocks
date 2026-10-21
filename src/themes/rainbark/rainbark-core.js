/**
 * Rainbark core: three-free constants and maths shared by the world, the director, the
 * playground effect and the unit tests. Nothing here touches the DOM, the bus or a renderer.
 */

/** Piece shape → integer bark code (the girdle and shadow-well encoding). 7 = old husk / unknown. */
export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});

/** Bark age of each piece code (0 fresh First Skin … 1 old husk): the ramp stop it wears. */
export const PIECE_AGE = Object.freeze([0.0, 0.12, 0.26, 0.38, 0.52, 0.66, 0.79, 0.95]);

/**
 * The bark age ramp, age → sRGB hex. Lightness is deliberately non-monotonic. Past the ember the
 * bark weathers through rust and maroon to a cool slate: old bark is the blue-grey matrix the
 * jewels sit in, so the trunks read as blue-grey pillars streaked with colour, never as brown
 * trees. Stops 0–6 are the seven piece colours (pieces read the ramp exactly at PIECE_AGE).
 */
export const RAMP_STOPS = Object.freeze([
    [0.0, '#C2F23D'], // First Skin (I)
    [0.12, '#2BCB72'], // Young Emerald (T)
    [0.26, '#1A93AC'], // Glaucous Teal (Z)
    [0.38, '#2F4CC0'], // Cobalt Bark (L)
    [0.52, '#B98AF2'], // Bloom Violet (S)
    [0.66, '#D23468'], // Ruby Bark (J)
    [0.79, '#F07A2A'], // Ember Bark (O)
    [0.84, '#B04C2E'], // Rust
    [0.885, '#7A3A3C'], // Husk Maroon
    [0.93, '#5E6573'], // Weathered Slate
    [1.0, '#56616F'], // Old Slate (the matrix)
]);

/** Piece shape key → code, tolerant of lower case and unknown input. */
export function pieceCode(shape) {
    if (typeof shape !== 'string') return PIECE_CODE.GARBAGE;
    const key = shape.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(PIECE_CODE, key) ? PIECE_CODE[key] : PIECE_CODE.GARBAGE;
}

/**
 * A piece matrix as 4 cell offsets (8 numbers, x right, y up), centred on its bounding box.
 * Returns null for anything that is not a matrix with at least one filled cell.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length && c < 8; c++) {
            if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
        }
    }
    if (!cells.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i += 2) {
        minX = Math.min(minX, cells[i]);
        maxX = Math.max(maxX, cells[i]);
        minY = Math.min(minY, cells[i + 1]);
        maxY = Math.max(maxY, cells[i + 1]);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const out = new Array(8);
    for (let i = 0; i < 8; i += 2) {
        const j = i < cells.length ? i : 0;
        out[i] = cells[j] - cx;
        out[i + 1] = cells[j + 1] - cy;
    }
    return out;
}

/** Fraction of the way to a target after dt at an exponential rate. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges (0 when the edges are equal or reversed and v is below lo). */
export function smooth(lo, hi, v) {
    if (hi === lo) return v < lo ? 0 : 1;
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Small, fast, deterministic PRNG (returns a function giving floats in [0, 1)). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/** Ken Perlin's smootherstep on 0..1 (the Climb's ease). */
export function smoother(t) {
    const x = clamp01(t);
    return x * x * x * (x * (x * 6 - 15) + 10);
}

/** The pieces in their spawn orientation (the game's own matrices). */
export const SHAPES = Object.freeze({
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
});
export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

// ── Colour ──────────────────────────────────────────────────────────────────────

const srgbChannelToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** An sRGB hex ('#RRGGBB') as linear RGB in 0..1 (black for anything else). */
export function hexToLinear(hex, out = [0, 0, 0]) {
    const m = typeof hex === 'string' ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
    if (!m) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return out;
    }
    const n = parseInt(m[1], 16);
    out[0] = srgbChannelToLinear(((n >> 16) & 255) / 255);
    out[1] = srgbChannelToLinear(((n >> 8) & 255) / 255);
    out[2] = srgbChannelToLinear((n & 255) / 255);
    return out;
}

const RAMP_LINEAR = RAMP_STOPS.map(([age, hex]) => [age, hexToLinear(hex)]);

/** The bark at an age (0..1, clamped), interpolated in linear light between the ramp stops. */
export function rampAt(age, out = [0, 0, 0]) {
    const a = clamp01(Number.isFinite(age) ? age : 1);
    let i = 0;
    while (i < RAMP_LINEAR.length - 2 && a > RAMP_LINEAR[i + 1][0]) i += 1;
    const [a0, c0] = RAMP_LINEAR[i];
    const [a1, c1] = RAMP_LINEAR[i + 1];
    const k = a1 > a0 ? clamp01((a - a0) / (a1 - a0)) : 0;
    for (let c = 0; c < 3; c++) out[c] = c0[c] + (c1[c] - c0[c]) * k;
    return out;
}

// ── The bark ────────────────────────────────────────────────────────────────────

/** One tile of bark space (metres around × up): the patch atlas covers exactly one. */
export const BARK_TILE = Object.freeze({ around: 4.8, up: 14 });
/** Metres of edge distance that map to the full range of the atlas's G channel (either sign). */
export const PATCH_EDGE_RANGE = 0.25;
/** The offset between two z-slices of the noise lattice (the classic 37, 17). */
export const LATTICE_SLICE = Object.freeze([37, 17]);

/**
 * How the bark's colour sits in the ramp at rest: ambient patches show this share of the ramp's
 * chroma (mixed toward their luma), times the dry albedo. Gameplay bands use the full colour.
 */
export const BARK_CHROMA = 0.78;
export const BARK_ALBEDO = 0.82;
/**
 * The rare middle of the ramp (teal, cobalt, violet, ruby) is worn more muted still, and a little
 * darker: chroma BARK_CHROMA − mute and albedo × dim between `from` and `to` (ramped in and out
 * over `ramp`), so the accents read as dusky jewels among the lime and ember instead of candy.
 */
export const BARK_ACCENT = Object.freeze({
    mute: 0.32, dim: 0.85, from: 0.24, to: 0.68, ramp: 0.08,
});
/**
 * Fresh ambient bark is dimmed in value (to this share of its albedo, fading out from age `from`
 * to `to`) but keeps more of the ramp's chroma (`chroma`, fading back to BARK_CHROMA likewise): at
 * full value First Skin is a highlighter; in the photographs it is a deep satin lime-green (hue
 * about 120°, never mint).
 */
export const BARK_FRESH_DIM = Object.freeze({
    k: 0.68, chroma: 0.92, from: 0.08, to: 0.2,
});
/** The old bark between the patches (the matrix): its mean age, and how far it wanders. */
export const MATRIX_AGE = 0.965;
/**
 * The pale old-skin islands in the matrix: the first ATLAS_ISLANDS regions of the patch atlas
 * (laid first, under every ribbon). They never cycle; they sit a touch older than the matrix (so
 * their lips lift over it) and this much lighter.
 */
export const ATLAS_ISLANDS = 10;
/** The ribbons of one atlas tile (laid after the islands: ids ATLAS_ISLANDS + 1 …). */
export const ATLAS_RIBBONS = 22;
/**
 * The step between consecutive ribbons in the order their places in a tile's cycle are dealt
 * (coprime to ATLAS_RIBBONS, so ribbons side by side never stand side by side in the cycle).
 */
export const RIBBON_PHASE_STEP = 7;

/** CIELAB chroma (C*) of a linear rgb colour (D65). */
export function labChroma(rgb) {
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * rgb[0] + 0.3576 * rgb[1] + 0.1805 * rgb[2]) / 0.95047);
    const y = f(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
    const z = f((0.0193 * rgb[0] + 0.1192 * rgb[1] + 0.9505 * rgb[2]) / 1.08883);
    return Math.hypot(500 * (x - y), 200 * (y - z));
}

/**
 * Where a ribbon's cycle is vivid (its ambient bark a jewel: C* over `chroma`) at the grove's
 * resting bias, in `bins` steps of its phase; and how many moments round a tile's cycle the
 * ribbons' places are judged at (ribbonPhases).
 */
export const VIVID = Object.freeze({
    chroma: 25, bias: 0.4, bins: 128, turns: 48,
});
let vividCycle = null;
const vividScratch = [0, 0, 0];
/** The vivid share of each step of a ribbon's cycle (VIVID), found once. */
export function vividOfCycle() {
    if (!vividCycle) {
        vividCycle = new Uint8Array(VIVID.bins);
        for (let i = 0; i < VIVID.bins; i++) {
            barkAlbedo(ageOfPhase(warpAge((i + 0.5) / VIVID.bins, VIVID.bias)), vividScratch);
            vividCycle[i] = labChroma(vividScratch) > VIVID.chroma ? 1 : 0;
        }
    }
    return vividCycle;
}

/** The share of `areas`' total that is vivid when the ribbons at `phases` have turned `turn` round. */
export function vividShare(phases, areas, turn) {
    const vivid = vividOfCycle();
    let lit = 0;
    let total = 0;
    for (let k = 0; k < phases.length; k++) {
        const p = (((phases[k] + turn) % 1) + 1) % 1;
        if (vivid[Math.min(VIVID.bins - 1, Math.floor(p * VIVID.bins))]) lit += areas[k];
        total += areas[k];
    }
    return total > 0 ? lit / total : 0;
}

/** Places round the cycle for ribbons dealt in `order`, each at the middle of its area's share. */
function placesFor(order, w, total, out) {
    let at = 0;
    for (let j = 0; j < order.length; j++) {
        const k = order[j];
        out[k] = (at + w[k] / 2) / total;
        at += w[k];
    }
    return out;
}

/**
 * How far the vivid share of ribbons at `places` swings over a whole cycle (max − min, exactly:
 * the share only changes where a ribbon crosses an edge of the vivid part of its cycle).
 */
function vividSwing(places, w, total) {
    const vivid = vividOfCycle();
    const { bins } = VIVID;
    let worst = 0;
    // Judged at every turn where some ribbon stands on an edge of the vivid part, just after it.
    for (let k = 0; k < places.length; k++) {
        for (let e = 0; e < bins; e++) {
            if (vivid[e] === vivid[(e + bins - 1) % bins]) continue;
            const turn = e / bins - places[k] + 0.5 / (bins * 8);
            let lit = 0;
            for (let j = 0; j < places.length; j++) {
                const p = (((places[j] + turn) % 1) + 1) % 1;
                if (vivid[Math.min(bins - 1, Math.floor(p * bins))]) lit += w[j];
            }
            const share = lit / total;
            if (worst === 0) {
                vividSwing.lo = share;
                vividSwing.hi = share;
            }
            vividSwing.lo = Math.min(vividSwing.lo, share);
            vividSwing.hi = Math.max(vividSwing.hi, share);
            worst = 1;
        }
    }
    return worst ? vividSwing.hi - vividSwing.lo : 0;
}

/**
 * Each ribbon's place in its tile's cycle (0 … 1), spread by AREA (§3.4's jewel share, the A1
 * review): every ribbon of a tile runs the same life, so the area-weighted ages of a tile at any
 * moment are its ribbons' places turned round the cycle. Each ribbon stands at the middle of its
 * own share of the cycle, as wide as its share of the ribbons' area, dealt first in the order
 * k · RIBBON_PHASE_STEP (ribbons side by side never stand side by side in the cycle), then that
 * order refined by swaps while the vivid share's swing round the cycle (vividShare) shrinks: big
 * ribbons come to stand where one leaves the vivid part of the cycle as another enters it, so the
 * vivid area of a tile holds steady whichever big ribbons happen to be young. Deterministic.
 * `areas` lists the ribbons' visible areas (any unit); a ribbon that shows nowhere takes a sliver.
 */
export function ribbonPhases(areas) {
    const n = areas.length;
    const out = new Float32Array(n);
    if (!n) return out;
    const w = Array.from(areas, (a) => Math.max(Number(a) || 0, 1e-6));
    const total = w.reduce((sum, a) => sum + a, 0);
    const order = Array.from({ length: n }, (_, j) => (j * RIBBON_PHASE_STEP) % n);
    const places = new Float32Array(n);
    let best = vividSwing(placesFor(order, w, total, places), w, total);
    for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (let a = 0; a < n - 1; a++) {
            for (let b = a + 1; b < n; b++) {
                [order[a], order[b]] = [order[b], order[a]];
                const swing = vividSwing(placesFor(order, w, total, places), w, total);
                if (swing < best - 1e-9) {
                    best = swing;
                    improved = true;
                } else {
                    [order[a], order[b]] = [order[b], order[a]];
                }
            }
        }
        if (!improved) break;
    }
    return placesFor(order, w, total, out);
}

export const ISLAND_LIFT = 0.3;
/**
 * The top bit of the atlas's A channel: this texel's neighbours agree on which side of its edge
 * is which, so a bilinear read of the edge distance there is a true distance to that edge.
 */
export const ATLAS_CONSISTENT = 128;
/**
 * How far (metres) a patch edge may tear either way along the grain (the shader's fray), which
 * the atlas's edge bookkeeping must reach past.
 */
export const BARK_TEAR = 0.025;

/**
 * A patch's warped life phase (0 → 1) → its age on the ramp. Bark lingers fresh (lime, the first
 * skin held longest, then quickly through emerald: the greens stay lime, never mint),
 * hurries through the rare blue and violet phases and through ruby, lingers in ember and rust,
 * and ends weathered: at the grove's resting bias (+0.4) a uniform phase lands about 26% fresh
 * (0–0.14), 10% mid (0.14–0.60), 2% ruby (0.60–0.70), 1.5% turning to ember (0.70–0.75), 40.5%
 * ember and rust (0.75–0.86) and 20% maroon and slate (0.86–0.95). The last age is short of the
 * matrix's, so an old patch dissolves into the slate before it peels.
 */
export const AGE_PHASE_STOPS = Object.freeze([
    [0, 0],
    [0.2, 0.04],
    [0.344, 0.14],
    [0.465, 0.6],
    [0.488, 0.7],
    [0.505, 0.75],
    [0.87, 0.86],
    [1, 0.95],
]);

/**
 * A patch's life (seconds): PATCH_LIFE.min + PATCH_LIFE.span · hash, times its group's scale
 * (GROUP_CYCLE.lifeScale). Only GROUP_CYCLE.share of a group's patches cycle at all; the rest
 * hold their phase (the grove's age drift still ripens them). With every patch on a 4–10 minute
 * cycle the 16:9 rest frame (≈ 300 patches) would wrap one somewhere every second or two; this
 * keeps it to one clearly visible wrap every 6–10 s (§5), most of them on the Elder.
 * Groups: 0 the Elder, 1 the Sisters and the right R1, 2 the left R1, 3 the far grove.
 */
export const PATCH_LIFE = Object.freeze({ min: 240, span: 360 });
/**
 * The far grove (group 3) shows the most bark of all (10 000–30 000 m² in a 16:9 frame, by
 * tier), every patch of it small and hazed: so few of its patches cycle that the whole far grove
 * adds at most one wrap every five seconds, never a twinkle. `turn` turns each group's ribbons
 * round their cycle (a share of it): the Elder's face at the reference frames is a fair sample of
 * the grove's mix (lime and emerald, ember and rust round the slate, an accent or two), not the
 * accent-heavy turn the bare phases happen to give it there (a sweep of turns, A4 review).
 */
export const GROUP_CYCLE = Object.freeze({
    lifeScale: Object.freeze([1, 2.5, 2.5, 3]),
    share: Object.freeze([1, 0.36, 0.3, 0.02]),
    turn: Object.freeze([0.9, 0, 0, 0]),
});
/** A new patch's fresh skin is revealed from its rim inward over this long (seconds)… */
export const PATCH_REVEAL = 2.5;
/** …and in this long before it sheds, its old lip lifts all the way. */
export const PATCH_BUILD = 3;

/** The mean wrap rate of one cycling patch at life scale 1 (per second): E[1 / life]. */
export const PATCH_WRAP_RATE = Math.log((PATCH_LIFE.min + PATCH_LIFE.span) / PATCH_LIFE.min) / PATCH_LIFE.span;

/**
 * Patch wraps per second over some bark: `areas` lists { group, area } (square metres of bark in
 * view), `density` the patches per square metre (the atlas's ribbons over its tile's area).
 */
export function wrapsPerSecond(areas, density) {
    let rate = 0;
    areas.forEach(({ group, area }) => {
        const g = Math.max(0, Math.min(3, Math.round(group) || 0));
        rate += (area * density * GROUP_CYCLE.share[g] * PATCH_WRAP_RATE) / GROUP_CYCLE.lifeScale[g];
    });
    return rate;
}

/** The age a warped phase lands on (piecewise linear through AGE_PHASE_STOPS, clamped). */
export function ageOfPhase(w) {
    const p = clamp01(Number.isFinite(w) ? w : 0);
    let age = 0;
    for (let i = 1; i < AGE_PHASE_STOPS.length; i++) {
        const [w0, a0] = AGE_PHASE_STOPS[i - 1];
        const [w1, a1] = AGE_PHASE_STOPS[i];
        age += clamp01((p - w0) / (w1 - w0)) * (a1 - a0);
    }
    return age;
}

/**
 * The grove's age bias on a cyclic age (§3.4): b ≥ 0 pushes ages old, b < 0 young, monotonic in
 * a for any b, and the identity at b = 0.
 */
export function warpAge(a, b) {
    const x = clamp01(a);
    return b >= 0 ? 1 - (1 - x) ** (1 + b) : x ** (1 - b);
}

/** How far an age stands inside the ramp's rare middle (0 outside … 1 inside; BARK_ACCENT). */
export function accentBand(age) {
    const a = BARK_ACCENT;
    return smooth(a.from - a.ramp, a.from, age) - smooth(a.to, a.to + a.ramp, age);
}

/**
 * The ambient chroma of the bark at an age (BARK_CHROMA; fresh bark nearer the ramp's own,
 * BARK_FRESH_DIM; the rare accents muted further).
 */
export function barkChroma(age) {
    const d = BARK_FRESH_DIM;
    const young = 1 - smooth(d.from, d.to, age);
    return BARK_CHROMA + (d.chroma - BARK_CHROMA) * young - BARK_ACCENT.mute * accentBand(age);
}

/**
 * The share of its albedo ambient bark keeps at an age: fresh bark dimmed (BARK_FRESH_DIM), the
 * rare accents a little (BARK_ACCENT).
 */
export function freshDim(age) {
    const d = BARK_FRESH_DIM;
    return (1 - (1 - d.k) * (1 - smooth(d.from, d.to, age))) * (1 - (1 - BARK_ACCENT.dim) * accentBand(age));
}

/** A ramp colour as the ambient bark wears it (chroma toward luma, times the dry albedo). */
export function barkAlbedo(age, out = [0, 0, 0]) {
    rampAt(age, out);
    const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    const k = BARK_ALBEDO * freshDim(age);
    const chroma = barkChroma(age);
    for (let c = 0; c < 3; c++) out[c] = (luma + (out[c] - luma) * chroma) * k;
    return out;
}

const MEAN_SAMPLES = 64;
const meanScratch = [0, 0, 0];

/**
 * The mean albedo of a group's bark at an age bias: the matrix's share of old slate (its pale
 * islands lighter) plus the patches, whose phases are spread evenly round their cycles (so the
 * clock drops out). The far trunks fade to it by pixel footprint. Returns [r, g, b, meanAge]
 * (linear).
 */
export function groupMean(bias, matrixShare = 0.42, out = [0, 0, 0, 0], islandShare = 0) {
    const share = clamp01(matrixShare);
    const islands = Math.min(share, clamp01(islandShare));
    barkAlbedo(MATRIX_AGE, meanScratch);
    const matrixK = share + islands * ISLAND_LIFT;
    for (let c = 0; c < 3; c++) out[c] = meanScratch[c] * matrixK;
    out[3] = MATRIX_AGE * share;
    const w = (1 - share) / MEAN_SAMPLES;
    for (let i = 0; i < MEAN_SAMPLES; i++) {
        const age = ageOfPhase(warpAge((i + 0.5) / MEAN_SAMPLES, bias));
        barkAlbedo(age, meanScratch);
        for (let c = 0; c < 3; c++) out[c] += meanScratch[c] * w;
        out[3] += age * w;
    }
    return out;
}

/**
 * Box-filtered mips of an RGBA8 or R8 square bake, down to 1×1 (generating mips on the GPU is not
 * portable to every WebGL2 device for every format, and a CPU chain is the same on both).
 * @param {Uint8Array} data  size × size × channels
 * @returns {{ data: Uint8Array, width: number, height: number }[]}  level 0 first
 */
export function buildMips(data, size, channels = 4) {
    const levels = [{ data, width: size, height: size }];
    let level = data;
    let w = size;
    while (w > 1) {
        const nw = w >> 1;
        const next = new Uint8Array(nw * nw * channels);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * channels;
                const b = a + channels;
                const c = a + w * channels;
                const d = c + channels;
                const o = (y * nw + x) * channels;
                for (let k = 0; k < channels; k++) {
                    next[o + k] = (level[a + k] + level[b + k] + level[c + k] + level[d + k] + 2) >> 2;
                }
            }
        }
        levels.push({ data: next, width: nw, height: nw });
        level = next;
        w = nw;
    }
    return levels;
}

// ── The grove and the Climb ─────────────────────────────────────────────────────

/**
 * The CSS width at and under which the stylesheet reflows the stats bar into a full-width row
 * under the card (main.css, `@media (max-width: 820px)`), and that row's height (CSS px: its
 * seven stats two to a row, 20 px under the card, 20 px in from either side).
 */
export const HUD_ROW_WIDTH = 820;
export const HUD_ROW = Object.freeze({ height: 196, gap: 20, inset: 20 });

/** Metres the walkway rises a level, the lowest storey, and the levels before it wraps. */
export const STOREY = 12;
export const CLIMB_BASE = 20;
export const CLIMB_LEVELS = 12;
/** The canopy plane (yC, metres): the gobo and the lace hang here. */
export const CANOPY_Y = 172;
/**
 * The canopy's leaf lace (bakeLeafLace): its tile (metres), the bake's seed, size and twig
 * clusters per 512² of tile (fewer at a smaller size), and the second, larger layer the backdrop
 * lays over it (its tile and turn): two layers, the sky showing only where both open, which also
 * hides either tile's repeat. The lace is the leaves' detail inside the crowns, read only where
 * single leaves resolve.
 */
export const CANOPY_LACE = Object.freeze({
    tile: 12, seed: 7717, size: 256, twigs: 21000, upper: 31, turn: 0.64,
});
/**
 * The canopy's crowns (bakeCrownField): one tile (metres) of crowns 15–25 m across with the
 * channels of crown shyness between them (1.5–3 m, opening wider where three crowns meet), its
 * bake's seed and size, and the reach of its signed field (± metres: what the shader can widen or
 * narrow the openings by, and the widest half-width it tells apart).
 */
export const CANOPY_CROWNS = Object.freeze({
    tile: 72, seed: 5113, size: 512, crowns: 3, range: 3,
});
/**
 * The leaves of the crowns (bakeCrownField), metres. Leaf masses stand at least `masses.apart`
 * apart: first at the ends of the limbs' steps (a chance rising from `from` of a limb's length to
 * its tip), then `darts` throws through the tile, none where the crown has under `least` of room
 * (crownRoom) nor, most of the time, where its broad thinning noise stands from `thin[0]` to
 * `thin[1]`; each is `radius` across (half of it). A mass is `clumps.count` round clumps of
 * `clumps.radius` (smaller ones likelier), none whose centre stands under `into` of its radius
 * inside the crown, each within `spread` of the room the mass leaves it; round each clump's rim hang `leaves.count` sprays of lanceolate leaves,
 * `leaves.length` long, `aspect` times as long as wide, rooted at `root` of the clump's radius,
 * turned up to `splay`/2 off its radius, none whose middle hangs over `hang` of its half-length
 * into a channel. A primitive's own field reaches `reach` outside it (beyond, the exact distance to
 * the leaves). `rim` of a mass's tone is how near its crown's rim it hangs (lighter there), and
 * `dome` of a texel's tone its clump's own depth. In the leaves the field is the distance to the
 * nearest opening wider than a `pinhole` (half-width, metres).
 */
export const CANOPY_CLUMPS = Object.freeze({
    masses: Object.freeze({
        apart: 2.5,
        from: 0.3,
        darts: 9000,
        least: 0.3,
        thin: Object.freeze([0.64, 0.86]),
        radius: Object.freeze([1.8, 3.0]),
    }),
    clumps: Object.freeze({
        count: Object.freeze([7, 12]), radius: Object.freeze([0.6, 1.5]), spread: 0.7, into: 0.75,
    }),
    leaves: Object.freeze({
        count: Object.freeze([3, 6]),
        length: Object.freeze([0.4, 0.9]),
        root: 0.7,
        splay: 1.1,
        hang: 0.6,
    }),
    aspect: 4.5,
    reach: 0.35,
    rim: 0.45,
    dome: 0.4,
    pinhole: 0.3,
});
/**
 * The limbs inside each crown (bakeCrownField's G channel), metres: `count` limbs from `start` off
 * the crown's heart, `length` and `width` (at the base, tapering to `tip` of it), wandering by up
 * to `wander` radians a `step`, each forking once between `forkAt` of its length, the fork turned
 * `forkTurn` radians, `forkLength` of the rest long and `forkWidth` as thick.
 */
export const CANOPY_LIMBS = Object.freeze({
    count: Object.freeze([6, 9]),
    start: 0.8,
    length: Object.freeze([7, 12]),
    width: Object.freeze([0.4, 0.75]),
    tip: 0.25,
    step: 1.2,
    wander: 0.35,
    forkAt: Object.freeze([0.35, 0.65]),
    forkTurn: Object.freeze([0.35, 0.7]),
    forkLength: 0.7,
    forkWidth: 0.65,
});
/** The tide's period (seconds): low at t = 0, high at half of it. */
export const TIDE_PERIOD = 150;
/** The sun's azimuth, degrees to the right of the view axis (it drifts ±SUN_DRIFT over the tide). */
export const SUN_AZIMUTH = 70;
export const SUN_DRIFT = 3;

/** The Climb's place for a level: c = (level − 1) mod 12, so level 13 is the lowest storey again. */
export function levelCycle(level) {
    const n = Math.max(1, Math.round(Number.isFinite(Number(level)) ? Number(level) : 1));
    return (n - 1) % CLIMB_LEVELS;
}

/** The walkway's height (metres above the floor) on a level: 20 m on L1 … 152 m on L12. */
export function climbHeight(level) {
    return CLIMB_BASE + STOREY * levelCycle(level);
}

/** The palette rows each zone sets (in this order in the palette table). */
export const ZONE_COLOR_KEYS = Object.freeze([
    'hazeShade', 'hazeSun', 'sky', 'zenith', 'mistTop', 'underglow', 'fleck', 'crown', 'gradeShadow', 'gradeLight',
]);

/**
 * The five zones of the Climb. Each sets the haze, the light and the grade; `cycles` are the
 * values of c (level − 1 mod 12) that stand in it. Air: σA (per metre at the tide top) falling
 * off with the scale height Hs above it, σM inside the mist. `pearl` marks the pearly, high-key
 * zones (the Fog Line; the Mistfall look too): 1 there, 0 elsewhere, crossfaded over the Climb
 * (the canopy is a faint shadow high in their pearl, the mist's lit fronts lean cream).
 */
export const ZONES = Object.freeze([
    Object.freeze({
        name: 'Buttress Deep',
        // (Exposure under the spec's 1.15, for the post's contrast S: the cool storey stays moody.)
        cycles: Object.freeze([0, 1]),
        tideTop: 10,
        tideAmp: 8,
        sunElevation: 50,
        fleck: 0.06,
        sat: 0.85,
        pearl: 0,
        exposure: 1.05,
        sigmaA: 0.016,
        scaleHeight: 30,
        sigmaM: 0.06,
        colors: Object.freeze({
            hazeShade: '#4F5F9A',
            hazeSun: '#D6D2CF',
            sky: '#9DB4D8',
            zenith: '#9DB4D8',
            mistTop: '#E2DDD3',
            underglow: '#CDBFA6',
            fleck: '#FFE5B0',
            crown: '#1B3326',
            gradeShadow: '#18213D',
            gradeLight: '#E6EDF8',
        }),
    }),
    Object.freeze({
        name: 'Bole',
        cycles: Object.freeze([2, 3, 4]),
        // The mist floor 22–38 m below the reference storey (the A2 review): the nearest mist
        // seen between the trunks is then 80 m off, an abyss through the haze, never a floor,
        // and L3 (44 m) never ends up inside the mist at high tide. A deliberate change from the
        // spec's 38 ± 8 m top (§2.3, §3.3: recorded there, pending the lead's sign-off); the swing
        // is the spec's ±8 m, so the tide reads (the A3 review). The trunks' warm bounce at eye
        // height is a little lower for the lower top (BOUNCE_HEIGHT and the bounce's eye term
        // make it up).
        tideTop: 26,
        tideAmp: 8,
        sunElevation: 55,
        fleck: 0.18,
        sat: 1.0,
        pearl: 0,
        exposure: 1.0,
        sigmaA: 0.0102,
        scaleHeight: 40,
        sigmaM: 0.05,
        colors: Object.freeze({
            hazeShade: '#8FA6D8',
            hazeSun: '#F6EBCB',
            sky: '#CFE6F6',
            zenith: '#CFE6F6',
            mistTop: '#F6EBCB',
            underglow: '#F2DDB0',
            fleck: '#FFE3A0',
            crown: '#23452F',
            gradeShadow: '#1E2A44',
            gradeLight: '#FFF2D8',
        }),
    }),
    Object.freeze({
        name: 'Fog Line',
        // (Exposure under the spec's 0.92: the post's contrast S lifts a high-key frame, and inside
        // the mist that read as blown white rather than pearl.)
        cycles: Object.freeze([5, 6, 7]),
        tideTop: 100,
        tideAmp: 4,
        sunElevation: 58,
        fleck: 0.10,
        sat: 0.78,
        pearl: 1,
        exposure: 0.74,
        sigmaA: 0.012,
        scaleHeight: 40,
        // Thinner than the spec's 0.05: from the walkway inside it (the vapour about 0.85 of its
        // full density there) the first rank, 45 m off, still stands as a ghost while the trunks
        // dissolve within 60 m (§3.2's mood; the A3 review).
        sigmaM: 0.035,
        colors: Object.freeze({
            hazeShade: '#C9D2E2',
            hazeSun: '#F4F1EA',
            sky: '#EEF2F6',
            zenith: '#EEF2F6',
            mistTop: '#F7F7F3',
            underglow: '#E9E6DE',
            fleck: '#FFF4DC',
            crown: '#3A5446',
            gradeShadow: '#4E5873',
            gradeLight: '#FBFAF6',
        }),
    }),
    Object.freeze({
        name: 'Limb Storey',
        cycles: Object.freeze([8, 9, 10]),
        tideTop: 104,
        tideAmp: 8,
        sunElevation: 61,
        fleck: 0.30,
        sat: 1.08,
        pearl: 0,
        exposure: 0.98,
        sigmaA: 0.0075,
        scaleHeight: 45,
        sigmaM: 0.045,
        colors: Object.freeze({
            hazeShade: '#A6BEE4',
            hazeSun: '#FFF0D2',
            sky: '#D6ECFA',
            zenith: '#9CCBF0',
            mistTop: '#FFF6E2',
            underglow: '#F5E2BE',
            fleck: '#FFE6A6',
            crown: '#2C5A3A',
            gradeShadow: '#22314E',
            gradeLight: '#FFF4DE',
        }),
    }),
    Object.freeze({
        name: 'Crown Light',
        cycles: Object.freeze([11]),
        tideTop: 108,
        tideAmp: 8,
        sunElevation: 64,
        fleck: 0.42,
        sat: 1.0,
        pearl: 0,
        exposure: 0.95,
        sigmaA: 0.006,
        scaleHeight: 50,
        sigmaM: 0.04,
        colors: Object.freeze({
            hazeShade: '#9CC4EA',
            hazeSun: '#FDF5E4',
            sky: '#8FC3EE',
            zenith: '#4F93D6',
            mistTop: '#FFFDF6',
            underglow: '#F0E7D2',
            fleck: '#FFF0C4',
            crown: '#2F6A3E',
            gradeShadow: '#28406A',
            gradeLight: '#FFF8EA',
        }),
    }),
]);

/**
 * The Mistfall look (game over, at rest): laid over the zone, never a zone of its own. It has
 * no flecks, so its fleck colour is never seen.
 */
export const MISTFALL = Object.freeze({
    name: 'Mistfall',
    /** The mist rises this far above the camera. */
    tideLift: 15,
    fleck: 0,
    sat: 0.6,
    pearl: 1,
    // (A blue-hour fog, never a white sheet: game over is quiet, and the UI over it is dark.)
    exposure: 0.8,
    colors: Object.freeze({
        hazeShade: '#7E8AB0',
        hazeSun: '#C9C9DC',
        sky: '#B8C1D8',
        zenith: '#B8C1D8',
        mistTop: '#CDD2E2',
        underglow: '#B9B6CC',
        fleck: '#D4D2E2',
        crown: '#36424A',
        gradeShadow: '#2E3552',
        gradeLight: '#E4E5F0',
    }),
});

/**
 * The grain of the mist top's billows for an eye at `camY` in a zone (mistGrainAt): `ref` metres
 * over the zone's tide top divided by the eye's height over it, rounded to a whole number (so the
 * drift's wrap still repeats every read exactly) from 1 to `most`. From a storey just over the
 * mist (L1, L3) the billows seen at the bottom of the frame are a few tens of metres off, where
 * the Bole's 33 m billows would fill it with one soft blob; finer there, they still read as
 * billows.
 */
export const MIST_GRAIN = Object.freeze({ ref: 30, most: 3, dip: 0.1 });

/** The billows' grain (MIST_GRAIN) for an eye at `camY` in `zone`. */
export function mistGrainAt(camY, zone = ZONES[1]) {
    const over = Math.max(camY - zone.tideTop, 1e-3);
    return Math.round(Math.min(MIST_GRAIN.most, Math.max(1, MIST_GRAIN.ref / over)));
}

/**
 * The billows' contrast while the Climb runs from a storey of grain `grainA` to one of `grainB`
 * (`k` its share run, 0 … 1): where the grains differ the grain is swapped at the midpoint, so the
 * contrast dips to 0 there (from `MIST_GRAIN.dip` either side of it): the swap lands while the
 * floor is flat, never a pop of the whole pattern. 1 where the grains agree.
 */
export function billowContrast(k, grainA, grainB) {
    if (grainA === grainB) return 1;
    return smooth(0, MIST_GRAIN.dip, Math.abs(k - 0.5));
}

/** The zone a level stands in (an index into ZONES). */
export function zoneIndex(level) {
    const c = levelCycle(level);
    for (let i = 0; i < ZONES.length; i++) if (ZONES[i].cycles.includes(c)) return i;
    return ZONES.length - 1;
}

/** The mist floor's top (metres) at time t in a zone: low at t = 0, high at TIDE_PERIOD / 2. */
export function tideAt(t, zone = ZONES[1]) {
    const time = Number.isFinite(t) ? t : 0;
    return zone.tideTop + zone.tideAmp * -Math.cos((TAU * time) / TIDE_PERIOD);
}

/**
 * The tide's four phases (§3.3), each a quarter of the cycle centred on its moment: clearing round
 * low water (t = 0), rising, immersion round high water (half the period), then draining.
 */
export const TIDE_PHASES = Object.freeze(['clearing', 'rising', 'immersion', 'draining']);

/**
 * What the tide does to the light, the air and the mist, from low water to high, following its
 * height smoothly (never a step at a phase's edge): the flecks' gain (the canopy's light thins as
 * the vapour rises), the bark's sheen (wetter in the mist), the haze's density (σA, on rays at and
 * above the horizon: the air the vapour breathes into, never the air between the eye and the mist
 * below, which would veil the risen mist as much as its rise brings it near), how far above the
 * tide the vapour begins (metres: at high water it swallows the trunks' feet higher; never within
 * `onsetEye` metres of the eye, mistOnset, where every trunk would start to sink at the horizon's
 * row, a line across the frame) and the mist sheets' strength (thin while the mist clears).
 */
export const TIDE_LIGHT = Object.freeze({
    fleckGain: Object.freeze([1.15, 0.6]),
    sheen: Object.freeze([0.6, 1.0]),
    air: Object.freeze([1.0, 1.3]),
    onset: Object.freeze([1, 6]),
    onsetEye: 3.5,
    sheets: Object.freeze([0.55, 1.0]),
});

/**
 * How far above the tide the vapour begins for an eye at `camY`: the tide clock's onset, kept
 * TIDE_LIGHT.onsetEye under the eye (never under the low-water onset).
 */
export function mistOnset(onset, tide, camY) {
    const room = camY - tide - TIDE_LIGHT.onsetEye;
    return Math.max(TIDE_LIGHT.onset[0], Math.min(onset, room));
}

/**
 * The tide clock at time t in a zone (the 150 s cycle of §3.3): the mist's top (tideAt), how high
 * the water stands (`high`, 0 low … 1 high), how fast it moves (`rate`, metres a second, rising
 * positive, and `rise`, the same from −1 draining fastest to 1 rising fastest), the phase (index
 * into TIDE_PHASES, and its name) and what the tide does to the light, the air and the mist
 * (TIDE_LIGHT; the sheets' strength is read from `high` on the GPU). Allocation-free with `out`.
 */
export function tideClock(t, zone = ZONES[1], out = {
    tide: 0,
    high: 0,
    rate: 0,
    rise: 0,
    phase: 0,
    name: TIDE_PHASES[0],
    fleckGain: 1,
    sheen: 1,
    air: 1,
    onset: 1,
}) {
    const time = Number.isFinite(t) ? t : 0;
    const p = (((time / TIDE_PERIOD) % 1) + 1) % 1;
    const angle = TAU * p;
    const high = 0.5 - 0.5 * Math.cos(angle);
    out.tide = zone.tideTop + zone.tideAmp * (2 * high - 1);
    out.high = high;
    out.rise = Math.sin(angle);
    out.rate = zone.tideAmp * (TAU / TIDE_PERIOD) * out.rise;
    out.phase = Math.floor(p * 4 + 0.5) % 4;
    out.name = TIDE_PHASES[out.phase];
    out.fleckGain = lerp(TIDE_LIGHT.fleckGain[0], TIDE_LIGHT.fleckGain[1], high);
    out.sheen = lerp(TIDE_LIGHT.sheen[0], TIDE_LIGHT.sheen[1], high);
    out.air = lerp(TIDE_LIGHT.air[0], TIDE_LIGHT.air[1], high);
    out.onset = lerp(TIDE_LIGHT.onset[0], TIDE_LIGHT.onset[1], high);
    return out;
}

// ── The mist floor (its geometry: sheets and wisps, §4.6) ───────────────────────

/**
 * The mist's drift: the billows and sheets travel `speed` metres a second along `heading` (a unit
 * xz vector), and the billows boil slowly (`boil` noise cells a second in the noise's third axis).
 * Each of x and z is wrapped on its own at `wrap` metres, where every noise read through the drift
 * repeats exactly (the billows' two octaves and each mist sheet's sheared rate, in cells a metre on
 * the 256-cell lattice), so the wrap never shows; the boil wraps at the lattice's 256 cells and is
 * read only at whole multiples of itself (MIST_SHEETS.boil, the billows' `boil`).
 */
export const MIST_DRIFT = Object.freeze({
    speed: 0.4, heading: Object.freeze([0.8, -0.6]), wrap: 512000, boil: 0.02,
});

/** The mist's drift at time t: (x, z) metres along the heading, each wrapped, and the boil (cells). */
export function mistDrift(t, out = [0, 0, 0]) {
    const time = Number.isFinite(t) ? Math.max(0, t) : 0;
    const along = MIST_DRIFT.speed * time;
    out[0] = (along * MIST_DRIFT.heading[0]) % MIST_DRIFT.wrap;
    out[1] = (along * MIST_DRIFT.heading[1]) % MIST_DRIFT.wrap;
    out[2] = (MIST_DRIFT.boil * time) % 256;
    return out;
}

/**
 * The mist sheets (§4.6): horizontal, `span` metres across and centred on the camera, the i-th at
 * tide + base + step·i (the first just under the top, inside the vapour, the rest climbing out of
 * it); their density a noise of `scale` cells a metre, each sheet drifting a little faster than the
 * one under it (`shear`) so the layers slide over each other; `thickness` metres of mist each
 * (alpha 1 − exp(−σM·thickness)); seen within `grazing` of the horizontal (|V.y|) a sheet fades
 * out, so a stack of planes never shows its slices edge-on; and over the outer `rim` of its span it
 * fades into the backdrop's analytic mist. A sheet standing over the tide thins (to `above` of its
 * strength from `climb[0]` to `climb[1]` metres over it): it crosses trunks the mist has not yet
 * veiled, and a thin plane cut by a trunk would draw a line across the bark. For the same reason
 * a sheet within `eye` metres under the camera's height (seen edge-on by every trunk near it)
 * fades out, fully gone at the first of them, and a sheet over the eye (seen from below, from
 * inside the mist) is gone altogether. Each boils at `boil` (a whole number) times the drift's
 * boil.
 */
export const MIST_SHEETS = Object.freeze({
    span: 600,
    base: -4,
    step: 3,
    scale: 0.02,
    shear: 0.15,
    boil: 1,
    thickness: 5,
    grazing: Object.freeze([0.1, 0.35]),
    rim: 0.6,
    climb: Object.freeze([-4, 5]),
    above: 0.2,
    eye: Object.freeze([4, 14]),
});

/** The height (metres) of the i-th mist sheet over a tide. */
export function mistSheetHeight(i, tide) {
    return tide + MIST_SHEETS.base + MIST_SHEETS.step * i;
}

/**
 * The wisps (§4.6): ragged threads of vapour hanging between the ranks below the eye, their feet
 * `sink` metres under the tide, rising `rise` metres a second, each living `life` seconds and at
 * most `alpha` opaque, `aspect` times as wide as they are tall (their thread a narrow column of
 * that, tapering upward). Their height is scaled to the gap between the mist and the eye
 * (wispHeight: `height.per` of it plus `height.add`, within `height.least` … `height.most` metres,
 * `height.spread` of that by each life's hash) and never reaches within `height.eye` metres of
 * the eye: from just over the mist a 30 m veil would tower out of the frame. Each life stands
 * somewhere new in one of the gaps between the grove's ranks (`gaps`, metres of depth from the
 * eye, picked with the odds `odds`: mostly the middle gaps, where a thread's upper part stands in
 * front of the blue air over the far mist and the darker ranks, not the cream floor it rises
 * from), and never within `keepOut` of the card's screen band (the lanes either side of it; a
 * life fades out over `keepSoft` of screen width at the band's edge, never popping as the camera
 * breathes). The tide drives them (`rising`): while the mist is still or
 * draining only `share[0]` of the lives show, all of them while it rises fastest, and those grow
 * up to `tall` taller. Their light adds at most `lift` (scene-linear luminance) over the air
 * behind them: a thread of vapour, never a pane of light.
 */
export const MIST_WISPS = Object.freeze({
    height: Object.freeze({
        per: 0.8, add: 4, least: 6, most: 40, eye: 2, spread: Object.freeze([0.7, 1.0]),
    }),
    aspect: 0.3,
    sink: 2,
    rise: 0.3,
    life: Object.freeze([8, 14]),
    alpha: 0.25,
    lift: 0.14,
    keepOut: 0.03,
    keepSoft: 0.01,
    gaps: Object.freeze([
        Object.freeze([28, 42]), Object.freeze([50, 60]), Object.freeze([86, 98]), Object.freeze([128, 148]),
    ]),
    odds: Object.freeze([0.1, 0.45, 0.3, 0.15]),
    rising: Object.freeze({ share: Object.freeze([0.6, 1.0]), tall: 0.2 }),
});

/**
 * A wisp's height (metres) for an eye at `camY` over the tide `tide` (MIST_WISPS.height): scaled to
 * the gap between them, `h` (0 … 1, the life's hash) picking within the spread, `tall` its growth
 * while the tide rises (1 still), and never reaching from its foot `footY` (the tide less the sink
 * unless given) to within `eye` metres of the eye; 0 when its foot stands that high.
 */
export function wispHeight(camY, tide, h = 1, tall = 1, footY = tide - MIST_WISPS.sink) {
    const H = MIST_WISPS.height;
    const full = Math.min(H.most, Math.max(H.least, H.per * (camY - tide) + H.add));
    const height = full * lerp(H.spread[0], H.spread[1], clamp01(h)) * tall;
    return Math.max(0, Math.min(height, camY - H.eye - footY));
}

/**
 * A screen x (fraction) in the lanes either side of the card band [x0, x1] kept `keep` clear of it,
 * for q in [0, 1): q spreads evenly over both lanes, left then right. NaN when neither lane has room
 * (a wisp there collapses).
 */
export function laneX(q, x0, x1, keep = MIST_WISPS.keepOut) {
    const left = Math.max(0, x0 - keep);
    const rightFrom = Math.min(1, x1 + keep);
    const right = Math.max(0, 1 - rightFrom);
    const total = left + right;
    if (!(total > 1e-3)) return NaN;
    const at = clamp01(q) * total;
    return at < left ? at : rightFrom + (at - left);
}

// ── The rest view (the camera rig's lens, as screen maths) ──────────────────────

/** Portrait → landscape (k) and landscape → ultrawide (w), as 0..1 weights of the aspect. */
export function aspectWeights(aspect, out = { k: 0, w: 0 }) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    out.k = smooth(0.62, 1.5, a);
    out.w = smooth(1.78, 2.4, a);
    return out;
}

/** The rig's vertical field of view (degrees): 64° upright … 50° at 16:9 … 44° at 21:9. */
export function viewFov(aspect) {
    const { k, w } = aspectWeights(aspect);
    return 64 - 14 * k - 6 * w;
}

/** How far the rig pitches the view up (degrees): 9° upright, 6° at 16:9, 5° at 21:9. */
export function viewPitch(aspect) {
    const { k, w } = aspectWeights(aspect);
    return 9 - 3 * k - 1 * w;
}

/**
 * The rest view of an aspect for screen maths: the tangents of its half angles and the sine and
 * cosine of its pitch. Composition is measured through it (the camera's x breath is ignored).
 */
export function restLens(aspect, out = {}) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const pitch = viewPitch(a) * DEG;
    out.aspect = a;
    out.tanV = Math.tan((viewFov(a) * DEG) / 2);
    out.tanH = out.tanV * a;
    out.s = Math.sin(pitch);
    out.c = Math.cos(pitch);
    return out;
}

/**
 * One screen row (fraction, 0 at the top) of a rest lens. A point at horizontal depth D in front
 * of the eye shows on this row when it stands D·rise above the eye, and a direction whose
 * horizontal tangent is x/D shows at screen x = 0.5 + 0.5·(x/D)·scale/tanH: the pitch makes
 * verticals converge upward, the same on every storey.
 */
export function lensRow(lens, sy, out = { rise: 0, scale: 1 }) {
    const yt = (1 - 2 * sy) * lens.tanV;
    const scale = lens.c - yt * lens.s;
    out.rise = (lens.s + yt * lens.c) / scale;
    out.scale = scale;
    return out;
}

/** The screen row (fraction) a rest lens shows the eye's own height on. */
export function eyeRow(lens) {
    return 0.5 + (0.5 * lens.s) / (lens.c * lens.tanV);
}

/**
 * The unit vector toward the sun for an elevation and an azimuth (degrees; azimuth to the right
 * of the view axis −z). The Bole sun (55°, 70°) is (0.539, 0.819, −0.196).
 */
export function sunDirection(elevation, azimuth = SUN_AZIMUTH, out = [0, 0, 0]) {
    const el = elevation * DEG;
    const az = azimuth * DEG;
    out[0] = Math.cos(el) * Math.sin(az);
    out[1] = Math.sin(el);
    out[2] = -Math.cos(el) * Math.cos(az);
    return out;
}

// ── The sunflecks: the canopy's gobo (§4.5) ─────────────────────────────────────

/**
 * The canopy's gap mask (bakeGapMask): one tileable `tile` metre square of the canopy seen from
 * below, R8 at `size` texels a side with its CPU mips (1 open … 0 leaves), and its seed. Its
 * openings come in three kinds, each read at its own storey: `patches` thin places in the crowns,
 * at least `apart` metres from each other, each `pinholes` openings (radii `small`, metres)
 * gathered within a Gaussian of `spread` metres (from the Bole each patch is one soft fleck, its
 * pinholes' images merged: about a dozen discrete flecks a tile; higher up it breaks into its
 * openings); `mediums` openings (radii `medium`) scattered between; and `fine` scattered pinholes
 * (radii `fineR`) that only the upper storeys resolve (from the Bole their images melt into the
 * canopy's dapple), so the flecks there are small, crisp and many. Its pyramid is `oversample`
 * levels oversampled (each level holds the blur of the one that many further down, at 2ⁿ times its
 * texels: cut at a threshold, a fleck's outline is a round soft disc, never a polygon with
 * straight sides).
 */
export const GAP_MASK = Object.freeze({
    tile: 9,
    size: 256,
    // (Picked from a sweep so the Elder's sunlit face holds flecks at the reference frames; any
    // seed gives the zone's coverage on average.)
    seed: 152,
    oversample: 2,
    patches: 17,
    apart: 2.1,
    pinholes: Object.freeze([5, 9]),
    spread: Object.freeze([0.55, 0.7]),
    small: Object.freeze([0.1, 0.17]),
    mediums: 8,
    medium: Object.freeze([0.12, 0.2]),
    fine: 520,
    fineR: Object.freeze([0.05, 0.11]),
});

/**
 * The gobo (rbFleck, fleckAt): a point's sun ray runs dC = (yC − y)/L.y up to the canopy plane,
 * where the sun's 0.53° disc makes every opening a pinhole image `disc`·dC metres across; the
 * mask is read at that size's level (one texel of the base level is tile/size metres; no finer
 * than level 0, no coarser than `maxLod`; read fleckSharpen levels finer: `sharpen`[0] from the
 * Bole down, rising to [1] over the levels `sharpenLod`, as the mask's levels are an oversampled
 * Gaussian pyramid, GAP_MASK.oversample levels and about one more softer than a box chain's, and
 * up high the cut should resolve a cluster's pinholes one by one), times 2^(`gain`·lod) so a pinhole's
 * image stays a bright disc however far its light falls. A fleck is that cut from the zone's threshold `thr` (fleckThreshold:
 * the zone's share of bark in flecks) to `soft` times as much again (a soft rim, as wide as the
 * image's own penumbra), never under `floor` of the brightest the mask reads at that level (the
 * cut stays among real openings: lower, it would light the soft skirts of whole clusters of them
 * as long bars; a storey whose zone wants more than its openings give takes less); between the
 * flecks the canopy's light dapples the sunny side, up to `dapple` of a fleck's light where the
 * mask's light nears the cut. Low and Minimal read one
 * level for the whole frame (the level at the eye's storey: fleckLodAt), never a level per pixel.
 * `pools` is the brightest a combo gap's pool is against an ambient fleck (max-combined, never
 * summed); a pool is the gap's pinhole image: a solid disc of the gap's radius plus `poolReach` of
 * the sun's penumbra there, its edge `poolEdge` of the penumbra either side (a disc of sun you can
 * count, never a dim blob melting over the penumbra's whole width). In a pearly zone (the shader's u.pearl) the vapour overhead widens the rim by up to
 * 1 + `pearlSoft` times (fleckAt, the gobo's calibration, keeps the clear zones' rim).
 */
export const FLECK = Object.freeze({
    disc: 0.0093,
    gain: 0.85,
    sharpen: Object.freeze([3, 3.5]),
    sharpenLod: Object.freeze([4.9, 4.1]),
    soft: 0.22,
    pearlSoft: 2,
    dapple: 0.08,
    maxLod: 7,
    pools: 1.5,
    poolReach: 0.3,
    poolEdge: 0.125,
    least: 0.02,
    floor: 0.3,
});

/**
 * How many levels finer than its pinhole image's own the gap mask is read at a level `lod`
 * (FLECK.sharpen: [0] from the Bole down, rising linearly to [1] from sharpenLod[0] to [1], the
 * Limb Storey's levels): as the walkway climbs the cut resolves a cluster's pinholes one by one,
 * small crisp flecks, never one merged stain.
 */
export function fleckSharpen(lod) {
    const [from, to] = FLECK.sharpenLod;
    const k = clamp01((from - lod) / (from - to));
    return FLECK.sharpen[0] + (FLECK.sharpen[1] - FLECK.sharpen[0]) * k;
}

/**
 * The gobo's wind, in tiles of the mask: two octaves on each axis (periods 2.9–6.7 s), and a gust
 * every `every` ± `jitter` seconds that moves the canopy in `length` seconds (eased) from where the
 * last gust left it to a new place within `reach` tiles of rest (so a gust moves it at most twice
 * that). Higher up the flecks are smaller, so the wind's reach there is scaled down with them
 * (windScaleAt, never under `least`): every point crosses a fleck's edge less than twice a second
 * on every storey (WCAG 2.3.1).
 */
export const CANOPY_WIND = Object.freeze({
    x: Object.freeze([[0.02, 5.3, 0], [0.012, 2.9, 1.7]]),
    z: Object.freeze([[0.016, 6.7, 0.4], [0.01, 3.7, 0]]),
    gust: Object.freeze({
        every: 20, jitter: 2.5, length: 1.2, reach: 0.05,
    }),
    ref: 56,
    least: 0.15,
    shrink: 1.15,
});

/** An integer → [0, 1) (the gusts' schedule). */
function hashInt(n, salt) {
    let h = Math.imul((n | 0) ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul((salt | 0) + 0x5bd1e995, 0x68e31da4);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** When gust n blows (seconds): every `every`, jittered ± `jitter` (n ≥ 1). */
export function gustTime(n) {
    const g = CANOPY_WIND.gust;
    return g.every * n + g.jitter * (2 * hashInt(n, 11) - 1);
}

/** The sum of a wind axis's octaves at a time (each term [amplitude, period, phase]). */
function windOctaves(terms, time) {
    let sum = 0;
    for (let i = 0; i < terms.length; i++) {
        const term = terms[i];
        sum += term[0] * Math.sin((TAU * time) / term[1] + term[2]);
    }
    return sum;
}

/** Where gust k leaves the canopy (an angle round its rest). */
const gustPlace = (k) => hashInt(k, 23) * TAU;

/**
 * The canopy's wind at time t (closed form: seek-safe), in tiles of the gap mask: [x, z]. The two
 * octaves, plus where the gusts have left the canopy: between gust n and n + 1 it rests at gust
 * n's place (gust 0's place before the first), moving there from gust n − 1's over `length`.
 */
export function canopyWind(t, out = [0, 0], scale = 1) {
    const time = Number.isFinite(t) ? Math.max(0, t) : 0;
    const W = CANOPY_WIND;
    out[0] = windOctaves(W.x, time);
    out[1] = windOctaves(W.z, time);
    const g = W.gust;
    // The latest gust at or before t (gust times are each within ±jitter of their slot).
    let n = Math.max(0, Math.floor((time + g.jitter) / g.every));
    while (n > 0 && gustTime(n) > time) n -= 1;
    const e = n > 0 ? smoother((time - gustTime(n)) / g.length) : 1;
    const a = gustPlace(Math.max(0, n - 1));
    const b = gustPlace(n);
    out[0] += g.reach * (Math.cos(a) + (Math.cos(b) - Math.cos(a)) * e);
    out[1] += g.reach * (Math.sin(a) + (Math.sin(b) - Math.sin(a)) * e);
    out[0] *= scale;
    out[1] *= scale;
    return out;
}

/**
 * The wind's scale for an eye at height y (canopyWind): the flecks' size there (the level the
 * mask is read at, fleckSharpen levels finer than the pinhole image's own) against the Bole's
 * reference storey (CANOPY_WIND.ref), to the power CANOPY_WIND.shrink (the small crisp flecks up
 * high have the sharper rims: the reach falls a little faster than their size), at most 1, never
 * under CANOPY_WIND.least.
 */
export function windScaleAt(y, sunY, canopyY = CANOPY_Y) {
    const read = (h) => {
        const lod = fleckLodAt(h, sunY, canopyY);
        return Math.max(0, lod - fleckSharpen(lod));
    };
    const k = 2 ** ((read(y) - read(CANOPY_WIND.ref)) * CANOPY_WIND.shrink);
    return Math.max(CANOPY_WIND.least, Math.min(1, k));
}

/** The gap mask's level for a pinhole image from height y (the gobo's size at that height). */
export function fleckLodAt(y, sunY, canopyY = CANOPY_Y) {
    const dC = Math.max(canopyY - y, 0) / Math.max(sunY, 0.2);
    const texel = GAP_MASK.tile / GAP_MASK.size;
    return Math.max(0, Math.min(FLECK.maxLod, Math.log2(Math.max(dC * FLECK.disc, texel) / texel)));
}

/** A bilinear, wrapping read of one R8 mip level at (u, v) in tiles (texel centres at (i + ½)/w). */
function sampleLevel(level, u, v) {
    const w = level.width;
    const h = level.height;
    const x = u * w - 0.5;
    const y = v * h - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const xa = ((x0 % w) + w) % w;
    const xb = (xa + 1) % w;
    const ya = ((y0 % h) + h) % h;
    const yb = (ya + 1) % h;
    const d = level.data;
    const top = d[ya * w + xa] + (d[ya * w + xb] - d[ya * w + xa]) * fx;
    const bottom = d[yb * w + xa] + (d[yb * w + xb] - d[yb * w + xa]) * fx;
    return (top + (bottom - top) * fy) / 255;
}

/** A trilinear read of the gap mask (as a LinearMipmapLinear sampler reads it) at a level. */
export function sampleGapMask(mask, u, v, lod) {
    const last = mask.mipmaps.length - 1;
    const l = Math.max(0, Math.min(last, lod));
    const l0 = Math.floor(l);
    const l1 = Math.min(last, l0 + 1);
    const a = sampleLevel(mask.mipmaps[l0], u, v);
    return l1 === l0 ? a : a + (sampleLevel(mask.mipmaps[l1], u, v) - a) * (l - l0);
}

/** The gobo's cut of the mask's light `v` (FLECK): the fleck, or between flecks the dapple. */
export function fleckCut(v, thr) {
    const t = Math.max(thr, FLECK.least);
    return Math.max(smooth(t, t * (1 + FLECK.soft), v), FLECK.dapple * clamp01(v / t));
}

/**
 * The CPU twin of rbFleck (§4.5): the canopy's sunfleck at a world point (0 shade … 1 a fleck's
 * heart, up to FLECK.pools in a combo gap's pool), for spawning what lives only in the light.
 * `light` = { sunDir [x, y, z] toward the sun, wind [x, z] tiles (canopyWind), thr
 * (fleckThreshold), lod (optional: one level for every point, as Low and Minimal read it), canopyY,
 * gaps (optional: the combo gaps' rows as the events table holds them, [x, z, radius, open] on the
 * canopy plane at rest) }.
 */
export function fleckAt(mask, x, y, z, light) {
    const L = light.sunDir;
    const yC = Number.isFinite(light.canopyY) ? light.canopyY : CANOPY_Y;
    const dC = Math.max(yC - y, 0) / Math.max(L[1], 0.2);
    const qx = x + L[0] * dC;
    const qz = z + L[2] * dC;
    const lod = Number.isFinite(light.lod) ? light.lod : fleckLodAt(y, L[1], yC);
    const at = Math.max(0, lod - fleckSharpen(lod));
    const m = sampleGapMask(mask, qx / GAP_MASK.tile + light.wind[0], qz / GAP_MASK.tile + light.wind[1], at);
    let fl = fleckCut(m * 2 ** (FLECK.gain * lod), light.thr);
    const gaps = light.gaps || [];
    const pen = dC * FLECK.disc;
    for (let i = 0; i < gaps.length; i++) {
        // A combo gap's pool: its own pinhole image, drifting with the canopy (max-combined).
        const [gx, gz, r, open] = gaps[i];
        const d = Math.hypot(qx - (gx + light.wind[0] * GAP_MASK.tile), qz - (gz + light.wind[1] * GAP_MASK.tile));
        const reach = r + pen * FLECK.poolReach;
        const edge = pen * FLECK.poolEdge;
        const pool = (1 - smooth(reach - edge, reach + edge + 1e-3, d)) * open;
        fl = Math.max(fl, pool * FLECK.pools);
    }
    return fl;
}

/**
 * The gobo's calibration for a share of the bark in flecks at a level of the mask: the mask's
 * light read at `n` × `n` points spread over one tile; `thr` its (1 − coverage) quantile, less
 * the soft rim's half (so a fleck is half lit there; never under FLECK.floor of the brightest
 * point, nor under FLECK.least), `mean` the gobo's mean light over the grid at that threshold
 * (what far bark melts into), `peak` that brightest point and `coverage` the share it lights.
 */
export function fleckCalibration(mask, coverage, lod, n = 64) {
    const count = n * n;
    const values = new Float32Array(count);
    const gain = 2 ** (FLECK.gain * lod);
    const at = Math.max(0, lod - fleckSharpen(lod));
    // A low-discrepancy (R2) set of points over the tile: a regular grid would beat against the
    // finer levels' texels.
    let peak = 0;
    for (let i = 0; i < count; i++) {
        values[i] = sampleGapMask(mask, (0.5 + i * 0.7548776662) % 1, (0.5 + i * 0.5698402910) % 1, at) * gain;
        peak = Math.max(peak, values[i]);
    }
    const sorted = Float32Array.from(values).sort();
    const k = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - clamp01(coverage)) * sorted.length)));
    const thr = Math.max(FLECK.least, sorted[k] / (1 + FLECK.soft * 0.5), FLECK.floor * peak);
    let sum = 0;
    let lit = 0;
    for (let i = 0; i < values.length; i++) {
        const c = fleckCut(values[i], thr);
        sum += c;
        if (c > 0.5) lit += 1;
    }
    return {
        thr, mean: sum / values.length, peak, coverage: lit / values.length,
    };
}

/** The gobo's calibration at a level's storey (its zone's coverage at the eye's mask level). */
export function storeyFleck(mask, level) {
    const zone = ZONES[zoneIndex(level)];
    const lod = fleckLodAt(climbHeight(level), Math.sin(zone.sunElevation * DEG));
    return fleckCalibration(mask, zone.fleck, lod);
}

// ── The shafts (§4.8) ──────────────────────────────────────────────────────────

/**
 * The three ambient shafts (Medium and up): slabs of sunlit haze along the sun's ray, each through
 * a point `x`, `z` metres (at the eye's storey, `rise` metres over it), `width` metres across,
 * with its own salt for the motes and streaks in it. At the 16:9 rest frame they stand in the open
 * air on the right, beyond the Sisters, and slant down-left through the haze (§2.1).
 */
export const AMBIENT_SHAFTS = Object.freeze([
    Object.freeze({
        x: 27, z: -64, rise: 4, width: 6.3, salt: 0.17,
    }),
    Object.freeze({
        x: 44, z: -60, rise: -2, width: 3.9, salt: 0.53,
    }),
    Object.freeze({
        x: 38, z: -104, rise: 8, width: 9.8, salt: 0.81,
    }),
]);

/**
 * The shafts' light (rainbark-fx.js): a shaft is lit over a span of its length, from `top` metres
 * over the eye (fading in over `soften`) down to `bottom` metres over the mist's top (fading out
 * over the same), brighter where the haze is denser (its density along it, relative to the zone's
 * tide top) and where the mist stands high (`tide`: from low water to high); its light the sun's,
 * forward-scattered toward the eye (g = `g`), times `k`. Across it a soft slab's profile (1 − x²),
 * broken by slow motes (`streaks` across, drifting `drift` metres a second down it). A combo shaft runs from
 * its gap down to `land` metres under the eye, fading over its last `landFade` metres (§4.10), its
 * forward scatter never under `combo.floor` (the Elder's stations stand away from the sun: a chain's
 * beams must read there too), its light times `combo.gain`. No shaft crosses the card: it fades out
 * from `card`[1] (screen fraction) away from the card's rect to [0].
 */
export const SHAFT_LIGHT = Object.freeze({
    top: 34,
    bottom: 4,
    soften: 14,
    tide: Object.freeze([0.7, 1.15]),
    g: 0.55,
    k: 0.32,
    streaks: 1.5,
    drift: 0.6,
    land: 6,
    landFade: 9,
    pearl: 2.2,
    combo: Object.freeze({ gain: 1.6, floor: 0.2 }),
    card: Object.freeze([0.0, 0.04]),
});

// ── The trunks ──────────────────────────────────────────────────────────────────

/**
 * The gentle fluting of every trunk: r(θ, y) = R(y)·(1 + amp·cos(n·θ + φ + twist·y)), so the
 * flutes spiral a little up the bole.
 */
export const TRUNK_FLUTE = Object.freeze({ amp: 0.022, twist: 0.004 });

/** The height (metres) the hero trunks' table positions and radii are given at: level 4's storey. */
export const HERO_REF_Y = 56;

/**
 * The trunks the composition names, at their 16:9 fallback places (§2.3): axis (x, z) and radius
 * at HERO_REF_Y, top (y1), lean (degrees, toward the azimuth `leanTo` in the xz-plane: 180 = −x),
 * flute and buttress-fin counts, fin height h_b. `code` 1–8 draws in the near draw (the
 * event-aware one); 0 in the far draw. `group`: 0 the Elder, 1 the Sisters and R1 on the right,
 * 2 R1 left and middle, 3 the far grove.
 */
export const HERO_TRUNK_FIELDS = Object.freeze([
    'name', 'code', 'group', 'x', 'z', 'radius', 'top', 'taper', 'lean', 'leanTo', 'flutes', 'fins', 'finHeight',
    'finAmp', 'sway',
]);
export const HERO_TRUNKS = Object.freeze([
    // name, code, group, x, z, radius, top, taper, lean, leanTo, flutes, fins, finHeight, finAmp, sway
    ['Elder', 1, 0, -6.05, -9.0, 2.6, 185, 0.452, 2, 180, 11, 4, 11, 2.4, 0.12],
    // The Sisters barely lean (and Sister Two away from her): leaning together, with the pitched
    // lens converging them too, they would close an arch over the open air right of the HUD.
    ['Sister One', 2, 1, 12.9, -24, 1.6, 180, 0.45, 1, 180, 9, 4, 10, 1.5, 0.25],
    // Sister Two stands deep and slim, a clear band of air beyond Sister One on every row.
    ['Sister Two', 3, 1, 43.5, -62, 1.0, 174, 0.42, 0.8, 0, 8, 3, 9, 0.9, 0.3],
    ['R1a', 4, 2, -12.7, -45, 1.5, 178, 0.45, 1.2, 200, 9, 4, 10, 1.4, 0.25],
    ['R1b', 5, 1, 19.1, -48, 1.4, 177, 0.45, 1.5, 150, 8, 3, 9, 1.3, 0.28],
    ['R1c', 0, 2, -30, -50, 1.7, 180, 0.45, 1, 120, 10, 4, 11, 1.6, 0.2],
    // R1d stands past the right edge of every landscape frame (lean and all), so the Sisters'
    // quarter keeps its open, sunlit air.
    ['R1d', 0, 1, 60, -58, 1.6, 178, 0.45, 1.4, 230, 9, 4, 10, 1.5, 0.22],
].map((row) => Object.freeze(Object.fromEntries(HERO_TRUNK_FIELDS.map((key, i) => [key, row[i]])))));

/**
 * The heroes no landscape rest frame shows: the composition keeps R1b out of the open air right
 * of the HUD (behind Sister One she would stand as one colonnade with the Sisters), and R1d stands
 * past the edge. The grove plan neither counts them as cover nor grows limbs from them.
 */
export const REST_HIDDEN = Object.freeze(['R1b', 'R1d']);

/**
 * A trunk's instance record (16 floats, the layout both trunk draws read; §4.2):
 *   aBase (base x, base z, R0 at the floor, taper), aSpan (y0, y1, fin amplitude, fin height),
 *   aLean (lean x, lean z, curve, sway), aCode (code, group, seed, fins·16 + flutes).
 * The table gives the radius at HERO_REF_Y (the trunk's shape) and the axis at `pivotY`: the base
 * is moved so the leaning, bowing spine passes through (x, z) there. The world pivots every trunk
 * at the eye's storey, so a lean never walks a trunk across the frame as the walkway climbs.
 * `seed` is a small integer (it salts shader hashes, which want small inputs).
 */
export function trunkRecord(trunk, seed, out = new Float32Array(16), offset = 0, pivotY = HERO_REF_Y) {
    const y0 = 0;
    const y1 = trunk.top;
    const span = y1 - y0;
    const { taper } = trunk;
    // R(y) = R0·(1 − taper·(y − y0)/span), so the radius at the reference height is the table's.
    const r0 = trunk.radius / Math.max(0.2, 1 - (taper * (HERO_REF_Y - y0)) / span);
    const slope = Math.tan((trunk.lean || 0) * DEG);
    const az = (trunk.leanTo || 0) * DEG;
    const lx = Math.cos(az) * slope;
    const lz = Math.sin(az) * slope;
    // A gentle bow (metres of offset at the top per metre of height), its direction from the seed.
    const curve = (mulberry32(seed * 7919 + 17)() - 0.5) * 0.012;
    const bowAz = trunkBowAzimuth(seed);
    const below = (Number.isFinite(pivotY) ? pivotY : HERO_REF_Y) - y0;
    const bow = (curve * below * below) / span;
    out[offset] = trunk.x - lx * below - Math.cos(bowAz) * bow;
    out[offset + 1] = trunk.z - lz * below - Math.sin(bowAz) * bow;
    out[offset + 2] = r0;
    out[offset + 3] = taper;
    out[offset + 4] = y0;
    out[offset + 5] = y1;
    out[offset + 6] = trunk.finAmp || 0;
    out[offset + 7] = trunk.finHeight || 10;
    out[offset + 8] = lx;
    out[offset + 9] = lz;
    out[offset + 10] = curve;
    out[offset + 11] = trunk.sway || 0;
    out[offset + 12] = trunk.code || 0;
    out[offset + 13] = trunk.group || 0;
    out[offset + 14] = seed;
    out[offset + 15] = (trunk.fins || 0) * 16 + (trunk.flutes || 0);
    return out;
}

/**
 * The direction a trunk bows in (radians in the xz-plane), from its seed by a golden-ratio step:
 * simple enough that the vertex stage derives the same from the record in single precision.
 */
export function trunkBowAzimuth(seed) {
    const x = seed * 0.6180339887;
    return (x - Math.floor(x)) * TAU;
}

/** Floats per trunk record (both trunk draws). */
export const TRUNK_STRIDE = 16;
/** The group code a limb adds to its parent's group (aCode.y). */
export const LIMB_GROUP = 4;

/**
 * The axis of a record at height y (the vertex stage's spine and radius, without sway, flutes
 * or fins): [x, z, radius].
 */
export function recordAxis(record, y, out = [0, 0, 0], offset = 0) {
    const y0 = record[offset + 4];
    const span = Math.max(record[offset + 5] - y0, 1);
    const yy = y - y0;
    const k = yy / span;
    const bowAz = trunkBowAzimuth(Math.floor(record[offset + 14] + 0.5));
    const bow = record[offset + 10] * yy * k;
    out[0] = record[offset] + record[offset + 8] * yy + Math.cos(bowAz) * bow;
    out[1] = record[offset + 1] + record[offset + 9] * yy + Math.sin(bowAz) * bow;
    out[2] = record[offset + 2] * (1 - record[offset + 3] * k);
    return out;
}

const spanAxis = [0, 0, 0];
const spanRow = { rise: 0, scale: 1 };

/**
 * The screen-x span (fractions) a trunk record covers on one screen row of a rest lens, the eye at
 * (eyeX, eyeY, 0): the two tangents of its cross-section there (flutes and buttress fins included
 * as an outer bound). A trunk the eye stands in, or behind the eye, gives [−∞, ∞] / [∞, ∞].
 */
export function trunkSpan(record, lens, sy, eyeY = HERO_REF_Y, eyeX = 0, out = [0, 0], offset = 0) {
    const row = lensRow(lens, sy, spanRow);
    // The height the row meets the trunk at depends on the trunk's depth there (it barely moves).
    let y = eyeY;
    for (let i = 0; i < 3; i++) {
        recordAxis(record, y, spanAxis, offset);
        y = eyeY + Math.max(-spanAxis[1], 0.1) * row.rise;
    }
    recordAxis(record, y, spanAxis, offset);
    const cx = spanAxis[0] - eyeX;
    const cz = spanAxis[1];
    const foot = Math.max(y - record[offset + 4], 0);
    const fins = record[offset + 6] * Math.exp(-Math.min(foot / Math.max(record[offset + 7], 0.5), 30));
    const radius = spanAxis[2] * (1 + TRUNK_FLUTE.amp) + fins;
    const d = Math.hypot(cx, cz);
    if (!(cz < 0) || d <= radius) {
        out[0] = cz < 0 ? -Infinity : Infinity;
        out[1] = Infinity;
        return out;
    }
    const phi = Math.atan2(cx, -cz);
    const alpha = Math.asin(radius / d);
    const lo = Math.max(phi - alpha, -1.5);
    const hi = Math.min(phi + alpha, 1.5);
    const k = (0.5 * row.scale) / lens.tanH;
    out[0] = 0.5 + Math.tan(lo) * k;
    out[1] = 0.5 + Math.tan(hi) * k;
    return out;
}

/**
 * How a limb grows (§4.2 limbs, as the A2 reviews amend them): its base is at most BASE times its
 * parent's radius there, its tip at least TIP times its base (a limb that tapers to a hairline
 * reads as a wire), and a collar flares it into the bole (COLLAR times its base, fading over FLARE
 * metres past where it leaves the parent's bark). It bows gently toward the vertical: its sag off
 * the straight line from foot to tip is at most BOW times its length, and its tip climbs at most
 * TURN degrees steeper than its foot (it never hooks upright like a tusk).
 */
export const LIMB_SHAPE = Object.freeze({
    base: 0.45, tip: 0.5, collar: 0.8, flare: 1.6, bow: 0.06, turn: 15,
});
/**
 * A limb's tip ends this far over the canopy plane (metres): the tube is clamped at the plane, so
 * every limb ends on it, where it has melted into the leaves, never in open air below it.
 */
export const LIMB_TIP_OVER = 0.3;
/** Samples a hero limb's card check takes from its foot to where it leaves its parent's bark. */
const LIMB_FOOT_SAMPLES = 4;

/**
 * The curve a limb record bows by (record[10]: the spine's offset along its azimuth grows as
 * run·h + curve·h²/span), the most LIMB_SHAPE allows for a limb `length` metres long rising at
 * `elevation` degrees, times `lift` (0..1).
 */
export function limbCurve(length, elevation, lift) {
    const el = Math.max(10, Math.min(80, elevation)) * DEG;
    const run = 1 / Math.tan(el);
    const span = Math.max(length * Math.sin(el), 1e-3);
    // The tip's horizontal slope, run + 2·curve, never under cot(el + turn); the sag off the
    // chord, |curve|·span/4, never over bow·length.
    const steep = Math.max(0, run - 1 / Math.tan(Math.min(el + LIMB_SHAPE.turn * DEG, 89 * DEG))) / 2;
    const sag = (4 * LIMB_SHAPE.bow * length) / span;
    return -Math.max(0, Math.min(1, lift)) * Math.min(steep, sag);
}

/**
 * A limb's instance record: a tapering branch rising out of its parent's spine at height y, up
 * and out at `elevation` degrees toward its seed's azimuth (trunkBowAzimuth, radians in the
 * xz-plane), `length` metres long, curving gently up toward its tip (limbCurve). It is drawn as a trunk whose spine
 * leans by cot(elevation); its bow points straight back along the limb, so the bow lifts it.
 * Code 0 (the far draw), group parent + LIMB_GROUP, no fins: the fin amplitude and height hold its
 * collar instead (a ring all round, its height measured from the limb's foot).
 */
export function limbRecord(limb, parent, out = new Float32Array(TRUNK_STRIDE), offset = 0, parentOffset = 0) {
    const axis = recordAxis(parent, limb.y, spanAxis, parentOffset);
    const el = Math.max(10, Math.min(80, limb.elevation)) * DEG;
    const rise = limb.length * Math.sin(el);
    const run = 1 / Math.tan(el);
    const az = trunkBowAzimuth(limb.seed);
    const base = Math.min(limb.radius, axis[2] * LIMB_SHAPE.base);
    // Where the limb leaves its parent's bark (metres above its foot): the collar flares there.
    const exit = axis[2] * Math.tan(el);
    out[offset] = axis[0];
    out[offset + 1] = axis[1];
    out[offset + 2] = base;
    out[offset + 3] = Math.min(limb.taper, 1 - LIMB_SHAPE.tip);
    out[offset + 4] = limb.y;
    out[offset + 5] = limb.y + rise;
    out[offset + 6] = base * LIMB_SHAPE.collar;
    out[offset + 7] = exit + LIMB_SHAPE.flare;
    out[offset + 8] = Math.cos(az) * run;
    out[offset + 9] = Math.sin(az) * run;
    // The bow points along the limb (its seed's azimuth): a negative curve bends the tip upward.
    out[offset + 10] = limbCurve(limb.length, limb.elevation, limb.lift);
    out[offset + 11] = 0;
    out[offset + 12] = 0;
    out[offset + 13] = (Math.round(parent[parentOffset + 13]) % LIMB_GROUP) + LIMB_GROUP;
    out[offset + 14] = limb.seed;
    out[offset + 15] = limb.flutes;
    return out;
}

/**
 * Where a world point shows through a rest lens with the eye at (0, eyeY, 0): screen fractions
 * (x, y; y down), or NaN for a point not in front of the eye. The inverse of lensRow.
 */
export function projectRest(lens, x, y, z, eyeY, out = [0, 0]) {
    const D = -z;
    if (!(D > 0.1)) {
        out[0] = NaN;
        out[1] = NaN;
        return out;
    }
    const rise = (y - eyeY) / D;
    const yt = (rise * lens.c - lens.s) / (lens.c + rise * lens.s);
    const scale = lens.c - yt * lens.s;
    out[0] = 0.5 + (0.5 * (x / D) * scale) / lens.tanH;
    out[1] = 0.5 * (1 - yt / lens.tanV);
    return out;
}

// ── The grove plan ──────────────────────────────────────────────────────────────

/**
 * The 21:9 Twin (§2.5): a fused pair standing at the right edge only in an ultrawide frame. Far
 * draw (code 0), the right-hand group. (x, z) is its 21:9 place; Twin B keeps its offset from Twin A.
 */
export const TWIN_TRUNKS = Object.freeze([
    // One fused silhouette (the two boles overlap and barely part as they rise), deep beyond the
    // Sisters; the solver stands it a band of air right of Sister Two.
    ['Twin A', 0, 1, 40.5, -52, 1.2, 178, 0.45, 1.0, 190, 8, 3, 9, 1.1, 0.26],
    ['Twin B', 0, 1, 41.8, -52, 0.9, 176, 0.45, 1.2, 350, 7, 3, 8, 0.8, 0.3],
].map((row) => Object.freeze(Object.fromEntries(HERO_TRUNK_FIELDS.map((key, i) => [key, row[i]])))));
/** The Twin's two seeds (its patch hashes and bow). */
export const TWIN_SEEDS = Object.freeze([311, 577]);

/**
 * The far grove's ranks behind R1 (§2.3): depth (metres in front of the eye), radius at
 * HERO_REF_Y, the most trunks the plan stands in each (a tier takes the first of each), and the
 * bark group: every far rank is the far group, R2 too (§2.3 puts R2 with the left R1, but that
 * group's patches cycle at the near ranks' pace, and the 70 m rank's bark, much of it in view at
 * 21:9 and behind the Elder, would add a wrap every few seconds: GROUP_CYCLE).
 * `keepOut`: stays out of the card band (card ± GROVE_CARD_MARGIN) at the 16:9 and 21:9
 * fallbacks; `aisle`: keeps out of the aisle of light behind the HUD (groveAisle: from the card
 * band to the HUD's far side, the HUD ± GROVE_HUD_MARGIN within it) at both; `sisters`: out of
 * the Sisters' quarter (the open air right of the HUD, where a near rank would only crowd the
 * Sisters); `behindCard`: at most this many in the card band; `lane`: the first trunk tries the
 * left air lane (between the Elder and the card) first, so the 70 m rank shows as a rank of its
 * own where the grove's mass recedes; `sunSide`: the share of its density right of
 * GROVE_SUN_SIDE (the deep ghosts thin out toward the sunlit right). R5 is the deepest rank, only
 * for the tiers with trunks to spare.
 */
const rankRule = (rank, depth, radius, count, rules) => Object.freeze({
    rank, depth: Object.freeze(depth), radius: Object.freeze(radius), count, ...rules,
});
/** The aisle behind the HUD at the 16:9 fallback (screen fractions). */
export const GROVE_AISLE = Object.freeze([0.61, 0.72]);
export const GROVE_RANKS = Object.freeze([
    rankRule(2, [62, 82], [0.9, 2.6], 8, {
        group: 3, keepOut: true, aisle: true, sisters: true, behindCard: 0, lane: true, sunSide: 1,
    }),
    rankRule(3, [100, 125], [1.1, 3.0], 10, {
        group: 3, keepOut: false, aisle: true, sisters: true, behindCard: 2, lane: false, sunSide: 1,
    }),
    rankRule(4, [150, 185], [1.8, 2.6], 12, {
        group: 3, keepOut: false, aisle: false, sisters: false, behindCard: 99, lane: false, sunSide: 0.5,
    }),
    rankRule(5, [205, 250], [2.0, 2.8], 17, {
        group: 3, keepOut: false, aisle: false, sisters: false, behindCard: 99, lane: false, sunSide: 0.5,
    }),
]);

/**
 * The screen bands (16:9 fallback) of the Sisters' quarter (out to what a 21:9 frame adds beyond
 * the 16:9 edge), and the card's margin.
 */
export const GROVE_SISTERS = Object.freeze([0.72, 1.12]);
/**
 * The open air no rank stands in (16:9 fallback): the band right of the HUD and the band between
 * the Sisters, which the composition keeps clear (HUD_AIR, SISTER_GAP).
 */
export const GROVE_OPEN_AIR = Object.freeze([Object.freeze([0.708, 0.748]), Object.freeze([0.878, 0.92])]);
export const GROVE_CARD_MARGIN = 0.02;
/** No near rank's silhouette comes closer than this to the HUD (screen fraction). */
export const GROVE_HUD_MARGIN = 0.01;
/** The left air lane (16:9 fallback, between the Elder and the card band) R2's first trunk tries. */
export const GROVE_LANE = Object.freeze([0.29, 0.385]);
/** Right of this (16:9 fallback) the deep ranks thin out (GROVE_RANKS `sunSide`). */
export const GROVE_SUN_SIDE = 0.6;
/** The fallback frames the grove's keep-outs are judged in: 1920 × 1080 and 2560 × 1080 (21:9). */
export const GROVE_FRAMES = Object.freeze([16 / 9, 64 / 27]);

/**
 * The aisle of light behind the HUD in a frame (screen fractions): from the card band's right edge
 * to the HUD's far side, the HUD ± GROVE_HUD_MARGIN within it (and the whole of GROVE_AISLE at
 * 16:9), so no near rank stands under the HUD or between it and the card (a 70 m trunk is
 * wider on screen than the gap between them: it would only be cut by one or the other).
 */
export function groveAisle(card, hud, aspect) {
    const lo = Math.min(card.x1 + GROVE_CARD_MARGIN, hud.x0 - GROVE_HUD_MARGIN);
    const hi = hud.x1 + GROVE_HUD_MARGIN;
    if (Math.abs(aspect - 16 / 9) < 0.01) return [Math.min(lo, GROVE_AISLE[0]), Math.max(hi, GROVE_AISLE[1])];
    return [lo, hi];
}
/** Azimuth reach of the plan (degrees either side): a 21:9 frame sees ±44°. */
export const GROVE_REACH = 44;
/**
 * Density of the grove behind the Elder (left of GROVE_ELDER_EDGE in the 16:9 frame: hidden at
 * every aspect, there only for the limbs that reach out of it) and beyond the frame's right edge
 * (what 21:9 adds), against the open frame's own.
 */
export const GROVE_BEHIND = 0.12;
export const GROVE_BEYOND = 0.3;
export const GROVE_ELDER_EDGE = 0.25;
/**
 * Trunks a 16:9 frame shows stand at least this far apart on screen (eye's row), so each rank
 * reads as its own silhouette and the lane left of the card never mats into one muddy band.
 */
export const GROVE_SEPARATION = 0.012;
/** A planned trunk the 16:9 frame shows only this much of (nearer trunks in front) is moved. */
export const GROVE_HIDDEN = 0.6;
/** Trunk axes stand at least this many times the sum of their radii apart. */
export const GROVE_SPACING = 2.5;
/**
 * The near ranks (up to `ranks`) lean `deg`[0] … [1] degrees sideways to the eye (either way, ±25°
 * off square), so the grove is never a colonnade of plumb poles; no two trunks a 16:9 frame shows
 * swap order between its `rows` (top, bottom), so none lean into an X.
 */
export const GROVE_LEAN = Object.freeze({ ranks: 3, deg: Object.freeze([0.6, 1.6]), rows: Object.freeze([0.02, 0.98]) });

/**
 * The near ranks (up to `ranks`) stand in clumps, never at an even pitch: across the 16:9 frame
 * (from `span`[0] to [1]) a trunk is accepted `floor` as often away from its rank's `count` clump
 * centres (hashed per rank) as at one, falling off over `width` (screen fractions), and only
 * `open` as often in the `gap` (the gold air's opening behind the card's right half).
 */
export const GROVE_CLUMPS = Object.freeze({
    ranks: 3,
    count: 4,
    span: Object.freeze([0.26, 1.0]),
    width: 0.045,
    floor: 0.12,
    gap: Object.freeze([0.47, 0.6]),
    open: 0.3,
});

/** How often a near-rank trunk is accepted at screen x `sx` (GROVE_CLUMPS), 1 elsewhere. */
function clumped(rank, sx) {
    const K = GROVE_CLUMPS;
    if (rank > K.ranks || sx < K.span[0] || sx > K.span[1]) return 1;
    const hash = mulberry32(Math.imul(rank, 0x2f6b9d1) >>> 0);
    let near = 0;
    for (let i = 0; i < K.count; i++) {
        const c = K.span[0] + (K.span[1] - K.span[0]) * hash();
        near = Math.max(near, Math.exp(-(((sx - c) / K.width) ** 2)));
    }
    const gap = sx > K.gap[0] && sx < K.gap[1] ? K.open : 1;
    return (K.floor + (1 - K.floor) * near) * gap;
}

/**
 * A lean's azimuth (degrees, as trunkRecord reads leanTo) square across the line from the eye to a
 * trunk at (x, z), to one side or the other and up to 25° off square, from one uniform draw `h`.
 */
function sideways(x, z, h) {
    const side = h < 0.5 ? -1 : 1;
    const jitter = (((h * 2) % 1) - 0.5) * 50;
    return (Math.atan2(side * x, -side * z) / DEG) + jitter;
}

/**
 * How many trunks a tier stands in each far rank (R2, R3, R4, R5): what the tier's trunk count
 * leaves after the composition's seven, shared among the ranks in the proportions 8 : 10 : 12
 * (R4 only from Medium up), and anything past 30 in R5.
 */
export function groveCounts(tier) {
    const n = Math.max(0, Math.round(Number(tier?.trunks) || 0) - HERO_TRUNKS.length);
    if (n > 30) return [8, 10, 12, Math.min(GROVE_RANKS[3].count, n - 30)];
    const deep = n >= 15;
    const total = deep ? 30 : 18;
    const r2 = Math.round((n * 8) / total);
    const r3 = deep ? Math.round((n * 10) / total) : n - r2;
    return [r2, r3, deep ? n - r2 - r3 : 0, 0];
}

/** The limbs of the full plan, in the order a tier takes them, and the longest a limb grows (m). */
const LIMB_MAX = 36;
const LIMB_REACH = 40;
/** The limbs a tier asks for (at most LIMB_MAX). */
function limbsWanted(tier) {
    return Math.max(0, Math.min(LIMB_MAX, Math.round(Number(tier?.limbs) || 0)));
}

const planRecord = new Float32Array(TRUNK_STRIDE);
const planSpan = [0, 0];

/** Laid plans by seed and tier (a quality change back to a tier already seen is free). */
const PLANS = new Map();

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

/**
 * The grove (§2.3 seeded rules), the same for the same seed and tier:
 *  - heroes: every trunk the composition names (HERO_TRUNKS) with its seed;
 *  - trunks: the far draw's grove: R1c and R1d, then the ranks R2 … R5, each trunk with its seed,
 *    group (3), rank, lean, taper, top, flutes and buttress fins (count 3–5, height 8–14 m);
 *  - limbs: branches off the parents' spines high on the bole, up and out into the canopy
 *    (planLimbs).
 * The full plan is laid once; a tier takes the first trunks of each rank and the first limbs, so
 * a lower tier's grove is part of a higher one's. Rules: axes at least GROVE_SPACING·(Ra + Rb)
 * apart (heroes at their 16:9 places included); the left half of the frame twice as dense as the
 * right, so the grove recedes on a diagonal (the deep ranks thinner still toward the sunlit
 * right); at the 16:9 and 21:9 fallbacks R2 keeps out of the card band and both R2 and R3 out of
 * the aisle behind the HUD (groveAisle), at most two R3 behind the card, neither in the Sisters'
 * quarter. Within a rank the trunks a 16:9 frame shows (not behind the Elder or a nearer trunk)
 * come first. A plan is laid once per seed and tier (the same frozen object comes back).
 * @param {number} seed
 * @param {{ trunks: number, limbs: number }} tier  a content tier (rainbark-quality.js)
 */
export function planGrove(seed, tier) {
    const base = (Number(seed) >>> 0) || 1;
    const counts = groveCounts(tier);
    const key = `${base}:${counts.join(',')}:${limbsWanted(tier)}`;
    if (!PLANS.has(key)) PLANS.set(key, deepFreeze(layGrove(base, counts, tier)));
    return PLANS.get(key);
}

/** The fallback frames (GROVE_FRAMES) as the plan measures them: lens, card rows, bands. */
const PLAN_FRAMES = GROVE_FRAMES.map((aspect) => {
    const H = 1080;
    const card = fallbackCard(aspect * H, H);
    const hud = fallbackHud(aspect * H, H);
    return {
        aspect,
        lens: restLens(aspect),
        rows: [card.y0, (card.y0 + card.y1) / 2, card.y1],
        band: [card.x0 - GROVE_CARD_MARGIN, card.x1 + GROVE_CARD_MARGIN],
        aisle: groveAisle(card, hud, aspect),
    };
});

function layGrove(base, counts, tier) {
    const heroRand = mulberry32(base);
    const heroes = HERO_TRUNKS.map((trunk) => ({ trunk, seed: 1 + Math.floor(heroRand() * 999) }));
    // The 16:9 fallback (as world.setLayout gives it) measures what the frame shows; every
    // fallback frame measures the keep-outs.
    const { lens } = PLAN_FRAMES[0];
    const placed = heroes.map(({ trunk }) => ({ x: trunk.x, z: trunk.z, radius: trunk.radius }));
    // What the 16:9 frame's nearer trunks already cover on the eye's row (the Elder aside: what
    // stands behind her is there for wider frames).
    const sy = eyeRow(lens);
    const cover = [];
    const cast = (trunk, trunkSeed) => {
        trunkRecord(trunk, trunkSeed, planRecord, 0, HERO_REF_Y);
        trunkSpan(planRecord, lens, sy, HERO_REF_Y, 0, planSpan);
        cover.push({ x0: planSpan[0], x1: planSpan[1], depth: -trunk.z });
    };
    heroes.forEach(({ trunk, seed: s }) => {
        if (trunk.group !== 0 && !REST_HIDDEN.includes(trunk.name)) cast(trunk, s);
    });
    const hidden = (trunk, trunkSeed) => {
        trunkRecord(trunk, trunkSeed, planRecord, 0, HERO_REF_Y);
        trunkSpan(planRecord, lens, sy, HERO_REF_Y, 0, planSpan);
        const [a, b] = planSpan;
        let covered = 0;
        cover.forEach((c) => {
            if (c.depth < -trunk.z) covered += Math.max(0, Math.min(b, c.x1) - Math.max(a, c.x0));
        });
        return covered > GROVE_HIDDEN * (b - a);
    };
    // A trunk's widest span over a frame's card rows.
    const span = (trunk, trunkSeed, frame, out) => {
        trunkRecord(trunk, trunkSeed, planRecord, 0, HERO_REF_Y);
        let lo = Infinity;
        let hi = -Infinity;
        frame.rows.forEach((row) => {
            trunkSpan(planRecord, frame.lens, row, HERO_REF_Y, 0, planSpan);
            lo = Math.min(lo, planSpan[0]);
            hi = Math.max(hi, planSpan[1]);
        });
        out[0] = lo;
        out[1] = hi;
        return out;
    };
    const overlaps = (s, range) => s[1] > range[0] && s[0] < range[1];
    // What the 16:9 frame shows on the eye's row (the heroes it shows, then each trunk placed in
    // view): a new trunk in view keeps GROVE_SEPARATION from all of it.
    const seen = [];
    heroes.forEach(({ trunk, seed: s }) => {
        if (REST_HIDDEN.includes(trunk.name)) return;
        trunkRecord(trunk, s, planRecord, 0, HERO_REF_Y);
        trunkSpan(planRecord, lens, sy, HERO_REF_Y, 0, planSpan);
        seen.push({ x0: trunk.group === 0 ? -Infinity : planSpan[0], x1: planSpan[1] });
    });
    const crowded = (trunk) => {
        trunkRecord(trunk, trunk.seed, planRecord, 0, HERO_REF_Y);
        trunkSpan(planRecord, lens, sy, HERO_REF_Y, 0, planSpan);
        const [a, b] = planSpan;
        return seen.some((o) => a < o.x1 + GROVE_SEPARATION && b > o.x0 - GROVE_SEPARATION);
    };
    const s16 = [0, 0];
    const sAny = [0, 0];
    const elderEdge = GROVE_ELDER_EDGE + 0.03;
    // Where each trunk the frame shows stands at its top and bottom rows (its span's middle): a new
    // one keeps its order against each of them at both, so no two lean into an X.
    const ends = [];
    const endsOf = (trunk, trunkSeed, out) => {
        trunkRecord(trunk, trunkSeed, planRecord, 0, HERO_REF_Y);
        trunkSpan(planRecord, lens, GROVE_LEAN.rows[0], HERO_REF_Y, 0, planSpan);
        out[0] = (planSpan[0] + planSpan[1]) / 2;
        trunkSpan(planRecord, lens, GROVE_LEAN.rows[1], HERO_REF_Y, 0, planSpan);
        out[1] = (planSpan[0] + planSpan[1]) / 2;
        return out;
    };
    heroes.forEach(({ trunk, seed: s }) => {
        if (trunk.group !== 0 && !REST_HIDDEN.includes(trunk.name)) ends.push(endsOf(trunk, s, [0, 0]));
    });
    const candidateEnds = [0, 0];
    const crosses = (trunk) => {
        endsOf(trunk, trunk.seed, candidateEnds);
        return ends.some((e) => Math.sign(candidateEnds[0] - e[0]) !== Math.sign(candidateEnds[1] - e[1]));
    };
    const ranks = GROVE_RANKS.map((rule) => {
        const rand = mulberry32((base ^ Math.imul(rule.rank, 0x9e3779b1)) >>> 0);
        const list = [];
        let behind = 0;
        for (let i = 0; i < rule.count; i++) {
            let trunk = null;
            // The rank's first trunk tries the left air lane first (it may not fit there).
            const laneTries = rule.lane && i === 0 ? 300 : 0;
            for (let attempt = 0; attempt < 600 + laneTries && !trunk; attempt++) {
                const inLane = attempt < laneTries;
                const late = attempt - laneTries;
                // Sampled across the 16:9 frame's x: the left half twice as dense as the right;
                // behind the Elder (who covers the same share of every frame) and beyond the
                // right edge (what 21:9 adds) sparser, the deep ranks thinner toward the sun; the
                // reach widens if a rank cannot fit.
                const reach = Math.tan((GROVE_REACH + Math.floor(Math.max(late, 0) / 200) * 10) * DEG) / lens.tanH;
                const sx = inLane
                    ? lerp(GROVE_LANE[0], GROVE_LANE[1], rand())
                    : 0.5 + reach * (2 * rand() - 1) * 0.5;
                const beyond = sx > 1 ? GROVE_BEYOND : 1;
                const sunny = sx > GROVE_SUN_SIDE ? rule.sunSide : 1;
                const weight = (sx < 0.5 ? 2 : 1) * (sx < GROVE_ELDER_EDGE ? GROVE_BEHIND : beyond) * sunny
                    * clumped(rule.rank, sx);
                if (!inLane && rand() * 2 > weight) continue;
                const phi = Math.atan((sx - 0.5) * 2 * lens.tanH);
                const depth = lerp(rule.depth[0], rule.depth[1], rand());
                const radius = lerp(rule.radius[0], rule.radius[1], rand());
                const candidate = {
                    name: `R${rule.rank}.${i + 1}`,
                    code: 0,
                    group: rule.group,
                    rank: rule.rank,
                    x: depth * Math.tan(phi),
                    z: -depth,
                    radius,
                    top: 178 + 14 * rand(),
                    taper: 0.38 + 0.12 * rand(),
                    lean: rule.rank <= GROVE_LEAN.ranks ? GROVE_LEAN.deg[0] + (GROVE_LEAN.deg[1] - GROVE_LEAN.deg[0]) * rand()
                        : 0.4 + 1.8 * rand(),
                    leanTo: rule.rank <= GROVE_LEAN.ranks ? sideways(depth * Math.tan(phi), -depth, rand()) : 360 * rand(),
                    flutes: 7 + Math.floor(rand() * 5),
                    fins: 3 + Math.floor(rand() * 3),
                    finHeight: 8 + 6 * rand(),
                    finAmp: radius * (0.7 + 0.3 * rand()),
                    sway: 0.15 + 0.2 * rand(),
                    seed: 1 + Math.floor(rand() * 999),
                };
                span(candidate, candidate.seed, PLAN_FRAMES[0], s16);
                const inBand = overlaps(s16, PLAN_FRAMES[0].band);
                const clear = placed.every((p) => Math.hypot(p.x - candidate.x, p.z - candidate.z)
                    >= GROVE_SPACING * (p.radius + candidate.radius));
                const inFrame = s16[1] > elderEdge && s16[0] < 1;
                // A trunk the frame would show only behind a nearer one is better stood elsewhere.
                const behindNearer = inFrame && hidden(candidate, candidate.seed);
                // The keep-outs, in every fallback frame.
                const kept = PLAN_FRAMES.every((frame) => {
                    const s = frame === PLAN_FRAMES[0] ? s16 : span(candidate, candidate.seed, frame, sAny);
                    return !(rule.keepOut && overlaps(s, frame.band)) && !(rule.aisle && overlaps(s, frame.aisle));
                });
                if (clear
                    && kept
                    && !(inLane && !(inFrame && !behindNearer))
                    && !(behindNearer && late < 400)
                    && !(inFrame && !behindNearer && crowded(candidate))
                    && !(inFrame && !behindNearer && crosses(candidate))
                    && !(rule.sisters && overlaps(s16, GROVE_SISTERS))
                    && !GROVE_OPEN_AIR.some((air) => overlaps(s16, air))
                    && !(inBand && behind >= rule.behindCard)) {
                    trunk = candidate;
                    trunk.visible = inFrame && !behindNearer;
                    if (inBand) behind += 1;
                }
            }
            if (trunk) {
                placed.push(trunk);
                list.push(trunk);
                cast(trunk, trunk.seed);
                if (trunk.visible) {
                    seen.push({ x0: planSpan[0], x1: planSpan[1] });
                    ends.push(endsOf(trunk, trunk.seed, [0, 0]));
                }
            }
        }
        // What a 16:9 frame shows first (a stable partition), so a small tier's few trunks show.
        return [...list.filter((t) => t.visible), ...list.filter((t) => !t.visible)];
    });
    const trunks = heroes.filter(({ trunk }) => trunk.code === 0).map(({ trunk, seed: s }) => ({
        ...trunk, rank: 1, seed: s,
    }));
    const standing = ranks.map((list, r) => list.slice(0, counts[r]));
    standing.forEach((list) => list.forEach((trunk) => trunks.push(trunk)));
    return {
        seed: base, heroes, trunks, limbs: planLimbs(base, heroes, standing, ranks, tier),
    };
}

/** The storeys limbs are judged from: the Limb Storey (where they first cross overhead), Crown Light, level 4. */
const LIMB_EYE = 128;
const LIMB_CROWN_EYE = 152;
/** The lenses a limb must read in: 16:9 and an upright phone, and the rows of each reference frame. */
const LIMB_LENSES = [restLens(16 / 9), restLens(0.46)];
const LIMB_ROWS = [1080, 844];
/**
 * The views a limb is judged in: each lens from the Limb Storey, 16:9 from Crown Light, and the
 * phone from level 4 (it looks up into the crown above the card).
 */
const LIMB_VIEWS = [
    { lens: 0, eye: LIMB_EYE }, { lens: 1, eye: LIMB_EYE }, { lens: 0, eye: LIMB_CROWN_EYE },
    { lens: 1, eye: HERO_REF_Y },
];
/** Where a limb leaves its parent (metres up the bole). */
const LIMB_FOOT = [130, 154];
/** A limb drawn thinner than this (pixels across at its middle, in any view that shows it) reads as a wire. */
const LIMB_MIN_PX = 1.5;
/** A limb's path keeps this clear (screen fraction) of any trunk nearer than 1.6 × its parent's depth. */
const LIMB_CLEAR = 0.02;
/** How far a trunk's silhouette can stray from its eye-row span up the frame (lean, convergence). */
const LIMB_QUICK = 0.15;
/** Two limbs whose paths on screen run closer to parallel than this read as rails. */
const LIMB_PARALLEL = 5 * DEG;
/** Azimuth draws per limb (a hero's; a far trunk's, which is dropped if none passes). */
const LIMB_TRIES = 40;
const LIMB_FAR_TRIES = 16;
/** A limb's path on screen leans at least this far from the vertical (as a tangent). */
const LIMB_SPREAD = Math.tan(18 * DEG);
const LIMB_SAMPLES = 6;
const limbPlanRecord = new Float32Array(TRUNK_STRIDE);
const limbPlanParent = new Float32Array(TRUNK_STRIDE);
const limbPlanAxis = [0, 0, 0];
const limbPlanPoint = [0, 0];
const limbPlanSpan = [0, 0];

/** True when two screen segments ({ x0, y0, x1, y1 }) cross. */
function segmentsCross(a, b) {
    const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const d1 = side(b.x0, b.y0, b.x1, b.y1, a.x0, a.y0);
    const d2 = side(b.x0, b.y0, b.x1, b.y1, a.x1, a.y1);
    const d3 = side(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0);
    const d4 = side(a.x0, a.y0, a.x1, a.y1, b.x1, b.y1);
    return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The thinnest a limb record shows (pixels across at its middle) in any judged view whose frame
 * holds its middle; Infinity when none does.
 */
function limbThinnest(record) {
    const mid = record[4] + (record[5] - record[4]) / 2;
    recordAxis(record, mid, limbPlanAxis);
    const [x, z, r] = limbPlanAxis;
    let least = Infinity;
    LIMB_VIEWS.forEach((view) => {
        const lens = LIMB_LENSES[view.lens];
        projectRest(lens, x, mid, z, view.eye, limbPlanPoint);
        const [px, py] = limbPlanPoint;
        if (!(px > 0 && px < 1 && py > 0 && py < 1)) return;
        const dist = Math.hypot(x, mid - view.eye, z);
        least = Math.min(least, ((2 * r) / dist) * ((0.5 * LIMB_ROWS[view.lens]) / lens.tanV));
    });
    return least;
}

/**
 * The limbs: round one gives each hero trunk a rest frame shows one (and R1c), round two another
 * to the big boles (the Elder, Sister One, R1c), then one on each standing R2, R3 and R4 trunk in
 * turn; a tier takes the first `tier.limbs` that stand (there may be fewer: risk 17 lets the limb
 * count fall until the canopy stage).
 * Each limb leaves its parent at 130–154 m, 35–55° up and out, and ends on the canopy plane
 * (LIMB_TIP_OVER over it, the tube clamped there), having melted into its leaves over the last of
 * its length (a limb never ends in open air); its foot is drawn high enough that it is never longer than LIMB_REACH. Its azimuth is
 * its seed's bow, drawn until it reads as a branch (judged in LIMB_VIEWS):
 *  - never toward the eye (a near one would come at the camera); a hero's grows outward, away
 *    from the card, and R1a's never reaches back across the lane toward the Elder on screen;
 *  - leaning at least 18° from the vertical on screen (straight up beside its trunk it would read
 *    as a second bole);
 *  - its path on screen crosses no other trunk nearer than 1.6 times its parent's depth (a limb
 *    running into a neighbour reads as a rung between two poles), crosses no limb already
 *    placed and runs no closer than LIMB_PARALLEL to parallel with one near it (rails, pipework).
 * When no draw passes, a hero's first limb with the fewest faults stands and any other is
 * dropped; so is any limb thinner than LIMB_MIN_PX in a view that shows it.
 * @param {number} base      the plan's seed
 * @param {object[]} heroes  the plan's heroes ({ trunk, seed })
 * @param {object[][]} ranks the trunks each far rank stands on this tier (the limbs' parents)
 * @param {object[][]} all   every rank's full list (what a limb must not cross)
 * @param {object} tier
 */
function planLimbs(base, heroes, ranks, all, tier) {
    const want = limbsWanted(tier);
    if (!want) return [];
    const rand = mulberry32((base ^ 0x51ed27) >>> 0);
    const shown = heroes.filter(({ trunk }) => !REST_HIDDEN.includes(trunk.name));
    const parents = [];
    // The two big boles grow a second limb (a slim one's second would run beside its first).
    shown.forEach((hero) => parents.push(hero));
    shown.filter(({ trunk }) => trunk.radius >= 1.6).forEach((hero) => parents.push(hero));
    ranks.slice(0, 3).forEach((list) => list.forEach((trunk) => parents.push({ trunk, seed: trunk.seed })));
    // Every trunk a limb might cross, stood at the judging storey, if either lens shows it.
    const others = [];
    [...shown, ...all.flat().map((trunk) => ({ trunk, seed: trunk.seed }))].forEach(({ trunk, seed }) => {
        const record = trunkRecord(trunk, seed, new Float32Array(TRUNK_STRIDE), 0, LIMB_EYE);
        // Its span on each lens's eye row (a quick test before the exact one on a sample's row).
        const spans = LIMB_LENSES.map((lens) => trunkSpan(record, lens, eyeRow(lens), LIMB_EYE, 0, [0, 0]));
        const seen = spans.some(([a, b]) => b > -0.05 && a < 1.05);
        if (seen) {
            others.push({
                name: trunk.name, depth: -trunk.z, record, spans,
            });
        }
    });
    const paths = [];
    const limbs = [];
    // The faults of a limb record grown from `parent`: crossings, then near-parallel runs; its
    // paths (per view: first and last point on screen) are left in `trial`. Counting stops once
    // it reaches `bound` (a draw that cannot beat the best so far).
    const trial = LIMB_VIEWS.map(() => ({
        on: false, x0: 0, y0: 0, x1: 0, y1: 0,
    }));
    let backward = false;
    let hero = false;
    // (Whether the last limb judged crosses the card in any view, its foot inside its parent too.)
    let acrossCard = false;
    const card = fallbackCard(1920, 1080);
    const faults = (parent, limb, bound = Infinity) => {
        limbRecord(limb, limbPlanParent, limbPlanRecord);
        const exit = limbPlanRecord[7] - LIMB_SHAPE.flare;
        const rise = limbPlanRecord[5] - limbPlanRecord[4];
        let count = 0;
        acrossCard = false;
        LIMB_VIEWS.forEach((view, l) => {
            if (count >= bound) return;
            const lens = LIMB_LENSES[view.lens];
            const path = trial[l];
            path.on = false;
            const crossed = new Set();
            let overCard = false;
            // (From its foot, inside its parent, to where it leaves the bark: on screen it is still
            // the limb's own line.)
            if (hero && view.lens === 0) {
                for (let j = 0; j < LIMB_FOOT_SAMPLES; j++) {
                    const y = limbPlanRecord[4] + (exit * j) / LIMB_FOOT_SAMPLES;
                    recordAxis(limbPlanRecord, y, limbPlanAxis);
                    projectRest(lens, limbPlanAxis[0], y, limbPlanAxis[1], view.eye, limbPlanPoint);
                    const [px, py] = limbPlanPoint;
                    if (px > 0 && px < 1 && py > 0 && px > card.x0 - 0.02 && px < card.x1 + 0.02 && py > card.y0 - 0.02) {
                        overCard = true;
                    }
                }
            }
            for (let j = 0; j <= LIMB_SAMPLES; j++) {
                const y = limbPlanRecord[4] + exit + ((rise - exit) * j) / LIMB_SAMPLES;
                recordAxis(limbPlanRecord, y, limbPlanAxis);
                projectRest(lens, limbPlanAxis[0], y, limbPlanAxis[1], view.eye, limbPlanPoint);
                const [px, py] = limbPlanPoint;
                // Its whole path (on screen or above it: the frame climbs over the levels) for
                // its direction; only what is on screen for what it crosses.
                if (!(px > -0.2 && px < 1.2 && py > -1.5 && py < 1)) continue;
                if (!path.on) {
                    path.on = true;
                    path.x0 = px;
                    path.y0 = py;
                }
                path.x1 = px;
                path.y1 = py;
                if (!(px > 0 && px < 1 && py > 0)) continue;
                // A hero's limbs never cross the card (16:9 fallback, judged in its own lens).
                if (hero && view.lens === 0 && px > card.x0 - 0.02 && px < card.x1 + 0.02 && py > card.y0 - 0.02) {
                    overCard = true;
                }
                others.forEach((o) => {
                    if (o.name === parent.name || crossed.has(o.name) || o.depth > 1.6 * -parent.z) return;
                    const [a, b] = o.spans[view.lens];
                    if (px < a - LIMB_QUICK || px > b + LIMB_QUICK) return;
                    trunkSpan(o.record, lens, py, view.eye, 0, limbPlanSpan);
                    if (px > limbPlanSpan[0] - LIMB_CLEAR && px < limbPlanSpan[1] + LIMB_CLEAR) crossed.add(o.name);
                });
            }
            count += crossed.size + (overCard ? 3 : 0);
            if (overCard) acrossCard = true;
            if (!path.on) return;
            // R1a's limbs never reach back across the lane toward the Elder (rungs between them).
            if (backward && path.x1 < path.x0 - 0.005) count += 1;
            // A limb that rises straight up the frame beside its trunk reads as a second bole.
            const dx = Math.abs(path.x1 - path.x0) * lens.aspect;
            const dy = Math.abs(path.y1 - path.y0);
            if (dy > 0.02 && dx < LIMB_SPREAD * dy) count += 1;
            const angle = Math.atan2(path.y1 - path.y0, path.x1 - path.x0);
            paths.forEach((q) => {
                if (q.view !== l) return;
                let turn = Math.abs(angle - q.angle) % Math.PI;
                turn = Math.min(turn, Math.PI - turn);
                const near = Math.min(path.x0, path.x1) < q.hi + 0.05 && Math.max(path.x0, path.x1) > q.lo - 0.05;
                if (near && turn < LIMB_PARALLEL) count += 1;
                // Two limbs crossing in an X read as pipework.
                if (segmentsCross(path, q)) count += 1;
            });
        });
        return count;
    };
    const tipY = CANOPY_Y + LIMB_TIP_OVER;
    for (let i = 0; i < parents.length && limbs.length < want; i++) {
        const { trunk: parent, seed: parentSeed } = parents[i];
        trunkRecord(parent, parentSeed, limbPlanParent, 0, LIMB_EYE);
        const toEye = Math.atan2(-parent.z, -parent.x);
        // Out and away from the middle of the frame (a hero's limbs never cross the card).
        const outward = parent.x < 0 ? Math.PI : 0;
        backward = parent.code > 0 && parent.group === 2;
        hero = parent.code > 0;
        // A hero's first limb (R1c's too) keeps its best draw; a second limb, or a far trunk's,
        // only grows if a draw passes.
        const named = i < shown.length;
        // (R1a stands between the Elder and the card: hers may lean toward the card, high above
        // it, never back toward the Elder.)
        const side = parent.code > 0 && !backward && Math.abs(parent.x) / Math.max(-parent.z, 1) > 0.15 ? 0 : -1;
        // High on the bole, reaching up into the canopy (where it dissolves into the lace, as
        // the trunks do): a limb never ends in mid-air, and is never longer than LIMB_REACH.
        const elevation = 35 + 20 * rand();
        const sine = Math.sin(elevation * DEG);
        const y = lerp(Math.max(LIMB_FOOT[0], tipY - LIMB_REACH * sine), LIMB_FOOT[1], rand());
        const limb = {
            parent: parent.name,
            y,
            elevation,
            length: (tipY - y) / sine,
            radius: 0.35 + 0.55 * rand(),
            taper: 0.4 + 0.1 * rand(),
            lift: 0.6 + 0.4 * rand(),
            flutes: 5 + Math.floor(rand() * 3),
            seed: 1,
        };
        let best = -1;
        let bestFaults = Infinity;
        const tries = named ? LIMB_TRIES : LIMB_FAR_TRIES;
        for (let attempt = 0; attempt < tries && bestFaults > 0; attempt++) {
            const limbSeed = 1 + Math.floor(rand() * 999);
            const az = trunkBowAzimuth(limbSeed);
            if (!(Math.cos(az - toEye) < 0.3 && Math.cos(az - outward) > side)) continue;
            limb.seed = limbSeed;
            const n = faults(parent, limb, bestFaults);
            if (n < bestFaults) {
                bestFaults = n;
                best = limbSeed;
            }
        }
        if (best < 0) {
            // Nothing passed the hard rules (a parent straight ahead of the eye): straight away.
            for (let attempt = 0; attempt < 256 && best < 0; attempt++) {
                const limbSeed = 1 + Math.floor(rand() * 999);
                if (Math.cos(trunkBowAzimuth(limbSeed) - toEye) < -0.5) best = limbSeed;
            }
            bestFaults = Infinity;
        }
        limb.seed = Math.max(1, best);
        faults(parent, limb);
        // A far trunk's limb that cannot read as a branch, any limb that would read as a wire, and
        // a hero's whose best draw still crosses the card, is not grown.
        if ((!named && bestFaults > 0) || limbThinnest(limbPlanRecord) < LIMB_MIN_PX || (hero && acrossCard)) continue;
        trial.forEach((path, l) => {
            if (path.on) {
                paths.push({
                    view: l,
                    angle: Math.atan2(path.y1 - path.y0, path.x1 - path.x0),
                    lo: Math.min(path.x0, path.x1),
                    hi: Math.max(path.x0, path.x1),
                    x0: path.x0,
                    y0: path.y0,
                    x1: path.x1,
                    y1: path.y1,
                });
            }
        });
        limbs.push({ ...limb });
    }
    return limbs;
}

/**
 * The solo card at the stylesheet's own formulas (rainbark-composition.js fallbackLayout, kept in
 * step with it): the card is 1.19 boards wide and 2 boards + 158 px tall, centred.
 */
export function fallbackCard(width, height) {
    const W = Math.max(1, width || 1);
    const H = Math.max(1, height || 1);
    const board = Math.max(120, Math.min(Math.max(220, Math.min(0.22 * W, 300)), (H - 250) / 2));
    const cw = 1.19 * board;
    const ch = 2 * board + 158;
    return {
        x0: (W / 2 - cw / 2) / W, y0: (H / 2 - ch / 2) / H, x1: (W / 2 + cw / 2) / W, y1: (H / 2 + ch / 2) / H,
    };
}

/**
 * The solo stats bar at the stylesheet's own formulas (kept in step with fallbackLayout): 140 px
 * wide, 60 px right of the stage (clamp(300, 35vw, 400), at most (100vh − 200)/2), centred
 * vertically, min(385 px, 50vh) tall; on a frame HUD_ROW_WIDTH CSS px wide or narrower, a
 * full-width row under the card (HUD_ROW), which a narrow frame's bottom edge may cut.
 */
export function fallbackHud(width, height) {
    const W = Math.max(1, width || 1);
    const H = Math.max(1, height || 1);
    if (W <= HUD_ROW_WIDTH) {
        const top = fallbackCard(W, H).y1 * H + HUD_ROW.gap;
        return {
            x0: HUD_ROW.inset / W, y0: top / H, x1: (W - HUD_ROW.inset) / W, y1: (top + HUD_ROW.height) / H,
        };
    }
    const stage = Math.min(Math.max(300, Math.min(0.35 * W, 400)), (H - 200) / 2);
    const x0 = W / 2 + stage / 2 + 60;
    const hh = Math.min(385, H * 0.5);
    return {
        x0: x0 / W, y0: (H / 2 - hh / 2) / H, x1: (x0 + 140) / W, y1: (H / 2 + hh / 2) / H,
    };
}

// ── The shared tables ───────────────────────────────────────────────────────────

/**
 * Rows of the palette table (one vec4 uniform array): the zone colours (linear rgb, 1), the four
 * group mean bark colours, the eight piece-age rows (linear rgb of the bark at that age, the age)
 * in PIECE_CODE order, then the ribbons' places in their cycle (ribbonPhases), four to a row.
 */
export const PALETTE_ROWS = Object.freeze({
    ...Object.fromEntries(ZONE_COLOR_KEYS.map((key, i) => [key, i])),
    groupMean: ZONE_COLOR_KEYS.length,
    pieceAge: ZONE_COLOR_KEYS.length + 4,
    phases: ZONE_COLOR_KEYS.length + 4 + PIECE_AGE.length,
    used: ZONE_COLOR_KEYS.length + 4 + PIECE_AGE.length + Math.ceil(ATLAS_RIBBONS / 4),
    total: 28,
});

/** Slots per block of the event table, and rows per slot. */
export const EVENT_SLOTS = Object.freeze({
    peels: 16, girdles: 12, helices: 6, knocks: 4, gaps: 7, moult: 1,
});
export const EVENT_ROWS_PER = Object.freeze({
    peels: 3, girdles: 3, helices: 2, knocks: 1, gaps: 1, moult: 1,
});

/** The first row of each block of the event table (one vec4 uniform array of `total` rows). */
export const EVENT_ROWS = (() => {
    const rows = {};
    let at = 0;
    Object.keys(EVENT_SLOTS).forEach((block) => {
        rows[block] = at;
        at += EVENT_SLOTS[block] * EVENT_ROWS_PER[block];
    });
    rows.used = at;
    rows.total = 112;
    return Object.freeze(rows);
})();

// ── The board's marks on the bark (§6.1, §6.2) ──────────────────────────────────

/** An angle wrapped into [−π, π). */
export function wrapPi(a) {
    return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/**
 * The Peel (§6.1, as built): a band of bark the width of most of the lane (`width`, metres of arc
 * on the Elder and on Sister One) peels off at the piece's rows. The split shows for `delay`
 * seconds, then the front runs down the strip over `unzip` (`unzipHard` for a hard drop: torn off
 * whole). The fresh band ripens from the piece's own age at `ripen` a second, glows wet as it is
 * bared (`flush`: its own colour as light, gone with τ `flushTau`; then +`lift` of luminance with
 * τ `liftTau`) and keeps its gloss for τ `glossTau`. Its torn edges are `tear` metres ragged, with
 * a `cream` cambium edge inside and a `rim` shadow line outside. It lives `life` seconds (eroding
 * back into the mosaic over the last `erode` of it); past `held` bands standing, the oldest erodes
 * over `kill`. Columns 0–4 peel the Elder's lane, 5–9 Sister One's; across a lane the band follows
 * its column (left to right as on the board). A band is a torn ribbon like the bark's own: its
 * rows' height on the trunk times `stretch` plus `extend` metres, widest at its middle and tapering
 * (`taper`, the power of 1 − v²) to `point` of its width at both ends, leaning up to `lean` metres
 * of arc a metre of height its own way; each side meanders on its own (±`meander` of the half
 * width, two waves along the grain) and the whole ribbon sways (±`sway` of its half width), so no
 * two bands share an outline. Each band stands `jitter` of the lane's free width to one side or the
 * other of its column (`jitterSister` on Sister One's slim lane); Sister One keeps at most
 * `heldSister` standing. Bared bright, every band (and every Shed ring) settles to `settle` of its
 * chroma from `settleFor`[0] to [1] seconds: it belongs to the tree, never paint chips by the card.
 */
export const PEEL = Object.freeze({
    width: Object.freeze({ elder: 0.78, sister: 0.7 }),
    toPiece: Object.freeze([0.25, 1.8]),
    jitter: 0.6,
    jitterSister: 1.0,
    stretch: 2.4,
    extend: 0.7,
    taper: 0.5,
    point: 0.32,
    lean: 0.05,
    meander: 0.24,
    sway: 0.18,
    fibre: 0.2,
    delay: 0.04,
    unzip: 0.36,
    unzipHard: 0.12,
    ripen: 1 / 240,
    flush: 0.55,
    flushTau: 0.7,
    lift: 0.14,
    liftTau: 3,
    glossTau: 20,
    tear: 0.065,
    cream: 0.014,
    rim: 0.03,
    life: Object.freeze([28, 45]),
    erode: 0.75,
    held: 6,
    heldSister: 2,
    settle: 0.6,
    settleFor: Object.freeze([0.8, 3.0]),
    kill: 1.0,
    /** The lane's old bark: ages from `laneAge` up by `laneSpread` (rust, maroon, slate). */
    laneAge: 0.875,
    laneSpread: 0.1,
});

/**
 * The Knock (§6.2): a gleam runs up the struck side of the trunk at `speed` m/s for `life` seconds:
 * a band round its lane's middle (gone from `side`[0] to [1] radians round), its front lagging
 * only `bend` metres a radian² toward its sides (nearly level round the bole, so the eye sees it
 * ride the trunk's curve; a stronger lag drew a dome), crisp over `half` metres ahead of the front and
 * trailing a `tail` metres long behind it, the bark it passes `lift` brighter and gleaming `light`
 * of the sun in its own colour; its strength is 0.4 + 0.6·min(1, distance/`reach`)
 * rows; one per trunk per `gap` s.
 */
export const KNOCK = Object.freeze({
    speed: 18,
    life: 0.6,
    half: 0.1,
    tail: 0.75,
    bend: 0.35,
    gap: 0.25,
    reach: 18,
    light: 0.42,
    lift: 0.65,
    side: Object.freeze([0.15, 0.75]),
});

const rowOnTrunk = { rise: 0, scale: 1 };
const axisOnTrunk = [0, 0, 0];

/**
 * The height (metres) at which the rest eye's ray through screen row `sy` (fraction, 0 at the top)
 * meets a trunk record's surface at bearing θ, the eye at (0, eyeY, 0); `out` gets [y, radius].
 * (The surface point's depth depends on its height through the lean and taper: a few rounds settle it.)
 */
export function trunkHeightAt(record, lens, sy, theta, eyeY, offset = 0, out = [0, 0]) {
    lensRow(lens, sy, rowOnTrunk);
    let y = eyeY;
    for (let i = 0; i < 4; i++) {
        recordAxis(record, y, axisOnTrunk, offset);
        const z = axisOnTrunk[1] + axisOnTrunk[2] * Math.sin(theta);
        y = eyeY + Math.max(-z, 0.3) * rowOnTrunk.rise;
    }
    recordAxis(record, y, axisOnTrunk, offset);
    out[0] = y;
    out[1] = axisOnTrunk[2];
    return out;
}

/**
 * Curls and flakes (§4.7, as built): the strips the grove sheds. Kinds: 0 ambient (the grove's own
 * shedding), 1 a lock's strip (rides the unzip front, then detaches), 2 a flake (a knock's chip).
 * Each kind: terminal fall `fall` m/s reached with τ `fallTau`, an outward pop `out` m/s with τ
 * `outTau`, a drift back (−z) `back` m/s, spin in rev/s, a sideways flutter `flutter` metres at
 * 0.3 Hz. `ambient`: one ambient curl in `rate` slots a second… per tier (QUALITY.curlsAmbient);
 * each lives until it has fallen past the mist (at most `life` seconds). A lock's strip lifts off
 * the trunk as an open lip (turned `lip` radians at its middle, 1.4 times that at its end) while it
 * rides the front; once free it dries over `settle` seconds into a curl rolled across its width,
 * `turns` of a turn, its radius tightening to `inner` of the outer one (the old bark outside, the
 * cream underside within, as a strip curls on the tree; open, so its turns never show through one
 * another). A T-spin's strip takes the same shape. A ring's sheet pieces peel down their band as
 * lips too, then pop clear of the blazing ring at once and fall away still curled outward as
 * peeled bark does, only `plate` of the way eased into curved plates (rolled `roll` of the way a
 * lock's strip is: a short, wide plate rolled across its width is a capsule, a row of pills along
 * the ring), each slanted by its own hash up to `slant` radians either way, so a ring's lips never
 * lie level in a row.
 */
export const CURL = Object.freeze({
    stride: 20,
    ambient: Object.freeze({
        fall: 1.2,
        fallTau: 0.8,
        out: 0.75,
        outTau: 1.8,
        back: 0.15,
        flutter: 0.3,
        spin: Object.freeze([0.6, 1.4]),
        length: Object.freeze([0.45, 1.4]),
        width: Object.freeze([0.08, 0.22]),
        life: Object.freeze([26, 48]),
        rise: Object.freeze([-0.25, 0.7]),
    }),
    lock: Object.freeze({
        fall: 1.4,
        fallTau: 0.6,
        out: 1.6,
        outTau: 0.5,
        back: 0.4,
        flutter: 0.25,
        spin: 0.55,
        spinHard: 1.1,
        life: 7.5,
        detach: 0.12,
        lip: 1.6,
        turns: 0.8,
        inner: 0.6,
        settle: 0.4,
    }),
    sheet: Object.freeze({
        fall: 1.6,
        fallTau: 0.5,
        out: 2.4,
        outTau: 0.3,
        roll: 0.45,
        lip: 1.4,
        plate: 0.3,
        slant: 0.42,
        chroma: 0.6,
        back: 0.4,
        flutter: 0.3,
        spin: 0.7,
        spinHard: 0.7,
        life: 7,
        detach: 0.06,
    }),
    flake: Object.freeze({
        fall: 2.0,
        fallTau: 0.35,
        out: 1.6,
        outTau: 0.25,
        back: 0.3,
        flutter: 0.08,
        spin: Object.freeze([0.8, 1.5]),
        length: Object.freeze([0.05, 0.12]),
        width: Object.freeze([0.035, 0.08]),
        life: 3.2,
        above: Object.freeze([2, 6]),
    }),
    /** Ambient curls spawned a second per tier (menus); live play runs at `live` of it. */
    rate: Object.freeze({
        Minimal: 1.0, Low: 1.4, Medium: 2.0, High: 2.6, Ultra: 3.0, Extreme: 3.4,
    }),
    live: 0.35,
});

/**
 * Opening the canopy (§6.6, §4.10 as built): chain link n ≥ 2 opens gap n − 1 (at most 7). Each gap
 * is a hole in the crowns above a fixed station on the lanes, so its pinhole image (the gap's own
 * radius blurred by the sun's disc: about 2 m at the Bole) lands there as a big sun pool, with a
 * shaft of lit haze under it. A gap opens over `open` seconds and shuts over `close`; on the Set
 * they shut in reverse, `stagger` seconds apart. Its radius is `radius`[0] up to the Fog Line and
 * [1] from the Limb Storey (`high` metres) up. A gap that opens sheds `leaves` leaf bits from the
 * crowns above its station. Stations: [trunk code, screen row] in opening order, on a landscape
 * and on an upright frame (the Elder high, Sister One high, both mid, both low, then Sister Two).
 */
export const GAP = Object.freeze({
    open: 0.5,
    close: 0.45,
    stagger: 0.12,
    radius: Object.freeze([0.35, 0.25]),
    high: 110,
    leaves: 12,
    stations: Object.freeze({
        wide: Object.freeze([[1, 0.24], [2, 0.3], [1, 0.5], [2, 0.55], [1, 0.76], [2, 0.8], [3, 0.5]]),
        tall: Object.freeze([[1, 0.2], [2, 0.25], [1, 0.45], [2, 0.5], [1, 0.68], [2, 0.72], [1, 0.1]]),
    }),
});

/**
 * Quickening (§6.6): while a chain lives the bark's group clocks run at 1 + `per`·(n − 1) (n
 * capped at `cap`): the Elder from ×`join`[0], the Sisters from ×[1], the R1/R2 group from ×[2]
 * at `share`[2] of the speed-up, the far grove from ×[3] at `share`[3]. A rate eases toward its
 * target with τ `rise` (τ `fall` when it drops: the Set snaps the time-lapse back). From ×`gust`
 * the canopy's wind blows `wind` times as far (eased with τ `windTau`, so no fleck jumps).
 */
export const QUICKEN = Object.freeze({
    per: 1.6,
    cap: 8,
    join: Object.freeze([2, 3, 5, 7]),
    share: Object.freeze([1, 1, 0.6, 0.4]),
    rise: 0.8,
    fall: 0.25,
    gust: 4,
    wind: 1.5,
    windTau: 1.5,
});

/** A group's clock rate for a chain of n (QUICKEN). */
export function quickenRate(group, n) {
    const Q = QUICKEN;
    const c = Math.min(Math.max(0, Math.round(n) || 0), Q.cap);
    if (c < Q.join[group]) return 1;
    return 1 + Q.share[group] * Q.per * (c - 1);
}

/**
 * The Set (§6.7): when a chain of peak p ≥ 2 breaks, a curtain of min(`per`·(p − 1), the tier's
 * cap) curls falls from both near trunks, spawned top to bottom over `over` seconds; the quickened
 * bark sets: its sheen dips by `sheen` for `sheenFor` seconds.
 */
export const SET = Object.freeze({
    per: 8, over: 1.4, sheen: 0.3, sheenFor: 4,
});

/**
 * The motes (rainbark-fx.js): seeds, pollen and spores adrift in the air in front of the eye,
 * seen only where the canopy's light reaches them, so they glint in the sun's patches of air (the
 * very light that lands as flecks on the bark) and are all but gone in the shade: light in the
 * air without a shaft. Each slot holds one mote for good, `near` … `far` metres deep (more of them
 * near), over `spread` of the lens's half-width at that depth and from `rise`[0] to [1] of its
 * depth about the eye, world-fixed and wrapped round the eye (so the camera's breath gives
 * parallax and a Climb streams them down past it), drifting on a breeze of `drift`[0] m/s and
 * sinking `drift`[1] m/s, wandering ±`wander` metres (x, y) over periods of 7–13 s and 9–18 s. A
 * mote is `px` pixels across on a 1080-line frame (and never under `least` of a buffer pixel); in
 * the sun it glints `glint` of the sun's light, more toward the sun (forward scatter at g = `g`,
 * `backlit` more), tumbling: `flash` of its light comes in brief flashes at `twinkle` radians a
 * second; in the shade it keeps only `shade` of the sky's (lit by the bright air round it, every
 * mote would show at once: a snowfall); in a pearly zone, where the vapour veils the sun, `pearl`
 * of its light is gone. It fades over the band's edges (`edge` of
 * it), within `card` (screen fraction) of the card, in the air in front of it and in the mist.
 */
export const MOTES = Object.freeze({
    near: 4.5,
    far: 36,
    spread: 1.15,
    rise: Object.freeze([-0.55, 0.95]),
    drift: Object.freeze([0.16, 0.035]),
    wander: Object.freeze([0.4, 0.25]),
    px: Object.freeze([2.0, 4.2]),
    least: 1.2,
    glint: 1.1,
    backlit: 0.9,
    g: 0.7,
    flash: 0.6,
    twinkle: Object.freeze([1.1, 2.9]),
    shade: 0.04,
    pearl: 0.8,
    edge: 0.08,
    card: 0.03,
});

/**
 * The Sunshower (§6.8, as built): while a back-to-back run lives (level 1 … 3) rain falls in the
 * light (the first `level`/3 of the drops pool, eased in over `fadeIn` seconds and out over
 * `fadeOut`) and the grove is wet (`wet`[level], decaying with τ `dry` after the run breaks):
 * albedo ×(1 − `darken`·wet), chroma ×(1 + `chroma`·wet), glossier, its sheen up by `sheen`·wet.
 * Streaks are `length` metres falling `speed` m/s through a volume `near` … `far` metres deep,
 * `left` … `right` metres wide at its far side, from `top` over the eye down `height`; a drop
 * glints `glint` of the sun's light in a fleck and shows `shade` of the sky's in the shade. A streak
 * is never longer than `streakPx` pixels on screen; drops nearer than `nearDim`[1] metres glint
 * less (down to [2] of their light at [0]). On the near trunks the water runs down in `rivulet`s:
 * `around` columns round the trunk, a `share` of them holding a thread `width` of a column wide,
 * wandering ±`wander`[1] of a column at `wander`[0] radians a metre (and a finer wave), broken into
 * runs (where a wave of `runs`[0] radians a metre stands over `runs`[1]), beaded (`beads` a metre,
 * sliding `slide` of a bead a second), mirroring `mirror` of the bright air and `glint` of the
 * sun in the flecks.
 */
export const RAIN = Object.freeze({
    speed: 7,
    length: 1.1,
    near: 3,
    far: 34,
    left: -18,
    right: 26,
    top: 11,
    height: 24,
    glint: 0.5,
    backlit: 0.12,
    shade: 0.09,
    fadeIn: 2,
    fadeOut: 2,
    dry: 8,
    wet: Object.freeze([0, 0.7, 0.9, 1.1]),
    darken: 0.28,
    chroma: 0.18,
    sheen: 0.9,
    streakPx: 70,
    nearDim: Object.freeze([3, 8, 0.4]),
    rivulet: Object.freeze({
        around: 70,
        width: 0.08,
        wander: Object.freeze([0.6, 0.15]),
        runs: Object.freeze([0.7, 0.1]),
        share: 0.5,
        beads: 1.6,
        slide: 0.9,
        mirror: 0.3,
        glint: 0.7,
    }),
});

/**
 * The Floor (§6.10, as built): a perfect clear drains the mist (the tide to `tide` metres over
 * `drain` seconds, the haze thinned to `clear` of itself) and for the first time the forest floor
 * shows, far below: warm gravel, a braided stream glinting in the flecks, the session's shed curls
 * as a carpet (density 1 − exp(−sheds/`carpet`)), broad pools of sun; the frame's exposure up by
 * `lift` stops. It holds until `hold` seconds, then the mist and the haze return by `back`.
 */
export const FLOOR = Object.freeze({
    tide: -40,
    drain: 1.2,
    clear: 0.35,
    carpet: 400,
    lift: 0.2,
    hold: 9,
    back: 15,
    gravel: '#B79A62',
    glint: '#FFF6DA',
});

/** The Floor's envelope at s seconds after a perfect clear (0 … 1 … 0). */
export function floorEnvelope(s) {
    if (!(s >= 0) || s >= FLOOR.back) return 0;
    const up = smoother(s / FLOOR.drain);
    const down = s > FLOOR.hold ? smoother((s - FLOOR.hold) / (FLOOR.back - FLOOR.hold)) : 0;
    return up * (1 - down);
}

/** Leaf bits (kind 3 curls): eucalyptus leaves shaken from the crowns. */
export const LEAF = Object.freeze({
    fall: 0.85,
    fallTau: 1.2,
    out: 0.3,
    outTau: 1,
    back: 0.1,
    flutter: 0.45,
    spin: Object.freeze([0.4, 1.0]),
    length: Object.freeze([0.16, 0.28]),
    width: Object.freeze([0.035, 0.06]),
    life: 7,
    spread: 2.2,
});

/**
 * Five 3-bit bark codes (0 … 7) packed into one float: c0 + 8·c1 + 64·c2 + 512·c3 + 4096·c4, exact
 * in float32 (under 2^15). A row's ten cells are two such floats.
 */
export function packCodes(codes, from = 0) {
    let p = 0;
    for (let k = 4; k >= 0; k--) p = p * 8 + Math.max(0, Math.min(7, Math.round(Number(codes[from + k]) || 0)));
    return p;
}

/** The five codes of a packed float (packCodes' inverse). */
export function unpackCodes(p, out = [0, 0, 0, 0, 0]) {
    let v = Math.round(p);
    for (let k = 0; k < 5; k++) {
        out[k] = v % 8;
        v = Math.floor(v / 8);
    }
    return out;
}

/**
 * The Shed (§6.3, as built): each cleared row, lowest first and `stagger` seconds apart, girdles
 * both near trunks across their visible arc at its height: a ring `rows` board rows tall cast to
 * the trunk. A hairline splits its top edge (0 … `split`), the girdle's bark peels down off it
 * (`split` … `bare`, falling away as `sheets` sheet pieces a trunk), the ring blazes First Skin
 * (`bare` … `blaze`, its light capped at `blazeLight` through the iris), then ripens into the row's
 * own colours (from `ripen`, over `ripenFor`, cell after cell `cell` seconds apart, left to right
 * as on the board). It erodes after `life` seconds. A double also girdles the R1 trunks
 * `secondDelay` later at `second` strength; a triple shakes `triple` extra sheets per row off the
 * grove behind. Each ring is ±`vary` of its height taller or shorter (hashed per ring), its two edges
 * torn on their own (±`tear` of its half height, two waves round the trunk), and its cells part
 * along ragged, slanted lines (`slant` of the arc a metre), never a ruled barcode. Its sheets fall
 * from the middle `sheetArc` of the visible arc, their old bark aged `sheetAge` (violet to ember),
 * each up to `sheetJog`/2 of its slot to one side and `sheetSize` of its slot's width (hashed per ring
 * and slot): staggered lips of mixed sizes, never a row of piano keys. Sister One sheds
 * `sisterSheets` a ring, sized `sisterSize`, the second `sisterDrop` of the ring's half height lower:
 * never a pair of eyes.
 */
export const SHED = Object.freeze({
    stagger: 0.12,
    rows: 1.25,
    vary: 0.3,
    tear: 0.24,
    slant: 0.06,
    sheetArc: 0.7,
    sheetAge: Object.freeze([0.55, 0.8]),
    sheetJog: 0.7,
    sisterSheets: 2,
    sisterSize: Object.freeze([0.6, 1.1]),
    sisterDrop: 0.6,
    sheetSize: Object.freeze([0.55, 1.15]),
    split: 0.1,
    bare: 0.42,
    blaze: 0.6,
    blazeLight: 1.1,
    ripen: 0.6,
    ripenFor: 1.0,
    cell: 0.04,
    life: Object.freeze([60, 120]),
    sheets: Object.freeze({
        Minimal: 2, Low: 3, Medium: 4, High: 5, Ultra: 6, Extreme: 6,
    }),
    second: 0.7,
    secondDelay: 0.15,
    triple: 6,
});

/**
 * The Great Moult (§6.5, as built): the creak (`creak` seconds: every old lip lifts), then a front
 * sweeps down every trunk in screen elevation from `from` to `to` degrees over `front` seconds,
 * `rankDelay` later per rank (near first); above it the bark stands in wet First Skin. From
 * `ripenAt` the colour climbs back from the foot of the frame in flame-shaped fingers over
 * `ripenFor` (plus `rankRipen` a rank and up to `flame` seconds of ragged delay), until every patch
 * rejoins its own age. The near groups' age bias falls to `bias`, relaxing back over `relax`
 * seconds. The frame's exposure eases down by up to `iris` stops (rise `rise`, decay τ `decay`), so
 * First Skin never clips. `sheets`: moult sheets off the grove by tier.
 */
export const MOULT = Object.freeze({
    creak: 0.3,
    from: 35,
    to: -35,
    front: 0.9,
    rankDelay: 0.05,
    ripenAt: 2.0,
    ripenFor: 0.35,
    rankRipen: 0.25,
    flame: 1.1,
    span: 3.6,
    bias: -0.6,
    relax: 360,
    iris: 0.25,
    rise: 0.4,
    decay: 1.2,
    sheets: Object.freeze({
        Minimal: 24, Low: 36, Medium: 64, High: 110, Ultra: 150, Extreme: 200,
    }),
});

/**
 * The Unwinding (§6.9, as built): a T-spin's helix on the T's side (columns 0–4 the Elder, else
 * Sister One), from its top row down: `width` metres wide, `pitch` metres a turn, one turn per
 * line, unwinding from `start` over `unwind` seconds (`reduced` under reduced motion). Its strip
 * ripens from First Skin to Young Emerald (the T's own age) over `ripen` seconds; it stays for the
 * level (at most EVENT_SLOTS.helices; the oldest heals over `heal` seconds). The freed strip
 * falls as a corkscrew ribbon.
 */
export const HELIX = Object.freeze({
    width: Object.freeze({ elder: 0.3, sister: 0.6 }),
    pitch: Object.freeze({ elder: 0.9, sister: 2.2 }),
    start: 0.15,
    unwind: 1.4,
    reduced: 0.6,
    ripen: 3,
    heal: 4,
    blaze: 1.2,
});

/**
 * The light of the grove turns with the clock (as built), whatever the storey: a wheel of moods
 * over the zone's own colours, `step` seconds a mood, each held for `rest` of its step at either
 * end (the light is on its way for the rest). The wheel is the clock alone (the Climb already
 * changes the zone's colours with the level). Each mood tints the zone colours (linear rgb
 * multipliers; a key it does not name stays as it is) and the exposure (`exposure`).
 *   morning  the zones as authored: cream sun, blue air
 *   noon     a whiter, higher-key sun; cooler shade
 *   gold     an amber sun, rose-gold air on the sunny side, warm mist, violet shade
 *   pearl    a soft, pale light: lilac air, a rose-white sun, a silvery mist
 */
export const LIGHT_WHEEL = Object.freeze({
    step: 100,
    rest: 0.15,
    moods: Object.freeze([
        Object.freeze({ name: 'morning', exposure: 1, tint: Object.freeze({}) }),
        Object.freeze({
            name: 'noon',
            exposure: 1.04,
            tint: Object.freeze({
                fleck: [1.0, 1.06, 1.22],
                hazeSun: [0.97, 1.0, 1.08],
                hazeShade: [0.94, 1.0, 1.08],
                sky: [0.97, 1.0, 1.05],
                mistTop: [0.98, 1.0, 1.06],
                underglow: [0.97, 1.0, 1.06],
                gradeLight: [0.98, 1.0, 1.05],
            }),
        }),
        Object.freeze({
            name: 'gold',
            exposure: 1.0,
            tint: Object.freeze({
                // (Its sun a little stronger than whole: the gold turns the light's hue, never dims
                // the flecks. Never by the exposure: it would burn the gold air out.)
                fleck: [1.38, 1.12, 0.78],
                hazeSun: [1.12, 0.92, 0.72],
                hazeShade: [1.06, 0.92, 1.0],
                sky: [1.06, 0.96, 0.9],
                zenith: [1.04, 0.96, 0.94],
                mistTop: [1.1, 0.95, 0.8],
                underglow: [1.16, 0.92, 0.72],
                gradeLight: [1.08, 0.96, 0.84],
                gradeShadow: [1.1, 0.92, 1.05],
            }),
        }),
        Object.freeze({
            name: 'pearl',
            exposure: 1.02,
            tint: Object.freeze({
                fleck: [1.04, 0.94, 0.98],
                hazeSun: [1.02, 0.96, 1.06],
                hazeShade: [1.06, 0.97, 1.12],
                sky: [1.02, 0.98, 1.06],
                mistTop: [1.02, 0.98, 1.06],
                underglow: [1.02, 0.96, 1.06],
                gradeLight: [1.02, 0.98, 1.04],
            }),
        }),
    ]),
});

/**
 * Where the light wheel stands at time t: { a, b, mix } (indices into LIGHT_WHEEL.moods) and the
 * wheel's raw place (moods turned since t = 0). Closed form in the clock (seek-safe).
 */
export function lightWheelAt(t, out = {
    a: 0, b: 1, mix: 0, place: 0,
}) {
    const W = LIGHT_WHEEL;
    const n = W.moods.length;
    const place = Math.max(0, Number(t) || 0) / W.step;
    const k = Math.floor(place);
    const f = place - k;
    out.a = k % n;
    out.b = (k + 1) % n;
    out.mix = smooth(W.rest, 1 - W.rest, f);
    out.place = place;
    return out;
}

/** Meditation's clicks (§6.13): at most `rate` peels a second, each band ±`half` metres tall. */
export const MEDITATION = Object.freeze({ rate: 4, half: 0.55 });

/**
 * The liana (§4.9, as built): a woody vine slung from Sister One (camY + `from` metres) to Sister
 * Two (camY + `to`), sagging `sag` metres at its middle, `thick` metres thick, swaying ±`sway`
 * metres at `rate` Hz, on a ribbon of `segments` segments.
 */
export const LIANA = Object.freeze({
    from: 9, to: 4, sag: 3.5, thick: 0.12, sway: 0.4, rate: 0.15, segments: 32, twist: 2.4,
});

/**
 * Rainbow lorikeets (§4.9, as built): a flock crosses the air every `every` seconds (plus up to
 * `jitter`), `time` seconds a crossing, on an arc `span` metres long at `depth` metres (shifted
 * `right` of its depth to the right, `above` of its depth over the eye, rising `rise`), each bird
 * `size` metres long, its wings beating at `flap` Hz.
 */
export const LORIKEET = Object.freeze({
    every: 55,
    jitter: 15,
    time: 5,
    span: 60,
    depth: Object.freeze([28, 55]),
    right: 0.35,
    above: 0.12,
    rise: 2.5,
    size: 1.6,
    flap: 9,
});
