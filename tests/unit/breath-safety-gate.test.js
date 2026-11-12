/**
 * One gate on every path: until the safety note is read on this device, a fast breathing world
 * (Volcanic Fire) can be neither started nor switched to, whatever asks.
 *
 * The real guide, the real wiring of breathing on your own (standalone-breathing.js), the real
 * Serenity Mode, Hub pad callbacks and Breathing tab, with every world found: only the note
 * stands between the player and the fast world. One test per path.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { looseNode, looseWindow, targetMatching } from './helpers/loose-dom.js';

vi.mock('../../src/themes/base-theme.js', () => ({ setGlobalRenderScale: vi.fn() }));

const STAGE_MODULE = '../../src/ui/effects/breathing/stage/breath-stage.js';
const STORE_MODULE = '../../src/ui/effects/breathing/breath-collection-store.js';
const VOICE_MODULE = '../../src/ui/effects/breathing/world-voice.js';
const STRONG = 'volcanic-fire';
/** The worlds either side of the fast one, in the order the guide steps through them. */
const BEFORE = 'triangle';
const AFTER = 'ocean-breath';

let guide;
let mode;
let settings;
let stored;
let doc;
let win;
let container;
let cards;
let safety;
let modules;
let now;
let frames;

const key = (name) => doc.fire('keydown', { key: name, target: looseNode() });
const press = (name) => mode._onKeyPress({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() });
const readNote = () => safety.setBreathSafetyRead(true);
const toast = () => mode.ui.notice.mock.calls.map(([message]) => message);

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    now = 1000;
    frames = new Map();
    let nextFrame = 1;
    stored = new Map();
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
    doc = looseNode();
    doc.hidden = false;
    doc.body = looseNode('body');
    doc.createElement = (tag) => looseNode(tag);
    container = looseNode();
    doc.getElementById = (id) => (id === 'tab-breathing' ? container : null);
    win = looseWindow({
        localStorage: {
            getItem: (name) => stored.get(name) ?? null,
            setItem: (name, value) => stored.set(name, String(value)),
            removeItem: (name) => stored.delete(name),
        },
    });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock(STAGE_MODULE, () => ({
        BreathStage: class {
            constructor() {
                ['setFocus', 'setSessionPhase', 'setBreath', 'stop', 'dispose'].forEach((name) => { this[name] = vi.fn(); });
                ['setWorld', 'start', 'prepare', 'prepareNext'].forEach((name) => { this[name] = vi.fn(() => Promise.resolve()); });
            }
        },
    }));
    // Every world found: the note is the only thing between the player and the fast one.
    const { BreathCollectionService } = await import('../../src/ui/effects/breathing/breath-collection.js');
    const collection = new BreathCollectionService({ developmentUnlockAll: true });
    vi.doMock(STORE_MODULE, () => ({ getBreathCollection: () => collection }));
    vi.doMock(VOICE_MODULE, () => ({ startWorldVoice: () => ({ refresh() {}, stop() {} }) }));

    safety = await import('../../src/ui/effects/breathing/breath-safety.js');
    const { BREATH_WORLDS } = await import('../../src/ui/effects/breathing/breath-catalogue.js');
    const { startStandaloneBreathing } = await import('../../src/ui/effects/breathing/standalone-breathing.js');
    const { SerenityMode } = await import('../../src/core/game-modes/SerenityMode.js');
    const { SerenityHub } = await import('../../src/ui/serenity-hub/SerenityHub.js');
    const { BreathingTab } = await import('../../src/ui/serenity-hub/BreathingTab.js');
    modules = { SerenityHub, BreathingTab, BREATH_WORLDS };

    settings = { breathingTechnique: STRONG, breathingText: true, serenityKeyBindings: {} };
    const settingsManager = { get: () => settings, update: vi.fn((patch) => Object.assign(settings, patch)) };
    guide = startStandaloneBreathing({ settingsManager, cleanupHandlers: [] });
    win.breathingIndicator = guide;
    mode = new SerenityMode({ settingsManager });
    mode.isRunning = true;
    mode.isActive = true;
    mode.ui = { resting: false, notice: vi.fn(), stepWorld: vi.fn() };
    mode.serenityHub = {
        isOpen: false, updateIconState: vi.fn(), switchTab: vi.fn(), show: vi.fn(), hide: vi.fn(),
    };
    cards = BREATH_WORLDS.map((world) => Object.assign(looseNode('button'), { dataset: { techniqueId: world.id } }));
    container.lists['.breath-world'] = cards;
});

afterEach(async () => {
    guide?.destroy();
    await vi.dynamicImportSettled();
    vi.doUnmock(STAGE_MODULE);
    vi.doUnmock(STORE_MODULE);
    vi.doUnmock(VOICE_MODULE);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A Breathing tab over the real guide and mode. */
function openTab() {
    const hub = {
        serenityMode: mode, hide: vi.fn(), switchTab: vi.fn(), releaseGameplay: vi.fn(),
    };
    return new modules.BreathingTab(hub, guide);
}
const hero = (selector) => container.querySelector('.breath-lib__hero').querySelector(selector);
const clickCard = (id) => container.fire('click', {
    target: targetMatching({ '.breath-world': cards.find((card) => card.dataset.techniqueId === id) }),
});

describe('the rule itself (breath-safety.js canPractise)', () => {
    it('lets a gentle rhythm be practised always, a fast one only once the current note is read', () => {
        const { canPractise, BREATH_SAFETY_VERSION } = safety;
        expect(canPractise([5, 0, 5, 0])).toBe(true);
        expect(canPractise([3, 0, 2, 0])).toBe(false);
        // A tick on an older note does not count.
        stored.set('serenity.breathSafetyRead', '2026-11-08');
        expect(canPractise([3, 0, 2, 0])).toBe(false);
        readNote();
        expect(stored.get('serenity.breathSafetyRead')).toBe(BREATH_SAFETY_VERSION);
        expect(canPractise([3, 0, 2, 0])).toBe(true);
        expect(BREATH_SAFETY_VERSION).toBe('2026-11-12');
    });
});

describe('a fast world before its safety note is read', () => {
    it('is not a world you may choose, though you have found it (standalone-breathing canChoose)', () => {
        expect(guide.canChoose('coherence')).toBe(true);
        expect(guide.canChoose(STRONG)).toBe(false);
        expect(guide.allowedWorld(STRONG)).toBe('coherence');
        readNote();
        expect(guide.canChoose(STRONG)).toBe(true);
        expect(guide.allowedWorld(STRONG)).toBe(STRONG);
    });

    it('is skipped by the arrow keys of a running practice', () => {
        guide.setTechnique(BEFORE);
        guide.start();
        key('ArrowRight');
        expect(guide.currentTechnique).toBe(AFTER);
        key('ArrowLeft');
        expect(guide.currentTechnique).toBe(BEFORE);
        const seen = new Set();
        for (let i = 0; i < 24; i++) {
            key('ArrowRight');
            seen.add(guide.currentTechnique);
        }
        expect(seen.size).toBe(11);
        expect(seen.has(STRONG)).toBe(false);
    });

    it('is skipped by the guide\'s own previous and next buttons', () => {
        const click = (action) => guide.root.fire('click', {
            target: targetMatching({ '[data-action]': { dataset: { action } } }),
        });
        guide.setTechnique(BEFORE);
        guide.start();
        click('next');
        expect(guide.currentTechnique).toBe(AFTER);
        click('previous');
        expect(guide.currentTechnique).toBe(BEFORE);
    });

    it('is skipped by a controller: the D-pad\'s world buttons, and its left and right in a practice', () => {
        const hub = { serenityMode: mode };
        modules.SerenityHub.prototype.setupGamepadIntegration.call(hub);
        const pad = hub.gamepadCallbacks;
        guide.setTechnique(BEFORE);
        pad.nextBreathingTechnique();
        expect(guide.currentTechnique).toBe(AFTER);
        pad.previousBreathingTechnique();
        expect(guide.currentTechnique).toBe(BEFORE);
        guide.start();
        pad.stepWorld(1);
        expect(guide.currentTechnique).toBe(AFTER);
        pad.stepWorld(-1);
        expect(guide.currentTechnique).toBe(BEFORE);
    });

    it('is skipped by the T key, with the guide closed or open, and never saved as your choice', () => {
        guide.setTechnique(BEFORE);
        settings.breathingTechnique = BEFORE;
        press('t');
        expect(guide.currentTechnique).toBe(AFTER);
        expect(settings.breathingTechnique).toBe(AFTER);
        guide.setTechnique(BEFORE);
        guide.start();
        press('t');
        expect(guide.currentTechnique).toBe(AFTER);
        expect(settings.breathingTechnique).toBe(AFTER);
    });

    it('begins as the gentle default on Space, and says the note is in the Breathing tab', () => {
        press(' ');
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe('coherence');
        expect(guide.pattern).toEqual([5, 0, 5, 0]);
        expect(toast()).toEqual(['Volcanic Fire has a safety note: read it in the Breathing tab']);
        // Your choice is kept: once the note is read it begins as chosen.
        expect(settings.breathingTechnique).toBe(STRONG);
    });

    it('begins as the gentle default from a controller\'s breathing button', () => {
        const hub = { serenityMode: mode };
        modules.SerenityHub.prototype.setupGamepadIntegration.call(hub);
        hub.gamepadCallbacks.toggleBreathing();
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe('coherence');
        expect(toast()).toHaveLength(1);
    });

    it('begins as the gentle default with "Begin with Serenity Mode"', async () => {
        settings.breathingGuideAutoStart = true;
        mode._ensureMusicPlaying = vi.fn();
        mode._setupKeyboardControls = vi.fn();
        mode._setupCursorAutoHide = vi.fn();
        mode._setupSerenityUi = vi.fn();
        mode.serenityHub.setMode = vi.fn();
        win.serenityBlocks = { serenityHub: mode.serenityHub };
        await mode.onStart();
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe('coherence');
        expect(toast()).toHaveLength(1);
    });

    it('begins as the gentle default when a settings change turns the guide on', () => {
        mode.onSettingsChange({ ...settings, breathingGuideEnabled: true });
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe('coherence');
        expect(toast()).toHaveLength(1);
    });

    it('is only shown in the Breathing tab when its card is chosen: with its note and tick, never begun', () => {
        settings.breathingTechnique = 'calm-sleep';
        const tab = openTab();
        clickCard(STRONG);
        expect(hero('.breath-lib__name').textContent).toBe('Volcanic Fire');
        expect(hero('.breath-lib__caution').hidden).toBe(false);
        expect(hero('.breath-lib__caution').querySelector('.breath-lib__ack').hidden).toBe(false);
        expect(hero('.breath-lib__begin').disabled).toBe(true);
        // Neither the guide nor your saved choice moved to it.
        expect(guide.currentTechnique).not.toBe(STRONG);
        expect(settings.breathingTechnique).toBe('calm-sleep');
        container.fire('click', { target: targetMatching({ '.breath-lib__begin': true }) });
        tab.toggleBreathingGuide(true);
        expect(guide.isActive).toBe(false);
    });

    it('never takes over a running practice from its card: the practice stays, the note shows', () => {
        settings.breathingTechnique = 'calm-sleep';
        openTab();
        press(' ');
        expect(guide.currentTechnique).toBe('calm-sleep');
        clickCard(STRONG);
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe('calm-sleep');
        expect(guide.pattern).toEqual([4, 7, 8, 0]);
        expect(settings.breathingTechnique).toBe('calm-sleep');
        // The card is still chosen in the tab, so its note and tick can be read.
        expect(hero('.breath-lib__name').textContent).toBe('Volcanic Fire');
        expect(hero('.breath-lib__caution').hidden).toBe(false);
        expect(hero('.breath-lib__caution').querySelector('.breath-lib__ack').hidden).toBe(false);
        // Ticking the note is not a Begin: the practice goes on as it was.
        container.fire('change', {
            target: Object.assign(targetMatching({ '.breath-lib__ack-input': true }), { checked: true }),
        });
        expect(safety.isBreathSafetyRead()).toBe(true);
        expect(guide.currentTechnique).toBe('calm-sleep');
        // Read, the card now moves the practice as any other world's does.
        clickCard(STRONG);
        expect(guide.currentTechnique).toBe(STRONG);
        expect(settings.breathingTechnique).toBe(STRONG);
    });

    it('is never begun by the guide itself: a direct start falls back, a direct switch is refused', () => {
        // A Sukha session may leave the closed guide in the fast world (Phoenix breathes there).
        guide.setExternalControl(true);
        guide.setTechnique(STRONG);
        guide.setExternalControl(false);
        expect(guide.currentTechnique).toBe(STRONG);
        guide.start();
        expect(guide.currentTechnique).toBe('coherence');
        expect(guide.pattern).toEqual([5, 0, 5, 0]);
        guide.setTechnique(STRONG);
        expect(guide.currentTechnique).toBe('coherence');
        // Settings opened and closed over a practice restart it the same way.
        mode.breathingIndicatorActive = true;
        mode.onPause();
        guide.setExternalControl(true);
        guide.setTechnique(STRONG);
        guide.setExternalControl(false);
        mode.onResume();
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe('coherence');
    });
});

describe('a fast world once its safety note is read', () => {
    beforeEach(() => readNote());

    it('begins as chosen, with no notice, and can be stepped to', () => {
        press(' ');
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe(STRONG);
        expect(guide.pattern).toEqual([3, 0, 2, 0]);
        expect(toast()).toEqual([]);
        key('ArrowLeft');
        expect(guide.currentTechnique).toBe(BEFORE);
        key('ArrowRight');
        expect(guide.currentTechnique).toBe(STRONG);
    });

    it('begins from the Breathing tab, and its card moves a running practice to it', () => {
        settings.breathingTechnique = 'calm-sleep';
        openTab();
        clickCard(STRONG);
        expect(settings.breathingTechnique).toBe(STRONG);
        expect(hero('.breath-lib__begin').disabled).toBe(false);
        expect(hero('.breath-lib__cycle').textContent).toBe('5 s per breath · 30 breaths, then a rest');
        container.fire('click', { target: targetMatching({ '.breath-lib__begin': true }) });
        expect(guide.isActive).toBe(true);
        expect(guide.currentTechnique).toBe(STRONG);
    });
});

describe('a Sukha session', () => {
    it('sets its own worlds past the gate: its note is asked on its preparation screen', () => {
        guide.setExternalControl(true);
        guide.start();
        guide.setTechnique(STRONG);
        expect(guide.currentTechnique).toBe(STRONG);
    });
});
