import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import {
    MULTIPLAYER_EVENTS, onMultiplayerEvent,
} from '../../src/events/multiplayer-events.js';

function createCountdownElement(transitions = []) {
    const style = new Proxy({}, {
        set(target, property, value) {
            target[property] = value;
            if ((property === 'opacity' && value === '0')
                || (property === 'display' && value === 'none')) {
                transitions.push([Date.now(), property, value]);
            }
            return true;
        },
    });
    return { offsetHeight: 1, style, textContent: '' };
}

function createCountdownState(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        _countdownGeneration: 0,
        ...overrides,
    });
}

let unsubscribes = [];

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    unsubscribes = [];
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('FFA countdown lifecycle ownership', () => {
    it.each([
        {
            name: 'default countdown',
            args: [null, 5, true],
            duration: 5000,
            expectedEvents: [
                [0, 5], [750, 4], [1500, 3], [2250, 2], [3000, 1],
                [3750, 0], [3751, 'GO'],
            ],
            expectedTransitions: [[4351, 'opacity', '0'], [4651, 'display', 'none']],
            callbackAt: 4651,
        },
        {
            name: 'prefixed no-zero countdown',
            args: ['ROUND OVER', 3, false],
            duration: 5000,
            expectedEvents: [[1600, 3], [2350, 2], [3100, 1], [3850, 'GO']],
            expectedTransitions: [[4450, 'opacity', '0'], [4750, 'display', 'none']],
            callbackAt: 4750,
        },
    ])('pins the current $name timeline', async ({
        args, callbackAt, duration, expectedEvents, expectedTransitions,
    }) => {
        const transitions = [];
        const element = createCountdownElement(transitions);
        vi.stubGlobal('document', {
            getElementById: () => element,
        });
        let nextFrameId = 0;
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            nextFrameId += 1;
            Promise.resolve().then(() => callback(Date.now()));
            return nextFrameId;
        });
        const events = [];
        const unsubscribe = onMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, ({ count }) => {
            events.push([Date.now(), count]);
        });
        unsubscribes.push(unsubscribe);
        const callback = vi.fn(() => events.push([Date.now(), 'callback']));
        const state = createCountdownState();

        state.showCountdown(callback, ...args);
        if (args[0]) expect(element.textContent).toBe(args[0]);
        await vi.advanceTimersByTimeAsync(duration);

        expect(events).toEqual([...expectedEvents, [callbackAt, 'callback']]);
        expect(transitions).toEqual(expectedTransitions);
        expect(callback).toHaveBeenCalledOnce();
    });

    it('invalidates queued frames and timers when hidden', async () => {
        const frames = [];
        const element = createCountdownElement();
        vi.stubGlobal('document', { getElementById: () => element });
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            frames.push(callback);
            return frames.length;
        });
        const callback = vi.fn();
        const counts = [];
        const unsubscribe = onMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, ({ count }) => {
            counts.push(count);
        });
        unsubscribes.push(unsubscribe);
        const state = createCountdownState();

        state.showCountdown(callback, null, 2, true);
        state.hideCountdownOverlay();
        frames.splice(0).forEach((frame) => frame(0));
        await vi.runAllTimersAsync();

        expect(counts).toEqual([]);
        expect(callback).not.toHaveBeenCalled();
        expect(element.style.display).toBe('none');
        expect(element.textContent).toBe('');
    });

    it('lets a superseding countdown own the only completion callback', async () => {
        const frames = [];
        const element = createCountdownElement();
        vi.stubGlobal('document', { getElementById: () => element });
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            frames.push(callback);
            return frames.length;
        });
        const oldCallback = vi.fn();
        const newCallback = vi.fn();
        const counts = [];
        const unsubscribe = onMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, ({ count }) => {
            counts.push(count);
        });
        unsubscribes.push(unsubscribe);
        const state = createCountdownState();

        state.showCountdown(oldCallback, null, 2, true);
        state.showCountdown(newCallback, null, 1, false);
        frames.splice(0).forEach((frame) => frame(0));
        await vi.runAllTimersAsync();
        frames.splice(0).forEach((frame) => frame(Date.now()));

        expect(counts).toEqual([1, 'GO']);
        expect(oldCallback).not.toHaveBeenCalled();
        expect(newCallback).toHaveBeenCalledOnce();
    });

    it('invalidates the active countdown before cleanup resets match state', async () => {
        const frames = [];
        const element = createCountdownElement();
        vi.stubGlobal('document', { getElementById: () => element });
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            frames.push(callback);
            return frames.length;
        });
        const callback = vi.fn();
        const state = createCountdownState({
            _announceTimer: null,
            attackRouter: null,
            fragTracker: null,
            gamePhase: 'playing',
            inputValidator: null,
            players: new Map([['P1', {}]]),
            setLocalInputHooks: vi.fn(),
            stopGameLoop: vi.fn(),
            stopStateSyncLoop: vi.fn(),
            winner: 'P1',
        });

        state.showCountdown(callback, null, 2, true);
        state.cleanup();
        frames.splice(0).forEach((frame) => frame(0));
        await vi.runAllTimersAsync();

        expect(callback).not.toHaveBeenCalled();
        expect(state.gamePhase).toBe('waiting');
        expect(state.winner).toBeNull();
        expect(state.players.size).toBe(0);
        expect(element.style.display).toBe('none');
    });
});
