/**
 * ODYSSEY COLOUR SCRIPT — the art-direction contract for the One World ascent.
 *
 * From docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md §3.9:
 *
 *   "'One world' is an ownership change with no art direction in it. Without this table the
 *    default outcome is one uniformly grey world."
 *
 * Making the environment continuous removes the seams; it does not by itself make the journey
 * *go* anywhere. This table is what gives an unbroken world a dramatic arc: a small number of
 * keyframes along the path, each a complete lighting state, interpolated smoothly.
 *
 * WHY OKLAB. Interpolating two saturated colours in sRGB drags the path through a desaturated
 * grey middle (and through hue shifts that read as a colour cast). Oklab is perceptually
 * uniform, so a midpoint looks like a midpoint. This is the single reason the whole ascent can
 * be six keyframes rather than thirty.
 *
 * THE TWO INVARIANTS, both unit-tested in odyssey-colour-script.test.js:
 *
 *   1. HORIZON CONVERGENCE. Every atmospheric keyframe's horizon lands within ΔHue ≤ 8° and
 *      ΔChroma ≤ 0.02 of one declared anchor. This is Shadow of the Colossus' trick: no matter
 *      what a biome's local albedo is, every distant plane converges on ONE hue, and that is
 *      what makes very different places read as one continent. Keyframes in another MEDIUM
 *      (underwater, vacuum) are exempt and must say so — see `medium`.
 *
 *   2. HUE RATE LIMIT. Hue may not move more than 12° per 0.05 of path progress, except across
 *      a declared occlusion seam. A faster change than that reads as a cut, and on a rail the
 *      player cannot look away from it.
 *
 * The palette is deliberately small — five slots. A journey is legible because its lighting
 * states are few and distinct, not because each one is richly specified.
 */

// ── Oklab ────────────────────────────────────────────────────────────────────────

/** sRGB 0..1 → linear 0..1. */
function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** linear 0..1 → sRGB 0..1. */
function linearToSrgb(c) {
    return c <= 0.0031308 ? c * 12.92 : (1.055 * (c ** (1 / 2.4))) - 0.055;
}

/** Hex (0xRRGGBB) → Oklab {L, a, b}. */
export function hexToOklab(hex) {
    const r = srgbToLinear(((hex >> 16) & 255) / 255);
    const g = srgbToLinear(((hex >> 8) & 255) / 255);
    const b = srgbToLinear((hex & 255) / 255);

    const l = (0.4122214708 * r) + (0.5363325363 * g) + (0.0514459929 * b);
    const m = (0.2119034982 * r) + (0.6806995451 * g) + (0.1073969566 * b);
    const s = (0.0883024619 * r) + (0.2817188376 * g) + (0.6299787005 * b);

    const l2 = Math.cbrt(l);
    const m2 = Math.cbrt(m);
    const s2 = Math.cbrt(s);

    return {
        L: (0.2104542553 * l2) + (0.7936177850 * m2) - (0.0040720468 * s2),
        a: (1.9779984951 * l2) - (2.4285922050 * m2) + (0.4505937099 * s2),
        b: (0.0259040371 * l2) + (0.7827717662 * m2) - (0.8086757660 * s2),
    };
}

/** Oklab {L, a, b} → linear-RGB triple 0..1 (what a TSL uniform wants). */
export function oklabToLinearRgb({ L, a, b }) {
    const l2 = L + (0.3963377774 * a) + (0.2158037573 * b);
    const m2 = L - (0.1055613458 * a) - (0.0638541728 * b);
    const s2 = L - (0.0894841775 * a) - (1.2914855480 * b);

    const l = l2 * l2 * l2;
    const m = m2 * m2 * m2;
    const s = s2 * s2 * s2;

    return [
        Math.max(0, Math.min(1, (4.0767416621 * l) - (3.3077115913 * m) + (0.2309699292 * s))),
        Math.max(0, Math.min(1, (-1.2684380046 * l) + (2.6097574011 * m) - (0.3413193965 * s))),
        Math.max(0, Math.min(1, (-0.0041960863 * l) - (0.7034186147 * m) + (1.7076147010 * s))),
    ];
}

/** Oklab → hex, for tests and tooling. */
export function oklabToHex(lab) {
    const [r, g, b] = oklabToLinearRgb(lab).map((c) => Math.round(linearToSrgb(c) * 255));
    return (r << 16) | (g << 8) | b;
}

/** Hue in degrees 0..360, and chroma, of an Oklab colour. */
export function oklabHue(lab) {
    const deg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    return (deg + 360) % 360;
}

export function oklabChroma(lab) {
    return Math.hypot(lab.a, lab.b);
}

/** Smallest signed angular difference between two hues, in degrees. */
export function hueDelta(h1, h2) {
    let d = ((h2 - h1) + 540) % 360;
    d -= 180;
    return d;
}

function mixOklab(x, y, t) {
    return {
        L: x.L + ((y.L - x.L) * t),
        a: x.a + ((y.a - x.a) * t),
        b: x.b + ((y.b - x.b) * t),
    };
}

// ── The script ───────────────────────────────────────────────────────────────────

/**
 * THE HORIZON ANCHOR. Every atmospheric keyframe's horizon converges on this hue. It is the
 * single most load-bearing number in the file: it is what makes an ocean, a meadow and an
 * alpine ridge read as one planet rather than three postcards.
 */
export const HORIZON_ANCHOR = 0xb8d2ea;

/** How far an atmospheric horizon may stray from the anchor. */
export const HORIZON_HUE_TOLERANCE_DEG = 8;
export const HORIZON_CHROMA_TOLERANCE = 0.02;

/** Hue may not move faster than this, except across a declared seam. */
export const MAX_HUE_RATE_DEG_PER_005P = 12;

/**
 * Keyframes along the ascent. `p` is path progress over Act II.
 *
 * `medium` marks which atmosphere a keyframe lives in. Only 'air' keyframes are held to the
 * horizon anchor — an underwater horizon and a vacuum have no aerial perspective to converge,
 * and pretending otherwise is how you end up with a teal sky in space.
 *
 * `seamAfter` declares an occlusion transition immediately after this keyframe, where the hue
 * rate limit is deliberately suspended because the change happens behind something: a breach
 * through the water surface, a climb through a cloud deck. Those are the only two places the
 * journey is allowed to cut.
 */
export const ODYSSEY_COLOUR_SCRIPT = Object.freeze([
    {
        p: 0.00,
        name: 'abyss',
        medium: 'water',
        skyZenith: 0x0a2036,
        skyHorizon: 0x06121f,
        sun: 0x2f5f7a,
        groundLit: 0x143244,
        groundShadow: 0x061420,
        exposure: 1.18,
        fogDensity: 0.0042,
        wind: 0.15,
        seamAfter: true, // the breach: the change happens through the water surface
    },
    {
        p: 0.18,
        name: 'breach',
        medium: 'air',
        skyZenith: 0x2f6fc4,
        skyHorizon: 0xc4d9ec,
        sun: 0xfff2dc,
        groundLit: 0x8fae86,
        groundShadow: 0x3d5a66,
        exposure: 1.05,
        fogDensity: 0.00020,
        wind: 0.45,
    },
    {
        p: 0.38,
        name: 'shore',
        medium: 'air',
        skyZenith: 0x2a6ec2,
        skyHorizon: 0xbdd4ea,
        sun: 0xfff0d2,
        groundLit: 0x6f9450,
        groundShadow: 0x3a5566,
        exposure: 1.00,
        fogDensity: 0.00016,
        wind: 0.55,
    },
    {
        p: 0.58,
        name: 'highlands',
        medium: 'air',
        skyZenith: 0x1f5fbe,
        skyHorizon: 0xb6cfe8,
        sun: 0xffeecb,
        groundLit: 0x5d8552,
        groundShadow: 0x33506b,
        exposure: 0.98,
        fogDensity: 0.00019,
        wind: 0.70,
    },
    {
        p: 0.76,
        name: 'alpine',
        medium: 'air',
        skyZenith: 0x1650b4,
        skyHorizon: 0xb2cde8,
        sun: 0xfff4e2,
        groundLit: 0x9fb6c6,
        groundShadow: 0x3c5c80,
        exposure: 0.94,
        fogDensity: 0.00024,
        wind: 0.92,
    },
    {
        p: 0.90,
        name: 'cloud-deck',
        medium: 'air',
        skyZenith: 0x0f3f9e,
        skyHorizon: 0xbdd3e9,
        sun: 0xfff8ee,
        groundLit: 0xd8e4ee,
        groundShadow: 0x6f8aa8,
        exposure: 0.90,
        fogDensity: 0.00030,
        wind: 1.00,
        seamAfter: true, // the climb out: the change happens inside the cloud deck
    },
    {
        p: 1.00,
        name: 'edge-of-space',
        medium: 'vacuum',
        skyZenith: 0x02040f,
        skyHorizon: 0x1b3f79,
        sun: 0xffffff,
        groundLit: 0x9fb4cc,
        groundShadow: 0x1a2740,
        exposure: 0.86,
        fogDensity: 0.00004,
        wind: 0.30,
    },
]);

const COLOUR_SLOTS = ['skyZenith', 'skyHorizon', 'sun', 'groundLit', 'groundShadow'];
const SCALAR_SLOTS = ['exposure', 'fogDensity', 'wind'];

// Pre-convert once; the script never changes at runtime.
const LAB_CACHE = ODYSSEY_COLOUR_SCRIPT.map((k) => {
    const out = {};
    COLOUR_SLOTS.forEach((slot) => { out[slot] = hexToOklab(k[slot]); });
    return out;
});

/**
 * Sample the script at path progress `p`.
 *
 * Colours are interpolated in Oklab and returned as LINEAR rgb triples, which is what a TSL
 * uniform wants — converting to sRGB here and letting three convert back would round-trip the
 * value through a transfer function twice.
 */
export function sampleColourScript(p) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
    const keys = ODYSSEY_COLOUR_SCRIPT;

    let i = 0;
    while (i < keys.length - 2 && clamped > keys[i + 1].p) i += 1;
    const a = keys[i];
    const b = keys[i + 1] ?? keys[i];
    const span = b.p - a.p;
    const raw = span > 1e-6 ? (clamped - a.p) / span : 0;
    const t = Math.max(0, Math.min(1, raw));
    // Smoothstep between keyframes: a colour script should ease, not ramp linearly, or every
    // keyframe announces itself as a corner in the light.
    const e = t * t * (3 - (2 * t));

    const result = { name: a.name, nextName: b.name, medium: a.medium };
    COLOUR_SLOTS.forEach((slot, slotIndex) => {
        const lab = mixOklab(LAB_CACHE[i][slot], LAB_CACHE[i + 1]?.[slot] ?? LAB_CACHE[i][slot], e);
        result[slot] = oklabToLinearRgb(lab);
        result[`${slot}Lab`] = lab;
        return slotIndex;
    });
    SCALAR_SLOTS.forEach((slot) => {
        result[slot] = a[slot] + (((b[slot] ?? a[slot]) - a[slot]) * e);
    });
    return result;
}

/** The keyframes, for tooling and tests. */
export function getColourScriptKeyframes() {
    return ODYSSEY_COLOUR_SCRIPT;
}
