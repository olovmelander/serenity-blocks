import {
    hardDrop as coreHardDrop,
    move as coreMove,
    rotate as coreRotate,
    softDrop as coreSoftDrop,
} from '../../core/game.js';

/**
 * Own Odyssey's legacy window command surface for one captured level attempt.
 * Identity-checked disposal cannot overwrite a newer mode or fixed-tick owner.
 */
export function installOdysseyLegacyInputWrapper({
    gameState,
    isActive,
    juice,
    physicsCallbacks,
    soundPlayer,
}) {
    const browserWindow = typeof window === 'undefined' ? null : window;
    if (!browserWindow || !gameState) return null;

    const originals = {
        hardDrop: browserWindow.hardDrop,
        move: browserWindow.move,
        rotate: browserWindow.rotate,
        softDrop: browserWindow.softDrop,
    };
    let installed = true;
    const canInput = () => installed
        && isActive() === true
        && !gameState.isPaused
        && !gameState.isGameOver
        && gameState.hitStopRemaining <= 0;

    const wrappers = {
        move: (dir) => {
            if (!canInput()) return;
            const mirroredDirection = gameState.mirrorControls ? -dir : dir;
            const moved = coreMove(gameState, mirroredDirection, () => soundPlayer?.playMove?.());
            if (moved) {
                juice?.nudge?.(mirroredDirection * 1.5, 0);
                juice?.tilt?.(mirroredDirection * 0.4);
            } else {
                juice?.nudge?.(mirroredDirection * 0.8, 0);
            }
        },
        rotate: (dir) => {
            if (!canInput()) return;
            coreRotate(gameState, dir, () => soundPlayer?.playRotate?.());
            juice?.tilt?.(dir === 'left' ? -0.3 : 0.3);
        },
        hardDrop: () => {
            if (!canInput()) return;
            juice?.dip?.(3);
            juice?.bounce?.();
            coreHardDrop(gameState, () => soundPlayer?.playDrop?.(), physicsCallbacks);
        },
        softDrop: () => {
            if (!canInput()) return;
            coreSoftDrop(gameState, () => soundPlayer?.playDrop?.(), physicsCallbacks);
        },
    };
    const dispose = () => {
        if (!installed) return;
        installed = false;
        Object.entries(wrappers).forEach(([name, wrapper]) => {
            if (browserWindow[name] === wrapper) browserWindow[name] = originals[name];
        });
    };

    Object.assign(browserWindow, wrappers);
    return { dispose, wrappers };
}
