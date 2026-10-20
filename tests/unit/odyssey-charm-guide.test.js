import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    ODYSSEY_CHARM_GUIDE_ID, ODYSSEY_CHARM_GUIDE_RULES, createOdysseyCharmGuide, createOdysseyCharmGuideSheet,
    describeOdysseyCharmGuide,
} from '../../src/ui/odyssey/odyssey-charm-guide.js';
import { renderOdysseyCharmHeader } from '../../src/ui/odyssey/odyssey-charm-copy.js';
import { getOpenSheet } from '../../src/ui/sheet-input.js';
import { odysseyCharmBagEntries } from '../../src/core/odyssey/odyssey-charm-bag.js';

describe('Odyssey charm guide: what it says', () => {
    it('names all four charms in key order, the ones held with their count and the rest as missing', () => {
        const guide = describeOdysseyCharmGuide({ counts: { tide: 2, hearth: 1 } });
        expect(guide.charms.map((charm) => [charm.name, charm.key, charm.held, charm.status])).toEqual([
            ['Tide', '1', true, '2 of 3'],
            ['Still Air', '2', false, 'None in your bag'],
            ['Long Breath', '3', false, 'None in your bag'],
            ['Hearth', '4', true, '1 of 3'],
        ]);
        expect(guide.charms[0].rule).toBe('Clears the bottom 4 rows. Once an attempt.');
        expect(guide.charms[2].when).toBe('Only on orbs with a clock.');
        guide.charms.forEach((charm) => expect(charm.when).not.toBe(''));
        expect(guide.total).toBe(3);
    });

    it('caps counts at three, drops unknown charms and garbage, and counts the bag in its lede', () => {
        const guide = describeOdysseyCharmGuide({
            counts: {
                tide: 9, 'still-air': -2, 'long-breath': 'x', bogus: 3,
            },
            stats: { found: 7, used: 2 },
        });
        expect(guide.charms.map((charm) => charm.count)).toEqual([3, 0, 0, 0]);
        expect(guide.lede).toBe('You carry 3 charms. Found 7 this journey, used 2.');
        expect(describeOdysseyCharmGuide({ counts: { hearth: 1 } }).lede).toBe('You carry 1 charm.');
    });

    it('says how to find a first charm while the bag is empty, or the tally once some were found', () => {
        expect(describeOdysseyCharmGuide().lede).toBe('Your bag is empty. Clearing an orb leaves you a charm.');
        expect(describeOdysseyCharmGuide({ counts: {}, stats: { found: 3, used: 3 } }).lede)
            .toBe('Your bag is empty. Found 3 this journey, used 3.');
    });

    it('explains finding, using, the cap, the road’s mercy and the stars in plain words', () => {
        const rules = ODYSSEY_CHARM_GUIDE_RULES.join(' ');
        expect(rules).toMatch(/three-star clear leaves two/);
        expect(rules).toMatch(/once an attempt/);
        expect(rules).toMatch(/hold three of each/);
        expect(rules).toMatch(/After three falls in a row/);
        expect(rules).toMatch(/never costs stars/);
        expect(rules).not.toMatch(/carry|draft|slot|gem/i);
    });
});

// ---- A light DOM: elements with children, attributes, datasets and listeners ----
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
            const event = { target: this, preventDefault: vi.fn(), ...detail };
            listeners.get(type)?.forEach((listener) => listener(event));
            return event;
        },
    };
}
function createElement(tagName) {
    return eventTarget({
        tagName,
        children: [],
        attributes: {},
        dataset: {},
        textContent: '',
        className: '',
        isConnected: true,
        appendChild(child) { this.children.push(child); return child; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        remove() { this.isConnected = false; },
    });
}
const nodes = (element) => [element, ...element.children.flatMap(nodes)];
const byClass = (root, className) => nodes(root).filter((node) => node.className === className);
const textOf = (element) => nodes(element).map((node) => node.textContent).join(' ');

describe('Odyssey charm guide: the sheet', () => {
    let body;
    beforeEach(() => {
        body = createElement('body');
        vi.stubGlobal('document', eventTarget({
            createElement, body, getElementById: () => null, hidden: false, hasFocus: () => true,
        }));
        vi.stubGlobal('window', eventTarget({ dispatchEvent: vi.fn() }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('lists every charm, held or not, with how charms work and a way back to the map', () => {
        const modal = createOdysseyCharmGuideSheet({ counts: { 'long-breath': 3 } });
        expect(modal.id).toBe(ODYSSEY_CHARM_GUIDE_ID);
        expect(modal.ariaLabel).toBe('Charms');
        const rows = byClass(modal, 'sb-ody-charm-guide__charm');
        expect(rows.map((row) => [row.dataset.charm, row.dataset.held])).toEqual([
            ['tide', 'false'], ['still-air', 'false'], ['long-breath', 'true'], ['hearth', 'false'],
        ]);
        expect(byClass(rows[2], 'is-held')).toHaveLength(3);
        expect(textOf(rows[2])).toContain('3 of 3');
        expect(textOf(rows[0])).toContain('None in your bag');
        expect(textOf(modal)).toContain('How charms work');
        const back = byClass(modal, 'sb-btn sb-btn--primary')[0];
        expect(back.attributes['data-charm-guide-action']).toBe('close');
        expect(back.type).toBe('button');
    });

    it('closes from its button or a click on the scrim, never from a click inside the sheet', () => {
        const onClose = vi.fn();
        const modal = createOdysseyCharmGuideSheet({ onClose });
        modal.dispatch('click', { target: modal.children[0] });
        expect(onClose).not.toHaveBeenCalled();
        modal.dispatch('click', { target: modal });
        expect(onClose).toHaveBeenCalledOnce();
        byClass(modal, 'sb-btn sb-btn--primary')[0].dispatch('click');
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('opens over the map with the bag as it stands, and only while the map is the thing on screen', () => {
        const mode = {
            isActive: true,
            isInBoardView: true,
            odysseyState: {
                getCharmCounts: () => ({ tide: 1 }),
                getCharmStats: () => ({ found: 1, used: 0 }),
            },
            _isOdysseyNavigatorOpen: () => false,
        };
        const guide = createOdysseyCharmGuide(mode);
        expect(guide.isOpen()).toBe(false);
        expect(guide.open()).toBe(true);
        expect(body.children).toHaveLength(1);
        const [modal] = body.children;
        expect(textOf(modal)).toContain('You carry 1 charm. Found 1 this journey, used 0.');
        expect(window.dispatchEvent).toHaveBeenCalledOnce();
        expect(window.dispatchEvent.mock.calls[0][0].type).toBe('modalShown');
        expect(window.dispatchEvent.mock.calls[0][0].detail).toEqual({ modalName: 'odysseyCharms' });
        expect(guide.open()).toBe(true);
        expect(body.children).toHaveLength(1);

        byClass(modal, 'sb-btn sb-btn--primary')[0].dispatch('click');
        expect(modal.isConnected).toBe(false);
        expect(guide.isOpen()).toBe(false);
        expect(window.dispatchEvent.mock.calls[1][0].type).toBe('modalHidden');
        expect(guide.close()).toBe(false);

        mode._isOdysseyNavigatorOpen = () => true;
        expect(guide.open()).toBe(false);
        mode._isOdysseyNavigatorOpen = () => false;
        mode.isEnteringLevel = true;
        expect(guide.open()).toBe(false);
        expect(body.children).toHaveLength(1);
    });

    it('is a sheet the keyboard and pad know: Escape and B find its way back', () => {
        const element = {
            isConnected: true,
            inert: false,
            checkVisibility: () => true,
            querySelector: vi.fn(),
        };
        const doc = { getElementById: (id) => (id === ODYSSEY_CHARM_GUIDE_ID ? element : null) };
        const open = getOpenSheet(doc);
        expect(open.name).toBe('odysseyCharms');
        expect(open.sheet.odyssey).toBe(true);
        expect(open.sheet.backSelector).toBe('[data-charm-guide-action="close"]');
    });
});

describe('Odyssey map header: the charm chip says the bag in words', () => {
    it('names each charm held, or none yet, for screen readers', () => {
        const attributes = {};
        const node = {
            title: '', textContent: '', setAttribute: (name, value) => { attributes[name] = value; },
        };
        const entries = odysseyCharmBagEntries({
            bag: {
                tide: 2, 'still-air': 0, 'long-breath': 0, hearth: 1,
            },
        });
        vi.stubGlobal('document', undefined);
        renderOdysseyCharmHeader(entries, node);
        expect(attributes['aria-label']).toBe('Charms: 2 Tide, 1 Hearth');
        renderOdysseyCharmHeader([], node);
        expect(attributes['aria-label']).toBe('Charms: none yet');
        vi.unstubAllGlobals();
    });
});
