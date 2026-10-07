// @ts-check

/**
 * The peer-owns-board backstop. A peer simulates its own board; the host keeps a copy
 * of it a little behind. The two can only be compared at the same point in the piece
 * sequence, so the peer remembers its own score and lines for each recent piece and
 * checks the host's copy against its record for the piece that copy is playing.
 *
 * Comparing whenever the host had applied every input instead read a gravity lock the
 * host had yet to make as a divergence: one lock's points apart, even on a clean link.
 * Each of those froze the player's input for an exact resync.
 */

/** Pieces of the queue, after the falling one, that name a point in the sequence. */
const QUEUE_DEPTH = 4;
/** Recent pieces remembered; the host's copy is never this far behind. */
const HISTORY_LIMIT = 24;
/** Differing comparisons in a row before a resync is asked for. */
export const PEER_DIVERGENCE_RUN = 3;
/** At most one resync request per this long. */
export const PEER_RESYNC_COOLDOWN_MS = 3000;

/**
 * Where in the piece sequence a board stands: its falling piece and the queue after it.
 * @param {Record<string, any>|null|undefined} board
 * @returns {string|null} null without a falling piece (between pieces, or mid-cascade)
 */
export function pieceSequenceKey(board) {
    const piece = board?.currentPiece;
    const type = piece?.type ?? piece?.shapeKey;
    const queue = board?.nextPieces;
    if (!type || !Array.isArray(queue) || queue.length < QUEUE_DEPTH) return null;
    return `${type}|${queue.slice(0, QUEUE_DEPTH).join('')}`;
}

export class PeerBoardHistory {
    constructor(limit = HISTORY_LIMIT) {
        this.limit = limit;
        /** @type {number|null} the round the records belong to */
        this.roundGeneration = null;
        /** @type {Map<string, {score: unknown, lines: unknown}>} */
        this.byPiece = new Map();
    }

    /**
     * Remember this peer's own score and lines for the piece it is playing.
     * @param {Record<string, any>|null|undefined} gameState
     * @param {number} [roundGeneration] a new round's sequence starts over: forget the last
     */
    record(gameState, roundGeneration = 0) {
        if (roundGeneration !== this.roundGeneration) {
            this.byPiece.clear();
            this.roundGeneration = roundGeneration;
        }
        if (!gameState || gameState.isProcessingPhysics === true) return;
        const key = pieceSequenceKey(gameState);
        if (!key) return;
        this.byPiece.delete(key);
        this.byPiece.set(key, { score: gameState.score, lines: gameState.lines });
        if (this.byPiece.size > this.limit) this.byPiece.delete(this.byPiece.keys().next().value);
    }

    /**
     * The host's copy of this player against our record of the same piece.
     * @param {Record<string, any>|null|undefined} hostView
     * @returns {'agree'|'differ'|null} null when we have no record of that piece
     */
    compare(hostView) {
        const key = pieceSequenceKey(hostView);
        const mine = key ? this.byPiece.get(key) : undefined;
        if (!mine || !hostView) return null;
        return mine.score === hostView.score && mine.lines === hostView.lines ? 'agree' : 'differ';
    }

    clear() {
        this.byPiece.clear();
    }
}

/**
 * Run the backstop on one host snapshot: record our own piece, compare the host's copy,
 * and after PEER_DIVERGENCE_RUN differing comparisons in a row (no agreeing one between)
 * ask the host for one clean exact resync, at most once per PEER_RESYNC_COOLDOWN_MS.
 * @param {Record<string, any>} game the peer's game state
 * @param {{players?: Array<Record<string, any>>}} state the host's snapshot
 * @param {number} now
 * @returns {'agree'|'differ'|null}
 */
export function checkPeerBoardAgreement(game, state, now) {
    if (!(game._peerBoardHistory instanceof PeerBoardHistory)) {
        game._peerBoardHistory = new PeerBoardHistory();
    }
    const history = game._peerBoardHistory;
    const own = game.players?.get?.(game.localPlayerId)?.gameState;
    history.record(own, Number(game.roundGeneration) || 0);
    const hostView = state?.players?.find?.((player) => player.steamId === game.localPlayerId);
    const verdict = history.compare(hostView);
    if (verdict === 'agree') game._desyncCount = 0;
    if (verdict !== 'differ') return verdict;

    game._desyncCount = (game._desyncCount || 0) + 1;
    if (game._desyncCount < PEER_DIVERGENCE_RUN) return verdict;
    if (now - (game._lastResyncAt || 0) <= PEER_RESYNC_COOLDOWN_MS) return verdict;
    console.warn('⚠️ [peerLocalSim] divergence at the same piece '
        + `(score ${own?.score}/${hostView?.score}, lines ${own?.lines}/${hostView?.lines}) → resync`);
    game._lastResyncAt = now;
    game._desyncCount = 0;
    history.clear();
    game._requestResync?.();
    return verdict;
}
