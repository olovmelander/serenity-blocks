import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
    describe, expect, it, vi,
} from 'vitest';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'public', 'assets', 'audio', 'breathwork');
const INTENTIONS = {
    BASE: ['calm', 'focus', 'ground', 'breathe'],
    ELIXIR: ['energy', 'release', 'transform', 'power'],
    REST: ['sleep', 'unwind', 'restore', 'peace'],
    FLOW: ['balance', 'clarity', 'presence', 'rhythm'],
};

/** Seconds of audio in a PCM WAV file, read from its header. */
function wavSeconds(file) {
    const data = readFileSync(file);
    let offset = 12;
    let byteRate = 0;
    while (offset + 8 <= data.length) {
        const id = data.toString('ascii', offset, offset + 4);
        const size = data.readUInt32LE(offset + 4);
        if (id === 'fmt ') byteRate = data.readUInt32LE(offset + 16);
        if (id === 'data') return size / byteRate;
        offset += 8 + size + (size % 2);
    }
    return NaN;
}

/** Every clip a session can play: stage lines, cues, fillers, encouragement, intentions. */
function sessionClips(sessionId, session) {
    const voices = new Set();
    const cues = new Set();
    session.phases.forEach(({ audio }) => {
        if (!audio) return;
        [audio.sessionIntro, audio.transition, audio.voice, audio.encourage?.clip, ...(audio.fillers || [])]
            .filter(Boolean).forEach((clip) => voices.add(`voices/${clip}`));
        [audio.cues?.in, audio.cues?.out, audio.release].filter(Boolean).forEach((cue) => cues.add(cue));
    });
    INTENTIONS[sessionId].forEach((id) => voices.add(`voices/intentions/${sessionId.toLowerCase()}_${id}.wav`));
    return [...voices, ...cues];
}

// The manager makes its audio elements as it is built; only its session data is read here.
vi.stubGlobal('Audio', class {
    pause() {}

    load() {}
});
const { SESSIONS } = new BreathworkSessionManager(null);
vi.unstubAllGlobals();

describe('Hale session audio', () => {
    Object.entries(SESSIONS).forEach(([sessionId, session]) => {
        it(`${sessionId}: every clip it can play exists and is short`, () => {
            const clips = sessionClips(sessionId, session);
            expect(clips.length).toBeGreaterThan(15);
            clips.forEach((clip) => {
                const file = path.join(AUDIO, clip);
                expect(existsSync(file), clip).toBe(true);
                // A spoken line is seconds long. A clip of minutes is broken (two were nine minutes
                // of near-silence after their words) and costs every session that preloads it.
                const seconds = wavSeconds(file);
                expect(seconds, clip).toBeGreaterThan(0.5);
                expect(seconds, clip).toBeLessThan(25);
            });
        });
    });
});
