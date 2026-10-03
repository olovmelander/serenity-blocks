import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenuCoverageController, updateMenuCoverage } from '../../src/ui/modals.js';

function classList(initial = []) {
    const values = new Set(initial);
    return {
        contains: (name) => values.has(name),
        add: (name) => values.add(name),
        remove: (name) => values.delete(name),
        toggle(name, enabled) {
            if (enabled) values.add(name);
            else values.delete(name);
        },
    };
}

function createHarness() {
    const start = { id: 'start-modal', classList: classList(['modal', 'visible']), layer: 1000 };
    const replay = { id: 'demo-browser-modal', classList: classList(['modal']), layer: 1000 };
    const hub = { id: 'serenity-hub-panel', classList: classList(['serenity-hub-panel']), layer: 2000 };
    const settings = { id: 'settings-modal', classList: classList(['modal']), layer: 2100 };
    const surfaces = [start, settings, replay, hub];
    const events = new Map();
    let observerCallback;
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    const view = {
        getComputedStyle: (surface) => ({ zIndex: String(surface.layer) }),
        addEventListener: vi.fn((type, handler) => events.set(type, handler)),
        removeEventListener: vi.fn((type) => events.delete(type)),
        MutationObserver: class {
            constructor(callback) {
                observerCallback = callback;
                return observer;
            }
        },
    };
    const documentRoot = {
        body: { classList: classList() },
        defaultView: view,
        querySelectorAll: () => surfaces,
    };
    return {
        documentRoot, start, settings, replay, hub, surfaces, events, observer,
        notifyMutation: () => observerCallback(),
    };
}

afterEach(() => vi.restoreAllMocks());

describe('menu coverage lifecycle', () => {
    it('suspends covered menus and restores the same menu after nested settings closes', () => {
        const h = createHarness();
        h.hub.classList.add('open');
        updateMenuCoverage(h.documentRoot);
        expect(h.start.classList.contains('menu-covered')).toBe(true);
        expect(h.hub.classList.contains('menu-covered')).toBe(false);

        h.settings.classList.add('visible');
        updateMenuCoverage(h.documentRoot);
        expect(h.hub.classList.contains('menu-covered')).toBe(true);
        expect(h.settings.classList.contains('menu-covered')).toBe(false);

        h.settings.classList.remove('visible');
        updateMenuCoverage(h.documentRoot);
        expect(h.hub.classList.contains('menu-covered')).toBe(false);
        expect(h.start.classList.contains('menu-covered')).toBe(true);

        h.hub.classList.remove('open');
        updateMenuCoverage(h.documentRoot);
        expect(h.start.classList.contains('menu-covered')).toBe(false);
        expect(h.documentRoot.body.classList.contains('start-modal-covered')).toBe(false);
    });

    it('covers the earlier sibling when replay visibility changes outside ModalManager', () => {
        const h = createHarness();
        const controller = createMenuCoverageController(h.documentRoot);
        h.replay.classList.add('visible');
        h.notifyMutation();
        expect(h.start.classList.contains('menu-covered')).toBe(true);
        expect(h.replay.classList.contains('menu-covered')).toBe(false);

        h.replay.classList.remove('visible');
        h.notifyMutation();
        expect(h.start.classList.contains('menu-covered')).toBe(false);
        controller.destroy();
    });

    it('tracks new menu roots without observing animated descendants and cleans up', () => {
        const h = createHarness();
        const controller = createMenuCoverageController(h.documentRoot);
        const config = { id: 'local-match-config', classList: classList(['match-config-modal']), layer: 3000 };
        h.surfaces.push(config);
        h.notifyMutation();
        expect(h.start.classList.contains('menu-covered')).toBe(true);
        expect(h.observer.observe).toHaveBeenCalledWith(h.documentRoot.body, { childList: true });
        expect(h.observer.observe).toHaveBeenCalledWith(config, {
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden'],
        });
        expect(h.observer.observe.mock.calls.every(([, options]) => !options.subtree)).toBe(true);

        controller.destroy();
        expect(h.events.size).toBe(0);
        expect(h.start.classList.contains('menu-covered')).toBe(false);
        expect(h.documentRoot.body.classList.contains('start-modal-covered')).toBe(false);
    });
});
