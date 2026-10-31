import { describe, expect, it } from 'vitest';
import { LEVEL_SPEEDS } from '../../src/core/constants.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { ODYSSEY_ORB_COPY, applyOdysseyOrbCopy, getOdysseyOrbCopy } from '../../src/core/odyssey/data/orb-copy.js';

// The checkable half of the voice rules in orb-copy.js. The other half (does it read well, does
// it fit the world) is a person's job; these catch the mistakes that crept in before: designer
// notes shipped as copy, a "finale" that stopped being one, a pace the orb does not have.
const DESIGNER_TALK = new RegExp([
    'release beat', 'reset level', 'this is a ', 'chapter beat', 'flow score', 'showcase', 'encore',
    '\\bboss\\b', '\\bteach', 'reinforce', 'mastery', 'graduation', 'difficulty',
].join('|'), 'i');
const PLACE_CLAIM = /\b(final|finale|last)\b/i;
const UK_SPELLING = /colour|favour|centre|\bgrey|metre|behaviour|honour|realis|organis|recognis/i;
const GENRE_MARK = /tetris|tetromino|tetrimino/i;
const DASH = / - |--|–|—/;
const STOP_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'at', 'to', 'under', 'where']);

const orbs = LEVEL_CONFIGS.map((level) => ({ level, copy: getOdysseyOrbCopy(level) }));
const duels = LEVEL_CONFIGS.filter((level) => level.mechanics?.versus);

function words(level) {
    return `${level.name} ${level.metadata.description} ${level.metadata.tip}`;
}

/** The well's opening drop interval in ms per row (before slow-start, which only eases it). */
function openingInterval(level) {
    const { speed } = level.mechanics;
    return speed.fixedDropInterval || LEVEL_SPEEDS[(speed.startLevel || 1) - 1];
}

function nameStems(name) {
    return name.toLowerCase().split(/[^a-z']+/)
        .map((word) => word.replace(/'s$/, '').replace(/'/g, ''))
        .filter((word) => word && !STOP_WORDS.has(word))
        .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

describe('Odyssey orb copy', () => {
    it('gives every orb its words, and holds none for a world that has no orb', () => {
        const themes = LEVEL_CONFIGS.map((level) => level.theme.primary);
        expect(new Set(themes).size).toBe(LEVEL_CONFIGS.length);
        for (const { level, copy } of orbs) {
            expect(copy, `orb ${level.id} (${level.theme.primary}) has no copy`).not.toBeNull();
            expect(level.name).toBe(copy.name);
            expect(level.metadata.description).toBe(copy.description);
            expect(level.metadata.tip).toBe(copy.tip);
        }
        expect(Object.keys(ODYSSEY_ORB_COPY).sort()).toEqual([...themes].sort());
    });

    it('dresses an orb by its world, and leaves an orb without copy as it was', () => {
        const [dressed, bare] = applyOdysseyOrbCopy([
            { theme: { primary: 'geode' }, name: 'Old', metadata: { difficulty: 2 } },
            { theme: { primary: 'not-a-theme' }, name: 'Kept', metadata: { description: 'Kept.' } },
        ]);
        expect(dressed).toMatchObject({ name: 'Geode Heart', metadata: { difficulty: 2 } });
        expect(dressed.metadata.description).toBe(ODYSSEY_ORB_COPY.geode.description);
        expect(bare).toMatchObject({ name: 'Kept', metadata: { description: 'Kept.' } });
    });

    it('names every orb once, briefly, without repeating a word inside its chapter', () => {
        const names = LEVEL_CONFIGS.map((level) => level.name);
        expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
        for (const level of LEVEL_CONFIGS) {
            expect(level.name, `orb ${level.id}`).toMatch(/^[A-Z]/);
            expect(level.name.length, `orb ${level.id}: ${level.name}`).toBeLessThanOrEqual(22);
        }
        for (const chapter of CHAPTER_CONFIGS) {
            const stems = LEVEL_CONFIGS.filter((level) => level.chapter === chapter.id)
                .flatMap((level) => nameStems(level.name));
            const repeated = stems.filter((stem, index) => stems.indexOf(stem) !== index);
            expect(repeated, `chapter ${chapter.id} names repeat a word`).toEqual([]);
        }
    });

    // The navigator card clamps the description to two lines on short laptop screens (1366×768):
    // measured, 108 characters always fit and 120 never do.
    it('keeps descriptions short enough for the map card, without numbers that retuning would stale', () => {
        const descriptions = LEVEL_CONFIGS.map((level) => level.metadata.description);
        expect(new Set(descriptions).size).toBe(descriptions.length);
        for (const level of LEVEL_CONFIGS) {
            const { description } = level.metadata;
            expect(description.length, `orb ${level.id}: ${description}`).toBeGreaterThanOrEqual(60);
            expect(description.length, `orb ${level.id}: ${description}`).toBeLessThanOrEqual(108);
            expect(description, `orb ${level.id}`).toMatch(/[.!?]$/);
            expect(description, `orb ${level.id} restates a number`).not.toMatch(/\d/);
            expect(description.startsWith(level.name), `orb ${level.id} opens with its own name`).toBe(false);
        }
    });

    it('keeps every tip short, distinct and finished', () => {
        const tips = LEVEL_CONFIGS.map((level) => level.metadata.tip);
        expect(new Set(tips).size).toBe(tips.length);
        for (const level of LEVEL_CONFIGS) {
            const { tip } = level.metadata;
            expect(tip.length, `orb ${level.id}: ${tip}`).toBeGreaterThanOrEqual(30);
            expect(tip.length, `orb ${level.id}: ${tip}`).toBeLessThanOrEqual(120);
            expect(tip, `orb ${level.id}`).toMatch(/[.!?]$/);
        }
    });

    it('speaks to the player in one voice: no design notes, US spelling, no genre mark, no spaced dashes', () => {
        for (const level of LEVEL_CONFIGS) {
            const text = words(level);
            expect(text, `orb ${level.id}`).not.toMatch(DESIGNER_TALK);
            expect(text, `orb ${level.id}`).not.toMatch(UK_SPELLING);
            expect(text, `orb ${level.id}`).not.toMatch(GENRE_MARK);
            expect(text, `orb ${level.id}`).not.toMatch(DASH);
        }
    });

    it('claims a place in the journey only where the orb holds it', () => {
        for (const level of LEVEL_CONFIGS) {
            if (PLACE_CLAIM.test(words(level))) {
                expect(level.isChapterEnd, `orb ${level.id} claims to be last or final`).toBe(true);
            }
        }
        const firstRival = LEVEL_CONFIGS.filter((level) => /\bfirst rival\b/i.test(words(level)));
        const lastRival = LEVEL_CONFIGS.filter((level) => /\blast rival\b/i.test(words(level)));
        expect(firstRival.map((level) => level.id)).toEqual([duels[0].id]);
        expect(lastRival.map((level) => level.id)).toEqual([duels[duels.length - 1].id]);
    });

    it('names each rival in its duel and keeps rival talk to the duels', () => {
        const rivals = duels.map((level) => level.mechanics.versus.botName);
        for (const level of duels) {
            expect(level.metadata.description).toContain(level.mechanics.versus.botName);
        }
        // A rival's name in a solo orb's words reads as the rival (orb 58 is Neon Dusk, which is the
        // theme's own name; only its description and tip are checked).
        for (const level of LEVEL_CONFIGS.filter((orb) => !orb.mechanics?.versus)) {
            const text = `${level.metadata.description} ${level.metadata.tip}`;
            expect(text, `orb ${level.id}`).not.toMatch(/\brival\b/i);
            rivals.forEach((rival) => expect(text, `orb ${level.id}`).not.toMatch(new RegExp(`\\b${rival}\\b`)));
        }
    });

    it('describes speed, the clock and the showcase as the orb plays them', () => {
        for (const level of LEVEL_CONFIGS.filter((orb) => !orb.mechanics?.versus)) {
            const text = words(level);
            const interval = openingInterval(level);
            const timed = level.victory.failure?.type === 'time';
            if (/(fall|start) fast\b|high speed|quick drops/i.test(text)) {
                expect(interval, `orb ${level.id} says the pieces are fast`).toBeLessThanOrEqual(110);
            }
            if (/calm(er)? pace|easy rhythm|a calm, tall well/i.test(text)) {
                expect(interval, `orb ${level.id} says the pace is calm`).toBeGreaterThanOrEqual(500);
            }
            if (/faster as you clear|get faster/i.test(text)) {
                expect(level.mechanics.speed.levelProgression, `orb ${level.id}`).toBe(true);
            }
            if (/steady speed/i.test(text)) {
                expect(level.mechanics.speed.levelProgression, `orb ${level.id}`).toBe(false);
            }
            if (/no clock|no countdown|no timer|no hurry|no rush/i.test(text)) {
                expect(timed, `orb ${level.id} says there is no clock`).toBe(false);
            }
            if (/time runs out|clock runs out|against the clock|race the clock|time is short/i.test(text)) {
                expect(timed, `orb ${level.id} says the clock is running`).toBe(true);
            }
            expect(/play on for stars/i.test(text), `orb ${level.id} and its showcase`)
                .toBe(level.victoryLapPolicy === 'showcase');
        }
    });
});
