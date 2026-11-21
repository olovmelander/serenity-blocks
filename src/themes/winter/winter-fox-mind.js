/**
 * Winter — what the foxes do. Three-free and renderer-free: a fox's body (winter-fox-rig.js)
 * solves the pose this resolves and the model (winter-fox.js) draws it, so a fox behaves the same
 * with or without either.
 *
 * Every fox here does what the fox mind the themes share does (../shared/fox-mind.js): it brakes
 * to a halt, steps round to face the viewer, and then looks about, sits down to watch the sky,
 * stretches, bows — or hears something under the snow, listens with a paw raised, leaps on it nose
 * first, digs it out and shakes itself off. When the chain grows it runs, faster the longer the
 * chain, its trot opening into a gallop; a clear makes it dash; four lines make it pounce; when the
 * run ends it curls up and sleeps. A ring of powder reaching it flicks its tail. What is the arctic
 * fox's own — its paces, its own acts, its answers to the board, its prints — is
 * winter-fox-life.js.
 *
 * Three foxes are made of that:
 *
 *  - FoxMind, the plain fox, goes a fixed round over the snowfield and stops at its two places.
 *    The tests and the captures that pin an act or a pose use it: where it is at any moment is
 *    plain to see.
 *  - RoamingFoxMind (winter-fox-roam.js) is the game's fox. It goes round no ring: it roams the
 *    snowfield with a mind of its own — hunts, crosses to the other side for fresh snow, sits
 *    under the aurora, grooms, rests, romps, goes over to watch the other fox or the bear — by
 *    a way it lays as it goes.
 *  - VisitorMind (winter-fox-visitor.js) is a second fox of the other coat that roams the back of
 *    the snowfield now and then: it comes in from one side, stays a while, and leaves by either.
 */

import { foxAt, groundHeight } from './winter-core.js';
import {
    FOX_ACTS, FOX_RIG, POUNCE_AIR, SLEEP_HOLD, foxStride,
} from './winter-fox-rig.js';
import {
    AFTER_ZOOM, ArcticFoxMind, FOX_PACES, FOX_TROT, FOX_WANDER, FOX_WANDER_STOPS, MOUSE_HIT, MOUSE_MISS, ZOOM,
    arcticPaces, foxRunSpeed,
} from './winter-fox-life.js';
import { FOX_BLEND, MOUSING, foxGaitAmp } from '../shared/fox-mind.js';

/** Seconds each thing it does takes (the rig's acts; `Run` is its gait). */
export const FOX_CLIPS = FOX_ACTS;
export {
    AFTER_ZOOM, FOX_BLEND, FOX_PACES, FOX_TROT, FOX_WANDER, FOX_WANDER_STOPS, MOUSE_HIT, MOUSE_MISS, MOUSING,
    POUNCE_AIR, SLEEP_HOLD, ZOOM, foxGaitAmp, foxRunSpeed, foxStride,
};
export {
    FOX_ERRANDS, FOX_FOLLOW, FOX_RANGE, FOX_ROMP, FOX_STEER, FoxTrail, RoamingFoxMind, STOP_GROUPS, snowRange,
    stopGroups,
} from './winter-fox-roam.js';
export {
    VISITOR_AWAY, VISITOR_ERRANDS, VISITOR_MEET, VISITOR_RANGE, VISITOR_STAY, VISITOR_STOPS, VisitorMind,
} from './winter-fox-visitor.js';

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

/** The plain fox: the arctic fox on its fixed round over the snowfield (tests, captures). */
export class FoxMind extends ArcticFoxMind {
    /**
     * @param {object} round  foxRound(aspect)
     * @param {number} [seed]
     */
    constructor(round, seed = 0xf0c5) {
        super({
            course: courseOf(round),
            seed,
            start: startOf(round),
            paces: arcticPaces(FOX_RIG),
        }, null);
        this.round = round;
    }

    /** The round changed shape (the frame did): keep its place along it. */
    setRound(round) {
        this.round = round;
        this.start = startOf(round);
        this.setCourse(courseOf(round));
    }
}
