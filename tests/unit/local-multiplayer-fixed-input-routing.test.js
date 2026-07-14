import { describe, expect, it } from 'vitest';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { INPUT_DISPOSITIONS } from '../../src/core/simulation-tick.js';
import {
    createLocalMultiplayerFixedInputBinding,
    createLocalMultiplayerFixedTickRuntime,
    runLocalMultiplayerFixedTicks,
    startLocalMultiplayerFixedTickRuntime,
} from '../../src/core/game-modes/local-multiplayer-fixed-tick.js';
import { InputController } from '../../src/ui/controls.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

describe('Local Multiplayer production fixed-input routing', () => {
    it('routes keyboard P1 and gamepads P2-P4 to exact per-player queues', () => {
        const multiplayerState = new MultiPlayerState(4);
        multiplayerState.reset();
        multiplayerState.isPaused = false;
        const inputController = new InputController();
        const gamepadController = new GamepadController();
        const binding = createLocalMultiplayerFixedInputBinding({
            players: multiplayerState.players,
            inputController,
            gamepadController,
            isEnabled: () => true,
        });
        expect(binding.install()).toBe(true);

        expect(inputController.enqueueFixedTickAction({
            playerIndex: 0,
            logicalAction: 'moveLeft',
            physicalKey: 'a',
            event: { repeat: false },
            keyMapKey: 'moveLeft',
        })).toEqual({ handled: true, accepted: true });
        expect(gamepadController.pressFixedTickAction(1, null, 'rotate', 'right'))
            .toEqual({ handled: true, accepted: true });
        expect(gamepadController.pressFixedTickAction(2, 'right', 'move', 1))
            .toEqual({ handled: true, accepted: true });
        expect(gamepadController.pressFixedTickAction(3, null, 'hardDrop', null))
            .toEqual({ handled: true, accepted: true });

        // P1 is already owned by the keyboard; a pad edge is claimed but rejected,
        // so it cannot fall through to a legacy callback.
        expect(gamepadController.pressFixedTickAction(0, 'right', 'move', 1))
            .toEqual({ handled: true, accepted: false });

        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        const applied = [];
        runLocalMultiplayerFixedTicks(runtime, 1000 / 60, {
            ownership,
            advanceInput: binding.advanceInput,
            applyInput: (playerIndex, command) => {
                applied.push({
                    action: command.action,
                    playerIndex,
                    value: command.value ?? null,
                });
                return INPUT_DISPOSITIONS.APPLIED;
            },
        });

        expect(applied).toEqual([
            { action: 'move', playerIndex: 0, value: -1 },
            { action: 'rotate', playerIndex: 1, value: 'right' },
            { action: 'move', playerIndex: 2, value: 1 },
            { action: 'hardDrop', playerIndex: 3, value: null },
        ]);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1, 1, 1]);
        expect(binding.getActiveDevice(0)).toBe('keyboard');
        expect(binding.getActiveDevice(1)).toBe('gamepad');
        expect(binding.getActiveDevice(2)).toBe('gamepad');
        expect(binding.getActiveDevice(3)).toBe('gamepad');

        binding.dispose();
        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
    });
});
