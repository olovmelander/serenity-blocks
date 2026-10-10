import {
    existsSync, mkdtempSync, readFileSync, rmSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    lineState, readRecordings, renderRecordings, RECORDINGS_FILE, takeOf, writeRecordings,
} from '../../scripts/tts-recordings.mjs';

const SPEAKER = {
    model: 'gemini-2.5-pro-preview-tts', voice: 'Algieba', style: '[Calm]', text: 'Breathe in...',
};
const SCRIPT = JSON.parse(readFileSync(path.resolve(__dirname, '../../scripts/tts-script.json'), 'utf8'));
let dir;

afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
});

describe('Hale voice takes', () => {
    it('fingerprints everything that shapes a take, and keeps who said it readable', () => {
        const take = takeOf(SPEAKER);
        expect(take).toEqual({ voice: 'Algieba', model: SPEAKER.model, take: expect.stringMatching(/^[0-9a-f]{12}$/) });
        expect(takeOf({ ...SPEAKER })).toEqual(take);
        ['model', 'voice', 'style', 'text'].forEach((field) => {
            expect(takeOf({ ...SPEAKER, [field]: `${SPEAKER[field]}!` }).take, field).not.toBe(take.take);
        });
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

    it('keeps a take for clips of the script only, each naming its speaker', () => {
        expect(existsSync(RECORDINGS_FILE)).toBe(true);
        const scripted = new Set(SCRIPT.sessions.flatMap((group) => group.clips.map((clip) => `${group.id}/${clip.filename}`)));
        const entries = Object.entries(readRecordings());
        expect(entries.length).toBeGreaterThan(0);
        entries.forEach(([clip, entry]) => {
            expect(scripted.has(clip), `${clip} left the script: delete its entry (npm run tts:record does)`).toBe(true);
            expect(entry).toEqual({
                voice: expect.any(String), model: expect.any(String), take: expect.stringMatching(/^[0-9a-f]{12}$/),
            });
        });
    });
});
