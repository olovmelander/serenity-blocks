/**
 * @fileoverview A spectator's controller in online versus: the D-pad's left and right spotlight
 * the previous and next player's board (a mini-board's click was the only way to choose).
 * A spectator has no piece to move, so these presses play nothing; every other button goes on
 * as before (Menu to Settings, View to the Hub, R3 to the scoreboard), so process() never
 * takes the poll. A press already held when spectating began waits for its release.
 *
 * Installed through GamepadController.setPanelControls by OnlineMultiplayerMode.
 */

const STEPS = Object.freeze([
    { name: 'left', button: 14, direction: -1 },
    { name: 'right', button: 15, direction: 1 },
]);

/**
 * @param {object} callbacks
 * @param {() => boolean} callbacks.isActive spectating a match, with nothing over it
 * @param {(direction: number) => void} callbacks.step -1 previous board, 1 next
 */
export function createSpectatorPadControls({ isActive, step }) {
    const seenUp = { left: false, right: false };
    const reset = () => {
        seenUp.left = false;
        seenUp.right = false;
    };
    return {
        reset,
        process(gamepad, slot) {
            if (slot !== 0) return false;
            if (!isActive()) {
                reset();
                return false;
            }
            for (const { name, button, direction } of STEPS) {
                const down = Boolean(gamepad.buttons[button]?.pressed);
                if (down && seenUp[name]) step(direction);
                seenUp[name] = !down;
            }
            return false;
        },
    };
}
