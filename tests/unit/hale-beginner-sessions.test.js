import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    BreathworkSessionManager, CLOSING_LINE, HOLD_READY_LINE, SESSION_WORLDS,
} from '../../src/ui/effects/breathwork-session-manager.js';
import { BreathworkAudioManager } from '../../src/ui/effects/breathwork-audio-manager.js';
import { BREATH_WORLDS, isBreathWorld } from '../../src/ui/effects/breathing/breath-catalogue.js';

const BEGINNER = ['FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE'];
/**
 * The agreed order of opening: four worlds and First Breath at the start, then one world and one
 * session per Odyssey chapter. A session may only pass through worlds open by the time it opens.
 */
const STARTER_WORLDS = ['coherence', 'calm-sleep', 'box-breathing', 'zen-garden'];
const LADDER = [
    { session: 'FIRST', worlds: [] },
    { session: 'TIDE', worlds: ['ocean-breath'] },
    { session: 'ROOTS', worlds: ['forest-breath'] },
    { session: 'UNWIND', worlds: ['deep-relaxation'] },
    { session: 'SUNRISE', worlds: ['energizing'] },
    { session: 'REST', worlds: ['cosmic-breath'] },
    { session: 'FLOW', worlds: ['triangle'] },
    { session: 'BASE', worlds: ['electric-storm'] },
    { session: 'ELIXIR', worlds: ['wim-hof'] },
];

let manager;

beforeEach(() => {
    vi.stubGlobal('Audio', class {
        constructor() {
            this.pause = vi.fn();
            this.play = vi.fn().mockResolvedValue();
            this.load = vi.fn();
        }
    });
    manager = new BreathworkSessionManager(null);
});

afterEach(() => {
    manager.destroy?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const secondsOf = (phase) => (phase.type === 'active'
    ? phase.pattern.reduce((sum, part) => sum + part, 0) * phase.breaths : phase.duration);
const worldOf = (sessionId, phase) => {
    const worlds = SESSION_WORLDS[sessionId];
    const choice = worlds[phase.type] || worlds.grounding;
    return Array.isArray(choice) ? choice[Math.max(0, (phase.round || 1) - 1) % choice.length] : choice;
};

describe('Hale beginner sessions', () => {
    it.each(BEGINNER)('%s is short, gentle and ends in rest', (sessionId) => {
        const session = manager.SESSIONS[sessionId];
        expect(session.intensity).toBe('Gentle');
        expect(session.totalRounds).toBe(2);
        const seconds = session.phases.reduce((sum, phase) => sum + secondsOf(phase), 0);
        expect(seconds).toBeGreaterThanOrEqual(200);
        expect(seconds).toBeLessThanOrEqual(300);
        expect(session.phases[0].type).toBe('grounding');
        expect(session.phases.at(-1).type).toBe('integration');
        // No breath holds: no held stillness, no recovery breath, no pause longer than two seconds.
        session.phases.forEach((phase) => {
            expect(['grounding', 'active', 'carry', 'integration']).toContain(phase.type);
            if (phase.pattern) {
                expect(phase.pattern).toHaveLength(4);
                expect(Math.max(phase.pattern[1], phase.pattern[3])).toBeLessThanOrEqual(2);
            }
            expect(phase.prompt).toBeTruthy();
            expect(phase.subPrompt).toBeTruthy();
        });
        const rounds = session.phases.filter((phase) => phase.type === 'active').map((phase) => phase.round);
        expect(rounds).toEqual([1, 2]);
    });

    it('sets every stage of every session in a real breathing world', () => {
        Object.entries(manager.SESSIONS).forEach(([sessionId, session]) => {
            session.phases.forEach((phase) => {
                expect(isBreathWorld(worldOf(sessionId, phase)), `${sessionId} ${phase.type}`).toBe(true);
            });
        });
    });

    it('never passes through a world that is still locked when the session opens', () => {
        expect(STARTER_WORLDS.length + LADDER.flatMap((step) => step.worlds).length).toBe(BREATH_WORLDS.length);
        const open = new Set(STARTER_WORLDS);
        LADDER.forEach(({ session, worlds }) => {
            worlds.forEach((world) => open.add(world));
            manager.SESSIONS[session].phases.forEach((phase) => {
                const world = worldOf(session, phase);
                expect(open.has(world), `${session} ${phase.type} ${world}`).toBe(true);
            });
        });
        expect(open.size).toBe(BREATH_WORLDS.length);
    });

    it('words a stretch on your own by its rhythm', () => {
        const carry = (sessionId) => manager._guidanceFor(
            manager.SESSIONS[sessionId].phases.find((phase) => phase.type === 'carry'),
        );
        expect(carry('TIDE')).toEqual({ mode: 'carry', seconds: 24, hint: 'On your own now: the same easy rhythm' });
        expect(carry('ROOTS').hint).toBe('On your own now: the same easy rhythm');
        expect(carry('FLOW').hint).toBe('On your own now: in, hold, out, hold');
    });
});

describe('Hale lines spoken into silence', () => {
    it('says "breathe in when ready" after the hold bell, and the closing words, never over the voice', async () => {
        vi.useFakeTimers();
        const audio = manager.audioManager;
        audio.isRecorded = () => true;
        const spoken = vi.spyOn(audio, 'playVoice');
        manager.startSession('FIRST', vi.fn(), vi.fn());
        audio.isVoicePlaying = false;
        audio.isVoicePending = false;
        spoken.mockClear();
        manager.holdState = { ready: false };
        manager._holdReady();
        await vi.advanceTimersByTimeAsync(1399);
        expect(spoken).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(spoken).toHaveBeenCalledExactlyOnceWith(HOLD_READY_LINE);
        spoken.mockClear();
        audio.isVoicePlaying = true;
        manager._closing();
        expect(spoken).not.toHaveBeenCalled();
        audio.isVoicePlaying = false;
        manager._closing();
        expect(spoken).toHaveBeenCalledExactlyOnceWith(CLOSING_LINE);
        manager.stopSession();
        vi.useRealTimers();
    });
});

describe('Hale lines that are written but not yet recorded', () => {
    it('are never requested by a session', () => {
        const audio = manager.audioManager;
        expect(audio.isRecorded('voices/cues/breathe_in_soft.wav')).toBe(true);
        expect(audio.isRecorded('voices/base/r1_active.wav')).toBe(true);
        expect(audio.isRecorded('voices/first/r1_active.wav')).toBe(false);
        expect(audio.isRecorded('voices/intentions/tide_calm.wav')).toBe(false);
    });

    it('are skipped: a chain moves straight on, and nothing is loaded, scheduled or played', () => {
        const audio = new BreathworkAudioManager({ isRecorded: (clip) => !clip.includes('/first/') });
        const done = vi.fn();
        audio.playVoiceWithCallback('first/r1_active.wav', done);
        expect(done).toHaveBeenCalledOnce();
        expect(audio.isVoicePlaying).toBe(false);
        expect(audio.voiceAudio.src).toBeUndefined();
        audio.playVoice('first/integration.wav');
        expect(audio.voiceAudio.src).toBeUndefined();
        audio.scheduleVoice('first/r2_active.wav', 100);
        expect(audio.isVoicePending).toBe(false);
        audio.playCue('voices/first/cue.wav');
        expect(audio.cueAudio.src).toBeUndefined();
        audio.playVoice('cues/release.wav');
        expect(audio.voiceAudio.src).toMatch(/voices\/cues\/release\.wav$/);
        audio.destroy?.();
    });

    it('are left out of a session\'s preload', async () => {
        const audio = new BreathworkAudioManager({
            isRecorded: (clip) => !clip.includes('/first/') && !clip.includes('first_intro'),
        });
        const loaded = [];
        audio._loadAudio = vi.fn((clip) => { loaded.push(clip); return Promise.resolve(); });
        await audio.preloadSession('FIRST', manager.SESSIONS.FIRST);
        expect(loaded.length).toBeGreaterThan(5);
        expect(loaded.some((clip) => clip.includes('/first/') || clip.includes('first_intro'))).toBe(false);
        expect(loaded).toContain('voices/transitions/round1_start.wav');
        expect(loaded).toContain('voices/cues/breathe_in_soft.wav');
        audio.destroy?.();
    });
});
