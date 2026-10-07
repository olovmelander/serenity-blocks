import {
    afterEach, describe, expect, it,
} from 'vitest';
import { createVirtualClock } from '../../scripts/odyssey-benchmark/virtual-clock.mjs';

let clock;
afterEach(() => clock?.restore());

describe('Odyssey benchmark virtual clock', () => {
    it('advances chained async waits chronologically and restores every owned global', async () => {
        const names = [
            'Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'requestAnimationFrame', 'cancelAnimationFrame',
        ];
        const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
        clock = createVirtualClock({ epochMs: 1000000 }).install();
        const events = [];
        const physics = (async () => {
            await new Promise((resolve) => { setTimeout(resolve, 30); });
            events.push(['first', performance.now(), Date.now(), new Date().getTime()]);
            await new Promise((resolve) => { setTimeout(resolve, 70); });
            events.push(['second', performance.now()]);
        })();
        await clock.advance(99);
        expect(events).toEqual([['first', 30, 1000030, 1000030]]);
        await clock.advance(1);
        await physics;
        expect(events[1]).toEqual(['second', 100]);
        clock.restore();
        expect(names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))).toEqual(originals);
    });

    it('keeps interval cancellation and animation-frame boundaries separate', async () => {
        clock = createVirtualClock().install();
        const frames = [];
        let intervals = 0;
        const interval = setInterval(() => {
            intervals++;
            if (intervals === 2) clearInterval(interval);
        }, 10);
        const cancelled = requestAnimationFrame(() => frames.push('cancelled'));
        cancelAnimationFrame(cancelled);
        requestAnimationFrame((time) => frames.push(time));
        await clock.advance(40);
        expect(intervals).toBe(2);
        expect(frames).toEqual([1000 / 60]);
        expect(clock.pendingCount).toBe(0);
    });

    it('drains a captured continuation without advancing unrelated gameplay frames', async () => {
        clock = createVirtualClock().install();
        const physics = (async () => {
            await new Promise((resolve) => { setTimeout(resolve, 300); });
            await new Promise((resolve) => { setTimeout(resolve, 120); });
            return 'settled';
        })();
        expect(await clock.settle(physics)).toBe('settled');
        expect(clock.now).toBe(420);
        expect(clock.pendingCount).toBe(0);
    });

    it('surfaces rejected drains and refuses overlapping process-wide clocks', async () => {
        clock = createVirtualClock().install();
        expect(() => createVirtualClock().install()).toThrow('serially');
        await expect(clock.settle(Promise.reject(new Error('physics rejected')))).rejects.toThrow('physics rejected');
        expect(clock.pendingCount).toBe(0);
    });
});
