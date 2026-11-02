/**
 * @fileoverview A replay on a gamepad (the playback bar, playback-controls.js). The bar was
 * click-only: a controller could neither pause, seek, change speed nor stop a replay.
 *
 * While the bar is up it owns every pad: A plays and pauses, B stops, the D-pad or the left
 * stick seeks back and forward (holding repeats), LB and RB step the speed. Menu (Start) and
 * View pass through: Settings pauses the replay over it, View opens the Serenity Hub. A menu
 * over the replay (Settings, the Hub, a sheet) takes the pad back at once. A button already
 * held when the bar takes the pad counts only after it has been seen up, and every press it
 * takes is latched for the game behind it (the controller's held-input release).
 *
 * Installed through GamepadController.setPanelControls (consulted before menus and play).
 */

const BUTTON = Object.freeze({
    A: 0, B: 1, LB: 4, RB: 5, VIEW: 8, START: 9, D_LEFT: 14, D_RIGHT: 15,
});
const AXIS_X = 0;
/** One seek step, and how a held direction repeats it. */
export const REPLAY_SEEK_STEP_MS = 5000;
const REPEAT_DELAY_MS = 420;
const REPEAT_INTERVAL_MS = 220;

const SEEKS = Object.freeze([
    { id: 'back', sign: -1, button: BUTTON.D_LEFT },
    { id: 'forward', sign: 1, button: BUTTON.D_RIGHT },
]);

/**
 * @param {object} controller the GamepadController (stick tests, held-input latch, DAS reset)
 * @param {object} callbacks
 * @param {() => boolean} callbacks.isActive the bar is up and nothing covers it
 * @param {() => void} callbacks.togglePlayPause
 * @param {() => void} callbacks.stop
 * @param {(deltaMs: number) => void} callbacks.seekBy
 * @param {(direction: number) => void} callbacks.stepSpeed -1 slower (LB), 1 faster (RB)
 * @param {() => number} [callbacks.now]
 */
export function createReplayPadControls(controller, {
    isActive, togglePlayPause, stop, seekBy, stepSpeed,
    now = () => (globalThis.performance?.now?.() ?? Date.now()),
}) {
    /** `${slot}:${name}` → the button has been seen up since the bar took the pad. */
    const seenUp = new Map();
    /** `${slot}:${seek}` → when a held seek repeats next. */
    const holds = new Map();
    const reset = () => {
        seenUp.clear();
        holds.clear();
    };
    const forgetSlot = (slot) => {
        for (const key of [...seenUp.keys(), ...holds.keys()]) {
            if (key.startsWith(`${slot}:`)) {
                seenUp.delete(key);
                holds.delete(key);
            }
        }
    };
    const edge = (gamepad, slot, name, button) => {
        const key = `${slot}:${name}`;
        const down = Boolean(gamepad.buttons[button]?.pressed);
        const fired = down && seenUp.get(key) === true;
        seenUp.set(key, !down);
        return fired;
    };
    const seekHeld = (gamepad, entry) => Boolean(gamepad.buttons[entry.button]?.pressed)
        || (entry.sign < 0
            ? controller.isAxisNegative?.(gamepad, AXIS_X)
            : controller.isAxisPositive?.(gamepad, AXIS_X));

    return {
        reset,
        process(gamepad, slot) {
            if (!isActive()) {
                reset();
                return false;
            }
            // Settings and the Hub keep their buttons; what the bar saw held waits again after.
            if (gamepad.buttons[BUTTON.START]?.pressed || gamepad.buttons[BUTTON.VIEW]?.pressed) {
                forgetSlot(slot);
                return false;
            }
            const playPause = edge(gamepad, slot, 'a', BUTTON.A);
            const back = edge(gamepad, slot, 'b', BUTTON.B);
            const slower = edge(gamepad, slot, 'lb', BUTTON.LB);
            const faster = edge(gamepad, slot, 'rb', BUTTON.RB);

            const time = now();
            for (const entry of SEEKS) {
                const key = `${slot}:${entry.id}`;
                if (!seekHeld(gamepad, entry)) {
                    holds.delete(key);
                    seenUp.set(key, true);
                    continue;
                }
                if (seenUp.get(key) !== true) continue;
                const hold = holds.get(key);
                if (!hold) {
                    holds.set(key, { nextAt: time + REPEAT_DELAY_MS });
                    seekBy(entry.sign * REPLAY_SEEK_STEP_MS);
                } else if (time >= hold.nextAt) {
                    hold.nextAt = time + REPEAT_INTERVAL_MS;
                    seekBy(entry.sign * REPLAY_SEEK_STEP_MS);
                }
            }

            if (slower !== faster) stepSpeed(faster ? 1 : -1);
            if (playPause) togglePlayPause();
            else if (back) stop();

            // Nothing the bar took reaches the game behind it, now or when it lets go.
            if (controller.odysseyHeldInputs && typeof controller.getGameplayPressedState === 'function') {
                controller.odysseyHeldInputs[slot] = controller.getGameplayPressedState(gamepad, slot);
            }
            controller.clearFixedTickInput?.({ slot });
            controller.clearDasTimers?.(slot);
            return true;
        },
    };
}
