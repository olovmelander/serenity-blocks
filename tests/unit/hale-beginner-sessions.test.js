import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    BreathworkSessionManager, CLOSING_LINE, HOLD_READY_LINE, SESSION_WORLDS,
} from '../../src/ui/effects/breathwork-session-manager.js';
import { BreathworkAudioManager } from '../../src/ui/effects/breathwork-audio-manager.js';
import { BREATH_WORLDS, isBreathWorld } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { BREATH_LADDER, STARTER_SESSIONS, STARTER_WORLDS } from '../../src/ui/effects/breathing/breath-collection.js';

const BEGINNER = ['FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE'];
/**
 * The order of opening (breath-collection.js): four worlds and First Breath at the start, then
 * one world and its session per Odyssey chapter. A session may only pass through worlds open by
 * the time it opens, and features the world it opens with.
 */
const LADDER = [
    ...STARTER_SESSIONS.map((session) => ({ session, worlds: [] })),
    ...BREATH_LADDER.map((step) => ({ session: step.session, worlds: [step.world] })),
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
        expect(session.totalRounds).toBe(sessionId === 'FIRST' ? 3 : 2);
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
        expect(rounds).toEqual(Array.from({ length: session.totalRounds }, (_, index) => index + 1));
        // You arrive at your own pace: nothing is counted until the first round.
        expect(session.phases[0].pattern).toBeUndefined();
        expect(manager._guidanceFor(session.phases[0]).mode).toBe('natural');
    });

    it('features in every session the world it opens with', () => {
        BREATH_LADDER.forEach((step) => expect(SESSION_WORLDS[step.session].featured, step.session).toBe(step.world));
        expect(STARTER_WORLDS).toContain(SESSION_WORLDS.FIRST.featured);
        // First Breath is made of the starter worlds: one round in each of three, the arrival and rest in the fourth.
        const worlds = manager.SESSIONS.FIRST.phases.map((phase) => worldOf('FIRST', phase));
        expect(new Set(worlds)).toEqual(new Set(STARTER_WORLDS));
    });

    it('breathes in each round the rhythm of the world it is set in, or a gentler form of it', () => {
        const world = (id) => BREATH_WORLDS.find((candidate) => candidate.id === id);
        // Gentler: no hold longer than the world's own. The same shape: every part scaled alike (a wider square).
        const gentler = (pattern, of) => pattern.every((seconds, index) => (index % 2 === 0 ? true : seconds <= of[index]));
        const scaled = (pattern, of) => pattern.every((seconds, index) => seconds * of[0] === of[index] * pattern[0]);
        Object.entries(manager.SESSIONS).filter(([id]) => BEGINNER.includes(id) || id === 'REST' || id === 'FLOW').forEach(([id, session]) => {
            session.phases.filter((phase) => phase.type === 'active').forEach((phase) => {
                const own = world(worldOf(id, phase)).pattern;
                expect(gentler(phase.pattern, own) || scaled(phase.pattern, own), `${id} round ${phase.round}`).toBe(true);
            });
        });
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
        const carries = (sessionId) => manager.SESSIONS[sessionId].phases.filter((phase) => phase.type === 'carry')
            .map((phase) => manager._guidanceFor(phase).hint);
        expect(manager._guidanceFor(manager.SESSIONS.TIDE.phases[2])).toEqual({ mode: 'carry', seconds: 32, hint: 'On your own now: the same easy rhythm' });
        expect(carries('ROOTS')).toEqual(['On your own now: the same easy rhythm']);
        expect(carries('REST')).toEqual(['On your own now: the same easy rhythm', 'On your own now: in, hold, out']);
        expect(carries('FLOW')).toEqual([
            'On your own now: in, hold, out, hold', 'On your own now: in, out, rest', 'On your own now: in, hold, out, hold',
        ]);
    });
});

describe('Hale lines spoken into silence', () => {
    it('says "breathe in when ready" after the hold bell, and the closing words, never over the voice', async () => {
        vi.useFakeTimers();
        const audio = manager.audioManager;
        audio.resolveClip = (id) => `voices/${id}.wav`;
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
    it('are found by asking the recorded index for the line id', () => {
        // Every line is recorded today; the stand-in indexes below play the lines that are not.
        const audio = manager.audioManager;
        expect(audio.isRecorded('cues/breathe_in_soft')).toBe(true);
        expect(audio.isRecorded('first/r1_active')).toBe(true);
        expect(audio.isRecorded('first/no_such_line')).toBe(false);
        expect(audio.isRecorded('cues/breathe_in_soft.mp3')).toBe(false);
        expect(audio.isRecorded('cues/breathe_in_soft.wav')).toBe(false);
    });

    it('are skipped: a chain moves straight on, and nothing is loaded, scheduled or played', () => {
        const audio = new BreathworkAudioManager({ resolveClip: (id) => (id.startsWith('first/') ? null : `voices/${id}.mp3`) });
        const done = vi.fn();
        audio.playVoiceWithCallback('first/r1_active', done);
        expect(done).toHaveBeenCalledOnce();
        expect(audio.isVoicePlaying).toBe(false);
        expect(audio.voiceAudio.src).toBeUndefined();
        audio.playVoice('first/integration');
        expect(audio.voiceAudio.src).toBeUndefined();
        audio.scheduleVoice('first/r2_active', 100);
        expect(audio.isVoicePending).toBe(false);
        audio.playCue('first/cue');
        expect(audio.cueAudio.src).toBeUndefined();
        audio.playVoice('cues/release');
        expect(audio.voiceAudio.src).toMatch(/voices\/cues\/release\.mp3$/);
        audio.destroy?.();
    });

    it('are left out of a session\'s preload', async () => {
        const audio = new BreathworkAudioManager({
            resolveClip: (id) => (id.startsWith('first/') || id.includes('first_intro') ? null : `voices/${id}.mp3`),
        });
        const loaded = [];
        audio._loadAudio = vi.fn((clip) => { loaded.push(clip); return Promise.resolve(); });
        await audio.preloadSession('FIRST', manager.SESSIONS.FIRST, manager._extraLines(manager.SESSIONS.FIRST, 'FIRST'));
        expect(loaded.length).toBeGreaterThan(5);
        expect(loaded.some((clip) => clip.includes('/first/') || clip.includes('first_intro'))).toBe(false);
        expect(loaded).toEqual(expect.arrayContaining([
            'voices/transitions/round1_start.mp3', 'voices/cues/breathe_in_soft.mp3', 'voices/closings/wake.mp3',
            'voices/worlds/coherence_in.mp3', 'voices/worlds/calm-sleep_out.mp3',
        ]));
        audio.destroy?.();
    });

    it('follows the game\'s mute and effects volume', () => {
        const sound = { isMuted: false, getSfxVolume: () => 0.5 };
        const audio = new BreathworkAudioManager({ resolveClip: (id) => `voices/${id}.mp3`, getSound: () => sound });
        audio.playVoice('cues/release');
        expect(audio.voiceAudio.volume).toBeCloseTo(0.425);
        sound.isMuted = true;
        audio.playVoice('cues/release');
        expect(audio.voiceAudio.volume).toBe(0);
        audio.destroy?.();
    });
});
