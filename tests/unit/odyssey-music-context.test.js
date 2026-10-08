import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateOdysseyLevelTheme, releaseOdysseyThemeAccess } from '../../src/core/game-modes/odyssey-theme-access.js';
import {
    applyOdysseyBoardAudioPolicy, applyOdysseyChapterMusic, releaseOdysseyLevelMusic,
} from '../../src/core/game-modes/odyssey-audio-policy.js';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { getThemeMusic } from '../../src/core/progression/theme-music-catalog.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function fixture() {
    const sound = {
        themeLinkedMode: false,
        musicTrack: 'EchoesOfTheSoul',
        setTrack: vi.fn(),
        setOdysseyMusicContext: vi.fn(() => ({})),
        clearOdysseyMusicContext: vi.fn(() => true),
        ensureTrackPlaybackSynced: vi.fn().mockResolvedValue(true),
        suspendThemeLinkedMusic: vi.fn(),
    };
    const mode = {
        isActive: true,
        isInBoardView: true,
        themeRevealToken: 2,
        deps: {
            soundManager: sound,
            settingsManager: { get: () => ({ musicTrack: 'EchoesOfTheSoul' }) },
            themeManager: {
                beginOdysseyThemeScope: vi.fn(() => ({})),
                endOdysseyThemeScope: vi.fn().mockResolvedValue('forest'),
                loadTheme: vi.fn().mockResolvedValue(true),
                switchTheme: vi.fn(async (id) => id),
            },
        },
    };
    return { mode, sound };
}

afterEach(() => vi.restoreAllMocks());

describe('authored Odyssey orb music', () => {
    it('starts the orb soundtrack while graphics load even with manual music selection', async () => {
        const { mode, sound } = fixture();
        const loading = deferred();
        mode.deps.themeManager.loadTheme.mockReturnValueOnce(loading.promise);
        const entering = activateOdysseyLevelTheme(mode, { theme: { primary: 'aurora' } });
        expect(sound.setOdysseyMusicContext).toHaveBeenCalledWith(expect.objectContaining({
            trackKey: getThemeMusic('aurora').trackKey,
            restoreTrack: 'EchoesOfTheSoul',
        }));
        expect(sound.setTrack).not.toHaveBeenCalled();
        loading.resolve(true);
        expect(await entering).toBe(true);
        expect(sound.ensureTrackPlaybackSynced).toHaveBeenCalledWith({
            reason: 'odyssey-level-entry', force: true, waitForFade: false,
        });
    });

    it('keeps the committed orb permission through Pause and retires it with its entry token', async () => {
        const { mode, sound } = fixture();
        let current = true;
        await activateOdysseyLevelTheme(mode, { theme: { primary: 'vesper-chrysalis' } }, {
            isCurrent: () => current,
        });
        const { isCurrent } = sound.setOdysseyMusicContext.mock.calls[0][0];
        current = false;
        mode._odysseyThemeCommittedToken = mode.themeRevealToken;
        mode.isInBoardView = false;
        mode.isPaused = true;
        expect(isCurrent()).toBe(true);
        mode.themeRevealToken += 1;
        expect(isCurrent()).toBe(false);
        await releaseOdysseyThemeAccess(mode);
        expect(sound.clearOdysseyMusicContext).toHaveBeenCalledWith(
            sound.setOdysseyMusicContext.mock.results[0].value, { restore: true },
        );
    });

    it('revokes a failed orb entry instead of leaving a locked soundtrack selected', async () => {
        const { mode, sound } = fixture();
        mode.deps.themeManager.switchTheme.mockResolvedValue(false);
        expect(await activateOdysseyLevelTheme(mode, { theme: { primary: 'aurora' } })).toBe(false);
        expect(mode._odysseyMusicScope).toBeNull();
        expect(sound.clearOdysseyMusicContext).toHaveBeenCalledOnce();
    });

    it('a late failed entry clears only its own token after a replacement orb starts', async () => {
        const { mode, sound } = fixture();
        const loading = deferred();
        mode.deps.themeManager.loadTheme.mockReturnValueOnce(loading.promise);
        const oldEntry = activateOdysseyLevelTheme(mode, { theme: { primary: 'aurora' } }, {
            isCurrent: () => mode.themeRevealToken === 2,
        });
        const oldToken = mode._odysseyMusicScope;
        mode.themeRevealToken = 3;
        await activateOdysseyLevelTheme(mode, { theme: { primary: 'blood-moon' } });
        const newToken = mode._odysseyMusicScope;
        loading.resolve(true);
        expect(await oldEntry).toBe(false);
        expect(mode._odysseyMusicScope).toBe(newToken);
        expect(sound.clearOdysseyMusicContext.mock.calls[0][0]).toBe(oldToken);
        expect(sound.clearOdysseyMusicContext.mock.calls[0][0]).not.toBe(newToken);
    });

    it('does not let release of an absent old scope revoke the next orb', async () => {
        const { mode, sound } = fixture();
        await activateOdysseyLevelTheme(mode, { theme: { primary: 'aurora' } });
        const token = mode._odysseyMusicScope;
        releaseOdysseyLevelMusic(mode, { token: null });
        expect(mode._odysseyMusicScope).toBe(token);
        expect(sound.clearOdysseyMusicContext).not.toHaveBeenCalled();
    });
});

describe('temporary Odyssey world music', () => {
    function boardFixture() {
        const { mode, sound } = fixture();
        const board = Object.assign(Object.create(OdysseyBoardController.prototype), {
            isActive: true,
            isRenderingPaused: false,
            _disposed: false,
            soundManager: sound,
            isMusicContextActive: () => mode.isActive && mode.isInBoardView,
            renderer: {},
            scene: {},
            camera: {},
            clock: { getDelta: vi.fn() },
            animate: vi.fn(),
        });
        mode.boardController = board;
        return { board, mode, sound };
    }

    it.each(['parked', 'disposed', 'inactive mode', 'gameplay'])(
        'a chapter reason cannot authorize playback while %s',
        (state) => {
            const { board, mode, sound } = boardFixture();
            if (state === 'parked') board.isRenderingPaused = true;
            if (state === 'disposed') board._disposed = true;
            if (state === 'inactive mode') mode.isActive = false;
            if (state === 'gameplay') mode.isInBoardView = false;
            expect(applyOdysseyChapterMusic(board, 'Aurora', { reason: 'odyssey-chapter-music' })).toBe(false);
            expect(sound.setOdysseyMusicContext).not.toHaveBeenCalled();
        },
    );

    it('revokes the world context when parked and resumes its chapter without persisting it', () => {
        const { board, sound } = boardFixture();
        expect(board._applyChapterMusic(6)).toBe(true);
        const oldToken = board._odysseyMusicScope;
        const oldPermission = sound.setOdysseyMusicContext.mock.calls[0][0].isCurrent;
        board.pauseRendering();
        expect(oldPermission()).toBe(false);
        expect(sound.clearOdysseyMusicContext).toHaveBeenCalledWith(oldToken, { restore: false });
        board.resumeRendering();
        expect(board._odysseyMusicChapter).toBe(6);
        expect(board._odysseyMusicScope).not.toBe(oldToken);
        expect(sound.setTrack).not.toHaveBeenCalled();
    });

    it('restores scoped chapter music on map recovery and revokes the orb token', async () => {
        const { board, mode, sound } = boardFixture();
        await activateOdysseyLevelTheme(mode, { theme: { primary: 'aurora' } });
        const orbToken = mode._odysseyMusicScope;
        board._odysseyMusicChapter = 2;
        await applyOdysseyBoardAudioPolicy(mode, { restoreTrack: true });
        expect(sound.clearOdysseyMusicContext).toHaveBeenCalledWith(orbToken, { restore: true });
        expect(board._odysseyMusicScope).not.toBe(orbToken);
        expect(sound.setTrack).not.toHaveBeenCalled();
    });
});
