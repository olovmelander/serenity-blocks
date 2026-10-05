import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathingTab } from '../../src/ui/serenity-hub/BreathingTab.js';

function createNode(tagName = 'DIV') {
    const classes = new Set();
    const attributes = new Map();
    return {
        tagName: tagName.toUpperCase(),
        dataset: {},
        style: { setProperty: vi.fn() },
        setAttribute: (key, value) => attributes.set(key, value),
        getAttribute: (key) => attributes.get(key),
        classList: {
            add: (name) => classes.add(name),
            contains: (name) => classes.has(name),
            toggle: (name, active) => (active ? classes.add(name) : classes.delete(name)),
        },
    };
}

function tabHarness() {
    const tab = Object.create(BreathingTab.prototype);
    tab.breathingIndicator = {
        currentTechnique: 'deep-relaxation',
        isActive: false,
        start: vi.fn(() => { tab.breathingIndicator.isActive = true; }),
        stop: vi.fn(() => { tab.breathingIndicator.isActive = false; }),
        setTechnique: vi.fn(),
        setShowText: vi.fn(),
        techniques: {
            'deep-relaxation': {
                name: 'Aurora Dreams',
                pattern: [5, 2, 7, 2],
                color: { r: 80, g: 200, b: 255 },
            },
            coherence: {
                name: 'Heart Glow',
                pattern: [5, 0, 5, 0],
                color: { r: 255, g: 100, b: 150 },
            },
        },
    };
    tab.techniques = tab.getTechniques();
    tab.serenityMode = {
        _showBreathingIndicator: vi.fn(() => { tab.breathingIndicator.isActive = true; }),
        _hideBreathingIndicator: vi.fn(() => { tab.breathingIndicator.isActive = false; }),
        deps: { settingsManager: { update: vi.fn() } },
    };
    return tab;
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: createNode, getElementById: () => null });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('breathing library accessible selection', () => {
    it('uses a native button with a complete rhythm label and selected state', () => {
        const tab = tabHarness();
        const card = tab.createTechniqueCard(tab.techniques[0]);
        expect(card.tagName).toBe('BUTTON');
        expect(card.type).toBe('button');
        expect(card.getAttribute('aria-pressed')).toBe('true');
        expect(card.getAttribute('aria-label')).toContain('Inhale 5s → Hold 2s → Exhale 7s → Hold 2s');
        expect(card.innerHTML).toContain('data-world="deep-relaxation"');
        expect(card.innerHTML).toContain('aria-hidden="true"');
    });

    it('changes exactly one pressed state and persists selection without replacing buttons', () => {
        const tab = tabHarness();
        const cards = tab.techniques.map((technique) => tab.createTechniqueCard(technique));
        tab.container = { querySelectorAll: vi.fn(() => cards), querySelector: vi.fn(() => null) };
        tab.selectTechnique('coherence');
        expect(cards.map((card) => card.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
        expect(cards.map((card) => card.classList.contains('active'))).toEqual([false, true]);
        expect(tab.breathingIndicator.setTechnique).toHaveBeenCalledWith('coherence');
        expect(tab.serenityMode.deps.settingsManager.update).toHaveBeenCalledWith({ breathingTechnique: 'coherence' });
        tab.selectTechnique('unknown');
        expect(tab.breathingIndicator.setTechnique).toHaveBeenCalledOnce();
    });

    it('omits zero-duration holds from the visible rhythm', () => {
        const tab = tabHarness();
        const rhythm = tab.renderRhythm([5, 0, 5, 0]);
        expect(rhythm).toContain('data-phase="0"');
        expect(rhythm).toContain('data-phase="2"');
        expect(rhythm).not.toContain('data-phase="1"');
        expect(rhythm).not.toContain('data-phase="3"');
    });

    it.each([' ', 'Enter'])('keeps native %s activation from firing the global guide shortcut', (key) => {
        const tab = tabHarness();
        const control = createNode('button');
        tab.container = {
            addEventListener: vi.fn(),
            querySelector: () => null,
            contains: (node) => node === control,
        };
        tab.attachEventListeners();
        const event = {
            key,
            target: { closest: () => control },
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
        };
        tab.interactionKeydownHandler(event);
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('refreshes external technique and guide changes within its own container', () => {
        const tab = tabHarness();
        const cards = tab.techniques.map((technique) => tab.createTechniqueCard(technique));
        const toggle = {};
        const description = {};
        tab.container = {
            querySelectorAll: vi.fn(() => cards),
            querySelector: (selector) => ({
                '#breathing-guide-toggle': toggle,
                '.breathing-toggle-section .section-description': description,
            }[selector] || null),
        };
        tab.breathingIndicator.currentTechnique = 'coherence';
        tab.breathingIndicator.isActive = true;
        tab.refresh();
        expect(toggle.checked).toBe(true);
        expect(cards.map((card) => card.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
        expect(description.textContent).toContain('Guide is on');
        expect(tab.serenityMode.deps.settingsManager.update).not.toHaveBeenCalled();
    });

    it('keeps the guide switch and saved setting consistent', () => {
        const tab = tabHarness();
        tab.container = { querySelector: vi.fn(() => null), querySelectorAll: () => [] };
        tab.toggleBreathingGuide(true);
        expect(tab.serenityMode._showBreathingIndicator).toHaveBeenCalledOnce();
        expect(tab.serenityMode.deps.settingsManager.update).toHaveBeenLastCalledWith({ breathingGuideEnabled: true });
        tab.toggleBreathingGuide(false);
        expect(tab.serenityMode._hideBreathingIndicator).toHaveBeenCalledOnce();
        expect(tab.serenityMode.deps.settingsManager.update).toHaveBeenLastCalledWith({ breathingGuideEnabled: false });
    });

    it('starts and stops directly from the global Hub wrapper and reflects actual state', () => {
        const tab = tabHarness();
        delete tab.serenityMode._showBreathingIndicator;
        delete tab.serenityMode._hideBreathingIndicator;
        tab.serenityMode._toggleBreathingIndicator = vi.fn();
        const toggle = {};
        const description = {};
        tab.container = {
            querySelectorAll: () => [],
            querySelector: (selector) => ({
                '#breathing-guide-toggle': toggle,
                '.breathing-toggle-section .section-description': description,
            }[selector] || null),
        };
        tab.toggleBreathingGuide(true);
        expect(tab.breathingIndicator.start).toHaveBeenCalledOnce();
        expect(toggle.checked).toBe(true);
        expect(tab.serenityMode.breathingIndicatorActive).toBe(true);
        expect(description.textContent).toContain('Guide is on');
        expect(tab.serenityMode.deps.settingsManager.update).toHaveBeenLastCalledWith({ breathingGuideEnabled: true });
        tab.toggleBreathingGuide(false);
        expect(tab.breathingIndicator.stop).toHaveBeenCalledOnce();
        expect(toggle.checked).toBe(false);
        expect(tab.serenityMode.breathingIndicatorActive).toBe(false);
        expect(tab.serenityMode.deps.settingsManager.update).toHaveBeenLastCalledWith({ breathingGuideEnabled: false });
        expect(tab.serenityMode._toggleBreathingIndicator).not.toHaveBeenCalled();
    });

    it('protects the prescribed guided rhythm and unlocks its controls when the session ends', () => {
        const tab = tabHarness();
        tab.breathingIndicator.isExternallyControlled = true;
        const cards = tab.techniques.map((technique) => tab.createTechniqueCard(technique));
        const toggle = {};
        const notice = {};
        tab.container = {
            querySelectorAll: () => cards,
            querySelector: (selector) => ({
                '#breathing-guide-toggle': toggle,
                '.breath-guided-session-notice': notice,
            }[selector] || null),
        };
        tab.refresh();
        expect(cards.every((card) => card.disabled)).toBe(true);
        expect(toggle.disabled).toBe(true);
        expect(notice.hidden).toBe(false);
        tab.selectTechnique('coherence');
        tab.toggleBreathingGuide(false);
        expect(tab.breathingIndicator.setTechnique).not.toHaveBeenCalled();
        expect(tab.serenityMode._hideBreathingIndicator).not.toHaveBeenCalled();
        expect(tab.serenityMode.deps.settingsManager.update).not.toHaveBeenCalled();
        tab.breathingIndicator.isExternallyControlled = false;
        tab.refresh();
        expect(cards.every((card) => !card.disabled)).toBe(true);
        expect(toggle.disabled).toBe(false);
        expect(notice.hidden).toBe(true);
    });

    it('offers Hale session entry before any guided session is running', () => {
        const tab = tabHarness();
        const section = tab.createHaleSessionsSection();
        expect(tab.breathingIndicator.isExternallyControlled).toBeFalsy();
        expect(section.hidden).not.toBe(true);
        expect(section.innerHTML).toContain('Start a Hale session');
        expect(section.innerHTML).toContain('Choose a Hale session');
        expect(section.innerHTML).toContain('type="button"');
    });

    it('binds both the permanent Hale entry and active-session return controls', () => {
        const tab = tabHarness();
        tab.hub = { switchTab: vi.fn() };
        const buttons = Array.from({ length: 2 }, () => ({ addEventListener: vi.fn() }));
        tab.container = {
            addEventListener: vi.fn(),
            querySelectorAll: (selector) => (selector === '.breath-open-sessions' ? buttons : []),
        };
        tab.attachEventListeners();
        buttons.forEach((button) => button.addEventListener.mock.calls[0][1]());
        expect(tab.hub.switchTab).toHaveBeenCalledTimes(2);
        expect(tab.hub.switchTab).toHaveBeenLastCalledWith('sessions');
    });
});
