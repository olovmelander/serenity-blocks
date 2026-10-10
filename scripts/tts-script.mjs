/**
 * The voice script (scripts/tts-script.json): every line the breathing voice speaks, and the
 * speaker that records them. Shared by the recorder (generate-tts.js), the recorded-voice index
 * (index-breathwork-voices.mjs) and the tests.
 *
 * A line's key is '<group>/<id>', the id the game plays it by; its file is
 * public/assets/audio/breathwork/voices/<group>/<id>.<mp3|wav>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPT_FILE = path.join(ROOT, 'scripts', 'tts-script.json');
export const AUDIO_ROOT = path.join(ROOT, 'public', 'assets', 'audio', 'breathwork');
export const VOICE_EXTENSIONS = Object.freeze(['.mp3', '.wav']);

export function readScript(file = SCRIPT_FILE) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Every line, in script order, with its delivery and context settled.
 * @returns {{key: string, group: string, id: string, text: string, delivery: string,
 *   context: {previous?: string, next?: string}}[]}
 */
export function scriptLines(script) {
    return (script.groups || []).flatMap((group) => (group.lines || []).map((line) => ({
        key: `${group.id}/${line.id}`,
        group: group.id,
        id: line.id,
        text: line.text,
        delivery: line.delivery || group.delivery || 'guide',
        context: { ...(group.context || {}), ...(line.context || {}) },
    })));
}

/** Models that read audio tags ([softly]) and no SSML; the others take break tags and speed. */
export const isTagModel = (model) => /^eleven_v[34]/.test(String(model));

/**
 * The text sent to the service for one line. Pauses written as '[pause 1.5s]' become a break
 * tag (multilingual v2, flash) or a [short pause] / [long pause] tag (v3, v4, which also get the
 * delivery's tags and take no SSML). With `pauses: 'tags'`, a model that reads tags also hears
 * each '...' between words as a clean [short pause] (after a comma, or a full stop before a new
 * sentence) instead of a trailing-off; a line's closing '...' stays, drawing its last word out.
 */
export function requestText(text, { model, tags = '', pauses = 'ellipsis' } = {}) {
    const tagged = isTagModel(model);
    let body = String(text).replace(/\[pause\s+([\d.]+)\s*s\]/gi, (_, seconds) => {
        const value = Math.min(3, Math.max(0.2, Number(seconds) || 1));
        if (tagged) return value >= 1.5 ? '[long pause]' : '[short pause]';
        return `<break time="${value}s" />`;
    });
    if (tagged && pauses === 'tags') {
        body = body.replace(/\s*(?:\.\.\.|\u2026)\s+(?=(\S))/g, (_, next) => (/[A-Z]/.test(next) ? '. [short pause] ' : ', [short pause] '));
    }
    return tagged && tags ? `${tags} ${body}` : body;
}

/** The settings one line is recorded with: the voice's, then its delivery's. */
export function lineSettings(voice, delivery) {
    const { loudness, tags, ...overrides } = voice.deliveries?.[delivery] || {};
    return {
        voiceSettings: { ...(voice.voice_settings || {}), ...overrides },
        loudness: Number.isFinite(loudness) ? loudness : -20,
        tags: tags || '',
    };
}
