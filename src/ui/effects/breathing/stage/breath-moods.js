/**
 * Moods: each breathing world comes in a few versions of itself — another hour, another weather,
 * another colour of light — and a visit shows one of them. The world and its breath are the same;
 * only the scenery's mood changes, so a practice that returns to a world often finds it new.
 *
 * A visit never repeats the mood the last visit to that world showed (on this device):
 * `serenity.breathMoods` = { <world id>: <mood index> }. Boot-safe (no three.js).
 */
export const BREATH_MOODS_KEY = 'serenity.breathMoods';

function defaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function readLast(storage) {
    try {
        const value = JSON.parse(storage?.getItem(BREATH_MOODS_KEY) || 'null');
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

/**
 * Pick the mood for a visit to `worldId`, one of `count`: any but the one shown last time.
 * @returns {number} mood index
 */
export function pickBreathMood(worldId, count, { storage = defaultStorage(), random = Math.random } = {}) {
    if (!(count > 1)) return 0;
    const last = readLast(storage);
    const previous = Number.isInteger(last[worldId]) && last[worldId] < count ? last[worldId] : -1;
    let index = Math.floor(random() * (previous >= 0 ? count - 1 : count));
    if (previous >= 0 && index >= previous) index += 1;
    try {
        storage?.setItem(BREATH_MOODS_KEY, JSON.stringify({ ...last, [worldId]: index }));
    } catch {
        // A full or blocked storage only costs the no-repeat rule.
    }
    return index;
}

/**
 * The mood a request names: an index, a mood id, or nothing (null).
 * @param {Array<{id: string}>} moods
 */
export function resolveBreathMood(moods, request) {
    if (request === undefined || request === null || request === '') return null;
    const asNumber = Number(request);
    if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber < moods.length) return asNumber;
    const index = moods.findIndex((mood) => mood.id === request);
    return index >= 0 ? index : null;
}
