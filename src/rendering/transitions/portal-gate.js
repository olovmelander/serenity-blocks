/**
 * The gate between the Odyssey world and an orb: one visual language for both ways through.
 *
 * Entering an orb, light gathers onto it (motes spiral in, a ring closes on it), the orb opens
 * into a circular gate with a bright rim, the gate swells over the whole screen and its centre
 * glides to the middle while the world darkens around it, and inside it is the passage: clouds in
 * the destination's colours rushing past, streaks of light, the destination's own light ahead.
 * The passage is what plays while the next board prepares. On arrival the light ahead swells and
 * a second gate opens from it onto the board. Leaving, the board closes into a shrinking gate,
 * the passage streams the other way, and the world opens through a gate at the finished orb.
 *
 * Plain 2D canvas: no WebGPU pipeline of its own, so nothing here compiles while the level's
 * theme does. The textures (a procedural nebula ring, a streak, a glow) are made once on the CPU,
 * the noise once per page and the tints once per palette, and every frame is a few dozen scaled
 * image draws and ring strokes. Pure functions; the transitions own timing and the DOM.
 */

const TAU = Math.PI * 2;

/** Per quality preset: nebula layers, streaks, gathering motes, and the nebula texture's size. */
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

/**
 * The nebula ring as alpha (white light): clouds drawn out along the radius (the noise is read in
 * turn and log radius, so a layer zooming past reads as a passage, not a stamp), with filaments
 * where the clouds cross their middle, faded out at the centre and at the rim.
 * @returns {Uint8ClampedArray} size² RGBA
 */
export function bakeNebulaRing(size, seed = 7) {
    const data = new Uint8ClampedArray(size * size * 4);
    const half = size / 2;
    const period = 9;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x + 0.5 - half) / half;
            const dy = (y + 0.5 - half) / half;
            const r = Math.hypot(dx, dy);
            const o = (y * size + x) * 4;
            const envelope = smoothstep(0.1, 0.42, r) * (1 - smoothstep(0.72, 0.99, r));
            if (envelope <= 0) continue;
            const u = (Math.atan2(dy, dx) / TAU + 0.5) * period;
            const v = Math.log(Math.max(r, 0.02)) * 2.4;
            let n = 0;
            let amp = 0.55;
            let total = 0;
            for (let octave = 0; octave < 4; octave++) {
                const k = 2 ** octave;
                n += valueNoise(u * k, v * k, period * k, seed + octave * 31) * amp;
                total += amp;
                amp *= 0.5;
            }
            n /= total;
            const cloud = smoothstep(0.44, 0.82, n);
            const thread = (1 - Math.abs(n * 2 - 1)) ** 8 * 0.7;
            const a = Math.min(1, (cloud * 0.85 + thread) * envelope);
            data[o] = 255;
            data[o + 1] = 255;
            data[o + 2] = 255;
            data[o + 3] = Math.round(a * 255);
        }
    }
    return data;
}

// ── Sprites (DOM canvases, once per palette) ────────────────────────────────────

const nebulaCache = new Map();
const tintCache = new Map();

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

function nebulaBase(documentRef, size) {
    if (nebulaCache.has(size)) return nebulaCache.get(size);
    const made = makeCanvas(documentRef, size, size);
    if (!made || typeof made.ctx.createImageData !== 'function' || typeof made.ctx.putImageData !== 'function') {
        return null;
    }
    const image = made.ctx.createImageData(size, size);
    image.data.set(bakeNebulaRing(size));
    made.ctx.putImageData(image, 0, 0);
    nebulaCache.set(size, made.canvas);
    return made.canvas;
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
    // A small cache: a palette is a theme, and a session visits a handful.
    if (tintCache.size > 48) tintCache.delete(tintCache.keys().next().value);
    tintCache.set(key, made.canvas);
    return made.canvas;
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
    tintCache.set(key, made.canvas);
    return made.canvas;
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
    tintCache.set(key, made.canvas);
    return made.canvas;
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

/**
 * A colour set to a lightness and a floor of saturation (HSL), keeping its hue: palettes are
 * authored for UI (pale, light), and light added onto light washes out to a white fog, so the
 * passage's clouds take their hue at a deep, saturated value instead.
 */
export function deepen(color, lightness = 0.42, minSaturation = 0.7) {
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
    const sat = max === min ? 0 : Math.max(s, minSaturation);
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

// ── The gate ────────────────────────────────────────────────────────────────────

/**
 * Everything one run draws with: sprites in its palette and a fixed layout of layers, streaks
 * and motes (deterministic when `random` is).
 */
export function createPortalGate({
    qualityPreset = 'High', palette = {}, random = Math.random, documentRef = globalThis.document,
} = {}) {
    const counts = PORTAL_GATE_COUNTS[qualityPreset] || PORTAL_GATE_COUNTS.High;
    const colors = {
        primary: palette.primary || '#ffd38a',
        accent: palette.accent || '#fff3c8',
        highlight: palette.highlight || '#ffffff',
        shadow: palette.shadow || '#05070d',
    };
    const base = nebulaBase(documentRef, counts.texture);
    const key = `${colors.primary}|${colors.accent}|${colors.highlight}`;
    // The clouds in the palette's hues at a deep value (the light comes from the streaks and the
    // light ahead, not from fog), one cooler and one warmer of the two.
    const cloudA = deepen(colors.primary, 0.36, 0.72);
    const cloudB = deepen(colors.accent, 0.3, 0.6);
    const sprites = base ? {
        nebula: [
            tinted(documentRef, base, cloudA, `n${counts.texture}|${cloudA}`),
            tinted(documentRef, base, cloudB, `n${counts.texture}|${cloudB}`),
        ],
        streak: [
            streakSprite(documentRef, colors.highlight, `s|${colors.highlight}`),
            streakSprite(documentRef, colors.accent, `s|${colors.accent}`),
        ],
        glowHot: glowSprite(documentRef, colors.highlight, `gh|${colors.highlight}`, true),
        glowPrimary: glowSprite(documentRef, colors.primary, `gp|${colors.primary}`),
        glowAccent: glowSprite(documentRef, colors.accent, `ga|${colors.accent}`),
    } : null;
    const usable = sprites && Object.values(sprites).flat().every(Boolean);
    const deep = mixColor(deepen(colors.shadow, 0.08, 0.5), '#000000', 0.2);
    const heart = parseColor(deepen(colors.primary, 0.16, 0.6));
    return {
        key,
        colors,
        sprites: usable ? sprites : null,
        deep: `rgb(${deep.join(', ')})`,
        heart: `rgb(${heart.join(', ')})`,
        layers: Array.from({ length: counts.layers }, (_, index) => ({
            phase: index / counts.layers,
            turn: random() * TAU,
            spin: (index % 2 ? -1 : 1) * (0.12 + random() * 0.18),
            tint: index % 2,
            alpha: 0.5 + random() * 0.3,
        })),
        streaks: Array.from({ length: counts.streaks }, (_, index) => ({
            angle: random() * TAU,
            phase: random(),
            length: 0.55 + random() * 0.9,
            width: 0.7 + random() * 1.1,
            tint: index % 3 === 0 ? 0 : 1,
        })),
        motes: Array.from({ length: counts.motes }, (_, index) => ({
            angle: random() * TAU,
            from: 2.2 + random() * 2.6,
            delay: random() * 0.35,
            spin: (index % 2 ? -1 : 1) * (1.1 + random() * 0.9),
            size: 0.12 + random() * 0.14,
            hot: index % 4 === 0,
        })),
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

/** The passage: nebula clouds rushing past, streaks of light, the light ahead. */
function drawPassage(ctx, gate, frame) {
    const {
        width, height, dpr = 1, center, travel = 0, direction = 1, time = 0,
    } = frame;
    const intensity = clamp01(frame.intensity ?? 1);
    const rush = Math.max(0, frame.rush || 0);
    const cx = center.x;
    const cy = center.y;
    const reach = portalReach(width, height, cx, cy);

    // Deep space in the destination's shadow, lit a little round the light ahead.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    base.addColorStop(0, gate.heart);
    base.addColorStop(0.45, gate.deep);
    base.addColorStop(1, '#010103');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const { sprites } = gate;
    ctx.globalCompositeOperation = 'lighter';
    if (sprites) {
        // Clouds: each layer swells from a speck at the light ahead to past the frame, turning
        // slowly (alternate ways), so the passage has depth; it fades in from the light and out
        // as it rushes past the lens. Outward going in, inward coming back out.
        for (const layer of gate.layers) {
            let depth = fract(layer.phase + travel * 0.16);
            if (direction < 0) depth = 1 - depth;
            // Faint while small (they would pile up into fog round the light ahead), fullest as
            // they pass the lens.
            const alpha = intensity * layer.alpha * smoothstep(0.12, 0.62, depth) * (1 - smoothstep(0.86, 1, depth));
            if (alpha <= 0.004) continue;
            const size = reach * 3.4 * Math.exp((depth - 1) * 3.5);
            ctx.globalAlpha = alpha;
            drawSprite(ctx, dpr, sprites.nebula[layer.tint], cx, cy, size, layer.turn + travel * layer.spin);
        }
        // Streaks: light flying past, longer and brighter the nearer it is (and the faster we go).
        for (const streak of gate.streaks) {
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
        ctx.globalAlpha = intensity * 0.22;
        drawSprite(ctx, dpr, sprites.glowPrimary, cx, cy, reach * 0.75 * breathe);
        ctx.globalAlpha = intensity * 0.85;
        drawSprite(ctx, dpr, sprites.glowHot, cx, cy, reach * 0.17 * breathe);
    }

    // Framing: the edges fall into the dark, so the passage has a wall.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(cx, cy, reach * 0.35, cx, cy, reach);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
}

/** The gate's rim: a crisp ring of light with a soft glow, a slight colour split, arcs turning on it. */
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
    // Energy running round the rim: the gate is alive.
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
        const at = time * (k % 2 ? -1.3 : 1.1) + k * (TAU / 3);
        stroke(r, 4.2, colors.highlight, 0.55 * strength, at, at + 0.45 + 0.2 * Math.sin(time * 2 + k));
    }
}

/** Entering an orb: light gathers onto it before it opens. */
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
    // Motes spiral in from round the orb.
    for (const mote of gate.motes) {
        const local = clamp01((t - mote.delay) / (1 - mote.delay));
        if (local <= 0 || local >= 1) continue;
        const pull = local * local;
        const radius = r * (mote.from * (1 - pull) + 0.9 * pull);
        const angle = mote.angle + mote.spin * local * 1.6;
        const alpha = Math.sin(Math.PI * local) * 0.9 * fade;
        ctx.globalAlpha = alpha;
        drawSprite(
            ctx,
            dpr,
            mote.hot ? sprites.glowHot : sprites.glowAccent,
            gather.x + Math.cos(angle) * radius,
            gather.y + Math.sin(angle) * radius,
            r * mote.size * 3.4 * (1.2 - 0.5 * local),
        );
    }
    // A ring of light closes on the orb.
    const closing = 1 - (1 - t) ** 3;
    drawRim(ctx, gate, frame, {
        x: gather.x, y: gather.y, r: r * (1.1 + 2.4 * (1 - closing)), strength: Math.sin(Math.PI * Math.min(1, t * 1.05)) * fade,
    });
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
        direction: -1,
    },
]);

/**
 * Show the gate once, unseen, before the first portal. The first portal of a session otherwise
 * stalls the GPU process while it compiles the canvas's shaders for these draws (additive image
 * draws, radial gradients, even-odd clips, arcs) and uploads the sprites: a real-game capture
 * froze the world and the gate for 300 ms on the first entry and not at all on the second. A
 * canvas that is never shown is drawn in software and warms nothing, so this one is on the page
 * at 1 % opacity for three frames (invisible over the map), then gone. Also bakes the noise.
 * Once per page; call it when the map is up and idle.
 * @returns {boolean} whether it started (false when already warm or there is no page to draw on)
 */
export function warmPortalGate({
    documentRef = globalThis.document,
    requestAnimationFrameRef = globalThis.requestAnimationFrame?.bind(globalThis),
    qualityPreset = 'High',
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
    const gate = createPortalGate({ qualityPreset, documentRef });
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

/** Warm the gate when the page is next idle, at the player's effect quality. Never throws. */
export function scheduleWarmPortalGate(windowRef = globalThis.window) {
    const warm = () => {
        try {
            warmPortalGate({ qualityPreset: windowRef?.settings?.effectQuality || 'High' });
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
