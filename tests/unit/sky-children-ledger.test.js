/**
 * Sky Children — the ledger of what the world holds: which pool a lock's light-water fills, how
 * long it holds the colour, which pools a clear releases and where their colour runs, the
 * chain's stroke book (the true bow, the T-spin's turn), and the dial's pace up and down.
 */
import { describe, expect, it } from 'vitest';
import {
    DIAL, Dial, LEDGER, PoolLedger, StrokeBook, releaseCount,
} from '../../src/themes/sky-children/sky-children-ledger.js';

/**
 * A small plan: on the left a chain 0 → 1 → 2 pouring into fall 0, a chain 3 → 4 into fall 0
 * and a lone basin 5 into fall 2; on the right 6 → 7 and 8 → 9 into fall 1, and a basin 10 with
 * no fall of its own (it drains to the default fall).
 */
const SITES = [
    { side: 'left', y: 0.2, below: 1 },
    { side: 'left', y: 0.35, below: 2 },
    { side: 'left', y: 0.5, fall: 0 },
    { side: 'left', y: 0.6, below: 4 },
    { side: 'left', y: 0.7, fall: 0 },
    { side: 'left', y: 0.85, fall: 2 },
    { side: 'right', y: 0.3, below: 7 },
    { side: 'right', y: 0.45, fall: 1 },
    { side: 'right', y: 0.6, below: 9 },
    { side: 'right', y: 0.75, fall: 1 },
    { side: 'right', y: 0.9 },
];

const RED = [1, 0.1, 0.05];

function ledger() {
    const l = new PoolLedger(16);
    l.place(SITES, 0);
    return l;
}

/** Holds every pool, pool i at time i (so pool 0 is the oldest). */
function holdAll(l) {
    for (let i = 0; i < SITES.length; i++) l.hold(i, [i / 10, 0.5, 0.5], i);
    return SITES.length;
}

describe('Sky Children pools', () => {
    it('chooses an unlit pool near the row first, else the oldest of the three nearest', () => {
        const l = ledger();
        expect(l.choose('left', 0.36, 0)).toBe(1);
        l.hold(1, RED, 0);
        expect(l.choose('left', 0.36, 1)).toBe(2); // 1 is lit: the next nearest unlit
        l.hold(2, RED, 1);
        l.hold(0, RED, 2);
        expect(l.choose('left', 0.36, 3)).toBe(1); // all three lit: the oldest of them
        // Unlit again once their colour has gone.
        expect(l.choose('left', 0.36, 2 + LEDGER.end + 1)).toBe(1);
        // The right side, by name or by number.
        expect(l.choose('right', 0.46, 0)).toBe(7);
        expect(l.choose(1, 0.46, 0)).toBe(7);
        expect(l.choose(-1, 0.86, 0)).toBe(5);
        // No pools at all: nothing to choose.
        expect(new PoolLedger(4).choose('left', 0.5, 0)).toBe(-1);
    });

    it('holds a colour for about thirty seconds: in fast, full for eighteen, then fading', () => {
        const l = ledger();
        l.hold(3, RED, 10);
        expect(l.glowAt(3, 9.9)).toBe(0);
        expect(l.glowAt(3, 10 + LEDGER.fadeIn)).toBe(1);
        expect(l.glowAt(3, 10 + LEDGER.full)).toBe(1);
        const g24 = l.glowAt(3, 10 + 24);
        expect(g24).toBeGreaterThan(0.1);
        expect(g24).toBeLessThan(0.5);
        expect(l.glowAt(3, 10 + 30)).toBeLessThan(0.15);
        expect(l.glowAt(3, 10 + LEDGER.end)).toBe(0);
        let last = 1;
        for (let t = 10 + LEDGER.full; t < 10 + LEDGER.end; t += 0.25) {
            const g = l.glowAt(3, t);
            expect(g).toBeLessThanOrEqual(last + 1e-12);
            last = g;
        }
        expect(l.colourOf(3)).toEqual(RED.map((v) => Math.fround(v)));
        // A silent lock fills slowly.
        l.hold(4, RED, 10, true);
        expect(l.glowAt(4, 10 + LEDGER.fadeIn)).toBeLessThan(0.2);
        expect(l.glowAt(4, 10 + LEDGER.silentFadeIn)).toBe(1);
        // A new colour in the same pool wins.
        l.hold(3, [0, 0, 1], 20);
        expect(l.colourOf(3)[2]).toBe(1);
        expect(l.glowAt(3, 20 + LEDGER.full)).toBe(1);
        // And for the first seconds it spills a thin trickle to the pool below.
        expect(l.spillAt(3, 21)).toBeGreaterThan(0.5);
        expect(l.spillAt(3, 20 + LEDGER.spill)).toBe(0);
    });

    it('counts 3, 6, 9 and all pools for 1, 2, 3 and 4+ lines, halved (rounded up) under B2B', () => {
        expect([1, 2, 3, 4, 5].map((n) => releaseCount(n, false, 40))).toEqual([3, 6, 9, 40, 40]);
        expect([1, 2, 3, 4].map((n) => releaseCount(n, true, 40))).toEqual([2, 3, 5, 20]);
        expect(releaseCount(4, true, 11)).toBe(6);
        expect(releaseCount(Infinity, false, 7)).toBe(7);
        expect(releaseCount(3, false, 4)).toBe(4);
        expect(releaseCount(0, false, 40)).toBe(0);
        expect(releaseCount(2)).toBe(6);
    });

    it('releases the oldest held pools first, across both sides, and lets them dim', () => {
        const l = ledger();
        const held = holdAll(l);
        const now = 15;
        expect(l.heldCount(now)).toBe(held);
        const out = [];
        expect(l.releaseForClear(1, false, now, out)).toEqual([0, 1, 2]);
        expect(l.releaseForClear(2, false, now, out)).toEqual([3, 4, 5, 6, 7, 8]);
        expect(l.heldCount(now)).toBe(2);
        expect(l.releaseForClear(4, false, now, out)).toEqual([9, 10]);
        expect(l.releaseForClear(1, false, now, out)).toEqual([]);
        // Released pools dim away over releaseDim and are free for the next lock.
        expect(l.glowAt(0, now + LEDGER.releaseDim / 2)).toBeGreaterThan(0);
        expect(l.glowAt(0, now + LEDGER.releaseDim)).toBe(0);
        expect(l.choose('left', 0.2, now + 1)).toBe(0);
        // Under B2B a quad releases half of them, rounded up, and the rest brim.
        const b = ledger();
        holdAll(b);
        expect(b.releaseForClear(4, true, now, out)).toHaveLength(6);
        b.brimFrom(now);
        expect(b.glowAt(10, now + 1)).toBeCloseTo(LEDGER.brim, 6);
        expect(b.glowAt(10, now + LEDGER.brimSeconds + 0.1)).toBe(1);
    });

    it('runs every released pool down its terraces into a fall', () => {
        const l = ledger();
        const route = { pools: [], fall: -1, hops: 0 };
        for (let id = 0; id < SITES.length; id++) {
            l.drainRoute(id, route);
            expect(route.pools[0]).toBe(id);
            expect(route.fall, `pool ${id}`).toBeGreaterThanOrEqual(0);
            expect(route.hops).toBe(route.pools.length);
            for (let k = 1; k < route.pools.length; k++) expect(route.pools[k]).toBe(SITES[route.pools[k - 1]].below);
        }
        expect(l.drainRoute(0, route).pools).toEqual([0, 1, 2]);
        expect(route.fall).toBe(0);
        expect(l.drainRoute(6, route).fall).toBe(1);
        expect(l.drainRoute(10, route).fall).toBe(0); // no fall of its own: the default
        // A loop in a plan ends the route instead of running round it.
        const loop = new PoolLedger(4);
        loop.place([{ side: 0, y: 0.1, below: 1 }, { side: 0, y: 0.2, below: 0 }], 3);
        expect(loop.drainRoute(0, route).pools).toEqual([0, 1]);
        expect(route.fall).toBe(3);
    });

    it('schedules each packet on the water clock: one hop per terrace and one over the rim', () => {
        const l = ledger();
        l.hold(0, RED, 0);
        const p = l.packet(0, 100, 0.05);
        expect(p.fall).toBe(0);
        expect(p.hops).toBe(3);
        expect(p.bornWater).toBeCloseTo(100 + 0.05 + 3 * LEDGER.hop, 9);
        expect(p.width).toBe(LEDGER.packetWidth);
        expect(p.strength).toBe(LEDGER.packetStrength);
        expect(p.rgb).toEqual(RED.map((v) => Math.fround(v)));
        // The same packet whatever the world's clock: only the water clock schedules it.
        const again = l.packet(0, 100, 0.05, {});
        expect(again.bornWater).toBe(p.bornWater);
        expect(l.packet(5, 7.5).bornWater).toBeCloseTo(7.5 + LEDGER.hop, 9);
    });

    it('drains softly on a new run and dims slowly on game over, sending nothing down', () => {
        const l = ledger();
        holdAll(l);
        l.dimAll(20, LEDGER.drainFade);
        expect(l.glowAt(10, 20 + LEDGER.drainFade / 2)).toBeGreaterThan(0);
        expect(l.glowAt(10, 20 + LEDGER.drainFade)).toBe(0);
        expect(l.heldCount(21)).toBe(0);
        expect(l.releaseOldest(Infinity, 21)).toEqual([]);
        // What is held after the drain is untouched by it.
        l.hold(4, RED, 22);
        expect(l.glowAt(4, 23)).toBe(1);
        l.dimAll(25, LEDGER.overFade);
        expect(l.glowAt(4, 25 + LEDGER.overFade / 2)).toBeGreaterThan(0);
        expect(l.glowAt(4, 25 + LEDGER.overFade)).toBe(0);
    });

    it('keeps what pools hold through a new layout, and reuses what it is given', () => {
        const l = ledger();
        l.hold(2, RED, 0);
        l.place(SITES.map((s) => ({ ...s, y: s.y * 0.9 })), 0);
        expect(l.glowAt(2, 1)).toBe(1);
        const out = [];
        expect(l.releaseOldest(1, 1, out)).toBe(out);
        l.place(SITES.slice(0, 2), 0);
        expect(l.count).toBe(2);
        l.reset();
        expect(l.heldCount(0)).toBe(0);
    });
});

describe('Sky Children stroke book', () => {
    const colour = (k) => [k / 10, 1 - k / 10, 0.5];

    it('knows the true bow: seven primary strokes by seven different pieces', () => {
        const book = new StrokeBook();
        'SJITZLO'.split('').forEach((shape, k) => book.link(k + 1, colour(k), shape));
        expect(book.isTrueBow()).toBe(true);
        const repeat = new StrokeBook();
        'SJITZLS'.split('').forEach((shape, k) => repeat.link(k + 1, colour(k), shape));
        expect(repeat.isTrueBow()).toBe(false);
        const short = new StrokeBook();
        'SJITZL'.split('').forEach((shape, k) => short.link(k + 1, colour(k), shape));
        expect(short.isTrueBow()).toBe(false);
        // A new chain starts the count again.
        book.link(1, colour(0), 'S');
        expect(book.count).toBe(1);
        expect(book.isTrueBow()).toBe(false);
    });

    it('turns the colours one stroke along for a T-spin, the last coming round to the first', () => {
        const book = new StrokeBook();
        'SJITZLO'.split('').forEach((shape, k) => book.link(k + 1, colour(k), shape));
        const before = Array.from({ length: 7 }, (_, i) => book.colourOf(i));
        book.rotate();
        for (let i = 0; i < 7; i++) {
            const was = before[(i + 6) % 7];
            book.colourOf(i).forEach((v, c) => expect(v).toBeCloseTo(was[c], 6));
        }
        expect(book.shapes.slice(0, 7).join('')).toBe('OSJITZL');
        expect(book.isTrueBow()).toBe(true);
        // Only the painted strokes turn.
        const three = new StrokeBook();
        [0, 1, 2].forEach((k) => three.link(k + 1, colour(k), 'T'));
        three.rotate();
        expect(three.colourOf(0)[0]).toBeCloseTo(0.2, 6);
        expect(three.colourOf(3)).toEqual([0, 0, 0]);
    });

    it('paints nothing past the twelfth link', () => {
        const book = new StrokeBook();
        for (let k = 1; k <= 15; k++) book.link(k, colour(k % 10), 'I');
        expect(book.count).toBe(DIAL.strokes);
        expect(book.rgb).toHaveLength(DIAL.strokes * 3);
        book.link(0, colour(1), 'I');
        book.link(Number.NaN, colour(1), 'I');
        expect(book.count).toBe(DIAL.strokes);
    });
});

describe('Sky Children dial', () => {
    it('paints a stroke in a second, and faster when links arrive faster than strokes can be painted', () => {
        const dial = new Dial();
        dial.set(1, 0);
        // max(1/stroke, backlog/rush) strokes a second: a lone link is painted within the second.
        expect(dial.value(0.5)).toBeGreaterThanOrEqual(0.5);
        expect(dial.value(0.5)).toBeLessThan(0.65);
        expect(dial.value(DIAL.stroke)).toBe(1);
        expect(dial.value(5)).toBe(1);
        // Links one every two seconds: each stroke within its second.
        dial.set(2, 10);
        expect(dial.value(10 + DIAL.stroke)).toBe(2);
        expect(dial.value(10 + 0.9 * DIAL.stroke)).toBeLessThan(2);
        // Seven links at once: no stroke takes longer than a second, and all are painted long
        // before seven seconds.
        const rush = new Dial();
        rush.set(7, 0);
        let crossed = 0;
        let lastCross = 0;
        for (let t = 0; t < 8; t += 0.001) {
            const v = rush.value(t);
            if (v >= crossed + 1 - 1e-9) {
                crossed += 1;
                expect(t - lastCross).toBeLessThanOrEqual(DIAL.stroke + 1e-3);
                lastCross = t;
            }
        }
        expect(crossed).toBe(7);
        expect(lastCross).toBeLessThan(4);
        // Monotonic on the way up.
        let last = 0;
        for (let t = 0; t < 4; t += 0.01) {
            expect(rush.value(t)).toBeGreaterThanOrEqual(last - 1e-12);
            last = rush.value(t);
        }
    });

    it('withdraws newest first, one stroke every 0.35 s, each fading as it goes', () => {
        const dial = new Dial();
        dial.set(7, 0);
        dial.set(0, 20);
        for (let k = 0; k <= 7; k++) expect(dial.value(20 + k * DIAL.unwind)).toBeCloseTo(7 - k, 9);
        // The newest stroke (the 7th) is the first to go; the first stays while it does.
        expect(dial.progress(6, 20 + DIAL.unwind / 2)).toBeCloseTo(0.5, 9);
        expect(dial.progress(0, 20 + DIAL.unwind / 2)).toBe(1);
        expect(dial.fade(0, 20 + DIAL.unwind)).toBe(1);
        expect(dial.fade(6, 20 + DIAL.fade + 1e-6)).toBe(0);
        expect(dial.fade(6, 20 + DIAL.fade / 2)).toBeGreaterThan(0);
        expect(dial.fade(5, 20 + DIAL.unwind + DIAL.fade / 2)).toBeCloseTo(0.5, 6);
    });

    it('holds four seconds after a break while back-to-back is live, then lets go', () => {
        const dial = new Dial();
        dial.set(7, 0);
        dial.set(0, 20, { b2b: true });
        expect(dial.value(20 + DIAL.grace - 0.01)).toBe(7);
        expect(dial.fade(6, 20 + DIAL.grace - 0.01)).toBe(1);
        expect(dial.value(20 + DIAL.grace + DIAL.unwind)).toBeCloseTo(6, 9);
        // A new chain's first link during the grace does not cut it short ...
        const kept = new Dial();
        kept.set(7, 0);
        kept.set(0, 20, { b2b: true });
        kept.set(1, 21, { b2b: true });
        expect(kept.value(23.9)).toBe(7);
        expect(kept.value(24 + 6 * DIAL.unwind + 1)).toBe(1);
        // ... but a chain that climbs past it paints on at once.
        kept.set(8, 30, { b2b: true });
        expect(kept.value(30.5)).toBeGreaterThan(1);
        // Without B2B a break withdraws at once.
        const plain = new Dial();
        plain.set(7, 0);
        plain.set(0, 20);
        expect(plain.value(20 + DIAL.unwind)).toBeCloseTo(6, 9);
    });

    it('tops out at thirteen and resets to nothing', () => {
        const dial = new Dial();
        dial.set(40, 0);
        expect(dial.target).toBe(DIAL.max);
        expect(dial.value(60)).toBe(DIAL.max);
        dial.reset(61);
        expect(dial.value(62)).toBe(0);
        expect(DIAL.primary + DIAL.secondary).toBe(DIAL.strokes);
    });
});
