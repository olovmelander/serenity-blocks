import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';
import { THEME_MUSIC_CATALOG, DEFAULT_MUSIC_TRACK } from '../../src/core/progression/theme-music-catalog.js';

class MusicElement {
    constructor() {
        this.src = '';
        this.paused = true;
        this.ended = false;
        this.currentTime = 0;
        this.volume = 1;
        this.load = vi.fn();
        this.addEventListener = vi.fn();
        this.removeEventListener = vi.fn();
        this.play = vi.fn(async () => { this.paused = false; this.ended = false; });
    }

    get currentSrc() { return this.src; }

    pause() { this.paused = true; }
}

function createManager(owned = ['forest']) {
    const manager = new SoundManager();
    manager.songsData = THEME_MUSIC_CATALOG.map((song) => ({ ...song }));
    manager.trackNames = manager.songsData.map((song) => song.trackKey);
    manager.settingsManager = { update: vi.fn(), save: vi.fn(), get: () => ({}) };
    manager.audioContext = {};
    manager.ensureAudioAnalysisReady = vi.fn();
    manager.trackFadeOutMs = 0;
    manager.trackFadeInMs = 0;
    const grants = new Set(owned);
    let publish;
    const unsubscribe = vi.fn();
    const collection = {
        isUnlocked: (themeId) => grants.has(themeId),
        subscribe: vi.fn((listener) => { publish = listener; return unsubscribe; }),
    };
    manager.setThemeCollection(collection);
    return {
        manager, collection, unsubscribe,
        grant: (themeId) => { grants.add(themeId); publish(); },
    };
}

beforeEach(() => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), {
        location: { href: 'https://example.test/game/index.html' },
    }));
    vi.stubGlobal('document', { getElementById: () => null });
    vi.stubGlobal('Audio', MusicElement);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('theme-owned music playback', () => {
    it('is Forest-only before a collection has been bound and rejects unknown tracks', () => {
        const manager = new SoundManager();
        expect(manager.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
        expect(manager.canSelectTrack(DEFAULT_MUSIC_TRACK)).toBe(true);
        expect(manager.canSelectTrack('BloodMoon')).toBe(false);
        expect(manager.canSelectTrack('Missing')).toBe(false);
        expect(manager.setTrack('BloodMoon')).toBe(false);
        expect(manager.setTrack('Missing')).toBe(false);
    });

    it('never plays locked music through selection, direct URL, mismatched URL or resume', async () => {
        const { manager } = createManager();
        expect(manager.setTrack('BloodMoon')).toBe(false);
        await manager.startBackgroundMusic({ trackKey: 'BloodMoon' });
        await manager.playAudioFile(manager.resolveTrackUrl('BloodMoon'), { trackKey: 'BloodMoon' });
        await manager.playAudioFile(manager.resolveTrackUrl('BloodMoon'), { trackKey: DEFAULT_MUSIC_TRACK });
        await manager.playAudioFile('https://outside.test/foreign.mp3', { trackKey: DEFAULT_MUSIC_TRACK });
        manager.musicTrack = 'BloodMoon';
        expect(await manager.resumeBackgroundMusic()).toBe(false);
        await manager.ensureTrackPlaybackSynced({ force: true });
        expect(manager.audioElement).toBeNull();
        expect(manager.settingsManager.save).not.toHaveBeenCalled();
    });

    it('unlocks a song immediately from the same theme grant and refreshes without another store', async () => {
        const { manager, grant } = createManager();
        const changed = vi.fn();
        window.addEventListener('musicCollectionChanged', changed);
        expect(manager.getSelectableSongs().map((song) => song.themeId)).toEqual(['forest']);
        grant('blood-moon');
        expect(changed).toHaveBeenCalledOnce();
        expect(manager.canSelectTrack('BloodMoon')).toBe(true);
        expect(manager.setTrack('BloodMoon')).toBe(true);
        await manager.trackSwitchPromise;
        expect(manager.isTrackActuallyPlaying('BloodMoon')).toBe(true);
        expect(manager.settingsManager.update).toHaveBeenCalledWith({ musicTrack: 'BloodMoon' });
    });

    it('filters next, previous and automatic track completion to owned songs', async () => {
        const { manager } = createManager();
        expect(manager.nextTrack()).toBe(true);
        await manager.trackSwitchPromise;
        expect(manager.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
        manager.previousTrack();
        manager.onAudioEnded();
        await manager.trackSwitchPromise;
        expect(manager.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
        expect(manager.getSelectableSongs()).toHaveLength(1);
    });

    it('binds the same collection once and retires its subscription at cleanup', () => {
        const { manager, collection, unsubscribe } = createManager();
        manager.setThemeCollection(collection);
        expect(collection.subscribe).toHaveBeenCalledOnce();
        manager.cleanup();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('resumes an owned source at the paused position through the guarded API', async () => {
        const { manager } = createManager();
        manager.setTrack(DEFAULT_MUSIC_TRACK);
        await manager.trackSwitchPromise;
        manager.audioElement.currentTime = 37;
        manager.audioElement.pause();
        expect(await manager.resumeBackgroundMusic()).toBe(true);
        expect(manager.audioElement.currentTime).toBe(37);
    });
});

describe('temporary Odyssey music ownership', () => {
    it('plays only its authored song without granting it, persisting it or changing a theme', async () => {
        const { manager } = createManager();
        const autoTheme = vi.spyOn(manager, 'applyAutoThemeChange');
        const token = manager.setOdysseyMusicContext({ trackKey: 'BloodMoon' });
        await manager.trackSwitchPromise;
        expect(manager.isTrackActuallyPlaying('BloodMoon')).toBe(true);
        expect(manager.canSelectTrack('BloodMoon')).toBe(false);
        expect(manager.isTrackPlayable('BloodMoon')).toBe(true);
        expect(manager.setTrack(DEFAULT_MUSIC_TRACK)).toBe(false);
        expect(manager.setTrack('Aurora')).toBe(false);
        expect(manager.settingsManager.save).not.toHaveBeenCalled();
        expect(autoTheme).not.toHaveBeenCalled();
        expect(manager.clearOdysseyMusicContext(token)).toBe(true);
        await manager.trackSwitchPromise;
        expect(manager.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
        expect(manager.isTrackActuallyPlaying(DEFAULT_MUSIC_TRACK)).toBe(true);
        expect(manager.isTrackPlayable('BloodMoon')).toBe(false);
    });

    it('keeps the authored song on natural completion and both track shortcuts', async () => {
        const { manager } = createManager();
        manager.setOdysseyMusicContext({ trackKey: 'BloodMoon' });
        await manager.trackSwitchPromise;
        manager.audioElement.ended = true;
        manager.audioElement.paused = true;
        manager.onAudioEnded();
        await manager.trackSwitchPromise;
        manager.nextTrack();
        manager.previousTrack();
        expect(manager.musicTrack).toBe('BloodMoon');
        expect(manager.isTrackActuallyPlaying('BloodMoon')).toBe(true);
        expect(manager.settingsManager.save).not.toHaveBeenCalled();
    });

    it('preserves the preferred owned song through scope replacement and a silent board handoff', async () => {
        const { manager } = createManager(['forest', 'aurora']);
        manager.setTrack('Aurora');
        await manager.trackSwitchPromise;
        const first = manager.setOdysseyMusicContext({ trackKey: 'BloodMoon' });
        await manager.trackSwitchPromise;
        manager.clearOdysseyMusicContext(first, { restore: false });
        expect(manager.audioElement.paused).toBe(true);
        const second = manager.setOdysseyMusicContext({ trackKey: 'CinderDrift' });
        const third = manager.setOdysseyMusicContext({ trackKey: 'OceanDeep' });
        expect(manager.clearOdysseyMusicContext(second)).toBe(false);
        await manager.trackSwitchPromise;
        expect(manager.musicTrack).toBe('OceanDeep');
        manager.clearOdysseyMusicContext(third);
        await manager.trackSwitchPromise;
        expect(manager.musicTrack).toBe('Aurora');
        expect(manager.isTrackActuallyPlaying('Aurora')).toBe(true);
    });

    it('does not stop temporary playback when its theme is awarded or another grant arrives', async () => {
        const { manager, grant } = createManager();
        manager.setOdysseyMusicContext({ trackKey: 'BloodMoon' });
        await manager.trackSwitchPromise;
        const play = manager.audioElement.play;
        grant('aurora');
        grant('blood-moon');
        expect(manager.musicTrack).toBe('BloodMoon');
        expect(manager.canSelectTrack('BloodMoon')).toBe(true);
        expect(play).toHaveBeenCalledOnce();
    });

    it('does not start an expired context or allow its pending request to revive later', async () => {
        const { manager } = createManager();
        expect(manager.setOdysseyMusicContext({ trackKey: 'BloodMoon', isCurrent: () => false })).toBeNull();
        let current = true;
        const token = manager.setOdysseyMusicContext({ trackKey: 'BloodMoon', isCurrent: () => current });
        current = false;
        await manager.trackSwitchPromise;
        expect(manager.audioElement).toBeNull();
        expect(manager.pendingTrackKey).toBeNull();
        manager.clearOdysseyMusicContext(token, { restore: false });
        expect(manager.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
    });

    it('revokes a context while its fade is pending and prevents the retired source from applying', async () => {
        const { manager } = createManager();
        manager.setTrack(DEFAULT_MUSIC_TRACK);
        await manager.trackSwitchPromise;
        let finishFade;
        manager.fadeMusicVolume = vi.fn(() => new Promise((resolve) => { finishFade = resolve; }));
        const token = manager.setOdysseyMusicContext({ trackKey: 'BloodMoon' });
        const retired = manager.trackSwitchPromise;
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        expect(finishFade).toBeTypeOf('function');
        manager.clearOdysseyMusicContext(token, { restore: false });
        finishFade();
        await retired;
        expect(manager.getActualTrackKey()).toBe(DEFAULT_MUSIC_TRACK);
        expect(manager.audioElement.paused).toBe(true);
        expect(manager.pendingTrackPlayback).toBeNull();
    });
});
