import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

/** A node whose children are found by selector; milestone pips come from its HTML. */
function node() {
    const classes = new Set();
    const parts = new Map();
    const el = {
        style: { setProperty: vi.fn(function set(name, value) { this[name] = value; }) },
        dataset: {},
        textContent: '',
        _html: '',
        pips: [],
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
        remove: vi.fn(),
        get innerHTML() { return this._html; },
        set innerHTML(html) {
            this._html = html;
            this.pips = [...html.matchAll(/data-milestone="(\d+)"/g)].map(([, m]) => {
                const pip = node();
                pip.dataset.milestone = m;
                return pip;
            });
        },
        querySelector(selector) {
            if (!parts.has(selector)) parts.set(selector, node());
            return parts.get(selector);
        },
        querySelectorAll: () => el.pips,
    };
    return el;
}

let calculateBuildHeight;
beforeEach(() => {
    vi.resetModules();
    calculateBuildHeight = vi.fn((state) => state.height);
    vi.doMock('../../src/core/infinity-grid.js', () => ({ calculateBuildHeight }));
    vi.stubGlobal('document', {
        createElement: () => node(),
        getElementById: () => null,
        body: { appendChild: vi.fn() },
    });
});
afterEach(() => {
    vi.doUnmock('../../src/core/infinity-grid.js');
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const state = (overrides = {}) => ({
    height: 101,
    maxRows: 1000,
    board: [],
    boardVersion: 1,
    score: 12480,
    lines: 4,
    infinityStats: {
        blocksPlaced: 320, maxCascadeScore: 1500, maxComboDepth: 3, maxComboComplexity: 2, totalCascades: 5,
    },
    ...overrides,
});

describe('Infinity HUD', () => {
    it('shows the height, the way to the next milestone, the milestones and the ceiling', async () => {
        const { InfinityHUD } = await import('../../src/ui/infinity/InfinityHUD.js');
        const hud = new InfinityHUD();
        hud.update(state());
        expect(hud.heightDisplay.textContent).toBe('101');
        expect(hud.rowUnit.textContent).toBe('rows');
        expect(hud.progressText.textContent).toBe('149 rows to 250');
        expect(Number(hud.progressBar.style['--ih-progress'])).toBeCloseTo(1 / 150);
        expect(hud.topRowDisplay.textContent).toBe('899 rows');
        const [first, second, ...rest] = hud.milestonesDisplay.pips;
        expect(hud.milestones).toEqual([100, 250, 500, 750, 1000]);
        expect(first.classList.contains('is-passed')).toBe(true);
        expect(first.classList.contains('is-new')).toBe(true);
        expect(second.classList.contains('is-next')).toBe(true);
        const quiet = (pip) => !pip.classList.contains('is-next') && !pip.classList.contains('is-passed');
        expect(rest.every(quiet)).toBe(true);
        // Numbers, grouped.
        expect(hud.stats.score.textContent).toBe((12480).toLocaleString());
        expect(hud.stats.blocks.textContent).toBe('320');
        expect(hud.stats.maxCascadeScore.textContent).toBe((1500).toLocaleString());
        expect(hud.stats.cascades.textContent).toBe('5');
    });

    it('measures the height only when the board changes, and says so at the ceiling', async () => {
        const { InfinityHUD } = await import('../../src/ui/infinity/InfinityHUD.js');
        const hud = new InfinityHUD();
        const gs = state();
        hud.update(gs);
        hud.update(gs);
        hud.update(gs);
        expect(calculateBuildHeight).toHaveBeenCalledTimes(1);
        gs.boardVersion = 2;
        gs.height = 1;
        gs.board = [[null, { type: 'T' }]];
        hud.update(gs);
        expect(calculateBuildHeight).toHaveBeenCalledTimes(2);
        expect(hud.rowUnit.textContent).toBe('row');
        // An empty board has nothing built (the shared helper says one row).
        gs.board = [[null, null]];
        hud.update(gs);
        expect(hud.heightDisplay.textContent).toBe('0');
        expect(hud.rowUnit.textContent).toBe('rows');
        gs.boardVersion = 3;
        gs.height = 1000;
        hud.update(gs);
        expect(hud.progressText.textContent).toBe('At the ceiling');
        expect(hud.topRowDisplay.textContent).toBe('0 rows');
    });

    it('scales the milestones to another ceiling', async () => {
        const { InfinityHUD } = await import('../../src/ui/infinity/InfinityHUD.js');
        const hud = new InfinityHUD();
        hud.update(state({ maxRows: 100, height: 30 }));
        expect(hud.milestones).toEqual([10, 25, 50, 75, 100]);
        expect(hud.progressText.textContent).toBe('20 rows to 50');
    });

    it('counts a chaining cascade over the board and lets it go', async () => {
        vi.useFakeTimers();
        const { InfinityHUD } = await import('../../src/ui/infinity/InfinityHUD.js');
        const hud = new InfinityHUD();
        hud.updateCascadeCounter(1);
        expect(hud.cascadeCounter.classList.contains('is-shown')).toBe(false);
        hud.updateCascadeCounter(3);
        expect(hud.cascadeCounter.innerHTML).toContain('×3');
        expect(hud.cascadeCounter.classList.contains('is-shown')).toBe(true);
        vi.advanceTimersByTime(1600);
        expect(hud.cascadeCounter.classList.contains('is-shown')).toBe(false);
        hud.destroy();
        expect(hud.cascadeCounter).toBe(null);
    });
});
