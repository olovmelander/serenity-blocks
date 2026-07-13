import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';

function makePeer() {
    const network = new SteamNetworking();
    network.steamId = PEER_ID;
    network.isHost = false;
    network.hostSteamId = HOST_ID;
    network.sendP2PMessage = vi.fn(() => true);
    return network;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('SteamNetworking resync request transport boundary', () => {
    it('sends and counts the first request even when the monotonic test clock is zero', () => {
        vi.spyOn(Date, 'now').mockReturnValue(0);
        const network = makePeer();

        expect(network.requestResync(HOST_ID, 'sim_clock_warp')).toBe(true);
        expect(network.sendP2PMessage).toHaveBeenCalledOnce();
        expect(network.sendP2PMessage).toHaveBeenCalledWith(
            HOST_ID,
            MessageTypes.GAME_STATE_RESYNC_ACK,
            { requestResync: true, reason: 'sim_clock_warp' },
        );
        expect(network.getPacketStats()).toMatchObject({
            resyncRequestsSent: 1,
            resyncRequestsSuppressed: 0,
        });
        expect(network.lastResyncRequestAt.get(HOST_ID)).toBe(0);
    });

    it('suppresses and counts a duplicate inside the keyframe interval', () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(0);
        const network = makePeer();
        expect(network.requestResync(HOST_ID, 'sim_clock_warp')).toBe(true);

        now.mockReturnValue(network.fullSnapshotIntervalMs - 1);
        expect(network.requestResync(HOST_ID, 'sim_clock_warp')).toBe(false);
        expect(network.sendP2PMessage).toHaveBeenCalledOnce();
        expect(network.getPacketStats()).toMatchObject({
            resyncRequestsSent: 1,
            resyncRequestsSuppressed: 1,
        });
    });

    it('admits a request exactly at the keyframe-interval boundary', () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(0);
        const network = makePeer();
        expect(network.requestResync(HOST_ID, 'sim_clock_warp')).toBe(true);

        now.mockReturnValue(network.fullSnapshotIntervalMs);
        expect(network.requestResync(HOST_ID, 'sim_clock_warp')).toBe(true);
        expect(network.sendP2PMessage).toHaveBeenCalledTimes(2);
        expect(network.getPacketStats()).toMatchObject({
            resyncRequestsSent: 2,
            resyncRequestsSuppressed: 0,
        });
    });

    it('fails closed for a host role, stale host ID, and self-targeting peer role', () => {
        vi.spyOn(Date, 'now').mockReturnValue(0);
        const network = makePeer();

        expect(network.requestResync('OLD_HOST', 'sim_clock_warp')).toBe(false);
        network.hostSteamId = PEER_ID;
        expect(network.requestResync(PEER_ID, 'sim_clock_warp')).toBe(false);
        network.isHost = true;
        network.hostSteamId = HOST_ID;
        expect(network.requestResync(HOST_ID, 'sim_clock_warp')).toBe(false);

        expect(network.sendP2PMessage).not.toHaveBeenCalled();
        expect(network.getPacketStats()).toMatchObject({
            resyncRequestsSent: 0,
            resyncRequestsSuppressed: 0,
        });
        expect(network.lastResyncRequestAt.size).toBe(0);
    });

    it('keeps decoder callers on the public role-checked implementation', () => {
        const network = makePeer();
        const requestResync = vi.spyOn(network, 'requestResync').mockReturnValue(true);

        expect(network._requestResync(HOST_ID, 'delta_decode_failed')).toBe(true);
        expect(requestResync).toHaveBeenCalledWith(HOST_ID, 'delta_decode_failed');
    });
});
