// @ts-check
/**
 * @fileoverview FIRST LIGHT: the ending of the journey, its clock (2026-11-17), three-free.
 *
 * The journey began in the dark inside the Earth. Once every orb is done and the eye rests at the
 * end of the rail, the world answers, in this order (seconds of the ending's own clock):
 *
 *   the wave      the spire fires and a ring of light crosses the city: every window comes on as
 *                 it passes, window by window, out past the last tower;
 *   the clearing  the rain has stopped and the cloud has parted (the journey's end ramp, as before),
 *                 and the journey draws itself among the stars (odyssey-journey-constellation.js)
 *                 while the eye rises over the roofs (the camera's JOURNEY_END_RISE);
 *   the lanterns  paper lanterns in the eight chapters' colours lift off the streets and roofs;
 *   the fireworks over the skyline in the night's deepest, in the chapters' colours, their finale
 *                 as the first light shows;
 *   the dawn      the horizon warms, the sun that sank all chapter comes back up behind the spire,
 *                 the cloud catches fire from below and the stars thin out, the journey's own last;
 *   the rest      first light held: lanterns still drifting up, the city lit, the journey in the sky.
 *
 * The clock runs only at the journey's end with the whole journey done; it holds at the rest, is
 * taken back once the eye has left (so every return plays it again), and everything it drives is
 * also scaled by how near the end the eye is, so scrolling away dims it smoothly instead of
 * cutting it.
 */

function smooth01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
}

function ramp(a, b, x) {
    return smooth01((x - a) / (b - a));
}

export const JOURNEY_ENDING = Object.freeze({
    /** journeyEnd (the manager's ramp over the rail's last stretch) at which the clock runs. */
    arrive: 0.9,
    /** ...below which it is taken back for the next visit. */
    reset: 0.25,
    /** journeyEnd over which everything the ending shows comes in (a scroll away dims it). */
    shown: Object.freeze([0.45, 0.94]),
    /** The wave of light from the spire: seconds, and the radius it reaches (corridor units). */
    wave: Object.freeze([2.2, 15]),
    waveRadius: 1750,
    /** The night's deepest: the afterglow dies down as the journey draws itself among the stars. */
    dusk: Object.freeze([1, 9]),
    /** The lanterns' release (they keep rising for ever after). */
    lanterns: 7,
    /** First light: the sky's turn from night to dawn. */
    dawn: Object.freeze([33, 56]),
    /** The sun's return: seconds, and how far it climbs from where the chapter left it. */
    sunrise: Object.freeze([34, 62]),
    sunLift: 170,
    /** The fireworks' show. */
    fireworks: Object.freeze([10, 39]),
    /** The clock holds here. */
    rest: 66,
});

/**
 * Advance the ending's clock.
 * @param {{ seconds: number }} state carried between frames
 * @param {{ journeyEnd: number, complete: boolean, dt: number }} now
 * @param {typeof JOURNEY_ENDING} [spec]
 * @returns {number} seconds into the ending (0 before it, held at `rest`)
 */
export function advanceJourneyEnding(state, { journeyEnd, complete, dt }, spec = JOURNEY_ENDING) {
    const end = Number.isFinite(journeyEnd) ? journeyEnd : 0;
    if (!complete || end < spec.reset) state.seconds = 0;
    else if (end >= spec.arrive) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        state.seconds = Math.min(spec.rest, state.seconds + step);
    }
    return state.seconds;
}

/**
 * What the ending shows at a moment of its clock.
 * @param {number} seconds advanceJourneyEnding()
 * @param {number} journeyEnd 0..1
 * @param {typeof JOURNEY_ENDING} [spec]
 * @returns {{ shown: number, wave: number, waveRadius: number, dusk: number, dawn: number, sunLift: number,
 *   lanterns: number, fireworks: number, seconds: number }}
 *   `wave` 0..1 the ring's progress, `dawn` 0..1, `sunLift` corridor units, `lanterns` seconds since
 *   their release (negative before it), `fireworks` seconds into the show (negative before, and
 *   after it: the show is over)
 */
export function resolveJourneyEnding(seconds, journeyEnd, spec = JOURNEY_ENDING) {
    const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const shown = t > 0 ? ramp(spec.shown[0], spec.shown[1], Number.isFinite(journeyEnd) ? journeyEnd : 0) : 0;
    // The ring leaves the spire a moment after the eye has arrived and crosses the city at a
    // steady pace (it passes the eye about five seconds in), easing only as it dies in the haze.
    const w = Math.min(1, Math.max(0, (t - spec.wave[0]) / (spec.wave[1] - spec.wave[0])));
    const wave = w * (1.25 - (0.25 * w));
    const inShow = t >= spec.fireworks[0] && t <= spec.fireworks[1];
    return {
        shown,
        wave,
        waveRadius: wave * spec.waveRadius,
        dusk: ramp(spec.dusk[0], spec.dusk[1], t) * shown,
        dawn: ramp(spec.dawn[0], spec.dawn[1], t) * shown,
        sunLift: ramp(spec.sunrise[0], spec.sunrise[1], t) * spec.sunLift * shown,
        lanterns: t - spec.lanterns,
        fireworks: inShow ? t - spec.fireworks[0] : -1,
        seconds: t,
    };
}
