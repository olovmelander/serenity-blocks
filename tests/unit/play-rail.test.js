import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// A minimal DOM: just what the play rail touches (ids, order, attributes, labels).
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
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
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

function setup(modeId = 'single') {
    const body = makeElement('body');
    // Created in the page's order: the gear first, the lotus later.
    body.appendChild(makeElement('button', 'settings-btn-global'));
    body.appendChild(makeElement('div', 'serenity-hub-icon'));
    const handlers = new Map();
    const manager = {
        currentModeId: modeId,
        on: vi.fn((event, handler) => handlers.set(event, handler)),
    };
    let observe = null;
    vi.stubGlobal('document', {
        body,
        createElement: (tag) => makeElement(tag),
        getElementById: (id) => find(body, id),
    });
    vi.stubGlobal('window', { serenityBlocks: { gameModeManager: manager }, addEventListener: vi.fn() });
    vi.stubGlobal('MutationObserver', class {
        constructor(callback) { observe = callback; }

        observe() {}
    });
    return {
        body, manager, handlers, mutate: (nodes) => observe([{ addedNodes: nodes }]),
    };
}

const labelText = (tile) => tile.children.find((child) => child.className === 'sb-play-rail__label')?.innerHTML || '';

describe('play rail', () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => vi.unstubAllGlobals());

    it('adopts the controls in order, with Pause in the corner', async () => {
        const { body } = setup('single');
        const { installPlayRail } = await import('../../src/ui/keystone/play-rail.js');
        const rail = installPlayRail();

        expect(body.children.at(-1)).toBe(rail);
        expect(rail.children.map((tile) => tile.id)).toEqual(['serenity-hub-icon', 'settings-btn-global']);
        expect(labelText(rail.children[1])).toContain('Pause');
        expect(labelText(rail.children[1])).toContain('Esc');
        expect(rail.children[1].getAttribute('aria-label')).toBe('Pause');
        expect(labelText(rail.children[0])).toContain('Serenity Hub');
        expect(rail.dataset.mode).toBe('single');
    });

    it('says Settings in an online match, which cannot pause', async () => {
        setup('online-multiplayer');
        const { installPlayRail } = await import('../../src/ui/keystone/play-rail.js');
        const gear = installPlayRail().children[1];

        expect(labelText(gear)).toContain('Settings');
        expect(gear.getAttribute('aria-label')).toBe('Settings');
    });

    it('in Serenity, shows the Hub key and leaves Escape to "back to the menu"', async () => {
        setup('serenity');
        const { installPlayRail } = await import('../../src/ui/keystone/play-rail.js');
        const [hub, gear] = installPlayRail().children;

        expect(labelText(hub)).toContain('>H<');
        expect(labelText(gear)).not.toContain('Esc');
    });

    it('adopts the Odyssey navigator when it arrives, ahead of the Hub', async () => {
        const { body, mutate } = setup('odyssey');
        const { installPlayRail } = await import('../../src/ui/keystone/play-rail.js');
        const rail = installPlayRail();
        const navigator = makeElement('div', 'odyssey-navigator-btn');
        body.appendChild(navigator);
        mutate([navigator]);

        expect(rail.children.map((tile) => tile.id))
            .toEqual(['odyssey-navigator-btn', 'serenity-hub-icon', 'settings-btn-global']);
        expect(labelText(navigator)).toContain('Levels');
    });

    it('relabels when the mode changes, and reads as the menu while it is open', async () => {
        const { body, manager, handlers } = setup('single');
        const { installPlayRail } = await import('../../src/ui/keystone/play-rail.js');
        const rail = installPlayRail();

        manager.currentModeId = 'online-multiplayer';
        handlers.get('modeActivated')();
        expect(labelText(rail.children[1])).toContain('Settings');

        body.classList.add('start-modal-open');
        handlers.get('modeStopped')();
        expect(rail.dataset.mode).toBe('menu');
    });
});
