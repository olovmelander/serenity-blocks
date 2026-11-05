/**
 * What Steam Cloud's merges must not do to a player's save, with the real sync manager, the real
 * Odyssey state and the real score import over a small in-memory store.
 *
 * Every Odyssey upload merges the cloud copy first, as a union: right for progress, which only
 * grows, and wrong for what can go down. A plain spread let the older cloud copy win the charm bag
 * and the arrival mark on every save, and New Journey came back seconds later. The score merge
 * kept 100 scores overall where the store keeps 100 per mode, and rewrote the store from a list
 * with every replay link stripped.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';

const steam = vi.hoisted(() => ({
    cloud: new Map(),
    getCapabilities: vi.fn(() => ({ cloud: true })),
    isAvailable: vi.fn(() => true),
    waitForInit: vi.fn(async () => true),
    cloudRead: vi.fn(),
    cloudWrite: vi.fn(),
    on: vi.fn(),
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

const ODYSSEY = 'odyssey.json';
const CLEAR = {
    stars: 3, score: 1000, time: 60, lines: 10, combo: 2,
};

let syncs;

function device({ highScoreManager } = {}) {
    const values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    });
    const state = new OdysseyStateManager();
    const sync = new SteamCloudSyncManager({ getOdysseyState: () => state, highScoreManager });
    syncs.push(sync);
    return { state, sync, saved: () => JSON.parse(values.get('serenityBlocks_odysseyProgress')) };
}

const upload = (sync, file = ODYSSEY) => sync.queueUpload(file, { flush: true });
const cloudDoc = (file = ODYSSEY) => JSON.parse(steam.cloud.get(file));
const bagOf = (state) => JSON.stringify(state.getCharmBag());

function odysseyDoc(overrides = {}) {
    return {
        version: 5,
        currentChapter: 1,
        currentLevel: 1,
        unlockedLevels: [1],
        completedLevels: {},
        retiredCompletions: {},
        statistics: {},
        onboarding: { arrivalSeen: false },
        charms: {
            bag: {}, found: 0, used: 0, streak: { levelId: null, falls: 0 },
        },
        lastSaveDate: '2026-11-01T10:00:00.000Z',
        ...overrides,
    };
}

const charms = (found, used, bag = {}, falls = 0) => ({
    bag, found, used, streak: { levelId: falls ? 7 : null, falls },
});

beforeEach(() => {
    syncs = [];
    steam.cloud.clear();
    steam.cloudRead.mockImplementation(async (file) => ({
        supported: true, success: true, data: steam.cloud.get(file) ?? null, missing: !steam.cloud.has(file),
    }));
    steam.cloudWrite.mockImplementation(async (file, data) => {
        steam.cloud.set(file, data);
        return { supported: true, success: true };
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    syncs.forEach((sync) => clearTimeout(sync.flushTimer));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Odyssey charms through a cloud upload', () => {
    it('keeps the charms found since the last upload', async () => {
        const { state, sync } = device();
        state.save();
        await upload(sync);

        state.completeLevel(1, CLEAR);
        state.completeLevel(2, CLEAR);
        const bag = bagOf(state);
        const stats = state.getCharmStats();
        expect(stats.found).toBeGreaterThan(0);
        await upload(sync);

        expect(bagOf(state)).toBe(bag);
        expect(state.getCharmStats()).toEqual(stats);
        expect(cloudDoc().charms.found).toBe(stats.found);
    });

    it('does not hand a spent charm back', async () => {
        const { state, sync } = device();
        state.completeLevel(1, CLEAR);
        await upload(sync);
        const [{ id }] = state.getCharmBag();
        const before = state.getCharmCount(id);

        expect(state.spendCharm(id)).toBe(true);
        await upload(sync);

        expect(state.getCharmCount(id)).toBe(before - 1);
        expect(state.getCharmStats().used).toBe(1);
    });

    it('keeps the falls that count toward a pity charm', async () => {
        const { state, sync } = device();
        state.save();
        await upload(sync);

        state.recordAttempt(15);
        await upload(sync);
        state.recordAttempt(15);
        await upload(sync);

        expect(cloudDoc().charms.streak).toEqual({ levelId: 15, falls: 2 });
    });

    it('takes the charms of a device further along, whichever side it is', () => {
        const { sync } = device();
        const behind = odysseyDoc({ charms: charms(2, 0, { tide: 2 }) });
        const ahead = odysseyDoc({ charms: charms(5, 2, { tide: 3 }), lastSaveDate: '2026-10-01T10:00:00.000Z' });

        expect(sync._mergeOdyssey(behind, ahead).charms.found).toBe(5);
        expect(sync._mergeOdyssey(ahead, behind).charms.found).toBe(5);
    });

    it('is not fooled by a merge that restamped a stale copy', () => {
        const { sync } = device();
        const stale = odysseyDoc({ charms: charms(1, 0, { tide: 1 }), lastSaveDate: '2026-12-01T10:00:00.000Z' });
        const current = odysseyDoc({ charms: charms(4, 1, { tide: 3 }), lastSaveDate: '2026-11-01T10:00:00.000Z' });

        expect(sync._mergeOdyssey(stale, current).charms.found).toBe(4);
    });

    it('goes by the later save when both have seen as many charms, as after a fall', () => {
        const { sync } = device();
        const earlier = odysseyDoc({ charms: charms(3, 1, {}, 1), lastSaveDate: '2026-11-01T10:00:00.000Z' });
        const later = odysseyDoc({ charms: charms(3, 1, {}, 2), lastSaveDate: '2026-11-02T10:00:00.000Z' });

        expect(sync._mergeOdyssey(earlier, later).charms.streak.falls).toBe(2);
        expect(sync._mergeOdyssey(later, earlier).charms.streak.falls).toBe(2);
    });

    it('survives a document without charms, from before they were saved', () => {
        const { sync } = device();
        const old = odysseyDoc();
        delete old.charms;
        const current = odysseyDoc({ charms: charms(2, 0, { tide: 2 }) });

        expect(sync._mergeOdyssey(old, current).charms.found).toBe(2);
        expect(sync._mergeOdyssey(current, old).charms.found).toBe(2);
    });
});

describe('the Odyssey arrival mark', () => {
    it('stays seen through an upload', async () => {
        const { state, sync } = device();
        state.save();
        await upload(sync);

        state.markArrivalSeen();
        state.save(); // the mark travels with the next save
        await upload(sync);

        expect(state.hasSeenArrival()).toBe(true);
        expect(cloudDoc().onboarding.arrivalSeen).toBe(true);
    });

    it('is seen when either device has seen it', () => {
        const { sync } = device();
        const seen = odysseyDoc({ onboarding: { arrivalSeen: true } });
        const unseen = odysseyDoc();

        expect(sync._mergeOdyssey(seen, unseen).onboarding.arrivalSeen).toBe(true);
        expect(sync._mergeOdyssey(unseen, seen).onboarding.arrivalSeen).toBe(true);
    });
});

describe('New Journey with Steam Cloud on', () => {
    async function journeyInTheCloud() {
        const dev = device();
        [1, 2, 3].forEach((id) => dev.state.completeLevel(id, { ...CLEAR, stars: 2 }));
        dev.state.markArrivalSeen();
        await upload(dev.sync);
        return dev;
    }

    it('survives the upload that follows it', async () => {
        const { state, sync } = await journeyInTheCloud();

        state.reset();
        state.save();
        await upload(sync);

        expect(state.completedLevels.size).toBe(0);
        expect(state.currentLevel).toBe(1);
        expect([...state.unlockedLevels]).toEqual([1]);
        expect(state.getCharmStats().found).toBe(0);
        expect(state.hasSeenArrival()).toBe(false);
        expect(Object.keys(cloudDoc().completedLevels)).toEqual([]);
    });

    it('reaches the player\'s other device, however far along that device is', () => {
        const { sync } = device();
        const erased = odysseyDoc({ journeyStartedAt: '2026-11-05T09:00:00.000Z' });
        const old = odysseyDoc({
            unlockedLevels: [1, 2, 3],
            completedLevels: { 1: { stars: 3, bestScore: 1 }, 2: { stars: 3, bestScore: 1 } },
            currentLevel: 3,
            lastSaveDate: '2026-11-05T10:00:00.000Z',
        });

        [sync._mergeOdyssey(old, erased), sync._mergeOdyssey(erased, old)].forEach((merged) => {
            expect(merged.completedLevels).toEqual({});
            expect(merged.unlockedLevels).toEqual([1]);
            expect(merged.currentLevel).toBe(1);
            expect(merged.journeyStartedAt).toBe('2026-11-05T09:00:00.000Z');
        });
    });

    it('lets the later of two new journeys stand', () => {
        const { sync } = device();
        const first = odysseyDoc({
            journeyStartedAt: '2026-11-01T09:00:00.000Z', unlockedLevels: [1, 2], currentLevel: 2,
        });
        const second = odysseyDoc({ journeyStartedAt: '2026-11-03T09:00:00.000Z' });

        expect(sync._mergeOdyssey(first, second).journeyStartedAt).toBe('2026-11-03T09:00:00.000Z');
        expect(sync._mergeOdyssey(second, first).unlockedLevels).toEqual([1]);
    });

    it('still unions progress within one journey, on both devices', () => {
        const { sync } = device();
        const journeyStartedAt = '2026-11-01T09:00:00.000Z';
        const here = odysseyDoc({
            journeyStartedAt, unlockedLevels: [1, 2], completedLevels: { 1: { stars: 2, bestScore: 10 } },
        });
        const there = odysseyDoc({
            journeyStartedAt, unlockedLevels: [1, 2, 3], completedLevels: { 2: { stars: 1, bestScore: 5 } },
        });

        const merged = sync._mergeOdyssey(here, there);

        expect(Object.keys(merged.completedLevels).sort()).toEqual(['1', '2']);
        expect(merged.unlockedLevels.sort()).toEqual([1, 2, 3]);
    });

    it('still unions two saves from before journeys were stamped', () => {
        const { sync } = device();
        const here = odysseyDoc({ completedLevels: { 1: { stars: 2, bestScore: 10 } } });
        const there = odysseyDoc({ completedLevels: { 2: { stars: 1, bestScore: 5 } } });

        expect(Object.keys(sync._mergeOdyssey(here, there).completedLevels).sort()).toEqual(['1', '2']);
    });

    it('keeps the stamp through a save and a load', () => {
        const { state, saved } = device();
        state.reset();
        state.save();
        const stamp = saved().journeyStartedAt;
        expect(typeof stamp).toBe('string');

        state.load();
        state.save();

        expect(saved().journeyStartedAt).toBe(stamp);
    });
});
