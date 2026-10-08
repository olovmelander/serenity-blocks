import { showToast } from '../../ui/components/toast.js';

/** Temporary presentation permission is separate from earned collection ownership. */
export function captureOdysseyThemePreference(mode) {
    const manager = mode.deps?.themeManager;
    mode._odysseyPreferredTheme = mode.deps?.settingsManager?.get?.()?.backgroundTheme
        || manager?.activeThemeName || 'forest';
}

export async function releaseOdysseyThemeAccess(mode) {
    const scope = mode._odysseyThemeScope;
    mode._odysseyThemeScope = null;
    mode._odysseyThemeCommittedToken = null;
    if (mode.transitionManager) mode.transitionManager.themeAccessScope = null;
    if (scope) await mode.deps?.themeManager?.endOdysseyThemeScope?.(scope);
}

export async function activateOdysseyLevelTheme(mode, levelConfig, { isCurrent = () => true } = {}) {
    const { theme } = levelConfig || {};
    const manager = mode.deps?.themeManager;
    const soundManager = mode.deps?.soundManager;
    if (!isCurrent()) return false;
    const entryToken = mode.themeRevealToken;
    // The scenic flow owner retires after Ready. The same orb keeps its permission
    // through gameplay and Pause, until a new entry/return/stop retires this token.
    const ownsTheme = () => mode.isActive !== false && mode.themeRevealToken === entryToken
        && (mode._odysseyThemeCommittedToken === entryToken || isCurrent());
    const scope = manager?.beginOdysseyThemeScope?.(theme?.primary, {
        isCurrent: ownsTheme,
        restoreTheme: mode.deps?.settingsManager?.get?.()?.backgroundTheme || mode._odysseyPreferredTheme,
        onRuntimeFailure: () => {
            const session = mode._activeLevelSession;
            if (!ownsTheme() || mode._odysseyThemeScope !== scope
                || mode._odysseyThemeCommittedToken !== entryToken
                || mode.currentLevelConfig !== levelConfig || mode.levelCompleting
                || !mode._isLevelSessionActive?.(session)) return false;
            mode.onPause?.();
            const returning = mode.returnToBoard({ focusLevelId: levelConfig.id });
            showToast({ type: 'error', message: 'This world could not be restored. Try this orb again from Odyssey.' });
            return returning;
        },
    });
    mode._odysseyThemeScope = scope;
    if (mode.transitionManager) mode.transitionManager.themeAccessScope = scope;
    try {
        if (mode.transitionManager?.activatePrefetchedLevelTheme) {
            const activated = await mode.transitionManager.activatePrefetchedLevelTheme(levelConfig, { isCurrent });
            if (activated === false) return false;
        } else if (manager && theme?.primary) {
            if (mode.currentThemePrefetchPromise) await mode.currentThemePrefetchPromise;
            else await manager.loadTheme?.(theme.primary, true);
            if (!isCurrent()) return false;
            const args = scope ? [theme.primary, true, scope] : [theme.primary, true];
            const applied = await manager.switchTheme(...args);
            if (!isCurrent() || (typeof applied === 'string' && applied !== theme.primary)
                || applied === false || applied === null) return false;
            if (manager.themesSuspended) await manager.resumeThemes();
        }
        if (!isCurrent()) return false;
        soundManager?.resumeThemeLinkedMusic?.(true);
        if (soundManager?.ensureTrackPlaybackSynced) {
            await soundManager.ensureTrackPlaybackSynced({
                reason: 'odyssey-level-entry', force: true, waitForFade: false,
            }).catch((error) => console.warn('[Odyssey] Theme music sync drift during level entry:', error));
        }
        return isCurrent();
    } catch (error) {
        console.error('[Odyssey] Level theme activation failed:', error);
        return false;
    } finally {
        if (isCurrent()) {
            mode.currentThemePrefetchPromise = null;
            mode.currentThemePrefetchLevelId = null;
        }
    }
}

/** Browse only an already available orb, after the world is ready. */
export async function focusOdysseyCollectionLevel(mode, levelId) {
    if (mode.boardViewReadyPromise) await mode.boardViewReadyPromise;
    const available = () => mode.isActive && mode.isInBoardView && !mode.isEnteringLevel
        && !mode._journeyFlowOperation
        && mode.odysseyState.isLevelUnlocked(levelId);
    if (!available()) return false;
    const focused = await mode.boardController?.travelToLevel?.(levelId, { isCurrent: available });
    if (focused === false || !available()) return false;
    mode.selectedLevelId = levelId;
    mode._updateLevelPreview(levelId);
    return true;
}
