/**
 * Record the Hale voice: every line in scripts/tts-script.json, written to
 * public/assets/audio/breathwork/voices/<group>/<filename>.
 *
 * The speaker is set in one place, tts-script.json's voice_config (model, voice_name and the
 * delivery style prompt), or per run with --voice=, --model= and --style=. A run records every line
 * that is missing, or was recorded by another speaker or from other words (scripts/tts-recordings.json
 * keeps who recorded what). So a new speaker is: change voice_config, run again. A run that stops
 * part-way (a daily quota, a lost connection) continues where it stopped when you run it again.
 *
 *   npm run tts:list                              every line and its state (no key needed)
 *   npm run tts:record                            record what is missing or in another voice
 *   npm run tts:record -- --group=first,tide      only these groups
 *   npm run tts:record -- --only=tide/r1_carry.wav   only these lines (or bare file names)
 *   npm run tts:record -- --overwrite             re-take lines already in this voice too
 *   npm run tts:record -- --audition=Sulafat,Achernar
 *                         try voices on three lines, written to tts-auditions/ (the game is untouched)
 *
 * Recording needs GEMINI_API_KEY, from the environment or a git-ignored .env.local file. Afterwards
 * the recorded-voice index is refreshed, so the sessions speak the newly recorded lines (see
 * scripts/index-breathwork-voices.mjs). GEMINI_API_BASE replaces the API address (a proxy, a
 * stand-in for tests).
 */
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { indexBreathworkVoices } from './index-breathwork-voices.mjs';
import {
    lineState, readRecordings, takeOf, writeRecordings,
} from './tts-recordings.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// Create WAV header for raw PCM data
function createWavHeader(dataLength, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
}

// Configuration
const SCRIPT_PATH = path.join(__dirname, 'tts-script.json');
const OUTPUT_BASE_DIR = path.join(ROOT, 'public', 'assets', 'audio', 'breathwork');
const AUDITION_DIR = path.join(ROOT, 'tts-auditions');
const LOG_FILE = path.join(__dirname, 'tts-generated.log');
const DEFAULT_STYLE = '[Speak calmly and meditatively, like a peaceful breathing guide]';
// What an audition records unless --group or --only picks other lines: an arrival, a cue, a closing.
const AUDITION_LINES = ['session_intros/first_intro.wav', 'cues/breathe_in_soft.wav', 'transitions/closing.wav'];
// Seconds between requests, under the TTS models' per-minute limits.
const PACE_SECONDS = 7;
// A request that keeps failing this many lines in a row means the setup is wrong, not the line.
const FAILURES_IN_A_ROW = 3;

const argValue = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const listArg = (name) => argValue(name)?.split(',').map((item) => item.trim()).filter(Boolean) || null;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const LIST_MODE = process.argv.includes('--list');
const OVERWRITE_MODE = process.argv.includes('--overwrite');
const ONLY_GROUPS = listArg('group');
const ONLY_FILES = listArg('only');
const AUDITION_VOICES = listArg('audition');

// The key may live in a git-ignored .env.local (or .env) instead of the shell (Node 20.12 and later).
for (const name of ['.env.local', '.env']) {
    const file = path.join(ROOT, name);
    if (process.env.GEMINI_API_KEY || typeof process.loadEnvFile !== 'function') break;
    if (fs.existsSync(file)) process.loadEnvFile(file);
}
const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

/** A failed request, with what the run needs to decide: wait and retry, skip the line, or stop. */
class TtsError extends Error {
    constructor(message, { status = 0, retrySeconds = 0 } = {}) {
        super(message);
        this.status = status;
        this.retrySeconds = retrySeconds;
    }
}

/** Why a failure stops the run rather than moving on to the next line, or null. */
function stopReason(error) {
    if (error.status === 401 || error.status === 403) return 'The API key was refused: check GEMINI_API_KEY.';
    if (error.status === 404) return 'The model was not found: check voice_config.model in tts-script.json (or --model=).';
    if (error.status === 429) return 'The quota is used up for now (Gemini TTS has per-minute and daily limits).';
    return null;
}

async function generateAudio(text, voiceName, model, style = DEFAULT_STYLE, retries = 3) {
    const url = `${API_BASE}/v1beta/models/${model}:generateContent`;

    // Pad very short text to help the API (single words can fail)
    const styledText = text.length < 10 ? `${style} Say: "${text}"` : `${style} ${text}`;

    const payload = {
        contents: [
            { role: 'user', parts: [{ text: styledText }] },
        ],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                },
            },
        },
    };

    const response = await fetch(url, {
        method: 'POST',
        // The key goes in a header, not the address, so it stays out of logs and proxies.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // A per-minute limit says how long to wait (google.rpc.RetryInfo, e.g. "38s").
        const retryInfo = body.error?.details?.find((detail) => String(detail['@type']).endsWith('RetryInfo'));
        throw new TtsError(body.error?.message || response.statusText || `HTTP ${response.status}`, {
            status: response.status,
            retrySeconds: Number.parseFloat(retryInfo?.retryDelay) || 0,
        });
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const audioPart = parts?.find((part) => part.inlineData?.mimeType?.startsWith('audio'));

    if (!audioPart) {
        if (retries > 0) {
            process.stdout.write(`⟳ retry (${retries} left)... `);
            await sleep(3000);
            return generateAudio(text, voiceName, model, style, retries - 1);
        }
        throw new TtsError('No audio in response');
    }

    const { mimeType } = audioPart.inlineData;
    const rawBuffer = Buffer.from(audioPart.inlineData.data, 'base64');

    // Add WAV header for raw PCM
    if (mimeType.includes('L16') || mimeType.includes('pcm')) {
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
        const wavHeader = createWavHeader(rawBuffer.length, sampleRate);
        return Buffer.concat([wavHeader, rawBuffer]);
    }

    return rawBuffer;
}

/**
 * Say one line, waiting out a short rate limit. Returns the audio, or null when this line failed
 * and the run can go on; throws { stop } when the run cannot (a refused key, a used-up quota).
 */
async function sayLine(line, speaker, failures) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            const audio = await generateAudio(line.text, speaker.voiceName, speaker.model, speaker.style);
            failures.inARow = 0;
            return audio;
        } catch (error) {
            if (error.status === 429 && error.retrySeconds > 0 && error.retrySeconds <= 90 && attempt < 3) {
                process.stdout.write(`… rate limit, waiting ${Math.ceil(error.retrySeconds)} s... `);
                await sleep((error.retrySeconds + 1) * 1000);
                continue;
            }
            console.log(`✗ ${error.message}`);
            fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} | ${line.key} | ${speaker.voiceName} | FAILED | ${error.message}\n`);
            failures.inARow += 1;
            const reason = stopReason(error)
                || (failures.inARow >= FAILURES_IN_A_ROW ? `${failures.inARow} lines failed in a row: check the connection, and voice_config's voice_name and model.` : null);
            if (reason) throw Object.assign(new Error(reason), { stop: true });
            return null;
        }
    }
}

/** The lines of the script, as { group, file, key, text }, narrowed by --group and --only. */
function scriptLines(manifest, { all = false } = {}) {
    return manifest.sessions
        .filter((group) => all || !ONLY_GROUPS || ONLY_GROUPS.includes(group.id))
        .flatMap((group) => group.clips.map((clip) => {
            const file = clip.filename.replace('.mp3', '.wav');
            return {
                group: group.id, file, key: `${group.id}/${file}`, text: clip.text,
            };
        }))
        .filter((line) => all || !ONLY_FILES || ONLY_FILES.includes(line.file) || ONLY_FILES.includes(line.key));
}

const outputPath = (line) => path.join(OUTPUT_BASE_DIR, 'voices', line.group, line.file);

/** Why a stale line is recorded again: another speaker made it, or its words or style changed. */
const staleNote = (line, speaker) => (line.entry.voice === speaker.voiceName && line.entry.model === speaker.model
    ? 'new words or style' : `was ${line.entry.voice} · ${line.entry.model}`);

/** The state of every line for this speaker: current, stale, missing or external (see tts-recordings.mjs). */
function withStates(lines, recordings, speaker) {
    return lines.map((line) => {
        const take = takeOf({
            model: speaker.model, voice: speaker.voiceName, style: speaker.style, text: line.text,
        });
        const entry = recordings[line.key];
        return {
            ...line, take, entry, state: lineState({ exists: fs.existsSync(outputPath(line)), entry, take }),
        };
    });
}

async function record(manifest, speaker) {
    const recordings = readRecordings();
    // Takes of lines that left the script, or whose file is gone, are dropped now and on every write.
    const keep = new Set(scriptLines(manifest, { all: true }).filter((line) => fs.existsSync(outputPath(line)))
        .map((line) => line.key));
    const save = () => writeRecordings(Object.fromEntries(Object.entries(recordings)
        .filter(([key]) => keep.has(key))));
    if (Object.keys(recordings).some((key) => !keep.has(key))) save();
    const lines = withStates(scriptLines(manifest), recordings, speaker);
    const todo = lines.filter((line) => OVERWRITE_MODE || line.state === 'stale' || line.state === 'missing');
    const failures = { inARow: 0 };
    let made = 0;
    let failed = 0;
    let stopped = null;

    console.log(`Speaker: ${speaker.voiceName} · ${speaker.model}`);
    console.log(`Style: ${speaker.style}`);
    if (!lines.length) {
        console.log('No line matches --group / --only (npm run tts:list shows every line).');
        process.exitCode = 1;
        return;
    }
    if (!todo.length) {
        console.log(`Nothing to record: all ${lines.length} lines are in this voice (--overwrite re-takes them).`);
        return;
    }
    console.log(`${todo.length} of ${lines.length} lines to record`
        + `${OVERWRITE_MODE ? ' (--overwrite: every line)' : ''}, one every ${PACE_SECONDS} s.\n`);

    for (const line of todo) {
        process.stdout.write(`  → ${line.key}${line.state === 'stale' ? ` (${staleNote(line, speaker)})` : ''}... `);
        let audio;
        try {
            audio = await sayLine(line, speaker, failures);
        } catch (error) {
            if (!error.stop) throw error;
            failed += 1;
            stopped = error.message;
            break;
        }
        if (audio) {
            fs.mkdirSync(path.dirname(outputPath(line)), { recursive: true });
            fs.writeFileSync(outputPath(line), audio);
            // Saved after every line, so a run that stops keeps what it made.
            recordings[line.key] = line.take;
            keep.add(line.key);
            save();
            made += 1;
            console.log(`✓ (${Math.round(audio.length / 1024)} KB)`);
            fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} | ${line.key} | ${speaker.voiceName} | ${speaker.model} | ${Math.round(audio.length / 1024)}KB\n`);
        } else {
            failed += 1;
        }
        if (line !== todo[todo.length - 1]) await sleep(PACE_SECONDS * 1000);
    }

    // Newly recorded lines start playing in the sessions once the index lists them.
    if (made > 0) {
        const changed = indexBreathworkVoices();
        console.log(`\nRecorded-voice index ${changed ? 'updated' : 'unchanged'} (src/ui/effects/breathwork-recorded-voices.js)`);
    }
    const left = withStates(scriptLines(manifest), readRecordings(), speaker)
        .filter((line) => line.state === 'stale' || line.state === 'missing').length;
    console.log(`\n${stopped ? `Stopped: ${stopped}\n` : ''}Recorded ${made}${failed ? `, ${failed} failed` : ''}; `
        + `${left} line${left === 1 ? '' : 's'} still to record in this voice.`);
    if (left > 0) {
        console.log(stopped ? 'Once that is sorted, run the same command again: it continues where it stopped.'
            : 'Run the same command again to record the rest.');
    }
    if (stopped || failed) process.exitCode = 1;
}

/** Try voices on a few lines, written to tts-auditions/<voice>/: nothing in the game changes. */
async function audition(manifest, voices, speaker) {
    const picked = ONLY_GROUPS || ONLY_FILES
        ? scriptLines(manifest)
        : scriptLines(manifest, { all: true }).filter((line) => AUDITION_LINES.includes(line.key));
    if (!picked.length) {
        console.log('No line matches --group / --only (npm run tts:list shows every line).');
        process.exitCode = 1;
        return;
    }
    const failures = { inARow: 0 };
    console.log(`Audition: ${voices.join(', ')} · ${speaker.model} · ${picked.length} line(s) each\n`);
    const takes = voices.flatMap((voiceName) => picked.map((line) => ({ voiceName, line })));
    try {
        for (const [index, { voiceName, line }] of takes.entries()) {
            if (index > 0) await sleep(PACE_SECONDS * 1000);
            process.stdout.write(`  → ${voiceName}: ${line.key}... `);
            const audio = await sayLine(line, { ...speaker, voiceName }, failures);
            if (audio) {
                const file = path.join(AUDITION_DIR, voiceName, line.group, line.file);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, audio);
                console.log(`✓ ${path.relative(ROOT, file)}`);
            }
        }
    } catch (error) {
        if (!error.stop) throw error;
        console.log(`\nStopped: ${error.message}`);
        process.exitCode = 1;
    }
    console.log(`\nListen in ${path.relative(ROOT, AUDITION_DIR)}/, then set voice_config.voice_name to the one you like`
        + ' and run npm run tts:record.');
}

/** Every line and its state for this speaker: the plan for a recording session. */
function listLines(manifest, speaker) {
    const recordings = readRecordings();
    const lines = withStates(scriptLines(manifest), recordings, speaker);
    const marks = {
        current: '✓', stale: '↻', missing: '·', external: '?',
    };
    const count = (state, of = lines) => of.filter((line) => line.state === state).length;
    console.log(`Speaker: ${speaker.voiceName} · ${speaker.model}`);
    console.log(`Style: ${speaker.style}`);
    console.log('✓ in this voice   ↻ in another voice or older words (recorded again)   · not recorded'
        + '   ? made elsewhere (kept)\n');
    manifest.sessions.forEach((group) => {
        const own = lines.filter((line) => line.group === group.id);
        if (!own.length) return;
        console.log(`[${group.id}] ${count('current', own)}/${own.length} in this voice${group.description ? ` · ${group.description}` : ''}`);
        own.forEach((line) => {
            const note = line.state === 'stale' ? `  (${staleNote(line, speaker)})` : '';
            console.log(`  ${marks[line.state]} ${line.key}  ${line.text}${note}`);
        });
    });
    const words = lines.reduce((sum, line) => sum + line.text.split(/\s+/).filter(Boolean).length, 0);
    const characters = lines.reduce((sum, line) => sum + line.text.length, 0);
    const todo = count('stale') + count('missing');
    const external = count('external');
    console.log(`\n${lines.length} lines: ${count('current')} in this voice, ${count('stale')} in another voice or older words, `
        + `${count('missing')} not recorded${external ? `, ${external} made elsewhere` : ''} · ${words} words, ${characters} characters`);
    if (todo > 0) {
        console.log(`To record: ${todo} (npm run tts:record, about ${Math.ceil((todo * (PACE_SECONDS + 5)) / 60)} min; `
            + 'a quota that runs out part-way just means running it again later).');
    }
}

async function main() {
    // Load manifest
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'));
    } catch (err) {
        console.error(`Error loading script: ${err.message}`);
        process.exitCode = 1;
        return;
    }

    const config = manifest.voice_config || {};
    const speaker = {
        model: argValue('model') || config.model || 'gemini-2.5-pro-preview-tts',
        voiceName: argValue('voice') || config.voice_name || 'Algieba',
        style: argValue('style') || config.style || DEFAULT_STYLE,
    };

    if (LIST_MODE) {
        listLines(manifest, speaker);
        return;
    }
    if (!API_KEY) {
        console.error('Please set GEMINI_API_KEY: in the environment, or as GEMINI_API_KEY=... in .env.local');
        console.error('Get your key from: https://aistudio.google.com/apikey');
        console.error('(npm run tts:list shows every line without a key.)');
        process.exitCode = 1;
        return;
    }

    if (AUDITION_VOICES) await audition(manifest, AUDITION_VOICES, speaker);
    else await record(manifest, speaker);
}

main();
