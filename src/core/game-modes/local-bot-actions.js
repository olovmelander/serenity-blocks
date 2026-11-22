/**
 * The actions a local versus bot plays its board with (LocalBotManager's actionFactory): the
 * same core moves a person's keys make, with the move, turn and drop sounds and the board's
 * juice. The physics callbacks come from main.js's one live builder.
 */

import {
    move as coreMove,
    rotate as coreRotate,
    softDrop as coreSoftDrop,
    hardDrop as coreHardDrop,
} from '../game.js';

/**
 * @param {any} mode the LocalMultiplayerMode
 * @param {number} playerIndex
 */
export function createLocalBotActions(mode, playerIndex) {
    const playerNum = playerIndex + 1;
    const getPlayerState = () => mode.multiplayerState?.players?.[playerIndex];
    // main.js injects the ONE live callback builder. The mode's former local
    // fallback builder was dead code that fixes kept landing in — deleted.
    const getPhysicsCallbacks = () => mode.deps.getMultiplayerPhysicsCallbacks?.(playerNum) || {};
    const playMove = () => mode.deps.soundManager?.sfxPlayer?.playMove?.();
    const playRotate = () => mode.deps.soundManager?.sfxPlayer?.playRotate?.();
    const playDrop = () => mode.deps.soundManager?.sfxPlayer?.playDrop?.();
    const shift = (dir) => {
        const moved = coreMove(getPlayerState(), dir, playMove);
        if (moved) mode._applyBotBoardJuice(playerNum, 'move', dir);
        return moved;
    };
    const turn = (dir) => {
        const rotated = coreRotate(getPlayerState(), dir, playRotate);
        if (rotated) mode._applyBotBoardJuice(playerNum, 'rotate', dir);
        return rotated;
    };

    return {
        moveLeft: () => shift(-1),
        moveRight: () => shift(1),
        rotateLeft: () => turn('left'),
        rotateRight: () => turn('right'),
        rotateFlip: () => turn('flip'),
        softDrop: () => coreSoftDrop(getPlayerState(), playDrop, getPhysicsCallbacks()),
        hardDrop: () => {
            const playerState = getPlayerState();
            if (!playerState?.currentPiece) return false;
            coreHardDrop(playerState, playDrop, getPhysicsCallbacks());
            mode._applyBotBoardJuice(playerNum, 'hardDrop');
            return true;
        },
    };
}
