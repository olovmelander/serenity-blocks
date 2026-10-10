/**
 * Record the breathing voice with ElevenLabs: every line in scripts/tts-script.json, shaped
 * (silence trimmed, loudness evened, edges faded) and written as
 * public/assets/audio/breathwork/voices/<group>/<id>.mp3, the format the game ships.
 *
 * The speaker is set once, in tts-script.json's "voice" (voice_id or voice_name, model_id, voice
 * settings, and a delivery per kind of line). A run records every line that is missing, or was
 * recorded by another speaker, with other settings or from other words; scripts/tts-recordings.json
 * keeps the take of each line. So a new speaker is: change "voice", run again. A run that stops
 * part-way (credits, a lost connection) continues where it stopped when run again.
 *
 *   npm run tts:list                                   every line, its state, and what a run costs
 *   npm run tts:record                                 record what is missing or out of date
 *   npm run tts:record -- --group=first,tide           only these groups
 *   npm run tts:record -- --only=tide/r1_carry         only these lines (a bare id matches in every group)
 *   npm run tts:record -- --retake=tide/r1_carry       a new take of lines already recorded (new seed)
 *   npm run tts:record -- --overwrite                  retake every selected line
 *   npm run tts:record -- --browse[=meditation,calm] [--gender=female]
 *                       look through the Voice Library: the most used voices that match, their
 *                       details and their free previews (tts-auditions/library/); nothing is spent
 *   npm run tts:record -- --audition="Name A,<owner id>/<voice id>" [--models=eleven_v4,eleven_multilingual_v2]
 *                       [--stabilities=0.45,0.6,0.75]
 *                       three lines per voice (model, stability), to tts-auditions/: the game is
 *                       untouched. A library voice (as --browse prints it) is added to My Voices first.
 *   npm run tts:record -- --verify                     listen back: Speech to Text hears every recorded
 *                       line and says which do not say their words (a record run does this for the
 *                       lines it made, unless --no-verify)
 *   npm run tts:record -- --reshape                    re-shape and re-encode from the saved masters
 *                       (tts-masters/), after changing loudness or bitrate: no requests, no cost
 *   --voice=<id or name>  --model=<model id>  --concurrency=2   overrides for one run
 *
 * Needs ELEVENLABS_API_KEY, from the environment or a git-ignored .env.local file, or a cloud
 * environment that adds the key to requests itself (a network secret for api.elevenlabs.io).
 * Afterwards the recorded-voice index is refreshed, so the game speaks the new lines
 * (index-breathwork-voices.mjs). ELEVENLABS_API_BASE replaces the API address (a stand-in for tests).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { indexBreathworkVoices } from './index-breathwork-voices.mjs';
import {
    lineState, readRecordings, takeOf, wordsOf, writeRecordings,
} from './tts-recordings.mjs';
import {
    AUDIO_ROOT, lineSettings, readScript, requestText, scriptLines,
} from './tts-script.mjs';
import {
    compareHeard, createElevenLabsClient, estimateCost, formatSampleRate, isTagModel, probeNetworkKey, refusesOptionalFields,
    requestBody, retryDelay, seedFor,
} from './tts-elevenlabs.mjs';
import {
    encodeMp3, floatsFromPcm16, floatsFromWav, shapeVoiceLine, wavFromFloats,
} from './tts-audio.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTERS_DIR = path.join(ROOT, 'tts-masters');
const AUDITION_DIR = path.join(ROOT, 'tts-auditions');
const LOG_FILE = path.join(ROOT, 'scripts', 'tts-generated.log');
// What an audition says unless --group or --only picks other lines: a welcome, a cue, a closing.
const AUDITION_LINES = ['session_intros/first_intro', 'cues/breathe_in_soft', 'closings/sleep'];
const MAX_ATTEMPTS = 6;

const argValue = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const listArg = (name) => argValue(name)?.split(',').map((item) => item.trim()).filter(Boolean) || null;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const log = (line) => {
    try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} | ${line}\n`); } catch { /* the log is a convenience */ }
};

const LIST_MODE = process.argv.includes('--list');
const OVERWRITE_MODE = process.argv.includes('--overwrite');
const RESHAPE_MODE = process.argv.includes('--reshape');
const ONLY_GROUPS = listArg('group');
const ONLY_LINES = [...(listArg('only') || []), ...(listArg('retake') || [])];
const RETAKES = new Set(listArg('retake') || []);
const AUDITION_VOICES = listArg('audition');
const AUDITION_MODELS = listArg('models');
/** Stability values to compare in an audition: Eleven v4's main control besides its tags. */
const AUDITION_STABILITIES = listArg('stabilities')?.map(Number).filter((value) => value >= 0 && value <= 1) || null;
const CONCURRENCY = Math.max(1, Math.min(5, Number(argValue('concurrency')) || 2));
const VOICE_ID = /^[A-Za-z0-9]{16,}$/;
/** A Voice Library voice, as --browse prints it: '<public owner id>/<voice id>'. */
const LIBRARY_VOICE = /^([A-Za-z0-9]{8,})\/([A-Za-z0-9]{16,})$/;
const BROWSE_MODE = process.argv.some((arg) => arg === '--browse' || arg.startsWith('--browse='));
const BROWSE_TERMS = listArg('browse') || ['meditation', 'calm', 'soothing', 'sleep'];
const GENDER = argValue('gender') || '';
const VERIFY_MODE = process.argv.includes('--verify');
const SKIP_VERIFY = process.argv.includes('--no-verify');
const LIBRARY_DIR = path.join(AUDITION_DIR, 'library');
const LIBRARY_FILE = path.join(LIBRARY_DIR, 'voices.json');

// The key may live in a git-ignored .env.local (or .env) instead of the shell (Node 20.12 and later).
for (const name of ['.env.local', '.env']) {
    const file = path.join(ROOT, name);
    if (process.env.ELEVENLABS_API_KEY || typeof process.loadEnvFile !== 'function') break;
    if (fs.existsSync(file)) process.loadEnvFile(file);
}
const API_KEY = process.env.ELEVENLABS_API_KEY;

/** The lines of the script, narrowed by --group and --only / --retake. */
function selectedLines(script) {
    return scriptLines(script)
        .filter((line) => !ONLY_GROUPS || ONLY_GROUPS.includes(line.group))
        .filter((line) => !ONLY_LINES.length || ONLY_LINES.includes(line.key) || ONLY_LINES.includes(line.id));
}

const shipPath = (key) => path.join(AUDIO_ROOT, 'voices', `${key}.mp3`);
const masterPath = (key) => path.join(MASTERS_DIR, `${key}.wav`);
const recordedFile = (key) => ['.mp3', '.wav'].map((ext) => path.join(AUDIO_ROOT, 'voices', `${key}${ext}`)).find((file) => fs.existsSync(file));

/** The speaker for this run: the script's voice, with any --voice / --model override. */
function speakerFrom(script) {
    const voice = { ...script.voice };
    const override = argValue('voice');
    if (override && VOICE_ID.test(override)) {
        voice.voice_id = override;
        voice.voice_name = '';
    } else if (override) {
        voice.voice_id = '';
        voice.voice_name = override;
    }
    voice.model_id = argValue('model') || voice.model_id || 'eleven_multilingual_v2';
    return voice;
}

/** What one line is asked for, and its take: everything that shapes the recording. */
function linePlan(line, voice) {
    const { voiceSettings, loudness, tags } = lineSettings(voice, line.delivery);
    const text = requestText(line.text, { model: voice.model_id, tags: isTagModel(voice.model_id) ? tags : '' });
    const take = takeOf({
        model: voice.model_id, voice: voice.voice_id || voice.voice_name, settings: voiceSettings, text,
    });
    return {
        ...line, request: text, settings: voiceSettings, loudness, take,
    };
}

function withStates(lines, recordings, voice) {
    return lines.map((line) => {
        const plan = linePlan(line, voice);
        const entry = recordings[line.key];
        return {
            ...plan, entry, state: lineState({ exists: Boolean(recordedFile(line.key)), entry, take: plan.take }),
        };
    });
}

/** Turn a response into mono floats, whatever format was asked for. */
function decode(audio, format) {
    if (format.startsWith('wav_')) return floatsFromWav(audio);
    if (format.startsWith('pcm_')) return { samples: floatsFromPcm16(audio), sampleRate: formatSampleRate(format) };
    throw new Error(`Ask for wav_* or pcm_* (got ${format}): the recorder shapes the audio itself`);
}

/** Shape a take, keep its master, and write the shipped MP3 (replacing an older WAV). */
function shipTake(key, samples, sampleRate, loudness, ship) {
    fs.mkdirSync(path.dirname(masterPath(key)), { recursive: true });
    fs.writeFileSync(masterPath(key), wavFromFloats(samples, sampleRate));
    const shaped = shapeVoiceLine(samples, sampleRate, { targetLufs: loudness });
    fs.mkdirSync(path.dirname(shipPath(key)), { recursive: true });
    fs.writeFileSync(shipPath(key), encodeMp3(shaped.samples, sampleRate, ship?.bitrate_kbps || 96));
    const wav = path.join(AUDIO_ROOT, 'voices', `${key}.wav`);
    if (fs.existsSync(wav)) fs.rmSync(wav);
    return shaped;
}

/**
 * Ask for one line, retrying what can be retried. Returns { samples, sampleRate, requestId }, or
 * throws a TtsError whose action is 'stop' (end the run) or 'skip' (move on).
 */
async function speakLine(client, voice, plan, state) {
    for (let attempt = 1; ; attempt += 1) {
        // Lines run side by side and share what the plan allows: each request keeps how it asked,
        // so a refusal moves on from that, not from what another line has moved on to since.
        const { format } = state;
        const lean = Boolean(state.lean);
        try {
            const result = await client.speak(voice.voice_id, format, requestBody({
                text: plan.request,
                model: voice.model_id,
                settings: plan.settings,
                seed: plan.seed,
                languageCode: voice.language_code,
                context: plan.context,
                lean,
            }));
            return { ...decode(result.audio, format), requestId: result.requestId, characterCost: result.characterCost };
        } catch (error) {
            if (error.action === 'fallback-format' && (state.format !== format || nextFormat(voice, format))) {
                if (state.format === format) {
                    state.format = nextFormat(voice, format);
                    console.log(`  ${format} is not on this plan: using ${state.format} from here.`);
                }
                attempt -= 1;
                continue;
            }
            if (!lean && refusesOptionalFields(error)) {
                if (!state.lean) console.log(`  ${voice.model_id} does not take a language code or context: asking without them from here.`);
                state.lean = true;
                attempt -= 1;
                continue;
            }
            if (error.action === 'retry' && attempt < MAX_ATTEMPTS) {
                await sleep(retryDelay(attempt, error.retryAfter) * 1000);
                continue;
            }
            throw error;
        }
    }
}

/** The output format to try once `format` is refused: the script's fallbacks, in order. */
function nextFormat(voice, format) {
    const order = [voice.output_format || 'wav_44100', ...[voice.fallback_output_format || []].flat()];
    const index = order.indexOf(format);
    return index >= 0 ? order[index + 1] || null : null;
}

/** Run `work` over `items` with at most `limit` in flight; returning 'stop' ends it early. */
async function pool(items, limit, work) {
    let next = 0;
    let stopped = false;
    const worker = async () => {
        while (!stopped && next < items.length) {
            const item = items[next];
            next += 1;
            if (await work(item) === 'stop') stopped = true;
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return stopped;
}

async function resolveVoice(client, voice) {
    if (voice.voice_id) return voice;
    if (!voice.voice_name) {
        throw new Error('Choose a speaker first: set voice.voice_id (or voice.voice_name) in scripts/tts-script.json, '
            + 'or pass --voice=. Try candidates with --audition="Name A,Name B".');
    }
    const found = await client.findVoices(voice.voice_name);
    if (!found.length) throw new Error(`No voice named "${voice.voice_name}" in your ElevenLabs voices (add it to My Voices first).`);
    if (found.length > 1) console.log(`  ${found.length} voices are named "${voice.voice_name}": using the first (${found[0].voice_id}).`);
    console.log(`Voice "${voice.voice_name}" is ${found[0].voice_id}: put it in voice.voice_id to skip this lookup.`);
    return { ...voice, voice_id: found[0].voice_id };
}

async function record(script) {
    const client = createElevenLabsClient({ apiKey: API_KEY, apiBase: process.env.ELEVENLABS_API_BASE });
    const voice = await resolveVoice(client, speakerFrom(script));
    const recordings = readRecordings();
    const isRetake = (line) => OVERWRITE_MODE || RETAKES.has(line.key) || RETAKES.has(line.id);
    const lines = withStates(selectedLines(script), recordings, voice);
    const todo = lines.filter((line) => isRetake(line) || line.state === 'stale' || line.state === 'missing');
    console.log(`Speaker: ${voice.voice_name || voice.voice_id} · ${voice.model_id} · ${voice.output_format}`);
    if (!lines.length) {
        console.log('No line matches --group / --only (npm run tts:list shows every line).');
        process.exitCode = 1;
        return;
    }
    if (!todo.length) {
        console.log(`Nothing to record: all ${lines.length} lines are current (--retake=<line> or --overwrite for new takes).`);
        return;
    }
    const characters = todo.reduce((sum, line) => sum + line.request.length, 0);
    console.log(`${todo.length} of ${lines.length} lines to record: ${characters} characters, about $${estimateCost(characters, voice.model_id).toFixed(2)}.`);
    try {
        const credits = await client.creditsLeft();
        if (credits) console.log(`Credits left this period: ${credits.left} of ${credits.limit} (${credits.tier}).`);
        if (credits && credits.left < characters) console.log('  Not enough for all of it: the run stops when they run out, and continues next time.');
    } catch { /* a restricted key may not read the subscription: the run goes on */ }
    console.log('');

    const state = { format: voice.output_format || 'wav_44100' };
    let made = 0;
    let failed = 0;
    let stopped = null;
    await pool(todo, CONCURRENCY, async (line) => {
        // A retake asks for another seed; otherwise the line keeps its own, so a run is repeatable.
        const retake = (line.entry?.retake ?? 0) + (isRetake(line) ? 1 : 0);
        const plan = { ...line, seed: seedFor(line.key, retake) };
        try {
            const take = await speakLine(client, voice, plan, state);
            const shaped = shipTake(line.key, take.samples, take.sampleRate, line.loudness, voice.ship);
            recordings[line.key] = {
                ...line.take,
                voice: voice.voice_name || voice.voice_id,
                seconds: Math.round(shaped.seconds * 100) / 100,
                retake,
            };
            // Saved after every line, so a run that stops keeps what it made.
            writeRecordings(recordings);
            made += 1;
            console.log(`  ✓ ${line.key} (${shaped.seconds.toFixed(1)} s, ${shaped.lufs.toFixed(1)} LUFS)`);
            log(`${line.key} | ${voice.voice_id} | ${voice.model_id} | seed ${plan.seed} | ${take.requestId} | cost ${take.characterCost ?? '?'}`);
            return 'next';
        } catch (error) {
            failed += 1;
            console.log(`  ✗ ${line.key}: ${error.message}`);
            log(`${line.key} | FAILED | ${error.status || ''} ${error.code || ''} | ${error.requestId || ''} | ${error.message}`);
            if (error.action === 'stop' || !error.action) {
                stopped = error.message;
                return 'stop';
            }
            return 'next';
        }
    });

    if (made > 0) {
        const found = indexBreathworkVoices();
        console.log(`\nRecorded-voice index ${found.changed ? 'updated' : 'unchanged'}: ${Object.keys(found.entries).length} lines play in the game.`);
    }
    // Listen back to what this run made (Speech to Text): a spoken tag or a skipped word shows now.
    const fresh = todo.filter((line) => recordings[line.key]?.take === line.take.take && fs.existsSync(shipPath(line.key)));
    let misheard = 0;
    if (fresh.length && !SKIP_VERIFY) {
        console.log('\nListening back (Speech to Text; --no-verify skips this):');
        misheard = (await verify(client, fresh, recordings)).length;
    }
    const left = withStates(selectedLines(script), readRecordings(), voice).filter((line) => line.state === 'stale' || line.state === 'missing').length;
    console.log(`\n${stopped ? `Stopped: ${stopped}\n` : ''}Recorded ${made}${failed ? `, ${failed} failed` : ''}; ${left} line${left === 1 ? '' : 's'} still to record.`);
    if (left > 0) console.log(stopped ? 'Once that is sorted, run the same command again: it continues where it stopped.' : 'Run the same command again to record the rest.');
    if (stopped || failed || misheard) process.exitCode = 1;
}

/** Try voices (and models) on a few lines, written to tts-auditions/: nothing in the game changes. */
async function audition(script, names) {
    const client = createElevenLabsClient({ apiKey: API_KEY, apiBase: process.env.ELEVENLABS_API_BASE });
    const base = speakerFrom(script);
    const picked = ONLY_GROUPS || ONLY_LINES.length
        ? selectedLines(script) : scriptLines(script).filter((line) => AUDITION_LINES.includes(line.key));
    const models = AUDITION_MODELS || [base.model_id];
    console.log(`Audition: ${names.join(', ')} · ${models.join(', ')} · ${picked.length} line(s) each\n`);
    const takes = [];
    for (const name of names) {
        try {
            const library = LIBRARY_VOICE.exec(name);
            const label = library ? await addFromLibrary(client, library[1], library[2]) : name;
            let candidate = { ...base, voice_id: '', voice_name: name };
            if (library) candidate = { ...base, voice_id: library[2], voice_name: label };
            else if (VOICE_ID.test(name)) candidate = { ...base, voice_id: name };
            const voice = await resolveVoice(client, candidate);
            models.forEach((model) => (AUDITION_STABILITIES || [null]).forEach((stability) => picked.forEach((line) => {
                const settings = stability === null ? voice.voice_settings : { ...voice.voice_settings, stability };
                takes.push({
                    name: label,
                    voice: { ...voice, model_id: model, voice_settings: settings },
                    variant: stability === null ? model : `${model}-stability-${stability}`,
                    line,
                });
            })));
        } catch (error) {
            console.log(`  ✗ ${name}: ${error.message}`);
            if (error.action === 'stop') {
                process.exitCode = 1;
                return;
            }
        }
    }
    const state = { format: base.output_format || 'wav_44100' };
    let stoppedBy = null;
    await pool(takes, CONCURRENCY, async ({
        name, voice, variant, line,
    }) => {
        const plan = { ...linePlan(line, voice), seed: seedFor(line.key) };
        try {
            const take = await speakLine(client, voice, plan, state);
            const shaped = shapeVoiceLine(take.samples, take.sampleRate, { targetLufs: plan.loudness });
            const file = path.join(AUDITION_DIR, name.replace(/[^\w-]+/g, '_'), variant, `${line.key.replace('/', '-')}.mp3`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, encodeMp3(shaped.samples, take.sampleRate, voice.ship?.bitrate_kbps || 96));
            console.log(`  ✓ ${path.relative(ROOT, file)}`);
            return 'next';
        } catch (error) {
            console.log(`  ✗ ${name} · ${voice.model_id} · ${line.key}: ${error.message}`);
            if (error.action === 'stop') {
                stoppedBy = error.message;
                return 'stop';
            }
            return 'next';
        }
    });
    if (stoppedBy) process.exitCode = 1;
    console.log(`\nListen in ${path.relative(ROOT, AUDITION_DIR)}/, then set voice.voice_name (or voice_id) and voice.model_id in `
        + 'scripts/tts-script.json and run npm run tts:record.');
}

/** What --browse found last: names for the voices it printed. */
function readLibrary() {
    try { return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')); } catch { return []; }
}

/**
 * A Voice Library voice speaks only from My Voices: add it (once). Returns its name. A voice that
 * is already there, or a key that may not add voices, is not an error here: the audition says.
 */
async function addFromLibrary(client, ownerId, voiceId) {
    const name = readLibrary().find((voice) => voice.voice_id === voiceId)?.name || voiceId;
    try {
        await client.addLibraryVoice(ownerId, voiceId, name);
        console.log(`  Added "${name}" from the Voice Library to My Voices.`);
    } catch (error) {
        console.log(`  "${name}" was not added to My Voices (${error.message}); trying it as it is.`);
    }
    return name;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const compact = (count) => (count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : `${Math.round((count || 0) / 1e3)}K`);

/**
 * Look through the Voice Library for a breathing guide: voices matching any of the search terms,
 * most used first (a voice many people use is a proven one), with their free previews saved to
 * listen to. Nothing is spent: try the best on the script's own lines with --audition.
 */
async function browse(client) {
    const found = new Map();
    for (const term of BROWSE_TERMS) {
        try {
            const voices = await client.browseLibrary({ search: term, gender: GENDER });
            voices.forEach((voice) => { if (!found.has(voice.voice_id)) found.set(voice.voice_id, { ...voice, term }); });
        } catch (error) {
            console.log(`  ✗ "${term}": ${error.message}`);
            if (error.action === 'stop') {
                process.exitCode = 1;
                return;
            }
        }
    }
    // A voice with its own rate costs more for every line: shown, but after the others.
    const surcharge = (voice) => Boolean(voice.fiat_rate) || Number(voice.rate) > 1;
    const voices = [...found.values()]
        .sort((a, b) => (surcharge(a) - surcharge(b)) || ((b.usage_character_count_1y || 0) - (a.usage_character_count_1y || 0)))
        .slice(0, Number(argValue('limit')) || 12);
    if (!voices.length) {
        console.log('No library voice matched. Try other words: --browse=gentle,whisper,narrator');
        return;
    }
    fs.mkdirSync(LIBRARY_DIR, { recursive: true });
    console.log(`Voice Library: ${voices.length} of ${found.size} voices matching ${BROWSE_TERMS.join(', ')}, most used first\n`);
    const kept = [];
    for (const [index, voice] of voices.entries()) {
        const number = String(index + 1).padStart(2, '0');
        let preview = '';
        if (voice.preview_url) {
            try {
                const response = await fetch(voice.preview_url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const file = path.join(LIBRARY_DIR, `${number}-${voice.name.replace(/[^\w-]+/g, '_').slice(0, 40)}.mp3`);
                fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
                preview = path.relative(ROOT, file);
            } catch (error) {
                preview = `${voice.preview_url} (not saved: ${error.message})`;
            }
        }
        const traits = [voice.gender, voice.age, voice.accent, voice.descriptive, voice.use_case].filter(Boolean).join(' · ');
        console.log(`${number}. ${voice.name}  (${traits})`);
        console.log(`    ${compact(voice.usage_character_count_1y)} characters spoken this year · cloned ${plural(voice.cloned_by_count || 0, 'time')}`
            + `${surcharge(voice) ? ` · costs more: ${voice.fiat_rate ? `$${voice.fiat_rate} per 1K credits` : `×${voice.rate}`}` : ''}`
            + `${voice.free_users_allowed === false ? ' · not on the free plan' : ''}`);
        if (voice.description) console.log(`    "${String(voice.description).replace(/\s+/g, ' ').slice(0, 160)}"`);
        if (preview) console.log(`    preview: ${preview}`);
        console.log(`    --audition="${voice.public_owner_id}/${voice.voice_id}"\n`);
        kept.push({
            number, name: voice.name, voice_id: voice.voice_id, public_owner_id: voice.public_owner_id, preview,
        });
    }
    fs.writeFileSync(LIBRARY_FILE, `${JSON.stringify(kept, null, 2)}\n`);
    console.log('Previews are each voice\'s own sample, not this script. Hear the best two or three say our lines:');
    console.log(`  npm run tts:record -- --audition="${kept.slice(0, 3).map((voice) => `${voice.public_owner_id}/${voice.voice_id}`).join(',')}"`);
}

/**
 * Listen back: Speech to Text hears each recorded line, and what it heard is compared with the
 * line's words. A spoken delivery tag ("soft voice"), a skipped or invented word shows here.
 * The verdict is kept in tts-recordings.json ("heard"). Returns the lines that differ.
 */
async function verify(client, lines, recordings) {
    const checked = [];
    const stoppedBy = await pool(lines, CONCURRENCY, async (line) => {
        const file = recordedFile(line.key);
        if (!file) return 'next';
        try {
            const heard = await client.transcribe(fs.readFileSync(file), { filename: path.basename(file) });
            const result = compareHeard(line.text, heard);
            checked.push({ key: line.key, heard, ...result });
            if (recordings[line.key]) recordings[line.key] = { ...recordings[line.key], heard: result.verdict };
            if (result.verdict !== 'match') {
                const what = [result.missing.length ? `missing "${result.missing.join(' ')}"` : '', result.added.length ? `added "${result.added.join(' ')}"` : '']
                    .filter(Boolean).join(', ');
                console.log(`  ${result.verdict === 'close' ? '~' : '✗'} ${line.key}: heard "${heard.trim()}" (${what})`);
            }
            return 'next';
        } catch (error) {
            console.log(`  ✗ ${line.key}: could not listen back: ${error.message}`);
            return error.action === 'stop' ? 'stop' : 'next';
        }
    });
    writeRecordings(recordings);
    const count = (verdict) => checked.filter((item) => item.verdict === verdict).length;
    const differs = checked.filter((item) => item.verdict === 'differs');
    console.log(`\nListened back to ${plural(checked.length, 'line')}: ${count('match')} say their words, `
        + `${count('close')} one word apart (worth a listen), ${differs.length} differ.${stoppedBy ? ' (stopped early)' : ''}`);
    if (differs.length) console.log(`Record those again: npm run tts:record -- --retake=${differs.map((item) => item.key).join(',')}`);
    return differs;
}

/** Re-shape every saved master with today's loudness and bitrate: no requests, no cost. */
function reshape(script) {
    const voice = speakerFrom(script);
    const recordings = readRecordings();
    let count = 0;
    selectedLines(script).forEach((line) => {
        if (!fs.existsSync(masterPath(line.key)) || !recordings[line.key]) return;
        const { samples, sampleRate } = floatsFromWav(fs.readFileSync(masterPath(line.key)));
        const { loudness } = lineSettings(voice, line.delivery);
        const shaped = shapeVoiceLine(samples, sampleRate, { targetLufs: loudness });
        fs.mkdirSync(path.dirname(shipPath(line.key)), { recursive: true });
        fs.writeFileSync(shipPath(line.key), encodeMp3(shaped.samples, sampleRate, voice.ship?.bitrate_kbps || 96));
        recordings[line.key] = { ...recordings[line.key], seconds: Math.round(shaped.seconds * 100) / 100 };
        count += 1;
    });
    writeRecordings(recordings);
    const found = indexBreathworkVoices();
    console.log(`Re-shaped ${count} line(s) from tts-masters/; ${Object.keys(found.entries).length} lines play in the game.`);
}

/** Every line and its state for this speaker: the plan for a recording session. */
function listLines(script) {
    const voice = speakerFrom(script);
    const lines = withStates(selectedLines(script), readRecordings(), voice);
    const marks = {
        current: '✓', stale: '↻', missing: '·', external: '?',
    };
    const count = (state, of = lines) => of.filter((line) => line.state === state).length;
    console.log(`Speaker: ${voice.voice_name || voice.voice_id || '(not chosen yet: set voice.voice_id or voice_name)'} · ${voice.model_id}`);
    console.log('✓ recorded with this speaker   ↻ another speaker, other settings or older words   · not recorded   ? made elsewhere\n');
    (script.groups || []).forEach((group) => {
        const own = lines.filter((line) => line.group === group.id);
        if (!own.length) return;
        console.log(`[${group.id}] ${count('current', own)}/${own.length}${group.about ? ` · ${group.about}` : ''}`);
        own.forEach((line) => {
            let note = '';
            if (line.state === 'stale') {
                note = line.entry.words && line.entry.words !== line.take.words ? '  (older words)'
                    : `  (was ${line.entry.voice} · ${line.entry.model})`;
            }
            console.log(`  ${marks[line.state]} ${line.key} [${line.delivery}]  ${line.text}${note}`);
        });
    });
    const todo = lines.filter((line) => line.state === 'stale' || line.state === 'missing');
    const characters = todo.reduce((sum, line) => sum + line.request.length, 0);
    const words = lines.reduce((sum, line) => sum + wordsOf(line.text).split(' ').filter(Boolean).length, 0);
    console.log(`\n${lines.length} lines (${words} words): ${count('current')} current, ${count('stale')} out of date, `
        + `${count('missing')} not recorded${count('external') ? `, ${count('external')} made elsewhere` : ''}.`);
    if (todo.length) {
        console.log(`To record: ${todo.length} lines, ${characters} characters, about $${estimateCost(characters, voice.model_id).toFixed(2)} `
            + '(npm run tts:record; a run that stops continues where it left off).');
    }
}

async function main() {
    let script;
    try {
        script = readScript();
    } catch (error) {
        console.error(`Error loading scripts/tts-script.json: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    if (LIST_MODE) {
        listLines(script);
        return;
    }
    if (RESHAPE_MODE) {
        reshape(script);
        return;
    }
    if (!API_KEY) {
        const probe = await probeNetworkKey(createElevenLabsClient({ apiBase: process.env.ELEVENLABS_API_BASE }));
        if (!probe.added) {
            // A key that arrived and was refused says so; no key at all gets the ways to give one.
            if (probe.error && probe.error.code !== 'needs_authorization') console.error(probe.error.message);
            console.error('Set ELEVENLABS_API_KEY: in the environment, or as ELEVENLABS_API_KEY=... in .env.local.');
            console.error('In a Claude Code cloud environment, add it in the environment\'s settings: a network secret');
            console.error('for api.elevenlabs.io (header xi-api-key), or an environment variable. A new session picks it up.');
            console.error('Keys: https://elevenlabs.io/app/settings/api-keys (text-to-speech access; voices and user read help).');
            console.error('(npm run tts:list shows every line without a key.)');
            process.exitCode = 1;
            return;
        }
        console.log('No ELEVENLABS_API_KEY here, but the API answers: this environment adds the key to each request.');
    }
    try {
        const client = () => createElevenLabsClient({ apiKey: API_KEY, apiBase: process.env.ELEVENLABS_API_BASE });
        if (BROWSE_MODE) await browse(client());
        else if (VERIFY_MODE) {
            const recordings = readRecordings();
            const lines = selectedLines(script).filter((line) => recordings[line.key] && recordedFile(line.key));
            console.log(`Listening back to ${plural(lines.length, 'recorded line')}:`);
            if ((await verify(client(), lines, recordings)).length) process.exitCode = 1;
        } else if (AUDITION_VOICES) await audition(script, AUDITION_VOICES);
        else await record(script);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

main();
