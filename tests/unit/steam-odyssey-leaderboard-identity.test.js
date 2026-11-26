import { describe, expect, it, vi } from 'vitest';
import { createDesktopSteamClient } from '../../electron/steam-native-client.js';
import { BOARDS } from '../../src/core/steam/steam-catalogue.js';

function fixture(platform = 'win32') {
    const win = platform === 'win32';
    let found, entryId = 102n, changed = true;
    const fn = { stats: () => 1, mm: () => 2, utils: () => 3, remote: () => 4, initFilter: vi.fn(),
        find: vi.fn((_s, name) => { found = name; return 9n; }), sort: () => BOARDS[found].sort,
        display: () => BOARDS[found].display, entries: () => 200,
        upload: vi.fn(() => 10n), download: vi.fn(() => 11n), downloadUsers: vi.fn(() => 12n),
        entry: (_s, _list, _i, buf, details) => { buf.writeBigUInt64LE(entryId);
            buf.writeInt32LE(147, 8); buf.writeInt32LE(12345, 12); buf.writeInt32LE(1, 16);
            details.writeInt32LE(-123); return true; } };
    const dispatch = { wait: vi.fn(async (_call, kind, release) => {
        const out = Buffer.alloc(40);
        if (kind === 1104) { out.writeBigUInt64LE(5n); out[8] = 1; }
        if (kind === 1105) { out.writeBigUInt64LE(5n); out.writeBigUInt64LE(7n, 8); out.writeInt32LE(1, 16); }
        if (kind === 1106) { out[0] = 1; out.writeBigUInt64LE(5n, win ? 8 : 4);
            const pos = win ? 20 : 16; out[pos] = Number(changed); out.writeInt32LE(147, pos + 4); out.writeInt32LE(180, pos + 8); }
        release?.(); return out;
    }) };
    const native = { localplayer: { getSteamId: () => ({ steamId64: 101n }) }, friends: { getFriendName: () => 'Friend' } };
    const client = createDesktopSteamClient({ native, fn, dispatch, platform, appId: 1234 });
    return { boards: client.boards, fn, dispatch, setSelf: () => { entryId = 101n; }, keep: () => { changed = false; } };
}
const name = 'OdysseyLevelTime_v7_7', details = [1, 12, 3, 7, 12345, 0, -123];
describe.each(['linux', 'win32'])('native score and rank ABI on %s', (platform) => {
    it('finds only a published board with its actual sort and display, preserves an unchanged KeepBest and both ranks', async () => {
        const f = fixture(platform);
        await expect(f.boards.upload(name, 12345, details)).resolves.toEqual({ success: true, changed: true, rank: 147, previousRank: 180 });
        f.keep();
        await expect(f.boards.upload(name, 12345, details)).resolves.toMatchObject({ success: true, changed: false });
        expect(f.fn.find).toHaveBeenCalledTimes(1);
        expect(f.fn.upload).toHaveBeenCalledWith(1, 5n, 1, 12345, Int32Array.from(details), 7);
    });
    it('uses inclusive global ranks, signed around-me bounds, real board population, and exact SteamID for self', async () => {
        const f = fixture(platform);
        const page = await f.boards.page(name, 'global', 0, 10);
        expect(f.fn.download).toHaveBeenLastCalledWith(1, 5n, 0, 1, 10);
        expect(page).toMatchObject({ total: 200, entries: [{ rank: 147, name: 'Friend', details: [-123] }] });
        await f.boards.page(name, 'around_user', 0, 10);
        expect(f.fn.download).toHaveBeenLastCalledWith(1, 5n, 1, -2, 2);
        await f.boards.page(name, 'friends', 0, 10);
        expect(f.fn.download).toHaveBeenLastCalledWith(1, 5n, 2, 1, 10);
        expect(await f.boards.self(name)).toBeNull();
        f.setSelf(); expect((await f.boards.self(name)).rank).toBe(147);
    });
    // The last is a generation of orb 7's board that the catalogue does not name (steam-catalogue.js).
    it.each(['OdysseyLevelTime_v2_7', 'OdysseyLevelTime_v6_7', 'OdysseyLevelTime_v7_39', 'OdysseyLevelTime_v0_1', 'Random', '__proto__',
        'OdysseyLevelTime_v7_7_g99'])(
        'preserves retired and malformed names locally and never creates %s on Steam', async (key) => {
            const f = fixture(platform);
            await expect(f.boards.page(key, 'global', 0, 10)).rejects.toThrow();
            expect(f.fn.find).not.toHaveBeenCalled();
        });
    it('propagates mismatched provisioning and backend errors without returning an empty page', async () => {
        const f = fixture(platform); f.fn.sort = () => 2;
        await expect(f.boards.page(name, 'global', 0, 10)).rejects.toThrow('configuration');
        f.dispatch.wait.mockRejectedValueOnce(new Error('Steam offline'));
        await expect(f.boards.page(name, 'global', 0, 10)).rejects.toThrow('offline');
    });
});
