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

    it('shows the decisive frag result when a bot duel is completed', () => {
        const modal = createModal({
            includeLegacyResults: false,
            results: { score: 123, lines: 12, stars: 2, time: 30,
                duel: { playerFrags: 7, botFrags: 3, targetFrags: 7, botName: 'Quartz' } },
        });
        const markup = collectMarkup(modal);
        expect(markup).toContain('You beat Quartz, 7–3. First to 7 frags.');
        expect(markup).toContain('Final frags');
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
