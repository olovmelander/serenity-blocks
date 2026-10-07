import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { DEMO_LEGACY_SIMULATION_CLOCK, DEMO_FIXED_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';
import {
    cancelOdysseyJourneyFlow,
    continueOdysseyJourney,
    getOdysseyFlowDestination,
    showOdysseyFlowResults,
} from '../../src/ui/odyssey/odyssey-journey-flow.js';

const fixture = vi.hoisted(() => ({ overlays: [], surfaces: [], nextOverlay: null }));
vi.mock('../../src/ui/odyssey/JourneyFlowOverlay.js', () => ({
    createJourneyFlowOverlay: vi.fn((options) => {
        const modal = {
            options,
            dataset: {},
            visibilityGeneration: 0,
            dispose: vi.fn(),
            retainCover: vi.fn(),
            beginTransit: vi.fn(),
            cover: vi.fn().mockResolvedValue(true),
            reveal: vi.fn().mockResolvedValue(true),
            hold: vi.fn(),
            setStatus: vi.fn(),
            waitUntilVisible: vi.fn().mockResolvedValue(true),
            ...fixture.nextOverlay,
        };
        fixture.nextOverlay = null;
        fixture.overlays.push(modal);
        return modal;
    }),
}));
vi.mock('../../src/ui/cinematic-loading-surface.js', () => ({
    createCinematicLoadingSurface: vi.fn(() => {
        const surface = { ready: Promise.resolve(), cancel: vi.fn(), uncover: vi.fn() };
        fixture.surfaces.push(surface);
        return surface;
    }),
}));
vi.mock('../../src/core/game-modes/odyssey-physics-callbacks.js', () => ({
    prefersOdysseyReducedMotion: (mode) => mode.deps.settingsManager.get().reducedMotion === true,
}));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const level = { id: 1, chapter: 1, name: 'First light' };
const nextLevel = { id: 2, chapter: 1, name: 'Crystal rhythm' };
const results = {
    stars: 2, score: 1000, lines: 20, time: 30,
};

function createMode() {
    const settings = {};
    const mode = {
        isActive: true,
        currentLevelId: level.id,
        currentLevelConfig: level,
        themeRevealToken: 1,
        deps: {
            themeManager: {},
            inputController: { clearTimers: vi.fn() },
            settingsManager: {
                get: vi.fn(() => settings),
                update: vi.fn((changes) => Object.assign(settings, changes)),
                save: vi.fn(),
            },
        },
        levelRegistry: {
            getNextLevel: vi.fn(() => nextLevel),
            resolveLevelPresentation: vi.fn(() => nextLevel),
            getChapter: vi.fn((id) => ({ id, name: `Chapter ${id}` })),
        },
        odysseyState: { isLevelUnlocked: vi.fn(() => true) },
        transitionManager: { prefetchLevelTheme: vi.fn().mockResolvedValue(true) },
        _showDetailedLevelResults: vi.fn().mockResolvedValue(undefined),
        _cleanupOdysseyHUD: vi.fn(),
        _cleanupMinimap: vi.fn(),
        _clearLevelStartCue: vi.fn(),
        _clearGameplayRevealState: vi.fn(),
        _cancelBoardParkTimer: vi.fn(),
        _hideGoalCompleteOverlay: vi.fn(),
        _removeVictoryLapInputs: vi.fn(),
        _prepareGameplayReveal: vi.fn().mockResolvedValue(true),
        _activateLevelThemeVisuals: vi.fn().mockResolvedValue(true),
        _waitForEntryRevealReadiness: vi.fn().mockResolvedValue(true),
        _playJourneyTransitionCue: vi.fn(),
        _beginGameplayReveal: vi.fn(() => ({ playablePromise: Promise.resolve(true) })),
        showLevelStartCue: vi.fn().mockResolvedValue(true),
        beginLevelRun: vi.fn(() => true),
        returnToBoard: vi.fn().mockResolvedValue(true),
        _lockOdysseyBoardForLaunch: vi.fn(),
        _unlockOdysseyBoardAfterLaunchAttempt: vi.fn(),
        _setBoardOverlaySuppressed: vi.fn(),
        _updateLevelPreview: vi.fn(),
        setOdysseyNavigatorButtonVisible: vi.fn(),
        boardController: { travelToLevel: vi.fn().mockResolvedValue(true) },
        launchOdysseyLevel: vi.fn().mockResolvedValue(true),
    };
    const session = {
        levelId: level.id,
        levelConfig: level,
        simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
        retirementGeneration: 3,
        gameState: {},
    };
    mode._activeLevelSession = session;
    mode._isLevelSessionCurrent = vi.fn((candidate, generation) => (
        mode._activeLevelSession === candidate && candidate.retirementGeneration === generation
    ));
    mode._isLevelSessionActive = vi.fn((candidate) => mode._activeLevelSession === candidate && !candidate.retired);
    mode.prepareLevelStart = vi.fn(async () => {
        mode._activeLevelSession = { gameState: {}, levelId: mode.currentLevelId };
        return true;
    });
    return { mode, session, settings };
}

async function flush() {
    await new Promise((resolve) => { setImmediate(resolve); });
}

describe('Odyssey journey flow', () => {
    beforeEach(() => {
        fixture.overlays = [];
        fixture.surfaces = [];
        fixture.nextOverlay = null;
        vi.stubGlobal('document', { hidden: false, body: { appendChild: vi.fn() } });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('resolves only the unlocked ranked successor, including a chapter boundary', () => {
        const { mode, session } = createMode();
        expect(getOdysseyFlowDestination(mode, session)).toBe(nextLevel);
        mode.odysseyState.isLevelUnlocked.mockReturnValue(false);
        expect(getOdysseyFlowDestination(mode, session)).toBeNull();
        mode.odysseyState.isLevelUnlocked.mockReturnValue(true);
        session.simulationClock = DEMO_FIXED_SIMULATION_CLOCK;
        expect(getOdysseyFlowDestination(mode, session)).toBeNull();
        session.simulationClock = 'unknown-clock';
        expect(getOdysseyFlowDestination(mode, session)).toBeNull();
        session.simulationClock = DEMO_LEGACY_SIMULATION_CLOCK;
        mode.levelRegistry.getNextLevel.mockReturnValue(null);
        expect(getOdysseyFlowDestination(mode, session)).toBeNull();
    });

    it('keeps finale and unranked outcomes in the detailed result view without an automatic orb', async () => {
        const { mode, session } = createMode();
        session.levelId = 59;
        mode.levelRegistry.getNextLevel.mockReturnValue(null);
        expect(await showOdysseyFlowResults(mode, results, session)).toBe('map');
        expect(mode._showDetailedLevelResults).toHaveBeenCalledWith(results, session);
        expect(fixture.overlays).toHaveLength(0);
        expect(mode.transitionManager.prefetchLevelTheme).not.toHaveBeenCalled();
    });

    it('celebrates automatically without mounting a leaderboard, and persists manual preference', async () => {
        const { mode, session } = createMode();
        const pending = showOdysseyFlowResults(mode, results, session);
        const modal = fixture.overlays[0];
        expect(modal.options.autoContinue).toBe(true);
        expect(mode._showDetailedLevelResults).not.toHaveBeenCalled();
        modal.options.onAutoContinueChange(false);
        expect(mode.deps.settingsManager.update).toHaveBeenCalledWith({ odysseyAutoContinue: false });
        expect(mode.deps.settingsManager.save).toHaveBeenCalledOnce();
        modal.options.onChoose('next');
        expect(await pending).toBe('next');
        expect(mode.transitionManager.prefetchLevelTheme).toHaveBeenCalledWith(nextLevel, { priority: 'high' });
    });

    it.each(['replay', 'preference'])('starts %s completion with manual continuation', async (reason) => {
        const { mode, session, settings } = createMode();
        if (reason === 'replay') session.isReplay = true;
        else settings.odysseyAutoContinue = false;
        const pending = showOdysseyFlowResults(mode, results, session);
        expect(fixture.overlays[0].options.autoContinue).toBe(false);
        fixture.overlays[0].options.onChoose('map');
        expect(await pending).toBe('map');
    });

    it('returns from optional detailed results to a manual next-orb choice', async () => {
        const { mode, session } = createMode();
        const pending = showOdysseyFlowResults(mode, results, session);
        fixture.overlays[0].options.onChoose('details');
        await flush();
        expect(mode._showDetailedLevelResults).toHaveBeenCalledOnce();
        expect(fixture.overlays[1].options.autoContinue).toBe(false);
        fixture.overlays[1].options.onChoose('next');
        expect(await pending).toBe('next');
    });

    it('cancels a completion on exact-attempt retirement without advancing', async () => {
        const { mode, session } = createMode();
        const pending = showOdysseyFlowResults(mode, results, session);
        session.disposeOutcome();
        session.retirementGeneration += 1;
        expect(await pending).toBe(false);
        expect(fixture.overlays[0].dispose).toHaveBeenCalledOnce();
    });

    it('directly starts after covered readiness and input reset without map or launcher calls', async () => {
        const { mode } = createMode();
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(true);
        expect(mode.currentLevelId).toBe(2);
        expect(mode.currentLevelConfig).toBe(nextLevel);
        expect(mode.returnToBoard).not.toHaveBeenCalled();
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(mode.prepareLevelStart).toHaveBeenCalledOnce();
        expect(mode._waitForEntryRevealReadiness).toHaveBeenCalledWith(nextLevel, 2);
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
        expect(mode.deps.inputController.clearTimers).toHaveBeenCalledTimes(2);
        expect(fixture.surfaces[0].uncover).toHaveBeenCalledOnce();
        expect(mode._journeyFlowOperation).toBeNull();
    });

    it('does not acquire loading protection or rebuild gameplay before the portal is opaque', async () => {
        const { mode } = createMode();
        const cover = deferred();
        fixture.nextOverlay = { cover: vi.fn(() => cover.promise) };
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(fixture.surfaces).toHaveLength(0);
        expect(mode.prepareLevelStart).not.toHaveBeenCalled();
        cover.resolve(true);
        expect(await pending).toBe(true);
    });

    it.each(['cover', 'preparation', 'countdown'])('cannot revive after cancellation during %s', async (stage) => {
        const { mode } = createMode();
        const gate = deferred();
        if (stage === 'cover') fixture.nextOverlay = { cover: vi.fn(() => gate.promise) };
        if (stage === 'preparation') mode._activateLevelThemeVisuals.mockReturnValue(gate.promise);
        if (stage === 'countdown') mode.showLevelStartCue.mockReturnValue(gate.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        cancelOdysseyJourneyFlow(mode);
        gate.resolve(true);
        expect(await pending).toBe(false);
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(mode.returnToBoard).not.toHaveBeenCalled();
        expect(mode._journeyFlowOperation).toBeNull();
    });

    it('waits for a late theme activation before recovering from failed gameplay preparation', async () => {
        const { mode } = createMode();
        const theme = deferred();
        mode._activateLevelThemeVisuals.mockReturnValue(theme.promise);
        mode.prepareLevelStart.mockRejectedValue(new Error('board failed'));
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.returnToBoard).not.toHaveBeenCalled();
        theme.resolve(true);
        expect(await pending).toBe(false);
        expect(mode.returnToBoard).toHaveBeenCalledWith({ focusLevelId: 2, onCovered: expect.any(Function) });
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('honors Map during loading after in-flight work settles', async () => {
        const { mode } = createMode();
        const theme = deferred();
        mode._activateLevelThemeVisuals.mockReturnValue(theme.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        fixture.overlays[0].options.onChoose('map');
        expect(fixture.overlays[0].retainCover).toHaveBeenCalledOnce();
        expect(fixture.overlays[0].dispose).not.toHaveBeenCalled();
        expect(mode.returnToBoard).not.toHaveBeenCalled();
        theme.resolve(true);
        expect(await pending).toBe(false);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('keeps the reset board covered until the returning portal reaches blackout', async () => {
        const { mode } = createMode();
        const theme = deferred();
        const returned = deferred();
        mode._activateLevelThemeVisuals.mockReturnValue(theme.promise);
        mode.returnToBoard.mockReturnValue(returned.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        const modal = fixture.overlays[0];
        modal.options.onChoose('map');
        theme.resolve(true);
        await flush();
        expect(modal.dispose).not.toHaveBeenCalled();
        const { onCovered } = mode.returnToBoard.mock.calls[0][0];
        onCovered();
        expect(modal.dispose).toHaveBeenCalledOnce();
        returned.resolve(true);
        expect(await pending).toBe(false);
    });

    it('settles a Map request while waiting for visibility without revealing gameplay', async () => {
        const { mode } = createMode();
        const resume = deferred();
        fixture.nextOverlay = {
            waitUntilVisible: vi.fn(() => resume.promise),
            retainCover: vi.fn(() => resume.resolve(false)),
        };
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        fixture.overlays[0].options.onChoose('map');
        expect(await pending).toBe(false);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('waits for intentional visibility resume before a new ready cue and live play', async () => {
        const { mode } = createMode();
        const resume = deferred();
        fixture.nextOverlay = { waitUntilVisible: vi.fn(() => resume.promise) };
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        resume.resolve(true);
        expect(await pending).toBe(true);
    });

    it('repeats Ready after blur even if focus returned during the first countdown', async () => {
        const { mode } = createMode();
        const resume = deferred();
        mode.showLevelStartCue.mockImplementationOnce(async () => {
            fixture.overlays[0].visibilityGeneration += 1;
            return true;
        });
        fixture.nextOverlay = {
            waitUntilVisible: vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(() => resume.promise),
        };
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        resume.resolve(true);
        expect(await pending).toBe(true);
        expect(mode.showLevelStartCue).toHaveBeenCalledTimes(2);
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
    });

    it('refuses a replaced prepared session and recovers the map', async () => {
        const { mode } = createMode();
        mode.showLevelStartCue.mockImplementation(async () => {
            mode._activeLevelSession = {};
            return true;
        });
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(false);
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('travels visibly to a new chapter, then waits indefinitely for one direct launch action', async () => {
        const { mode } = createMode();
        const destination = { id: 6, chapter: 2, name: 'Ocean arrival' };
        const pending = continueOdysseyJourney(mode, destination);
        await flush();
        const operation = mode._journeyFlowOperation;
        expect(mode.returnToBoard).toHaveBeenCalledWith({ preserveJourneyFlow: operation });
        expect(mode.boardController.travelToLevel).toHaveBeenCalledWith(6, {
            chapterArrival: true, travelDuration: 2200, focusDuration: 450, focus: false,
        });
        expect(mode._setBoardOverlaySuppressed).toHaveBeenCalledWith(true);
        expect(fixture.overlays[0].options.variant).toBe('chapter');
        expect(fixture.overlays[0].options.autoContinue).toBe(false);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        fixture.overlays[0].options.onChoose('next');
        expect(await pending).toBe(true);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(6, {
            source: 'chapter-flow', beginPreparedRun: expect.any(Function), isCurrent: expect.any(Function),
        });
    });

    it('keeps chapter presence ownership through launch and repeats a missed Ready cue', async () => {
        const { mode } = createMode();
        const resume = deferred();
        const destination = { id: 6, chapter: 2 };
        mode.launchOdysseyLevel.mockImplementation(async (_id, options) => {
            mode._activeLevelSession = { gameState: {}, levelId: 6 };
            return options.beginPreparedRun();
        });
        mode.showLevelStartCue.mockImplementationOnce(async () => {
            fixture.overlays[0].visibilityGeneration += 1;
            fixture.overlays[0].waitUntilVisible.mockImplementationOnce(() => resume.promise);
            return true;
        });
        const pending = continueOdysseyJourney(mode, destination);
        await flush();
        const modal = fixture.overlays[0];
        modal.options.onChoose('next');
        await flush();
        expect(modal.beginTransit).toHaveBeenCalledOnce();
        expect(modal.dispose).not.toHaveBeenCalled();
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        resume.resolve(true);
        expect(await pending).toBe(true);
        expect(mode.showLevelStartCue).toHaveBeenCalledTimes(2);
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
    });

    it('still accepts Map after Begin chapter while the new run waits for presence', async () => {
        const { mode } = createMode();
        const resume = deferred();
        mode.launchOdysseyLevel.mockImplementation(async (_id, options) => {
            mode._activeLevelSession = { gameState: {}, levelId: 6 };
            fixture.overlays[0].waitUntilVisible.mockImplementationOnce(() => resume.promise);
            return options.beginPreparedRun();
        });
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        const modal = fixture.overlays[0];
        modal.retainCover.mockImplementation(() => resume.resolve(false));
        modal.options.onChoose('next');
        await flush();
        modal.options.onChoose('map');
        expect(await pending).toBe(false);
        expect(modal.retainCover).toHaveBeenCalled();
        expect(mode.returnToBoard).toHaveBeenCalledTimes(2);
        expect(mode.returnToBoard).toHaveBeenLastCalledWith({ focusLevelId: 6, onCovered: expect.any(Function) });
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('does not return to the map twice when an aborted chapter launch already restored it', async () => {
        const { mode } = createMode();
        mode.launchOdysseyLevel.mockImplementation(async (_id, options) => {
            fixture.overlays[0].options.onChoose('map');
            expect(options.isCurrent()).toBe(false);
            mode.isInBoardView = true;
            mode.currentLevelId = null;
            return false;
        });
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        fixture.overlays[0].options.onChoose('next');
        expect(await pending).toBe(false);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('supports reduced-motion chapter travel and leaves an interactive map when chosen', async () => {
        const { mode, settings } = createMode();
        settings.reducedMotion = true;
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        expect(mode.boardController.travelToLevel).toHaveBeenCalledWith(6, {
            chapterArrival: true, travelDuration: 0, focusDuration: 0, focus: false,
        });
        fixture.overlays[0].options.onChoose('map');
        expect(await pending).toBe(true);
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalledOnce();
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode.setOdysseyNavigatorButtonVisible).toHaveBeenCalledWith(true);
        expect(mode._updateLevelPreview).toHaveBeenLastCalledWith(6);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
    });

    it('cannot show a chapter interlude after external stop during the owned map return', async () => {
        const { mode } = createMode();
        const returned = deferred();
        mode.returnToBoard.mockReturnValue(returned.promise);
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        cancelOdysseyJourneyFlow(mode);
        returned.resolve(true);
        expect(await pending).toBe(false);
        expect(fixture.overlays).toHaveLength(0);
        expect(mode.boardController.travelToLevel).not.toHaveBeenCalled();
    });

    it('settles a waiting chapter choice on deactivation', async () => {
        const { mode } = createMode();
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        cancelOdysseyJourneyFlow(mode);
        expect(await pending).toBe(false);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
    });
});
