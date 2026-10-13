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
 *   girdles 12 × 3  (code, yC, halfH, t0) (codes lo, codes hi, θL, arc span) (strength, tKill, life, 0)
 *   helices  6 × 2  (code, yTop, turns, t0) (pitch, θ0, width, tKill)
 *   moult    1 × 1  (t0, active, rank delay, front seconds)
 *   gaps     7 × 1  (qx, qz, radius, open): station order, so the open ones are always a prefix
 *                   (the world fills them every frame; gapCount = one past the last open one)
 *
 * A peel lives its `life` (eroding back into the mosaic over the last of it); when more than
 * PEEL.held are standing, the oldest is told to erode now (over PEEL.kill), so a burst of locks
 * never pops a band off: there is always a slot for the one in flight.
 */

import {
    EVENT_ROWS, EVENT_SLOTS, HELIX, KNOCK, MOULT, PEEL, SHED,
} from './rainbark-core.js';

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
    code: 0, yC: 0, halfH: 0.2, t0: 0, lo: 0, hi: 0, thetaL: 0, span: 1, strength: 1, kill: Infinity, life: 90,
});

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
        /** The Great Moult in flight (t0 = -Infinity: none). */
        this.moult = { t0: -1e6, active: 0 };
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
        this.moult.active = 0;
        this.serial = 0;
        for (let i = 0; i < this.gaps.length; i++) this.gaps[i].open = 0;
    }

    /** The moment a peel has fully eroded (its natural end, or PEEL.kill after it was told to go). */
    static peelEnd(p) {
        return Math.min(p.t0 + p.life, p.kill + PEEL.kill);
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
        // A moult is over once its colour has climbed back.
        if (this.moult.active && t - this.moult.t0 > MOULT.ripenAt + MOULT.ripenFor + MOULT.flame + 2) this.moult.active = 0;
    }

    /**
     * A ring girdles a near trunk at time t (the Shed): `g` = { code, yC, halfH, lo, hi (the row's
     * packed codes), thetaL, span (the visible arc, screen left to right), strength }. When every
     * slot is taken the oldest is told to erode now; a full pool drops the oldest.
     */
    girdle(t, g) {
        this.prune(t);
        if (this.girdles.length >= this.girdlePool.length) this.girdles.shift();
        const slot = this.girdlePool.find((s) => !this.girdles.includes(s)) || this.girdlePool[0];
        Object.assign(slot, g);
        slot.t0 = t;
        slot.kill = Infinity;
        this.serial += 1;
        const h = (((this.serial * 0.7548776662) % 1) + 1) % 1;
        slot.life = SHED.life[0] + (SHED.life[1] - SHED.life[0]) * h;
        this.girdles.push(slot);
        let standing = 0;
        for (let i = 0; i < this.girdles.length; i++) if (this.girdles[i].kill === Infinity) standing += 1;
        for (let i = 0; i < this.girdles.length && standing > this.girdlePool.length - 2; i++) {
            if (this.girdles[i].kill === Infinity) {
                this.girdles[i].kill = t;
                standing -= 1;
            }
        }
        return slot;
    }

    /**
     * A T-spin's helix unwinds at time t: `h` = { code, yTop, turns, pitch, theta, width }. It
     * stands for the level; when every slot is taken the oldest heals (over HELIX.heal).
     */
    helix(t, h) {
        this.prune(t);
        if (this.helices.length >= this.helixPool.length) this.helices.shift();
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

    /** The Great Moult begins at time t. */
    startMoult(t) {
        this.moult.t0 = t;
        this.moult.active = 1;
    }

    /**
     * A strip peels off a lane trunk at time t: `p` = { code, yTop, yBot, theta, half (radians),
     * age (the piece's bark age), radius, hard (0/1) }. Returns the slot record.
     */
    peel(t, p) {
        this.prune(t);
        if (this.peels.length >= this.peelPool.length) this.peels.shift();
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
        for (let i = 0; i < this.peels.length && (standing > PEEL.held || sister > PEEL.heldSister); i++) {
            const old = this.peels[i];
            if (old.kill !== Infinity) continue;
            if (standing <= PEEL.held && old.code !== 2) continue;
            old.kill = t;
            standing -= 1;
            if (old.code === 2) sister -= 1;
        }
        return slot;
    }

    /**
     * A hard drop knocks a trunk: a gloss pulse runs up it from y0. One per trunk per KNOCK.gap
     * seconds (a newer one restarts the trunk's slot).
     */
    knock(t, code, y0, strength) {
        this.prune(t);
        let slot = this.knocks.find((k) => k.code === code && t - k.t0 < KNOCK.gap) || null;
        if (!slot) {
            if (this.knocks.length >= this.knockPool.length) this.knocks.shift();
            slot = this.knockPool.find((k) => !this.knocks.includes(k)) || this.knockPool[0];
            this.knocks.push(slot);
        }
        slot.code = code;
        slot.y0 = y0;
        slot.t0 = t;
        slot.strength = Math.max(0, Math.min(1, strength));
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
            table[R + i * 3 + 2].set(g.strength, Number.isFinite(g.kill) ? g.kill : 1e7, g.life, 0);
        }
        const X = EVENT_ROWS.helices;
        for (let i = 0; i < this.helices.length; i++) {
            const h = this.helices[i];
            table[X + i * 2].set(h.code, h.yTop, h.turns, h.t0);
            table[X + i * 2 + 1].set(h.pitch, h.theta, h.width, Number.isFinite(h.kill) ? h.kill : 1e7);
        }
        table[EVENT_ROWS.moult].set(this.moult.t0, this.moult.active, MOULT.rankDelay, MOULT.front);
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
