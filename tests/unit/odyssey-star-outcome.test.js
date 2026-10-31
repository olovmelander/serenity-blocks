import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LEVEL_CONFIGS, getLevelById } from '../../src/core/odyssey/data/levels.js';
import {
    describeOdysseyStarOutcome, formatOdysseyBonusObjective, formatOdysseyNextStar, formatOdysseyStarCondition,
} from '../../src/ui/odyssey/objective-copy.js';
import { createOdysseyStarNotes } from '../../src/ui/odyssey/odyssey-star-notes.js';
import { describeOdysseyOrbKind, renderOdysseyLevelPanel } from '../../src/ui/odyssey/odyssey-level-panel.js';
import { getOdysseyLevelBriefing } from '../../src/ui/odyssey/odyssey-level-briefing.js';

const PANEL_IDS = [
    'level-panel-kind', 'level-panel-number', 'level-panel-name', 'level-panel-chapter',
    'level-panel-description', 'level-panel-stars', 'level-panel-goal', 'level-panel-star-goals-label',
    'level-panel-star-goals', 'level-panel-rules-label', 'level-panel-rules', 'level-panel-tip',
    'level-panel-lock', 'level-panel-play-btn',
];

function createNode(tagName = 'div', { withDataset = true } = {}) {
    const node = {
        tagName,
        textContent: '',
        className: '',
        hidden: false,
        disabled: false,
        children: [],
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...children) { this.children = children; },
    };
    if (withDataset) node.dataset = {};
    return node;
}

function createPanelDocument() {
    const nodes = new Map(PANEL_IDS.map((id) => [id, createNode(id.endsWith('btn') ? 'button' : 'div')]));
    return {
        nodes,
        getElementById: (id) => nodes.get(id) || null,
        createElement: (tagName) => createNode(tagName),
    };
}

const texts = (node) => node.children.map((child) => child.textContent);
// A star goal is its tier's stars (here "2 ★", with no document to draw them) and its words.
const goalTexts = (node) => node.children.map((item) => item.children.map((part) => part.textContent).join(' '));

describe('Odyssey star outcome: why an attempt earned the stars it did', () => {
    it('marks earned tiers from the engine count and names the next star’s shortfall in the player’s numbers', () => {
        const outcome = describeOdysseyStarOutcome(getLevelById(1), {
            stars: 2, lines: 23, time: 148, bonuses: [false],
        });
        expect(outcome.stars).toBe(2);
        expect(outcome.tiers.map((tier) => tier.earned)).toEqual([true, true, false]);
        expect(outcome.tiers.map((tier) => tier.label)).toEqual([
            'Clear the orb', '20 lines + Under 2:30', '20 lines + Under 2 min + No single-line clears',
        ]);
        expect(outcome.next.tier).toBe('three');
        // A named bonus says what it needs, so it carries no "you:" count.
        expect(outcome.next.missed.map((part) => [part.key, part.actual])).toEqual([
            ['time', '2:28'], ['bonuses', ''],
        ]);
        expect(formatOdysseyNextStar(outcome)).toBe('Next star: Under 2 min (you: 2:28) · No single-line clears');
    });

    it('says so when every star is earned, and never invents a shortfall from numbers it was not given', () => {
        expect(formatOdysseyNextStar(describeOdysseyStarOutcome(getLevelById(1), { stars: 3 })))
            .toBe('All three stars earned.');
        const partial = describeOdysseyStarOutcome(getLevelById(1), { stars: 1 });
        expect(partial.next.tier).toBe('two');
        expect(partial.next.missed).toEqual([]);
        expect(partial.next.parts.map((part) => part.met)).toEqual([null, null]);
        expect(formatOdysseyNextStar(partial)).toBe('Next star: 20 lines + Under 2:30.');
        expect(formatOdysseyNextStar(describeOdysseyStarOutcome({ stars: {} }, { stars: 1 }))).toBeNull();
        expect(formatOdysseyNextStar(null)).toBeNull();
    });

    it('reads a chain requirement once, whichever keys spell it, against the deepest chain reached', () => {
        const level = {
            stars: {
                one: { cascades: 3 },
                two: { cascades: 3, maxCascadeDepth: 2 },
                three: { cascades: 3, combo: 6, maxCascadeDepth: 6 },
            },
        };
        const outcome = describeOdysseyStarOutcome(level, {
            stars: 2, cascades: 5, maxCascadeDepth: 4, combo: 3,
        });
        expect(outcome.tiers[2].parts.map((part) => part.label)).toEqual(['3+ cascades', '6-wave chain']);
        expect(formatOdysseyNextStar(outcome)).toBe('Next star: 6-wave chain (you: 4-wave chain)');
    });

    it('explains duel stars through knockouts and top-outs from the duel result', () => {
        const outcome = describeOdysseyStarOutcome(getLevelById(5), {
            stars: 2, duel: { playerFrags: 3, botFrags: 1, deaths: 1 },
        });
        expect(outcome.tiers.map((tier) => tier.label)).toEqual([
            'Win the match', 'Win the match + At most 1 top-out', 'Win the match + No top-outs',
        ]);
        expect(formatOdysseyNextStar(outcome)).toBe('Next star: No top-outs (you: 1 top-out)');
    });

    it('phrases a mastery orb’s next step in its own units', () => {
        const outcome = describeOdysseyStarOutcome(getLevelById(49), {
            stars: 1, score: 40000, tetrises: 6, maxCascadeDepth: 2,
        });
        expect(formatOdysseyNextStar(outcome)).toBe('Next star: 8+ Quads (you: 6 Quads)');
    });

    it('describes every campaign tier with a readable label and no duplicated requirement', () => {
        for (const level of LEVEL_CONFIGS) {
            const outcome = describeOdysseyStarOutcome(level, { stars: 0 });
            expect(outcome.tiers, level.id).toHaveLength(3);
            for (const tier of outcome.tiers) {
                expect(tier.label, `${level.id}:${tier.tier}`).not.toMatch(/^\.\.\.$|undefined|NaN/);
                expect(tier.label).toBe(formatOdysseyStarCondition(
                    level.stars[tier.tier],
                    tier.index,
                    level.victory?.bonuses,
                ));
                // A star that asks for a bonus names it (audit 2026-10-18).
                expect(tier.label, `${level.id}:${tier.tier}`).not.toMatch(/Get bonus/);
                const labels = tier.parts.map((part) => part.label);
                expect(new Set(labels).size, `${level.id}:${tier.tier}`).toBe(labels.length);
                expect(labels.every(Boolean)).toBe(true);
            }
        }
    });
});

describe('Odyssey bonus goals and the stars that ask for them', () => {
    it('names each bonus goal from its own numbers, the same way on every orb', () => {
        expect(formatOdysseyBonusObjective({ type: 'tetris-count', target: 1, description: 'stale' })).toBe('Clear 1 Quad');
        expect(formatOdysseyBonusObjective({ type: 'tetris-count', target: 6 })).toBe('Clear 6 Quads');
        expect(formatOdysseyBonusObjective({ type: 'cascade', target: 8 })).toBe('Trigger 8 cascades');
        expect(formatOdysseyBonusObjective({ type: 'no-singles', description: 'Clear no single lines' }))
            .toBe('No single-line clears');
        expect(formatOdysseyBonusObjective({ type: 'time', target: 45 })).toBe('Finish in under 45 seconds');
        expect(formatOdysseyBonusObjective({ type: 'time', target: 60 })).toBe('Finish in under 1 minute');
        expect(formatOdysseyBonusObjective({ type: 'time', target: 90 })).toBe('Finish in under 1:30');
        expect(formatOdysseyBonusObjective({ type: 'time', target: 120 })).toBe('Finish in under 2 minutes');
        expect(formatOdysseyBonusObjective({ type: 'max-cascade-depth', target: 4 }))
            .toBe('Trigger a chain of at least 4 waves');
        expect(formatOdysseyBonusObjective({ type: 'no-top-out' })).toBe('Never top out');
        expect(formatOdysseyBonusObjective({ type: 'pieces', target: 80 })).toBe('Finish within 80 pieces');
        expect(formatOdysseyBonusObjective({ type: 'unknown', description: 'Authored words' })).toBe('Authored words');
    });

    it('never names a bonus the star\'s other goals already guarantee', () => {
        const quadBonus = [{ type: 'no-singles' }, { type: 'tetris-count', target: 6 }];
        expect(formatOdysseyStarCondition({ lines: 45, tetrises: 6, bonuses: 2 }, 2, quadBonus))
            .toBe('45 lines + 6+ Quads + No single-line clears');
        const cascadeBonus = [{ type: 'cascade', target: 3 }, { type: 'no-singles' }];
        expect(formatOdysseyStarCondition({ lines: 40, cascades: 3, bonuses: 1 }, 2, cascadeBonus))
            .toBe('40 lines + 3+ cascades');
        expect(formatOdysseyStarCondition({ lines: 40, cascades: 2, bonuses: 1 }, 2, cascadeBonus))
            .toBe('40 lines + 2+ cascades + One of: Trigger 3 cascades, No single-line clears');
        expect(formatOdysseyStarCondition({ lines: 20, tetrises: 1 }, 1)).toBe('20 lines + 1 Quad');
    });

    it('explains the next star from the goals it names, judging each bonus by its own result', () => {
        const level = {
            stars: {
                one: { lines: 45 },
                two: { lines: 45, tetrises: 4 },
                three: { lines: 45, tetrises: 6, bonuses: 2 },
            },
            victory: { bonuses: [{ type: 'no-singles' }, { type: 'tetris-count', target: 6 }] },
        };
        // No singles were cleared; the missing piece is the Quads, which its own goal reports.
        const short = describeOdysseyStarOutcome(level, {
            stars: 2, lines: 45, tetrises: 4, bonuses: [true, false],
        });
        expect(short.next.missed.map((part) => part.key)).toEqual(['tetrises']);
        expect(formatOdysseyNextStar(short)).toBe('Next star: 6+ Quads (you: 4 Quads)');
        const singles = describeOdysseyStarOutcome(level, {
            stars: 2, lines: 45, tetrises: 6, bonuses: [false, true],
        });
        expect(formatOdysseyNextStar(singles)).toBe('Next star: No single-line clears');
        const guaranteed = describeOdysseyStarOutcome({
            stars: { one: { lines: 40 }, two: { lines: 40, cascades: 3, bonuses: 1 } },
            victory: { bonuses: [{ type: 'cascade', target: 3 }, { type: 'no-singles' }] },
        }, { stars: 1, lines: 40, cascades: 2, bonuses: [false, false] });
        expect(guaranteed.next.parts.map((part) => part.key)).toEqual(['lines', 'cascades']);
        expect(formatOdysseyNextStar(guaranteed)).toBe('Next star: 3+ cascades (you: 2 cascades)');
    });
});

describe('Odyssey star notes list', () => {
    beforeEach(() => {
        vi.stubGlobal('document', { createElement: (tagName) => createNode(tagName) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lists the three goals with earned marks and ends on the next-star line that sets the reading beat', () => {
        const notes = createOdysseyStarNotes(getLevelById(1), {
            stars: 2, lines: 23, time: 148, bonuses: [false],
        }, { className: 'ody-flow__star-notes' });
        expect(notes.list.className).toBe('ody-flow__star-notes');
        expect(notes.list.ariaLabel).toBe('Star goals');
        expect(notes.list.children).toHaveLength(4);
        expect(notes.list.children.map((item) => item.className)).toEqual([
            'ody-flow__star-notes__tier is-earned',
            'ody-flow__star-notes__tier is-earned',
            'ody-flow__star-notes__tier',
            'ody-flow__star-notes__next',
        ]);
        expect(notes.list.children.map((item) => item.dataset.earned)).toEqual(['true', 'true', 'false', undefined]);
        expect(notes.list.children[0].ariaLabel).toBe('Clear the orb: earned');
        expect(notes.list.children[2].ariaLabel).toBe('20 lines + Under 2 min + No single-line clears: not earned');
        expect(texts(notes.list.children[2])).toEqual(['·', '20 lines + Under 2 min + No single-line clears']);
        expect(notes.list.children[3].textContent)
            .toBe('Next star: Under 2 min (you: 2:28) · No single-line clears');
        expect(notes.words).toHaveLength(4);
        expect(notes.readingWords).toEqual([notes.list.children[3].textContent]);
    });

    it('renders nothing without star goals or results, and tolerates a DOM stub without dataset', () => {
        expect(createOdysseyStarNotes({ name: 'Clockwork Garden' }, { stars: 2 })).toBeNull();
        expect(createOdysseyStarNotes(getLevelById(1), null)).toBeNull();
        vi.stubGlobal('document', { createElement: (tagName) => createNode(tagName, { withDataset: false }) });
        const notes = createOdysseyStarNotes(getLevelById(2), { stars: 3 });
        expect(notes.list.className).toBe('ody-star-notes');
        expect(notes.list.children[3].textContent).toBe('All three stars earned.');
    });
});

describe('Odyssey map orb panel', () => {
    it('marks rival duels, chapter bosses and showcases, and nothing else', () => {
        expect(describeOdysseyOrbKind(getLevelById(5))).toEqual({ id: 'rival', label: 'Rival duel · Cinder' });
        expect(describeOdysseyOrbKind(getLevelById(4))).toEqual({ id: 'boss', label: 'Chapter boss' });
        // One boss per chapter (audit 2026-10-18): chapter 5 tags 32 and 33, and its boss is 33.
        expect(describeOdysseyOrbKind(getLevelById(33))).toEqual({ id: 'boss', label: 'Chapter boss' });
        expect(describeOdysseyOrbKind(getLevelById(32))).toEqual({ id: 'showcase', label: 'Showcase' });
        expect(describeOdysseyOrbKind(getLevelById(47))).toEqual({ id: 'boss', label: 'Chapter boss · Showcase' });
        // Chapter 8 tags none: its hardest solo orb wears the crown.
        expect(describeOdysseyOrbKind(getLevelById(59))).toEqual({ id: 'boss', label: 'Chapter boss · Showcase' });
        expect(describeOdysseyOrbKind(getLevelById(2))).toBeNull();
        expect(describeOdysseyOrbKind(null)).toBeNull();
    });

    it('briefs a locked rival duel: goal, star goals, what changes from the orb before, and how to open it', () => {
        const doc = createPanelDocument();
        const level = getLevelById(5);
        renderOdysseyLevelPanel({
            level, previousLevel: getLevelById(4), unlocked: false, chapterName: 'Earth Core',
        }, doc);
        const text = (id) => doc.nodes.get(id).textContent;
        expect(text('level-panel-kind')).toBe('Rival duel · Cinder');
        expect(doc.nodes.get('level-panel-kind').hidden).toBe(false);
        expect(doc.nodes.get('level-panel-kind').dataset.kind).toBe('rival');
        expect(text('level-panel-number')).toBe('Orb 5');
        expect(text('level-panel-name')).toBe(level.name);
        expect(text('level-panel-chapter')).toBe('Chapter 1: Earth Core');
        expect(text('level-panel-description')).toBe(level.metadata.description);
        expect(text('level-panel-stars')).toBe('☆☆☆');
        expect(doc.nodes.get('level-panel-stars').dataset.earned).toBe('false');
        expect(text('level-panel-goal')).toBe('Defeat Cinder · First to 3 knockouts');
        expect(goalTexts(doc.nodes.get('level-panel-star-goals'))).toEqual([
            '1 ★ Win the match', '2 ★ Win the match + At most 1 top-out', '3 ★ Win the match + No top-outs',
        ]);
        expect(text('level-panel-rules-label')).toBe('What changes here');
        expect(texts(doc.nodes.get('level-panel-rules')))
            .toEqual(getOdysseyLevelBriefing(level, getLevelById(4)).changes);
        expect(doc.nodes.get('level-panel-rules').hidden).toBe(false);
        expect(text('level-panel-tip')).toBe(level.metadata.tip);
        expect(text('level-panel-lock')).toBe('Locked · clear orb 4 to open this one.');
        expect(doc.nodes.get('level-panel-lock').hidden).toBe(false);
        expect(doc.nodes.get('level-panel-play-btn')).toMatchObject({ disabled: true, textContent: 'Locked' });
    });

    it('shows earned stars, a replay button and the full rules when there is no orb before', () => {
        const doc = createPanelDocument();
        const level = getLevelById(1);
        renderOdysseyLevelPanel({
            level, previousLevel: null, completion: { stars: 2 }, unlocked: true, chapterName: 'Earth Core',
        }, doc);
        const node = (id) => doc.nodes.get(id);
        expect(node('level-panel-kind').hidden).toBe(true);
        expect(node('level-panel-stars').textContent).toBe('★★☆');
        expect(node('level-panel-stars').dataset.earned).toBe('true');
        expect(node('level-panel-stars').ariaLabel).toBe('2 of 3 stars earned');
        expect(node('level-panel-stars').attributes['aria-label']).toBe('2 of 3 stars earned');
        expect(node('level-panel-goal').textContent).toBe('Clear 20 lines');
        expect(goalTexts(node('level-panel-star-goals'))).toEqual([
            '1 ★ Clear the orb', '2 ★ 20 lines + Under 2:30', '3 ★ 20 lines + Under 2 min + No single-line clears',
        ]);
        expect(node('level-panel-rules-label').textContent).toBe('Rules');
        expect(texts(node('level-panel-rules'))).toEqual(getOdysseyLevelBriefing(level).rules);
        expect(node('level-panel-lock').hidden).toBe(true);
        expect(node('level-panel-play-btn')).toMatchObject({ disabled: false, textContent: 'Play again' });
    });

    it('hides empty sections, offers Play for an open unplayed orb, and survives a panel without the new nodes', () => {
        const doc = createPanelDocument();
        const level = structuredClone(getLevelById(3));
        delete level.metadata.tip;
        renderOdysseyLevelPanel({
            level, previousLevel: getLevelById(3), unlocked: true,
        }, doc);
        expect(doc.nodes.get('level-panel-tip').hidden).toBe(true);
        expect(doc.nodes.get('level-panel-rules').hidden).toBe(true);
        expect(doc.nodes.get('level-panel-rules-label').hidden).toBe(true);
        expect(doc.nodes.get('level-panel-chapter').textContent).toBe('Chapter 1');
        expect(doc.nodes.get('level-panel-play-btn')).toMatchObject({ disabled: false, textContent: 'Play' });

        const sparse = { getElementById: () => null, createElement: (tagName) => createNode(tagName) };
        expect(() => renderOdysseyLevelPanel({ level, unlocked: true }, sparse)).not.toThrow();
        expect(() => renderOdysseyLevelPanel({ level: null }, doc)).not.toThrow();
    });
});
