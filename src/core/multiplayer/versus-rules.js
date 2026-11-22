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
 * - Feel (applyVersusFeel): pieces are drawn one by one, not from a bag, and a resting piece
 *   locks at the next gravity step instead of after a lock delay.
 */

import { GarbageQueue, STAMP_PER_HANDICAP } from '../garbage.js';

export const VERSUS_MAX_PENDING_LINES = 20;

/**
 * How versus garbage goes in (applyGarbage options): it never tops a player out, and rows its
 * settle completes count as the player's own clear (applyGarbage returns that clear's attack
 * as settleSummary, for the caller to route like any other).
 */
export const VERSUS_GARBAGE_OPTIONS = Object.freeze({
    overflowPolicy: 'spill',
    creditSettleClears: true,
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
