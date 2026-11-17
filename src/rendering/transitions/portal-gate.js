/**
 * The gate between the Odyssey world and an orb: one visual language for both ways through.
 *
 * Entering an orb, light gathers onto it (motes spiral in, a ring closes on it), the orb opens
 * into a circular gate with a bright rim, the gate swells over the whole screen and its centre
 * glides to the middle while the world darkens around it, and inside it is the passage: the
 * walls of a way through rushing past, matter flying by, the destination's own light ahead.
 * The passage is what plays while the next board prepares. On arrival the light ahead swells and
 * a second gate opens from it onto the board. Leaving, the board closes into a shrinking gate,
 * the passage streams the other way, and the world opens through a gate at the finished orb,
 * its own light blooming through.
 *
 * It is seen in and out of every orb, 120 times a journey, so no two are alike: the passage is
 * MADE OF the chapter you are in (portal-gate-matter.js: embers, bubbles, petals, snow, cloud,
 * stars, facets, neon), PAINTED IN the colours of the world you are going to (the palette: its
 * two strongest hues on the walls, its key light on the streaks, the rim and the light ahead,
 * its brightness lifting or deepening the whole), and LAID OUT from a seed of its own (`look`:
 * which way it swirls, how it curves, where everything in it starts).
 *
 * Plain 2D canvas: no WebGPU pipeline of its own, so nothing here compiles while the level's
 * theme does. The textures (a wall ring, a few sprites, a streak, a glow) are made once on the
 * CPU, the noise once per kind and the tints once per palette, and every frame is a few dozen
 * scaled image draws and ring strokes. Pure functions; the transitions own timing and the DOM.
 */
import {
    DEFAULT_PASSAGE_KIND, PASSAGE_KINDS, bakeMatterSprite, bakeWallRing, drawMatter, drawPassageExtras,
    drawRimOrnament, resolvePassageKind,
} from './portal-gate-matter.js';

export { bakeNebulaRing } from './portal-gate-matter.js';

const TAU = Math.PI * 2;

/** Per quality preset: wall layers, streaks and matter, gathering motes, and the wall texture's size. */
export const PORTAL_GATE_COUNTS = Object.freeze({
    Minimal: Object.freeze({
        layers: 3, streaks: 22, motes: 12, texture: 224,
    }),
    Low: Object.freeze({
        layers: 4, streaks: 32, motes: 16, texture: 256,
    }),
    Medium: Object.freeze({
        layers: 5, streaks: 46, motes: 20, texture: 288,
    }),
    High: Object.freeze({
        layers: 6, streaks: 64, motes: 26, texture: 320,
    }),
    Ultra: Object.freeze({
        layers: 7, streaks: 80, motes: 30, texture: 352,
    }),
    Extreme: Object.freeze({
        layers: 8, streaks: 96, motes: 34, texture: 384,
    }),
});

/**
 * The most a gate's own clock advances in one frame. A click on an orb sets off seconds of work,
 * and a frame the main thread drops must slow the gathering and the opening, never skip them (a
 * real-game capture lost the whole gathering to one 300 ms stall). Hold timeouts keep real time.
 */
export const GATE_MAX_FRAME_STEP_MS = 50;

const REQUIRED_CONTEXT = [
    'beginPath', 'arc', 'stroke', 'fill', 'rect', 'clip', 'save', 'restore', 'setTransform',
    'drawImage', 'fillRect', 'createRadialGradient',
];

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const fract = (value) => value - Math.floor(value);
const smoothstep = (lo, hi, value) => {
    const t = clamp01((value - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};

/** A small seeded generator (mulberry32): one passage's layout from one number. */
export function seededRandom(seed) {
    let state = (Number(seed) || 0) >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Sprites (DOM canvases, once per palette) ────────────────────────────────────

/** White-light bases: a wall ring per kind and size, a matter sprite per name. Baked once a page. */
const baseCache = new Map();
/** Sprites in a palette's colours. A palette is a theme and a session visits a handful. */
const tintCache = new Map();
const TINT_CACHE_LIMIT = 96;

function makeCanvas(documentRef, width, height) {
    const canvas = documentRef?.createElement?.('canvas');
    if (!canvas) return null;
    canvas.width = width;
    canvas.height = height;
    let ctx = null;
    try {
        ctx = canvas.getContext?.('2d');
    } catch {
        ctx = null;
    }
    if (!ctx || typeof ctx.drawImage !== 'function' || typeof ctx.fillRect !== 'function') return null;
    return { canvas, ctx };
}

/** Keep a sprite, letting the oldest go once the cache is full. */
function remember(key, canvas) {
    if (tintCache.size >= TINT_CACHE_LIMIT) tintCache.delete(tintCache.keys().next().value);
    tintCache.set(key, canvas);
    return canvas;
}

/** A canvas holding baked white-light pixels, made once per key. */
function baseSprite(documentRef, key, width, height, bake) {
    if (baseCache.has(key)) return baseCache.get(key);
    const made = makeCanvas(documentRef, width, height);
    if (!made || typeof made.ctx.createImageData !== 'function' || typeof made.ctx.putImageData !== 'function') {
        return null;
    }
    const image = made.ctx.createImageData(width, height);
    image.data.set(bake());
    made.ctx.putImageData(image, 0, 0);
    baseCache.set(key, made.canvas);
    return made.canvas;
}

/** The passage's wall for a kind, as white light. */
function wallBase(documentRef, wall, size) {
    return baseSprite(documentRef, `wall|${wall}|${size}`, size, size, () => bakeWallRing(wall, size));
}

/** One of a kind's matter sprites (a bubble, a petal, a shard ...), as white light. */
function matterBase(documentRef, name) {
    const baked = bakeMatterSprite(name);
    if (!baked) return null;
    return baseSprite(documentRef, `matter|${name}`, baked.width, baked.height, () => baked.data);
}

/** A white-light sprite turned to one colour (its alpha kept). */
function tinted(documentRef, source, color, key) {
    if (!source) return null;
    if (tintCache.has(key)) return tintCache.get(key);
    const made = makeCanvas(documentRef, source.width, source.height);
    if (!made) return null;
    made.ctx.drawImage(source, 0, 0);
    made.ctx.globalCompositeOperation = 'source-in';
    made.ctx.fillStyle = color;
    made.ctx.fillRect(0, 0, source.width, source.height);
    return remember(key, made.canvas);
}

/** A soft round glow in one colour: white at the heart for the hottest of them. */
function glowSprite(documentRef, color, key, hot = false) {
    if (tintCache.has(key)) return tintCache.get(key);
    const size = 128;
    const made = makeCanvas(documentRef, size, size);
    if (!made || typeof made.ctx.createRadialGradient !== 'function') return null;
    const g = made.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    if (hot) g.addColorStop(0, '#ffffff');
    g.addColorStop(hot ? 0.08 : 0, color);
    g.addColorStop(0.32, colorWithAlpha(color, 0.38));
    g.addColorStop(0.62, colorWithAlpha(color, 0.1));
    g.addColorStop(1, colorWithAlpha(color, 0));
    made.ctx.fillStyle = g;
    made.ctx.fillRect(0, 0, size, size);
    return remember(key, made.canvas);
}

/** A streak of light along +x: a fading tail, a bright head, a soft glow round its line. */
function streakSprite(documentRef, color, key) {
    if (tintCache.has(key)) return tintCache.get(key);
    const width = 256;
    const height = 24;
    const made = makeCanvas(documentRef, width, height);
    if (!made || typeof made.ctx.createImageData !== 'function') return null;
    const image = made.ctx.createImageData(width, height);
    const rgb = parseColor(color);
    for (let y = 0; y < height; y++) {
        const across = (y + 0.5 - height / 2) / (height / 2);
        const line = Math.exp(-(across * across) * 26);
        const glow = Math.exp(-(across * across) * 3.2) * 0.22;
        for (let x = 0; x < width; x++) {
            const along = (x + 0.5) / width;
            const tail = along ** 2.2;
            const head = Math.exp(-(((1 - along) * 18) ** 2)) * 0.9;
            const a = Math.min(1, (line + glow) * (tail + head));
            const o = (y * width + x) * 4;
            const hot = Math.min(1, line * head * 1.4);
            image.data[o] = Math.round(rgb[0] + (255 - rgb[0]) * hot);
            image.data[o + 1] = Math.round(rgb[1] + (255 - rgb[1]) * hot);
            image.data[o + 2] = Math.round(rgb[2] + (255 - rgb[2]) * hot);
            image.data[o + 3] = Math.round(a * 255);
        }
    }
    made.ctx.putImageData(image, 0, 0);
    return remember(key, made.canvas);
}

/** '#rrggbb', '#rgb' or 'rgb(a)(…)' → [r, g, b] (0..255). Anything else is white. */
export function parseColor(color) {
    if (typeof color !== 'string') return [255, 255, 255];
    const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
        return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    }
    const rgb = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (rgb) return [1, 2, 3].map((i) => Math.max(0, Math.min(255, Math.round(Number(rgb[i])))));
    return [255, 255, 255];
}

function colorWithAlpha(color, alpha) {
    const [r, g, b] = parseColor(color);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixColor(a, b, t) {
    const ca = parseColor(a);
    const cb = parseColor(b);
    return ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
}

/** A colour as hue, saturation and lightness (each 0..1). */
function toHsl(color) {
    const [r, g, b] = parseColor(color).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    return [h, s, l];
}

function fromHsl(h, sat, lightness) {
    const q = lightness < 0.5 ? lightness * (1 + sat) : lightness + sat - lightness * sat;
    const p = 2 * lightness - q;
    const channel = (t0) => {
        let t = t0;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const out = sat === 0 ? [lightness, lightness, lightness] : [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
    return `rgb(${out.map((v) => Math.round(v * 255)).join(', ')})`;
}

/**
 * A colour set to a lightness and a floor of saturation (HSL), keeping its hue: palettes are
 * authored for UI (pale, light), and light added onto light washes out to a white fog, so the
 * passage's clouds take their hue at a deep, saturated value instead.
 */
export function deepen(color, lightness = 0.42, minSaturation = 0.7) {
    const [h, s] = toHsl(color);
    return fromHsl(h, s === 0 ? 0 : Math.max(s, minSaturation), lightness);
}

/**
 * A colour of the destination's picture at the lightness the passage needs, its saturation
 * lifted in proportion to what it HAS. A floor of saturation (deepen) turns the faint cast of a
 * grey into a vivid hue: a storm-cloud grey became a blue passage into a golden prairie (audit
 * 2026-11-17). Here a moonlit grey-blue world keeps a muted passage and a golden one a rich one.
 */
export function passageTint(color, lightness, lift = 1.5, most = 0.88) {
    const [h, s] = toHsl(color);
    const sat = s < 0.04 ? 0 : Math.min(most, Math.max(s, s * lift + 0.06));
    return fromHsl(h, sat, clamp01(lightness));
}

// ── The gate ────────────────────────────────────────────────────────────────────

/** How many marks a rim's ornament is made of (portal-gate-matter.js drawRimOrnament). */
const RIM_MARKS = Object.freeze({
    molten: 9, wreath: 14, frost: 26, orbit: 2, polygon: 1, tube: 6,
});

/**
 * Everything one run draws with: sprites in its palette and a fixed layout of layers, streaks,
 * matter and motes (deterministic when `random` is, or when `look.seed` is given).
 * @param {object} [options]
 * @param {string} [options.qualityPreset]
 * @param {{primary?: string, accent?: string, highlight?: string, shadow?: string}} [options.palette]
 *   the destination's colours: its two strongest hues, its key light, its shadow
 * @param {{kind?: string, seed?: number, key?: number, world?: string}|null} [options.look] what
 *   the passage is made of (a PASSAGE_KINDS name: the chapter you are in), this passage's own
 *   seed, how bright the destination is (0 a night, 1 a white-out), and the light of the world
 *   the gate opens back onto (the emergence's bloom)
 * @param {() => number} [options.random] overrides the seed (tests)
 * @param {Document|{createElement: Function}|null} [options.documentRef]
 */
export function createPortalGate({
    qualityPreset = 'High', palette = {}, look = null, random = null, documentRef = globalThis.document,
} = {}) {
    const counts = PORTAL_GATE_COUNTS[qualityPreset] || PORTAL_GATE_COUNTS.High;
    const kindName = Object.hasOwn(PASSAGE_KINDS, look?.kind) ? look.kind : DEFAULT_PASSAGE_KIND;
    const kind = resolvePassageKind(kindName);
    let rand = random;
    if (typeof rand !== 'function') rand = Number.isFinite(look?.seed) ? seededRandom(look.seed) : Math.random;
    const brightness = clamp01(Number.isFinite(look?.key) ? look.key : 0.35);
    const colors = {
        primary: palette.primary || '#ffd38a',
        accent: palette.accent || '#fff3c8',
        highlight: palette.highlight || '#ffffff',
        shadow: palette.shadow || '#05070d',
    };
    const key = `${kindName}|${colors.primary}|${colors.accent}|${colors.highlight}`;
    // The walls in the destination's two hues at a deep value (the light comes from the streaks
    // and the light ahead, not from fog); a bright world lifts them, a night deepens them.
    const lift = 0.86 + 0.42 * brightness;
    const wallA = passageTint(colors.primary, Math.min(0.7, kind.wallValue[0] * lift));
    const wallB = passageTint(colors.accent, Math.min(0.66, kind.wallValue[1] * lift));
    // What flies past wears the destination's light and its second hue, bright.
    const matterTints = [passageTint(colors.highlight, 0.8, 1.2), passageTint(colors.accent, 0.64, 1.7)];
    const wall = wallBase(documentRef, kind.wall, counts.texture);
    const matterSprite = (name, color) => {
        if (name === 'streak') return streakSprite(documentRef, color, `s|${color}`);
        if (name === 'glow') return glowSprite(documentRef, color, `g|${color}`);
        return tinted(documentRef, matterBase(documentRef, name), color, `m|${name}|${color}`);
    };
    const sprites = wall ? {
        nebula: [
            tinted(documentRef, wall, wallA, `w|${kind.wall}|${counts.texture}|${wallA}`),
            tinted(documentRef, wall, wallB, `w|${kind.wall}|${counts.texture}|${wallB}`),
        ],
        streak: [
            streakSprite(documentRef, colors.highlight, `s|${colors.highlight}`),
            streakSprite(documentRef, colors.accent, `s|${colors.accent}`),
        ],
        glowHot: glowSprite(documentRef, colors.highlight, `gh|${colors.highlight}`, true),
        glowPrimary: glowSprite(documentRef, colors.primary, `gp|${colors.primary}`),
        glowAccent: glowSprite(documentRef, colors.accent, `ga|${colors.accent}`),
        // Per matter spec: the sprite in its own tint and in the other one (two-tone specs).
        matter: kind.matter.map((spec) => [
            matterSprite(spec.sprite, matterTints[spec.tint]),
            matterSprite(spec.sprite, matterTints[1 - spec.tint]),
        ]),
    } : null;
    if (sprites && kind.shafts) sprites.shaft = matterSprite('shaft', matterTints[0]);
    if (sprites && kind.school) sprites.school = matterSprite('fish', passageTint(colors.highlight, 0.9, 1));
    if (sprites && look?.world) {
        // The world the gate opens back onto: its own light, for the emergence's bloom.
        sprites.glowWorld = glowSprite(documentRef, look.world, `gw|${look.world}`, true);
        sprites.shaftWorld = matterSprite('shaft', passageTint(look.world, 0.82, 1.1));
    }
    const usable = sprites && Object.values(sprites).flat(2).every(Boolean);
    const deep = mixColor(passageTint(colors.shadow, 0.07 + 0.06 * brightness), '#000000', 0.2);
    const heart = parseColor(passageTint(colors.primary, 0.15 + 0.15 * brightness + (kind.fill || 0)));
    const layers = Array.from({ length: counts.layers }, (_, index) => ({
        phase: index / counts.layers,
        turn: rand() * TAU,
        spin: (index % 2 ? -1 : 1) * (0.12 + rand() * 0.18),
        tint: index % 2,
        alpha: 0.5 + rand() * 0.3,
    }));
    const streaks = Array.from({ length: counts.streaks }, (_, index) => ({
        angle: rand() * TAU,
        phase: rand(),
        length: 0.55 + rand() * 0.9,
        width: 0.7 + rand() * 1.1,
        tint: index % 3 === 0 ? 0 : 1,
    }));
    const motes = Array.from({ length: counts.motes }, (_, index) => ({
        angle: rand() * TAU,
        from: 2.2 + rand() * 2.6,
        delay: rand() * 0.35,
        spin: (index % 2 ? -1 : 1) * (1.1 + rand() * 0.9),
        size: 0.12 + rand() * 0.14,
        hot: index % 4 === 0,
    }));
    // This passage's own character: which way it swirls and how hard, how it curves, how much
    // of its matter it carries, which of its two hues its nearest wall wears.
    const swirl = (rand() < 0.5 ? -1 : 1) * (0.65 + rand() * 0.75);
    const bend = {
        angle: rand() * TAU,
        rate: (rand() < 0.5 ? -1 : 1) * (0.1 + rand() * 0.22),
        amount: 0.02 + rand() * 0.05,
    };
    const density = 0.75 + rand() * 0.5;
    // ... how fast it runs, how wide it stands open and how near the light ahead feels.
    const pace = 0.85 + rand() * 0.35;
    const width = 0.9 + rand() * 0.16;
    const ahead = 0.85 + rand() * 0.3;
    if (rand() < 0.5) layers.forEach((layer) => { layer.tint = 1 - layer.tint; });
    if (kind.align) {
        // A wire tunnel's rails line up from layer to layer.
        const turn = rand() * TAU;
        layers.forEach((layer) => { layer.turn = turn; });
    }
    const matter = kind.matter.flatMap((spec, specIndex) => Array.from(
        { length: Math.round(counts.streaks * spec.share * density) },
        (_, index) => ({
            spec: specIndex,
            angle: rand() * TAU,
            phase: rand(),
            pace: 0.7 + rand() * 0.6,
            seed: rand(),
            scale: 0.6 + rand() * 0.8,
            spin: (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 1.6),
            tone: index % 2,
        }),
    ));
    const tier = counts.layers / PORTAL_GATE_COUNTS.High.layers;
    const rimMarkCount = RIM_MARKS[kind.rim] || 0;
    const makeShafts = (count) => Array.from({ length: count }, () => ({
        angle: rand() * TAU,
        turn: (rand() < 0.5 ? -1 : 1) * (0.02 + rand() * 0.05),
        rate: 0.3 + rand() * 0.5,
        seed: rand(),
        alpha: 0.12 + rand() * 0.14,
        length: 0.62 + rand() * 0.4,
        width: 0.12 + rand() * 0.12,
    }));
    return {
        key,
        kind,
        kindName,
        colors,
        sprites: usable ? sprites : null,
        deep: `rgb(${deep.join(', ')})`,
        // The passage's far wall and how dark its edges fall: a bright world's way in is airier.
        far: `rgb(${mixColor(`rgb(${deep.join(', ')})`, '#010103', 0.85 - 0.6 * brightness).join(', ')})`,
        vignette: `rgba(0, 0, 0, ${(0.62 - 0.3 * brightness).toFixed(3)})`,
        heart: `rgb(${heart.join(', ')})`,
        layers,
        streaks,
        /** How many of the streaks stay streaks of light (the rest of the passage is its matter). */
        streakCount: Math.round(counts.streaks * kind.streaks),
        motes,
        matter,
        swirl,
        bend,
        pace,
        width,
        ahead,
        shafts: kind.shafts ? makeShafts(Math.max(3, Math.round(kind.shafts * tier))) : [],
        worldShafts: look?.world ? makeShafts(Math.max(5, Math.round(9 * tier))) : [],
        school: kind.school ? {
            pace: 0.1 + rand() * 0.06,
            phase: rand(),
            salt: Math.floor(rand() * 65536),
            fish: Array.from({ length: Math.max(4, Math.round(kind.school * tier)) }, (_, index) => ({
                lag: index * 0.035 + rand() * 0.03,
                spread: (rand() - 0.5) * 0.22,
                out: (rand() - 0.5) * 0.09,
                scale: 0.7 + rand() * 0.6,
                rate: 0.6 + rand() * 0.8,
            })),
        } : null,
        hoopPhase: rand(),
        rimSides: 5 + Math.floor(rand() * 4),
        rimMarks: Array.from({ length: rimMarkCount }, (_, index) => ({
            // Spread round the ring, each a little off its place.
            angle: ((index + rand() * 0.8) / rimMarkCount) * TAU,
            span: 0.14 + rand() * 0.3,
            rate: 0.6 + rand() * 1.4,
            seed: rand(),
            reach: rand(),
            turn: rand() < 0.5 ? -1 : 1,
        })),
        // The gathering's motes are the kind's own matter where it has a shape (a bubble, a petal).
        gatherSprite: usable && kind.matter[0] && !['streak', 'glow'].includes(kind.matter[0].sprite)
            ? sprites.matter[0][0] : null,
    };
}

/** Test stubs and exotic contexts without the needed calls simply skip the gate. */
export function canDrawPortalGate(ctx) {
    return Boolean(ctx) && REQUIRED_CONTEXT.every((method) => typeof ctx[method] === 'function');
}

/** How far from (cx, cy) the farthest corner of the frame is. */
export function portalReach(width, height, cx, cy) {
    return Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) || 1;
}

function drawSprite(ctx, dpr, sprite, cx, cy, size, angle = 0) {
    const cos = Math.cos(angle) * dpr;
    const sin = Math.sin(angle) * dpr;
    ctx.setTransform(cos, sin, -sin, cos, cx * dpr, cy * dpr);
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
}

/**
 * The passage: its walls rushing past, the matter it is made of, streaks of light, the light
 * ahead.
 */
function drawPassage(ctx, gate, frame) {
    const {
        width, height, dpr = 1, center, direction = 1, time = 0,
    } = frame;
    // This passage's own pace (its walls and its matter run by the same clock).
    const travel = (frame.travel || 0) * (gate.pace ?? 1);
    const intensity = clamp01(frame.intensity ?? 1);
    const rush = Math.max(0, frame.rush || 0);
    const cx = center.x;
    const cy = center.y;
    const reach = portalReach(width, height, cx, cy);
    const { kind } = gate;

    // The deep of the way through, in the destination's shadow, lit a little round the light ahead.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    base.addColorStop(0, gate.heart);
    base.addColorStop(0.45, gate.deep);
    base.addColorStop(1, gate.far);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const { sprites } = gate;
    ctx.globalCompositeOperation = 'lighter';
    if (sprites) {
        // The passage curves: the walls nearest the lens swing a little to one side, and that side
        // turns slowly. The light ahead stays where the gate is.
        const bendAngle = gate.bend.angle + time * gate.bend.rate;
        const bendX = Math.cos(bendAngle) * reach * gate.bend.amount;
        const bendY = Math.sin(bendAngle) * reach * gate.bend.amount;
        // Walls: each layer swells from a speck at the light ahead to past the frame, turning
        // slowly (alternate ways), so the passage has depth; it fades in from the light and out
        // as it rushes past the lens. Outward going in, inward coming back out.
        for (const layer of gate.layers) {
            let depth = fract(layer.phase + travel * 0.16);
            if (direction < 0) depth = 1 - depth;
            // Faint while small (they would pile up into fog round the light ahead), fullest as
            // they pass the lens.
            const alpha = intensity * layer.alpha * kind.wallAlpha
                * smoothstep(0.12, 0.62, depth) * (1 - smoothstep(0.86, 1, depth));
            if (alpha <= 0.004) continue;
            const scale = Math.exp((depth - 1) * 3.5);
            ctx.globalAlpha = Math.min(1, alpha);
            drawSprite(
                ctx,
                dpr,
                sprites.nebula[layer.tint],
                cx + bendX * scale,
                cy + bendY * scale,
                reach * 3.4 * scale * (gate.width ?? 1),
                layer.turn + travel * layer.spin * kind.spin,
            );
        }
        const env = {
            dpr, cx, cy, reach, travel, direction, time, intensity, rush,
        };
        drawPassageExtras(ctx, gate, env);
        drawMatter(ctx, gate, env);
        // Streaks: light flying past, longer and brighter the nearer it is (and the faster we go).
        for (let index = 0; index < gate.streakCount; index++) {
            const streak = gate.streaks[index];
            let depth = fract(streak.phase + travel * 0.5);
            if (direction < 0) depth = 1 - depth;
            const alpha = intensity * Math.min(1, Math.sin(Math.PI * depth) ** 0.7 * 1.15);
            if (alpha <= 0.004) continue;
            const inner = reach * (0.025 + 0.95 * depth ** 2.2);
            const length = reach * (0.012 + 0.34 * depth * depth) * streak.length * (1 + rush * 1.6);
            const thick = (1.6 + 4.6 * depth) * streak.width;
            const cos = Math.cos(streak.angle) * dpr;
            const sin = Math.sin(streak.angle) * dpr;
            ctx.globalAlpha = alpha;
            if (direction < 0) {
                // Coming back out the head leads inward: the sprite runs the other way.
                ctx.setTransform(-cos, -sin, -sin, cos, cx * dpr + cos * (inner + length), cy * dpr + sin * (inner + length));
            } else {
                ctx.setTransform(cos, sin, -sin, cos, cx * dpr + cos * inner, cy * dpr + sin * inner);
            }
            ctx.drawImage(sprites.streak[streak.tint], 0, -thick / 2, length, thick);
        }
        // The light ahead: where this gate is taking you.
        const breathe = 1 + Math.sin(time * 1.9) * 0.05;
        const ahead = (kind.lightAhead || 1) * (gate.ahead ?? 1);
        ctx.globalAlpha = Math.min(1, intensity * 0.22 * ahead);
        drawSprite(ctx, dpr, sprites.glowPrimary, cx, cy, reach * 0.75 * breathe * ahead);
        ctx.globalAlpha = intensity * 0.85;
        drawSprite(ctx, dpr, sprites.glowHot, cx, cy, reach * 0.17 * breathe * ahead);
    }

    // Framing: the edges fall into the dark, so the passage has a wall.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(cx, cy, reach * 0.35, cx, cy, reach);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, gate.vignette);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
}

/**
 * The gate's rim: a crisp ring of light with a soft glow and a slight colour split, and on it
 * what the gate is made of here (molten glass, a ripple, a wreath, frost ...).
 */
function drawRim(ctx, gate, frame, ring) {
    const { dpr = 1, time = 0 } = frame;
    const strength = clamp01(ring.strength);
    if (strength <= 0.004 || ring.r <= 0.5) return;
    const { colors } = gate;
    const { r } = ring;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const stroke = (radius, lineWidth, color, alpha, from = 0, to = TAU) => {
        if (alpha <= 0.004 || radius <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, radius, from, to);
        ctx.stroke();
    };
    const scale = Math.min(1, r / 160);
    stroke(r, Math.max(6, Math.min(48, r * 0.07)) * scale + 2, colors.primary, 0.16 * strength);
    stroke(r, Math.max(3, Math.min(15, r * 0.02)) * scale + 1, colors.accent, 0.42 * strength);
    stroke(r + 2.6, 1.3, colors.accent, 0.5 * strength);
    stroke(Math.max(0.5, r - 2.6), 1.3, colors.primary, 0.5 * strength);
    stroke(r, 2.1, colors.highlight, 0.95 * strength);
    ctx.lineCap = 'round';
    if (gate.kind.rim === 'orbit') {
        // Energy running round the rim: the gate is alive.
        for (let k = 0; k < 3; k++) {
            const at = time * (k % 2 ? -1.3 : 1.1) + k * (TAU / 3);
            stroke(r, 4.2, colors.highlight, 0.55 * strength, at, at + 0.45 + 0.2 * Math.sin(time * 2 + k));
        }
    }
    drawRimOrnament(ctx, gate, {
        x: ring.x, y: ring.y, r, strength, time,
    });
    ctx.lineCap = 'butt';
}

/** Entering an orb: light, and the matter of the place, gathers onto it before it opens. */
function drawGather(ctx, gate, frame, gather) {
    const { sprites } = gate;
    if (!sprites) return;
    const { dpr = 1 } = frame;
    const t = clamp01(gather.t);
    const fade = clamp01(gather.fade ?? 1);
    if (fade <= 0.004) return;
    const r = Math.max(6, gather.r);
    const swell = t * t * t;
    ctx.globalCompositeOperation = 'lighter';
    // The orb glows hotter as the light arrives.
    ctx.globalAlpha = (0.2 + 0.5 * swell) * fade;
    drawSprite(ctx, dpr, sprites.glowPrimary, gather.x, gather.y, r * (3 + 3 * swell));
    ctx.globalAlpha = (0.15 + 0.55 * swell) * fade;
    drawSprite(ctx, dpr, sprites.glowHot, gather.x, gather.y, r * (1.4 + 1.6 * swell));
    // Motes spiral in from round the orb: bubbles, petals, shards where the place has them.
    for (const mote of gate.motes) {
        const local = clamp01((t - mote.delay) / (1 - mote.delay));
        if (local <= 0 || local >= 1) continue;
        const pull = local * local;
        const radius = r * (mote.from * (1 - pull) + 0.9 * pull);
        const angle = mote.angle + mote.spin * local * 1.6;
        const alpha = Math.sin(Math.PI * local) * 0.9 * fade;
        ctx.globalAlpha = alpha;
        const shaped = gate.gatherSprite && !mote.hot;
        const glow = mote.hot ? sprites.glowHot : sprites.glowAccent;
        drawSprite(
            ctx,
            dpr,
            shaped ? gate.gatherSprite : glow,
            gather.x + Math.cos(angle) * radius,
            gather.y + Math.sin(angle) * radius,
            r * mote.size * (shaped ? 2.2 : 3.4) * (1.2 - 0.5 * local),
            shaped ? angle * 2 + mote.from : 0,
        );
    }
    // A ring of light closes on the orb.
    const closing = 1 - (1 - t) ** 3;
    drawRim(ctx, gate, frame, {
        x: gather.x, y: gather.y, r: r * (1.1 + 2.4 * (1 - closing)), strength: Math.sin(Math.PI * Math.min(1, t * 1.05)) * fade,
    });
}

/**
 * Coming back out: the world's own light blooms through the opening gate. A glow on the gate
 * and shafts of the world's light pouring out round it into the passage; never a flash (it
 * rises and falls over tenths of a second, and Reduce flashing scales it).
 */
function drawWorldBloom(ctx, gate, frame, amount, flash) {
    const { sprites } = gate;
    const { region } = frame;
    if (!sprites?.glowWorld || region?.kind !== 'hole') return;
    const {
        width, height, dpr = 1, time = 0,
    } = frame;
    const reach = portalReach(width, height, region.x, region.y);
    const r = Math.max(1, region.r);
    ctx.globalCompositeOperation = 'lighter';
    if (sprites.shaftWorld && r < reach) {
        // The shafts light the passage, not the world: clipped to what is still shut.
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.arc(region.x, region.y, r, 0, TAU, true);
        ctx.clip('evenodd');
        for (const shaft of gate.worldShafts) {
            const angle = shaft.angle + time * shaft.turn * 3;
            const length = reach * shaft.length * (0.45 + 0.55 * amount);
            const thick = length * shaft.width * 1.3;
            const cos = Math.cos(angle) * dpr;
            const sin = Math.sin(angle) * dpr;
            ctx.globalAlpha = Math.min(1, amount * shaft.alpha * 2.2 * flash);
            ctx.setTransform(cos, sin, -sin, cos, (region.x + Math.cos(angle) * r * 0.82) * dpr, (region.y + Math.sin(angle) * r * 0.82) * dpr);
            ctx.drawImage(sprites.shaftWorld, 0, -thick / 2, length, thick);
        }
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
    }
    ctx.globalAlpha = amount * 0.42 * flash;
    drawSprite(ctx, dpr, sprites.glowWorld, region.x, region.y, r * 2.3 + reach * 0.3);
}

/**
 * Draw one frame into a cleared context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof createPortalGate>} gate
 * @param {object} frame
 * @param {number} frame.width  CSS pixels
 * @param {number} frame.height
 * @param {number} [frame.dpr]
 * @param {number} [frame.time]  seconds (the rim's energy, the light's breath)
 * @param {number} frame.travel  integrated distance through the passage (see advancePortalTravel)
 * @param {number} [frame.direction]  1 into an orb (outward), -1 back out (inward)
 * @param {{x: number, y: number}} frame.center  the light ahead
 * @param {{kind: 'all'|'disc'|'hole', x?: number, y?: number, r?: number}} frame.region  where the
 *   passage is: everywhere, inside a gate opening onto it (`disc`), or round a gate opening onto
 *   the scene below (`hole`)
 * @param {number} [frame.intensity]  the passage's light (0..1)
 * @param {number} [frame.rush]  speed of the streaks' blur (0 at cruise)
 * @param {number} [frame.dim]  how dark the scene outside a `disc` falls (0..1)
 * @param {number} [frame.rim]  the gate's rim (0..1)
 * @param {number} [frame.bloom]  the arrival's light (0..1)
 * @param {number} [frame.worldBloom]  the world's light through a gate opening back onto it (0..1)
 * @param {number} [frame.flash]  what of a bright light the player allows (photosensitivity, 0..1)
 * @param {{x: number, y: number, r: number, t: number, fade?: number}} [frame.gather]
 * @returns {boolean} whether anything was drawn
 */
export function drawPortalGate(ctx, gate, frame) {
    if (!gate || !canDrawPortalGate(ctx)) return false;
    const {
        width, height, dpr = 1, region = { kind: 'all' },
    } = frame;
    const dim = clamp01(frame.dim || 0);
    const rim = clamp01(frame.rim || 0);
    const bloom = clamp01(frame.bloom || 0);
    const worldBloom = clamp01(frame.worldBloom || 0);
    const flash = clamp01(frame.flash ?? 1);
    const previousComposite = ctx.globalCompositeOperation;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (region.kind === 'disc' && dim > 0.002) {
        // The world round an opening gate falls into shadow.
        ctx.globalAlpha = dim;
        ctx.fillStyle = gate.deep;
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.arc(region.x, region.y, Math.max(0, region.r), 0, TAU, true);
        ctx.fill('evenodd');
    }

    const covers = region.kind === 'all'
        || (region.kind === 'disc' && region.r > 0.5)
        || (region.kind === 'hole' && region.r < portalReach(width, height, region.x, region.y));
    if (covers) {
        ctx.save();
        if (region.kind !== 'all') {
            ctx.beginPath();
            if (region.kind === 'hole') ctx.rect(0, 0, width, height);
            ctx.arc(region.x, region.y, Math.max(0, region.r), 0, TAU, region.kind === 'hole');
            ctx.clip(region.kind === 'hole' ? 'evenodd' : 'nonzero');
        }
        drawPassage(ctx, gate, frame);
        ctx.restore();
    }
    ctx.save();
    if (worldBloom > 0.002) drawWorldBloom(ctx, gate, frame, worldBloom, flash);
    if (region.kind !== 'all' && rim > 0.002) {
        drawRim(ctx, gate, frame, {
            x: region.x, y: region.y, r: region.r, strength: rim,
        });
    }
    if (frame.gather) drawGather(ctx, gate, frame, frame.gather);
    if (bloom > 0.002 && gate.sprites) {
        // The arrival's light: a glow, never a flash (and less of it under Reduce flashing).
        const { center } = frame;
        const reach = portalReach(width, height, center.x, center.y);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = bloom * 0.5 * flash;
        drawSprite(ctx, dpr, gate.sprites.glowHot, center.x, center.y, reach * (0.5 + 1.1 * bloom));
        ctx.globalAlpha = bloom * 0.3 * flash;
        drawSprite(ctx, dpr, gate.sprites.glowAccent, center.x, center.y, reach * (1.2 + 1.6 * bloom));
    }
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previousComposite || 'source-over';
    return true;
}

let warmed = false;

/** One frame of each kind of gate: opening (with the gathering), the passage, the arrival. */
const WARM_FRAMES = Object.freeze([
    {
        region: {
            kind: 'disc', x: 300, y: 170, r: 120,
        },
        dim: 0.5,
        rim: 1,
        gather: {
            x: 300, y: 170, r: 40, t: 0.5,
        },
    },
    { region: { kind: 'all' }, rush: 1 },
    {
        region: {
            kind: 'hole', x: 320, y: 180, r: 90,
        },
        rim: 1,
        bloom: 0.6,
        worldBloom: 0.6,
        direction: -1,
    },
]);

/**
 * Show the gate once, unseen, before the first portal. The first portal of a session otherwise
 * stalls the GPU process while it compiles the canvas's shaders for these draws (additive image
 * draws, radial gradients, even-odd clips, arcs) and uploads the sprites: a real-game capture
 * froze the world and the gate for 300 ms on the first entry and not at all on the second. A
 * canvas that is never shown is drawn in software and warms nothing, so this one is on the page
 * at 1 % opacity for three frames (invisible over the map), then gone. Also bakes the noise:
 * with a `look`, the wall and the sprites of the chapter the player is in.
 * Once per page; call it when the map is up and idle.
 * @returns {boolean} whether it started (false when already warm or there is no page to draw on)
 */
export function warmPortalGate({
    documentRef = globalThis.document,
    requestAnimationFrameRef = globalThis.requestAnimationFrame?.bind(globalThis),
    qualityPreset = 'High',
    look = null,
} = {}) {
    if (warmed || !documentRef?.body || typeof requestAnimationFrameRef !== 'function') return false;
    const made = makeCanvas(documentRef, 640, 360);
    if (!made) return false;
    warmed = true;
    const { canvas, ctx } = made;
    canvas.setAttribute?.('aria-hidden', 'true');
    canvas.style.cssText = 'position: fixed; left: 0; top: 0; width: 640px; height: 360px; '
        + 'opacity: 0.01; pointer-events: none; z-index: 2147483000;';
    documentRef.body.appendChild(canvas);
    const gate = createPortalGate({ qualityPreset, documentRef, look: { world: '#ffffff', ...look } });
    const base = {
        width: 640, height: 360, dpr: 1, travel: 0.4, time: 0.3, flash: 1, center: { x: 320, y: 180 },
    };
    let frame = 0;
    const step = () => {
        if (frame < WARM_FRAMES.length) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect?.(0, 0, 640, 360);
            drawPortalGate(ctx, gate, { ...base, ...WARM_FRAMES[frame] });
            frame += 1;
            requestAnimationFrameRef(step);
            return;
        }
        canvas.remove?.();
        canvas.width = 0;
        canvas.height = 0;
    };
    requestAnimationFrameRef(step);
    return true;
}

/**
 * Warm the gate when the page is next idle, at the player's effect quality. Never throws.
 * @param {Window} [windowRef]
 * @param {{kind?: string}|null} [look] the passage of the chapter the player is in
 */
export function scheduleWarmPortalGate(windowRef = globalThis.window, look = null) {
    const warm = () => {
        try {
            warmPortalGate({ qualityPreset: windowRef?.settings?.effectQuality || 'High', look });
        } catch (error) {
            console.warn('[Odyssey] Portal warm-up skipped:', error);
        }
    };
    if (typeof windowRef?.requestIdleCallback === 'function') windowRef.requestIdleCallback(warm, { timeout: 4000 });
    else windowRef?.setTimeout?.(warm, 1500);
}

/** Integrate travel so a change of speed accelerates smoothly instead of jumping. */
export function advancePortalTravel(state, now, speed = 1) {
    const last = state.lastTravelAt ?? now;
    state.travel = (state.travel || 0) + Math.max(0, Math.min(100, now - last)) * 0.001 * speed;
    state.lastTravelAt = now;
    return state.travel;
}

/** The ease the gates open and close with. */
export const portalEase = {
    inCubic: (t) => t * t * t,
    outCubic: (t) => 1 - (1 - t) ** 3,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2),
    clamp01,
};
