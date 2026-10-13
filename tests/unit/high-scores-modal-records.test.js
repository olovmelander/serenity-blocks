/**
 * The records list is built as markup, and its records can come from another device
 * through Steam Cloud. A malformed record must render as numbers, never as markup
 * (audit SCORE-17).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/core/steam/steam-service.js', () => ({ default: { on: vi.fn(), isAvailable: () => false } }));

const { showHighScoresModal } = await import('../../src/ui/modals.js');

function element() {
    return { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('high scores list', () => {
    it('renders hostile record fields as numbers', async () => {
        const list = element();
        const statistics = element();
        const elements = { 'high-scores-list': list, 'statistics-section': statistics };
        vi.stubGlobal('document', { getElementById: (id) => elements[id] || null });
        const hostile = '<img src=x onerror=alert(1)>';
        await showHighScoresModal({ show: vi.fn() }, {
            getTopScores: async () => [
                {
                    score: hostile, lines: hostile, level: hostile, timestamp: 1, demoId: '1" onmouseover="alert(2)',
                },
                {
                    score: 1200, lines: 1, level: 4, timestamp: 2, demoId: 9,
                },
            ],
            getStatistics: async () => ({
                totalGames: hostile, totalScore: 10, totalLines: 2, highestScore: hostile, highestLevel: hostile,
            }),
        }, () => {});
        const markup = list.innerHTML + statistics.innerHTML;
        expect(markup).not.toMatch(/<img|onerror|onmouseover/);
        expect(list.innerHTML).toContain('Level 0 · 0 lines');
        expect(list.innerHTML).toContain('Level 4 · 1 line');
        expect(list.innerHTML.match(/data-demo-id="(\d+)"/g)).toEqual(['data-demo-id="9"']);
    });
});
