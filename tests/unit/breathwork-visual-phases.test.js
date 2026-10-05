import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';

let manager;
let indicator;

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('Audio', class {
        constructor() {
            this.pause = vi.fn();
            this.load = vi.fn();
            this.removeAttribute = vi.fn();
        }
    });
    indicator = Object.fromEntries([
        'setExternalControl', 'setSessionTheme', 'setSessionPhase', 'setPrompt',
        'setTechnique', 'overridePattern', 'start', 'stop', 'pause', 'resume',
        'showProgress', 'updateProgress',
    ].map((name) => [name, vi.fn()]));
    manager = new BreathworkSessionManager(indicator);
    manager.audioManager.preloadSession = vi.fn().mockResolvedValue();
    manager.audioManager.playVoiceWithCallback = vi.fn();
    manager.audioManager.playCue = vi.fn();
});

afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('guided breathwork visual phase accuracy', () => {
    it.each(['BASE', 'ELIXIR'])('uses %s grounding counts instead of the generic cycle', (sessionId) => {
        manager.startSession(sessionId);
        const { pattern } = manager.SESSIONS[sessionId].phases[0];
        expect(indicator.overridePattern).toHaveBeenLastCalledWith(pattern);
        expect(indicator.setSessionPhase).toHaveBeenLastCalledWith('grounding', 0);
    });

    it.each(['BASE', 'ELIXIR', 'REST', 'FLOW'])('fits %s retention and recovery to their duration', (sessionId) => {
        const durationBefore = manager._calculateTotalDuration(sessionId);
        manager.startSession(sessionId);
        manager.currentPhaseIndex = 2;
        manager._runPhase();
        const retention = manager.SESSIONS[sessionId].phases[2];
        expect(indicator.overridePattern).toHaveBeenLastCalledWith([0, 0, 0, retention.duration]);
        expect(indicator.setSessionPhase).toHaveBeenLastCalledWith('retention', 0);
        manager.currentPhaseIndex = 3;
        manager._runPhase();
        const recovery = manager.SESSIONS[sessionId].phases[3];
        const pattern = indicator.overridePattern.mock.calls.at(-1)[0];
        expect(pattern).toEqual([2, recovery.duration - 4, 2, 0]);
        expect(pattern.reduce((total, count) => total + count, 0)).toBe(recovery.duration);
        expect(manager._calculateTotalDuration(sessionId)).toBe(durationBefore);
    });

    it('keeps a short recovery valid without extending its phase', () => {
        expect(manager._getVisualPattern({ type: 'recovery', duration: 3 })).toEqual([1.5, 0, 1.5, 0]);
    });

    it('forwards session phase progress and clears visuals when the session stops', async () => {
        manager.SESSIONS.TEST = {
            name: 'Test',
            totalRounds: 1,
            phases: [{ type: 'retention', duration: 10, round: 1 }],
        };
        manager.startSession('TEST');
        await vi.advanceTimersByTimeAsync(2500);
        expect(indicator.setSessionPhase).toHaveBeenLastCalledWith('retention', 0.25);
        manager.stopSession();
        expect(indicator.setSessionPhase).toHaveBeenLastCalledWith(null, 0);
        expect(indicator.setSessionTheme).toHaveBeenLastCalledWith(null);
        expect(indicator.setPrompt).toHaveBeenLastCalledWith('');
        expect(indicator.showProgress).toHaveBeenLastCalledWith(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('freezes the indicator during pause and restarts the existing phase on resume', async () => {
        manager.SESSIONS.TEST = {
            name: 'Test',
            totalRounds: 1,
            phases: [{ type: 'grounding', duration: 10, pattern: [2, 1, 3, 1] }],
        };
        manager.startSession('TEST');
        await vi.advanceTimersByTimeAsync(2000);
        manager.pauseSession();
        expect(indicator.pause).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(5000);
        manager.resumeSession();
        expect(indicator.resume).toHaveBeenCalledOnce();
        expect(indicator.overridePattern).toHaveBeenLastCalledWith([2, 1, 3, 1]);
        expect(indicator.setSessionPhase).toHaveBeenLastCalledWith('grounding', 0);
        expect(vi.getTimerCount()).toBe(2);
    });
});
