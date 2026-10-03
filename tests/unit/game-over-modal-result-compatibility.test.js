import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ModalManager, showGameOverModal } from '../../src/ui/modals.js';
import { SteamLeaderboardPanel } from '../../src/ui/components/steam-leaderboard-panel.js';

function createModalHarness() {
    const finalStats = { innerHTML: '' };
    const buttons = { innerHTML: '' };
    const mainMenuButton = { addEventListener: vi.fn() };
    const elements = new Map([
        ['final-stats', finalStats],
        ['game-over-buttons', buttons],
        ['game-over-main-menu', mainMenuButton],
    ]);
    const getElementById = vi.fn((id) => elements.get(id) || null);
    vi.stubGlobal('document', { getElementById });

    return {
        buttons,
        finalStats,
        getElementById,
        modalManager: {
            hide: vi.fn(),
            show: vi.fn(),
        },
    };
}

function createResultState() {
    return {
        dropInterval: 500,
        level: 4,
        lines: 17,
        piecesPlaced: 80,
        score: 4321,
        startTime: Date.now() - 10000,
    };
}

describe('game-over modal result compatibility', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders experimental session stats without touching legacy result views', async () => {
        const harness = createModalHarness();
        const mountLeaderboard = vi.spyOn(SteamLeaderboardPanel.prototype, 'mount');
        const highScoreManager = {
            getRank: vi.fn(),
            getStatistics: vi.fn(),
        };

        const presented = await showGameOverModal(
            harness.modalManager,
            createResultState(),
            highScoreManager,
            {},
            { includeLegacyResults: false },
        );

        expect(presented).toBe(true);
        expect(highScoreManager.getRank).not.toHaveBeenCalled();
        expect(highScoreManager.getStatistics).not.toHaveBeenCalled();
        expect(harness.finalStats.innerHTML).toContain('Experimental Session · Unranked');
        expect(harness.finalStats.innerHTML).toContain('Not added to legacy rankings');
        expect(harness.finalStats.innerHTML).not.toContain('Career Best');
        expect(harness.finalStats.innerHTML).not.toContain('steam-leaderboard-host');
        expect(harness.getElementById).not.toHaveBeenCalledWith('steam-leaderboard-host');
        expect(mountLeaderboard).not.toHaveBeenCalled();
        expect(harness.modalManager.show).toHaveBeenCalledWith('gameOver');
    });

    it('keeps the ranked legacy presentation as the default', async () => {
        const harness = createModalHarness();
        const highScoreManager = {
            getRank: vi.fn().mockResolvedValue(7),
            getStatistics: vi.fn().mockResolvedValue({
                highestLevel: 8,
                highestScore: 9000,
                totalGames: 12,
                totalLines: 240,
                totalScore: 48000,
            }),
        };

        const presented = await showGameOverModal(
            harness.modalManager,
            createResultState(),
            highScoreManager,
        );

        expect(presented).toBe(true);
        expect(highScoreManager.getRank).toHaveBeenCalledWith(4321);
        expect(highScoreManager.getStatistics).toHaveBeenCalledOnce();
        expect(harness.finalStats.innerHTML).toContain('Rank #7');
        expect(harness.finalStats.innerHTML).toContain('Career Best');
        expect(harness.modalManager.show).toHaveBeenCalledWith('gameOver');
    });

    it('abandons presentation when async ownership expires', async () => {
        const harness = createModalHarness();
        const rank = createDeferred();
        let ownsUi = true;
        const highScoreManager = {
            getRank: vi.fn(() => rank.promise),
            getStatistics: vi.fn().mockResolvedValue({}),
        };

        const presentation = showGameOverModal(
            harness.modalManager,
            createResultState(),
            highScoreManager,
            {},
            { shouldPresent: () => ownsUi },
        );
        ownsUi = false;
        rank.resolve(1);

        expect(await presentation).toBe(false);
        expect(harness.finalStats.innerHTML).toBe('');
        expect(harness.modalManager.show).not.toHaveBeenCalled();
    });

    it('does not render the error fallback after a rejected stale lookup', async () => {
        const harness = createModalHarness();
        const rank = createDeferred();
        let ownsUi = true;
        const highScoreManager = {
            getRank: vi.fn(() => rank.promise),
            getStatistics: vi.fn(),
        };

        const presentation = showGameOverModal(
            harness.modalManager,
            createResultState(),
            highScoreManager,
            {},
            { shouldPresent: () => ownsUi },
        );
        ownsUi = false;
        rank.reject(new Error('stale lookup failed'));

        expect(await presentation).toBe(false);
        expect(harness.finalStats.innerHTML).toBe('');
        expect(harness.modalManager.show).not.toHaveBeenCalled();
    });

    it('retires the previous ranked panel before replacing it with experimental results', async () => {
        const harness = createModalHarness();
        const previous = { destroy: vi.fn() };
        harness.modalManager.gameOverLeaderboardPanel = previous;
        await showGameOverModal(harness.modalManager, createResultState(), {}, {}, { includeLegacyResults: false });
        expect(previous.destroy).toHaveBeenCalledOnce();
        expect(harness.modalManager.gameOverLeaderboardPanel).toBeNull();
    });

    it('connects the panel presentation lifecycle to game-over modal visibility and manager teardown', () => {
        vi.stubGlobal('CustomEvent', class {});
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        const panel = { show: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
        const manager = Object.create(ModalManager.prototype);
        Object.assign(manager, {
            modals: { gameOver: { classList: { add: vi.fn(), remove: vi.fn() } } },
            menuCoverage: { refresh: vi.fn(), destroy: vi.fn() },
            gameOverLeaderboardPanel: panel,
        });
        manager.show('gameOver');
        manager.hide('gameOver');
        manager.destroy();
        expect(panel.show).toHaveBeenCalledOnce();
        expect(panel.hide).toHaveBeenCalledOnce();
        expect(panel.destroy).toHaveBeenCalledOnce();
        expect(manager.gameOverLeaderboardPanel).toBeNull();
    });
});

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}
