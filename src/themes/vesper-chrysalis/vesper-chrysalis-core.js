/**
 * Vesper Chrysalis — constants and CPU maths shared by the plan, the choreography and the
 * shaders. Three-free: the director, the composition and their tests import only this.
 *
 * The site (metres): a still lake at y = 0 under a dusk sky. The viewer stands a little above
 * the water at the origin and looks down −Z. Seventy metres out a chrysalis of crystal hangs
 * over the lake from threads of silk; the play of the board wakes it, and wings of light unfurl
 * from it to either side of the board. Lantern lilies float on the water left and right; two
 * stands of crystal frame the view; a ringed world hangs in the sky and the day's last light
 * lies on the horizon to the right.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** (1 − |x|)² inside |x| < 1, else 0. */
export function bell(x) {
    const k = Math.max(0, 1 - Math.abs(x));
    return k * k;
}

/** mulberry32: a tiny seeded [0, 1) generator. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── The site ────────────────────────────────────────────────────────────────────

/** The rest camera. */
export const EYE = Object.freeze({
    x: 0,
    y: 4.4,
    z: 0,
    /** It looks this far above the horizontal, which puts the horizon about 60% down the frame. */
    pitch: 4.9 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 75,
    minFov: 40,
    maxFov: 70,
    near: 0.5,
    far: 6000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((EYE.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(EYE.minFov, Math.min(EYE.maxFov, v));
}

/** The chrysalis: it hangs head down, its long axis vertical. */
export const CHRYSALIS = Object.freeze({
    x: 0,
    z: -70,
    /** Its lowest point and its length. */
    foot: 10.6,
    length: 12.8,
    /** Greatest half-width (at the shoulder ridge). */
    radius: 2.9,
    /** The shoulder ridge (the diadem of gold points) as a fraction of the length from the foot. */
    shoulder: 0.74,
    /** Points of gold on the diadem: one lights for every step of the chain. */
    diadem: 12,
});

/** Height of the chrysalis's centre of light (what the halo and the shafts are centred on). */
export const HEART = Object.freeze([CHRYSALIS.x, CHRYSALIS.foot + CHRYSALIS.length * 0.56, CHRYSALIS.z]);

/** Radius of the chrysalis at fraction `t` of its length (0 = foot, 1 = the stalk it hangs by). */
export function chrysalisProfile(t) {
    const x = clamp01(t);
    // A rounded foot, a long swell to the shoulder, a quick taper to the stalk.
    const foot = Math.sqrt(Math.max(0, 1 - (1 - x / 0.2) ** 2));
    const belly = 0.5 + 0.5 * smooth(0, CHRYSALIS.shoulder, x) ** 0.85;
    const body = x < 0.2 ? foot * (0.5 + 0.5 * smooth(0, CHRYSALIS.shoulder, 0.2) ** 0.85) : belly;
    const cap = 1 - smooth(CHRYSALIS.shoulder, 0.99, x) ** 0.7 * 0.93;
    // The abdomen's segments above the shoulder, and the shoulder's own ridge.
    const ridge = 1 + 0.07 * bell((x - CHRYSALIS.shoulder) / 0.035);
    const rings = x > CHRYSALIS.shoulder ? 1 + 0.035 * Math.cos((x - CHRYSALIS.shoulder) * 96) : 1;
    return CHRYSALIS.radius * Math.min(body, 1) * cap * ridge * rings;
}

/** The set sun: the direction TOWARD it (it is below the horizon, to the right). */
export const SUN = Object.freeze({ azimuth: 27 * DEG, elevation: -4.5 * DEG });

/** The ringed world: where it hangs and how large it looks (radians). */
export const PLANET = Object.freeze({
    azimuth: -24.5 * DEG,
    elevation: 15.8 * DEG,
    radius: 5.5 * DEG,
    /** The rings: inner and outer edge in planet radii, how open they look, how they lean. */
    ringIn: 1.34,
    ringOut: 2.3,
    ringOpen: 0.3,
    ringLean: -17 * DEG,
});

/** The evening star. */
export const VESPER = Object.freeze({ azimuth: 27 * DEG, elevation: 20 * DEG });

/** A unit direction from an azimuth (0 = straight ahead, + to the right) and an elevation. */
export function skyDirection(azimuth, elevation, out = [0, 0, 0]) {
    const c = Math.cos(elevation);
    out[0] = Math.sin(azimuth) * c;
    out[1] = Math.sin(elevation);
    out[2] = -Math.cos(azimuth) * c;
    return out;
}

// ── Gameplay slots and timings ──────────────────────────────────────────────────

/** Rings on the lake the water evaluates at once. */
export const RING_SLOTS = 12;
/** Swells (a clear's wave over the lake) at once. */
export const SWELL_SLOTS = 3;
/** Moths in flight at once (a lock sends one, a hard drop three). */
export const MOTH_SLOTS = 12;
/** Motes in one moth's wake. */
export const MOTH_TAIL = 22;
/** Pulses of light on the silk at once. */
export const THREAD_PULSES = 4;
/** The most lantern lilies any tier floats. */
export const BLOOM_MAX = 24;
/** Blades of light the cleared rows throw out of the card. */
export const BLADE_SLOTS = 4;

/** A ring's radius `age` seconds after it starts: reach · RING_REACH · (1 − e^(−age/τ)) metres. */
export const RING_REACH = 22;
export const RING_TAU = 1.15;
export const RING_FADE = 0.62;
/** Seconds a ring stays on the water (the shader skips its loop after). */
export const RING_LIVE = 6.5;

export function ringRadius(age, reach = 1) {
    return age <= 0 ? 0 : reach * RING_REACH * (1 - Math.exp(-age / RING_TAU));
}

/** A clear's swell leaves the water under the chrysalis and crosses the lake at this speed (m/s). */
export const SWELL_SPEED = 46;
export const SWELL_GAP = 5.5;
export const SWELL_LIVE = 7.0;
/** Where on the lake the swells start: under the chrysalis. */
export const SWELL_ORIGIN = Object.freeze([CHRYSALIS.x, CHRYSALIS.z]);

/** Seconds after a clear at which its first front passes a point of the lake. */
export function swellPassTime(x, z) {
    return Math.hypot(x - SWELL_ORIGIN[0], z - SWELL_ORIGIN[1]) / SWELL_SPEED;
}

/** Seconds a moth takes from the board to its lily (scaled by distance in the world). */
export const MOTH_FLIGHT = 0.95;
/** How far along the view ray (metres) a moth leaves the card. */
export const MOTH_DEPTH = 15;

/** Seconds the light a lock leaves in a lily takes to fall to 1/e. */
export const BLOOM_HOLD = 30;
/** The most light one lily holds (in lock units). */
export const BLOOM_FULL = 2.2;
/** Seconds a lily takes to open when a moth lands on it. */
export const BLOOM_RISE = 0.55;
/** What a lily keeps of its light when a clear's swell passes it. */
export const BLOOM_KEEP = 0.22;

/** Seconds a four-line clear holds the lake's breath before everything fires. */
export const HUSH_HOLD = 0.24;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.4;
/** Seconds the wings take to fall to dust when the chain breaks. */
export const WING_FALL = 1.7;

// ── The wings ───────────────────────────────────────────────────────────────────

/**
 * Each wing is a fan about the root: `an` runs 0..1 across it (for a forewing from the trailing
 * margin up to the leading edge, for a hindwing from its upper edge down to the body) and `v`
 * runs 0..1 from the root to the margin. Veins are lines of constant `an`, bands lines of
 * constant `v`. The right-hand wings are given; the left are their mirror images.
 */
export const WINGS = Object.freeze({
    /** The shoulders: where the fans are rooted (x is mirrored for the left wing). */
    root: Object.freeze([1.1, CHRYSALIS.foot + CHRYSALIS.length * 0.66, CHRYSALIS.z + 1.4]),
    /** Length of a forewing, root to tip (metres). */
    span: 46,
    fore: Object.freeze({
        a0: -27 * DEG, a1: 21 * DEG, segA: 30, segV: 30, veins: 7, scallops: 7,
    }),
    hind: Object.freeze({
        a0: -32 * DEG, a1: -84 * DEG, segA: 24, segV: 22, veins: 6, scallops: 6,
    }),
    /** The eyespots: (an, v, radius as a fraction of the span). */
    foreEye: Object.freeze([0.44, 0.6, 0.058]),
    hindEye: Object.freeze([0.36, 0.6, 0.066]),
});

/**
 * A wing's margin at `an` without its scallops, as a fraction of the span.
 * kind 0 = forewing, 1 = hindwing.
 */
export function wingBase(kind, an) {
    const a = clamp01(an);
    if (kind === 0) {
        const base = 0.6 + 0.4 * smooth(0, 0.9, a) ** 1.35;
        // The hooked tip: the margin draws in just below it.
        return base - 0.045 * bell((a - 0.78) / 0.16);
    }
    // A hindwing hangs toward the lake and stops short of it.
    const angle = lerp(WINGS.hind.a0, WINGS.hind.a1, a);
    const reachToWater = (WINGS.root[1] - 1.6) / (WINGS.span * Math.max(0.2, Math.abs(Math.sin(angle))));
    return Math.min(0.62, reachToWater) * (0.85 + 0.15 * Math.sin(Math.PI * a ** 0.8));
}

/** The scallops: how far the margin stands out (+) or draws in (−) at `an`, as a share of it. */
export function wingScallop(kind, an) {
    const a = clamp01(an);
    const fan = kind === 0 ? WINGS.fore : WINGS.hind;
    // A lobe between each pair of veins.
    return (kind === 0 ? 0.022 : 0.035) * (Math.abs(Math.sin(a * fan.scallops * Math.PI)) - 0.5);
}

/** How strongly the scallops show at `v` along the wing: they belong to the margin only. */
export const scallopReach = (v) => clamp01(v) ** 8;

/** A wing's margin at `an`, as a fraction of the span. */
export function wingOutline(kind, an) {
    return wingBase(kind, an) * (1 + wingScallop(kind, an));
}

/**
 * How far the wings have opened for a chain of `combo` clears (0 = folded away, 1 = full).
 * The first clear already shows light past both edges of the board.
 */
export const WING_STEPS = Object.freeze([0, 0.42, 0.52, 0.62, 0.71, 0.8, 0.88, 0.95, 1]);

export function wingForCombo(combo) {
    const n = Math.max(0, Math.round(Number(combo) || 0));
    return n >= WING_STEPS.length ? 1 : WING_STEPS[n];
}

/** The chrysalis's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 4.2) : 0;
}

/** The chain at which the hindwings' and the forewings' eyes open. */
export const EYE_COMBO = Object.freeze({ hind: 4, fore: 6 });

/** How far the fans have spread (0..1) when the wings are `w` unfurled: the shape is there early. */
export function wingShape(w) {
    return smooth(0, 0.8, clamp01(w));
}

/**
 * A point of a wing in the world. `side` −1 left / +1 right, `w` 0..1 how far the wings have
 * unfurled, `beat` the stroke angle (radians, + toward the viewer). The vertex shader computes
 * the same (plus a ripple of its own).
 */
export function wingPoint(kind, side, an, v, w = 1, beat = 0, out = [0, 0, 0]) {
    const fan = kind === 0 ? WINGS.fore : WINGS.hind;
    // A young wing is gathered toward its leading edge and a little short; it fans out as it fills.
    const fold = kind === 0 ? 1 : 0;
    const s = wingShape(w);
    const spread = 0.62 + 0.38 * s;
    const a = lerp(fan.a0, fan.a1, fold + (an - fold) * spread);
    const margin = wingBase(kind, an) * (1 + wingScallop(kind, an) * scallopReach(v));
    const reach = WINGS.span * margin * v * (0.74 + 0.26 * s);
    const lx = Math.cos(a) * reach;
    const ly = Math.sin(a) * reach;
    // The stroke: the wing turns about the body's upright axis, its tip lagging.
    const th = beat * (0.35 + 0.65 * v);
    out[0] = side * (WINGS.root[0] + lx * Math.cos(th));
    out[1] = WINGS.root[1] + ly;
    out[2] = WINGS.root[2] + Math.abs(lx) * Math.sin(th);
    return out;
}

// ── The lantern lilies ──────────────────────────────────────────────────────────

/**
 * Where the lilies float: left and right of the board, in rows that recede toward the far
 * shore. Listed by importance: a tier floats the first N, and those alternate sides.
 * Each: { x, z, size, side, seed }.
 */
export function planBlooms(count = BLOOM_MAX, seed = 7411) {
    const rand = mulberry32(seed);
    const out = [];
    const half = Math.tan((EYE.hFov * DEG) / 2);
    let guard = 0;
    let tries = 0;
    while (out.length < count && guard < 6000) {
        guard += 1;
        tries += 1;
        const i = out.length;
        const side = i % 2 === 0 ? -1 : 1;
        // Nearer rows first, then the far ones.
        const row = Math.floor(i / 2);
        const depth = 24 + row * 7.5 + rand() * 9 + (row % 3) * 4;
        // Screen-space lateral position: clear of the card, inside the frame; every third one
        // close enough to the card that a tall phone screen still shows it.
        const near = row % 3 === 1;
        const lo = near ? 0.24 : 0.34;
        const hi = near ? 0.42 : 0.86;
        const lateral = lo + (hi - lo) * rand();
        const x = side * lateral * half * depth;
        const z = -depth;
        // Lilies keep their distance; a slot that cannot find room settles for less of it.
        const room = tries > 80 ? 4.5 : 6.5;
        let clear = true;
        for (let k = 0; k < out.length; k++) {
            if (Math.hypot(out[k].x - x, (out[k].z - z) * 1.6) < room) clear = false;
        }
        if (!clear) continue;
        tries = 0;
        out.push({
            x, z, size: 1.25 + rand() * 0.55, side, seed: rand(),
        });
    }
    return out;
}

/** A lily's light `t` seconds after its last change: it rises from `from` to `to`, then fades. */
export function bloomLevel(from, to, age) {
    if (age <= 0) return from;
    const rise = smooth(0, BLOOM_RISE, age);
    return lerp(from, to, rise) * Math.exp(-age / BLOOM_HOLD);
}

// ── The crystal stands ──────────────────────────────────────────────────────────

/**
 * Two stands of crystal rise from the lake at the edges of the view; the long threads the
 * chrysalis hangs by are made fast to their tallest points.
 * Each crystal: { x, z, height, radius, lean: [x, z], side, seed, main }.
 */
export function planSpires(perSide = 9, seed = 2203) {
    const rand = mulberry32(seed);
    const out = [];
    [-1, 1].forEach((side) => {
        const cx = side * 63;
        const cz = -96;
        for (let i = 0; i < perSide; i++) {
            const main = i === 0;
            const ring = main ? 0 : 0.35 + rand() * 0.65;
            const ang = rand() * TAU;
            const height = main ? 27 : 6 + (1 - ring) * 15 + rand() * 5;
            out.push({
                x: cx + Math.cos(ang) * ring * 10 + side * ring * 3,
                z: cz + Math.sin(ang) * ring * 13,
                height,
                radius: (main ? 2.3 : 0.9 + rand() * 1.0) * (0.75 + height / 60),
                lean: [side * (0.05 + ring * 0.22) + (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.24],
                side,
                seed: rand(),
                main,
            });
        }
    });
    return out;
}

/** The top of a crystal of the stand. */
export function spireTip(c, out = [0, 0, 0]) {
    // The crystal stands along (lean.x, 1, lean.z), made a unit vector, `height` long.
    const k = c.height / Math.hypot(c.lean[0], 1, c.lean[1]);
    out[0] = c.x + c.lean[0] * k;
    out[1] = k;
    out[2] = c.z + c.lean[1] * k;
    return out;
}

// ── Colour ──────────────────────────────────────────────────────────────────────

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** An sRGB hex as scene-linear [r, g, b]. */
export function linRGB(hex) {
    return [
        srgbToLinear(((hex >> 16) & 255) / 255),
        srgbToLinear(((hex >> 8) & 255) / 255),
        srgbToLinear((hex & 255) / 255),
    ];
}

/** A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]. */
export function pieceColor(value, fallback = 0xffb347) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Push a pale colour toward its own hue, and keep a floor in every channel so a pure primary
    // still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.7) / (1 - lo * 0.7);
        return pushed * 0.95 + 0.05;
    });
}

const pal = (name, c) => Object.freeze({
    name,
    zenith: linRGB(c.zenith),
    mid: linRGB(c.mid),
    horizon: linRGB(c.horizon),
    far: linRGB(c.far),
    glow: linRGB(c.glow),
    cloudLit: linRGB(c.cloudLit),
    cloudShade: linRGB(c.cloudShade),
    haze: linRGB(c.haze),
    range: linRGB(c.range),
    deep: linRGB(c.deep),
    crystal: linRGB(c.crystal),
    shell: linRGB(c.shell),
    core: linRGB(c.core),
    wingRoot: linRGB(c.wing[0]),
    wingMid: linRGB(c.wing[1]),
    wingEdge: linRGB(c.wing[2]),
    auroraA: linRGB(c.aurora[0]),
    auroraB: linRGB(c.aurora[1]),
    /** How far into the night this hour is: stars and the aurora at rest. */
    night: c.night,
});

/**
 * The hours of the evening, in order (they come round again), authored in sRGB, held
 * scene-linear. A level moves the evening on one hour, and it moves on slowly by itself
 * (hourAt, paletteAt below):
 *   zenith / mid / horizon   the sky from overhead down to the horizon toward the set sun
 *   far                      the horizon away from the sun
 *   glow                     the day's last light
 *   cloudLit / cloudShade    the clouds' lit undersides and their bodies
 *   haze                     the mist on the far water and at the mountains' feet
 *   range                    the nearest mountains
 *   deep                     the lake's own colour
 *   crystal                  the stands of crystal
 *   shell / core             the chrysalis's crystal and the light inside it
 *   wing                     the wings from root through mid to margin
 *   aurora                   the two colours of the curtains
 */
export const VESPER_PALETTES = Object.freeze([
    pal('rose-dusk', {
        zenith: 0x07041a,
        mid: 0x2a1356,
        horizon: 0xd24a78,
        far: 0x48297c,
        glow: 0xff8a3c,
        cloudLit: 0xff7f6a,
        cloudShade: 0x2a1a4a,
        haze: 0x9a5a9e,
        range: 0x150c2e,
        deep: 0x0b0720,
        crystal: 0x8fe2ff,
        shell: 0x5a3aa8,
        core: 0xffa23a,
        wing: [0xffb347, 0xff5a9e, 0x7fe6ff],
        aurora: [0xff6ec7, 0x7be0ff],
        night: 0.35,
    }),
    pal('ember-hour', {
        zenith: 0x160b2a,
        mid: 0x5c2250,
        horizon: 0xf0603a,
        far: 0x70407a,
        glow: 0xffb040,
        cloudLit: 0xffa050,
        cloudShade: 0x3a1a3e,
        haze: 0xc06a70,
        range: 0x1c0d24,
        deep: 0x100818,
        crystal: 0xffd9a0,
        shell: 0x7a3a70,
        core: 0xffc04a,
        wing: [0xffd76a, 0xff7a3a, 0xff9ac0],
        aurora: [0xffb45a, 0xff6e9a],
        night: 0.2,
    }),
    pal('violet-hour', {
        zenith: 0x080624,
        mid: 0x2a1a70,
        horizon: 0x9a55d8,
        far: 0x3a3a90,
        glow: 0xff6ec7,
        cloudLit: 0xd070e0,
        cloudShade: 0x1c164a,
        haze: 0x7a5ab8,
        range: 0x0e0a2a,
        deep: 0x070520,
        crystal: 0xc8a8ff,
        shell: 0x4a3ab8,
        core: 0xff7ad0,
        wing: [0xff8ad8, 0xa060ff, 0xb8f0ff],
        aurora: [0xb070ff, 0x60e0ff],
        night: 0.55,
    }),
    pal('blue-hour', {
        zenith: 0x040820,
        mid: 0x0f2460,
        horizon: 0x4a7ad8,
        far: 0x1c3a80,
        glow: 0x8fd8ff,
        cloudLit: 0x8ab0f0,
        cloudShade: 0x0c1840,
        haze: 0x5a80c0,
        range: 0x070c26,
        deep: 0x040818,
        crystal: 0xa8ecff,
        shell: 0x2a4ab0,
        core: 0x9ae8ff,
        wing: [0xc8f4ff, 0x4aa0ff, 0xffffff],
        aurora: [0x60ffd0, 0x60a0ff],
        night: 0.8,
    }),
    pal('aurora-night', {
        zenith: 0x02061a,
        mid: 0x06283e,
        horizon: 0x1c7a6a,
        far: 0x0c3050,
        glow: 0x6affc0,
        cloudLit: 0x4ac0a0,
        cloudShade: 0x061a2c,
        haze: 0x3a8a8a,
        range: 0x040c1c,
        deep: 0x020812,
        crystal: 0x8affd8,
        shell: 0x1a6a8a,
        core: 0x9affb0,
        wing: [0xd8ff8a, 0x3ae0b0, 0xb080ff],
        aurora: [0x5aff9a, 0xb070ff],
        night: 1,
    }),
    pal('first-light', {
        zenith: 0x0e1838,
        mid: 0x48407a,
        horizon: 0xf2a878,
        far: 0x5a6aa0,
        glow: 0xffe2a8,
        cloudLit: 0xffc0a0,
        cloudShade: 0x30305a,
        haze: 0xc8a0a8,
        range: 0x12142e,
        deep: 0x0a0c20,
        crystal: 0xffe8d0,
        shell: 0x6a5a9a,
        core: 0xffe08a,
        wing: [0xfff0b0, 0xff9a8a, 0x9ad8ff],
        aurora: [0xffc890, 0x90c8ff],
        night: 0.3,
    }),
]);

export const PALETTE_KEYS = Object.freeze([
    'zenith', 'mid', 'horizon', 'far', 'glow', 'cloudLit', 'cloudShade', 'haze', 'range', 'deep',
    'crystal', 'shell', 'core', 'wingRoot', 'wingMid', 'wingEdge', 'auroraA', 'auroraB',
]);

/** Seconds the evening takes to move on one hour by itself, whatever the level. */
export const HOUR_SECONDS = 120;

/**
 * The hour of the evening as a number. Whole numbers are the palettes in order (they come round
 * again); the fraction is how far the evening has moved on toward the next. A level moves it on
 * a whole hour; `time` (seconds on the world clock) moves it on slowly by itself.
 */
export function hourAt(level, time = 0, drifting = true) {
    const n = Number(level);
    const base = Number.isFinite(n) ? Math.max(1, Math.round(n)) - 1 : 0;
    const elapsed = drifting && Number.isFinite(time) ? Math.max(0, time) : 0;
    return base + elapsed / HOUR_SECONDS;
}

/**
 * The palette at an hour: the hour the evening has left and the one it is moving to, blended —
 * slowly either side of a whole hour, so each hour is itself for a while. Writes scene-linear
 * colours (and `night`) into `out` and returns it.
 */
export function paletteAt(hour, out = {}) {
    const n = VESPER_PALETTES.length;
    const h = Number.isFinite(hour) ? ((hour % n) + n) % n : 0;
    const from = Math.floor(h) % n;
    const f = h - Math.floor(h);
    const w = f * f * (3 - 2 * f);
    const a = VESPER_PALETTES[from];
    const b = VESPER_PALETTES[(from + 1) % n];
    const target = out;
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
        const key = PALETTE_KEYS[i];
        const mixed = target[key] || (target[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c++) mixed[c] = a[key][c] + (b[key][c] - a[key][c]) * w;
    }
    target.night = a.night + (b.night - a.night) * w;
    return target;
}

/** The colour a four-line clear fires in. */
export const VESPERFIRE = Object.freeze([1.0, 0.86, 0.62]);
