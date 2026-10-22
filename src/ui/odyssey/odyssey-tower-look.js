/**
 * Odyssey's tall wells: looking around the tower as Infinity does (the ascent).
 *
 * Every Odyssey well taller than the twenty rows on screen is an Infinity or hybrid orb, and its
 * board scrolls behind the same camera as Infinity's. The ascent director
 * (ui/infinity/ascent/infinity-ascent.js) gives it the same journey: the wheel, a trackpad, the
 * right stick or the tower map pull the view, the game holds its breath, the theme sinks away and
 * cranes, the night comes down from above and a haze rises from below, motes stream past, and
 * the view flies home. The director scales the journey to the well (towerScale): rising to the
 * top of a 24-row well brings the full night, as rising 24 rows does in Infinity.
 *
 * OdysseyMode owns the game; this module is its half of the director's contract:
 * - the pause the look asks for goes through OdysseyMode.onPause/onResume (owner
 *   'odyssey-exploration'), so the level clock stops as under any pause, and the HUD does not
 *   call it a pause; a menu opened over a look keeps its pause after the look ends, and a
 *   resume from elsewhere ends the look without resuming twice (Infinity's rules);
 * - home is where the follow camera held the well when the look began;
 * - after a game key ends the look the camera settles home here at once (the follow, which
 *   re-targets every frame as Infinity's does since 2026-10-22, would glide back at its own pace).
 */

import { InfinityAscent } from '../infinity/ascent/infinity-ascent.js';

export const ODYSSEY_LOOK_OWNER = 'odyssey-exploration';
/** How fast the camera settles home after a game key ends a look (s, exponential). */
const HOME_SETTLE_S = 0.08;

/**
 * Does this attempt's well scroll behind the Infinity camera, and so get the ascent?
 * @param {any} mode OdysseyMode @param {any} [session] the level session
 */
export function usesOdysseyTowerLook(mode, session = mode._activeLevelSession) {
    const state = session?.gameState;
    const settings = mode.boardScene?.cameraSettings;
    if (!state?.isInfinityMode || session.duel || !settings) return false;
    return (state.board?.length || 0) > (settings.visibleRows || 20);
}

/** Can the player look now: the orb is playing, not starting, ending or retired. */
function isLookable(mode) {
    const state = mode.gameState;
    return Boolean(mode.isRunning && mode.entryPhase === 'running' && !mode.levelCompleting
        && state && !state.isGameOver && mode._lookSession === mode._activeLevelSession
        && mode._isLevelSessionActive(mode._activeLevelSession));
}

/** The camera's first row at play: while looking, where the look began. */
function homeTop(mode) {
    if (mode.isInExplorationMode) return mode.explorationStartCameraRow;
    return mode.boardScene?.cameraSettings?.currentTopRow ?? 0;
}

function createDirector(mode) {
    return new InfinityAscent({
        getBoardScene: () => mode.boardScene,
        getGameState: () => mode.gameState,
        getMinimap: () => mode.minimap,
        getBoardJuice: () => mode.boardJuice,
        isRunning: () => isLookable(mode),
        isExternallyPaused: () => mode.isPaused && !mode.isInExplorationMode,
        isExploring: () => mode.isInExplorationMode,
        beginExploration: () => beginOdysseyLook(mode),
        endExploration: () => endOdysseyLook(mode),
        homeTop: () => homeTop(mode),
        summitRow: () => mode._findHighestBlockRow(),
        updateMinimapView: (top) => mode._updateMinimap(top),
        // An orb asks for cascades, lines or time, never for height: no floors across the well.
        milestones: () => [],
        settings: () => mode.deps.settingsManager?.get?.() || {},
        soundManager: mode.deps.soundManager,
        themeManager: mode.deps.themeManager,
        gamepadController: mode.deps.gamepadController,
    });
}

/**
 * Begin looking around this attempt's well, if it scrolls (OdysseyMode.beginLevelRun).
 * @param {any} mode @param {any} session
 */
export function startOdysseyTowerLook(mode, session) {
    stopOdysseyTowerLook(mode);
    if (!usesOdysseyTowerLook(mode, session)) return false;
    mode._lookSession = session;
    mode._towerLook ??= createDirector(mode);
    mode._towerLook.start();
    return true;
}

/** The attempt is over (retired, retried, stopped): everything back as it was. @param {any} mode */
export function stopOdysseyTowerLook(mode) {
    cancelHomeSettle(mode);
    mode.isInExplorationMode = false;
    mode._lookOwnsPause = false;
    mode._lookSession = null;
    mode._towerLook?.stop();
}

/** The mode is deselected: the director's sky and listeners go. @param {any} mode */
export function disposeOdysseyTowerLook(mode) {
    stopOdysseyTowerLook(mode);
    mode._towerLook?.dispose();
    mode._towerLook = null;
}

/**
 * The pull gave way (or the tower map was pressed): pause the orb for the look.
 * @param {any} mode @returns {Promise<boolean>}
 */
export async function beginOdysseyLook(mode) {
    const session = mode._activeLevelSession;
    const state = session?.gameState;
    if (!isLookable(mode) || mode.isPaused || state.isPaused || mode.isInExplorationMode) return false;
    cancelHomeSettle(mode);
    mode._lookOwnsPause = true;
    mode.explorationStartCameraRow = mode.boardScene?.cameraSettings?.currentTopRow ?? 0;
    mode.isInExplorationMode = true;
    mode.onPause({ owner: ODYSSEY_LOOK_OWNER, session });
    if (!mode.isPaused) {
        // The pause was refused (the start cue): no look.
        mode.isInExplorationMode = false;
        mode._lookOwnsPause = false;
        return false;
    }
    mode.boardScene?.enableManualCameraControl?.();
    return true;
}

/**
 * The look ends: the camera goes home and, when the look owns the pause, the orb plays on.
 * @param {any} mode @param {{resumeMode?: boolean}} [options] resumeMode false: stay paused
 * @returns {boolean}
 */
export function endOdysseyLook(mode, { resumeMode = true } = {}) {
    const session = mode._lookSession;
    if (!mode.isInExplorationMode || !session || mode._activeLevelSession !== session) return false;
    const shouldResume = resumeMode && mode._lookOwnsPause;
    mode.isInExplorationMode = false;
    mode._lookOwnsPause = false;
    mode._towerLook?.onExplorationEnded();
    const scene = mode.boardScene;
    scene?.disableManualCameraControl?.();
    settleHome(mode, scene, mode.explorationStartCameraRow, session);
    if (shouldResume) mode.onResume({ owner: ODYSSEY_LOOK_OWNER, session });
    return true;
}

/**
 * Escape over a look (main.js): the look ends, the orb stays paused under the menu, whose own
 * resume ends the pause. @param {any} mode @returns {boolean}
 */
export function endOdysseyLookForMenu(mode) {
    if (!mode.isInExplorationMode) return false;
    if (mode.minimap) {
        mode.minimap.isExploring = false;
        mode.minimap.isDragging = false;
    }
    const ended = endOdysseyLook(mode, { resumeMode: false });
    if (ended) {
        mode.odysseyHUD?.setPaused(true);
        // The look's own pause skipped the board's presentation pause (exploring), and the mode
        // stays paused, so nothing paused it again: the board animated under Settings (audit
        // 2026-10-18).
        mode._setBoardPresentationPaused?.(true);
    }
    return ended;
}

/**
 * OdysseyMode.onPause: a pause from elsewhere over a look outlives it.
 * @param {any} mode @param {{owner?: string, session?: any}} [options]
 * @returns {boolean} whether this is the look's own pause
 */
export function notePauseOverLook(mode, options = {}) {
    const own = options.owner === ODYSSEY_LOOK_OWNER && options.session === mode._lookSession;
    if (mode.isInExplorationMode && !own) mode._lookOwnsPause = false;
    return own;
}

/**
 * OdysseyMode.onResume: a resume from elsewhere wins; the look ends first, without resuming.
 * @param {any} mode @param {{owner?: string}} [options]
 */
export function noteResumeOverLook(mode, options = {}) {
    if (mode.isInExplorationMode && options.owner !== ODYSSEY_LOOK_OWNER) {
        endOdysseyLook(mode, { resumeMode: false });
    }
}

function cancelHomeSettle(mode) {
    if (mode._lookHomeFrame) cancelAnimationFrame(mode._lookHomeFrame);
    mode._lookHomeFrame = null;
}

/** Bring the camera home over a few frames (a landed flight is home already). */
function settleHome(mode, scene, home, session) {
    cancelHomeSettle(mode);
    const settings = scene?.cameraSettings;
    if (!settings || !Number.isFinite(home) || typeof requestAnimationFrame !== 'function') return;
    let last = null;
    const frame = (now) => {
        mode._lookHomeFrame = null;
        if (mode._activeLevelSession !== session || mode.boardScene !== scene || settings.manualControl) return;
        const dt = last === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        const current = Number.isFinite(settings.currentTopRow) ? settings.currentTopRow : home;
        const gap = home - current;
        if (Math.abs(gap) < 0.02) {
            if (gap !== 0) scene.updateCameraPosition(home, true);
            return;
        }
        scene.updateCameraPosition(current + gap * (1 - Math.exp(-dt / HOME_SETTLE_S)), true);
        mode._lookHomeFrame = requestAnimationFrame(frame);
    };
    mode._lookHomeFrame = requestAnimationFrame(frame);
}
