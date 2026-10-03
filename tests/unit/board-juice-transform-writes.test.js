import { createHash } from 'node:crypto';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BoardJuice } from '../../src/rendering/phaser/board-juice.js';

vi.mock('@utils/helpers.js', async () => import('../../src/utils/helpers.js'));

// Recorded from the original BoardJuice implementation at 6080857. Each digest
// covers its complete ordered CSS transform sequence after removing adjacent
// duplicates. Tick counts preserve the original spring and RAF cadence as well.
const LEGACY_SEQUENCES = [
    [120, 'pulse', 33, 24, '84475a923350ec07bcb73276ac020919c9489ec517fd884d4f3ffb2c1dd917dd'],
    [120, 'nudge', 96, 34, '53f03319e5b4260567c75719b56be280607a3c4ebfe9c0d0a4b9e355d5d242a2'],
    [120, 'hardDrop', 102, 52, '8d430debc29802e80fca8741d62213120f7b96b4f8c923929e9fd112b9ebd7da'],
    [144, 'pulse', 40, 28, 'ab97f0fd37a421092ba30d6ea20f6b7702ea981a4a356e7e8065e9dfa7b63b07'],
    [144, 'nudge', 117, 41, '127c2d4e3ea95d5054c6727f32b38a4ff93118520384667f30e19c729386390a'],
    [144, 'hardDrop', 129, 60, '7b7777290a1754d70e6588ede36363a072d05e4773843e07a535014fb34acd0c'],
];

function createDriver(hz = 120) {
    let now = 0;
    let tick = 0;
    let nextId = 0;
    const pending = new Map();
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => pending.delete(id)));
    const advance = () => {
        tick += 1;
        now = (tick * 1000) / hz;
        const callbacks = Array.from(pending.values());
        pending.clear();
        callbacks.forEach((callback) => callback(now));
    };
    return {
        pending,
        advance,
        settle() {
            let ticks = 0;
            while (pending.size && ticks < 1000) {
                advance();
                ticks += 1;
            }
            expect(pending.size).toBe(0);
            return ticks;
        },
    };
}

function createElement() {
    const writes = [];
    let transform = '';
    const style = {};
    Object.defineProperty(style, 'transform', {
        get: () => transform,
        set(value) {
            transform = value;
            writes.push(value);
        },
    });
    return { element: { id: 'board', style }, writes };
}

function impulse(juice, kind) {
    if (kind === 'pulse') juice.pulse(1.005);
    else if (kind === 'nudge') juice.nudge(0.5, 0);
    else {
        juice.dip(4);
        juice.bounce();
    }
}

describe('BoardJuice changed transform writes', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(LEGACY_SEQUENCES)(
        'preserves the full legacy %s Hz %s sequence and %s ticks with only %s writes',
        (hz, kind, ticks, writeCount, digest) => {
            const driver = createDriver(hz);
            const { element, writes } = createElement();
            const juice = new BoardJuice(element);
            impulse(juice, kind);

            expect(driver.settle()).toBe(ticks);
            expect(requestAnimationFrame).toHaveBeenCalledTimes(ticks);
            expect(writes).toHaveLength(writeCount);
            expect(writes.every((value, i) => i === 0 || value !== writes[i - 1])).toBe(true);
            expect(createHash('sha256').update(JSON.stringify(writes)).digest('hex')).toBe(digest);
            expect(element.style.transform).toBe('');
            expect(juice._running).toBe(false);
        },
    );

    it('restarts a settled animation and applies the next impulse immediately', () => {
        const driver = createDriver();
        const { element, writes } = createElement();
        const juice = new BoardJuice(element);
        juice.nudge(0.5);
        driver.settle();
        const firstTransform = writes[0];
        writes.length = 0;

        juice.nudge(0.5);
        expect(driver.pending.size).toBe(1);
        driver.advance();
        expect(writes).toEqual([firstTransform]);
        driver.settle();
        expect(writes.at(-1)).toBe('');
    });

    it('clears and invalidates the presentation cache on reset without changing RAF ownership', () => {
        const driver = createDriver();
        const { element, writes } = createElement();
        const juice = new BoardJuice(element);
        juice.nudge(0.5);
        driver.advance();
        expect(element.style.transform).not.toBe('');

        juice.reset();
        expect(element.style.transform).toBe('');
        expect(juice._lastTransform).toBeNull();
        expect(driver.pending.size).toBe(1);
        const resets = requestAnimationFrame.mock.calls.length;
        driver.advance();
        expect(juice._running).toBe(false);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(resets);

        writes.length = 0;
        juice.pulse(1.005);
        driver.advance();
        expect(writes).toHaveLength(1);
        expect(writes[0]).not.toBe('');
        driver.settle();
        expect(element.style.transform).toBe('');
    });

    it('cancels pending RAF on destruction and ignores a queued callback or later impulses', () => {
        const driver = createDriver();
        const { element, writes } = createElement();
        const juice = new BoardJuice(element);
        juice.nudge(0.5);
        driver.advance();
        const staleCallback = Array.from(driver.pending.values())[0];

        juice.destroy();
        expect(cancelAnimationFrame).toHaveBeenCalledOnce();
        expect(driver.pending.size).toBe(0);
        expect(element.style.transform).toBe('');
        expect(element.style.willChange).toBe('');
        expect(element.style.transformOrigin).toBe('');
        expect(juice.element).toBeNull();
        expect(juice._lastTransform).toBeNull();
        const writeCount = writes.length;
        const requests = requestAnimationFrame.mock.calls.length;

        staleCallback(1000);
        juice.nudge(1);
        juice.tilt(1);
        juice.dip(1);
        juice.bounce();
        juice.pulse(1.01);
        juice.reset();
        juice.destroy();
        expect(writes).toHaveLength(writeCount);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(requests);
        expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    });

    it('retains disabled behavior when no element exists', () => {
        createDriver();
        const juice = new BoardJuice(null);
        expect(() => {
            juice.nudge(1);
            juice.tilt(1);
            juice.dip(1);
            juice.bounce();
            juice.pulse(1.01);
            juice.reset();
            juice.destroy();
        }).not.toThrow();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
    });
});
