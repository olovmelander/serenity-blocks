import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import {
    GOAL_FLOURISH_MS, clearOdysseyGoalFlourish, playOdysseyGoalFlourish,
} from '../../src/ui/odyssey/odyssey-goal-flourish.js';
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
    const offs = [];
    beforeEach(() => {
        vi.useFakeTimers();
        border = element('single-player-border');
        well = element();
        border.parentElement = well;
        vi.stubGlobal('document', { hidden: false, getElementById: (id) => (id === border.id ? border : null) });
        lineClears = [];
        combos = [];
        offs.push(eventBus.on(EVENTS.LINE_CLEAR, (payload) => lineClears.push(payload)));
        offs.push(eventBus.on(EVENTS.COMBO, (payload) => combos.push(payload)));
    });
    afterEach(() => {
        offs.splice(0).forEach((off) => off?.());
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    const mode = () => ({ deps: { soundManager: { sfxPlayer: { playLevelUp: vi.fn() } } } });
    const session = (overrides = {}) => ({
        levelId: 7, levelConfig: { id: 7, chapter: 2 }, gameState: {}, ...overrides,
    });

    it('lets the theme, the well and the chime answer the goal, then gets out of the way', async () => {
        const owner = mode();
        const done = vi.fn();
        playOdysseyGoalFlourish(owner, session()).then(done);
        expect(lineClears).toEqual([expect.objectContaining({ lineCount: 4, source: 'odyssey-goal', levelId: 7 })]);
        expect(combos).toEqual([expect.objectContaining({ comboCount: 6, source: 'odyssey-goal' })]);
        expect(owner.deps.soundManager.sfxPlayer.playLevelUp).toHaveBeenCalledOnce();
        expect(border.classList.contains('odyssey-goal-flare')).toBe(true);
        expect(well.classList.contains('odyssey-goal-sweep')).toBe(true);
        expect(well.style.setProperty).toHaveBeenCalledWith('--odyssey-goal-color', '#8cd3ed');
        await vi.advanceTimersByTimeAsync(GOAL_FLOURISH_MS - 1);
        expect(done).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toHaveBeenCalledOnce();
        // The flare retires itself so a stage shown again later can never replay it.
        await vi.advanceTimersByTimeAsync(1000);
        expect(border.classList.contains('odyssey-goal-flare')).toBe(false);
        expect(well.classList.contains('odyssey-goal-sweep')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps reduced motion short and still', async () => {
        const done = vi.fn();
        playOdysseyGoalFlourish(mode(), session(), { reducedMotion: true }).then(done);
        expect(well.dataset.goalReducedMotion).toBe('true');
        await vi.advanceTimersByTimeAsync(280);
        expect(done).toHaveBeenCalledOnce();
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
        expect(lineClears).toHaveLength(1);
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

    it('saves beneath the flourish and only then shows the ceremony', async () => {
        let finish;
        const celebrate = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const { mode, order } = completionMode(celebrate);
        const completing = completeOdysseyLevel(mode, {});
        await Promise.resolve();
        await Promise.resolve();
        expect(celebrate).toHaveBeenCalledOnce();
        expect(order).toEqual(['drain', 'save']);
        expect(mode._showLevelResults).not.toHaveBeenCalled();
        finish();
        await completing;
        expect(order).toEqual(['drain', 'save', 'results']);
    });

    it('never lets a failing flourish block or skip the save', async () => {
        const { mode, order } = completionMode(() => { throw new Error('cosmetic failure'); });
        await completeOdysseyLevel(mode, {});
        expect(order).toEqual(['drain', 'save', 'results']);
    });
});
