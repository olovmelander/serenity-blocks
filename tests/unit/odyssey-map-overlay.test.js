import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    createBoardInfoOverlay, describeOdysseyMapJourney, renderOdysseyMapHeader, scheduleOdysseyMapHeader,
} from '../../src/ui/odyssey/BoardInfoOverlay.js';
import {
    describeOdysseyPanelOrbState, describeOdysseyPanelPlayLabel, renderOdysseyLevelPanel, resetOdysseyPanelPlay,
} from '../../src/ui/odyssey/odyssey-level-panel.js';
import { renderOdysseyCharmHeader } from '../../src/ui/odyssey/odyssey-charm-copy.js';
import { odysseyCharmBagEntries } from '../../src/core/odyssey/odyssey-charm-bag.js';
import { buildOdysseyNavigatorModel } from '../../src/ui/odyssey/odyssey-navigator-model.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

// ---- A light DOM: elements with children, attributes, datasets, classes and listeners ----
function createElement(tagName) {
    const classes = new Set();
    const element = {
        tagName,
        children: [],
        attributes: {},
        dataset: {},
        style: {},
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        offsetWidth: 0,
        scrollTop: 0,
        get className() { return [...classes].join(' '); },
        set className(value) {
            classes.clear();
            String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
        },
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
            toggle: (name, force = !classes.has(name)) => {
                if (force) classes.add(name);
                else classes.delete(name);
                return force;
            },
        },
        appendChild(child) { this.children.push(child); return child; },
        append(...children) { this.children.push(...children); },
        prepend(...children) { this.children.unshift(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        addEventListener: vi.fn(),
        querySelector: () => null,
    };
    return element;
}
const nodes = (element) => [element, ...(element.children || []).flatMap(nodes)];
const byClass = (root, className) => nodes(root)
    .filter((node) => String(node.className).split(' ').includes(className));

const PANEL_IDS = [
    'odyssey-level-panel', 'level-panel-art', 'level-panel-kind', 'level-panel-number', 'level-panel-name',
    'level-panel-chapter', 'level-panel-description', 'level-panel-stars', 'level-panel-charm-hint', 'level-panel-goal',
    'level-panel-star-goals-label', 'level-panel-star-goals', 'level-panel-rules-label', 'level-panel-rules',
    'level-panel-tip', 'level-panel-lock', 'level-panel-play-btn', 'odyssey-map-meter',
];
const HEADER_IDS = [
    'odyssey-map-header', 'odyssey-map-stars', 'odyssey-map-max-stars', 'odyssey-map-cleared', 'odyssey-map-total-orbs',
    'odyssey-map-chapter', 'odyssey-map-total-chapters', 'odyssey-map-meter',
];

function createDocument(ids) {
    const map = new Map(ids.map((id) => [id, createElement(id.endsWith('btn') ? 'button' : 'div')]));
    return {
        map,
        createElement,
        getElementById: (id) => map.get(id) || null,
    };
}

/** A journey with the first `cleared` orbs done (two stars each) and the next one open. */
function journeyMode(cleared) {
    const levelRegistry = new LevelRegistry();
    const odysseyState = {
        getProgressSummary: () => ({ currentLevel: cleared + 1, totalStars: cleared * 2, maxStars: 180 }),
        isLevelUnlocked: (id) => id <= cleared + 1,
        isLevelCompleted: (id) => id <= cleared,
        getLevelStars: (id) => (id <= cleared ? 2 : 0),
        getLevelCompletion: (id) => (id <= cleared ? { stars: 2 } : null),
    };
    return { odysseyState, levelRegistry };
}

const registry = new LevelRegistry();
const level = (id) => registry.resolveLevelPresentation(id);
const bossId = registry.getLevelsInChapter(3).map((entry) => entry.id).find((id) => level(id).chapterBoss);
const rivalId = registry.getLevelsInChapter(3).map((entry) => entry.id).find((id) => level(id).mechanics?.versus);

describe('Odyssey map overlay: the shell', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('docks the orb card with its art, a scrolling story and Play at the foot with the map’s keys', () => {
        vi.stubGlobal('document', { createElement: () => ({ innerHTML: '', querySelector: () => null }) });
        const { overlay } = createBoardInfoOverlay();
        const html = overlay.innerHTML;
        expect(html).toContain('id="level-panel-art"');
        expect(html.indexOf('class="level-panel__body"')).toBeLessThan(html.indexOf('id="level-panel-play-btn"'));
        expect(html.indexOf('id="level-panel-play-btn"')).toBeLessThan(html.indexOf('class="sb-hints level-nav-hint"'));
        // Every key has its controller button beside it.
        ['←', '→', '↑', '↓'].forEach((key) => expect(html).toContain(`<kbd class="sb-kbd" data-key>${key}</kbd>`));
        ['◀', '▶', '▲', '▼'].forEach((pad) => expect(html).toContain(`<kbd class="sb-kbd" data-pad>${pad}</kbd>`));
        // The header's figures and meter, with the mode's lines kept for it to write into.
        ['odyssey-map-stars', 'odyssey-map-cleared', 'odyssey-map-chapter', 'odyssey-map-meter',
            'odyssey-header-stars', 'odyssey-header-progress', 'odyssey-header-charms']
            .forEach((id) => expect(html).toContain(`id="${id}"`));
        expect(html).toContain('data-journey="pending"');
    });
});

describe('Odyssey map header: the journey in figures and cells', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('counts stars, orbs cleared and the chapter the journey is in, every orb a cell', () => {
        const journey = describeOdysseyMapJourney(buildOdysseyNavigatorModel(journeyMode(16)));
        expect(journey).toMatchObject({
            stars: 32, maxStars: 180, cleared: 16, totalOrbs: registry.getTotalLevels(), totalChapters: 8,
        });
        expect(journey.chapter).toBe(registry.resolveLevelPresentation(17).chapter);
        const cells = journey.chapters.flatMap((chapter) => chapter.cells);
        expect(cells).toHaveLength(registry.getTotalLevels());
        expect(cells.filter((state) => state === 'cleared')).toHaveLength(16);
        expect(cells[16]).toBe('next');
        expect(cells.slice(17).every((state) => state === 'locked')).toBe(true);
        expect(journey.chapters[0].state).toBe('complete');
    });

    it('draws the figures and the meter, then lets them stand in for the mode’s lines', () => {
        const doc = createDocument(HEADER_IDS);
        vi.stubGlobal('document', doc);
        const journey = renderOdysseyMapHeader(journeyMode(3), doc);
        const text = (id) => doc.map.get(id).textContent;
        expect([text('odyssey-map-stars'), text('odyssey-map-max-stars')]).toEqual(['6', '180']);
        expect([text('odyssey-map-cleared'), text('odyssey-map-total-orbs')]).toEqual(['3', String(journey.totalOrbs)]);
        expect([text('odyssey-map-chapter'), text('odyssey-map-total-chapters')]).toEqual(['1', '8']);
        const groups = doc.map.get('odyssey-map-meter').children;
        expect(groups).toHaveLength(8);
        expect(groups[0].dataset).toMatchObject({ odyChapter: '1', state: 'current' });
        expect(groups[0].children.map((cell) => cell.dataset.state))
            .toEqual(['cleared', 'cleared', 'cleared', 'next', 'locked']);
        expect(groups[1].dataset.state).toBe('locked');
        expect(doc.map.get('odyssey-map-header').dataset).toMatchObject({ journey: 'ready', odyChapter: '1' });
    });

    it('leaves the mode’s lines in place when the journey cannot be read', () => {
        const doc = createDocument(HEADER_IDS);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(renderOdysseyMapHeader({ odysseyState: {}, levelRegistry: {} }, doc)).toBeNull();
        expect(renderOdysseyMapHeader(null, doc)).toBeNull();
        expect(doc.map.get('odyssey-map-header').dataset.journey).toBeUndefined();
        warn.mockRestore();
        // A document whose nodes cannot hold children still gets its figures.
        const sparse = { getElementById: (id) => (id === 'odyssey-map-stars' ? { textContent: '' } : null) };
        expect(() => renderOdysseyMapHeader(journeyMode(0), sparse)).not.toThrow();
    });

    it('draws at most once a frame, from the latest journey asked for', () => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', undefined);
        const doc = createDocument(HEADER_IDS);
        vi.stubGlobal('document', doc);
        const early = journeyMode(1);
        const late = journeyMode(3);
        const earlyRead = vi.spyOn(early.odysseyState, 'isLevelUnlocked');
        scheduleOdysseyMapHeader(early, doc);
        scheduleOdysseyMapHeader(late, doc);
        expect(doc.map.get('odyssey-map-cleared').textContent).toBe('');
        vi.runAllTimers();
        expect(earlyRead).not.toHaveBeenCalled();
        expect(doc.map.get('odyssey-map-cleared').textContent).toBe('3');
        vi.useRealTimers();
    });
});

describe('Odyssey map header: the charm chip', () => {
    beforeEach(() => vi.stubGlobal('document', { createElement }));
    afterEach(() => vi.unstubAllGlobals());

    const bag = (counts) => odysseyCharmBagEntries({
        bag: {
            tide: 0, 'still-air': 0, 'long-breath': 0, hearth: 0, ...counts,
        },
    });

    it('names itself, then shows each charm held as its icon and count', () => {
        const chip = createElement('button');
        renderOdysseyCharmHeader(bag({ tide: 2, hearth: 1 }), chip);
        const [label, ...items] = chip.children;
        expect(label.className).toBe('odyssey-map-charms__label');
        expect(label.textContent).toBe('Charms');
        expect(items.map((item) => item.children[0].dataset.charm)).toEqual(['tide', 'hearth']);
        expect(items.map((item) => item.children[1].textContent)).toEqual(['×2', '×1']);
        expect(chip.dataset.empty).toBe('false');
        expect(chip.attributes['aria-label']).toBe('Charms: 2 Tide, 1 Hearth');
    });

    it('says an empty bag plainly', () => {
        const chip = createElement('button');
        renderOdysseyCharmHeader([], chip);
        expect(chip.children.map((part) => part.textContent)).toEqual(['Charms', 'None yet']);
        expect(chip.dataset.empty).toBe('true');
        expect(chip.attributes['aria-label']).toBe('Charms: none yet');
        expect(chip.title).toContain('Clearing an orb leaves you a charm');
    });
});

describe('Odyssey map orb panel: the navigator’s card, docked', () => {
    let doc;
    beforeEach(() => {
        doc = createDocument(PANEL_IDS);
        vi.stubGlobal('document', doc);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('names the orb’s state the navigator’s way', () => {
        expect(describeOdysseyPanelOrbState({ completion: { stars: 1 }, unlocked: true })).toBe('cleared');
        expect(describeOdysseyPanelOrbState({ unlocked: true })).toBe('next');
        expect(describeOdysseyPanelOrbState({ unlocked: false })).toBe('locked');
        expect(describeOdysseyPanelOrbState()).toBe('locked');
    });

    it('shows a cleared orb’s world in its chapter’s light, its stars lit and its star goals marked', () => {
        renderOdysseyLevelPanel({
            level: level(8), completion: { stars: 2 }, unlocked: true, chapterName: 'Deep Ocean',
        }, doc);
        const panel = doc.map.get('odyssey-level-panel');
        expect(panel.dataset).toMatchObject({ odyChapter: String(level(8).chapter), state: 'cleared', levelId: '8' });
        expect(panel.classList.contains('is-entering')).toBe(true);
        const [art] = doc.map.get('level-panel-art').children;
        expect(art.className).toBe('sb-orb-art level-panel__orb');
        expect(art.dataset).toMatchObject({ state: 'cleared', odyChapter: String(level(8).chapter) });
        expect(byClass(art, 'sb-orb-art__image')[0].src).toBeTruthy();
        expect(byClass(art, 'sb-orb-art__number')[0].textContent).toBe('8');
        const [row] = doc.map.get('level-panel-stars').children;
        expect(row.className).toBe('sb-star-row level-panel__star-row');
        expect(row.children.map((star) => star.className)).toEqual(['is-earned', 'is-earned', '']);
        expect(doc.map.get('level-panel-stars').attributes['aria-label']).toBe('2 of 3 stars earned');
        const goals = doc.map.get('level-panel-star-goals').children;
        expect(goals.map((goal) => goal.className)).toEqual(['is-earned', 'is-earned', '']);
        expect(goals.map((goal) => goal.children[0].children.length)).toEqual([1, 2, 3]);
        expect(goals[2].children[0].attributes['aria-label']).toBe('3 stars');
        expect(goals[0].children[1].textContent).toBeTruthy();
        expect(doc.map.get('level-panel-play-btn').textContent).toBe('Play again');
    });

    it('crowns the chapter boss, marks the rival and shuts a locked orb', () => {
        renderOdysseyLevelPanel({ level: level(bossId), unlocked: true }, doc);
        let [art] = doc.map.get('level-panel-art').children;
        expect(doc.map.get('odyssey-level-panel').dataset).toMatchObject({ state: 'next', kind: 'boss' });
        expect(byClass(art, 'sb-orb-art__badge--boss')).toHaveLength(1);

        renderOdysseyLevelPanel({ level: level(rivalId), unlocked: true }, doc);
        [art] = doc.map.get('level-panel-art').children;
        expect(byClass(art, 'sb-orb-art__badge--rival')[0].textContent).toBe('VS');
        expect(doc.map.get('level-panel-kind').dataset.kind).toBe('rival');

        renderOdysseyLevelPanel({ level: level(rivalId + 1), unlocked: false }, doc);
        [art] = doc.map.get('level-panel-art').children;
        expect(art.dataset.state).toBe('locked');
        expect(byClass(art, 'sb-orb-art__lock')).toHaveLength(1);
        expect(doc.map.get('level-panel-play-btn')).toMatchObject({ disabled: true, textContent: 'Locked' });
    });

    it('keeps the art of an orb drawn again, and lights its chapter on the header’s meter', () => {
        const meter = doc.map.get('odyssey-map-meter');
        meter.children = [1, 2, 3].map((id) => {
            const group = createElement('span');
            group.dataset.odyChapter = String(id);
            return group;
        });
        renderOdysseyLevelPanel({ level: level(12), unlocked: true }, doc);
        const [first] = doc.map.get('level-panel-art').children;
        const panel = doc.map.get('odyssey-level-panel');
        panel.classList.remove('is-entering');
        renderOdysseyLevelPanel({ level: level(12), unlocked: true }, doc);
        expect(doc.map.get('level-panel-art').children[0]).toBe(first);
        // The same orb again does not replay the entrance.
        expect(panel.classList.contains('is-entering')).toBe(false);
        expect(meter.children.map((group) => group.classList.contains('is-selected')))
            .toEqual([1, 2, 3].map((id) => id === level(12).chapter));
    });
});

describe('Odyssey map orb panel: Play after a launch that did not start', () => {
    const playButton = (text) => {
        const classes = new Set(['level-play-btn', 'clicked']);
        const classList = { remove: (name) => classes.delete(name), has: (name) => classes.has(name) };
        return { textContent: text, classList };
    };

    it('says Play, Play again or Locked for the orb', () => {
        expect(describeOdysseyPanelPlayLabel({ unlocked: false })).toBe('Locked');
        expect(describeOdysseyPanelPlayLabel({ completion: { stars: 1 } })).toBe('Play again');
        expect(describeOdysseyPanelPlayLabel()).toBe('Play');
    });

    it('lets go of the press and gives a cleared orb its Play again back', () => {
        const button = playButton('Setting out');
        const doc = { getElementById: (id) => (id === 'level-panel-play-btn' ? button : null) };
        resetOdysseyPanelPlay(doc, 4, { getLevelCompletion: (id) => (id === 4 ? { stars: 2 } : null) });
        expect(button.textContent).toBe('Play again');
        expect(button.classList.has('clicked')).toBe(false);
        resetOdysseyPanelPlay(doc, 5, { getLevelCompletion: () => null });
        expect(button.textContent).toBe('Play');
        button.textContent = 'Setting out';
        resetOdysseyPanelPlay(doc, null, {});
        expect(button.textContent).toBe('Setting out');
        expect(() => resetOdysseyPanelPlay({ getElementById: () => null }, 4, {})).not.toThrow();
    });
});
