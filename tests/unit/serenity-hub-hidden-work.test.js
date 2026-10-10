import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionsTab } from '../../src/ui/serenity-hub/SessionsTab.js';
import { BreathCollectionService } from '../../src/ui/effects/breathing/breath-collection.js';
import { ThemesTab, applyThemeCardFilter } from '../../src/ui/serenity-hub/ThemesTab.js';
import { SerenityHub } from '../../src/ui/serenity-hub/SerenityHub.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { looseNode } from './helpers/loose-dom.js';

function createNode() {
    const node = new EventTarget();
    const classes = new Set();
    node.dataset = {};
    node.styleWrites = 0;
    node.labelWrites = 0;
    node.style = new Proxy({}, { set(target, key, value) {
        target[key] = value;
        node.styleWrites++;
        return true;
    } });
    node.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle: (name, active) => (active ? classes.add(name) : classes.delete(name)),
    };
    let label = '';
    Object.defineProperty(node, 'textContent', {
        get: () => label,
        set: (value) => { label = String(value); node.labelWrites++; },
    });
    node.querySelector = vi.fn(() => null);
    node.querySelectorAll = vi.fn(() => []);
    node.remove = vi.fn();
    return node;
}

function progress(overrides = {}) {
    return {
        sessionId: 'BASE', sessionName: 'Hale Base', round: 1, totalRounds: 3, phase: 'active', ...overrides,
    };
}

let cleanup;
beforeEach(() => {
    vi.useFakeTimers();
    cleanup = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
        hidden: false,
        createElement: (tag) => looseNode(tag),
        body: Object.assign(looseNode('body'), { classList: { remove: vi.fn() } }),
    });
});
afterEach(() => {
    cleanup.forEach((fn) => fn());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function sessionsHarness() {
    const container = looseNode();
    const live = container.querySelector('.hale__live');
    live.hidden = true;
    const name = live.querySelector('.hale__live-name');
    let writes = 0;
    let label = '';
    Object.defineProperty(name, 'textContent', {
        get: () => label,
        set: (value) => { label = String(value); writes += 1; },
    });
    const manager = {
        startSession: vi.fn(), stopSession: vi.fn(), destroy: vi.fn(), activeSession: {},
    };
    const hub = {
        panel: { querySelector: () => container },
        isOpen: true,
        currentTab: 'sessions',
        // Every session found: these tests are about hidden work, not about finding sessions.
        serenityMode: { deps: { breathCollection: new BreathCollectionService({ developmentUnlockAll: true }) } },
    };
    const tab = new SessionsTab(hub, manager);
    hub.hide = () => { hub.isOpen = false; tab.setActive(false); };
    cleanup.push(() => tab.destroy());
    return {
        tab, hub, manager, container, live, name, writes: () => writes,
    };
}

describe('hidden session tab presentation', () => {
    it('writes nothing while hidden and shows exactly the latest stage when reopened', () => {
        const h = sessionsHarness();
        h.tab.startSession('BASE');
        const report = h.manager.startSession.mock.calls[0][1];
        const query = vi.spyOn(h.container, 'querySelector');
        for (let index = 0; index < 100; index++) report(progress({ round: 1 + (index % 3) }));
        expect(query).not.toHaveBeenCalled();
        expect(h.writes()).toBe(0);
        expect(h.live.hidden).toBe(true);
        expect(h.manager.stopSession).not.toHaveBeenCalled();
        h.tab.setActive(true);
        expect(h.live.hidden).toBe(false);
        expect(h.name.textContent).toBe('Hale Base · Round 1 of 3 · Breathe');
    });

    it('rewrites the visible strip only when what it says changes', () => {
        const h = sessionsHarness();
        h.tab.setActive(true);
        h.tab.updateLive(progress());
        expect(h.writes()).toBe(1);
        for (let index = 0; index < 50; index++) h.tab.updateLive(progress());
        expect(h.writes()).toBe(1);
        h.tab.updateLive(progress({ phase: 'retention' }));
        expect(h.writes()).toBe(2);
        expect(h.name.textContent).toBe('Hale Base · Round 1 of 3 · Hold');
    });

    it('cancels countdown waits on destroy without late session startup or timer retention', async () => {
        const h = sessionsHarness();
        h.tab.pendingSessionId = 'BASE';
        const countdown = h.tab.startCountdown();
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        h.tab.destroy();
        await countdown;
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(6000);
        expect(h.manager.startSession).not.toHaveBeenCalled();
        h.tab.destroy();
    });

    it.each(['stopSession', 'showPrepScreen', 'hidePrepScreen', 'cancelForModeChange'])(
        'settles a countdown that %s interrupts, and never starts its session',
        async (action) => {
            const h = sessionsHarness();
            h.hub.show = vi.fn();
            h.hub.switchTab = vi.fn();
            h.tab.pendingSessionId = 'BASE';
            const countdown = h.tab.startCountdown();
            await vi.advanceTimersByTimeAsync(10);
            expect(h.tab.step).toBe('countdown');

            h.tab[action]('REST');
            await countdown;
            await vi.advanceTimersByTimeAsync(6000);
            expect(h.manager.startSession).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            if (action === 'showPrepScreen') {
                expect(h.tab.pendingSessionId).toBe('REST');
                expect(h.tab.step).toBe('prepare');
            }
        },
    );
});

function makeThemeCard(id, active = false) {
    const card = createNode();
    card.dataset.theme = id;
    if (active) card.classList.add('active');
    card.setAttribute = vi.fn();
    const indicator = active ? { remove: vi.fn() } : null;
    const swatch = {
        querySelector: vi.fn(() => indicator), appendChild: vi.fn(),
    };
    card.querySelector.mockReturnValue(swatch);
    return card;
}
function themeTabHarness() {
    const tab = Object.create(ThemesTab.prototype);
    Object.assign(tab, {
        hub: { isOpen: false, currentTab: 'music' },
        active: false, destroyed: false, currentTheme: 'forest', renderedTheme: 'forest',
        themes: [{ id: 'forest', displayName: 'Forest' }, { id: 'ocean', displayName: 'Ocean' }],
        themeManager: { activeThemeName: 'forest' },
        themeCardElements: new Map(), searchTimer: null, iconBatchFrame: null,
        refreshThemeParams: vi.fn(), hydrateVisibleThemeCardIcons: vi.fn(),
        badgeElement: createNode(), domAbortController: new AbortController(),
        filterDirty: false,
    });
    cleanup.push(() => tab.unsubscribeThemeChange?.());
    return tab;
}

describe('theme picker bounded work', () => {
    it('defers hidden theme events and touches only previous/current cards on activation', () => {
        const tab = themeTabHarness();
        const cards = Array.from({ length: 190 }, (_, index) => makeThemeCard(`theme-${index}`));
        const previous = makeThemeCard('forest', true);
        const current = makeThemeCard('ocean');
        tab.themeCardElements = new Map([...cards, previous, current].map((card) => [card.dataset.theme, card]));
        vi.stubGlobal('document', { createElement: () => ({ innerHTML: '' }) });
        tab.listenForThemeChanges();
        tab.themeManager.activeThemeName = 'ocean';
        eventBus.emit(EVENTS.THEME_CHANGED, { themeName: 'ocean' });
        expect(previous.querySelector).not.toHaveBeenCalled();
        expect(current.querySelector).not.toHaveBeenCalled();
        expect(tab.refreshThemeParams).not.toHaveBeenCalled();
        tab.setActive(true);
        expect(previous.querySelector).toHaveBeenCalledOnce();
        expect(current.querySelector).toHaveBeenCalledOnce();
        expect(cards.every((card) => card.querySelector.mock.calls.length === 0)).toBe(true);
        // The toolbar shows a "Current" label beside the name (Keystone: no colon after a label),
        // so the badge's text is the world's name alone.
        expect(tab.badgeElement.textContent).toBe('Ocean');
        expect(tab.refreshThemeParams).toHaveBeenCalledOnce();
    });

    it('leaves unchanged filter attributes and classes untouched', () => {
        const card = makeThemeCard('forest');
        card.hidden = false;
        card.tabIndex = 0;
        card.getAttribute = vi.fn(() => 'false');
        const toggle = vi.spyOn(card.classList, 'toggle');
        applyThemeCardFilter([card], ['forest']);
        expect(card.setAttribute).not.toHaveBeenCalled();
        expect(toggle).not.toHaveBeenCalled();
    });

    it('pauses real thumbnail batches while hidden and resumes unloaded icons when activated', () => {
        const tab = themeTabHarness();
        tab.hydrateVisibleThemeCardIcons = ThemesTab.prototype.hydrateVisibleThemeCardIcons;
        tab.hub.getScrollContainer = () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 600 }) });
        vi.stubGlobal('window', { desktopRuntimeConfig: { isElectron: true, isPackaged: true } });
        const queuedFrames = new Map();
        let nextFrame = 0;
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            const id = ++nextFrame;
            queuedFrames.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id) => queuedFrames.delete(id));
        tab.iconLoadHandler = vi.fn();
        tab.iconErrorHandler = vi.fn();
        const icons = Array.from({ length: 62 }, (_, index) => {
            const icon = createNode();
            icon.dataset.themeIconSrc = `/icons/theme-${index}.png`;
            icon.setAttribute = vi.fn();
            let src = '';
            Object.defineProperty(icon, 'src', {
                get: () => src,
                set: (value) => { src = value; },
            });
            return icon;
        });
        tab.themeCardElements = new Map(icons.map((icon, index) => [`theme-${index}`, {
            hidden: false,
            querySelectorAll: () => [icon],
            getBoundingClientRect: () => ({ top: Math.floor(index / 4) * 180, bottom: Math.floor(index / 4) * 180 + 160 }),
        }]));
        tab.hydrateVisibleThemeCardIcons();
        expect(icons.filter((icon) => icon.src)).toHaveLength(0);
        tab.setActive(true);
        const firstStarted = icons.filter((icon) => icon.src).length;
        expect(firstStarted).toBeGreaterThan(0);
        expect(firstStarted).toBeLessThan(62);
        expect(queuedFrames.size).toBe(1);
        tab.setActive(false);
        expect(queuedFrames.size).toBe(0);
        expect(icons.filter((icon) => icon.src)).toHaveLength(firstStarted);
        tab.setActive(true);
        while (queuedFrames.size) {
            const [id, callback] = queuedFrames.entries().next().value;
            queuedFrames.delete(id);
            callback();
        }
        expect(icons.filter((icon) => icon.src)).toHaveLength(62);
        tab.setActive(false);
    });

    it('retains the latest search while hidden and filters once on reactivation', () => {
        const tab = themeTabHarness();
        const input = createNode();
        const container = createNode();
        container.querySelector.mockImplementation((selector) => (selector === '#themes-search-input' ? input : null));
        vi.stubGlobal('document', { getElementById: () => container });
        tab.attachThemeParamListeners = vi.fn();
        tab.refreshThemeGrid = vi.fn();
        tab.active = true;
        tab.attachEventListeners();
        input.value = 'ocean';
        input.dispatchEvent(new Event('input'));
        tab.setActive(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(tab.searchQuery).toBe('ocean');
        expect(tab.refreshThemeGrid).not.toHaveBeenCalled();
        tab.setActive(true);
        expect(tab.refreshThemeGrid).toHaveBeenCalledOnce();
        tab.domAbortController.abort();
    });

    it('cancels queued thumbnail batches and search work when the tab becomes inactive', () => {
        const tab = themeTabHarness();
        tab.active = true;
        tab.iconBatchFrame = 17;
        tab.iconObserver = { disconnect: vi.fn() };
        const observer = tab.iconObserver;
        tab.searchTimer = setTimeout(() => { throw new Error('inactive search ran'); }, 90);
        const cancel = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancel);
        tab.setActive(false);
        expect(cancel).toHaveBeenCalledWith(17);
        expect(observer.disconnect).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(tab.iconBatchFrame).toBeNull();
        expect(tab.iconObserver).toBeNull();
    });
});

it('destroys owned SessionsTab and session manager with the Hub', () => {
    const hub = Object.create(SerenityHub.prototype);
    Object.assign(hub, {
        serenityMode: { deps: {} }, cancelAutoHide: vi.fn(), clearScrollPerformanceMode: vi.fn(),
        abortController: new AbortController(), tabAbortControllers: new Map(),
        sessionsTab: { destroy: vi.fn() }, sessionManager: { destroy: vi.fn() },
    });
    const tab = hub.sessionsTab;
    const manager = hub.sessionManager;
    hub.destroy();
    expect(tab.destroy).toHaveBeenCalledOnce();
    expect(manager.destroy).toHaveBeenCalledOnce();
    expect(hub.sessionsTab).toBeNull();
    expect(hub.sessionManager).toBeNull();
});
