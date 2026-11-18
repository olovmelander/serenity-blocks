/**
 * Settings opened over Records takes LB/RB and Q/E for its own tabs; Records beneath keeps
 * its mode (audit 2026-11-18, A18-UI-6). Both used to switch, so Records re-read its scores
 * out of sight and showed another mode once Settings closed.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { showHighScoresModal } from '../../src/ui/modals.js';

function classes(...names) {
    const set = new Set(names);
    return {
        add: (name) => set.add(name),
        remove: (name) => set.delete(name),
        contains: (name) => set.has(name),
        toggle: (name, force) => {
            const on = force ?? !set.has(name);
            if (on) set.add(name); else set.delete(name);
            return on;
        },
    };
}

function tab(mode, selected = false) {
    const attributes = { 'aria-selected': String(selected) };
    return {
        id: `tab-${mode}`,
        dataset: { mode },
        classList: classes(...(selected ? ['active'] : [])),
        getAttribute: (name) => attributes[name] ?? null,
        setAttribute: (name, value) => { attributes[name] = String(value); },
        click: vi.fn(),
        focus() {},
    };
}

/** Records open on Single Player, Settings over it on General. */
function recordsUnderSettings() {
    const settingsTabs = [tab('general', true), tab('display')];
    const recordsTabs = [tab('single', true), tab('infinity'), tab('odyssey')];
    const settings = { id: 'settings-modal', classList: classes('modal', 'visible'), contains: () => false };
    const records = {
        id: 'high-scores-modal',
        classList: classes('modal', 'visible'),
        querySelectorAll: (selector) => (selector === '.hs-tab' ? recordsTabs : []),
    };
    const listeners = [];
    const panel = () => ({ innerHTML: '', querySelectorAll: () => [] });
    const elements = {
        'settings-modal': settings,
        'high-scores-modal': records,
        'hs-tabs': { dataset: {}, addEventListener() {} },
        'high-scores-list': panel(),
        'statistics-section': panel(),
    };
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
        addEventListener: (type, listener) => { if (type === 'keydown') listeners.push(listener); },
        removeEventListener() {},
        getElementById: (id) => elements[id] || null,
        querySelector: (selector) => (selector === '.settings-tab.active' ? settingsTabs[0] : null),
        querySelectorAll: (selector) => {
            if (selector === '.settings-tab') return settingsTabs;
            if (selector === '#high-scores-modal .hs-tab') return recordsTabs;
            return [];
        },
        body: { classList: classes() },
        activeElement: null,
    });
    const keydown = (key) => listeners.forEach((listener) => listener({
        key, target: null, preventDefault() {},
    }));
    return {
        settingsTabs, recordsTabs, keydown,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Settings over Records', () => {
    it('RB switches the Settings tab only', () => {
        const { settingsTabs, recordsTabs } = recordsUnderSettings();
        const controller = new GamepadController();

        controller.switchMainTab(1);

        expect(settingsTabs[1].click).toHaveBeenCalledTimes(1);
        recordsTabs.forEach((recordsTab) => expect(recordsTab.click).not.toHaveBeenCalled());
    });

    it('E leaves the Records tab beneath where it was', async () => {
        const { recordsTabs, keydown } = recordsUnderSettings();
        const highScoreManager = {
            getStatistics: vi.fn(async () => ({})),
            getTopScores: vi.fn(async () => []),
        };
        await showHighScoresModal({ show: vi.fn() }, highScoreManager, null, { mode: 'single' });
        expect(recordsTabs[0].classList.contains('active')).toBe(true);

        keydown('e');

        expect(recordsTabs[0].classList.contains('active')).toBe(true);
        expect(recordsTabs[1].classList.contains('active')).toBe(false);
    });
});
