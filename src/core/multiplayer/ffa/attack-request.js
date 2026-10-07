// @ts-check

/**
 * Host-side trust boundary for peer attack requests (GAME_ATTACK_REQUEST).
 *
 * A peer reports its own cascade and the host turns that report into garbage for
 * every opponent, so the report is untrusted wire data. Until attacks are derived
 * from the host's replica (plan §6B.1, `authoritativeAttacks`), this module is the
 * only thing between a modified client and the garbage calculation:
 *
 *  - the summary is rebuilt from a whitelist with every field bounded — an
 *    unbounded `depth` used to drive an allocation loop of (1 + depth) / 2 rows,
 *    so one packet could hang the host and end the match for everyone;
 *  - requests are fenced to the live round, so a cascade still on the wire when
 *    a round ends cannot land in the next one;
 *  - a per-attacker token bucket on the host tick bounds how fast one peer can
 *    make the host fan garbage out to the lobby;
 *  - reports are checked against the lines the host's copy of the board cleared this
 *    round, so a client cannot report clears it never made.
 *
 * Bounds are physical, not tuned: one lock cannot clear more lines than the board
 * has rows, because a cascade only removes cells.
 */

import {
    COLS, ROWS, HIDDEN_ROWS, SHAPES,
} from '../../constants.js';

/** Burst a peer may send at once (a reliable channel can batch after a stall). */
export const ATTACK_REQUEST_BUCKET_CAPACITY = 24;
/** Lines a peer's reports may run ahead of the clears the host's copy of its board made. */
export const ATTACK_LINES_AHEAD = 8;
/** Host ticks per refilled token: 15 requests/s sustained at a 60 Hz host tick. */
export const ATTACK_REQUEST_TICKS_PER_TOKEN = 4;

const MAX_COLOR_LENGTH = 32;
/** CSS colour characters only — no quotes, semicolons, braces or angle brackets. */
const SAFE_COLOR = /^[#a-zA-Z0-9(),.%\s-]+$/;

/**
 * @typedef {{
 *   totalLines: number,
 *   depth: number,
 *   comboStages: number,
 *   complexity: number,
 *   holeMask: Array<Array<boolean>|Array<number>|null>,
 *   manualColumns: number[],
 *   sendForPerfectClear: boolean,
 *   sourceColor: string|number|null,
 *   sourcePiece: string|null,
 *   sequence: number|undefined,
 * }} SanitizedCascadeSummary
 */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isColumn(value) {
    return Number.isInteger(value) && /** @type {number} */ (value) >= 0 && /** @type {number} */ (value) < COLS;
}

/**
 * One hole-mask row: either COLS booleans (what physics emits) or a short list of
 * column indices (the other shape the garbage calculation accepts). Anything else
 * becomes null, which the calculation replaces with its fallback hole.
 * @param {unknown} row
 * @returns {Array<boolean>|Array<number>|null}
 */
function sanitizeMaskRow(row) {
    if (!Array.isArray(row) || row.length === 0 || row.length > COLS) return null;
    if (row.length === COLS && row.every((cell) => typeof cell === 'boolean')) {
        return row.slice();
    }
    return row.every(isColumn) ? row.slice() : null;
}

/**
 * @param {unknown} value
 * @returns {string|number|null}
 */
function sanitizeColor(value) {
    if (typeof value === 'string') {
        return value.length <= MAX_COLOR_LENGTH && SAFE_COLOR.test(value) ? value : null;
    }
    return Number.isInteger(value) && /** @type {number} */ (value) >= 0 && /** @type {number} */ (value) <= 0xFFFFFF
        ? /** @type {number} */ (value)
        : null;
}

/**
 * Rebuild a peer-supplied cascade summary from a whitelist of bounded fields.
 * @param {unknown} summary
 * @param {{ maxRows?: number }} [options]
 * @returns {{ ok: true, summary: SanitizedCascadeSummary } | { ok: false, reason: string }}
 */
export function sanitizePeerCascadeSummary(summary, options = {}) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
        return { ok: false, reason: 'malformed_summary' };
    }
    const raw = /** @type {Record<string, unknown>} */ (summary);
    const maxRows = Number.isInteger(options.maxRows) && /** @type {number} */ (options.maxRows) > 0
        ? /** @type {number} */ (options.maxRows)
        : ROWS + HIDDEN_ROWS;

    const depth = raw.depth ?? raw.totalLines;
    if (!Number.isInteger(depth) || /** @type {number} */ (depth) < 1 || /** @type {number} */ (depth) > maxRows) {
        return { ok: false, reason: 'depth_out_of_range' };
    }
    const lines = /** @type {number} */ (depth);

    const rawComplexity = raw.complexity ?? raw.comboStages;
    const complexity = Number.isFinite(rawComplexity)
        ? Math.min(maxRows, Math.max(0, Math.floor(/** @type {number} */ (rawComplexity))))
        : 0;

    const rawMask = raw.holeMask ?? raw.holeMaskBuffer;
    if (rawMask != null && !Array.isArray(rawMask)) {
        return { ok: false, reason: 'malformed_hole_mask' };
    }
    // The calculation reads at most depth - 1 rows; never map more than `lines`.
    const holeMask = Array.isArray(rawMask) ? rawMask.slice(0, lines).map(sanitizeMaskRow) : [];

    const manualColumns = Array.isArray(raw.manualColumns)
        ? Array.from(new Set(raw.manualColumns.slice(0, COLS).filter(isColumn)))
        : [];

    const sourcePiece = typeof raw.sourcePiece === 'string'
        && Object.prototype.hasOwnProperty.call(SHAPES, raw.sourcePiece)
        ? raw.sourcePiece
        : null;

    return {
        ok: true,
        summary: {
            totalLines: lines,
            depth: lines,
            comboStages: complexity,
            complexity,
            holeMask,
            manualColumns,
            sendForPerfectClear: raw.sendForPerfectClear === true,
            sourceColor: sanitizeColor(raw.sourceColor),
            sourcePiece,
            sequence: Number.isFinite(raw.sequence)
                ? Math.floor(/** @type {number} */ (raw.sequence))
                : undefined,
        },
    };
}

/**
 * Token bucket keyed by attacker and clocked by the host tick (no wall clock in
 * the sim boundary). A tick that runs backwards — round restart, migration —
 * refills the bucket rather than freezing it.
 * @param {Map<string, { tokens: number, tick: number }>} buckets
 * @param {string} steamId
 * @param {number} tick
 * @returns {boolean} true when the request may proceed
 */
export function consumeAttackRequestToken(buckets, steamId, tick) {
    const now = Number.isFinite(tick) ? tick : 0;
    let bucket = buckets.get(steamId);
    if (!bucket || now < bucket.tick) {
        bucket = { tokens: ATTACK_REQUEST_BUCKET_CAPACITY, tick: now };
        buckets.set(steamId, bucket);
    } else {
        const refill = Math.floor((now - bucket.tick) / ATTACK_REQUEST_TICKS_PER_TOKEN);
        if (refill > 0) {
            bucket.tokens = Math.min(ATTACK_REQUEST_BUCKET_CAPACITY, bucket.tokens + refill);
            bucket.tick += refill * ATTACK_REQUEST_TICKS_PER_TOKEN;
        }
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
}

/**
 * This round's line count for one player: what the host's copy of the board cleared, and
 * what the player has reported.
 * @param {any} game
 * @param {string} steamId
 */
function attackLedger(game, steamId) {
    if (!game._attackLedgers) game._attackLedgers = new Map();
    const round = Number(game.roundGeneration) || 0;
    let ledger = game._attackLedgers.get(steamId);
    if (!ledger || ledger.round !== round) {
        ledger = { round, cleared: 0, claimed: 0 };
        game._attackLedgers.set(steamId, ledger);
    }
    return ledger;
}

/**
 * Host: the host's copy of a peer's board cleared lines (its own cascade summary, which
 * the peer's report is checked against).
 * @param {any} game
 * @param {string} steamId
 * @param {any} summary
 */
export function noteCopyClear(game, steamId, summary) {
    const lines = Number(summary?.totalLines ?? summary?.depth) || 0;
    if (lines > 0) attackLedger(game, steamId).cleared += lines;
}

/** @param {any} gameState */
function occupiedCells(gameState) {
    let cells = 0;
    (gameState?.boardGrid || []).forEach((/** @type {any} */ row) => {
        if (Array.isArray(row)) row.forEach((cell) => { if (cell) cells += 1; });
    });
    return cells;
}

/**
 * Whether a report fits the clears the host's copy of the attacker's board made this
 * round. The copy runs a little behind (it waits for the peer's inputs), so reports may
 * run ahead by a quarter plus ATTACK_LINES_AHEAD lines (two quads); a client reporting
 * clears its board never made gets no further. A perfect-clear bonus needs a copy that is
 * no fuller than the clear itself plus two pieces.
 * @param {any} game
 * @param {any} attacker
 * @param {SanitizedCascadeSummary} summary
 */
export function plausibleAttack(game, attacker, summary) {
    const ledger = attackLedger(game, attacker.steamId);
    if (ledger.claimed + summary.totalLines > ledger.cleared * 1.25 + ATTACK_LINES_AHEAD) return false;
    ledger.claimed += summary.totalLines;
    if (summary.sendForPerfectClear && occupiedCells(attacker.gameState) > summary.totalLines * COLS + 8) {
        summary.sendForPerfectClear = false;
    }
    return true;
}

/**
 * Host handler for GAME_ATTACK_REQUEST. Routes a validated attack; every other
 * outcome is counted and logged with its reason.
 * @param {any} game  FFAGameStateP2P
 * @param {{ from?: string, data?: any }} msg
 * @returns {boolean} true when the attack was routed
 */
export function handleFfaAttackRequest(game, msg) {
    if (!game.isHost) return false; // Only the host routes attacks

    const attackerSteamId = msg?.from; // set by the transport, Steam-authenticated
    const data = msg?.data;
    if (!attackerSteamId || !data || typeof data !== 'object' || !data.cascadeSummary) return false;

    if (game._authoritativeAttacksEnabled) {
        // The host derives attacks itself; keep the peer's (bounded) report in the
        // log so the §6B.1 soak can still diff reported vs derived attacks.
        const reported = sanitizePeerCascadeSummary(data.cascadeSummary);
        game._recordNetEvent?.('attack_request_ignored', {
            attackerSteamId,
            reason: 'authoritative_attacks',
            cascadeSummary: 'summary' in reported ? reported.summary : null,
        });
        return false;
    }

    /** @param {string} reason */
    const reject = (reason) => {
        game._attackRequestDrops = (game._attackRequestDrops || 0) + 1;
        game._recordNetEvent?.('attack_request_rejected', { attackerSteamId, reason });
        return false;
    };

    if (game.gamePhase !== 'playing') return reject('not_playing');
    if (typeof data.roundGeneration === 'number' && data.roundGeneration < game.roundGeneration) {
        return reject('stale_round');
    }

    const attacker = game.players?.get?.(attackerSteamId);
    if (!attacker || !attacker.isAlive) return reject('unknown_or_dead_attacker');

    const sanitized = sanitizePeerCascadeSummary(data.cascadeSummary, {
        maxRows: attacker.gameState?.boardGrid?.length,
    });
    if ('reason' in sanitized) return reject(sanitized.reason);
    if (!plausibleAttack(game, attacker, sanitized.summary)) return reject('implausible_attack');

    if (!game._attackRequestBuckets) game._attackRequestBuckets = new Map();
    if (!consumeAttackRequestToken(game._attackRequestBuckets, attackerSteamId, game.simTick || 0)) {
        return reject('rate_limited');
    }

    game._recordNetEvent?.('attack_request', {
        attackerSteamId,
        cascadeSummary: sanitized.summary,
    });
    game.attackRouter.routeAttack(attackerSteamId, sanitized.summary);
    return true;
}
