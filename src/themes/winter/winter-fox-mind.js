/**
 * Winter — what the foxes do. Three-free and renderer-free: a fox's body (winter-fox-rig.js)
 * solves the pose this resolves and the model (winter-fox.js) draws it, so a fox behaves the same
 * with or without either.
 *
 * At rest the fox goes its round over the snowfield and stops now and then: it brakes to a halt,
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
 * side of its round, it stops where it likes on either open side of the board, not only at its
 * two places, and now and then turns right round and goes back the way it came. What is its own
 * here is where on the snowfield it may stray and stop — clear of the framing trees, inside the
 * frame, on the open snow — and how it lives there:
 *
 *  - its paces. It does not only trot: it walks slowly with its nose to the snow, lopes, and
 *    bounds through the snow in arcs, a spell of each, more of the quick ones when it is restless;
 *  - what it does when it stops. Beside every fox's acts it has its own (winter-fox-rig.js): it
 *    scratches behind an ear, rolls in the snow, lies like a sphinx, stands up on its hind legs,
 *    goes round after its tail, leaps high for a mouse and misses, bows and tears round in a
 *    circle. What it chooses leans on the night: under a strong aurora it sits and watches more,
 *    after a chain it lies down;
 *  - what it answers the board with, beside its dash and its pounce: a leap with a turn in it
 *    (`twirl`), a long look at the sky (`gaze`), three bounces on stiff legs (`rejoice`);
 *  - its prints, pressed where its paws are put down.
 *
 * A second fox, the visitor (VisitorMind), is the same animal on another way: a lane across the
 * back of the snowfield that leaves the frame at both ends and comes round behind the viewer.
 */

import {
    bearingFor, foxAt, foxRoundPull, groundHeight,
} from './winter-core.js';
import {
    FOX_ACTS, FOX_RIG, POUNCE_AIR, SLEEP_HOLD, foxStride,
} from './winter-fox-rig.js';
import {
    AFTER_ZOOM, ArcticFoxMind, FOX_PACES, FOX_TROT, FOX_WANDER, FOX_WANDER_STOPS, MOUSE_HIT, MOUSE_MISS, ZOOM,
    arcticPaces, foxRunSpeed, treesFor, withLoops,
} from './winter-fox-life.js';
import { FOX_BLEND, MOUSING, foxGaitAmp } from '../shared/fox-mind.js';
import { foxWalk, wanderingCourse } from '../shared/fox-wander.js';

/** Seconds each thing it does takes (the rig's acts; `Run` is its gait). */
export const FOX_CLIPS = FOX_ACTS;
export {
    AFTER_ZOOM, FOX_BLEND, FOX_PACES, FOX_TROT, FOX_WANDER, FOX_WANDER_STOPS, MOUSE_HIT, MOUSE_MISS, MOUSING,
    POUNCE_AIR, SLEEP_HOLD, ZOOM, foxGaitAmp, foxRunSpeed, foxStride,
};
export {
    VISITOR_AWAY, VISITOR_MEET, VISITOR_STOPS, VISITOR_WANDER, VISITOR_WAY, VisitorMind, visitorWay,
} from './winter-fox-visitor.js';

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
 * stops on the open snow either side of the board. `roam` says where it may tear round in a
 * circle: clear of the trees, in the frame, no nearer the eye and no further out than its round.
 */
function snowPlan(aspect, round) {
    const trees = treesFor(aspect).filter(([x, z]) => Math.hypot(x, z) < 24);
    const across = Math.tan(bearingFor(1, aspect));
    const clearance = (x, z) => trees.reduce((m, [tx, tz]) => Math.min(m, Math.hypot(tx - x, tz - z)), Infinity);
    const fractionOf = (x, z) => (z < 0 ? Math.abs(x / -z) / across : Infinity);
    const [near, far] = FOX_WANDER.open;
    let nearest = Infinity;
    let furthest = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < round.count; i++) {
        const range = Math.hypot(round.points[i * 3], round.points[i * 3 + 1]);
        nearest = Math.min(nearest, range);
        furthest = Math.max(furthest, range);
        cx += round.points[i * 3] / round.count;
        cz += round.points[i * 3 + 1] / round.count;
    }
    return {
        reach: FOX_WANDER.stray * foxRoundPull(aspect),
        allowed: (i, x, z, sx, sz) => clearance(sx, sz) >= Math.min(FOX_WANDER.treeRoom, clearance(x, z))
            && fractionOf(sx, sz) <= Math.max(far, fractionOf(x, z)),
        open: (i, x, z) => {
            const fraction = fractionOf(x, z);
            return fraction >= near && fraction <= far;
        },
        roam: (x, z) => {
            const range = Math.hypot(x, z);
            return clearance(x, z) >= 2 && fractionOf(x, z) <= 0.92 && range >= nearest - 0.2 && range <= furthest + 1;
        },
        centre: [cx, cz],
    };
}

/** Its round (foxRound(aspect)) as the course its mind goes: the viewer stands at the origin. */
const courseOf = (round, walk) => wanderingCourse(baseOf(round), walk, { height: groundHeight, viewer: [0, 0] });
/** It starts on its way to its stopping place under the moon, already under way. */
const startOf = (round) => round.stations[1] - 11;

export class FoxMind extends ArcticFoxMind {
    /**
     * @param {object} round  foxRound(aspect)
     * @param {number} [seed]
     * @param {object} [o]
     * @param {boolean} [o.wander]  let it wander (the game does; its plain round is what is left)
     * @param {number} [o.aspect]   the frame's (where the snow beside the board is open)
     */
    constructor(round, seed = 0xf0c5, { wander = false, aspect = 16 / 9 } = {}) {
        const plan = wander ? snowPlan(aspect, round) : null;
        const walk = wander ? withLoops(foxWalk(baseOf(round), plan)) : null;
        super({
            course: courseOf(round, walk),
            seed,
            start: startOf(round),
            paces: arcticPaces(FOX_RIG),
        }, walk ? { ...FOX_WANDER, walk, stops: FOX_WANDER_STOPS } : null, plan);
        this.round = round;
        this.aspect = aspect;
    }

    /** The round changed shape (the frame did): keep its place along it. */
    setRound(round, aspect = this.aspect) {
        this.round = round;
        this.aspect = aspect;
        this.start = startOf(round);
        this.setBase(baseOf(round), snowPlan(aspect, round), courseOf(round, this.walk));
    }
}
