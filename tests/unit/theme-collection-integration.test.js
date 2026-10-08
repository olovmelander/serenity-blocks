import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    canExploreThemeCollection, exploreThemeFromCollection, focusThemeCollectionTarget,
    sanitizeCollectionThemeSetting, switchToRandomCollectedTheme,
} from '../../src/ui/theme-collection-integration.js';
import {
    activateOdysseyLevelTheme, captureOdysseyThemePreference, focusOdysseyCollectionLevel,
    releaseOdysseyThemeAccess,
} from '../../src/core/game-modes/odyssey-theme-access.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

function appFixture() {
    const mode = {
        isActive: true,
        isRunning: true,
        isInBoardView: true,
        levelRegistry: { getAllLevels: () => [{ id: 1 }, { id: 2 }, { id: 22 }] },
        odysseyState: {
            isLevelUnlocked: (id) => id <= 2,
            isLevelCompleted: (id) => id === 1,
        },
        focusCollectionLevel: vi.fn().mockResolvedValue(true),
    };
    return {
        mode,
        app: {
            themeCollection: {
                isUnlocked: (id) => id === 'forest',
                getThemeStatus: () => ({ owned: false, requirement: { levelId: 22 } }),
            },
            settingsManager: {
                get: () => ({ backgroundMode: 'Specific', backgroundTheme: 'aurora' }),
                update: vi.fn(),
                save: vi.fn(),
            },
            gameModeManager: { getCurrentMode: () => mode, getCurrentModeId: () => 'odyssey' },
            modalManager: { isVisible: () => false },
            serenityHub: { hide: vi.fn() },
        },
    };
}

describe('collection application integration', () => {
    it('repairs a locked preference quietly and preserves an owned preference', () => {
        const { app } = appFixture();
        sanitizeCollectionThemeSetting(app);
        expect(app.settingsManager.update).toHaveBeenCalledWith({ backgroundTheme: 'forest' }, false);
        expect(app.settingsManager.save).toHaveBeenCalledOnce();
        app.themeCollection.isUnlocked = () => true;
        sanitizeCollectionThemeSetting(app);
        expect(app.settingsManager.update).toHaveBeenCalledOnce();
    });

    it('blocks collection navigation during gameplay or an ongoing journey handoff', async () => {
        const { app, mode } = appFixture();
        mode.isInBoardView = false;
        expect(canExploreThemeCollection(app).allowed).toBe(false);
        expect(await exploreThemeFromCollection(app, 'aurora')).toBe(false);
        expect(app.serenityHub.hide).not.toHaveBeenCalled();
        mode.isInBoardView = true;
        mode._journeyFlowOperation = {};
        expect(canExploreThemeCollection(app).allowed).toBe(false);
    });

    it('focuses the next playable orb when the requested unlock orb is still locked', async () => {
        const { app, mode } = appFixture();
        expect(await exploreThemeFromCollection(app, 'aurora')).toBe(true);
        expect(mode.focusCollectionLevel).toHaveBeenCalledWith(2);
        expect(app.serenityHub.hide).toHaveBeenCalledWith({ resumeGameplay: false });
    });

    it('focuses the requested available orb without starting it', async () => {
        const { app, mode } = appFixture();
        mode.odysseyState.isLevelUnlocked = () => true;
        await focusThemeCollectionTarget(app, { mode: 'odyssey', collectionThemeId: 'aurora' });
        expect(mode.focusCollectionLevel).toHaveBeenCalledWith(22);
    });

    it('uses the normal mode startup event from the menu instead of changing progression', async () => {
        const { app, mode } = appFixture();
        mode.isRunning = false;
        mode.isActive = false;
        app.modalManager.isVisible = () => true;
        const dispatchEvent = vi.fn();
        vi.stubGlobal('window', { dispatchEvent });
        await exploreThemeFromCollection(app, 'aurora');
        expect(dispatchEvent.mock.calls[0][0].detail).toEqual({ mode: 'odyssey', collectionThemeId: 'aurora' });
        expect(mode.focusCollectionLevel).not.toHaveBeenCalled();
    });

    it('never persists a rejected random choice or a temporary locked active theme', async () => {
        const { app } = appFixture();
        app.themeManager = {
            getRandomTheme: () => 'forest',
            canSelectTheme: () => true,
            switchTheme: vi.fn().mockResolvedValue('cinder-drift'),
            activeThemeName: 'cinder-drift',
        };
        expect(await switchToRandomCollectedTheme(app)).toBe(false);
        expect(app.settingsManager.update).not.toHaveBeenCalled();
    });
});

describe('Odyssey collection presentation scope', () => {
    async function runtimeFailureFixture() {
        const config = { id: 1, theme: { primary: 'cinder-drift' } };
        const manager = {
            beginOdysseyThemeScope: vi.fn().mockReturnValue({}),
            loadTheme: vi.fn().mockResolvedValue(true),
            switchTheme: vi.fn().mockResolvedValue('cinder-drift'),
        };
        const events = [];
        const mode = {
            isActive: true,
            themeRevealToken: 4,
            currentLevelConfig: config,
            deps: { themeManager: manager, notifyOdysseyThemeFailure: vi.fn() },
            onPause: vi.fn(() => events.push('pause')),
            returnToBoard: vi.fn(async () => { events.push('return'); return true; }),
        };
        mode._activeLevelSession = { retired: false };
        mode._isLevelSessionActive = (session) => session === mode._activeLevelSession && !session.retired;
        await activateOdysseyLevelTheme(mode, config);
        mode._odysseyThemeCommittedToken = 4;
        const fail = manager.beginOdysseyThemeScope.mock.calls[0][1].onRuntimeFailure;
        return {
            mode, fail, events,
        };
    }

    it('pauses an unrecoverable live orb and returns to its world with an actionable explanation', async () => {
        const {
            mode, fail, events,
        } = await runtimeFailureFixture();
        await expect(fail()).resolves.toBe(true);
        expect(events).toEqual(['pause', 'return']);
        expect(mode.returnToBoard).toHaveBeenCalledWith({ focusLevelId: 1 });
        expect(mode.deps.notifyOdysseyThemeFailure).toHaveBeenCalledOnce();
    });

    it('keeps runtime failure recovery owned by the current in-place retry session', async () => {
        const { mode, fail } = await runtimeFailureFixture();
        mode._activeLevelSession.retired = true;
        mode._activeLevelSession = { retired: false };
        mode.levelRunStarted = false;
        mode.entryPhase = 'prepared';
        await expect(fail()).resolves.toBe(true);
        expect(mode.onPause).toHaveBeenCalledOnce();
    });

    it.each(['replaced', 'completed', 'retired'])(
        'does not stop an orb after the failed runtime is %s',
        async (state) => {
            const { mode, fail } = await runtimeFailureFixture();
            if (state === 'replaced') mode.themeRevealToken += 1;
            if (state === 'completed') mode.levelCompleting = true;
            if (state === 'retired') mode._activeLevelSession.retired = true;
            expect(fail()).toBe(false);
            expect(mode.onPause).not.toHaveBeenCalled();
            expect(mode.returnToBoard).not.toHaveBeenCalled();
            expect(mode.deps.notifyOdysseyThemeFailure).not.toHaveBeenCalled();
        },
    );

    it('retains scoped access after scenic entry until the entry token changes', async () => {
        let entryCurrent = true;
        const scope = {};
        const manager = {
            activeThemeName: 'forest',
            beginOdysseyThemeScope: vi.fn().mockReturnValue(scope),
            loadTheme: vi.fn().mockResolvedValue(true),
            switchTheme: vi.fn().mockResolvedValue('cinder-drift'),
            endOdysseyThemeScope: vi.fn().mockResolvedValue('forest'),
        };
        const mode = { isActive: true, themeRevealToken: 4, deps: { themeManager: manager } };
        captureOdysseyThemePreference(mode);
        // A later world-map choice supersedes the preference captured on mode entry.
        mode.deps.settingsManager = { get: () => ({ backgroundTheme: 'aurora' }) };
        expect(await activateOdysseyLevelTheme(mode, { id: 1, theme: { primary: 'cinder-drift' } }, {
            isCurrent: () => entryCurrent,
        })).toBe(true);
        expect(manager.switchTheme).toHaveBeenCalledWith('cinder-drift', true, scope);
        expect(manager.beginOdysseyThemeScope.mock.calls[0][1].restoreTheme).toBe('aurora');
        const ownsTheme = manager.beginOdysseyThemeScope.mock.calls[0][1].isCurrent;
        entryCurrent = false;
        mode.levelRunStarted = true;
        mode._odysseyThemeCommittedToken = mode.themeRevealToken;
        mode.isPaused = true;
        expect(ownsTheme()).toBe(true);
        mode.levelRunStarted = false; // In-place retry prepares a new attempt under the same theme.
        expect(ownsTheme()).toBe(true);
        mode.themeRevealToken += 1;
        expect(ownsTheme()).toBe(false);
        await releaseOdysseyThemeAccess(mode);
        expect(manager.endOdysseyThemeScope).toHaveBeenCalledWith(scope);
        expect(mode._odysseyThemeScope).toBeNull();
    });

    it('does not create permission or start a theme for a stale entry', async () => {
        const beginOdysseyThemeScope = vi.fn();
        const mode = { deps: { themeManager: { beginOdysseyThemeScope } } };
        expect(await activateOdysseyLevelTheme(mode, { theme: { primary: 'aurora' } }, {
            isCurrent: () => false,
        })).toBe(false);
        expect(beginOdysseyThemeScope).not.toHaveBeenCalled();
    });

    it('does not announce a selected map orb when its world travel failed', async () => {
        const { mode } = appFixture();
        mode.boardController = { travelToLevel: vi.fn().mockResolvedValue(false) };
        mode._updateLevelPreview = vi.fn();
        expect(await focusOdysseyCollectionLevel(mode, 2)).toBe(false);
        expect(mode._updateLevelPreview).not.toHaveBeenCalled();
        expect(await focusOdysseyCollectionLevel(mode, 22)).toBe(false);
        expect(mode.boardController.travelToLevel).toHaveBeenCalledOnce();
    });
});
