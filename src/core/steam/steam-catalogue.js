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

/**
 * The board generation of every Odyssey orb that is past its first, by orb id: `{ 26: 2 }`.
 * An orb that is not listed is on generation 1 and keeps the name the partner site was set up
 * with, `OdysseyLevelTime_v7_<orb>`.
 *
 * List an orb here when a change can alter how fast it is cleared: its goal, layout, speed,
 * garbage, mechanics or rival. It then races on a board of its own,
 * `OdysseyLevelTime_v7_<orb>_g<generation>`, which must exist on the Steam partner site before
 * the build ships. The other orbs keep their boards. Times recorded on the old board keep their
 * stars and history and stop racing (progression/record-book.js).
 *
 * tests/unit/odyssey-time-board-freeze.test.js fails when an orb changes and is neither listed
 * here nor re-pinned (scripts/odyssey-time-board-freeze.mjs).
 */
export const ODYSSEY_TIME_BOARD_GENERATIONS = Object.freeze({});

/** Valve's `k_cchLeaderboardNameMax`: a leaderboard name holds at most this many UTF-8 bytes. */
export const STEAM_LEADERBOARD_NAME_MAX_BYTES = 128;

/** The campaign's orbs, and the two survival orbs that have no fastest-first board. */
const ODYSSEY_ORB_COUNT = 60;
const ORBS_WITHOUT_TIME_BOARD = Object.freeze([39, 58]);

/**
 * The one place an orb's time board is named. Everything that records, ranks, uploads or shows
 * an orb time asks here, so a new generation of one orb reaches all of them at once.
 * @param {number|string} orb the orb's public id
 * @param {Record<string, number>} [generations] defaults to the shipped table
 * @returns {string}
 */
export function odysseyTimeBoardName(orb, generations = ODYSSEY_TIME_BOARD_GENERATIONS) {
    const generation = Object.hasOwn(generations, orb) ? generations[orb] : 1;
    if (!Number.isInteger(generation) || generation < 1) {
        throw new RangeError(`Odyssey orb ${orb} has an invalid board generation: ${generation}`);
    }
    const first = STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX + orb;
    return generation === 1 ? first : `${first}_g${generation}`;
}

/**
 * Whether a name is an orb time board of any campaign version and any generation, current or
 * retired. A score queued for one is a time: lower is better, even when its board is gone.
 * @param {unknown} name
 */
export function isOdysseyTimeBoardName(name) {
    return typeof name === 'string' && /^OdysseyLevelTime_v[1-9]\d*_[1-9]\d*(?:_g[1-9]\d*)?$/.test(name);
}

export const STAT_NAMES = Object.freeze(['total_games_played', 'total_lines_cleared', 'playtime_minutes',
    'best_cascade', 'infinity_best_time', 'odyssey_stars', 'ffa_matches', 'ffa_wins', 'ffa_kills']);
export const ACHIEVEMENT_DEFINITIONS = Object.freeze({
    ACH_ODYSSEY_FIRST_ORB: { name: 'First Light', description: 'Complete an Odyssey orb.' },
    ACH_ODYSSEY_CHAPTER_ONE: { name: 'Chapter One', description: 'Complete every orb in Odyssey Chapter 1.' },
    ACH_SINGLE_100_LINES: { name: 'One Hundred Lines', description: 'Clear 100 lines in one Single Player run.' },
    ACH_INFINITY_CASCADE_5: { name: 'Five in a Cascade', description: 'Finish an Infinity run with a cascade of five or more.' },
});
export const ACHIEVEMENTS = Object.freeze(Object.keys(ACHIEVEMENT_DEFINITIONS));

export const isScoreInt = (value) => Number.isInteger(value) && value >= 0 && value <= 0x7fffffff;

/**
 * The boards the game reads and writes, with the rules that go with them, for one generation
 * table. The game uses the shipped table (the exports below); a test builds another to show
 * what a new generation of one orb does.
 * @param {Record<string, number>} [generations]
 */
export function createSteamCatalogue(generations = ODYSSEY_TIME_BOARD_GENERATIONS) {
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
    // Only an orb's current generation is a board here. A retired one stays on Steam as it was
    // and is no longer read or written.
    for (let orb = 1; orb <= ODYSSEY_ORB_COUNT; orb++) {
        if (ORBS_WITHOUT_TIME_BOARD.includes(orb)) continue;
        define(odysseyTimeBoardName(orb, generations), `Orb ${orb}`, 'odyssey', 'TimeMilliSeconds', orb);
    }
    const BOARDS = Object.freeze(boards);

    const betterScore = (name, value, previous) => previous == null
        || (BOARDS[name]?.sort === 1 ? value < previous : value > previous);

    function isEligibleScore(name, score, details) {
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

    return Object.freeze({
        BOARDS,
        betterScore,
        isEligibleScore,
        /** @param {number|string} orb */
        odysseyTimeBoardName: (orb) => odysseyTimeBoardName(orb, generations),
    });
}

const shipped = createSteamCatalogue();
export const { BOARDS, betterScore, isEligibleScore } = shipped;
