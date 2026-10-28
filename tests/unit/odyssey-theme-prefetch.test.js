/**
 * The map's theme warm-ups (perf audit 2026-10-28). The picked orb's theme is warmed so Play
 * enters a loaded theme; a guess at the next one (the hovered orb, the picked orb's neighbours)
 * used to take the cache's one free room from it, and to start in the middle of a glide, a scroll
 * or the return's reveal. A guess now waits for a quiet map, never overlaps another theme load,
 * and never pushes out a theme still wanted.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    OdysseyThemeWarmups, clearOdysseyThemePrefetch, prefetchOdysseyLevelThemes, warmOdysseyHoveredLevelTheme,
} from '../../src/ui/odyssey/odyssey-theme-prefetch.js';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';

const LEVELS = [
    { id: 1, chapter: 1, theme: { primary: 'aurora' } },
    { id: 2, chapter: 1, theme: { primary: 'dunes' } },
    { id: 3, chapter: 1, theme: { primary: 'reef' } },
    { id: 4, chapter: 1, theme: { primary: 'ember' } },
];

/** ThemeManager's cache as far as eviction goes (ensureThemeCacheCapacity: least recently used, never the active one). */
function createThemeManager({ cap = 2, active = 'forest', cached = [] } = {}) {
    const manager = {
        maxCachedThemes: cap,
        themeInstances: new Map(),
        themeLRU: [],
        activeTheme: null,
        pendingThemeInstance: null,
        inFlightThemeLoads: new Map(),
    };
    const add = (name) => {
        const instance = { name };
        manager.themeInstances.set(name, instance);
        manager.themeLRU = manager.themeLRU.filter((n) => n !== name).concat(name);
        return instance;
    };
    manager.store = (name) => {
        while (manager.themeInstances.size >= manager.maxCachedThemes) {
            const victim = manager.themeLRU.find((n) => manager.themeInstances.get(n) !== manager.activeTheme);
            manager.themeInstances.delete(victim);
            manager.themeLRU = manager.themeLRU.filter((n) => n !== victim);
        }
        add(name);
    };
    cached.forEach(add);
    if (active) manager.activeTheme = add(active);
    return manager;
}

/** The transition manager's prefetch, with loads that land when the test says. */
function createTransitions(manager) {
    const loads = [];
    const transitions = {
        themeManager: manager,
        prefetchRecords: new Map(),
        prefetchLevelTheme: vi.fn((level) => {
            const name = level.theme.primary;
            if (manager.themeInstances.has(name)) return Promise.resolve(true);
            const existing = loads.find((load) => load.name === name);
            if (existing) return existing.promise;
            let finish;
            const promise = new Promise((resolve) => { finish = resolve; });
            transitions.prefetchRecords.set(name, {});
            manager.inFlightThemeLoads.set(name, promise);
            loads.push({
                name,
                promise,
                land: () => {
                    manager.store(name);
                    transitions.prefetchRecords.delete(name);
                    manager.inFlightThemeLoads.delete(name);
                    loads.splice(loads.findIndex((load) => load.name === name), 1);
                    finish(true);
                },
            });
            return promise;
        }),
    };
    return { transitions, loads };
}

function createMode({ manager = createThemeManager(), selectedLevelId = null } = {}) {
    const { transitions, loads } = createTransitions(manager);
    const board = {
        hoveredLevelId: null,
        quiet: true,
        isQuietForSpeculativeWork() { return this.quiet; },
    };
    const byId = new Map(LEVELS.map((level) => [level.id, level]));
    const mode = {
        isActive: true,
        isInBoardView: true,
        isEnteringLevel: false,
        selectedLevelId,
        _boardReturnOperation: null,
        boardController: board,
        transitionManager: transitions,
        levelRegistry: {
            resolveLevelPresentation: (level) => (typeof level === 'object' ? level : byId.get(level)) ?? null,
            getLevelsInChapter: (chapter) => LEVELS.filter((level) => level.chapter === chapter),
        },
        currentThemePrefetchLevelId: null,
        currentThemePrefetchPromise: null,
        levelThemePrefetchTimer: null,
    };
    mode._themeWarmups = new OdysseyThemeWarmups(mode, { idle: (run) => setTimeout(run, 0) });
    return {
        mode, board, manager, transitions, loads,
    };
}

const warmedNames = (transitions) => transitions.prefetchLevelTheme.mock.calls.map(([level]) => level.theme.primary);

function hover(mode, board, levelId) {
    board.hoveredLevelId = levelId;
    return warmOdysseyHoveredLevelTheme(mode, levelId);
}

describe('Odyssey map theme warm-ups', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('warms a hovered orb once the cursor rests on it, started at once into room the cache has', async () => {
        const {
            mode, board, transitions, loads, manager,
        } = createMode();
        const warmed = hover(mode, board, 3);
        await vi.advanceTimersByTimeAsync(100);
        expect(transitions.prefetchLevelTheme).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(500);
        expect(transitions.prefetchLevelTheme).toHaveBeenCalledWith(LEVELS[2], { priority: 'high' });
        loads[0].land();
        await expect(warmed).resolves.toBe(true);
        expect([...manager.themeInstances.keys()]).toEqual(['forest', 'reef']);
    });

    it('lets the orbs the cursor only crosses go', async () => {
        const { mode, board, transitions } = createMode();
        const crossed = hover(mode, board, 2);
        await vi.advanceTimersByTimeAsync(100);
        hover(mode, board, 3);
        await vi.advanceTimersByTimeAsync(1000);
        await expect(crossed).resolves.toBe(false);
        expect(warmedNames(transitions)).toEqual(['reef']);
    });

    it('waits out a glide or scroll and a return, and gives up after a while', async () => {
        const { mode, board, transitions } = createMode();
        board.quiet = false;
        hover(mode, board, 3);
        await vi.advanceTimersByTimeAsync(2000);
        expect(transitions.prefetchLevelTheme).not.toHaveBeenCalled();
        board.quiet = true;
        mode._boardReturnOperation = {};
        await vi.advanceTimersByTimeAsync(1000);
        expect(transitions.prefetchLevelTheme).not.toHaveBeenCalled();
        mode._boardReturnOperation = null;
        await vi.advanceTimersByTimeAsync(500);
        expect(warmedNames(transitions)).toEqual(['reef']);

        const late = createMode();
        late.board.quiet = false;
        const dropped = hover(late.mode, late.board, 3);
        await vi.advanceTimersByTimeAsync(6500);
        await expect(dropped).resolves.toBe(false);
        late.board.quiet = true;
        await vi.advanceTimersByTimeAsync(1000);
        expect(late.transitions.prefetchLevelTheme).not.toHaveBeenCalled();
    });

    it('never pushes out the picked orb\'s theme', async () => {
        const { mode, board, transitions } = createMode({
            manager: createThemeManager({ cached: ['dunes'] }),
            selectedLevelId: 2,
        });
        const warmed = hover(mode, board, 3);
        await vi.advanceTimersByTimeAsync(1000);
        await expect(warmed).resolves.toBe(false);
        expect(transitions.prefetchLevelTheme).not.toHaveBeenCalled();
    });

    it('may push out a theme nobody wants', async () => {
        const {
            mode, board, loads, manager,
        } = createMode({ manager: createThemeManager({ cached: ['nimbus'] }) });
        const warmed = hover(mode, board, 3);
        await vi.advanceTimersByTimeAsync(600);
        loads[0].land();
        await expect(warmed).resolves.toBe(true);
        expect([...manager.themeInstances.keys()]).toEqual(['forest', 'reef']);
    });

    it('never starts while another theme load is in flight or scheduled', async () => {
        const {
            mode, board, transitions, loads,
        } = createMode({ manager: createThemeManager({ cap: 3 }), selectedLevelId: 2 });
        transitions.prefetchLevelTheme(LEVELS[1]); // the picked orb's own warm-up, still loading
        hover(mode, board, 3);
        await vi.advanceTimersByTimeAsync(2000);
        expect(warmedNames(transitions)).toEqual(['dunes']);
        loads[0].land();
        await vi.advanceTimersByTimeAsync(500);
        expect(warmedNames(transitions)).toEqual(['dunes', 'reef']);
    });

    it('warms the picked orb\'s next neighbour, and the previous one does not push it out', async () => {
        const {
            mode, transitions, loads, manager,
        } = createMode({ manager: createThemeManager({ active: 'dunes', cached: ['nimbus'] }), selectedLevelId: 2 });
        await expect(prefetchOdysseyLevelThemes(mode, 2, {
            priority: 'low', includeAdjacent: true, trackAsCurrent: true,
        })).resolves.toBe(true); // the picked orb's theme is the active one
        expect(mode.currentThemePrefetchLevelId).toBe(2);
        await vi.advanceTimersByTimeAsync(420 + 100);
        expect(warmedNames(transitions)).toEqual(['dunes', 'reef']);
        loads[0].land();
        await vi.advanceTimersByTimeAsync(1000);
        expect(warmedNames(transitions)).toEqual(['dunes', 'reef']);
        expect([...manager.themeInstances.keys()]).toEqual(['dunes', 'reef']);
    });

    it('a pick made while a guess loads waits for it to land, then takes the room', async () => {
        const {
            mode, board, transitions, loads, manager,
        } = createMode();
        hover(mode, board, 3);
        await vi.advanceTimersByTimeAsync(600);
        expect(warmedNames(transitions)).toEqual(['reef']);
        mode.selectedLevelId = 4;
        const picked = prefetchOdysseyLevelThemes(mode, 4, { priority: 'low', trackAsCurrent: true });
        expect(mode.currentThemePrefetchPromise).toBe(picked);
        await vi.advanceTimersByTimeAsync(0);
        expect(warmedNames(transitions)).toEqual(['reef']);
        loads[0].land();
        await vi.advanceTimersByTimeAsync(0);
        expect(transitions.prefetchLevelTheme).toHaveBeenLastCalledWith(LEVELS[3], { priority: 'low' });
        loads[0].land();
        await expect(picked).resolves.toBe(true);
        expect([...manager.themeInstances.keys()]).toEqual(['forest', 'ember']);
    });

    it('drops the waiting guesses on a pick, a return or a stop', async () => {
        const { mode, board, transitions } = createMode();
        board.quiet = false;
        const warmed = hover(mode, board, 3);
        clearOdysseyThemePrefetch(mode);
        await expect(warmed).resolves.toBe(false);
        board.quiet = true;
        await vi.advanceTimersByTimeAsync(1000);
        expect(transitions.prefetchLevelTheme).not.toHaveBeenCalled();
    });
});

describe('OdysseyBoardController.isQuietForSpeculativeWork', () => {
    function createBoard(overrides = {}) {
        const board = Object.create(OdysseyBoardController.prototype);
        Object.assign(board, {
            _disposed: false,
            isActive: true,
            isRenderingPaused: false,
            cameraController: { isAnimating: false, travelModel: { inputVelocity: 0 } },
            scrollIdleThreshold: 0.02,
            lastInteractionAt: performance.now() - 5000,
            backgroundLoadQuietWindowMs: 700,
            frameMsEma: 10,
            frameHealthBudgetMs: 20,
            _bgGateBlockedSince: 0,
        }, overrides);
        return board;
    }

    it('is the background gate without its escape, and leaves the escape\'s clock alone', () => {
        expect(createBoard().isQuietForSpeculativeWork()).toBe(true);
        expect(createBoard({ isRenderingPaused: true }).isQuietForSpeculativeWork()).toBe(false);
        expect(createBoard({ lastInteractionAt: performance.now() }).isQuietForSpeculativeWork()).toBe(false);
        expect(createBoard({ frameMsEma: 40 }).isQuietForSpeculativeWork()).toBe(false);
        const gliding = createBoard({ cameraController: { isAnimating: true, travelModel: { inputVelocity: 0 } } });
        expect(gliding.isQuietForSpeculativeWork()).toBe(false);
        // Long blocked: the background gate takes its escape; the quiet test neither does nor starts its clock.
        const since = performance.now() - 9000;
        const blocked = createBoard({ frameMsEma: 40, _bgGateBlockedSince: since });
        expect(blocked.isQuietForSpeculativeWork()).toBe(false);
        expect(blocked._bgGateBlockedSince).toBe(since);
        const fresh = createBoard({ frameMsEma: 40 });
        fresh.isQuietForSpeculativeWork();
        expect(fresh._bgGateBlockedSince).toBe(0);
        expect(blocked._canRunBackgroundTask()).toBe(true);
    });
});
