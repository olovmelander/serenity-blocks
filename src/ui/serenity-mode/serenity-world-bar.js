/**
 * The world bar: Serenity Mode's one piece of chrome, at the top centre.
 *
 *     ‹   Theme 3 of 15 · Firefly Night · ♪ Echoes of the Soul   ›
 *              [ Drift · with the music ]  [ Rest off ]
 *
 * It names what you are watching and listening to, and its arrows step between themes the
 * way the breathing guide's arrows step between its worlds (the same keys, ← and →). It is
 * there when you reach for it — pointer movement, a key, a change of theme or song — and
 * leaves when you are still, so the theme has the screen. It never shows over the Hub, the
 * breathing guide or the rest veil.
 *
 * Styles: public/styles/keystone-overlays.css (`#serenity-world-bar`). `.serenity-hub` keeps
 * a press on it from also touching the world behind it.
 */
import { csIcon } from '../components/cosmic-icons.js';

/** How long the bar stays after you reach for it, and after it has something to announce. */
export const AWAKE_MS = 3200;
export const ANNOUNCE_MS = 5200;

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export class SerenityWorldBar {
    /**
     * @param {object} options
     * @param {(direction: number) => void} options.onStep
     * @param {() => void} options.onDrift a press on the drift chip
     * @param {() => void} options.onRest a press on the rest chip
     * @param {HTMLElement} [options.host]
     */
    constructor({
        onStep, onDrift, onRest, host = document.body,
    }) {
        this.onStep = onStep;
        this.onDrift = onDrift;
        this.onRest = onRest;
        this.timer = null;
        this.covered = false;
        this.abort = new AbortController();
        this._build(host);
    }

    _build(host) {
        const root = el('div', 'serenity-world-bar serenity-hub');
        root.id = 'serenity-world-bar';
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', 'Theme');
        const arrow = (direction, label, glyph, key) => {
            const side = direction < 0 ? 'prev' : 'next';
            const button = el('button', `serenity-world-bar__arrow serenity-world-bar__arrow--${side}`, glyph);
            button.type = 'button';
            button.dataset.step = String(direction);
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-keyshortcuts', key);
            return button;
        };
        this.prev = arrow(-1, 'Previous theme', '‹', 'ArrowLeft');
        this.next = arrow(1, 'Next theme', '›', 'ArrowRight');
        const label = el('div', 'serenity-world-bar__label');
        this.eyebrow = el('p', 'serenity-world-bar__eyebrow');
        this.name = el('p', 'serenity-world-bar__name');
        this.name.setAttribute('aria-live', 'polite');
        this.song = el('p', 'serenity-world-bar__song');
        this.songIcon = el('span', 'serenity-world-bar__note');
        this.songIcon.setAttribute('aria-hidden', 'true');
        this.songIcon.innerHTML = csIcon('note', 13);
        this.songText = el('span', 'serenity-world-bar__song-text');
        this.song.append(this.songIcon, this.songText);
        label.append(this.eyebrow, this.name, this.song);
        const chips = el('div', 'serenity-world-bar__chips');
        const chip = (kind) => {
            const button = el('button', `serenity-world-bar__chip serenity-world-bar__chip--${kind}`);
            button.type = 'button';
            button.dataset.chip = kind;
            return button;
        };
        this.driftChip = chip('drift');
        this.restChip = chip('rest');
        chips.append(this.driftChip, this.restChip);
        root.append(this.prev, label, this.next, chips);

        const { signal } = this.abort;
        root.addEventListener('click', (event) => {
            const step = event.target.closest?.('[data-step]');
            const kind = event.target.closest?.('[data-chip]')?.dataset.chip;
            if (step) this.onStep(Number(step.dataset.step));
            else if (kind === 'drift') this.onDrift();
            else if (kind === 'rest') this.onRest();
            else return;
            this.wake();
        }, { signal });
        // A press on a button must not also reach Serenity's own Space / Enter shortcuts.
        root.addEventListener('keydown', (event) => {
            const activates = event.key === ' ' || event.key === 'Enter';
            if (activates && event.target.closest?.('button')) event.stopPropagation();
        }, { signal });
        root.addEventListener('pointerenter', () => this.wake(), { signal });
        this.root = root;
        host.appendChild(root);
    }

    /**
     * @param {object} state
     * @param {string} state.name the theme's name
     * @param {number} state.index its place among your themes (0-based; -1 unknown)
     * @param {number} state.total how many themes you have
     * @param {string} [state.song] the song's title
     * @param {string} state.driftChip @param {string} state.driftLabel
     * @param {string} state.restChip @param {string} state.restLabel
     * @param {boolean} [state.arriving] the theme is still being built
     */
    update(state) {
        const alone = !(state.total > 1);
        let eyebrow = 'Your theme · Odyssey brings more';
        if (!alone) eyebrow = state.index >= 0 ? `Theme ${state.index + 1} of ${state.total}` : `${state.total} themes`;
        setText(this.eyebrow, eyebrow);
        setText(this.name, state.name || '');
        setText(this.songText, state.song || '');
        this.song.hidden = !state.song;
        setText(this.driftChip, state.driftChip);
        this.driftChip.setAttribute('aria-label', state.driftLabel);
        this.driftChip.classList.toggle('is-on', state.driftChip !== 'Drift off');
        setText(this.restChip, state.restChip);
        this.restChip.setAttribute('aria-label', state.restLabel);
        this.restChip.classList.toggle('is-on', state.restChip !== 'Rest off');
        this.root.classList.toggle('is-alone', alone);
        this.root.classList.toggle('is-arriving', Boolean(state.arriving));
        this.prev.disabled = alone;
        this.next.disabled = alone;
    }

    /** Show the bar for a while (pointer movement, a key, a press on it). */
    wake(ms = AWAKE_MS) {
        if (this.covered) return;
        this.root.classList.add('is-awake');
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.root.classList.remove('is-awake');
        }, ms);
    }

    /** A new theme or song: show it a little longer, so it can be read. */
    announce() {
        this.wake(ANNOUNCE_MS);
    }

    /** Leave the screen at once (the cursor is resting, the mode is leaving). */
    sleep() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.root.classList.remove('is-awake');
    }

    /** Something else has the screen (the Hub, the breathing guide, the rest veil). */
    setCovered(covered) {
        this.covered = Boolean(covered);
        this.root.classList.toggle('is-covered', this.covered);
        if (this.covered) this.sleep();
    }

    destroy() {
        this.sleep();
        this.abort.abort();
        this.root.remove();
    }
}

function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
}
