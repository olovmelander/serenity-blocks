import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

let operations;
let nodes;
function node(id) {
    const classes = new Set(['single-player-stat-value', 'pulse']);
    let text = '';
    return {
        classList: {
            add: (name) => { classes.add(name); operations.push(`add:${id}:${name}`); },
            remove: (name) => { classes.delete(name); operations.push(`remove:${id}:${name}`); },
            contains: (name) => classes.has(name),
        },
        set className(value) { classes.clear(); value.split(' ').forEach((name) => classes.add(name)); },
        get className() { return [...classes].join(' '); },
        set textContent(value) { text = value; operations.push(`text:${id}`); },
        get textContent() { return text; },
        get offsetWidth() { operations.push(`layout:${id}`); return 100; },
    };
}
beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(60000);
    operations = [];
    nodes = Object.fromEntries(['score', 'lines', 'level', 'next-level', 'speed', 'bpm', 'ppm']
        .map((id) => [id, node(id)]));
    vi.stubGlobal('document', { getElementById: (id) => nodes[id] });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
function stats(overrides = {}) {
    return {
        score: 123, lines: 5, level: 6, linesUntilNextLevel: 5, startTime: 59000, piecesPlaced: 1, ...overrides,
    };
}

describe('HUD pulse batching', () => {
    it('restarts five changed stats with one layout read and preserves values and warning classes', async () => {
        const { updateStats } = await import('../../src/rendering/draw.js');
        updateStats(stats());
        const reads = operations.filter((operation) => operation.startsWith('layout:'));
        const removes = operations.filter((operation) => operation.startsWith('remove:'));
        const adds = operations.filter((operation) => operation.endsWith(':pulse') && operation.startsWith('add:'));
        expect(reads).toHaveLength(1);
        expect(removes).toHaveLength(5);
        expect(adds).toHaveLength(5);
        const barrier = operations.indexOf(reads[0]);
        expect(operations.slice(barrier + 1).every((operation) => operation.startsWith('add:'))).toBe(true);
        expect(operations.slice(0, barrier).filter((operation) => operation.startsWith('text:'))).toHaveLength(7);
        expect(nodes.score.textContent).toBe('123');
        expect(nodes.lines.textContent).toBe(5);
        expect(nodes.level.textContent).toBe(6);
        expect(nodes.level.classList.contains('warning')).toBe(true);
        expect(nodes.level.classList.contains('danger')).toBe(false);
        expect(nodes.speed.textContent).toBe('2.0x');
        expect(nodes['next-level'].textContent).toBe(5);
        expect(nodes.bpm.textContent).toBe(0);
        expect(nodes.ppm.textContent).toBe('0');
        for (const id of ['score', 'lines', 'level', 'next-level', 'speed']) {
            expect(nodes[id].classList.contains('pulse')).toBe(true);
        }
        operations = [];
        updateStats(stats());
        expect(operations).toEqual([]);
    });

    it('keeps BPM and PPM pulse conditions while sharing their layout read', async () => {
        const { updateStats } = await import('../../src/rendering/draw.js');
        updateStats(stats({ score: 100, piecesPlaced: 5, startTime: 54000 }));
        expect(nodes.bpm.textContent).toBe(50);
        expect(nodes.ppm.textContent).toBe((1000).toLocaleString());
        expect(operations.filter((operation) => operation.startsWith('layout:'))).toHaveLength(1);
        expect(operations).toContain('add:bpm:pulse');
        expect(operations).toContain('add:ppm:pulse');
        operations = [];
        updateStats(stats({ score: 101, piecesPlaced: 6, startTime: 53000 }));
        expect(nodes.bpm.textContent).toBe(51);
        expect(nodes.ppm.textContent).toBe((866).toLocaleString());
        expect(operations).not.toContain('add:bpm:pulse');
        expect(operations).not.toContain('add:ppm:pulse');
        expect(operations.filter((operation) => operation.startsWith('layout:'))).toHaveLength(1);
        operations = [];
        updateStats(stats({ score: 101, piecesPlaced: 6, startTime: 52000 }));
        expect(operations.filter((operation) => operation.startsWith('layout:'))).toHaveLength(0);
        expect(operations).toEqual(['text:bpm', 'text:ppm']);
    });

    it('groups the score, fills the level bar and warns the well near the top', async () => {
        const progress = { style: { setProperty: vi.fn() } };
        const attributes = new Set();
        const stage = {
            hasAttribute: (name) => attributes.has(name),
            toggleAttribute: vi.fn((name, on) => (on ? attributes.add(name) : attributes.delete(name))),
        };
        vi.stubGlobal('document', {
            getElementById: (id) => (id === 'level-progress' ? progress : nodes[id]),
            querySelector: (selector) => (selector === '.single-player-stage' ? stage : null),
        });
        const { updateStats } = await import('../../src/rendering/draw.js');
        const grid = Array.from({ length: 24 }, () => Array(10).fill(null));
        // Twelve rows stand: calm.
        for (let y = 12; y < 24; y++) grid[y][0] = { type: 'T' };
        updateStats(stats({
            score: 12480, linesUntilNextLevel: 6, boardGrid: grid, boardVersion: 1,
        }));
        expect(nodes.score.textContent).toBe((12480).toLocaleString());
        expect(progress.style.setProperty).toHaveBeenCalledWith('--sp-level', '0.600');
        expect(stage.toggleAttribute).not.toHaveBeenCalled();
        // Sixteen rows: the well turns coral, and stays so until the stack is clearly lower.
        for (let y = 8; y < 12; y++) grid[y][0] = { type: 'T' };
        updateStats(stats({ boardGrid: grid, boardVersion: 2 }));
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-danger', true);
        grid[8][0] = null;
        grid[9][0] = null;
        updateStats(stats({ boardGrid: grid, boardVersion: 3 }));
        expect(stage.toggleAttribute).toHaveBeenCalledTimes(1);
        for (let y = 10; y < 13; y++) grid[y][0] = null;
        updateStats(stats({ boardGrid: grid, boardVersion: 4 }));
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-danger', false);
        // Infinity's tall grid never warns.
        updateStats(stats({
            boardGrid: Array.from({ length: 200 }, () => [{ type: 'T' }]), boardVersion: 5, isInfinityMode: true,
        }));
        expect(stage.toggleAttribute).toHaveBeenCalledTimes(2);
        // Cleared from outside (the mode left), a high stack warns again on its next change.
        for (let y = 8; y < 13; y++) grid[y][0] = { type: 'T' };
        updateStats(stats({ boardGrid: grid, boardVersion: 6 }));
        expect(attributes.has('data-danger')).toBe(true);
        attributes.delete('data-danger');
        grid[7][0] = { type: 'T' };
        updateStats(stats({ boardGrid: grid, boardVersion: 7 }));
        expect(attributes.has('data-danger')).toBe(true);
    });

    it('retains danger transitions and avoids reflow when only nonpulsing rate values change', async () => {
        const { updateStats } = await import('../../src/rendering/draw.js');
        updateStats(stats({ level: 20, score: 123, piecesPlaced: 1, startTime: 50000 }));
        expect(nodes.level.classList.contains('danger')).toBe(true);
        expect(nodes.speed.classList.contains('danger')).toBe(true);
        operations = [];
        updateStats(stats({ level: 20, score: 123, piecesPlaced: 1, startTime: 49000 }));
        expect(operations.filter((operation) => operation.startsWith('layout:'))).toHaveLength(0);
    });
});
