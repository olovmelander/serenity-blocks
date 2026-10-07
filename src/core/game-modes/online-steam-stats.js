// @ts-check

import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';

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
 * @param {{ localSteamId?: string|null, rounds?: number, localLines?: number }} local
 */
export async function syncFfaSteamStats(detail, { localSteamId, rounds = 1, localLines } = {}) {
    if (!detail?.finalStats || !localSteamId) return;
    const localStats = detail.finalStats.find((entry) => `${entry.steamId}` === `${localSteamId}`);
    if (!localStats) return;

    const counted = matchStatsForSteam(localStats, {
        players: detail.finalStats.length, rounds, localLines, durationMs: detail.duration,
    });
    const { kills, isWinner } = counted;

    const matchesBefore = steamService.getCachedStat('ffa_matches', 0);
    const winsBefore = steamService.getCachedStat('ffa_wins', 0);
    const killsBefore = steamService.getCachedStat('ffa_kills', 0);

    await Promise.all([
        steamService.incrementStat('ffa_matches', 1),
        steamService.incrementStat('ffa_kills', kills),
        steamService.incrementStat('total_lines_cleared', counted.lines),
        steamService.incrementStat('playtime_minutes', counted.minutes),
        isWinner ? steamService.incrementStat('ffa_wins', 1) : Promise.resolve(true),
    ]);

    const matches = steamService.getCachedStat('ffa_matches', matchesBefore + 1);
    const wins = steamService.getCachedStat('ffa_wins', winsBefore + (isWinner ? 1 : 0));
    const totalKills = steamService.getCachedStat('ffa_kills', killsBefore + kills);
    const winRateScore = matches > 0 ? Math.round((wins / matches) * 10000) : 0;

    const scoreDetails = {
        score: counted.score,
        duration: counted.minutes * 60,
        linesCleared: counted.lines,
        highestLevel: counted.level,
        kills,
        wins,
        matches,
        placement: localStats.placement,
        mode: 'ffa',
        version: '1.0.0',
    };

    await Promise.all([
        steamService.uploadScore(STEAM_LEADERBOARDS.FFA_TOTAL_KILLS, totalKills, {
            ...scoreDetails,
            extraValue: totalKills,
        }),
        steamService.uploadScore(STEAM_LEADERBOARDS.FFA_WIN_RATE, winRateScore, {
            ...scoreDetails,
            extraValue: totalKills,
        }),
    ]);
}
