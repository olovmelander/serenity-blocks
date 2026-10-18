import { describe, expect, it } from 'vitest';
import {
    AFTERGLOW_BONUS, KEEL_FACTOR, LONG_BREATH_SECONDS, LOW_TIDE_ROWS, ODYSSEY_CHAPTER_CHARMS, ODYSSEY_CHARMS,
    ODYSSEY_CHARM_DRAFT_SIZE, ODYSSEY_CHARM_KIND_LABELS, ODYSSEY_CHARM_SLOTS, ODYSSEY_MERCY_FALLS, STILL_AIR_FACTOR,
    applyOdysseyCharmsToLevel, carryOdysseyCharm, createOdysseyCharmState, describeOdysseyCharms, keelTarget,
    normalizeOdysseyCharmState, odysseyChapterCharms, odysseyChapterDraft, odysseyCharmById, odysseyCharmEases,
    odysseyMercyCharms, odysseyMercyDraft, passOdysseyCharm, recordOdysseyFall, takeOdysseyCharm,
    toggleOdysseyCarriedCharm,
} from '../../src/core/odyssey/odyssey-charms.js';
import { CHARMS as WAYSTONES_CHARMS } from '../../src/core/waystones/charms.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';

const ids = (charms) => charms.map((charm) => charm.id);
const everyCharm = ids(ODYSSEY_CHARMS);

describe('Odyssey charms: the catalogue', () => {
    it('offers eight distinct charms of three kinds, each named with one line and a kind label', () => {
        expect(ODYSSEY_CHARMS).toHaveLength(8);
        expect(new Set(everyCharm).size).toBe(8);
        ODYSSEY_CHARMS.forEach((charm) => {
            expect(['score', 'goal', 'safety']).toContain(charm.kind);
            expect(charm.name.length).toBeGreaterThan(2);
            expect(charm.line.endsWith('.')).toBe(true);
            expect(ODYSSEY_CHARM_KIND_LABELS[charm.kind]).toBeTruthy();
        });
        expect(ids(ODYSSEY_CHARMS.filter((charm) => charm.kind === 'score'))).toEqual(['kindle', 'swell', 'afterglow']);
        expect(ids(ODYSSEY_CHARMS.filter((charm) => charm.kind === 'goal')))
            .toEqual(['keel', 'long-breath', 'still-air', 'low-tide']);
        expect(ids(ODYSSEY_CHARMS.filter((charm) => charm.kind === 'safety'))).toEqual(['hearth']);
        expect(odysseyCharmById('keel')).toMatchObject({ name: 'Keel', kind: 'goal' });
        expect(odysseyCharmById('nope')).toBeNull();
        expect(ids(describeOdysseyCharms(['hearth', 'nope', 'keel']))).toEqual(['hearth', 'keel']);
        expect(describeOdysseyCharms(undefined)).toEqual([]);
        expect(KEEL_FACTOR).toBe(0.85);
        expect(AFTERGLOW_BONUS).toBe(1500);
        expect(ODYSSEY_CHARM_SLOTS).toBe(3);
    });

    it('speaks the Waystones language: a charm shared by name keeps its kind, and its score line', () => {
        ODYSSEY_CHARMS.forEach((charm) => {
            const twin = WAYSTONES_CHARMS.find((entry) => entry.id === charm.id);
            if (!twin) return;
            expect(twin.name).toBe(charm.name);
            expect(twin.kind).toBe(charm.kind);
            if (charm.kind === 'score') expect(twin.line).toBe(charm.line);
        });
        expect(ODYSSEY_CHARMS.filter((charm) => WAYSTONES_CHARMS.some((entry) => entry.id === charm.id)).length)
            .toBeGreaterThanOrEqual(3);
    });

    it('knows which charms ease an orb: its clock, its rubble, its ask, a fall; the points charms never do', () => {
        expect(odysseyCharmEases(getLevelById(15), 'long-breath')).toBe(true); // a 4:30 deadline
        expect(odysseyCharmEases(getLevelById(1), 'long-breath')).toBe(false);
        expect(odysseyCharmEases(getLevelById(6), 'low-tide')).toBe(true); // five rows of rubble
        expect(odysseyCharmEases(getLevelById(1), 'low-tide')).toBe(false);
        expect(odysseyCharmEases(getLevelById(1), 'keel')).toBe(true); // 20 lines become 17
        expect(odysseyCharmEases(getLevelById(5), 'keel')).toBe(false); // a duel asks knockouts
        ['hearth', 'still-air'].forEach((id) => {
            expect(odysseyCharmEases(getLevelById(5), id)).toBe(true);
            expect(odysseyCharmEases(undefined, id)).toBe(true);
        });
        ['kindle', 'swell', 'afterglow', 'nope'].forEach((id) => {
            expect(odysseyCharmEases(getLevelById(1), id)).toBe(false);
        });
        expect(odysseyCharmEases(undefined, 'keel')).toBe(false);
    });
});

describe('Odyssey charms: the chapter offers', () => {
    it('authors three charms for every chapter, mixing the kinds, and offers each charm at least twice', () => {
        const chapters = CHAPTER_CONFIGS.map((chapter) => chapter.id);
        expect(Object.keys(ODYSSEY_CHAPTER_CHARMS).map(Number).sort((a, b) => a - b)).toEqual(chapters);
        const seen = new Map(everyCharm.map((id) => [id, 0]));
        chapters.forEach((chapterId) => {
            const offered = ODYSSEY_CHAPTER_CHARMS[chapterId];
            expect(offered, `chapter ${chapterId}`).toHaveLength(ODYSSEY_CHARM_DRAFT_SIZE);
            expect(new Set(offered).size).toBe(3);
            offered.forEach((id) => {
                expect(odysseyCharmById(id), `${chapterId}:${id}`).not.toBeNull();
                seen.set(id, seen.get(id) + 1);
            });
            expect(new Set(offered.map((id) => odysseyCharmById(id).kind)).size, `chapter ${chapterId}`)
                .toBeGreaterThanOrEqual(2);
        });
        seen.forEach((count, id) => expect(count, id).toBeGreaterThanOrEqual(2));
        // The first chapter teaches the three kinds; the first deadline chapter offers the clock.
        expect(new Set(ODYSSEY_CHAPTER_CHARMS[1].map((id) => odysseyCharmById(id).kind)).size).toBe(3);
        expect(ODYSSEY_CHAPTER_CHARMS[3]).toContain('long-breath');
        expect(ODYSSEY_CHAPTER_CHARMS[2]).toContain('low-tide');
    });

    it('leaves out what the bag holds and tops the offer up from the catalogue while charms remain', () => {
        expect(odysseyChapterCharms(3, [])).toEqual(['long-breath', 'swell', 'keel']);
        expect(odysseyChapterCharms(3, ['swell'])).toEqual(['long-breath', 'keel', 'kindle']);
        expect(odysseyChapterCharms(3, ['swell', 'kindle', 'long-breath'])).toEqual(['keel', 'afterglow', 'still-air']);
        expect(odysseyChapterCharms(3, everyCharm.filter((id) => id !== 'hearth'))).toEqual(['hearth']);
        expect(odysseyChapterCharms(3, everyCharm)).toEqual([]);
        expect(odysseyChapterCharms(99, [])).toEqual(['kindle', 'swell', 'afterglow']);
    });

    it('offers a chapter draft once: taken or passed, it is settled; a full bag has nothing to draw', () => {
        const state = createOdysseyCharmState();
        expect(state).toEqual({
            gathered: [], carried: [], drafts: {}, falls: {},
        });
        const draft = odysseyChapterDraft(state, 1);
        expect(draft.key).toBe('chapter:1');
        expect(ids(draft.charms)).toEqual(['kindle', 'keel', 'hearth']);
        expect(takeOdysseyCharm(state, draft, 'keel')).toEqual({ setDown: null });
        expect(odysseyChapterDraft(state, 1)).toBeNull();
        expect(ids(odysseyChapterDraft(state, 2).charms)).toEqual(['low-tide', 'kindle', 'hearth']);
        expect(passOdysseyCharm(state, odysseyChapterDraft(state, 2))).toBe(true);
        expect(odysseyChapterDraft(state, 2)).toBeNull();
        expect(passOdysseyCharm(state, { key: 'chapter:2', charms: [] })).toBe(false);
        expect(state.drafts).toEqual({ 'chapter:1': 'keel', 'chapter:2': null });
        const full = createOdysseyCharmState();
        full.gathered = [...everyCharm];
        expect(odysseyChapterDraft(full, 3)).toBeNull();
        expect(odysseyChapterDraft(null, 1)).toBeNull();
    });
});

describe('Odyssey charms: the bag and the three slots', () => {
    const gatherChapters = (state, count) => {
        const taken = [];
        for (let chapter = 1; chapter <= count; chapter += 1) {
            const draft = odysseyChapterDraft(state, chapter);
            taken.push({ id: draft.charms[0].id, outcome: takeOdysseyCharm(state, draft, draft.charms[0].id) });
        }
        return taken;
    };

    it('carries a taken charm from here, and sets down the one carried longest when the slots are full', () => {
        const state = createOdysseyCharmState();
        const taken = gatherChapters(state, 4);
        expect(taken.map((entry) => entry.id)).toEqual(['kindle', 'low-tide', 'long-breath', 'still-air']);
        expect(taken.slice(0, 3).map((entry) => entry.outcome)).toEqual([
            { setDown: null }, { setDown: null }, { setDown: null },
        ]);
        expect(taken[3].outcome).toEqual({ setDown: 'kindle' });
        expect(state.gathered).toEqual(['kindle', 'low-tide', 'long-breath', 'still-air']);
        expect(state.carried).toEqual(['low-tide', 'long-breath', 'still-air']);
        expect(carryOdysseyCharm(state, 'still-air')).toBeNull(); // already carried: nothing moves
        expect(state.carried).toEqual(['low-tide', 'long-breath', 'still-air']);
    });

    it('refuses a charm not on offer, already in the bag, or of a settled draft', () => {
        const state = createOdysseyCharmState();
        const draft = odysseyChapterDraft(state, 1);
        expect(takeOdysseyCharm(state, draft, 'swell')).toBeNull();
        expect(takeOdysseyCharm(state, draft, 'nope')).toBeNull();
        expect(takeOdysseyCharm(state, null, 'keel')).toBeNull();
        expect(takeOdysseyCharm(null, draft, 'keel')).toBeNull();
        expect(state.gathered).toEqual([]);
        expect(takeOdysseyCharm(state, draft, 'keel')).toEqual({ setDown: null });
        expect(takeOdysseyCharm(state, draft, 'kindle')).toBeNull(); // settled
        const stale = { key: 'orb:9', charms: describeOdysseyCharms(['keel']) };
        expect(takeOdysseyCharm(state, stale, 'keel')).toBeNull(); // already in the bag
        expect(state.gathered).toEqual(['keel']);
    });

    it('lets the player set a charm down and carry it again, never a fourth, never one outside the bag', () => {
        const state = createOdysseyCharmState();
        gatherChapters(state, 4);
        expect(toggleOdysseyCarriedCharm(state, 'long-breath')).toEqual({ carried: false, refused: false });
        expect(state.carried).toEqual(['low-tide', 'still-air']);
        expect(toggleOdysseyCarriedCharm(state, 'kindle')).toEqual({ carried: true, refused: false });
        expect(state.carried).toEqual(['low-tide', 'still-air', 'kindle']);
        expect(toggleOdysseyCarriedCharm(state, 'long-breath')).toEqual({ carried: false, refused: true });
        expect(state.carried).toEqual(['low-tide', 'still-air', 'kindle']);
        expect(toggleOdysseyCarriedCharm(state, 'hearth')).toEqual({ carried: false, refused: true });
        expect(toggleOdysseyCarriedCharm(null, 'kindle')).toEqual({ carried: false, refused: true });
    });

    it('makes a saved state whole: unknown charms dropped, the carried a subset of the bag, counts whole', () => {
        const state = normalizeOdysseyCharmState({
            gathered: ['keel', 'bogus', 'keel', 'hearth', 'swell', 'kindle'],
            carried: ['hearth', 'bogus', 'low-tide', 'keel', 'swell', 'kindle'],
            drafts: { 'chapter:1': 'keel', 'chapter:2': null, 'chapter:3': 'bogus' },
            falls: {
                4: 2.7, 5: 0, 6: -1, 7: 'x',
            },
        });
        expect(state).toEqual({
            gathered: ['keel', 'hearth', 'swell', 'kindle'],
            carried: ['keel', 'swell', 'kindle'],
            drafts: { 'chapter:1': 'keel', 'chapter:2': null },
            falls: { 4: 2 },
        });
        // A save that only names what was gathered carries the last three taken.
        expect(normalizeOdysseyCharmState({ owned: ['keel', 'hearth', 'swell', 'kindle'] }))
            .toMatchObject({ gathered: ['keel', 'hearth', 'swell', 'kindle'], carried: ['hearth', 'swell', 'kindle'] });
        expect(normalizeOdysseyCharmState({ gathered: ['keel'], carried: 'keel' }).carried).toEqual(['keel']);
        expect(normalizeOdysseyCharmState(undefined)).toEqual(createOdysseyCharmState());
        expect(normalizeOdysseyCharmState({ gathered: 'keel', carried: [] })).toEqual(createOdysseyCharmState());
    });
});

describe('Odyssey charms: the road’s mercy', () => {
    const fall = (state, levelId, times) => {
        for (let count = 0; count < times; count += 1) recordOdysseyFall(state, levelId);
    };

    it('offers the charms that would ease the orb fallen on, its own trouble first, nothing already in the bag', () => {
        expect(odysseyMercyCharms(getLevelById(15), [])).toEqual(['long-breath', 'keel', 'hearth']); // timed, lines
        expect(odysseyMercyCharms(getLevelById(15), ['long-breath', 'keel'])).toEqual(['hearth', 'still-air']);
        expect(odysseyMercyCharms(getLevelById(6), [])).toEqual(['low-tide', 'keel', 'hearth']); // rubble, lines
        expect(odysseyMercyCharms(getLevelById(5), [])).toEqual(['hearth', 'still-air']); // a duel
        expect(odysseyMercyCharms(getLevelById(1), ['keel', 'hearth', 'still-air'])).toEqual([]);
        expect(odysseyMercyCharms(undefined, [])).toEqual(['hearth', 'still-air']);
    });

    it('opens after the third fall on one orb, keyed to that orb, until taken or passed', () => {
        const state = createOdysseyCharmState();
        const level = getLevelById(15);
        fall(state, 15, ODYSSEY_MERCY_FALLS - 1);
        expect(odysseyMercyDraft(state, level)).toBeNull();
        expect(recordOdysseyFall(state, 15)).toBe(ODYSSEY_MERCY_FALLS);
        const mercy = odysseyMercyDraft(state, level);
        expect(mercy.key).toBe('orb:15');
        expect(ids(mercy.charms)).toEqual(['long-breath', 'keel', 'hearth']);
        expect(odysseyMercyDraft(state, getLevelById(16))).toBeNull();
        // Offered again on every later fall until settled; taking carries the charm from here.
        recordOdysseyFall(state, 15);
        expect(odysseyMercyDraft(state, level)).toEqual(mercy);
        expect(takeOdysseyCharm(state, mercy, 'long-breath')).toEqual({ setDown: null });
        expect(state.carried).toEqual(['long-breath']);
        expect(odysseyMercyDraft(state, level)).toBeNull();
        expect(state.falls).toEqual({ 15: 4 });
        // Another orb's mercy can be passed, and stays settled.
        fall(state, 6, ODYSSEY_MERCY_FALLS);
        const rubble = odysseyMercyDraft(state, getLevelById(6));
        expect(ids(rubble.charms)).toEqual(['low-tide', 'keel', 'hearth']);
        expect(passOdysseyCharm(state, rubble)).toBe(true);
        expect(odysseyMercyDraft(state, getLevelById(6))).toBeNull();
        expect(odysseyMercyDraft(null, level)).toBeNull();
    });

    it('has nothing to offer when the bag already holds what would ease the orb, and keys by id without an orb', () => {
        const holding = createOdysseyCharmState();
        holding.gathered = ['keel', 'hearth', 'still-air'];
        fall(holding, 1, ODYSSEY_MERCY_FALLS);
        expect(odysseyMercyDraft(holding, getLevelById(1))).toBeNull();
        const blind = createOdysseyCharmState();
        fall(blind, 42, ODYSSEY_MERCY_FALLS);
        const mercy = odysseyMercyDraft(blind, undefined, 42);
        expect(mercy.key).toBe('orb:42');
        expect(ids(mercy.charms)).toEqual(['hearth', 'still-air']);
    });
});

describe('Odyssey charms: the orb as the carried charms make it', () => {
    const authored = () => ({
        id: 9,
        chapter: 2,
        name: 'Synthetic orb',
        victory: {
            primary: { type: 'lines', target: 20 },
            failure: { type: 'time', value: 180 },
            bonuses: [],
        },
        stars: { one: { lines: 20 }, two: { lines: 20, time: 150 }, three: { lines: 30, time: 120 } },
        mechanics: { board: { startingRows: 4 }, speed: { fixedDropInterval: 800 } },
    });

    it('eases with Keel, lengthens with Long Breath, clears with Low Tide, slows with Still Air; orb kept', () => {
        const level = authored();
        const frozen = structuredClone(level);
        const held = ['keel', 'long-breath', 'low-tide', 'still-air', 'hearth', 'kindle'];
        const played = applyOdysseyCharmsToLevel(level, held);
        expect(played).not.toBe(level);
        expect(level).toEqual(frozen);
        expect(played.victory.primary.target).toBe(17);
        // The star tier that mirrors the goal follows it; higher asks stay what they were.
        expect(played.stars.one).toEqual({ lines: 17 });
        expect(played.stars.two).toEqual({ lines: 17, time: 150 });
        expect(played.stars.three).toEqual({ lines: 30, time: 120 });
        expect(played.victory.failure.value).toBe(180 + LONG_BREATH_SECONDS);
        expect(played.mechanics.board.startingRows).toBe(4 - LOW_TIDE_ROWS);
        expect(played.mechanics.speed).toEqual({ fixedDropInterval: 800, paceFactor: STILL_AIR_FACTOR });
        expect(played.charms).toEqual(held);
        expect(played.name).toBe('Synthetic orb');
        expect(played.victory.bonuses).toBe(level.victory.bonuses);
    });

    it('returns the authored orb itself without charms, and ignores charms that do not exist', () => {
        const level = authored();
        expect(applyOdysseyCharmsToLevel(level, [])).toBe(level);
        expect(applyOdysseyCharmsToLevel(level, undefined)).toBe(level);
        expect(applyOdysseyCharmsToLevel(level, ['bogus'])).toBe(level);
        expect(applyOdysseyCharmsToLevel(null, ['keel'])).toBeNull();
        // Points and safety charms change nothing about the orb's asks, only mark it charmed.
        const scored = applyOdysseyCharmsToLevel(level, ['swell', 'hearth']);
        expect(scored.victory).toEqual(level.victory);
        expect(scored.mechanics).toEqual(level.mechanics);
        expect(scored.charms).toEqual(['swell', 'hearth']);
    });

    it('asks one fewer of a cascade or chain goal, never less than one, and leaves other goals alone', () => {
        expect(keelTarget('lines', 20)).toBe(17);
        expect(keelTarget('score', 10000)).toBe(8500);
        expect(keelTarget('lines', 1)).toBe(1);
        expect(keelTarget('cascade', 3)).toBe(2);
        expect(keelTarget('combo', 1)).toBe(1);
        expect(keelTarget('survive', 120)).toBe(120);
        const level = authored();
        level.victory.primary = { type: 'cascade', target: 3 };
        level.stars = { one: { cascades: 3 }, two: { cascades: 3, maxCascadeDepth: 3 }, three: { cascades: 5 } };
        const played = applyOdysseyCharmsToLevel(level, ['keel']);
        expect(played.victory.primary.target).toBe(2);
        expect(played.stars.one).toEqual({ cascades: 2 });
        expect(played.stars.two).toEqual({ cascades: 2, maxCascadeDepth: 3 });
        expect(played.stars.three).toEqual({ cascades: 5 });
        const survive = authored();
        survive.victory.primary = { type: 'survive', target: 120 };
        expect(applyOdysseyCharmsToLevel(survive, ['keel']).victory.primary.target).toBe(120);
    });

    it('only lengthens a deadline, only clears rubble that exists, and stacks Still Air on an authored pace', () => {
        const level = authored();
        level.victory.failure = { type: 'topOut' };
        delete level.mechanics.board.startingRows;
        level.mechanics.speed.paceFactor = 1.2;
        const played = applyOdysseyCharmsToLevel(level, ['long-breath', 'low-tide', 'still-air']);
        expect(played.victory.failure).toEqual({ type: 'topOut' });
        expect(played.mechanics.board.startingRows).toBeUndefined();
        expect(played.mechanics.speed.paceFactor).toBeCloseTo(1.5);
        const shallow = authored();
        shallow.mechanics.board.startingRows = 1;
        expect(applyOdysseyCharmsToLevel(shallow, ['low-tide']).mechanics.board.startingRows).toBe(0);
    });

    it('eases a real orb the way the map and the HUD will show it', () => {
        const level = getLevelById(1);
        const played = applyOdysseyCharmsToLevel(level, ['keel']);
        expect(level.victory.primary).toMatchObject({ type: 'lines', target: 20 });
        expect(played.victory.primary.target).toBe(17);
        Object.entries(level.stars).forEach(([tier, condition]) => {
            if (condition.lines === 20) expect(played.stars[tier]).toEqual({ ...condition, lines: 17 });
            else expect(played.stars[tier]).toEqual(condition);
        });
        expect(getLevelById(1).victory.primary.target).toBe(20);
    });
});
