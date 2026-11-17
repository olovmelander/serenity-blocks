/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE STEAM QUENCH — the Chapter 1 -> Act II occlusion moment.
 *
 * The plan asks for the two surviving act edges to become OCCLUSION moments rather than alpha
 * crossfades: "fog as a traversable object, not a post effect". This is the ch1->ch2 one, and
 * the journey already argues for it in two independent places. The chapter profile authors the
 * transition as `stinger: 'steam-quench'` with a deliberately widened seam so "the ember->steam
 * veils and the orange->cyan transformation play across multiple frames instead of popping".
 * And the geometry agrees: Earth Core is a molten cavern, while the rail enters Act II at
 * y~128 against a sea level of 287 — the traveller plunges from fire into deep water. Steam is
 * what that collision produces, so the occluder is diegetic rather than a wipe.
 *
 * WHY A BACKSIDE SPHERE. An occlusion moment has to actually OCCLUDE — that is the whole
 * difference from the crossfade it replaces. A camera-facing billboard cannot, because you can
 * always see past its edges; a volume you are INSIDE can. The camera flies through this sphere,
 * and while it is inside, the shell covers the frame completely at peak density. Outside it,
 * the same shell reads as a distant billowing bank you are approaching.
 *
 * Cheap on purpose: one draw, one material, no depth texture, no post pass. The softening that
 * would normally need a depth prepass is bought instead with a wide radial feather plus the
 * fact that peak density happens while the camera is inside, where there is no silhouette to
 * harden against.
 *
 * WHAT IT PAINTS (masterpiece pass, 2026-11-17). Not a fog that turns from gold through white to
 * grey: a place. The steam is a column the eye climbs inside, lit from below by the lava (heat on
 * one fire ramp: near-black wine in the gaps, deep red, gold, pale gold on the billows' heads,
 * never a dimmed gold); straight ahead, where the camera looks, is THE SEA'S EYE — black-blue
 * water that opens as the eye climbs to the vent's lip (steamQuenchEyeRadius) — and past the
 * boundary the shell is the abyss's own darkness, lifting evenly toward the ocean's blue
 * (steamQuenchAbyssVeil). What stands in front of it (the black smokers on the vent's rim, their
 * smoke, the gas racing up) is the chapter's: chapter-environments/earth-core-sea-vent.js.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cameraFar,
    cameraNear,
    cameraPosition,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    floor,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    oneMinus,
    positionLocal,
    positionWorld,
    select,
    smoothstep,
    sqrt,
    step,
    uniform,
    vec2,
    vec3,
    vec4,
    viewZToPerspectiveDepth,
} from 'three/tsl';
import { fbm3, noise2, noise3 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { ONE_WORLD_ACT_MARGIN } from '../world/odyssey-world-act-gate.js';

/** World radius of the steam volume. Wide enough to envelop the corridor at the boundary. */
export const STEAM_QUENCH_RADIUS = 110;

/**
 * APPROACH half-width of the occlusion window, in progress units. Deliberately 2x the
 * authored transition seamWidth (0.03): the steam exists to HIDE the content handoff, and an
 * occluder narrower than the thing it occludes just frames it. (The ch5->ch6 cloud bank
 * shares this number for BOTH its halves.) Owned here, beside the volume it windows, so the
 * board and the seam-12-dive playground drive the same quench by construction — they
 * disagreed by 0.03 of exit window until 2026-08-13.
 */
export const STEAM_QUENCH_HALF_WIDTH = 0.06;
/**
 * THE CH1 APPROACH — rescaled 2026-10-01, and the reason the middle of Earth Core was cream.
 *
 * STEAM_QUENCH_HALF_WIDTH above was authored as "106 u" when the journey was 1767 u long and
 * chapter 1 spanned p 0 -> 0.093. The layout has since grown to ~2533 u and chapter 1 now
 * spans p 0 -> 0.0649, so the same 0.06 opened the veil at chapter-local 0.075: measured in
 * capture, the cathedral was 21 % veiled at local 0.3 and 50 % at 0.5 — the "beige noise
 * ceiling" the player looked at for most of the chapter. (The cloud bank at 5->6, inside a
 * chapter four times longer, keeps 0.06.)
 *
 * 0.034 opens the veil at chapter-local ~0.48 — the cathedral's first half is clear — while
 * the approach curve below still has the volume ~0.9 dense at boundary - ONE_WORLD_ACT_MARGIN,
 * the moment the continuous world starts drawing behind it (ADR-0017: occlusion, never
 * crossfade). Must stay wider than chapter 1's seamWidth (pinned by the quench test).
 */
export const STEAM_QUENCH_APPROACH_HALF_WIDTH = 0.034;
/**
 * ...but the EXIT half-width cannot be that same number, and this is where the long-standing
 * "cloud deck renders underwater" ghost lived. The geometry: ±0.06 of progress is ±106 u
 * against a 110 u BackSide sphere — the eye never leaves the shell on the way out, so the
 * veil was a full-screen wash over the first half of chapter 2, still ~18% opaque at
 * p=0.130. The exit only has to outlast the CO-PRESENCE window, which is chapter 1's
 * authored `transition.seamWidth` = 0.03. NOTE this is not the plan's §7.2 decision
 * (plateau vs three beats) — that reshapes the curve AT the crossing and is the owner's;
 * this only stops the tail veiling half an act after the crossing is over.
 */
// Scaled 0.03 -> 0.0222 with every other seam (chapter-profile.js: x0.7384 when the ascent
// lengthened the curve); it still covers the co-presence window, which is that same 0.0222.
export const STEAM_QUENCH_EXIT_HALF_WIDTH = 0.0222;

/**
 * Where the approach curve must be dense: the fraction of the approach half at which the
 * world's act gate opens. Density there is ~0.93 (smoothstep at 1/1.2 of its span).
 */
const APPROACH_GATE_FRACTION = Math.max(0.05, 1 - (ONE_WORLD_ACT_MARGIN / STEAM_QUENCH_APPROACH_HALF_WIDTH));

/**
 * Journey progress -> the quench's seamT, BOUNDARY-TRUE: 0 at the approach edge, exactly 0.5
 * at the 1->2 boundary, 1 at the exit edge.
 *
 * The board used to map progress LINEARLY across the asymmetric window, while update() assumes
 * the boundary sits at 0.5 — with the old 0.06/0.03 widths that put peak density and the
 * warm->cool flip 0.015 of progress BEFORE the crossing the volume exists to hide. Piecewise
 * keeps the colour flip on the handoff whatever the two half-widths are.
 * @param {number} progress camera progress
 * @param {number} boundary the 1->2 chapter boundary
 * @returns {number}
 */
export function steamQuenchSeamT(progress, boundary) {
    if (!Number.isFinite(progress) || !Number.isFinite(boundary)) return 0;
    if (progress <= boundary) {
        const lo = boundary - STEAM_QUENCH_APPROACH_HALF_WIDTH;
        return 0.5 * Math.max(0, Math.min(1, (progress - lo) / STEAM_QUENCH_APPROACH_HALF_WIDTH));
    }
    return 0.5 + (0.5 * Math.max(0, Math.min(1, (progress - boundary) / STEAM_QUENCH_EXIT_HALF_WIDTH)));
}

/**
 * Density as a pure function of seamT, so the curve is testable without a renderer.
 * Approach: a smoothstep that stays clear through the cathedral and closes fast — ~0.93 dense
 * where the world's act gate opens. Exit: the old squared triangle, leaving the weather quickly.
 * @param {number} seamT 0..1, 0.5 at the boundary
 * @returns {number} 0..1
 */
export function steamQuenchDensity(seamT) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    if (t <= 0.5) {
        const x = Math.min(1, (t * 2) / (APPROACH_GATE_FRACTION * 1.2));
        return x * x * (3 - (2 * x));
    }
    const tri = 1 - ((t * 2) - 1);
    return tri * tri;
}

/**
 * THE FOG ON THE ROCK STAYS DIM (seamless pass, 2026-10-02; re-read for the masterpiece pass).
 *
 * The steam occludes NEAR rock through scene fog (STEAM_QUENCH_FOG_DENSITY below), and the fog's
 * colour is the frame's dark: the throat's rock, a few tens of units from the eye, dissolves into
 * it, and the lit vapour beyond (the shell) stands against that dark. So its luminance is capped
 * (hue kept: the whole colour scales), low while the vapour closes over the cavern and a little
 * higher toward the water — the old vapour's whole brightness script, which the shell no longer
 * needs (it is shaded as heat on a fire ramp now, its light and its dark authored outright) but
 * the fog still does: a bright fog over the throat's rock is the tan veil of every earlier pass.
 * Linear, pre-tonemap.
 */
export const STEAM_QUENCH_LUMA_CAP = 0.074;
export const STEAM_QUENCH_DARK_FRACTION = 0.30;
export const STEAM_QUENCH_RAMP_START = 0.08;
export const STEAM_QUENCH_RAMP_END = 0.65;

/**
 * The fog's luminance cap at a seamT (linear, pre-tonemap): cavern-dark while the volume closes,
 * then an even climb (half linear, half smoothstep — the corners are soft and the steepest slope
 * is only 1.25x the mean), then held.
 * @param {number} seamT 0..1 (0.5 at the boundary)
 * @returns {number}
 */
export function steamQuenchLumaCap(seamT) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    const u = Math.max(0, Math.min(1, (t - STEAM_QUENCH_RAMP_START)
        / (STEAM_QUENCH_RAMP_END - STEAM_QUENCH_RAMP_START)));
    const k = (0.5 * u) + (0.5 * u * u * (3 - (2 * u)));
    return STEAM_QUENCH_LUMA_CAP * (STEAM_QUENCH_DARK_FRACTION + ((1 - STEAM_QUENCH_DARK_FRACTION) * k));
}

/**
 * THE STEAM OCCLUDES NEAR ROCK THROUGH SCENE FOG — at no extra draw cost (seamless pass).
 * The shell is depth-tested with no depth write, so the rock between the eye and the shell stayed
 * crisp in front of the vapour. The board drives scene fog toward the fog colour below by
 * `steamQuenchDensity`, so nearby geometry dissolves at the same rate the shell thickens: at peak,
 * ~75 % at 30 u. The shell itself opts out of fog (its own ramp must not be fogged).
 */
export const STEAM_QUENCH_FOG_DENSITY = 0.042;

// The turn of the vapour's hue from the fire's to the sea's, as the warmth (1 - seamT) at which it
// starts and finishes: narrow and late, at the boundary (the cavern's sparks stay embers until then).
const STEAM_WARM_HUE_LO = 0.475;
const STEAM_WARM_HUE_HI = 0.53;
const warmHueOf = (w) => {
    const x = Math.max(0, Math.min(1, (w - STEAM_WARM_HUE_LO) / (STEAM_WARM_HUE_HI - STEAM_WARM_HUE_LO)));
    return x * x * (3 - (2 * x));
};

/**
 * How much of the vapour's hue is still the fire's at a seamT (1 the fire's .. 0 the sea's): the
 * cavern's sparks stay embers until the eye is at the vent's lip.
 * @param {number} seamT 0..1 (0.5 at the boundary)
 * @returns {number}
 */
export function steamQuenchWarmHue(seamT) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    return warmHueOf(1 - t);
}

/**
 * The colour near rock dissolves into at a seamT: the ember-dark of the vapour's shade while the
 * fire is below (a deep red-orange, on the steam's own fire ramp: the old mean of gold and shadow
 * was an olive that showed on every half-fogged boulder), the abyss's blue-black once the eye is
 * at the sea — with the luminance cap. The board feeds it to scene fog.
 * @param {number} seamT 0..1 (0.5 at the boundary)
 * @param {THREE.Color} out
 * @returns {THREE.Color} `out`
 */
export function steamQuenchFogColour(seamT, out) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    steamQuenchMeanColour(t, out);
    const lum = (0.2126 * out.r) + (0.7152 * out.g) + (0.0722 * out.b);
    const cap = steamQuenchLumaCap(t);
    if (lum > cap) out.multiplyScalar(cap / lum);
    return out;
}

/**
 * The fog colour's hue and weight BEFORE the luminance cap: ember below, the sea's dark above,
 * turning as the eye nears the vent's lip.
 * @param {number} seamT 0..1 (0.5 at the boundary)
 * @param {THREE.Color} out
 * @returns {THREE.Color} `out`
 */
export function steamQuenchMeanColour(seamT, out) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    const k = Math.max(0, Math.min(1, (t - 0.42) / 0.14));
    const sea = k * k * (3 - (2 * k));
    return out.setRGB(
        0.55 + ((0.020 - 0.55) * sea),
        0.13 + ((0.055 - 0.13) * sea),
        0.016 + ((0.105 - 0.016) * sea),
    );
}

/**
 * THE OCEAN'S LIFE IS BEHIND THE STEAM (2026-10-25). Olov: "everything in the chapter 2 needs to
 * be rendered a little earlier, hidden by the smoke and steam! We have a little pop when we get
 * out from the steam right now! Everything needs to be there visible when getting out from the
 * steam."
 *
 * The sea's life (fish, kelp, spires, the visiting animals) used to come in only as the steam
 * thinned, faded up from the WATER's colour: dark shapes against the pale vapour, so the first
 * kelp crown and the whale shark's silhouette appeared through the steam. It is now present from
 * just past the boundary, behind the steam: the eye is inside the steam's sphere for its whole
 * window, and the shell covers what lies beyond it with its own billows, so while the window is
 * open the life writes its depth just past the shell along its view ray (ordered among itself by
 * its own distance; `behindSteamDepth`). The shell then covers it exactly as it covers the water,
 * and lets it through exactly as fast as it clears: when it has, everything is there. (Painting
 * it in the vapour's mean colour instead left flat silhouettes over the billows.) The light
 * shafts write no depth, so the shell already covers them. One state for every material that
 * reads it; the board writes it each frame (setSteamVeil).
 */
const VEIL = {
    on: uniform(0),
    centre: uniform(new THREE.Vector3()),
    radius: uniform(STEAM_QUENCH_RADIUS),
};
let veilWeight = 0;

/**
 * The steam's state for the life behind it: `weight` (how thick it is, 0..1; 0 outside its
 * window), and the sphere the eye is inside while it is up.
 * @param {number} weight 0..1
 * @param {{x:number,y:number,z:number}} [centre]
 * @param {number} [radius]
 */
export function setSteamVeil(weight, centre, radius = STEAM_QUENCH_RADIUS) {
    veilWeight = Math.min(Math.max(Number.isFinite(weight) ? weight : 0, 0), 1);
    VEIL.on.value = veilWeight > 0 && centre ? 1 : 0;
    if (centre) VEIL.centre.value.set(centre.x, centre.y, centre.z);
    VEIL.radius.value = radius;
}

/** How thick the steam is now (CPU): an animal under a thick veil can arrive unseen. */
export function steamVeilWeight() {
    return veilWeight;
}

/**
 * The depth (standard perspective, 0..1) a surface at world position `wp` writes so that, while
 * the steam is up and the eye inside it, it lies just past the steam's shell; its own otherwise.
 * For `material.depthNode`.
 */
export function behindSteamDepth(wp) {
    const to = wp.sub(cameraPosition);
    const d = length(to);
    const dir = to.div(max(d, float(1e-4)));
    const oc = cameraPosition.sub(VEIL.centre);
    const b = dot(dir, oc);
    const c = dot(oc, oc).sub(VEIL.radius.mul(VEIL.radius));
    // Where the ray leaves the sphere (the eye is inside it: c < 0).
    const shell = b.negate().add(sqrt(max(b.mul(b).sub(c), float(0))));
    const pushed = max(d, shell.add(1).add(d.mul(0.01)));
    const dist = select(VEIL.on.greaterThan(0.5).and(c.lessThan(0)), pushed, d);
    const viewZ = cameraViewMatrix.mul(vec4(cameraPosition.add(dir.mul(dist)), 1)).z;
    return viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar);
}

/**
 * THE STEAM IS LIT BY THE LAKE (masterpiece pass, 2026-11-17). The vapour's light is the lava's,
 * and the lava is on the chapter's clock (earth-core-clock.js): the lake's mood lifts and banks
 * it, a fountain far below throws more of it up the shaft, and a pulse of the vent pushes the
 * vapour up into the sea's eye. One state for the shell's shader; the chapter writes it each
 * frame (as setSteamVeil is written by the board).
 */
const LIGHT = {
    gain: uniform(1),
    surge: uniform(0),
};

/**
 * @param {number} gain how much of the lava's light the vapour holds (1 = as authored)
 * @param {number} [surge] 0..1: a pulse of the vent pushing the vapour up into the sea's eye
 */
export function setSteamQuenchLight(gain, surge = 0) {
    LIGHT.gain.value = Math.min(1.6, Math.max(0.4, Number.isFinite(gain) ? gain : 1));
    LIGHT.surge.value = Math.min(1, Math.max(0, Number.isFinite(surge) ? surge : 0));
}

/** The light the shell is drawn with now (CPU): for instruments and tests. */
export function steamQuenchLight() {
    return { gain: LIGHT.gain.value, surge: LIGHT.surge.value };
}

/** Vertical gap between the vapour decks the eye climbs through (world units). */
export const STEAM_DECK_SPACING = 10;
/** How many decks are drawn above the eye at once (the nearest fades out as it reaches the lens). */
export const STEAM_DECK_COUNT = 3;
/**
 * Decks per quality tier (`pickByQualityTier`). Each deck is six value-noise lookups per pixel of
 * a full-screen shell: the three cost ~0.65 ms at 2560x1440 on the RTX (bench 2026-11-01). Medium
 * (the iGPU lane) keeps two; Low draws the vapour without them.
 */
export const STEAM_DECKS_BY_TIER = Object.freeze({ high: 3, medium: 2, low: 0 });
/** The decks rise on their own (u/s), so a parked eye still sees vapour streaming up past it. */
export const STEAM_DECK_RISE = 0.9;
// The lava's key in the decks' plane: the light reaches them from below and a little from one
// side, so every billow has a lit flank and a lee (world xz, unit length).
const DECK_KEY = [0.6, -0.8];

/**
 * WHERE THE STEAM MEETS THE SEA (masterpiece pass, 2026-11-17): the vent's lip, this far below the
 * shell's centre (the shell sits on the rail at the 1->2 boundary, y ~128; the shaft's lip is at
 * y ~102-106, the world's seabed over the shaft, and the eye is at ~108 as it crosses the boundary). Below it the throat is full of steam; above it
 * is water. No deck of vapour stands above it, and the eye passes it at the boundary.
 */
export const STEAM_QUENCH_INTERFACE_DROP = 20;

/**
 * THE EYE OF THE SEA (masterpiece pass, 2026-11-17).
 *
 * The steam used to be the whole frame from p 0.045 to past the boundary: a luminous fog, then a
 * white turn, then grey murk — a fade through fog, with nothing in it showing lava MEETING the
 * sea. Now the steam is a column the eye climbs inside, lit gold from the lava below, and at its
 * top is the sea: a dark eye of black-blue water straight ahead (the camera looks up the shaft),
 * ragged with billows, that opens as the eye climbs toward it — a little at orb 5's station, most
 * of the frame at the vent's lip, everything just past it. Fire stays below and behind; the sea
 * comes from ahead. The turn is a place in the picture, not a moment of grey.
 *
 * This is the eye's radius as the sine of its half-angle from the zenith (the measure the shader
 * compares `length(viewDir.xz)` with): negative while it is shut, past 1 once it is the whole sky.
 * @param {number} seamT 0..1 (0.5 at the boundary)
 * @returns {number}
 */
export function steamQuenchEyeRadius(seamT) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    const s = (x) => {
        const u = Math.max(0, Math.min(1, x));
        return u * u * (3 - (2 * u));
    };
    // Shut until the vapour has closed; ~16 deg at orb 5's station (seamT 0.37); ~40 deg at the
    // boundary; past the frame's corners (46 deg) just after it.
    return -0.2
        + (0.476 * s((t - 0.23) / 0.14))
        + (0.367 * s((t - 0.38) / 0.12))
        + (0.9 * s((t - 0.48) / 0.14));
}

/**
 * THE ABYSS LIFTS EVENLY. Past the boundary the volume is no longer vapour but the darkness of
 * the water at the vent (lit only by the lava below), and it lifts as the eye climbs out of the
 * vent's smoke toward the ocean's own blue. Its opacity falls near-linearly from the boundary to
 * the window's end (half linear, half smoothstep: soft at both ends), so the frame's brightness
 * climbs at an even rate — the 1->2 seam gate measures luma per 0.01 p, and the old squared
 * triangle spent most of the lift in the first third of the exit.
 * @param {number} seamT 0..1 (0.5 at the boundary)
 * @returns {number} 0..1 (1 at and before the boundary)
 */
export function steamQuenchAbyssVeil(seamT) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    const u = Math.max(0, Math.min(1, (t - 0.5) * 2));
    return 1 - ((0.5 * u) + (0.5 * u * u * (3 - (2 * u))));
}

/**
 * The colour of the vapour NEAR the eye (the chapter's haze puffs wear it while the steam is up):
 * lit gold while the fire is below, sinking to the abyss's blue-black once the eye is in the water.
 * @param {number} seamT 0..1 (0.5 at the boundary)
 * @param {THREE.Color} out
 * @returns {THREE.Color} `out`
 */
export function steamQuenchNearVapourColour(seamT, out) {
    const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
    const k = Math.max(0, Math.min(1, (t - 0.42) / 0.14));
    const e = k * k * (3 - (2 * k));
    return out.setRGB(
        0.62 + ((0.012 - 0.62) * e),
        0.27 + ((0.03 - 0.27) * e),
        0.07 + ((0.05 - 0.07) * e),
    );
}

/**
 * THE STEAM'S FIRE RAMP (scene-linear, before the board's tone curve): the colour of vapour by how
 * much of the lava's light it holds, 0..1. The whole volume is shaded as that one scalar and
 * coloured here once, so every half-tone is on the ramp: a dim reach of vapour is deep red, never
 * a dimmed gold (which is tan — the mud of every earlier pass was gold light scaled down, or gold
 * blended half over dark). Near-black wine, deep red, orange-red, gold, pale gold.
 */
export const STEAM_FIRE_RAMP = Object.freeze([
    Object.freeze([0.012, 0.004, 0.005]),
    Object.freeze([0.170, 0.028, 0.007]),
    Object.freeze([0.560, 0.170, 0.026]),
    Object.freeze([0.950, 0.520, 0.130]),
    Object.freeze([1.200, 0.960, 0.600]),
]);
const STEAM_HOT = STEAM_FIRE_RAMP[4];

/** The ramp as nodes: heat (float node, 0..1) -> colour. */
function steamFire(heat) {
    const stops = STEAM_FIRE_RAMP.map((c) => vec3(c[0], c[1], c[2]));
    const h = clamp(heat, 0.0, 1.0).mul(stops.length - 1);
    let colour = stops[0];
    for (let i = 1; i < stops.length; i += 1) {
        colour = mix(colour, stops[i], clamp(h.sub(i - 1), 0.0, 1.0));
    }
    return colour;
}
// The sea the vent opens into: blue-black, a little lighter straight up where the far surface is.
const ABYSS_DEEP = [0.0035, 0.009, 0.018];
const ABYSS_ZENITH = [0.009, 0.026, 0.05];
// The lava's glow in the water over the vent.
const ABYSS_GLOW = [0.34, 0.058, 0.012];

/**
 * THE DECKS: sheets of vapour at fixed world heights that the eye climbs through. Each is a
 * horizontal sheet of billows met by the view ray (plane intersection, no march), composited front
 * to back, so near decks are big and fast and far ones small and slow: the parallax of climbing.
 * The lava is BELOW the eye and the eye looks up, so it sees the billows' lit undersides: a thick
 * billow is bright, brighter on the flank toward the lava's key, its thin edge lets the darker
 * vapour beyond show; farther decks sink into ember air. No deck stands above the vent's lip
 * (`interfaceY`): there the vapour has met the sea.
 * @param {object} o
 * @param {*} o.viewDir normalised view ray (vec3 node)
 * @param {*} o.uTime seconds (uniform)
 * @param {*} o.interfaceY world height of the vent's lip (float node)
 * @param {*} o.eyeR float node, the sea's eye (the sine of its half-angle from the zenith)
 * @param {number} [o.count] how many decks (STEAM_DECKS_BY_TIER)
 * @returns {{ heat: *, transmit: * }} the decks' light as heat on the fire ramp (weighted by
 *   their cover), and how much of what lies beyond shows
 */
function steamDecks({
    viewDir, uTime, interfaceY, eyeR, count = STEAM_DECK_COUNT,
}) {
    const radial = viewDir.xz.length();
    const eyeY = cameraPosition.y.sub(uTime.mul(STEAM_DECK_RISE));
    const below = floor(eyeY.div(STEAM_DECK_SPACING));
    const up = max(viewDir.y, float(0.22));
    // Horizontal sheets seen edge-on would smear into streaks: only where the eye looks up.
    const facing = smoothstep(0.18, 0.42, viewDir.y);
    const reach = STEAM_DECK_SPACING * count;
    const drift = vec2(uTime.mul(0.05), uTime.mul(-0.032));
    let heat = float(0.0);
    let transmit = float(1.0);
    for (let k = 1; k <= count; k += 1) {
        const n = below.add(k);
        // Height of this deck above the eye: (0, reach]. It fades in far away and out again
        // before it reaches the lens, so a deck never pops as the eye passes through it.
        const height = n.mul(STEAM_DECK_SPACING).sub(eyeY);
        const hit = cameraPosition.xz.add(viewDir.xz.mul(height.div(up)));
        const q = hit.mul(0.26).add(vec2(n.mul(7.31), n.mul(-4.17))).add(drift);
        const warp = noise2(q.mul(0.43).add(vec2(3.1, 1.7)));
        const qw = q.add(vec2(warp, warp.mul(-0.7)).mul(1.5));
        const o1 = noise2(qw);
        const o2 = noise2(qw.mul(2.03).add(vec2(5.2, 1.3)));
        const o3 = noise2(qw.mul(4.11).add(vec2(-2.7, 8.1)));
        const broad = o1.mul(0.5).add(o2.mul(0.25));
        const body = broad.add(o3.mul(0.125));
        // Lit flank: the billow thins toward the lava's key (density falls that way), so seen from
        // below each hanging billow is a dome lit on one side and in shade on the other.
        const toKey = qw.add(vec2(DECK_KEY[0], DECK_KEY[1]).mul(0.3));
        const broadKey = noise2(toKey).mul(0.5).add(noise2(toKey.mul(2.03).add(vec2(5.2, 1.3))).mul(0.25));
        const flank = clamp(broad.sub(broadKey).mul(5.5).add(0.5), 0.0, 1.0);
        const dens = smoothstep(0.40, 0.66, body);
        // The vapour ends at the vent's lip: a deck above it is not there.
        const under = oneMinus(smoothstep(interfaceY.sub(6.0), interfaceY.add(1.0), cameraPosition.y.add(height)));
        const fade = smoothstep(2.0, 7.5, height)
            .mul(oneMinus(smoothstep(reach * 0.6, reach, height)))
            .mul(facing)
            .mul(under)
            // Not across the sea's eye — but each deck ends at its own ragged edge, a little
            // inside or outside the far vapour's, so the eye's rim is layered and slides as the
            // eye climbs.
            .mul(smoothstep(
                eyeR.sub(0.07),
                eyeR.add(0.03),
                radial.add(broad.sub(0.38).mul(0.5)).add((k * 0.02) - 0.03),
            ));
        const alpha = clamp(dens.mul(2.2), 0.0, 1.0).mul(fade).mul(0.96);
        // BILLOWS, NOT BLUR. Folding each octave about its middle turns smooth noise into rounded
        // heads with sharp creases between them (the cauliflower of a real plume): the heads hold
        // the lava's light, the creases fall dark, so the sheet reads as heaped vapour and not as a
        // gradient. Front-lit from below: the flank toward the key is brighter, the thin edge dim.
        const puff = o1.mul(2.0).sub(1.0).abs().mul(0.5)
            .add(o2.mul(2.0).sub(1.0).abs().mul(0.3))
            .add(o3.mul(2.0).sub(1.0).abs().mul(0.2));
        const head = smoothstep(0.10, 0.52, puff);
        const heart = smoothstep(0.35, 1.0, dens);
        const lit = mix(float(0.24), float(0.64), head)
            .mul(float(0.72).add(flank.mul(0.36)))
            .add(heart.mul(head).mul(0.10));
        // Farther decks sink into the ember air between them: the depth the climb passes through.
        const haze = smoothstep(0.0, reach, height).mul(0.7);
        const deck = mix(lit, float(0.20), haze);
        heat = heat.add(deck.mul(alpha).mul(transmit));
        transmit = transmit.mul(oneMinus(alpha));
    }
    return { heat, transmit };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.radius] world radius of the volume
 * @param {number} [opts.decks] vapour decks the eye climbs through (STEAM_DECKS_BY_TIER); 0 draws
 *   the vapour without them
 * @returns {{ mesh: THREE.Mesh, update: (t:number, seamT:number) => void, dispose: () => void }}
 *   `seamT` is 0 approaching the boundary, 0.5 at it, 1 leaving it.
 */
export function createSteamQuench({ radius = STEAM_QUENCH_RADIUS, decks = STEAM_DECK_COUNT } = {}) {
    const deckCount = Math.max(0, Math.min(STEAM_DECK_COUNT, Math.round(decks)));
    const uTime = uniform(0);
    // 1 while the decks can show (the steam is up and the eye still under the vent's lip): the
    // shader skips their noise where they cannot (a uniform branch).
    const uDecksOn = uniform(0);
    // 0 outside the seam, 1 at the boundary: how much of the frame the volume covers.
    const uDensity = uniform(0);
    // The sea's eye (steamQuenchEyeRadius): the sine of its half-angle from the zenith. A pulse
    // of the vent pushes the vapour up into it: it narrows a little, and opens again.
    const uEyeBase = uniform(-0.2);
    const uEyeR = uEyeBase.sub(LIGHT.surge.mul(0.045));
    // 0 until the crossing, -> 1 as the exit runs: the volume is then the abyss's own darkness,
    // lifting as a whole (no billow-shaped holes: thin wisps over open water read as cumulus).
    const uExit = uniform(0);
    // World height of the vent's lip (set from the mesh's seat in update()).
    const uInterfaceY = uniform(0);
    // Past the boundary: 1, and the abyss's veil (steamQuenchAbyssVeil).
    const uExitOn = uniform(0);
    const uVeilOut = uniform(0);

    // Billowing, in LOCAL space so the volume churns with itself rather than with the camera.
    // FREQUENCY IS SET BY THE RADIUS, not by taste: positionLocal spans +/-radius (110), and the
    // follow camera looks up the shaft at only the sphere's top cap, so the scale is read in
    // SCREEN terms (0.034: at 0.062 the cap still showed a dozen blotches). The body is domain-
    // warped, so it rolls in big soft masses, and stretched vertically into columns that climb.
    const p = positionLocal.mul(0.042);
    const warp = fbm3(p.mul(0.55).add(vec3(uTime.mul(0.015), uTime.mul(-0.05), 0.0)), 2);
    const warped = p.add(vec3(warp, warp.mul(0.5), warp.mul(-0.8)).mul(1.7));
    // Four octaves, read twice: summed as they are (the vapour's body: where it is thick), and
    // folded about their middles (its billows: rounded heads, sharp creases between them).
    const q0 = warped.mul(vec3(1.0, 0.42, 1.0)).add(vec3(0.0, uTime.mul(-0.09), 0.0));
    const n0 = noise3(q0);
    const n1 = noise3(q0.mul(2.03));
    const n2 = noise3(q0.mul(4.12));
    const n3 = noise3(q0.mul(8.36));
    const slow = n0.mul(0.5).add(n1.mul(0.25)).add(n2.mul(0.125)).add(n3.mul(0.0625));
    const billowRaw = clamp(slow.mul(1.02), 0.0, 1.0);
    const farPuff = n0.mul(2.0).sub(1.0).abs().mul(0.5)
        .add(n1.mul(2.0).sub(1.0).abs().mul(0.28))
        .add(n2.mul(2.0).sub(1.0).abs().mul(0.14))
        .add(n3.mul(2.0).sub(1.0).abs().mul(0.08));

    // Soft on purpose: a hard-edged veil gave the THIN approach vapour holes that, over the dark
    // cavern, read as camouflage, not wisps.
    const veil = smoothstep(0.08, 0.92, billowRaw);

    // ALPHA AND FORM ARE DECOUPLED. The billow shapes alpha only while the volume is thin (the
    // approach, where wisps are correct); as density rises the alpha goes fully opaque — an
    // occluder has to occlude (ADR-0017: the world starts drawing behind it) — and all the
    // structure lives in the colour below. Leaving, it lifts as a whole.
    const d = clamp(uDensity, 0.0, 1.0);
    const alphaShape = mix(mix(veil, float(1.0), d), float(1.0), uExit);
    // Past the boundary the volume is the abyss's darkness, on its own even lift (uVeilOut).
    const opacity = mix(clamp(alphaShape.mul(d).mul(1.25), 0.0, 1.0), uVeilOut, step(0.5, uExitOn));

    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const viewUp = viewDir.y;
    const radialDistance = viewDir.xz.length();
    const azimuth = viewDir.xz.div(max(radialDistance, float(1e-4)));

    // WISPS STREAM PAST. The eye climbs the shaft, so vapour slides out of the opening ahead
    // toward the edges of the view: noise on the azimuth circle (no seam) against the log of the
    // view's distance from the shaft axis, scrolled outward with time. Static fbm on a sphere you
    // fly through read as a painted dome; this reads as motion.
    const shaftContrast = smoothstep(0.04, 0.32, radialDistance);
    const flowR = log(radialDistance.add(0.03));
    const wisps = fbm3(vec3(azimuth.x.mul(5.0), azimuth.y.mul(5.0), flowR.mul(1.8).sub(uTime.mul(0.42))), 2);
    const streak = smoothstep(0.40, 0.84, wisps).mul(shaftContrast);

    // ── THE STEAM, LIT FROM BELOW. The lava is under the eye and the eye looks up, so it sees
    // the vapour's lit side: thick billows are gold with a pale heart, thin vapour is ember, and
    // the gaps between them fall to near-black wine — smoke, never brown. The light is strongest
    // low (toward the frame's edges, nearest the lava) and spends itself toward the top. ──
    // THE FAR VAPOUR is deeper in the column than the decks, farther from the light: ember and
    // deep red with gold only in its thickest billows, so the lit decks stand in front of it.
    const hot = vec3(STEAM_HOT[0], STEAM_HOT[1], STEAM_HOT[2]);
    const lowLight = mix(float(1.1), float(0.62), smoothstep(0.66, 1.0, viewUp));
    // SHAFTS OF THE LAVA'S LIGHT stream up past the eye through the gaps in the vapour: seen
    // along their own length they fan out from the vanishing point overhead (noise on the view's
    // azimuth, on a circle so there is no seam), each broken along its length by the wisps.
    const rayNoise = noise2(azimuth.mul(3.6).add(vec2(uTime.mul(0.045), uTime.mul(-0.03))));
    const rays = smoothstep(0.52, 0.88, rayNoise).mul(shaftContrast).mul(float(0.45).add(streak.mul(0.75)));
    const farHeat = smoothstep(0.06, 0.50, farPuff)
        .mul(smoothstep(0.30, 0.66, billowRaw).mul(0.58).add(0.15))
        .mul(float(0.86).add(streak.mul(0.28)))
        .add(rays.mul(0.16))
        .mul(lowLight);

    // ── THE SEA'S EYE. Straight ahead the vapour ends and the water begins: black-blue, with the
    // lava's glow in it low over the vent. Its rim is ragged with the billows and the wisps. ──
    const rag = billowRaw.sub(0.47).mul(0.34).add(wisps.sub(0.5).mul(0.12));
    const eyeR = radialDistance.add(rag);
    const eye = oneMinus(smoothstep(uEyeR.sub(0.03), uEyeR.add(0.03), eyeR));
    // How far the eye stands over the vent's lip: the glow in the water falls away as it climbs.
    const overVent = max(cameraPosition.y.sub(uInterfaceY), float(0.0));
    const glowReach = exp(overVent.div(-24.0));
    const abyssBase = mix(
        vec3(ABYSS_DEEP[0], ABYSS_DEEP[1], ABYSS_DEEP[2]),
        vec3(ABYSS_ZENITH[0], ABYSS_ZENITH[1], ABYSS_ZENITH[2]),
        smoothstep(0.62, 1.0, viewUp),
    );
    // Smoke hangs in the water over the vent: broad darker and lighter reaches, drifting.
    const smoke = float(0.72).add(billowRaw.mul(0.62));
    // The far surface's light comes down the water in faint shafts: seen from below along their
    // own length they fan out from straight overhead, drifting — the sign that this dark is water
    // and not a night sky.
    const seaShafts = smoothstep(0.45, 0.85, noise2(azimuth.mul(2.6).add(vec2(uTime.mul(-0.02), uTime.mul(0.026)))))
        .mul(shaftContrast)
        .mul(smoothstep(0.55, 0.95, viewUp));
    // The glow is light in turbid water: strongest low, broken by the smoke, never a flat ring.
    const lowWater = oneMinus(smoothstep(0.60, 0.98, viewUp));
    // It REPLACES the water's blue where it is strong (orange light added to blue water is
    // mauve): the smoke over the vent is lit ember-red from below, its creases dark.
    const glowAmount = lowWater.mul(lowWater).mul(glowReach)
        .mul(smoothstep(0.10, 0.55, farPuff).mul(0.8).add(0.2))
        .mul(smoothstep(0.30, 0.62, billowRaw));
    const abyss = mix(
        abyssBase.mul(smoke).add(vec3(0.006, 0.020, 0.034).mul(seaShafts)),
        vec3(ABYSS_GLOW[0], ABYSS_GLOW[1], ABYSS_GLOW[2]),
        clamp(glowAmount.mul(0.85), 0.0, 1.0),
    );
    // WATER FLASHING TO STEAM: where the vapour meets the sea its edge burns pale gold, flickering
    // slowly along the rim with the wisps (a broken line, brightest where the billow is thick).
    const rimBand = smoothstep(uEyeR.sub(0.045), uEyeR.sub(0.008), eyeR)
        .mul(oneMinus(smoothstep(uEyeR.sub(0.008), uEyeR.add(0.018), eyeR)));
    const rimLight = vec3(STEAM_FIRE_RAMP[3][0], STEAM_FIRE_RAMP[3][1], STEAM_FIRE_RAMP[3][2])
        .add(hot.mul(streak).mul(0.5))
        .mul(rimBand)
        .mul(clamp(streak.mul(1.2).add(farPuff.sub(0.3).mul(1.4)), 0.0, 1.2))
        .mul(0.55)
        .mul(oneMinus(uExit));

    // THE WHOLE VOLUME AS ONE SCALAR: heat (how much of the lava's light the vapour along this
    // ray holds, weighted by how much of the ray it covers) and cover (the rest is the sea).
    // THE DECKS the eye climbs through stand in front of the far vapour — only while the steam is
    // dense and the eye still under the lip (a uniform branch). Every value the branch shares with
    // the rest of the shell is pinned at the root first: TSL emits a shared value where it is first
    // BUILT, and one first built inside the branch is paid twice (r187) or read as zero outside it
    // (r186) — the TSL skill's branch trap.
    const climbed = Fn(() => {
        const eyeV = eye.toVar();
        const far = farHeat.toVar();
        const cover = oneMinus(eyeV).toVar();
        const heat = far.mul(cover).toVar();
        const sea = abyss.toVar();
        const flash = rimLight.toVar();
        if (deckCount > 0) {
            const dv = d.toVar();
            const dir = viewDir.toVar();
            If(uDecksOn.greaterThan(0.5), () => {
                const decksLit = steamDecks({
                    viewDir: dir, uTime, interfaceY: uInterfaceY, eyeR: uEyeR, count: deckCount,
                });
                heat.assign(mix(heat, decksLit.heat.add(heat.mul(decksLit.transmit)), dv));
                cover.assign(mix(cover, oneMinus(decksLit.transmit.mul(eyeV)), dv));
            });
        }
        // Coloured once, on the ramp, at the vapour's own heat (not the cover-weighted one: a
        // thin edge of bright vapour over the sea is gold at part strength, not red).
        const vapour = steamFire(heat.div(max(cover, float(0.02))).mul(LIGHT.gain));
        return vapour.mul(cover).add(sea.mul(oneMinus(cover))).add(flash);
    })();

    // A SOFT SHOULDER ON LUMINANCE, HUE KEPT. A per-channel clip turned the fire-lit vapour tan
    // and olive where the light sums (red clips first while green keeps rising). Linear to the
    // knee, then rolling off; the hue is the colour's own.
    const knee = 1.25;
    const preLuma = dot(climbed, vec3(0.2126, 0.7152, 0.0722));
    const over = max(preLuma.sub(knee), float(0.0));
    const shoulder = min(preLuma, float(knee).add(over.div(over.add(1.0))));
    const colour = climbed.mul(shoulder.div(max(preLuma, float(1e-4))));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colour;
    material.opacityNode = opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    // The board rewrites scene.fog every frame from the chapter profile, and this volume sits
    // at the boundary where that fog is mid-lerp. It carries its own colour ramp, so fogging it
    // would paint the seam in the outgoing chapter's fog — the trap this repo has paid for four
    // times (see the scene.fog note in docs/ + memory).
    material.fog = false;
    material.toneMapped = true;

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    mesh.name = 'odyssey-steam-quench';
    // The camera passes through it, so it must not vanish when its origin leaves the frustum.
    mesh.frustumCulled = false;
    mesh.renderOrder = 12; // after opaque chapter content, before UI-ish additive overlays

    return {
        mesh,
        /**
         * @param {number} time seconds
         * @param {number} seamT 0 approaching -> 0.5 at the boundary -> 1 leaving
         */
        update(time, seamT) {
            uTime.value = time;
            const t = Math.max(0, Math.min(1, seamT));
            // ASYMMETRIC ON PURPOSE. Approach: clear through the cathedral, then closing fast
            // so it is dense before Act II starts drawing (see steamQuenchDensity). Exit: the
            // square — the abyss's darkness lifting as the eye climbs out of the vent's smoke.
            uDensity.value = steamQuenchDensity(t);
            uEyeBase.value = steamQuenchEyeRadius(t);
            uExit.value = Math.max(0, Math.min(1, (t - 0.5) / 0.12));
            uInterfaceY.value = mesh.position.y - STEAM_QUENCH_INTERFACE_DROP;
            uExitOn.value = t > 0.5 ? 1 : 0;
            uVeilOut.value = steamQuenchAbyssVeil(t);
            uDecksOn.value = (deckCount > 0 && uDensity.value > 1e-3 && t < 0.52) ? 1 : 0;
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
