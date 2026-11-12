/**
 * The breathing features' safety note, and the rules for strong breathing, in one place.
 *
 * Strong breathing: a rhythm whose whole breath (in, hold, out, rest) takes five seconds or less,
 * or a hold after it. Before the first strong practice (a guided session or a world on its own)
 * the note is shown and the practice waits for its tick. It is read once for both the Sessions and
 * the Breathing tab, and asked again when its words change (BREATH_SAFETY_VERSION). Until then no
 * path starts a strong world or switches to one: every path asks canPractise().
 *
 * A strong world on its own runs for STRONG_WORLD_BREATHS breaths, then rests for at least
 * STRONG_REST_SECONDS before it can run again (createStrongDose).
 */

/** A breath this short or shorter, in seconds, is fast breathing. */
export const STRONG_BREATH_CYCLE_SECONDS = 5;
/** A fast world on its own breathes this many breaths, then rests. */
export const STRONG_WORLD_BREATHS = 30;
/** The rest after them: slow, natural breathing for at least this long. */
export const STRONG_REST_SECONDS = 60;

/** The note: a lead line, then a short list (breathCautionMarkup draws it the same everywhere). */
export const BREATH_CAUTION = Object.freeze({
    lead: 'For adults only. Fast breathing, and holding your breath after it, can make you light-headed '
        + 'or faint.',
    points: Object.freeze([
        'Sit or lie down. Never practise in or near water or a bath, while driving, or standing.',
        'Do not practise it if you are pregnant, or have epilepsy or have had seizures, a heart or '
            + 'blood-pressure condition, an aneurysm, asthma or COPD, a past stroke, a history of fainting, '
            + 'panic attacks or a serious mental-health condition, or have had surgery recently.',
        'If you have any medical condition or take medication, ask a doctor first.',
        'Never force a hold: breathe whenever you need to. Tingling or cramping hands mean ease off: '
            + 'slow down, or breathe normally.',
        'Stop and breathe normally if you feel chest pain or feel unwell. If you faint, stop for the '
            + 'day, and get help if you do not recover quickly.',
    ]),
});

/** The whole note as one text. */
export const BREATH_CAUTION_TEXT = [BREATH_CAUTION.lead, ...BREATH_CAUTION.points].join(' ');

/** The words beside the tick that opens strong practice. */
export const BREATH_SAFETY_ACK = 'I am 18 or over, I have read this, and none of it applies to me';

export const BREATH_WELLNESS_TEXT = 'For relaxation only: not medical advice, treatment or a medical device.';

/**
 * The note as markup: its lead line, its list, and any closing line.
 * @param {{icon?: string, closing?: string}} [options] trusted markup and text of the game's own
 */
export function breathCautionMarkup({ icon = '', closing = '' } = {}) {
    const points = BREATH_CAUTION.points.map((point) => `<li>${point}</li>`).join('');
    return [
        `<p class="breath-note__lead">${icon}<span>${BREATH_CAUTION.lead}</span></p>`,
        `<ul class="breath-note__points">${points}</ul>`,
        closing ? `<p class="breath-note__closing">${closing}</p>` : '',
    ].join('');
}

const SAFETY_KEY = 'serenity.breathSafetyRead';
/** Bump when the note changes in substance: everyone reads the new note once. */
export const BREATH_SAFETY_VERSION = '2026-11-12';

/** True for a [in, hold, out, rest] rhythm fast enough to need the note. */
export function isStrongPattern(pattern) {
    if (!Array.isArray(pattern)) return false;
    const cycle = pattern.reduce((sum, seconds) => sum + (Number(seconds) || 0), 0);
    return cycle > 0 && cycle <= STRONG_BREATH_CYCLE_SECONDS;
}

/** True for a session (its phases) with a hold after a round, or a fast breathing round. */
export function isStrongSession(phases = []) {
    return phases.some((phase) => phase.type === 'retention'
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

/**
 * The one rule for starting a rhythm or switching to it: a gentle rhythm always may be practised,
 * a strong one only once the current note has been read on this machine.
 * @param {number[]} pattern [in, hold, out, rest] seconds
 */
export function canPractise(pattern, storage = defaultStorage()) {
    return !isStrongPattern(pattern) || isBreathSafetyRead(storage);
}

/**
 * Counts the fast breaths of a practice of your own. After STRONG_WORLD_BREATHS the world rests;
 * the count starts over once STRONG_REST_SECONDS have passed without a fast breath, however the
 * practice was stopped, started or moved between worlds meanwhile.
 * @returns {{breath: (now: number) => boolean, restLeft: (now: number) => number}} times in ms
 */
export function createStrongDose() {
    let breaths = 0;
    let lastAt = -Infinity;
    const settle = (now) => {
        if (now - lastAt >= STRONG_REST_SECONDS * 1000) breaths = 0;
    };
    return {
        /** A fast breath was completed. Returns whether the rest is due now. */
        breath(now) {
            settle(now);
            breaths += 1;
            lastAt = now;
            return breaths >= STRONG_WORLD_BREATHS;
        },
        /** Milliseconds of rest still to come before fast breathing may run again (0: none). */
        restLeft(now) {
            settle(now);
            return breaths >= STRONG_WORLD_BREATHS ? lastAt + STRONG_REST_SECONDS * 1000 - now : 0;
        },
    };
}
