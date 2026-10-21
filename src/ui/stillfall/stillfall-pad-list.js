/**
 * @fileoverview The Stillfall puzzle atlas on a gamepad. Select opens it; while it is open
 * it owns the first pad: the D-pad or stick walks the puzzles (up and down a row, left and
 * right a card; holding repeats), LB and RB change tier, A plays the one selected, B or
 * Select closes. Every press it takes is latched for gameplay (the controller's held-input
 * release), so the A that chose a puzzle cannot also rotate the new piece. Start always
 * passes through to the pause sheet.
 *
 * The HUD supplies the callbacks (stillfall-hud.js, which hands them to stillfall-atlas.js);
 * the controller consults this before gameplay through GamepadController.setPanelControls.
 */

const BUTTON = Object.freeze({
    A: 0, B: 1, LB: 4, RB: 5, SELECT: 8, START: 9, D_UP: 12, D_DOWN: 13, D_LEFT: 14, D_RIGHT: 15,
});
const AXIS = Object.freeze({ X: 0, Y: 1 });
const REPEAT_DELAY_MS = 420;
const REPEAT_INTERVAL_MS = 180;
const MOVES = Object.freeze([
    {
        id: 'up', step: -1, button: BUTTON.D_UP, axis: AXIS.Y, sign: -1, across: false,
    },
    {
        id: 'down', step: 1, button: BUTTON.D_DOWN, axis: AXIS.Y, sign: 1, across: false,
    },
    {
        id: 'left', step: -1, button: BUTTON.D_LEFT, axis: AXIS.X, sign: -1, across: true,
    },
    {
        id: 'right', step: 1, button: BUTTON.D_RIGHT, axis: AXIS.X, sign: 1, across: true,
    },
]);

/**
 * @param {object} controller the GamepadController (axis tests, held-input latch, DAS reset)
 * @param {object} callbacks
 * @param {() => boolean} callbacks.isActive a puzzle is on the board and nothing covers it
 * @param {() => boolean} callbacks.isListOpen
 * @param {() => void} callbacks.onOpen
 * @param {(step: number) => void} callbacks.onMove -1 up, 1 down
 * @param {(step: number) => void} [callbacks.onMoveAcross] -1 left, 1 right
 * @param {(step: number) => void} [callbacks.onTier] -1 LB, 1 RB
 * @param {() => void} callbacks.onChoose
 * @param {() => void} callbacks.onClose
 * @param {() => number} [callbacks.now]
 */
export function createPuzzleListPadControls(controller, {
    isActive, isListOpen, onOpen, onMove, onMoveAcross, onTier, onChoose, onClose,
    now = () => (globalThis.performance?.now?.() ?? Date.now()),
}) {
    const held = new Map();
    // A button counts once it has been seen up, so a press that began elsewhere never fires here.
    const up = {
        select: false, a: false, b: false, lb: false, rb: false,
    };
    const reset = () => {
        held.clear();
        Object.keys(up).forEach((name) => { up[name] = false; });
    };
    const pressedMove = (gamepad, entry) => Boolean(gamepad.buttons[entry.button]?.pressed)
        || (entry.sign < 0
            ? controller.isAxisNegative?.(gamepad, entry.axis)
            : controller.isAxisPositive?.(gamepad, entry.axis));
    const edge = (gamepad, name, button) => {
        const down = Boolean(gamepad.buttons[button]?.pressed);
        const fired = down && up[name];
        up[name] = !down;
        return fired;
    };
    const swallow = (gamepad) => {
        controller.odysseyHeldInputs[0] = controller.getGameplayPressedState(gamepad, 0);
        controller.clearFixedTickInput?.({ slot: 0 });
        controller.clearDasTimers?.(0);
        return true;
    };
    const step = (entry) => {
        if (!entry.across) onMove(entry.step);
        else onMoveAcross?.(entry.step);
    };
    return {
        reset,
        process(gamepad, slot) {
            if (slot !== 0) return false;
            if (!isActive() || gamepad.buttons[BUTTON.START]?.pressed
                || globalThis.document?.hidden || globalThis.document?.hasFocus?.() === false) {
                reset();
                return false;
            }
            const select = edge(gamepad, 'select', BUTTON.SELECT);
            const choose = edge(gamepad, 'a', BUTTON.A);
            const back = edge(gamepad, 'b', BUTTON.B);
            const tierUp = edge(gamepad, 'lb', BUTTON.LB);
            const tierDown = edge(gamepad, 'rb', BUTTON.RB);
            if (!isListOpen()) {
                held.clear();
                if (!select) return false;
                onOpen();
                return swallow(gamepad);
            }
            const time = now();
            for (const entry of MOVES) {
                if (!pressedMove(gamepad, entry)) {
                    held.delete(entry.id);
                    continue;
                }
                const state = held.get(entry.id);
                if (!state) {
                    held.set(entry.id, { nextAt: time + REPEAT_DELAY_MS });
                    step(entry);
                } else if (time >= state.nextAt) {
                    state.nextAt = time + REPEAT_INTERVAL_MS;
                    step(entry);
                }
            }
            if (tierUp !== tierDown) onTier?.(tierUp ? -1 : 1);
            if (choose) onChoose();
            else if (back || select) onClose();
            return swallow(gamepad);
        },
    };
}
