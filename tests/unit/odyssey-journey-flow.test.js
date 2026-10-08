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
            beginTransit: vi.fn(({ onChoose } = {}) => { if (onChoose) options.onChoose = onChoose; return true; }),
            showChapter: vi.fn(({ onChoose } = {}) => { if (onChoose) options.onChoose = onChoose; return true; }),
            cover: vi.fn().mockResolvedValue(true),
            reveal: vi.fn().mockResolvedValue(true),
            hold: vi.fn(),
            setStatus: vi.fn(),
            setScenic: vi.fn(),
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
        _restoreInputs: vi.fn(),
        _applyBoardAudioPolicy: vi.fn().mockResolvedValue(undefined),
        _restoreTransitionMusicDuck: vi.fn(),
        setOdysseyNavigatorButtonVisible: vi.fn(),
        boardController: {
            travelToLevel: vi.fn().mockResolvedValue(true),
            cancelTravel: vi.fn(),
            cameraController: { config: { idleAutoDrift: true } },
        },
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
    mode._isLevelSessionActive = vi.fn((candidate) => !!candidate
        && mode._activeLevelSession === candidate && !candidate.retired);
    mode.prepareLevelStart = vi.fn(async () => {
        mode._activeLevelSession = { gameState: {}, levelId: mode.currentLevelId };
        return true;
    });
    const launch = {
        blackout: vi.fn().mockResolvedValue(true),
        restoreMap: vi.fn(() => {
            mode.currentLevelId = null;
            mode.currentLevelConfig = null;
            mode.isInBoardView = true;
            mode.isEnteringLevel = false;
            return false;
        }),
    };
    mode.returnToBoard.mockImplementation(async (options = {}) => {
        options.onCovered?.();
        mode.currentLevelId = null;
        mode.currentLevelConfig = null;
        mode.isInBoardView = true;
        mode.isEnteringLevel = false;
        if (options.scenicJourney) mode._scenicJourneyOperation = options.preserveJourneyFlow;
        options.onWorldReady?.();
        return true;
    });
    // This adapter preserves the launcher's observable lifecycle: blackout owns
    // rebuilding, all preparation settles before recovery, and reveal precedes play.
    // Portal rendering itself is covered by the entry/return transition suites.
    mode.launchOdysseyLevel.mockImplementation(async (id, options) => {
        const owner = mode._journeyFlowOperation;
        const current = () => options.isCurrent?.() !== false;
        const abort = () => (mode.isActive && mode._journeyFlowOperation === owner
            ? launch.restoreMap() : false);
        if (!current()) return abort();
        mode.currentLevelId = id;
        mode.currentLevelConfig = id === nextLevel.id ? nextLevel : { id, chapter: 2 };
        mode.isEnteringLevel = true;
        if (!await launch.blackout() || !current()) return abort();
        if (await options.onBlackoutReached?.() === false || !current()) return abort();
        await mode._prepareGameplayReveal();
        const prepared = await Promise.allSettled([
            mode._activateLevelThemeVisuals(mode.currentLevelConfig, { isCurrent: current }),
            mode.prepareLevelStart(),
        ]);
        if (!current() || prepared.some((result) => result.status === 'rejected' || result.value === false)) {
            return abort();
        }
        if (!await mode._waitForEntryRevealReadiness(mode.currentLevelConfig, ++mode.themeRevealToken)
            || !current()) return abort();
        if (await options.onRevealStart?.() === false || !current()) return abort();
        mode.isInBoardView = false;
        const started = await options.beginPreparedRun();
        if (!started || !current()) return abort();
        mode.isEnteringLevel = false;
        return true;
    });
    return {
        mode, session, settings, launch,
    };
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
        session.levelId = 60;
        mode.levelRegistry.getNextLevel.mockReturnValue(null);
        expect(await showOdysseyFlowResults(mode, results, session)).toBe('map');
        expect(mode._showDetailedLevelResults).toHaveBeenCalledWith(results, session);
        expect(fixture.overlays).toHaveLength(0);
        expect(mode.transitionManager.prefetchLevelTheme).not.toHaveBeenCalled();
    });

    it('passes the same collection receipt and reduced motion into manual final-orb results', async () => {
        const { mode, session, settings } = createMode();
        mode.levelRegistry.getNextLevel.mockReturnValue(null);
        settings.reducedMotion = true;
        const themeUnlock = {
            persisted: true, themeIds: ['neon-district'], totalOwned: 69, totalThemes: 69,
        };
        await showOdysseyFlowResults(mode, { ...results, themeUnlock }, session);
        const [presented] = mode._showDetailedLevelResults.mock.calls[0];
        expect(presented.themeUnlock).toBe(themeUnlock);
        expect(presented.reducedMotion).toBe(true);
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

    it('carries the same completion view through preparation after releasing retired-attempt ownership', async () => {
        const { mode, session } = createMode();
        const pending = showOdysseyFlowResults(mode, results, session);
        const modal = fixture.overlays[0];
        modal.options.onChoose('next');
        expect(await pending).toBe('next');
        expect(modal.dispose).not.toHaveBeenCalled();
        expect(session.disposeOutcome).toBeNull();
        mode.prepareLevelStart.mockImplementation(async () => {
            session.disposeOutcome?.();
            expect(modal.dispose).not.toHaveBeenCalled();
            mode._activeLevelSession = { gameState: {}, levelId: 2 };
            return true;
        });
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(true);
        expect(fixture.overlays).toHaveLength(1);
        expect(modal.beginTransit).toHaveBeenCalledWith({ onChoose: expect.any(Function) });
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('still honors Map during preparation on the transferred completion view', async () => {
        const { mode, session } = createMode();
        const theme = deferred();
        mode._activateLevelThemeVisuals.mockReturnValue(theme.promise);
        const choice = showOdysseyFlowResults(mode, results, session);
        const modal = fixture.overlays[0];
        modal.options.onChoose('next');
        await choice;
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        modal.beginTransit.mock.calls[0][0].onChoose('map');
        expect(modal.retainCover).toHaveBeenCalledOnce();
        theme.resolve(true);
        expect(await pending).toBe(false);
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('disposes a transferred view if the mode stops before continuation is invoked', async () => {
        const { mode, session } = createMode();
        const pending = showOdysseyFlowResults(mode, results, session);
        const modal = fixture.overlays[0];
        modal.options.onChoose('next');
        await pending;
        mode.isActive = false;
        cancelOdysseyJourneyFlow(mode);
        expect(modal.dispose).toHaveBeenCalledOnce();
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(false);
        expect(mode.prepareLevelStart).not.toHaveBeenCalled();
    });

    it('cannot transfer an outcome whose retirement generation changed while it was visible', async () => {
        const { mode, session } = createMode();
        const pending = showOdysseyFlowResults(mode, results, session);
        const modal = fixture.overlays[0];
        session.retirementGeneration += 1;
        modal.options.onChoose('next');
        expect(await pending).toBe(false);
        expect(mode._journeyFlowOperation).toBeUndefined();
        expect(modal.dispose).toHaveBeenCalledOnce();
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

    it('carries the player through the resident world and its next orb portal before starting once', async () => {
        const { mode } = createMode();
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(true);
        expect(mode.currentLevelId).toBe(2);
        expect(mode.currentLevelConfig).toBe(nextLevel);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.returnToBoard).toHaveBeenCalledWith(expect.objectContaining({
            preserveJourneyFlow: expect.any(Object), scenicJourney: true, focusLevelId: 1,
        }));
        expect(mode.boardController.travelToLevel).toHaveBeenCalledWith(2, expect.objectContaining({
            pathTravel: true,
            focus: false,
            travelDuration: 1500,
            isCurrent: expect.any(Function),
            isPaused: expect.any(Function),
        }));
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(2, expect.objectContaining({
            source: 'journey-flow',
            isCurrent: expect.any(Function),
            onBlackoutReached: expect.any(Function),
            onRevealStart: expect.any(Function),
            beginPreparedRun: expect.any(Function),
        }));
        expect(mode.returnToBoard.mock.invocationCallOrder[0])
            .toBeLessThan(mode.boardController.travelToLevel.mock.invocationCallOrder[0]);
        expect(mode.boardController.travelToLevel.mock.invocationCallOrder[0])
            .toBeLessThan(mode.launchOdysseyLevel.mock.invocationCallOrder[0]);
        expect(fixture.overlays[0].setScenic.mock.calls.map(([phase]) => phase))
            .toEqual(expect.arrayContaining(['emerging', 'travel', 'entering']));
        expect(mode.prepareLevelStart).toHaveBeenCalledOnce();
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
        expect(fixture.surfaces[0].uncover).toHaveBeenCalledOnce();
        expect(mode._journeyFlowOperation).toBeNull();
    });

    it('keeps the world visible and does not rebuild gameplay until entry reaches opaque blackout', async () => {
        const { mode, launch } = createMode();
        const blackout = deferred();
        launch.blackout.mockReturnValue(blackout.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.boardController.travelToLevel).toHaveBeenCalledOnce();
        expect(mode.launchOdysseyLevel).toHaveBeenCalledOnce();
        expect(fixture.surfaces).toHaveLength(0);
        expect(mode.prepareLevelStart).not.toHaveBeenCalled();
        expect(mode._activateLevelThemeVisuals).not.toHaveBeenCalled();
        blackout.resolve(true);
        expect(await pending).toBe(true);
        expect(fixture.surfaces).toHaveLength(1);
    });

    it('keeps the loading surface owned until gameplay readiness reaches the reveal hook', async () => {
        const { mode } = createMode();
        const ready = deferred();
        mode._waitForEntryRevealReadiness.mockReturnValue(ready.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(fixture.surfaces).toHaveLength(1);
        expect(fixture.surfaces[0].uncover).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        ready.resolve(true);
        expect(await pending).toBe(true);
        expect(fixture.surfaces[0].uncover).toHaveBeenCalledOnce();
        expect(fixture.surfaces[0].cancel).toHaveBeenCalled();
    });

    it('keeps the chapter world still during a held journey and restores its camera after Map', async () => {
        const { mode } = createMode();
        const travel = deferred();
        mode.boardController.travelToLevel.mockReturnValue(travel.promise);
        mode.boardController.cancelTravel.mockImplementation(() => travel.resolve(false));
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(false);
        fixture.overlays[0].options.onChoose('map');
        expect(await pending).toBe(false);
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(true);
    });

    it('reduces path travel motion while preserving the same entry and readiness protections', async () => {
        const { mode, settings } = createMode();
        settings.reducedMotion = true;
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(true);
        expect(mode.boardController.travelToLevel).toHaveBeenCalledWith(2, expect.objectContaining({
            pathTravel: true, travelDuration: 0, focus: false,
        }));
        expect(mode.prepareLevelStart).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
    });

    it('covers the world before the reduced-motion destination seek can jump the camera', async () => {
        const { mode, settings } = createMode();
        settings.reducedMotion = true;
        const cover = deferred();
        fixture.nextOverlay = { cover: vi.fn(() => cover.promise) };
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.boardController.travelToLevel).not.toHaveBeenCalled();
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        cover.resolve(true);
        expect(await pending).toBe(true);
        expect(mode.boardController.travelToLevel).toHaveBeenCalledOnce();
    });

    it.each(['return', 'travel', 'blackout', 'preparation', 'countdown'])('stays cancelled in %s', async (stage) => {
        const { mode, launch } = createMode();
        const gate = deferred();
        if (stage === 'return') mode.returnToBoard.mockReturnValue(gate.promise);
        if (stage === 'travel') mode.boardController.travelToLevel.mockReturnValue(gate.promise);
        if (stage === 'blackout') launch.blackout.mockReturnValue(gate.promise);
        if (stage === 'preparation') mode._activateLevelThemeVisuals.mockReturnValue(gate.promise);
        if (stage === 'countdown') mode.showLevelStartCue.mockReturnValue(gate.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        cancelOdysseyJourneyFlow(mode);
        gate.resolve(true);
        expect(await pending).toBe(false);
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode._journeyFlowOperation).toBeNull();
        expect(mode.boardController.cancelTravel).toHaveBeenCalled();
    });

    it('cannot travel or launch a destination when the source world return fails', async () => {
        const { mode } = createMode();
        mode.returnToBoard.mockResolvedValue(false);
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(false);
        expect(mode.boardController.travelToLevel).not.toHaveBeenCalled();
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(fixture.surfaces).toHaveLength(0);
    });

    it('waits for late theme activation before the launcher recovers failed gameplay preparation', async () => {
        const { mode, launch } = createMode();
        const theme = deferred();
        mode._activateLevelThemeVisuals.mockReturnValue(theme.promise);
        mode.prepareLevelStart.mockRejectedValue(new Error('board failed'));
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(launch.restoreMap).not.toHaveBeenCalled();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        theme.resolve(true);
        expect(await pending).toBe(false);
        expect(launch.restoreMap).toHaveBeenCalledOnce();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('honors Map during world travel by cancelling motion and restoring the existing map controls', async () => {
        const { mode } = createMode();
        const travel = deferred();
        mode.boardController.travelToLevel.mockReturnValue(travel.promise);
        mode.boardController.cancelTravel.mockImplementation(() => travel.resolve(false));
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        fixture.overlays[0].options.onChoose('map');
        expect(await pending).toBe(false);
        expect(mode.boardController.cancelTravel).toHaveBeenCalled();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalled();
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode.setOdysseyNavigatorButtonVisible).toHaveBeenCalledWith(true);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(fixture.surfaces).toHaveLength(0);
    });

    it('restores usable map controls immediately while the resident-world music settles separately', async () => {
        const { mode } = createMode();
        const travel = deferred();
        const audio = deferred();
        const settled = vi.fn();
        mode.boardController.travelToLevel.mockReturnValue(travel.promise);
        mode.boardController.cancelTravel.mockImplementation(() => travel.resolve(false));
        mode._applyBoardAudioPolicy.mockReturnValue(audio.promise);
        const pending = continueOdysseyJourney(mode, nextLevel).then(settled);
        await flush();
        fixture.overlays[0].options.onChoose('map');
        await flush();
        expect(mode._applyBoardAudioPolicy).toHaveBeenCalledWith({ restoreTrack: true });
        expect(mode._restoreTransitionMusicDuck).toHaveBeenCalledWith(250);
        expect(mode._restoreInputs).toHaveBeenCalledOnce();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalledOnce();
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode.setOdysseyNavigatorButtonVisible).toHaveBeenCalledWith(true);
        expect(mode._scenicJourneyOperation).toBeNull();
        expect(settled).toHaveBeenCalledWith(false);
        audio.resolve();
        await pending;
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('recovers failed path travel to the visible resident world without replaying a return portal', async () => {
        const { mode } = createMode();
        mode.boardController.travelToLevel.mockResolvedValue(false);
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(false);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalled();
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(true);
    });

    it('honors Map during portal preparation after in-flight work settles without a second return', async () => {
        const { mode, launch } = createMode();
        const theme = deferred();
        mode._activateLevelThemeVisuals.mockReturnValue(theme.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        fixture.overlays[0].options.onChoose('map');
        expect(fixture.overlays[0].retainCover).toHaveBeenCalled();
        expect(fixture.overlays[0].dispose).not.toHaveBeenCalled();
        expect(launch.restoreMap).not.toHaveBeenCalled();
        theme.resolve(true);
        expect(await pending).toBe(false);
        expect(launch.restoreMap).toHaveBeenCalledOnce();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode._applyBoardAudioPolicy).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('keeps failed entry covered until an unhandled launch error has returned safely to the world', async () => {
        const { mode } = createMode();
        const returned = deferred();
        mode.launchOdysseyLevel.mockImplementation(async () => {
            mode.isInBoardView = false;
            mode.currentLevelId = 2;
            throw new Error('unexpected entry failure');
        });
        mode.returnToBoard.mockImplementationOnce(async () => {
            mode.currentLevelId = null;
            mode.isInBoardView = true;
            return true;
        }).mockReturnValueOnce(returned.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        const modal = fixture.overlays[0];
        expect(modal.dispose).not.toHaveBeenCalled();
        const { onCovered } = mode.returnToBoard.mock.calls[1][0];
        onCovered();
        expect(modal.dispose).toHaveBeenCalledOnce();
        returned.resolve(true);
        expect(await pending).toBe(false);
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('waits for deliberate presence resume before moving through the chapter world', async () => {
        const { mode } = createMode();
        const resume = deferred();
        fixture.nextOverlay = {
            waitUntilVisible: vi.fn().mockImplementationOnce(() => resume.promise)
                .mockResolvedValue(true),
        };
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.boardController.travelToLevel).not.toHaveBeenCalled();
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        resume.resolve(true);
        expect(await pending).toBe(true);
    });

    it('pauses travel on lost presence and requires a live operation for its next frame', async () => {
        const { mode } = createMode();
        const travel = deferred();
        mode.boardController.travelToLevel.mockReturnValue(travel.promise);
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        const options = mode.boardController.travelToLevel.mock.calls[0][1];
        const modal = fixture.overlays[0];
        expect(options.isPaused()).toBe(false);
        modal.dataset.visibilityHeld = 'true';
        expect(options.isPaused()).toBe(true);
        modal.dataset.visibilityHeld = 'false';
        document.hidden = true;
        expect(options.isPaused()).toBe(true);
        document.hidden = false;
        expect(options.isCurrent()).toBe(true);
        cancelOdysseyJourneyFlow(mode);
        expect(options.isCurrent()).toBe(false);
        travel.resolve(false);
        expect(await pending).toBe(false);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
    });

    it('settles Map while waiting for presence after preparation without revealing live gameplay', async () => {
        const { mode } = createMode();
        const resume = deferred();
        mode._waitForEntryRevealReadiness.mockImplementationOnce(async () => {
            fixture.overlays[0].waitUntilVisible.mockImplementationOnce(() => resume.promise);
            return true;
        });
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        const modal = fixture.overlays[0];
        modal.retainCover.mockImplementation(() => resume.resolve(false));
        modal.options.onChoose('map');
        expect(await pending).toBe(false);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('waits for intentional visibility resume before a new ready cue and live play', async () => {
        const { mode } = createMode();
        const resume = deferred();
        mode._waitForEntryRevealReadiness.mockImplementationOnce(async () => {
            fixture.overlays[0].waitUntilVisible.mockImplementationOnce(() => resume.promise);
            return true;
        });
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.prepareLevelStart).toHaveBeenCalledOnce();
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
            fixture.overlays[0].waitUntilVisible.mockImplementationOnce(() => resume.promise);
            return true;
        });
        const pending = continueOdysseyJourney(mode, nextLevel);
        await flush();
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        resume.resolve(true);
        expect(await pending).toBe(true);
        expect(mode.showLevelStartCue).toHaveBeenCalledTimes(2);
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
    });

    it('refuses a replaced prepared session and accepts the launcher map recovery', async () => {
        const { mode, launch } = createMode();
        mode.showLevelStartCue.mockImplementation(async () => {
            mode._activeLevelSession = {};
            return true;
        });
        expect(await continueOdysseyJourney(mode, nextLevel)).toBe(false);
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(launch.restoreMap).toHaveBeenCalledOnce();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('cannot cancel a replacement operation or its travel when an old return resolves late', async () => {
        const { mode } = createMode();
        const oldReturn = deferred();
        mode.returnToBoard.mockReturnValueOnce(oldReturn.promise);
        const obsolete = continueOdysseyJourney(mode, nextLevel);
        await flush();
        mode._scenicJourneyOperation = mode._journeyFlowOperation;
        cancelOdysseyJourneyFlow(mode);
        expect(mode._scenicJourneyOperation).toBeNull();
        const newTravel = deferred();
        mode.boardController.travelToLevel.mockReturnValueOnce(newTravel.promise);
        const replacement = continueOdysseyJourney(mode, nextLevel, { chapterBreak: false });
        await flush();
        const activeOperation = mode._journeyFlowOperation;
        const cancellationCount = mode.boardController.cancelTravel.mock.calls.length;
        oldReturn.resolve(true);
        expect(await obsolete).toBe(false);
        expect(mode._journeyFlowOperation).toBe(activeOperation);
        expect(mode._scenicJourneyOperation).toBe(activeOperation);
        expect(mode._applyBoardAudioPolicy).not.toHaveBeenCalled();
        expect(mode._restoreInputs).not.toHaveBeenCalled();
        expect(mode.boardController.cancelTravel).toHaveBeenCalledTimes(cancellationCount);
        newTravel.resolve(true);
        expect(await replacement).toBe(true);
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
    });

    it('rejects stale portal hooks without taking a new operation loading lease or starting its board', async () => {
        const { mode, launch } = createMode();
        const blackout = deferred();
        launch.blackout.mockReturnValueOnce(blackout.promise);
        const obsolete = continueOdysseyJourney(mode, nextLevel);
        await flush();
        const oldHooks = mode.launchOdysseyLevel.mock.calls[0][1];
        cancelOdysseyJourneyFlow(mode);
        const travel = deferred();
        mode.boardController.travelToLevel.mockReturnValueOnce(travel.promise);
        const replacement = continueOdysseyJourney(mode, nextLevel, { chapterBreak: false });
        await flush();
        const owner = mode._journeyFlowOperation;
        expect(oldHooks.isCurrent()).toBe(false);
        expect(await oldHooks.onBlackoutReached()).toBe(false);
        expect(await oldHooks.onRevealStart()).toBe(false);
        expect(await oldHooks.beginPreparedRun()).toBe(false);
        expect(fixture.surfaces).toHaveLength(0);
        expect(mode.prepareLevelStart).not.toHaveBeenCalled();
        blackout.resolve(true);
        expect(await obsolete).toBe(false);
        expect(mode._journeyFlowOperation).toBe(owner);
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(false);
        travel.resolve(true);
        expect(await replacement).toBe(true);
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
    });

    it('travels visibly to a new chapter, then waits indefinitely for one direct launch action', async () => {
        const { mode } = createMode();
        const destination = { id: 6, chapter: 2, name: 'Ocean arrival' };
        const pending = continueOdysseyJourney(mode, destination);
        await flush();
        const operation = mode._journeyFlowOperation;
        expect(mode.returnToBoard).toHaveBeenCalledWith({
            preserveJourneyFlow: operation, settlePath: true, onWorldReady: expect.any(Function),
        });
        expect(mode.boardController.travelToLevel).toHaveBeenCalledWith(6, {
            chapterArrival: true, travelDuration: 2200, focusDuration: 450, focus: false,
            isCurrent: expect.any(Function), isPaused: expect.any(Function),
        });
        expect(mode._setBoardOverlaySuppressed).toHaveBeenCalledWith(true);
        expect(fixture.overlays[0].options.variant).toBe('transit');
        expect(fixture.overlays[0].showChapter).toHaveBeenCalledOnce();
        expect(fixture.overlays[0].options.autoContinue).toBe(false);
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        fixture.overlays[0].options.onChoose('next');
        expect(await pending).toBe(true);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(6, {
            source: 'chapter-flow', beginPreparedRun: expect.any(Function), isCurrent: expect.any(Function),
            onBlackoutReached: expect.any(Function), onRevealStart: expect.any(Function),
        });
    });

    it('retains the saved completion presence owner through chapter travel and reading', async () => {
        const { mode, session } = createMode();
        const destination = { id: 6, chapter: 2, name: 'Ocean arrival' };
        mode.levelRegistry.getNextLevel.mockReturnValue(destination);
        mode.levelRegistry.resolveLevelPresentation.mockReturnValue(destination);
        const completion = showOdysseyFlowResults(mode, results, session);
        const modal = fixture.overlays[0];
        modal.options.onChoose('next');
        expect(await completion).toBe('next');
        expect(session.disposeOutcome).toBeNull();
        expect(modal.dispose).not.toHaveBeenCalled();
        const pending = continueOdysseyJourney(mode, destination);
        await flush();
        expect(fixture.overlays).toHaveLength(1);
        expect(modal.beginTransit).toHaveBeenCalledOnce();
        expect(modal.showChapter).toHaveBeenCalledOnce();
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(false);
        modal.options.onChoose('map');
        expect(await pending).toBe(true);
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(true);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode._applyBoardAudioPolicy).not.toHaveBeenCalled();
    });

    it('holds chapter return before launch until the retained presence owner resumes', async () => {
        const { mode } = createMode();
        const resume = deferred();
        fixture.nextOverlay = { waitUntilVisible: vi.fn().mockReturnValueOnce(resume.promise).mockResolvedValue(true) };
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        const modal = fixture.overlays[0];
        expect(modal.setScenic).toHaveBeenCalledWith('emerging');
        expect(mode.returnToBoard).not.toHaveBeenCalled();
        resume.resolve(true);
        await flush();
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        modal.options.onChoose('map');
        await pending;
    });

    it('keeps Map available during chapter return and restores its resident world once', async () => {
        const { mode } = createMode();
        const returnGate = deferred();
        mode.returnToBoard.mockImplementationOnce(async () => {
            await returnGate.promise;
            mode.currentLevelId = null;
            mode.isInBoardView = true;
            return true;
        });
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        const modal = fixture.overlays[0];
        modal.options.onChoose('map');
        expect(modal.retainCover).toHaveBeenCalledOnce();
        returnGate.resolve();
        expect(await pending).toBe(false);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.boardController.travelToLevel).not.toHaveBeenCalled();
        expect(modal.showChapter).not.toHaveBeenCalled();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalledOnce();
    });

    it('pauses chapter rail travel on blur and keeps the vista still until the chapter ends', async () => {
        const { mode } = createMode();
        const travel = deferred();
        mode.boardController.travelToLevel.mockReturnValueOnce(travel.promise);
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        const modal = fixture.overlays[0];
        const travelOptions = mode.boardController.travelToLevel.mock.calls[0][1];
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(false);
        expect(modal.showChapter).not.toHaveBeenCalled();
        expect(travelOptions.isPaused()).toBe(false);
        modal.dataset.visibilityHeld = 'true';
        expect(travelOptions.isPaused()).toBe(true);
        modal.dataset.visibilityHeld = 'false';
        document.hidden = true;
        expect(travelOptions.isPaused()).toBe(true);
        document.hidden = false;
        travel.resolve(true);
        await flush();
        expect(modal.showChapter).toHaveBeenCalledOnce();
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(false);
        modal.options.onChoose('map');
        await pending;
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(true);
    });

    it('cancels chapter travel and its pending narrative when Map is requested', async () => {
        const { mode } = createMode();
        const travel = deferred();
        mode.boardController.travelToLevel.mockReturnValueOnce(travel.promise);
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        const modal = fixture.overlays[0];
        const options = mode.boardController.travelToLevel.mock.calls[0][1];
        modal.options.onChoose('map');
        expect(mode.boardController.cancelTravel).toHaveBeenCalled();
        expect(options.isCurrent()).toBe(false);
        travel.resolve(false);
        expect(await pending).toBe(false);
        expect(modal.showChapter).not.toHaveBeenCalled();
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(mode.boardController.cameraController.config.idleAutoDrift).toBe(true);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('covers a reduced-motion chapter seek before moving and reveals its narrative only after arrival', async () => {
        const { mode, settings } = createMode();
        settings.reducedMotion = true;
        const cover = deferred();
        const travel = deferred();
        fixture.nextOverlay = { cover: vi.fn(() => cover.promise) };
        mode.boardController.travelToLevel.mockReturnValueOnce(travel.promise);
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        const modal = fixture.overlays[0];
        expect(modal.cover).toHaveBeenCalledOnce();
        expect(mode.boardController.travelToLevel).not.toHaveBeenCalled();
        cover.resolve(true);
        await flush();
        expect(mode.boardController.travelToLevel).toHaveBeenCalledOnce();
        expect(modal.showChapter).not.toHaveBeenCalled();
        travel.resolve(true);
        await flush();
        expect(modal.showChapter).toHaveBeenCalledOnce();
        modal.options.onChoose('map');
        await pending;
    });

    it('starts the chapter briefing fade with board reveal, then waits for both before Ready', async () => {
        const { mode } = createMode();
        const fade = deferred();
        const boardReveal = deferred();
        fixture.nextOverlay = { reveal: vi.fn(() => fade.promise) };
        mode.launchOdysseyLevel.mockImplementation(async (_id, options) => {
            await options.onBlackoutReached();
            await mode.prepareLevelStart();
            await options.onRevealStart();
            await boardReveal.promise;
            return options.beginPreparedRun();
        });
        const pending = continueOdysseyJourney(mode, { id: 6, chapter: 2 });
        await flush();
        const modal = fixture.overlays[0];
        expect(fixture.surfaces).toHaveLength(0);
        modal.options.onChoose('next');
        await flush();
        expect(fixture.surfaces).toHaveLength(1);
        expect(fixture.surfaces[0].uncover).toHaveBeenCalledOnce();
        expect(modal.reveal).toHaveBeenCalledOnce();
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        fade.resolve(true);
        await flush();
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        boardReveal.resolve();
        expect(await pending).toBe(true);
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
        expect(fixture.surfaces[0].cancel).toHaveBeenCalledOnce();
    });

    it('keeps chapter presence ownership through launch and repeats a missed Ready cue', async () => {
        const { mode } = createMode();
        const resume = deferred();
        const destination = { id: 6, chapter: 2 };
        mode.launchOdysseyLevel.mockImplementation(async (_id, options) => {
            mode._activeLevelSession = { gameState: {}, levelId: 6 };
            await options.onBlackoutReached();
            await options.onRevealStart();
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
            mode.currentLevelId = 6;
            mode.isInBoardView = false;
            fixture.overlays[0].waitUntilVisible.mockImplementationOnce(() => resume.promise);
            await options.onBlackoutReached();
            await options.onRevealStart();
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
            isCurrent: expect.any(Function), isPaused: expect.any(Function),
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
        expect(fixture.overlays).toHaveLength(1);
        expect(fixture.overlays[0].dispose).toHaveBeenCalled();
        expect(fixture.overlays[0].showChapter).not.toHaveBeenCalled();
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
