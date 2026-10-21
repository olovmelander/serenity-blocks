import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createJourneyFlowOverlay } from '../../src/ui/odyssey/JourneyFlowOverlay.js';
import { createFailureModal } from '../../src/ui/odyssey/FailureModal.js';
import { createResultsModal } from '../../src/ui/odyssey/ResultsModal.js';
import { renderOdysseyLevelPanel } from '../../src/ui/odyssey/odyssey-level-panel.js';
import { createBoardInfoOverlay } from '../../src/ui/odyssey/BoardInfoOverlay.js';
import { ODYSSEY_FIRST_ARRIVAL_NOTES } from '../../src/ui/odyssey/odyssey-first-arrival.js';
import {
    ODYSSEY_CHARM_ARRIVAL_NOTE, describeOdysseyCharmHeader, describeOdysseyCharmPity, describeOdysseyCharmsFound,
    describeOdysseyPanelCharms, renderOdysseyCharmHeader,
} from '../../src/ui/odyssey/odyssey-charm-copy.js';
import { odysseyCharmBagEntries } from '../../src/core/odyssey/odyssey-charm-bag.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';

const bag = (counts) => odysseyCharmBagEntries({
    bag: {
        tide: 0, 'still-air': 0, 'long-breath': 0, hearth: 0, ...counts,
    },
});

describe('Odyssey charm copy: the words the sheets and the map use', () => {
    it('counts the bag in the map header and names every charm held in the tooltip', () => {
        expect(describeOdysseyCharmHeader([])).toEqual({
            text: '◇ No charms yet',
            title: 'Clearing an orb leaves you a charm. Press 1–4 during an orb to use one.',
        });
        expect(describeOdysseyCharmHeader(bag({ tide: 1 })).text).toBe('◆ 1 charm');
        const five = describeOdysseyCharmHeader(bag({ tide: 2, hearth: 3 }));
        expect(five.text).toBe('◆ 5 charms');
        expect(five.title.split('\n')).toEqual([
            'Tide ×2 · clears the bottom 4 rows. Once an attempt.',
            'Hearth ×3 · arm it, and your next top-out clears the well instead of ending the orb.',
        ]);
        const node = { textContent: '', title: '' };
        renderOdysseyCharmHeader(bag({ 'still-air': 1 }), node);
        expect(node).toEqual({ textContent: '◆ 1 charm', title: 'Still Air ×1 · slows the fall for 20 seconds.' });
        expect(() => renderOdysseyCharmHeader([], null)).not.toThrow();
    });

    it('says what a clear left, and the first time, how to use it', () => {
        expect(describeOdysseyCharmsFound(null)).toBeNull();
        expect(describeOdysseyCharmsFound({ charmsFound: [] })).toBeNull();
        expect(describeOdysseyCharmsFound({ charmsFound: ['bogus'] })).toBeNull();
        expect(describeOdysseyCharmsFound({ charmsFound: ['tide'] })).toEqual({
            line: '◆ Found: Tide', text: 'Found: Tide', hint: null, ids: ['tide'], words: ['◆ Found: Tide'],
        });
        expect(describeOdysseyCharmsFound({ charmsFound: ['hearth', 'tide'], charmsFirstFound: true })).toEqual({
            line: '◆ Found: Hearth · Tide',
            text: 'Found: Hearth · Tide',
            hint: 'Press 4 during an orb to use it.',
            ids: ['hearth', 'tide'],
            words: ['◆ Found: Hearth · Tide', 'Press 4 during an orb to use it.'],
        });
    });

    it('says which charm the third fall left and the key that uses it, in plain words', () => {
        expect(describeOdysseyCharmPity('long-breath'))
            .toBe('◆ After three falls here, the road leaves you Long Breath. Press 3 for 30 more seconds.');
        expect(describeOdysseyCharmPity('hearth'))
            .toBe('◆ After three falls here, the road leaves you Hearth. Press 4 to arm it: your next top-out clears the well.');
        expect(describeOdysseyCharmPity('keel')).toBeNull();
        expect(describeOdysseyCharmPity(null)).toBeNull();
    });

    it('names the charms held that help on an orb for its panel, or nothing', () => {
        expect(describeOdysseyPanelCharms(bag({ tide: 2, 'long-breath': 1 }), getLevelById(15)))
            .toBe('Charms that help here: Tide ×2, Long Breath.');
        expect(describeOdysseyPanelCharms(bag({ tide: 2, 'long-breath': 1 }), getLevelById(1)))
            .toBe('Charms that help here: Tide ×2.');
        expect(describeOdysseyPanelCharms(bag({ 'long-breath': 3 }), getLevelById(1))).toBeNull();
        expect(describeOdysseyPanelCharms([], getLevelById(15))).toBeNull();
        expect(describeOdysseyPanelCharms(null, getLevelById(15))).toBeNull();
    });

    it('tells a new traveller how charms work on the first arrival, with nothing to carry or choose', () => {
        expect(ODYSSEY_FIRST_ARRIVAL_NOTES).toContain(ODYSSEY_CHARM_ARRIVAL_NOTE);
        expect(ODYSSEY_CHARM_ARRIVAL_NOTE)
            .toBe('Clearing an orb leaves you a charm. Press 1–4 during an orb to use one; it is spent when used.');
        ODYSSEY_FIRST_ARRIVAL_NOTES.forEach((note) => {
            expect(note).not.toMatch(/carry|draft|offers a charm/i);
        });
    });
});

// ---- A light DOM for the ceremony: elements with children, datasets, listeners and focus ----
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
const byClass = (root, className) => nodes(root).filter((node) => node.className === className);
const stubDocument = () => {
    const body = createElement('body');
    vi.stubGlobal('document', eventTarget({
        createElement, body, activeElement: null, hidden: false, hasFocus: () => true,
    }));
    vi.stubGlobal('window', eventTarget({ innerHeight: 900 }));
    return body;
};

describe('Odyssey charms on the ceremony', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        stubDocument();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    const completion = (results) => createJourneyFlowOverlay({
        variant: 'completion',
        level: getLevelById(1),
        nextLevel: getLevelById(2),
        chapter: CHAPTER_CONFIGS[0],
        results,
        autoContinue: true,
    });
    const base = {
        stars: 2, score: 1000, time: 60, lines: 20,
    };

    it('names what the clear left under the stars, says how to use the first charm, and waits to be read', () => {
        const plain = completion(base);
        expect(byClass(plain, 'ody-flow__found')).toHaveLength(0);
        const first = completion({
            ...base, stars: 3, charmsFound: ['tide', 'hearth'], charmsFirstFound: true,
        });
        const found = byClass(first, 'ody-flow__found')[0];
        expect(found.children.map((node) => node.className)).toEqual(['ody-flow__found-line', 'ody-flow__found-hint']);
        const [line, hint] = found.children;
        // One live icon per charm found (its glyph until the first frame), then the words without a glyph of their own.
        expect(line.children.map((node) => node.dataset.charm)).toEqual(['tide', 'hearth', undefined]);
        expect(line.children.map((node) => node.className)).toEqual(['charm-sprite', 'charm-sprite', '']);
        expect(line.children[0].children.map((node) => node.className)).toEqual(['charm-sprite__canvas', 'charm-sprite__glyph']);
        expect(line.children.map((node) => node.textContent)).toEqual(['', '', 'Found: Tide · Hearth']);
        expect(hint.textContent).toBe('Press 1 during an orb to use it.');
        expect(first.autoContinueMs).toBeGreaterThan(plain.autoContinueMs);
        const later = completion({ ...base, charmsFound: ['still-air'] });
        expect(byClass(later, 'ody-flow__found')[0].children[0].children.map((node) => node.textContent))
            .toEqual(['', 'Found: Still Air']);
        expect(later.autoContinueMs).toBeLessThan(first.autoContinueMs);
        // A chapter arrival carries no charm block and no pending choice.
        const arrival = createJourneyFlowOverlay({
            variant: 'chapter', nextLevel: getLevelById(1), chapter: CHAPTER_CONFIGS[0], orientation: ODYSSEY_FIRST_ARRIVAL_NOTES,
        });
        expect(nodes(arrival).map((node) => node.textContent).join(' ')).toContain(ODYSSEY_CHARM_ARRIVAL_NOTE);
        expect(byClass(arrival, 'ody-flow__charms')).toHaveLength(0);
        expect(arrival.dataset.charmPending).toBeUndefined();
    });
});

describe('Odyssey charms on the failure sheet, the results sheet, the map and its panel', () => {
    function element(tagName) {
        const listeners = new Map();
        return {
            tagName,
            children: [],
            className: '',
            dataset: {},
            textContent: '',
            innerHTML: '',
            hidden: false,
            style: {},
            remove: vi.fn(),
            matches: () => false,
            contains: () => false,
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

    it('shows the charm the third fall left as a gift card, with its key and nothing to choose', () => {
        const modal = createFailureModal({
            attemptNumber: 3, reasonText: 'You topped out!', onChoose: vi.fn(), charmPity: 'long-breath',
        });
        const note = all(modal).find((node) => node.className === 'sb-ody-note sb-ody-charm-pity');
        expect(note.role).toBe('status');
        // The card wears the charm's tone; its live icon (the glyph until the first frame) is the art.
        expect(note.dataset.charm).toBe('long-breath');
        const [art, copy] = note.children;
        expect(art.className).toBe('sb-ody-gift__art');
        expect(art.ariaHidden).toBe('true');
        expect(all(art).find((node) => node.className === 'charm-sprite').dataset.charm).toBe('long-breath');
        expect(copy.children.map((node) => text(node).replace(/\s+/g, ' ').trim())).toEqual([
            'After three falls here',
            'Long Breath',
            'The road leaves you this charm. Press 3 for 30 more seconds.',
        ]);
        expect(all(copy).find((node) => node.tagName === 'kbd').textContent).toBe('3');
        // It sits in the main column after the outcome (and the figures, when there are any).
        const main = all(modal).find((node) => node.children.includes(note));
        const lede = main.children.find((node) => node.className === 'sb-ody-lede');
        expect(main.children.indexOf(note)).toBe(main.children.indexOf(lede) + 1);
        expect(all(modal).filter((node) => node.tagName === 'button').map((node) => node.textContent))
            .toEqual(['Retry', 'Back to Map']);
        expect(text(modal)).not.toMatch(/Not now|offers a charm/);
        const plain = createFailureModal({ attemptNumber: 1, reasonText: 'You topped out!', onChoose: vi.fn() });
        expect(all(plain).some((node) => node.className.includes('sb-ody-charm'))).toBe(false);
        const unknown = createFailureModal({
            attemptNumber: 3, reasonText: 'You topped out!', onChoose: vi.fn(), charmPity: 'keel',
        });
        expect(all(unknown).some((node) => node.className.includes('sb-ody-charm'))).toBe(false);
    });

    it('lists the charms a clear used on the results sheet as a fact, not a warning', () => {
        const build = (results) => createResultsModal({
            results,
            formatTime: (milliseconds) => `${milliseconds}ms`,
            levelConfig: getLevelById(1),
            levelId: 1,
            onClose: vi.fn(),
            totalStars: 3,
            includeLegacyResults: false,
        });
        const facts = (modal) => all(modal).filter((node) => node.className === 'sb-ody-fact')
            .map((fact) => fact.children.map((part) => part.textContent));
        const charmed = build({
            lines: 20, score: 4321, stars: 3, time: 90, charms: ['tide', 'bogus', 'hearth'],
        });
        expect(facts(charmed)).toContainEqual(['Charms used', 'Tide · Hearth']);
        expect(text(charmed)).not.toMatch(/unaided|one star/i);
        const plain = build({
            lines: 20, score: 4321, stars: 2, time: 90, charms: [],
        });
        expect(facts(plain).map(([label]) => label)).toEqual(['Score', 'Lines', 'Time']);
    });

    it('carries the header count and a read-only charm line in the board overlay, with no toggles', () => {
        vi.stubGlobal('document', { createElement: () => ({ innerHTML: '', querySelector: () => null }) });
        const { overlay } = createBoardInfoOverlay();
        expect(overlay.innerHTML).toContain('id="odyssey-header-charms"');
        expect(overlay.innerHTML).toContain('◇ No charms yet');
        expect(overlay.innerHTML).toContain('Clearing an orb leaves you a charm');
        expect(overlay.innerHTML).toContain('id="level-panel-charm-hint"');
        expect(overlay.innerHTML).not.toContain('level-panel-charm-list');
        expect(overlay.innerHTML).not.toMatch(/carry|gem/i);
    });

    it('writes the panel’s charm line for the charms held that help here, and hides it otherwise', () => {
        const PANEL_IDS = [
            'level-panel-kind', 'level-panel-number', 'level-panel-name', 'level-panel-chapter',
            'level-panel-description', 'level-panel-stars', 'level-panel-goal', 'level-panel-star-goals-label',
            'level-panel-star-goals', 'level-panel-rules-label', 'level-panel-rules', 'level-panel-tip',
            'level-panel-lock', 'level-panel-play-btn', 'level-panel-charm-hint',
        ];
        const createNode = (tagName = 'div') => ({
            tagName,
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
        });
        const map = new Map(PANEL_IDS.map((id) => [id, createNode(id.endsWith('btn') ? 'button' : 'div')]));
        const doc = { getElementById: (id) => map.get(id) || null, createElement: (tagName) => createNode(tagName) };
        renderOdysseyLevelPanel({
            level: getLevelById(15), unlocked: true, chapterName: 'Surface World', charms: bag({ tide: 1, 'long-breath': 2 }),
        }, doc);
        const hint = map.get('level-panel-charm-hint');
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toBe('Charms that help here: Tide, Long Breath ×2.');
        // The goal is the authored goal: nothing eases it before the orb starts.
        expect(map.get('level-panel-goal').textContent).not.toContain('not');
        renderOdysseyLevelPanel({
            level: getLevelById(1), unlocked: true, charms: bag({ 'long-breath': 2 }),
        }, doc);
        expect(hint.hidden).toBe(true);
        expect(hint.textContent).toBe('');
        renderOdysseyLevelPanel({ level: getLevelById(1), unlocked: true }, doc);
        expect(hint.hidden).toBe(true);
    });
});
