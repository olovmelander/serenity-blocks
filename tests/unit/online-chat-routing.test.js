import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';

function makeMode({ isHost }) {
    const localPlayerId = isHost ? HOST_ID : PEER_ID;
    const network = {
        isHost,
        hostSteamId: HOST_ID,
        playerName: isHost ? 'Host' : 'Peer',
        broadcastToAll: vi.fn(),
        sendP2PMessage: vi.fn(),
    };
    const mode = Object.create(OnlineMultiplayerMode.prototype);
    mode.ffaGameState = {
        localPlayerId,
        network,
        chatHistory: [],
    };
    mode.chat = { addMessage: vi.fn() };
    mode._getPlayerColor = vi.fn(() => '#123456');
    return { mode, network };
}

describe('OnlineMultiplayerMode chat routing', () => {
    it('broadcasts host chat and relays peer chat only to the host', () => {
        const { mode: hostMode, network: hostNetwork } = makeMode({ isHost: true });
        hostMode._sendChatMessage('host message');

        expect(hostNetwork.broadcastToAll).toHaveBeenCalledWith(
            MessageTypes.GAME_CHAT,
            expect.objectContaining({
                steamId: HOST_ID,
                playerName: 'Host',
                message: 'host message',
            }),
        );
        expect(hostNetwork.sendP2PMessage).not.toHaveBeenCalled();

        const { mode: peerMode, network: peerNetwork } = makeMode({ isHost: false });
        peerMode._sendChatMessage('peer message');

        expect(peerNetwork.sendP2PMessage).toHaveBeenCalledWith(
            HOST_ID,
            MessageTypes.GAME_CHAT,
            expect.objectContaining({
                steamId: PEER_ID,
                playerName: 'Peer',
                message: 'peer message',
            }),
        );
        expect(peerNetwork.broadcastToAll).not.toHaveBeenCalled();
    });
});
