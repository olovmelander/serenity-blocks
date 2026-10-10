/**
 * The game's one breath collection (breath-collection.js), wired to its evidence: saved Odyssey
 * progress, the Hale practice log, stand-alone breathing practice, and, once, what an existing
 * player had already used before worlds could be locked.
 */
import { BreathCollectionService, readSavedOdysseyProgress } from './breath-collection.js';
import { readBreathPractice } from './breath-practice.js';
import { readPracticeLog } from '../breathwork-practice-log.js';
import { SESSION_WORLDS } from './session-worlds.js';

const SETTINGS_KEY = 'serenityBlocksSettings';
/** The world every player started on before this: proof of nothing on its own. */
const OLD_DEFAULT_WORLD = 'deep-relaxation';

let instance = null;

function defaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** URL-only preview access, like the theme collection's: never stored. */
export function isDevelopmentBreathUnlocked(search = globalThis.location?.search || '') {
    return new URLSearchParams(search).get('unlockAll') === '1';
}

const worldsOf = (sessionId) => Object.entries(SESSION_WORLDS[sessionId] || {})
    .filter(([stage]) => stage !== 'featured').flatMap(([, worlds]) => [worlds].flat());

/**
 * What an existing player had used: the Hale sessions in their log and the worlds those pass
 * through, their stand-alone practice worlds, and the world they had chosen (the old default
 * counts only alongside other signs of breathing).
 */
export function readLegacyBreathEvidence(storage = defaultStorage()) {
    const log = readPracticeLog(storage);
    const sessions = new Set([...log.entries.map((entry) => entry.id), log.last?.id].filter(Boolean));
    const practice = readBreathPractice(storage);
    const worlds = new Set([...[...sessions].flatMap(worldsOf), ...Object.keys(practice.worlds)]);
    let chosen = null;
    try { chosen = JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null')?.breathingTechnique || null; } catch { chosen = null; }
    if (chosen && (chosen !== OLD_DEFAULT_WORLD || sessions.size || practice.seconds > 0 || log.seconds > 0)) worlds.add(chosen);
    return { worlds: [...worlds], sessions: [...sessions] };
}

/** Minutes of breathing that count toward opening: Hale sessions and stand-alone practice. */
export function readBreathPracticeSeconds(storage = defaultStorage()) {
    return (readPracticeLog(storage).seconds || 0) + readBreathPractice(storage).seconds;
}

export function getBreathCollection() {
    if (!instance) {
        const storage = defaultStorage();
        instance = new BreathCollectionService({
            storage,
            readOdysseyProgress: () => readSavedOdysseyProgress(storage),
            readPracticeSeconds: () => readBreathPracticeSeconds(storage),
            readLegacyEvidence: () => readLegacyBreathEvidence(storage),
            developmentUnlockAll: isDevelopmentBreathUnlocked(),
        });
    }
    return instance;
}

/** For tests: forget the instance. */
export function resetBreathCollectionForTests() {
    instance = null;
}
