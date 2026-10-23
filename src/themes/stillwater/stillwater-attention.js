/* eslint-disable max-classes-per-file -- a look held, and the place a run of lights falls: one kit */
/**
 * Stillwater — where each of the two looks, and for how long (CPU only, three-free).
 *
 * A body does not look at every thing that happens. It looks at one thing, holds it a while, and
 * turns to the next only when that is clearly worth more than what it holds, or when it has held
 * the first long enough to let it go. Each figure has one Attention: every frame the story offers
 * it the things there are to look at (`interests`: the other across the water, a light falling,
 * the heart in flight, the sky, the water before them), each with a weight, and it chooses.
 *
 *   dwell   seconds a look is held before something merely better may take it
 *   margin  what holding a look is worth: a rival must beat it by this much
 *   urgent  a rival this much heavier takes the look at once (the heart rising, a light falling
 *           hard in a calm night)
 *
 * Interests that come thick and fast (the lights of a quick run falling on one side) are not
 * offered one by one: the story gathers them into one place that moves smoothly (`Area`), and the
 * figure watches that, the way one watches rain fall on a pond and not each drop.
 */

/** How the two hold their looks: the old troll slow to let go, the spirit a little lighter. */
export const ATTENTION = Object.freeze({
    troll: Object.freeze({ dwell: 1.2, margin: 0.12, urgent: 0.35 }),
    spirit: Object.freeze({ dwell: 0.9, margin: 0.12, urgent: 0.35 }),
});

export class Attention {
    constructor({ dwell = 1, margin = 0.12, urgent = 0.35 } = {}) {
        this.dwell = dwell;
        this.margin = margin;
        this.urgent = urgent;
        this.reset(0);
    }

    reset(time = 0) {
        /** The key of the look held, and since when. */
        this.key = null;
        this.since = time - 100;
        /** Looks taken (a count, for the record and the tests). */
        this.switches = 0;
        /** What was held, kept for when it goes before its dwell is up (the eyes stay where it was). */
        this.ghost = { key: null, at: null, weight: 0 };
    }

    /**
     * Choose what to look at among `interests` ({ key, at, weight }; `at` null = down before them).
     * Returns the interest chosen (one of those offered), or null when none has any weight.
     */
    choose(time, interests) {
        let best = null;
        let bestScore = -Infinity;
        let held = null;
        for (let i = 0; i < interests.length; i++) {
            const it = interests[i];
            if (!(it.weight > 0)) continue;
            const mine = it.key === this.key;
            if (mine) held = it;
            const score = it.weight + (mine ? this.margin : 0);
            if (score > bestScore) {
                bestScore = score;
                best = it;
            }
        }
        // What was held went before its dwell was up: the eyes stay where it was for the rest of it,
        // unless something urgent comes.
        const { ghost } = this;
        if (!held && ghost.key && ghost.key === this.key && time - this.since < this.dwell) {
            if (!best || best.weight < ghost.weight + this.urgent) return ghost;
        }
        let pick = held;
        if (!held) pick = best;
        else if (best && best !== held) {
            const long = time - this.since >= this.dwell;
            if (long || best.weight >= held.weight + this.urgent) pick = best;
        }
        const key = pick ? pick.key : null;
        if (key !== this.key) {
            this.key = key;
            this.since = time;
            this.switches += 1;
        }
        if (pick) {
            ghost.key = pick.key;
            ghost.at = pick.at ? [pick.at[0], pick.at[1], pick.at[2]] : null;
            ghost.weight = pick.weight;
        } else ghost.key = null;
        return pick;
    }
}

/**
 * Where a run of falling lights is falling, on one side: each new one draws the place a share of
 * the way toward it, and what a figure watches follows that place on a slow spring, so a quick run
 * reads as one patch of water being watched, not a head darting from splash to splash.
 */
export class Area {
    constructor() {
        this.reset();
    }

    reset() {
        this.target = null;
        this.at = null;
        this.v = [0, 0, 0];
    }

    /** A light fell at `p` ([x, y, z]). */
    add(p, share = 0.35) {
        if (!this.target) {
            this.target = [p[0], p[1], p[2]];
            this.at = [p[0], p[1], p[2]];
            return;
        }
        for (let i = 0; i < 3; i++) this.target[i] += (p[i] - this.target[i]) * share;
    }

    /** Ease what is watched toward the place (a critically damped spring of `halfLife` seconds). */
    step(dt, halfLife = 0.9) {
        if (!this.target || !(dt > 0)) return this.at;
        const y = (2 * Math.LN2) / halfLife;
        const e = Math.exp(-y * dt);
        for (let i = 0; i < 3; i++) {
            const j0 = this.at[i] - this.target[i];
            const j1 = this.v[i] + j0 * y;
            this.at[i] = e * (j0 + j1 * dt) + this.target[i];
            this.v[i] = e * (this.v[i] - j1 * y * dt);
        }
        return this.at;
    }
}
