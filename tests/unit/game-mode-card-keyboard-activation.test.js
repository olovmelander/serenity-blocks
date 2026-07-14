import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';

/**
 * Regression: keyboard users could not select a game mode. The mode cards are
 * <div>s that only listened for `click`; a <div> never emits click on
 * Enter/Space, so keyboard activation fell through to the global start-modal
 * handler which launched the DEFAULT mode regardless of the focused card
 * (WCAG 2.1.1 / 4.1.2), while the card still played a "confirmed" chime.
 *
 * setupModeButtons() must now: (a) launch the focused card's OWN mode on
 * Enter/Space, (b) stopPropagation so the global handler can't also fire, and
 * (c) expose each card as a real button (role + aria-label + aria-describedby).
 */

class FakeEl extends EventTarget {
    constructor(id, mode) {
        super();
        this.id = id;
        this.dataset = mode ? { mode } : {};
        this._attrs = {};
        this.title = '';
        const cls = new Set(['game-mode-card']);
        this.classList = {
            add: (c) => cls.add(c),
            remove: (c) => cls.delete(c),
            toggle: (c, f) => (f ? cls.add(c) : cls.delete(c)),
            contains: (c) => cls.has(c),
        };
        this._desc = { id: '', textContent: 'description' };
        this._icon = { setAttribute: () => {} };
    }

    setAttribute(k, v) { this._attrs[k] = String(v); }

    getAttribute(k) { return this._attrs[k] ?? null; }

    hasAttribute(k) { return k in this._attrs; }

    querySelector(sel) {
        if (sel === '.mode-card-title') return { textContent: this.id };
        if (sel === '.mode-card-desc') return this._desc;
        if (sel === '.mode-card-icon') return this._icon;
        return null;
    }
}

const CARD_IDS = {
    'single-player-card-btn': 'single',
    'local-multiplayer-card-btn': 'local-multiplayer',
    'online-multiplayer-card-btn': 'online-multiplayer',
    'serenity-card-btn': 'serenity',
    'infinity-card-btn': 'infinity',
    'odyssey-card-btn': 'odyssey',
};

describe('game-mode card keyboard activation', () => {
    let els;
    let GameModeUI;
    const saved = {};

    beforeEach(async () => {
        els = {};
        Object.entries(CARD_IDS).forEach(([id, mode]) => { els[id] = new FakeEl(id, mode); });

        for (const g of ['window', 'document', 'CustomEvent', 'localStorage']) saved[g] = globalThis[g];
        globalThis.window = new EventTarget();
        globalThis.window.location = { search: '' };
        globalThis.CustomEvent = function CustomEvent(type, opts) {
            const ev = new Event(type);
            ev.detail = opts?.detail;
            return ev;
        };
        globalThis.localStorage = { getItem: () => null };
        globalThis.document = { getElementById: (id) => els[id] || null, activeElement: null };

        ({ GameModeUI } = await import('../../src/ui/game-mode-ui.js'));
    });

    afterEach(() => {
        for (const g of ['window', 'document', 'CustomEvent', 'localStorage']) globalThis[g] = saved[g];
    });

    function pressKey(el, key) {
        const ev = new Event('keydown');
        ev.key = key;
        let stopped = false;
        const orig = ev.stopPropagation.bind(ev);
        ev.stopPropagation = () => { stopped = true; orig(); };
        el.dispatchEvent(ev);
        return stopped;
    }

    it('launches the focused card\'s own mode on Enter and blocks the global handler', () => {
        const ui = new GameModeUI(); // eslint-disable-line no-unused-vars
        let launched = null;
        window.addEventListener('startGameWithMode', (e) => { launched = e.detail.mode; });

        const stopped = pressKey(els['odyssey-card-btn'], 'Enter');

        expect(launched).toBe('odyssey');
        expect(stopped).toBe(true);
    });

    it('launches on Space too (not just Enter)', () => {
        const ui = new GameModeUI(); // eslint-disable-line no-unused-vars
        let launched = null;
        window.addEventListener('startGameWithMode', (e) => { launched = e.detail.mode; });

        pressKey(els['serenity-card-btn'], ' ');

        expect(launched).toBe('serenity');
    });

    it('exposes each card as a real button for assistive tech', () => {
        const ui = new GameModeUI(); // eslint-disable-line no-unused-vars
        const odyssey = els['odyssey-card-btn'];
        expect(odyssey.getAttribute('role')).toBe('button');
        expect(odyssey.getAttribute('aria-label')).toBeTruthy();
        expect(odyssey.getAttribute('aria-describedby')).toBeTruthy();
    });

    it('does not launch on other keys', () => {
        const ui = new GameModeUI(); // eslint-disable-line no-unused-vars
        let launched = null;
        window.addEventListener('startGameWithMode', (e) => { launched = e.detail.mode; });

        pressKey(els['infinity-card-btn'], 'a');

        expect(launched).toBeNull();
    });
});
