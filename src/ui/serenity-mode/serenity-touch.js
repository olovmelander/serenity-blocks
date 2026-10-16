/**
 * Touching the world in Serenity Mode: a press (mouse, pen or finger) where nothing else is
 * sends one soft ripple of light and asks the theme for its gentlest line-clear reaction.
 * There are no counts, no combos and no cooldown messages: a calm mode does not score you.
 * Many presses in a row are simply quieter — past TOUCH_BUDGET in TOUCH_WINDOW_MS the ripple
 * still answers but the theme rests.
 *
 * On a touch screen a horizontal swipe steps to the previous or next theme instead.
 *
 * Presses on any control (the world bar, the play rail, the Hub, a dialog, the breathing
 * guide) are theirs alone.
 */
import { emitLineClear } from '../../events/gameplay-events.js';

export const TOUCH_GAP_MS = 450;
export const TOUCH_BUDGET = 8;
export const TOUCH_WINDOW_MS = 12000;
const SWIPE_PX = 64;
const TAP_SLOP_PX = 14;
const RIPPLE_MS = 1100;

/** Anything a press on which belongs to a control, not to the world. */
const CONTROL_SELECTOR = [
    'button', 'a', 'input', 'select', 'textarea', 'label', '[role="button"]', '[role="dialog"]',
    '.serenity-hub', '.serenity-notification', '#settings-modal', '.breath-guide', '.hale-flow', '#sb-play-rail',
    '.modal', '.sb-sheet',
].join(', ');

/**
 * Whether a press belongs to the world (true) or to a control (false).
 * @param {EventTarget|null} target
 */
export function isWorldTarget(target) {
    return !target?.closest?.(CONTROL_SELECTOR);
}

/**
 * The touches the world answers: at most one per TOUCH_GAP_MS, and the theme's reaction only
 * for TOUCH_BUDGET of them in any TOUCH_WINDOW_MS.
 * @param {() => number} [now]
 * @returns {() => 'touch'|'ripple'|'none'} what each press does
 */
export function createTouchRhythm(now = () => Date.now()) {
    let times = [];
    return () => {
        const t = now();
        const last = times[times.length - 1];
        if (last !== undefined && t - last < TOUCH_GAP_MS) return 'none';
        times = times.filter((time) => t - time < TOUCH_WINDOW_MS);
        times.push(t);
        return times.length <= TOUCH_BUDGET ? 'touch' : 'ripple';
    };
}

export class SerenityTouch {
    /**
     * @param {object} options
     * @param {() => boolean} options.isLive the mode is running and the world is on screen
     * @param {(direction: number) => void} options.onSwipe
     * @param {() => void} [options.onTouch] after a touch (the world bar wakes)
     */
    constructor({ isLive, onSwipe, onTouch = () => {} }) {
        this.isLive = isLive;
        this.onSwipe = onSwipe;
        this.onTouch = onTouch;
        this.rhythm = createTouchRhythm();
        this.down = null;
        this.abort = new AbortController();
        const { signal } = this.abort;
        document.addEventListener('pointerdown', (event) => this._down(event), { signal, passive: true });
        document.addEventListener('pointerup', (event) => this._up(event), { signal, passive: true });
        document.addEventListener('pointercancel', () => { this.down = null; }, { signal, passive: true });
    }

    _down(event) {
        if (!event.isPrimary || event.button > 0 || !this.isLive() || !isWorldTarget(event.target)) {
            this.down = null;
            return;
        }
        this.down = { x: event.clientX, y: event.clientY, type: event.pointerType };
    }

    _up(event) {
        const start = this.down;
        this.down = null;
        if (!start || !event.isPrimary || !this.isLive()) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (start.type === 'touch' && Math.abs(dx) >= SWIPE_PX && Math.abs(dy) < Math.abs(dx) * 0.6) {
            // A swipe moves the world: to the left brings the next theme in.
            this.onSwipe(dx < 0 ? 1 : -1);
            return;
        }
        if (Math.hypot(dx, dy) > TAP_SLOP_PX) return;
        this.touch(event.clientX, event.clientY);
    }

    /**
     * Touch the world at a point (a press, or a controller's A at the centre).
     * @returns {boolean} whether the world answered
     */
    touch(x = window.innerWidth / 2, y = window.innerHeight / 2) {
        const answer = this.rhythm();
        if (answer === 'none') return false;
        showRipple(x, y);
        if (answer === 'touch') {
            emitLineClear({
                lineCount: 1, comboCount: 0, source: 'serenity-interaction', position: { x, y },
            });
        }
        this.onTouch();
        return true;
    }

    destroy() {
        this.abort.abort();
        this.down = null;
    }
}

function showRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'serenity-click-ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), RIPPLE_MS);
}
