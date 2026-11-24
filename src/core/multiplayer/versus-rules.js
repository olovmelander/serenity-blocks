// @ts-check

/**
 * The versus rules every multiplayer board plays by, local and online alike.
 *
 * - Garbage never kills on arrival. It lifts the stack, cells lifted past the top of the
 *   hidden rows are lost, and a player dies only when the next piece cannot spawn
 *   (garbage.js, overflowPolicy 'spill').
 * - At most VERSUS_MAX_PENDING_LINES rows wait for a player; rows sent beyond that are dropped.
 * - Outgoing lines never cancel incoming ones.
 * - Attacks keep their full size while CROWD_FREE_PLAYERS or fewer players are alive. Past
 *   that, each placed piece earns a crowd stamp (up to STAMPS_PER_LINE for every extra
 *   living player), and every STAMPS_PER_LINE stamps take one line off a normal attack.
 *   A move that empties the board is never reduced, and boring rules turn the cut off.
 * - The frag goes to the player whose recent attacks on you weigh most (AttackCredit).
 * - The rows of one attack hold together as one solid, rows of different attacks do not
 *   (garbage.js, joinAttackRows; the standard well).
 * - Feel (applyVersusFeel): pieces are drawn one by one, not from a bag, and a resting piece
 *   locks at the next gravity step instead of after a lock delay.
 */

import { GarbageQueue, STAMP_PER_HANDICAP } from '../garbage.js';
import { fillBag } from '../game.js';
import { applyMatchLevelRule } from './match-level-rule.js';

/**
 * Versus game types. 'ffa' (free-for-all, the default): a player who dies presses a key and
 * plays on at once on an empty well, keeping score and lines, and the match goes on until its
 * goal (frags by default). 'survivor': rounds; the last player or team alive takes the round,
 * then everyone restarts on an empty well.
 */
export const VERSUS_GAME_TYPES = Object.freeze(['ffa', 'survivor']);
export const DEFAULT_VERSUS_GAME_TYPE = 'ffa';

/**
 * @param {{ gameType?: unknown } | null | undefined} config
 * @returns {'ffa' | 'survivor'}
 */
export function readVersusGameType(config) {
    return config?.gameType === 'survivor' ? 'survivor' : DEFAULT_VERSUS_GAME_TYPE;
}

/**
 * The game type in a word, for the waiting room and the match bar.
 * @param {{ gameType?: unknown } | null | undefined} config
 */
export function describeVersusGameType(config) {
    return readVersusGameType(config) === 'survivor' ? 'Survivor' : 'Free-for-all';
}

/**
 * In free-for-all, a knocked-out player's keys bring them back only this long after the
 * knock-out, so the key they were pressing as they went out does not.
 */
export const RESPAWN_AFTER_MS = 1000;

/**
 * Whether a frag credit that has faded to nothing is forgotten (AttackCredit.notePiecePlaced):
 * in free-for-all a player who has not been attacked for a while dies uncredited; in survivor
 * the last holder keeps it for the round.
 * @param {{ gameType?: unknown } | null | undefined} config
 */
export function forgetsSpentCredit(config) {
    return readVersusGameType(config) === 'ffa';
}

/**
 * Put a dead player's board back in play (free-for-all respawn): an empty well at the match's
 * start level and speed, no piece, no lock, blind or combo state. Score, lines, piece and clear
 * counts, the piece stream (same generator, preview topped up), the player's handicap level,
 * the attack sequence and the simulation clock carry on. The caller clears the player's garbage
 * queue, frag credit and stamps, and marks the player alive.
 * @param {import('../game.js').GameState} gameState
 * @param {{ startLevel?: unknown, levelProgression?: unknown } | null | undefined} matchConfig
 */
export function respawnVersusBoard(gameState, matchConfig) {
    const kept = {
        score: gameState.score,
        lines: gameState.lines,
        piecesPlaced: gameState.piecesPlaced,
        pieceCounts: { ...gameState.pieceCounts },
        lineClearCounts: { ...gameState.lineClearCounts },
        randomGenerator: gameState.randomGenerator,
        rngDescriptor: gameState.rngDescriptor,
        nextPieces: gameState.nextPieces.slice(),
        handicap: gameState.handicap,
        garbageAttackSequence: gameState.garbageAttackSequence,
        simFrame: gameState.simFrame,
        simTimeMs: gameState.simTimeMs,
        lastTime: gameState.lastTime,
    };
    gameState.reset();
    Object.assign(gameState, kept);
    fillBag(gameState.nextPieces, gameState.randomGenerator, gameState.pieceRandomizer);
    applyMatchLevelRule(gameState, matchConfig);
    gameState.isAlive = true;
    gameState.isGameOver = false;
}

export const VERSUS_MAX_PENDING_LINES = 20;

/**
 * How versus garbage goes in (applyGarbage options): it never tops a player out, and rows its
 * settle completes count as the player's own clear (applyGarbage returns that clear's attack
 * as settleSummary, for the caller to route like any other). The rows of one attack hold
 * together as one solid, rows of different attacks do not (the standard well).
 */
export const VERSUS_GARBAGE_OPTIONS = Object.freeze({
    overflowPolicy: 'spill',
    creditSettleClears: true,
    joinAttackRows: true,
});
export const CROWD_FREE_PLAYERS = 4;
export const STAMPS_PER_LINE = STAMP_PER_HANDICAP;

/** Weight one received garbage line adds to its sender's credit. */
export const CREDIT_PER_LINE = 2;
/** Highest credit one attacker can hold. */
export const CREDIT_MAX = 255;

/**
 * The crowd stamps a player holds after placing one more piece.
 * @param {number} stamps stamps held before the piece
 * @param {number} aliveCount living players in the match, this player included
 * @returns {number}
 */
export function stepCrowdStamps(stamps, aliveCount) {
    const extraPlayers = Math.max(0, Math.floor(Number(aliveCount) || 0) - CROWD_FREE_PLAYERS);
    const cap = extraPlayers * STAMPS_PER_LINE;
    const held = Math.max(0, Math.floor(Number(stamps) || 0));
    return held < cap ? held + 1 : cap;
}

/**
 * Take the crowd cut off one attack's normal lines.
 * @param {number} lines normal (non-clean) lines the move sends
 * @param {number} stamps crowd stamps the sender holds
 * @param {{ clean?: boolean, boringRules?: boolean }} [options]
 * @returns {{ lines: number, stamps: number }} lines left to send and stamps left over
 */
export function takeCrowdCut(lines, stamps, { clean = false, boringRules = false } = {}) {
    let left = Math.max(0, Math.floor(Number(lines) || 0));
    let held = Math.max(0, Math.floor(Number(stamps) || 0));
    if (clean || boringRules) return { lines: left, stamps: held };
    while (left > 0 && held >= STAMPS_PER_LINE) {
        left -= 1;
        held -= STAMPS_PER_LINE;
    }
    return { lines: left, stamps: held };
}

/**
 * Who gets the frag when a player dies. Every attack that reaches the player adds
 * CREDIT_PER_LINE per line to its sender's credit; every piece the player places takes one
 * off each sender. The credited attacker changes only when an attack arrives: the sender takes
 * the credit when its total reaches the current holder's. A holder whose credit runs out is
 * forgotten only when `forgetSpent` is set (a respawning match); in a round match the last
 * holder keeps it.
 */
export class AttackCredit {
    constructor() {
        /** @type {Map<string|number, number>} */
        this.weights = new Map();
        /** @type {string|number|null} */
        this.holder = null;
    }

    /**
     * An attack reached this player.
     * @param {string|number|null|undefined} attackerId
     * @param {number} lines rows the attack carried (before the pending cap)
     */
    noteAttack(attackerId, lines) {
        if (attackerId === null || attackerId === undefined) return;
        const rows = Math.max(0, Math.floor(Number(lines) || 0));
        const weight = Math.min(CREDIT_MAX, (this.weights.get(attackerId) || 0) + rows * CREDIT_PER_LINE);
        this.weights.set(attackerId, weight);
        if (this.holder === null || weight >= (this.weights.get(this.holder) || 0)) {
            this.holder = attackerId;
        }
    }

    /**
     * This player placed a piece.
     * @param {{ forgetSpent?: boolean }} [options]
     */
    notePiecePlaced({ forgetSpent = false } = {}) {
        for (const [attackerId, weight] of this.weights) {
            const next = Math.max(0, weight - 1);
            if (next === 0) this.weights.delete(attackerId);
            else this.weights.set(attackerId, next);
            if (next === 0 && forgetSpent && this.holder === attackerId) this.holder = null;
        }
    }

    /** @returns {string|number|null} the player the frag goes to, or null */
    get killer() {
        return this.holder;
    }

    reset() {
        this.weights.clear();
        this.holder = null;
    }
}

/**
 * The versus feel for one board: every piece drawn on its own from the shared seed (no bag
 * of seven), and a resting piece locked at the next gravity step it cannot take, with no lock
 * delay to slide or turn in (a soft drop takes that step at once). Set once per board; a
 * board's reset() keeps it.
 * @param {{ pieceRandomizer?: string, lockStyle?: string }} gameState
 */
export function applyVersusFeel(gameState) {
    if (!gameState) return;
    gameState.pieceRandomizer = 'random';
    gameState.lockStyle = 'gravity';
}

/** A garbage queue that holds at most VERSUS_MAX_PENDING_LINES rows. */
export function createVersusGarbageQueue() {
    return new GarbageQueue({ maxLines: VERSUS_MAX_PENDING_LINES });
}

/**
 * The frag credit of one online player (host side), created on first use. A player whose
 * credit was never fed here (a board adopted from another host) starts from the
 * lastAttackerId it carried over.
 * @param {{ fragCredit?: AttackCredit, lastAttackerId?: string|null }} player
 * @returns {AttackCredit}
 */
export function ensureAttackCredit(player) {
    if (!player.fragCredit) player.fragCredit = new AttackCredit();
    if (player.fragCredit.holder === null && player.lastAttackerId) {
        player.fragCredit.holder = player.lastAttackerId;
    }
    return player.fragCredit;
}

/**
 * Forget one online player's frag credit and crowd stamps (a new round or match).
 * @param {{ fragCredit?: AttackCredit, lastAttackerId?: string|null, crowdStamps?: number }} player
 */
export function resetVersusCredit(player) {
    player.lastAttackerId = null;
    player.crowdStamps = 0;
    player.fragCredit?.reset();
}
