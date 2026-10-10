/**
 * The ElevenLabs recorder end to end, against a stand-in for the API: a copy of the recorder in a
 * temporary folder records a three-line script the way a real session goes (a plan without
 * 44.1 kHz WAV, a model that refuses a request option, a rate limit, a line that comes back
 * saying an extra word), and the game's index, the record of takes and the shipped MP3s follow.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import { wavFromFloats } from '../../scripts/tts-audio.mjs';

const ROOT = path.resolve(__dirname, '../..');
const RECORDER_FILES = [
    'generate-tts.js', 'index-breathwork-voices.mjs', 'tts-audio.mjs', 'tts-elevenlabs.mjs', 'tts-recordings.mjs', 'tts-script.mjs',
];
const VOICE = 'StandInVoice00000001';
const OWNER = 'ownerid0000000042';
const LIBRARY_VOICE = 'LibraryVoice00000002';

const SCRIPT = {
    voice: {
        provider: 'elevenlabs',
        voice_id: VOICE,
        voice_name: 'Stand-in',
        model_id: 'eleven_v4',
        language_code: 'en',
        output_format: 'wav_44100',
        fallback_output_format: ['wav_24000', 'pcm_24000'],
        voice_settings: {
            stability: 0.6, similarity_boost: 0.8, style: 0, speed: 0.93,
        },
        deliveries: {
            guide: { loudness: -20, tags: '[Calm, soothing, slow narration]' },
            cue: { loudness: -20, tags: '[Soft, slow voice]' },
            still: { loudness: -22, tags: '[Very soft, slow, peaceful voice]' },
        },
        ship: { format: 'mp3', bitrate_kbps: 96 },
    },
    groups: [
        {
            id: 'tide',
            delivery: 'guide',
            lines: [
                { id: 'r1_active', text: 'In with the wave... and out as it slides away.' },
                { id: 'integration', delivery: 'still', text: 'Let the counting go.' },
            ],
        },
        {
            id: 'cues',
            delivery: 'cue',
            context: { previous: 'Follow the light, and breathe slowly through your nose.' },
            lines: [{ id: 'breathe_in_soft', text: 'Breathe in...' }],
        },
    ],
};

/** A second of a voice-like tone: enough energy for the loudness pass to work on. */
function toneWav(sampleRate) {
    const samples = new Float32Array(sampleRate);
    for (let i = 0; i < samples.length; i += 1) {
        const envelope = Math.min(1, i / 2000, (samples.length - i) / 2000);
        samples[i] = 0.3 * envelope * Math.sin((2 * Math.PI * 220 * i) / sampleRate) * (1 + 0.3 * Math.sin((2 * Math.PI * 3 * i) / sampleRate));
    }
    return { samples, wav: wavFromFloats(samples, sampleRate) };
}

/** The stand-in API. `state.heardFor()` decides what Speech to Text hears next. */
function standIn() {
    const calls = [];
    const state = { rateLimited: false, heardFor: () => '' };
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://stand-in');
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
            const raw = Buffer.concat(chunks);
            const json = (status, body, headers = {}) => {
                response.writeHead(status, { 'content-type': 'application/json', ...headers });
                response.end(JSON.stringify(body));
            };
            const key = request.headers['xi-api-key'];
            calls.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), key });
            if (url.pathname.startsWith('/preview/')) {
                response.writeHead(200, { 'content-type': 'audio/mpeg' });
                response.end(Buffer.from('ID3 preview audio'));
                return;
            }
            if (key !== 'test-key') {
                json(401, { detail: { status: 'needs_authorization', message: 'Neither authorization header nor xi-api-key received, please provide one.' } });
                return;
            }
            if (url.pathname === '/v1/user/subscription') {
                json(200, { character_limit: 100000, character_count: 1200, tier: 'creator' });
            } else if (url.pathname === '/v1/shared-voices') {
                const port = server.address().port;
                json(200, {
                    voices: [
                        {
                            voice_id: 'PopularVoice00000003', public_owner_id: OWNER, name: 'Popular Pricey', gender: 'female', rate: 2, usage_character_count_1y: 9e6, cloned_by_count: 10,
                        },
                        {
                            voice_id: LIBRARY_VOICE,
                            public_owner_id: OWNER,
                            name: 'Quiet Shore',
                            gender: 'female',
                            age: 'middle_aged',
                            accent: 'british',
                            descriptive: 'calm',
                            use_case: 'narrative_story',
                            description: 'A soft, slow voice for meditation.',
                            usage_character_count_1y: 2.5e6,
                            cloned_by_count: 812,
                            preview_url: `http://127.0.0.1:${port}/preview/quiet-shore.mp3`,
                        },
                    ],
                    has_more: false,
                });
            } else if (url.pathname.startsWith('/v1/voices/add/')) {
                json(200, { voice_id: url.pathname.split('/').pop() });
            } else if (url.pathname.startsWith('/v1/text-to-speech/')) {
                const body = JSON.parse(raw.toString('utf8'));
                const format = url.searchParams.get('output_format');
                calls.at(-1).body = body;
                if (format === 'wav_44100') {
                    json(403, { detail: { status: 'output_format_not_allowed', message: 'This output format is not available on your plan.' } });
                } else if (body.language_code || body.previous_text) {
                    json(422, { detail: { status: 'invalid_request', message: 'language_code is not supported for this model.' } });
                } else if (!state.rateLimited && body.text.includes('Let the counting go')) {
                    state.rateLimited = true;
                    json(429, { detail: { status: 'too_many_concurrent_requests', message: 'Too many requests.' } }, { 'retry-after': '0.01' });
                } else {
                    calls.at(-1).spoke = true;
                    response.writeHead(200, { 'content-type': 'audio/wav', 'request-id': `req-${calls.length}`, 'character-cost': String(body.text.length) });
                    response.end(toneWav(Number(format.split('_')[1])).wav);
                }
            } else if (url.pathname === '/v1/speech-to-text') {
                const form = raw.toString('latin1');
                calls.at(-1).model = /name="model_id"\r\n\r\n([^\r]+)/.exec(form)?.[1];
                json(200, { text: state.heardFor(), language_code: 'en', words: [] });
            } else {
                json(404, { detail: { status: 'not_found', message: `No route ${url.pathname}` } });
            }
        });
    });
    return { server, calls, state };
}

function run(dir, args, env = {}) {
    return new Promise((resolve) => {
        execFile(process.execPath, [path.join(dir, 'scripts', 'generate-tts.js'), ...args], {
            cwd: dir, env: { ...process.env, ...env }, timeout: 60_000,
        }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: `${stdout}${stderr}` }));
    });
}

let dir;
let api;
let base;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hale-recorder-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    RECORDER_FILES.forEach((file) => fs.copyFileSync(path.join(ROOT, 'scripts', file), path.join(dir, 'scripts', file)));
    fs.writeFileSync(path.join(dir, 'scripts', 'tts-script.json'), JSON.stringify(SCRIPT, null, 2));
    fs.mkdirSync(path.join(dir, 'src', 'ui', 'effects'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'public', 'assets', 'audio', 'breathwork', 'voices'), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    api = standIn();
    await new Promise((resolve) => { api.server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${api.server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve) => { api?.server.close(resolve); });
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const env = () => ({ ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_API_BASE: base });
const voices = (...parts) => path.join(dir, 'public', 'assets', 'audio', 'breathwork', 'voices', ...parts);
const recordings = () => JSON.parse(fs.readFileSync(path.join(dir, 'scripts', 'tts-recordings.json'), 'utf8')).clips;

describe('Recording the breathing voice with ElevenLabs', () => {
    it('explains how to give it a key when none reaches the API', async () => {
        const result = await run(dir, [], { ELEVENLABS_API_KEY: '', ELEVENLABS_API_BASE: base });
        expect(result.code).toBe(1);
        expect(result.out).toContain('Set ELEVENLABS_API_KEY');
        expect(result.out).toContain('network secret');
    });

    it('records every line through the plan\'s limits, ships MP3s the game indexes, and listens back', async () => {
        // Speech to Text hears every line right, except the cue, which comes back saying its tag
        // (with one line in flight, lines are heard in the order they were recorded).
        const heard = [
            'In with the wave, and out as it slides away.',
            'Let the counting go.',
            'Soft, slow voice. Breathe in.',
        ];
        let heardIndex = 0;
        api.state.heardFor = () => heard[heardIndex++] || '';
        const result = await run(dir, ['--concurrency=1'], env());
        expect(result.out).toContain('wav_44100 is not on this plan: using wav_24000 from here.');
        expect(result.out).toContain('does not take a language code or context: asking without them from here.');
        expect(result.out).toContain('Credits left this period: 98800 of 100000 (creator).');
        ['tide/r1_active.mp3', 'tide/integration.mp3', 'cues/breathe_in_soft.mp3'].forEach((file) => {
            const bytes = fs.readFileSync(voices(...file.split('/')));
            expect(bytes.length, file).toBeGreaterThan(1000);
            // An MPEG audio frame (or an ID3 header) opens the file.
            expect(bytes[0] === 0xff || bytes.toString('latin1', 0, 3) === 'ID3', file).toBe(true);
        });
        expect(fs.existsSync(path.join(dir, 'tts-masters', 'tide', 'r1_active.wav'))).toBe(true);
        const asked = api.calls.filter((call) => call.path.startsWith('/v1/text-to-speech/') && call.body);
        // The first request asked with everything; the model refused the language code and context.
        expect(asked[0].body).toMatchObject({
            model_id: 'eleven_v4', voice_settings: { stability: 0.6, similarity_boost: 0.8 }, language_code: 'en',
        });
        const speak = asked.filter((call) => call.spoke);
        expect(speak).toHaveLength(3);
        // v4 takes stability and similarity only, and the delivery's tags open the text.
        expect(speak[0].body.voice_settings).toEqual({ stability: 0.6, similarity_boost: 0.8 });
        expect(speak.at(-1).body.text).toBe('[Soft, slow voice] Breathe in...');
        expect(speak.at(-1).body.language_code).toBeUndefined();
        expect(speak.every((call) => Number.isInteger(call.body.seed))).toBe(true);
        expect(api.calls.filter((call) => call.path === '/v1/speech-to-text').every((call) => call.model === 'scribe_v2')).toBe(true);
        // The cue said its tag aloud: flagged, with the command that records it again.
        expect(result.out).toContain('✗ cues/breathe_in_soft: heard "Soft, slow voice. Breathe in." (added "soft slow voice")');
        expect(result.out).toContain('Record those again: npm run tts:record -- --retake=cues/breathe_in_soft');
        expect(result.code).toBe(1);
        const clips = recordings();
        // Who said it stays readable: the voice's name.
        expect(clips['tide/r1_active']).toMatchObject({
            voice: 'Stand-in', model: 'eleven_v4', heard: 'match', seconds: expect.any(Number),
        });
        expect(clips['cues/breathe_in_soft'].heard).toBe('differs');
        const index = fs.readFileSync(path.join(dir, 'src', 'ui', 'effects', 'breathwork-recorded-voices.js'), 'utf8');
        expect(index).toContain("'tide/r1_active': 'voices/tide/r1_active.mp3'");
        expect(index).toContain("'cues/breathe_in_soft': 'voices/cues/breathe_in_soft.mp3'");
    }, 60_000);

    it('records a flagged line again with a new seed, and leaves the rest alone', async () => {
        const before = api.calls.length;
        const firstSeed = api.calls.filter((call) => call.spoke && call.body.text === '[Soft, slow voice] Breathe in...').at(-1).body.seed;
        api.state.heardFor = () => 'Breathe in.';
        const result = await run(dir, ['--retake=cues/breathe_in_soft'], env());
        expect(result.code).toBe(0);
        const speak = api.calls.slice(before).filter((call) => call.spoke);
        expect(speak.map((call) => call.body.text)).toEqual(['[Soft, slow voice] Breathe in...']);
        expect(speak[0].body.seed).not.toBe(firstSeed);
        expect(recordings()['cues/breathe_in_soft']).toMatchObject({ retake: 1, heard: 'match' });
        const again = await run(dir, [], env());
        expect(again.out).toContain('Nothing to record: all 3 lines are current');
    }, 60_000);

    it('finds meditative voices in the Voice Library, keeps their previews, and auditions one on our lines', async () => {
        const result = await run(dir, ['--browse=meditation,calm'], env());
        expect(result.code).toBe(0);
        const shelf = api.calls.filter((call) => call.path === '/v1/shared-voices');
        expect(shelf.map((call) => call.query.search)).toEqual(['meditation', 'calm']);
        expect(shelf[0].query).toMatchObject({ language: 'en', sort: 'usage_character_count_1y' });
        // The voice that costs more per line comes after the one that does not.
        expect(result.out.indexOf('Quiet Shore')).toBeLessThan(result.out.indexOf('Popular Pricey'));
        expect(result.out).toContain('costs more: ×2');
        expect(result.out).toContain(`--audition="${OWNER}/${LIBRARY_VOICE}"`);
        const preview = path.join(dir, 'tts-auditions', 'library', '01-Quiet_Shore.mp3');
        expect(fs.readFileSync(preview, 'utf8')).toBe('ID3 preview audio');

        const audition = await run(dir, [`--audition=${OWNER}/${LIBRARY_VOICE}`, '--only=tide/r1_active'], env());
        expect(audition.code).toBe(0);
        expect(audition.out).toContain('Added "Quiet Shore" from the Voice Library to My Voices.');
        expect(api.calls.some((call) => call.method === 'POST' && call.path === `/v1/voices/add/${OWNER}/${LIBRARY_VOICE}`)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'tts-auditions', 'Quiet_Shore', 'eleven_v4', 'tide-r1_active.mp3'))).toBe(true);
        // One's own voice, at two stabilities: v4's main control besides its tags.
        const before = api.calls.length;
        const steadier = await run(dir, [`--audition=${VOICE}`, '--only=tide/r1_active', '--stabilities=0.45,0.75'], env());
        expect(steadier.code, steadier.out).toBe(0);
        expect(steadier.out).not.toContain('wav_24000 is not on this plan');
        const asked = api.calls.slice(before).filter((call) => call.spoke).map((call) => call.body.voice_settings.stability);
        expect(asked.sort()).toEqual([0.45, 0.75]);
        ['0.45', '0.75'].forEach((value) => {
            expect(fs.existsSync(path.join(dir, 'tts-auditions', VOICE, `eleven_v4-stability-${value}`, 'tide-r1_active.mp3')), value).toBe(true);
        });
        // An audition never touches what the game plays.
        expect(recordings()['tide/r1_active'].voice).toBe('Stand-in');
    }, 60_000);

    it('listens back on request and passes when every line says its words', async () => {
        const words = new Map([
            [0, 'In with the wave and out as it slides away.'], [1, 'Let the counting go.'], [2, 'Breathe in.'],
        ]);
        let next = 0;
        api.state.heardFor = () => words.get(next++) ?? '';
        const result = await run(dir, ['--verify', '--concurrency=1'], env());
        expect(result.out).toContain('Listened back to 3 lines: 3 say their words');
        expect(result.code).toBe(0);
    }, 60_000);
});
