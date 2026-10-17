/**
 * Steam Cloud keeps every device's scores, stats and settings (audit
 * 2026-10-13: SCORE-01, SCORE-04).
 *
 * Two devices share one in-memory cloud. Each has its own localStorage (cloud
 * manifest and device id), settings and score store. The fake score store
 * imports the way HighScoreManager does: scores as a deduplicated top-100
 * union, stats through the same mergeStatisticsSnapshots.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { createEmptyStatistics, mergeStatisticsSnapshots } from '../../src/core/progression/score-statistics.js';

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

const HOUR = 60 * 60 * 1000;
let clock;
let managers;

const scoreKey = (entry) => [entry.score, entry.lines, entry.level, entry.timestamp].join('|');
const cloudDoc = (file) => JSON.parse(steam.cloud.get(file));

function createDevice({ settings = {} } = {}) {
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
    const state = {
        scores: [],
        stats: createEmptyStatistics(),
        settings: {
            musicVolume: 0.7,
            keyBindings: { moveLeft: 'ArrowLeft' },
            player2KeyBindings: {},
            serenityKeyBindings: {},
            serenityGamepadBindings: {},
            ...settings,
        },
    };
    const highScoreManager = {
        exportHighScores: async (limit = 100) => state.scores.slice(0, limit).map((entry) => ({ ...entry })),
        importHighScores: async (entries, { merge = true } = {}) => {
            const seen = new Set();
            state.scores = [...(merge ? state.scores : []), ...entries]
                .filter((entry) => !seen.has(scoreKey(entry)) && seen.add(scoreKey(entry)))
                .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
                .slice(0, 100);
            return state.scores.length;
        },
        exportStatistics: async () => structuredClone(state.stats),
        importStatistics: async (incoming, { merge = true } = {}) => {
            state.stats = mergeStatisticsSnapshots(merge ? state.stats : null, incoming);
            return state.stats;
        },
    };
    const settingsManager = {
        get: () => state.settings,
        update: (next) => { state.settings = { ...next }; },
        save: () => true,
        dirtyKeys: new Set(),
        flushPendingSave: () => false,
    };
    vi.stubGlobal('localStorage', storage);
    const manager = new SteamCloudSyncManager({ highScoreManager, settingsManager, now: () => clock });
    managers.push(manager);
    return {
        state,
        manager,
        // The manager reads its manifest from the global localStorage.
        async run(action) {
            vi.stubGlobal('localStorage', storage);
            return action(manager);
        },
        // What HighScoreManager.saveScore records for one finished game.
        play(score, { lines = 10, level = 2 } = {}) {
            clock += 1000;
            const entry = { score, lines, level, timestamp: clock };
            state.scores = [...state.scores, entry].sort((a, b) => b.score - a.score);
            state.stats = {
                ...state.stats,
                totalGames: state.stats.totalGames + 1,
                totalScore: state.stats.totalScore + score,
                totalLines: state.stats.totalLines + lines,
                highestScore: Math.max(state.stats.highestScore, score),
                highestLevel: Math.max(state.stats.highestLevel, level),
            };
        },
        // HIGH_SCORE_SAVED queues both documents; flush instead of debouncing.
        async uploadRecords() {
            await this.run(async (m) => {
                await m.queueUpload('highscores.json', { flush: true });
                await m.queueUpload('stats.json', { flush: true });
            });
        },
        sync() {
            clock += HOUR;
            return this.run((m) => m.syncFromCloud());
        },
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    clock = Date.parse('2026-10-01T12:00:00Z');
    managers = [];
    steam.cloud.clear();
    steam.cloudRead.mockReset().mockImplementation(async (file) => ({
        supported: true, success: true, data: steam.cloud.get(file) ?? null,
    }));
    steam.cloudWrite.mockReset().mockImplementation(async (file, data) => {
        steam.cloud.set(file, data);
        return { supported: true, success: true };
    });
});

afterEach(() => {
    managers.forEach((manager) => clearTimeout(manager.flushTimer));
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Steam Cloud scores, stats and settings across devices', () => {
    it("downloads the cloud copy on a new device's first sync instead of replacing it", async () => {
        const original = createDevice({ settings: { musicVolume: 0.2, keyBindings: { moveLeft: 'a' } } });
        original.play(50000);
        original.play(42000);
        await original.sync();

        const fresh = createDevice();
        await fresh.sync();

        expect(fresh.state.scores.map((entry) => entry.score)).toEqual([50000, 42000]);
        expect(fresh.state.stats).toMatchObject({ totalGames: 2, totalScore: 92000, highestScore: 50000 });
        expect(fresh.state.settings).toMatchObject({ musicVolume: 0.2, keyBindings: { moveLeft: 'a' } });
        expect(cloudDoc('highscores.json').highScores).toHaveLength(2);
        expect(cloudDoc('stats.json').stats.totalGames).toBe(2);
        expect(cloudDoc('keybinds.json').keyBindings.moveLeft).toBe('a');

        await original.sync();
        expect(original.state.settings).toMatchObject({ musicVolume: 0.2, keyBindings: { moveLeft: 'a' } });
    });

    it('counts each game once across devices, and syncs without play change nothing', async () => {
        const first = createDevice();
        for (let game = 0; game < 10; game += 1) first.play(1000);
        await first.sync();

        const second = createDevice();
        await second.sync();
        expect(second.state.stats.totalGames).toBe(10);
        for (let game = 0; game < 3; game += 1) second.play(2000);
        await second.uploadRecords();

        await first.sync();
        for (let round = 0; round < 3; round += 1) {
            await first.sync();
            await second.sync();
        }

        for (const stats of [first.state.stats, second.state.stats, cloudDoc('stats.json').stats]) {
            expect(stats).toMatchObject({ totalGames: 13, totalScore: 16000, totalLines: 130 });
        }
    });

    it("keeps another device's scores when a game is uploaded before the first sync", async () => {
        const original = createDevice();
        original.play(50000);
        original.play(42000);
        await original.sync();

        const fresh = createDevice();
        fresh.play(900);
        await fresh.uploadRecords();

        expect(cloudDoc('highscores.json').highScores.map((entry) => entry.score)).toEqual([50000, 42000, 900]);
        expect(fresh.state.scores.map((entry) => entry.score)).toEqual([50000, 42000, 900]);
    });

    it('holds a score upload until the remote copy can be read', async () => {
        const original = createDevice();
        original.play(50000);
        await original.sync();

        const fresh = createDevice();
        fresh.play(900);
        const scoreWrites = () => steam.cloudWrite.mock.calls.filter(([file]) => file === 'highscores.json');
        const writesBefore = scoreWrites().length;
        steam.cloudRead.mockResolvedValueOnce({ supported: false, data: null });
        await fresh.run((m) => m.queueUpload('highscores.json', { flush: true }));
        expect(scoreWrites()).toHaveLength(writesBefore);
        expect(cloudDoc('highscores.json').highScores.map((entry) => entry.score)).toEqual([50000]);
        expect(fresh.manager.pendingUploads.has('highscores.json')).toBe(true);

        await fresh.run((m) => m._flushPendingUploads());
        expect(cloudDoc('highscores.json').highScores.map((entry) => entry.score)).toEqual([50000, 900]);
        expect(fresh.manager.pendingUploads.has('highscores.json')).toBe(false);
    });

    it('never queues a blind offline write for scores or stats', async () => {
        const device = createDevice();
        device.play(900);
        await device.uploadRecords();
        const recordWrites = steam.cloudWrite.mock.calls
            .filter(([file]) => file === 'highscores.json' || file === 'stats.json');
        expect(recordWrites).toHaveLength(2);
        for (const [, , options] of recordWrites) expect(options).toEqual({ queueIfOffline: false });
    });
});

describe('mergeStatisticsSnapshots', () => {
    it('keeps the larger value of every counter and per-level best', () => {
        expect(mergeStatisticsSnapshots(
            {
                totalGames: 10, totalScore: 500, totalLines: 40, highestScore: 90, highestLevel: 3,
                bestScorePerLevel: { 1: 50, 3: 90 },
            },
            {
                totalGames: 7, totalScore: 900, totalLines: 41, highestScore: 80, highestLevel: 5,
                bestScorePerLevel: { 1: 60, 5: 80 },
            },
        )).toEqual({
            id: 'stats',
            totalGames: 10,
            totalScore: 900,
            totalLines: 41,
            highestScore: 90,
            highestLevel: 5,
            bestScorePerLevel: { 1: 60, 3: 90, 5: 80 },
            // Neither snapshot has per-mode counters, so both histories count as Single Player.
            byMode: {
                single: {
                    totalGames: 10, totalScore: 900, totalLines: 41, highestScore: 90, highestLevel: 5,
                },
            },
        });
    });

    it('is idempotent and normalizes a single or malformed snapshot', () => {
        const stats = { ...createEmptyStatistics(), totalGames: 4, bestScorePerLevel: { 2: 30 } };
        expect(mergeStatisticsSnapshots(stats, stats)).toEqual(mergeStatisticsSnapshots(null, stats));
        expect(mergeStatisticsSnapshots(null, { totalGames: '3', totalScore: -5, highestLevel: Number.NaN }))
            .toEqual({
                ...createEmptyStatistics(),
                totalGames: 3,
                byMode: {
                    single: {
                        totalGames: 3, totalScore: 0, totalLines: 0, highestScore: 0, highestLevel: 0,
                    },
                },
            });
        expect(mergeStatisticsSnapshots(undefined, undefined)).toEqual(createEmptyStatistics());
    });
});
