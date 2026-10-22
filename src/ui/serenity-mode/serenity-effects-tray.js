/**
 * The effects tray: press an effect and watch what the theme does with it.
 *
 *     ■ EFFECTS                                 [ Play all ]  [ × ]
 *     Firefly Night
 *     What it does when you play
 *     Pieces       [Lock] [Hard drop]
 *     Line clears  [Single] [Double] [Triple] [Quad]
 *     Cascades     [3 waves] [6 waves] [10 waves]
 *     Chains       [Combo ×5] [Back-to-back]
 *     Moments      [T-spin] [Perfect clear] [Level up]
 *     Build-up     [Rush] [Fever]
 *     ← → another theme · E closes
 *
 * On a wide screen it stands at the right edge, clear of the middle where the board would be
 * and where the themes play their effects; on a phone it lies along the bottom. It stays until
 * you close it (E, Esc, its ×, the world bar's chip); it steps aside whenever something else
 * has the screen (the Hub, the breathing guide, the rest veil). While it is in view it owns
 * Esc, as the Hub does.
 *
 * The effects themselves are serenity-effects.js. Styles: public/styles/keystone-overlays.css
 * (`#serenity-effects`). `.serenity-hub` keeps a press on it from also touching the world.
 */
import { EFFECTS, EFFECT_GROUPS } from './serenity-effects.js';

export const TRAY_ID = 'serenity-effects';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export class SerenityEffectsTray {
    /**
     * @param {object} options
     * @param {(id: string) => void} options.onPlay
     * @param {() => void} options.onPlayAll a press on Play all (or Stop, while it plays)
     * @param {() => void} options.onClose
     * @param {{ effects: string, previous: string, next: string }} [options.keys] keycap text
     * @param {HTMLElement} [options.host]
     */
    constructor({
        onPlay, onPlayAll, onClose, keys = { effects: 'E', previous: '←', next: '→' }, host = document.body,
    }) {
        this.onPlay = onPlay;
        this.onPlayAll = onPlayAll;
        this.onClose = onClose;
        this.isOpen = false;
        this.covered = false;
        this.abort = new AbortController();
        /** @type {Map<string, HTMLButtonElement>} */
        this.buttons = new Map();
        this._build(host, keys);
    }

    _build(host, keys) {
        const root = el('section', 'serenity-effects serenity-hub');
        root.id = TRAY_ID;
        root.setAttribute('aria-labelledby', `${TRAY_ID}-title`);
        root.hidden = true;

        const head = el('header', 'serenity-effects__head');
        const titles = el('div', 'serenity-effects__titles');
        // The guide's three levels: where you are (Effects), the place (the theme), the line.
        const eyebrow = el('p', 'serenity-effects__eyebrow', 'Effects');
        this.title = el('h2', 'serenity-effects__title', 'This theme');
        this.title.id = `${TRAY_ID}-title`;
        this.subtitle = el('p', 'serenity-effects__subtitle', 'What it does when you play');
        titles.append(eyebrow, this.title, this.subtitle);
        this.playAll = el('button', 'serenity-effects__all', 'Play all');
        this.playAll.type = 'button';
        this.playAll.dataset.action = 'all';
        const close = el('button', 'serenity-effects__close', '×');
        close.type = 'button';
        close.dataset.action = 'close';
        close.setAttribute('aria-label', 'Close effects');
        head.append(titles, this.playAll, close);

        const groups = el('div', 'serenity-effects__groups');
        EFFECT_GROUPS.forEach((group) => {
            const row = el('div', 'serenity-effects__group');
            row.setAttribute('role', 'group');
            const label = el('p', 'serenity-effects__group-label', group.label);
            label.id = `${TRAY_ID}-group-${group.id}`;
            row.setAttribute('aria-labelledby', label.id);
            const list = el('div', 'serenity-effects__list');
            EFFECTS.filter((effect) => effect.group === group.id).forEach((effect) => {
                const button = el('button', 'serenity-effects__effect', effect.label);
                button.type = 'button';
                button.dataset.effect = effect.id;
                if (effect.name !== effect.label) button.title = effect.name;
                list.appendChild(button);
                this.buttons.set(effect.id, button);
            });
            row.append(label, list);
            groups.appendChild(row);
        });

        this.note = el('p', 'serenity-effects__note');
        this.note.setAttribute('role', 'status');
        this.note.hidden = true;
        // Rebound keys are the player's own text: keycaps are built, never parsed.
        const hint = el('p', 'serenity-effects__hint');
        const cap = (text) => el('kbd', 'sb-kbd', text);
        hint.append(cap(keys.previous), cap(keys.next), el('span', '', 'another theme'));
        hint.append(cap(keys.effects), el('span', '', 'closes'));
        // The keycaps say it to sighted players; the buttons say it to everyone else.
        hint.setAttribute('aria-hidden', 'true');

        root.append(head, groups, this.note, hint);

        const { signal } = this.abort;
        root.addEventListener('click', (event) => {
            const { target } = event;
            const effect = target.closest?.('[data-effect]');
            const action = target.closest?.('[data-action]')?.dataset.action;
            if (effect) this.onPlay(effect.dataset.effect);
            else if (action === 'all') this.onPlayAll();
            else if (action === 'close') this.onClose();
        }, { signal });
        // A press on a button must not also reach Serenity's own Space / Enter shortcuts.
        root.addEventListener('keydown', (event) => {
            const activates = event.key === ' ' || event.key === 'Enter';
            if (activates && event.target.closest?.('button')) event.stopPropagation();
        }, { signal });
        // Esc closes the tray first. The document's other Esc owners (Settings, in controls.js)
        // listen as it bubbles; this one listens on the way down, only while the tray is in view.
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !this.isOpen || this.covered) return;
            if (document.getElementById('settings-modal')?.classList.contains('visible')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.onClose();
        }, { signal, capture: true });
        this.root = root;
        host.appendChild(root);
    }

    /** @param {{ focus?: boolean }} [options] focus the first effect (opened from the keyboard) */
    open({ focus = false } = {}) {
        this.isOpen = true;
        this.root.hidden = false;
        // Laid out once at rest first, so it slides in rather than appearing.
        void this.root.offsetWidth; // eslint-disable-line no-void
        this.root.classList.add('is-open');
        document.body.classList.add('serenity-effects-open');
        if (focus) this.buttons.values().next().value?.focus({ preventScroll: true });
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        if (this.root.contains(document.activeElement)) /** @type {HTMLElement} */ (document.activeElement).blur();
        this.root.classList.remove('is-open');
        this.root.hidden = true;
        document.body.classList.remove('serenity-effects-open');
    }

    /** Something else has the screen (the Hub, the breathing guide, the rest veil). */
    setCovered(covered) {
        this.covered = Boolean(covered);
        this.root.classList.toggle('is-covered', this.covered);
    }

    /** @param {{ playing: string|null, touring: boolean }} state */
    setState({ playing, touring }) {
        this.buttons.forEach((button, id) => button.classList.toggle('is-playing', id === playing));
        this.playAll.textContent = touring ? 'Stop' : 'Play all';
        this.playAll.classList.toggle('is-on', touring);
        this.playAll.setAttribute('aria-label', touring ? 'Stop playing every effect' : 'Play every effect in turn');
    }

    /** @param {string} name the theme on screen */
    setTheme(name) {
        const text = name || 'This theme';
        if (this.title.textContent !== text) this.title.textContent = text;
    }

    /** @param {string} text a word about why nothing may show ('' for none) */
    setNote(text) {
        if (this.note.textContent !== text) this.note.textContent = text;
        this.note.hidden = !text;
    }

    destroy() {
        this.close();
        this.abort.abort();
        this.root.remove();
    }
}
