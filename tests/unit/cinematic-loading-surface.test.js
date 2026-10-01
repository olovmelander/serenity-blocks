import {
    afterEach, expect, it, vi,
} from 'vitest';
import { createCinematicLoadingSurface } from '../../src/ui/cinematic-loading-surface.js';
import { waitForStartupThemeIdle } from '../../src/ui/boot-warp-startup.js';

vi.mock('../../src/ui/boot-warp-startup.js', () => ({
    waitForStartupThemeIdle: vi.fn(() => Promise.resolve()),
}));

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

function manager() {
    const release = Object.assign(vi.fn(), { uncover: vi.fn() });
    return {
        release,
        beginLoadingSurface: vi.fn(() => release),
        preloadAsyncRenderPipelines: vi.fn(() => Promise.resolve()),
        whenLoadingSurfacePipelinesSettled: vi.fn(() => Promise.resolve(true)),
        activeTheme: { name: 'test' },
    };
}

it('arms async compilation before mode setup and waits for the backend preload', async () => {
    vi.useFakeTimers();
    const tm = manager();
    let finish;
    tm.preloadAsyncRenderPipelines.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const surface = createCinematicLoadingSurface(tm);
    expect(tm.beginLoadingSurface).toHaveBeenCalledWith('cinematic-loading');
    const ready = vi.fn();
    surface.ready.then(ready);
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).not.toHaveBeenCalled();
    finish();
    await surface.ready;
    expect(ready).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    surface.cancel();
});

it('bounds a stalled backend preload and safely accepts a late completion', async () => {
    vi.useFakeTimers();
    const tm = manager();
    let finish;
    tm.preloadAsyncRenderPipelines.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const surface = createCinematicLoadingSurface(tm);
    await vi.advanceTimersByTimeAsync(2000);
    await surface.ready;
    surface.cancel();
    finish();
    await Promise.resolve();
    expect(tm.release).toHaveBeenCalledOnce();
});

it('keeps loading available when the async backend is unavailable', async () => {
    const tm = manager();
    tm.preloadAsyncRenderPipelines.mockRejectedValue(new Error('backend unavailable'));
    const surface = createCinematicLoadingSurface(tm);
    await expect(surface.ready).resolves.toBeUndefined();
    surface.cancel();
});

it('stops covering at reveal but retains compilation until streaming and pipelines settle', async () => {
    const tm = manager();
    let idle;
    waitForStartupThemeIdle.mockReturnValueOnce(new Promise((resolve) => { idle = resolve; }));
    const surface = createCinematicLoadingSurface(tm);
    await surface.ready;
    surface.uncover();
    surface.uncover();
    surface.cancel();
    expect(tm.release.uncover).toHaveBeenCalledOnce();
    expect(tm.release).not.toHaveBeenCalled();
    expect(waitForStartupThemeIdle.mock.calls[0][0]()).toBe(tm.activeTheme);
    idle();
    await vi.waitFor(() => expect(tm.release).toHaveBeenCalledOnce());
    expect(tm.whenLoadingSurfacePipelinesSettled).toHaveBeenCalledWith(5000);
});

it('releases a replaced cover once without waiting for the next theme', async () => {
    const tm = manager();
    const surface = createCinematicLoadingSurface(tm);
    await surface.ready;
    surface.cancel();
    surface.cancel();
    surface.uncover();
    expect(tm.release).toHaveBeenCalledOnce();
    expect(waitForStartupThemeIdle).not.toHaveBeenCalled();
});

it('releases the lease even if settling fails', async () => {
    const tm = manager();
    tm.whenLoadingSurfacePipelinesSettled.mockRejectedValue(new Error('disposed'));
    const surface = createCinematicLoadingSurface(tm);
    await surface.ready;
    surface.uncover();
    await vi.waitFor(() => expect(tm.release).toHaveBeenCalledOnce());
});
