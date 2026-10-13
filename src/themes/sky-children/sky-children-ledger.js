/* eslint-disable max-classes-per-file -- the pools, the stroke book and the dial are the one
   ledger of what the world holds (FINAL §6.1); the world reads them together. */
/**
 * Sky Children — Irisfall: what the world holds (CPU only, three-free).
 *
 *   PoolLedger  the terraced pools: a lock's light-water fills one and it HOLDS the colour
 *               (about 30 s); a clear RELEASES the oldest held, which run down the terraces pool
 *               to pool and ride down a fall as coloured packets
 *   StrokeBook  the chain's links: the colour and piece of each link that paints a stroke of the
 *               bow (7 on the primary, 5 on the secondary), whether the seven primary strokes
 *               were made by seven different pieces (the true bow), and the T-spin's turn
 *   Dial        the one eased number (0..13) every chain stage reads: it paints up at most a
 *               second a stroke (faster under a backlog), withdraws newest-first a stroke every
 *               0.35 s, and under B2B holds four seconds before it lets go
 *
 * Everything is closed form in the clock it is given (the world's clock for pools and the dial,
 * the water clock for packets: packets ride the falls at water speed, through the hush and the
 * pour alike), and nothing allocates after construction.
 */
import { clamp, clamp01, smooth } from './sky-children-core.js';

export const LEDGER = Object.freeze({
    /** How fast a held pool fills (a silent lock fills slowly), how long it stays full. */
    fadeIn: 0.25,
    silentFadeIn: 1.5,
    full: 18,
    /** Then it fades as exp(−(age − full)/decay), gone by `end` (seconds since the lock). */
    decay: 6,
    end: 34,
    /** A thin trickle of the new colour spills to the pool below for this long. */
    spill: 6,
    /** A released pool dims over this, while its colour runs down. */
    releaseDim: 0.8,
    /** A new run drains every pool softly; a game over dims them slowly. */
    drainFade: 2.5,
    overFade: 8,
    /** A hop from pool to pool (and the last one, over the rim into the fall): water seconds. */
    hop: 0.4,
    /** A packet's length on the fall (water seconds of travel) and its HDR strength. */
    packetWidth: 0.35,
    packetStrength: 1.4,
    /** Pools released per cleared line (four lines and more release all of them). */
    perLine: 3,
    /** Back-to-back: the pools left brimming brighten this much for this long. */
    brim: 1.3,
    brimSeconds: 6,
    /** A lock chooses among this many pools nearest its row. */
    nearest: 3,
});

/**
 * How many of the held pools a clear releases: 3, 6, 9 for 1, 2, 3 lines, all of them for four
 * and more (and a perfect clear: pass Infinity); halved, rounded up, under back-to-back.
 * @param {number} lines
 * @param {boolean} [b2b]
 * @param {number} [held] how many are held now
 */
export function releaseCount(lines, b2b = false, held = Infinity) {
    const n = Number(lines) || 0;
    if (!(n >= 1)) return 0;
    let count = n >= 4 ? held : LEDGER.perLine * Math.floor(n);
    if (b2b) count = Math.ceil(count / 2);
    return Math.max(0, Math.min(count, held));
}

/** 'left' | 'right', or a number (≤ 0 left, > 0 right; 0 and 1 also read as left and right). */
const sideOf = (side) => (side === 'right' || side === 'R' || side === true || Number(side) > 0 ? 1 : 0);

/**
 * The pools. Lay them out with place() (from the plan: each pool's side, its height on screen,
 * the pool its overflow runs into and the fall it pours into), then hold, choose and release by
 * pool index.
 */
export class PoolLedger {
    /** @param {number} [capacity] the most pools a plan may lay out */
    constructor(capacity = 72) {
        this.capacity = Math.max(1, Math.floor(capacity));
        const n = this.capacity;
        this.count = 0;
        this.side = new Uint8Array(n);
        this.y = new Float32Array(n);
        this.below = new Int16Array(n).fill(-1);
        this.fall = new Int16Array(n).fill(-1);
        this.rgb = new Float32Array(n * 3);
        this.heldAt = new Float64Array(n);
        this.silent = new Uint8Array(n);
        this.endAt = new Float64Array(n);
        this.endSeconds = new Float64Array(n);
        this.released = new Uint8Array(n);
        this.brimAt = -Infinity;
        this.defaultFall = 0;
        this.nearestScratch = new Int16Array(LEDGER.nearest);
        this.routeScratch = { pools: [], fall: -1, hops: 0 };
        this.reset();
    }

    /** Empties every pool (a seek, a new world); keeps the layout. */
    reset() {
        this.heldAt.fill(-Infinity);
        this.endAt.fill(Infinity);
        this.endSeconds.fill(1);
        this.released.fill(0);
        this.silent.fill(0);
        this.rgb.fill(0);
        this.brimAt = -Infinity;
    }

    /**
     * Lays the pools out. A layout change keeps what each pool holds (indices are the plan's).
     * @param {Array<{side: (number|string), y: number, below?: number, fall?: number}>} sites
     *   side the side of the card it serves; y its height on screen (0 top .. 1 bottom); below the
     *   pool its overflow runs into (−1: none); fall the fall it pours into (−1: none of its own)
     * @param {number} [defaultFall] where a route with no fall of its own pours (the Mother Fall)
     */
    place(sites, defaultFall = 0) {
        const n = Math.min(this.capacity, sites.length);
        for (let i = 0; i < n; i++) {
            const s = sites[i];
            this.side[i] = sideOf(s.side);
            this.y[i] = Number(s.y) || 0;
            const below = Number.isInteger(s.below) ? s.below : -1;
            this.below[i] = below >= 0 && below < n && below !== i ? below : -1;
            this.fall[i] = Number.isInteger(s.fall) ? s.fall : -1;
        }
        for (let i = n; i < this.count; i++) this.heldAt[i] = -Infinity;
        this.count = n;
        this.defaultFall = defaultFall;
    }

    /**
     * A pool takes a colour (the newest wins).
     * @param {number} id
     * @param {number[]} rgb linear light
     * @param {number} clock
     * @param {boolean} [silent] a silent lock: no thread arrived, the colour fades in slowly
     */
    hold(id, rgb, clock, silent = false) {
        if (!(id >= 0 && id < this.count)) return;
        this.rgb[id * 3] = rgb[0];
        this.rgb[id * 3 + 1] = rgb[1];
        this.rgb[id * 3 + 2] = rgb[2];
        this.heldAt[id] = clock;
        this.silent[id] = silent ? 1 : 0;
        this.endAt[id] = Infinity;
        this.released[id] = 0;
    }

    /** True if a pool holds a colour that a clear may still release. */
    isHeld(id, clock) {
        const age = clock - this.heldAt[id];
        return age >= 0 && age < LEDGER.end && this.endAt[id] === Infinity;
    }

    /** How many pools hold a colour a clear may release. */
    heldCount(clock) {
        let n = 0;
        for (let i = 0; i < this.count; i++) if (this.isHeld(i, clock)) n++;
        return n;
    }

    /**
     * How brightly a pool shows its colour, 0..1 (more while a B2B keeps the pools brimming):
     * fills over fadeIn, stays full, fades from `full` to `end`, dims away when released or
     * drained.
     */
    glowAt(id, clock) {
        if (!(id >= 0 && id < this.count)) return 0;
        const age = clock - this.heldAt[id];
        if (!(age >= 0) || age >= LEDGER.end) return 0;
        let g = smooth(0, this.silent[id] ? LEDGER.silentFadeIn : LEDGER.fadeIn, age);
        if (age > LEDGER.full) {
            g *= Math.exp(-(age - LEDGER.full) / LEDGER.decay) * (1 - smooth(LEDGER.end - 6, LEDGER.end, age));
        }
        const since = clock - this.endAt[id];
        if (since >= 0) g *= 1 - smooth(0, this.endSeconds[id], since);
        const brim = clock - this.brimAt;
        if (brim >= 0 && brim < LEDGER.brimSeconds && this.heldAt[id] <= this.brimAt
            && this.endAt[id] > this.brimAt) {
            const swell = smooth(0, 0.3, brim) * (1 - smooth(LEDGER.brimSeconds - 1.5, LEDGER.brimSeconds, brim));
            g *= 1 + (LEDGER.brim - 1) * swell;
        }
        return g;
    }

    /** The thin trickle a newly held pool spills to the one below, 0..1. */
    spillAt(id, clock) {
        if (!(id >= 0 && id < this.count) || this.endAt[id] !== Infinity) return 0;
        const age = clock - this.heldAt[id];
        if (!(age >= 0) || age >= LEDGER.spill) return 0;
        return smooth(0, 0.3, age) * (1 - smooth(LEDGER.spill - 1.5, LEDGER.spill, age));
    }

    /** The colour a pool holds (linear), into `out`. */
    colourOf(id, out = [0, 0, 0]) {
        const i = clamp(id, 0, this.capacity - 1) * 3;
        out[0] = this.rgb[i];
        out[1] = this.rgb[i + 1];
        out[2] = this.rgb[i + 2];
        return out;
    }

    /**
     * The pool a lock's light-water goes to: of the LEDGER.nearest pools on its side nearest the
     * row's height, the nearest unlit one, else the oldest held. −1 if there are no pools.
     * @param {number|string} side
     * @param {number} y the row's height on screen (0 top .. 1 bottom)
     * @param {number} clock
     */
    choose(side, y, clock) {
        const want = sideOf(side);
        let found = this.nearestOn(want, y);
        if (found === 0) found = this.nearestOn(-1, y);
        if (found === 0) return -1;
        const near = this.nearestScratch;
        for (let k = 0; k < found; k++) {
            if (this.glowAt(near[k], clock) <= 1e-3) return near[k];
        }
        let best = near[0];
        for (let k = 1; k < found; k++) if (this.heldAt[near[k]] < this.heldAt[best]) best = near[k];
        return best;
    }

    /** Fills nearestScratch with up to LEDGER.nearest pools on a side (−1: any), nearest first. */
    nearestOn(side, y) {
        const near = this.nearestScratch;
        let found = 0;
        for (let i = 0; i < this.count; i++) {
            if (side >= 0 && this.side[i] !== side) continue;
            const d = Math.abs(this.y[i] - y);
            let k = found < near.length ? found++ : near.length;
            // Insert in order, dropping the farthest when full.
            while (k > 0 && Math.abs(this.y[near[k - 1]] - y) > d) {
                if (k < near.length) near[k] = near[k - 1];
                k--;
            }
            if (k < near.length) near[k] = i;
        }
        return found;
    }

    /**
     * Releases the `n` oldest held pools (oldest first, across both sides): each dims over
     * releaseDim while its colour runs down. Writes their indices into `out` (its length set).
     * @param {number} n (Infinity: all)
     * @param {number} clock
     * @param {number[]} [out]
     */
    releaseOldest(n, clock, out = []) {
        out.length = 0;
        const want = Math.max(0, Math.min(Number(n) || 0, this.count));
        while (out.length < want) {
            let best = -1;
            for (let i = 0; i < this.count; i++) {
                if (!this.isHeld(i, clock)) continue;
                if (best < 0 || this.heldAt[i] < this.heldAt[best]) best = i;
            }
            if (best < 0) break;
            this.endAt[best] = clock;
            this.endSeconds[best] = LEDGER.releaseDim;
            this.released[best] = 1;
            out.push(best);
        }
        return out;
    }

    /** A clear's release: releaseCount(lines, b2b) of the oldest held pools. */
    releaseForClear(lines, b2b, clock, out = []) {
        return this.releaseOldest(releaseCount(lines, b2b, this.heldCount(clock)), clock, out);
    }

    /** Dims every held pool over `seconds` with no packets (new run: drainFade; game over: overFade). */
    dimAll(clock, seconds = LEDGER.drainFade) {
        for (let i = 0; i < this.count; i++) {
            if (!this.isHeld(i, clock)) continue;
            this.endAt[i] = clock;
            this.endSeconds[i] = Math.max(0.01, seconds);
        }
    }

    /** Back-to-back: the pools still holding brighten for a while. */
    brimFrom(clock) {
        this.brimAt = clock;
    }

    /**
     * Where a pool's colour runs when it is released: down the terraces, pool to pool, until a
     * pool with a fall of its own pours it over that lip (or the chain ends: then the default
     * fall). `out.pools` starts with the pool itself; `out.hops` counts every hop including the
     * pour into the fall; `out.fall` is never −1.
     */
    drainRoute(id, out = { pools: [], fall: -1, hops: 0 }) {
        out.pools.length = 0;
        out.fall = -1;
        let at = id >= 0 && id < this.count ? id : -1;
        while (at >= 0 && out.pools.length < this.count) {
            out.pools.push(at);
            if (this.fall[at] >= 0) {
                out.fall = this.fall[at];
                break;
            }
            at = this.below[at];
            if (out.pools.includes(at)) break; // a loop in the plan: stop where it closes
        }
        if (out.fall < 0) out.fall = this.defaultFall;
        out.hops = out.pools.length;
        return out;
    }

    /**
     * The packet a released pool sends down its fall, scheduled on the WATER clock: it enters
     * the fall `delay` water-seconds after `water`, plus one hop per terrace and the pour.
     * @param {number} id
     * @param {number} water the water clock at the release
     * @param {number} [delay] the stagger before it starts (water seconds)
     * @param {object} [out]
     */
    packet(id, water, delay = 0, out = {}) {
        const route = this.drainRoute(id, this.routeScratch);
        out.pool = id;
        out.fall = route.fall;
        out.hops = route.hops;
        out.bornWater = water + delay + route.hops * LEDGER.hop;
        out.width = LEDGER.packetWidth;
        out.strength = LEDGER.packetStrength;
        if (!out.rgb) out.rgb = [0, 0, 0];
        this.colourOf(id, out.rgb);
        return out;
    }
}

// ── The chain ───────────────────────────────────────────────────────────────────────────────

export const DIAL = Object.freeze({
    /** The bow's strokes: 7 on the primary (the 7th closes the circle), then 5 on the secondary. */
    primary: 7,
    secondary: 5,
    strokes: 12,
    /** The dial's top: from 13 links on, the bows sing. */
    max: 13,
    /** Up: a stroke paints in at most this (s), faster when links queue: max(1/stroke, backlog/rush). */
    stroke: 1.0,
    rush: 0.8,
    /** Down: newest first, one stroke every `unwind` s, each fading over `fade` s. */
    unwind: 0.35,
    fade: 1.2,
    /** A break while back-to-back is live holds everything this long first. */
    grace: 4,
});

/** The seven pieces, the letters a link's shape is told in. */
const PIECES = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

/**
 * The links of the chain that paint the strokes: link n (1-based) paints stroke n in the colour
 * of the piece whose lock made it.
 */
export class StrokeBook {
    constructor() {
        this.rgb = new Float32Array(DIAL.strokes * 3);
        this.shapes = new Array(DIAL.strokes).fill('');
        this.count = 0;
    }

    reset() {
        this.rgb.fill(0);
        this.shapes.fill('');
        this.count = 0;
    }

    /**
     * Link `n` of the chain (1 starts a new one), made by a piece of this colour and shape.
     * Links past the last stroke paint nothing.
     * @param {number} n
     * @param {number[]} rgb linear
     * @param {string} [shape] 'I' 'O' 'T' 'S' 'Z' 'J' 'L'
     */
    link(n, rgb, shape = '') {
        const k = Math.floor(Number(n));
        if (!(k >= 1)) return;
        if (k === 1) this.count = 0;
        if (k > DIAL.strokes) return;
        const i = k - 1;
        this.rgb[i * 3] = rgb[0];
        this.rgb[i * 3 + 1] = rgb[1];
        this.rgb[i * 3 + 2] = rgb[2];
        this.shapes[i] = typeof shape === 'string' ? shape.toUpperCase() : '';
        this.count = Math.max(this.count, k);
    }

    /** The colour of stroke i (0-based), into `out`. */
    colourOf(i, out = [0, 0, 0]) {
        const at = clamp(Math.floor(i), 0, DIAL.strokes - 1) * 3;
        out[0] = this.rgb[at];
        out[1] = this.rgb[at + 1];
        out[2] = this.rgb[at + 2];
        return out;
    }

    /** The true bow: the seven primary strokes were made by seven different pieces. */
    isTrueBow() {
        if (this.count < DIAL.primary) return false;
        let seen = 0;
        for (let i = 0; i < DIAL.primary; i++) {
            const p = PIECES.indexOf(this.shapes[i]);
            if (p < 0 || seen & (1 << p)) return false;
            seen |= 1 << p;
        }
        return true;
    }

    /**
     * The T-spin: the colours turn one place along the painted strokes (stroke i takes stroke
     * i − 1's colour, the first the last's).
     * @param {number} [count] how many strokes are painted (default: the links so far)
     */
    rotate(count = this.count) {
        const n = clamp(Math.floor(count), 0, DIAL.strokes);
        if (n < 2) return;
        const r = this.rgb[(n - 1) * 3];
        const g = this.rgb[(n - 1) * 3 + 1];
        const b = this.rgb[(n - 1) * 3 + 2];
        const shape = this.shapes[n - 1];
        for (let i = n - 1; i > 0; i--) {
            this.rgb[i * 3] = this.rgb[(i - 1) * 3];
            this.rgb[i * 3 + 1] = this.rgb[(i - 1) * 3 + 1];
            this.rgb[i * 3 + 2] = this.rgb[(i - 1) * 3 + 2];
            this.shapes[i] = this.shapes[i - 1];
        }
        this.rgb[0] = r;
        this.rgb[1] = g;
        this.rgb[2] = b;
        this.shapes[0] = shape;
    }
}

/**
 * The dial: one eased value 0..13 that the chain's every stage reads through its own threshold.
 * Closed form in the clock: set() starts a new segment from wherever the dial stands.
 */
export class Dial {
    constructor() {
        this.reset(0);
    }

    reset(time = 0) {
        this.v0 = 0;
        this.t0 = Number.isFinite(time) ? time : 0;
        this.target = 0;
        this.holdUntil = -Infinity;
    }

    /** When the current segment starts moving (after any B2B grace). */
    get start() {
        return Math.max(this.t0, this.holdUntil);
    }

    /** The dial at a time. */
    value(clock) {
        const dt = clock - this.start;
        const { v0, target } = this;
        if (!(dt > 0) || target === v0) return v0;
        if (target < v0) return Math.max(target, v0 - dt / DIAL.unwind);
        // Up: dv/dt = max(1/stroke, backlog/rush): a backlog closes exponentially until it is
        // down to what a steady stroke a second would paint in `rush`, then strokes run steady.
        const floor = 1 / DIAL.stroke;
        const knee = floor * DIAL.rush;
        const b0 = target - v0;
        if (b0 > knee) {
            const t1 = DIAL.rush * Math.log(b0 / knee);
            if (dt < t1) return target - b0 * Math.exp(-dt / DIAL.rush);
            return Math.min(target, target - knee + floor * (dt - t1));
        }
        return Math.min(target, v0 + floor * dt);
    }

    /**
     * The chain is `n` links long now (0: broken).
     * @param {number} n
     * @param {number} clock
     * @param {{b2b?: boolean}} [options] b2b: a back-to-back is live (a break waits DIAL.grace)
     */
    set(n, clock, { b2b = false } = {}) {
        const target = clamp(Math.floor(Number(n)) || 0, 0, DIAL.max);
        if (target === this.target) return;
        const v = this.value(clock);
        const holding = clock < this.holdUntil;
        if (target > v) {
            this.holdUntil = -Infinity;
        } else if (b2b && target < this.target && !holding) {
            this.holdUntil = clock + DIAL.grace;
        }
        this.v0 = v;
        this.t0 = clock;
        this.target = target;
    }

    /** How much of stroke i (0-based) is painted, 0..1. */
    progress(i, clock) {
        return clamp01(this.value(clock) - i);
    }

    /**
     * How bright stroke i still is, 0..1: 1 while it stands (or paints), fading over DIAL.fade
     * from the moment the withdrawal reached it.
     */
    fade(i, clock) {
        const { v0, target, start } = this;
        if (!(target < v0) || clock <= start) return 1;
        const top = i + 1;
        if (this.value(clock) >= top) return 1;
        const reached = start + (v0 - top) * DIAL.unwind;
        return 1 - smooth(0, DIAL.fade, clock - reached);
    }
}
