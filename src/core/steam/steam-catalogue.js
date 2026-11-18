// Shared by Electron, the renderer and the partner-site manifest generator.
export const STEAM_LEADERBOARDS = Object.freeze({
    SINGLE_PLAYER_HIGH_SCORE: 'SinglePlayerHighScore_v1',
    SINGLE_PLAYER_LINES: 'SinglePlayerLines_v1',
    INFINITY_HIGH_SCORE: 'InfinityHighScore_v1',
    INFINITY_SURVIVAL_TIME: 'InfinitySurvivalTime_v1',
    INFINITY_BEST_CASCADE: 'InfinityBestCascade_v1',
    ODYSSEY_TOTAL_STARS: 'OdysseyTotalStars_v3',
    ODYSSEY_LEVEL_TIME_PREFIX: 'OdysseyLevelTime_v7_',
});

export const STAT_NAMES = Object.freeze(['total_games_played', 'total_lines_cleared', 'playtime_minutes',
    'best_cascade', 'infinity_best_time', 'odyssey_stars', 'ffa_matches', 'ffa_wins', 'ffa_kills']);
export const ACHIEVEMENT_DEFINITIONS = Object.freeze({
    ACH_ODYSSEY_FIRST_ORB: { name: 'First Light', description: 'Complete an Odyssey orb.' },
    ACH_ODYSSEY_CHAPTER_ONE: { name: 'Chapter One', description: 'Complete every orb in Odyssey Chapter 1.' },
    ACH_SINGLE_100_LINES: { name: 'One Hundred Lines', description: 'Clear 100 lines in one Single Player run.' },
    ACH_INFINITY_CASCADE_5: { name: 'Five in a Cascade', description: 'Finish an Infinity run with a cascade of five or more.' },
});
export const ACHIEVEMENTS = Object.freeze(Object.keys(ACHIEVEMENT_DEFINITIONS));

const names = STEAM_LEADERBOARDS;
const boards = Object.create(null);
function define(name, label, mode, unit = 'Numeric', orb = 0) {
    // Valve ELeaderboardSortMethod and ELeaderboardDisplayType values for the flat SDK.
    boards[name] = Object.freeze({
        name,
        label,
        mode,
        unit,
        orb,
        sort: orb ? 1 : 2,
        display: { Numeric: 1, TimeSeconds: 2, TimeMilliSeconds: 3 }[unit],
    });
}
define(names.SINGLE_PLAYER_HIGH_SCORE, 'Score', 'single');
define(names.SINGLE_PLAYER_LINES, 'Lines', 'single');
define(names.INFINITY_HIGH_SCORE, 'Score', 'infinity');
define(names.INFINITY_SURVIVAL_TIME, 'Survival', 'infinity', 'TimeSeconds');
define(names.INFINITY_BEST_CASCADE, 'Cascade', 'infinity');
define(names.ODYSSEY_TOTAL_STARS, 'Campaign stars', 'odyssey');
for (let orb = 1; orb <= 60; orb++) {
    if (orb !== 39 && orb !== 58) define(names.ODYSSEY_LEVEL_TIME_PREFIX + orb, `Orb ${orb}`, 'odyssey', 'TimeMilliSeconds', orb);
}
export const BOARDS = Object.freeze(boards);
export const betterScore = (name, value, previous) => previous == null
    || (BOARDS[name]?.sort === 1 ? value < previous : value > previous);
export const isScoreInt = (value) => Number.isInteger(value) && value >= 0 && value <= 0x7fffffff;

export function isEligibleScore(name, score, details) {
    const board = BOARDS[name];
    if (!board || !isScoreInt(score) || !Array.isArray(details) || details.length !== 7) return false;
    const [version, seconds, lines, level, metric, flags, checksum] = details;
    if (version !== 1 || ![seconds, lines, level, metric, flags].every(isScoreInt)
        || !Number.isInteger(checksum) || (checksum | 0) !== checksum || (flags & ~15) || (flags & 4)) return false;
    if (board.orb) {
        return score > 0 && level === board.orb && score === metric
        && Math.abs(seconds - score / 1000) <= 1;
    }
    if (name === names.ODYSSEY_TOTAL_STARS) return score === metric && score <= 180;
    if (name === names.SINGLE_PLAYER_LINES) return score === lines;
    if (name === names.INFINITY_SURVIVAL_TIME) return score > 0 && score === seconds;
    if (name === names.INFINITY_BEST_CASCADE) return score === metric;
    return true;
}
