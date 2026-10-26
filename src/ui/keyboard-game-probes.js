// @ts-check
/**
 * @fileoverview What the global keyboard handler (controls.js) asks the game before a key
 * plays: who sits in seat 2, whether a game is being played, whether the mode keeps
 * Escape for itself. Kept out of main.js, which spreads these into its game actions.
 */
import { GAME_MODES } from '../core/constants.js';

/**
 * @param {{ gameModeManager?: any }} app the SerenityBlocks app
 */
export function createKeyboardGameProbes(app) {
    const currentMode = () => app.gameModeManager?.getCurrentMode?.() || null;
    return {
        /**
         * Player 2's keys play only while a person plays seat 2 of a Local Versus match;
         * elsewhere (and against a bot) they stay Player 1's.
         */
        isPlayer2KeyboardActive: () => {
            const mode = currentMode();
            if (mode?.getModeId?.() !== GAME_MODES.LOCAL_MULTIPLAYER) return false;
            if (!mode.multiplayerState?.players?.[1]) return false;
            return mode._isBotPlayer?.(1) !== true;
        },
        /**
         * Whether a piece is in play. Off it (the Odyssey map, a replay, a paused or
         * finished game) Space and Enter on a focused control press that control.
         */
        isGameplayLive: () => {
            const mode = currentMode();
            if (!mode?.isRunning) return false;
            // The Odyssey map keeps the last board's piece as a preview: no orb is in play there.
            if (mode.levelRunStarted === false) return false;
            const versus = mode.multiplayerState;
            if (versus) return !versus.isGameOver && !versus.isPaused;
            const state = mode.gameState;
            // A mode without one (online versus) keeps its keys the game's.
            if (!state) return true;
            return Boolean(state.currentPiece) && !state.isGameOver && !state.isPaused && !state.isReplay;
        },
        /** Serenity Mode leaves on Escape while that is its exitToMenu key. */
        modeOwnsEscape: () => {
            const mode = currentMode();
            if (!mode?.isRunning || mode.getModeId?.() !== GAME_MODES.SERENITY) return false;
            const key = mode.keyFor?.('exitToMenu');
            return key === 'Escape' || key === 'Esc';
        },
    };
}
