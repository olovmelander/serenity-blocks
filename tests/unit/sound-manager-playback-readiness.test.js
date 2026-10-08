import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

class MusicElement {
    constructor(src = '') {
        this.src = src;
        this.paused = !src;
        this.ended = false;
        this.volume = 1;
        this.currentTime = 0;
        this.load = vi.fn();
        this.addEventListener = vi.fn();
        this.removeEventListener = vi.fn();
        this.play = vi.fn(async () => { this.paused = false; });
    }

    get currentSrc() { return this.src; }

    pause() { this.paused = true; }
}

function createManager() {
    const manager = new SoundManager();
    manager.trackNames = ['Alpha', 'Beta', 'Gamma'];
    manager.songsData = manager.trackNames.map((name) => ({ name, path: `/${name}.mp3` }));
    manager.musicTrack = 'Alpha';
    manager.audioElement = new MusicElement('https://example.test/Alpha.mp3');
    manager.audioContext = { currentTime: 0 };
    manager.musicGainWired = true;
    manager.musicGainNode = {
        gain: {
            value: 1,
            cancelScheduledValues: vi.fn(),
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
        },
    };
    manager.ensureAudioAnalysisReady = vi.fn();
    return manager;
}

async function flushMicrotasks() {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('music playback readiness without waiting for fade completion', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', {
            location: { href: 'https://example.test/index.html' }, dispatchEvent: vi.fn(),
        });
        vi.stubGlobal('Audio', MusicElement);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('keeps an already playing selected track uninterrupted', async () => {
        const manager = createManager();
        const switchTrack = vi.spyOn(manager, 'playAudioFile');
        await manager.ensureTrackPlaybackSynced({ waitForFade: false, force: true });
        expect(switchTrack).not.toHaveBeenCalled();
        expect(manager.audioElement.play).not.toHaveBeenCalled();
        expect(manager.isTrackActuallyPlaying('Alpha')).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('allows readiness at playback while retaining the complete fade for default callers', async () => {
        const manager = createManager();
        manager.musicTrack = 'Beta';
        const readiness = vi.fn();
        const fadeFinished = vi.fn();
        const prepared = manager.ensureTrackPlaybackSynced({ waitForFade: false }).then(readiness);
        const full = manager.ensureTrackPlaybackSynced().then(fadeFinished);
        await flushMicrotasks();
        expect(readiness).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2550);
        await prepared;
        expect(manager.isTrackActuallyPlaying('Beta')).toBe(true);
        expect(readiness).toHaveBeenCalledOnce();
        expect(fadeFinished).not.toHaveBeenCalled();
        expect(manager.pendingTrackKey).toBe('Beta');
        expect(manager.volumeFadeFrame).not.toBeNull();
        // Another readiness waiter during the fade joins the same played source.
        await manager.ensureTrackPlaybackSynced({ waitForFade: false });
        expect(manager.audioElement.play).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(2050);
        await full;
        expect(fadeFinished).toHaveBeenCalledOnce();
        expect(manager.pendingTrackKey).toBeNull();
        expect(manager.pendingTrackPlayback).toBeNull();
        expect(manager.musicGainNode.gain.value).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not confuse loaded media or a pending play request with playback', async () => {
        const manager = createManager();
        const play = deferred();
        manager.audioElement.play.mockImplementation(() => play.promise.then(() => {
            manager.audioElement.paused = false;
        }));
        manager.musicTrack = 'Beta';
        manager.trackFadeOutMs = 0;
        const readiness = vi.fn();
        const prepared = manager.ensureTrackPlaybackSynced({ waitForFade: false }).then(readiness);
        await flushMicrotasks();
        expect(manager.audioElement.src).toBe('https://example.test/Beta.mp3');
        expect(manager.audioElement.play).toHaveBeenCalledOnce();
        expect(readiness).not.toHaveBeenCalled();
        play.resolve();
        await prepared;
        expect(manager.isTrackActuallyPlaying('Beta')).toBe(true);
        expect(manager.pendingTrackKey).toBe('Beta');
        await vi.advanceTimersByTimeAsync(2050);
        await manager.trackSwitchPromise;
    });

    it.each([true, false])('never resurrects a superseded selection (waitForFade=%s)', async (waitForFade) => {
        const manager = createManager();
        manager.musicTrack = 'Beta';
        const oldSwitch = manager.startBackgroundMusic();
        const prepared = manager.ensureTrackPlaybackSynced({ waitForFade });
        await flushMicrotasks();
        manager.musicTrack = 'Gamma';
        const latest = manager.startBackgroundMusic({ fadeOutMs: 0, fadeInMs: 0 });
        await Promise.all([prepared, oldSwitch, latest]);
        expect(manager.isTrackActuallyPlaying('Gamma')).toBe(true);
        expect(manager.audioElement.play).toHaveBeenCalledOnce();
        expect(manager.trackRequestToken).toBe(2);
        expect(manager.pendingTrackPlayback).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['stopBackgroundMusic', 'cleanup', 'toggleMute'])('settles waiting readiness on %s without restarting audio', async (action) => {
        const manager = createManager();
        manager.musicTrack = 'Beta';
        const switching = manager.startBackgroundMusic();
        const prepared = manager.ensureTrackPlaybackSynced({ waitForFade: false });
        const element = manager.audioElement;
        await flushMicrotasks();
        manager[action]();
        await Promise.all([prepared, switching]);
        expect(element.play).not.toHaveBeenCalled();
        expect(manager.pendingTrackPlayback).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('settles failed playback and retains the existing recovery and error reporting path', async () => {
        const manager = createManager();
        manager.musicTrack = 'Beta';
        manager.trackFadeOutMs = 0;
        manager.audioElement.play.mockRejectedValue(new Error('Unsupported media'));
        const report = vi.spyOn(manager, 'emitMusicPlaybackError').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await manager.ensureTrackPlaybackSynced({ waitForFade: false });
        await manager.trackSwitchPromise;
        expect(manager.audioElement.play).toHaveBeenCalledTimes(2);
        expect(manager.isMusicPlaying()).toBe(false);
        expect(report).toHaveBeenCalledOnce();
        expect(manager.pendingTrackPlayback).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports readiness after successful fallback playback without leaking a failed first attempt', async () => {
        const manager = createManager();
        manager.musicTrack = 'Beta';
        manager.trackFadeOutMs = 0;
        manager.audioElement.play.mockRejectedValueOnce(new Error('Initial playback failure'));
        await manager.ensureTrackPlaybackSynced({ waitForFade: false });
        await manager.trackSwitchPromise;
        expect(manager.audioElement.play).toHaveBeenCalledTimes(2);
        expect(manager.isTrackActuallyPlaying('Beta')).toBe(true);
        expect(manager.pendingTrackPlayback).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});
