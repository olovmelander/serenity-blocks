// @ts-check
/**
 * @fileoverview THE HOLE IS ALIVE (2026-11-17, the Odyssey masterpiece pass): what happens round
 * the traced black hole on the clock, and how it wakes as the journey nears it. Pure and
 * three-free: the lens (odyssey-great-hole-lens.tsl.js) writes this state into its uniforms.
 *
 * The audit: the traced hole with the galaxy and the giant beside it is the best picture in the
 * game, and it was the SAME picture for seven orbs. Nothing moved, nothing happened. Now:
 *
 *   - KNOTS: hot clumps of gas (and one dark gap) that circle the hole in the disk, each at its own
 *     radius and so at its own pace (Kepler: the inner ones lap the outer), drawn out by the shear
 *     into a bright head and a long tail, each breathing slowly. They pass in front, sweep onto the
 *     bright approaching side, and ride over the shadow in the disk's lensed image.
 *   - A STREAM: every `stream.period` seconds a thread of gas enters at the disk's rim and winds
 *     inward for `stream.fall` seconds, heating from ember to white as it sinks (it takes the
 *     disk's own colour for its radius), and where it meets the inner edge...
 *   - A FLARE: ...the inner disk and the glow round it brighten, slowly (seconds up, longer
 *     down: a swell, never a flash; and through `flashScale` all the same).
 *   - WAKING: `greatHoleWakeAt` is how far the hole has woken, by progress from its first light to
 *     the mouth: an ember at the orb where it first shows, the full blaze at the last. Its world
 *     size also grows over the first of those orbs (cosmic-expanse.js `OMEN_SPINE_ANCHOR`).
 *
 * Every function here is continuous in time and in progress: a knot's turn only ever advances, the
 * stream fades in from nothing at the rim and out to nothing at the inner edge, the flare is an
 * eased rise and fall.
 */

/** Seconds for the gas at the disk's inner edge (3 Rs) to circle the hole (the lens's own). */
export const GREAT_HOLE_INNER_ORBIT_SECONDS = 13;
const INNER_EDGE = 3;

/**
 * The knots: radius (Schwarzschild radii), where on its orbit it starts (turns), its light (a
 * share of the disk's own density; negative = a gap), its length along the orbit (turns), and its
 * breath: period (seconds), where in it it starts (0..1) and how deep (0 steady .. 1 to nothing).
 */
export const GREAT_HOLE_KNOTS = Object.freeze([
    Object.freeze({
        radius: 3.6, start: 0.13, gain: 1.15, arc: 0.05, breath: 37, at: 0.2, depth: 0.7,
    }),
    Object.freeze({
        radius: 4.7, start: 0.58, gain: 0.95, arc: 0.06, breath: 53, at: 0.7, depth: 0.8,
    }),
    Object.freeze({
        radius: 6.1, start: 0.86, gain: 0.8, arc: 0.07, breath: 67, at: 0.45, depth: 0.6,
    }),
    Object.freeze({
        radius: 7.9, start: 0.31, gain: 0.7, arc: 0.08, breath: 83, at: 0.9, depth: 0.7,
    }),
    Object.freeze({
        radius: 5.3, start: 0.02, gain: -0.75, arc: 0.1, breath: 61, at: 0.1, depth: 0.5,
    }),
]);

export const GREAT_HOLE_STREAM = Object.freeze({
    /** Seconds from one stream's first light to the next one's. */
    period: 88,
    /** Seconds the head takes from the rim to the inner edge. */
    fall: 34,
    /** Where the head enters and where it ends (Schwarzschild radii). */
    from: 10.2,
    to: 3.3,
    /** Turns round the hole on the way in, and where on the disk it enters (turns). */
    turns: 1.7,
    enter: 0.62,
    /** The thread's length behind its head (turns) at its longest, and its light. */
    length: 0.42,
    gain: 1.5,
    /** Seconds the last of the thread takes to drain once the head is in. */
    drain: 7,
});

export const GREAT_HOLE_FLARE = Object.freeze({
    /** Seconds before the stream's head arrives that the swell begins, its rise and its fall. */
    lead: 3,
    rise: 6,
    fall: 17,
});

/** How far the hole's light is from its full blaze at its first orb (see greatHoleWakeAt). */
export const GREAT_HOLE_WAKE = Object.freeze({
    /** Heat, light and glow at the first light, as shares of the full blaze's. */
    heat: 0.8,
    gain: 0.62,
    corona: 0.55,
    /** Progress before the mouth over which the clock's life (knots, stream, flare) hands back to
     * the plain disk, so the dive keeps the hole it was composed with: [from, to]. */
    lifeOut: Object.freeze([0.009, 0.003]),
});

const smooth01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/** Seconds a knot at `radius` takes to circle the hole. */
export function greatHoleOrbitSeconds(radius) {
    return GREAT_HOLE_INNER_ORBIT_SECONDS * ((Math.max(radius, 1.5) / INNER_EDGE) ** 1.5);
}

/**
 * The stream at `time`: its head's radius and turn, the thread's length behind it (turns) and its
 * light (0 between streams), and the flare's level 0..1.
 * @param {number} time seconds
 * @returns {{ radius: number, turn: number, length: number, gain: number, flare: number, pitch: number }}
 */
export function greatHoleStreamAt(time) {
    const S = GREAT_HOLE_STREAM;
    const F = GREAT_HOLE_FLARE;
    const t = Number.isFinite(time) ? time : 0;
    const cycle = Math.floor(t / S.period);
    const into = t - (cycle * S.period);
    // The head sinks faster the nearer it is (it is falling).
    const s = Math.min(1, into / S.fall);
    const fallen = s ** 1.7;
    // The thread winds a logarithmic spiral: its radius falls by this rate per turn.
    const pitch = Math.log(S.from / S.to) / S.turns;
    const radius = S.from * Math.exp(-pitch * S.turns * fallen);
    // Each stream enters a little farther round than the last (the golden turn: never the same place).
    const turn = S.enter + (cycle * 0.381966) + (S.turns * fallen);
    // In from nothing at the rim, out to nothing once the head is in and the thread has drained.
    const drained = smooth01((into - S.fall) / S.drain);
    const arrived = smooth01(into / 5);
    const length = S.length * arrived * (1 - drained);
    const gain = S.gain * arrived * (1 - drained);
    // The swell: up as the head reaches the inner edge, down slowly after.
    const since = into - (S.fall - F.lead);
    const flare = smooth01(since / F.rise) * (1 - smooth01((since - F.rise) / F.fall));
    return {
        radius, turn: turn - Math.floor(turn), length, gain, flare, pitch,
    };
}

/**
 * The hole's clock state at `time` (seconds): each knot as [radius, turn 0..1, light, arc], the
 * stream and the flare.
 * @param {number} time
 */
export function greatHoleLifeAt(time) {
    const t = Number.isFinite(time) ? time : 0;
    const knots = GREAT_HOLE_KNOTS.map((k) => {
        const turn = k.start + (t / greatHoleOrbitSeconds(k.radius));
        const breath = 1 - (k.depth * (0.5 - (0.5 * Math.cos(Math.PI * 2 * ((t / k.breath) + k.at)))));
        return [k.radius, turn - Math.floor(turn), k.gain * breath, k.arc];
    });
    return { knots, stream: greatHoleStreamAt(t) };
}

/**
 * How far the hole has woken at journey progress `p`: 0 at its first light (`from`), 1 at the mouth
 * (`to`), and the shares of the full blaze its heat, light and glow stand at there; `life` is how
 * much of the clock's life shows (it hands back to the plain disk just before the mouth).
 * @param {number} p journey progress
 * @param {number} from where the hole's light first shows
 * @param {number} to the mouth (chapter 7's start)
 * @returns {{ wake: number, heat: number, gain: number, corona: number, life: number }}
 */
export function greatHoleWakeAt(p, from, to) {
    const W = GREAT_HOLE_WAKE;
    if (!Number.isFinite(p) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return {
            wake: 1, heat: 1, gain: 1, corona: 1, life: 0,
        };
    }
    // To the last orb before the mouth, not the mouth itself: the dive begins from the full blaze.
    const full = to - W.lifeOut[0];
    const wake = smooth01((p - from) / (full - from));
    const life = 1 - smooth01((p - (to - W.lifeOut[0])) / (W.lifeOut[0] - W.lifeOut[1]));
    return {
        wake,
        heat: W.heat + ((1 - W.heat) * wake),
        gain: W.gain + ((1 - W.gain) * wake),
        corona: W.corona + ((1 - W.corona) * wake),
        life,
    };
}
