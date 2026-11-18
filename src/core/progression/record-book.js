import {
    ACHIEVEMENTS, BOARDS, STEAM_LEADERBOARDS as N, STAT_NAMES, isScoreInt, betterScore, isEligibleScore,
} from '../steam/steam-catalogue.js';
import { packScoreDetails } from '../steam/leaderboard-score-details.js';

const runIds = new WeakMap();
export function runIdFor(session) {
    if (!runIds.has(session)) runIds.set(session, globalThis.crypto.randomUUID());
    return runIds.get(session);
}
export function recordOwner(service) {
    return service.steamId && service.appId ? `${String(service.appId)}/${service.steamId}` : null;
}
const modes = new Set(['single', 'infinity', 'odyssey', 'ffa']);
export function validRun(id, run) {
    return typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,150}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id)
        && run && modes.has(run.mode) && (run.owner == null || /^\d+\/\d{1,20}$/.test(run.owner))
        && ['score', 'lines', 'level', 'duration', 'cascade', 'timeMs', 'stars', 'kills'].every((key) => run[key] == null || (Number.isSafeInteger(run[key]) && run[key] >= 0))
        && (run.mode !== 'odyssey' || (run.level >= 1 && run.level <= 60 && run.stars <= 180))
        && (!run.flags || (isScoreInt(run.flags) && !(run.flags & ~15)))
        && (!run.checksum || Number.isInteger(run.checksum));
}
// Older completions keep their stars and history. Only the recorded board can claim a time.
function isCurrentOrbTime(run) {
    return run.assisted === false && run.timeBoard === N.ODYSSEY_LEVEL_TIME_PREFIX + run.level
        && Boolean(BOARDS[run.timeBoard]);
}

export function localOrbBest(book, levelId, excludeId = null) {
    let best = null;
    for (const [id, run] of Object.entries(book?.runs || {})) {
        if (id === excludeId || run.mode !== 'odyssey' || run.level !== Number(levelId) || !isCurrentOrbTime(run)
            || !Number.isSafeInteger(run.timeMs) || run.timeMs <= 0) continue;
        best = best === null ? run.timeMs : Math.min(best, run.timeMs);
    }
    return best;
}

export function asGuestStatistics(stats) {
    if (!stats?.recordBook) return stats;
    const { base, runs } = stats.recordBook;
    return {
        ...stats,
        recordBook: {
            version: 1,
            base,
            runs: Object.fromEntries(
                Object.entries(runs || {}).filter(([id, run]) => validRun(id, run)).map(([id, run]) => [id, { ...run, owner: null }]),
            ),
        },
    };
}

// Only the old, account-owned Cloud payload is eligible for milestone backfill.
export function legacyAwards(file, data) {
    const awards = new Set();
    if (data?.recordSchema || !data) return [];
    if (file === 'highscores.json') {
        for (const row of data.highScores || data.scores || []) {
            if (row.runId || !isScoreInt(row.score)) continue;
            if ((row.mode || 'single') === 'single' && isScoreInt(row.lines) && row.lines >= 100) awards.add('ACH_SINGLE_100_LINES');
            if (row.mode === 'infinity' && isScoreInt(row.cascade) && row.cascade >= 5) awards.add('ACH_INFINITY_CASCADE_5');
        }
    }
    if (file === 'odyssey.json') {
        const completed = Object.entries(data.completedLevels || {})
            .filter(([key, row]) => Number(key) >= 1 && Number(key) <= 60 && Number.isInteger(row?.stars) && row.stars >= 1 && row.stars <= 3)
            .map(([key]) => Number(key));
        if (completed.length) awards.add('ACH_ODYSSEY_FIRST_ORB');
        if ([1, 2, 3, 4, 5].every((id) => completed.includes(id))) awards.add('ACH_ODYSSEY_CHAPTER_ONE');
    }
    return [...awards];
}

export function assessRecords(book = {}, owner = null) {
    const values = Object.fromEntries(STAT_NAMES.map((name) => [name, Number(book.steamBase?.[name]) || 0]));
    const bests = Object.create(null);
    const earned = new Set((book.earned?.[owner] || []).filter((id) => ACHIEVEMENTS.includes(id)));
    const orbs = new Set();
    const best = (name, score, details, id) => {
        if (isEligibleScore(name, score, details) && betterScore(name, score, bests[name]?.score)) {
            bests[name] = { score, details, id };
        }
    };
    for (const [id, r] of Object.entries(book.runs || {})) {
        if (!validRun(id, r) || r.owner !== owner) continue;
        const lines = r.lines || 0;
        const duration = r.duration || 0;
        values.playtime_minutes += Math.max(1, Math.round(duration / 60));
        values.total_lines_cleared += lines;
        if (r.mode === 'ffa') {
            values.ffa_matches++;
            values.ffa_wins += r.win === true ? 1 : 0;
            values.ffa_kills += r.kills || 0;
            continue;
        }
        // Local records can exceed Steam's signed int32 format. Do not let packing
        // silently clamp a detail and turn it into a different public result.
        const compatible = [duration, lines, r.level ?? 0, r.cascade ?? 0].every(isScoreInt);
        const details = compatible ? packScoreDetails({
            duration, lines, level: r.level, flags: r.flags, checksum32: r.checksum,
        }) : [];
        if (r.mode === 'odyssey') {
            orbs.add(r.level);
            earned.add('ACH_ODYSSEY_FIRST_ORB');
            values.odyssey_stars = Math.max(values.odyssey_stars, r.stars || 0);
            details[4] = r.stars || 0;
            best(N.ODYSSEY_TOTAL_STARS, r.stars || 0, [...details], id);
            if (isCurrentOrbTime(r)) {
                details[4] = r.timeMs;
                best(r.timeBoard, r.timeMs, details, id);
            }
            continue;
        }
        values.total_games_played++;
        if (r.mode === 'single') {
            best(N.SINGLE_PLAYER_HIGH_SCORE, r.score, details, id);
            best(N.SINGLE_PLAYER_LINES, lines, details, id);
            if (lines >= 100) earned.add('ACH_SINGLE_100_LINES');
        } else {
            details[4] = r.cascade || 0;
            best(N.INFINITY_HIGH_SCORE, r.score, details, id);
            best(N.INFINITY_SURVIVAL_TIME, duration, details, id);
            best(N.INFINITY_BEST_CASCADE, r.cascade || 0, details, id);
            values.best_cascade = Math.max(values.best_cascade, r.cascade || 0);
            values.infinity_best_time = Math.max(values.infinity_best_time, duration);
            if (r.cascade >= 5) earned.add('ACH_INFINITY_CASCADE_5');
        }
    }
    if ([1, 2, 3, 4, 5].every((id) => orbs.has(id))) earned.add('ACH_ODYSSEY_CHAPTER_ONE');
    for (const name of STAT_NAMES) values[name] = Math.min(0x7fffffff, values[name]);
    return { values, bests, awards: [...earned].sort() };
}
