/* eslint-disable import/first */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { SoundManager } from '../../src/audio/sound-manager.js';

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
    }

    get currentSrc() { return this.src; }

    pause() { this.paused = true; }

    async play() { this.paused = false; }
}

function createAudio(volume = 1) {
    const sound = new SoundManager();
    sound.trackNames = ['Alpha', 'Beta'];
    sound.songsData = sound.trackNames.map((name) => ({ name, path: `/${name}.mp3` }));
    sound.musicTrack = 'Alpha';
    sound.audioElement = new MusicElement('https://example.test/Alpha.mp3');
    sound.audioContext = { currentTime: 0 };
    sound.musicGainWired = true;
    sound.musicGainNode = {
        gain: {
            value: volume,
            cancelScheduledValues: vi.fn(),
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
        },
    };
    sound.ensureAudioAnalysisReady = vi.fn();
    sound.musicVolume = volume;
    const mode = Object.create(OdysseyMode.prototype);
    mode.deps = { soundManager: sound };
    return { sound, mode };
}

async function flushMicrotasks() {
    // eslint-disable-next-line no-await-in-loop -- Drain the chained track-switch continuations without advancing fades.
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('Odyssey transition audio respects player volume and fade ownership', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', { location: { href: 'https://example.test/index.html' }, dispatchEvent: vi.fn() });
        vi.stubGlobal('Audio', MusicElement);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([0, 0.1, 0.35, 1])('attenuates a music preference of %s without raising it', async (volume) => {
        const { sound, mode } = createAudio(volume);
        mode._setTransitionMusicDuck(0.42, 180);
        await vi.advanceTimersByTimeAsync(230);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(volume * 0.42);
        expect(sound.getMusicVolume()).toBe(volume);
        mode._restoreTransitionMusicDuck(250);
        await vi.advanceTimersByTimeAsync(300);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(volume);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('repeated entry/return ducks use the user preference rather than compounding attenuation', () => {
        const { sound, mode } = createAudio(0.2);
        mode._setTransitionMusicDuck(0.42, 0);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(0.084);
        mode._setTransitionMusicDuck(0.35, 0);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(0.07);
        mode._restoreTransitionMusicDuck(0);
        mode._restoreTransitionMusicDuck(0);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(0.2);
        expect(mode.transitionMusicDuckActive).toBe(false);
    });

    it.each([0, 0.12, 0.8])('restores the current preference %s when it changed during the journey', (volume) => {
        const { sound, mode } = createAudio(0.4);
        mode._setTransitionMusicDuck(0.42, 0);
        sound.setMusicVolume(volume);
        mode._restoreTransitionMusicDuck(0);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(volume);
        expect(sound.getMusicVolume()).toBe(volume);
    });

    it('preserves the Mode restore ramp when playback readiness completes before the track fade-in', async () => {
        const { sound, mode } = createAudio();
        mode._setTransitionMusicDuck(0.42, 0);
        sound.musicTrack = 'Beta';
        sound.trackFadeOutMs = 0;
        await sound.ensureTrackPlaybackSynced({ waitForFade: false });
        expect(sound.isTrackActuallyPlaying('Beta')).toBe(true);
        expect(sound.pendingTrackKey).toBe('Beta');
        expect(sound._getCurrentMusicVolume()).toBe(0);
        mode._restoreTransitionMusicDuck(650);
        const restorationTimer = sound.volumeFadeFrame;
        await flushMicrotasks();
        await sound.trackSwitchPromise;
        // Finishing the interrupted track fade must not snap gain or cancel the new ramp.
        expect(sound._getCurrentMusicVolume()).toBe(0);
        expect(sound.volumeFadeFrame).toBe(restorationTimer);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(700);
        expect(sound._getCurrentMusicVolume()).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a newer attenuation when track fade completion settles behind it', async () => {
        const { sound, mode } = createAudio(0.2);
        sound.musicTrack = 'Beta';
        sound.trackFadeOutMs = 0;
        await sound.ensureTrackPlaybackSynced({ waitForFade: false });
        mode._setTransitionMusicDuck(0.35, 0);
        await sound.trackSwitchPromise;
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(0.07);
        expect(sound.getMusicVolume()).toBe(0.2);
    });

    it('keeps music at zero if the player changes volume while a restore ramp is running', async () => {
        const { sound, mode } = createAudio();
        mode._setTransitionMusicDuck(0.42, 0);
        mode._restoreTransitionMusicDuck(650);
        sound.setMusicVolume(0);
        await vi.advanceTimersByTimeAsync(3000);
        expect(sound._getCurrentMusicVolume()).toBe(0);
        expect(sound.getMusicVolume()).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not let an old return restore override a newer entry attenuation', async () => {
        const { sound, mode } = createAudio(0.2);
        mode._setTransitionMusicDuck(0.42, 0);
        mode._restoreTransitionMusicDuck(650);
        mode._setTransitionMusicDuck(0.35, 160);
        await vi.advanceTimersByTimeAsync(1000);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(0.07);
        expect(mode.transitionMusicDuckActive).toBe(true);
        mode._restoreTransitionMusicDuck(0);
        expect(sound._getCurrentMusicVolume()).toBeCloseTo(0.2);
    });

    it('keeps a manual zero preference when its change settles a pending track fade', async () => {
        const { sound } = createAudio(0.2);
        sound.musicTrack = 'Beta';
        sound.trackFadeOutMs = 0;
        await sound.ensureTrackPlaybackSynced({ waitForFade: false });
        sound.setMusicVolume(0);
        await sound.trackSwitchPromise;
        await vi.advanceTimersByTimeAsync(3000);
        expect(sound._getCurrentMusicVolume()).toBe(0);
        expect(sound.isTrackActuallyPlaying('Beta')).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
