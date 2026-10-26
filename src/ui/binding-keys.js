// @ts-check
/**
 * @fileoverview How a bound key is stored and compared, for every keyboard binding set
 * (Player 1, Player 2, Serenity Mode) and everything that reads them.
 *
 * Bindings hold `KeyboardEvent.key` values. A letter is held in lower case and matched
 * without its case: Caps Lock or a held Shift (Player 2's hard drop) turns `z` into `Z`,
 * and the control must still answer. Space is stored as `Space`.
 */

/** Keys a binding never takes: they do not arrive reliably or they belong to the system. */
const UNBINDABLE_KEYS = new Set([
    'Tab', 'Dead', 'Unidentified', 'Process', 'Meta', 'OS', 'ContextMenu', 'Alt', 'AltGraph',
    'CapsLock', 'NumLock', 'ScrollLock',
]);

/**
 * A key as the bindings store it.
 * @param {unknown} key - a `KeyboardEvent.key`, or a stored binding
 * @returns {string} '' for no key
 */
export function normalizeBindingKey(key) {
    if (key === ' ' || key === 'Spacebar') return 'Space';
    if (key === 'Esc') return 'Escape';
    if (typeof key !== 'string') return '';
    return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Whether a key can be bound to an action. (In a capture Escape cancels instead; Serenity
 * Mode keeps it for leaving.)
 * @param {unknown} key
 */
export function isBindableKey(key) {
    const normalized = normalizeBindingKey(key);
    return normalized !== '' && !UNBINDABLE_KEYS.has(normalized);
}

/**
 * The action a binding set gives a key, or null.
 * @param {Record<string, unknown>|null|undefined} bindings
 * @param {unknown} key - a `KeyboardEvent.key` or a normalized key
 * @returns {string|null}
 */
export function findBoundAction(bindings, key) {
    if (!bindings || typeof bindings !== 'object') return null;
    const wanted = normalizeBindingKey(key);
    if (!wanted) return null;
    for (const action of Object.keys(bindings)) {
        if (normalizeBindingKey(bindings[action]) === wanted) return action;
    }
    return null;
}

/**
 * Whether any of the binding sets uses the key.
 * @param {Array<Record<string, unknown>|null|undefined>} bindingSets
 * @param {unknown} key
 */
export function isKeyBound(bindingSets, key) {
    return bindingSets.some((bindings) => findBoundAction(bindings, key) !== null);
}
