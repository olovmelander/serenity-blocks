/**
 * What the portal passage is MADE OF. The gate is one visual language (portal-gate.js: a rim, a
 * passage rushing past, the light ahead); this module gives it a character for each chapter of
 * the journey, so the passage is made of where you are while its colours are the place you are
 * going to (the palette): embers and molten glass inside the Earth, bubbles, light shafts and
 * the flash of fish in the sea, petals and leaves on the island, snow on the wind in the
 * mountains, cloud and shafts of gold in the sky, stars and dust in space, folding facets inside
 * the hole, neon rain in the city.
 *
 * A kind is three things, all cheap: the passage's WALL (one alpha texture baked once per kind
 * and size, drawn as the same few zooming layers as before), its MATTER (a few dozen small
 * sprites flying past, in place of some of the streaks) and its RIM (a handful of strokes).
 * Still a plain 2D canvas, still drawn in the gate's worker, nothing here compiles anything.
 * Pure functions: no DOM (the caller makes the canvases), no clock, no randomness of its own.
 */

const TAU = Math.PI * 2;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const fract = (value) => value - Math.floor(value);
const smoothstep = (lo, hi, value) => {
    const t = clamp01((value - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};

// ── Noise (CPU, once) ───────────────────────────────────────────────────────────

function hash(x, y, seed) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise, periodic in x with `period` cells. */
function valueNoise(x, y, period, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const a = hash(x0, yi, seed);
    const b = hash(x1, yi, seed);
    const c = hash(x0, yi + 1, seed);
    const d = hash(x1, yi + 1, seed);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

/** Fractal value noise in 0..1, periodic in u. */
function fbm(u, v, period, seed, octaves = 4) {
    let n = 0;
    let amp = 0.55;
    let total = 0;
    for (let octave = 0; octave < octaves; octave++) {
        const k = 2 ** octave;
        n += valueNoise(u * k, v * k, period * k, seed + octave * 31) * amp;
        total += amp;
        amp *= 0.5;
    }
    return n / total;
}

/**
 * Cells of a jittered grid, periodic in u: how near the pixel is to a cell's edge, the cell's
 * own number, and how near the pixel is to the cell's middle.
 */
function cells(u, v, period, seed) {
    const cu = Math.floor(u);
    const cv = Math.floor(v);
    let d1 = 9;
    let d2 = 9;
    let id = 0;
    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            const gx = cu + i;
            const gy = cv + j;
            const wx = ((gx % period) + period) % period;
            const d = Math.hypot(u - (gx + 0.15 + 0.7 * hash(wx, gy, seed)), v - (gy + 0.15 + 0.7 * hash(wx, gy, seed + 17)));
            if (d < d1) {
                d2 = d1;
                d1 = d;
                id = hash(wx, gy, seed + 41);
            } else if (d < d2) d2 = d;
        }
    }
    return { edge: d2 - d1, id, near: d1 };
}

/**
 * The walls. Each reads its noise in turn (u, periodic) and log radius (v), so a layer zooming
 * past reads as a passage, not a stamp. `period`: cells round the ring. Returns alpha 0..1.
 */
const WALLS = Object.freeze({
    // Clouds drawn out along the radius with filaments where they cross their middle.
    dust: {
        period: 9,
        alpha(u, v, seed) {
            const n = fbm(u, v, 9, seed);
            return smoothstep(0.44, 0.82, n) * 0.85 + (1 - Math.abs(n * 2 - 1)) ** 8 * 0.7;
        },
    },
    // Black rock, cracked: thin veins of light and little else.
    rock: {
        period: 8,
        alpha(u, v, seed) {
            const n = fbm(u, v, 8, seed);
            const fine = fbm(u * 2, v * 2, 16, seed + 211, 2);
            return (1 - Math.abs(n * 2 - 1)) ** 14 * 0.95
                + (1 - Math.abs(fine * 2 - 1)) ** 18 * 0.45
                + smoothstep(0.56, 0.9, n) * 0.3;
        },
    },
    // Water: a slow net of caustic light.
    water: {
        period: 6,
        alpha(u, v, seed) {
            const a = fbm(u, v * 0.8, 6, seed, 3);
            const b = fbm(u + 2.7, v * 1.3 + 4.1, 6, seed + 101, 3);
            return (1 - Math.abs(a * 2 - 1)) ** 5 * 0.8
                + (1 - Math.abs(b * 2 - 1)) ** 8 * 0.45
                + smoothstep(0.5, 0.92, a) * 0.22;
        },
    },
    // Open air: a few soft wisps.
    air: {
        period: 5,
        alpha(u, v, seed) {
            return smoothstep(0.5, 0.9, fbm(u, v * 0.8, 5, seed, 3)) * 0.7;
        },
    },
    // Wind: long strokes along the way you are going.
    wind: {
        period: 14,
        alpha(u, v, seed) {
            const n = fbm(u, v * 0.2, 14, seed, 3);
            return smoothstep(0.5, 0.8, n) * 0.7 + (1 - Math.abs(n * 2 - 1)) ** 10 * 0.35;
        },
    },
    // Cumulus: round heaps of cloud, each with a lit crest.
    cumulus: {
        period: 7,
        alpha(u, v, seed) {
            const n = fbm(u * 2, v * 2, 14, seed, 3);
            const { near } = cells(u, v * 1.15, 7, seed + 5);
            const heap = smoothstep(0.78, 0.22, near + (n - 0.5) * 0.55);
            return heap * (0.4 + 0.6 * n) + smoothstep(0.55, 0.9, heap * n * 1.6) * 0.3;
        },
    },
    // Facets: flat shards of glass, each at its own brightness, with bright edges.
    shards: {
        period: 8,
        alpha(u, v, seed) {
            const { edge, id } = cells(u, v * 1.35, 8, seed);
            return (id < 0.3 ? 0.04 : 0.16 + 0.6 * id) + (1 - smoothstep(0.02, 0.09, edge)) * 0.85;
        },
    },
    // A wire tunnel: rails running to the light and hoops round it.
    grid: {
        period: 16,
        alpha(u, v) {
            const du = Math.min(fract(u), 1 - fract(u));
            const fv = fract(v * 1.25);
            const dv = Math.min(fv, 1 - fv);
            const rail = Math.exp(-((du / 0.045) ** 2));
            const hoop = Math.exp(-((dv / 0.06) ** 2));
            return Math.max(rail * 0.8, hoop) + 0.03;
        },
    },
});

/**
 * A wall ring as alpha (white light), faded out at the centre (the light ahead) and at the rim.
 * @param {keyof typeof WALLS} wall
 * @param {number} size
 * @param {number} [seed]
 * @returns {Uint8ClampedArray} size² RGBA
 */
export function bakeWallRing(wall, size, seed = 7) {
    const recipe = WALLS[wall] || WALLS.dust;
    const data = new Uint8ClampedArray(size * size * 4);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x + 0.5 - half) / half;
            const dy = (y + 0.5 - half) / half;
            const r = Math.hypot(dx, dy);
            const envelope = smoothstep(0.1, 0.42, r) * (1 - smoothstep(0.72, 0.99, r));
            if (envelope <= 0) continue;
            const u = (Math.atan2(dy, dx) / TAU + 0.5) * recipe.period;
            const v = Math.log(Math.max(r, 0.02)) * 2.4;
            const o = (y * size + x) * 4;
            data[o] = 255;
            data[o + 1] = 255;
            data[o + 2] = 255;
            data[o + 3] = Math.round(Math.min(1, recipe.alpha(u, v, seed)) * envelope * 255);
        }
    }
    return data;
}

/** The nebula ring every passage used to be made of: space's dust. */
export function bakeNebulaRing(size, seed = 7) {
    return bakeWallRing('dust', size, seed);
}

// ── Matter sprites (white light, alpha) ─────────────────────────────────────────

/** Each sprite: its size and its alpha at (x, y) in -1..1 across the sprite (x along its length). */
const SPRITES = Object.freeze({
    // A bubble: a thin wall, a faint body, a highlight on its upper left.
    bubble: {
        width: 64,
        height: 64,
        alpha(x, y) {
            const r = Math.hypot(x, y);
            if (r > 1) return 0;
            const wall = Math.exp(-(((r - 0.8) / 0.075) ** 2));
            const lit = Math.max(0, Math.cos(Math.atan2(y, x) + Math.PI * 0.75));
            const shine = Math.exp(-(((r - 0.5) / 0.13) ** 2)) * lit ** 5;
            return wall * (0.5 + 0.5 * lit) + (r < 0.8 ? 0.07 : 0) + shine * 0.9;
        },
    },
    // A petal: round at one end, drawn to a point at the other, a soft vein down it.
    petal: {
        width: 64,
        height: 48,
        alpha(x, y) {
            const t = (x + 1) / 2;
            const half = 0.86 * Math.sin(Math.PI * t) ** 0.75 * (1.15 - 0.45 * t);
            if (half <= 0) return 0;
            const edge = smoothstep(half, half - 0.24, Math.abs(y));
            return edge * (0.62 + 0.38 * (1 - Math.abs(y) / half)) * (1 - 0.3 * Math.exp(-((y / 0.07) ** 2)));
        },
    },
    // A leaf: pointed at both ends, its midrib catching the light.
    leaf: {
        width: 72,
        height: 36,
        alpha(x, y) {
            const half = 0.9 * Math.sin((Math.PI * (x + 1)) / 2) ** 1.1;
            if (half <= 0) return 0;
            const edge = smoothstep(half, half - 0.3, Math.abs(y));
            return edge * 0.66 + Math.exp(-((y / 0.08) ** 2)) * edge * 0.34;
        },
    },
    // A shard of glass: a flat triangle, brighter toward one edge.
    shard: {
        width: 64,
        height: 64,
        alpha(x, y) {
            const ax = -0.86;
            const ay = -0.5;
            const bx = 0.9;
            const by = -0.22;
            const cx = -0.2;
            const cy = 0.9;
            const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
            const wa = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
            const wb = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
            const wc = 1 - wa - wb;
            const inside = Math.min(wa, wb, wc);
            if (inside <= 0) return 0;
            return smoothstep(0, 0.06, inside) * (0.28 + 0.62 * wa) + (1 - smoothstep(0, 0.09, wc)) * 0.4;
        },
    },
    // The flash of a fish: a silver sliver, brighter along its back.
    fish: {
        width: 96,
        height: 32,
        alpha(x, y) {
            const body = 1 - x * x;
            if (body <= 0) return 0;
            const half = 0.8 * body ** 0.8 * (0.75 + 0.25 * x);
            const edge = smoothstep(half, half - 0.45, Math.abs(y));
            return edge * (0.4 + 0.6 * Math.exp(-(((y + 0.25) / 0.3) ** 2)));
        },
    },
    // A shaft of light from the light ahead: narrow where it starts, wide and faint where it ends.
    shaft: {
        width: 192,
        height: 64,
        alpha(x, y) {
            const t = (x + 1) / 2;
            const half = 0.1 + 0.9 * t;
            return Math.exp(-((y / half) ** 2) * 2.6) * Math.sin(Math.PI * t) ** 0.7 * (1 - 0.35 * t);
        },
    },
});

/**
 * @param {keyof typeof SPRITES} name
 * @returns {{width: number, height: number, data: Uint8ClampedArray}|null} white light, RGBA
 */
export function bakeMatterSprite(name) {
    const sprite = SPRITES[name];
    if (!sprite) return null;
    const { width, height } = sprite;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const a = clamp01(sprite.alpha(((x + 0.5) / width) * 2 - 1, ((y + 0.5) / height) * 2 - 1));
            const o = (y * width + x) * 4;
            data[o] = 255;
            data[o + 1] = 255;
            data[o + 2] = 255;
            data[o + 3] = Math.round(a * 255);
        }
    }
    return { width, height, data };
}

// ── The kinds ───────────────────────────────────────────────────────────────────

/**
 * @typedef {object} PassageKind
 * @property {keyof typeof WALLS} wall
 * @property {[number, number]} wallValue lightness of the wall's two tints (the body's and the
 *   second hue's), before the destination's own brightness lifts them (`key`)
 * @property {number} wallAlpha how much of the wall shows
 * @property {number} spin how fast the wall's layers turn (1: as the nebula did)
 * @property {number} streaks share of the gate's streaks that stay streaks of light
 * @property {Array<object>} matter what else flies past (see drawMatter)
 * @property {string[]} sprites the matter sprites this kind needs baked
 * @property {number} [shafts] shafts of light from the light ahead
 * @property {number} [school] fish in the school that crosses the passage
 * @property {number} [hoops] hoops of light the passage runs through
 * @property {boolean} [align] the wall's layers keep one turn (a wire tunnel's rails line up)
 * @property {number} [fill] lifts the passage's deep (a way through cloud is not a night)
 * @property {number} [lightAhead] how much bigger the light ahead is
 * @property {string} rim the rim's ornament
 */

/** @type {Readonly<Record<string, Readonly<PassageKind>>>} */
export const PASSAGE_KINDS = Object.freeze({
    // Inside the Earth: cracked rock lit from within, embers flying, a rim of molten glass.
    embers: {
        wall: 'rock',
        wallValue: [0.4, 0.3],
        wallAlpha: 1,
        spin: 0.6,
        streaks: 0.3,
        sprites: [],
        matter: [{
            sprite: 'streak', tint: 1, share: 0.85, size: 0.014, aspect: 5, orient: 'radial', swirl: 0.5, wobble: 0.1, glow: 0.8, flicker: 0.3,
        }],
        rim: 'molten',
    },
    // The sea: caustic light on the walls, shafts from the surface, bubbles and a school of fish.
    bubbles: {
        wall: 'water',
        wallValue: [0.34, 0.3],
        wallAlpha: 0.9,
        spin: 0.5,
        lightAhead: 1.2,
        streaks: 0.12,
        sprites: ['bubble', 'fish', 'shaft'],
        matter: [{
            sprite: 'bubble', tint: 0, share: 0.5, size: 0.05, aspect: 1, orient: 'none', swirl: 0.25, wobble: 0.22,
        }],
        shafts: 5,
        school: 9,
        rim: 'ripple',
    },
    // The island: soft air, petals and leaves turning as they pass.
    petals: {
        wall: 'air',
        wallValue: [0.5, 0.42],
        wallAlpha: 1,
        spin: 0.8,
        fill: 0.05,
        streaks: 0.12,
        sprites: ['petal', 'leaf', 'shaft'],
        shafts: 4,
        matter: [
            {
                sprite: 'petal', tint: 0, share: 0.46, size: 0.056, aspect: 1.33, orient: 'tumble', swirl: 1.1, wobble: 0.12,
            },
            {
                sprite: 'leaf', tint: 1, share: 0.3, size: 0.044, aspect: 2, orient: 'tumble', swirl: 0.8, wobble: 0.1,
            },
        ],
        rim: 'wreath',
    },
    // The mountains: wind you can see, and snow on it.
    snow: {
        wall: 'wind',
        wallValue: [0.42, 0.36],
        wallAlpha: 0.7,
        spin: 1.5,
        streaks: 0.12,
        sprites: [],
        matter: [
            {
                sprite: 'glow', tint: 0, share: 1.1, size: 0.03, aspect: 1, orient: 'radial', swirl: 1.5, wobble: 0.06, rushStretch: 1.4,
            },
            // A few big soft flakes close to the lens.
            {
                sprite: 'glow', tint: 0, share: 0.16, size: 0.085, aspect: 1, orient: 'none', swirl: 1.9, wobble: 0.1, alpha: 0.5,
            },
        ],
        rim: 'frost',
    },
    // The sky: heaped cloud, shafts of gold light through it.
    cloud: {
        wall: 'cumulus',
        wallValue: [0.56, 0.44],
        wallAlpha: 0.75,
        spin: 0.35,
        fill: 0.07,
        lightAhead: 1.25,
        streaks: 0.14,
        sprites: ['shaft'],
        matter: [{
            sprite: 'glow', tint: 1, share: 0.3, size: 0.016, aspect: 1, orient: 'none', swirl: 0.3, wobble: 0.1,
        }],
        shafts: 7,
        rim: 'halo',
    },
    // Space: stars and dust, as the gate was first drawn.
    stars: {
        wall: 'dust',
        wallValue: [0.36, 0.3],
        wallAlpha: 1,
        spin: 1,
        streaks: 1,
        sprites: [],
        matter: [],
        rim: 'orbit',
    },
    // Inside the hole: space folded into facets, shards of it turning past.
    facets: {
        wall: 'shards',
        wallValue: [0.4, 0.32],
        wallAlpha: 0.9,
        spin: 1.3,
        streaks: 0.25,
        sprites: ['shard'],
        matter: [{
            sprite: 'shard', tint: 0, share: 0.5, size: 0.062, aspect: 1, orient: 'flip', swirl: 0.6, wobble: 0, twoTone: true,
        }],
        rim: 'polygon',
    },
    // The city: a wire tunnel of light, neon rain down it.
    neon: {
        wall: 'grid',
        wallValue: [0.46, 0.4],
        wallAlpha: 0.5,
        spin: 0,
        align: true,
        streaks: 0.2,
        sprites: [],
        matter: [{
            sprite: 'streak', tint: 0, share: 0.9, size: 0.008, aspect: 30, orient: 'radial', swirl: 0, wobble: 0, twoTone: true, rushStretch: 0.8,
        }],
        hoops: 3,
        rim: 'tube',
    },
});

export const DEFAULT_PASSAGE_KIND = 'stars';

/** @returns {Readonly<PassageKind>} a kind by name (space's for anything unknown) */
export function resolvePassageKind(name) {
    return PASSAGE_KINDS[name] || PASSAGE_KINDS[DEFAULT_PASSAGE_KIND];
}

// ── Drawing ─────────────────────────────────────────────────────────────────────

function place(ctx, dpr, sprite, x, y, length, height, rotation, flip = 1) {
    const cos = Math.cos(rotation) * dpr;
    const sin = Math.sin(rotation) * dpr;
    ctx.setTransform(cos * flip, sin * flip, -sin, cos, x * dpr, y * dpr);
    ctx.drawImage(sprite, -length / 2, -height / 2, length, height);
}

/**
 * The kind's matter flying past: each piece rides out from the light ahead (in from the lens
 * coming back), growing as it nears, turning with the passage's own swirl.
 * @param {CanvasRenderingContext2D} ctx additive ('lighter'), set by the caller
 * @param {object} gate createPortalGate()'s (its `kind`, `matter` pieces and tinted `sprites`)
 * @param {{dpr: number, cx: number, cy: number, reach: number, travel: number, direction: number,
 *   time: number, intensity: number, rush: number}} env
 */
export function drawMatter(ctx, gate, env) {
    const { sprites, kind } = gate;
    if (!sprites || !gate.matter?.length) return;
    const {
        dpr, cx, cy, reach, travel, direction, time, intensity, rush,
    } = env;
    for (const piece of gate.matter) {
        const spec = kind.matter[piece.spec];
        let depth = fract(piece.phase + travel * 0.42 * piece.pace);
        if (direction < 0) depth = 1 - depth;
        let alpha = intensity * Math.min(1, Math.sin(Math.PI * depth) ** 0.7 * 1.15) * (spec.alpha ?? 1);
        if (spec.flicker) alpha *= 1 - spec.flicker * (0.5 + 0.5 * Math.sin(time * (2.2 + piece.seed * 2.6) + piece.seed * 40));
        if (alpha <= 0.004) continue;
        const angle = piece.angle
            + gate.swirl * spec.swirl * depth
            + spec.wobble * Math.sin(time * (0.8 + piece.seed) + piece.seed * 30);
        const radius = reach * (0.03 + 0.95 * depth ** 2.1);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        const height = reach * spec.size * (0.3 + 1.5 * depth) * piece.scale;
        let length = height * spec.aspect;
        let rotation = 0;
        let flip = 1;
        if (spec.orient === 'radial') {
            length *= 1 + rush * (spec.rushStretch ?? 0.6);
            rotation = direction < 0 ? angle + Math.PI : angle;
        } else if (spec.orient === 'tumble') {
            rotation = angle + piece.seed * TAU + time * piece.spin;
            // Turning over as it flies: its face narrows and widens.
            flip = 0.3 + 0.7 * Math.abs(Math.cos(time * piece.spin * 1.3 + piece.seed * 9));
        } else if (spec.orient === 'flip') {
            rotation = piece.seed * TAU + time * piece.spin * 0.4;
            flip = Math.cos(time * piece.spin * 1.6 + piece.seed * 9);
            // Edge-on, a shard catches nothing.
            alpha *= 0.35 + 0.65 * Math.abs(flip);
            if (Math.abs(flip) < 0.06) continue;
        }
        const sprite = sprites.matter[piece.spec][spec.twoTone ? piece.tone : 0];
        ctx.globalAlpha = Math.min(1, alpha);
        place(ctx, dpr, sprite, x, y, length, height, rotation, flip);
        if (spec.glow && piece.tone === 0) {
            // A hot head on what is burning (every other piece: the rest are sparks).
            ctx.globalAlpha = Math.min(1, alpha * spec.glow);
            place(ctx, dpr, sprites.glowHot, x, y, height * 3.2, height * 3.2, 0);
        }
    }
}

/**
 * What a kind adds to the passage besides its matter: shafts of light from the light ahead, a
 * school of fish, hoops of light. Drawn before the matter.
 */
export function drawPassageExtras(ctx, gate, env) {
    const { sprites, kind } = gate;
    if (!sprites) return;
    const {
        dpr, cx, cy, reach, travel, direction, time, intensity,
    } = env;
    if (kind.shafts && sprites.shaft) {
        // Shafts turn slowly and breathe, each on its own period: never a strobe.
        for (const shaft of gate.shafts) {
            const breath = 0.55 + 0.45 * Math.sin(time * shaft.rate + shaft.seed * TAU);
            const alpha = intensity * shaft.alpha * breath;
            if (alpha <= 0.004) continue;
            const angle = shaft.angle + time * shaft.turn * gate.swirl;
            const length = reach * shaft.length;
            const width = length * shaft.width;
            const cos = Math.cos(angle) * dpr;
            const sin = Math.sin(angle) * dpr;
            ctx.globalAlpha = alpha;
            const from = reach * 0.03;
            ctx.setTransform(cos, sin, -sin, cos, (cx + Math.cos(angle) * from) * dpr, (cy + Math.sin(angle) * from) * dpr);
            ctx.drawImage(sprites.shaft, 0, -width / 2, length, width);
        }
    }
    if (kind.school && sprites.school) {
        // A school crosses the passage now and then: one arc, each fish a beat behind the last.
        const { school } = gate;
        const lap = travel * school.pace + school.phase;
        const pass = fract(lap);
        // A different crossing every lap.
        const turn = hash(Math.floor(lap), 3, school.salt) * TAU;
        const side = hash(Math.floor(lap), 5, school.salt) < 0.5 ? -1 : 1;
        for (const fish of school.fish) {
            const t = (direction < 0 ? 1 - pass : pass) * 1.5 - fish.lag;
            if (t <= 0 || t >= 1) continue;
            const angle = turn + side * (t * 2.4 + fish.spread);
            const radius = reach * (0.16 + 0.5 * t + fish.out);
            // Each turns its flank to the light now and then (a glint, slower than twice a second).
            const glint = 0.55 + 0.45 * Math.sin(time * 4 * fish.rate + fish.spread * 50) ** 2;
            const alpha = intensity * Math.sin(Math.PI * t) * glint;
            if (alpha <= 0.004) continue;
            const length = reach * 0.05 * (0.5 + t) * fish.scale;
            // Heading along its arc, as it would swim.
            const heading = angle + side * (Math.PI / 2) * (direction < 0 ? -1 : 1) + 0.35 * side;
            ctx.globalAlpha = Math.min(1, alpha);
            const fx = cx + Math.cos(angle) * radius;
            const fy = cy + Math.sin(angle) * radius;
            place(ctx, dpr, sprites.school, fx, fy, length, length / 3, heading);
        }
    }
    if (kind.hoops && typeof ctx.arc === 'function') {
        // Hoops of light the passage runs through.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let k = 0; k < kind.hoops; k++) {
            let depth = fract(k / kind.hoops + travel * 0.3 + gate.hoopPhase);
            if (direction < 0) depth = 1 - depth;
            const alpha = intensity * Math.sin(Math.PI * depth) ** 1.4 * 0.42;
            if (alpha <= 0.004) continue;
            const radius = reach * (0.04 + 1.05 * depth ** 2.2);
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = gate.colors[k % 2 ? 'accent' : 'highlight'];
            ctx.lineWidth = 1 + 2.6 * depth;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, TAU);
            ctx.stroke();
        }
    }
}

/**
 * The rim's ornament: what the gate's edge is made of here. Drawn over the gate's own ring of
 * light (portal-gate.js drawRim), additively, in the gate's colours.
 * @param {CanvasRenderingContext2D} ctx additive, transform at dpr scale, set by the caller
 * @param {object} gate
 * @param {{x: number, y: number, r: number, strength: number, time: number}} ring
 */
export function drawRimOrnament(ctx, gate, ring) {
    const {
        x, y, r, strength, time,
    } = ring;
    const { colors, kind } = gate;
    const rimMarks = gate.rimMarks || [];
    if (strength <= 0.004 || r <= 1) return;
    const lines = typeof ctx.moveTo === 'function' && typeof ctx.lineTo === 'function';
    const scale = Math.min(1, r / 160);
    const arc = (radius, width, color, alpha, from, to) => {
        if (alpha <= 0.004 || radius <= 0) return;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(x, y, radius, from, to);
        ctx.stroke();
    };
    const tick = (angle, from, to, width, color, alpha) => {
        if (!lines || alpha <= 0.004) return;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * from, y + Math.sin(angle) * from);
        ctx.lineTo(x + Math.cos(angle) * to, y + Math.sin(angle) * to);
        ctx.stroke();
    };
    ctx.lineCap = 'round';
    switch (kind.rim) {
    case 'molten':
        // Molten glass: a thick glowing lip, beads of it swelling and running round.
        arc(r, (10 + 14 * scale), colors.primary, 0.2 * strength, 0, TAU);
        for (const mark of rimMarks) {
            const swell = 0.5 + 0.5 * Math.sin(time * mark.rate * 1.4 + mark.seed * TAU);
            const at = mark.angle + time * 0.12 * mark.turn;
            arc(r, (3 + 5 * swell) * (0.5 + scale), colors.accent, (0.3 + 0.5 * swell) * strength, at, at + mark.span * (0.5 + 0.5 * swell));
            // A drip running inward off the lip.
            tick(at, r - 2, r - (4 + 22 * swell * mark.reach) * (0.4 + scale), 2.2, colors.highlight, 0.55 * swell * strength);
        }
        break;
    case 'ripple':
        // Water: the ring is a ripple, and more spread from it.
        for (let k = 0; k < 3; k++) {
            const phase = fract(time * 0.42 + k / 3);
            arc(r * (1 + 0.1 * phase * (0.4 + scale)), 1.6, colors.accent, (1 - phase) * 0.55 * strength, 0, TAU);
            arc(Math.max(1, r * (1 - 0.07 * phase)), 1.2, colors.highlight, (1 - phase) * 0.35 * strength, 0, TAU);
        }
        break;
    case 'wreath':
        // A wreath: leaves laid round the ring, turning with it.
        for (const mark of rimMarks) {
            const at = mark.angle + time * 0.22;
            const sway = 0.25 * Math.sin(time * mark.rate + mark.seed * TAU);
            const from = at + sway * 0.1;
            const leaf = mark.turn > 0 ? colors.accent : colors.highlight;
            const width = (2.4 + 3.6 * mark.reach) * (0.45 + scale);
            arc(r + (mark.reach - 0.5) * 7 * scale, width, leaf, (0.45 + 0.4 * mark.reach) * strength, from, from + mark.span * 0.55);
        }
        break;
    case 'frost':
        // Frost: needles of ice standing off the ring.
        for (const mark of rimMarks) {
            const glint = 0.6 + 0.4 * Math.sin(time * mark.rate + mark.seed * TAU);
            const length = (6 + 26 * mark.reach) * (0.35 + scale);
            tick(mark.angle, r, r + length, 1.4, colors.highlight, 0.7 * glint * strength);
            tick(mark.angle + 0.02, r + length * 0.45, r + length * 0.8, 1, colors.accent, 0.5 * glint * strength);
        }
        break;
    case 'halo':
        // A halo round the sun: a wide soft ring, a faint one outside it, a sun dog either side.
        arc(r, 14 + 20 * scale, colors.accent, 0.13 * strength, 0, TAU);
        arc(r * 1.12, 2, colors.primary, 0.3 * strength, 0, TAU);
        arc(r * 1.12, 7, colors.highlight, 0.4 * strength, -0.11, 0.11);
        arc(r * 1.12, 7, colors.highlight, 0.4 * strength, Math.PI - 0.11, Math.PI + 0.11);
        break;
    case 'orbit':
        // A bright body riding the ring, and its wake.
        for (const mark of rimMarks.slice(0, 2)) {
            const at = mark.angle + time * 0.6 * mark.turn;
            arc(r, 2.6, colors.highlight, 0.85 * strength, at, at + 0.05);
            arc(r, 1.4, colors.accent, 0.4 * strength, at - 0.5 * mark.turn, at);
        }
        break;
    case 'polygon':
        // The ring folded: two polygons turning against each other inside it.
        if (lines) {
            for (let k = 0; k < 2; k++) {
                const sides = (gate.rimSides || 6) + k * 2;
                const turn = time * (k ? -0.35 : 0.25) + (rimMarks[0]?.angle || 0);
                ctx.globalAlpha = (k ? 0.4 : 0.6) * strength;
                ctx.strokeStyle = k ? colors.accent : colors.highlight;
                ctx.lineWidth = k ? 1.2 : 1.8;
                ctx.beginPath();
                for (let i = 0; i <= sides; i++) {
                    const a = turn + (i / sides) * TAU;
                    const px = x + Math.cos(a) * r * (k ? 1.07 : 0.985);
                    const py = y + Math.sin(a) * r * (k ? 1.07 : 0.985);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
            }
        }
        break;
    case 'tube':
        // A neon tube: two colours side by side, dashes of light running round it.
        arc(r + 4, 2.4, colors.accent, 0.8 * strength, 0, TAU);
        arc(Math.max(1, r - 4), 2.4, colors.primary, 0.8 * strength, 0, TAU);
        for (const mark of rimMarks) {
            const at = mark.angle + time * 0.9 * mark.turn;
            arc(r + (mark.turn > 0 ? 4 : -4), 3.4, colors.highlight, 0.75 * strength, at, at + mark.span * 0.4);
        }
        break;
    default:
        break;
    }
}
