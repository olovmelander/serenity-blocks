import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import {
    GOAL_FLOURISH_MS, clearOdysseyGoalFlourish, playOdysseyGoalFlourish,
} from '../../src/ui/odyssey/odyssey-goal-flourish.js';
import {
    DEFAULT_ODYSSEY_SHOWPIECE, SHOWPIECE_SETTLE_MS, buildOdysseyShowpiece, odysseyShowpieceDuration,
} from '../../src/ui/odyssey/odyssey-showpiece.js';
import { completeOdysseyLevel } from '../../src/core/game-modes/odyssey-completion.js';
import { DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';

function element(id = '') {
    const classes = new Set();
    return {
        id,
        dataset: {},
        parentElement: null,
        style: { setProperty: vi.fn() },
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        getClientRects: () => [{}],
        getBoundingClientRect: () => ({}),
    };
}

describe('Odyssey goal flourish', () => {
    let border;
    let well;
    let lineClears;
    let combos;
    let perfectClears;
    const offs = [];
    beforeEach(() => {
        vi.useFakeTimers();
        border = element('single-player-border');
        well = element();
        border.parentElement = well;
        vi.stubGlobal('document', { hidden: false, getElementById: (id) => (id === border.id ? border : null) });
        lineClears = [];
        combos = [];
        perfectClears = [];
        offs.push(eventBus.on(EVENTS.LINE_CLEAR, (payload) => lineClears.push(payload)));
        offs.push(eventBus.on(EVENTS.COMBO, (payload) => combos.push(payload)));
        offs.push(eventBus.on(EVENTS.PERFECT_CLEAR, (payload) => perfectClears.push(payload)));
    });
    afterEach(() => {
        offs.splice(0).forEach((off) => off?.());
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    const mode = () => ({
        deps: { soundManager: { sfxPlayer: { playLevelUp: vi.fn(), playPerfectClear: vi.fn() } } },
    });
    const session = (overrides = {}) => ({
        levelId: 7,
        levelConfig: { id: 7, chapter: 2, theme: { primary: 'crystal-cave' } },
        gameState: {},
        ...overrides,
    });

    it('builds the theme reel from the catalogue: a quad, a cascade, then the board emptying', () => {
        const reel = buildOdysseyShowpiece({ themeId: 'crystal-cave', levelId: 7 });
        expect(DEFAULT_ODYSSEY_SHOWPIECE).toEqual(['quad', 'cascade-6', 'perfect-clear']);
        expect(reel[0]).toMatchObject({ at: 0, type: 'pieceLock' });
        expect(reel[1]).toMatchObject({
            at: 0, type: 'lineClear', payload: { lineCount: 4, source: 'odyssey-goal', levelId: 7 },
        });
        const depths = reel.filter((step) => step.type === 'combo').map((step) => step.payload.comboCount);
        expect(depths).toEqual([2, 3, 4, 5, 6]);
        const last = reel[reel.length - 1];
        expect(last.type).toBe('perfectClear');
        expect(last.payload).toMatchObject({ depth: 4, source: 'odyssey-goal', levelId: 7 });
        expect(reel.every((step, index) => index === 0 || step.at >= reel[index - 1].at)).toBe(true);
        // Physics pacing compressed to a celebration: over a second, well under two.
        expect(last.at).toBeGreaterThan(1000);
        expect(last.at).toBeLessThan(1700);
        expect(odysseyShowpieceDuration(reel)).toBe(last.at + SHOWPIECE_SETTLE_MS);
        expect(GOAL_FLOURISH_MS).toBe(odysseyShowpieceDuration(buildOdysseyShowpiece()));
        // Reduced motion: one still moment.
        expect(buildOdysseyShowpiece({ reducedMotion: true, levelId: 3 })).toEqual([{
            at: 0,
            type: 'perfectClear',
            payload: expect.objectContaining({ depth: 4, source: 'odyssey-goal', levelId: 3 }),
        }]);
    });

    it('plays the reel on the well with the chimes and the flare, then hands over to the ceremony', async () => {
        const owner = mode();
        const done = vi.fn();
        playOdysseyGoalFlourish(owner, session()).then(done);
        expect(lineClears).toEqual([expect.objectContaining({ lineCount: 4, source: 'odyssey-goal', levelId: 7 })]);
        expect(combos).toEqual([]);
        expect(owner.deps.soundManager.sfxPlayer.playLevelUp).toHaveBeenCalledOnce();
        expect(border.classList.contains('odyssey-goal-flare')).toBe(true);
        expect(well.classList.contains('odyssey-goal-sweep')).toBe(true);
        expect(well.style.setProperty).toHaveBeenCalledWith('--odyssey-goal-color', '#8cd3ed');
        await vi.advanceTimersByTimeAsync(GOAL_FLOURISH_MS - 1);
        expect(combos.map((payload) => payload.comboCount)).toEqual([2, 3, 4, 5, 6]);
        expect(perfectClears).toEqual([expect.objectContaining({ depth: 4, source: 'odyssey-goal', levelId: 7 })]);
        expect(owner.deps.soundManager.sfxPlayer.playPerfectClear).toHaveBeenCalledOnce();
        expect(lineClears.length).toBeGreaterThan(6);
        expect(done).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toHaveBeenCalledExactlyOnceWith(true);
        // The flare retires itself so a stage shown again later can never replay it.
        await vi.advanceTimersByTimeAsync(1000);
        expect(border.classList.contains('odyssey-goal-flare')).toBe(false);
        expect(well.classList.contains('odyssey-goal-sweep')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps reduced motion short and still: one perfect clear, no reel', async () => {
        const done = vi.fn();
        playOdysseyGoalFlourish(mode(), session(), { reducedMotion: true }).then(done);
        expect(well.dataset.goalReducedMotion).toBe('true');
        expect(perfectClears).toHaveLength(1);
        expect(lineClears).toEqual([]);
        await vi.advanceTimersByTimeAsync(280);
        expect(done).toHaveBeenCalledExactlyOnceWith(true);
        clearOdysseyGoalFlourish();
        expect(border.classList.contains('odyssey-goal-flare')).toBe(false);
    });

    it.each([
        ['an already celebrated showcase lap', () => session({ gameState: { victoryLapStartTime: 1 } })],
        ['a hidden page', () => { document.hidden = true; return session(); }],
    ])('does not replay or wait for %s', async (_label, build) => {
        await expect(playOdysseyGoalFlourish(mode(), build())).resolves.toBeUndefined();
        expect(lineClears).toEqual([]);
        expect(border.classList.contains('odyssey-goal-flare')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('celebrates through the theme without waiting when no well is rendered', async () => {
        border.getClientRects = () => [];
        await expect(playOdysseyGoalFlourish(mode(), session())).resolves.toBeUndefined();
        // Only the reel's opening events: the quad lands, nothing is scheduled.
        expect(lineClears).toHaveLength(1);
        expect(combos).toEqual([]);
        expect(border.classList.contains('odyssey-goal-flare')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('Odyssey completion and its flourish', () => {
    function completionMode(celebrate) {
        const order = [];
        const session = {
            levelId: 2,
            retirementGeneration: 4,
            simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
            levelConfig: { id: 2, chapter: 1, theme: { primary: 'crystal-cave' } },
            gameState: { score: 900 },
            hybridEngine: { updateScore: vi.fn(), getMetrics: () => ({ time: 20 }) },
        };
        const mode = {
            levelRegistry: { getAllLevels: () => [{ id: 2 }], getAllChapters: () => [] },
            odysseyState: {
                completeLevel: vi.fn(() => { order.push('save'); return { persisted: true }; }),
                isLevelCompleted: () => false,
                getLevelStars: () => 0,
            },
            _activeLevelSession: session,
            _isLevelSessionActive: (owner) => owner === session,
            _isLevelSessionCurrent: (owner) => owner === session,
            _retireLevelSession: () => ({ retirementGeneration: 4 }),
            _drainLevelSession: vi.fn(async () => { order.push('drain'); }),
            _calculateStars: () => 2,
            _evaluateBonuses: () => [],
            _syncSteamStats: vi.fn().mockResolvedValue(),
            _celebrateGoalReached: celebrate,
            _showLevelResults: vi.fn(async () => { order.push('results'); return 'map'; }),
            _getJourneyFlowDestination: () => null,
            returnToBoard: vi.fn().mockResolvedValue(),
            deps: {},
        };
        return { mode, order };
    }

    it('saves beneath the flourish and only then shows the ceremony, through the afterglow it earned', async () => {
        let finish;
        const celebrate = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const { mode, order } = completionMode(celebrate);
        const completing = completeOdysseyLevel(mode, {});
        await Promise.resolve();
        await Promise.resolve();
        expect(celebrate).toHaveBeenCalledOnce();
        expect(order).toEqual(['drain', 'save']);
        expect(mode._showLevelResults).not.toHaveBeenCalled();
        finish(true);
        await completing;
        expect(order).toEqual(['drain', 'save', 'results']);
        expect(mode._showLevelResults)
            .toHaveBeenCalledWith(expect.objectContaining({ showpiece: true }), expect.anything());
    });

    it('keeps the ceremony’s direct entrance when the well could not play the reel', async () => {
        const { mode } = completionMode(vi.fn(() => Promise.resolve(undefined)));
        await completeOdysseyLevel(mode, {});
        expect(mode._showLevelResults.mock.calls[0][0].showpiece).toBeUndefined();
    });

    it('never lets a failing flourish block or skip the save', async () => {
        const { mode, order } = completionMode(() => { throw new Error('cosmetic failure'); });
        await completeOdysseyLevel(mode, {});
        expect(order).toEqual(['drain', 'save', 'results']);
    });
});
