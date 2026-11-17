/**
 * Stillwater — the night's own weather, and who comes by (CPU only, three-free).
 *
 * The hours (stillwater-core.js) turn the night's colours. This is what the AIR does meanwhile, on
 * a clock of its own that never falls in step with the hours: it lies still and the tarn is glass;
 * mist comes in off the far water and the moon's shafts stand between the trunks; the sky clears
 * and the stars come out over the wood and lie in the water; a soft rain falls and rings the whole
 * tarn; a breeze gets up, the mirror breaks into glitter and the boughs sway. Each air rests a
 * while and then melts into the next, and no two nights of airs run in the same order.
 *
 * And the tarn has visitors, one at a time, each at its own seeded moment: a fish rises; a star
 * falls over the wood (and through the water); an owl crosses the moon; the old elk of the wood
 * comes down to the far shallows to drink, stands a while looking at the two lights, and goes.
 *
 * Everything here is a pure function of the world clock (a seed and the time), so a seek, a
 * replay and a rebuild that carries the clock all meet the same weather and the same visitors.
 */

import { clamp01, lerp, mulberry32 } from './stillwater-core.js';

/**
 * The airs. Each is what the night's own numbers are multiplied by or given:
 *   mist     × the hour's mist (the far wood, the banks, the veil on the water)
 *   stars    + the hour's stars
 *   cloud    how much thin cloud drifts across the moon's part of the sky (0..1.5)
 *   rain     0..1: rings all over the tarn, streaks in the air
 *   wind     + the air's own movement (the boughs, the ripple that breaks the mirror)
 *   shafts   + the moon's shafts between the trunks
 *   flies    × how many fireflies are awake at rest
 *   rise     how often a fish rises (visitors: weight)
 */
export const AIRS = Object.freeze({
    still: Object.freeze({
        mist: 1, stars: 0, cloud: 0.55, rain: 0, wind: 0, shafts: 0, flies: 1,
    }),
    mist: Object.freeze({
        mist: 1.7, stars: -0.25, cloud: 0.9, rain: 0, wind: 0, shafts: 0.34, flies: 0.8,
    }),
    clear: Object.freeze({
        mist: 0.42, stars: 0.8, cloud: 0, rain: 0, wind: 0.02, shafts: -0.12, flies: 1.5,
    }),
    rain: Object.freeze({
        mist: 1.25, stars: -0.6, cloud: 1.5, rain: 1, wind: 0.1, shafts: 0.06, flies: 0.35,
    }),
    breeze: Object.freeze({
        mist: 0.72, stars: 0.2, cloud: 1.1, rain: 0, wind: 0.42, shafts: 0.1, flies: 0.7,
    }),
});

export const AIR_NAMES = Object.freeze(Object.keys(AIRS));
export const AIR_KEYS = Object.freeze(Object.keys(AIRS.still));

/** Seconds one air lasts, and the share of that it rests before it melts into the next. */
export const AIR_SECONDS = 96;
export const AIR_REST = 0.62;

/** A seeded number in [0, 1) for an integer and a stream (the same wherever it runs). */
export function nightHash(n, stream = 0) {
    return mulberry32((Math.imul((n | 0) + 1, 0x9e3779b1) ^ Math.imul((stream | 0) + 7, 0x85ebca6b)) >>> 0)();
}

/**
 * The air of slot `slot` (0, 1, 2…): every round of the airs is told in a new order, the first
 * night opens still (the picture the theme is known by), and no air follows itself.
 */
export function airOfSlot(slot) {
    const n = AIR_NAMES.length;
    const s = Math.max(0, Math.floor(slot));
    const round = Math.floor(s / n);
    const order = (r) => {
        const names = [...AIR_NAMES];
        // (A seeded shuffle; the first round keeps `still` in front.)
        for (let i = n - 1; i > (r === 0 ? 1 : 0); i--) {
            const j = (r === 0 ? 1 : 0) + Math.floor(nightHash(r * 31 + i, 3) * (i + 1 - (r === 0 ? 1 : 0)));
            [names[i], names[j]] = [names[j], names[i]];
        }
        return names;
    };
    const names = order(round);
    if (round > 0) {
        const before = order(round - 1)[n - 1];
        if (names[0] === before) names.push(names.shift());
    }
    return names[s % n];
}

/**
 * The air at `time`: the one the night rests on, the one it is melting into, and how far.
 * Writes the blended numbers into `out` (and `out.from`, `out.to`, `out.melt`) and returns it.
 * @param {number} time  seconds on the world clock
 * @param {object} [out]
 * @param {string|null} [hold]  an air to hold whatever the clock says (captures)
 */
export function airAt(time, out = {}, hold = null) {
    const o = out;
    if (hold && AIRS[hold]) {
        AIR_KEYS.forEach((key) => {
            o[key] = AIRS[hold][key];
        });
        o.from = hold;
        o.to = hold;
        o.melt = 0;
        return o;
    }
    const turns = Math.max(0, Number(time) || 0) / AIR_SECONDS;
    const slot = Math.floor(turns);
    const k = clamp01((turns - slot - AIR_REST) / (1 - AIR_REST));
    const melt = k * k * (3 - 2 * k);
    const from = airOfSlot(slot);
    const to = airOfSlot(slot + 1);
    const a = AIRS[from];
    const b = AIRS[to];
    AIR_KEYS.forEach((key) => {
        o[key] = lerp(a[key], b[key], melt);
    });
    o.from = from;
    o.to = to;
    o.melt = melt;
    return o;
}

// ── Visitors ────────────────────────────────────────────────────────────────────

/** Seconds a visitor's slot lasts: in each, at most one comes, at a seeded moment. */
export const VISIT_SLOT = 17;

/** How long each stays in the picture (seconds): the world keeps the elk from being cut short. */
export const VISITOR_SPAN = Object.freeze({
    fish: 2, star: 1.4, owl: 12, elk: 66,
});

/** Slots between two of the same kind at the least (the elk is a rare sight; a fish is not). */
const VISITOR_GAP = Object.freeze({
    fish: 1, star: 2, owl: 5, elk: 13,
});

/** What each visitor is worth in each air (0 = never then). */
const VISITOR_WEIGHT = Object.freeze({
    fish: Object.freeze({
        still: 1.2, mist: 0.9, clear: 1, rain: 0.5, breeze: 0.6,
    }),
    star: Object.freeze({
        still: 0.5, mist: 0, clear: 1.6, rain: 0, breeze: 0.5,
    }),
    owl: Object.freeze({
        still: 0.6, mist: 0.5, clear: 0.6, rain: 0.1, breeze: 0.5,
    }),
    elk: Object.freeze({
        still: 0.5, mist: 0.9, clear: 0.3, rain: 0.25, breeze: 0.3,
    }),
});

export const VISITOR_NAMES = Object.freeze(Object.keys(VISITOR_WEIGHT));

/**
 * Who comes in slot `slot`, and when: { kind, time, seed } or null (a quiet slot). Pure of the
 * slot: it looks back over the slots before it for when each kind last came.
 */
export function visitorOfSlot(slot) {
    const s = Math.floor(slot);
    if (s < 1) return null;
    // (Decided for every slot from the first, so that "since each last came" is the same on a replay.)
    const cache = visitorOfSlot.cache || (visitorOfSlot.cache = []);
    for (let i = cache.length; i <= s; i++) {
        let pick = null;
        if (i >= 1) {
            const at = (i + 0.2 + nightHash(i, 11) * 0.6) * VISIT_SLOT;
            const air = airAt(at).from;
            let total = 0;
            const weights = VISITOR_NAMES.map((kind) => {
                let last = -1000;
                for (let j = i - 1; j >= 0 && j >= i - 20; j--) {
                    if (cache[j] && cache[j].kind === kind) {
                        last = j;
                        break;
                    }
                }
                // (The elk never in the night's first minute and a half; the others from the start.)
                const early = kind === 'elk' && at < 95;
                const w = i - last > VISITOR_GAP[kind] && !early ? VISITOR_WEIGHT[kind][air] : 0;
                total += w;
                return w;
            });
            // (About one slot in four passes with nobody.)
            let r = nightHash(i, 13) * (total + 0.9);
            for (let k = 0; k < weights.length && !pick; k++) {
                r -= weights[k];
                if (r <= 0 && weights[k] > 0) pick = { kind: VISITOR_NAMES[k], time: at, seed: nightHash(i, 17) };
            }
        }
        cache[i] = pick;
    }
    return cache[s];
}

/** Every visitor whose moment falls in (from, to], oldest first. */
export function visitorsBetween(from, to, out = []) {
    const list = out;
    list.length = 0;
    if (!(to > from)) return list;
    const first = Math.max(1, Math.floor(from / VISIT_SLOT));
    const last = Math.floor(to / VISIT_SLOT);
    // (A long step — a seek's replay — is walked slot by slot, but never more than a few minutes of them.)
    for (let s = Math.max(first, last - 24); s <= last; s++) {
        const v = visitorOfSlot(s);
        if (v && v.time > from && v.time <= to) list.push(v);
    }
    return list;
}
