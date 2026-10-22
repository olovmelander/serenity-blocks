/**
 * Rainbark — the event table's writer (§4.11): renderer-free, DOM-free.
 *
 * The world hands it numbers when the board does something (a peel, a knock, …); every frame it
 * writes the live slots of each block into the event table (one vec4 uniform array, EVENT_ROWS),
 * COMPACTED to the front of the block, and reports how many are live, so the near bark's loops
 * run only over what exists (gotcha #110). Nothing is allocated after construction: slots are
 * plain records recycled in place.
 *
 *   peels   16 × 3  (code, yTop, yBot, t0) (θc, half arc, piece age, radius) (tKill, life, hard, seed)
 *   knocks   4 × 1  (code, y0, t0, strength)
 *   girdles 16 × 3  (code, yC, halfH, t0) (codes lo, codes hi, θL, arc span) (strength, tKill, life, blaze)
 *   helices  6 × 2  (code, yTop, turns, t0) (pitch, θ0, width, tKill)
 *   moult    1 × 1  (base front t0, shown 0 … 1, 0, latest front t1)
 *   gaps     7 × 1  (qx, qz, radius, open): station order, so the open ones are always a prefix
 *                   (the world fills them every frame; gapCount = one past the last open one)
 *
 * A peel lives its `life` (eroding back into the mosaic over the last of it); when more than
 * PEEL.held are standing (more while play runs hot: the world passes how many), the oldest is told
 * to erode now (over PEEL.kill), so a burst of locks never pops a band off: there is always a slot
 * for the one in flight.
 *
 * Under fast play nothing in flight is cut. A full block gives up the slot nearest its own end
 * (one already eroding, healing or spent), never the newest. A ring cleared again where a ring
 * already stands is not a second ring over the first: the standing one RE-BLAZES (`blaze`, a front
 * sweeping down it again from First Skin, ripening back), so the rows a chain clears over and
 * over keep burning instead of churning the pool. A second Great Moult never restarts the first:
 * its front sweeps down again from the top, re-stripping what had ripened, while below it the
 * colour keeps climbing back from the first (the base front `t0` keeps what stands stripped; the
 * latest `t1` is what the colour climbs back from).
 */

import {
    EVENT_ROWS, EVENT_SLOTS, HELIX, KNOCK, MOULT, PEEL, SHED,
} from './rainbark-core.js';

/** Ranks (35 m each) of the farthest trunk a moult's timing must cover. */
const MOULT_RANKS = 6;
/** A moult's front has swept every trunk in view by this long after it began. */
export const MOULT_SWEPT = MOULT.creak + MOULT.front + MOULT.rankDelay * MOULT_RANKS + 0.1;
/** The last of a front's colour has climbed back by this long after it began. */
export const MOULT_RIPE = MOULT.ripenAt + MOULT.span + MOULT.flame + MOULT.rankRipen * MOULT_RANKS + 0.3;
/** A moult fades in over this long (hidden under its creak) and out over this long once ripe. */
const MOULT_FADE_IN = 0.3;
const MOULT_FADE_OUT = 1.5;
/** A ring that re-blazed may blaze again once its colour has climbed back (seconds after). */
export const REBLAZE_AFTER = SHED.ripen + SHED.ripenFor + 10 * SHED.cell + 0.2;

const makePeel = () => ({
    code: 0, yTop: 0, yBot: 0, t0: 0, theta: 0, half: 0, age: 0, radius: 1, kill: Infinity, life: 120, hard: 0, seed: 0,
});
const makeKnock = () => ({
    code: 0, y0: 0, t0: -1e6, strength: 0,
});
const makeHelix = () => ({
    code: 0, yTop: 0, turns: 1, t0: 0, pitch: 1, theta: 0, width: 0.3, kill: Infinity,
});
const makeGirdle = () => ({
    code: 0,
    yC: 0,
    halfH: 0.2,
    t0: 0,
    lo: 0,
    hi: 0,
    thetaL: 0,
    span: 1,
    strength: 1,
    kill: Infinity,
    life: 90,
    blaze: 0,
    touched: 0,
});

/** When a mark has fully eroded (its natural end, or PEEL.kill after it was told to go). */
const markEnd = (m) => Math.min(m.t0 + m.life, m.kill + PEEL.kill);

/** The index of the record nearest its end in a list (the slot a full block gives up). */
function nearestEnd(list, endOf) {
    let best = 0;
    let bestEnd = Infinity;
    for (let i = 0; i < list.length; i++) {
        const end = endOf(list[i]);
        if (end < bestEnd || (end === bestEnd && list[i].t0 < list[best].t0)) {
            best = i;
            bestEnd = end;
        }
    }
    return best;
}

export class RainbarkEvents {
    constructor() {
        this.peelPool = Array.from({ length: EVENT_SLOTS.peels }, makePeel);
        /** The live peels, oldest first (references into peelPool). */
        this.peels = [];
        this.knockPool = Array.from({ length: EVENT_SLOTS.knocks }, makeKnock);
        this.knocks = [];
        this.girdlePool = Array.from({ length: EVENT_SLOTS.girdles }, makeGirdle);
        this.girdles = [];
        this.helixPool = Array.from({ length: EVENT_SLOTS.helices }, makeHelix);
        this.helices = [];
        /**
         * The Great Moult in flight: its base front (what stands stripped), its latest front (what
         * the colour climbs back from), when this showing began (`start`, never moved by a second
         * front) and when it began to fade in (`on`), and whether it shows.
         */
        this.moult = {
            t0: -1e6, t1: -1e6, start: -1e6, on: -1e6, active: 0,
        };
        this.serial = 0;
        /** The canopy gaps, in station order (the world writes them each frame). */
        this.gaps = Array.from({ length: EVENT_SLOTS.gaps }, () => ({
            qx: 0, qz: 0, radius: 0, open: 0,
        }));
        this.counts = {
            peels: 0, knocks: 0, girdles: 0, helices: 0, gaps: 0,
        };
    }

    /** Drop everything in flight (a seek, a rebuild). */
    reset() {
        this.peels.length = 0;
        this.knocks.length = 0;
        this.girdles.length = 0;
        this.helices.length = 0;
        this.moult.t0 = -1e6;
        this.moult.t1 = -1e6;
        this.moult.start = -1e6;
        this.moult.on = -1e6;
        this.moult.active = 0;
        this.serial = 0;
        for (let i = 0; i < this.gaps.length; i++) this.gaps[i].open = 0;
    }

    /** The moment a peel has fully eroded (its natural end, or PEEL.kill after it was told to go). */
    static peelEnd(p) {
        return markEnd(p);
    }

    prune(t) {
        for (let i = this.peels.length - 1; i >= 0; i--) {
            if (t >= RainbarkEvents.peelEnd(this.peels[i])) this.peels.splice(i, 1);
        }
        for (let i = this.knocks.length - 1; i >= 0; i--) {
            if (t - this.knocks[i].t0 > KNOCK.life) this.knocks.splice(i, 1);
        }
        for (let i = this.girdles.length - 1; i >= 0; i--) {
            const g = this.girdles[i];
            if (t >= Math.min(g.t0 + g.life, g.kill + PEEL.kill)) this.girdles.splice(i, 1);
        }
        for (let i = this.helices.length - 1; i >= 0; i--) {
            if (t >= this.helices[i].kill + HELIX.heal) this.helices.splice(i, 1);
        }
        // A moult is over once the latest front's colour has climbed back and it has faded out.
        if (this.moult.active && t >= this.moult.t1 + MOULT_RIPE + MOULT_FADE_OUT) this.moult.active = 0;
    }

    /**
     * How much the moult shows at t (0 … 1): faded in over MOULT_FADE_IN from its start, out over
     * MOULT_FADE_OUT once its latest front is ripe (every patch is its own colour again by then, so
     * the fade only hands each one back to its own skin, never seen to jump).
     */
    moultShown(t) {
        const m = this.moult;
        if (!m.active) return 0;
        const fadeIn = Math.max(0, Math.min(1, (t - m.on) / MOULT_FADE_IN));
        const fadeOut = 1 - Math.max(0, Math.min(1, (t - m.t1 - MOULT_RIPE) / MOULT_FADE_OUT));
        return Math.min(fadeIn, fadeOut);
    }

    /**
     * The standing ring a new one at `g`'s place would only cover (the same trunk, about the same
     * height, bared and not on its way out), or null.
     */
    girdleAt(t, g) {
        let found = null;
        for (let i = 0; i < this.girdles.length; i++) {
            const r = this.girdles[i];
            if (r.code !== g.code || r.kill !== Infinity || t < r.t0 + SHED.bare) continue;
            // (Not one already eroding back into the mosaic at the end of its life.)
            if (t > r.t0 + r.life * (1 - PEEL.erode) - 2) continue;
            if (Math.abs(r.yC - g.yC) > 0.6 * Math.max(r.halfH, g.halfH)) continue;
            if (!found || r.t0 > found.t0) found = r;
        }
        return found;
    }

    /**
     * A ring girdles a near trunk at time t (the Shed): `g` = { code, yC, halfH, lo, hi (the row's
     * packed codes), thetaL, span (the visible arc, screen left to right), strength }. Where a ring
     * already stands it re-blazes instead (once its last blaze has ripened; while that one still
     * burns it is only fed). When every slot is taken the oldest is told to erode now; a full pool
     * gives up the ring nearest its end.
     */
    girdle(t, g) {
        this.prune(t);
        const here = this.girdleAt(t, g);
        if (here) {
            here.strength = Math.max(here.strength, g.strength);
            here.touched = t;
            if (t - here.blaze >= REBLAZE_AFTER) {
                // Burnt in again: a fresh front of First Skin sweeps down it and ripens back, and it
                // stands as long as a new ring would.
                here.blaze = t;
                this.serial += 1;
                const h = (((this.serial * 0.7548776662) % 1) + 1) % 1;
                const life = SHED.life[0] + (SHED.life[1] - SHED.life[0]) * h;
                here.life = Math.max(here.life, t - here.t0 + life);
            }
            return here;
        }
        if (this.girdles.length >= this.girdlePool.length) {
            this.girdles.splice(nearestEnd(this.girdles, markEnd), 1);
        }
        const slot = this.girdlePool.find((s) => !this.girdles.includes(s)) || this.girdlePool[0];
        Object.assign(slot, g);
        slot.t0 = t;
        slot.blaze = t;
        slot.touched = t;
        slot.kill = Infinity;
        this.serial += 1;
        const h = (((this.serial * 0.7548776662) % 1) + 1) % 1;
        slot.life = SHED.life[0] + (SHED.life[1] - SHED.life[0]) * h;
        this.girdles.push(slot);
        // Too many standing: the one the board has left alone longest (never one a chain keeps
        // re-blazing) erodes now.
        let standing = 0;
        for (let i = 0; i < this.girdles.length; i++) if (this.girdles[i].kill === Infinity) standing += 1;
        while (standing > this.girdlePool.length - 4) {
            let idle = null;
            for (let i = 0; i < this.girdles.length; i++) {
                const r = this.girdles[i];
                if (r.kill === Infinity && r !== slot && (!idle || r.touched < idle.touched)) idle = r;
            }
            if (!idle) break;
            idle.kill = t;
            standing -= 1;
        }
        return slot;
    }

    /**
     * A T-spin's helix unwinds at time t: `h` = { code, yTop, turns, pitch, theta, width }. It
     * stands for the level; when every slot is taken the oldest heals (over HELIX.heal).
     */
    helix(t, h) {
        this.prune(t);
        if (this.helices.length >= this.helixPool.length) {
            // (The one nearest the end of its healing; a standing one only when none is healing.)
            this.helices.splice(nearestEnd(this.helices, (x) => x.kill + HELIX.heal), 1);
        }
        const slot = this.helixPool.find((s) => !this.helices.includes(s)) || this.helixPool[0];
        Object.assign(slot, h);
        slot.t0 = t;
        slot.kill = Infinity;
        this.helices.push(slot);
        const standing = this.helices.filter((s) => s.kill === Infinity);
        if (standing.length >= this.helixPool.length) standing[0].kill = t;
        return slot;
    }

    /** Every helix heals (a new level: the scars belong to the level they were made in). */
    healHelices(t) {
        for (let i = 0; i < this.helices.length; i++) if (this.helices[i].kill === Infinity) this.helices[i].kill = t;
    }

    /**
     * A four-line clear: the Great Moult begins at time t. One already showing is never restarted:
     * once its latest front has swept the grove a new front sweeps down again from the top,
     * re-stripping what had ripened (the colour climbs back from it), and inside a front still
     * sweeping the moult is only fed. Returns 'fresh', 'again' or 'fed'.
     */
    startMoult(t) {
        const m = this.moult;
        if (!m.active || t >= m.t1 + MOULT_RIPE + MOULT_FADE_OUT) {
            m.t0 = t;
            m.t1 = t;
            m.start = t;
            m.on = t;
            m.active = 1;
            return 'fresh';
        }
        if (t - m.t1 < MOULT_SWEPT) return 'fed';
        // (Fading out, it fades back in from where it stands.)
        const shown = this.moultShown(t);
        m.t0 = m.t1;
        m.t1 = t;
        m.on = t - MOULT_FADE_IN * shown;
        return 'again';
    }

    /**
     * A strip peels off a lane trunk at time t: `p` = { code, yTop, yBot, theta, half (radians),
     * age (the piece's bark age), radius, hard (0/1) }; `held` how many may stand (PEEL.held, more
     * while play runs hot). Returns the slot record.
     */
    peel(t, p, held = PEEL.held) {
        this.prune(t);
        const keep = Math.max(1, Math.min(this.peelPool.length - 3, Math.round(held)));
        if (this.peels.length >= this.peelPool.length) this.peels.splice(nearestEnd(this.peels, markEnd), 1);
        const free = this.peelPool.find((slot) => !this.peels.includes(slot));
        const slot = free || this.peelPool[0];
        this.serial += 1;
        slot.code = p.code;
        slot.yTop = p.yTop;
        slot.yBot = p.yBot;
        slot.t0 = t;
        slot.theta = p.theta;
        slot.half = p.half;
        slot.age = p.age;
        slot.radius = p.radius;
        slot.hard = p.hard ? 1 : 0;
        slot.seed = this.serial % 251;
        slot.kill = Infinity;
        // Each band erodes at its own pace (90–150 s), hashed from its serial.
        const h = (((this.serial * 0.6180339887) % 1) + 1) % 1;
        slot.life = PEEL.life[0] + (PEEL.life[1] - PEEL.life[0]) * h;
        this.peels.push(slot);
        // More than `held` standing: the oldest that is not already going erodes now; on Sister
        // One (code 2, a slim lane) more than `heldSister`.
        let standing = 0;
        let sister = 0;
        for (let i = 0; i < this.peels.length; i++) {
            if (this.peels[i].kill !== Infinity) continue;
            standing += 1;
            if (this.peels[i].code === 2) sister += 1;
        }
        for (let i = 0; i < this.peels.length && (standing > keep || sister > PEEL.heldSister); i++) {
            const old = this.peels[i];
            if (old.kill !== Infinity) continue;
            if (standing <= keep && old.code !== 2) continue;
            old.kill = t;
            standing -= 1;
            if (old.code === 2) sister -= 1;
        }
        return slot;
    }

    /**
     * A hard drop knocks a trunk: a gloss pulse runs up it from y0. One that lands within KNOCK.gap
     * of the trunk's last feeds that gleam (it only grows brighter, never jumps back down the
     * trunk); a later one runs up behind the first while it finishes, a full pool giving up the
     * oldest.
     */
    knock(t, code, y0, strength) {
        this.prune(t);
        const s = Math.max(0, Math.min(1, strength));
        const fed = this.knocks.find((k) => k.code === code && t - k.t0 < KNOCK.gap) || null;
        if (fed) {
            fed.strength = Math.min(1, Math.max(fed.strength, s) + 0.25 * s);
            return fed;
        }
        if (this.knocks.length >= this.knockPool.length) this.knocks.shift();
        const slot = this.knockPool.find((k) => !this.knocks.includes(k)) || this.knockPool[0];
        this.knocks.push(slot);
        slot.code = code;
        slot.y0 = y0;
        slot.t0 = t;
        slot.strength = s;
        return slot;
    }

    /**
     * Write every live slot into the table (THREE.Vector4-like rows, mutated in place), each block
     * compacted to its front; returns the counts (also kept on this.counts).
     */
    write(table, t) {
        this.prune(t);
        const P = EVENT_ROWS.peels;
        for (let i = 0; i < this.peels.length; i++) {
            const p = this.peels[i];
            table[P + i * 3].set(p.code, p.yTop, p.yBot, p.t0);
            table[P + i * 3 + 1].set(p.theta, p.half, p.age, p.radius);
            table[P + i * 3 + 2].set(Number.isFinite(p.kill) ? p.kill : 1e7, p.life, p.hard, p.seed);
        }
        const K = EVENT_ROWS.knocks;
        for (let i = 0; i < this.knocks.length; i++) {
            const k = this.knocks[i];
            table[K + i].set(k.code, k.y0, k.t0, k.strength);
        }
        const R = EVENT_ROWS.girdles;
        for (let i = 0; i < this.girdles.length; i++) {
            const g = this.girdles[i];
            table[R + i * 3].set(g.code, g.yC, g.halfH, g.t0);
            table[R + i * 3 + 1].set(g.lo, g.hi, g.thetaL, g.span);
            table[R + i * 3 + 2].set(g.strength, Number.isFinite(g.kill) ? g.kill : 1e7, g.life, g.blaze);
        }
        const X = EVENT_ROWS.helices;
        for (let i = 0; i < this.helices.length; i++) {
            const h = this.helices[i];
            table[X + i * 2].set(h.code, h.yTop, h.turns, h.t0);
            table[X + i * 2 + 1].set(h.pitch, h.theta, h.width, Number.isFinite(h.kill) ? h.kill : 1e7);
        }
        const m = this.moult;
        table[EVENT_ROWS.moult].set(m.t0, this.moultShown(t), 0, m.t1);
        const G = EVENT_ROWS.gaps;
        let gaps = 0;
        for (let i = 0; i < this.gaps.length; i++) {
            const g = this.gaps[i];
            table[G + i].set(g.qx, g.qz, g.radius, g.open);
            if (g.open > 1e-3) gaps = i + 1;
        }
        this.counts.peels = this.peels.length;
        this.counts.knocks = this.knocks.length;
        this.counts.girdles = this.girdles.length;
        this.counts.helices = this.helices.length;
        this.counts.gaps = gaps;
        return this.counts;
    }
}
