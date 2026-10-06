import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// A minimal DOM: just what the play rail touches (ids, order, attributes, labels, docks).
function makeElement(tag, id = '') {
    const classes = new Set();
    return {
        tagName: tag.toUpperCase(),
        id,
        children: [],
        parentElement: null,
        dataset: {},
        attributes: {},
        innerHTML: '',
        className: '',
        onScreen: true,
        click: vi.fn(),
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            contains: (name) => classes.has(name),
            replace: (from, to) => { classes.delete(from); classes.add(to); },
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        appendChild(child) { return this.insertBefore(child, null); },
        insertBefore(child, reference) {
            if (child.parentElement) {
                const siblings = child.parentElement.children;
                siblings.splice(siblings.indexOf(child), 1);
            }
            const index = reference ? this.children.indexOf(reference) : -1;
            if (index >= 0) this.children.splice(index, 0, child);
            else this.children.push(child);
            child.parentElement = this;
            return child;
        },
        contains(node) {
            for (let at = node; at; at = at.parentElement) if (at === this) return true;
            return false;
        },
        getClientRects() { return this.onScreen ? [{}] : []; },
        getBoundingClientRect() {
            return {
                left: 0, top: 0, width: this.onScreen ? 90 : 0, height: 48,
            };
        },
        get firstElementChild() { return this.children[0] || null; },
        get nextElementSibling() {
            const siblings = this.parentElement?.children || [];
            return siblings[siblings.indexOf(this) + 1] || null;
        },
    };
}

function find(root, id) {
    if (root.id === id) return root;
    for (const child of root.children) {
        const hit = find(child, id);
        if (hit) return hit;
    }
    return null;
}

function setup(modeId = 'single', { settings = {}, docks = [] } = {}) {
    const body = makeElement('body');
    // Created in the page's order: the gear first, the lotus later.
    body.appendChild(makeElement('button', 'settings-btn-global'));
    body.appendChild(makeElement('div', 'serenity-hub-icon'));
    docks.forEach((dock) => body.appendChild(dock));
    const handlers = new Map();
    const manager = {
        currentModeId: modeId,
        on: vi.fn((event, handler) => handlers.set(event, handler)),
    };
    const store = new Map();
    let observe = null;
    let keydown = null;
    let visibleModal = null;
    vi.stubGlobal('document', {
        body,
        createElement: (tag) => makeElement(tag),
        getElementById: (id) => find(body, id),
        querySelectorAll: (selector) => (selector === '[data-play-dock]' ? docks : []),
        querySelector: (selector) => (selector === '.modal.visible' ? visibleModal : null),
        addEventListener: (type, handler) => { if (type === 'keydown') keydown = handler; },
        elementFromPoint: () => find(body, 'sb-play-rail'),
    });
    const hub = { hide: vi.fn() };
    vi.stubGlobal('window', {
        serenityBlocks: { gameModeManager: manager, serenityHub: hub },
        settingsManager: { get: () => settings },
        addEventListener: vi.fn(),
        matchMedia: () => ({ matches: false }),
        localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    });
    vi.stubGlobal('MutationObserver', class {
        constructor(callback) { observe = callback; }

        observe() {}
    });
    const press = (key, target = { closest: () => null }) => {
        const event = {
            key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
        };
        keydown(event);
        return event;
    };
    return {
        body,
        manager,
        handlers,
        hub,
        store,
        press,
        mutate: (nodes) => observe([{ addedNodes: nodes }]),
        showModal: (modal) => { visibleModal = modal; },
    };
}

const labelText = (tile) => tile.children.find((child) => child.className === 'sb-play-rail__label')?.innerHTML || '';

async function install() {
    const { installPlayRail } = await import('../../src/ui/keystone/play-rail.js');
    return installPlayRail();
}

describe('play rail', () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('adopts the controls in order, with Settings in the corner and their keys named', async () => {
        const { body } = setup('single');
        const rail = await install();

        expect(body.children.at(-1)).toBe(rail);
        expect(rail.children.map((tile) => tile.id)).toEqual(['serenity-hub-icon', 'settings-btn-global']);
        const [hub, gear] = rail.children;
        expect(labelText(gear)).toContain('Settings');
        expect(labelText(gear)).toContain('>Esc<');
        expect(gear.getAttribute('aria-label')).toBe('Settings');
        expect(labelText(hub)).toContain('Serenity Hub');
        expect(labelText(hub)).toContain('>H<');
        // Outside Serenity the pad reaches the Hub through Settings, not Y.
        expect(labelText(hub)).not.toContain('>Y<');
        expect(rail.dataset.mode).toBe('single');
    });

    it('in Serenity, shows the pad Hub button and leaves Escape to "back to the menu"', async () => {
        setup('serenity');
        const [hub, gear] = (await install()).children;

        expect(labelText(hub)).toContain('>H<');
        expect(labelText(hub)).toContain('>Y<');
        expect(labelText(gear)).not.toContain('Esc');
    });

    it('names the rebound Hub key', async () => {
        setup('single', { settings: { serenityKeyBindings: { toggleHub: 'g' } } });
        const [hub] = (await install()).children;

        expect(labelText(hub)).toContain('>G<');
    });

    it('adopts the Odyssey navigator when it arrives, ahead of the Hub', async () => {
        const { body, mutate } = setup('odyssey');
        const rail = await install();
        const navigator = makeElement('div', 'odyssey-navigator-btn');
        body.appendChild(navigator);
        mutate([navigator]);

        expect(rail.children.map((tile) => tile.id))
            .toEqual(['odyssey-navigator-btn', 'serenity-hub-icon', 'settings-btn-global']);
        expect(labelText(navigator)).toContain('Levels');
    });

    it('relabels when the mode changes, and reads as the menu while it is open', async () => {
        const { body, manager, handlers } = setup('single');
        const rail = await install();

        manager.currentModeId = 'serenity';
        handlers.get('modeActivated')();
        expect(labelText(rail.children[1])).not.toContain('Esc');

        body.classList.add('start-modal-open');
        handlers.get('modeStopped')();
        expect(rail.dataset.mode).toBe('menu');
    });

    it('joins a mode\'s chrome when its dock is on screen, and floats again when it leaves', async () => {
        const dock = makeElement('div');
        dock.setAttribute('data-play-dock', 'online');
        dock.onScreen = false;
        const { body, manager, handlers } = setup('single', { docks: [dock] });
        const rail = await install();
        expect(rail.parentElement).toBe(body);
        expect(rail.dataset.dock).toBeUndefined();

        dock.onScreen = true;
        manager.currentModeId = 'online-multiplayer';
        handlers.get('modeActivated')();
        expect(rail.parentElement).toBe(dock);
        expect(rail.dataset.dock).toBe('online');

        dock.onScreen = false;
        manager.currentModeId = 'single';
        handlers.get('modeActivated')();
        expect(rail.parentElement).toBe(body);
        expect(rail.dataset.dock).toBeUndefined();
    });

    it('opens the Hub with its key in every mode Serenity does not handle itself', async () => {
        const { body, manager, press } = setup('local-multiplayer');
        const rail = await install();
        const hubTile = rail.children[0];

        expect(press('h').defaultPrevented).toBe(true);
        expect(hubTile.click).toHaveBeenCalledTimes(1);

        // Typing in the chat, or Serenity Mode (which binds its own), leave it alone.
        press('h', { closest: () => ({}) });
        manager.currentModeId = 'serenity';
        press('h');
        body.classList.add('start-modal-open');
        manager.currentModeId = 'single';
        press('h');
        expect(hubTile.click).toHaveBeenCalledTimes(1);
    });

    it('leaves the key to the game when a player has it bound', async () => {
        const { press } = setup('local-multiplayer', { settings: { player2KeyBindings: { flip: 'H' } } });
        const [hubTile] = (await install()).children;

        expect(press('h').defaultPrevented).toBe(false);
        expect(hubTile.click).not.toHaveBeenCalled();
    });

    it('stays out of an open Settings sheet, and closes an open Hub with the same key', async () => {
        const {
            body, hub, press, showModal,
        } = setup('single');
        const [hubTile] = (await install()).children;

        showModal({});
        press('h');
        expect(hubTile.click).not.toHaveBeenCalled();

        showModal(null);
        body.classList.add('serenity-hub-open');
        press('h');
        expect(hub.hide).toHaveBeenCalledTimes(1);
        expect(hubTile.click).not.toHaveBeenCalled();
    });

    it('names its controls in the tray for a mode\'s first runs, then folds away', async () => {
        vi.useFakeTimers();
        const { manager, handlers, store } = setup('single');
        const rail = await install();

        for (let run = 1; run <= 4; run += 1) {
            handlers.get('modeStarted')();
            // After the countdown most modes open with.
            vi.advanceTimersByTime(3300);
            const peeked = rail.classList.contains('is-peek');
            expect(peeked).toBe(run <= 3);
            vi.advanceTimersByTime(10000);
            expect(rail.classList.contains('is-peek')).toBe(false);
            expect(rail.classList.contains('is-folding')).toBe(false);
        }
        expect(JSON.parse(store.get('serenity.playRail.peeks'))).toEqual({ single: 3 });
        expect(manager.on).toHaveBeenCalled();
    });
});
