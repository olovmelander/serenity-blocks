import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyHUD } from '../../src/ui/odyssey/OdysseyHUD.js';
import { createOdysseyCharmRun, describeOdysseyCharmRun } from '../../src/core/odyssey/odyssey-charm-use.js';
import { DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';

const UNTIMED = { victory: { primary: { type: 'lines', target: 20 }, failure: { type: 'top-out' } } };

function classes() {
    const values = new Set();
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        contains: (name) => values.has(name),
        toggle: (name, value) => (value ? values.add(name) : values.delete(name)),
        remove: (...names) => names.forEach((name) => values.delete(name)),
    };
}

const part = () => ({ textContent: '', hidden: true });

function node(tagName = 'div') {
    const parts = { '.charm-chip__count': part(), '.charm-chip__state': part(), '[data-pad]': part() };
    const element = {
        tagName,
        children: [],
        dataset: {},
        classList: classes(),
        listeners: {},
        parts,
        hidden: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        title: '',
        ariaLabel: '',
        appendChild: vi.fn((child) => { element.children.push(child); return child; }),
        addEventListener: vi.fn((type, listener) => { element.listeners[type] = listener; }),
        querySelector: (selector) => parts[selector] || null,
    };
    return element;
}

const stage = { toggleAttribute: vi.fn() };

function hudFixture() {
    const hud = Object.create(OdysseyHUD.prototype);
    hud.container = node();
    hud.charmChips = new Map();
    hud.charmStates = new Map();
    hud.charmFlashTimers = new Map();
    hud.charmView = null;
    hud.clockFlashTimer = null;
    hud.onUseCharm = vi.fn(() => ({ ok: true }));
    vi.stubGlobal('document', { createElement: (tag) => node(tag), querySelector: () => stage });
    hud._createCharmsSection();
    return hud;
}

const session = () => ({
    charms: createOdysseyCharmRun(), levelConfig: UNTIMED, simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
});

describe('Odyssey HUD: the charm tray', () => {
    beforeEach(() => {
        stage.toggleAttribute.mockClear();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shows a chip per charm held or used, with its key, count, state and reason, and hides without any', () => {
        const hud = hudFixture();
        expect(hud.charmsSection.hidden).toBe(true);
        expect(hud.container.children).toContain(hud.charmsSection);
        expect([...hud.charmChips.keys()]).toEqual(['tide', 'still-air', 'long-breath', 'hearth']);
        expect(hud.charmChips.get('tide').innerHTML).toContain('data-key>1<');
        expect(hud.charmChips.get('hearth').innerHTML).toContain('data-key>4<');
        expect(hud.charmsLive.role).toBe('status');

        const attempt = session();
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 2, 'long-breath': 1 }, 0));
        expect(hud.charmsSection.hidden).toBe(false);
        const tide = hud.charmChips.get('tide');
        expect(tide.hidden).toBe(false);
        expect(tide.dataset.state).toBe('ready');
        expect(tide.disabled).toBe(false);
        expect(tide.parts['.charm-chip__count'].textContent).toBe('×2');
        expect(tide.parts['.charm-chip__state'].textContent).toBe('');
        expect(tide.title).toBe('Tide · clears the bottom 4 rows. Once an attempt.');
        expect(tide.ariaLabel).toBe('Tide · clears the bottom 4 rows. Once an attempt. ×2');
        // Long Breath on an orb without a clock: shown, disabled, and it says why.
        const breath = hud.charmChips.get('long-breath');
        expect(breath.hidden).toBe(false);
        expect(breath.disabled).toBe(true);
        expect(breath.dataset.reason).toBe('no-clock');
        expect(breath.parts['.charm-chip__state'].textContent).toBe('no clock here');
        expect(breath.ariaLabel).toContain('(no clock here)');
        expect(hud.charmChips.get('hearth').hidden).toBe(true);
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', false);

        // Used, active with a countdown, armed; paused disables every chip; the well is tinted.
        attempt.charms.used.push('tide', 'still-air', 'hearth');
        attempt.charms.stillAir = { until: 20000, base: 500, slow: 1500 };
        attempt.charms.hearthArmed = true;
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 7500, { paused: true }));
        expect(tide.dataset.state).toBe('used');
        expect(tide.disabled).toBe(true);
        expect(tide.parts['.charm-chip__state'].textContent).toBe('used');
        expect(tide.parts['.charm-chip__count'].textContent).toBe('');
        const air = hud.charmChips.get('still-air');
        expect(air.dataset.state).toBe('active');
        expect(air.parts['.charm-chip__state'].textContent).toBe('13 s');
        expect(air.ariaLabel).toContain('(13 s)');
        expect(hud.charmChips.get('hearth').dataset.state).toBe('armed');
        expect(hud.charmChips.get('hearth').parts['.charm-chip__state'].textContent).toBe('armed');
        expect(breath.hidden).toBe(true);
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', true);
        // Only a change of state is spoken, never the countdown.
        expect(hud.charmsLive.textContent).toBe('Tide used');
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 8500));
        expect(air.parts['.charm-chip__state'].textContent).toBe('12 s');
        expect(hud.charmsLive.textContent).toBe('Tide used');
        attempt.charms.stillAir = null;
        attempt.charms.hearthArmed = false;
        attempt.charms.hearthUsed = true;
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 30000));
        expect(hud.charmsLive.textContent).toBe('Still Air has ended. Hearth took the top-out');
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', false);

        hud.updateCharms(null);
        expect(hud.charmsSection.hidden).toBe(true);
        hud.updateCharms({ hidden: true, charms: [] });
        expect(hud.charmsSection.hidden).toBe(true);
    });

    it('shows a refused press on the chip for a moment, then the chip as it was', () => {
        vi.useFakeTimers();
        const hud = hudFixture();
        const attempt = session();
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 0));
        const tide = hud.charmChips.get('tide');
        hud.flashCharmReason('tide', 'cascade');
        expect(tide.dataset.flash).toBe('true');
        expect(tide.parts['.charm-chip__state'].textContent).toBe('mid-cascade');
        expect(hud.charmsLive.textContent).toBe('Tide: mid-cascade');
        // A refresh during the flash leaves the reason showing.
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 100));
        expect(tide.parts['.charm-chip__state'].textContent).toBe('mid-cascade');
        vi.advanceTimersByTime(1400);
        expect(tide.dataset.flash).toBeUndefined();
        expect(tide.parts['.charm-chip__state'].textContent).toBe('');
        expect(hud.charmFlashTimers.size).toBe(0);
        // Unknown reasons and charms are ignored.
        hud.flashCharmReason('tide', 'nope');
        expect(tide.dataset.flash).toBeUndefined();
        expect(() => hud.flashCharmReason('keel', 'cascade')).not.toThrow();
        // A chip click uses through the mode and shows its own refusal.
        hud.onUseCharm.mockReturnValue({ ok: false, reason: 'used' });
        tide.listeners.click();
        expect(hud.onUseCharm).toHaveBeenCalledWith('tide');
        expect(tide.parts['.charm-chip__state'].textContent).toBe('used');
        expect(tide.dataset.flash).toBe('true');
    });

    it('labels controller buttons per charm, lengthens the clock with a flash, and cleans up on destroy', () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const hud = hudFixture();
        hud.setCharmPadHints({ tide: 'LB', hearth: 'LT' });
        expect(hud.charmChips.get('tide').parts['[data-pad]']).toEqual({ textContent: 'LB', hidden: false });
        expect(hud.charmChips.get('still-air').parts['[data-pad]']).toEqual({ textContent: '', hidden: true });

        hud.timeLimit = 180;
        hud.elapsedTime = 1000;
        hud.updateTime = vi.fn();
        hud.timeDisplay = { classList: classes() };
        hud.extendTimeLimit(30);
        expect(hud.timeLimit).toBe(210);
        expect(hud.updateTime).toHaveBeenCalledWith(1000);
        expect(hud.timeDisplay.classList.contains('is-extended')).toBe(true);
        vi.advanceTimersByTime(1200);
        expect(hud.timeDisplay.classList.contains('is-extended')).toBe(false);
        expect(hud.clockFlashTimer).toBeNull();
        hud.timeLimit = null;
        hud.extendTimeLimit(30);
        expect(hud.timeLimit).toBeNull();

        hud.timeLimit = 100;
        hud.extendTimeLimit(5);
        hud.flashCharmReason('tide', 'used');
        expect(hud.charmFlashTimers.size).toBe(1);
        hud.destroy();
        expect(hud.charmFlashTimers.size).toBe(0);
        expect(hud.clockFlashTimer).toBeNull();
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', false);
    });
});
