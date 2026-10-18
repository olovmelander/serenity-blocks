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
 * to her breast. When the chain breaks they do not turn at once: they look at each other a while,
 * then go back, he slowly, she looking over her shoulder.
 *
 * At rest the story goes on in small things: she kneels at the water's edge and trails her hand in
 * it; he sits with his staff against his shoulder and nods off, and wakes with a start when a light
 * falls hard; now and then one of them looks across, and sometimes the other is looking back.
 *
 * This module only decides what each of them means to do (`trollWant`, `spiritWant`) and the
 * story's own beats (the heart's flight, the path of light, a meeting of eyes); the bodies
 * (stillwater-troll-body.js, stillwater-spirit-body.js) carry it out. Everything is a function of
 * the clock and the events it was told, so a replay meets the same story.
 */

import {
    APPROACH_STEPS, HEART, HUSH_HOLD, SPIRIT, TROLL, clamp01, lerp, smooth,
} from './stillwater-core.js';

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
        /** How far the chain has drawn them (0..1), as the bodies are asked to go. */
        this.bond = 0;
        this.bondTarget = 0;
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
        this.heart = null;
        this.startleAt = -10;
        this.skyAt = -10;
        this.clearAt = -10;
        this.path = 0;
        this.gaze = 0;
        this.ended = false;
        this.lastBondAt = -100;
    }

    // ── What happened ───────────────────────────────────────────────────────────

    /** A piece's light fell into the tarn at `at` (world [x, z]) on `side` (−1 left, +1 right). */
    onLock({
        time, side = 1, at = null, hardDrop = false,
    }) {
        this.lastEvent = time;
        if (at) {
            const point = [at[0], 0.1, at[1]];
            this.lastLock = point;
            // The one whose side it fell on turns to it; a hard drop turns both.
            const who = side < 0 ? 'spirit' : 'troll';
            this.looks.push({
                who, at: point, from: time + 0.12, until: time + 1.7,
            });
            if (hardDrop) {
                this.looks.push({
                    who: who === 'spirit' ? 'troll' : 'spirit', at: point, from: time + 0.3, until: time + 1.4,
                });
            }
        }
        if (hardDrop) this.startleAt = time;
        this.ended = false;
    }

    /** Lines cleared. A four-line clear raises the heart. */
    onClear({ time, lines = 1, perfect = false }) {
        this.lastEvent = time;
        this.clearAt = time;
        const quad = lines >= 4 || perfect;
        if (quad && (!this.heart || time > this.heart.time + HEART_FLIGHT.taken)) {
            this.heart = { time, perfect };
        }
        // Both look out to the tarn's heart, where the swells come from.
        ['troll', 'spirit'].forEach((who) => {
            this.looks.push({
                who, at: [HEART[0], 0.2, HEART[2]], from: time + 0.05, until: time + (quad ? 1.2 : 0.9),
            });
        });
        this.ended = false;
    }

    /** The chain's length now. */
    onCombo(combo, time) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        const was = this.combo;
        const b = chainBond(n);
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
        this.time = time;
        if (this.partingUntil >= 0 && time >= this.partingUntil) {
            // The parting is over: they go back to where the chain (if a new one runs) has them.
            this.partingUntil = -1;
            this.bondTarget = chainBond(this.combo);
        }
        // The bond is what they are asked: up at once, down only after the parting.
        this.bond = this.bondTarget;
        this.trollAt = trollStation(this.bond, this.trollAt);
        // (A chain of one gets him up off his stone; he sits again only after a calm.)
        if (this.trollAt !== 'home' || this.bond > 0.2) this.trollHomeSince = time;
        if (this.bond > 0.05) this.spiritHomeSince = time;
        // (Kept here, not where her wants are read: reading them must not change the story.)
        if (this.bond >= 0.05) this.lastBondAt = time;
        // Old looks and arrivals drop away.
        this.looks = this.looks.filter((l) => l.until > time);
        this.arrivals = this.arrivals.filter((a) => a.at > time - 2);
        if (this.heart && time > this.heart.time + HEART_FLIGHT.held + 2) this.heart = null;
        // The path of light runs between them while the chain holds them near.
        const pathTarget = this.bond >= 0.6 && this.partingUntil < 0 ? 1 : 0;
        const rate = pathTarget > this.path ? 0.35 : 0.6;
        this.path += (pathTarget - this.path) * (1 - Math.exp(-rate * dt * 2));
        this.at = at;
        this.updateGaze(time, dt);
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
        const meet = this.glance('troll', time) && this.glance('spirit', time) ? 1 : 0;
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

    /** Where the heart is on its flight (world), and how brightly it shows; null when it is not flying. */
    heartAt(time, out = [0, 0, 0, 0]) {
        if (!this.heart) return null;
        const t = time - this.heart.time;
        const F = HEART_FLIGHT;
        if (t < F.rise || t > F.held + 1.5) return null;
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

    /** 0..1: how far into being taken the heart is (her flare), with its moment. */
    heartTaken(time) {
        if (!this.heart) return 0;
        const t = time - this.heart.time;
        if (t < HEART_FLIGHT.taken) return 0;
        return Math.exp(-(t - HEART_FLIGHT.taken) / 1.4);
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
        // Going back he walks a little slower, and carries the lantern up where she can see it.
        const goingHome = station === 'home' && me && Math.hypot(me[0] - spot[0], me[1] - spot[2]) > 0.5;
        out.pace = goingHome ? 0.42 : 0.55;
        out.heavy = goingHome;
        // The staff: lifted for light coming home, held out to her while the chain holds, lowered
        // to the water for the heart.
        out.staff = 'walk';
        out.crouch = false;
        out.reach = 0;
        const heartT = this.heart ? time - this.heart.time : -1;
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
        // What he watches: an event, the heart, her (glances, the chain), or the water before him.
        let look = this.eventLook('troll', time);
        if (flying) {
            const h = this.heartAt(time);
            if (h) look = [h[0], h[1], h[2]];
        }
        if (!look && (this.glance('troll', time) || this.bond > 0.3 || this.partingUntil >= 0)) look = spirit;
        if (!look && time - this.skyAt < 2.4) look = [me[0] - 6, 14, me[1] - 20];
        if (!look) look = [me[0] - 3.5, 0.0, me[1] + 0.8];
        out.look = look;
        out.doze = out.sit && calm > DOZE_AFTER;
        // (The moment of the start, for the body to take once however slow the frames are.)
        out.startleAt = this.startleAt;
        out.wind = 0;
        return out;
    }

    /** The spirit's intent for her body: how far out over the water, what her hands do, where she looks. */
    spiritWant(time, out = {}) {
        const at = this.at || {};
        out.out = this.bond;
        const lantern = at.lantern || [TROLL.home[0] - 0.4, 2.4, TROLL.home[2] + 0.3];
        // (Not only in a long silence: while the chain sleeps she goes back down to the water,
        // and pieces falling do not call her up; a chain does.)
        out.kneel = this.bond < 0.05 && time - this.spiritHomeSince > KNEEL_AFTER && !this.heart;
        const heartT = this.heart ? time - this.heart.time : -1;
        out.hands = 'rest';
        if (heartT >= HEART_FLIGHT.rise && heartT < HEART_FLIGHT.taken) out.hands = 'open';
        else if (heartT >= HEART_FLIGHT.taken && heartT < HEART_FLIGHT.held) out.hands = 'heart';
        else if (this.arrivals.some((a) => a.side < 0 && a.at > time - 0.3 && a.at < time + 0.9)) out.hands = 'receive';
        else if (this.bond >= 0.6 && this.partingUntil < 0) out.hands = 'reach';
        let look = this.eventLook('spirit', time);
        if (heartT >= HEART_FLIGHT.rise && heartT < HEART_FLIGHT.taken) {
            const h = this.heartAt(time);
            if (h) look = [h[0], h[1], h[2]];
        }
        if (!look && (this.glance('spirit', time) || this.bond > 0.3 || this.partingUntil >= 0)) look = lantern;
        if (!look && time - this.skyAt < 2.6) look = [-12, 18, -40];
        // Going back to her stone she looks back at him over her shoulder.
        if (!look && this.bond < 0.05 && this.lastBondAt > time - 7) look = lantern;
        out.look = look;
        // At rest she looks down into the water before her stone.
        out.gazeDown = !look;
        out.back = this.bond < 0.05 && this.lastBondAt > time - 7;
        return out;
    }
}
