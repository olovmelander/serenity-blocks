/**
 * The level rule of a multiplayer match, the same in every mode (local and online).
 *
 * Every board starts at the match's starting level (1 unless the host chose another) and,
 * unless the host turned "Level up as you clear" on, stays there for the whole match: the
 * pieces fall at that level's speed throughout. With it on, a board climbs one level for
 * every 15 lines cleared (physics.js) and its fall speed follows.
 *
 * Pure: it reads a match config and writes one board's level, speed and progression flag.
 * Online, the host and every peer apply it from the same config (LOBBY_GAME_START), so a
 * peer's own simulation keeps the host's speed without being told it.
 */
import { LEVEL_SPEEDS } from '../constants.js';

/** The starting levels a match may choose (the setup sheets' stepper). */
export const MATCH_START_LEVEL_MIN = 1;
export const MATCH_START_LEVEL_MAX = 9;

/**
 * A match config's level rule. A missing or broken starting level is 1; levelling up is
 * off unless the config says `levelProgression: true`.
 * @param {{startLevel?: unknown, levelProgression?: unknown} | null | undefined} config
 * @returns {{startLevel: number, levelProgression: boolean}}
 */
export function readMatchLevelRule(config) {
    const asked = Math.round(Number(config?.startLevel));
    const startLevel = Number.isFinite(asked)
        ? Math.min(MATCH_START_LEVEL_MAX, Math.max(MATCH_START_LEVEL_MIN, asked))
        : MATCH_START_LEVEL_MIN;
    return { startLevel, levelProgression: config?.levelProgression === true };
}

/** The fall interval of a level, as physics.js sets it on a level-up. */
export function dropIntervalForMatchLevel(level) {
    return LEVEL_SPEEDS[Math.min(Math.max(1, level) - 1, LEVEL_SPEEDS.length - 1)];
}

/**
 * Put one board on the match's level rule: the starting level (or, with levelling on, a
 * higher `level` it carries into a new round), that level's fall speed, and whether
 * clearing lines takes it higher.
 * @param {{level: number, dropInterval: number, disableLevelProgression: boolean}} gameState
 * @param {{startLevel?: unknown, levelProgression?: unknown} | null | undefined} config
 * @param {number | null} [level] a level carried from the last round (used only with levelling on)
 * @returns {number} the level the board now stands on
 */
export function applyMatchLevelRule(gameState, config, level = null) {
    const rule = readMatchLevelRule(config);
    const carried = Number.isSafeInteger(level) ? level : rule.startLevel;
    const at = rule.levelProgression ? Math.max(rule.startLevel, carried) : rule.startLevel;
    gameState.disableLevelProgression = !rule.levelProgression;
    gameState.level = at;
    gameState.dropInterval = dropIntervalForMatchLevel(at);
    return at;
}

/**
 * The level rule in a few words, for the waiting room: "1, no level-ups" or
 * "From 3, up every 15 lines".
 * @param {{startLevel?: unknown, levelProgression?: unknown} | null | undefined} config
 */
export function describeMatchLevelRule(config) {
    const { startLevel, levelProgression } = readMatchLevelRule(config);
    return levelProgression ? `From ${startLevel}, up every 15 lines` : `${startLevel}, no level-ups`;
}

/**
 * Set whether each player's board may level up, from the match's rule, leaving its level and
 * speed alone: a resync carries those, but not the rule.
 * @param {Map<string, {gameState?: {disableLevelProgression: boolean}}>} players
 * @param {{levelProgression?: unknown} | null | undefined} config
 */
export function applyMatchLevelProgression(players, config) {
    const { levelProgression } = readMatchLevelRule(config);
    players?.forEach?.((player) => {
        if (player?.gameState) player.gameState.disableLevelProgression = !levelProgression;
    });
}
