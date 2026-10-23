/**
 * The world caption: what Serenity Mode says over the theme, in the breathing guide's language.
 * No panels: words on the world itself, over a soft shade that comes and goes with them, in the
 * theme's own light (--world-accent, serenity-theme-accent.js).
 *
 *                        ■ NATURE · 7 OF 10
 *            ‹              Crystal Cave               ›
 *                         ♪ Crystal Cave
 *                       ▪▪▪▪▪▪█▪▪▪            (your themes; the one on screen lit,
 *                                              filling toward the next when it drifts)
 *
 *       [ ◌ Drift · with the music ]  [ ☾ Rest off ]  [ ✦ Effects ]      (the dock, below)
 *
 * While Play all runs with the effects tray folded away, the effects tile says how far it has
 * come ("Effects · 5 of 16") and a Stop tile stands beside it.
 *
 * The arrows step between your themes as the guide's step between its worlds (the same keys,
 * ← and →). It is there when you reach for it — pointer movement, a key, a change of theme or
 * song — and leaves when you are still, so the theme has the screen. It never shows over the
 * Hub, the breathing guide or the rest veil.
 *
 * The layer covers the screen but only its buttons take the pointer, so a press anywhere else
 * still touches the world. Styles: public/styles/keystone-overlays.css (`#serenity-world-bar`).
 */
import { csIcon } from '../components/cosmic-icons.js';
import { TRAY_ID } from './serenity-effects-tray.js';

/** How long the caption stays after you reach for it, and after it has something to announce. */
export const AWAKE_MS = 3200;
export const ANNOUNCE_MS = 5200;
/** More themes than this and the collection strip would be dust: it is left out. */
const STRIP_MAX = 80;

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
     * @param {() => void} options.onDrift a press on the drift tile
     * @param {() => void} options.onRest a press on the rest tile
     * @param {() => void} [options.onEffects] a press on the effects tile
     * @param {() => void} [options.onStopEffects] a press on Stop (while Play all runs)
     * @param {HTMLElement} [options.host]
     */
    constructor({
        onStep, onDrift, onRest, onEffects = () => {}, onStopEffects = () => {}, host = document.body,
    }) {
        this.onStep = onStep;
        this.onDrift = onDrift;
        this.onRest = onRest;
        this.onEffects = onEffects;
        this.onStopEffects = onStopEffects;
        this.timer = null;
        this.covered = false;
        this.stripTotal = -1;
        this.fillKey = '';
        this.abort = new AbortController();
        this._build(host);
    }

    _build(host) {
        const root = el('div', 'serenity-world serenity-hub');
        root.id = 'serenity-world-bar';
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', 'Theme');
        const top = el('div', 'serenity-world__shade serenity-world__shade--top');
        const bottom = el('div', 'serenity-world__shade serenity-world__shade--bottom');
        top.setAttribute('aria-hidden', 'true');
        bottom.setAttribute('aria-hidden', 'true');

        const arrow = (direction, label, key) => {
            const side = direction < 0 ? 'prev' : 'next';
            const glyph = direction < 0 ? '‹' : '›';
            const button = el('button', `serenity-world__arrow serenity-world__arrow--${side}`, glyph);
            button.type = 'button';
            button.dataset.step = String(direction);
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-keyshortcuts', key);
            return button;
        };
        this.prev = arrow(-1, 'Previous theme', 'ArrowLeft');
        this.next = arrow(1, 'Next theme', 'ArrowRight');
        const words = el('div', 'serenity-world__words');
        this.eyebrow = el('p', 'serenity-world__eyebrow');
        this.name = el('h2', 'serenity-world__name');
        this.name.setAttribute('aria-live', 'polite');
        this.song = el('p', 'serenity-world__song');
        const note = el('span', 'serenity-world__note');
        note.setAttribute('aria-hidden', 'true');
        note.innerHTML = csIcon('note', 14);
        this.songText = el('span', 'serenity-world__song-text');
        this.song.append(note, this.songText);
        this.strip = el('div', 'serenity-world__strip');
        this.strip.setAttribute('aria-hidden', 'true');
        words.append(this.eyebrow, this.name, this.song, this.strip);
        const caption = el('header', 'serenity-world__caption');
        caption.append(this.prev, words, this.next);

        const tile = (kind, icon) => {
            const button = el('button', `serenity-world__tile serenity-world__tile--${kind}`);
            button.type = 'button';
            button.dataset.chip = kind;
            const glyph = el('span', 'serenity-world__tile-icon');
            glyph.setAttribute('aria-hidden', 'true');
            glyph.innerHTML = csIcon(icon, 16);
            const text = el('span', 'serenity-world__tile-text');
            button.append(glyph, text);
            return { button, text };
        };
        const drift = tile('drift', 'cycle');
        const rest = tile('rest', 'moon');
        const effects = tile('effects', 'burst');
        this.driftChip = drift.button;
        this.driftText = drift.text;
        this.restChip = rest.button;
        this.restText = rest.text;
        this.effectsChip = effects.button;
        this.effectsText = effects.text;
        effects.text.textContent = 'Effects';
        this.effectsChip.setAttribute('aria-controls', TRAY_ID);
        this.effectsChip.setAttribute('aria-expanded', 'false');
        this.effectsChip.setAttribute('aria-label', 'Theme effects: watch what this theme does when you play');
        // Only while Play all runs with the tray folded away: the tray has its own Stop.
        const stop = tile('stop', 'square');
        this.stopChip = stop.button;
        this.stopChip.setAttribute('aria-label', 'Stop playing every effect');
        this.stopChip.hidden = true;
        const dock = el('nav', 'serenity-world__dock');
        dock.setAttribute('aria-label', 'Serenity');
        dock.append(this.driftChip, this.restChip, this.effectsChip, this.stopChip);

        root.append(top, bottom, caption, dock);

        const { signal } = this.abort;
        root.addEventListener('click', (event) => {
            const step = event.target.closest?.('[data-step]');
            const kind = event.target.closest?.('[data-chip]')?.dataset.chip;
            if (step) this.onStep(Number(step.dataset.step));
            else if (kind === 'drift') this.onDrift();
            else if (kind === 'rest') this.onRest();
            else if (kind === 'effects') this.onEffects();
            else if (kind === 'stop') this.onStopEffects();
            else return;
            this.wake();
        }, { signal });
        // A press on a button must not also reach Serenity's own Space / Enter shortcuts.
        root.addEventListener('keydown', (event) => {
            const activates = event.key === ' ' || event.key === 'Enter';
            if (activates && event.target.closest?.('button')) event.stopPropagation();
        }, { signal });
        // Only the buttons take the pointer; reaching one keeps everything in view.
        [caption, dock].forEach((part) => part.addEventListener('pointerover', () => this.wake(), { signal }));
        this.root = root;
        host.appendChild(root);
    }

    /**
     * @param {object} state
     * @param {string} state.name the theme's name
     * @param {string} [state.group] its category's name (Nature, Cosmic…)
     * @param {number} state.index its place among your themes (0-based; -1 unknown)
     * @param {number} state.total how many themes you have
     * @param {string} [state.song] the song's title
     * @param {number[]} [state.accent] the theme's light, [r, g, b]
     * @param {{from: number, ms: number}|null} [state.driftFill] how far the world has come
     *   toward its next drift (0..1) and how long is left; null when it does not drift
     * @param {string} state.driftChip @param {string} state.driftLabel
     * @param {string} state.restChip @param {string} state.restLabel
     * @param {boolean} [state.arriving] the theme is still being built
     * @param {boolean} [state.effectsOpen] the effects tray is open
     * @param {{index: number, total: number}|null} [state.effectsTour] where Play all has got to
     *   (0-based), while it runs
     */
    update(state) {
        const alone = !(state.total > 1);
        const group = state.group ? `${state.group} · ` : '';
        let eyebrow = 'Your first theme · the Odyssey brings more';
        if (!alone && state.index >= 0) eyebrow = `${group}${state.index + 1} of ${state.total}`;
        else if (!alone) eyebrow = `${state.total} themes`;
        setText(this.eyebrow, eyebrow);
        setText(this.name, state.name || '');
        setText(this.songText, state.song || '');
        this.song.hidden = !state.song;
        if (Array.isArray(state.accent)) setStyle(this.root, '--world-accent', state.accent.join(', '));
        this._renderStrip(alone ? 0 : state.total, state.index, state.driftFill || null);
        setText(this.driftText, state.driftChip);
        this.driftChip.setAttribute('aria-label', state.driftLabel);
        this.driftChip.classList.toggle('is-on', state.driftChip !== 'Drift off');
        setText(this.restText, state.restChip);
        this.restChip.setAttribute('aria-label', state.restLabel);
        this.restChip.classList.toggle('is-on', state.restChip !== 'Rest off');
        const tour = state.effectsTour || null;
        const folded = Boolean(tour) && !state.effectsOpen;
        setText(this.effectsText, folded ? `Effects · ${tour.index + 1} of ${tour.total}` : 'Effects');
        this.effectsChip.classList.toggle('is-on', Boolean(state.effectsOpen) || Boolean(tour));
        this.effectsChip.setAttribute('aria-expanded', String(Boolean(state.effectsOpen)));
        this.stopChip.hidden = !folded;
        this.root.classList.toggle('is-alone', alone);
        this.root.classList.toggle('is-arriving', Boolean(state.arriving));
        this.prev.disabled = alone;
        this.next.disabled = alone;
    }

    /** One cell per theme you have, the one on screen lit; drifting, it fills toward the next. */
    _renderStrip(total, index, fill) {
        const count = total > 1 && total <= STRIP_MAX ? total : 0;
        if (count !== this.stripTotal) {
            this.stripTotal = count;
            this.strip.replaceChildren(...Array.from({ length: count }, () => el('i', '', undefined)));
            this.fillKey = '';
        }
        this.strip.hidden = count === 0;
        [...this.strip.children].forEach((cell, i) => cell.classList.toggle('is-here', i === index));
        const here = this.strip.children[index];
        const key = fill && here ? `${index}:${Math.round(fill.from * 1000)}:${Math.round(fill.ms / 1000)}` : '';
        if (key === this.fillKey) return;
        this.fillKey = key;
        [...this.strip.children].forEach((cell) => cell.replaceChildren());
        if (!key) return;
        // The fill runs on the compositor: from where drift stands now to full, over what is left.
        const bar = el('b');
        bar.style.setProperty('--fill-from', String(Math.max(0, Math.min(1, fill.from))));
        bar.style.animationDuration = `${Math.max(0, fill.ms)}ms`;
        here.appendChild(bar);
    }

    /** Show the caption for a while (pointer movement, a key, a press on it). */
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

    /** The keyboard follows Play all out of the folded tray, to the dock's Stop. */
    focusStop() {
        if (!this.stopChip.hidden) this.stopChip.focus({ preventScroll: true });
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

function setStyle(node, property, value) {
    if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
}
