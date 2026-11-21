/**
 * ODYSSEY ACT II — THE WATERS' LOOKS (2026-11-02): the sea's pigments, the north lake's colours
 * and the settings of the terms the world renderer shades them with, plus CPU twins of the formulas
 * the tests hold (the depth colour, the sea's horizon dissolve from above, its surf line from afar,
 * the lake's clear water and soft shore). Three-free.
 *
 * The twins mirror the shader in odyssey-world-renderer.js line for line (`waterRampBody`, the
 * dissolve, `buildShoreFoam`'s surf line, the lake's clear film and opacity). Change both together.
 */
import { ODYSSEY_WATER_RAMP } from '../odyssey-colour-script.js';

/**
 * THE NORTH LAKE'S WATER (2026-11-02, Olov: "Real water for the lake ... reflections of the sky
 * and clouds, a turquoise-to-blue depth colour, and a soft shoreline instead of a hard dark
 * edge"; clear since 2026-11-21, the tarn's kind). The lake is the island's one water, like the
 * sea and the tarn: the shared `water*` terms with a few lake settings.
 *
 * - `clarity`: how fast its water takes the bed (per unit of depth): the sand shows 61 % through
 *   1 u, 22 % through 3 u, 1 % through 10 u. The ground draws the bed (the tarn's bed in the
 *   lake's units, a sand shelf).
 * - `shallow`, `deep`: the water's own colour where the bed no longer shows (linear), turquoise
 *   in the first units and a deep blue past `blend` (u of depth): the owner's "turquoise-to-blue".
 *   It is the water's, self-lit as a pigment is: the bed is lit by the low evening sun like any
 *   ground, and from the climb, through ~1 km of the evening's haze, a lit sand shelf alone read
 *   as a pale lilac ring.
 * - `calm`: the sea's ripple slope scaled for a big sheltered lake, between the tarn and the sea;
 *   `rippleFade`: the range (u) over which that fine ripple gives way, because it is finer than a
 *   pixel from the climb; `swell`, `swellScale`: the broad undulation that bends the reflection
 *   from afar instead (its slope gain, and the bake's scale per unit).
 * - `fresnel`: [gain, floor] of the sky's share. Seen from the climb at 30-50 degrees the gain
 *   adds almost nothing, so the floor is what shows the sky and the clouds in the water. Higher
 *   and the big cumulus over the lake turn it milky.
 * - `shore`, `shorePx`: the soft shoreline. The water thins to nothing over this many units of
 *   depth, or this many pixels' worth of it from afar, whichever is wider. (No pale wet line any
 *   more: on the drawn lake's gentle shelf it would have been a ring 7-14 px wide, an outline.)
 */
export const LAKE_WATER = Object.freeze({
    clarity: 0.50,
    shallow: Object.freeze([0.06, 0.36, 0.40]),
    deep: Object.freeze([0.02, 0.12, 0.26]),
    blend: Object.freeze([2, 12]),
    calm: 0.5,
    rippleFade: Object.freeze([300, 900]),
    swell: 0.5,
    swellScale: 0.0042,
    // (Floor 0.15 since 2026-11-21: over clear water the bright evening sky at 0.24 swamped the
    // water's own colour, and from the climb the lake read as a pale lilac sheet.)
    fresnel: Object.freeze([0.62, 0.15]),
    shore: 0.5,
    shorePx: 2.0,
});
/**
 * The sea turns blue sooner (2026-10-31, "can we improve the water in the ocean"): a gain on the
 * colour script's measured absorption. At 1 the visible sea sat in the ramp's pale upper plates
 * from every Act II station, a milky aqua; above 1 the same depths reach cerulean and cobalt.
 */
export const SEA_ABSORB_GAIN = 2.6;
/**
 * THE WATERS' OWN PIGMENTS (water pass, 2026-10-31, "do what you think will be most beautiful").
 * This is a cool northern island (a snowy horn, conifers, meadows): its sea is turquoise only in
 * the thin band over the sand and turns a deep teal-blue within a few metres, clear and cold, like
 * the Lofoten or Fiordland coasts; the colour script's ramp (Act I's, unchanged) leaned tropical,
 * a wide band of bright aqua that was the most saturated thing in every frame. The sea keeps the
 * script's turquoise for the sand and steps through teal to a blue-green deep. The tarn under the
 * horn is fed by its snow: the milky jade-turquoise of glacial flour, brighter and less saturated
 * than the sea and nearly opaque, so it reads as an alpine lake rather than a pool. Both keep the
 * script's four plates (`bands`) and every other water term in common. (Since then the tarn is
 * clear water, 2026-11-20, `TARN_MIRROR`, and so is the north lake, 2026-11-21, `LAKE_WATER`: the
 * sea is the one water left on a ramp.)
 */
export const SEA_RAMP = Object.freeze({
    // (2026-11-20: its own shore, clearer and less milky than the colour script's viridian, which
    // was brighter than the sand under it and turned the shallows to frosted glass.)
    shore: Object.freeze([0.26, 0.62, 0.60]),
    shelf: Object.freeze([0.10, 0.41, 0.50]),
    open: Object.freeze([0.05, 0.27, 0.40]),
    deep: Object.freeze([0.03, 0.15, 0.24]),
});
/**
 * THE SEA FROM ABOVE (2026-11-02, "the whole sea stops looking milky and flat"). The horizon
 * dissolve fades with how steeply the eye looks down at the water: the sines of the angles where
 * it starts to let go (~3 degrees) and where it is gone (~14 degrees). See the dissolve.
 */
export const SEA_HORIZON_DOWN = Object.freeze([0.015, 0.18]);
/**
 * THE SEA'S OWN AIR FROM ABOVE (2026-11-21 sea audit, item 1). Seen from the climb the open sea
 * read as a pale peach-lavender wash as bright as the sky: it took 1.6x the land's haze at the same
 * range, every downward ray took the palest horizon colour, and the ground mist lay over it too.
 * Where the sea is seen from above and not far (`seaAirOwn` 1), it takes the land's haze weight,
 * the dome's colour `up` (the elevation's sine) instead of the horizon's, and `mistAbove` of its
 * mist share, so it keeps a blue value of its own under the eye.
 * - `far`: range (u) over which the far band keeps the water's own convergence on the horizon;
 * - `graze`: sines below the horizon over which a grazing ray keeps the horizon's air;
 * - `sunSide`: the cosine toward the sun (flat) over which the warm forward air is kept;
 * - `eyeAbove`: the eye's height over the sea (u) over which the share comes in (shore orbs 0).
 */
export const SEA_AIR = Object.freeze({
    up: 0.5,
    far: Object.freeze([4500, 8500]),
    graze: Object.freeze([0.03, 0.12]),
    sunSide: Object.freeze([0.25, 0.85]),
    eyeAbove: Object.freeze([120, 300]),
    mistAbove: 0.15,
});
/**
 * A STEADY NEAR SEA (2026-11-21 sea audit, item 2). The body's tint followed the swell's height at
 * each instant across the whole stacked amplitude, so at the shore orbs every patch of the near sea
 * swung from deep blue to jade and back once a wave (~45 levels within a second), and the full swell
 * tilt swung the reflection's share and the land mirror across it. The wave speeds were right.
 * - `SEA_CREST_GLOW`: jade only on the crest tops (`top`, shares of the stacked amplitude), on the
 *   face turned to the eye (`face`, the slope toward it), with the sun behind it, at most `gain`;
 * - `SEA_TROUGH`: the troughs (`window`, shares below) take `tint`, a slight deepening;
 * - `SEA_SWELL_TILT`: the reflection rides `near` of the swell's tilt by the eye, all of it past
 *   `range` (u, 3-D, so the climb's sea is unchanged).
 */
export const SEA_CREST_GLOW = Object.freeze({
    top: Object.freeze([0.42, 0.82]),
    face: Object.freeze([0.03, 0.12]),
    gain: 0.30,
});
export const SEA_TROUGH = Object.freeze({
    window: Object.freeze([0.25, 0.85]),
    tint: Object.freeze([0.96, 0.975, 0.99]),
});
export const SEA_SWELL_TILT = Object.freeze({ near: 0.4, range: Object.freeze([60, 260]) });
/**
 * WHITECAPS WITH A LIFE (2026-11-21 sea audit, item 11). The caps were the swell's stacked height
 * at that instant cut in a narrow band: opaque paper-white blobs that switched on and off within a
 * tenth of a second as crests passed. A cap now has an AGE, worked out per pixel with no stored
 * state: the seconds since the long swell's crest last passed this water. It is born where the
 * three waves stood stacked at that moment (`birth`, shares of their summed amplitude, broken by
 * `gate` of a per-crest pattern and `gust` of the wind), flashes white for `flashT` s, then
 * thins as a sheet (`sheetT`, `sheetShare` of it) and a lace (`laceT`), coming in over `rise` s
 * and gone `tail` s before the next crest. Within `range` (u: whole, gone) of the eye. The lace
 * is the foam-lace tile, `tile` u across the wind and `streak` times that along it, drifting
 * `drift` u/s downwind and bent `bend` by the ripples; its threads `width` (tile shares: thin
 * young, wide when the cover is whole), its alpha `alpha` [lace, flash], its colour `colour`.
 */
export const SEA_CAPS = Object.freeze({
    birth: Object.freeze([0.80, 1.05]),
    gate: 0.45,
    gust: 0.10,
    flashT: 0.45,
    sheetT: 0.9,
    laceT: 3.0,
    sheetShare: 0.55,
    rise: 0.30,
    tail: 1.5,
    range: Object.freeze([260, 720]),
    tile: 9,
    streak: 1.8,
    drift: 0.3,
    bend: 0.18,
    width: Object.freeze([0.12, 0.85]),
    alpha: Object.freeze([0.38, 0.85]),
    colour: Object.freeze([0.90, 0.95, 0.98]),
});
/**
 * A REAL BEACH (2026-11-21 sea audit, item 9). The south beach read as an ochre-olive bank darker
 * than the water: the whole of it sat on the palette's damp sand pole, grass cross-faded down to
 * the waterline over 13 u of height, and the only wetting was a matte strip 1 u high.
 * - `SEA_BEACH`: the beach is pure sand from the water up to `top` (u over the sea, wandering by
 *   `topWobble` on a `topCell` noise and `topBreak` of the grain), its edge as soft as `topEdge`
 *   (u, widened by the pixel's height footprint); its dry sand `dry` (linear) with a broad `tone`
 *   swell (`toneCell` u), a finer grain (`tooth`), and eased `farKeep` back toward the palette's
 *   sand from afar so the coast gets no pale outline.
 * - `SEA_WET`: the sand the sea wets: up to `top` (u) wandering `wobble` on `cells`, its edge
 *   `edge` (u, by footprint), breathing `breathe` with the run-up; `dark` its albedo factor,
 *   `filmDark` under the thin film the backwash leaves, `toothKeep`; `absorb` the first units of
 *   water over it (rgb per u); `gloss` [damp, film] its sky sheen floor, `glare` [core, skirt] the
 *   sun's lobe on it (High).
 */
export const SEA_BEACH = Object.freeze({
    dry: Object.freeze([0.93, 0.83, 0.60]),
    tone: 0.10,
    toneCell: 70,
    top: 5.0,
    topWobble: 1.4,
    topCell: 55,
    topBreak: 0.7,
    topEdge: Object.freeze([0.25, 2.5]),
    tooth: 0.05,
    farKeep: 0.4,
});
export const SEA_WET = Object.freeze({
    top: 1.6,
    wobble: 0.7,
    cells: Object.freeze([7.5, 23]),
    edge: Object.freeze([0.16, 0.6]),
    breathe: 0.12,
    // (Warm: wet sand is darker AND more saturated; a neutral factor read as grey concrete.)
    dark: Object.freeze([0.62, 0.52, 0.42]),
    filmDark: 0.85,
    toothKeep: 0.3,
    absorb: Object.freeze([0.50, 0.14, 0.09]),
    gloss: Object.freeze([0.05, 0.24]),
    glare: Object.freeze([0.55, 0.06]),
});
/**
 * THE SUN ROAD FROM FACET STATISTICS (2026-11-21 sea audit, item 18). Facing the sun the sea had no
 * glitter path: a milky veil (a lobe on a mirror ray whose far normal had been faded flat) and a
 * few opaque white dabs (a hairline core lighting whole swell faces). The road is now the sun seen
 * in a sea of facets whose slopes spread by `floorVar` (the unresolved chop, calm to gust) plus
 * `waveVar` (the swell's own, handed back where the distance fade drops it from the normal), so
 * the band reaches the horizon, narrow there and wider near the eye, HDR (`gain`, eased by
 * `knee`) and coloured by the sun; near the eye, where one facet spans pixels, a broad sheen
 * (`sheenVar`, `sheenShare`) instead of white dabs (`glintFoot`: u a pixel, the near-to-far hand-over).
 */
export const SEA_SUN_GLITTER = Object.freeze({
    waveVar: 0.0142,
    floorVar: Object.freeze([0.0028, 0.0060]),
    sheenVar: 0.006,
    gain: 0.55,
    knee: 0.05,
    vyFloor: 0.045,
    hyFloor: 0.35,
    sheenShare: 0.2,
    glintFoot: Object.freeze([0.75, 2.0]),
});

/**
 * The road's light (SEA_SUN_GLITTER) for a view `V` (surface -> eye), a sun `L` (surface -> sun),
 * the surface's mean slope `slope` [sx, sz] and the slope variance `s2` per axis: `odds`, the
 * share of facets turned to send the sun to the eye, and `band` (before the gain), knee'd.
 */
export function seaSunRoad({
    V, L, slope = [0, 0], s2,
}) {
    const G = SEA_SUN_GLITTER;
    const h = [V[0] + L[0], V[1] + L[1], V[2] + L[2]];
    const hl = Math.hypot(...h) || 1;
    const H = h.map((v) => v / hl);
    const hy = Math.max(H[1], 0.08);
    const mx = (-H[0] / hy) - slope[0];
    const mz = (-H[2] / hy) - slope[1];
    const m2 = (mx * mx) + (mz * mz);
    const odds = Math.exp(m2 / (-2 * s2));
    const vh = Math.max((V[0] * H[0]) + (V[1] * H[1]) + (V[2] * H[2]), 0);
    const fres = 0.02 + (0.98 * ((1 - vh) ** 5));
    const light = fres / (4 * Math.max(V[1], G.vyFloor) * (Math.max(hy, G.hyFloor) ** 4) * 2 * Math.PI);
    const raw = (odds / s2) * light;
    return { odds, band: raw / (1 + (G.knee * raw)) };
}

/**
 * THE SURF (2026-11-21 sea audit, item 16). The sea stopped at the sand as a lake does: a 1-2 px
 * pencil rim and hairline rings offshore, every shore term a band of DEPTH on a bed that drops
 * 0.35-0.87 per unit, so 10 m of water was 12-16 u of sea and a pixel. The surf is measured in
 * HORIZONTAL units now and clocked by the long swell already aimed at the beach: its crests
 * whiten as they shoal, break where the water is `breakDepth` m deep (`breakX` u out at most and
 * least), and run in as bores at `boreSpeed` u/s (shore-parallel inside the break), each a
 * tapered, segmented `lip` (a share of its cycle) leaving a lace band (`trail` cycle, its holes
 * opening `lace` as it ages) that `feather`s in from the crest; within `reach` u of the shore,
 * up close (the far surf line takes over by footprint), strongest at the points (`exposure` the
 * least share in a bay), at `gain`.
 */
export const SEA_SURF_BREAK = Object.freeze({
    boreSpeed: 2.6,
    breakDepth: 4.5,
    breakX: Object.freeze([10, 36]),
    slopeMin: 0.03,
    lip: 0.075,
    trail: Object.freeze([0.08, 0.42]),
    lace: Object.freeze([0.28, 0.70]),
    feather: 8,
    reach: 44,
    exposure: 0.55,
    gain: 1.15,
});
/**
 * THE SURF LINE FROM AFAR (2026-11-02): the soft white line on the waterline once a pixel spans
 * more depth than the swash front. Its width in pixels (calm, at the top of a run-up), how much of
 * it a broken stretch keeps, the scale of the drifting field that breaks it (per unit), and its
 * strength. `thinPx`, `thinKeep`: where one pixel spans more than the whole surf zone (metres of
 * depth a pixel, from-to) the foam is only part of that pixel, so the line thins to `thinKeep`.
 */
export const SEA_SURF = Object.freeze({
    widthPx: Object.freeze([2.4, 3.6]),
    broken: 0.45,
    breakScale: 0.0045,
    gain: 0.70,
    thinPx: Object.freeze([2.0, 8.0]),
    thinKeep: 0.4,
});
/**
 * THE WINDROWS (2026-11-20; rebuilt 2026-11-21, sea audit item 12): long foam streaks parallel to
 * the wind. They read as scratches on glass: round noise cut them into 4-9 u dashes, they wandered
 * off the wind and hooked, a hard stroke, and their dash mask scrolled across them so they blinked.
 * Now each row is a cell of its own every `spacing` u across the wind, jittered `jitter` of it, its
 * course wandering by two sines along the wind only (`wander` u at `wanderK` rad/u), so a row can
 * never fold or meet a neighbour; it rides the swell's orbit sideways (`ride`), is lit in long
 * stretches by a break field stretched along it (`alongScale`, `lit`), drifts downwind `drift`
 * u/s and re-forms (`evolve`). Half-width `halfWidth` u by its strength, its edge `soft`; kept
 * off the near water (`near`, u) and gone where its cells fall under `footprint` (rows a pixel).
 */
export const SEA_WINDROWS = Object.freeze({
    spacing: 23,
    jitter: 0.36,
    wander: Object.freeze([2.2, 1.0]),
    wanderK: Object.freeze([0.019, 0.043]),
    ride: 4.0,
    alongScale: 0.0012,
    drift: 0.4,
    evolve: 0.0009,
    lit: Object.freeze([0.40, 0.66]),
    halfWidth: Object.freeze([0.10, 0.30]),
    soft: 0.3,
    near: Object.freeze([45, 120]),
    footprint: Object.freeze([0.05, 0.10]),
    gain: 0.16,
});
/** The sea film's opacity over the water's depth: clear at the first, whole at the second (u). */
export const SEA_FILM = Object.freeze([-0.45, 2.0]);
/**
 * THE SHORE'S DEPTH FIGHT (2026-11-03, Olov: "the big shore on the back of the island, it flickers
 * against the water"). The camera's depth buffer (near 0.1, far 9000, not reversed) steps by about
 * 2^-24 near 1, which is `2^-24 * z^2 / near` world units along a ray at range z: 2.4 u at 2 km.
 * Where a film of water lies over a gently shelving bed, the last fraction of a metre of water is
 * inside that step, so the depth test between the film and the sand cannot decide, and the winner
 * changes with every sub-pixel move of the camera. From the climb (the north beach at 1.7-2.1 km,
 * 15-25 degrees down, a 2-degree beach) that was a band ~20 u wide right on the waterline, where
 * the film is part-opaque and the surf line is drawn.
 *
 * The fix: the waters' films are drawn this many depth steps nearer the eye (a pipeline depth bias,
 * `polygonOffsetUnits`: in the depth buffer's own steps, so it grows with range exactly as the
 * precision falls). In the undecided band the water now always wins, and what shows there is its
 * own opacity, which reads the real depth over the seabed (the plates). The undecided line moves
 * onto the dry sand, `bias` steps above the water, where the film is clear and no foam is drawn.
 * The look of the shallows, the surf line and the beach is unchanged. Near the eye the bias is
 * tiny: 0.16 u along the ray at 300 u, 0.05 u of height looking 20 degrees down.
 */
export const WATER_SHORE_DEPTH_BIAS = 3;
/** The depth buffer's step near 1 (24-bit unorm, or 32-bit float in [0.5, 1)). */
export const DEPTH_STEP = 2 ** -24;

// ── CPU twins ─────────────────────────────────────────────────────────────────────────────────

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
/** WGSL's smoothstep (reversed edges allowed). */
export function smoothstepGpu(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - (2 * t));
}
const fract = (x) => x - Math.floor(x);
const mix3 = (a, b, t) => [0, 1, 2].map((i) => a[i] + ((b[i] - a[i]) * t));

/**
 * The pigment ramp at driver `t` in its flat plates (`waterRampBody`): `bands` plates with an
 * anti-aliased riser, walked shore -> shelf -> open -> deep.
 * @param {number} t 0..1
 * @param {{shore:number[], shelf:number[], open:number[], deep:number[]}} ramp
 * @returns {number[]} rgb
 */
export function waterRampColour(t, ramp, bands = ODYSSEY_WATER_RAMP.bands) {
    const cell = t * bands;
    const seg = ((Math.floor(cell) + smoothstepGpu(0.45, 0.55, fract(cell))) / bands) * 3;
    return mix3(
        mix3(mix3(ramp.shore, ramp.shelf, clamp01(seg)), ramp.open, clamp01(seg - 1)),
        ramp.deep,
        clamp01(seg - 2),
    );
}

/**
 * The swash's run-up at phase `f` (0..1 of its cycle), as a share of its reach: up over the first
 * third, back down over the rest (the water's shoreline vertices and the foam front ride it).
 */
export function swashRise01(f) {
    return smoothstepGpu(0, 0.32, f) * (1 - smoothstepGpu(0.32, 1, f));
}
/**
 * The wet line the run-up leaves (SEA_WET, 2026-11-21): it rises with the water and recedes about
 * three times slower, so the sand stays dark and glossy after the backwash; at the cycle's wrap it
 * is back at the base with the water (no step).
 */
export function swashMemory01(f) {
    return smoothstepGpu(0, 0.32, f) * Math.sqrt(Math.sqrt(clamp01(1 - smoothstepGpu(0.32, 1, f))));
}

/**
 * A whitecap's life at `age` seconds after its crest (SEA_CAPS): in over `rise`, a sheet and a lace
 * thinning, gone before the next crest (`period`, the long swell's, s).
 */
export function seaCapLife(age, period) {
    const C = SEA_CAPS;
    const rise = smoothstepGpu(0, C.rise, age);
    const tail = 1 - smoothstepGpu(period - C.tail, period, age);
    return ((Math.exp(-age / C.sheetT) * C.sheetShare) + (Math.exp(-age / C.laceT) * (1 - C.sheetShare)))
        * rise * tail;
}

/** How much of the lake's bed shows through `depth` units of its water (its clear-water film). */
export function lakeClearAt(depth) {
    return Math.exp(-Math.max(depth, 0) * LAKE_WATER.clarity);
}

/**
 * The sea's own-air share (SEA_AIR): 1 where the sea is seen from above and near, away from the
 * sun; 0 at the horizon, in the far band, toward the sun, from a shore eye and while the Earth is
 * there. `downSine` is the sine of the ray's angle below the horizon, `toSun` the cosine of its
 * flat bearing to the sun's, `eyeAbove` the eye's height over the sea.
 */
export function seaAirOwn(range, downSine, toSun, eyeAbove, earth = 0) {
    const keep = Math.max(
        smoothstepGpu(SEA_AIR.far[0], SEA_AIR.far[1], range),
        1 - smoothstepGpu(SEA_AIR.graze[0], SEA_AIR.graze[1], downSine),
        smoothstepGpu(SEA_AIR.sunSide[0], SEA_AIR.sunSide[1], toSun),
    );
    return (1 - keep) * smoothstepGpu(SEA_AIR.eyeAbove[0], SEA_AIR.eyeAbove[1], eyeAbove) * (1 - earth);
}

/** The sea's body colour over `depth` units of water. */
export function seaBodyAt(depth) {
    const k = ODYSSEY_WATER_RAMP.absorptionPerMetre * SEA_ABSORB_GAIN;
    return waterRampColour(clamp01(1 - (2 ** (-depth * k))), SEA_RAMP);
}

/**
 * How much of the horizon dissolve a sea fragment keeps, by the sine of how steeply the eye looks
 * down at it (`viewDir.y`): 1 looking along the water, 0 looking down on it.
 */
export function seaHorizonKeep(downSine) {
    return 1 - smoothstepGpu(SEA_HORIZON_DOWN[0], SEA_HORIZON_DOWN[1], downSine);
}

/**
 * The surf line from afar (`buildShoreFoam`): its weight at a fragment over `depth` units of
 * water, where one pixel spans `depthPx` of depth, at swash `pulse` (0..1) and break-up noise
 * `breakN` (0..1). Before SEA_SURF.gain.
 */
export function seaSurfLine(depth, depthPx, pulse = 0, breakN = 1) {
    const px = Math.max(depthPx, 1e-3);
    const u = depth / px;
    const width = SEA_SURF.widthPx[0] + ((SEA_SURF.widthPx[1] - SEA_SURF.widthPx[0]) * pulse);
    return smoothstepGpu(-1.0, 0.4, u)
        * (1 - smoothstepGpu(1.0, width, u))
        * (SEA_SURF.broken + ((1 - SEA_SURF.broken) * smoothstepGpu(0.30, 0.62, breakN)))
        * smoothstepGpu(0.3, 1.2, px)
        * (1 - (smoothstepGpu(SEA_SURF.thinPx[0], SEA_SURF.thinPx[1], px) * (1 - SEA_SURF.thinKeep)));
}

/** The sea film's opacity over `depth` units of water (`opacityNode` before the foam). */
export function seaFilmOpacity(depth) {
    return smoothstepGpu(SEA_FILM[0], SEA_FILM[1], depth);
}

/** World units along a view ray that one depth-buffer step spans at range `range`. */
export function depthStepAlongRay(range, near) {
    return (DEPTH_STEP * range * range) / near;
}

/**
 * The heights above the water (u, on the dry side) between which the depth test cannot decide
 * between a water film drawn `units` steps nearer and the land under it, for an eye looking down
 * at sine `downSine`: [low, high]. With no bias the band straddles the waterline (low < 0).
 */
export function shoreFightBand(range, downSine, near, units = WATER_SHORE_DEPTH_BIAS) {
    const step = depthStepAlongRay(range, near) * downSine;
    return [(units - 1) * step, (units + 1) * step];
}

/** The width (units of depth) of the lake's soft shore where one pixel spans `depthPx`. */
export function lakeShoreWidth(depthPx) {
    return Math.max(LAKE_WATER.shore, depthPx * LAKE_WATER.shorePx);
}

/** The lake film's opacity over `depth` units of water. */
export function lakeShoreOpacity(depth, depthPx) {
    return smoothstepGpu(0, lakeShoreWidth(depthPx), depth);
}
