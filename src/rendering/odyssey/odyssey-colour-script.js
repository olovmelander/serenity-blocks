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
 * THE EVENING (chapter 5, 2026-11-17) is the declared exception to invariant 1 and takes
 * invariant 2 in another form: its keyframes carry `horizon: 'evening'`, their horizons leave the
 * anchor on purpose (the day ends on the climb), and they are rate-limited by how far the horizon
 * colour MOVES rather than by its hue angle. See the note at those keyframes.
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
 * THE EVENING'S RATE LIMIT: how far the horizon colour may travel in the Oklab a/b plane per 0.05
 * of path progress, from the last anchored keyframe into the evening and through it.
 *
 * A hue ANGLE is the wrong ruler here. The evening's horizons are pale (chroma 0.01-0.06), and on
 * its way from the anchor's blue to gold the colour passes close to white, where the angle swings
 * through 180 degrees while the eye sees a blue haze turn cream. What reads as a cut is the
 * colour's own travel. 0.055 is the pace of the journey's two declared occlusion seams (0.04-0.05
 * measured), so the evening may move as fast as a seam does and no faster; a swing from the
 * anchor to its warm opposite inside one window (0.078) is refused.
 */
export const MAX_EVENING_HORIZON_TRAVEL_PER_005P = 0.055;

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
/**
 * THE SEA'S OWN RAMP — one table owns the water's colour (painted-water plan, Wave 1).
 *
 * The Act II water surface used to carry three hardcoded `vec3`s in the renderer, divorced
 * from this file, so "the colour script owns the palette" was true of everything except the
 * sea. These four stops are that palette, in the scene-referred units the world authors in
 * (the board hands the stack `applyExposure:false` + output scale/saturation, so these are
 * NOT display hexes — they are magnitude-matched to the ramp they replace, which was tuned
 * in-game).
 *
 * The hues are the painted pigment axis the research pass converged on: Painted backgrounds are
 * opaque poster colour drawn from a narrow, nameable set, and the sea runs viridian in the
 * shallows through cerulean and cobalt to a Prussian deep — teal/slate-shifted, never a
 * saturated primary blue. Four stops, because a painted sea reads as a few flat plates of
 * colour rather than a continuous gradient; the renderer quantises between them.
 */
export const ODYSSEY_WATER_RAMP = Object.freeze({
    /** Viridian shallows — where the bed is a metre or two down and the sand tints it green. */
    shore: Object.freeze([0.42, 0.74, 0.66]),
    /** Cerulean — the near-shore body. */
    shelf: Object.freeze([0.19, 0.55, 0.68]),
    /** Cobalt — open water. */
    open: Object.freeze([0.09, 0.33, 0.55]),
    /** Prussian — the deep, muted and green-black rather than purple-blue. */
    deep: Object.freeze([0.045, 0.17, 0.32]),
    /**
     * Absorption coefficient for the depth driver, per metre: t = 1 − exp2(−depth·k).
     *
     * MEASURED, not chosen by eye. Ray-casting the real height field through the real camera
     * at the two largest water views gives a median visible bed depth of 49.6 m at the ch3
     * shoreline (p=0.225) and 133 m just past the breach (p=0.210, 29% of the frame). The old
     * ramp's band edges (0–18 m, then 18–103 m) put BOTH medians in its flat upper region —
     * 59% of shoreline water pixels landed in one band and nearly all post-breach pixels were
     * pinned at the deep colour, which is precisely why the sea read as a single flat sheet.
     * k = 0.02 puts 50 m at exactly t = 0.5, 10 m at 0.13 and 133 m at 0.84, so the visible
     * range spans the whole ramp instead of its last sixth.
     */
    absorptionPerMetre: 0.02,
    /** How many flat plates the ramp is quantised into (the toon signature). */
    bands: 4,
});

export const ODYSSEY_COLOUR_SCRIPT = Object.freeze([
    {
        p: 0.00,
        name: 'abyss',
        medium: 'water',
        // Blue-black (masterpiece pass, 2026-11-17): the deep is dark, and the things that glow in
        // it are its lights. The water COLUMN's own colours by depth live in the depth arc
        // (world/odyssey-ocean-depth.js); these keyframes are what the script still drives under
        // water: the sky seen through the surface, the shafts' light, the rail's and the orbs' fog.
        skyZenith: 0x061426,
        skyHorizon: 0x040c18,
        sun: 0x2a5a80,
        groundLit: 0x0e2a40,
        groundShadow: 0x040e1a,
        exposure: 1.18,
        fogDensity: 0.0042,
        wind: 0.15,
        seamAfter: true, // the breach: the change happens through the water surface
    },
    {
        p: 0.06,
        name: 'luminous-mid-water',
        medium: 'water',
        // The water the vent opens into (the journey reaches the sea at script p 0.05): a dark
        // blue, so the eruption's glow and the quench's steam have something to burn against.
        skyZenith: 0x0f3454,
        skyHorizon: 0x0b2e46,
        sun: 0x3a78a4,
        groundLit: 0x184a64,
        groundShadow: 0x081f2e,
        exposure: 1.12,
        fogDensity: 0.0034,
        wind: 0.22,
    },
    {
        p: 0.12,
        name: 'shallows',
        medium: 'water',
        skyZenith: 0x2f6f9e,
        skyHorizon: 0x4a8ab0,
        sun: 0x80c0e0,
        groundLit: 0x5d95b4,
        groundShadow: 0x1d465e,
        exposure: 1.08,
        fogDensity: 0.0016,
        wind: 0.32,
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
    // ── THE ISLAND'S MORNING AND THE MOUNTAINS' AFTERNOON (masterpiece pass, 2026-11-17) ──
    // Chapters 3 and 4 shared one noon ('shore', p 0.38, stood where these three stand). Each now
    // has its own hour: the island keeps its fresh morning to its last orb, the day turns between
    // the two chapters, and the mountains stand in a warm late afternoon that ends at the start of
    // the golden hour, where the sky chapter takes it on. `hour` (see HOUR below) carries the part
    // of that light the five colours cannot: alpenglow, the blue of long shadows, the gold in the
    // clouds and the mist. In script p these sit at the last island orb's park (journey p 0.2323),
    // the first mountain orbs' park (0.2689) and the last mountain orb (0.3356).
    {
        p: 0.2690,
        name: 'island-morning',
        medium: 'air',
        skyZenith: 0x2c6fc6,
        skyHorizon: 0xc0d9ee,
        sun: 0xfff4e2,
        groundLit: 0x7ea268,
        groundShadow: 0x3b5868,
        exposure: 1.02,
        fogDensity: 0.00018,
        wind: 0.50,
        hour: 0,
        // The day turns after this keyframe, behind a cloud's shadow (world/odyssey-day-turn.js):
        // the shade crosses the valley and the afternoon's light follows it up the mountain. It
        // is NOT a declared `seamAfter`: the horizon keeps the anchor's hue through it (the
        // evening's warmth lies in a belt under the script's horizon, see `hour`), so the hue
        // rate limit holds across the turn with nothing suspended.
    },
    {
        p: 0.3155,
        name: 'mountain-afternoon',
        medium: 'air',
        skyZenith: 0x2562c4,
        skyHorizon: 0xc9dcec,
        sun: 0xffd9a8,
        groundLit: 0x8a9a52,
        groundShadow: 0x44609a,
        exposure: 1.00,
        fogDensity: 0.00021,
        wind: 0.60,
        hour: 0.42,
    },
    {
        p: 0.4050,
        name: 'alpine-gold',
        medium: 'air',
        skyZenith: 0x1f5cc4,
        skyHorizon: 0xcbdcea,
        sun: 0xffc885,
        groundLit: 0x9a9648,
        groundShadow: 0x46629c,
        exposure: 0.98,
        fogDensity: 0.00024,
        wind: 0.70,
        hour: 0.62,
    },
    // ── THE EVENING (2026-11-17, the sky pass of the masterpiece round) ─────────────────────
    // Chapter 5 used to climb through the same noon as chapters 3 and 4 ('highlands', 'alpine',
    // 'cloud-deck': three blues a few points apart), so "Sky & Atmospheric Drift" had no sky of
    // its own. Now the day ends on the climb: one keyframe per orb (L27 .. L34), late afternoon
    // gold at the foot of the wall, amber, the sunset's rose on the snow, the pink belt over the
    // Earth's shadow as the eye comes out above the summit, and the indigo of thin air where the
    // round Earth arrives. The world's sun stays where it is (ODYSSEY_WORLD_SUN is baked into the
    // shadow plates); what sinks is the LIGHT: its colour here, and the sky's own sun, belt and
    // shadow in world/odyssey-evening.js.
    //
    // `horizon: 'evening'` DECLARES THE EXEMPTION from the horizon anchor (invariant 1), the way
    // `medium` exempts water and vacuum. The anchor made three biomes read as one continent under
    // one noon; an evening is the horizon leaving that blue, on purpose, in the journey's last
    // act in the air. The owner's brief for this round (each chapter its own mood, palette and
    // light) outranks the anchor here. What still holds is invariant 2 in the form that means
    // something for pale colours: these horizons are held to a rate limit on how far the colour
    // MOVES (Oklab a/b distance per 0.05 p), because a hue angle swings 180 degrees through a
    // near-white cream without the eye seeing any change at all.
    //
    // The sun colours are light on SNOW: saturated enough to read as light rather than as sand
    // (the 2026-10-20 'sand cone' was a pale warm white, which reads as dirty snow; gold and rose
    // read as alpenglow), and the shadow tint walks to violet-blue against them.
    {
        p: 0.409, // journey p 0.340: where the island pass hands the light over
        name: 'golden-hour',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x3f7ed6,
        skyHorizon: 0xf2dfc4,
        sun: 0xffcd8c,
        groundLit: 0x7f9a5a,
        groundShadow: 0x425a84,
        exposure: 0.99,
        fogDensity: 0.00017,
        wind: 0.60,
    },
    {
        p: 0.4875, // L28, p 0.400
        name: 'gold',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x4079d8,
        skyHorizon: 0xf6d6b2,
        sun: 0xffc377,
        groundLit: 0x8f9a5c,
        groundShadow: 0x465b8e,
        exposure: 0.98,
        fogDensity: 0.00018,
        wind: 0.68,
    },
    {
        p: 0.5528, // L29, p 0.450
        name: 'amber',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x4370d8,
        skyHorizon: 0xf6cbac,
        sun: 0xffb66c,
        groundLit: 0xa89a66,
        groundShadow: 0x495a98,
        exposure: 0.97,
        fogDensity: 0.00019,
        wind: 0.76,
    },
    {
        p: 0.6193, // L30, p 0.501
        name: 'sunset',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x4667d8,
        skyHorizon: 0xf5c4b6,
        sun: 0xffa56f,
        groundLit: 0xc09a78,
        groundShadow: 0x50589f,
        exposure: 0.96,
        fogDensity: 0.00021,
        wind: 0.84,
    },
    {
        p: 0.6859, // L31, p 0.552
        name: 'alpenglow',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x445cd0,
        skyHorizon: 0xf1c2c9,
        sun: 0xff9782,
        groundLit: 0xcf9c92,
        groundShadow: 0x54559f,
        exposure: 0.95,
        fogDensity: 0.00023,
        wind: 0.90,
    },
    {
        p: 0.7512, // L32, p 0.602
        name: 'belt-of-venus',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x394bbc,
        skyHorizon: 0xe8c6d6,
        sun: 0xff9d92,
        groundLit: 0xd2a2a8,
        groundShadow: 0x4f4e98,
        exposure: 0.94,
        fogDensity: 0.00024,
        wind: 0.94,
    },
    {
        p: 0.827, // L33, p 0.653
        name: 'afterglow',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x283a9c,
        skyHorizon: 0xd4bfdc,
        sun: 0xffb7a4,
        groundLit: 0xd6b4bc,
        groundShadow: 0x484a92,
        exposure: 0.92,
        fogDensity: 0.00027,
        wind: 0.98,
    },
    {
        p: 0.90, // p 0.696, just before L34
        name: 'cloud-deck',
        medium: 'air',
        horizon: 'evening',
        skyZenith: 0x131f66,
        skyHorizon: 0xb4b3e0,
        // The light clears as the eye leaves the weather: above the dense air the low sun is
        // white again, which is the light the round Earth is lit by where it takes over.
        sun: 0xffdccb,
        groundLit: 0xd8e4ee,
        groundShadow: 0x5a6aa6,
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

/**
 * THE DEEP IS DARK (Act I overhaul, 2026-10-20) — the ocean's value structure.
 *
 * Captured before this: every chapter 2 frame from the vent to ~60 u under the surface sat at luma
 * ~100-110, one mid-blue from edge to edge, so the light shafts, the motes and the Snell window
 * (the only lights down there) had nothing darker to stand against. Looking UP from 150 u down,
 * the light reaching the eye has crossed 150 u of water: the column should be deep and dim, and
 * brighten as the climb nears the surface. This is the multiplier on the water's IN-SCATTERED
 * light (the haze every underwater surface converges to), by the eye's depth (the world's
 * `uEyeDepth`: 0 at the surface, 1 from 140 u down). It leaves the top ~30 u untouched (the 2->3
 * breach frames and their seam gate) and is a pure function.
 *
 * Since the masterpiece pass (2026-11-17) the world's own column, the whales and the visitors take
 * their darkness from the depth arc (world/odyssey-ocean-depth.js: four waters, the abyss at 0.24);
 * this function remains for the steam quench's exit colour, at the vent's depth, and was deepened
 * with it (0.45 -> 0.30) so the steam clears onto the dark water that is really there.
 */
export const DEEP_WATER_DIM = 0.30;
/**
 * @param {number} eyeDepth 0..1 (0 at the surface, 1 from 140 u down)
 * @returns {number} 1 near the surface, DEEP_WATER_DIM in the deep
 */
export function odysseyDeepWaterDim(eyeDepth) {
    const e = Math.max(0, Math.min(1, Number.isFinite(eyeDepth) ? eyeDepth : 0));
    const t = Math.max(0, Math.min(1, (e - 0.2) / 0.8));
    return 1 - ((1 - DEEP_WATER_DIM) * t * t * (3 - (2 * t)));
}

const COLOUR_SLOTS = ['skyZenith', 'skyHorizon', 'sun', 'groundLit', 'groundShadow'];
const SCALAR_SLOTS = ['exposure', 'fogDensity', 'wind'];

// Pre-convert once; the script never changes at runtime.
const LAB_CACHE = ODYSSEY_COLOUR_SCRIPT.map((k) => {
    const out = {};
    COLOUR_SLOTS.forEach((slot) => { out[slot] = hexToOklab(k[slot]); });
    return out;
});

/**
 * THE HOUR (masterpiece pass, 2026-11-17) — how far the day has gone toward sunset: 0 is the clear
 * day every keyframe had, 1 the sun on the horizon. The world's sun never moves (its direction is
 * baked into the shadow plates), so the hour is told by colour, and five colour slots cannot tell
 * all of it: this scalar scales the terms that only exist late in the day (alpenglow on lit snow,
 * the sky's blue in long shadows, the sun's share of a cloud's lit side, the warm air toward the
 * sun, the mist in the hollows; world/odyssey-day-turn.js `ODYSSEY_HOUR_LOOK`).
 *
 * A keyframe that names no `hour` KEEPS THE HOUR OF THE ONE BEFORE IT, so the day never jumps back
 * to noon at a keyframe that was written before the hour existed, and a later keyframe takes the
 * day further by naming its own.
 */
const HOUR_CACHE = ODYSSEY_COLOUR_SCRIPT.reduce((out, k) => {
    out.push(Number.isFinite(k.hour) ? Math.min(Math.max(k.hour, 0), 1) : (out.at(-1) ?? 0));
    return out;
}, []);

/** The hour each keyframe stands at (its own, or the one it inherits), for tests and tooling. */
export function getColourScriptHours() {
    return HOUR_CACHE.slice();
}

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
    result.hour = HOUR_CACHE[i] + (((HOUR_CACHE[i + 1] ?? HOUR_CACHE[i]) - HOUR_CACHE[i]) * e);
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
        // THE VENT (masterpiece pass, 2026-11-17). The crack is no longer a pale vapour that turns
        // white and then grey: straight ahead (the "zenith" the climb looks into) is the sea's eye,
        // blue-black; round it the steam is lit gold by the lava below; the rock of the vent's rim
        // is black with ember in it. The picture is drawn by the steam quench and the sea vent
        // (composition/odyssey-steam-quench.js, chapter-environments/earth-core-sea-vent.js); this
        // keyframe is its palette.
        skyZenith: 0x06162a,
        skyHorizon: 0xd9822b,
        sun: 0xffa24a,
        groundLit: 0x3a1a0c,
        groundShadow: 0x0b0d14,
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
