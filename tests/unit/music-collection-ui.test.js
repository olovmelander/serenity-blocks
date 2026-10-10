import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { MusicTab } from '../../src/ui/serenity-hub/MusicTab.js';
import { SerenityHub } from '../../src/ui/serenity-hub/SerenityHub.js';
import { MusicCollectionView, getMusicCollectionState } from '../../src/ui/serenity-hub/MusicCollectionView.js';
import { THEME_MUSIC_CATALOG } from '../../src/core/progression/theme-music-catalog.js';
import { looseNode, targetMatching } from './helpers/loose-dom.js';

function harness({
    owned = ['forest'], active = true, context = {}, developmentUnlockAll = false,
} = {}) {
    const ownedIds = new Set(owned);
    let notify;
    const unsubscribe = vi.fn();
    const collection = {
        getThemeStatus: (id) => ({
            owned: developmentUnlockAll || ownedIds.has(id),
            ...(developmentUnlockAll && !ownedIds.has(id) ? { developmentAccess: true } : {}),
            requirement: { label: 'Complete Odyssey orb 1 · Ashen Dawn.' },
        }),
        getSummary: () => ({ developmentUnlockAll }),
        subscribe: vi.fn((fn) => { notify = fn; return unsubscribe; }),
        reconcileFromOdyssey: vi.fn(),
    };
    const tab = Object.create(MusicTab.prototype);
    Object.assign(tab, {
        active,
        songs: THEME_MUSIC_CATALOG,
        currentSong: 'EchoesOfTheSoul',
        audibleSong: 'EchoesOfTheSoul',
        container: looseNode(),
        nodes: {},
        updateNowPlaying: vi.fn(),
        updatePlayPauseButton: vi.fn(),
        updateVinylAnimation: vi.fn(),
        soundManager: { musicTrack: 'EchoesOfTheSoul', setTrack: vi.fn(() => false) },
    });
    const view = new MusicCollectionView(tab, collection, context);
    tab.collectionView = view;
    return {
        tab, view, collection, ownedIds, notify: () => notify(), unsubscribe,
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('the theme-linked soundtrack collection', () => {
    it('labels temporary URL access separately from earned songs', () => {
        const { tab, view } = harness({ developmentUnlockAll: true });
        expect(view.countLabel()).toBe('61 / 61 available');
        expect(view.renderIntro()).toContain('Remove the URL option to restore song locks.');
        expect(view.renderRowCopy('CinderDrift')).toContain('Development access');
        expect(view.renderRowCopy('CinderDrift')).not.toContain('Collected');
        expect(view.renderRowCopy('EchoesOfTheSoul')).toContain('Collected');
        expect(tab.getTrackMeta('CinderDrift')).toBe('Cinder Drift · Development access');
        view.showDetails('CinderDrift');
        const detail = tab.container.querySelector('.music-collection-detail').innerHTML;
        expect(detail).toContain('Temporarily available through the URL option.');
        expect(detail).not.toContain('Yours with');
    });

    it('shows all 61 songs with only Forest collected, and keeps locked rows inspectable', () => {
        const { tab, view } = harness();
        const rows = tab.renderPlaylist();
        expect((rows.match(/data-track=/g) || [])).toHaveLength(61);
        expect((rows.match(/is-locked/g) || [])).toHaveLength(60);
        expect(view.countLabel()).toBe('1 / 61 collected');
        expect(rows.indexOf('data-track="EchoesOfTheSoul"')).toBeLessThan(rows.indexOf('data-track="CinderDrift"'));
        expect(rows).toContain('Complete Odyssey orb 1 · Ashen Dawn.');
        expect(rows).toContain('locked. View unlock details');
        expect(rows).not.toContain('placeholder');
        expect(rows).not.toContain('aria-disabled');
        expect(tab.nameToKey('Echoes of the Soul')).toBe('EchoesOfTheSoul');
    });

    it('gives every song its world as artwork, on its row and when it plays', () => {
        const { tab } = harness();
        const rows = tab.renderPlaylist();
        expect((rows.match(/class="playlist-item-art"/g) || [])).toHaveLength(61);
        // A song's picture is its theme's icon, whatever the song is called.
        expect(tab.getTrackArt('EchoesOfTheSoul')).toContain('forest-theme-icon');
        expect(rows).toContain(`<img src="${tab.getTrackArt('EchoesOfTheSoul')}"`);
        expect(tab.getTrackArt('CinderDrift')).toContain('cinder-drift-theme-icon');
        expect(tab.getTrackArt('NotASong')).toBeNull();

        const albumArt = looseNode();
        const albumPicture = looseNode();
        tab.nodes = { albumArt, albumPicture };
        tab.audibleSong = 'CinderDrift';
        MusicTab.prototype.updateNowPlayingArt.call(tab);
        expect(albumPicture.style.backgroundImage).toBe(`url('${tab.getTrackArt('CinderDrift')}')`);
        expect(albumArt.classList.contains('has-art')).toBe(true);
        // A track without a world falls back to the note.
        tab.audibleSong = 'NotASong';
        MusicTab.prototype.updateNowPlayingArt.call(tab);
        expect(albumPicture.style.backgroundImage).toBe('');
        expect(albumArt.classList.contains('has-art')).toBe(false);
    });

    it('shows locked track details without asking audio to play or granting the theme', () => {
        const { tab, view, ownedIds } = harness();
        expect(tab.selectTrack('CinderDrift')).toBe(false);
        expect(tab.soundManager.setTrack).not.toHaveBeenCalled();
        expect(tab.currentSong).toBe('EchoesOfTheSoul');
        const detail = tab.container.querySelector('.music-collection-detail');
        expect(detail.hidden).toBe(false);
        expect(detail.innerHTML).toContain('Unlock Cinder Drift and its song together.');
        expect(detail.innerHTML).toContain('data-music-explore');
        expect(detail.querySelector('#music-detail-title').focused).toBe(1);
        expect(ownedIds.has('cinder-drift')).toBe(false);
        view.closeDetails();
        expect(detail.hidden).toBe(true);
    });

    it('continues Odyssey through its existing route and checks availability at action time', async () => {
        let allowed = true;
        const onExploreTheme = vi.fn();
        const { view } = harness({
            context: {
                onExploreTheme,
                canExploreTheme: () => ({ allowed, reason: 'Finish this orb first.' }),
            },
        });
        view.showDetails('CinderDrift');
        const button = targetMatching({ '[data-music-explore]': looseNode('button') });
        await view.handleAction(button);
        expect(onExploreTheme).toHaveBeenCalledExactlyOnceWith('cinder-drift');
        allowed = false;
        await view.handleAction(button);
        expect(onExploreTheme).toHaveBeenCalledTimes(1);
    });

    it('defers hidden collection updates, refreshes on activation and unsubscribes on disposal', () => {
        const {
            tab, view, notify, ownedIds, unsubscribe,
        } = harness({ active: false });
        const playlist = tab.container.querySelector('#playlist-container');
        playlist.innerHTML = 'unchanged while hidden';
        ownedIds.add('cinder-drift');
        notify();
        expect(playlist.innerHTML).toBe('unchanged while hidden');
        expect(view.dirty).toBe(true);
        tab.active = true;
        view.activate();
        expect(view.dirty).toBe(false);
        expect(tab.container.querySelector('.track-count').textContent).toBe('2 / 61 collected');
        expect(view.state('CinderDrift').owned).toBe(true);
        view.destroy();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('preserves focus when a grant rebuilds the inspected song detail', () => {
        const {
            tab, view, ownedIds, notify,
        } = harness();
        view.showDetails('CinderDrift');
        const detail = tab.container.querySelector('.music-collection-detail');
        const title = detail.querySelector('#music-detail-title');
        detail.contains = (node) => node === title;
        vi.stubGlobal('document', { activeElement: title });
        ownedIds.add('cinder-drift');
        notify();
        expect(title.focused).toBe(2);
        expect(detail.innerHTML).toContain('Yours with Cinder Drift');
    });

    it.each(['keyboard', 'gamepad'])('routes %s Back to the visible collection only', (input) => {
        vi.stubGlobal('window', new EventTarget());
        vi.stubGlobal('document', new EventTarget());
        const hub = Object.create(SerenityHub.prototype);
        const abortController = new AbortController();
        Object.assign(hub, {
            currentTab: 'music',
            isOpen: true,
            hide: vi.fn(),
            themesTab: { closeCollectionDetails: vi.fn(() => true) },
            musicTab: { closeCollectionDetails: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) },
            panel: looseNode(),
            tabAbortControllers: new Map(),
            abortController,
            serenityMode: { deps: { gamepadController: { enableSerenityMode: vi.fn() } } },
        });
        let back;
        if (input === 'keyboard') {
            hub.attachEventListeners();
            back = () => hub.documentKeydownHandler({
                key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
            });
        } else {
            hub.setupGamepadIntegration();
            back = hub.gamepadCallbacks.closeHub;
        }
        back();
        expect(hub.musicTab.closeCollectionDetails).toHaveBeenCalledOnce();
        expect(hub.themesTab.closeCollectionDetails).not.toHaveBeenCalled();
        expect(hub.hide).not.toHaveBeenCalled();
        back();
        expect(hub.hide).toHaveBeenCalledOnce();
        abortController.abort();
    });

    it('does not call temporary Odyssey music collected or permit selecting it', () => {
        const { tab, collection } = harness();
        tab.currentSong = 'CinderDrift';
        tab.audibleSong = 'CinderDrift';
        expect(tab.getTrackMeta()).toBe('Playing in Odyssey · Not collected yet');
        expect(getMusicCollectionState('CinderDrift', collection).owned).toBe(false);
        tab.selectTrack('CinderDrift');
        expect(tab.soundManager.setTrack).not.toHaveBeenCalled();
    });

    it('does not replace the selected UI song when the Odyssey owner denies an owned selection', () => {
        const { tab } = harness();
        tab.currentSong = 'CinderDrift';
        tab.soundManager.musicTrack = 'CinderDrift';
        tab.soundManager.canSelectTrack = () => true;
        expect(tab.selectTrack('EchoesOfTheSoul')).toBe(false);
        expect(tab.currentSong).toBe('CinderDrift');
        expect(tab.updateNowPlaying).not.toHaveBeenCalled();
        expect(tab.container.querySelector('[data-music-collection-status]').textContent)
            .toContain('Finish or leave it to choose a song');
    });

    it('previous track uses only permanent collection choices and handles an empty selection', () => {
        const { tab } = harness();
        tab.currentSong = 'CinderDrift';
        tab.selectTrack = vi.fn();
        tab.soundManager.getSelectableSongs = () => [THEME_MUSIC_CATALOG.find((song) => song.themeId === 'forest')];
        tab.previousTrack();
        expect(tab.selectTrack).toHaveBeenCalledExactlyOnceWith('EchoesOfTheSoul');
        tab.soundManager.getSelectableSongs = () => [];
        tab.previousTrack();
        expect(tab.selectTrack).toHaveBeenCalledTimes(1);
    });

    it('resumes and pauses through the audio access owner without optimistic playing feedback', async () => {
        const { tab } = harness();
        tab.syncWithAudioState = vi.fn();
        const audioElement = { paused: true, play: vi.fn(), pause: vi.fn() };
        Object.assign(tab.soundManager, {
            audioElement, resumeBackgroundMusic: vi.fn(async () => false), pauseAudioElement: vi.fn(),
        });
        await tab.togglePlayPause();
        expect(tab.soundManager.resumeBackgroundMusic).toHaveBeenCalledOnce();
        expect(audioElement.play).not.toHaveBeenCalled();
        expect(tab.updatePlayPauseButton).not.toHaveBeenCalled();
        audioElement.paused = false;
        await tab.togglePlayPause();
        expect(tab.soundManager.pauseAudioElement).toHaveBeenCalledExactlyOnceWith(false);
        expect(audioElement.pause).not.toHaveBeenCalled();
        expect(tab.syncWithAudioState).toHaveBeenCalledTimes(2);
    });
});
