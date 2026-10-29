/**
 * Winter — what the fox does. Three-free and renderer-free: its body (winter-fox-rig.js) solves
 * the pose this resolves and the model (winter-fox.js) draws it, so the fox behaves the same
 * with or without either.
 *
 * At rest it trots its round over the snowfield and stops now and then: it brakes to a halt,
 * steps round to face the viewer, and then looks about, sits down to watch the sky, stretches,
 * bows — or hears something under the snow, listens with a paw raised, leaps on it nose first,
 * digs it out and shakes itself off. When the chain grows it runs, faster the longer the chain,
 * its trot opening into a gallop; a clear makes it dash; four lines make it pounce; when the run
 * ends it curls up and sleeps. A ring of powder reaching it flicks its tail.
 *
 * All of that is the fox mind the themes share (../shared/fox-mind.js). This file is what is
 * the arctic fox's own: its round over the snowfield as the course that mind goes, the viewer
 * it turns to face, and its paces.
 *
 * And, in the game, how it wanders (`wander`; ../shared/fox-wander.js): it strays a little either
 * side of its round, its trot drifts, it stops where it likes on either open side of the board,
 * not only at its two places, does a different thing each time, and now and then turns right
 * round and goes back the way it came. What is its own here is where on the snowfield it may
 * stray and stop: clear of the framing trees, inside the frame, on the open snow.
 */

import {
    FRAME_TREES, bearingFor, clamp01, foxAt, foxRoundPull, groundHeight,
} from './winter-core.js';
import {
    FOX_ACTS, FOX_RIG, POUNCE_AIR, SLEEP_HOLD, foxStride,
} from './winter-fox-rig.js';
import { FOX_BLEND, MOUSING, foxGaitAmp } from '../shared/fox-mind.js';
import { WanderingFoxMind, foxWalk, wanderingCourse } from '../shared/fox-wander.js';

/** Seconds each thing it does takes (the rig's acts; `Run` is its gait). */
export const FOX_CLIPS = FOX_ACTS;
export {
    FOX_BLEND, MOUSING, POUNCE_AIR, SLEEP_HOLD, foxGaitAmp, foxStride,
};

/** Its paces (m/s). */
export const FOX_TROT = 1.5;
export const foxRunSpeed = (power, surge = 0) => 2.7 + 4.1 * clamp01(power) + 1.4 * Math.min(1.4, Math.max(0, surge));

/** How it wanders when it is let. */
export const FOX_WANDER = Object.freeze({
    /** Metres it strays either side of its round (where its round is drawn as planned: less nearer the eye). */
    stray: 0.9,
    /** Metres it keeps from a framing tree where its round lets it (it never strays nearer than its round goes). */
    treeRoom: 2.4,
    /** Its trot, as a share of FOX_TROT, slowest and quickest. */
    pace: Object.freeze([0.8, 1.22]),
    /** Seconds before it next stops (drawn skewed toward short). */
    rest: Object.freeze([4, 26]),
    /** Odds it stops where it is (on an open side) rather than going on to one of its places. */
    anywhere: 0.55,
    /** Odds it turns back the way it came as it pulls up (never twice within this many seconds). */
    turnBack: 0.3,
    turnGap: 20,
    /** Where it may stop: fractions of the half width either side of the board, the open snow. */
    open: Object.freeze([0.4, 0.86]),
    /** Metres ahead it looks for a place to stop. */
    reach: 26,
    /** How slowly its restlessness drifts (seconds), and how far. */
    restlessTime: 70,
    restlessSpread: 0.32,
});

/** What it may do when it stops, as it wanders: [acts, how likely]. */
export const FOX_WANDER_STOPS = Object.freeze([
    [['LookAround'], 1],
    [MOUSING, 1.2],
    [['Sit'], 0.7],
    [['Listen', 'LookAround'], 0.8],
    [['Stretch', 'LookAround'], 0.6],
    [['Dig', 'Shake'], 0.5],
    [['Greet'], 0.5],
    [['Sit', 'LookAround'], 0.6],
    [['LookAround', 'Sit'], 0.5],
    [['Listen'], 0.5],
    [['Stretch'], 0.4],
    [['Greet', 'LookAround'], 0.35],
    [['LookAround', 'Listen', 'LookAround'], 0.3],
].map(([acts, odds]) => Object.freeze([Object.freeze([...acts]), odds])));

/** Its round as its walk lays it out. */
const baseOf = (round) => ({
    points: round.points,
    count: round.count,
    length: round.length,
    stations: round.stations,
    at: (distance, out) => foxAt(round, distance, out),
});

/**
 * Where it may stray and stop on the snowfield at an aspect: never nearer a framing tree than its
 * round goes (or than FOX_WANDER.treeRoom), never further out across the frame than its round goes
 * or the open snow reaches, less on an upright screen (where its round is drawn near the eye); it
 * stops on the open snow either side of the board.
 */
function snowPlan(aspect) {
    const trees = FRAME_TREES.filter(([, dist]) => dist < 24).map(([fraction, dist]) => {
        const az = bearingFor(fraction, aspect);
        return [Math.sin(az) * dist, -Math.cos(az) * dist];
    });
    const across = Math.tan(bearingFor(1, aspect));
    const clearance = (x, z) => trees.reduce((m, [tx, tz]) => Math.min(m, Math.hypot(tx - x, tz - z)), Infinity);
    const fractionOf = (x, z) => (z < 0 ? Math.abs(x / -z) / across : Infinity);
    const [near, far] = FOX_WANDER.open;
    return {
        reach: FOX_WANDER.stray * foxRoundPull(aspect),
        allowed: (i, x, z, sx, sz) => clearance(sx, sz) >= Math.min(FOX_WANDER.treeRoom, clearance(x, z))
            && fractionOf(sx, sz) <= Math.max(far, fractionOf(x, z)),
        open: (i, x, z) => {
            const fraction = fractionOf(x, z);
            return fraction >= near && fraction <= far;
        },
    };
}

/** Its round (foxRound(aspect)) as the course its mind goes: the viewer stands at the origin. */
const courseOf = (round, walk) => wanderingCourse(baseOf(round), walk, { height: groundHeight, viewer: [0, 0] });
/** It starts on its way to its stopping place under the moon, already under way. */
const startOf = (round) => round.stations[1] - 11;

export class FoxMind extends WanderingFoxMind {
    /**
     * @param {object} round  foxRound(aspect)
     * @param {number} [seed]
     * @param {object} [o]
     * @param {boolean} [o.wander]  let it wander (the game does; its plain round is what is left)
     * @param {number} [o.aspect]   the frame's (where the snow beside the board is open)
     */
    constructor(round, seed = 0xf0c5, { wander = false, aspect = 16 / 9 } = {}) {
        const walk = wander ? foxWalk(baseOf(round), snowPlan(aspect)) : null;
        super({
            rig: FOX_RIG,
            course: courseOf(round, walk),
            seed,
            start: startOf(round),
            paces: { trot: FOX_TROT, run: foxRunSpeed },
        }, walk ? { ...FOX_WANDER, walk, stops: FOX_WANDER_STOPS } : null);
        this.round = round;
        this.aspect = aspect;
    }

    /** The round changed shape (the frame did): keep its place along it. */
    setRound(round, aspect = this.aspect) {
        this.round = round;
        this.aspect = aspect;
        this.start = startOf(round);
        this.setBase(baseOf(round), snowPlan(aspect), courseOf(round, this.walk));
    }
}
