/**
 * Rainbow Terraces — the event effects in closed form (rainbow-terraces-events.js, three-free).
 *
 * Every visible beat of a lock or a clear is a record in a preallocated ring, evaluated at a time:
 * emit(t) is a function of t and the records alone (so a seek reproduces any frame), a lock lands
 * when its melt and flight are done (a hard drop's jet at once), each landing is reported once,
 * crowns and sheets die after their life, and the rings never grow. Timings are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    CROWN_LIFE, EventEffects, LOCK, SHEET_LIFE,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-events.js';
import { frameFor, project, unproject } from '../../src/themes/rainbow-terraces/rainbow-terraces-frame.js';

const T_CELLS = [-1, -0.5, 0, -0.5, 1, -0.5, 0, 0.5];
const SIZES = {
    threads: 6, droplets: 12, crowns: 8, sheets: 10,
};

/** Every light emit(t) pushes, as plain arrays. */
function lights(fx, t) {
    const out = [];
    fx.emit(t, (...args) => out.push(args.map((v) => (typeof v === 'number' ? Number(v.toFixed(9)) : v))));
    return out;
}

function lockAt(fx, at, extra = {}) {
    return fx.lock(at, {
        from: [-20, 5, -40],
        to: [-180, -40, -480],
        right: [1, 0, 0],
        up: [0, 1, 0],
        cells: T_CELLS,
        cellSize: 0.8,
        colour: [0.2, 0.9, 0.5],
        pool: 3,
        ...extra,
    });
}

/** A busy script: locks, a hard drop, crowns and sheets. */
function script(fx) {
    lockAt(fx, 1.0);
    lockAt(fx, 1.3, { hardDrop: true, pool: 5 });
    lockAt(fx, 1.7, { flight: 1.05, pool: 7 });
    fx.crown(1.9, [0, -10, -300], [1, 0.5, 0.2], { count: 12, size: 1.5, speed: 7 });
    for (let k = 0; k < 4; k++) {
        fx.sheet(2.0 + k * 0.04, [-10, k, -42], [-1, 0, 0], [1, 0.9, 0.7], { speed: 30 });
        fx.sheet(2.0 + k * 0.04, [10, k, -42], [1, 0, 0], [1, 0.9, 0.7], { speed: 30 });
    }
}

describe('rainbow terraces event effects', () => {
    it('emits a pure function of the time and the records: the same lights twice, in any order of asking', () => {
        const a = new EventEffects(SIZES);
        const b = new EventEffects(SIZES);
        script(a);
        script(b);
        const times = [0.5, 1.05, 1.2, 1.31, 1.45, 1.95, 2.1, 2.5, 3.0, 4.0];
        const first = times.map((t) => lights(a, t));
        // Asked again, backward, and on a twin built the same way: identical.
        expect(times.map((t) => lights(a, t))).toEqual(first);
        expect([...times].reverse().map((t) => lights(a, t)).reverse()).toEqual(first);
        expect(times.map((t) => lights(b, t))).toEqual(first);
        // Something happens at the busy moments, nothing before the first record.
        expect(lights(a, 0.5)).toEqual([]);
        expect(first.slice(1, 8).every((l) => l.length > 0)).toBe(true);
        // Asking which locks landed does not change what is drawn.
        a.landed(10);
        expect(times.map((t) => lights(a, t))).toEqual(first);
    });

    it('forgets every record on reset', () => {
        const fx = new EventEffects(SIZES);
        script(fx);
        expect(lights(fx, 2.1).length).toBeGreaterThan(0);
        fx.reset();
        for (const t of [1.05, 1.31, 2.1, 2.5]) expect(lights(fx, t), `t ${t}`).toEqual([]);
        expect(fx.landed(100)).toEqual([]);
    });

    it('lands a lock after its melt and flight, and a hard drop\'s jet at once', () => {
        const fx = new EventEffects(SIZES);
        expect(lockAt(fx, 2, { flight: 0.9 })).toBeCloseTo(2 + LOCK.melt + 0.9, 12);
        expect(lockAt(fx, 2, { flight: 1.1 })).toBeCloseTo(2 + LOCK.melt + 1.1, 12);
        expect(lockAt(fx, 2)).toBeCloseTo(2 + LOCK.melt + LOCK.flight, 12);
        // A hard drop has no melt and flies the jet whatever flight it was given.
        expect(lockAt(fx, 2, { hardDrop: true, flight: 0.9 })).toBeCloseTo(2 + LOCK.jet, 12);
        expect(LOCK.melt).toBeCloseTo(0.24, 12);
        expect(LOCK.jet).toBeCloseTo(0.2, 12);
        expect(LOCK.cool).toBeLessThan(LOCK.melt);
    });

    it('reports each landing once, when it lands and not before', () => {
        const fx = new EventEffects(SIZES);
        const soft = lockAt(fx, 1, { pool: 2 });
        const hard = lockAt(fx, 1.5, { hardDrop: true, pool: 9 });
        expect(hard).toBeLessThan(soft);
        expect(fx.landed(1.5 + LOCK.jet - 1e-6)).toEqual([]);
        const first = fx.landed(hard).map((r) => r.pool);
        expect(first).toEqual([9]);
        expect(fx.landed(hard + 0.01)).toEqual([]);
        expect(fx.landed(soft - 1e-6)).toEqual([]);
        const second = fx.landed(soft + 0.5);
        expect(second.map((r) => r.pool)).toEqual([2]);
        // The landed record carries what the world needs to fill the pool.
        expect(second[0].colour).toEqual([0.2, 0.9, 0.5]);
        expect(second[0].to).toEqual([-180, -40, -480]);
        expect(second[0].hard).toBe(false);
        expect(fx.landed(100)).toEqual([]);
    });

    it('lands a thread at once when a burst of locks needs its slot, so its pool still takes the colour', () => {
        const fx = new EventEffects(SIZES);
        // One slot per thread: the seventh lock in the same instant displaces the first, in flight.
        for (let k = 0; k < SIZES.threads; k++) lockAt(fx, 1, { pool: 10 + k, colour: [k / 10, 0.5, 0.5] });
        expect(fx.landed(1.01)).toEqual([]);
        lockAt(fx, 1.02, { pool: 99 });
        const now = fx.landed(1.03);
        expect(now.map((r) => r.pool)).toEqual([10]);
        expect(now[0].colour).toEqual([0, 0.5, 0.5]);
        // ...and only once.
        expect(fx.landed(1.04)).toEqual([]);
    });

    it('draws the copy at the card first, then the thread\'s head arriving at the pool as it lands', () => {
        const fx = new EventEffects(SIZES);
        const land = lockAt(fx, 1);
        // The copy: four cells (rounded squares) round the start point, white-hot at first, inside
        // the shock ring that runs out from it, sparks thrown off.
        const first = lights(fx, 1.01);
        const copy = first.filter((l) => l[7] === 2);
        expect(copy).toHaveLength(4);
        expect(first.filter((l) => l[7] === 5)).toHaveLength(1);
        expect(first.filter((l) => l[7] === 3).length).toBeGreaterThan(4);
        copy.forEach((l) => expect(Math.hypot(l[0] + 20, l[1] - 5, l[2] + 40)).toBeLessThan(2));
        expect(Math.min(...copy.map((l) => l[4]))).toBeGreaterThan(2);
        // In flight: a head and its droplets; just before landing the head is at the pool.
        const late = lights(fx, land - 1e-4);
        const head = late.find((l) => l[7] === 4);
        expect(head).toBeTruthy();
        expect(Math.hypot(head[0] + 180, head[1] + 40, head[2] + 480)).toBeLessThan(5);
        // After it lands the thread is gone.
        expect(lights(fx, land + 0.1)).toEqual([]);
    });

    it('flies a thread with screen ends on a screen arc, from the copy to the pool, shrinking with distance', () => {
        const { cam } = frameFor(16 / 9, null, {});
        const at = (x, y, d) => unproject(x, y, cam, [0, 0, 0]).map((v) => v * d);
        const from = at(0.36, 0.4, 42);
        const to = at(0.14, 0.6, 520);
        for (const via of [null, [0.3, 0.2]]) {
            const fx = new EventEffects(SIZES);
            fx.setCamera(cam);
            const land = fx.lock(1, {
                from,
                to,
                right: [1, 0, 0],
                up: [0, 1, 0],
                cellSize: 0.8,
                colour: [1, 0.4, 0.3],
                fromScreen: [0.36, 0.4],
                toScreen: [0.14, 0.6],
                viaScreen: via,
                pool: 1,
            });
            // The head is the brightest bead of the thread.
            const headAt = (t) => lights(fx, t).reduce((a, l) => (l[4] > a[4] ? l : a));
            const heads = [];
            const first = 1 + LOCK.melt + 0.005;
            const span = land - first - 1e-4;
            for (let i = 0; i <= 100; i++) heads.push(headAt(first + (i / 100) * span));
            const screen = heads.map((l) => project([l[0], l[1], l[2]], cam));
            const depth = heads.map((l) => Math.hypot(l[0], l[1], l[2]));
            const label = via ? 'round a waypoint' : 'direct';
            // It leaves the copy and arrives at the pool, on screen and in depth.
            expect(Math.hypot(screen[0].x - 0.36, screen[0].y - 0.4), label).toBeLessThan(0.03);
            expect(Math.hypot(screen.at(-1).x - 0.14, screen.at(-1).y - 0.6), label).toBeLessThan(0.02);
            expect(depth[0], label).toBeLessThan(60);
            expect(depth.at(-1), label).toBeGreaterThan(450);
            for (let i = 1; i < depth.length; i++) expect(depth[i], label).toBeGreaterThan(depth[i - 1]);
            if (via) {
                const close = Math.min(...screen.map((p) => Math.hypot(p.x - via[0], p.y - via[1])));
                expect(close, label).toBeLessThan(0.02);
            }
        }
    });

    it('lets crowns and sheets die after their life', () => {
        const fx = new EventEffects(SIZES);
        fx.crown(1, [0, 0, -100], [1, 1, 1], { count: 12 });
        expect(lights(fx, 1 + CROWN_LIFE * 0.5)).toHaveLength(12);
        expect(lights(fx, 1 + CROWN_LIFE + 1e-6)).toEqual([]);
        fx.sheet(5, [0, 0, -40], [1, 0, 0], [1, 1, 1]);
        const mid = lights(fx, 5 + SHEET_LIFE * 0.5);
        expect(mid.length).toBeGreaterThan(0);
        // Shot outward along its direction, then falling.
        expect(Math.max(...mid.map((l) => l[0]))).toBeGreaterThan(0);
        expect(Math.min(...mid.map((l) => l[1]))).toBeLessThan(0);
        expect(lights(fx, 5 + SHEET_LIFE + 1e-6)).toEqual([]);
        expect(lights(fx, 4.99)).toEqual([]);
    });

    it('never grows a ring: the oldest record is overwritten, the landing list stays within the threads', () => {
        const fx = new EventEffects(SIZES);
        const rings = [fx.locks.items, fx.crowns.items, fx.sheets.items];
        const lengths = rings.map((r) => r.length);
        expect(lengths).toEqual([SIZES.threads, SIZES.crowns, SIZES.sheets]);
        const { landings } = fx;
        // The most lights one record of each kind ever pushes, over its whole life.
        const peak = (add) => {
            const one = new EventEffects(SIZES);
            add(one);
            let top = 0;
            for (let t = 0; t <= 3; t += 0.005) {
                let n = 0;
                one.emit(t, () => { n += 1; });
                top = Math.max(top, n);
            }
            return top;
        };
        const perLock = Math.max(peak((one) => lockAt(one, 0)), peak((one) => lockAt(one, 0, { hardDrop: true })));
        const perCrown = peak((one) => one.crown(0, [0, 0, -100], [1, 1, 1]));
        const perSheet = peak((one) => one.sheet(0, [0, 0, -40], [1, 0, 0], [1, 1, 1]));
        const ceiling = SIZES.threads * perLock + SIZES.crowns * perCrown + SIZES.sheets * perSheet;
        let most = 0;
        let busiest = 0;
        for (let i = 0; i < 500; i++) {
            const t = i * 0.05;
            lockAt(fx, t, { hardDrop: i % 4 === 0 });
            fx.crown(t, [0, 0, -100], [1, 1, 1]);
            fx.sheet(t, [0, 0, -40], [1, 0, 0], [1, 1, 1]);
            most = Math.max(most, fx.landed(t).length);
            let pushed = 0;
            fx.emit(t, () => { pushed += 1; });
            busiest = Math.max(busiest, pushed);
        }
        // However many events came, a frame never draws more than the full rings can hold.
        expect(busiest).toBeGreaterThan(0);
        expect(busiest).toBeLessThanOrEqual(ceiling);
        expect([fx.locks.items, fx.crowns.items, fx.sheets.items]).toEqual(rings);
        expect([fx.locks.items, fx.crowns.items, fx.sheets.items].map((r) => r.length)).toEqual(lengths);
        expect(fx.locks.items[0]).toBe(rings[0][0]);
        expect(fx.landings).toBe(landings);
        expect(most).toBeLessThanOrEqual(SIZES.threads);
    });
});
