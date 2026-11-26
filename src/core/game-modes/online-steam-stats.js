// @ts-check

import steamService from '../steam/steam-service.js';
import { recordOwner } from '../progression/record-book.js';

/** The most lines and minutes one online match can add to lifetime stats. */
export const MAX_MATCH_LINES = 5000;
export const MAX_MATCH_MINUTES = 600;
/** The highest frags goal a match can be created with (the create sheet's stepper). */
export const MAX_FRAGS_GOAL = 100;
/** A free-for-all without a frags goal counts at most one knock-out per this much play. */
export const FFA_KNOCKOUT_PACE_MS = 10_000;
/**
 * How far the host's match duration may run ahead of this computer's own measure of it: the
 * countdown, the message's travel and two clocks that never agree to the second.
 */
export const LOCAL_CLOCK_SLACK_MS = 10_000;

/**
 * How long the match lasted for this player. The host reports a duration, and time bounds both
 * the minutes and (without a frags goal) the knock-outs a match can add, so a host's figure is
 * never taken past what this computer measured itself. A player who dropped in late played for
 * their own time, not the host's.
 * @param {unknown} hostDurationMs the duration in the host's result
 * @param {unknown} [localDurationMs] this computer's own measure, when it has one
 */
export function playedMs(hostDurationMs, localDurationMs) {
    const host = Math.max(0, Number(hostDurationMs) || 0);
    if (typeof localDurationMs !== 'number' || !Number.isFinite(localDurationMs)) return host;
    return Math.min(host, Math.max(0, localDurationMs) + LOCAL_CLOCK_SLACK_MS);
}

/**
 * The most knock-outs one player can have earned in a match.
 *
 * Survivor: one per opponent per round. A free-for-all has no rounds and a knocked-out player
 * comes straight back, so opponents and rounds bound nothing there (that bound recorded a
 * 10-frag win as 1 kill). Played to a frags goal it ends when someone reaches the goal, so the
 * goal is the bound; with any other goal the bound is how long the match ran.
 *
 * Rules that do not name a game type get whichever of the two bounds allows more: a real
 * result is never cut for a field this client could not read.
 * @param {{
 *   players?: number, rounds?: number, durationMs?: number,
 *   matchConfig?: { gameType?: unknown, endCondition?: unknown, endConditionValue?: unknown } | null,
 * }} match
 */
export function maxMatchKills({
    players = 2, rounds = 1, durationMs = 0, matchConfig,
} = {}) {
    const opponents = Math.max(0, Math.floor(Number(players) || 0) - 1);
    const perRound = opponents * Math.max(1, Math.floor(Number(rounds) || 1));
    if (matchConfig?.gameType === 'survivor') return perRound;

    let freeForAll;
    if (matchConfig?.endCondition === 'frags') {
        const goal = Math.floor(Number(matchConfig.endConditionValue) || 0);
        freeForAll = Math.min(MAX_FRAGS_GOAL, Math.max(1, goal));
    } else {
        const counted = Math.min(Math.max(0, Number(durationMs) || 0), MAX_MATCH_MINUTES * 60_000);
        // The roster can have shrunk by the end (a seat let go), so opponents are only the floor.
        freeForAll = Math.max(opponents, Math.floor(counted / FFA_KNOCKOUT_PACE_MS));
    }
    return matchConfig?.gameType === 'ffa' ? freeForAll : Math.max(freeForAll, perRound);
}

/**
 * What an online match adds to this player's lifetime Steam stats. The match's figures
 * come from the host, so each is bounded by what one match can hold, and lines are never
 * more than this player's own board counted. A host's numbers used to be added as sent,
 * negative ones included.
 * @param {Record<string, any>|null|undefined} reported this player's row of the host's final stats
 * @param {{
 *   players?: number, rounds?: number, localLines?: number, durationMs?: number,
 *   localDurationMs?: number,
 *   matchConfig?: { gameType?: unknown, endCondition?: unknown, endConditionValue?: unknown } | null,
 * }} match what this client itself knows about the match; `durationMs` is the host's figure
 */
export function matchStatsForSteam(reported, {
    players = 2, rounds = 1, localLines, durationMs = 0, localDurationMs, matchConfig,
} = {}) {
    /** @param {unknown} value @param {number} max */
    const count = (value, max) => Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));
    const ownLines = Number.isFinite(localLines) ? count(localLines, MAX_MATCH_LINES) : MAX_MATCH_LINES;
    const played = playedMs(durationMs, localDurationMs);
    return {
        kills: count(reported?.frags, maxMatchKills({
            players, rounds, durationMs: played, matchConfig,
        })),
        lines: Math.min(count(reported?.lines, MAX_MATCH_LINES), ownLines),
        minutes: Math.max(1, count(Math.round(played / 60000), MAX_MATCH_MINUTES)),
        isWinner: reported?.placement === 1,
    };
}

/**
 * Persist one personal match contribution using the host's stable finish ID.
 * @param {{
 *   finalStats?: Array<Record<string, any>>, duration?: number, recordId?: string,
 *   endCondition?: unknown, endConditionValue?: unknown,
 * }} detail the match result
 * @param {{
 *   localSteamId?: string|null, rounds?: number, localLines?: number, localDurationMs?: number,
 *   records?: any,
 *   matchConfig?: { gameType?: unknown, endCondition?: unknown, endConditionValue?: unknown } | null,
 * }} local this client's own view: its match rules and its own clock bound what the host reports
 */
export async function syncFfaSteamStats(detail, {
    localSteamId, rounds = 1, localLines, localDurationMs, records, matchConfig,
} = {}) {
    if (!detail?.recordId || !detail.finalStats || !localSteamId || !records) return;
    const localStats = detail.finalStats.find((entry) => `${entry.steamId}` === `${localSteamId}`);
    if (!localStats) return;

    const counted = matchStatsForSteam(localStats, {
        players: detail.finalStats.length,
        rounds,
        localLines,
        durationMs: detail.duration,
        localDurationMs,
        // A caller without the match's rules still gets the goal the host announced.
        matchConfig: matchConfig ?? {
            endCondition: detail.endCondition, endConditionValue: detail.endConditionValue,
        },
    });
    await records.saveCompletion(`ffa:${detail.recordId}:${localSteamId}`, {
        mode: 'ffa',
        owner: recordOwner(steamService),
        lines: counted.lines,
        kills: counted.kills,
        duration: counted.minutes * 60,
        win: counted.isWinner,
    });
}

/**
 * A finished match's stats, ready to record: what the online mode knows is read now, so the
 * record can still be written after the mode has let its match go. A failure is logged and
 * never holds up the results; the match's ID makes a later delivery of the same result safe.
 * @param {any} mode the online mode (its networking, game state and record book)
 * @param {Parameters<typeof syncFfaSteamStats>[0]} detail the match result
 * @returns {() => Promise<void>}
 */
export function onlineMatchStatsRecorder(mode, detail) {
    const since = mode._matchActiveSince;
    const local = {
        records: mode.deps?.highScoreManager,
        localSteamId: mode.steamNetworking?.steamId,
        rounds: mode.roundNumber,
        localLines: mode.ffaGameState?.getLocalPlayer?.()?.gameState?.lines,
        // This computer's own clock for the match, which bounds the duration the host reports.
        localDurationMs: Number.isFinite(since) && since > 0 ? Date.now() - since : undefined,
        // The game type and goal bound the knock-outs a host may report.
        matchConfig: mode.ffaGameState?.matchConfig,
    };
    return () => syncFfaSteamStats(detail, local).catch((err) => {
        console.warn('[OnlineMultiplayer] Steam stats sync failed:', err.message);
    });
}

/**
 * Record a finished match from the online mode, now.
 * @param {any} mode
 * @param {Parameters<typeof syncFfaSteamStats>[0]} detail
 */
export function recordOnlineMatchStats(mode, detail) {
    return onlineMatchStatsRecorder(mode, detail)();
}
