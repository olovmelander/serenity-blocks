import { showToast } from './components/toast.js';
import { resolveOwnedMusicPreference } from '../core/progression/music-preference.js';
import { getBreathCollection } from './effects/breathing/breath-collection-store.js';

/** Application-owned collection navigation and free-play selection. */
export function sanitizeCollectionThemeSetting(app) {
    const settings = app.settingsManager?.get?.();
    if (!settings || !app.themeCollection) return;
    app.soundManager?.setThemeCollection?.(app.themeCollection);
    const changes = {};
    if (!app.themeCollection.isUnlocked(settings.backgroundTheme)) changes.backgroundTheme = 'forest';
    const musicTrack = resolveOwnedMusicPreference(settings.musicTrack, app.themeCollection);
    if (musicTrack !== settings.musicTrack) changes.musicTrack = musicTrack;
    if (app.soundManager && app._musicCollectionOwner !== app.themeCollection) {
        app._musicCollectionOwner = app.themeCollection;
        app.soundManager.setTrack?.(musicTrack, { persist: false });
    }
    if (Object.keys(changes).length === 0) return;
    app.settingsManager.update(changes, false);
    app.settingsManager.save?.();
}

export function canExploreThemeCollection(app) {
    const mode = app.gameModeManager?.getCurrentMode?.();
    const onOdysseyMap = app.gameModeManager?.getCurrentModeId?.() === 'odyssey'
        && mode?.isInBoardView && mode.isActive && mode.isRunning
        && !mode.isEnteringLevel && !mode._journeyFlowOperation;
    const atMenu = app.modalManager?.isVisible?.('start') && !mode?.isRunning;
    return {
        allowed: Boolean(onOdysseyMap || atMenu),
        reason: 'Open Odyssey from the main menu or its world map. Your current session stays here.',
    };
}

export function themeCollectionDependencies(app) {
    return {
        themeCollection: app.themeCollection,
        // An Odyssey chapter also opens a breathing world and its Hale session (breath-collection.js).
        breathCollection: getBreathCollection(),
        canExploreTheme: () => canExploreThemeCollection(app),
        onExploreTheme: (themeId) => exploreThemeFromCollection(app, themeId),
        notifyOdysseyThemeFailure: () => showToast({
            type: 'error', message: 'This world could not be restored. Try this orb again from Odyssey.',
        }),
    };
}

export async function focusThemeCollectionTarget(app, detail = {}) {
    if (detail.mode !== 'odyssey' || !detail.collectionThemeId) return false;
    const mode = app.gameModeManager?.getCurrentMode?.();
    if (app.gameModeManager?.getCurrentModeId?.() !== 'odyssey' || !mode?.isActive) return false;
    const status = app.themeCollection?.getThemeStatus(detail.collectionThemeId);
    if (!status || status.owned) return false;
    const targetId = status.requirement?.levelId;
    const levels = mode.levelRegistry.getAllLevels();
    const eligible = (id) => mode.odysseyState.isLevelUnlocked(id);
    const target = targetId && eligible(targetId) ? targetId : levels.find((level) => (
        eligible(level.id) && !mode.odysseyState.isLevelCompleted(level.id)
    ))?.id;
    if (!target) return false;
    return mode.focusCollectionLevel?.(target) ?? false;
}

export async function exploreThemeFromCollection(app, themeId) {
    if (!app.themeCollection?.getThemeStatus(themeId) || !canExploreThemeCollection(app).allowed) return false;
    app.serenityHub?.hide({ resumeGameplay: false });
    const detail = { mode: 'odyssey', collectionThemeId: themeId };
    const mode = app.gameModeManager?.getCurrentMode?.();
    if (app.gameModeManager?.getCurrentModeId?.() === 'odyssey' && mode?.isActive
        && mode.isRunning && mode.isInBoardView) {
        return focusThemeCollectionTarget(app, detail);
    }
    // Reuse the normal startup/overlay/input owner. Never grant access or launch an orb here.
    window.dispatchEvent(new CustomEvent('startGameWithMode', { detail }));
    return true;
}

export async function switchToRandomCollectedTheme(app) {
    const theme = app.themeManager.getRandomTheme();
    if (!theme || app.themeManager.canSelectTheme?.(theme) === false) return false;
    const applied = await app.themeManager.switchTheme(theme);
    if (applied !== theme || app.themeManager.activeThemeName !== theme) return false;
    if (app.settingsManager.get().backgroundMode === 'Specific') {
        app.settingsManager.update({ backgroundTheme: theme }, false);
        app.settingsManager.save?.();
        const select = document.getElementById('background-theme');
        if (select) select.value = theme;
    }
    return true;
}
