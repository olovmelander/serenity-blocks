/** Current positions of named experiments; historical artifact labels remain unchanged. */
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';

export const MAX_ODYSSEY_LEVEL_ID = Math.max(...LEVEL_CONFIGS.map((level) => level.id));

export function levelIdForTheme(themeId) {
    const matches = LEVEL_CONFIGS.filter((level) => level.theme?.primary === themeId);
    if (matches.length !== 1) throw new Error(`Expected one authored orb for theme ${themeId}`);
    return matches[0].id;
}

export const MASTERY_LEVEL_IDS = Object.freeze(
    ['fluid-dreams', 'singing-bowl', 'neon-district'].map(levelIdForTheme),
);
