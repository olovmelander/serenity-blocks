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
 *     whose body follows it, banking, bulging, splitting and closing on the breath;
 *   - the gathering: on every third breath the whole flock pours into a ring of light round the
 *     title, holds it, and unravels;
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
 * its thickness against that, `speed` how fast its head flies (radians a second).
 */
export const MURMURATION = Object.freeze({
    z: -9,
    zAmp: 8,
    rx: 0.66,
    ry: 0.62,
    span: 3.7,
    width: 4.4,
    thick: 0.18,
    speed: 0.075,
});

/**
 * The motes: s along the flock (0 head, 1 tail), an angle and a radius across it, a random of
 * their own.
 * @returns {Float32Array} count rows of (s, angle, radius, r)
 */
export function buildMurmurationSeeds(count, seed = 29) {
    const rnd = mulberry32(seed);
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        out[i * 4] = rnd();
        out[i * 4 + 1] = rnd() * TAU;
        // Denser toward its middle line, a few out at its edges.
        out[i * 4 + 2] = Math.sqrt(rnd()) * (0.75 + 0.25 * rnd());
        out[i * 4 + 3] = rnd();
    }
    return out;
}

/**
 * A point on the flock's middle line (s 0 at its head, 1 at its tail) for a state from
 * `murmurationAt`: the same law the vertex stage uses (intro-world-murmuration.js), on the CPU.
 * @returns {number[]} [x, y, z]
 */
export function murmurationLine(m, s) {
    const phi = m.head - s * m.span;
    const wob = 1 + 0.1 * Math.sin(3 * phi + m.wobble) + 0.05 * Math.sin(5 * phi - 1.7 * m.wobble);
    const swing = phi + m.wobble * 0.6;
    return [
        m.center[0] + m.radii[0] * wob * Math.cos(phi),
        m.center[1] + m.radii[1] * wob * Math.sin(phi),
        m.center[2] + m.radii[2] * Math.sin(swing),
    ];
}

/**
 * The murmuration at time t. `menu` (0..1) draws it in to the right of the menu's navigation;
 * `motion` (0..1) calms it for reduced motion; `gather` (0..1) how far it has poured into the ring
 * round the title. A closed form of time, so a seek lands where playing would.
 */
export function murmurationAt({
    time, breath = 0, aspect = 16 / 9, menu = 0, motion = 1, gather = 0,
}) {
    const M = MURMURATION;
    const hh = halfHeightAt(M.z);
    const hw = hh * Math.max(0.56, aspect);
    const tall = smoothstep(1.25, 0.85, aspect);
    const m = easeInOutCubic(menu);
    // It draws in a little on the in-breath.
    const draw = 1 - 0.07 * breath;
    const rx = lerp(M.rx * hw, 0.36 * hw, m) * draw;
    const ry = lerp(M.ry * hh, 0.6 * hh, m) * draw;
    // Out-breaths open it into two streams, more on some breaths than others.
    const split = (0.5 - 0.5 * Math.cos((TAU * time) / 40)) * (1 - breath) * 0.85 * motion;
    const ringBreath = 0.97 + 0.06 * breath;
    return {
        center: [lerp(0, 0.5 * hw, m), lerp(0.02, 0.04, m) * hh, M.z],
        radii: [rx, ry, M.zAmp * (0.4 + 0.6 * motion)],
        head: time * M.speed + 0.6,
        span: M.span,
        width: M.width * (1 + 0.1 * breath) * lerp(1, 0.7, tall) * (1 - 0.25 * m),
        thick: M.thick,
        split,
        // A wave of banking: about two and a half turns along it, rolling from head to tail.
        bank: [2.5, time * 1.5, 1.3 * motion, 0.35],
        wobble: time * 0.21,
        bulge: time * 0.5,
        light: (0.8 + 0.35 * breath) * (1 - 0.2 * m),
        swirl: time * 0.3,
        // The ring it gathers into stands round the title.
        // It breathes with the breath while it holds.
        ring: [0, 0.02 * hh, hw * lerp(0.4, 0.84, tall) * ringBreath, hh * lerp(0.48, 0.4, tall) * ringBreath],
        ringTube: 1.05,
        gather: clamp01(gather),
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
