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
        matches() { return ['button', 'input', 'select', 'textarea'].includes(tagName) && !this.disabled; },
        contains(element) { return element === this || this.children.some((child) => child.contains(element)); },
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
        vi.useRealTimers();
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

    it('lays out the orb as the hero, the board in its own column and Continue in the footer', () => {
        let boards = null;
        vi.spyOn(SteamLeaderboardPanel.prototype, 'mount').mockImplementation(function mount() {
            ({ boards } = this);
        });
        const modal = createModal({
            levelConfig: {
                id: 8, name: 'Koi Sanctuary', chapter: 2, theme: { primary: 'koi-pond' },
            },
            levelId: 8,
        });
        const body = findByClass(modal, 'sb-ody-outcome sb-ody-outcome--art sb-ody-outcome--side');
        expect(body.children.map((node) => node.className))
            .toEqual(['sb-ody-outcome__hero', 'sb-ody-outcome__main', 'sb-ody-outcome__side']);
        expect(body.children[0].children[0].className).toBe('sb-orb-art sb-ody-outcome__orb');
        const [, main, side] = body.children;
        expect(findByClass(main, 'sb-eyebrow sb-ody-eyebrow').textContent).toBe('Orb 8 · Deep Ocean · Cleared');
        expect(findByClass(main, 'sb-ody-title').textContent).toBe('Koi Sanctuary');
        expect(findByClass(side, 'steam-leaderboard-panel')).not.toBeNull();
        expect(findByClass(main, 'steam-leaderboard-panel')).toBeNull();
        // However long the board, Continue is not under it: it sits in the footer.
        const footer = findByClass(modal, 'sb-ody-outcome__footer');
        expect(findByClass(footer, 'sb-btn sb-btn--primary').textContent).toBe('Continue');
        expect(findByClass(body, 'sb-ody-actions')).toBeNull();
        // The orb time ranks lower-is-better, so the pending row lands where this run's time ranks.
        expect(boards.map(({ id, sortOrder, currentScore }) => ({ id, sortOrder, currentScore }))).toEqual([
            { id: 'level-time', sortOrder: 'asc', currentScore: 12500 },
            { id: 'total-stars', sortOrder: 'desc', currentScore: 14 },
        ]);
    });

    it('keeps a charmed run off the orb time ranking, which it is not uploaded to', () => {
        let boards = null;
        vi.spyOn(SteamLeaderboardPanel.prototype, 'mount').mockImplementation(function mount() {
            ({ boards } = this);
        });
        createModal({
            results: {
                lines: 18, score: 4321, stars: 2, time: 12.5, charms: ['tide'],
            },
        });
        expect(boards[0].currentScore).toBeNull();
        expect(boards[1].currentScore).toBe(14);
    });

    it('shows the decisive frag result when a bot duel is completed', () => {
        const modal = createModal({
            includeLegacyResults: false,
            results: { score: 123, lines: 12, stars: 2, time: 30,
                duel: { playerFrags: 7, botFrags: 3, targetFrags: 7, botName: 'Quartz' } },
        });
        const markup = collectMarkup(modal);
        expect(markup).toContain('You defeated Quartz, 7–3. First to 7 knockouts.');
        expect(markup).toContain('Knockouts');
    });

    it('retires the owned Steam panel once when either close action dismisses the modal', () => {
        vi.spyOn(SteamLeaderboardPanel.prototype, 'mount').mockImplementation(() => {});
        const destroy = vi.spyOn(SteamLeaderboardPanel.prototype, 'destroy').mockImplementation(() => {});
        const onClose = vi.fn();
        const modal = createModal({ onClose });
        const keyHandler = document.addEventListener.mock.calls.find(([type]) => type === 'keydown')[1];
        const event = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        keyHandler(event);
        keyHandler(event);
        expect(destroy).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(modal.remove).toHaveBeenCalledOnce();
    });

    it.each(['Enter', ' '])('lets focused leaderboard controls own %j without closing or dropping', (key) => {
        let leaderboardButton;
        vi.spyOn(SteamLeaderboardPanel.prototype, 'mount').mockImplementation((host) => {
            leaderboardButton = document.createElement('button');
            leaderboardButton.textContent = 'Total Stars';
            host.appendChild(leaderboardButton);
        });
        const onClose = vi.fn();
        const modal = createModal({ onClose });
        document.activeElement = leaderboardButton;
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled(); // The key reaches its actual target.
        expect(onClose).not.toHaveBeenCalled();

        const bubbleHandler = modal.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        bubbleHandler(event);
        expect(event.stopPropagation).toHaveBeenCalledOnce(); // Gameplay cannot cancel native Space activation.
        expect(event.preventDefault).not.toHaveBeenCalled();

        const release = document.addEventListener.mock.calls.find(([name]) => name === 'keyup')[1];
        const keyup = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        release(keyup);
        expect(keyup.preventDefault).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('keeps native Continue activation and deliberate Escape dismissal single-fire', () => {
        const onClose = vi.fn();
        const modal = createModal({ includeLegacyResults: false, onClose });
        const button = findByClass(modal, 'sb-btn sb-btn--primary');
        document.activeElement = button;
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        const enter = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(enter);
        expect(onClose).not.toHaveBeenCalled();
        expect(enter.preventDefault).not.toHaveBeenCalled();
        button.addEventListener.mock.calls.find(([name]) => name === 'click')[1]();
        expect(onClose).toHaveBeenCalledOnce();
        handler({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('rejects held finishing keys and an inherited Space release, then accepts a fresh Escape', () => {
        const onClose = vi.fn();
        const modal = createModal({ includeLegacyResults: false, onClose });
        document.activeElement = findByClass(modal, 'sb-btn sb-btn--primary');
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        for (const key of ['Enter', ' ', 'Escape']) {
            const repeated = { key, repeat: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
            handler(repeated);
            expect(repeated.preventDefault).toHaveBeenCalledOnce();
        }
        const release = document.addEventListener.mock.calls.find(([name]) => name === 'keyup')[1];
        const spaceRelease = { key: ' ', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        release(spaceRelease);
        expect(spaceRelease.preventDefault).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
        handler({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('lets the next mode receive keys when a removed result sheet is still registered', () => {
        const onClose = vi.fn();
        const modal = createModal({ includeLegacyResults: false, onClose });
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        modal.isConnected = false;
        const event = { key: ' ', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', handler, true);
        expect(document.removeEventListener).toHaveBeenCalledWith('keyup', expect.any(Function), true);
        expect(modal.remove).toHaveBeenCalledOnce();
    });

    it('lets the next mode receive a release when the sheet was removed before keyup', () => {
        const onClose = vi.fn();
        const modal = createModal({ includeLegacyResults: false, onClose });
        modal.isConnected = false;
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keyup')[1];
        const release = { key: ' ', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(release);
        expect(release.preventDefault).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(document.removeEventListener).toHaveBeenCalledWith('keyup', handler, true);
    });

    it('disposes cancellation once without a player callback or later focus', () => {
        vi.useFakeTimers();
        vi.spyOn(SteamLeaderboardPanel.prototype, 'mount').mockImplementation(() => {});
        const destroy = vi.spyOn(SteamLeaderboardPanel.prototype, 'destroy').mockImplementation(() => {});
        const onClose = vi.fn();
        const modal = createModal({ onClose });
        const button = findByClass(modal, 'sb-btn sb-btn--primary');
        button.focus = vi.fn();
        modal.dispose();
        modal.dispose();
        vi.runAllTimers();
        expect(onClose).not.toHaveBeenCalled();
        expect(button.focus).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledOnce();
        expect(modal.remove).toHaveBeenCalledOnce();
    });
});
