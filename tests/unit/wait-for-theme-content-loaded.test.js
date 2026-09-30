import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { waitForThemeContentLoaded } from '../../src/ui/boot-warp-startup.js';

// waitForThemeContentLoaded (src/ui/boot-warp-startup.js, ADR-0020): before a loading surface
// lifts, wait (bounded) for the theme's OWN content loads — streamed buildings, background,
// deferred materials, scene creation — but never for its shader prewarm or pipelines still in
// flight, which the surface's own async-pipeline gate covers. Fake timers drive both the poll
// (setTimeout) and the budget clock (performance.now).

// Start the wait and expose its state without awaiting it.
function track(promise) {
    const state = { settled: false, value: undefined };
    promise.then((value) => {
        state.settled = true;
        state.value = value;
    });
    return state;
}

// Drain microtasks without letting fake time move.
const drain = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('waitForThemeContentLoaded', () => {
    it.each([
        ['a theme with no content-load flags', { name: 'forest' }],
        ['a theme whose loads report complete', {
            buildingLoadInProgress: false,
            buildingLoadComplete: true,
            buildingLoadPromise: Promise.resolve(),
            backgroundLoadInProgress: false,
            backgroundLoadComplete: true,
            backgroundLoadPromise: Promise.resolve(),
            deferredMaterialLoadInProgress: false,
            deferredMaterialLoadComplete: true,
            deferredMaterialLoadPromise: Promise.resolve(),
            isCreatingScene: false,
        }],
        ['a theme that is only shader-prewarming', { isPrewarming: true }],
        ['a theme with only an unfinished prewarm promise', { prewarmPromise: new Promise(() => {}) }],
        ['a theme with only async pipelines in flight', { asyncPipelinesInFlight: 4 }],
        ['a theme with every non-content busy reason at once', {
            isPrewarming: true,
            prewarmPromise: new Promise(() => {}),
            asyncPipelinesInFlight: 12,
        }],
    ])('resolves true immediately for %s', async (_label, theme) => {
        const getTheme = vi.fn(() => theme);
        const state = track(waitForThemeContentLoaded(getTheme, { maxWaitMs: 1000, pollMs: 100 }));

        await drain();

        expect(state).toEqual({ settled: true, value: true });
        expect(getTheme).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0); // it never scheduled a poll
    });

    it.each([
        ['getTheme returns null', () => null],
        ['getTheme returns undefined', () => undefined],
    ])('resolves true immediately when %s', async (_label, getTheme) => {
        const state = track(waitForThemeContentLoaded(getTheme, { maxWaitMs: 1000, pollMs: 100 }));
        await drain();
        expect(state).toEqual({ settled: true, value: true });
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['getTheme is missing', undefined],
        ['getTheme is not a function', { buildingLoadInProgress: true }],
    ])('resolves true immediately when %s', async (_label, getTheme) => {
        const state = track(waitForThemeContentLoaded(getTheme, { maxWaitMs: 1000, pollMs: 100 }));
        await drain();
        expect(state).toEqual({ settled: true, value: true });
    });

    it.each([
        ['buildingLoadInProgress', { buildingLoadInProgress: true }, (t) => { t.buildingLoadInProgress = false; }],
        ['backgroundLoadInProgress', { backgroundLoadInProgress: true }, (t) => {
            t.backgroundLoadInProgress = false;
        }],
        ['deferredMaterialLoadInProgress', { deferredMaterialLoadInProgress: true }, (t) => {
            t.deferredMaterialLoadInProgress = false;
        }],
        ['isCreatingScene', { isCreatingScene: true }, (t) => { t.isCreatingScene = false; }],
        ['an unresolved buildingLoadPromise', {
            buildingLoadPromise: new Promise(() => {}),
            buildingLoadComplete: false,
        }, (t) => { t.buildingLoadComplete = true; }],
        ['an unresolved backgroundLoadPromise', {
            backgroundLoadPromise: new Promise(() => {}),
        }, (t) => { t.backgroundLoadComplete = true; }],
        ['an unresolved deferredMaterialLoadPromise', {
            deferredMaterialLoadPromise: new Promise(() => {}),
        }, (t) => { t.deferredMaterialLoadPromise = null; }],
    ])('waits while %s is set and resolves true on the first poll after it clears', async (_label, busy, clear) => {
        const theme = { name: 'forest', ...busy };
        const getTheme = vi.fn(() => theme);
        const state = track(waitForThemeContentLoaded(getTheme, { maxWaitMs: 5000, pollMs: 100 }));

        await vi.advanceTimersByTimeAsync(250);
        expect(state.settled).toBe(false);
        expect(getTheme).toHaveBeenCalledTimes(3); // t = 0, 100, 200

        clear(theme);
        // The next poll is at t = 300: nothing reads the cleared flag before it.
        await vi.advanceTimersByTimeAsync(49);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state).toEqual({ settled: true, value: true });
        expect(getTheme).toHaveBeenCalledTimes(4);
        expect(vi.getTimerCount()).toBe(0); // and stops polling once it has resolved
    });

    it('keeps waiting until EVERY content load has cleared, not just the first', async () => {
        const theme = {
            buildingLoadInProgress: true,
            deferredMaterialLoadInProgress: true,
            isPrewarming: true,
        };
        const state = track(waitForThemeContentLoaded(() => theme, { maxWaitMs: 5000, pollMs: 100 }));

        await vi.advanceTimersByTimeAsync(150);
        theme.buildingLoadInProgress = false;
        await vi.advanceTimersByTimeAsync(500);
        expect(state.settled).toBe(false);

        // The shader prewarm is still running: content is all that is waited on.
        theme.deferredMaterialLoadInProgress = false;
        await vi.advanceTimersByTimeAsync(100);
        expect(state).toEqual({ settled: true, value: true });
        expect(theme.isPrewarming).toBe(true);
    });

    it('re-reads getTheme on every poll (the pending theme instance can change mid-wait)', async () => {
        const loading = { name: 'forest-a', buildingLoadInProgress: true };
        const loaded = { name: 'forest-b', asyncPipelinesInFlight: 2 };
        let current = loading;
        const state = track(waitForThemeContentLoaded(() => current, { maxWaitMs: 5000, pollMs: 100 }));

        await vi.advanceTimersByTimeAsync(150);
        expect(state.settled).toBe(false);
        current = loaded;
        await vi.advanceTimersByTimeAsync(50);
        expect(state).toEqual({ settled: true, value: true });
        expect(loading.buildingLoadInProgress).toBe(true);
    });

    it('treats a theme that goes away mid-wait (getTheme -> null) as loaded', async () => {
        let current = { backgroundLoadInProgress: true };
        const state = track(waitForThemeContentLoaded(() => current, { maxWaitMs: 5000, pollMs: 100 }));

        await vi.advanceTimersByTimeAsync(150);
        expect(state.settled).toBe(false);
        current = null;
        await vi.advanceTimersByTimeAsync(50);
        expect(state).toEqual({ settled: true, value: true });
    });

    it('resolves false once maxWaitMs has passed with content still loading', async () => {
        const theme = { buildingLoadInProgress: true };
        const getTheme = vi.fn(() => theme);
        const state = track(waitForThemeContentLoaded(getTheme, { maxWaitMs: 1000, pollMs: 100 }));

        await vi.advanceTimersByTimeAsync(999);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state).toEqual({ settled: true, value: false });
        expect(getTheme).toHaveBeenCalledTimes(11); // t = 0, 100, ..., 1000
        expect(vi.getTimerCount()).toBe(0);

        // A load that clears after the budget has no effect on the settled result.
        theme.buildingLoadInProgress = false;
        await vi.advanceTimersByTimeAsync(500);
        expect(state.value).toBe(false);
        expect(getTheme).toHaveBeenCalledTimes(11);
    });

    it('bounds the wait even when pollMs does not divide maxWaitMs', async () => {
        const state = track(waitForThemeContentLoaded(
            () => ({ isCreatingScene: true }),
            { maxWaitMs: 250, pollMs: 100 },
        ));

        // Checks at t = 0, 100, 200 are under the budget; the one at t = 300 is past it.
        await vi.advanceTimersByTimeAsync(299);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state).toEqual({ settled: true, value: false });
    });

    it('polls every 100 ms for up to 6 s by default', async () => {
        const getTheme = vi.fn(() => ({ deferredMaterialLoadInProgress: true }));
        const state = track(waitForThemeContentLoaded(getTheme));

        await vi.advanceTimersByTimeAsync(5999);
        expect(state.settled).toBe(false);
        expect(getTheme).toHaveBeenCalledTimes(60);
        await vi.advanceTimersByTimeAsync(1);
        expect(state).toEqual({ settled: true, value: false });
        expect(getTheme).toHaveBeenCalledTimes(61);
    });

    it('a maxWaitMs of 0 checks once and gives up at once while content is loading', async () => {
        const getTheme = vi.fn(() => ({ buildingLoadInProgress: true }));
        const state = track(waitForThemeContentLoaded(getTheme, { maxWaitMs: 0, pollMs: 100 }));
        await drain();
        expect(state).toEqual({ settled: true, value: false });
        expect(getTheme).toHaveBeenCalledTimes(1);
    });
});
