import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    compareStandings, goalText, metricValue, playerStatus, primaryMetric, secondaryMetric,
} from '../../src/ui/scoreboard-metrics.js';

describe('scoreboard metrics', () => {
    it('ranks by the number that decides the match', () => {
        expect(primaryMetric('frags')).toBe('frags');
        expect(primaryMetric('never')).toBe('frags');
        expect(primaryMetric('points')).toBe('score');
        // A timed match goes to the highest score (frag-tracker.js), not the most frags.
        expect(primaryMetric('time')).toBe('score');
        expect(primaryMetric('lines')).toBe('lines');
        expect(secondaryMetric('frags')).toBe('score');
        expect(secondaryMetric('score')).toBe('frags');
        expect(secondaryMetric('lines')).toBe('frags');
    });

    it('orders players totally: the deciding number, then frags, score, lines and id', () => {
        const players = [
            { id: 'b', frags: 2, score: 10 },
            { id: 'a', frags: 2, score: 10 },
            { id: 'c', frags: 1, score: 900 },
            { id: 'd', frags: 3, score: 5 },
        ];
        const byFrags = [...players].sort((x, y) => compareStandings(x, y, 'frags')).map((p) => p.id);
        const byScore = [...players].sort((x, y) => compareStandings(x, y, 'score')).map((p) => p.id);
        expect(byFrags).toEqual(['d', 'a', 'b', 'c']);
        expect(byScore).toEqual(['c', 'a', 'b', 'd']);
    });

    it('names each status, and prints numbers the way the columns show them', () => {
        expect(playerStatus({ isAlive: true }).label).toBe('Alive');
        expect(playerStatus({ isAlive: false })).toMatchObject({ label: 'Out', isDead: true });
        // A late joiner waiting to spawn is not out.
        expect(playerStatus({ isAlive: false, awaitingSpawn: true }))
            .toMatchObject({ label: 'Waiting', isDead: false, isWaiting: true });
        expect(metricValue({ score: 12345 }, 'score')).toBe((12345).toLocaleString());
        expect(metricValue({}, 'frags')).toBe('0');
        expect(goalText('frags', 10)).toBe('First to 10 frags');
    });
});

// A minimal DOM: the scoreboard's container, its list, goal and the injected header.
function makeScoreboardDom() {
    const element = () => ({
        innerHTML: '', textContent: '', className: '', after: vi.fn(), before: vi.fn(),
    });
    const list = element();
    const goal = element();
    const title = element();
    let header = null;
    title.after = vi.fn((node) => { header = node; });
    const container = {
        querySelector: (selector) => {
            if (selector === '#scoreboard-list' || selector === '.scoreboard-list') return list;
            if (selector === '#scoreboard-goal' || selector === '.scoreboard-goal') return goal;
            if (selector === '.scoreboard-header') return title;
            if (selector === '.scoreboard-columns-header') return header;
            return null;
        },
    };
    vi.stubGlobal('document', { createElement: () => element() });
    return {
        container, list, goal, header: () => header,
    };
}

describe('online scoreboard', () => {
    afterEach(() => vi.unstubAllGlobals());

    const players = [
        {
            id: 'p1', name: 'Moonlit_Harbor_Wanderer', frags: 2, score: 300, isAlive: true,
        },
        {
            id: 'me', name: 'Kai <3', frags: 1, score: 9000, isAlive: false,
        },
        {
            id: 'late', name: 'Late', frags: 0, score: 0, isAlive: false, awaitingSpawn: true,
        },
    ];

    it('gives every row its whole name, its status and the deciding number first', async () => {
        const dom = makeScoreboardDom();
        const { OnlineScoreboard } = await import('../../src/ui/online-scoreboard.js');
        const board = new OnlineScoreboard(dom.container);
        board.setLocalPlayer('me');
        board.setGoal('frags', 10);
        board.updatePlayers(players);

        const html = dom.list.innerHTML;
        expect(html).toContain('title="Moonlit_Harbor_Wanderer"');
        // Names are escaped in the text and in the title.
        expect(html).toContain('title="Kai &lt;3"');
        expect(html).not.toContain('Kai <3');
        expect(html).toMatch(/Kai &lt;3<\/span><span class="col-name__you">You<\/span>/);
        expect(html).toContain('>Alive<');
        expect(html).toContain('>Out<');
        expect(html).toContain('>Waiting<');
        expect(html.indexOf('Moonlit')).toBeLessThan(html.indexOf('Kai'));
        expect(html).toContain('<span class="col-primary" data-metric="frags">2</span>');
        expect(dom.goal.textContent).toBe('First to 10 frags');
        expect(dom.header().innerHTML).toContain('aria-label="Frags"');
        expect(dom.header().innerHTML).toContain('aria-label="Score"');
    });

    it('ranks a timed match by score, and relabels its columns', async () => {
        const dom = makeScoreboardDom();
        const { OnlineScoreboard } = await import('../../src/ui/online-scoreboard.js');
        const board = new OnlineScoreboard(dom.container);
        board.updatePlayers(players);
        board.setGoal('time', 3);

        const html = dom.list.innerHTML;
        expect(html.indexOf('Kai')).toBeLessThan(html.indexOf('Moonlit'));
        expect(html).toContain(`<span class="col-primary" data-metric="score">${(9000).toLocaleString()}</span>`);
        expect(html).toContain('<span class="col-secondary" data-metric="frags">1</span>');
        expect(dom.header().innerHTML).toMatch(/col-primary" data-metric="score"/);
    });
});
