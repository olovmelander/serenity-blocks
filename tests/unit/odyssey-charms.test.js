import { describe, expect, it } from 'vitest';
import {
    AFTERGLOW_BONUS, KEEL_FACTOR, LONG_BREATH_SECONDS, LOW_TIDE_ROWS, ODYSSEY_CHARMS, ODYSSEY_CHARM_DRAFT_SIZE,
    ODYSSEY_CHARM_KIND_LABELS, ODYSSEY_MERCY_FALLS, STILL_AIR_FACTOR,
    applyOdysseyCharmsToLevel, createOdysseyCharmState, describeOdysseyCharms, draftOdysseyCharms, keelTarget,
    normalizeOdysseyCharmState, odysseyChapterDraftKey, odysseyCharmById, odysseyCharmDraft, odysseyMercyDraft,
    odysseyMercyDraftKey, passOdysseyCharm, recordOdysseyFall, takeOdysseyCharm,
} from '../../src/core/odyssey/odyssey-charms.js';
import { CHARMS as WAYSTONES_CHARMS } from '../../src/core/waystones/charms.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

const ids = (charms) => charms.map((charm) => charm.id);

describe('Odyssey charms: the catalogue', () => {
    it('offers eight distinct charms of three kinds, each named with one line and a kind label', () => {
        expect(ODYSSEY_CHARMS).toHaveLength(8);
        expect(new Set(ids(ODYSSEY_CHARMS)).size).toBe(8);
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
    });

    it('speaks the Waystones language: a charm shared by name keeps its kind, and its score lines', () => {
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
});

describe('Odyssey charms: drafts', () => {
    it('offers three distinct charms, the same three for one journey and key, never one already held', () => {
        const first = draftOdysseyCharms('journey-a', 'chapter:1', []);
        expect(first).toHaveLength(ODYSSEY_CHARM_DRAFT_SIZE);
        expect(new Set(first).size).toBe(3);
        first.forEach((id) => expect(odysseyCharmById(id)).not.toBeNull());
        expect(draftOdysseyCharms('journey-a', 'chapter:1', [])).toEqual(first);
        const later = draftOdysseyCharms('journey-a', 'chapter:2', [first[0], first[1]]);
        expect(later).toHaveLength(3);
        expect(later).not.toContain(first[0]);
        expect(later).not.toContain(first[1]);
        // Fewer remain, fewer are offered; none once every charm is held.
        expect(draftOdysseyCharms('journey-a', 'chapter:3', ids(ODYSSEY_CHARMS.slice(0, 6)))).toHaveLength(2);
        expect(draftOdysseyCharms('journey-a', 'chapter:3', ids(ODYSSEY_CHARMS))).toEqual([]);
        // Another journey draws its own drafts.
        const keys = [1, 2, 3, 4, 5, 6].map(odysseyChapterDraftKey);
        expect(keys.some((key) => (
            draftOdysseyCharms('journey-b', key, []).join() !== draftOdysseyCharms('journey-a', key, []).join()
        ))).toBe(true);
    });

    it('takes one charm of a draft and keeps it; a draft, taken or passed, is never offered again', () => {
        const state = createOdysseyCharmState({ seed: 'journey-a' });
        expect(state).toEqual({
            seed: 'journey-a', owned: [], drafts: {}, falls: {},
        });
        const draft = odysseyCharmDraft(state, 'chapter:1');
        expect(draft.key).toBe('chapter:1');
        expect(draft.charms).toHaveLength(3);
        const [pick] = draft.charms;
        const elsewhere = ODYSSEY_CHARMS.find((charm) => !draft.charms.includes(charm));
        expect(takeOdysseyCharm(state, 'chapter:1', 'not-a-charm')).toBe(false);
        expect(takeOdysseyCharm(state, 'chapter:1', elsewhere.id)).toBe(false);
        expect(state.owned).toEqual([]);
        expect(takeOdysseyCharm(state, 'chapter:1', pick.id)).toBe(true);
        expect(state.owned).toEqual([pick.id]);
        expect(state.drafts).toEqual({ 'chapter:1': pick.id });
        expect(odysseyCharmDraft(state, 'chapter:1')).toBeNull();
        expect(takeOdysseyCharm(state, 'chapter:1', pick.id)).toBe(false);
        // The next draft never offers the charm already held; a pass settles it for good.
        expect(ids(odysseyCharmDraft(state, 'chapter:2').charms)).not.toContain(pick.id);
        expect(passOdysseyCharm(state, 'chapter:2')).toBe(true);
        expect(state.drafts['chapter:2']).toBeNull();
        expect(odysseyCharmDraft(state, 'chapter:2')).toBeNull();
        expect(passOdysseyCharm(state, 'chapter:2')).toBe(false);
        expect(state.owned).toEqual([pick.id]);
        expect(odysseyCharmDraft(null, 'chapter:1')).toBeNull();
    });

    it('runs out gracefully: once every charm is held a new draft offers nothing', () => {
        const state = createOdysseyCharmState({ seed: 'all-of-them' });
        for (let chapter = 1; chapter <= 8; chapter += 1) {
            const draft = odysseyCharmDraft(state, odysseyChapterDraftKey(chapter));
            expect(draft, `chapter ${chapter}`).not.toBeNull();
            expect(takeOdysseyCharm(state, draft.key, draft.charms[0].id)).toBe(true);
        }
        expect(new Set(state.owned).size).toBe(8);
        expect(odysseyCharmDraft(state, odysseyChapterDraftKey(9))).toBeNull();
    });

    it('makes a saved state whole: unknown charms dropped, duplicates folded, counts whole, a seed present', () => {
        const state = normalizeOdysseyCharmState({
            seed: 'kept',
            owned: ['keel', 'bogus', 'keel', 'hearth'],
            drafts: { 'chapter:1': 'keel', 'chapter:2': null, 'chapter:3': 'bogus' },
            falls: {
                4: 2.7, 5: 0, 6: -1, 7: 'x',
            },
        });
        expect(state).toEqual({
            seed: 'kept',
            owned: ['keel', 'hearth'],
            drafts: { 'chapter:1': 'keel', 'chapter:2': null },
            falls: { 4: 2 },
        });
        expect(normalizeOdysseyCharmState(undefined).seed).toMatch(/\S/);
        expect(normalizeOdysseyCharmState({ seed: '' }).seed).toMatch(/\S/);
        expect(normalizeOdysseyCharmState({ seed: 42, owned: 'keel' }).owned).toEqual([]);
        expect(createOdysseyCharmState().seed).not.toBe(createOdysseyCharmState().seed);
    });

    it('opens the road’s mercy after the third fall on one orb, keyed to that orb, until it is settled', () => {
        const state = createOdysseyCharmState({ seed: 'mercy' });
        expect(recordOdysseyFall(state, 7)).toBe(1);
        expect(odysseyMercyDraft(state, 7)).toBeNull();
        expect(recordOdysseyFall(state, 7)).toBe(2);
        expect(odysseyMercyDraft(state, 7)).toBeNull();
        expect(recordOdysseyFall(state, 7)).toBe(ODYSSEY_MERCY_FALLS);
        const mercy = odysseyMercyDraft(state, 7);
        expect(mercy.key).toBe(odysseyMercyDraftKey(7));
        expect(mercy.key).toBe('orb:7');
        expect(mercy.charms).toHaveLength(3);
        expect(odysseyMercyDraft(state, 8)).toBeNull();
        // Offered again on every later fall until taken or passed; a pass ends it for this orb.
        recordOdysseyFall(state, 7);
        expect(odysseyMercyDraft(state, 7)).toEqual(mercy);
        expect(passOdysseyCharm(state, mercy.key)).toBe(true);
        expect(odysseyMercyDraft(state, 7)).toBeNull();
        expect(state.falls).toEqual({ 7: 4 });
        expect(odysseyMercyDraft(null, 7)).toBeNull();
    });
});

describe('Odyssey charms: the orb as the held charms make it', () => {
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
        // Score and safety charms change nothing about the orb's asks, only mark it charmed.
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
