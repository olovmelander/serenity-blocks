import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { completeOdysseyLevel } from '../../src/core/game-modes/odyssey-completion.js';
import { DEMO_FIXED_SIMULATION_CLOCK, DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';

function fixture({ persisted = true, clock = DEMO_LEGACY_SIMULATION_CLOCK } = {}) {
    const receipt = {
        persisted: true, themeIds: ['cinder-drift'], totalOwned: 2, totalThemes: 69, sourceLevelId: 1,
    };
    const session = {
        levelId: 1,
        levelConfig: { id: 1, theme: { primary: 'cinder-drift', pathIcon: 'pyrestorm' } },
        retirementGeneration: 4,
        simulationClock: clock,
        gameState: { score: 2000 },
        hybridEngine: { updateScore: vi.fn(), getMetrics: () => ({ time: 40, lines: 20 }) },
    };
    const mode = {
        deps: { themeCollection: { awardCompletion: vi.fn(() => receipt) } },
        levelRegistry: { getAllLevels: () => [], getAllChapters: () => [] },
        odysseyState: { completeLevel: vi.fn(() => ({ stars: 1, persisted })) },
        _activeLevelSession: session,
        _isLevelSessionActive: (candidate) => candidate === mode._activeLevelSession,
        _isLevelSessionCurrent: (candidate) => candidate === mode._activeLevelSession,
        _retireLevelSession: () => ({ retirementGeneration: 4 }),
        _drainLevelSession: vi.fn().mockResolvedValue(),
        _calculateStars: () => 1,
        _evaluateBonuses: () => [],
        _syncSteamStats: vi.fn().mockResolvedValue(),
        _showLevelResults: vi.fn().mockResolvedValue('map'),
        _getJourneyFlowDestination: () => null,
        returnToBoard: vi.fn().mockResolvedValue(),
    };
    return {
        mode, session, receipt, collection: mode.deps.themeCollection,
    };
}

describe('Odyssey theme award boundary', () => {
    afterEach(() => vi.restoreAllMocks());

    it('persists the authored completed theme before passing the same receipt to results', async () => {
        const {
            mode, session, receipt, collection,
        } = fixture();
        await completeOdysseyLevel(mode, {});
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ stars: 1 }),
            { themeId: 'cinder-drift' },
        );
        expect(collection.awardCompletion).toHaveBeenCalledExactlyOnceWith({
            levelId: 1,
            themeId: 'cinder-drift',
            odysseyState: mode.odysseyState,
            progressPersisted: true,
        });
        expect(mode.odysseyState.completeLevel.mock.invocationCallOrder[0])
            .toBeLessThan(collection.awardCompletion.mock.invocationCallOrder[0]);
        expect(collection.awardCompletion.mock.invocationCallOrder[0])
            .toBeLessThan(mode._showLevelResults.mock.invocationCallOrder[0]);
        expect(mode._showLevelResults.mock.calls[0][0].themeUnlock).toBe(receipt);
        expect(mode._showLevelResults.mock.calls[0][1]).toBe(session);
        await completeOdysseyLevel(mode, {});
        expect(collection.awardCompletion).toHaveBeenCalledOnce();
    });

    it.each([
        { clock: DEMO_FIXED_SIMULATION_CLOCK },
        { clock: 'future-clock' },
    ])('does not grant or announce a reward for ineligible persistence: %j', async (options) => {
        const { mode, collection } = fixture(options);
        await completeOdysseyLevel(mode, {});
        expect(collection.awardCompletion).not.toHaveBeenCalled();
        expect(mode._showLevelResults.mock.calls[0][0].themeUnlock).toBeUndefined();
    });

    it('shows an honest progress-save notice without awarding anything when the orb save fails', async () => {
        const { mode, collection } = fixture({ persisted: false });
        await completeOdysseyLevel(mode, {});
        expect(collection.awardCompletion).not.toHaveBeenCalled();
        expect(mode._showLevelResults.mock.calls[0][0].themeUnlock).toEqual({
            persisted: false, failure: 'progress',
        });
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('keeps older callers without a persistence result free of fabricated save warnings', async () => {
        const { mode, collection } = fixture();
        mode.odysseyState.completeLevel.mockReturnValue({ stars: 1 });
        await completeOdysseyLevel(mode, {});
        expect(collection.awardCompletion).not.toHaveBeenCalled();
        expect(mode._showLevelResults.mock.calls[0][0].themeUnlock).toBeUndefined();
    });

    it('rejects an attempt replaced while its physics was draining', async () => {
        const { mode, collection } = fixture();
        mode._drainLevelSession.mockImplementation(async () => { mode._activeLevelSession = {}; });
        await completeOdysseyLevel(mode, {});
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
        expect(collection.awardCompletion).not.toHaveBeenCalled();
        expect(mode._showLevelResults).not.toHaveBeenCalled();
    });

    it.each([
        { persisted: true, themeIds: [] },
        { persisted: false, themeIds: ['cinder-drift'] },
    ])('does not celebrate an already-owned or unpersisted collection receipt: %j', async (receipt) => {
        const { mode, collection } = fixture();
        collection.awardCompletion.mockReturnValue(receipt);
        await completeOdysseyLevel(mode, {});
        expect(mode._showLevelResults.mock.calls[0][0].themeUnlock).toEqual(receipt.persisted === false
            ? { persisted: false, failure: 'collection' } : undefined);
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('preserves saved completion and navigation when collection persistence throws', async () => {
        const { mode, collection } = fixture();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        collection.awardCompletion.mockImplementation(() => { throw new Error('storage unavailable'); });
        await completeOdysseyLevel(mode, {});
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledOnce();
        expect(mode._showLevelResults.mock.calls[0][0].themeUnlock).toEqual({
            persisted: false, failure: 'collection',
        });
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
    });

    it('awards a duel completion through the same saved outcome boundary', async () => {
        const { mode, session, collection } = fixture();
        session.duel = { score: 3000, getResult: () => ({ playerFrags: 7, botFrags: 3 }) };
        await completeOdysseyLevel(mode, {});
        expect(collection.awardCompletion).toHaveBeenCalledOnce();
        expect(mode._showLevelResults.mock.calls[0][0]).toMatchObject({
            score: 3000,
            duel: { playerFrags: 7, botFrags: 3 },
            themeUnlock: { themeIds: ['cinder-drift'] },
        });
    });
});
