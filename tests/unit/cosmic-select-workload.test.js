import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    enhanceSelectOverlay, installCosmicSelects, uninstallCosmicSelects,
} from '../../src/ui/components/cosmic-select.js';

afterEach(() => {
    uninstallCosmicSelects();
    vi.unstubAllGlobals();
});

function observerHarness() {
    let notify;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const body = { childElementCount: 0 };
    vi.stubGlobal('document', { body });
    vi.stubGlobal('MutationObserver', class {
        constructor(callback) { notify = callback; }
        observe = observe;
        disconnect = disconnect;
    });
    installCosmicSelects();
    return { notify, observe, disconnect };
}

describe('global cosmic select mutation batching', () => {
    it('refreshes an enhanced select once for a batch of option mutations', () => {
        const { notify } = observerHarness();
        const refresh = vi.fn();
        const select = { tagName: 'SELECT', dataset: { cosmicEnhanced: 'true' }, _cosmicSelect: { refresh } };
        const records = Array.from({ length: 40 }, () => ({
            target: select,
            addedNodes: [{ nodeType: 1, tagName: 'OPTION', querySelectorAll: vi.fn() }],
        }));
        notify(records);
        expect(refresh).toHaveBeenCalledOnce();
        expect(records.every((r) => r.addedNodes[0].querySelectorAll.mock.calls.length === 0)).toBe(true);
    });

    it('refreshes changed option labels and ignores removed selects', () => {
        const { notify } = observerHarness();
        const refresh = vi.fn();
        const select = { tagName: 'SELECT', dataset: { cosmicEnhanced: 'true' }, _cosmicSelect: { refresh } };
        const option = { closest: (selector) => (selector === 'select' ? select : option) };
        notify([{ target: option, addedNodes: [{ nodeType: 3 }] }]);
        expect(refresh).toHaveBeenCalledOnce();
        select.isConnected = false;
        notify([{ target: select, addedNodes: [] }]);
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('scans overlapping added subtrees once and skips already enhanced select roots', () => {
        const { notify } = observerHarness();
        const parent = { nodeType: 1, tagName: 'DIV', childElementCount: 1, parentElement: null, querySelectorAll: vi.fn(() => []) };
        const child = { ...parent, parentElement: parent, querySelectorAll: vi.fn(() => []) };
        const select = { nodeType: 1, tagName: 'SELECT', dataset: { cosmicEnhanced: 'true' }, querySelectorAll: vi.fn() };
        notify([{ target: {}, addedNodes: [parent, child, select] }]);
        expect(parent.querySelectorAll).toHaveBeenCalledOnce();
        expect(child.querySelectorAll).not.toHaveBeenCalled();
        expect(select.querySelectorAll).not.toHaveBeenCalled();
    });
});

function overlayHarness() {
    const frames = new Map();
    const windowHandlers = new Map();
    const styleWrites = [];
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frameId += 1; frames.set(frameId, callback); return frameId; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
    vi.stubGlobal('window', {
        innerHeight: 800,
        addEventListener: (name, callback) => windowHandlers.set(name, callback),
        removeEventListener: (name) => windowHandlers.delete(name),
    });
    class Element {
        constructor() {
            this.dataset = {};
            this.style = new Proxy({}, {
                set(target, property, value) {
                    styleWrites.push([property, value]);
                    target[property] = `${Math.round(Number.parseFloat(value) * 1000) / 1000}px`;
                    return true;
                },
            });
            this.attributes = new Map();
            this.children = [];
            this.handlers = new Map();
            this.offsetHeight = 100;
            this.classes = new Set();
            this.classList = {
                add: (name) => this.classes.add(name),
                remove: (name) => this.classes.delete(name),
            };
        }
        setAttribute(name, value) { this.attributes.set(name, value); }
        getAttribute(name) { return this.attributes.get(name); }
        addEventListener(name, callback) { this.handlers.set(name, callback); }
        removeEventListener(name) { this.handlers.delete(name); }
        appendChild(child) { this.children.push(child); }
        querySelector() { return this.children.find((child) => child.attributes.get('aria-selected') === 'true'); }
        closest() { return this; }
        contains(child) { return this.children.includes(child); }
        scrollIntoView() {}
        remove() { this.removed = true; }
        focus() {}
    }
    const body = new Element();
    const doc = {
        body,
        createElement: () => new Element(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    const select = new Element();
    select.tagName = 'SELECT';
    select.ownerDocument = doc;
    select.options = [{ value: 'a', textContent: 'A' }, { value: 'b', textContent: 'B' }];
    select.value = 'a';
    select.getBoundingClientRect = vi.fn(() => ({ width: 200, left: 100, top: 200, bottom: 230.21875 }));
    const api = enhanceSelectOverlay(select);
    select.handlers.get('mousedown')({ preventDefault() {} });
    return {
        select, api, body, frames, windowHandlers, styleWrites,
        flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); },
    };
}

describe('cosmic select overlay positioning ownership', () => {
    it('coalesces ancestor scroll/resize bursts into one anchor read per frame', () => {
        const h = overlayHarness();
        expect(h.select.getBoundingClientRect).toHaveBeenCalledOnce();
        for (let i = 0; i < 60; i += 1) {
            h.windowHandlers.get('scroll')({ target: h.body });
            h.windowHandlers.get('resize')();
        }
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(h.select.getBoundingClientRect).toHaveBeenCalledOnce();
        h.flush();
        expect(h.select.getBoundingClientRect).toHaveBeenCalledTimes(2);
        expect(h.styleWrites).toHaveLength(3); // Initial placement only, despite CSSOM rounding.
        h.api.destroy();
    });

    it('ignores list scrolling and cancels a queued position update on close', () => {
        const h = overlayHarness();
        h.windowHandlers.get('scroll')({ target: h.body.children[0] });
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        h.windowHandlers.get('scroll')({ target: h.body });
        h.select.handlers.get('keydown')();
        expect(cancelAnimationFrame).toHaveBeenCalledOnce();
        expect(h.frames.size).toBe(0);
        expect(h.windowHandlers.has('scroll')).toBe(false);
        expect(h.body.children[0].removed).toBe(true);
        h.api.destroy();
    });
});
