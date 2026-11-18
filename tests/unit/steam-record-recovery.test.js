import { describe, it, expect, vi } from 'vitest';
import { mergeStatisticsSnapshots } from '../../src/core/progression/score-statistics.js';
import { assessRecords, asGuestStatistics, legacyAwards } from '../../src/core/progression/record-book.js';
import { CloudRecordGenerations } from '../../src/core/steam/cloud-record-generations.js';
import { RecordPublisher } from '../../src/core/steam/record-publisher.js';
import { createHash } from 'node:crypto';

const owner = '123/101';
const run = (score, ownerId = owner) => ({ mode: 'single', owner: ownerId, score, lines: 100, level: 1, duration: 60 });
const add = (base, id, data) => mergeStatisticsSnapshots(base, { recordBook: { runs: { [id]: data } } });
const storage = () => {
    const values = new Map();
    return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
};
function cloud() {
    const files = new Map();
    const service = {
        cloudRead: async (name) => ({ supported: true, success: true, data: files.get(name) ?? null }),
        cloudWrite: async (name, s) => { files.set(name, s); return { supported: true, success: true }; },
        cloudList: async () => [...files.keys()].map((name) => ({ name })),
    };
    return { files, service };
}
describe('record recovery', () => {
    it('converges from a known 10 to exactly 12 in either order, including repeated deliveries', () => {
        const base = { totalGames: 10, totalLines: 80 };
        const a = add(base, 'first', run(1100)), b = add(base, 'second', run(2200));
        const together = mergeStatisticsSnapshots(a, b);
        expect(together.totalGames).toBe(12); expect(together.totalLines).toBe(280);
        expect(mergeStatisticsSnapshots(b, a)).toEqual(together);
        expect(mergeStatisticsSnapshots(together, a)).toEqual(together);
        const other = add(together, 'anonymous', run(9000, null));
        expect(assessRecords(other.recordBook, owner).bests.SinglePlayerHighScore_v1.score).toBe(2200);
        expect(assessRecords(other.recordBook, owner).awards).toContain('ACH_SINGLE_100_LINES');
    });
    it('retains one verified slot per independent writer through damage and refused writes', async () => {
        const { files, service } = cloud();
        const apply = vi.fn(), quarantine = vi.fn();
        const writer = (device) => new CloudRecordGenerations({ service, device, apply, quarantine,
            hash: async (json) => createHash('sha256').update(json).digest('hex') });
        const a = writer('a'), b = writer('b');
        await Promise.all([a.write('stats.json', '{"points":10}'), b.write('stats.json', '{"points":20}')]);
        await a.write('stats.json', '{"points":12}');
        const newest = [...files].find(([key, value]) => key.includes('_a_') && JSON.parse(value).generation === 2)[0];
        files.set(newest, '{');
        expect(await writer('fresh').restore()).toBe(true);
        expect(quarantine).toHaveBeenCalled();
        expect(apply).toHaveBeenCalledWith('stats.json', { points: 12 });
        expect(apply).toHaveBeenCalledWith('stats.json', { points: 20 });
        const originals = [...files];
        service.cloudWrite = async () => ({ supported: true, success: false });
        await expect(a.write('stats.json', '{"points":42}')).rejects.toThrow();
        expect([...files]).toEqual(originals);
    });
    it('converges when two devices capture the first Steam baseline across an acknowledged finish', () => {
        const before = assessRecords().values;
        const a = mergeStatisticsSnapshots(add(null, 'first', run(1000)),
            { recordBook: { steamBase: { ...before, total_games_played: 10, best_cascade: 3 } } });
        const b = mergeStatisticsSnapshots(add(null, 'second', run(500)),
            { recordBook: { steamBase: { ...before, total_games_played: 11, best_cascade: 4 } } });
        for (const combined of [mergeStatisticsSnapshots(a,b), mergeStatisticsSnapshots(b,a)]) {
            const { values } = assessRecords(combined.recordBook, owner);
            expect(values.total_games_played).toBe(12);
            expect(values.best_cascade).toBe(4);
        }
    });
    it('backs up the shared baseline before storing absolute stats and replays a lost acknowledgement once', async () => {
        const service = { appId: 123, steamId: '101', isOnline: true, capabilities: { cloud: true } };
        let stats = add(null, 'first', run(1000));
        const before = Object.fromEntries(Object.keys(assessRecords().values).map((key) => [key, 0]));
        before.total_games_played = 10;
        let lost = true;
        const values = [];
        const backend = async (channel, data) => {
            if (channel === 'steam:getStats') return before;
            values.push(data.values.total_games_played);
            if (lost) { lost = false; throw new Error('lost acknowledgement'); }
            return true;
        };
        const publisher = new RecordPublisher(service, backend, storage());
        publisher.cloudOwner = owner;
        publisher.manager = { getStatistics: async () => stats, importStatistics: async (doc) => (stats = mergeStatisticsSnapshots(stats, doc)) };
        await publisher.flush();
        expect(values).toEqual([]);
        expect(stats.recordBook.steamBase).toEqual(before);
        publisher.cloudOwner = owner;
        await publisher.flush();
        expect(values).toEqual([]);
        publisher.baselineConfirmed = JSON.stringify(before);
        await publisher.flush(); await publisher.flush(); await publisher.flush();
        expect(values).toEqual([11, 11]);
    });
    it('retains an out-of-range local PB without truncating it for a public board', () => {
        const oversized = 2147483900;
        const snapshot = add(null, 'large', run(oversized));
        expect(snapshot.highestScore).toBe(oversized);
        expect(assessRecords(snapshot.recordBook, owner).bests.SinglePlayerHighScore_v1).toBeUndefined();
        const duration = add(null, 'long', { ...run(100), duration: oversized });
        expect(assessRecords(duration.recordBook, owner).bests.SinglePlayerHighScore_v1).toBeUndefined();
    });
    it('keeps a newer version intact even when an older valid Cloud generation exists', async () => {
        const { files, service } = cloud();
        const make = () => new CloudRecordGenerations({ service, device: 'a', apply: vi.fn(), quarantine: vi.fn(), hash: async (s) => s });
        await make().write('stats.json', '{"points":1}');
        const name = [...files.keys()][0];
        files.set(name, '{"version":999}');
        expect(await make().restore()).toBe(false);
        await expect(make().write('stats.json', '{}')).rejects.toThrow('newer');
        expect(files.get(name)).toBe('{"version":999}');
    });
    it('backfills attributable milestones without converting a guest import to public scores or counters', () => {
        expect(legacyAwards('highscores.json', { highScores: [run(1000)] })).toEqual(['ACH_SINGLE_100_LINES']);
        expect(legacyAwards('highscores.json', { recordSchema: 1, highScores: [run(1000)] })).toEqual([]);
        expect(legacyAwards('odyssey.json', { completedLevels: Object.fromEntries([1,2,3,4,5].map((id) => [id, {stars:1}])) }))
            .toEqual(['ACH_ODYSSEY_FIRST_ORB', 'ACH_ODYSSEY_CHAPTER_ONE']);
        const earned = { [owner]: ['ACH_SINGLE_100_LINES'] };
        const snapshot = mergeStatisticsSnapshots(add(null, 'old', run(1000)), { recordBook: { earned, steamBase: { total_games_played: 99 } } });
        expect(assessRecords(asGuestStatistics(snapshot).recordBook, owner).values.total_games_played).toBe(0);
        expect(assessRecords(asGuestStatistics(snapshot).recordBook, owner).awards).toEqual([]);
        expect(assessRecords(snapshot.recordBook, owner).awards).toEqual(earned[owner]);
    });
    it('waits for opt-in, serializes retries and never publishes a different account’s receipt', async () => {
        const service = { steamId: '101', appId: 123, isOnline: true, capabilities: { leaderboards: true } };
        const backend = vi.fn(async (_c, p) => ({ success: p.score !== 1 }));
        let now = 10000;
        const publisher = new RecordPublisher(service, backend, storage(), () => now);
        let stats = add(null, 'first', run(1000));
        stats = add(stats, 'foreign', run(99999, '123/102'));
        publisher.manager = { getStatistics: async () => stats };
        publisher.save({ awarded: JSON.stringify(['ACH_SINGLE_100_LINES']) });
        await publisher.flush();
        expect(backend).not.toHaveBeenCalled();
        await Promise.all([publisher.setSharing(true), publisher.flush()]);
        expect(backend.mock.calls.map(([, p]) => p.score)).toEqual([1000, 100]);
        await publisher.flush(); expect(backend).toHaveBeenCalledTimes(2);
        publisher.save({ uploads: Array(10).fill(now) });
        stats = add(stats, 'new', run(2200));
        await publisher.flush(); expect(backend).toHaveBeenCalledTimes(2);
        now += 600001;
        await publisher.flush(); expect(backend.mock.calls.at(-1)[1].score).toBe(2200);
        service.steamId = '102';
        publisher.save({ awarded: JSON.stringify(['ACH_SINGLE_100_LINES']) });
        await publisher.flush(); expect(publisher.sharing()).toBeNull();
        expect(backend).toHaveBeenCalledTimes(3);
    });
});
