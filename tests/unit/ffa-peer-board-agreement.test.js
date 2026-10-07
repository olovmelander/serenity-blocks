/**
 * The peer-owns-board backstop compares a peer's own board with the host's copy only at
 * the same piece. A host that is merely behind (a gravity lock it has yet to make) is
 * not a divergence; a different score at the same piece is.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    PeerBoardHistory,
    checkPeerBoardAgreement,
    pieceSequenceKey,
} from '../../src/core/multiplayer/ffa/peer-board-agreement.js';

const BAG = ['T', 'O', 'S', 'Z', 'I', 'J', 'L', 'T', 'O'];

/** A board on piece `index` of the bag, with `locks` pieces locked so far. */
function board(index, score, lines = 0) {
    return {
        score,
        lines,
        isProcessingPhysics: false,
        currentPiece: { type: BAG[index] },
        nextPieces: BAG.slice(index + 1),
    };
}

function makeGame() {
    const own = { gameState: board(0, 0) };
    return {
        localPlayerId: 'ME',
        roundGeneration: 2,
        players: new Map([['ME', own]]),
        own,
        _requestResync: vi.fn(),
    };
}

const snapshot = (hostView) => ({ players: [{ steamId: 'ME', ...hostView }] });

afterEach(() => {
    vi.restoreAllMocks();
});

describe('pieceSequenceKey', () => {
    it('names a point in the sequence by the falling piece and the queue', () => {
        expect(pieceSequenceKey(board(0, 0))).toBe('T|OSZI');
        expect(pieceSequenceKey(board(1, 0))).toBe('O|SZIJ');
        expect(pieceSequenceKey({ ...board(0, 0), currentPiece: null })).toBeNull();
    });
});

describe('the peer-owns-board backstop', () => {
    it('does not read a host one lock behind as a divergence (the 50-point false alarm)', () => {
        const game = makeGame();
        checkPeerBoardAgreement(game, snapshot(board(0, 0)), 10_000);
        // We locked the T (+50) and play the O; the host's copy still drops the T.
        game.own.gameState = board(1, 50);
        for (let i = 0; i < 5; i += 1) {
            expect(checkPeerBoardAgreement(game, snapshot(board(0, 0)), 10_000 + i * 33)).toBe('agree');
        }
        expect(game._requestResync).not.toHaveBeenCalled();
    });

    it('asks for one resync when the host\'s copy differs at the same piece', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const game = makeGame();
        game.own.gameState = board(1, 50);
        const verdicts = [0, 1, 2].map((i) => checkPeerBoardAgreement(game, snapshot(board(1, 100)), 10_000 + i));
        expect(verdicts).toEqual(['differ', 'differ', 'differ']);
        expect(game._requestResync).toHaveBeenCalledTimes(1);
        // Rate-limited, and the history starts over after asking.
        checkPeerBoardAgreement(game, snapshot(board(1, 100)), 10_100);
        expect(game._requestResync).toHaveBeenCalledTimes(1);
    });

    it('lets an agreeing comparison clear a run of differences', () => {
        const game = makeGame();
        game.own.gameState = board(1, 50);
        checkPeerBoardAgreement(game, snapshot(board(1, 100)), 1);
        checkPeerBoardAgreement(game, snapshot(board(1, 100)), 2);
        expect(checkPeerBoardAgreement(game, snapshot(board(1, 50)), 3)).toBe('agree');
        checkPeerBoardAgreement(game, snapshot(board(1, 100)), 4);
        expect(game._requestResync).not.toHaveBeenCalled();
    });

    it('forgets the last round: a new round\'s sequence starts over', () => {
        const history = new PeerBoardHistory();
        history.record(board(0, 900), 1);
        history.record(board(0, 0), 2);
        expect(history.compare(board(0, 0))).toBe('agree');
    });

    it('does not record or compare mid-cascade', () => {
        const history = new PeerBoardHistory();
        history.record({ ...board(0, 0), isProcessingPhysics: true }, 0);
        expect(history.compare(board(0, 0))).toBeNull();
    });
});
