import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    BreathworkSessionManager, CLOSINGS, HOLD_READY_LINE, SESSION_WORLDS,
} from '../../src/ui/effects/breathwork-session-manager.js';
import { RECORDED_VOICES } from '../../src/ui/effects/breathwork-recorded-voices.js';
import { HALE_INTENTIONS } from '../../src/ui/serenity-hub/SessionsTab.js';
import { BREATH_WORLDS } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { buildVoiceIndex, renderVoiceIndex } from '../../scripts/index-breathwork-voices.mjs';
import { readScript, scriptLines } from '../../scripts/tts-script.mjs';
import { readRecordings, wordsOf } from '../../scripts/tts-recordings.mjs';

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'public', 'assets', 'audio', 'breathwork');
const INDEX = path.join(ROOT, 'src', 'ui', 'effects', 'breathwork-recorded-voices.js');
const SCRIPT = readScript();
/** Every line written for the voice, by the id the game plays it by. */
const LINES = new Map(scriptLines(SCRIPT).map((line) => [line.key, line]));
const RECORDINGS = readRecordings();

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

// The manager makes its audio elements as it is built; only its session data is read here.
vi.stubGlobal('Audio', class {
    pause() {}

    load() {}
});
const manager = new BreathworkSessionManager(null);
const { SESSIONS } = manager;
vi.unstubAllGlobals();

/** Every line a session can speak: stages, cues, fillers, encouragement, intentions, closing. */
function sessionLines(sessionId, session) {
    const lines = new Set();
    session.phases.forEach(({ audio }) => {
        if (!audio) return;
        [audio.sessionIntro, audio.transition, audio.voice, audio.encourage?.clip, audio.release,
            audio.cues?.in, audio.cues?.out, audio.cues?.hold, ...(audio.fillers || [])]
            .filter(Boolean).forEach((id) => lines.add(id));
    });
    (HALE_INTENTIONS[sessionId] || []).forEach(({ id }) => lines.add(`intentions/${sessionId.toLowerCase()}_${id}`));
    manager.options = { intention: null };
    manager._extraLines(session, sessionId).forEach((id) => lines.add(id));
    return [...lines];
}

describe('The breathing voice script', () => {
    Object.entries(SESSIONS).forEach(([sessionId, session]) => {
        it(`${sessionId}: every line it can speak is written for the voice`, () => {
            const lines = sessionLines(sessionId, session);
            expect(lines.length).toBeGreaterThan(10);
            // A new speaker re-records the script: a line missing from it would keep the old voice.
            lines.forEach((id) => expect(LINES.has(id), `${id} is not in scripts/tts-script.json`).toBe(true));
        });

        it(`${sessionId}: every stage says the same words it shows`, () => {
            session.phases.forEach((phase) => {
                const line = LINES.get(phase.audio?.voice);
                expect(line, `${sessionId} ${phase.prompt}`).toBeTruthy();
                expect(wordsOf(line.text), `${phase.audio.voice}`).toBe(wordsOf(phase.subPrompt));
            });
        });
    });

    it('says the closing words it shows, and the hold bell\'s invitation', () => {
        Object.values(CLOSINGS).forEach((closing) => {
            expect(wordsOf(LINES.get(closing.line)?.text || ''), closing.line).toBe(wordsOf(closing.text));
        });
        expect(LINES.has(HOLD_READY_LINE)).toBe(true);
    });

    it('writes an introduction and cue words for every breathing world', () => {
        BREATH_WORLDS.forEach((world) => {
            ['intro', 'in', 'out'].forEach((part) => expect(LINES.has(`worlds/${world.id}_${part}`), `${world.id} ${part}`).toBe(true));
            expect(wordsOf(LINES.get(`worlds/${world.id}_in`).text)).toBe(wordsOf(world.cues[0]));
            expect(wordsOf(LINES.get(`worlds/${world.id}_out`).text)).toBe(wordsOf(world.cues[1]));
        });
    });

    it('writes nothing the game never plays (every line costs a recording)', () => {
        const played = new Set([
            ...Object.entries(SESSIONS).flatMap(([id, session]) => sessionLines(id, session)),
            ...Object.values(CLOSINGS).map((closing) => closing.line),
            ...BREATH_WORLDS.flatMap((world) => ['intro', 'in', 'out'].map((part) => `worlds/${world.id}_${part}`)),
        ]);
        expect([...LINES.keys()].filter((id) => !played.has(id))).toEqual([]);
    });

    it('sets up the speaker and keeps every line short enough to say in a few seconds', () => {
        expect(SCRIPT.voice).toMatchObject({
            provider: 'elevenlabs', model_id: expect.any(String), output_format: expect.stringMatching(/^(wav|pcm)_/),
        });
        ['welcome', 'guide', 'cue', 'still'].forEach((kind) => expect(SCRIPT.voice.deliveries[kind], kind).toMatchObject({ loudness: expect.any(Number) }));
        expect(new Set(LINES.keys()).size).toBe([...scriptLines(SCRIPT)].length);
        LINES.forEach((line, id) => {
            expect(SCRIPT.voice.deliveries[line.delivery], `${id} delivery`).toBeTruthy();
            const words = wordsOf(line.text).split(' ').filter(Boolean).length;
            expect(words, id).toBeGreaterThan(0);
            // About two words a second at a calm pace: 45 words stays under the 25-second limit.
            expect(words, id).toBeLessThanOrEqual(45);
        });
    });
});

describe('The recorded voice', () => {
    it('indexes exactly the recordings that still say their line', () => {
        const fresh = buildVoiceIndex({ audioRoot: AUDIO });
        expect(RECORDED_VOICES).toEqual(fresh.entries);
        expect(readFileSync(INDEX, 'utf8'), 'stale index: run npm run tts:index').toBe(renderVoiceIndex(fresh.entries));
        expect(fresh.orphans, 'files no line plays: npm run tts:index -- --prune').toEqual([]);
    });

    it('plays only real recordings, each seconds long', () => {
        Object.entries(RECORDED_VOICES).forEach(([id, file]) => {
            const full = path.join(AUDIO, file);
            expect(existsSync(full), file).toBe(true);
            // A spoken line is seconds long. A clip of minutes is broken (two were nine minutes
            // of near-silence after their words) and costs every session that preloads it.
            const seconds = file.endsWith('.wav') ? wavSeconds(full) : RECORDINGS[id]?.seconds;
            expect(seconds, `${id}: no length recorded`).toBeGreaterThan(0.3);
            expect(seconds, id).toBeLessThan(25);
            expect(statSync(full).size, id).toBeGreaterThan(1000);
        });
    });

    it('pairs every session with the world it features', () => {
        Object.keys(SESSIONS).forEach((id) => expect(SESSION_WORLDS[id].featured, id).toBeTruthy());
    });
});
