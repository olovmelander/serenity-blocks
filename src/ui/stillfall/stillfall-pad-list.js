/**
 * @fileoverview The Stillfall puzzle list on a gamepad. Select opens the list; while it is
 * open the list owns the first pad: D-pad or stick up and down walk the puzzles (holding
 * repeats), A plays the one marked, B or Select closes. Every press the list takes is
 * latched for gameplay (the controller's held-input release), so the A that chose a puzzle
 * cannot also rotate the new piece. Start always passes through to the pause sheet.
 *
 * The HUD supplies the callbacks (stillfall-hud.js); the controller consults this before
 * gameplay through GamepadController.setPanelControls.
 */

const BUTTON = Object.freeze({
    A: 0, B: 1, SELECT: 8, START: 9, D_UP: 12, D_DOWN: 13,
});
const REPEAT_DELAY_MS = 420;
const REPEAT_INTERVAL_MS = 180;
const MOVES = Object.freeze([
    { step: -1, button: BUTTON.D_UP, sign: -1 },
    { step: 1, button: BUTTON.D_DOWN, sign: 1 },
]);

/**
 * @param {object} controller the GamepadController (axis tests, held-input latch, DAS reset)
 * @param {object} callbacks
 * @param {() => boolean} callbacks.isActive a puzzle is on the board and nothing covers it
 * @param {() => boolean} callbacks.isListOpen
 * @param {() => void} callbacks.onOpen
 * @param {(step: number) => void} callbacks.onMove -1 up, 1 down
 * @param {() => void} callbacks.onChoose
 * @param {() => void} callbacks.onClose
 * @param {() => number} [callbacks.now]
 */
export function createPuzzleListPadControls(controller, {
    isActive, isListOpen, onOpen, onMove, onChoose, onClose,
    now = () => (globalThis.performance?.now?.() ?? Date.now()),
}) {
    const held = new Map();
    // A button counts once it has been seen up, so a press that began elsewhere never fires here.
    const up = { select: false, a: false, b: false };
    const reset = () => {
        held.clear();
        up.select = false;
        up.a = false;
        up.b = false;
    };
    const pressedMove = (gamepad, entry) => Boolean(gamepad.buttons[entry.button]?.pressed)
        || (entry.sign < 0 ? controller.isAxisNegative?.(gamepad, 1) : controller.isAxisPositive?.(gamepad, 1));
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
            if (!isListOpen()) {
                held.clear();
                if (!select) return false;
                onOpen();
                return swallow(gamepad);
            }
            const time = now();
            for (const entry of MOVES) {
                if (!pressedMove(gamepad, entry)) {
                    held.delete(entry.step);
                    continue;
                }
                const state = held.get(entry.step);
                if (!state) {
                    held.set(entry.step, { nextAt: time + REPEAT_DELAY_MS });
                    onMove(entry.step);
                } else if (time >= state.nextAt) {
                    state.nextAt = time + REPEAT_INTERVAL_MS;
                    onMove(entry.step);
                }
            }
            if (choose) onChoose();
            else if (back || select) onClose();
            return swallow(gamepad);
        },
    };
}
