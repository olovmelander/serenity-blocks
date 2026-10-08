import { THEMES } from '../core/constants.js';
import { getThemeMeta, resolveThemeId } from './theme-registry.js';

/** Ownership governs selection; an opaque, revocable scope permits one Odyssey orb. */
export class ThemePlaybackAccess {
    constructor(collection = null) {
        this.collection = collection;
        this.scope = null;
        this.preferredTheme = 'forest';
    }

    isUnlocked(themeId) {
        const id = resolveThemeId(themeId);
        return Boolean(getThemeMeta(id))
            && (id === 'forest' || !this.collection || this.collection.isUnlocked(id));
    }

    getOwnedThemes() {
        return THEMES.filter((id) => this.isUnlocked(id));
    }

    rememberSelection(themeId) {
        if (this.isUnlocked(themeId)) this.preferredTheme = resolveThemeId(themeId);
    }

    getRestoreTheme() {
        return this.isUnlocked(this.preferredTheme) ? this.preferredTheme : 'forest';
    }

    begin(themeId, { isCurrent = () => true, restoreTheme } = {}) {
        const id = resolveThemeId(themeId);
        if (!getThemeMeta(id)) throw new Error(`Unknown Odyssey theme: ${themeId}`);
        this.rememberSelection(restoreTheme);
        const token = Object.freeze({ themeId: id });
        this.scope = { token, isCurrent };
        return token;
    }

    canUse(themeId, token = null) {
        const id = resolveThemeId(themeId);
        if (!token) return !this.isScopeActive() && this.isUnlocked(id);
        return this.scope?.token === token
            && token.themeId === id
            && this.scope.isCurrent() === true;
    }

    isScopeActive() {
        return this.scope?.isCurrent() === true;
    }

    end(token) {
        if (!token || this.scope?.token !== token) return null;
        this.scope = null;
        return this.getRestoreTheme();
    }

    cleanup() {
        this.scope = null;
    }
}
