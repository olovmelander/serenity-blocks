/**
 * The choices Serenity Mode offers for watching on its own: how it drifts between themes, and
 * how long it stays before it rests. Shared by the world bar, the Hub's Themes tab and the
 * mode itself; no DOM, so the Hub can import it at boot.
 */

/** Drift: off, with each song (a song's end brings the next song and its world), or a timer. */
export const DRIFT_OPTIONS = Object.freeze([
    Object.freeze({ id: 'off', label: 'Off', chip: 'Drift off' }),
    Object.freeze({ id: 'music', label: 'With the music', chip: 'Drift · with the music' }),
    Object.freeze({ id: '10', label: 'Every 10 min', chip: 'Drift · every 10 min' }),
    Object.freeze({ id: '20', label: 'Every 20 min', chip: 'Drift · every 20 min' }),
    Object.freeze({ id: '30', label: 'Every 30 min', chip: 'Drift · every 30 min' }),
]);

/** The pace D turns drift on with when nothing was chosen before. */
export const DEFAULT_DRIFT_PACE = 'music';

/** The rest timer, in minutes; 0 is off. */
export const REST_OPTIONS = Object.freeze([0, 15, 30, 45, 60]);

/** @param {unknown} value @returns {string} a known drift id ('off' for anything else) */
export function normalizeDrift(value) {
    const id = String(value ?? 'off');
    return DRIFT_OPTIONS.some((option) => option.id === id) ? id : 'off';
}

/** @param {string} id @returns {string} a known pace, never 'off' */
export function normalizeDriftPace(id) {
    const pace = normalizeDrift(id);
    return pace === 'off' ? DEFAULT_DRIFT_PACE : pace;
}

/** @param {string} id @returns {number} minutes between drifts, 0 for off and with the music */
export function driftMinutes(id) {
    const minutes = Number(id);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/** @param {string} id @returns {{id: string, label: string, chip: string}} */
export function driftOption(id) {
    return DRIFT_OPTIONS.find((option) => option.id === normalizeDrift(id)) || DRIFT_OPTIONS[0];
}

/** The option after `id`, wrapping round to Off: what a press on the drift chip chooses. */
export function nextDriftOption(id) {
    const index = DRIFT_OPTIONS.findIndex((option) => option.id === normalizeDrift(id));
    return DRIFT_OPTIONS[(index + 1) % DRIFT_OPTIONS.length].id;
}

/** @param {number} minutes @returns {number} the rest length after `minutes`, wrapping to 0 */
export function nextRestOption(minutes) {
    const index = REST_OPTIONS.indexOf(minutes);
    return REST_OPTIONS[(index + 1) % REST_OPTIONS.length];
}

/** @param {number} minutes chosen @returns {string} the rest chip's words for a choice */
export function restOptionLabel(minutes) {
    return minutes > 0 ? `${minutes} min` : 'Off';
}

/**
 * The rest chip while a timer runs: how long is left, in whole minutes, rounded up.
 * @param {number} msLeft @returns {string}
 */
export function restChipLabel(msLeft) {
    if (!(msLeft > 0)) return 'Rest off';
    return `Rest · ${Math.max(1, Math.ceil(msLeft / 60000))} min left`;
}
