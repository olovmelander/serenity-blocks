/**
 * Words for what just opened in the breath collection: "Ocean Tide" and "Sukha Tide", for the
 * Odyssey ceremony, a Sukha result and the toast that marks an opening by practice.
 */
import { showToast } from '../../components/toast.js';
import { getBreathWorld, isBreathWorld } from './breath-catalogue.js';

/** Sessions whose title is not their key (the keys are saved data; the titles are what players see). */
const SESSION_TITLES = Object.freeze({
    FIRST: 'First Breath', REST: 'Nightfall', FLOW: 'Mandala', BASE: 'Homecoming', ELIXIR: 'Phoenix',
});

/** 'TIDE' → 'Sukha Tide', 'ELIXIR' → 'Sukha Phoenix'. */
export function sukhaSessionName(id) {
    const key = String(id || '');
    const title = SESSION_TITLES[key] ?? `${key.charAt(0)}${key.slice(1).toLowerCase()}`;
    return `Sukha ${title}`;
}

/**
 * @param {{worlds?: string[], sessions?: string[]}|null} opened
 * @returns {{worlds: {id: string, name: string}[], sessions: {id: string, name: string}[], line: string}|null}
 */
export function describeOpenings(opened) {
    const worlds = (opened?.worlds || []).filter(isBreathWorld).map((id) => ({ id, name: getBreathWorld(id).name }));
    const sessions = (opened?.sessions || []).map((id) => ({ id, name: sukhaSessionName(id) }));
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
