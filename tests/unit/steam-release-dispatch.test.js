import { describe, expect, it, vi } from 'vitest';
import { createDesktopSteamClient } from '../../electron/steam-native-client.js';
import { openSteamDispatcher } from '../../electron/steam-dispatch.js';
import { createLobbyIntents, parseLobbyLaunch } from '../../electron/steam-launch-intents.js';

function harness() {
    const queue = [], memory = new Map(), results = new Map();
    let clock = 0, seq = 0;
    const fn = { pipe: () => 1, frame: vi.fn(), free: vi.fn(),
        next: (_p, msg) => { if (!queue.length) return false;
            const [kind, data] = queue.shift(); memory.set(++seq, data);
            msg.writeInt32LE(kind, 4); msg.writeBigUInt64LE(BigInt(seq), 8); msg.writeInt32LE(data.length, 16); return true; },
        result: vi.fn((_p, handle, dest) => { results.get(handle)?.copy(dest); return true; }) };
    const dispatcher = openSteamDispatcher(fn, (ptr) => memory.get(Number(ptr)), { clock: () => clock });
    function complete(id, kind, data) {
        const info = Buffer.alloc(16); info.writeBigUInt64LE(id); info.writeInt32LE(kind, 8); info.writeUInt32LE(data.length, 12);
        results.set(id, data); queue.push([703, info]);
    }
    return { dispatcher, complete, queue, fn, tick: (t) => { clock = t; dispatcher.pump(); } };
}
describe('single Steam dispatcher', () => {
    it('delivers interleaved lobby, board and unsolicited callbacks to the registered owner', async () => {
        const h = harness(), status = vi.fn();
        h.dispatcher.on(101, status);
        const a = h.dispatcher.wait(1n, 1106), b = h.dispatcher.wait(2n, 510);
        h.complete(2n, 510, Buffer.from([20])); h.queue.push([101, Buffer.alloc(0)]);
        h.complete(4n, 1106, Buffer.from([99])); h.complete(1n, 1106, Buffer.from([31])); h.tick(0);
        expect([...(await a)]).toEqual([31]); expect([...(await b)]).toEqual([20]);
        expect(h.fn.free).toHaveBeenCalledTimes(4); expect(h.fn.result).toHaveBeenCalledTimes(2); expect(status).toHaveBeenCalledOnce();
    });
    it('exposes timeout but retains native ownership until the late completion or shutdown', async () => {
        const h = harness(), retired = vi.fn();
        const call = h.dispatcher.wait(7n, 1106, retired);
        h.tick(30001); await expect(call).rejects.toThrow('timed out'); expect(retired).not.toHaveBeenCalled();
        h.complete(7n, 1106, Buffer.alloc(1)); h.tick(30002); expect(retired).toHaveBeenCalledOnce();
        const other = h.dispatcher.wait(8n, 510); h.dispatcher.close(); await expect(other).rejects.toThrow('ended');
    });
    it('confirms an absolute stats store only on the matching game, successful result and read-back', async () => {
        const h = harness();
        const stats = new Map([['total_games_played', 10]]);
        const earned = new Set();
        const fn = { stats: () => 1, mm: () => 2, utils: () => 3, remote: () => 4, initFilter: vi.fn(),
            award: (_s, id) => { earned.add(id); return true; }, statsStore: vi.fn(() => true) };
        const native = { localplayer: { getSteamId: () => ({ steamId64: 101n }) },
            stats: { getInt: (name) => stats.get(name), setInt: (name, v) => { stats.set(name, v); return true; } },
            achievement: { isActivated: (id) => earned.has(id) } };
        const client = createDesktopSteamClient({native, fn, dispatch: h.dispatcher, platform: 'win32', appId: 123});
        const confirm = (appId, result) => {
            const buf = Buffer.alloc(16);
            buf.writeBigUInt64LE(BigInt(appId)); buf.writeInt32LE(result, 8);
            h.queue.push([1102, buf]); h.tick(1);
        };
        const pending = client.commitStats({ total_games_played: 12 }, ['ACH_SINGLE_100_LINES']);
        confirm(999, 1);
        await expect(client.commitStats({}, [])).rejects.toThrow('in progress');
        confirm(123, 1);
        await expect(pending).resolves.toBe(true);
        const retry = client.commitStats({ total_games_played: 12 }, []);
        confirm(123, 2);
        await expect(retry).rejects.toThrow('result 2');
        const unread = client.commitStats({ total_games_played: 12 }, []);
        stats.delete('total_games_played');
        confirm(123, 1);
        await expect(unread).rejects.toThrow('read-back');
        client.retire();
    });
    it('delivers a cold join once after renderer startup and validates full 64-bit IDs', () => {
        const box = createLobbyIntents(), id = '109775240987654321';
        expect(parseLobbyLaunch(['game.exe', '+connect_lobby', id])).toBe(id);
        expect(parseLobbyLaunch('+connect_lobby 18446744073709551616')).toBeNull();
        box.offer(id, '12', 'cold'); box.offer(id, '12', 'callback'); expect(box.list()).toHaveLength(1);
        box.ack(id); box.offer(id, '12', 'repeated'); expect(box.list()).toEqual([]);
    });
});
