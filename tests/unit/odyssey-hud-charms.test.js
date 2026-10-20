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
    const parts = {
        '.charm-chip__count': part(),
        '[data-pad]': part(),
        '.charms-caption__name': part(),
        '.charms-caption__text': part(),
    };
    const styles = new Map();
    const attributes = {};
    const element = {
        tagName,
        children: [],
        dataset: {},
        classList: classes(),
        listeners: {},
        parts,
        attributes,
        hidden: false,
        textContent: '',
        innerHTML: '',
        title: '',
        ariaLabel: '',
        style: {
            setProperty: (name, value) => styles.set(name, value),
            getPropertyValue: (name) => styles.get(name) || '',
            removeProperty: (name) => styles.delete(name),
        },
        setAttribute: (name, value) => { attributes[name] = value; },
        appendChild: vi.fn((child) => { element.children.push(child); return child; }),
        addEventListener: vi.fn((type, listener) => { element.listeners[type] = listener; }),
        querySelector: (selector) => parts[selector] || null,
        blur: vi.fn(),
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
    hud.charmFlash = null;
    hud.charmFocus = null;
    hud.charmView = null;
    hud.clockFlashTimer = null;
    hud.onUseCharm = vi.fn(() => ({ ok: true }));
    hud.reducedMotion = true;
    vi.stubGlobal('document', { createElement: (tag) => node(tag), querySelector: () => stage });
    hud._createCharmsSection();
    // The icon stage and the column's fit are their own modules (odyssey-charm-icon-stage.test.js,
    // odyssey-hud-fit.test.js); here they only receive states and refit requests.
    hud.charmIconStage = { setStates: vi.fn(), init: vi.fn(async () => false), dispose: vi.fn() };
    hud.fit = { schedule: vi.fn(), dispose: vi.fn() };
    return hud;
}

const caption = (hud) => ({
    charm: hud.charmsCaption.dataset.charm,
    tone: hud.charmsCaption.dataset.tone,
    name: hud.charmsCaption.parts['.charms-caption__name'].textContent,
    text: hud.charmsCaption.parts['.charms-caption__text'].textContent,
});

const session = () => ({
    charms: createOdysseyCharmRun(), levelConfig: UNTIMED, simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
});

describe('Odyssey HUD: the charm hotbar', () => {
    beforeEach(() => {
        stage.toggleAttribute.mockClear();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shows a tile per charm held or used, captions the one that matters, and hides without any', () => {
        const hud = hudFixture();
        expect(hud.charmsSection.hidden).toBe(true);
        expect(hud.container.children).toContain(hud.charmsSection);
        expect([...hud.charmChips.keys()]).toEqual(['tide', 'still-air', 'long-breath', 'hearth']);
        expect(hud.charmChips.get('tide').innerHTML).toContain('data-key>1<');
        expect(hud.charmChips.get('hearth').innerHTML).toContain('data-key>4<');
        expect(hud.charmChips.get('tide').innerHTML).toContain('charm-chip__name">Tide<');
        expect(hud.charmsLive.role).toBe('status');
        expect(hud.charmsCaption.innerHTML).toContain('Press 1–4 to use');

        const attempt = session();
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 2, 'long-breath': 1 }, 0));
        expect(hud.charmsSection.hidden).toBe(false);
        // The row appeared: the column refits around it.
        expect(hud.fit.schedule).toHaveBeenCalledTimes(1);
        const tide = hud.charmChips.get('tide');
        expect(tide.hidden).toBe(false);
        expect(tide.dataset.state).toBe('ready');
        expect(tide.attributes['aria-disabled']).toBe('false');
        expect(tide.parts['.charm-chip__count'].textContent).toBe('×2');
        expect(tide.title).toBe('Tide · clears the bottom 4 rows. Once an attempt.');
        expect(tide.ariaLabel).toBe('Tide · clears the bottom 4 rows. Once an attempt. ×2 (Clears bottom 4 rows)');
        expect(tide.innerHTML).toContain('charm-chip__icon');
        // Long Breath on an orb without a clock: shown, dimmed, and it says why when asked.
        const breath = hud.charmChips.get('long-breath');
        expect(breath.hidden).toBe(false);
        expect(breath.attributes['aria-disabled']).toBe('true');
        expect(breath.dataset.reason).toBe('no-clock');
        expect(breath.ariaLabel).toContain('(No clock here)');
        // Nothing is running: the caption says how to use one.
        expect(caption(hud)).toEqual({
            charm: '', tone: '', name: '', text: 'Press 1–4 to use',
        });
        // The icon stage is told every shown chip's state and started.
        expect(hud.charmIconStage.setStates).toHaveBeenLastCalledWith({ tide: 'ready', 'long-breath': 'ready' });
        expect(hud.charmIconStage.init).toHaveBeenCalled();
        expect(hud.charmChips.get('hearth').hidden).toBe(true);
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', false);

        // The pointer over a tile puts that charm's rule, or its reason, in the caption.
        tide.listeners.pointerenter();
        expect(caption(hud)).toEqual({
            charm: 'tide', tone: 'ready', name: 'Tide', text: 'Clears bottom 4 rows',
        });
        breath.listeners.focus();
        expect(caption(hud)).toEqual({
            charm: 'long-breath', tone: 'ready', name: 'Long Breath', text: 'No clock here',
        });
        // Leaving a tile that no longer has the caption changes nothing.
        tide.listeners.pointerleave();
        expect(caption(hud).name).toBe('Long Breath');
        breath.listeners.blur();
        expect(caption(hud).text).toBe('Press 1–4 to use');
        // A refresh with the same row does not refit.
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 2, 'long-breath': 1 }, 250));
        expect(hud.fit.schedule).toHaveBeenCalledTimes(1);

        // Used, active with a countdown, armed; paused dims every tile; the well is tinted.
        attempt.charms.used.push('tide', 'still-air', 'hearth');
        attempt.charms.stillAir = { until: 20000, base: 500, slow: 1500 };
        attempt.charms.hearthArmed = true;
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 7500, { paused: true }));
        expect(hud.fit.schedule).toHaveBeenCalledTimes(2);
        expect(tide.dataset.state).toBe('used');
        expect(tide.dataset.paused).toBe('true');
        expect(tide.attributes['aria-disabled']).toBe('true');
        expect(tide.parts['.charm-chip__count'].textContent).toBe('');
        expect(tide.ariaLabel).toContain('(Used this attempt)');
        const air = hud.charmChips.get('still-air');
        expect(air.dataset.state).toBe('active');
        expect(air.ariaLabel).toContain('(13 s left)');
        // Still Air's tile carries the time left as a bar: 12.5 of 20 seconds.
        expect(air.style.getPropertyValue('--charm-left')).toBe('0.625');
        expect(tide.style.getPropertyValue('--charm-left')).toBe('0.000');
        const hearth = hud.charmChips.get('hearth');
        expect(hearth.dataset.state).toBe('armed');
        expect(hearth.ariaLabel).toContain('(Armed for the next top-out)');
        // The countdown outranks the armed Hearth in the caption.
        expect(caption(hud)).toEqual({
            charm: 'still-air', tone: 'active', name: 'Still Air', text: '13 s left',
        });
        expect(hud.charmIconStage.setStates).toHaveBeenLastCalledWith({
            tide: 'used', 'still-air': 'active', hearth: 'armed',
        });
        expect(breath.hidden).toBe(true);
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', true);
        // Only a change of state is spoken, never the countdown.
        expect(hud.charmsLive.textContent).toBe('Tide used');
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 8500));
        expect(caption(hud).text).toBe('12 s left');
        expect(tide.dataset.paused).toBeUndefined();
        expect(hud.charmsLive.textContent).toBe('Tide used');
        // The pointer wins over the countdown while it rests on a tile.
        hearth.listeners.pointerenter();
        expect(caption(hud)).toEqual({
            charm: 'hearth', tone: 'armed', name: 'Hearth', text: 'Armed for the next top-out',
        });
        hearth.listeners.pointerleave();

        attempt.charms.stillAir = null;
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 21000));
        expect(caption(hud)).toEqual({
            charm: 'hearth', tone: 'armed', name: 'Hearth', text: 'Armed for the next top-out',
        });
        expect(hud.charmsLive.textContent).toBe('Still Air has ended');
        attempt.charms.hearthArmed = false;
        attempt.charms.hearthUsed = true;
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1 }, 30000, { paused: true }));
        expect(hud.charmsLive.textContent).toBe('Hearth took the top-out');
        expect(caption(hud)).toEqual({
            charm: '', tone: 'paused', name: '', text: 'Paused',
        });
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', false);

        hud.updateCharms(null);
        expect(hud.charmsSection.hidden).toBe(true);
        expect(hud.fit.schedule).toHaveBeenCalledTimes(3);
        hud.updateCharms({ hidden: true, charms: [] });
        expect(hud.charmsSection.hidden).toBe(true);
        expect(hud.fit.schedule).toHaveBeenCalledTimes(3);
    });

    it('shows a refused press under the row for a moment, lighting its tile, then the row as it was', () => {
        vi.useFakeTimers();
        const hud = hudFixture();
        const attempt = session();
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1, hearth: 1 }, 0));
        const tide = hud.charmChips.get('tide');
        hud.flashCharmReason('tide', 'cascade');
        expect(tide.dataset.flash).toBe('true');
        expect(caption(hud)).toEqual({
            charm: 'tide', tone: 'flash', name: 'Tide', text: 'Mid-cascade',
        });
        expect(hud.charmsLive.textContent).toBe('Tide: Mid-cascade');
        // A refresh, or the pointer on another tile, leaves the reason showing until the flash ends.
        hud.updateCharms(describeOdysseyCharmRun(attempt, { tide: 1, hearth: 1 }, 100));
        hud.charmChips.get('hearth').listeners.pointerenter();
        expect(caption(hud).text).toBe('Mid-cascade');
        vi.advanceTimersByTime(1400);
        expect(tide.dataset.flash).toBeUndefined();
        expect(caption(hud)).toEqual({
            charm: 'hearth', tone: 'ready', name: 'Hearth', text: 'Arm it for one top-out',
        });
        expect(hud.charmFlashTimers.size).toBe(0);
        hud.charmChips.get('hearth').listeners.pointerleave();
        expect(caption(hud).text).toBe('Press 1–4 to use');
        // A second refusal moves the light to its own tile.
        hud.flashCharmReason('tide', 'used');
        hud.flashCharmReason('hearth', 'cascade');
        expect(tide.dataset.flash).toBeUndefined();
        expect(hud.charmChips.get('hearth').dataset.flash).toBe('true');
        expect(caption(hud).name).toBe('Hearth');
        vi.advanceTimersByTime(1400);
        // Unknown reasons and charms are ignored.
        hud.flashCharmReason('tide', 'nope');
        expect(tide.dataset.flash).toBeUndefined();
        expect(() => hud.flashCharmReason('keel', 'cascade')).not.toThrow();
        // A tile click uses through the mode, shows its own refusal, and gives the keyboard back.
        hud.onUseCharm.mockReturnValue({ ok: false, reason: 'used' });
        tide.listeners.click();
        expect(hud.onUseCharm).toHaveBeenCalledWith('tide');
        expect(caption(hud)).toEqual({
            charm: 'tide', tone: 'flash', name: 'Tide', text: 'Used',
        });
        expect(tide.dataset.flash).toBe('true');
        expect(tide.blur).toHaveBeenCalled();
    });

    it('labels controller buttons per tile, lengthens the clock with a flash, and cleans up on destroy', () => {
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
        const iconStage = hud.charmIconStage;
        const { fit } = hud;
        hud.destroy();
        expect(hud.charmFlashTimers.size).toBe(0);
        expect(hud.charmFlash).toBeNull();
        expect(hud.clockFlashTimer).toBeNull();
        expect(iconStage.dispose).toHaveBeenCalledOnce();
        expect(hud.charmIconStage).toBeNull();
        expect(fit.dispose).toHaveBeenCalledOnce();
        expect(hud.fit).toBeNull();
        expect(stage.toggleAttribute).toHaveBeenLastCalledWith('data-still-air', false);
    });
});
