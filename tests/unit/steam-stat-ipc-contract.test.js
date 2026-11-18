import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../electron/steam-integration.js', import.meta.url), 'utf8');

function createStatsHarness(storeBuild = false) {
    const handlers = new Map();
    const stats = {
        getInt: vi.fn(() => 10),
        setInt: vi.fn(() => true),
        store: vi.fn(() => true),
    };
    const helperStart = source.indexOf('function normalizeStatArgs');
    const helperEnd = source.indexOf('function resolveCloudWriteBuffer', helperStart);
    const handlersStart = source.indexOf('// --- Stats ---');
    const handlersEnd = source.indexOf('// --- Leaderboards ---', handlersStart);
    runInNewContext([
        source.slice(helperStart, helperEnd),
        source.slice(handlersStart, handlersEnd),
    ].join('\n'), {
        steamworksClient: { stats },
        app: { isPackaged: storeBuild }, isStoreBuild: () => storeBuild,
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    });
    return { stats, invoke: (channel, ...args) => handlers.get(channel)({}, ...args) };
}

describe('native Steam stat write results', () => {
    it.each(['steam:setStat', 'steam:setStatMax', 'steam:incrementStat'])(
        '%s does not acknowledge or store a rejected stat write', (channel) => {
            const { stats, invoke } = createStatsHarness();
            stats.setInt.mockReturnValue(false);
            expect(invoke(channel, 'total_score', 20)).toBe(false);
            expect(stats.setInt).toHaveBeenCalledOnce();
            expect(stats.store).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['steam:setStat', { name: 'total_score', value: 20.9 }, 20],
        ['steam:setStatMax', { name: 'total_score', value: 20.9 }, 20],
        ['steam:incrementStat', { name: 'total_score', amount: 20.9 }, 30],
    ])('%s preserves accepted writes and reports store failures', (channel, payload, expected) => {
        const { stats, invoke } = createStatsHarness();
        expect(invoke(channel, payload)).toBe(true);
        expect(stats.setInt).toHaveBeenLastCalledWith('total_score', expected);
        expect(stats.store).toHaveBeenCalledOnce();
        stats.store.mockReturnValue(false);
        expect(invoke(channel, payload)).toBe(false);
    });

    it('reserves stores and cumulative counters for the receipt publisher in a store build', () => {
        const { stats, invoke } = createStatsHarness(true);
        for (const channel of ['steam:setStat', 'steam:setStatMax', 'steam:incrementStat', 'steam:storeStats']) {
            expect(invoke(channel, 'total_games_played', 1)).toBe(false);
        }
        expect(stats.setInt).not.toHaveBeenCalled();
        expect(stats.store).not.toHaveBeenCalled();
    });

    it('keeps an existing maximum without writing a lower value', () => {
        const { stats, invoke } = createStatsHarness();
        expect(invoke('steam:setStatMax', 'total_score', 9)).toBe(true);
        expect(stats.setInt).not.toHaveBeenCalled();
        expect(stats.store).not.toHaveBeenCalled();
    });
});
