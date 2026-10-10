/**
 * Words for what just opened in the breath collection: "Ocean Tide" and "Hale Tide", for the
 * Odyssey ceremony, a Hale result and the toast that marks an opening by practice.
 */
import { showToast } from '../../components/toast.js';
import { getBreathWorld, isBreathWorld } from './breath-catalogue.js';

/** 'TIDE' → 'Hale Tide'; the first session has a longer name. */
export function haleSessionName(id) {
    if (id === 'FIRST') return 'Hale First Breath';
    const word = String(id || '').toLowerCase();
    return `Hale ${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * @param {{worlds?: string[], sessions?: string[]}|null} opened
 * @returns {{worlds: {id: string, name: string}[], sessions: {id: string, name: string}[], line: string}|null}
 */
export function describeOpenings(opened) {
    const worlds = (opened?.worlds || []).filter(isBreathWorld).map((id) => ({ id, name: getBreathWorld(id).name }));
    const sessions = (opened?.sessions || []).map((id) => ({ id, name: haleSessionName(id) }));
    if (!worlds.length && !sessions.length) return null;
    const names = [...worlds, ...sessions].map((item) => item.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    return { worlds, sessions, line: `${list} ${names.length > 1 ? 'are' : 'is'} yours now` };
}

/** A quiet toast for what practice opened (an Odyssey chapter has its own ceremony). */
export function announceBreathOpenings(opened) {
    const described = describeOpenings(opened);
    if (!described) return null;
    showToast({ type: 'success', message: `Your breathing opened something new: ${described.line}.`, timeoutMs: 6000 });
    return described;
}
