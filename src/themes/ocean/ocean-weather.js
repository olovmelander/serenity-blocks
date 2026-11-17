/**
 * Ocean — the sea's own weather (CPU only, three-free).
 *
 * The hours (ocean-hours.js) turn the colour of the light. This turns everything else the sea
 * does by itself, on clocks of its own, so the hour and the weather never line up the same way
 * twice in a session:
 *
 *   the sea states   six of them on a second wheel, 73 s each (the hours take 100 s, and neither
 *                    wheel's turn is a small multiple of the other's): the trade wind
 *                    (as the reef always was), glass (a still surface, the shafts crisp, the water
 *                    clearer), the long swell (the surface standing in high rollers, the current
 *                    gone round to the other side), a plankton bloom (the water thick and full of
 *                    specks, the shafts soft), a squall (the sky gone grey, rain ringing the
 *                    surface, the shafts all but out) and crystal water after it (clear to the far
 *                    pinnacles, the shafts at their strongest);
 *   the clouds       shadows that cross the sun: the shafts fade and come back in a burst, as
 *                    often as the state's sky is clouded;
 *   the happenings   small things at irregular times: a vent on the reef lets go a string of
 *                    bubbles, the reef fish of one garden dart for cover, the school flashes as
 *                    it turns, and at night the corals spawn a little by themselves.
 *
 * All of it is a pure function of the world clock and a seed (a session draws its own; a capture
 * uses seed 1), so any frame can be replayed.
 */
import {
    clamp01, lerp, mulberry32, smooth,
} from './ocean-core.js';

/** Seconds of the world's clock one sea state lasts. */
export const SEA_SECONDS = 73;
/** The share of a state, at each end, the sea rests on that state's own numbers. */
export const SEA_REST = 0.22;

/** What a sea state sets (all plain numbers, mixed between neighbours). */
export const SEA_SCALARS = Object.freeze([
    'swell', 'chop', 'clarity', 'shafts', 'motes', 'current', 'clouds', 'rain', 'sun',
]);

const state = (name, values) => Object.freeze({ name, ...values });

/**
 *   swell    how steep the surface's wave trains stand (1 = the reef's own)
 *   chop     how much the small waves and the skin's crinkle stand (1 = the reef's own)
 *   clarity  how far the water has cleared (+) or thickened (−): −0.6..0.6
 *   shafts   gain on the shafts of light
 *   motes    gain on what drifts in the water
 *   current  the steady current's lean on everything that grows: its sign is its side
 *   clouds   how much of the sky is cloud (how often and how far the sun goes in)
 *   rain     0..1: rain ringing the surface
 *   sun      gain on the sun's own light
 */
export const SEA_STATES = Object.freeze([
    state('trade', {
        swell: 1, chop: 1, clarity: 0, shafts: 1, motes: 1, current: 0.26, clouds: 0.4, rain: 0, sun: 1,
    }),
    state('glass', {
        swell: 0.6, chop: 0.4, clarity: 0.28, shafts: 1.25, motes: 0.7, current: 0.08, clouds: 0.08, rain: 0, sun: 1.06,
    }),
    state('swell', {
        swell: 1.55, chop: 0.9, clarity: 0.05, shafts: 1.1, motes: 1, current: -0.32, clouds: 0.3, rain: 0, sun: 1,
    }),
    state('bloom', {
        swell: 0.9, chop: 0.8, clarity: -0.5, shafts: 0.8, motes: 2.4, current: 0.16, clouds: 0.55, rain: 0, sun: 0.92,
    }),
    state('squall', {
        swell: 1.35, chop: 1.5, clarity: -0.12, shafts: 0.28, motes: 1.2, current: -0.44, clouds: 1, rain: 1, sun: 0.5,
    }),
    state('crystal', {
        swell: 0.85, chop: 0.7, clarity: 0.55, shafts: 1.35, motes: 0.5, current: 0.22, clouds: 0.12, rain: 0, sun: 1.1,
    }),
]);

const wrap = (place, n) => ((place % n) + n) % n;

/** Where on the wheel of sea states a clock stands for a seed (each session starts somewhere of its own). */
export function seaPlace(clock, seed = 1) {
    const start = seed === 1 ? 0 : mulberry32(seed * 7919 + 13)() * SEA_STATES.length;
    return start + Math.max(0, clock) / SEA_SECONDS;
}

/** The sea state at a place on its wheel: every number of SEA_SCALARS, and `name`, `next`, `mix`. */
export function seaAt(place, out = {}) {
    const n = SEA_STATES.length;
    const p = wrap(Number.isFinite(place) ? place : 0, n);
    const from = Math.floor(p) % n;
    const to = (from + 1) % n;
    const mix = smooth(SEA_REST, 1 - SEA_REST, p - from);
    const a = SEA_STATES[from];
    const b = SEA_STATES[to];
    for (let i = 0; i < SEA_SCALARS.length; i += 1) {
        const key = SEA_SCALARS[i];
        out[key] = lerp(a[key], b[key], mix);
    }
    out.name = mix < 0.5 ? a.name : b.name;
    out.next = mix < 0.5 ? b.name : a.name;
    out.mix = mix;
    return out;
}

// ── The clouds ──────────────────────────────────────────────────────────────────

function lattice1(i, seed) {
    let h = Math.imul(i ^ (seed * 0x9e3779b1), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise on a line, 0..1. */
function noise1(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return lerp(lattice1(i, seed), lattice1(i + 1, seed), s);
}

/**
 * How far the sun is in at a clock, 0 (out) .. 1 (behind cloud): shadows of a quarter of a minute
 * with longer gaps, and a slower drift under them.
 */
export function cloudShadow(clock, seed = 1) {
    const n = noise1(clock / 17, seed) * 0.65 + noise1(clock / 43 + 9.1, seed + 5) * 0.35;
    return smooth(0.5, 0.78, n);
}

/**
 * The gain on the sun's light at a clock under a sky `clouds` cloudy: 1 with the sun out, down
 * to about half as a shadow crosses, and a little over 1 just as it comes back out (the eye's
 * own doing: the burst after a shadow).
 */
export function sunGain(clock, clouds, seed = 1) {
    const now = cloudShadow(clock, seed);
    const before = cloudShadow(clock - 2.5, seed);
    const burst = Math.max(0, before - now) * 0.5;
    return 1 - 0.5 * clamp01(clouds) * now + burst * clamp01(clouds * 1.5);
}

// ── The happenings ──────────────────────────────────────────────────────────────

/** Seconds between the slots the happenings are dealt into (one to a slot, somewhere in it). */
export const HAPPEN_SLOT = 17;

/** The kinds, and how often each is dealt (weights). */
export const HAPPENINGS = Object.freeze([
    ['vent', 4], ['dart', 3], ['flash', 3], ['spawn', 2],
]);

const HAPPEN_TOTAL = HAPPENINGS.reduce((sum, h) => sum + h[1], 0);

/**
 * The happening dealt into a slot: { at (seconds), kind, a, b } (a and b are its own numbers,
 * 0..1: which garden, how strong).
 */
export function happeningAt(slot, seed = 1, out = {}) {
    const rand = mulberry32((slot + 1) * 2654435761 + seed * 40503);
    out.at = slot * HAPPEN_SLOT + 2 + rand() * (HAPPEN_SLOT - 4);
    let pick = rand() * HAPPEN_TOTAL;
    out.kind = HAPPENINGS[0][0];
    for (let i = 0; i < HAPPENINGS.length; i += 1) {
        pick -= HAPPENINGS[i][1];
        if (pick <= 0) {
            [out.kind] = HAPPENINGS[i];
            break;
        }
    }
    out.a = rand();
    out.b = rand();
    return out;
}

/** The slot a clock stands in. */
export const happenSlot = (clock) => Math.floor(Math.max(0, clock) / HAPPEN_SLOT);
