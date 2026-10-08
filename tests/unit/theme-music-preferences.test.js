import {
    describe, expect, it, vi,
} from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/constants.js';
import { DEFAULT_MUSIC_TRACK, getThemeMusic } from '../../src/core/progression/theme-music-catalog.js';
import { resolveOwnedMusicPreference } from '../../src/core/progression/music-preference.js';
import { sanitizeCollectionThemeSetting } from '../../src/ui/theme-collection-integration.js';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { IntroAnimation } from '../../src/ui/intro-animation.js';
import { ensurePreferredMenuMusic } from '../../src/ui/startup-music.js';

const collection = { isUnlocked: (id) => ['forest', 'blood-moon'].includes(id) };

describe('theme-owned music preferences', () => {
    it.each(['Ambient', 'CosmicChimes', 'FallingPieces', 'unknown', undefined])(
        'repairs an unavailable saved track %s to Forest',
        (key) => expect(resolveOwnedMusicPreference(key, collection)).toBe(DEFAULT_MUSIC_TRACK),
    );

    it('preserves the starter and songs from genuinely owned themes', () => {
        expect(resolveOwnedMusicPreference(DEFAULT_MUSIC_TRACK, null)).toBe(DEFAULT_MUSIC_TRACK);
        expect(resolveOwnedMusicPreference('BloodMoon', collection)).toBe('BloodMoon');
        expect(resolveOwnedMusicPreference('BloodMoon', null)).toBe(DEFAULT_MUSIC_TRACK);
    });

    it('binds the live collection and repairs theme/song settings in one quiet save', () => {
        const settings = { backgroundTheme: 'aurora', musicTrack: 'Aurora' };
        const app = {
            themeCollection: collection,
            soundManager: { setThemeCollection: vi.fn() },
            settingsManager: {
                get: () => settings,
                update: vi.fn((changes) => Object.assign(settings, changes)),
                save: vi.fn(),
            },
        };
        sanitizeCollectionThemeSetting(app);
        expect(app.soundManager.setThemeCollection).toHaveBeenCalledWith(collection);
        expect(app.settingsManager.update).toHaveBeenCalledExactlyOnceWith({
            backgroundTheme: 'forest', musicTrack: DEFAULT_MUSIC_TRACK,
        }, false);
        sanitizeCollectionThemeSetting(app);
        expect(app.settingsManager.save).toHaveBeenCalledOnce();
    });

    it('sanitizes cloud preferences using ownership rather than a remembered selection', () => {
        const settings = { backgroundTheme: 'forest', musicTrack: DEFAULT_MUSIC_TRACK };
        const owner = {
            themeCollection: { ...collection, getThemeStatus: (id) => ({ themeId: id }) },
            settingsManager: {
                get: () => settings,
                update: (changes) => Object.assign(settings, changes),
                save: vi.fn(),
            },
        };
        SteamCloudSyncManager.prototype._applySettings.call(owner, { musicTrack: 'Aurora' });
        expect(settings.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
        SteamCloudSyncManager.prototype._applySettings.call(owner, { musicTrack: 'BloodMoon' });
        expect(settings.musicTrack).toBe('BloodMoon');
        expect(owner.settingsManager.save).toHaveBeenLastCalledWith({ emitEvent: false });
    });

    it('restores an unchanged owned preference once when the collection is first bound', () => {
        const settings = { backgroundTheme: 'forest', musicTrack: 'BloodMoon' };
        const app = {
            themeCollection: collection,
            soundManager: { setThemeCollection: vi.fn(), setTrack: vi.fn() },
            settingsManager: { get: () => settings, update: vi.fn(), save: vi.fn() },
        };
        sanitizeCollectionThemeSetting(app);
        expect(app.soundManager.setTrack).toHaveBeenCalledExactlyOnceWith('BloodMoon', { persist: false });
        sanitizeCollectionThemeSetting(app);
        expect(app.soundManager.setTrack).toHaveBeenCalledOnce();
        expect(app.settingsManager.save).not.toHaveBeenCalled();
    });

    it.each(['BloodMoon', 'Aurora', undefined])('validates menu preference %s against ownership', (saved) => {
        const sound = {
            musicTrack: DEFAULT_MUSIC_TRACK,
            settingsManager: { get: () => ({ musicTrack: saved }) },
            trackNames: [DEFAULT_MUSIC_TRACK, 'BloodMoon', 'Aurora'],
            canSelectTrack: (key) => [DEFAULT_MUSIC_TRACK, 'BloodMoon'].includes(key),
            isMusicPlaying: () => false,
            setTrack: vi.fn(),
            startBackgroundMusic: vi.fn(),
        };
        ensurePreferredMenuMusic(sound);
        if (saved === 'BloodMoon') expect(sound.setTrack).toHaveBeenCalledWith(saved, { persist: false });
        else {
            expect(sound.setTrack).not.toHaveBeenCalled();
            expect(sound.startBackgroundMusic).toHaveBeenCalledOnce();
        }
    });

    it('starts the intro with Forest and resolves the same file when the manifest is unavailable', () => {
        expect(DEFAULT_SETTINGS.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
        const intro = new IntroAnimation();
        const manager = {
            trackNames: [DEFAULT_MUSIC_TRACK, 'CosmicChimes'],
            musicTrack: 'CosmicChimes',
            setTrack: vi.fn(),
            playAudioFile: vi.fn(),
            isMusicPlaying: () => false,
        };
        intro.soundManager = manager;
        intro.ensureIntroMusic();
        expect(manager.setTrack).toHaveBeenCalledExactlyOnceWith(DEFAULT_MUSIC_TRACK, { persist: false });
        manager.trackNames = [];
        intro.ensureIntroMusic();
        expect(manager.musicTrack).toBe(DEFAULT_MUSIC_TRACK);
        expect(manager.playAudioFile).toHaveBeenCalledExactlyOnceWith(getThemeMusic('forest').path, {
            trackKey: DEFAULT_MUSIC_TRACK,
        });
    });
});
