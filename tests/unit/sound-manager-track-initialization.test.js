import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function manifest(names) {
    return { ok: true, json: async () => names.map((name) => ({ name, path: `${name}.mp3` })) };
}

describe('shared music manifest and owner initialization', () => {
    let SoundManager;
    let loadSongs;
    let getAvailableSongs;
    let dropdown;
    let fetch;

    beforeEach(async () => {
        vi.resetModules();
        ({ SoundManager } = await import('../../src/audio/sound-manager.js'));
        ({ loadSongs, getAvailableSongs } = await import('../../src/audio/music-loader.js'));
        dropdown = { value: '', appendChild: vi.fn() };
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => dropdown), createElement: vi.fn(() => ({})),
        });
        fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shares overlapping boot initialization and builds the dropdown once', async () => {
        const request = deferred();
        fetch.mockReturnValue(request.promise);
        const manager = new SoundManager();
        manager.preloadDefaultTrack = vi.fn();
        const first = manager.initializeTracks();
        const second = manager.initializeTracks();
        expect(second).toBe(first);
        expect(fetch).toHaveBeenCalledOnce();
        request.resolve(manifest(['Moon Light', 'Calm Sky']));
        expect(await first).toBe(manager);
        expect(await second).toBe(manager);
        expect(manager.trackNames).toEqual(['MoonLight', 'CalmSky']);
        expect(manager.musicTrack).toBe('MoonLight');
        expect(dropdown.value).toBe('MoonLight');
        expect(dropdown.appendChild).toHaveBeenCalledTimes(2);
        expect(manager.preloadDefaultTrack).toHaveBeenCalledOnce();
        expect(manager.pendingTrackInitialization).toBeNull();
    });

    it('shares the manifest across separate managers but applies each live owner', async () => {
        const request = deferred();
        fetch.mockReturnValue(request.promise);
        const first = new SoundManager();
        const second = new SoundManager();
        const pending = [first.initializeTracks(), second.initializeTracks(), loadSongs()];
        expect(fetch).toHaveBeenCalledOnce();
        request.resolve(manifest(['Echoes Of The Soul', 'Ocean Deep']));
        await Promise.all(pending);
        expect(first.musicTrack).toBe('EchoesOfTheSoul');
        expect(second.trackNames).toEqual(first.trackNames);
        expect(getAvailableSongs()).toBe(first.songsData);
        expect(dropdown.appendChild).toHaveBeenCalledTimes(4);
    });

    it('returns the fallback after an HTTP failure and retries on a later request', async () => {
        fetch.mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce(manifest(['Restored Song']));
        const manager = new SoundManager();
        await manager.initializeTracks();
        expect(manager.trackNames).toEqual(['EchoesoftheSoul']);
        expect(manager.pendingTrackInitialization).toBeNull();
        await manager.initializeTracks();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(manager.trackNames).toEqual(['RestoredSong']);
    });

    it('shares a failed request fallback and permits a later network retry', async () => {
        const request = deferred();
        fetch.mockReturnValueOnce(request.promise).mockResolvedValueOnce(manifest(['Recovered']));
        const first = loadSongs();
        expect(loadSongs()).toBe(first);
        request.reject(new Error('Offline'));
        expect((await first)[0].name).toBe('Echoes of the Soul');
        expect((await loadSongs())[0].name).toBe('Recovered');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not populate or preload after its owner has been cleaned up', async () => {
        const request = deferred();
        fetch.mockReturnValue(request.promise);
        const manager = new SoundManager();
        manager.preloadDefaultTrack = vi.fn();
        const pending = manager.initializeTracks();
        manager.cleanup();
        request.resolve(manifest(['Late Song']));
        expect(await pending).toBe(manager);
        expect(manager.songsData).toEqual([]);
        expect(dropdown.appendChild).not.toHaveBeenCalled();
        expect(manager.preloadDefaultTrack).not.toHaveBeenCalled();
    });

    it('allows a replacement initialization while retiring the previous continuation', async () => {
        const request = deferred();
        fetch.mockReturnValue(request.promise);
        const manager = new SoundManager();
        const retired = manager.initializeTracks();
        manager.cleanup();
        const replacement = manager.initializeTracks();
        expect(replacement).not.toBe(retired);
        expect(fetch).toHaveBeenCalledOnce();
        request.resolve(manifest(['Replacement Song']));
        await Promise.all([retired, replacement]);
        expect(dropdown.appendChild).toHaveBeenCalledOnce();
        expect(manager.trackNames).toEqual(['ReplacementSong']);
        expect(manager.pendingTrackInitialization).toBeNull();
    });
});
