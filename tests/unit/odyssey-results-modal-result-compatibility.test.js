import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import steamService from '../../src/core/steam/steam-service.js';
import { SteamLeaderboardPanel } from '../../src/ui/components/steam-leaderboard-panel.js';
import { createResultsModal } from '../../src/ui/odyssey/ResultsModal.js';

function createElement(tagName) {
    return {
        tagName,
        children: [],
        className: '',
        id: '',
        innerHTML: '',
        textContent: '',
        style: {},
        addEventListener: vi.fn(),
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        remove: vi.fn(),
    };
}

function collectMarkup(element) {
    return [
        element.textContent,
        element.innerHTML,
        ...element.children.map(collectMarkup),
    ].join(' ');
}

function findByClass(element, className) {
    if (element.className === className) return element;
    for (const child of element.children) {
        const match = findByClass(child, className);
        if (match) return match;
    }
    return null;
}

function createModal(options = {}) {
    return createResultsModal({
        results: {
            lines: 18,
            score: 4321,
            stars: 2,
            time: 12.5,
        },
        formatTime: (milliseconds) => `${milliseconds}ms`,
        levelConfig: { name: 'Clockwork Garden' },
        levelId: 7,
        onClose: vi.fn(),
        totalStars: 14,
        ...options,
    });
}

describe('Odyssey results modal compatibility', () => {
    beforeEach(() => {
        vi.stubGlobal('document', {
            addEventListener: vi.fn(),
            createElement: vi.fn(createElement),
            removeEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('shows experimental results without constructing or reading the legacy Steam view', () => {
        const mountLeaderboard = vi.spyOn(SteamLeaderboardPanel.prototype, 'mount');
        const getLeaderboard = vi.spyOn(steamService, 'getLeaderboard');

        const modal = createModal({ includeLegacyResults: false });
        const markup = collectMarkup(modal);

        expect(markup).toContain('Experimental Session · Unranked');
        expect(markup).toContain('Run stars are a preview');
        expect(markup).toContain('Campaign progress and leaderboard results were not saved');
        expect(markup).toMatch(/4\D321/);
        expect(markup).toContain('18');
        expect(findByClass(modal, 'steam-leaderboard-panel')).toBeNull();
        expect(mountLeaderboard).not.toHaveBeenCalled();
        expect(getLeaderboard).not.toHaveBeenCalled();
    });

    it('preserves the ranked Steam presentation as the default', () => {
        const mountLeaderboard = vi
            .spyOn(SteamLeaderboardPanel.prototype, 'mount')
            .mockImplementation(() => {});

        const modal = createModal();
        const markup = collectMarkup(modal);

        expect(markup).not.toContain('Experimental Session · Unranked');
        expect(findByClass(modal, 'steam-leaderboard-panel')).not.toBeNull();
        expect(mountLeaderboard).toHaveBeenCalledOnce();
    });
});
