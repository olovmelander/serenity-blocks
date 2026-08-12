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

// ── ACT I ────────────────────────────────────────────────────────────────────────

/**
 * THE ACT I SCRIPT — Earth Core, in its own array on its own domain.
 *
 * Act I could not be added to the array above: `sampleColourScript` clamps to [0, 1] and a
 * shipped test pins that the script spans exactly that, so the "extend it downward with
 * negative p" design in the plan was unimplementable. Re-basing the Act II keyframes to make
 * room would have moved a shipped, capture-verified act. So Act I gets its own table on its
 * own parameter — chapter-1 local progress, 0 at birth, 1 at the crack — sharing every piece
 * of machinery above (Oklab interpolation, the slot list, the invariants).
 *
 * The SLOT NAMES are deliberately unchanged, because a cavern is a room with a sky:
 *   skyZenith   → the vault crown (the darkness the whole act is built on)
 *   skyHorizon  → the vault low band, where the lake's bounce lives
 *   sun         → THE KEY: the lava lake / the veins it lights
 *   groundLit   → rock facing the key
 *   groundShadow→ rock that is not
 *
 * Values are Wave 1's capture-calibrated palette, not the plan's first proposal — the study
 * moved almost every one of them (see the Wave 1 outcome). They are authored for the FLAT
 * playground; the in-game port overshoots, per the standing NoToneMapping-vs-ACES rule.
 */
export const ODYSSEY_ACT1_COLOUR_SCRIPT = Object.freeze([
    {
        t: 0.00,
        name: 'birth',
        medium: 'magma',
        skyZenith: 0x0a0810,
        skyHorizon: 0x2a1208,
        sun: 0xff6a28,
        groundLit: 0x3a1c10,
        groundShadow: 0x0d0b12,
        exposure: 1.10,
        fogDensity: 0.0028,
        wind: 0.10,
    },
    {
        t: 0.55,
        name: 'cathedral',
        medium: 'magma',
        skyZenith: 0x0d0b12,
        skyHorizon: 0x241008,
        sun: 0xff8040,
        groundLit: 0x2e1710,
        groundShadow: 0x0b0910,
        exposure: 1.05,
        fogDensity: 0.0022,
        wind: 0.16,
        // The quench owns the next transition. Declared HERE, not on `crack`: the rate limit
        // is checked on the pair FOLLOWING the declaration, and cathedral -> crack is the
        // ember-to-vapour swing the occlusion moment exists to hide.
        seamAfter: true,
    },
    {
        t: 1.00,
        name: 'crack',
        medium: 'steam',
        skyZenith: 0x1a2630,
        skyHorizon: 0xcfe6ff,
        sun: 0xffb079,
        groundLit: 0x8fa6b4,
        groundShadow: 0x22303c,
        exposure: 1.00,
        fogDensity: 0.0040,
        wind: 0.35,
        // THE ONE PLACE WARM AND COOL SHARE A FRAME. Everywhere else in the act that is a
        // bug (see INVARIANT 3); here it is the entire point — fire meeting water — and the
        // steam quench is drawn over it. Exactly one keyframe may declare this.
        warmCoolCollision: true,
    },
]);

const ACT1_LAB_CACHE = ODYSSEY_ACT1_COLOUR_SCRIPT.map((k) => {
    const out = {};
    COLOUR_SLOTS.forEach((slot) => { out[slot] = hexToOklab(k[slot]); });
    return out;
});

/**
 * Sample the Act I script at chapter-1 local progress `t` (0 = birth, 1 = the crack).
 * Same easing and same Oklab path as `sampleColourScript`; separate domain.
 * @param {number} t
 */
export function sampleAct1ColourScript(t) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    const keys = ODYSSEY_ACT1_COLOUR_SCRIPT;

    let i = 0;
    while (i < keys.length - 2 && clamped > keys[i + 1].t) i += 1;
    const a = keys[i];
    const b = keys[i + 1] ?? keys[i];
    const span = b.t - a.t;
    const raw = span > 1e-6 ? (clamped - a.t) / span : 0;
    const localT = Math.max(0, Math.min(1, raw));
    const e = localT * localT * (3 - (2 * localT));

    const result = { name: a.name, nextName: b.name, medium: a.medium };
    COLOUR_SLOTS.forEach((slot) => {
        const lab = mixOklab(ACT1_LAB_CACHE[i][slot], ACT1_LAB_CACHE[i + 1]?.[slot] ?? ACT1_LAB_CACHE[i][slot], e);
        result[slot] = oklabToLinearRgb(lab);
        result[`${slot}Lab`] = lab;
    });
    SCALAR_SLOTS.forEach((slot) => {
        result[slot] = a[slot] + (((b[slot] ?? a[slot]) - a[slot]) * e);
    });
    return result;
}

/**
 * INVARIANT 3 — WARM/COOL EXCLUSIVITY, as a function so both scripts can be checked.
 *
 * The research behind this act found the same discipline in every adopted reference: a zone
 * is one temperature family plus one accent, and warm never shares a frame with cool except
 * at a declared collision. Wave 1 proved how fast that inverts in practice — an unstarved
 * cyan seed turned the molten cathedral into a cool cave with warm decorations in a single
 * capture. This makes it mechanical instead of a matter of taste.
 *
 * CHROMA FLOOR, CALIBRATED AGAINST THE ACTUAL PALETTE (do not raise it back to 0.05).
 * This act's cool tones are PALE by design — the quench's shipped `#cfe6ff` measures Oklab
 * chroma 0.042, its vault-cool `#1a2630` 0.025, its lit rock `#8fa6b4` 0.033. A floor set for
 * saturated colour (0.05) classified every one of them as neutral, so the crack keyframe read
 * as "all warm" and the rule was blind in precisely the place it exists to watch. 0.02 sees
 * them while still excluding the near-neutral charcoals (`#0d0b12` at 0.015), which carry a
 * nominal hue that means nothing at that saturation.
 *
 * @param {object} keyframe
 * @returns {{warm: string[], cool: string[]}} offending slots by temperature, chroma-gated
 */
export const ACT1_CHROMA_FLOOR = 0.02;

export function classifyTemperature(keyframe, chromaFloor = ACT1_CHROMA_FLOOR) {
    const warm = [];
    const cool = [];
    COLOUR_SLOTS.forEach((slot) => {
        const lab = hexToOklab(keyframe[slot]);
        if (oklabChroma(lab) <= chromaFloor) return;
        const hue = oklabHue(lab);
        if (hue >= 0 && hue <= 90) warm.push(slot);
        else if (hue >= 180 && hue <= 280) cool.push(slot);
    });
    return { warm, cool };
}
