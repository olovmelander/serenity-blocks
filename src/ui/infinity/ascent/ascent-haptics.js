// @ts-check

/**
 * The ascent in the hands: gamepad rumble for the moments of a look around the tower. Only while
 * the gamepad is what moves the view (a mouse scroll must not buzz a controller on the desk), and
 * only where the browser offers a vibration actuator (`dual-rumble`).
 */

/** Each moment's pulse: duration (ms) and the two motors (0..1). */
export const RUMBLE = Object.freeze({
    tick: { duration: 22, weak: 0.14, strong: 0 },
    give: { duration: 70, weak: 0.28, strong: 0.16 },
    dock: { duration: 40, weak: 0.22, strong: 0.08 },
    milestone: { duration: 95, weak: 0.36, strong: 0.26 },
    bump: { duration: 75, weak: 0.2, strong: 0.55 },
    land: { duration: 150, weak: 0.3, strong: 0.2 },
});

/** Ticks closer than this are dropped (a fast flight is a purr, not a buzz). */
const MIN_GAP_MS = 60;

export class AscentHaptics {
    /** @param {{getGamepads?: () => (Gamepad|null)[], now?: () => number}} [options] */
    constructor({ getGamepads, now } = {}) {
        this.getGamepads = getGamepads || (() => {
            try {
                return typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : [];
            } catch {
                return [];
            }
        });
        this.now = now || (() => (typeof performance !== 'undefined' ? performance.now() : 0));
        this.enabled = false;
        this.index = 0;
        this.lastAt = -Infinity;
    }

    /** The gamepad moves the view (or no longer does). @param {boolean} on @param {number} [index] */
    useGamepad(on, index = 0) {
        this.enabled = Boolean(on);
        if (Number.isInteger(index)) this.index = index;
    }

    /**
     * @param {keyof typeof RUMBLE} kind
     * @param {number} [scale] 0..1 on the pulse's strength
     * @returns {boolean} whether a pulse was sent
     */
    pulse(kind, scale = 1) {
        const pattern = RUMBLE[kind];
        if (!this.enabled || !pattern) return false;
        const now = this.now();
        if (kind === 'tick' && now - this.lastAt < MIN_GAP_MS) return false;
        const pad = this.getGamepads()[this.index];
        const actuator = /** @type {any} */ (pad)?.vibrationActuator;
        if (!actuator || typeof actuator.playEffect !== 'function') return false;
        const k = Math.min(1, Math.max(0, Number.isFinite(scale) ? scale : 1));
        this.lastAt = now;
        try {
            const done = actuator.playEffect('dual-rumble', {
                startDelay: 0,
                duration: pattern.duration,
                weakMagnitude: pattern.weak * k,
                strongMagnitude: pattern.strong * k,
            });
            done?.catch?.(() => {});
            return true;
        } catch {
            return false;
        }
    }
}
