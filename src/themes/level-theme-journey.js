/**
 * Background mode "As you level up": the world behind the board changes every
 * LEVELS_PER_THEME levels. A game starts on the theme already on screen, and each
 * later stretch of levels draws the next theme from the shared shuffle deck, so
 * every owned theme comes up before one repeats and no two games open alike.
 */
export const LEVELS_PER_THEME = 3;

/** Stage 0 holds levels 1-3, stage 1 levels 4-6, and so on. */
export function levelStage(level) {
    const value = Number(level);
    return Number.isFinite(value) ? Math.max(0, Math.floor((value - 1) / LEVELS_PER_THEME)) : 0;
}

/** Fisher-Yates, in place. */
export function shuffleInPlace(list, random = Math.random) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/** Newly owned themes go on top of the deck (drawn first), in random order among themselves. */
export function dealOnTop(deck, fresh, random = Math.random) {
    const top = shuffleInPlace([...fresh], random);
    return [...deck.filter((id) => !top.includes(id)), ...top];
}

export class LevelThemeJourney {
    /**
     * @param {object} hooks
     * @param {() => string} hooks.onScreen the owned theme showing now, or the one to fall back to
     * @param {(current: string) => string} hooks.drawNext the next theme after `current`
     * @param {(id: string) => boolean} hooks.isOwned
     */
    constructor({ onScreen, drawNext, isOwned }) {
        this.onScreen = onScreen;
        this.drawNext = drawNext;
        this.isOwned = isOwned;
        this.stage = null;
        this.theme = null;
        this.requested = null;
    }

    /** Start over at `level`, from `startTheme` when it is owned, otherwise from the theme on screen. */
    restart(level = 1, startTheme = null) {
        this.stage = levelStage(level);
        this.theme = startTheme && this.isOwned(startTheme) ? startTheme : this.onScreen();
        this.requested = null;
        return this.theme;
    }

    /** The theme for `level`'s stretch; a later stretch draws the next theme, once. */
    themeFor(level) {
        const stage = levelStage(level);
        // A lower stage is a new game nobody announced: start over rather than draw.
        if (this.stage === null || stage < this.stage || !this.isOwned(this.theme)) {
            return this.restart(level);
        }
        if (stage > this.stage) {
            this.stage = stage;
            this.theme = this.drawNext(this.theme);
        }
        return this.theme;
    }

    /**
     * The theme to switch to now, or null. Each stretch asks once, so a switch that is
     * still building is not queued again on every frame (audit LIFE-04).
     */
    nextSwitch(level, activeTheme) {
        const theme = this.themeFor(level);
        if (!theme || theme === activeTheme || theme === this.requested) return null;
        this.requested = theme;
        return theme;
    }
}
