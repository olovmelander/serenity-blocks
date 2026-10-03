import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    cancelSettingsCapture,
    handleGamepadBinding,
    initializeSettingsUI,
    SettingsManager,
    startKeyboardBindingCapture,
} from '../../src/ui/settings.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

function createNode(id) {
    const node = new EventTarget();
    const classes = new Set();
    node.id = id;
    node.value = '';
    node.textContent = '';
    node.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
    };
    node.style = {};
    return node;
}

function setupDocument(nodes = []) {
    const document = new EventTarget();
    document.getElementById = (id) => nodes.find((node) => node.id === id) || null;
    document.querySelector = () => null;
    document.querySelectorAll = (selector) => (selector.includes('input[type="range"]')
        ? nodes.filter((node) => node.id === 'music-volume') : []);
    vi.stubGlobal('document', document);
    return document;
}

let managers;
beforeEach(() => {
    vi.useFakeTimers();
    managers = [];
    const store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => store.get(key) || null,
        setItem: vi.fn((key, value) => store.set(key, value)),
    });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', { getGamepads: vi.fn(() => []) });
});
afterEach(() => {
    managers.forEach((manager) => manager.dispose());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
function managerWithBaseline() {
    const manager = new SettingsManager();
    manager.save({ emitEvent: false });
    localStorage.setItem.mockClear();
    managers.push(manager);
    return manager;
}

describe('live settings and coalesced persistence', () => {
    it('applies every preview immediately, retains binding identity, and persists one final value', () => {
        const manager = managerWithBaseline();
        const bindings = manager.get().keyBindings;
        const previews = [];
        window.addEventListener('settingsChanged', (event) => previews.push(event.detail));
        const saved = [];
        const unsubscribe = eventBus.on(EVENTS.SETTINGS_CHANGED, (event) => saved.push(event));
        for (const volume of [0.2, 0.4, 0.7]) {
            manager.update({ musicVolume: volume });
            manager.scheduleSave();
            vi.advanceTimersByTime(40);
        }
        expect(manager.get().musicVolume).toBe(0.7);
        expect(manager.get().keyBindings).toBe(bindings);
        expect(previews).toEqual([{ musicVolume: 0.2 }, { musicVolume: 0.4 }, { musicVolume: 0.7 }]);
        expect(localStorage.setItem).not.toHaveBeenCalled();
        vi.advanceTimersByTime(180);
        expect(localStorage.setItem).toHaveBeenCalledTimes(1);
        expect(saved[0].dirtyKeys).toEqual(['musicVolume']);
        expect(saved[0].categories).toEqual(['settings']);
        expect(JSON.parse(localStorage.getItem(manager.STORAGE_KEY)).musicVolume).toBe(0.7);
        manager.update({ musicVolume: 0.7 });
        manager.save();
        expect(previews).toHaveLength(3);
        expect(localStorage.setItem).toHaveBeenCalledTimes(1);
        expect(saved).toHaveLength(1);
        unsubscribe();
    });

    it('flushes the final slider value on change, modal close, pagehide and disposal without duplicate gains', () => {
        const manager = managerWithBaseline();
        const slider = createNode('music-volume');
        const value = createNode('music-volume-value');
        setupDocument([slider, value]);
        const callbacks = { onMusicVolumeChange: vi.fn() };
        initializeSettingsUI(manager, callbacks);
        slider.value = '35';
        slider.dispatchEvent(new Event('input'));
        expect(manager.get().musicVolume).toBe(0.35);
        expect(localStorage.setItem).not.toHaveBeenCalled();
        slider.dispatchEvent(new Event('change'));
        expect(JSON.parse(localStorage.getItem(manager.STORAGE_KEY)).musicVolume).toBe(0.35);
        slider.value = '48';
        slider.dispatchEvent(new Event('input'));
        window.dispatchEvent(new CustomEvent('modalHidden', { detail: { modalName: 'settings' } }));
        expect(JSON.parse(localStorage.getItem(manager.STORAGE_KEY)).musicVolume).toBe(0.48);
        slider.value = '59';
        slider.dispatchEvent(new Event('input'));
        window.dispatchEvent(new Event('pagehide'));
        expect(JSON.parse(localStorage.getItem(manager.STORAGE_KEY)).musicVolume).toBe(0.59);
        slider.value = '64';
        slider.dispatchEvent(new Event('input'));
        manager.dispose();
        expect(JSON.parse(localStorage.getItem(manager.STORAGE_KEY)).musicVolume).toBe(0.64);
        expect(callbacks.onMusicVolumeChange).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        slider.value = '70';
        slider.dispatchEvent(new Event('input'));
        expect(manager.get().musicVolume).toBe(0.64);
    });

    it('retains explicit save semantics for direct binding mutations and suppresses cloud events when requested', () => {
        const manager = managerWithBaseline();
        const emit = vi.spyOn(eventBus, 'emit');
        manager.get().keyBindings.moveLeft = 'j';
        manager.save();
        expect(emit.mock.calls[0][1].dirtyKeys).toEqual(['keyBindings']);
        manager.update({ musicVolume: 0.25 });
        manager.scheduleSave();
        manager.save({ emitEvent: false });
        expect(emit).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('single settings capture session', () => {
    it('cancels replaced gamepad polling and only binds the current control', () => {
        const manager = managerWithBaseline();
        setupDocument();
        const first = createNode('gamepad-moveLeft');
        const second = createNode('gamepad-moveRight');
        handleGamepadBinding(first, manager);
        expect(vi.getTimerCount()).toBe(2);
        handleGamepadBinding(second, manager);
        expect(first.classList.contains('listening')).toBe(false);
        expect(vi.getTimerCount()).toBe(2);
        navigator.getGamepads.mockReturnValue([{ buttons: Array.from({ length: 17 }, (_, index) => ({
            pressed: index === 16, value: index === 16 ? 1 : 0,
        })) }]);
        vi.advanceTimersByTime(50);
        expect(manager.get().gamepadBindings.moveRight).toBe(16);
        expect(manager.get().gamepadBindings.moveLeft).not.toBe(16);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('removes keyboard listeners on replacement, timeout, modal close and disposal', () => {
        const manager = managerWithBaseline();
        const document = setupDocument();
        initializeSettingsUI(manager, {});
        const first = createNode('key-moveLeft');
        const second = createNode('key-moveRight');
        startKeyboardBindingCapture(first, manager);
        startKeyboardBindingCapture(second, manager);
        const press = () => {
            const event = new Event('keydown', { cancelable: true });
            event.key = 'j';
            document.dispatchEvent(event);
        };
        press();
        expect(manager.get().keyBindings.moveRight).toBe('j');
        expect(manager.get().keyBindings.moveLeft).not.toBe('j');
        expect(vi.getTimerCount()).toBe(0);
        const update = vi.spyOn(manager, 'update');
        startKeyboardBindingCapture(first, manager);
        vi.advanceTimersByTime(10000);
        press();
        expect(update).not.toHaveBeenCalled();
        startKeyboardBindingCapture(first, manager);
        window.dispatchEvent(new CustomEvent('modalHidden', { detail: { modalName: 'settings' } }));
        press();
        expect(update).not.toHaveBeenCalled();
        handleGamepadBinding(first, manager);
        startKeyboardBindingCapture(second, manager);
        expect(vi.getTimerCount()).toBe(1);
        manager.dispose();
        press();
        expect(update).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        cancelSettingsCapture(manager);
    });
});
