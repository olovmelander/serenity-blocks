/**
 * Own the legacy window movement decoration outside the simulation layer.
 * Identity-checked disposal cannot overwrite a newer mode/input owner.
 *
 * @param {{
 *   gameState: Object,
 *   isActive: () => boolean,
 *   juice: {
 *     disabled?: boolean,
 *     nudge: (x: number, y: number) => void,
 *     tilt: (amount: number) => void,
 *   },
 * }} options
 * @returns {{dispose: () => void, wrappedMove: Function, wrappedRotate: Function}|null}
 */
export function installLegacyBoardJuiceInputWrapper(options) {
    const browserWindow = typeof window === 'undefined' ? null : window;
    if (!browserWindow || !options?.juice || !options.gameState) return null;

    const { gameState, isActive, juice } = options;
    const originalMove = browserWindow.move;
    const originalRotate = browserWindow.rotate;
    let installed = true;
    const ownsInput = () => installed && isActive() === true;

    const wrappedMove = (dir) => {
        if (!ownsInput() || gameState.hitStopRemaining > 0) return false;
        const result = originalMove?.(dir);
        if (!juice.disabled) {
            juice.nudge(dir * 1.5, 0);
            juice.tilt(dir * 0.4);
        }
        return result;
    };
    const wrappedRotate = (dir) => {
        if (!ownsInput() || gameState.hitStopRemaining > 0) return undefined;
        const result = originalRotate?.(dir);
        if (!juice.disabled) {
            juice.tilt(dir === 'left' ? -0.3 : 0.3);
        }
        return result;
    };
    const dispose = () => {
        if (!installed) return;
        installed = false;
        if (browserWindow.move === wrappedMove) browserWindow.move = originalMove;
        if (browserWindow.rotate === wrappedRotate) browserWindow.rotate = originalRotate;
    };

    browserWindow.move = wrappedMove;
    browserWindow.rotate = wrappedRotate;
    return { dispose, wrappedMove, wrappedRotate };
}
