/**
 * The moment an orb's goal is reached, as the player is shown it (owner's playtest, 2026-11-26:
 * orb 8 was won with the HUD on "4 / 6", no word that the goal was met, and the next piece still
 * falling for four seconds before the results). Three things must hold on every orb: the HUD
 * gets the goal's last reading before the attempt retires, the well says the goal is reached,
 * and the finished attempt stops.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { gameLoop } from '../../src/core/game.js';
import { OdysseyHUD } from '../../src/ui/odyssey/OdysseyHUD.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { completeOdysseyLevel } from '../../src/core/game-modes/odyssey-completion.js';
import { DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';
import {
    GOAL_FLOURISH_MS, clearOdysseyGoalFlourish, playOdysseyGoalFlourish, showOdysseyGoalReached,
} from '../../src/ui/odyssey/odyssey-goal-flourish.js';

function classes() {
    const values = new Set();
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        contains: (name) => values.has(name),
        toggle: (name, value) => (value ? values.add(name) : values.delete(name)),
        remove: (...names) => names.forEach((name) => values.delete(name)),
    };
}

function node() {
    const element = {
        children: [],
        parentElement: null,
        dataset: {},
        textContent: '',
        classList: classes(),
        style: { setProperty: vi.fn() },
        appendChild(child) {
            element.children.push(child);
            child.parentElement = element;
            return child;
        },
        remove() {
            const siblings = element.parentElement?.children;
            if (siblings) siblings.splice(siblings.indexOf(element), 1);
            element.parentElement = null;
        },
        getClientRects: () => [{}],
        getBoundingClientRect: () => ({}),
    };
    return element;
}

/** The HUD's goal section and stars for one orb, without a document. */
function hudFor(levelConfig) {
    const hud = Object.create(OdysseyHUD.prototype);
    hud.levelConfig = levelConfig;
    hud.metrics = {
        lines: 0, score: 0, cascades: 0, maxCascadeDepth: 0, quads: 0, combo: 0, bonuses: 0, deaths: 0, frags: 0,
    };
    hud.completedBonuses = new Set();
    hud.elapsedTime = 0;
    hud.timeLimit = null;
    hud.isVictoryLap = false;
    hud.isGoalReached = false;
    hud.awardedStars = null;
    hud.container = node();
    hud.goalLabel = node();
    hud.goalLabel.textContent = 'Goal';
    hud.progressValue = node();
    hud.progressBar = node();
    hud.progressBar.style = {};
    hud.progressTrack = {};
    hud.timeLabel = node();
    hud.timeDisplay = node();
    hud.starRows = Array.from({ length: 3 }, () => node());
    hud.starsDisplay = { querySelectorAll: () => hud.starRows };
    return hud;
}

/** The goal's counter one step short of its target: what a throttled HUD last showed. */
function oneShort(hud, { type, target }) {
    const short = type === 'score' ? target - 100 : target - 1;
    const key = {
        lines: 'lines',
        score: 'score',
        cascade: 'cascades',
        combo: 'combo',
        quads: 'quads',
        rubble: 'rubbleCleared',
        frags: 'frags',
    }[type];
    if (type === 'time') hud.elapsedTime = short * 1000 + 400;
    else hud.metrics[key] = short;
    return short;
}

const figures = (text) => text.split('/').map((part) => Number(part.replace(/[^0-9]/g, '')));
const litStars = (hud) => hud.starRows.filter((row) => row.classList.contains('earned')).length;

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('the HUD at a reached goal, on every orb', () => {
    it('covers the whole campaign and every goal type it uses', () => {
        expect(LEVEL_CONFIGS).toHaveLength(60);
        expect([...new Set(LEVEL_CONFIGS.map((level) => level.victory.primary.type))].sort())
            .toEqual(['cascade', 'combo', 'frags', 'lines', 'quads', 'rubble', 'score', 'time']);
    });

    it.each(LEVEL_CONFIGS.map((level) => [level.id, level.victory.primary.type, level]))(
        'orb %i (%s): the count stands at its goal with a full bar, the label says so, the awarded stars are lit',
        (_id, _type, level) => {
            const hud = hudFor(level);
            const { primary } = level.victory;
            const short = oneShort(hud, primary);
            hud._updateProgress();
            expect(figures(hud.progressValue.textContent)).toEqual([short, primary.target]);
            expect(hud.progressBar.classList.contains('is-complete')).toBe(false);

            hud.markGoalReached({ stars: 2 });
            expect(figures(hud.progressValue.textContent)).toEqual([primary.target, primary.target]);
            expect(hud.progressBar.style.width).toBe('100%');
            expect(hud.progressBar.classList.contains('is-complete')).toBe(true);
            expect(hud.progressTrack.ariaValueNow).toBe(String(primary.target));
            expect(hud.goalLabel.textContent).toBe('Goal reached');
            expect(hud.container.classList.contains('is-goal-reached')).toBe(true);
            expect(litStars(hud)).toBe(2);

            // Nothing written afterwards can take the reading or the awarded stars back.
            hud.updateTime(3600 * 1000);
            hud.updateMetrics({ lines: 0, score: 0 });
            expect(figures(hud.progressValue.textContent)[0]).toBeGreaterThanOrEqual(primary.target);
            expect(litStars(hud)).toBe(2);
        },
    );

    it('shows a count that passed its goal as it is', () => {
        const hud = hudFor(LEVEL_CONFIGS.find((level) => level.victory.primary.type === 'score'));
        const { target } = hud.levelConfig.victory.primary;
        hud.metrics.score = target + 1250;
        hud.markGoalReached({ stars: 3 });
        expect(figures(hud.progressValue.textContent)).toEqual([target + 1250, target]);
        expect(litStars(hud)).toBe(3);
    });

    it('a showcase lap keeps "Complete" and takes the label and the stars', () => {
        const hud = hudFor(LEVEL_CONFIGS.find((level) => level.victoryLapPolicy === 'showcase'));
        hud.isVictoryLap = true;
        hud.progressValue.textContent = 'Complete';
        hud.markGoalReached({ stars: 1 });
        expect(hud.progressValue.textContent).toBe('Complete');
        expect(hud.goalLabel.textContent).toBe('Goal reached');
        expect(litStars(hud)).toBe(1);
    });

    it('a new attempt starts with the goal open again', () => {
        const hud = hudFor(LEVEL_CONFIGS[7]);
        hud.metrics.rubbleCleared = 6;
        hud.markGoalReached({ stars: 3 });
        hud.resetMetrics();
        expect(hud.isGoalReached).toBe(false);
        expect(hud.awardedStars).toBeNull();
        expect(hud.goalLabel.textContent).toBe('Goal');
        expect(hud.container.classList.contains('is-goal-reached')).toBe(false);
        expect(figures(hud.progressValue.textContent)).toEqual([0, 6]);
        expect(litStars(hud)).toBe(0);
    });
});

describe('the goal\'s last reading before the attempt retires', () => {
    function attempt({ duel = null } = {}) {
        const order = [];
        const hud = {
            updateDuel: vi.fn(() => order.push('duel')),
            updateTime: vi.fn(() => order.push('time')),
            markGoalReached: vi.fn(() => order.push('reached')),
        };
        const session = {
            duel,
            gameState: { score: 4200, currentPiece: { shapeKey: 'T' } },
            hybridEngine: {
                updateScore: vi.fn(() => order.push('score')),
                getMetrics: () => ({ time: 28.42 }),
                calculateStars: () => 2,
            },
        };
        const mode = { odysseyHUD: hud, _updateOdysseyHUD: vi.fn(() => order.push('metrics')) };
        return {
            mode, session, hud, order,
        };
    }

    it('writes the rules\' own figures, time and stars to the HUD, and the next piece leaves the well', () => {
        const {
            mode, session, hud, order,
        } = attempt();
        showOdysseyGoalReached(mode, session);
        expect(order).toEqual(['score', 'metrics', 'time', 'reached']);
        expect(session.hybridEngine.updateScore).toHaveBeenCalledWith(4200);
        expect(hud.updateTime).toHaveBeenCalledWith(28420);
        expect(hud.markGoalReached).toHaveBeenCalledWith({ stars: 2 });
        expect(session.gameState.currentPiece).toBeNull();
    });

    it('a duel gets its last scoreboard and keeps its wells as the knockout left them', () => {
        const snapshot = { playerFrags: 3 };
        const {
            mode, session, hud, order,
        } = attempt({ duel: { score: 900, getSnapshot: () => snapshot } });
        showOdysseyGoalReached(mode, session);
        expect(order).toEqual(['score', 'metrics', 'duel', 'time', 'reached']);
        expect(session.hybridEngine.updateScore).toHaveBeenCalledWith(900);
        expect(hud.updateDuel).toHaveBeenCalledWith(snapshot);
        expect(session.gameState.currentPiece).toEqual({ shapeKey: 'T' });
    });

    it('still clears the piece when no HUD is up, and ignores a missing attempt', () => {
        const { session } = attempt();
        showOdysseyGoalReached({ odysseyHUD: null }, session);
        expect(session.gameState.currentPiece).toBeNull();
        expect(() => showOdysseyGoalReached({}, null)).not.toThrow();
    });

    function completion(showGoalReached) {
        const order = [];
        const session = {
            levelId: 8,
            retirementGeneration: 4,
            simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
            levelConfig: { id: 8, chapter: 2, theme: { primary: 'koi-pond' } },
            gameState: { score: 900 },
            hybridEngine: {
                updateScore: vi.fn(), updateTime: vi.fn(() => order.push('clock')), getMetrics: () => ({ time: 20 }),
            },
        };
        const mode = {
            levelStartTime: 1,
            _elapsedLevelMs: () => 20000,
            levelRegistry: { getAllLevels: () => [{ id: 8 }], getAllChapters: () => [] },
            odysseyState: {
                completeLevel: vi.fn(() => { order.push('save'); return { persisted: true }; }),
                isLevelCompleted: () => false,
                getLevelStars: () => 0,
            },
            _activeLevelSession: session,
            _isLevelSessionActive: (owner) => owner === session,
            _isLevelSessionCurrent: (owner) => owner === session,
            _showGoalReached: showGoalReached && ((owner) => { order.push('goal reading'); return showGoalReached(owner); }),
            _retireLevelSession: () => { order.push('retire'); return { retirementGeneration: 4 }; },
            _drainLevelSession: vi.fn(async () => { order.push('drain'); }),
            _calculateStars: () => 2,
            _evaluateBonuses: () => [],
            _syncSteamStats: vi.fn().mockResolvedValue(),
            _celebrateGoalReached: vi.fn(() => Promise.resolve(undefined)),
            _showLevelResults: vi.fn(async () => { order.push('results'); return 'map'; }),
            _getJourneyFlowDestination: () => null,
            returnToBoard: vi.fn().mockResolvedValue(),
            deps: {},
        };
        return { mode, order, session };
    }

    it('goes out after the final clock and before the attempt retires', async () => {
        const { mode, order, session } = completion(vi.fn());
        await completeOdysseyLevel(mode, {});
        expect(order).toEqual(['clock', 'goal reading', 'retire', 'drain', 'save', 'results']);
        expect(mode._showGoalReached).toBeDefined();
        expect(session.hybridEngine.updateTime).toHaveBeenCalledWith(20);
    });

    it('can never block the save or the results', async () => {
        const { mode, order } = completion(() => { throw new Error('cosmetic failure'); });
        await completeOdysseyLevel(mode, {});
        expect(order).toEqual(['clock', 'goal reading', 'retire', 'drain', 'save', 'results']);
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('the well says the goal is reached', () => {
    let border;
    let well;
    beforeEach(() => {
        vi.useFakeTimers();
        border = node();
        border.id = 'single-player-border';
        well = node();
        border.parentElement = well;
        vi.stubGlobal('document', {
            hidden: false,
            getElementById: (id) => (id === border.id ? border : null),
            createElement: () => node(),
        });
    });
    const mode = (goal = 'Dig out 6 rubble rows') => ({
        deps: { soundManager: { sfxPlayer: { playLevelUp: vi.fn(), playPerfectClear: vi.fn() } } },
        odysseyHUD: { objectiveDisplay: { textContent: goal } },
    });
    const session = () => ({
        levelId: 8, levelConfig: { id: 8, chapter: 2, theme: { primary: 'koi-pond' } }, gameState: {},
    });
    const words = () => well.children.filter((child) => child.className === 'odyssey-goal-word');

    it('in words, over the goal itself, as a status, for as long as the flare', async () => {
        playOdysseyGoalFlourish(mode(), session());
        expect(words()).toHaveLength(1);
        const [word] = words();
        expect(word.role).toBe('status');
        expect(word.children.map((line) => [line.className, line.textContent])).toEqual([
            ['odyssey-goal-word__title', 'Goal reached'],
            ['odyssey-goal-word__goal', 'Dig out 6 rubble rows'],
        ]);
        await vi.advanceTimersByTimeAsync(GOAL_FLOURISH_MS);
        expect(words()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(words()).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves with the attempt, and a second goal never stacks a second word', () => {
        playOdysseyGoalFlourish(mode(), session());
        playOdysseyGoalFlourish(mode('Clear 20 lines'), session());
        expect(words()).toHaveLength(1);
        expect(words()[0].children[1].textContent).toBe('Clear 20 lines');
        clearOdysseyGoalFlourish();
        expect(words()).toHaveLength(0);
    });

    it('stands alone when the HUD has no goal line to quote', () => {
        playOdysseyGoalFlourish({ deps: {} }, session());
        expect(words()[0].children.map((line) => line.textContent)).toEqual(['Goal reached']);
        clearOdysseyGoalFlourish();
    });
});

describe('a finished attempt stops', () => {
    const running = () => ({
        isGameOver: false, isPaused: false, forceDraw: false, lastTime: 0, currentPiece: null,
    });

    it('the loop does not schedule another frame once its own callbacks stopped the game', () => {
        vi.stubGlobal('window', {});
        const requestAnimationFrame = vi.fn(() => 7);
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
        const gameState = running();
        // An orb's victory check retires the attempt from inside the frame: no frame was pending to cancel.
        gameLoop(0, gameState, null, () => { gameState.isStopped = true; gameState.animationId = null; }, null, {});
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(gameState.animationId).toBeNull();
    });

    it('a game that is still running keeps its loop', () => {
        vi.stubGlobal('window', {});
        const requestAnimationFrame = vi.fn(() => 7);
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
        const gameState = running();
        gameLoop(0, gameState, null, vi.fn(), null, {});
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(gameState.animationId).toBe(7);
    });
});
