/**
 * First Light — the opening and menu world: pure data and closed-form motion (no three.js).
 *
 * Everything here is deterministic in time, so the playground can seek any moment and the
 * unit tests can check the composition on the CPU:
 *   - the palette (the logo's own spectrum: lavender, aqua, mint, cream and the coral tile);
 *   - the breath: the whole world breathes in for 4 s and out for 6 s, and its integral (the
 *     "rise clock") paces everything that ascends, so speeds follow the breath without the
 *     phase jumping (a clock times a changing rate would);
 *   - the pieces' lanes: solid tetrominoes rising at every depth on either side of the title,
 *     never through it;
 *   - the camera's poses for the opening, the title and the menu, and the curves between them.
 */

export const TAU = Math.PI * 2;

/** sRGB hex → linear [r, g, b]. */
export function srgbToLinear(hex) {
    const n = Number.parseInt(String(hex).replace('#', ''), 16);
    const ch = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}

/** The brand spectrum (public/assets/branding/serenity-blocks-logo.svg and the loading lights). */
export const BRAND = Object.freeze({
    ink: '#04061a',
    indigo: '#0f1546',
    violet: '#2d2470',
    lavender: '#b8a4ff',
    periwinkle: '#aac7f6',
    aqua: '#9ee8ed',
    mint: '#c5f1cf',
    cream: '#fff6e9',
    coral: '#ffac88',
});

export const PIECE_KEYS = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

/**
 * The pieces in the logo's light: the wordmark's spectrum, so the world reads as one family
 * with the title. Solid colour, never four cells. No shape wears its familiar Guideline hue
 * (I cyan, O yellow, T purple, S green, Z red, J blue, L orange): 0/7 on the palette gate
 * (scripts/palette-guideline-check.mjs, tetris_legal_review.md PAL-1), the house ideal.
 */
export const PIECE_COLORS = Object.freeze({
    I: '#b49cff', // lavender
    O: '#86e3ef', // aqua
    T: '#a6eec0', // mint
    S: '#ff9d8c', // coral
    Z: '#8eaeff', // periwinkle
    J: '#ffd89c', // soft gold
    L: '#f6a8d6', // rose
});

/** Each shape's cells in its spawn orientation, centred on its bounding box (x right, y up). */
export const PIECE_CELLS = Object.freeze({
    I: [-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0],
    O: [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5],
    T: [-1, -0.5, 0, -0.5, 1, -0.5, 0, 0.5],
    S: [-1, -0.5, 0, -0.5, 0, 0.5, 1, 0.5],
    Z: [-1, 0.5, 0, 0.5, 0, -0.5, 1, -0.5],
    J: [-1, 0.5, -1, -0.5, 0, -0.5, 1, -0.5],
    L: [1, 0.5, -1, -0.5, 0, -0.5, 1, -0.5],
});

// ── The breath ──────────────────────────────────────────────────────────────────

/** One breath: in for 4 s, out for 6 s (six breaths a minute, the coherent-breathing pace). */
export const BREATH_PERIOD = 10;
export const BREATH_IN = 4;

const wrap = (t, p) => ((t % p) + p) % p;

/** The breath at time t: 0 at rest (empty), 1 at the top of the inhale. Smooth everywhere. */
export function breathAt(t) {
    const u = wrap(t, BREATH_PERIOD);
    if (u < BREATH_IN) return 0.5 - 0.5 * Math.cos((Math.PI * u) / BREATH_IN);
    return 0.5 + 0.5 * Math.cos((Math.PI * (u - BREATH_IN)) / (BREATH_PERIOD - BREATH_IN));
}

/** ∫₀ᵗ breathAt, exactly. */
export function breathIntegral(t) {
    const out = BREATH_PERIOD - BREATH_IN;
    const whole = Math.floor(t / BREATH_PERIOD);
    const u = t - whole * BREATH_PERIOD;
    let acc = whole * BREATH_PERIOD * 0.5;
    if (u < BREATH_IN) {
        acc += 0.5 * u - (BREATH_IN / TAU) * Math.sin((Math.PI * u) / BREATH_IN);
    } else {
        const y = u - BREATH_IN;
        acc += BREATH_IN * 0.5 + 0.5 * y + (out / TAU) * Math.sin((Math.PI * y) / out);
    }
    return acc;
}

/** How much the breath changes the pace of everything that rises (±). */
export const BREATH_PACE = 0.5;

/**
 * The rise clock: seconds of ascent at a pace of 1 ± BREATH_PACE/2 that follows the breath
 * (faster on the inhale). Exact, so a seek lands where playing would have.
 */
export function riseClock(t) {
    return t + BREATH_PACE * (breathIntegral(t) - 0.5 * t);
}

// ── Easing ──────────────────────────────────────────────────────────────────────

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
export const easeOutCubic = (x) => 1 - (1 - clamp01(x)) ** 3;
export const easeInOutCubic = (x) => {
    const t = clamp01(x);
    return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
};
/** A glide that leaves gently and lands softer still (the exhale). */
export const easeGlide = (x) => {
    const t = clamp01(x);
    return t * t * t * (t * (6 * t - 15) + 10) * 0.35 + easeOutCubic(t) * 0.65;
};
export const lerp = (a, b, t) => a + (b - a) * t;

// ── The opening ─────────────────────────────────────────────────────────────────

/** The opening's own length: the camera keeps settling after the cover has gone. */
export const OPENING_SECONDS = 5.2;
/** How far (in units of a lane's speed) everything rises extra while the world opens. */
export const OPENING_RISE = 9;

/**
 * What the opening looks like at progress p (0 = the frame under the loading screen,
 * 1 = settled): the camera's travel, how far the veils are drawn, the light, the exhale wave.
 */
export function openingState(p) {
    const q = clamp01(p);
    return {
        travel: easeGlide(q),
        rise: easeOutCubic(q),
        unfurl: smoothstep(0.0, 0.62, q),
        light: smoothstep(0.0, 0.55, q),
        wave: q < 0.62 ? smoothstep(0.0, 0.62, q) : 1,
        waveFade: 1 - smoothstep(0.18, 0.62, q),
        halo: smoothstep(0.32, 0.86, q),
    };
}

// ── The camera ──────────────────────────────────────────────────────────────────

/** The reference camera the lanes are laid out for (the title pose). */
export const REF_CAMERA = Object.freeze({ z: 34, fov: 38 });

/** Poses: position, the point looked at, vertical field of view (degrees). */
export const POSES = Object.freeze({
    // Close, looking down into the light below: the opening lifts the eye from it to the horizon.
    open: { pos: [0, 3.2, 18], look: [0, -7.5, -12], fov: 46 },
    title: { pos: [0, 0.2, 34], look: [0, 0.6, 0], fov: 38 },
    // A little higher and tilted up: the light sinks to the foot of the frame behind the cards.
    menu: { pos: [0.8, 1.4, 33], look: [1.6, 3.8, 0], fov: 40 },
});

/** A pose between a and b. */
export function mixPose(a, b, t) {
    return {
        pos: [lerp(a.pos[0], b.pos[0], t), lerp(a.pos[1], b.pos[1], t), lerp(a.pos[2], b.pos[2], t)],
        look: [lerp(a.look[0], b.look[0], t), lerp(a.look[1], b.look[1], t), lerp(a.look[2], b.look[2], t)],
        fov: lerp(a.fov, b.fov, t),
    };
}

/**
 * The camera at a moment: the opening's travel (0..1) from `open` to the resting pose, the
 * resting pose itself a blend of title and menu (m 0..1), then a breath dolly and the drift.
 */
export function cameraPoseAt({
    travel = 1, menu = 0, breath = 0, time = 0, pointerX = 0, pointerY = 0, motion = 1,
}) {
    const rest = mixPose(POSES.title, POSES.menu, easeInOutCubic(menu));
    const pose = mixPose(POSES.open, rest, clamp01(travel));
    // The breath carries the eye a little forward and up on the inhale.
    pose.pos[2] -= (breath - 0.5) * 0.9 * motion;
    pose.pos[1] += (breath - 0.5) * 0.35 * motion;
    // A slow drift, and the pointer's parallax (the eye moves; it keeps looking at the scene).
    const dx = (Math.sin(time * 0.071) * 0.9 + Math.sin(time * 0.033 + 1.3) * 0.6) * motion;
    const dy = Math.sin(time * 0.053 + 0.4) * 0.45 * motion;
    pose.pos[0] += dx + pointerX * 1.6 * motion;
    pose.pos[1] += dy + pointerY * 0.9 * motion;
    pose.look[0] += dx * 0.35 + pointerX * 0.3 * motion;
    pose.look[1] += dy * 0.35 + pointerY * 0.2 * motion;
    return pose;
}

// ── Seeded randomness ───────────────────────────────────────────────────────────

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

// ── The pieces ──────────────────────────────────────────────────────────────────

/** Half the reference frame's height at depth z (world units), for the reference camera. */
export function halfHeightAt(z) {
    return (REF_CAMERA.z - z) * Math.tan((REF_CAMERA.fov * Math.PI) / 360);
}

/** Depth bands: near (large, quick, a few), middle, far (small, slow, hazed). */
const BANDS = [
    {
        name: 'near', share: 0.1, z: [6, 13], scale: [0.95, 1.2], speed: [0.85, 1.15], sx: [0.78, 1.08],
    },
    {
        name: 'mid', share: 0.38, z: [-18, -4], scale: [0.72, 0.98], speed: [0.38, 0.62], sx: [0.5, 1.06],
    },
    {
        name: 'far', share: 0.52, z: [-66, -26], scale: [0.95, 1.4], speed: [0.2, 0.36], sx: [0.34, 1.1],
    },
];

/**
 * The lanes: one piece each. `sx` is the lane's place across the reference frame (-1 left edge,
 * +1 right edge), so a portrait screen keeps the same composition; it alternates sides and
 * keeps clear of the title's column.
 * @param {{ count?: number, seed?: number }} [options]
 */
export function buildPieceField({ count = 26, seed = 7 } = {}) {
    const rnd = mulberry32(seed);
    const range = ([a, b]) => a + (b - a) * rnd();
    const lanes = [];
    let shapeCursor = Math.floor(rnd() * PIECE_KEYS.length);
    // The middle band rises in twins (same shape, same side), so a stack can find a partner.
    const twinShapes = ['O', 'J', 'I', 'L'].map((k) => PIECE_KEYS.indexOf(k));
    BANDS.forEach((band, bandIndex) => {
        const n = bandIndex === BANDS.length - 1
            ? count - lanes.length
            : Math.max(1, Math.round(count * band.share));
        for (let i = 0; i < n; i++) {
            const twins = band.name === 'mid';
            const pair = Math.floor(i / 2);
            let side;
            if (twins) side = pair % 2 === 0 ? -1 : 1;
            else side = (lanes.length + bandIndex) % 2 === 0 ? -1 : 1;
            // Spread the lanes over the band's width rather than leaving it to chance (twins
            // share a stretch of it, so they rise near each other).
            const across = twins
                ? (Math.floor(pair / 2) + 0.25 + (i % 2) * 0.4 + rnd() * 0.2) / Math.ceil(n / 4)
                : (i + rnd() * 0.85) / n;
            const sx = side * (band.sx[0] + (band.sx[1] - band.sx[0]) * Math.min(1, across));
            const axis = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
            const len = Math.hypot(...axis) || 1;
            shapeCursor = (shapeCursor + 3) % PIECE_KEYS.length;
            lanes.push({
                band: band.name,
                shape: twins ? twinShapes[pair % twinShapes.length] : shapeCursor,
                sx,
                z: range(band.z),
                scale: range(band.scale),
                speed: range(band.speed),
                phase: rnd(),
                swayAmp: 0.4 + rnd() * 0.9,
                swayFreq: 0.05 + rnd() * 0.07,
                swayPhase: rnd() * TAU,
                axis: axis.map((v) => v / len),
                spin: (0.07 + rnd() * 0.16) * (rnd() < 0.5 ? -1 : 1),
                angle0: rnd() * TAU,
                seed: rnd(),
            });
        }
    });
    return lanes;
}

/** Quaternion [x, y, z, w] for a unit axis and an angle. */
export function axisAngle(axis, angle) {
    const s = Math.sin(angle / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/**
 * Where a lane's piece is: it rises through the whole frame (and the margin beyond it, so it
 * never pops in or out), sways, and tumbles slowly.
 * @param {object} lane
 * @param {{ rise: number, time: number, aspect: number, extraRise?: number, extraSpin?: number }} ctx
 * @returns {{ x: number, y: number, z: number, q: number[], scale: number }}
 */
export function pieceAt(lane, {
    rise, time, aspect, extraRise = 0, extraSpin = 0,
}) {
    const hh = halfHeightAt(lane.z);
    const margin = lane.scale * 2.4 + 3;
    const span = 2 * (hh + margin);
    const travel = lane.phase * span + lane.speed * (rise + extraRise);
    const y = -hh - margin + wrap(travel, span);
    // A wide screen spreads the lanes; a tall one keeps them inside its narrower frame.
    const hw = hh * Math.max(0.56, aspect);
    const x = lane.sx * hw + Math.sin(time * lane.swayFreq * TAU + lane.swayPhase) * lane.swayAmp;
    const q = axisAngle(lane.axis, lane.angle0 + lane.spin * time + extraSpin);
    // On a narrow screen a near piece would fill the frame's side: draw it smaller.
    const fit = lane.band === 'near' ? Math.max(0.6, Math.min(1, aspect / 1.4)) : 1;
    return {
        x, y, z: lane.z, q, scale: lane.scale * fit,
    };
}

// ── Quaternions (x, y, z, w) ────────────────────────────────────────────────────

export function qMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

/** v turned by the unit quaternion q. */
export function qRotate(q, v) {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
    ];
}

export function qSlerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const s = d < 0 ? -1 : 1;
    d *= s;
    if (d > 0.9995) {
        const out = a.map((v, i) => v + (b[i] * s - v) * t);
        const len = Math.hypot(...out) || 1;
        return out.map((v) => v / len);
    }
    const th = Math.acos(Math.min(1, d));
    const k0 = Math.sin((1 - t) * th) / Math.sin(th);
    const k1 = Math.sin(t * th) / Math.sin(th);
    return a.map((v, i) => v * k0 + b[i] * s * k1);
}

// ── The stack: two pieces find each other on a breath ───────────────────────────

/**
 * Shapes that lock with a twin of their own into a rectangle: the twin is turned `turn` about
 * the face and docked `offset` cells away in the first one's frame. Two J (or two L) make a
 * 2 x 4, two O a 4 x 2, two I a bar of eight.
 */
export const STACK_FITS = Object.freeze({
    O: { offset: [2, 0], turn: 0 },
    I: { offset: [4, 0], turn: 0 },
    J: { offset: [1, 0], turn: Math.PI },
    L: { offset: [-1, 0], turn: Math.PI },
});

/** The stack's rhythm: once every three breaths, from the in-breath through the out-breath. */
export const STACK = Object.freeze({
    every: 3 * BREATH_PERIOD,
    first: 2 * BREATH_PERIOD,
    approach: 3.7,
    hold: 3.1,
    release: 4.6,
});
export const STACK_SECONDS = STACK.approach + STACK.hold + STACK.release;

/** Which stack (k) a moment belongs to and how far into it (seconds), or null between them. */
export function stackSlot(t) {
    if (t < STACK.first) return null;
    const k = Math.floor((t - STACK.first) / STACK.every);
    const tau = t - STACK.first - k * STACK.every;
    return tau < STACK_SECONDS ? { k, tau, start: t - tau } : null;
}

/**
 * How far the pair is joined (0..1), the flash of the lock and the lock's moment, at tau seconds
 * into a stack: they glide together on the in-breath, lock at its top, hold, and let go on the
 * out-breath.
 */
export function stackPhase(tau) {
    const { approach, hold, release } = STACK;
    let join;
    if (tau < approach) join = easeInOutCubic(tau / approach);
    else if (tau < approach + hold) join = 1;
    else join = 1 - easeInOutCubic((tau - approach - hold) / release);
    const sinceLock = tau - approach * 0.96;
    const flash = sinceLock >= 0 ? Math.exp(-sinceLock * 1.7) : 0;
    return { join: clamp01(join), flash, locked: sinceLock >= 0 && tau < approach + hold };
}

/**
 * Choose the pair for a stack starting at `start`: an anchor in the middle band, low enough in
 * the frame to stay in view for the whole breath, on the side the mode allows, and the nearest
 * twin of its shape on the same side, not too far in depth. Returns null when no pair fits.
 * @param {object[]} lanes
 * @param {{ start: number, aspect: number, side?: number }} options side: -1 left, +1 right, 0 either
 */
export function chooseStackPair(lanes, { start, aspect, side = 0 }) {
    const rise = riseClock(start);
    const at = lanes.map((lane) => pieceAt(lane, { rise, time: start, aspect }));
    let best = null;
    lanes.forEach((a, i) => {
        if (a.band !== 'mid' || !STACK_FITS[PIECE_KEYS[a.shape]]) return;
        if (side !== 0 && Math.sign(a.sx) !== side) return;
        const hh = halfHeightAt(a.z);
        if (at[i].y < -hh * 0.75 || at[i].y > -hh * 0.05) return;
        lanes.forEach((b, j) => {
            if (j === i || b.shape !== a.shape || Math.sign(b.sx) !== Math.sign(a.sx)) return;
            if (Math.abs(b.z - a.z) > 14) return;
            const d = Math.hypot(at[j].x - at[i].x, at[j].y - at[i].y, (at[j].z - at[i].z) * 0.5);
            if (!best || d < best.d) best = { anchor: i, partner: j, d };
        });
    });
    return best ? { anchor: best.anchor, partner: best.partner } : null;
}

// ── The motes ───────────────────────────────────────────────────────────────────

/** A mote's static seed row (x, y-phase, z, size/brightness), packed into one vec4 each. */
export function buildMoteSeeds(count, seed = 11) {
    const rnd = mulberry32(seed);
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        // Mostly far (a fine dust of light), a few in the middle, and one in a hundred close
        // enough to the eye to open into a soft disc.
        const r = rnd();
        const near = rnd() < 0.012;
        out[i * 4] = rnd() * 2 - 1;
        out[i * 4 + 1] = rnd();
        out[i * 4 + 2] = near ? 7 + rnd() * 9 : -72 + 70 * r ** 1.6;
        out[i * 4 + 3] = rnd();
    }
    return out;
}

// ── Avoid zones ─────────────────────────────────────────────────────────────────

/**
 * How present a piece is (0..1) given where it is on screen (NDC, y up) and the rects it must
 * keep out of (screen fractions, y down: { x0, y0, x1, y1 }), measured with a soft edge.
 */
export function presenceAt(ndcX, ndcY, radius, rects) {
    if (!rects || rects.length === 0) return 1;
    const sx = ndcX * 0.5 + 0.5;
    const sy = 0.5 - ndcY * 0.5;
    let presence = 1;
    for (const r of rects) {
        if (!r) continue;
        const dx = Math.max(r.x0 - sx, 0, sx - r.x1);
        const dy = Math.max(r.y0 - sy, 0, sy - r.y1);
        const d = Math.hypot(dx, dy) - radius;
        presence = Math.min(presence, smoothstep(-0.01, 0.06, d));
    }
    return presence;
}
