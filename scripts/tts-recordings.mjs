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

/** The take a speaker makes of a line: who says it, and a fingerprint of everything that shapes it. */
export function takeOf({
    model, voice, style, text,
}) {
    const take = crypto.createHash('sha256').update([model, voice, style, text].join('\n')).digest('hex').slice(0, 12);
    return { voice, model, take };
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

/** The entries, keyed '<group>/<file>.wav'. */
export function readRecordings(file = RECORDINGS_FILE) {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')).clips || {};
}

/** One entry per line, sorted, so a recording session reads as a clean diff. */
export function renderRecordings(clips) {
    const json = JSON.stringify;
    const lines = Object.keys(clips).sort().map((key) => {
        const { voice, model, take } = clips[key];
        return `    ${json(key)}: { "voice": ${json(voice)}, "model": ${json(model)}, "take": ${json(take)} }`;
    });
    return `{\n  "about": ${json(ABOUT)},\n  "clips": {\n${lines.join(',\n')}\n  }\n}\n`;
}

export function writeRecordings(clips, file = RECORDINGS_FILE) {
    fs.writeFileSync(file, renderRecordings(clips));
}
