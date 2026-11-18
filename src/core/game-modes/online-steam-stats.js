// @ts-check

import steamService from '../steam/steam-service.js';
import { recordOwner } from '../progression/record-book.js';

/** The most lines, minutes and points one online match can add to lifetime stats. */
export const MAX_MATCH_LINES = 5000;
export const MAX_MATCH_MINUTES = 600;
export const MAX_MATCH_SCORE = 1_000_000_000;

/**
 * What an online match adds to this player's lifetime Steam stats. The match's figures
 * come from the host, so each is bounded by what one match can hold, and lines are never
 * more than this player's own board counted. A host's numbers used to be added as sent,
 * negative ones included.
 * @param {Record<string, any>|null|undefined} reported this player's row of the host's final stats
 * @param {{ players?: number, rounds?: number, localLines?: number, durationMs?: number }} match
 */
export function matchStatsForSteam(reported, {
    players = 2, rounds = 1, localLines, durationMs = 0,
} = {}) {
    /** @param {unknown} value @param {number} max */
    const count = (value, max) => Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));
    const ownLines = Number.isFinite(localLines) ? count(localLines, MAX_MATCH_LINES) : MAX_MATCH_LINES;
    return {
        // One knock-out per opponent per round at most.
        kills: count(reported?.frags, Math.max(0, players - 1) * Math.max(1, rounds)),
        lines: Math.min(count(reported?.lines, MAX_MATCH_LINES), ownLines),
        score: count(reported?.score, MAX_MATCH_SCORE),
        level: count(reported?.level, 99),
        minutes: Math.max(1, count(Math.round((Number(durationMs) || 0) / 60000), MAX_MATCH_MINUTES)),
        isWinner: reported?.placement === 1,
    };
}

/**
 * Add an online match to this player's Steam stats and leaderboards (best effort; the
 * caller does not wait).
 * @param {{ finalStats?: Array<Record<string, any>>, duration?: number }} detail the match result
 * @param {{ localSteamId?: string|null, rounds?: number, localLines?: number, records?: any, matchId?: string }} local
 */
export async function syncFfaSteamStats(detail, { localSteamId, rounds = 1, localLines, records, matchId } = {}) {
    if (!detail?.finalStats || !localSteamId) return;
    const localStats = detail.finalStats.find((entry) => `${entry.steamId}` === `${localSteamId}`);
    if (!localStats) return;

    const counted = matchStatsForSteam(localStats, {
        players: detail.finalStats.length, rounds, localLines, durationMs: detail.duration,
    });
    if (!matchId || !records) return;
    await records.saveCompletion('ffa:' + matchId + ':' + localSteamId, {
        mode: 'ffa', owner: recordOwner(steamService), lines: counted.lines, kills: counted.kills,
        duration: counted.minutes * 60, win: counted.isWinner,
    });
}
