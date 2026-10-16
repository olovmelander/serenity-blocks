/**
 * The theme arrows: step to the previous or next theme you have collected, in the Hub's order.
 *
 * Browsing should feel instant and cost nothing: a press names the theme at once (onPreview)
 * and the switch waits DELAY_MS for the next press, so passing three themes on the way builds
 * only the one you stop on. The theme manager coalesces switches too (latest wins); this keeps
 * the intermediate themes from being asked for at all.
 *
 * A theme you step to is your choice, as in the Hub: it is saved as the background theme and
 * stays in every mode until you choose another.
 */
import { THEME_REGISTRY, getThemeMeta, resolveThemeId } from '../../themes/theme-registry.js';

export const DELAY_MS = 420;

/** The themes the arrows walk through: the Hub's order, only those you may use. */
export function steppableThemes(themeManager) {
    return THEME_REGISTRY.map((entry) => entry.id).filter((id) => themeManager?.canSelectTheme?.(id) !== false
        && themeManager?.isThemeUnlocked?.(id) !== false);
}

/**
 * The theme `direction` steps away from `fromId` in `list`, wrapping round.
 * @param {string[]} list @param {string|null} fromId @param {number} direction -1 or 1
 * @returns {string|null}
 */
export function stepThemeId(list, fromId, direction) {
    if (!list.length) return null;
    const index = list.indexOf(resolveThemeId(fromId));
    if (index < 0) return list[direction < 0 ? list.length - 1 : 0];
    return list[(index + (direction < 0 ? -1 : 1) + list.length) % list.length];
}

/** @param {string|null} id @returns {string} the theme's name as the Hub shows it */
export function themeName(id) {
    return getThemeMeta(id)?.displayName || String(id || '');
}

export class SerenityWorldStepper {
    /**
     * @param {object} options
     * @param {any} options.themeManager
     * @param {any} [options.settingsManager]
     * @param {(themeId: string, position: {index: number, total: number}) => void} [options.onPreview]
     * @param {(themeId: string|null, ok: boolean) => void} [options.onSettled]
     * @param {(themeId: string|null) => void} [options.onAlone] there is no other theme to step to
     * @param {(callback: () => void, ms: number) => any} [options.schedule]
     * @param {(handle: any) => void} [options.cancel]
     */
    constructor({
        themeManager, settingsManager = null, onPreview = () => {}, onSettled = () => {}, onAlone = () => {},
        schedule = (callback, ms) => setTimeout(callback, ms),
        cancel = (handle) => clearTimeout(handle),
    }) {
        this.themeManager = themeManager;
        this.settingsManager = settingsManager;
        this.onPreview = onPreview;
        this.onSettled = onSettled;
        this.onAlone = onAlone;
        this.schedule = schedule;
        this.cancelTimer = cancel;
        this.target = null;
        this.timer = null;
        this.token = 0;
    }

    /** Where the arrows stand: the theme they point at, its place in the list and the count. */
    position(themeId = this.target || this.themeManager?.activeThemeName) {
        const list = steppableThemes(this.themeManager);
        return { list, index: list.indexOf(resolveThemeId(themeId)), total: list.length };
    }

    /**
     * @param {number} direction -1 previous, 1 next
     * @returns {string|null} the theme the arrows now point at
     */
    step(direction) {
        const from = this.target || this.themeManager?.activeThemeName || null;
        const { list } = this.position(from);
        if (list.length < 2) {
            this.onAlone(from);
            return null;
        }
        const next = stepThemeId(list, from, direction);
        this.target = next;
        this.onPreview(next, { index: list.indexOf(next), total: list.length });
        this._clear();
        this.timer = this.schedule(() => this.apply(), DELAY_MS);
        return next;
    }

    /** Switch to the theme the arrows point at now (also what the delay ends in). */
    async apply() {
        this._clear();
        const { target } = this;
        if (!target) return false;
        this.token += 1;
        const { token } = this;
        let applied = null;
        try {
            applied = await this.themeManager.switchTheme(target);
        } catch (error) {
            console.warn('[Serenity] Theme step failed:', error);
        }
        if (token !== this.token) return false;
        this.target = null;
        const ok = applied === target && this.themeManager.activeThemeName === target;
        if (ok) saveThemeChoice(this.settingsManager, target);
        this.onSettled(this.themeManager.activeThemeName || null, ok);
        return ok;
    }

    /** Forget a pending step (the mode is leaving). */
    cancel() {
        this._clear();
        this.target = null;
        this.token += 1;
    }

    _clear() {
        if (this.timer !== null) this.cancelTimer(this.timer);
        this.timer = null;
    }
}

/** A theme you chose (an arrow, Random): saved as your background in every mode, as the Hub does. */
export function saveThemeChoice(settingsManager, themeId) {
    if (!settingsManager?.update || !themeId) return;
    settingsManager.update({ backgroundTheme: themeId, backgroundMode: 'Specific' });
    settingsManager.save?.();
}
