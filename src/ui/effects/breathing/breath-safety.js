/**
 * The breathing features' safety words, and the one rule for which practices ask for them to be
 * read first.
 *
 * Strong breathing: a rhythm whose whole breath (in, hold, out, rest) takes five seconds or less,
 * or holds after it that you end yourself. Fast, deep breathing lowers carbon dioxide in the blood
 * and can make you light-headed or faint, more so with a hold after it. Before the first strong
 * practice (a guided session or a world on its own) the note is shown and Begin waits for
 * "I understand". It is read once for both the Sessions and the Breathing tab, and asked again
 * when its words change (BREATH_SAFETY_VERSION).
 */

/** A breath this short or shorter, in seconds, is fast breathing. */
export const STRONG_BREATH_CYCLE_SECONDS = 5;

export const BREATH_CAUTION_TEXT = 'Fast breathing, and holding your breath after it, can make you '
    + 'light-headed or faint. Sit or lie down. Never practise in or near water or a bath, while driving, '
    + 'or standing. Not for children. Do not practise it if you are pregnant, or have epilepsy or have had '
    + 'seizures, a heart or blood-pressure condition, asthma or COPD, a past stroke, or a history of fainting. '
    + 'Never force a hold: breathe whenever you need to. Stop and breathe normally if you feel chest pain '
    + 'or feel unwell.';

export const BREATH_WELLNESS_TEXT = 'For relaxation only: not medical advice, treatment or a medical device.';

const SAFETY_KEY = 'serenity.breathSafetyRead';
/** Bump when BREATH_CAUTION_TEXT changes in substance: everyone reads the new note once. */
export const BREATH_SAFETY_VERSION = '2026-11-08';

/** True for a [in, hold, out, rest] rhythm fast enough to need the note. */
export function isStrongPattern(pattern) {
    if (!Array.isArray(pattern)) return false;
    const cycle = pattern.reduce((sum, seconds) => sum + (Number(seconds) || 0), 0);
    return cycle > 0 && cycle <= STRONG_BREATH_CYCLE_SECONDS;
}

/** True for a session (its phases) with open holds or a fast breathing round. */
export function isStrongSession(phases = []) {
    return phases.some((phase) => (phase.type === 'retention' && phase.hold === 'open')
        || (phase.type === 'active' && isStrongPattern(phase.pattern)));
}

function defaultStorage() {
    try {
        return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** Whether the current note has been read on this machine. */
export function isBreathSafetyRead(storage = defaultStorage()) {
    try {
        return storage?.getItem?.(SAFETY_KEY) === BREATH_SAFETY_VERSION;
    } catch {
        return false;
    }
}

/** Remember that the current note was read (or, with false, forget it). */
export function setBreathSafetyRead(read = true, storage = defaultStorage()) {
    try {
        if (read) storage?.setItem?.(SAFETY_KEY, BREATH_SAFETY_VERSION);
        else storage?.removeItem?.(SAFETY_KEY);
    } catch {
        // Private storage: the note is asked for again next time.
    }
}
