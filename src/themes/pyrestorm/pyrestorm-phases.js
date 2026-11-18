/**
 * Pyrestorm — the eruption's phases and its own happenings (three-free).
 *
 * An eruption is never one thing for long. Beside the watches of the night (pyrestorm-hours.js:
 * the light) the mountain keeps a wheel of its own, the eruption's phases, round and round:
 *
 *   strombolian   the mountain as it always was: rhythmic bursts, a steady fountain, the column
 *   paroxysm      the fountain stands two thousand metres over the crater, the rivers run fast
 *                 and bright, embers fill the air
 *   ash storm     the column fattens and darkens and roofs the sky; the fire is half hidden in it
 *                 and the storm breaks on its own
 *   effusive      the column thins to pale gas and the lava takes over: the rivers swell over
 *                 their banks, the fissure's curtain stands tall
 *   the glow      a lull: the fountain sinks into the crater and a thin plume of steam stands over
 *                 it, lit red from below; the sky clears to the stars and the moon
 *
 * The wheel's place = clock / PHASE_SECONDS + the levels gained, exactly as the watches' wheel (a
 * level-up moves the eruption one phase on, eased over TIMING.levelTurn), but at its own pace, so
 * the same phase meets a different night every time round: five phases at 86 s against eight
 * watch steps at 100 s meet again only after hours. A phase rests at each end of its step
 * (PHASE_REST), so each is really seen, and every number between two phases is a plain mix.
 *
 * Between play's events the mountain also does things by itself: the happenings, one every
 * HAPPEN_SECONDS or so, each picked by the clock alone (a hash of its slot, weighted by the phase
 * it falls in), so a seek replays them: a lone bomb thrown far out onto the plain, a glowing
 * rockfall down a gully, a shooting star over the clear sky, a gust of embers off the near
 * rivers, a vent of the fissure jetting, a stroke out of the column, the lava lake turning over,
 * a pour of fresh lava down the channels. They are the mountain's, not the player's: softer than
 * any gameplay event, never counted as one, and none shakes the ridge.
 */
import { lerp, smooth } from './pyrestorm-core.js';

/** Seconds of theme clock per phase, and the share of a step a phase rests at each end. */
export const PHASE_SECONDS = 86;
export const PHASE_REST = 0.2;

/**
 * What a phase sets (1 = the strombolian mountain, today's look):
 *   fountain   the crater fountain's height at rest
 *   body       how dense the column is; `girth` how wide (never over 1: the column is marched
 *              inside a tube of its full width, and every pixel of that tube is paid for);
 *              `tone` its ash's albedo (pale steam > 1, dark ash < 1)
 *   cover      how much of the anvil is there (under 1 it breaks into patches and the stars show)
 *   lava       how hot the lava runs; `flux` how wide its channels stand
 *   fissure    the height of the fissure's curtain
 *   storm      how often the storm strikes by itself (0 never … 1 every few seconds)
 *   embers     embers in the air at the eye; `fall` the ash falling out of the anvil
 *   lake       how hard the crater's own glow breathes (the lava lake under a quiet fountain)
 */
export const PHASES = Object.freeze([
    Object.freeze({
        name: 'strombolian', fountain: 1, body: 1, girth: 1, tone: 1, cover: 1, lava: 1, flux: 1, fissure: 1, storm: 0.22, embers: 1, fall: 0.4, lake: 0,
    }),
    Object.freeze({
        name: 'paroxysm', fountain: 2.15, body: 1.1, girth: 1, tone: 1.08, cover: 1.08, lava: 1.1, flux: 1.18, fissure: 1.4, storm: 0.45, embers: 2.4, fall: 0.55, lake: 0,
    }),
    Object.freeze({
        name: 'ash storm', fountain: 0.75, body: 1.5, girth: 1, tone: 0.7, cover: 1.3, lava: 0.93, flux: 0.95, fissure: 0.85, storm: 1, embers: 0.7, fall: 1, lake: 0.1,
    }),
    Object.freeze({
        name: 'effusive', fountain: 0.6, body: 0.55, girth: 0.8, tone: 1.45, cover: 0.62, lava: 1.05, flux: 1.45, fissure: 1.9, storm: 0.05, embers: 1.5, fall: 0.12, lake: 0.45,
    }),
    Object.freeze({
        name: 'the glow', fountain: 0.38, body: 0.4, girth: 0.62, tone: 1.7, cover: 0.34, lava: 0.9, flux: 0.88, fissure: 0.65, storm: 0, embers: 0.6, fall: 0, lake: 1,
    }),
]);

export const PHASE_KEYS = Object.freeze(['fountain', 'body', 'girth', 'tone', 'cover', 'lava', 'flux', 'fissure', 'storm', 'embers', 'fall', 'lake']);

/** A phase record the world reuses (no allocation per frame). */
export function createPhaseState() {
    const P = {
        place: 0, from: 0, to: 0, mix: 0,
    };
    for (const k of PHASE_KEYS) P[k] = PHASES[0][k];
    return P;
}

/** The eruption at a place on the phase wheel (0 strombolian, 1 paroxysm, … 5 strombolian again). */
export function phaseAt(place, out = createPhaseState()) {
    const p = Number.isFinite(place) ? Math.max(0, place) : 0;
    const step = Math.floor(p);
    const frac = smooth(PHASE_REST, 1 - PHASE_REST, p - step);
    const from = step % PHASES.length;
    const to = (step + 1) % PHASES.length;
    const A = PHASES[from];
    const B = PHASES[to];
    for (const k of PHASE_KEYS) out[k] = lerp(A[k], B[k], frac);
    out.place = p;
    out.from = from;
    out.to = to;
    out.mix = frac;
    return out;
}

/** The wheel's place from the clock and the levels gained (the WatchWheel's eased offset). */
export function phasePlace(time, levelOffset = 0) {
    return Math.max(0, Number.isFinite(time) ? time : 0) / PHASE_SECONDS + Math.max(0, levelOffset || 0);
}

// ── The mountain's own happenings ───────────────────────────────────────────────────

/** One happening per this many seconds of theme clock (its moment falls inside its slot). */
export const HAPPEN_SECONDS = 23;

export const HAPPENINGS = Object.freeze(['bomb', 'rockfall', 'meteor', 'embers', 'jet', 'stroke', 'lake', 'pour']);

/**
 * How likely each happening is in each phase (rows: PHASES, columns: HAPPENINGS). A phase's own
 * character: the storm strikes in the ash, stars fall where the sky is clear, the lake turns over
 * in the glow.
 */
const WEIGHTS = Object.freeze([
    //  bomb rock  meteor embers jet stroke lake pour
    Object.freeze([3, 2, 1, 1.5, 1, 1, 1, 1]),
    Object.freeze([4, 2.5, 0.5, 3, 2, 1.5, 0, 2]),
    Object.freeze([1.5, 2, 0, 0.5, 0.5, 5, 1, 0.5]),
    Object.freeze([1, 1.5, 2, 2.5, 3.5, 0, 2, 4]),
    Object.freeze([0.5, 1.5, 4, 1, 1, 0, 4.5, 1.5]),
]);

/** Integer slot → three independent numbers in [0, 1). */
function slotHash(k, n) {
    let h = Math.imul((k | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((n | 0) + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** When slot k's happening comes (theme clock): somewhere in the slot's middle 60 %. */
const momentOf = (k) => (k + 0.25 + slotHash(k, 1) * 0.6) * HAPPEN_SECONDS;

/** The phase's row of weights at a moment. */
const weightsAt = (at, phaseIndexAt) => WEIGHTS[Math.max(0, Math.min(PHASES.length - 1, phaseIndexAt(at) | 0))];

/** Slot k's own draw (an index into HAPPENINGS), before it gives way to its neighbours. */
function drawOf(k, phaseIndexAt) {
    const row = weightsAt(momentOf(k), phaseIndexAt);
    let total = 0;
    for (let i = 0; i < row.length; i++) total += row[i];
    let pick = slotHash(k, 2) * total;
    for (let i = 0; i < row.length; i++) {
        pick -= row[i];
        if (pick < 0) return i;
    }
    return row.length - 1;
}

/**
 * The happening of slot `k` (0, 1, 2 …): when it comes (theme clock), which it is given the phase
 * it falls in (`phaseIndexAt(time)` → index into PHASES), and three numbers of its own in [0, 1)
 * for the world to shape it with. Pure: the same slot is the same happening on every replay.
 * The first slot holds none (a theme just picked shows the rest picture first).
 *
 * Never the same thing twice running: an even slot keeps its draw, and an odd slot whose draw is
 * its neighbour's on either side takes the next kind its phase allows instead.
 */
export function happeningAt(k, phaseIndexAt, out = {}) {
    const slot = Math.max(0, Math.floor(k));
    out.slot = slot;
    out.at = momentOf(slot);
    out.a = slotHash(slot, 3);
    out.b = slotHash(slot, 4);
    out.c = slotHash(slot, 5);
    if (slot === 0) {
        out.kind = null;
        return out;
    }
    let pick = drawOf(slot, phaseIndexAt);
    if (slot % 2 === 1) {
        const row = weightsAt(out.at, phaseIndexAt);
        const before = slot > 1 ? drawOf(slot - 1, phaseIndexAt) : -1;
        const after = drawOf(slot + 1, phaseIndexAt);
        for (let tries = 0; tries < HAPPENINGS.length && (pick === before || pick === after || !(row[pick] > 0)); tries++) {
            pick = (pick + 1) % HAPPENINGS.length;
        }
    }
    out.kind = HAPPENINGS[pick];
    return out;
}

/** The phase that owns a place on the wheel (the nearer of the two it lies between). */
export function phaseIndexOf(place) {
    const p = Math.max(0, Number.isFinite(place) ? place : 0);
    return Math.round(p) % PHASES.length;
}
