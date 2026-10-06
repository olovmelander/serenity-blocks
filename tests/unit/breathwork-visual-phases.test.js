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
            this.play = vi.fn().mockResolvedValue();
            this.load = vi.fn();
            this.removeAttribute = vi.fn();
        }
    });
    indicator = Object.fromEntries([
        'setExternalControl', 'setSessionTheme', 'setSessionPhase', 'setPrompt',
        'setTechnique', 'overridePattern', 'start', 'stop', 'pause', 'resume',
        'showProgress', 'updateProgress', 'setJourney',
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

    it('keeps Flow\'s box going, uncounted, in the stretch after each round', () => {
        manager.startSession('FLOW');
        manager.currentPhaseIndex = 2;
        manager._runPhase();
        expect(indicator.overridePattern).toHaveBeenLastCalledWith([4, 4, 4, 4]);
        expect(indicator.setSessionPhase).toHaveBeenLastCalledWith('carry', 0);
        expect(indicator.setTechnique).toHaveBeenLastCalledWith('triangle', false);
        expect(manager._calculateTotalDuration('FLOW')).toBe(1459);
    });

    it.each(['BASE', 'ELIXIR', 'REST'])('fits %s retention and recovery to their duration', (sessionId) => {
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

    it('holds a stage at its place during a pause and continues it on resume', async () => {
        manager.SESSIONS.TEST = {
            name: 'Test',
            totalRounds: 1,
            phases: [{ type: 'grounding', duration: 10, pattern: [2, 1, 3, 1] }],
        };
        const done = vi.fn();
        manager.startSession('TEST', vi.fn(), done);
        await vi.advanceTimersByTimeAsync(4000);
        const stageStarts = indicator.overridePattern.mock.calls.length;
        manager.pauseSession();
        expect(indicator.pause).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60000);
        expect(done).not.toHaveBeenCalled();
        manager.resumeSession();
        expect(indicator.resume).toHaveBeenCalledOnce();
        // The stage picks up where it stopped; it is not started over.
        expect(indicator.overridePattern).toHaveBeenCalledTimes(stageStarts);
        expect(vi.getTimerCount()).toBe(2);
        await vi.advanceTimersByTimeAsync(5900);
        expect(done).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(200);
        expect(done).toHaveBeenCalledOnce();
    });

    it('counts the breaths of an active round from the same clock that ends it', async () => {
        manager.SESSIONS.TEST = {
            name: 'Test',
            totalRounds: 1,
            phases: [{
                type: 'active', breaths: 5, pattern: [1, 0, 1, 0], round: 1,
            }],
        };
        const report = vi.fn();
        manager.startSession('TEST', report, vi.fn());
        await vi.advanceTimersByTimeAsync(4500);
        expect(report.mock.calls.at(-1)[0]).toMatchObject({ breathCount: 2, totalBreaths: 5, isActivePhase: true });
        manager.pauseSession();
        await vi.advanceTimersByTimeAsync(30000);
        manager.resumeSession();
        await vi.advanceTimersByTimeAsync(2000);
        expect(report.mock.calls.at(-1)[0].breathCount).toBe(3);
        expect(report.mock.calls.at(-1)[0].sessionRemaining).toBeCloseTo(3.5, 0);
    });

    it('sets every stage in its session\'s own world, the same every time', () => {
        manager.startSession('ELIXIR');
        expect(indicator.setTechnique).toHaveBeenLastCalledWith('zen-garden', false);
        [[1, 'wim-hof'], [2, 'cosmic-breath'], [3, 'coherence'], [4, 'energizing'], [7, 'electric-storm'], [10, 'deep-relaxation']]
            .forEach(([index, world]) => {
                manager.currentPhaseIndex = index;
                manager._runPhase();
                expect(indicator.setTechnique).toHaveBeenLastCalledWith(world, false);
            });
        manager.SESSIONS.TEST = { name: 'Test', totalRounds: 1, phases: [{ type: 'grounding', duration: 5 }] };
        manager.startSession('TEST');
        expect(indicator.setTechnique).toHaveBeenLastCalledWith('forest-breath', false);
    });

    it('hands the guide its journey and answers the guide\'s own Pause and End controls', () => {
        manager.startSession('BASE');
        const journey = indicator.setJourney.mock.calls[0][0];
        expect(journey).toHaveLength(manager.SESSIONS.BASE.phases.length);
        expect(journey[0]).toEqual({ type: 'grounding', round: 0, seconds: 180 });
        expect(journey[1]).toEqual({ type: 'active', round: 1, seconds: 240 });
        indicator.onControl('pause');
        expect(manager.isPaused).toBe(true);
        indicator.onControl('resume');
        expect(manager.isPaused).toBe(false);
        const ended = vi.fn();
        manager.onEndRequested = ended;
        indicator.onControl('end');
        expect(ended).toHaveBeenCalledOnce();
        expect(manager.activeSession).not.toBeNull();
        manager.onEndRequested = null;
        indicator.onControl('end');
        expect(manager.activeSession).toBeNull();
    });
});
