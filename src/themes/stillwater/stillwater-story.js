/**
 * Stillwater — the story the two tell (CPU only, three-free).
 *
 * Long ago the princess dropped her gold heart into the tarn, and she has stayed, a pale spirit
 * on her stone, looking down into the water for it. The old troll of the wood keeps a lantern lit
 * on the far bank. They have never crossed the water.
 *
 * Every piece the player sets down is a light that falls into the tarn; a clear gathers those
 * lights and carries them home, to her hands and to his lantern. A chain of clears draws the two
 * toward each other: he gets up off his stone and plods down to the water, then into it; she
 * rises and drifts out over it, and a path of light begins to run between them on the water.
 * Four lines at once and the heart itself rises out of the tarn: he lowers his lantern to the
 * water to light its way, it comes up gold out of the dark and crosses to her, and she takes it
 * to her breast. Every four lines raise another: a heart never takes the place of one still on
 * its way or in her hands. The next waits on the bed until she has taken the last, and each one
 * she takes adds to the light she holds, so a run of them leaves her burning brighter and longer.
 * When the chain breaks they do not turn at once: they look at each other a while,
 * then go back, he slowly, she looking over her shoulder.
 *
 * At rest the story goes on in small things: she kneels at the water's edge and trails her hand in
 * it; he sits with his staff against his shoulder and nods off, and wakes with a start when a light
 * falls hard; now and then one of them looks across, and sometimes the other is looking back.
 *
 * Between the moments play gives them they live their own small lives, and grow nearer the longer
 * the night goes on (stillwater-life.js): the story asks the life what each is doing, and play
 * always comes first.
 *
 * Where each of them looks is chosen, not dictated (stillwater-attention.js): every frame the story
 * offers each what there is to watch, and a look is held a while before it is let go. A quick run
 * of play does not set their heads darting after every light: the lights falling on a side are
 * gathered into one place that moves smoothly, and that is what they watch.
 *
 * This module only decides what each of them means to do (`trollWant`, `spiritWant`) and the
 * story's own beats (the heart's flight, the path of light, a meeting of eyes); the bodies
 * (stillwater-troll-body.js, stillwater-spirit-body.js) carry it out. Everything is a function of
 * the clock and the events it was told, so a replay meets the same story; reading a want changes
 * nothing.
 */

import {
    APPROACH_STEPS, HEART, HUSH_HOLD, SPIRIT, TROLL, clamp01, lerp, smooth,
} from './stillwater-core.js';
import { Swell, softCeiling } from '../shared/swell.js';
import { ATTENTION, Area, Attention } from './stillwater-attention.js';
import { KIN, StillwaterLife } from './stillwater-life.js';

/** How far along her path she kneels on the water off her stone. */
export const KNEEL_AT = 0.28;
/** Seconds of calm before a hard drop makes him start (in a quick run he is alert, not jolted). */
export const STARTLE_CALM = 2.5;
/** Locks counted over this many seconds make play "busy" (see `busy`). */
const RATE_TIME = 3;
/** A light falling where nothing else is happening is followed down; in a busy run it is not. */
const FOLLOW_BELOW = 0.35;
/** Seconds they wait at the water after a chain lets them go, in the quickest play (none when calm). */
export const LINGER = 4;

/** Seconds the two hold each other's eyes when a chain breaks, before they go back. */
export const PARTING = 2.6;
/** Seconds of calm at home before he sits (and before she kneels at the water). */
export const SIT_AFTER = 6;
export const KNEEL_AFTER = 9;
/** Seconds of calm, seated, before he nods off. */
export const DOZE_AFTER = 16;

/** The heart's flight after a four-line clear, seconds from the clear: rise, cross, taken, held. */
export const HEART_FLIGHT = Object.freeze({
    rise: HUSH_HOLD, surface: HUSH_HOLD + 1.1, crest: HUSH_HOLD + 2.0, taken: HUSH_HOLD + 3.6, held: HUSH_HOLD + 7.5,
});
/** Seconds after she takes one heart before the next waiting on the bed rises. */
export const HEART_GAP = 0.6;
/** Seconds a heart in her breast takes to sink into her own light as the next one rises. */
export const HEART_SINK = 0.5;
/** Hearts waiting on the bed at most: four lines more make the last of them the brighter. */
export const HEART_QUEUE = 3;
/** How near a fever of play draws the two (a bond), whatever the chain: out to the water's edge. */
export const FERVOUR_BOND = 0.62;

/** How far the chain has them (0..1) for a combo. */
export function bondForCombo(combo) {
    const n = Math.max(0, Math.round(Number(combo) || 0));
    return APPROACH_STEPS[Math.min(n, APPROACH_STEPS.length - 1)];
}

/**
 * How far a chain draws them for the combo the game reports. Every clear reports at least 1 (the
 * first clear of a chain), so a single clear is not a chain: it is answered with looks and hands,
 * and only two clears in a row begin to draw them out (he stands, she drifts), three walk him down.
 */
export function chainBond(combo) {
    const n = Math.max(0, Math.round(Number(combo) || 0));
    return bondForCombo(Math.max(0, n - 1));
}

/** The troll's place for a bond, with a step of hysteresis so a wavering chain does not walk him to and fro. */
export function trollStation(bond, current) {
    const up = { home: 0, bank: 1, shallows: 2 };
    let want = 'home';
    if (bond >= 0.7) want = 'shallows';
    else if (bond >= 0.4) want = 'bank';
    if (up[want] >= up[current]) return want;
    // Going back needs the bond to have fallen clearly below the step.
    if (current === 'shallows' && bond < 0.6) return bond < 0.3 ? 'home' : 'bank';
    if (current === 'bank' && bond < 0.3) return 'home';
    return current;
}

/** A point of the spirit's path out over the water, 0 = her stone, 1 = as far as she comes. */
export function spiritPathPoint(s, out = [0, 0, 0]) {
    const k = clamp01(s);
    out[0] = lerp(SPIRIT.home[0], SPIRIT.reach[0], k);
    out[1] = lerp(SPIRIT.home[1], 0.04, smooth(0, 0.18, k));
    out[2] = lerp(SPIRIT.home[2], SPIRIT.reach[2], k);
    return out;
}

/** A small seeded hash (0..1) of an integer and a stream. */
function hash(n, stream) {
    const h = Math.sin((n + 1) * 12.9898 + stream * 78.233) * 43758.5453;
    return h - Math.floor(h);
}

export class StillwaterStory {
    constructor() {
        this.reset(0);
    }

    reset(time = 0) {
        this.time = time;
        this.combo = 0;
        /** How far the chain has drawn them (0..1), and how far out they stand for it (`drawn`). */
        this.bond = 0;
        this.bondTarget = 0;
        this.drawn = 0;
        this.fallSince = -1;
        /** A chain that broke: when, and how long they hold each other's eyes before going back. */
        this.partingUntil = -1;
        this.lastEvent = time - 30;
        this.lastLock = null;
        this.trollAt = 'home';
        this.trollHomeSince = time - SIT_AFTER - 1;
        this.spiritHomeSince = time - KNEEL_AFTER - 1;
        /** Looks the events ask for: { who, at: [x, y, z], from, until }. */
        this.looks = [];
        /** Light arriving: { side, at } (the receiver lifts their hands or the lantern for it). */
        this.arrivals = [];
        /**
         * The hearts four-line clears raised, oldest first: { time (its flight's start), raised
         * (the clear that raised it), gain }. Only one flies at a time; the rest wait on the bed.
         */
        this.hearts = [];
        /** The flare still left of hearts the story has let go of: (amount, as of when). */
        this.spent = 0;
        this.spentAt = time;
        /** What she holds of every heart she has taken: it fades over half a minute. */
        if (this.glory) this.glory.reset();
        else {
            this.glory = new Swell({
                attack: 0.6, release: 30, ceiling: 1.5, knee: 1,
            });
        }
        /** How hot play runs (0..1, the world says): a fever draws them out whatever the chain. */
        this.fervour = 0;
        this.b2bAt = -10;
        this.startleAt = -10;
        this.skyAt = -10;
        this.clearAt = -10;
        this.path = 0;
        this.gaze = 0;
        this.ended = false;
        this.lastBondAt = -100;
        /** How quick play runs: locks counted over a few seconds, and that read as 0..1. */
        this.rate = 0;
        this.busy = 0;
        /** Where a run of lights is falling, on her side and on his. */
        if (!this.areas) this.areas = { spirit: new Area(), troll: new Area() };
        this.areas.spirit.reset();
        this.areas.troll.reset();
        this.locks = 0;
        /** Where each is looking (chosen every update), and what else there was to look at. */
        if (!this.attention) {
            this.attention = { troll: new Attention(ATTENTION.troll), spirit: new Attention(ATTENTION.spirit) };
            this.interests = { troll: [], spirit: [] };
            this._pool = { troll: [], spirit: [] };
        }
        this.attention.troll.reset(time);
        this.attention.spirit.reset(time);
        this.lookOf = { troll: null, spirit: null };
        this.lookKey = { troll: null, spirit: null };
        /** Their eyes met (both looking at the other), and since when. */
        this.meeting = false;
        this.meetSince = -100;
        /** A small answer to a clear while they watch play: a nod, a clap. */
        this.reflex = { troll: null, spirit: null, at: -100 };
        /** Whether play has them now (a chain, the heart, a parting): the life waits. */
        this.engaged = false;
        if (!this.life) this.life = new StillwaterLife();
        this.life.reset(time, this.kinAtReset ?? KIN.start);
        this._ctx = {};
    }

    /** How near the two have grown (0..1). */
    get kin() {
        return this.life.kin;
    }

    /** Set how near they have grown (captures; a seek keeps it through the reset). */
    setKin(kin) {
        this.kinAtReset = clamp01(Number(kin) || 0);
        this.life.kin = this.kinAtReset;
    }

    // ── What happened ───────────────────────────────────────────────────────────

    /** A piece's light fell into the tarn at `at` (world [x, z]) on `side` (−1 left, +1 right). */
    onLock({
        time, side = 1, at = null, hardDrop = false,
    }) {
        const calm = time - this.lastEvent;
        this.lastEvent = time;
        this.rate += 1;
        this.locks += 1;
        const who = side < 0 ? 'spirit' : 'troll';
        if (at) {
            const point = [at[0], 0.1, at[1]];
            this.lastLock = point;
            this.areas[who].add(point);
            // In a calm night the one whose side it fell on follows it down, and a hard drop turns
            // both; in a quick run they watch where the lights are falling, not each light.
            if (this.busy < FOLLOW_BELOW) {
                const key = `lock${this.locks}`;
                // (A hard one out of a calm is a start: it takes the eyes from anything but the heart.)
                let weight = hardDrop ? 1 : 0.6;
                if (hardDrop && calm > STARTLE_CALM) weight = 1.35;
                this.looks.push({
                    who, at: point, from: time + 0.12, until: time + 1.7, key, weight,
                });
                if (hardDrop) {
                    const other = who === 'spirit' ? 'troll' : 'spirit';
                    this.looks.push({
                        who: other, at: point, from: time + 0.3, until: time + 1.5, key, weight: 0.6,
                    });
                }
            }
        }
        // A hard drop out of a calm makes him start; one in a quick run he takes in his stride.
        if (hardDrop && calm > STARTLE_CALM) this.startleAt = time;
        this.ended = false;
    }

    /** The newest heart raised, or null. */
    get heart() {
        return this.hearts.length ? this.hearts[this.hearts.length - 1] : null;
    }

    /**
     * Four lines raise a heart. It never takes the place of another: one still on its way or in
     * her hands is followed, the next rising from the bed as soon as she has taken the last.
     */
    raiseHeart(time, gain = 1) {
        const F = HEART_FLIGHT;
        const last = this.heart;
        let waiting = 0;
        for (let i = 0; i < this.hearts.length; i++) if (this.hearts[i].time + F.rise > time) waiting += 1;
        if (last && waiting >= HEART_QUEUE) {
            // The bed holds as many as it will: the last of them comes up the brighter for it.
            last.gain = Math.min(3, last.gain + gain * 0.5);
            this.glory.hit(gain * 0.5, last.time + F.taken);
            return;
        }
        const start = last ? Math.max(time, last.time + F.taken - F.rise + HEART_GAP) : time;
        this.hearts.push({ time: start, raised: time, gain });
        this.glory.hit(gain, start + F.taken);
    }

    /** Lines cleared. A four-line clear raises the heart. */
    onClear({ time, lines = 1, perfect = false }) {
        this.lastEvent = time;
        this.clearAt = time;
        const quad = lines >= 4 || perfect;
        if (quad) this.raiseHeart(time, perfect ? 1.4 : 1);
        this.life.grow(KIN.line * Math.max(1, Number(lines) || 1));
        // Both look out to the tarn's heart, where the swells come from: in a calm night fully, in
        // a quick run only if nothing holds them more (they are watching their own sides).
        const weight = quad ? 0.8 : 0.3 + 0.6 * (1 - this.busy);
        ['troll', 'spirit'].forEach((who) => {
            const until = time + (quad ? 1.6 : 1.3);
            this.looks.push({
                who, at: [HEART[0], 0.2, HEART[2]], from: time + 0.05, until, key: 'tarn', weight,
            });
        });
        // While they watch play they answer a clear in small ways: he nods, she claps for more
        // than one line (not every clear: they are not puppets of it).
        if (!quad && this.busy < 0.6 && time - this.reflex.at > 6) {
            this.reflex.at = time;
            this.reflex.troll = { name: 'nod', start: time + 0.35, length: 1.3 };
            const clap = lines >= 2;
            this.reflex.spirit = { name: clap ? 'clap' : 'nod', start: time + 0.25, length: clap ? 1.8 : 1.3 };
        }
        this.ended = false;
    }

    /**
     * A perfect clear settled on the four lines still playing: the heart they raised comes up the
     * brighter (or one rises, if none is on its way), and both look up as the mist lifts.
     */
    onCrown(time) {
        this.lastEvent = time;
        this.skyAt = time;
        const last = this.heart;
        if (last && time < last.time + HEART_FLIGHT.taken) {
            last.gain = Math.min(3, last.gain + 0.5);
            this.glory.hit(0.5, last.time + HEART_FLIGHT.taken);
        } else this.raiseHeart(time, 1.4);
        this.ended = false;
    }

    /** A second difficult clear in a row: the two look at each other across the water. */
    onB2B(time) {
        this.lastEvent = time;
        this.b2bAt = time;
        const at = this.at || {};
        const spirit = at.spiritHeart || [SPIRIT.home[0], SPIRIT.home[1] + 1.2, SPIRIT.home[2]];
        const lantern = at.lantern || [TROLL.home[0] - 0.4, 2.4, TROLL.home[2] + 0.3];
        this.looks.push({
            who: 'troll', at: spirit, from: time + 0.05, until: time + 1.8, key: 'partner', weight: 0.9,
        });
        this.looks.push({
            who: 'spirit', at: lantern, from: time + 0.05, until: time + 1.8, key: 'partner', weight: 0.9,
        });
        this.ended = false;
    }

    /** How hot play runs (0..1): a fever draws them out to the water whatever the chain. */
    setFervour(fervour) {
        this.fervour = clamp01(Number(fervour) || 0);
    }

    /** The chain's length now. */
    onCombo(combo, time) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        const was = this.combo;
        const b = chainBond(n);
        if (n > was && n >= 2) this.life.grow(KIN.chain * (n - Math.max(1, was)));
        if (n < was) {
            // The chain broke (or broke and a new one has already begun): if that leaves them less
            // near, they hold each other's eyes a while before they go back to where the new one has them.
            if (this.bondTarget > b) {
                if (this.partingUntil < 0) this.partingUntil = time + PARTING;
            } else this.bondTarget = b;
        } else if (n > 0) {
            // The chain grows (or holds): it never sends them back. A new chain that has caught up
            // with where they stand ends the parting.
            if (this.partingUntil >= 0) {
                if (b >= this.bondTarget) {
                    this.partingUntil = -1;
                    this.bondTarget = b;
                }
            } else this.bondTarget = Math.max(this.bondTarget, b);
        }
        this.combo = n;
        this.lastEvent = time;
    }

    /** Light coming home: `side` −1 to her hands, +1 to his lantern, arriving at `at`. */
    onArrival(side, at) {
        this.arrivals.push({ side, at });
        if (this.arrivals.length > 24) this.arrivals.shift();
    }

    /** The hour turned: both look up. */
    onLevel(time) {
        this.skyAt = time;
        this.lastEvent = time;
    }

    /** The run ended (or a new one began): no parting look, they go home. */
    onEnd(time) {
        this.combo = 0;
        this.bondTarget = 0;
        // (Play has stopped: nothing is quick about it now, so nobody lingers at the water.)
        this.rate = 0;
        this.busy = 0;
        this.partingUntil = time + 0.8;
        this.ended = true;
        this.lastEvent = time;
    }

    // ── The frame ───────────────────────────────────────────────────────────────

    /**
     * @param {number} time
     * @param {number} dt
     * @param {object} at  where things are now (world): { spiritHeart, lantern, troll: [x, z] }
     */
    update(time, dt, at) {
        const prev = this.time;
        this.time = time;
        if (this.partingUntil >= 0 && time >= this.partingUntil) {
            // The parting is over: they go back to where the chain (if a new one runs) has them.
            this.partingUntil = -1;
            this.bondTarget = chainBond(this.combo);
        }
        // The bond is what they are asked: up at once, down only after the parting. A fever of play
        // draws them out too, chain or none, and lets them go as it cools.
        this.bond = Math.max(this.bondTarget, FERVOUR_BOND * this.fervour);
        // Where they stand follows the bond out at once; back, in a quick run, only once it has
        // stayed lower a few seconds (another chain is likely on its way: they wait at the water
        // for it instead of trudging home to come straight back).
        if (this.bond >= this.drawn) {
            this.drawn = this.bond;
            this.fallSince = -1;
        } else {
            if (this.fallSince < 0) this.fallSince = time;
            if (time - this.fallSince >= LINGER * this.busy) this.drawn = this.bond;
        }
        this.trollAt = trollStation(this.drawn, this.trollAt);
        // (A chain of one gets him up off his stone; he sits again only after a calm.)
        if (this.trollAt !== 'home' || this.drawn > 0.2) this.trollHomeSince = time;
        if (this.drawn > 0.05) this.spiritHomeSince = time;
        // (Kept here, not where her wants are read: reading them must not change the story.)
        if (this.drawn >= 0.05) this.lastBondAt = time;
        // Old looks and arrivals drop away.
        this.looks = this.looks.filter((l) => l.until > time);
        this.arrivals = this.arrivals.filter((a) => a.at > time - 2);
        // Every heart she takes brings them nearer.
        for (let i = 0; i < this.hearts.length; i++) {
            const taken = this.hearts[i].time + HEART_FLIGHT.taken;
            if (prev < taken && time >= taken) this.life.grow(KIN.heart * this.hearts[i].gain);
        }
        for (let i = this.hearts.length - 1; i >= 0; i--) {
            const h = this.hearts[i];
            if (time <= h.time + HEART_FLIGHT.held + 2) continue;
            // (What is left of its flare dies away as it would have.)
            this.spent = this.spentFlare(time) + h.gain * Math.exp(-(time - h.time - HEART_FLIGHT.taken) / 1.4);
            this.spentAt = time;
            this.hearts.splice(i, 1);
        }
        // The path of light runs between them while the chain holds them near.
        const pathTarget = this.bond >= 0.6 && this.partingUntil < 0 ? 1 : 0;
        const rate = pathTarget > this.path ? 0.35 : 0.6;
        this.path += (pathTarget - this.path) * (1 - Math.exp(-rate * dt * 2));
        if (this.path > 0.5) this.life.grow(KIN.path * Math.max(0, dt));
        this.at = at;
        // How quick play runs, and where its lights are falling.
        if (dt > 0) this.rate *= Math.exp(-dt / RATE_TIME);
        this.busy = clamp01((this.rate - 2) / 4);
        this.areas.troll.step(dt);
        this.areas.spirit.step(dt);
        // Play has them (a chain, the heart, a parting, the walk home after): the life waits.
        this.engaged = this.drawn > 0.05 || this.partingUntil >= 0 || this.hearts.length > 0
            || this.lastBondAt > time - 7 || this.trollAt !== 'home';
        this.updateLife(time, dt);
        this.updateLooks(time);
        this.updateGaze(time, dt);
    }

    /** Step the life the two live between the moments play gives them. */
    updateLife(time, dt) {
        const at = this.at || {};
        const c = this._ctx;
        c.calm = time - this.lastEvent;
        c.busy = this.busy;
        c.engaged = this.engaged;
        c.meet = this.meeting;
        c.troll = at.troll || [TROLL.home[0], TROLL.home[2]];
        c.trollMode = at.trollMode || 'standing';
        c.trollSpeed = at.trollSpeed || 0;
        c.spirit = at.spirit || SPIRIT.home;
        c.spiritMode = at.spiritMode || 'standing';
        c.lantern = at.lantern || [TROLL.home[0] - 0.4, 2.4, TROLL.home[2] + 0.3];
        c.spiritHeart = at.spiritHeart || [SPIRIT.home[0], SPIRIT.home[1] + 1.2, SPIRIT.home[2]];
        this.life.update(time, dt, c);
    }

    /** The things one of them might look at now, each with what it is worth to them. */
    interestsOf(who, time) {
        const list = this.interests[who];
        const pool = this._pool[who];
        list.length = 0;
        const add = (key, at, weight) => {
            for (let i = 0; i < list.length; i++) {
                // (One thing offered twice is worth the more of the two.)
                if (list[i].key === key) {
                    if (weight > list[i].weight) {
                        list[i].weight = weight;
                        list[i].at = at;
                    }
                    return;
                }
            }
            const it = pool[list.length] || (pool[list.length] = { key: '', at: null, weight: 0 });
            it.key = key;
            it.at = at;
            it.weight = weight;
            list.push(it);
        };
        const at = this.at || {};
        const troll = who === 'troll';
        const me = at.troll || [TROLL.home[0], TROLL.home[2]];
        const partner = troll
            ? (at.spiritHeart || [SPIRIT.home[0], 1.2, SPIRIT.home[2]])
            : (at.lantern || [TROLL.home[0] - 0.4, 2.4, TROLL.home[2] + 0.3]);
        // At rest: the water before him; down into the water before her.
        if (troll) add('water', [me[0] - 3.5, 0.0, me[1] + 0.8], 0.3);
        else add('down', null, 0.3);
        // The other, across the water: more for a glance, a chain, a parting, her way home.
        let other = 0.12 + 0.18 * this.life.kin;
        if (this.glance(who, time)) other = 0.62;
        if (this.bond > 0.3) other = 0.78 + 0.12 * this.bond;
        if (!troll && this.drawn < 0.05 && this.lastBondAt > time - 7) other = 0.8;
        if (this.partingUntil >= 0) other = 0.95;
        add('partner', partner, other);
        // Where the lights of a quick run are falling on their side.
        const area = this.areas[who];
        if (area.at && this.busy > 0.1) add('area', area.at, 0.35 + 0.45 * this.busy);
        // What play pointed them at.
        for (let i = 0; i < this.looks.length; i++) {
            const l = this.looks[i];
            if (l.who === who && time >= l.from && time < l.until) add(l.key || `look${i}`, l.at, l.weight ?? 0.8);
        }
        // The sky turning.
        if (time - this.skyAt < 2.4) add('sky', troll ? [me[0] - 6, 14, me[1] - 20] : [-12, 18, -40], 0.85);
        // The heart in flight, above all.
        for (let i = this.hearts.length - 1; i >= 0; i--) {
            const t = time - this.hearts[i].time;
            if (t >= HEART_FLIGHT.rise && t < HEART_FLIGHT.taken) {
                const h = this.heartAt(time);
                if (h) add('heart', [h[0], h[1], h[2]], 1.2);
                break;
            }
        }
        // What they are doing between times.
        const life = this.life[who];
        if (!this.engaged && life.look) add(life.look.key, life.look.at, life.look.weight);
        return list;
    }

    /** Each chooses what to look at (holding a look a while before letting it go). */
    updateLooks(time) {
        ['troll', 'spirit'].forEach((who) => {
            const pick = this.attention[who].choose(time, this.interestsOf(who, time));
            this.lookOf[who] = pick ? pick.at : null;
            this.lookKey[who] = pick ? pick.key : null;
        });
        const meeting = this.lookKey.troll === 'partner' && this.lookKey.spirit === 'partner';
        if (meeting && !this.meeting) this.meetSince = time;
        this.meeting = meeting;
    }

    /** Idle glances: every so often one looks across; sometimes the other looks back. */
    glance(who, time) {
        // Slots of ~9 s (him) and ~13 s (her): in each, one glance of ~2.4 s at a seeded moment.
        const period = who === 'troll' ? 9 : 13;
        const stream = who === 'troll' ? 1 : 2;
        const slot = Math.floor(time / period);
        const start = (slot + 0.15 + hash(slot, stream) * 0.55) * period;
        const length = 2.2 + hash(slot, stream + 7) * 1.2;
        return time >= start && time < start + length;
    }

    updateGaze(time, dt) {
        const meet = this.meeting || time - this.b2bAt < 1.8 ? 1 : 0;
        const parting = this.partingUntil >= 0 ? 1 : 0;
        const target = Math.max(meet, parting, this.bond >= 0.6 ? 0.6 : 0);
        this.gaze += (target - this.gaze) * (1 - Math.exp(-dt * (target > this.gaze ? 2.5 : 1.2)));
    }

    /** The current event look for one of them, or null. */
    eventLook(who, time) {
        let best = null;
        for (let i = 0; i < this.looks.length; i++) {
            const l = this.looks[i];
            if (l.who === who && time >= l.from && time < l.until) best = l;
        }
        return best ? best.at : null;
    }

    /**
     * Where the heart is (world), and how brightly it shows: the one on its way if one is flying,
     * else the newest in her breast (sinking into her as the next rises); null when there is none.
     */
    heartAt(time, out = [0, 0, 0, 0]) {
        const F = HEART_FLIGHT;
        const { hearts } = this;
        for (let i = hearts.length - 1; i >= 0; i--) {
            const t = time - hearts[i].time;
            if (t >= F.rise && t < F.taken) return this.flightAt(t, out);
        }
        for (let i = hearts.length - 1; i >= 0; i--) {
            const t = time - hearts[i].time;
            if (t < F.taken || t > F.held + 1.5) continue;
            this.flightAt(t, out);
            const next = hearts[i + 1];
            if (next) {
                // The next is about to rise: the one she holds sinks into her own light first.
                const rise = next.time + F.rise;
                out[3] *= 1 - smooth(Math.max(rise - HEART_SINK, next.raised), rise, time);
            }
            return out;
        }
        return null;
    }

    /** A heart `t` seconds into its flight (rise..held): where, and how brightly. */
    flightAt(t, out) {
        const F = HEART_FLIGHT;
        const to = this.at?.spiritHeart || [SPIRIT.home[0], SPIRIT.home[1] + 1.2, SPIRIT.home[2]];
        const surface = [HEART[0], 0.05, HEART[2]];
        const crest = [lerp(HEART[0], to[0], 0.35), 2.6, lerp(HEART[2], to[2], 0.35)];
        if (t < F.surface) {
            const k = smooth(F.rise, F.surface, t);
            out[0] = HEART[0];
            out[1] = lerp(HEART[1], surface[1], k);
            out[2] = HEART[2];
            out[3] = 0.4 + 0.6 * k;
        } else if (t < F.crest) {
            const k = smooth(F.surface, F.crest, t);
            out[0] = lerp(surface[0], crest[0], k);
            out[1] = lerp(surface[1], crest[1], Math.sin(k * Math.PI * 0.5));
            out[2] = lerp(surface[2], crest[2], k);
            out[3] = 1;
        } else if (t < F.taken) {
            const k = smooth(F.crest, F.taken, t);
            out[0] = lerp(crest[0], to[0], k);
            out[1] = lerp(crest[1], to[1], k) + Math.sin(k * Math.PI) * 0.4;
            out[2] = lerp(crest[2], to[2], k);
            out[3] = 1;
        } else {
            // Taken: it is in her now, and fades into her own light.
            out[0] = to[0];
            out[1] = to[1];
            out[2] = to[2];
            out[3] = 1 - smooth(F.taken, F.held, t);
        }
        return out;
    }

    /**
     * Her flare as she takes a heart (1 at the moment, dying away). Hearts taken one after another
     * add to it (under a soft ceiling): a new one never puts out the last one's light.
     */
    heartTaken(time) {
        let sum = this.spentFlare(time);
        for (let i = 0; i < this.hearts.length; i++) {
            const h = this.hearts[i];
            const t = time - h.time;
            if (t >= HEART_FLIGHT.taken) sum += h.gain * Math.exp(-(t - HEART_FLIGHT.taken) / 1.4);
        }
        return softCeiling(sum, 1, 1.8);
    }

    /** What is left of the flare of hearts already let go of. */
    spentFlare(time) {
        if (!(this.spent > 1e-6)) return 0;
        return this.spent * Math.exp(-Math.max(0, time - this.spentAt) / 1.4);
    }

    /** What she holds of every heart she has taken (0..1.5): a slow light that outlasts the flare. */
    heartsHeld(time) {
        return this.glory.valueAt(time);
    }

    // ── What each of them means to do ───────────────────────────────────────────

    /**
     * The troll's intent for his body (see TrollBody.update): where to stand, what to face, what
     * to do with the staff, what to watch.
     */
    trollWant(time, out = {}) {
        const at = this.at || {};
        const station = this.trollAt;
        const spots = { home: TROLL.home, bank: TROLL.reach, shallows: TROLL.shallows };
        const spot = spots[station] || TROLL.home;
        out.at = [spot[0], spot[2]];
        const spirit = at.spiritHeart || [SPIRIT.home[0], 1.2, SPIRIT.home[2]];
        const me = at.troll || [spot[0], spot[2]];
        out.face = Math.atan2(spirit[0] - me[0], spirit[2] - me[1]);
        const calm = time - this.lastEvent;
        out.sit = station === 'home' && time - this.trollHomeSince > SIT_AFTER && this.partingUntil < 0;
        // Going back from a chain he walks a little slower, and carries the lantern up where she can
        // see it. (Not on his way back from his own errands: that is just a walk.)
        const fromChain = !(this.life.troll.scene && !this.engaged) && this.lastBondAt > time - 25;
        const goingHome = station === 'home' && fromChain && me && Math.hypot(me[0] - spot[0], me[1] - spot[2]) > 0.5;
        out.pace = goingHome ? 0.42 : 0.55;
        out.heavy = goingHome;
        // The staff: lifted for light coming home, held out to her while the chain holds, lowered
        // to the water for the heart.
        out.staff = 'walk';
        out.crouch = false;
        out.reach = 0;
        // (The newest heart on its way: an older one is already in her hands.)
        let heartT = -1;
        for (let i = this.hearts.length - 1; i >= 0; i--) {
            const t = time - this.hearts[i].time;
            if (t >= 0) {
                heartT = t;
                break;
            }
        }
        const flying = heartT >= 0 && heartT < HEART_FLIGHT.taken + 0.6;
        if (flying) {
            if (station !== 'home' && heartT < HEART_FLIGHT.crest) {
                out.crouch = true;
                out.staff = 'dip';
            } else out.staff = 'raise';
        } else if (this.arrivals.some((a) => a.side > 0 && a.at > time - 0.35 && a.at < time + 0.8)) {
            out.staff = 'raise';
        } else if (this.bond >= 0.6 && station !== 'home' && this.partingUntil < 0) {
            out.staff = 'offer';
            out.reach = 0.0;
        } else if (goingHome) out.staff = 'high';
        out.faceFixed = false;
        out.gesture = null;
        out.scene = null;
        // Between the moments play gives him, what he is doing with his night.
        const life = this.engaged ? null : this.life.troll;
        if (life && life.scene) {
            out.scene = life.scene;
            if (life.at) out.at = [life.at[0], life.at[1]];
            if (life.sit !== null) out.sit = life.sit;
            if (life.crouch !== null) out.crouch = life.crouch;
            if (life.pace) out.pace = life.pace;
            if (life.face !== null) {
                out.face = life.face;
                out.faceFixed = true;
            }
            // (Light coming home still lifts the lantern: that is play's.)
            if (life.staff && out.staff === 'walk') out.staff = life.staff;
            out.gesture = life.gesture;
        }
        const reflex = this.reflex.troll;
        if (!out.gesture && reflex && time >= reflex.start && time < reflex.start + reflex.length) out.gesture = reflex;
        // What he watches (chosen in the update, and held a while: see stillwater-attention.js).
        out.look = this.lookOf.troll;
        out.lookKey = this.lookKey.troll;
        out.doze = out.sit && calm > DOZE_AFTER && !out.scene;
        // (The moment of the start, for the body to take once however slow the frames are.)
        out.startleAt = this.startleAt;
        out.wind = 0;
        return out;
    }

    /** The spirit's intent for her body: how far out over the water, what her hands do, where she looks. */
    spiritWant(time, out = {}) {
        out.out = this.drawn;
        // (Not only in a long silence: while the chain sleeps she goes back down to the water,
        // and pieces falling do not call her up; a chain does.)
        out.kneel = this.drawn < 0.05 && time - this.spiritHomeSince > KNEEL_AFTER && !this.hearts.length;
        // Open for a heart on its way (before the one she holds), else holding one to her breast.
        let open = false;
        let holding = false;
        for (let i = 0; i < this.hearts.length; i++) {
            const t = time - this.hearts[i].time;
            if (t >= HEART_FLIGHT.rise && t < HEART_FLIGHT.taken) open = true;
            else if (t >= HEART_FLIGHT.taken && t < HEART_FLIGHT.held) holding = true;
        }
        out.hands = 'rest';
        if (open) out.hands = 'open';
        else if (holding) out.hands = 'heart';
        else if (this.arrivals.some((a) => a.side < 0 && a.at > time - 0.3 && a.at < time + 0.9)) out.hands = 'receive';
        else if (this.bond >= 0.6 && this.partingUntil < 0) out.hands = 'reach';
        out.back = this.drawn < 0.05 && this.lastBondAt > time - 7;
        // How she turns: out to him, back to her stone, at rest a little toward the tarn's heart.
        // (Not by what she glances at: her head turns for a glance, not all of her.)
        out.faceMode = 'rest';
        if (this.drawn > 0.05) out.faceMode = 'lantern';
        else if (out.back) out.faceMode = 'home';
        out.face = null;
        out.at = null;
        out.pace = null;
        out.gesture = null;
        out.scene = null;
        const life = this.engaged ? null : this.life.spirit;
        if (life && life.scene) {
            out.scene = life.scene;
            if (life.at) {
                out.at = [life.at[0], life.at[1], life.at[2]];
                out.faceMode = 'path';
            }
            if (life.kneel !== null) out.kneel = life.kneel;
            if (life.pace) out.pace = life.pace;
            if (life.face !== null) {
                out.face = life.face;
                out.faceMode = 'abs';
            }
            if (life.hands && out.hands === 'rest') out.hands = life.hands;
            out.gesture = life.gesture;
        }
        const reflex = this.reflex.spirit;
        if (!out.gesture && reflex && time >= reflex.start && time < reflex.start + reflex.length) out.gesture = reflex;
        // What she watches (chosen in the update, held a while); at rest, down into the water.
        out.look = this.lookOf.spirit;
        out.lookKey = this.lookKey.spirit;
        out.gazeDown = !out.look;
        return out;
    }
}
