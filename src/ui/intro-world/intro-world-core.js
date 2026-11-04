/**
 * First Light — the opening and menu world: pure data and closed-form motion (no three.js).
 *
 * Everything here is deterministic in time, so the playground can seek any moment and the
 * unit tests can check the composition on the CPU:
 *   - the palette (the logo's own spectrum: lavender, aqua, mint, cream and the coral tile);
 *   - the breath: the whole world breathes in for 4 s and out for 6 s, and its integral (the
 *     "rise clock") paces everything that ascends, so speeds follow the breath without the
 *     phase jumping (a clock times a changing rate would);
 *   - the murmuration: one great flock of light whose head flies a slow loop round the title and
 *     whose body follows it, banking, folding, bulging, splitting and closing on the breath;
 *   - its line: the flock's middle as a spline the world writes every frame, so its path can be
 *     any shape (the loop round the title, the circuit round the menu's stage card);
 *   - the gathering: on every third breath the whole flock pours into a ring of light fitted to
 *     the title, holds it, and unravels;
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
    rose: '#f5aed0',
    sky: '#94c8ff',
    gold: '#f3d28d',
});

/** The light each menu mode lends the page (public/styles/keystone-menu.css), as the flock wears it. */
export const MODE_HUES = Object.freeze({
    single: BRAND.aqua,
    infinity: BRAND.lavender,
    stillfall: BRAND.coral,
    'local-multiplayer': BRAND.rose,
    'online-multiplayer': BRAND.sky,
    serenity: BRAND.mint,
    sukha: BRAND.mint,
    odyssey: BRAND.gold,
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
    travel = 1, menu = 0, breath = 0, time = 0, pointerX = 0, pointerY = 0, motion = 1, gather = 0,
}) {
    const rest = mixPose(POSES.title, POSES.menu, easeInOutCubic(menu));
    const pose = mixPose(POSES.open, rest, clamp01(travel));
    // The breath carries the eye a little forward and up on the inhale.
    pose.pos[2] -= (breath - 0.5) * 0.9 * motion;
    pose.pos[1] += (breath - 0.5) * 0.35 * motion;
    // As the flock gathers round the title the eye leans in toward it, and back as it lets go.
    pose.pos[2] -= easeInOutCubic(gather) * 2.2 * motion;
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

// ── The frame ───────────────────────────────────────────────────────────────────

/** Half the reference frame's height at depth z (world units), for the reference camera. */
export function halfHeightAt(z) {
    return (REF_CAMERA.z - z) * Math.tan((REF_CAMERA.fov * Math.PI) / 360);
}

// ── The murmuration: one great flock of light ───────────────────────────────────

/**
 * The flock's character. Its head flies a loop round the title (`rx`, `ry`: shares of the frame's
 * half width and height at its depth `z`), swinging `zAmp` nearer and further; its body covers
 * `span` radians of that loop behind the head; `width` is its greatest half-width across, `thick`
 * its thickness against that, `fold` how deep the sheet's folds run (against its width), `speed`
 * how fast its head flies (radians a second).
 */
export const MURMURATION = Object.freeze({
    z: -9,
    zAmp: 8,
    rx: 0.66,
    ry: 0.62,
    span: 3.7,
    width: 3.9,
    thick: 0.1,
    fold: 0.3,
    speed: 0.075,
});

/** The flock's line: this many control points of a uniform cubic B-spline (two are guards). */
export const FLOCK_POINTS = 28;

/** The shape of the flock along its length: 0 at its two tips, 1 through its body. */
export function flockTaper(s) {
    return Math.max(0, Math.sin(Math.PI * clamp01(s))) ** 0.55;
}

/**
 * s along the flock for a uniform u: the motes are spread by the flock's width, so where it
 * tapers it thins out to wisps instead of crowding into a bright blob at its tip.
 */
function buildFlockSampler(samples = 512) {
    const cdf = new Float64Array(samples + 1);
    for (let i = 1; i <= samples; i++) {
        const s = (i - 0.5) / samples;
        cdf[i] = cdf[i - 1] + 0.04 + flockTaper(s) ** 1.6;
    }
    const total = cdf[samples];
    return (u) => {
        const target = clamp01(u) * total;
        let lo = 0;
        let hi = samples;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cdf[mid] <= target) lo = mid;
            else hi = mid;
        }
        const step = cdf[hi] - cdf[lo];
        return (lo + (step > 0 ? (target - cdf[lo]) / step : 0)) / samples;
    };
}

/**
 * A mote's place along the flock by rank is s - FLOCK_RANK_FIT / TAU * sin(TAU * s): s spreads the
 * motes by the flock's width, thin toward its tips, and this undoes that (a closed fit to the
 * sampler above), so the flock lies even when it is drawn all the way round a ring or a frame.
 * The vertex stage does it, so the line's points stay evenly spaced.
 */
export const FLOCK_RANK_FIT = 0.94;

/** A standard normal draw from two uniforms. */
const gaussian = (a, b) => Math.sqrt(-2 * Math.log(1 - a * 0.9995)) * Math.cos(TAU * b);

/** The share of the motes that fly in streams; the rest are loose dust round them. */
const STREAMED = 0.68;

/**
 * The motes: s along the flock (0 head, 1 tail), an angle and a radius across it, a random of
 * their own. Most fly in fine streams, each a strand at one place across the sheet over a stretch
 * of the flock's length, so the sheet reads as silk rather than spray; the rest are loose dust,
 * Gaussian across it with a few stragglers, so the flock has a soft edge rather than an outline.
 * A stream's motes share nearly one random: some strands burn brighter than the rest.
 * @returns {Float32Array} count rows of (s, angle, radius, r)
 */
export function buildMurmurationSeeds(count, seed = 29) {
    const rnd = mulberry32(seed);
    const along = buildFlockSampler();
    const streams = Array.from({ length: Math.max(24, Math.round(Math.sqrt(count) * 0.42)) }, () => {
        const reach = 0.42 + 0.58 * rnd();
        const from = (1 - reach) * rnd();
        return {
            x: gaussian(rnd(), rnd()) * 0.46,
            y: gaussian(rnd(), rnd()) * 0.4,
            from,
            to: from + reach,
            r: rnd() ** 1.4 * 0.86 + (rnd() < 0.09 ? 0.13 : 0),
            fine: 0.006 + 0.012 * rnd(),
        };
    });
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        let s = along(rnd());
        let x;
        let y;
        let r = rnd();
        if (rnd() < STREAMED) {
            const stream = streams[Math.floor(rnd() * streams.length)];
            // Inside its stretch of the flock, its ends fraying.
            const fray = 0.06 * rnd();
            s = stream.from - fray + (stream.to - stream.from + 2 * fray) * s;
            s = clamp01(s);
            x = stream.x + gaussian(rnd(), rnd()) * stream.fine;
            y = stream.y + gaussian(rnd(), rnd()) * stream.fine * 3;
            r = clamp01(stream.r + (rnd() - 0.5) * 0.045);
        } else {
            x = gaussian(rnd(), rnd()) * 0.46;
            y = gaussian(rnd(), rnd()) * 0.46;
        }
        const row = i * 4;
        out[row] = s;
        out[row + 1] = Math.atan2(y, x);
        out[row + 2] = Math.min(1.5, Math.hypot(x, y));
        out[row + 3] = r;
    }
    return out;
}

/** The loop's angle at s along the flock (the head leads; the tail is `span` behind it). */
const flockAngle = (m, s) => m.head - s * m.span;

/**
 * A point on the flock's free flight (s 0 at its head, 1 at its tail) for a state from
 * `murmurationAt`: a loop round the title.
 * @returns {number[]} [x, y, z]
 */
export function murmurationLine(m, s) {
    const phi = flockAngle(m, s);
    const wob = 1 + 0.1 * Math.sin(3 * phi + m.wobble) + 0.05 * Math.sin(5 * phi - 1.7 * m.wobble);
    const swing = phi + m.wobble * 0.6;
    return [
        m.center[0] + m.radii[0] * wob * Math.cos(phi),
        m.center[1] + m.radii[1] * wob * Math.sin(phi),
        m.center[2] + m.radii[2] * Math.sin(swing),
    ];
}

// ── The circuit: the flock's path round the menu's stage card ───────────────────

/** The narrowest and the widest clearance (frame heights) the circuit keeps from the card. */
const CIRCUIT_MIN_CLEAR = 0.03;
const CIRCUIT_MAX_CLEAR = 0.16;

/**
 * Fit the circuit to the menu as it stands. The flock flies round the stage card down the middle
 * of the free band on each side (between card and navigation, card and dock, card and the frame's
 * edge), so it hugs the interface whatever the layout. Rects are screen fractions, y down.
 *
 * @param {{ stage: object, nav?: object, dock?: object }} layout
 * @param {number} aspect
 * @returns {object|null} centre and half size in frame heights, the corner radius, each side's
 *   clearance (half its free band) and the path's length; null with no stage on the screen.
 */
export function stageCircuit({ stage, nav = null, dock = null }, aspect) {
    if (!stage || !(stage.x1 > stage.x0) || !(stage.y1 > stage.y0)) return null;
    const a = Math.max(0.1, aspect);
    const x0 = stage.x0 * a;
    const x1 = stage.x1 * a;
    const { y0, y1 } = stage;
    // What bounds each side's band: the navigation or the frame on the left, the navigation or
    // the frame above, the dock or the frame below, the frame to the right.
    const navBeside = nav && nav.x1 <= stage.x0;
    const navAbove = nav && !navBeside && nav.y1 <= stage.y0;
    const dockBelow = dock && dock.y0 >= stage.y1;
    const left = navBeside ? nav.x1 * a : 0;
    const top = navAbove ? nav.y1 : 0;
    const bottom = dockBelow ? dock.y0 : 1;
    const band = (near, far) => Math.min(CIRCUIT_MAX_CLEAR, Math.max(CIRCUIT_MIN_CLEAR, (far - near) * 0.5));
    const clear = {
        left: band(left, x0),
        right: band(x1, a),
        top: band(top, y0),
        bottom: band(y1, bottom),
    };
    const hx = (x1 - x0) * 0.5 + (clear.left + clear.right) * 0.5;
    const hy = (y1 - y0) * 0.5 + (clear.top + clear.bottom) * 0.5;
    const cx = (x0 - clear.left + x1 + clear.right) * 0.5;
    const cy = (y0 - clear.top + y1 + clear.bottom) * 0.5;
    const r = Math.min(hx, hy, 0.12 + 0.5 * Math.min(clear.left, clear.right, clear.top, clear.bottom));
    const sx = 2 * (hx - r);
    const sy = 2 * (hy - r);
    return {
        cx, cy, hx, hy, r, sx, sy, clear, aspect: a, length: 2 * (sx + sy) + TAU * r,
    };
}

/**
 * The point on a circuit at loop angle phi: 0 at the middle of its right side, going up the right
 * side and across the top as the free loop does (the same phi lands on the same side), by length
 * along it so the flock keeps its pace round the corners.
 * @returns {{ x: number, y: number, clear: number }} screen fractions (y down) and the clearance
 *   there in frame heights
 */
export function circuitPoint(c, phi) {
    const {
        cx, cy, hx, hy, r, sx, sy, clear, aspect,
    } = c;
    const arc = (Math.PI * r) / 2;
    let d = ((((phi % TAU) + TAU) % TAU) / TAU) * c.length;
    const place = (x, y, side) => ({ x: x / aspect, y, clear: side });
    const blend = (a, b, t) => lerp(a, b, smoothstep(0, 1, t));
    const take = (length) => {
        if (d <= length) return true;
        d -= length;
        return false;
    };
    const R = hx - r;
    const U = hy - r;
    // Up the right side from its middle.
    if (take(sy / 2)) return place(cx + hx, cy - d, clear.right);
    if (take(arc)) {
        const t = d / arc;
        const a = t * (Math.PI / 2);
        return place(cx + R + r * Math.cos(a), cy - U - r * Math.sin(a), blend(clear.right, clear.top, t));
    }
    // Across the top.
    if (take(sx)) return place(cx + R - d, cy - hy, clear.top);
    if (take(arc)) {
        const t = d / arc;
        const a = t * (Math.PI / 2);
        return place(cx - R - r * Math.sin(a), cy - U - r * Math.cos(a), blend(clear.top, clear.left, t));
    }
    // Down the left, through the gutter between the navigation and the card.
    if (take(sy)) return place(cx - hx, cy - U + d, clear.left);
    if (take(arc)) {
        const t = d / arc;
        const a = t * (Math.PI / 2);
        return place(cx - R - r * Math.cos(a), cy + U + r * Math.sin(a), blend(clear.left, clear.bottom, t));
    }
    // Along the foot, between the card and the dock.
    if (take(sx)) return place(cx - R + d, cy + hy, clear.bottom);
    if (take(arc)) {
        const t = d / arc;
        const a = t * (Math.PI / 2);
        return place(cx + R + r * Math.sin(a), cy + U + r * Math.cos(a), blend(clear.bottom, clear.right, t));
    }
    return place(cx + hx, cy + U - d, clear.right);
}

/**
 * The circuit's angle at s along the flock. As the flock closes round the card (`m.close`) its
 * head runs ahead and its tail falls back until the two meet.
 */
function circuitAngle(m, s) {
    const reach = (TAU - m.span) * (m.close ?? 0);
    return m.head + reach * 0.5 - s * (m.span + reach);
}

/**
 * Write the flock's line: FLOCK_POINTS rows of (x, y, z, width share), s running from just
 * before its head to just past its tail. Each point flies the free loop, or the circuit where the
 * flock has moved to the menu; it pours across head first, and fits its width to the gutter it
 * is in.
 *
 * @param {object} m a state from `murmurationAt`
 * @param {Float32Array} out FLOCK_POINTS * 4
 * @param {object} [options]
 * @param {object|null} [options.circuit] from `stageCircuit`
 * @param {number} [options.onCircuit] how far it has moved to the circuit (0..1)
 * @param {number} [options.risen] the opening's progress (0..1): it pours up out of the light
 * @param {(x: number, y: number, z: number) => number[]} [options.toWorld] a screen fraction on the
 *   plane z, in the world
 * @param {number} [options.worldPerFrame] world units across one frame height at the flock's depth
 */
export function writeFlockLine(m, out, {
    circuit = null, onCircuit = 0, risen = 1, toWorld = null, worldPerFrame = 1,
} = {}) {
    const n = FLOCK_POINTS;
    const drop = halfHeightAt(MURMURATION.z) * 1.5;
    for (let i = 0; i < n; i++) {
        const s = (i - 1) / (n - 3);
        const sc = clamp01(s);
        const [fx, fy, fz] = murmurationLine(m, s);
        let x = fx;
        let y = fy;
        let z = fz;
        let share = 1;
        const k = circuit && toWorld ? smoothstep(sc * 0.45, sc * 0.45 + 0.55, onCircuit) : 0;
        if (k > 0) {
            const phi = circuitAngle(m, s);
            const swing = phi + m.wobble * 0.6;
            const c = circuitPoint(circuit, phi);
            // It keeps a small life of its own in its gutter, in scale with the room it has.
            const wander = (0.22 * Math.sin(3 * phi + m.wobble) + 0.11 * Math.sin(5 * phi - 1.7 * m.wobble)) * c.clear;
            const [wx, wy, wz] = toWorld(
                c.x + (wander * Math.cos(phi)) / circuit.aspect,
                c.y - wander * Math.sin(phi),
                MURMURATION.z + m.radii[2] * 0.35 * Math.sin(swing),
            );
            x = lerp(x, wx, k);
            y = lerp(y, wy, k);
            z = lerp(z, wz, k);
            share = lerp(1, (c.clear * 0.72 * worldPerFrame) / Math.max(1e-3, m.width), k);
        }
        // While the world opens it pours up out of the light below, head first.
        y -= drop * (1 - easeOutCubic(risen * 1.3 - sc * 0.3));
        out[i * 4] = x;
        out[i * 4 + 1] = y;
        out[i * 4 + 2] = z;
        out[i * 4 + 3] = share;
    }
    return out;
}

/**
 * The murmuration at time t. `menu` (0..1) calms it behind the menu; `motion` (0..1) calms it for
 * reduced motion; `gather` (0..1) how far it has poured into the ring round the title; `close`
 * (0..1) how far it has closed round the stage card. A closed form of time, so a seek lands where
 * playing would.
 */
export function murmurationAt({
    time, breath = 0, aspect = 16 / 9, menu = 0, motion = 1, gather = 0, close = 0,
}) {
    const M = MURMURATION;
    const hh = halfHeightAt(M.z);
    const hw = hh * Math.max(0.56, aspect);
    const tall = smoothstep(1.25, 0.85, aspect);
    const m = easeInOutCubic(menu);
    // It draws in a little on the in-breath.
    const draw = 1 - 0.07 * breath;
    const rx = M.rx * hw * draw;
    const ry = M.ry * hh * draw;
    // Out-breaths open it into two streams, more on some breaths than others.
    const split = (0.5 - 0.5 * Math.cos((TAU * time) / 40)) * (1 - breath) * 0.85 * motion * (1 - 0.6 * m);
    const ringBreath = 0.97 + 0.06 * breath;
    return {
        center: [0, 0.02 * hh, M.z],
        radii: [rx, ry, M.zAmp * (0.4 + 0.6 * motion)],
        head: time * M.speed + 0.6,
        span: M.span,
        width: M.width * (1 + 0.1 * breath) * lerp(1, 0.7, tall),
        thick: M.thick,
        fold: M.fold * (0.35 + 0.65 * motion),
        split,
        // A wave of banking: about two and a half turns along it, rolling from head to tail.
        bank: [2.5, time * 1.5, 1.3 * motion, 0.35],
        wobble: time * 0.21,
        bulge: time * 0.5,
        light: (0.8 + 0.35 * breath) * (1 - 0.4 * m),
        swirl: time * 0.3,
        // The ring it gathers into stands round the title (the world fits it to the wordmark's
        // rect when it has one). It breathes with the breath while it holds.
        ring: [0, 0.02 * hh, hw * lerp(0.4, 0.84, tall) * ringBreath, hh * lerp(0.48, 0.4, tall) * ringBreath],
        ringBreath,
        ringTube: 0.8,
        gather: clamp01(gather),
        close: clamp01(close),
    };
}

/** The gathering's rhythm: once every three breaths, from the in-breath through the out-breath. */
export const GATHER = Object.freeze({
    every: 3 * BREATH_PERIOD,
    first: 2 * BREATH_PERIOD,
    approach: 3.7,
    hold: 3.1,
    release: 4.6,
});
export const GATHER_SECONDS = GATHER.approach + GATHER.hold + GATHER.release;

/** Which gathering (k) a moment belongs to and how far into it (seconds), or null between them. */
export function gatherSlot(t) {
    if (t < GATHER.first) return null;
    const k = Math.floor((t - GATHER.first) / GATHER.every);
    const tau = t - GATHER.first - k * GATHER.every;
    return tau < GATHER_SECONDS ? { k, tau, start: t - tau } : null;
}

/**
 * How far the flock has gathered (0..1), the flash as the ring closes and that moment, at tau
 * seconds into a gathering: it pours in on the in-breath, closes at its top, holds, and lets go on
 * the out-breath.
 */
export function gatherPhase(tau) {
    const { approach, hold, release } = GATHER;
    let join;
    if (tau < approach) join = easeInOutCubic(tau / approach);
    else if (tau < approach + hold) join = 1;
    else join = 1 - easeInOutCubic((tau - approach - hold) / release);
    const sinceLock = tau - approach * 0.96;
    const flash = sinceLock >= 0 ? Math.exp(-sinceLock * 1.7) : 0;
    return { join: clamp01(join), flash, locked: sinceLock >= 0 && tau < approach + hold };
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
