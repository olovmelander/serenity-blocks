import { ROWS } from '../../core/constants.js';
import { calculateTopRow } from '../../core/infinity-grid.js';

const owners = new WeakMap();

/** Configure the shared well without giving its camera ownership of simulation. */
export function configureOdysseyBoardPresentation({
    scene, session, settingsManager, getJuice,
}) {
    if (!scene) return { syncSettings() {}, dispose() {} };
    owners.get(scene)?.dispose();
    let disposed = false;
    let owner;
    const ownsScene = () => !disposed && owners.get(scene) === owner;
    const syncSettings = () => {
        if (!ownsScene()) return;
        const settings = settingsManager?.get?.() || {};
        const reducedMotion = Boolean(settings.reducedMotion
            || globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
        session.gameState.settings = { reducedMotion };
        scene.setEffectQuality?.(settings.effectQuality || 'High');
        const juice = getJuice?.();
        if (juice) {
            juice.disabled = reducedMotion;
            if (reducedMotion) juice.reset?.();
        }
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        globalThis.window?.removeEventListener?.('settingsChanged', syncSettings);
        if (owners.get(scene) === owner) owners.delete(scene);
    };
    owner = { syncSettings, dispose };
    owners.set(scene, owner);
    scene.setWellStyle?.(true);
    scene.configureCamera?.();
    if (session.gameState.isInfinityMode) {
        const top = session.gameState.lockedPieces.length
            ? calculateTopRow(session.gameState) : session.gameState.board.length;
        const topRow = Math.max(0, Math.min(session.gameState.board.length - ROWS, top - ROWS));
        scene.updateCameraPosition?.(topRow, true);
    }
    syncSettings();
    globalThis.window?.addEventListener?.('settingsChanged', syncSettings);
    return owner;
}

/** Mount the opponent as a visual observer of this exact attempt. */
export async function prepareOdysseyOpponentPresentation(mode, session) {
    if (!session.duel) return true;
    const options = { deps: mode.deps, isCurrent: () => mode._isLevelSessionActive(session) };
    session.opponentBoard = await mode.odysseyHUD?.prepareOpponentBoard?.(session.duel.players[1], options);
    if (!mode._isLevelSessionActive(session)) {
        session.opponentBoard?.dispose();
        return false;
    }
    mode.boardScenes = session.opponentBoard?.scene ? [session.opponentBoard.scene] : [];
    mode.phaserGames = session.opponentBoard?.game ? [session.opponentBoard.game] : [];
    session.duel.setPresentation({
        getHumanCallbacks: () => ({
            onGarbageApplied: (count) => mode._getPhysicsCallbacks(session).onGarbageApplied?.(count),
            onTopOut: () => mode._getPhysicsCallbacks(session).onTopOut?.(),
            onRoundWin: () => mode._getBoardScene()?.sharedEffects?.playRoundWin?.(),
            onVictory: () => mode._getBoardScene()?.sharedEffects?.playVictory?.(),
        }),
        getBotCallbacks: () => session.opponentBoard?.getVisualCallbacks() || {},
    });
    return true;
}

/** Both wells keep their renderer and lose only the previous round's transients. */
export function resetOdysseyRoundPresentation(mode, session) {
    const scene = mode._getBoardScene();
    scene?.sharedEffects?.cleanup?.();
    scene?.clearBoard?.();
    mode.boardJuice?.reset?.();
    session.boardPresentation?.syncSettings();
    session.opponentBoard?.resetRound(session.duel.players[1]);
    mode._odysseyBoardLayout?.update({ danger: false });
}
