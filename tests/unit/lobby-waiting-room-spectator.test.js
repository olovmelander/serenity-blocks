/**
 * The waiting room for someone who came to watch: no Ready to press (a spectator is not in
 * the roster, so the button did nothing), and a line that says what happens next.
 */
import { describe, expect, it } from 'vitest';
import { LobbyWaitingRoom } from '../../src/ui/lobby-waiting-room.js';

function makeRoom(gameState) {
    const nodes = {};
    const el = () => ({
        hidden: false,
        textContent: '',
        innerHTML: '',
        className: '',
        classList: { toggle() {} },
        setAttribute() {},
    });
    const room = Object.assign(Object.create(LobbyWaitingRoom.prototype), {
        gameState,
        container: {
            querySelector: (selector) => {
                nodes[selector] = nodes[selector] || el();
                return nodes[selector];
            },
        },
    });
    return { room, node: (id) => nodes[`#${id}`] };
}

const roster = () => new Map([
    ['H', { steamId: 'H', name: 'Host', isReady: true }],
    ['P', { steamId: 'P', name: 'Peer', isReady: false }],
]);

describe('waiting room: watching', () => {
    it('offers a spectator nothing to ready, and says the host starts the match', () => {
        const { room, node } = makeRoom({
            isHost: false,
            isSpectator: true,
            players: roster(),
            network: { hostSteamId: 'H' },
            getLocalPlayer: () => null,
            getSpectatorCount: () => 1,
        });
        room.updateControls();
        expect(node('ready-btn').hidden).toBe(true);
        expect(node('start-match-btn').hidden).toBe(true);
        expect(node('waiting-text').textContent).toBe('You are watching. The match starts when the host is ready.');
        expect(node('ready-progress-label').textContent).toBe('1 of 2 ready · 1 watching');
    });

    it('still gives a player their Ready', () => {
        const { room, node } = makeRoom({
            isHost: false,
            isSpectator: false,
            players: roster(),
            network: { hostSteamId: 'H' },
            getLocalPlayer: () => ({ steamId: 'P', isReady: false }),
        });
        room.updateControls();
        expect(node('ready-btn').hidden).toBe(false);
        expect(node('ready-btn').textContent).toBe('Ready');
        expect(node('waiting-text').textContent).toBe('Press Ready when you are set.');
    });
});
