import {
    existsSync, mkdtempSync, readFileSync, rmSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    lineState, readRecordings, renderRecordings, RECORDINGS_FILE, saysLine, takeOf, wordsOf, writeRecordings,
} from '../../scripts/tts-recordings.mjs';
import { readScript, scriptLines } from '../../scripts/tts-script.mjs';
import { compareHeard, probeNetworkKey, requestBody } from '../../scripts/tts-elevenlabs.mjs';

const SPEAKER = {
    model: 'eleven_multilingual_v2', voice: 'abcdefghijklmnop1234', settings: { stability: 0.65, speed: 0.9 }, text: 'Breathe in...',
};
let dir;

afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
});

describe('Hale voice takes', () => {
    it('fingerprints everything that shapes a take, and keeps who said it readable', () => {
        const take = takeOf(SPEAKER);
        expect(take).toEqual({
            voice: SPEAKER.voice, model: SPEAKER.model, take: expect.stringMatching(/^[0-9a-f]{12}$/), words: expect.stringMatching(/^[0-9a-f]{12}$/),
        });
        expect(takeOf({ ...SPEAKER })).toEqual(take);
        ['model', 'voice', 'text'].forEach((field) => {
            expect(takeOf({ ...SPEAKER, [field]: `${SPEAKER[field]}!` }).take, field).not.toBe(take.take);
        });
        expect(takeOf({ ...SPEAKER, settings: { ...SPEAKER.settings, speed: 0.85 } }).take).not.toBe(take.take);
    });

    it('keeps a recording true to its line while its words are the same, however the pauses are marked', () => {
        const take = takeOf(SPEAKER);
        expect(wordsOf('Breathe in... [pause 1.5s] <break time="1s" /> softly…')).toBe('breathe in softly');
        expect(saysLine(take, 'Breathe in.')).toBe(true);
        expect(saysLine(take, 'BREATHE IN…')).toBe(true);
        expect(saysLine(take, 'Breathe in softly...')).toBe(false);
        expect(saysLine(undefined, 'anything')).toBe(true);
    });

    it('records a line again when another speaker made it or its words changed, and keeps clips made elsewhere', () => {
        const take = takeOf(SPEAKER);
        expect(lineState({ exists: false, entry: take, take })).toBe('missing');
        expect(lineState({ exists: true, entry: undefined, take })).toBe('external');
        expect(lineState({ exists: true, entry: take, take })).toBe('current');
        expect(lineState({ exists: true, entry: takeOf({ ...SPEAKER, voice: 'Sulafat' }), take })).toBe('stale');
        expect(lineState({ exists: true, entry: takeOf({ ...SPEAKER, text: 'Breathe out...' }), take })).toBe('stale');
    });

    it('writes one sorted line per clip and reads it back', () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'tts-recordings-'));
        const file = path.join(dir, 'tts-recordings.json');
        expect(readRecordings(file)).toEqual({});
        const clips = {
            'tide/r1_carry.wav': takeOf({ ...SPEAKER, voice: 'Sulafat' }),
            'cues/hold.wav': takeOf(SPEAKER),
        };
        writeRecordings(clips, file);
        expect(readRecordings(file)).toEqual(clips);
        const text = readFileSync(file, 'utf8');
        expect(text.indexOf('cues/hold.wav')).toBeLessThan(text.indexOf('tide/r1_carry.wav'));
        expect(text.split('\n').filter((line) => line.includes('"take"'))).toHaveLength(2);
        expect(JSON.parse(renderRecordings({})).clips).toEqual({});
    });

    it('keeps a take for lines of the script only, each naming its speaker and words', () => {
        expect(existsSync(RECORDINGS_FILE)).toBe(true);
        const scripted = new Set(scriptLines(readScript()).map((line) => line.key));
        const entries = Object.entries(readRecordings());
        expect(entries.length).toBeGreaterThan(0);
        entries.forEach(([line, entry]) => {
            expect(scripted.has(line), `${line} left the script: npm run tts:index -- --prune`).toBe(true);
            expect(entry).toMatchObject({
                voice: expect.any(String), model: expect.any(String), take: expect.stringMatching(/^[0-9a-f]{12}$/),
                words: expect.stringMatching(/^[0-9a-f]{12}$/), seconds: expect.any(Number),
            });
        });
    });
});

describe('Listening back to a take', () => {
    it('hears numbers, sound-alikes and punctuation as the line, and names what differs', () => {
        expect(compareHeard('Four, seven, eight.', '4, 7, 8.').verdict).toBe('match');
        expect(compareHeard('Welcome to Hale Tide.', 'Welcome to Hail Tide.').verdict).toBe('match');
        expect(compareHeard('Breathe in...', 'Soft, slow voice. Breathe in.')).toMatchObject({ verdict: 'differs', added: ['soft', 'slow', 'voice'] });
        expect(compareHeard('Let the breath deepen a little.', 'Let the breath deepen little.')).toMatchObject({ verdict: 'close', missing: ['a'] });
        expect(compareHeard('In...', 'Out.')).toMatchObject({ verdict: 'differs', missing: ['in'], added: ['out'] });
    });

    it('keeps each line\'s retakes and what listening back heard', () => {
        const clips = {
            'cues/hold': {
                voice: 'Quiet Shore', model: 'eleven_v4', take: 'abc', words: 'def', seconds: 1.2, retake: 2, heard: 'match',
            },
            'cues/release': {
                voice: 'Quiet Shore', model: 'eleven_v4', take: 'ghi', retake: 0,
            },
        };
        const text = renderRecordings(clips);
        expect(text).toContain('"retake": 2, "heard": "match"');
        expect(text).not.toContain('"retake": 0');
        dir = mkdtempSync(path.join(os.tmpdir(), 'hale-takes-'));
        const file = path.join(dir, 'takes.json');
        writeRecordings(clips, file);
        expect(readRecordings(file)['cues/hold']).toMatchObject({ retake: 2, heard: 'match' });
    });

    it('asks a model without a language code or context when it refuses them', () => {
        const full = requestBody({
            text: 'Breathe in...', model: 'eleven_v4', settings: { stability: 0.6, speed: 0.9 }, seed: 7, languageCode: 'en', context: { previous: 'Slowly.' },
        });
        expect(full).toEqual({
            text: 'Breathe in...', model_id: 'eleven_v4', voice_settings: { stability: 0.6 }, seed: 7, language_code: 'en', previous_text: 'Slowly.',
        });
        const lean = requestBody({
            text: 'Breathe in...', model: 'eleven_v4', settings: {}, seed: 7, languageCode: 'en', context: { previous: 'Slowly.' }, lean: true,
        });
        expect(lean).toEqual({
            text: 'Breathe in...', model_id: 'eleven_v4', voice_settings: {}, seed: 7,
        });
    });

    it('notices a key the environment adds to requests, and one that is missing', async () => {
        const refused = (code) => ({ creditsLeft: async () => { throw Object.assign(new Error(code), { code }); } });
        expect(await probeNetworkKey({ creditsLeft: async () => ({ left: 10 }) })).toEqual({ added: true });
        expect(await probeNetworkKey(refused('missing_permissions'))).toEqual({ added: true });
        expect((await probeNetworkKey(refused('needs_authorization'))).added).toBe(false);
    });
});
