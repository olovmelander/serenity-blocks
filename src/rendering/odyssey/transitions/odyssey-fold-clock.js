/**
 * THE FOLD'S CLOCK — what changes in a room of the fold while the eye is parked in it (masterpiece
 * pass, 2026-11-17). One pure function of the world clock, read by every place:
 *
 *  - three MOODS, slow turns of 53, 89 and 149 seconds that are never in step (each place reads
 *    them its own way: a hue, a light's warmth, which world a facet shows), so two visits to one
 *    orb are not the same picture;
 *  - a rare HAPPENING: one in every `slot` seconds, at a place inside the slot that differs from
 *    slot to slot, rising and falling over `last` seconds without a step (a great swell on the
 *    tide, a bright wave down the lattice, the flock turning, a world flooding the jewel);
 *  - TURNS: how many happenings have been, eased through the one under way (whole again after
 *    four), for what a happening leaves changed: the stairs' three glasses change places.
 *
 * Everything is continuous in time, and still under reduced motion (the moods rest mid-way, no
 * happening, no turn).
 */

export const CH7_FOLD_CLOCK = Object.freeze({
    moods: Object.freeze([53, 89, 149]),
    moodOffsets: Object.freeze([0.9, 2.3, 4.1]),
    slot: 44,
    last: 15,
});

const hash = (k, salt) => {
    const x = Math.sin((k * 127.1) + salt) * 43758.5453;
    return x - Math.floor(x);
};

const smooth = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/** When slot `k`'s happening begins (seconds). */
export function foldHappeningStart(k) {
    const C = CH7_FOLD_CLOCK;
    return (k * C.slot) + (hash(k, 311.7) * (C.slot - C.last));
}

/**
 * The fold's clock at world time `time`.
 * @param {number} time seconds
 * @param {{ still?: boolean }} [opts] `still` under reduced motion
 * @returns {{ mood: number[], event: number, eventAge: number, eventSeed: number, turns: number }}
 *   moods 0..1; `event` 0..1 (the happening's strength), `eventAge` seconds into it, `eventSeed`
 *   0..1 (which one), `turns` 0..4 (quarter turns made, wrapped: four are a whole turn)
 */
export function resolveFoldClock(time, { still = false } = {}) {
    const C = CH7_FOLD_CLOCK;
    if (still || !Number.isFinite(time)) {
        return {
            mood: [0.5, 0.5, 0.5], event: 0, eventAge: 0, eventSeed: 0, turns: 0,
        };
    }
    const t = Math.max(0, time);
    const mood = C.moods.map((period, i) => 0.5 - (0.5 * Math.cos(((t / period) * Math.PI * 2) + C.moodOffsets[i])));
    const k = Math.floor(t / C.slot);
    const age = t - foldHappeningStart(k);
    const under = age >= 0 && age <= C.last;
    const event = under ? Math.sin((Math.PI * age) / C.last) ** 2 : 0;
    // Quarter turns made: every finished happening, and the share of the one under way.
    const made = k + (age < 0 ? 0 : smooth(age / C.last));
    return {
        mood,
        event,
        eventAge: Math.min(C.last, Math.max(0, age)),
        eventSeed: hash(k, 74.7),
        turns: made % 4,
    };
}
