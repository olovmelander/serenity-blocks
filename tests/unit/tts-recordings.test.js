import {
    existsSync, mkdtempSync, readFileSync, rmSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    lineState, readRecordings, renderRecordings, RECORDINGS_FILE, saysLine, takeOf, wordsOf, writeRecordings,
} from '../../scripts/tts-recordings.mjs';
import {
    lineSettings, readScript, requestText, scriptLines,
} from '../../scripts/tts-script.mjs';
import { compareHeard, probeNetworkKey, requestBody } from '../../scripts/tts-elevenlabs.mjs';
import { shapeVoiceLine } from '../../scripts/tts-audio.mjs';

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

describe('What the voice is sent', () => {
    const TAGS = '[thoughtful] [meditative] [deep]';

    it('opens with the delivery tags and turns a pause between words into a clean [short pause]', () => {
        const v4 = (text, pauses = 'tags') => requestText(text, { model: 'eleven_v4', tags: TAGS, pauses });
        expect(v4('Sit comfortably... let your shoulders drop... and breathe.'))
            .toBe(`${TAGS} Sit comfortably, [short pause] let your shoulders drop, [short pause] and breathe.`);
        expect(v4('A few quiet minutes... There\'s nothing to get right.'))
            .toBe(`${TAGS} A few quiet minutes. [short pause] There's nothing to get right.`);
        // A closing '...' draws the last word out.
        expect(v4('Breathe in...')).toBe(`${TAGS} Breathe in...`);
        expect(v4('Sit... and rest.', 'ellipsis')).toBe(`${TAGS} Sit... and rest.`);
        expect(v4('Rest. [pause 2s] Now.')).toBe(`${TAGS} Rest. [long pause] Now.`);
    });

    it('sends a model without tags plain words and break tags', () => {
        expect(requestText('Sit... and rest. [pause 1s] Now.', { model: 'eleven_multilingual_v2', tags: TAGS, pauses: 'tags' }))
            .toBe('Sit... and rest. <break time="1s" /> Now.');
    });

    it('records with the tags that suited olov-voice, and its pauses as tags', () => {
        const { voice } = readScript();
        expect(voice).toMatchObject({ voice_id: 'oVRBQOcE5xQoswjGIb1u', model_id: 'eleven_v4', pauses: 'tags' });
        const { quick, ...calm } = voice.deliveries;
        Object.values(calm).forEach((delivery) => expect(delivery.tags).toBe(TAGS));
        // A take for a breath of a second: the calm tags drew even "Release" out to 1.4 s.
        expect(quick).toMatchObject({ tags: '', tail_ms: expect.any(Number) });
    });

    it('keeps a delivery\'s tail out of what is asked for: it shapes the clip, not the take', () => {
        const voice = {
            voice_settings: { stability: 0.5 },
            deliveries: {
                quick: {
                    speed: 1, loudness: -20, tags: '', tail_ms: 150,
                },
            },
        };
        expect(lineSettings(voice, 'quick')).toEqual({
            voiceSettings: { stability: 0.5, speed: 1 }, loudness: -20, tags: '', trim: { tailMs: 150 },
        });
        expect(lineSettings(voice, 'cue')).toEqual({
            voiceSettings: { stability: 0.5 }, loudness: -20, tags: '', trim: {},
        });
    });
});

describe('Shaping a take', () => {
    it('keeps what its delivery says after the last word: less for a quick take', () => {
        const rate = 24000;
        // A quarter second of quiet, half a second of voice, then a second of quiet.
        const samples = new Float32Array(rate * 1.75);
        for (let i = 0; i < rate / 2; i += 1) samples[rate / 4 + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate);
        const voice = { deliveries: { cue: { loudness: -20 }, quick: { loudness: -20, tail_ms: 150 } } };
        const seconds = (delivery) => {
            const { loudness, trim } = lineSettings(voice, delivery);
            return shapeVoiceLine(samples, rate, { targetLufs: loudness, trim }).seconds;
        };
        // 90 ms before the voice; after it the trim's 280 ms, or the quick delivery's 150.
        expect(seconds('cue')).toBeCloseTo(0.09 + 0.5 + 0.28, 2);
        expect(seconds('quick')).toBeCloseTo(0.09 + 0.5 + 0.15, 2);
    });
});
