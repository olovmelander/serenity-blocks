/**
 * Online versus' results: the standings rank by what decided the match (a lines race by
 * lines), the winner always first; the table keeps the columns that say something and
 * marks the deciding one; the winner's line leads with it, and a draw has none.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { FragTracker } from '../../src/core/multiplayer/frag-tracker.js';
import { MatchResultsModal } from '../../src/ui/match-results-modal.js';

function makePlayer(steamId, { frags = 0, score = 0, lines = 0 } = {}) {
    return {
        steamId,
        name: `Player ${steamId}`,
        color: '#22d3ee',
        isAlive: true,
        frags,
        gameState: { score, lines, piecesPlaced: 10 },
    };
}

function makeTracker(endCondition, players) {
    return new FragTracker({
        isHost: true,
        matchConfig: { endCondition, endConditionValue: 3 },
        players: new Map(players.map((p) => [p.steamId, p])),
        getAttackStats: () => [],
    });
}

describe('online results: who placed where', () => {
    it('ranks a lines race by lines, not by frags', () => {
        const tracker = makeTracker('lines', [
            makePlayer('A', { frags: 2, score: 9000, lines: 1 }),
            makePlayer('B', { frags: 0, score: 1200, lines: 3 }),
        ]);
        const stats = tracker.buildFinalStats(60000);
        expect(stats.map((s) => s.steamId)).toEqual(['B', 'A']);
        expect(stats.map((s) => s.placement)).toEqual([1, 2]);
    });

    it('ranks a points race and a timed match by score', () => {
        ['points', 'time'].forEach((condition) => {
            const tracker = makeTracker(condition, [
                makePlayer('A', { frags: 3, score: 100, lines: 9 }),
                makePlayer('B', { frags: 0, score: 5000, lines: 1 }),
            ]);
            expect(tracker.buildFinalStats(60000)[0].steamId).toBe('B');
        });
    });

    it('keeps frags first in a frag match', () => {
        const tracker = makeTracker('frags', [
            makePlayer('A', { frags: 1, score: 9000 }),
            makePlayer('B', { frags: 2, score: 100 }),
        ]);
        expect(tracker.buildFinalStats(60000)[0].steamId).toBe('B');
    });

    it('puts the winner first, so the results\' winner and first place agree', () => {
        // Tied on lines: the race's winner (the first to reach it) heads the table.
        const tracker = makeTracker('lines', [
            makePlayer('A', { score: 9000, lines: 3 }),
            makePlayer('B', { score: 100, lines: 3 }),
        ]);
        expect(tracker.buildFinalStats(60000, 'B')[0].steamId).toBe('B');
        expect(tracker.buildFinalStats(60000)[0].steamId).toBe('A');
    });
});

/** A results modal without its DOM: just the nodes updateContent writes. */
function makeModal() {
    const nodes = {};
    const node = () => ({ textContent: '', innerHTML: '' });
    const modal = Object.assign(Object.create(MatchResultsModal.prototype), {
        container: {
            querySelector: (selector) => {
                nodes[selector] = nodes[selector] || node();
                return nodes[selector];
            },
        },
        localPlayerId: 'B',
        _loadWinnerAvatar: vi.fn(),
    });
    return { modal, nodes };
}

const RACE = {
    isGameOver: true,
    winner: { steamId: 'B', name: 'Player B' },
    winnerName: 'Player B',
    endCondition: 'lines',
    endConditionValue: '3',
    duration: 12000,
    killFeed: [],
    finalStats: [
        {
            steamId: 'B', name: 'Player B', placement: 1, frags: 0, deaths: 0, score: 1245, lines: 3, pps: 0.8, apm: 0, attackLinesSent: 6,
        },
        {
            steamId: 'A', name: 'Player A', placement: 2, frags: 0, deaths: 0, score: 0, lines: 0, pps: 0.1, apm: 0, attackLinesSent: 0,
        },
    ],
};

beforeEach(() => {
    vi.stubGlobal('document', {
        createElement: () => {
            const el = { text: '' };
            Object.defineProperty(el, 'textContent', { set(v) { el.text = String(v); } });
            Object.defineProperty(el, 'innerHTML', {
                get() { return el.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
            });
            return el;
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('online results: the table', () => {
    it('keeps the columns that say something, and marks the one that decided', () => {
        const { modal, nodes } = makeModal();
        modal.updateContent(RACE);
        const html = nodes['#match-results-stats-table'].innerHTML;
        const heads = [...html.matchAll(/<th scope="col"[^>]*>(?:<abbr[^>]*>)?([^<]+)/g)].map((m) => m[1]);
        expect(heads).toEqual(['#', 'Player', 'Frags', 'Deaths', 'Score', 'Lines', 'PPS', 'APM', 'Sent']);
        expect(html).toContain('<th scope="col" data-col="lines" class="is-goal">Lines</th>');
        // The deciding cell of each row is marked too.
        expect(html.match(/<td data-col="lines" class="is-goal">/g)).toHaveLength(2);
    });

    it('names the goal even when the host sent it as a string', () => {
        const { modal, nodes } = makeModal();
        modal.updateContent(RACE);
        expect(nodes['#match-results-subtitle'].textContent).toBe('First to 3 lines · 0:12');
    });

    it('leads the winner\'s line with what decided the match', () => {
        const { modal, nodes } = makeModal();
        modal.updateContent(RACE);
        expect(nodes['#match-results-winner-meta'].textContent).toBe(`3 lines · ${(1245).toLocaleString()} points`);
        expect(modal.formatWinnerMeta({ frags: 1, score: 300 }, 'frags')).toBe('1 frag · 300 points');
        expect(modal.formatWinnerMeta({ score: 12300, lines: 40 }, 'points'))
            .toBe(`${(12300).toLocaleString()} points · 40 lines`);
    });

    it('gives a draw no winner\'s line', () => {
        const { modal, nodes } = makeModal();
        modal.updateContent({ ...RACE, winner: null, winnerName: 'Draw' });
        expect(nodes['#match-results-winner-name'].textContent).toBe('Draw');
        expect(nodes['#match-results-winner-meta'].textContent).toBe('');
    });
});
