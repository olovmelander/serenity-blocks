import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { SteamLeaderboardPanel } from '../../src/ui/components/steam-leaderboard-panel.js';

const steam = vi.hoisted(() => ({ steamId: 'local-player' }));

vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

class Element {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.className = '';
        this.textContent = '';
        this.classes = new Set();
        this.classList = { add: (...values) => values.forEach((value) => this.classes.add(value)) };
    }

    set innerHTML(value) {
        this.children = [];
        this.markup = value;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }
}

const times = [
    {
        rank: 1, steamId: 'a', name: 'mirelune', score: 107000,
    },
    {
        rank: 2, steamId: 'b', name: 'Tova', score: 110500,
    },
    {
        rank: 3, steamId: 'c', name: 'quietfox', score: 116050,
    },
];
const scores = [
    {
        rank: 1, steamId: 'a', name: 'mirelune', score: 90000,
    },
    {
        rank: 2, steamId: 'b', name: 'Tova', score: 60000,
    },
    {
        rank: 3, steamId: 'c', name: 'quietfox', score: 30000,
    },
];

/** The rendered rows as "rank name" strings, the pending row marked with a star. */
function render(board, entries, { pageSize = 10 } = {}) {
    const panel = new SteamLeaderboardPanel({ boards: [board], pageSize });
    panel.listEl = new Element();
    panel._renderEntries(board, entries, true, '');
    const [list] = panel.listEl.children;
    return list.children.map((row) => {
        if (row.className === 'steam-leaderboard-empty') return row.textContent;
        const [rank, name] = row.children.map((cell) => cell.textContent);
        const marks = `${row.classes.has('pending') ? '*' : ''}${row.classes.has('beyond') ? '+' : ''}`;
        return `${marks}${rank} ${name}`;
    });
}

describe('Steam leaderboard: this run where it ranks', () => {
    beforeEach(() => {
        steam.steamId = 'local-player';
        vi.stubGlobal('document', { createElement: (tagName) => new Element(tagName) });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('places a time among faster and slower times on a lower-is-better board, unnumbered', () => {
        const board = {
            id: 'time', name: 'time', currentScore: 112000, sortOrder: 'asc', pendingLabel: 'You · this run',
        };
        expect(render(board, times)).toEqual(['#1 mirelune', '#2 Tova', '*— You · this run', '#3 quietfox']);
        expect(render({ ...board, currentScore: 90000 }, times)[0]).toBe('*— You · this run');
    });

    it('places a score by value on a higher-is-better board, the default', () => {
        const board = { id: 'score', name: 'score', currentScore: 45000 };
        expect(render(board, scores)).toEqual(['#1 mirelune', '#2 Tova', '*— You (pending)', '#3 quietfox']);
    });

    it('reads the board’s direction from its rows when none is given', () => {
        const board = { id: 'time', name: 'time', currentScore: 112000 };
        expect(render(board, times)[2]).toBe('*— You (pending)');
    });

    it('marks a run below a full page as ranking further down, not next', () => {
        const board = {
            id: 'time', name: 'time', currentScore: 200000, sortOrder: 'asc',
        };
        expect(render(board, times, { pageSize: 3 })).toEqual([
            '#1 mirelune', '#2 Tova', '#3 quietfox', '*+— You (pending)',
        ]);
        expect(render(board, times, { pageSize: 8 }).at(-1)).toBe('*— You (pending)');
    });

    it('shows the run alone over an empty board, and not at all once Steam lists the player', () => {
        const board = {
            id: 'time', name: 'time', currentScore: 112000, sortOrder: 'asc',
        };
        expect(render(board, [])).toEqual(['*— You (pending)', 'No scores yet.']);
        const listed = [...times, {
            rank: 4, steamId: 'local-player', name: 'Me', score: 120000,
        }];
        expect(render(board, listed).some((row) => row.startsWith('*'))).toBe(false);
        expect(render({ ...board, currentScore: null }, times).some((row) => row.startsWith('*'))).toBe(false);
    });
});
