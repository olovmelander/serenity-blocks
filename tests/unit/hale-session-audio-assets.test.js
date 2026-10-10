import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    BreathworkSessionManager, CLOSING_LINE, HOLD_READY_LINE,
} from '../../src/ui/effects/breathwork-session-manager.js';
import { RECORDED_VOICE_CLIPS } from '../../src/ui/effects/breathwork-recorded-voices.js';
import { HALE_INTENTIONS } from '../../src/ui/serenity-hub/SessionsTab.js';
import { listRecordedVoiceClips, renderVoiceIndex } from '../../scripts/index-breathwork-voices.mjs';

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'public', 'assets', 'audio', 'breathwork');
const INDEX = path.join(ROOT, 'src', 'ui', 'effects', 'breathwork-recorded-voices.js');
const SCRIPT = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'tts-script.json'), 'utf8'));
/** Every line written for the voice, as the path it is recorded to. */
const SCRIPTED = new Map(SCRIPT.sessions.flatMap((group) => group.clips
    .map((clip) => [`voices/${group.id}/${clip.filename}`, clip.text])));
const RECORDED = new Set(RECORDED_VOICE_CLIPS);
const ORIGINAL_SESSIONS = ['BASE', 'ELIXIR', 'REST', 'FLOW'];

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
    (HALE_INTENTIONS[sessionId] || [])
        .forEach(({ id }) => voices.add(`voices/intentions/${sessionId.toLowerCase()}_${id}.wav`));
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
        it(`${sessionId}: every line it can speak is written for the voice, and recorded or still to record`, () => {
            const clips = sessionClips(sessionId, session);
            expect(clips.length).toBeGreaterThan(10);
            clips.forEach((clip) => {
                // A new speaker re-records the script: a line missing from it would keep the old voice.
                expect(SCRIPTED.has(clip), `${clip} is not in scripts/tts-script.json`).toBe(true);
                const file = path.join(AUDIO, clip);
                if (!RECORDED.has(clip)) {
                    // Still to record: the session shows the words and never asks for the file.
                    expect(existsSync(file), `${clip} exists: run npm run tts:index`).toBe(false);
                    return;
                }
                expect(existsSync(file), clip).toBe(true);
                // A spoken line is seconds long. A clip of minutes is broken (two were nine minutes
                // of near-silence after their words) and costs every session that preloads it.
                const seconds = wavSeconds(file);
                expect(seconds, clip).toBeGreaterThan(0.5);
                expect(seconds, clip).toBeLessThan(25);
            });
        });
    });

    it('writes the lines every session shares for the hold bell and the closing', () => {
        [HOLD_READY_LINE, CLOSING_LINE].forEach((line) => expect(SCRIPTED.has(`voices/${line}`), line).toBe(true));
    });

    it('keeps the original four sessions fully recorded', () => {
        ORIGINAL_SESSIONS.forEach((sessionId) => {
            const unrecorded = sessionClips(sessionId, SESSIONS[sessionId]).filter((clip) => !RECORDED.has(clip));
            expect(unrecorded, sessionId).toEqual([]);
        });
    });

    it('voices the beginner sessions with recorded shared lines until their own are recorded', () => {
        Object.keys(SESSIONS).filter((id) => !ORIGINAL_SESSIONS.includes(id)).forEach((sessionId) => {
            const shared = sessionClips(sessionId, SESSIONS[sessionId])
                .filter((clip) => /voices\/(cues|transitions|encouragement|fillers)\//.test(clip));
            expect(shared.length, sessionId).toBeGreaterThan(5);
            shared.forEach((clip) => expect(RECORDED.has(clip), clip).toBe(true));
        });
    });

    it('indexes exactly the clips on disk', () => {
        expect(RECORDED_VOICE_CLIPS).toEqual(listRecordedVoiceClips(AUDIO));
        expect(readFileSync(INDEX, 'utf8'), 'stale index: run npm run tts:index')
            .toBe(renderVoiceIndex(listRecordedVoiceClips(AUDIO)));
        RECORDED_VOICE_CLIPS.forEach((clip) => expect(SCRIPTED.has(clip), `${clip} has no script line`).toBe(true));
    });

    it('writes every line short enough to speak in a few seconds', () => {
        expect(SCRIPT.voice_config).toMatchObject({
            model: expect.any(String), voice_name: expect.any(String), style: expect.any(String),
        });
        const files = SCRIPT.sessions.flatMap((group) => group.clips.map((clip) => `${group.id}/${clip.filename}`));
        expect(new Set(files).size).toBe(files.length);
        SCRIPTED.forEach((text, clip) => {
            expect(clip.endsWith('.wav'), clip).toBe(true);
            const words = text.trim().split(/\s+/).filter(Boolean).length;
            expect(words, clip).toBeGreaterThan(0);
            // About two words a second at a calm pace: 45 words stays under the 25-second limit.
            expect(words, clip).toBeLessThanOrEqual(45);
        });
    });
});
