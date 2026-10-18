import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createJourneyFlowOverlay } from '../../src/ui/odyssey/JourneyFlowOverlay.js';
import { createFailureModal } from '../../src/ui/odyssey/FailureModal.js';
import { createResultsModal } from '../../src/ui/odyssey/ResultsModal.js';
import { renderOdysseyLevelPanel } from '../../src/ui/odyssey/odyssey-level-panel.js';
import { createBoardInfoOverlay } from '../../src/ui/odyssey/BoardInfoOverlay.js';
import {
    describeOdysseyArrival, pendingOdysseyChapterArrival, presentOdysseyArrival,
} from '../../src/ui/odyssey/odyssey-first-arrival.js';
import { returnToOdysseyWorld } from '../../src/ui/odyssey/odyssey-world-return.js';
import {
    ODYSSEY_CHARM_KIND_LABELS, ODYSSEY_MERCY_FALLS, applyOdysseyCharmsToLevel, describeOdysseyCharms,
    odysseyCharmById,
} from '../../src/core/odyssey/odyssey-charms.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { getOdysseyLevelBriefing } from '../../src/ui/odyssey/odyssey-level-briefing.js';
import { formatOdysseyMapObjective, formatOdysseyStarCondition } from '../../src/ui/odyssey/objective-copy.js';

// ---- A light DOM: elements with children, datasets, listeners and focus --------------------
function eventTarget(properties = {}) {
    const listeners = new Map();
    return {
        ...properties,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
        dispatch(type, detail = {}) {
            const event = {
                target: this, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...detail,
            };
            listeners.get(type)?.forEach((listener) => listener(event));
            return event;
        },
    };
}
function createElement(tagName) {
    return eventTarget({
        tagName,
        children: [],
        dataset: {},
        style: { setProperty: vi.fn() },
        textContent: '',
        className: '',
        hidden: false,
        isConnected: true,
        appendChild(child) { this.children.push(child); return child; },
        remove() { this.isConnected = false; },
        focus(options) { document.activeElement = this; this.focusOptions = options; },
    });
}
const nodes = (element) => [element, ...element.children.flatMap(nodes)];
const action = (modal, name) => nodes(modal).find((node) => node.dataset.flowAction === name);
const byClass = (root, className) => nodes(root).filter((node) => node.className === className);
const markup = (root) => nodes(root).map((node) => node.textContent).join(' ');
const stubDocument = () => {
    const body = createElement('body');
    vi.stubGlobal('document', eventTarget({
        createElement, body, activeElement: null, hidden: false, hasFocus: () => true,
    }));
    vi.stubGlobal('window', eventTarget({ innerHeight: 900 }));
    return body;
};
const offer = (charmIds = ['keel', 'kindle', 'hearth']) => ({
    charms: describeOdysseyCharms(charmIds), onTake: vi.fn(), onPass: vi.fn(),
});

describe('Odyssey charm draft: the chapter arrival overlay', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        stubDocument();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    const arrival = (options = {}) => createJourneyFlowOverlay({
        variant: 'chapter', nextLevel: getLevelById(1), chapter: CHAPTER_CONFIGS[0], ...options,
    });
    const cards = (modal) => byClass(modal, 'ody-charm');

    it('lays three cards on the arrival and holds Begin chapter and Map until one is taken', () => {
        const onChoose = vi.fn();
        const draft = offer();
        const modal = arrival({ charmDraft: draft, onChoose });
        expect(modal.dataset.charmPending).toBe('true');
        expect(markup(modal)).toContain('The road offers a charm');
        expect(markup(modal)).toContain('Take one and keep it, or pass. You carry up to three at a time.');
        expect(cards(modal).map((card) => card.dataset.charm)).toEqual(['keel', 'kindle', 'hearth']);
        expect(cards(modal).map((card) => card.dataset.kind)).toEqual(['goal', 'score', 'safety']);
        expect(cards(modal)[0].children.map((part) => part.textContent))
            .toEqual([ODYSSEY_CHARM_KIND_LABELS.goal, 'Keel', odysseyCharmById('keel').line]);
        const status = byClass(modal, 'ody-flow__status')[0];

        action(modal, 'next').dispatch('click');
        expect(onChoose).not.toHaveBeenCalled();
        expect(status.textContent).toBe('Take a charm or pass to go on.');
        expect(document.activeElement).toBe(cards(modal)[0]);
        document.dispatch('keydown', { key: 'Escape' });
        expect(onChoose).not.toHaveBeenCalled();

        cards(modal)[0].dispatch('click');
        expect(draft.onTake).toHaveBeenCalledExactlyOnceWith('keel');
        expect(modal.dataset.charmPending).toBe('false');
        expect(cards(modal)).toEqual([]);
        expect(action(modal, 'pass-charm')).toBeUndefined();
        expect(markup(modal)).toContain(`Keel is yours and carried from here. ${odysseyCharmById('keel').line}`);
        expect(status.textContent).toBe('');
        expect(document.activeElement).toBe(action(modal, 'next'));
        action(modal, 'next').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('lets the player pass, then leave for the map, and takes no second answer to a settled draft', () => {
        const onChoose = vi.fn();
        const draft = offer();
        const modal = arrival({ charmDraft: draft, onChoose });
        const pass = action(modal, 'pass-charm');
        expect(pass.textContent).toBe('Pass');
        pass.dispatch('click');
        expect(draft.onPass).toHaveBeenCalledOnce();
        expect(markup(modal)).toContain('No charm this time. The road offers more ahead.');
        pass.dispatch('click');
        expect(draft.onPass).toHaveBeenCalledOnce();
        expect(draft.onTake).not.toHaveBeenCalled();
        document.dispatch('keydown', { key: 'Escape' });
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('map');
        modal.dispose();
    });

    it('says what was set down when a taken charm filled the three slots', () => {
        const full = { ...offer(), onTake: vi.fn(() => ({ taken: true, setDown: odysseyCharmById('swell') })) };
        const modal = arrival({ charmDraft: full });
        cards(modal)[2].dispatch('click');
        expect(markup(modal)).toContain('Hearth is yours and carried from here. Swell was set down to make room; '
            + 'change what you carry on the map.');
        modal.dispose();
    });

    it('keeps the draft open when taking is refused, and shows no draft block at all without one', () => {
        const refused = { ...offer(), onTake: vi.fn(() => false) };
        const modal = arrival({ charmDraft: refused });
        cards(modal)[1].dispatch('click');
        expect(refused.onTake).toHaveBeenCalledExactlyOnceWith('kindle');
        expect(cards(modal)).toHaveLength(3);
        expect(modal.dataset.charmPending).toBe('true');
        modal.dispose();

        const onChoose = vi.fn();
        const plain = arrival({ onChoose });
        expect(byClass(plain, 'ody-flow__charms')[0].hidden).toBe(true);
        expect(plain.dataset.charmPending).toBe('false');
        action(plain, 'next').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        plain.dispose();
        const empty = arrival({ charmDraft: { charms: [], onTake: vi.fn() } });
        expect(byClass(empty, 'ody-flow__charms')[0].hidden).toBe(true);
        empty.dispose();
    });

    it('keeps the cards and Pass in the Tab cycle', () => {
        const modal = arrival({ charmDraft: offer() });
        action(modal, 'map').focus();
        document.dispatch('keydown', { key: 'Tab', shiftKey: false });
        expect(document.activeElement).toBe(cards(modal)[0]);
        document.dispatch('keydown', { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(action(modal, 'map'));
        modal.dispose();
    });

    it('carries a draft into the arrival of a journey crossing a chapter, hidden in transit before and after', () => {
        const onChapter = vi.fn();
        const draft = offer();
        const modal = createJourneyFlowOverlay({
            level: getLevelById(5),
            nextLevel: getLevelById(6),
            chapter: CHAPTER_CONFIGS[1],
            results: { stars: 2 },
            autoContinue: false,
        });
        const block = byClass(modal, 'ody-flow__charms')[0];
        expect(block.hidden).toBe(true);
        action(modal, 'next').dispatch('click');
        modal.beginTransit({});
        modal.setScenic('travel');
        expect(block.hidden).toBe(true);
        expect(modal.showChapter({ onChoose: onChapter, charmDraft: draft })).toBe(true);
        expect(block.hidden).toBe(false);
        expect(cards(modal)).toHaveLength(3);
        expect(modal.dataset.charmPending).toBe('true');
        action(modal, 'next').dispatch('click');
        expect(onChapter).not.toHaveBeenCalled();
        cards(modal)[2].dispatch('click');
        expect(draft.onTake).toHaveBeenCalledExactlyOnceWith('hearth');
        action(modal, 'next').dispatch('click');
        expect(onChapter).toHaveBeenCalledExactlyOnceWith('next');
        modal.beginTransit({});
        expect(block.hidden).toBe(true);
        modal.dispose();
    });

    it('names a pending arrival the way the map offers it', () => {
        const modal = createJourneyFlowOverlay({
            variant: 'chapter',
            nextLevel: getLevelById(8),
            chapter: CHAPTER_CONFIGS[1],
            destinationPrefix: 'Next',
            arrivalEyebrow: 'Chapter 2 · The road offers a charm',
            arrivalPrimary: 'Continue',
            charmDraft: offer(),
        });
        expect(markup(modal)).toContain('Chapter 2 · The road offers a charm');
        expect(markup(modal)).toContain(`Next · Orb 8 · ${getLevelById(8).name}`);
        expect(markup(modal)).not.toContain('A new horizon');
        expect(action(modal, 'next').textContent).toBe('Continue');
        modal.dispose();
    });
});

describe('Odyssey charm draft: the road’s mercy on the failure sheet', () => {
    function element(tagName) {
        const listeners = new Map();
        return {
            tagName,
            children: [],
            className: '',
            dataset: {},
            textContent: '',
            hidden: false,
            style: {},
            remove: vi.fn(),
            addEventListener: vi.fn((type, listener) => { listeners.set(type, listener); }),
            appendChild(child) { this.children.push(child); return child; },
            dispatch(type, event = {}) { listeners.get(type)?.(event); },
        };
    }
    const all = (root) => [root, ...root.children.flatMap(all)];
    const text = (root) => all(root).map((node) => node.textContent).join(' ');
    beforeEach(() => {
        vi.stubGlobal('document', {
            addEventListener: vi.fn(), createElement: vi.fn(element), removeEventListener: vi.fn(), activeElement: null,
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    const keydown = () => document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];

    it('offers three charms after the third fall; a card owns Enter, taking settles the sheet, Retry follows', () => {
        const onChoose = vi.fn();
        const draft = offer(['low-tide', 'swell', 'hearth']);
        const modal = createFailureModal({
            attemptNumber: 3, reasonText: 'You topped out!', onChoose, charmDraft: draft,
        });
        expect(text(modal)).toContain('The road offers a charm');
        expect(text(modal)).toContain(`After ${ODYSSEY_MERCY_FALLS} falls on one orb`);
        const cards = all(modal).filter((node) => node.className === 'sb-ody-charm');
        expect(cards.map((card) => card.dataset.charm)).toEqual(['low-tide', 'swell', 'hearth']);
        expect(cards[1].children.map((part) => part.textContent))
            .toEqual([ODYSSEY_CHARM_KIND_LABELS.score, 'Swell', odysseyCharmById('swell').line]);
        const notNow = all(modal).find((node) => node.textContent === 'Not now');
        expect(notNow.className).toContain('sb-ody-charm-pass');

        document.activeElement = cards[1];
        const enter = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        keydown()(enter);
        expect(enter.preventDefault).not.toHaveBeenCalled();
        expect(onChoose).not.toHaveBeenCalled();

        cards[1].dispatch('click');
        expect(draft.onTake).toHaveBeenCalledExactlyOnceWith('swell');
        expect(all(modal).find((node) => node.className === 'sb-ody-charm-list').hidden).toBe(true);
        expect(notNow.hidden).toBe(true);
        expect(text(modal)).toContain(`Swell is yours, carried from the next attempt. ${odysseyCharmById('swell').line}`);
        cards[0].dispatch('click');
        notNow.dispatch('click');
        expect(draft.onTake).toHaveBeenCalledOnce();
        expect(draft.onPass).not.toHaveBeenCalled();

        document.activeElement = null;
        keydown()({ key: 'r', preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('retry');
    });

    it('lets the player decline, names a set-down charm, and shows no offer without a draft', () => {
        const draft = offer();
        const modal = createFailureModal({
            attemptNumber: 4, reasonText: 'Time ran out!', onChoose: vi.fn(), charmDraft: draft,
        });
        all(modal).find((node) => node.textContent === 'Not now').dispatch('click');
        expect(draft.onPass).toHaveBeenCalledOnce();
        expect(text(modal)).toContain('No charm this time. The road offers more ahead.');
        const full = { ...offer(), onTake: vi.fn(() => ({ taken: true, setDown: odysseyCharmById('kindle') })) };
        const crowded = createFailureModal({
            attemptNumber: 3, reasonText: 'Time ran out!', onChoose: vi.fn(), charmDraft: full,
        });
        all(crowded).find((node) => node.className === 'sb-ody-charm').dispatch('click');
        expect(text(crowded)).toContain('Keel is yours, carried from the next attempt. Kindle was set down to make room.');
        const plain = createFailureModal({ attemptNumber: 1, reasonText: 'Time ran out!', onChoose: vi.fn() });
        expect(text(plain)).not.toContain('charm');
        expect(all(plain).some((node) => node.className === 'sb-ody-charm')).toBe(false);
    });

    it('says which charm in the bag would help when the road has nothing new to offer', () => {
        const hinted = createFailureModal({
            attemptNumber: 3,
            reasonText: 'Time ran out!',
            onChoose: vi.fn(),
            charmHint: 'In your bag, not carried: Long Breath (30 more seconds on the clock). Change what you carry on the map.',
        });
        const note = all(hinted).find((node) => node.className === 'sb-ody-note sb-ody-charm-hint');
        expect(note.children.map((part) => part.textContent)).toEqual([
            'Your charms',
            'In your bag, not carried: Long Breath (30 more seconds on the clock). Change what you carry on the map.',
        ]);
        // A draft on offer outranks the hint.
        const both = createFailureModal({
            attemptNumber: 3, reasonText: 'Time ran out!', onChoose: vi.fn(), charmDraft: offer(), charmHint: 'unused',
        });
        expect(text(both)).not.toContain('unused');
    });
});

describe('Odyssey charm draft: a chapter arrival the map still owes', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        stubDocument();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    function createMode({ state = {}, ...overrides } = {}) {
        return {
            isActive: true,
            isInBoardView: true,
            isEnteringLevel: false,
            _chapterFlowActive: false,
            _boardPresentationGeneration: 3,
            selectedLevelId: null,
            odysseyState: {
                isFreshJourney: () => false,
                hasSeenArrival: () => true,
                markArrivalSeen: vi.fn(),
                currentChapter: 2,
                currentLevel: 8,
                getChapterCharmDraft: vi.fn((chapterId) => (
                    chapterId === 2 ? { key: 'chapter:2', charms: offer().charms } : null
                )),
                takeCharm: vi.fn(() => ({ setDown: null })),
                passCharm: vi.fn(() => true),
                ...state,
            },
            levelRegistry: {
                getLevel: (id) => getLevelById(id),
                getChapter: (id) => CHAPTER_CONFIGS.find((chapter) => chapter.id === id) || null,
            },
            deps: { settingsManager: { get: () => ({}) } },
            _lockOdysseyBoardForLaunch: vi.fn(),
            _unlockOdysseyBoardAfterLaunchAttempt: vi.fn(),
            _setBoardOverlaySuppressed: vi.fn(),
            setOdysseyNavigatorButtonVisible: vi.fn(),
            _updateLevelPreview: vi.fn(),
            launchOdysseyLevel: vi.fn().mockResolvedValue(true),
            ...overrides,
        };
    }
    async function open(mode, options) {
        const run = presentOdysseyArrival(mode, options);
        await Promise.resolve();
        return { run, modal: document.body.children[0] };
    }

    it('returns as the road’s offer for the chapter the player stands in, and continues from their orb', async () => {
        const mode = createMode();
        expect(pendingOdysseyChapterArrival(mode)).toMatchObject({
            chapterId: 2, level: getLevelById(8), fresh: false, draft: { key: 'chapter:2' },
        });
        const { run, modal } = await open(mode, { onlyPending: true });
        expect(modal.dataset.layout).toBe('chapter');
        expect(markup(modal)).toContain('Chapter 2 · The road offers a charm');
        expect(markup(modal)).toContain(`Next · Orb 8 · ${getLevelById(8).name}`);
        expect(markup(modal)).not.toContain('Each orb is one short puzzle');
        expect(action(modal, 'next').textContent).toBe('Continue');
        expect(mode.odysseyState.markArrivalSeen).not.toHaveBeenCalled();
        expect(mode._chapterFlowActive).toBe(true);
        byClass(modal, 'ody-charm')[0].dispatch('click');
        expect(mode.odysseyState.takeCharm)
            .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'chapter:2' }), 'keel');
        action(modal, 'next').dispatch('click');
        expect(await run).toBe('next');
        expect(mode._chapterFlowActive).toBe(false);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledExactlyOnceWith(8, { source: 'chapter-arrival' });
        expect(mode._updateLevelPreview).toHaveBeenLastCalledWith(8);
    });

    it('says Begin chapter at the chapter’s first orb, and lets a pass settle the draft before Map', async () => {
        const mode = createMode({ state: { currentLevel: 6 } });
        const { run, modal } = await open(mode, { onlyPending: true });
        expect(markup(modal)).toContain(`First · Orb 6 · ${getLevelById(6).name}`);
        expect(action(modal, 'next').textContent).toBe('Begin chapter');
        action(modal, 'map').dispatch('click');
        expect(mode.odysseyState.passCharm).not.toHaveBeenCalled();
        action(modal, 'pass-charm').dispatch('click');
        expect(mode.odysseyState.passCharm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'chapter:2' }));
        action(modal, 'map').dispatch('click');
        expect(await run).toBe('map');
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(mode.selectedLevelId).toBe(6);
    });

    it('owes nothing for a settled draft, a fresh journey asked only for a pending one, or elsewhere', async () => {
        const settled = createMode({ state: { getChapterCharmDraft: vi.fn(() => null) } });
        expect(describeOdysseyArrival(settled)).toBeNull();
        expect(await presentOdysseyArrival(settled, { onlyPending: true })).toBeNull();
        const fresh = createMode({ state: { isFreshJourney: () => true, hasSeenArrival: () => false } });
        expect(await presentOdysseyArrival(fresh, { onlyPending: true })).toBeNull();
        expect(fresh.odysseyState.markArrivalSeen).not.toHaveBeenCalled();
        const elsewhere = createMode({ isInBoardView: false });
        expect(await presentOdysseyArrival(elsewhere, { onlyPending: true })).toBeNull();
        expect(document.body.children).toHaveLength(0);
        expect(pendingOdysseyChapterArrival(createMode({ state: { currentChapter: 0 } }))).toBeNull();
        expect(pendingOdysseyChapterArrival(null)).toBeNull();
    });

    it('welcomes a fresh journey with Chapter 1’s draft beside the orientation', async () => {
        const mode = createMode({
            state: {
                isFreshJourney: () => true,
                hasSeenArrival: () => false,
                currentChapter: 1,
                currentLevel: 1,
                getChapterCharmDraft: vi.fn((chapterId) => (
                    chapterId === 1 ? { key: 'chapter:1', charms: offer().charms } : null
                )),
            },
        });
        const { run, modal } = await open(mode);
        expect(markup(modal)).toContain('Chapter 1 · A new horizon');
        expect(markup(modal)).toContain('offers a charm to keep');
        expect(byClass(modal, 'ody-charm')).toHaveLength(3);
        expect(mode.odysseyState.markArrivalSeen).toHaveBeenCalledOnce();
        action(modal, 'next').dispatch('click');
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        byClass(modal, 'ody-charm')[1].dispatch('click');
        expect(mode.odysseyState.takeCharm)
            .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'chapter:1' }), 'kindle');
        action(modal, 'next').dispatch('click');
        expect(await run).toBe('next');
        expect(mode.launchOdysseyLevel).toHaveBeenCalledExactlyOnceWith(1, { source: 'first-arrival' });
    });

    it('is offered by the world return once the map is back, never under a journey flow', async () => {
        const settings = {};
        const transition = {
            play: vi.fn(async ({ callbacks }) => {
                await callbacks.onComplete();
                return { success: true };
            }),
        };
        const mode = {
            currentLevelId: 5,
            currentLevelConfig: { id: 5 },
            themeRevealToken: 0,
            deps: { settingsManager: { get: () => settings } },
            journeyReturnTransition: transition,
            _perfMark: vi.fn(),
            _perfMeasure: vi.fn(),
            _resolveJourneyReturnDepartureAnchor: vi.fn(() => null),
            _buildJourneyEntryPalette: vi.fn(() => ({})),
            _buildJourneyReturnTimings: vi.fn(() => ({})),
            _retireLevelSession: vi.fn(() => null),
            _clearNeutralThemeFallbackBackdrop: vi.fn(),
            _clearLevelThemePrefetchTimer: vi.fn(),
            _clearGameplayRevealState: vi.fn(),
            _clearLevelStartCue: vi.fn(),
            _clearBoardReturnFallbackVeil: vi.fn(),
            _restoreInputs: vi.fn(),
            _offerPendingArrival: vi.fn(),
        };
        expect(await returnToOdysseyWorld(mode, {})).toBe(true);
        expect(mode._restoreInputs).toHaveBeenCalledOnce();
        expect(mode._offerPendingArrival).toHaveBeenCalledOnce();
        const operation = {};
        mode._journeyFlowOperation = operation;
        expect(await returnToOdysseyWorld(mode, { preserveJourneyFlow: operation })).toBe(true);
        expect(mode._offerPendingArrival).toHaveBeenCalledOnce();
    });
});

describe('Odyssey charms on the map and the results sheet', () => {
    const PANEL_IDS = [
        'level-panel-kind', 'level-panel-number', 'level-panel-name', 'level-panel-chapter',
        'level-panel-description', 'level-panel-stars', 'level-panel-goal', 'level-panel-star-goals-label',
        'level-panel-star-goals', 'level-panel-rules-label', 'level-panel-rules', 'level-panel-tip',
        'level-panel-lock', 'level-panel-play-btn', 'level-panel-charms', 'level-panel-charm-list',
        'level-panel-charm-hint',
    ];
    function createNode(tagName = 'div') {
        const listeners = new Map();
        return {
            tagName,
            addEventListener(type, listener) { listeners.set(type, listener); },
            dispatch(type) { listeners.get(type)?.(); },
            textContent: '',
            className: '',
            hidden: false,
            disabled: false,
            children: [],
            dataset: {},
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = String(value); },
            appendChild(child) { this.children.push(child); return child; },
            replaceChildren(...children) { this.children = children; },
        };
    }
    function createPanelDocument() {
        const map = new Map(PANEL_IDS.map((id) => [id, createNode(id.endsWith('btn') ? 'button' : 'div')]));
        return {
            nodes: map,
            getElementById: (id) => map.get(id) || null,
            createElement: (tagName) => createNode(tagName),
        };
    }
    const texts = (node) => node.children.map((child) => child.textContent);
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps keyboard focus on the charm the player toggled when the bag redraws', () => {
        // Audit 2026-10-18: the rebuild destroyed the focused chip and focus fell to the page.
        const doc = createPanelDocument();
        const create = doc.createElement;
        doc.createElement = (tagName) => Object.assign(create(tagName), { focus: vi.fn() });
        const list = doc.nodes.get('level-panel-charm-list');
        list.contains = (node) => list.children.includes(node);
        const level = getLevelById(2);
        const render = (carried) => renderOdysseyLevelPanel({
            level, unlocked: true, charms: { gathered: ['keel', 'swell'], carried },
        }, doc);
        render([]);
        doc.activeElement = list.children[1]; // Swell, toggled from the keyboard
        render(['swell']);
        expect(list.children[1].dataset.charm).toBe('swell');
        expect(list.children[1].focus).toHaveBeenCalledOnce();
        expect(list.children[0].focus).not.toHaveBeenCalled();
    });

    it('briefs the orb as the carried charms make it, with the bag as carry toggles above the goal', () => {
        const doc = createPanelDocument();
        const level = getLevelById(2);
        const onToggle = vi.fn();
        const bag = { gathered: ['keel', 'swell', 'kindle'], carried: ['keel', 'swell'], onToggle };
        renderOdysseyLevelPanel({
            level, previousLevel: getLevelById(1), unlocked: true, chapterName: 'Earth Core', charms: bag,
        }, doc);
        const played = applyOdysseyCharmsToLevel(level, bag.carried);
        expect(played.victory.primary.target).toBeLessThan(level.victory.primary.target);
        expect(doc.nodes.get('level-panel-goal').textContent).toBe(formatOdysseyMapObjective(played.victory.primary));
        const starGoals = texts(doc.nodes.get('level-panel-star-goals'));
        // The first star reads 'Clear the orb' either way; the second names the eased cascade count.
        expect(starGoals[1]).toBe(`2 ★ ${formatOdysseyStarCondition(played.stars.two, 1)}`);
        expect(starGoals[1]).not.toBe(`2 ★ ${formatOdysseyStarCondition(level.stars.two, 1)}`);
        expect(texts(doc.nodes.get('level-panel-rules')))
            .toEqual(getOdysseyLevelBriefing(played, applyOdysseyCharmsToLevel(getLevelById(1), bag.carried)).changes);
        expect(doc.nodes.get('level-panel-charms').hidden).toBe(false);
        const chips = doc.nodes.get('level-panel-charm-list').children;
        expect(chips.map((chip) => chip.textContent)).toEqual(['◆ Keel', '◆ Swell', '◇ Kindle']);
        expect(chips.map((chip) => chip.attributes['aria-pressed'])).toEqual(['true', 'true', 'false']);
        expect(chips.map((chip) => chip.dataset.charm)).toEqual(['keel', 'swell', 'kindle']);
        expect(chips[2].title).toContain('tap to carry it');
        chips[2].dispatch('click');
        expect(onToggle).toHaveBeenCalledExactlyOnceWith('kindle');
        expect(doc.nodes.get('level-panel-charm-hint').textContent)
            .toBe('Carrying 2 of 3. The goal and rules below count them.');

        // A charm in the bag that would ease this orb, left uncarried, is named with what it would do.
        const timed = createPanelDocument();
        renderOdysseyLevelPanel({
            level: getLevelById(15), unlocked: true, charms: { gathered: ['keel', 'long-breath'], carried: ['keel'] },
        }, timed);
        expect(timed.nodes.get('level-panel-charm-hint').textContent)
            .toBe('Not carried here: Long Breath (30 more seconds on the clock).');
        // A notice from the last toggle outranks the rest, once.
        const crowded = createPanelDocument();
        renderOdysseyLevelPanel({
            level, unlocked: true, charms: { gathered: ['keel'], carried: [], notice: 'You carry 3. Set one down to carry another.' },
        }, crowded);
        expect(crowded.nodes.get('level-panel-charm-hint').textContent).toBe('You carry 3. Set one down to carry another.');
        expect(crowded.nodes.get('level-panel-charm-hint').dataset.notice).toBe('true');
        expect(crowded.nodes.get('level-panel-goal').textContent).toBe(formatOdysseyMapObjective(level.victory.primary));

        const bare = createPanelDocument();
        renderOdysseyLevelPanel({ level, previousLevel: getLevelById(1), unlocked: true }, bare);
        expect(bare.nodes.get('level-panel-goal').textContent).toBe(formatOdysseyMapObjective(level.victory.primary));
        expect(bare.nodes.get('level-panel-charms').hidden).toBe(true);
        const empty = createPanelDocument();
        renderOdysseyLevelPanel({ level, unlocked: true, charms: { gathered: [], carried: [] } }, empty);
        expect(empty.nodes.get('level-panel-charms').hidden).toBe(true);
    });

    it('carries the header’s charm line and the panel’s charm note in the board overlay', () => {
        vi.stubGlobal('document', { createElement: () => ({ innerHTML: '', querySelector: () => null }) });
        const { overlay } = createBoardInfoOverlay();
        expect(overlay.innerHTML).toContain('id="odyssey-header-charms"');
        expect(overlay.innerHTML).toContain('◇ No charms yet');
        expect(overlay.innerHTML).toContain('id="level-panel-charms"');
        expect(overlay.innerHTML).toContain('id="level-panel-charm-list"');
        expect(overlay.innerHTML).toContain('Charms · carry up to three');
        expect(overlay.innerHTML).not.toContain('gem');
    });

    it('lists the charms a completed orb was played with on the results sheet', () => {
        function element(tagName) {
            return {
                tagName,
                children: [],
                className: '',
                textContent: '',
                innerHTML: '',
                style: {},
                addEventListener: vi.fn(),
                matches: () => false,
                contains: () => false,
                appendChild(child) { this.children.push(child); return child; },
                remove: vi.fn(),
            };
        }
        vi.stubGlobal('document', {
            addEventListener: vi.fn(), createElement: vi.fn(element), removeEventListener: vi.fn(),
        });
        const build = (results) => createResultsModal({
            results,
            formatTime: (milliseconds) => `${milliseconds}ms`,
            levelConfig: getLevelById(1),
            levelId: 1,
            onClose: vi.fn(),
            totalStars: 3,
            includeLegacyResults: false,
        });
        const all = (root) => [root, ...root.children.flatMap(all)];
        const facts = (modal) => all(modal).filter((node) => node.className === 'sb-ody-fact')
            .map((fact) => fact.children.map((part) => part.textContent));
        const charmed = build({
            lines: 20, score: 4321, stars: 2, time: 90, charms: ['afterglow', 'bogus', 'hearth'],
        });
        expect(facts(charmed)).toContainEqual(['Charms', 'Afterglow · Hearth']);
        const plain = build({
            lines: 20, score: 4321, stars: 2, time: 90,
        });
        expect(facts(plain).map(([label]) => label)).toEqual(['Score', 'Lines', 'Time']);
    });
});
