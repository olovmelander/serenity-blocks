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
 */

import { clamp01, foxAt, groundHeight } from './winter-core.js';
import {
    FOX_ACTS, FOX_RIG, POUNCE_AIR, SLEEP_HOLD, foxStride,
} from './winter-fox-rig.js';
import {
    FOX_BLEND, FoxMind as SharedFoxMind, MOUSING, foxGaitAmp,
} from '../shared/fox-mind.js';

/** Seconds each thing it does takes (the rig's acts; `Run` is its gait). */
export const FOX_CLIPS = FOX_ACTS;
export {
    FOX_BLEND, MOUSING, POUNCE_AIR, SLEEP_HOLD, foxGaitAmp, foxStride,
};

/** Its paces (m/s). */
export const FOX_TROT = 1.5;
export const foxRunSpeed = (power, surge = 0) => 2.7 + 4.1 * clamp01(power) + 1.4 * Math.min(1.4, Math.max(0, surge));

/** Its round (foxRound(aspect)) as the course its mind goes: the viewer stands at the origin. */
const courseOf = (round) => ({
    length: round.length,
    stations: round.stations,
    height: groundHeight,
    viewer: [0, 0],
    at: (distance, out) => foxAt(round, distance, out),
});
/** It starts on its way to its stopping place under the moon, already under way. */
const startOf = (round) => round.stations[1] - 11;

export class FoxMind extends SharedFoxMind {
    /**
     * @param {object} round  foxRound(aspect)
     * @param {number} [seed]
     */
    constructor(round, seed = 0xf0c5) {
        super({
            rig: FOX_RIG,
            course: courseOf(round),
            seed,
            start: startOf(round),
            paces: { trot: FOX_TROT, run: foxRunSpeed },
        });
        this.round = round;
    }

    /** The round changed shape (the frame did): keep its place along it. */
    setRound(round) {
        this.round = round;
        this.start = startOf(round);
        this.setCourse(courseOf(round));
    }
}
