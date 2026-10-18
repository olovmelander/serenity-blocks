import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    ODYSSEY_FIRST_ARRIVAL_NOTES, presentOdysseyFirstArrival, shouldOfferOdysseyFirstArrival,
} from '../../src/ui/odyssey/odyssey-first-arrival.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';

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
        focus() {},
    });
}
const nodes = (element) => [element, ...element.children.flatMap(nodes)];
const action = (modal, name) => nodes(modal).find((node) => node.dataset.flowAction === name);
const markup = (modal) => nodes(modal).map((node) => node.textContent).join(' ');

function createMode(overrides = {}) {
    return {
        isActive: true,
        isInBoardView: true,
        isEnteringLevel: false,
        _chapterFlowActive: false,
        _boardPresentationGeneration: 3,
        selectedLevelId: null,
        odysseyState: {
            isFreshJourney: () => true, hasSeenArrival: () => false, markArrivalSeen: vi.fn(),
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

async function openArrival(mode) {
    const run = presentOdysseyFirstArrival(mode);
    await Promise.resolve();
    return { run, modal: document.body.children[0] };
}

describe('Odyssey first arrival', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        const body = createElement('body');
        vi.stubGlobal('document', eventTarget({
            createElement, body, activeElement: null, hidden: false, hasFocus: () => true,
        }));
        vi.stubGlobal('window', eventTarget({ innerHeight: 900 }));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('is offered only to a journey with nothing played in it that has not been welcomed yet', () => {
        expect(shouldOfferOdysseyFirstArrival(createMode())).toBe(true);
        expect(shouldOfferOdysseyFirstArrival(createMode({
            odysseyState: { isFreshJourney: () => false, hasSeenArrival: () => false },
        }))).toBe(false);
        expect(shouldOfferOdysseyFirstArrival(createMode({
            odysseyState: { isFreshJourney: () => true, hasSeenArrival: () => true },
        }))).toBe(false);
        expect(shouldOfferOdysseyFirstArrival(null)).toBe(false);
    });

    it('welcomes with the Chapter 1 arrival and orientation, then launches Orb 1 on Begin chapter', async () => {
        const mode = createMode();
        const { run, modal } = await openArrival(mode);
        expect(modal).toBeDefined();
        expect(modal.dataset.layout).toBe('chapter');
        expect(modal.ariaLabel).toBe('A new chapter');
        const text = markup(modal);
        expect(text).toContain('Chapter 1 · A new horizon');
        expect(text).toContain(CHAPTER_CONFIGS[0].name);
        expect(text).toContain(`First · Orb 1 · ${getLevelById(1).name}`);
        ODYSSEY_FIRST_ARRIVAL_NOTES.forEach((note) => expect(text).toContain(note));
        expect(nodes(modal).find((node) => node.className === 'ody-flow__orientation').hidden).toBe(false);
        expect(action(modal, 'next').textContent).toBe('Begin chapter');
        expect(action(modal, 'pause').hidden).toBe(true);
        // The map is held while the welcome reads; the welcome is remembered at once.
        expect(mode.odysseyState.markArrivalSeen).toHaveBeenCalledOnce();
        expect(mode._chapterFlowActive).toBe(true);
        expect(mode._lockOdysseyBoardForLaunch).toHaveBeenCalledOnce();
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(true);
        expect(mode._updateLevelPreview).toHaveBeenLastCalledWith(null);

        action(modal, 'next').dispatch('click');
        expect(await run).toBe('next');
        expect(modal.isConnected).toBe(false);
        expect(mode._chapterFlowActive).toBe(false);
        expect(mode._setBoardOverlaySuppressed).toHaveBeenLastCalledWith(false);
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalledOnce();
        expect(mode.setOdysseyNavigatorButtonVisible).toHaveBeenLastCalledWith(true);
        expect(mode.selectedLevelId).toBe(1);
        expect(mode._updateLevelPreview).toHaveBeenLastCalledWith(1);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledExactlyOnceWith(1, { source: 'first-arrival' });
    });

    it('hands the map back with Orb 1 selected when the player chooses Map', async () => {
        const mode = createMode();
        const { run, modal } = await openArrival(mode);
        action(modal, 'map').dispatch('click');
        expect(await run).toBe('map');
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalledOnce();
        expect(mode._updateLevelPreview).toHaveBeenLastCalledWith(1);
        expect(mode._firstArrival).toBeNull();
    });

    it('leaves the board alone when the mode deactivates under the welcome', async () => {
        const mode = createMode();
        const { run, modal } = await openArrival(mode);
        mode.isActive = false;
        mode._firstArrival.cancel();
        expect(await run).toBeNull();
        expect(modal.isConnected).toBe(false);
        expect(mode._chapterFlowActive).toBe(false);
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).not.toHaveBeenCalled();
        expect(mode.launchOdysseyLevel).not.toHaveBeenCalled();
    });

    it('shows nothing for a journey already under way or a mode that is busy', async () => {
        const veteran = createMode({ odysseyState: { isFreshJourney: () => false, hasSeenArrival: () => false } });
        expect(await presentOdysseyFirstArrival(veteran)).toBeNull();
        const busy = createMode({ isEnteringLevel: true });
        expect(await presentOdysseyFirstArrival(busy)).toBeNull();
        expect(busy.odysseyState.markArrivalSeen).not.toHaveBeenCalled();
        expect(document.body.children).toHaveLength(0);
    });
});
