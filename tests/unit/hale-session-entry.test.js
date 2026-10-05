import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SerenityHub } from '../../src/ui/serenity-hub/SerenityHub.js';

function element(tag = 'div') {
    const target = new EventTarget();
    const attributes = new Map();
    const classes = new Set();
    Object.assign(target, {
        tagName: tag.toUpperCase(), dataset: {}, style: {},
        setAttribute: (key, value) => attributes.set(key, value),
        getAttribute: (key) => attributes.get(key),
        querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []),
        classList: {
            add: (name) => classes.add(name), remove: (name) => classes.delete(name),
            toggle: (name, active) => (active ? classes.add(name) : classes.delete(name)),
        },
        focus: vi.fn(), remove: vi.fn(),
    });
    return target;
}

const cleanup = [];
let body;
beforeEach(() => {
    const nodes = new Map();
    body = element('body');
    body.appendChild = vi.fn((node) => {
        node.parentNode = body;
        nodes.set(node.id, node);
    });
    vi.stubGlobal('document', {
        body, createElement: element, getElementById: (id) => nodes.get(id) || null,
        addEventListener: vi.fn(),
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), addEventListener: vi.fn() });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    cleanup.splice(0).forEach((fn) => fn());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function hubHarness() {
    const hub = Object.assign(Object.create(SerenityHub.prototype), {
        abortController: new AbortController(), tabAbortControllers: new Map(),
        panel: element(), backdrop: element(), hubIcon: element(),
        serenityMode: { deps: {} }, isOpen: false, currentTab: 'themes',
        switchTab: vi.fn(), show: vi.fn(), cancelAutoHide: vi.fn(),
        clearScrollPerformanceMode: vi.fn(), startAutoHide: vi.fn(), onResumeCallback: vi.fn(),
    });
    cleanup.push(() => hub.abortController?.abort());
    return hub;
}

describe('discoverable Hale session entry', () => {
    it('provides one labelled native control that opens the Hale catalogue', () => {
        const hub = hubHarness();
        hub.createHaleSessionsEntry();
        hub.createHaleSessionsEntry();
        const button = hub.haleSessionsEntry;
        expect(body.appendChild).toHaveBeenCalledOnce();
        expect(button.tagName).toBe('BUTTON');
        expect(button.type).toBe('button');
        expect(button.innerHTML).toContain('Hale sessions');
        expect(button.innerHTML).toContain('Guided breathwork');
        expect(button.getAttribute('aria-controls')).toBe('serenity-hub-panel');
        expect(button.getAttribute('aria-haspopup')).toBe('dialog');
        button.dispatchEvent(new Event('click'));
        expect(hub.switchTab).toHaveBeenCalledWith('sessions');
        expect(hub.show).toHaveBeenCalledOnce();
        expect(hub.switchTab.mock.invocationCallOrder[0]).toBeLessThan(hub.show.mock.invocationCallOrder[0]);
    });

    it.each([' ', 'Enter'])('preserves native %j activation without reaching guide shortcuts', (key) => {
        const hub = hubHarness();
        hub.createHaleSessionsEntry();
        const event = new Event('keydown', { cancelable: true });
        Object.defineProperty(event, 'key', { value: key });
        const stop = vi.spyOn(event, 'stopPropagation');
        hub.haleSessionsEntry.dispatchEvent(event);
        expect(stop).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(false);
        // The native browser click owns opening, avoiding double keyboard activation.
        expect(hub.show).not.toHaveBeenCalled();
        hub.haleSessionsEntry.dispatchEvent(new Event('click'));
        expect(hub.show).toHaveBeenCalledOnce();
    });

    it('keeps Hale entry clicks inside the control rather than triggering scene interactions', () => {
        const hub = hubHarness();
        hub.createHaleSessionsEntry();
        const event = new Event('click');
        const stop = vi.spyOn(event, 'stopPropagation');
        hub.haleSessionsEntry.dispatchEvent(event);
        expect(stop).toHaveBeenCalledOnce();
        expect(hub.haleSessionsEntry.className).toContain('serenity-hub');
        expect(hub.show).toHaveBeenCalledOnce();
    });

    it.each([' ', 'Enter'])('activates the Hale tab with %j without also changing the guide', (key) => {
        const hub = hubHarness();
        const tab = element('button');
        tab.dataset.tab = 'sessions';
        hub.panel.querySelectorAll.mockReturnValue([tab]);
        hub.attachEventListeners();
        const event = new Event('keydown', { cancelable: true });
        Object.defineProperty(event, 'key', { value: key });
        const stop = vi.spyOn(event, 'stopPropagation');
        tab.dispatchEvent(event);
        expect(hub.switchTab).toHaveBeenCalledWith('sessions');
        expect(stop).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
        hub.tabAbortControllers.forEach((controller) => controller.abort());
    });

    it('keeps gameplay paused for every breathing surface and releases it when the last one leaves', () => {
        const hub = hubHarness();
        expect(hub.holdsGameplay()).toBe(false);
        window.breathingIndicator = { isActive: true };
        expect(hub.holdsGameplay()).toBe(true);
        hub.releaseGameplay();
        expect(hub.onResumeCallback).not.toHaveBeenCalled();
        window.breathingIndicator.isActive = false;
        hub.sessionsTab = { holdsScreen: true };
        expect(hub.holdsGameplay()).toBe(true);
        hub.sessionsTab.holdsScreen = false;
        hub.sessionManager = { activeSession: {} };
        expect(hub.holdsGameplay()).toBe(true);
        hub.sessionManager.activeSession = null;
        hub.isOpen = true;
        hub.releaseGameplay();
        expect(hub.onResumeCallback).not.toHaveBeenCalled();
        hub.isOpen = false;
        hub.releaseGameplay();
        expect(hub.onResumeCallback).toHaveBeenCalledOnce();
    });

    it('follows the guide: hides the entry while it runs, tells the mode, and resumes play when it ends', () => {
        const hub = hubHarness();
        hub.createHaleSessionsEntry();
        hub.serenityMode.onBreathingGuideChange = vi.fn();
        window.breathingIndicator = { isActive: true };
        hub.onBreathingGuideChange({ active: true, session: false });
        expect(hub.haleSessionsEntry.hidden).toBe(true);
        expect(hub.serenityMode.onBreathingGuideChange).toHaveBeenLastCalledWith(true);
        expect(hub.onResumeCallback).not.toHaveBeenCalled();
        window.breathingIndicator.isActive = false;
        hub.onBreathingGuideChange({ active: false, session: false });
        expect(hub.haleSessionsEntry.hidden).toBe(false);
        expect(hub.onResumeCallback).toHaveBeenCalledOnce();
        // A session's guide is not the mode's standalone practice.
        hub.serenityMode.onBreathingGuideChange.mockClear();
        hub.onBreathingGuideChange({ active: true, session: true });
        expect(hub.serenityMode.onBreathingGuideChange).not.toHaveBeenCalled();
    });

    it('removes the labelled entry and its navigation listener when the Hub is destroyed', () => {
        const hub = hubHarness();
        hub.createHaleSessionsEntry();
        const button = hub.haleSessionsEntry;
        hub.destroy();
        expect(button.remove).toHaveBeenCalledOnce();
        expect(hub.haleSessionsEntry).toBeNull();
        button.dispatchEvent(new Event('click'));
        expect(hub.show).not.toHaveBeenCalled();
    });

    it.each([true, false])('closing the Hub preserves gameplay pause while session active is %s', (active) => {
        const hub = hubHarness();
        hub.isOpen = true;
        hub.sessionManager = { activeSession: active ? { name: 'Hale Base' } : null };
        SerenityHub.prototype.hide.call(hub);
        expect(hub.isOpen).toBe(false);
        if (active) expect(hub.onResumeCallback).not.toHaveBeenCalled();
        else expect(hub.onResumeCallback).toHaveBeenCalledOnce();
    });

    it('cancels session UI on mode changes and releases a manager before its tab exists', () => {
        const hub = hubHarness();
        hub.sessionManager = { stopSession: vi.fn() };
        hub.cancelGuidedSession();
        expect(hub.sessionManager.stopSession).toHaveBeenCalledOnce();
        hub.sessionsTab = { cancelForModeChange: vi.fn() };
        hub.cancelGuidedSession();
        expect(hub.sessionsTab.cancelForModeChange).toHaveBeenCalledOnce();
        expect(hub.sessionManager.stopSession).toHaveBeenCalledOnce();
    });

    it('can close an inactive session Hub without resuming the mode it is leaving', () => {
        const hub = hubHarness();
        hub.isOpen = true;
        hub.sessionManager = { activeSession: null };
        hub.hide({ resumeGameplay: false });
        expect(hub.isOpen).toBe(false);
        expect(hub.onResumeCallback).not.toHaveBeenCalled();
    });

    it('closes the Hub after cancelling session ownership so menu controls are reachable', () => {
        const hub = hubHarness();
        hub.isOpen = true;
        hub.sessionManager = { activeSession: { name: 'Hale Base' } };
        hub.sessionsTab = {
            cancelForModeChange: vi.fn(() => { hub.sessionManager.activeSession = null; }),
            setActive: vi.fn(),
        };
        const close = vi.spyOn(hub, 'hide');
        hub.cancelGuidedSession();
        expect(hub.sessionsTab.cancelForModeChange).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledWith({ resumeGameplay: false });
        expect(hub.sessionsTab.cancelForModeChange.mock.invocationCallOrder[0])
            .toBeLessThan(close.mock.invocationCallOrder[0]);
        expect(hub.isOpen).toBe(false);
        expect(hub.onResumeCallback).not.toHaveBeenCalled();
    });

    it('reveals Hale in an overflowing tab strip when the panel opens without moving dialog scroll', () => {
        const hub = hubHarness();
        const nav = element('nav');
        const tab = element('button');
        const content = element();
        Object.assign(nav, { offsetLeft: 20, clientWidth: 300, scrollLeft: 0 });
        Object.assign(tab, { offsetLeft: 350, offsetWidth: 90 });
        content.scrollTop = 73;
        nav.querySelector.mockReturnValue(tab);
        hub.panel.querySelector.mockImplementation((selector) => ({
            '.hub-tabs': nav, '.hub-tab-content': content,
        }[selector] || null));
        hub.loadTabContent = vi.fn();
        hub.showIcon = vi.fn();

        SerenityHub.prototype.show.call(hub);

        expect(nav.scrollLeft).toBe(120);
        expect(tab.offsetLeft - nav.offsetLeft + tab.offsetWidth)
            .toBeLessThanOrEqual(nav.scrollLeft + nav.clientWidth);
        expect(content.scrollTop).toBe(73);
        expect(tab.focus).not.toHaveBeenCalled();
    });

    it('reveals the newly selected tab in either direction without changing an already visible tab', () => {
        const hub = hubHarness();
        const nav = element('nav');
        const tab = element('button');
        tab.dataset.tab = 'sessions';
        Object.assign(nav, { offsetLeft: 20, clientWidth: 300, scrollLeft: 0 });
        Object.assign(tab, { offsetLeft: 350, offsetWidth: 90 });
        nav.querySelector.mockReturnValue(tab);
        hub.panel.querySelector.mockImplementation((selector) => (selector === '.hub-tabs' ? nav : null));
        hub.panel.querySelectorAll.mockImplementation((selector) => (selector === '.hub-tab' ? [tab] : []));
        hub.loadTabContent = vi.fn();

        SerenityHub.prototype.switchTab.call(hub, 'sessions');
        expect(tab.getAttribute('aria-selected')).toBe(true);
        expect(nav.scrollLeft).toBe(120);
        hub.revealActiveTab();
        expect(nav.scrollLeft).toBe(120);
        tab.offsetLeft = 40;
        hub.revealActiveTab();
        expect(nav.scrollLeft).toBe(20);
        expect(tab.focus).not.toHaveBeenCalled();
    });
});
