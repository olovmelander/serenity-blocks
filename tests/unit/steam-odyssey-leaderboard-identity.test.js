import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { STEAM_LEADERBOARDS, STEAM_STORAGE_KEYS } from '../../src/core/steam/steam-config.js';

const nativeSource = readFileSync(new URL('../../electron/steam-integration.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');

function createNativeHarness(sortMethod) {
    const handlers = new Map();
    const exposed = {};
    const api = {
        SortMethod: sortMethod,
        findOrCreateLeaderboard: vi.fn(async (name) => name),
        uploadLeaderboardScore: vi.fn(async () => true),
        downloadLeaderboardEntries: vi.fn(async () => [
            {
                rank: 6, steamId: '76561198000000000', score: 9000, name: 'Player',
            },
        ]),
    };
    const helpersStart = nativeSource.indexOf('function getLeaderboardsApi');
    const helpersEnd = nativeSource.indexOf('// Public API', helpersStart);
    const handlersStart = nativeSource.indexOf('// --- Leaderboards ---');
    const handlersEnd = nativeSource.indexOf('// --- Cloud Storage ---', handlersStart);
    runInNewContext([
        nativeSource.slice(helpersStart, helpersEnd),
        nativeSource.slice(handlersStart, handlersEnd),
    ].join('\n'), {
        steamworksClient: { leaderboards: api },
        leaderboardHandles: new Map(),
        normalizeSteamId: (value) => value,
        ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    });
    const ipc = {
        invoke: vi.fn(async (channel, ...args) => handlers.get(channel)?.({}, ...args) ?? null),
        on: vi.fn(),
        removeListener: vi.fn(),
    };
    runInNewContext(preloadSource, {
        require: () => ({
            contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
            ipcRenderer: ipc,
        }),
        process: { argv: [] },
    });
    return { api, ipc, electronAPI: exposed.electronAPI };
}

async function createService(harness) {
    vi.stubGlobal('window', { electronAPI: harness.electronAPI });
    const { SteamService } = await import('../../src/core/steam/steam-service.js');
    const service = new SteamService();
    service.capabilitiesLoaded = true;
    service.capabilities.leaderboards = true;
    return service;
}

beforeEach(() => {
    vi.resetModules();
    const values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Odyssey campaign leaderboard identity', () => {
    it('assigns new boards to the reordered 60-orb campaign', () => {
        expect(STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX).toBe('OdysseyLevelTime_v3_');
        expect(STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS).toBe('OdysseyTotalStars_v2');
    });

    it.each(['OdysseyLevelTime_v1_42', 'OdysseyLevelTime_v2_46', 'OdysseyLevelTime_v3_60'])(
        'retains the fastest offline result and creates %s ascending',
        async (name) => {
            const harness = createNativeHarness();
            const service = await createService(harness);
            await service.uploadScore(name, 12000);
            await service.uploadScore(name, 9000);
            await service.uploadScore(name, 15000);
            expect(service.offlineQueue).toHaveLength(1);
            expect(service.offlineQueue[0].data).toMatchObject({ leaderboardName: name, score: 9000 });
            service.isOnline = true;
            await service._flushOfflineQueue();
            expect(harness.api.findOrCreateLeaderboard).toHaveBeenCalledWith(name, 1, 1);
            expect(harness.api.uploadLeaderboardScore).toHaveBeenCalledWith(name, 1, 9000, [{ flags: 8 }]);
            expect(service.offlineQueue).toHaveLength(0);
        },
    );

    it('keeps persisted old uploads on their original board when new-campaign scores arrive', async () => {
        const historical = ['OdysseyLevelTime_v1_42', 'OdysseyLevelTime_v2_46'];
        localStorage.setItem(STEAM_STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(historical.map((leaderboardName) => ({
            action: 'uploadScore', data: { leaderboardName, score: 10000 }, timestamp: Date.now(),
        }))));
        const harness = createNativeHarness();
        const service = await createService(harness);
        await service.uploadScore(historical[1], 8000);
        const current = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}46`;
        await service.uploadScore(current, 14000);
        expect(service.offlineQueue.map((entry) => entry.data.leaderboardName)).toEqual([...historical, current]);
        service.isOnline = true;
        await service._flushOfflineQueue();
        const uploads = harness.ipc.invoke.mock.calls.filter(([channel]) => channel === 'steam:uploadScore');
        expect(uploads.map(([, payload]) => [payload.leaderboardName, payload.score])).toEqual([
            [historical[0], 10000], [historical[1], 8000], [current, 14000],
        ]);
        expect(service.offlineQueue).toHaveLength(0);
    });

    it.each(['OdysseyTotalStars_v1', 'OdysseyTotalStars_v2', 'SinglePlayerHighScore_v1'])(
        'keeps higher scores on %s with descending native creation',
        async (name) => {
            const harness = createNativeHarness();
            const service = await createService(harness);
            await service.uploadScore(name, 30);
            await service.uploadScore(name, 45);
            await service.uploadScore(name, 20);
            expect(service.offlineQueue[0].data.score).toBe(45);
            service.isOnline = true;
            await service._flushOfflineQueue();
            expect(harness.api.findOrCreateLeaderboard).toHaveBeenCalledWith(name, 2, 1);
            expect(harness.api.uploadLeaderboardScore).toHaveBeenCalledWith(name, 1, 45, [{ flags: 8 }]);
        },
    );

    it('uses adapter enum values when supplied and caches handles per complete board name', async () => {
        const harness = createNativeHarness({ Ascending: 101, Descending: 202 });
        const service = await createService(harness);
        service.isOnline = true;
        await service.uploadScore('OdysseyLevelTime_v3_60', 20000);
        await service.uploadScore('OdysseyLevelTime_v3_60', 19000);
        await service.uploadScore('OdysseyTotalStars_v2', 180);
        expect(harness.api.findOrCreateLeaderboard.mock.calls).toEqual([
            ['OdysseyLevelTime_v3_60', 101, 1], ['OdysseyTotalStars_v2', 202, 1],
        ]);
        expect(harness.api.uploadLeaderboardScore).toHaveBeenCalledTimes(3);
    });

    it('reads the new board through service, preload and native handler with visible success', async () => {
        const harness = createNativeHarness();
        const service = await createService(harness);
        service.isOnline = true;
        const name = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}60`;
        const result = await service.getLeaderboard(name, 'friends', 5, 4);
        expect(harness.ipc.invoke).toHaveBeenCalledWith('steam:getLeaderboard', {
            leaderboardName: name, type: 'friends', start: 5, end: 8,
        });
        expect(harness.api.downloadLeaderboardEntries).toHaveBeenCalledWith(name, 2, 5, 8);
        expect(result).toMatchObject({
            supported: true, total: 1, entries: [{ rank: 6, score: 9000, name: 'Player' }],
        });
    });

    it('reports unsupported reads when the native download API is missing or fails', async () => {
        const harness = createNativeHarness();
        const service = await createService(harness);
        service.isOnline = true;
        harness.api.downloadLeaderboardEntries.mockRejectedValueOnce(new Error('offline'));
        expect(await service.getLeaderboard(STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS)).toEqual({
            supported: false, entries: [], total: 0,
        });
        delete harness.api.downloadLeaderboardEntries;
        expect(await service.getLeaderboard(STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS)).toEqual({
            supported: false, entries: [], total: 0,
        });
    });

    it.each(['OdysseyLevelTime_v3_total', 'OdysseyLevelTime_v3_60_extra', 'OdysseyLevelTime_v0_1'])(
        'does not classify unrelated board %s as an orb time',
        async (name) => {
            const harness = createNativeHarness();
            const service = await createService(harness);
            expect(service._getLeaderboardSort(name)).toBe('desc');
            service.isOnline = true;
            await service.uploadScore(name, 10);
            expect(harness.api.findOrCreateLeaderboard).toHaveBeenCalledWith(name, 2, 1);
        },
    );
});
