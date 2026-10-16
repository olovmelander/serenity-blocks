import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { SerenityDrift, SILENT_MUSIC_MS } from '../../src/ui/serenity-mode/serenity-drift.js';
import {
    DRIFT_OPTIONS, nextDriftOption, nextRestOption, normalizeDrift, normalizeDriftPace, restChipLabel,
} from '../../src/ui/serenity-mode/serenity-options.js';
import { SerenityRestTimer } from '../../src/ui/serenity-mode/serenity-rest.js';
import {
    DELAY_MS, SerenityWorldStepper, stepThemeId, steppableThemes,
} from '../../src/ui/serenity-mode/serenity-world-stepper.js';
import {
    TOUCH_BUDGET, TOUCH_GAP_MS, TOUCH_WINDOW_MS, createTouchRhythm, isWorldTarget,
} from '../../src/ui/serenity-mode/serenity-touch.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';

/**
 * Serenity Mode on its own: the theme arrows, Drift, the rest timer and touching the world.
 * Everything here runs on injected timers, so the minutes pass in microseconds.
 */

const MINUTE = 60 * 1000;
const owned = ['forest', 'aurora', 'galaxy', 'ocean'];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function makeDrift({ active = 'forest', next = 'aurora' } = {}) {
    const state = { active };
    const applied = [];
    const drift = new SerenityDrift({
        activeTheme: () => state.active,
        pickNextTheme: () => next,
        themeForTrack: (track) => ({ Aurora: 'aurora', Galaxy: 'galaxy', EchoesOfTheSoul: 'forest' })[track] || null,
        canUse: (id) => owned.includes(id),
        applyTheme: (id, reason) => {
            applied.push([id, reason]);
            state.active = id;
        },
    });
    return { drift, applied, state };
}

describe('drift options', () => {
    it('knows its paces, cycles through them to off, and reads unknown values as off', () => {
        expect(DRIFT_OPTIONS.map((option) => option.id)).toEqual(['off', 'music', '10', '20', '30']);
        expect(nextDriftOption('off')).toBe('music');
        expect(nextDriftOption('30')).toBe('off');
        expect(normalizeDrift('every-hour')).toBe('off');
        expect(normalizeDriftPace('off')).toBe('music');
        expect(nextRestOption(0)).toBe(15);
        expect(nextRestOption(60)).toBe(0);
        expect(restChipLabel(0)).toBe('Rest off');
        expect(restChipLabel(14.2 * MINUTE)).toBe('Rest · 15 min left');
        expect(restChipLabel(10)).toBe('Rest · 1 min left');
    });
});

describe('drift', () => {
    it('stays put while off', () => {
        const { drift, applied } = makeDrift();
        vi.advanceTimersByTime(60 * MINUTE);
        expect(applied).toEqual([]);
        expect(drift.isOn).toBe(false);
    });

    it('moves on every N minutes, counted from the last change of theme', () => {
        const { drift, applied } = makeDrift();
        drift.setPace('10');
        vi.advanceTimersByTime(9 * MINUTE);
        drift.noteThemeChanged(); // you chose a theme: it gets its full ten minutes
        vi.advanceTimersByTime(9 * MINUTE);
        expect(applied).toEqual([]);
        vi.advanceTimersByTime(1 * MINUTE);
        expect(applied).toEqual([['aurora', 'drift']]);
        drift.setPace('off');
        vi.advanceTimersByTime(30 * MINUTE);
        expect(applied).toHaveLength(1);
    });

    it('waits while the theme is covered or you are choosing, and keeps the time it had left', () => {
        const { drift, applied } = makeDrift();
        drift.setPace('20');
        vi.advanceTimersByTime(15 * MINUTE);
        drift.hold('hub');
        drift.hold('breathing');
        vi.advanceTimersByTime(60 * MINUTE);
        drift.release('hub');
        vi.advanceTimersByTime(60 * MINUTE);
        expect(applied).toEqual([]);
        drift.release('breathing');
        vi.advanceTimersByTime(4.9 * MINUTE);
        expect(applied).toEqual([]);
        vi.advanceTimersByTime(0.2 * MINUTE);
        expect(applied).toEqual([['aurora', 'drift']]);
    });

    it('with the music, brings each song\'s world, and catches up after a hold', () => {
        const { drift, applied } = makeDrift();
        drift.setPace('music');
        drift.noteTrackChanged('Aurora');
        expect(applied).toEqual([['aurora', 'drift-music']]);
        drift.hold('hub');
        drift.noteTrackChanged('Galaxy');
        expect(applied).toHaveLength(1);
        drift.release('hub');
        expect(applied).toEqual([['aurora', 'drift-music'], ['galaxy', 'drift-music']]);
        // A song with no world of its own, or one you do not have, leaves the world alone.
        drift.noteTrackChanged('Unknown');
        expect(applied).toHaveLength(2);
    });

    it('with the music silent, moves on by itself after a while', () => {
        const { drift, applied } = makeDrift();
        drift.setPace('music');
        vi.advanceTimersByTime(SILENT_MUSIC_MS - 1000);
        expect(applied).toEqual([]);
        vi.advanceTimersByTime(1000);
        expect(applied).toEqual([['aurora', 'drift']]);
    });

    it('does not move to the theme already on screen', () => {
        const { drift, applied } = makeDrift({ next: 'forest' });
        drift.setPace('10');
        vi.advanceTimersByTime(10 * MINUTE);
        expect(applied).toEqual([]);
    });
});

describe('the theme arrows', () => {
    function makeStepper(active = 'forest') {
        const themeManager = {
            activeThemeName: active,
            canSelectTheme: (id) => owned.includes(id),
            isThemeUnlocked: (id) => owned.includes(id),
            switchTheme: vi.fn(async (id) => {
                themeManager.activeThemeName = id;
                return id;
            }),
        };
        const settingsManager = { update: vi.fn(), save: vi.fn() };
        const previews = [];
        const settled = [];
        const alone = vi.fn();
        const stepper = new SerenityWorldStepper({
            themeManager,
            settingsManager,
            onPreview: (id, position) => previews.push([id, position]),
            onSettled: (id, ok) => settled.push([id, ok]),
            onAlone: alone,
        });
        return {
            stepper, themeManager, settingsManager, previews, settled, alone,
        };
    }

    const order = THEME_REGISTRY.map((entry) => entry.id).filter((id) => owned.includes(id));

    it('walk your themes in the Hub\'s order and wrap round', () => {
        expect(steppableThemes({ canSelectTheme: (id) => owned.includes(id) })).toEqual(order);
        expect(stepThemeId(order, order[0], -1)).toBe(order[order.length - 1]);
        expect(stepThemeId(order, order[order.length - 1], 1)).toBe(order[0]);
        expect(stepThemeId(order, 'not-a-theme', 1)).toBe(order[0]);
    });

    it('name the theme at once and build only the one you stop on', async () => {
        const {
            stepper, themeManager, previews, settled, settingsManager,
        } = makeStepper(order[0]);
        stepper.step(1);
        stepper.step(1);
        stepper.step(1);
        expect(previews.map(([id]) => id)).toEqual([order[1], order[2], order[3]]);
        expect(previews[2][1]).toEqual({ index: 3, total: order.length });
        expect(themeManager.switchTheme).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(DELAY_MS);
        expect(themeManager.switchTheme).toHaveBeenCalledExactlyOnceWith(order[3]);
        expect(settled).toEqual([[order[3], true]]);
        // Your choice, as in the Hub: saved as the background in every mode.
        expect(settingsManager.update).toHaveBeenCalledWith({ backgroundTheme: order[3], backgroundMode: 'Specific' });
    });

    it('do not save a theme that did not open', async () => {
        const {
            stepper, themeManager, settled, settingsManager,
        } = makeStepper(order[0]);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        themeManager.switchTheme.mockImplementation(async () => order[0]);
        stepper.step(-1);
        await vi.advanceTimersByTimeAsync(DELAY_MS);
        expect(settled).toEqual([[order[0], false]]);
        expect(settingsManager.update).not.toHaveBeenCalled();
    });

    it('say so when you have only one theme', () => {
        const { stepper, alone, previews } = makeStepper('forest');
        stepper.themeManager.canSelectTheme = (id) => id === 'forest';
        expect(stepper.step(1)).toBeNull();
        expect(alone).toHaveBeenCalledOnce();
        expect(previews).toEqual([]);
    });
});

describe('the rest timer', () => {
    it('counts down, can be changed or turned off, and ends once', () => {
        const onEnd = vi.fn();
        const timer = new SerenityRestTimer({ onEnd });
        timer.set(15);
        vi.advanceTimersByTime(5 * MINUTE);
        expect(timer.msLeft).toBe(10 * MINUTE);
        timer.set(30);
        vi.advanceTimersByTime(29 * MINUTE);
        expect(onEnd).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1 * MINUTE);
        expect(onEnd).toHaveBeenCalledOnce();
        expect(timer.isSet).toBe(false);
        timer.set(15);
        timer.set(0);
        vi.advanceTimersByTime(60 * MINUTE);
        expect(onEnd).toHaveBeenCalledOnce();
    });
});

describe('touching the world', () => {
    it('answers one press at a time, and quietly rests the theme after many', () => {
        let now = 0;
        const take = createTouchRhythm(() => now);
        expect(take()).toBe('touch');
        now += TOUCH_GAP_MS - 1;
        expect(take()).toBe('none');
        const answers = [];
        for (let i = 0; i < TOUCH_BUDGET + 2; i++) {
            now += TOUCH_GAP_MS;
            answers.push(take());
        }
        expect(answers.filter((answer) => answer === 'touch')).toHaveLength(TOUCH_BUDGET - 1);
        expect(answers.at(-1)).toBe('ripple');
        now += TOUCH_WINDOW_MS;
        expect(take()).toBe('touch');
    });

    it('leaves presses on controls to the controls', () => {
        const control = { closest: (selector) => (selector.includes('#sb-play-rail') ? {} : null) };
        const world = { closest: () => null };
        expect(isWorldTarget(control)).toBe(false);
        expect(isWorldTarget(world)).toBe(true);
        expect(isWorldTarget(null)).toBe(true);
    });
});
