/**
 * A music load that fails once is loaded again. On the live site (2026-11-27) one entry in four
 * of an orb ended with the audio element in "MEDIA_ELEMENT_ERROR: Format error" on a file the
 * server serves; the switch's fallback then called play() on the failed element without loading
 * it again, that rejected at once, and the orb played in silence.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';

const created = [];
const SONG = 'https://example.test/BloodMoon.mp3';

/** A media element whose first load of BloodMoon fails the way a browser's does. */
class MusicElement {
    constructor(src = '') {
        this.loads = [];
        this.address = src;
        this.error = null;
        this.paused = !src;
        this.ended = false;
        this.volume = 1;
        this.currentTime = 0;
        this.failNextLoadOf = null;
        this.load = vi.fn();
        this.addEventListener = vi.fn();
        this.removeEventListener = vi.fn();
        this.play = vi.fn(async () => {
            if (this.error) {
                const failure = new Error('The element has no supported sources.');
                failure.name = 'NotSupportedError';
                throw failure;
            }
            this.paused = false;
        });
        created.push(this);
    }

    get src() { return this.address; }

    // Setting the address starts a fresh load, whatever the last one did.
    set src(value) {
        this.address = value;
        this.loads.push(value);
        this.error = value && this.failNextLoadOf && value.includes(this.failNextLoadOf)
            ? { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' } : null;
        if (this.error) this.failNextLoadOf = null;
    }

    get currentSrc() { return this.address; }

    pause() { this.paused = true; }
}

function createManager() {
    const manager = new SoundManager();
    manager.musicAccess.collection = { isUnlocked: () => true };
    manager.trackNames = ['EchoesOfTheSoul', 'BloodMoon'];
    manager.songsData = manager.trackNames.map((name) => ({ name, path: `/${name}.mp3` }));
    manager.musicTrack = 'EchoesOfTheSoul';
    manager.audioElement = new MusicElement('https://example.test/EchoesOfTheSoul.mp3');
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
    manager.trackFadeOutMs = 0;
    manager.trackFadeInMs = 0;
    return manager;
}

describe('a music load that fails once', () => {
    let errors;
    beforeEach(() => {
        vi.useFakeTimers();
        created.length = 0;
        errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('window', {
            location: { href: 'https://example.test/index.html' }, dispatchEvent: vi.fn(),
        });
        vi.stubGlobal('CustomEvent', function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        });
        vi.stubGlobal('Audio', MusicElement);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('is loaded again by the fallback switch, with no preloader beside it, and plays', async () => {
        const manager = createManager();
        const music = manager.audioElement;
        music.failNextLoadOf = 'BloodMoon';
        manager.musicTrack = 'BloodMoon';
        const synced = manager.ensureTrackPlaybackSynced();
        await vi.advanceTimersByTimeAsync(3000);
        await synced;
        await manager.trackSwitchPromise;

        // Two loads of the same address on the playing element: the failed one, then the retry.
        expect(music.loads).toEqual([SONG, SONG]);
        expect(music.play).toHaveBeenCalledTimes(2);
        expect(music.error).toBeNull();
        expect(manager.isTrackActuallyPlaying('BloodMoon')).toBe(true);
        expect(manager.lastAppliedTrackKey).toBe('BloodMoon');
        expect(errors).not.toHaveBeenCalled();
        expect(window.dispatchEvent).not.toHaveBeenCalled();
        // The first load bridged the old track with a preloader; the load after the failure did not.
        const preloaders = created.filter((element) => element !== music);
        expect(preloaders).toHaveLength(1);
        expect(preloaders[0].loads).toEqual([SONG, '']);
    });

    it('still reports a source that fails twice', async () => {
        const manager = createManager();
        const music = manager.audioElement;
        // Every load of this address fails.
        Object.defineProperty(music, 'failNextLoadOf', { get: () => 'BloodMoon', set: () => {} });
        manager.musicTrack = 'BloodMoon';
        const synced = manager.ensureTrackPlaybackSynced();
        await vi.advanceTimersByTimeAsync(3000);
        await synced;
        await manager.trackSwitchPromise;

        expect(music.loads).toEqual([SONG, SONG]);
        expect(manager.isTrackActuallyPlaying('BloodMoon')).toBe(false);
        expect(errors).toHaveBeenCalledOnce();
        expect(errors.mock.calls[0][0]).toContain('Music switch failed');
        expect(window.dispatchEvent).toHaveBeenCalledOnce();
        expect(window.dispatchEvent.mock.calls[0][0]).toMatchObject({
            type: 'musicPlaybackError', detail: { trackKey: 'BloodMoon' },
        });
    });

    it('leaves a healthy switch as it was: one load, bridged by a preloader', async () => {
        const manager = createManager();
        const music = manager.audioElement;
        manager.musicTrack = 'BloodMoon';
        const synced = manager.ensureTrackPlaybackSynced();
        await vi.advanceTimersByTimeAsync(3000);
        await synced;
        await manager.trackSwitchPromise;
        expect(music.loads).toEqual([SONG]);
        expect(music.play).toHaveBeenCalledOnce();
        expect(created.filter((element) => element !== music)).toHaveLength(1);
        expect(errors).not.toHaveBeenCalled();
    });
});
