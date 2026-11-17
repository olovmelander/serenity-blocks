/**
 * Coming back out of an orb (src/ui/odyssey/odyssey-world-return.js): the passage back is the
 * same visit seen from the other side, and as the world's gate opens the world answers the orb
 * just cleared (its stars land, the rail lights up toward the next orb).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { returnToOdysseyWorld } from '../../src/ui/odyssey/odyssey-world-return.js';

/** A mode with just what the return touches; its transition plays straight through. */
function createMode({ cleared = null, nextUnlocked = true, reducedMotion = false } = {}) {
    const played = [];
    const mode = {
        isActive: true,
        currentLevelId: 14,
        currentLevelConfig: { id: 14, chapter: 3, theme: { primary: 'moonlit-greenhouse' } },
        themeRevealToken: 0,
        _orbJustCleared: cleared,
        _journeyFlowOperation: null,
        deps: {
            settingsManager: { get: () => ({ reducedMotion }) },
            themeManager: { suspendThemes: vi.fn() },
        },
        levelRegistry: { getNextLevel: vi.fn((id) => ({ id: id + 1 })) },
        odysseyState: { isLevelUnlocked: vi.fn(() => nextUnlocked) },
        boardController: {
            needsQualityRebuild: () => false,
            nodeManager: {
                landStars: vi.fn(),
                pulseNode: vi.fn(),
                getNodePathPosition: (id) => 0.1 + id * 0.01,
            },
            pathRenderer: { pathCurve: { getLength: () => 2500 }, playRipple: vi.fn(() => true) },
        },
        journeyReturnTransition: {
            play: vi.fn(async (config) => {
                played.push(config);
                await config.callbacks.onBlackoutReached();
                await config.callbacks.onRevealStart();
                await config.callbacks.onComplete();
                return { success: true };
            }),
        },
        _buildJourneyEntryPalette: vi.fn(() => ({ primary: '#123456', look: { kind: 'petals', seed: 7 } })),
        _buildJourneyReturnTimings: vi.fn(() => ({})),
        _resolveJourneyReturnDepartureAnchor: vi.fn(() => ({ x: 0.5, y: 0.5, radius: 0.2 })),
        _resolveJourneyReturnArrivalAnchor: vi.fn(() => ({
            x: 0.6, y: 0.4, radius: 0.1, onScreen: true,
        })),
        _retireLevelSession: vi.fn(() => null),
        _showBoardView: vi.fn(async () => true),
        onStop: vi.fn(async () => {}),
        _applyBoardAudioPolicy: vi.fn(async () => {}),
    };
    ['_perfMark', '_perfMeasure', '_lockOdysseyBoardForLaunch', '_setBoardOverlaySuppressed',
        '_clearNeutralThemeFallbackBackdrop', '_clearLevelThemePrefetchTimer', '_clearGameplayRevealState',
        '_clearLevelStartCue', '_clearBoardReturnFallbackVeil', '_hideGameplaySurfaceForBoardReturn',
        '_unlockOdysseyBoardAfterLaunchAttempt', 'setOdysseyNavigatorButtonVisible', '_restoreInputs',
        '_disposeOdysseyBoard'].forEach((name) => { mode[name] = vi.fn(); });
    return { mode, played };
}

describe('coming back out of an orb', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { settings: { effectQuality: 'High' }, matchMedia: () => ({ matches: false }) });
        vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('asks for the passage of the same visit seen from the other side', async () => {
        const { mode, played } = createMode();
        expect(await returnToOdysseyWorld(mode)).toBe(true);
        expect(mode._buildJourneyEntryPalette).toHaveBeenCalledWith(mode._buildJourneyEntryPalette.mock.calls[0][0], { returning: true });
        expect(mode._buildJourneyEntryPalette.mock.calls[0][0]).toMatchObject({ id: 14, chapter: 3 });
        // The look rides with the palette into the transition.
        expect(played[0].palette.look).toEqual({ kind: 'petals', seed: 7 });
    });

    it('lands the stars on the orb just cleared and lights the rail to the next, once', async () => {
        const { mode } = createMode({ cleared: 14 });
        await returnToOdysseyWorld(mode);
        const { nodeManager, pathRenderer } = mode.boardController;
        expect(nodeManager.landStars).toHaveBeenCalledWith(14);
        expect(nodeManager.pulseNode).toHaveBeenCalledWith(14, 760);
        expect(pathRenderer.playRipple).toHaveBeenCalledOnce();
        expect(pathRenderer.playRipple.mock.calls[0][0].from).toBeCloseTo(0.24);
        expect(pathRenderer.playRipple.mock.calls[0][0].to).toBeCloseTo(0.25);
        // Answered: the next return (a retry backed out of, say) lands nothing.
        expect(mode._orbJustCleared).toBeNull();
        nodeManager.landStars.mockClear();
        mode.currentLevelId = 14;
        mode.currentLevelConfig = { id: 14, chapter: 3 };
        await returnToOdysseyWorld(mode);
        expect(nodeManager.landStars).not.toHaveBeenCalled();
    });

    it('answers nothing for an orb left without a clear', async () => {
        const { mode } = createMode({ cleared: null });
        await returnToOdysseyWorld(mode);
        expect(mode.boardController.nodeManager.landStars).not.toHaveBeenCalled();
        expect(mode.boardController.pathRenderer.playRipple).not.toHaveBeenCalled();
    });

    it('leaves the rail to the ride when the journey goes on, and lights no rail toward a locked orb', async () => {
        const riding = createMode({ cleared: 14 });
        const operation = {};
        riding.mode._journeyFlowOperation = operation;
        await returnToOdysseyWorld(riding.mode, { preserveJourneyFlow: operation, scenicJourney: true, focusLevelId: 14 });
        expect(riding.mode.boardController.nodeManager.landStars).toHaveBeenCalledWith(14);
        expect(riding.mode.boardController.pathRenderer.playRipple).not.toHaveBeenCalled();

        const locked = createMode({ cleared: 14, nextUnlocked: false });
        await returnToOdysseyWorld(locked.mode);
        expect(locked.mode.boardController.nodeManager.landStars).toHaveBeenCalledWith(14);
        expect(locked.mode.boardController.pathRenderer.playRipple).not.toHaveBeenCalled();
    });

    it('moves nothing under reduced motion: the stars are simply there', async () => {
        const { mode, played } = createMode({ cleared: 14, reducedMotion: true });
        await returnToOdysseyWorld(mode);
        expect(played[0].reducedMotion).toBe(true);
        expect(mode.boardController.nodeManager.landStars).not.toHaveBeenCalled();
        expect(mode.boardController.pathRenderer.playRipple).not.toHaveBeenCalled();
        expect(mode._orbJustCleared).toBeNull();
    });
});
