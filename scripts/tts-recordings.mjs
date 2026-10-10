/**
 * Which speaker recorded each Hale voice clip, and from which words: scripts/tts-recordings.json.
 *
 * scripts/generate-tts.js writes an entry after every clip it records. A line whose entry no longer
 * matches the speaker in tts-script.json's voice_config, or the line's words, is "stale": the next
 * run records it again. So changing the speaker and running again re-voices every line, and a run
 * that stops part-way (a daily quota, a lost connection) continues where it stopped.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDINGS_FILE = path.join(ROOT, 'scripts', 'tts-recordings.json');

const ABOUT = 'Which speaker recorded each clip in public/assets/audio/breathwork/voices, written by '
    + 'scripts/generate-tts.js. A take is a fingerprint of the model, voice, style and words: a line '
    + 'whose take differs from what tts-script.json asks for is recorded again on the next run.';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

/**
 * The words of a line, without its pauses, punctuation or case: what a listener hears said.
 * A recording stays true to its line while these match, however the delivery is marked up.
 */
export function wordsOf(text) {
    return String(text)
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^a-z0-9']+/g, ' ')
        .trim();
}

/**
 * The take a speaker makes of a line: who says it, a fingerprint of everything that shapes it
 * (`settings` is whatever else the service is asked for, e.g. voice settings), and a fingerprint
 * of its words alone.
 */
export function takeOf({
    model, voice, style = '', settings = null, text,
}) {
    const shape = [model, voice, style, settings ? JSON.stringify(settings) : '', text].join('\n');
    return {
        voice, model, take: hash(shape), words: hash(wordsOf(text)),
    };
}

/** Whether a recording says the words a line has now (a recording from older words does not). */
export function saysLine(entry, text) {
    return !entry?.words || entry.words === hash(wordsOf(text));
}

/**
 * A line's state: 'current' (this speaker, these words), 'stale' (another speaker or older words:
 * a run records it again), 'missing', or 'external' (a clip with no entry, made some other way:
 * kept unless --overwrite).
 */
export function lineState({ exists, entry, take }) {
    if (!exists) return 'missing';
    if (!entry) return 'external';
    return entry.take === take.take ? 'current' : 'stale';
}

/** The entries, keyed by line id ('<group>/<id>'). */
export function readRecordings(file = RECORDINGS_FILE) {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')).clips || {};
}

/**
 * One entry per line, sorted, so a recording session reads as a clean diff. Besides the take: its
 * length, how many retakes it has had (each asks for a new seed), and what listening back heard
 * ('match', 'close' or 'differs': generate-tts.js --verify).
 */
export function renderRecordings(clips) {
    const json = JSON.stringify;
    const lines = Object.keys(clips).sort().map((key) => {
        const {
            voice, model, take, words, seconds, retake, heard,
        } = clips[key];
        const extra = [
            words ? `"words": ${json(words)}` : '',
            Number.isFinite(seconds) ? `"seconds": ${json(seconds)}` : '',
            Number.isInteger(retake) && retake > 0 ? `"retake": ${json(retake)}` : '',
            typeof heard === 'string' && heard ? `"heard": ${json(heard)}` : '',
        ].filter(Boolean).map((field) => `, ${field}`).join('');
        return `    ${json(key)}: { "voice": ${json(voice)}, "model": ${json(model)}, "take": ${json(take)}${extra} }`;
    });
    return `{\n  "about": ${json(ABOUT)},\n  "clips": {\n${lines.join(',\n')}\n  }\n}\n`;
}

export function writeRecordings(clips, file = RECORDINGS_FILE) {
    fs.writeFileSync(file, renderRecordings(clips));
}
