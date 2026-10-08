import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { getOdysseyCampaignSummary } from '../../src/core/odyssey/odyssey-campaign-summary.js';
import { completeOdysseyLevel } from '../../src/core/game-modes/odyssey-completion.js';
import { createCampaignFinale } from '../../src/ui/odyssey/CampaignFinale.js';
import { showOdysseyCampaignFinale } from '../../src/ui/odyssey/odyssey-campaign-finale.js';
import { createOdysseyFlowDom } from '../helpers/odyssey-flow-dom.js';
import { DEMO_FIXED_SIMULATION_CLOCK, DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';

const levels = [{ id: 1, chapter: 1 }, { id: 2, chapter: 1 }, { id: 3, chapter: 2 }];
function fixture(completed = [1, 2, 3]) {
    const saved = new Map(completed.map((id) => [id, { stars: id === 1 ? 2 : 3 }]));
    const registry = {
        getAllLevels: () => levels,
        getAllChapters: () => [{ id: 1, name: 'Earth' }, { id: 2, name: 'Ocean' }],
    };
    const state = {
        isLevelCompleted: (id) => saved.has(id),
        getLevelStars: (id) => saved.get(id)?.stars || 0,
        completeLevel: vi.fn((id, result) => saved.set(id, result)),
    };
    const session = {
        levelId: 3,
        retirementGeneration: 7,
        simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
        gameState: { score: 1200 },
        hybridEngine: { updateScore: vi.fn(), getMetrics: () => ({ time: 30, lines: 12 }) },
    };
    const mode = {
        levelRegistry: registry,
        odysseyState: state,
        _activeLevelSession: session,
        _isLevelSessionActive: (owner) => owner === mode._activeLevelSession,
        _isLevelSessionCurrent: (owner, generation) => owner === mode._activeLevelSession
            && generation === session.retirementGeneration,
        _retireLevelSession: () => ({ retirementGeneration: session.retirementGeneration }),
        _drainLevelSession: vi.fn().mockResolvedValue(),
        _calculateStars: () => 1,
        _evaluateBonuses: () => [],
        _syncSteamStats: vi.fn().mockResolvedValue(),
        _showLevelResults: vi.fn().mockResolvedValue('map'),
        _getJourneyFlowDestination: () => null,
        returnToBoard: vi.fn().mockResolvedValue(),
        _cleanupOdysseyHUD: vi.fn(),
        _cleanupMinimap: vi.fn(),
        _showDetailedLevelResults: vi.fn().mockResolvedValue(),
        deps: {
            inputController: { clearTimers: vi.fn() },
            settingsManager: { get: () => ({ reducedMotion: true }) },
        },
    };
    return {
        mode, registry, state, saved, session,
    };
}
const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const action = (modal, name) => nodes(modal).find((node) => node.dataset.finaleAction === name);
const currentModal = () => document.getElementById('odyssey-finale-modal');
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('Odyssey campaign conclusion', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        const dom = createOdysseyFlowDom();
        vi.stubGlobal('document', dom.document);
        vi.stubGlobal('window', dom.window);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('counts registered achievements rather than stale save totals or unregistered orbs', () => {
        const { registry, state, saved } = fixture();
        saved.set(99, { stars: 3 });
        state.statistics = { totalStars: 900, chaptersCompleted: 99 };
        expect(getOdysseyCampaignSummary(registry, state)).toMatchObject({
            complete: true,
            completedOrbs: 3,
            totalOrbs: 3,
            stars: 8,
            maxStars: 9,
            completedChapters: 2,
            totalChapters: 2,
            nextMasteryLevelId: 1,
        });
        expect(getOdysseyCampaignSummary({}, state).complete).toBe(false);
    });

    it('celebrates the saved transition to a fully completed campaign exactly once', async () => {
        const { mode } = fixture([1, 2]);
        await completeOdysseyLevel(mode, {});
        expect(mode._showLevelResults).toHaveBeenCalledWith(expect.objectContaining({
            campaignCompleted: true,
        }), mode._activeLevelSession);
        expect(mode.odysseyState.completeLevel).toHaveBeenCalledOnce();
        await completeOdysseyLevel(mode, {});
        expect(mode._showLevelResults).toHaveBeenCalledOnce();
    });

    it('does not announce campaign completion for an isolated final-orb debug win', async () => {
        const { mode } = fixture([]);
        await completeOdysseyLevel(mode, {});
        expect(mode._showLevelResults.mock.calls[0][0].campaignCompleted).toBe(false);
    });

    it('celebrates the last missing registered orb even when it is not numerically last', async () => {
        const { mode, session } = fixture([1, 3]);
        session.levelId = 2;
        await completeOdysseyLevel(mode, {});
        expect(mode._showLevelResults.mock.calls[0][0].campaignCompleted).toBe(true);
    });

    it('does not repeat the finale for a replay of an already completed campaign', async () => {
        const { mode } = fixture();
        await completeOdysseyLevel(mode, {});
        expect(mode._showLevelResults.mock.calls[0][0].campaignCompleted).toBe(false);
    });

    it('keeps experimental-clock results outside campaign completion and persistence', async () => {
        const { mode, session } = fixture([1, 2]);
        session.simulationClock = DEMO_FIXED_SIMULATION_CLOCK;
        await completeOdysseyLevel(mode, {});
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
        expect(mode._showLevelResults.mock.calls[0][0].campaignCompleted).not.toBe(true);
        await expect(showOdysseyCampaignFinale(mode, { campaignCompleted: true }, session)).resolves.toBeNull();
    });

    it('focuses the next unfinished star on the map without starting another attempt', async () => {
        const { mode } = fixture([1, 2]);
        mode._showLevelResults.mockResolvedValue({ focusLevelId: 1 });
        await completeOdysseyLevel(mode, {});
        expect(mode.returnToBoard).toHaveBeenCalledExactlyOnceWith({ focusLevelId: 1 });
    });

    it('offers an untimed conclusion and does not claim all stars were earned', async () => {
        const { mode, session } = fixture();
        const result = showOdysseyCampaignFinale(mode, { campaignCompleted: true }, session);
        const modal = currentModal();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(currentModal()).toBe(modal);
        expect(document.activeElement).toBe(action(modal, 'world'));
        expect(nodes(modal).map((node) => node.textContent).join(' ')).toContain('8 / 9');
        action(modal, 'mastery').dispatch('click');
        await expect(result).resolves.toEqual({ focusLevelId: 1 });
        expect(session.disposeOutcome).toBeNull();
        expect(currentModal()).toBeNull();
    });

    it('returns from optional results to the same campaign facts without saving again', async () => {
        const { mode, session } = fixture();
        const result = showOdysseyCampaignFinale(mode, { campaignCompleted: true }, session);
        const first = currentModal();
        action(first, 'details').dispatch('click');
        await flush();
        const second = currentModal();
        expect(second).not.toBe(first);
        expect(mode._showDetailedLevelResults).toHaveBeenCalledOnce();
        expect(mode.odysseyState.completeLevel).not.toHaveBeenCalled();
        action(second, 'world').dispatch('click');
        await expect(result).resolves.toBe('map');
    });

    it('settles and removes all finale input when its attempt owner is retired', async () => {
        const { mode, session } = fixture();
        const result = showOdysseyCampaignFinale(mode, { campaignCompleted: true }, session);
        expect(document.listenerCount()).toBe(1);
        session.disposeOutcome();
        await expect(result).resolves.toBe(false);
        expect(currentModal()).toBeNull();
        expect(document.listenerCount()).toBe(0);
    });

    it('never remounts over a replacement session after an optional results await', async () => {
        const { mode, session } = fixture();
        let close;
        mode._showDetailedLevelResults.mockReturnValue(new Promise((resolve) => { close = resolve; }));
        const result = showOdysseyCampaignFinale(mode, { campaignCompleted: true }, session);
        action(currentModal(), 'details').dispatch('click');
        await flush();
        mode._activeLevelSession = {};
        close();
        await expect(result).resolves.toBe(false);
        expect(currentModal()).toBeNull();
    });

    it('hides the optional star invitation when every registered star is earned', () => {
        const { registry, state, saved } = fixture();
        saved.set(1, { stars: 3 });
        const modal = createCampaignFinale({ summary: getOdysseyCampaignSummary(registry, state) });
        expect(action(modal, 'mastery')).toBeUndefined();
        expect(nodes(modal).map((node) => node.textContent).join(' ')).toContain('Every star is yours.');
        modal.dispose();
    });

    it('preserves focused-button activation, traps Tab and ignores carried activation keys', () => {
        const { registry, state } = fixture();
        const onChoose = vi.fn();
        const modal = createCampaignFinale({ summary: getOdysseyCampaignSummary(registry, state), onChoose });
        document.body.appendChild(modal);
        action(modal, 'details').focus();
        const preventDefault = vi.fn();
        document.dispatch('keydown', { key: 'Enter', preventDefault });
        expect(preventDefault).not.toHaveBeenCalled();
        expect(onChoose).not.toHaveBeenCalled();
        document.dispatch('keydown', { key: 'Tab', preventDefault });
        expect(document.activeElement).toBe(action(modal, 'world'));
        document.dispatch('keydown', { key: 'Enter', repeat: true, preventDefault });
        expect(onChoose).not.toHaveBeenCalled();
        document.dispatch('keydown', { key: 'Escape', preventDefault });
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('world');
        expect(document.listenerCount()).toBe(0);
    });

    it('does not clean a replacement interface when invoked with a stale attempt', async () => {
        const { mode, session } = fixture();
        mode._activeLevelSession = {};
        await expect(showOdysseyCampaignFinale(mode, { campaignCompleted: true }, session)).resolves.toBe(false);
        expect(mode._cleanupOdysseyHUD).not.toHaveBeenCalled();
        expect(mode._cleanupMinimap).not.toHaveBeenCalled();
        expect(currentModal()).toBeNull();
    });

    it('does not activate finale actions while the window is hidden or unfocused', () => {
        const { registry, state } = fixture();
        const onChoose = vi.fn();
        const modal = createCampaignFinale({ summary: getOdysseyCampaignSummary(registry, state), onChoose });
        document.hidden = true;
        action(modal, 'world').dispatch('click');
        expect(onChoose).not.toHaveBeenCalled();
        document.hidden = false;
        document.hasFocus = () => false;
        action(modal, 'world').dispatch('click');
        expect(onChoose).not.toHaveBeenCalled();
        modal.dispose();
    });
});
