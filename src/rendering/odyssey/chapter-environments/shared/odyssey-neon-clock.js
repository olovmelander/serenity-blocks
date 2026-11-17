// @ts-check
/**
 * @fileoverview THE CITY'S CLOCK (2026-11-17 masterpiece pass), three-free.
 *
 * Nothing in chapter 8 used to change with time. Everything that now does is a closed form of the
 * chapter clock (seconds) or of the eye's progress through the chapter, so a seek, a capture and a
 * second visit all land on a sky the clock can explain, and nothing pops:
 *
 *   - THE WEATHER: showers come in off a slow front and pass (`resolveNeonWeather`): the rain, the
 *     cloud that gathers a little before it, the wet that outlasts it, the storm at its heart;
 *   - THE SUN: it sinks toward the skyline between the first orb and the last (`resolveNeonSunSink`,
 *     by progress: the chapter ends on its last light);
 *   - THE TRAINS: each elevated line's trains, by the clock (`resolveNeonTrain`);
 *   - THE SEARCHLIGHTS: slow sweeps (`resolveNeonSearchlight`).
 *
 * The windows that go on and off and the signs that cycle are written in the shaders on the same
 * clock (urban-dreams.tsl.js, odyssey-neon-signs.tsl.js).
 */

const TAU = Math.PI * 2;

function smooth01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
}

function ramp(a, b, x) {
    return smooth01((x - a) / (b - a));
}

/** The front's three swells (seconds) and their weights: incommensurate, so no two visits match. */
export const NEON_WEATHER = Object.freeze({
    periods: Object.freeze([113, 67, 41]),
    weights: Object.freeze([0.27, 0.2, 0.12]),
    phases: Object.freeze([0.6, 2.1, 4.4]),
    /** The front's level over which it rains (from a drizzle to a downpour). */
    rain: Object.freeze([0.52, 0.76]),
    /** ...over which the cloud closes in (it gathers `lead` seconds before the rain). */
    cover: Object.freeze([0.3, 0.74]),
    lead: 7,
    /** Cloud cover in the clear spells and under a shower. */
    coverRange: Object.freeze([0.3, 0.86]),
    /** ...and over which sheet lightning may fire. */
    storm: Object.freeze([0.8, 0.95]),
    /** The street never dries: the wet look is the city's. Seconds a shower's wet lingers. */
    wetFloor: 0.5,
    wetLinger: Object.freeze([9, 21, 36]),
    wetKeep: Object.freeze([0.92, 0.8, 0.64]),
});

/**
 * The front: a slow swell about 0.5, above ~0.6 it rains.
 * @param {number} time chapter clock (s)
 * @returns {number} about -0.1..1.1
 */
export function neonFront(time) {
    if (!Number.isFinite(time)) return 0.5;
    const W = NEON_WEATHER;
    let level = 0.5;
    for (let i = 0; i < W.periods.length; i += 1) {
        level += W.weights[i] * Math.sin(((TAU * time) / W.periods[i]) + W.phases[i]);
    }
    return level;
}

/**
 * The weather at a moment of the chapter clock.
 * @param {number} time chapter clock (s)
 * @returns {{ rain: number, cover: number, wet: number, storm: number, front: number }}
 *   rain 0..1 (how hard it falls), cover 0..1 (how closed the cloud is), wet 0.5..1 (the street and
 *   the glass), storm 0..1 (whether lightning may fire)
 */
export function resolveNeonWeather(time) {
    const W = NEON_WEATHER;
    const front = neonFront(time);
    const rainAt = (t) => ramp(W.rain[0], W.rain[1], neonFront(t));
    const rain = rainAt(time);
    let wet = Math.max(W.wetFloor, rain);
    for (let i = 0; i < W.wetLinger.length; i += 1) {
        wet = Math.max(wet, W.wetKeep[i] * rainAt(time - W.wetLinger[i]));
    }
    const gather = ramp(W.cover[0], W.cover[1], neonFront(time + W.lead));
    return {
        rain,
        cover: W.coverRange[0] + ((W.coverRange[1] - W.coverRange[0]) * Math.max(gather, rain)),
        wet,
        storm: ramp(W.storm[0], W.storm[1], front),
        front,
    };
}

/**
 * How far the sun has sunk toward the skyline (corridor units), by the eye's progress through
 * the chapter. Nothing until the 7->8 carry has handed the disc over and its reflection has risen
 * (local 0.15), then down to its last light at the journey's end.
 */
export const NEON_SUN_SINK = Object.freeze({ from: 0.15, to: 1, depth: 52 });

/**
 * @param {number|null} local chapter-local progress 0..1 (null: unknown, a standalone harness)
 * @returns {number} units the disc's centre has dropped
 */
export function resolveNeonSunSink(local) {
    if (!Number.isFinite(local)) return 0;
    return NEON_SUN_SINK.depth * ramp(NEON_SUN_SINK.from, NEON_SUN_SINK.to, /** @type {number} */ (local));
}

/**
 * The elevated lines: one down each side of the boulevard, over the kerb lanes and under the rail
 * (y -21.5: over the lantern strings and the two low skybridges, 10 u under the rail), from behind
 * the eye to a terminus at the spire's foot.
 * `dir` -1 runs toward the sun (corridor -z), +1 toward the eye. A train enters at one end of the
 * span, runs it at `speed` and the line is then empty until the next `period`.
 */
export const NEON_TRAIN_LINES = Object.freeze([
    Object.freeze({
        x: 15.6, y: -21.5, dir: -1, speed: 44, period: 59, phase: 11, cars: 6,
    }),
    Object.freeze({
        x: -15.6, y: -21.5, dir: 1, speed: 38, period: 83, phase: 47, cars: 5,
    }),
]);

/** The span a line runs (corridor z), a car's length and the gap between cars. */
export const NEON_TRAIN = Object.freeze({
    zNear: 420, zFar: -515, carLength: 15, carGap: 0.9, carWidth: 3.1, carHeight: 3.3,
});

/**
 * Where a line's train is: the corridor z of its nose, or null between trains.
 * @param {{ dir: number, speed: number, period: number, phase: number, cars: number }} line
 * @param {number} time chapter clock (s)
 * @returns {{ z: number, dir: number, age: number } | null}
 */
export function resolveNeonTrain(line, time) {
    if (!Number.isFinite(time)) return null;
    const T = NEON_TRAIN;
    const length = line.cars * (T.carLength + T.carGap);
    const run = (T.zNear - T.zFar) + length;
    const age = (((time + line.phase) % line.period) + line.period) % line.period;
    const travelled = age * line.speed;
    if (travelled > run) return null;
    const z = line.dir < 0 ? T.zNear - travelled : (T.zFar + travelled);
    return { z, dir: line.dir, age };
}

/**
 * A searchlight's sweep: its bearing swings about its rest bearing and its elevation nods, both
 * slow sines of the clock (never a step).
 * @param {{ bearing: number, swing: number, period: number, phase: number, elevation: number, nod: number }} lamp
 *   radians and seconds
 * @param {number} time chapter clock (s)
 * @returns {{ bearing: number, elevation: number }}
 */
export function resolveNeonSearchlight(lamp, time) {
    const t = Number.isFinite(time) ? time : 0;
    return {
        bearing: lamp.bearing + (lamp.swing * Math.sin(((TAU * t) / lamp.period) + lamp.phase)),
        elevation: lamp.elevation + (lamp.nod * Math.sin(((TAU * t) / (lamp.period * 0.61)) + (lamp.phase * 1.7))),
    };
}
