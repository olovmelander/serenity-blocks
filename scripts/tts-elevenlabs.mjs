/**
 * ElevenLabs text-to-speech over plain HTTP: building a request for each model, reading its
 * errors, finding a voice by name and the credits left. Used by scripts/generate-tts.js.
 *
 * API reference (checked 2026-10-10): POST /v1/text-to-speech/{voice_id}?output_format=...,
 * header xi-api-key. Models: eleven_v4 (the most natural: audio tags such as
 * [Quiet, measured narration], stability and similarity only, no speed, style or SSML; pauses
 * come from punctuation and tags), eleven_v3 (audio tags, stability only),
 * eleven_multilingual_v2 (all five voice settings, speed 0.7-1.2, <break> tags) and
 * eleven_flash_v2_5 (fast, cheaper). Also the Voice Library (GET /v1/shared-voices, POST
 * /v1/voices/add/{owner}/{voice}) and Speech to Text (POST /v1/speech-to-text, scribe_v2), which
 * checks that a take says its line. See scripts/tts-audio-tracking.md.
 */
import crypto from 'node:crypto';
import { isTagModel } from './tts-script.mjs';

export const DEFAULT_API_BASE = 'https://api.elevenlabs.io';
/** USD per 1,000 characters on the API (pricing page, 2026-10-10). */
const PRICE_PER_1K = { flash: 0.04, other: 0.08 };

/** The voice settings a model honours: v4 stability and similarity, v3 stability, the rest all five. */
export function settingsForModel(model, settings = {}) {
    const pick = (keys) => Object.fromEntries(keys.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
    if (/^eleven_v4/.test(model)) return pick(['stability', 'similarity_boost']);
    if (/^eleven_v3/.test(model)) return pick(['stability']);
    const all = pick(['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed']);
    if (all.speed !== undefined) all.speed = Math.min(1.2, Math.max(0.7, Number(all.speed)));
    return all;
}

/** A line's own seed: the same take every run, until a retake asks for another. */
export function seedFor(key, retake = 0) {
    return crypto.createHash('sha256').update(`${key}#${retake}`).digest().readUInt32BE(0);
}

/**
 * The JSON body for one line. `lean` leaves out what not every model takes (a language code and
 * the unspoken context): the recorder falls back to it when a model refuses them.
 */
export function requestBody({
    text, model, settings, seed, languageCode, context = {}, lean = false,
}) {
    const body = { text, model_id: model, voice_settings: settingsForModel(model, settings) };
    if (Number.isInteger(seed)) body.seed = seed;
    if (lean) return body;
    // multilingual v2 does not take a language code; the newer models do.
    if (languageCode && !/^eleven_multilingual_v2/.test(model)) body.language_code = languageCode;
    if (context.previous) body.previous_text = context.previous;
    if (context.next) body.next_text = context.next;
    return body;
}

/** A refusal of an optional request field (a model that takes no language code or context). */
export const refusesOptionalFields = (error) => error?.status === 422
    && /language_code|previous_text|next_text|unsupported_language|not supported/i.test(`${error.code} ${error.message}`);

export function estimateCost(characters, model) {
    const rate = /flash|turbo/.test(model) ? PRICE_PER_1K.flash : PRICE_PER_1K.other;
    return (characters / 1000) * rate;
}

/** A failed request: what went wrong, and whether to retry, fall back or stop the run. */
export class TtsError extends Error {
    constructor(message, {
        status = 0, code = '', action = 'skip', retryAfter = 0, requestId = '',
    } = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.action = action;
        this.retryAfter = retryAfter;
        this.requestId = requestId;
    }
}

const STOP_HINTS = {
    401: 'The API key was refused (or lacks text-to-speech permission): check ELEVENLABS_API_KEY.',
    402: 'Out of credits: the run continues where it stopped once credits are topped up or renewed.',
    403: 'This account may not use that request (a plan limit or a restricted key).',
    404: 'Not found: check voice.voice_id (or voice_name) and voice.model_id in scripts/tts-script.json. A Professional '
        + 'Voice Clone speaks Eleven v4 only once trained for it (My Voices, the voice, + beside Eleven v4); until then '
        + 'audition it with --model=eleven_multilingual_v2.',
    422: 'The request was rejected: check voice.voice_settings in scripts/tts-script.json.',
};

/**
 * Read an error response. Statuses are checked by `detail.status`, then `detail.code`, then the
 * HTTP status, since the API's newer `code` is often generic where the legacy `status` is exact.
 * @returns {TtsError} action 'retry' | 'fallback-format' | 'stop' | 'skip'
 */
export function classifyError(httpStatus, body, headers = {}) {
    const detail = body?.detail;
    const list = Array.isArray(detail) ? detail : null;
    const legacy = String((!list && detail?.status) || '');
    const code = String((!list && detail?.code) || '');
    const type = String((!list && detail?.type) || '');
    const message = list ? list.map((item) => `${(item.loc || []).join('.')}: ${item.msg}`).join('; ')
        : String(detail?.message || detail || body?.message || `HTTP ${httpStatus}`);
    const requestId = String((!list && detail?.request_id) || headers['request-id'] || headers['x-trace-id'] || '');
    const retryAfter = Number.parseFloat(headers['retry-after']) || 0;
    const reason = `${legacy} ${code} ${type}`;
    let action = 'skip';
    if (/output_format_not_allowed|subscription_required|invalid_output_format/.test(reason)) action = 'fallback-format';
    else if (/quota_exceeded|insufficient_credits|payment_required|invalid_api_key|needs_authorization|missing_permissions|unauthorized/.test(reason)) action = 'stop';
    else if (/voice_not_found|model_not_found|unsupported_model|model_access_denied|invalid_uid/.test(reason)) action = 'stop';
    else if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) action = 'retry';
    else if ([401, 402, 403, 404, 422].includes(httpStatus)) action = 'stop';
    let hint = '';
    if (action === 'stop') {
        if (/quota_exceeded|insufficient_credits|payment_required/.test(reason)) hint = STOP_HINTS[402];
        else if (/voice_not_found|model_not_found|unsupported_model|model_access_denied|invalid_uid/.test(reason)) hint = STOP_HINTS[404];
        else if (/invalid_api_key|needs_authorization|missing_permissions|unauthorized/.test(reason)) hint = STOP_HINTS[401];
        else hint = STOP_HINTS[httpStatus] || '';
    }
    return new TtsError(`${message}${legacy ? ` (${legacy})` : ''}${hint ? `. ${hint}` : ''}`, {
        status: httpStatus, code: legacy || code, action, retryAfter, requestId,
    });
}

/** Seconds to wait before retry `attempt` (1, 2, 4, 8, 16 s with jitter), or what the API asks. */
export function retryDelay(attempt, retryAfter = 0, random = Math.random) {
    if (retryAfter > 0) return Math.min(60, retryAfter);
    const base = Math.min(60, 2 ** (attempt - 1));
    return base * (0.8 + random() * 0.4);
}

/** The audio of an output format, as mono floats: WAV is read from its header, PCM is S16LE. */
export function formatSampleRate(format) {
    const rate = Number(String(format).split('_')[1]);
    return Number.isFinite(rate) ? rate : 0;
}

/** A small client: fetch is injected so the recorder can be tested against a stand-in. */
export function createElevenLabsClient({ apiKey, fetchImpl = globalThis.fetch, apiBase = DEFAULT_API_BASE } = {}) {
    const base = String(apiBase).replace(/\/$/, '');
    // Without a key here, the environment may add one on the way (see probeNetworkKey).
    const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'xi-api-key': apiKey } : {}) };
    const readHeaders = (response) => Object.fromEntries([...(response.headers?.entries?.() || [])].map(([key, value]) => [key.toLowerCase(), value]));

    async function call(path, init = {}) {
        let response;
        try {
            response = await fetchImpl(`${base}${path}`, { headers, ...init });
        } catch (error) {
            throw new TtsError(`Network error: ${error.message}`, { action: 'retry' });
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw classifyError(response.status, body, readHeaders(response));
        return body;
    }
    const get = (path) => call(path);

    return {
        /** One line: the audio bytes, and the request id and character cost the API reports. */
        async speak(voiceId, format, body) {
            let response;
            try {
                response = await fetchImpl(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(format)}`, {
                    method: 'POST', headers, body: JSON.stringify(body),
                });
            } catch (error) {
                throw new TtsError(`Network error: ${error.message}`, { action: 'retry' });
            }
            const responseHeaders = readHeaders(response);
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw classifyError(response.status, errorBody, responseHeaders);
            }
            const audio = Buffer.from(await response.arrayBuffer());
            if (!audio.length) throw new TtsError('Empty audio in the response', { action: 'retry' });
            return {
                audio,
                requestId: responseHeaders['request-id'] || responseHeaders['x-trace-id'] || '',
                characterCost: Number(responseHeaders['character-cost']) || null,
            };
        },
        /** The account's voices whose name matches exactly (case-insensitive). */
        async findVoices(name) {
            const body = await get(`/v2/voices?search=${encodeURIComponent(name)}&page_size=100`);
            const wanted = String(name).trim().toLowerCase();
            return (body.voices || []).filter((voice) => String(voice.name).trim().toLowerCase() === wanted);
        },
        /** Credits left this period, or null when the account does not say. */
        async creditsLeft() {
            const body = await get('/v1/user/subscription');
            const limit = Number(body.character_limit);
            const used = Number(body.character_count);
            return Number.isFinite(limit) && Number.isFinite(used) ? { left: Math.max(0, limit - used), limit, tier: body.tier } : null;
        },
        /** Voices in the shared Voice Library matching a search, most used first. */
        async browseLibrary({
            search = '', gender = '', language = 'en', pageSize = 30, sort = 'usage_character_count_1y',
        } = {}) {
            const query = new URLSearchParams({ page_size: String(pageSize), sort });
            if (search) query.set('search', search);
            if (gender) query.set('gender', gender);
            if (language) query.set('language', language);
            const body = await get(`/v1/shared-voices?${query}`);
            return body.voices || [];
        },
        /** Add a Voice Library voice to My Voices, so it can speak. Returns the id to speak with. */
        async addLibraryVoice(ownerId, voiceId, name) {
            const body = await call(`/v1/voices/add/${encodeURIComponent(ownerId)}/${encodeURIComponent(voiceId)}`, {
                method: 'POST', body: JSON.stringify({ new_name: name }),
            });
            return body.voice_id || voiceId;
        },
        /** What a recording says, heard by Speech to Text. */
        async transcribe(audio, { filename = 'line.mp3', model = 'scribe_v2', languageCode = 'en' } = {}) {
            const form = new FormData();
            form.append('model_id', model);
            if (languageCode) form.append('language_code', languageCode);
            form.append('tag_audio_events', 'false');
            form.append('file', new Blob([audio], { type: filename.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }), filename);
            // fetch sets the multipart boundary itself: only the key is our header here.
            const body = await call('/v1/speech-to-text', {
                method: 'POST', body: form, headers: apiKey ? { 'xi-api-key': apiKey } : {},
            });
            return String(body.text || '');
        },
    };
}

/** Number words, so a transcript's "4, 7, 8" matches a script's "Four, seven, eight". */
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** Words a transcript may spell another way that sound the same. */
const SOUNDS_LIKE = { hail: 'hale', hayle: 'hale', ok: 'okay' };

/** The words of a line, as a listener hears them: lower case, no punctuation, numbers spelled. */
export function heardWords(text) {
    return String(text).toLowerCase()
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[’']/g, '')
        .replace(/\d+/g, (digits) => NUMBER_WORDS[Number(digits)] || digits)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((word) => SOUNDS_LIKE[word] || word);
}

/**
 * How a transcript compares with its line: the words missing and the words added, and a verdict:
 * 'match', 'close' (one word apart, worth a listen) or 'differs' (record again).
 */
export function compareHeard(expected, heard) {
    const want = heardWords(expected);
    const got = heardWords(heard);
    // Word-level edit distance, with the operations kept to name what differs.
    const rows = want.length + 1;
    const cols = got.length + 1;
    // cost[i][j]: edits between the first i words wanted and the first j heard.
    const cost = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (__, j) => Math.max(i, j) * Number(i === 0 || j === 0)));
    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const same = want[i - 1] === got[j - 1] ? 0 : 1;
            cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + same);
        }
    }
    const missing = [];
    const added = [];
    for (let i = want.length, j = got.length; i > 0 || j > 0;) {
        if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (want[i - 1] === got[j - 1] ? 0 : 1)) {
            if (want[i - 1] !== got[j - 1]) {
                missing.unshift(want[i - 1]);
                added.unshift(got[j - 1]);
            }
            i -= 1;
            j -= 1;
        } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
            missing.unshift(want[i - 1]);
            i -= 1;
        } else {
            added.unshift(got[j - 1]);
            j -= 1;
        }
    }
    const distance = cost[want.length][got.length];
    let verdict = 'differs';
    if (distance === 0) verdict = 'match';
    else if (distance === 1 && want.length >= 4) verdict = 'close';
    return {
        verdict, distance, missing, added,
    };
}

/**
 * Whether requests reach the API with a key although this process has none: a cloud environment
 * can add it on the way (a network secret for api.elevenlabs.io), so the key never enters the
 * container. Asks for the subscription, which costs nothing.
 * @returns {Promise<{added: boolean, error?: TtsError}>}
 */
export async function probeNetworkKey(client) {
    try {
        await client.creditsLeft();
        return { added: true };
    } catch (error) {
        // A key arrived but may not read the subscription (a restricted key): it can still record.
        if (error.code === 'missing_permissions') return { added: true };
        return { added: false, error };
    }
}

export { isTagModel };
