/**
 * Starlight — the night's air (CPU only, three-free).
 *
 * The hours (starlight-core.js PALETTES) turn the light; the AIR turns the weather of the sky, on
 * a clock of its own that never lines up with the hours for long, so the same hour comes back
 * under a different sky. A pure function of the night's clock: a seek lands on the same air.
 *
 *   clear    the dark sky, nothing between the lens and the stars
 *   waves    airglow in waves: long bands of green light (oxygen, ninety kilometres up) with a
 *            red fringe above them, rippling slowly across the whole sky
 *   veil     a high veil of cirrus drifting over: fibres that form, stretch and melt as they
 *            go (two layers at two speeds), lit from below by the town and the hour's glow; the
 *            stars and the band dim behind it and shine through its gaps
 *   mist     the mist rises off the lake: thicker, higher, the far shore half drowned, haloes
 *            round the lamps
 *   breeze   a breath of wind: cat's paws spread over the lake and the mirror breaks into
 *            shivering columns of light
 *   shine    noctilucent cloud: silver-blue fibres low over the horizon, brightest in the
 *            twilight hours, when the sun far below still lights them
 *
 * Each state holds AIR_SECONDS and melts into the next over the last AIR_MELT of it. The order
 * puts a clear sky between most weathers, so the dark night stays the theme's own.
 */
import { clamp01, smooth01 } from './starlight-core.js';

export const AIRS = Object.freeze(['clear', 'waves', 'veil', 'mist', 'breeze', 'shine']);

/** The order the air takes, one state a step, round and round. */
export const AIR_ORDER = Object.freeze([
    'clear', 'waves', 'clear', 'veil', 'mist', 'clear', 'shine', 'breeze',
    'waves', 'clear', 'veil', 'clear', 'mist', 'breeze', 'shine',
]);

/** Seconds a state of the air holds (the hours turn every 100 s: the two drift apart). */
export const AIR_SECONDS = 118;
/** The share of a state spent melting into the next. */
export const AIR_MELT = 0.24;

/** How strongly each state shows at its height (1 = full), before the hour's own share. */
const AIR_GAIN = Object.freeze({
    clear: 0, waves: 1, veil: 1, mist: 1, breeze: 1, shine: 1,
});

function blank(out) {
    for (let i = 0; i < AIRS.length; i += 1) out[AIRS[i]] = 0;
    return out;
}

/**
 * The air at `time` (seconds of the night's clock): a weight 0..1 for every state in AIRS
 * (they sum to 1), `name` the state it is in or leaving, `next` the one it melts into, and `turn`
 * how far the melt has gone. `shift` moves the clock on (a session's own offset).
 */
export function airAt(time, out = {}, shift = 0) {
    blank(out);
    const t = Math.max(0, time + shift);
    const step = Math.floor(t / AIR_SECONDS);
    const f = t / AIR_SECONDS - step;
    const a = AIR_ORDER[step % AIR_ORDER.length];
    const b = AIR_ORDER[(step + 1) % AIR_ORDER.length];
    const k = smooth01((f - (1 - AIR_MELT)) / AIR_MELT);
    out[a] += 1 - k;
    out[b] += k;
    out.name = a;
    out.next = b;
    out.turn = k;
    return out;
}

/**
 * What the shader is given: the four weathers that share a vec4 (waves, veil, mist, breeze) and
 * the shine, each scaled by its gain, the hour's dusk (the shine is a twilight thing; the waves
 * drown in a bright twilight) and the player's `held` override (the playground's `air=`).
 */
export function airUniforms(air, dusk = 0, out = {}) {
    const d = clamp01(dusk);
    out.waves = clamp01(air.waves * AIR_GAIN.waves * (1 - 0.55 * d));
    out.veil = clamp01(air.veil * AIR_GAIN.veil);
    out.mist = clamp01(air.mist * AIR_GAIN.mist);
    out.breeze = clamp01(air.breeze * AIR_GAIN.breeze);
    out.shine = clamp01(air.shine * AIR_GAIN.shine * (0.4 + 0.6 * d));
    return out;
}

/** A held air (`name` one of AIRS): weight 1 on it, 0 elsewhere. */
export function heldAir(name, out = {}) {
    blank(out);
    if (Object.prototype.hasOwnProperty.call(out, name)) out[name] = 1;
    else out.clear = 1;
    out.name = AIRS.includes(name) ? name : 'clear';
    out.next = out.name;
    out.turn = 0;
    return out;
}
