import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathingTab } from '../../src/ui/serenity-hub/BreathingTab.js';
import { BREATH_WORLDS } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { looseNode, looseWindow, targetMatching } from './helpers/loose-dom.js';

let container;
let cards;
let guide;
let hub;
let settings;
let win;

function createTab({ mode = {} } = {}) {
    hub.serenityMode = {
        deps: { settingsManager: { get: () => settings, update: vi.fn((patch) => Object.assign(settings, patch)) } },
        ...mode,
    };
    return new BreathingTab(hub, guide);
}

const hero = (selector) => container.querySelector('.breath-lib__hero').querySelector(selector);
const click = (matches) => container.fire('click', { target: targetMatching(matches) });

beforeEach(() => {
    container = looseNode();
    cards = BREATH_WORLDS.map((world) => Object.assign(looseNode('button'), { dataset: { techniqueId: world.id } }));
    container.lists['.breath-world'] = cards;
    settings = { breathingTechnique: 'calm-sleep', breathingText: false, breathingGuideAutoStart: false };
    guide = {
        currentTechnique: 'deep-relaxation',
        isActive: false,
        isExternallyControlled: false,
        start: vi.fn(() => { guide.isActive = true; }),
        stop: vi.fn(() => { guide.isActive = false; }),
        setTechnique: vi.fn((id) => { guide.currentTechnique = id; }),
        setShowText: vi.fn(),
    };
    hub = { hide: vi.fn(), switchTab: vi.fn(), releaseGameplay: vi.fn() };
    win = looseWindow();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { getElementById: (id) => (id === 'tab-breathing' ? container : null) });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('breathing library', () => {
    it('features the current world with its rhythm, pace and a button that names it', () => {
        createTab();
        expect(hero('.breath-lib__name').textContent).toBe('Aurora Dreams');
        expect(hero('.breath-lib__eyebrow').textContent).toBe('Unwind · A long out-breath under northern lights.');
        expect(hero('.breath-rhythm').getAttribute('aria-label')).toBe('Inhale 5s → Hold 2s → Exhale 7s → Rest 2s');
        expect(hero('.breath-lib__cycle').textContent).toBe('16 s per breath · about 3.8 a minute');
        expect(hero('.breath-lib__begin').textContent).toBe('Begin Aurora Dreams');
        expect(hero('.breath-lib__hero-art').style.backgroundImage).toBe("url('./assets/breathing/deep-relaxation.webp')");
        expect(cards.filter((card) => card.getAttribute('aria-pressed') === 'true').map((card) => card.dataset.techniqueId))
            .toEqual(['deep-relaxation']);
    });

    it('leaves the phases a rhythm skips out of its description', () => {
        const tab = createTab();
        expect(tab.formatPattern([4, 7, 8, 0])).toBe('Inhale 4s → Hold 7s → Exhale 8s');
        expect(tab.formatPattern([5, 0, 5, 0])).toBe('Inhale 5s → Exhale 5s');
        const rhythm = tab.renderRhythm([5, 0, 5, 0]);
        expect(rhythm.match(/breath-rhythm__step/g)).toHaveLength(2);
        expect(rhythm).not.toContain('Hold');
    });

    it('selects a world: one pressed card, the guide follows, the choice is saved', () => {
        const tab = createTab();
        click({ '.breath-world': cards[4] });
        expect(guide.setTechnique).toHaveBeenLastCalledWith('coherence');
        expect(tab.serenityMode.deps.settingsManager.update).toHaveBeenLastCalledWith({ breathingTechnique: 'coherence' });
        expect(cards.filter((card) => card.getAttribute('aria-pressed') === 'true')).toEqual([cards[4]]);
        expect(hero('.breath-lib__name').textContent).toBe('Heart Glow');
        tab.selectTechnique('not-a-world');
        expect(guide.setTechnique).toHaveBeenCalledTimes(1);
    });

    it('begins through Serenity Mode, closes the Hub so the world has the screen, and saves the state', () => {
        const show = vi.fn(() => { guide.isActive = true; });
        const tab = createTab({ mode: { _showBreathingIndicator: show, _hideBreathingIndicator: vi.fn(() => { guide.isActive = false; }) } });
        click({ '.breath-lib__begin': true });
        expect(show).toHaveBeenCalledOnce();
        expect(guide.start).not.toHaveBeenCalled();
        expect(tab.serenityMode.breathingIndicatorActive).toBe(true);
        expect(settings.breathingGuideEnabled).toBe(true);
        expect(hub.hide).toHaveBeenCalledOnce();
        expect(hero('.breath-lib__begin').textContent).toBe('Stop breathing');
        click({ '.breath-lib__begin': true });
        expect(tab.serenityMode._hideBreathingIndicator).toHaveBeenCalledOnce();
        expect(settings.breathingGuideEnabled).toBe(false);
        expect(hub.releaseGameplay).toHaveBeenCalledOnce();
        expect(hero('.breath-lib__begin').textContent).toBe('Begin Aurora Dreams');
    });

    it('begins directly from another mode with the saved world and wording preference', () => {
        createTab();
        click({ '.breath-lib__begin': true });
        expect(guide.setTechnique).toHaveBeenCalledWith('calm-sleep');
        expect(guide.setShowText).toHaveBeenCalledWith(false);
        expect(guide.start).toHaveBeenCalledOnce();
        expect(hub.hide).toHaveBeenCalledOnce();
    });

    it('locks its controls while a Hale session owns the rhythm, and unlocks them after', () => {
        const tab = createTab();
        guide.isExternallyControlled = true;
        guide.isActive = true;
        tab.refresh();
        expect(container.querySelector('.breath-lib__notice').hidden).toBe(false);
        expect(hero('.breath-lib__begin').disabled).toBe(true);
        expect(cards.every((card) => card.disabled)).toBe(true);
        click({ '.breath-world': cards[2] });
        click({ '.breath-lib__begin': true });
        expect(guide.setTechnique).not.toHaveBeenCalled();
        expect(guide.stop).not.toHaveBeenCalled();
        guide.isExternallyControlled = false;
        guide.isActive = false;
        tab.refresh();
        expect(container.querySelector('.breath-lib__notice').hidden).toBe(true);
        expect(cards.every((card) => !card.disabled)).toBe(true);
    });

    it('opens the Hale sessions from either entry and applies preferences at once', () => {
        const tab = createTab();
        click({ '.breath-open-sessions': true });
        expect(hub.switchTab).toHaveBeenCalledWith('sessions');
        container.fire('change', { target: { id: 'breathing-text-toggle', checked: true } });
        expect(guide.setShowText).toHaveBeenLastCalledWith(true);
        expect(settings.breathingText).toBe(true);
        container.fire('change', { target: { id: 'breathing-auto-start', checked: true } });
        expect(settings.breathingGuideAutoStart).toBe(true);
        expect(tab.serenityMode.deps.settingsManager.update).toHaveBeenCalledTimes(2);
    });

    it('follows changes the guide makes on its own and stops listening when destroyed', () => {
        const tab = createTab();
        guide.currentTechnique = 'zen-garden';
        win.dispatchEvent({ type: 'breathingTechniqueChange', detail: { id: 'zen-garden' } });
        expect(hero('.breath-lib__name').textContent).toBe('Zen Garden');
        guide.isActive = true;
        win.dispatchEvent({ type: 'breathingGuideChange', detail: { active: true } });
        expect(hero('.breath-lib__begin').textContent).toBe('Stop breathing');
        tab.destroy();
        expect(win.listenerCount('breathingGuideChange')).toBe(0);
        expect(container.listenerCount('click')).toBe(0);
        expect(() => tab.refresh()).not.toThrow();
    });

    it('keeps native activation keys away from the mode\'s global shortcuts', () => {
        createTab();
        const onButton = container.fire('keydown', { key: ' ', target: targetMatching({ 'button': true }) });
        expect(onButton.stopped).toBe(true);
        const elsewhere = container.fire('keydown', { key: ' ', target: targetMatching({}) });
        expect(elsewhere.stopped).toBeUndefined();
    });
});
