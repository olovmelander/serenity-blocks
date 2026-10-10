import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathingTab } from '../../src/ui/serenity-hub/BreathingTab.js';
import { BreathCollectionService } from '../../src/ui/effects/breathing/breath-collection.js';
import { BREATH_WORLDS } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { looseNode, looseWindow, targetMatching } from './helpers/loose-dom.js';

let container;
let cards;
let guide;
let hub;
let settings;
let win;

function createTab({ mode = {}, collection = null } = {}) {
    hub.serenityMode = {
        deps: {
            settingsManager: { get: () => settings, update: vi.fn((patch) => Object.assign(settings, patch)) },
            // Every world found, unless a test is about finding them.
            breathCollection: collection || new BreathCollectionService({ developmentUnlockAll: true }),
        },
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
    it('features the world you chose, its rhythm and pace, and a button that begins that world', () => {
        // The guide still holds another world; Begin starts the saved choice, so the hero shows it.
        createTab();
        expect(hero('.breath-lib__name').textContent).toBe('Moonlit Waters');
        expect(hero('.breath-lib__eyebrow').textContent).toBe('Sleep · In for 4, hold for 7, out for 8.');
        expect(hero('.breath-rhythm').getAttribute('aria-label')).toBe('Inhale 4s → Hold 7s → Exhale 8s');
        expect(hero('.breath-lib__cycle').textContent).toBe('19 s per breath · about 3.2 a minute');
        expect(hero('.breath-lib__begin').textContent).toBe('Begin Moonlit Waters');
        expect(hero('.breath-lib__hero-art').style.backgroundImage).toBe("url('./assets/breathing/calm-sleep.webp')");
        expect(cards.filter((card) => card.getAttribute('aria-pressed') === 'true').map((card) => card.dataset.techniqueId))
            .toEqual(['calm-sleep']);
    });

    it('shows what is playing while a practice runs', () => {
        guide.isActive = true;
        createTab();
        expect(hero('.breath-lib__name').textContent).toBe('Aurora Dreams');
        expect(hero('.breath-lib__begin').textContent).toBe('Stop breathing');
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
        expect(hero('.breath-lib__begin').textContent).toBe('Begin Moonlit Waters');
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
        // The breath tones have their own switch, beside the voice's.
        expect(container.innerHTML).toContain('id="breathing-tones-toggle"');
        container.fire('change', { target: { id: 'breathing-tones-toggle', checked: false } });
        expect(settings.breathingTones).toBe(false);
        container.fire('change', { target: { id: 'breathing-voice-toggle', checked: false } });
        expect(settings.breathingVoice).toBe(false);
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

    it('shows a world not found yet: you can look at it, not begin it, and it says where it is found', () => {
        const tab = createTab({ collection: new BreathCollectionService() });
        const html = container.innerHTML;
        expect(html).toContain('4 of 12 found');
        expect(html).toMatch(/class="breath-world is-locked"\s+data-technique-id="wim-hof"/);
        expect(html).toContain('aria-label="Volcanic Fire, not found yet. Opens when you complete the Odyssey, or after 120 more minutes of breathing."');
        expect(html).not.toMatch(/class="breath-world is-locked"\s+data-technique-id="calm-sleep"/);
        click({ '.breath-world': cards[6] });
        expect(guide.setTechnique).not.toHaveBeenCalled();
        expect(tab.serenityMode.deps.settingsManager.update).not.toHaveBeenCalled();
        expect(hero('.breath-lib__name').textContent).toBe('Volcanic Fire');
        expect(container.querySelector('.breath-lib__hero').classList.contains('is-locked')).toBe(true);
        expect(hero('.breath-lib__eyebrow').textContent).toBe('Activate · Found at the end of the Odyssey');
        expect(hero('.breath-lib__begin').textContent).toBe('Found at the end of the Odyssey');
        expect(hero('.breath-lib__begin').disabled).toBe(true);
        expect(hero('.breath-lib__cycle').textContent).toBe('Opens when you complete the Odyssey, or after 120 more minutes of breathing.');
        tab.toggleBreathingGuide(true);
        expect(guide.start).not.toHaveBeenCalled();
        click({ '.breath-world': cards[4] });
        expect(container.querySelector('.breath-lib__hero').classList.contains('is-locked')).toBe(false);
        expect(hero('.breath-lib__begin').textContent).toBe('Begin Heart Glow');
        expect(hero('.breath-lib__begin').disabled).toBe(false);
    });

    it('marks a world that has just opened as new until you look at it, and redraws when one opens', () => {
        const levels = {};
        const collection = new BreathCollectionService({ readOdysseyProgress: () => ({ completedLevels: levels }) });
        const tab = createTab({ collection });
        expect(container.innerHTML).toContain('4 of 12 found');
        [1, 2, 3, 4, 5].forEach((id) => { levels[id] = { stars: 3 }; });
        tab.onShow();
        expect(container.innerHTML).toContain('5 of 12 found');
        expect(container.innerHTML).toMatch(/class="breath-world is-new"\s+data-technique-id="ocean-breath"/);
        expect(container.innerHTML).toContain('aria-label="Ocean Tide, new.');
        cards[7].classList.add('is-new');
        click({ '.breath-world': cards[7] });
        expect(guide.setTechnique).toHaveBeenLastCalledWith('ocean-breath');
        expect(collection.status('worlds', 'ocean-breath').isNew).toBe(false);
        expect(cards[7].classList.contains('is-new')).toBe(false);
        tab.destroy();
        [6, 7, 8, 9, 10].forEach((id) => { levels[id] = { stars: 1 }; });
        expect(() => collection.reconcile()).not.toThrow();
    });

    it('keeps native activation keys away from the mode\'s global shortcuts', () => {
        createTab();
        const onButton = container.fire('keydown', { key: ' ', target: targetMatching({ 'button': true }) });
        expect(onButton.stopped).toBe(true);
        const elsewhere = container.fire('keydown', { key: ' ', target: targetMatching({}) });
        expect(elsewhere.stopped).toBeUndefined();
    });
});
