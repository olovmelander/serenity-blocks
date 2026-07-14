import {
    advancePlayerInputTick,
    resetPlayerInputState,
    updateInputHandlingConfig,
} from '../player-input-state.js';

function getLocalState(mode, game = mode.ffaGameState, requireControllable = false) {
    if (!game || game !== mode.ffaGameState) return null;
    const player = game.players?.get(game.localPlayerId);
    if (
        requireControllable
        && (player?.isAlive !== true || player.awaitingSpawn === true)
    ) return null;
    return player?.gameState || null;
}

function advanceHeldInput(mode, currentTime, delta) {
    mode.deps.inputController?.updateDAS?.(delta);
    mode.deps.gamepadController?.advanceGameplayInput?.(currentTime);
}

function resetHeldInput(mode) {
    mode.deps.inputController?.clearTimers?.();
    mode.deps.gamepadController?.clearAllDasTimers?.();
    mode._fixedInputDevice = null;
}

function isOnlineFixedInputEnabled(mode, game, playerIndex) {
    return playerIndex === 0
        && mode.isInMatch === true
        && mode.ffaGameState === game
        && game.isSpectator !== true
        && game._fixedTickEnabled === true
        && game.gamePhase === 'playing';
}

function acceptOnlineFixedInputDevice(mode, device) {
    if (mode._fixedInputDevice == null) mode._fixedInputDevice = device;
    return mode._fixedInputDevice === device;
}

function releaseOnlineFixedInputDevice(mode, device) {
    if (mode._fixedInputDevice === device) mode._fixedInputDevice = null;
}

export function latchOnlineFixedInputHandling(mode, game = mode.ffaGameState) {
    const localState = getLocalState(mode, game);
    if (!localState?.playerInput) return;
    updateInputHandlingConfig(
        localState.playerInput,
        mode.deps.settingsManager?.get?.() || {},
    );
}

export function dispatchOnlineFixedInput(mode, command) {
    const game = mode.ffaGameState;
    if (!game || game.gamePhase !== 'playing' || mode.isInMatch !== true) return false;
    if (!getLocalState(mode, game, true)) return false;

    switch (command?.action) {
    case 'move':
        game.sendInput('move', { direction: command.value });
        mode.boardJuice?.nudge(command.value * 1.5, 0);
        mode.boardJuice?.tilt(command.value * 0.4);
        return true;
    case 'rotate':
        game.sendInput('rotate', { direction: command.value });
        mode.boardJuice?.tilt(command.value === 'left' ? -0.3 : 0.3);
        return true;
    case 'softDrop':
        game.sendInput('drop', { type: 'soft' });
        return true;
    case 'hardDrop':
        game.sendInput('drop', { type: 'hard' });
        mode.boardJuice?.dip(3);
        mode.boardJuice?.bounce();
        return true;
    default:
        return false;
    }
}

export function configureOnlineFixedInput(mode, game) {
    if (!game?.setLocalInputHooks) return;
    mode._fixedInputDevice = null;
    game.setLocalInputHooks({
        advance: (currentTime, delta) => advanceHeldInput(mode, currentTime, delta),
        advanceFixed: (context) => {
            const localState = getLocalState(mode, game);
            if (!localState?.playerInput) return;
            if (!getLocalState(mode, game, true)) {
                resetPlayerInputState(localState.playerInput);
                return;
            }
            advancePlayerInputTick(localState.playerInput, context);
        },
        applyFixed: (command) => dispatchOnlineFixedInput(mode, command),
        reset: () => resetHeldInput(mode),
    });
    latchOnlineFixedInputHandling(mode, game);
}

export function removeOnlineFixedKeyboardAdapter(mode) {
    const { inputController } = mode.deps;
    if (
        inputController?.fixedTickInputAdapter
        && inputController.fixedTickInputAdapter === mode._fixedTickKeyboardAdapter
    ) {
        inputController.setFixedTickInputAdapter(null);
    }
    mode._fixedTickKeyboardAdapter = null;
}

export function installOnlineFixedKeyboardAdapter(mode, game = mode.ffaGameState) {
    const { inputController } = mode.deps;
    if (!inputController?.setFixedTickInputAdapter || !game) return;

    removeOnlineFixedKeyboardAdapter(mode);
    const adapter = {
        resolveGameState: (playerIndex) => (
            playerIndex === 0 ? getLocalState(mode, game, true) : null
        ),
        isEnabled: ({ playerIndex }) => isOnlineFixedInputEnabled(mode, game, playerIndex),
        acceptSource: () => acceptOnlineFixedInputDevice(mode, 'keyboard'),
        releaseSource: () => releaseOnlineFixedInputDevice(mode, 'keyboard'),
    };
    mode._fixedTickKeyboardAdapter = adapter;
    inputController.setFixedTickInputAdapter(adapter);
}

export function removeOnlineFixedGamepadAdapter(mode) {
    const { gamepadController } = mode.deps;
    if (
        gamepadController?.fixedTickInputAdapter
        && gamepadController.fixedTickInputAdapter === mode._fixedTickGamepadAdapter
    ) {
        gamepadController.setFixedTickInputAdapter(null);
    }
    mode._fixedTickGamepadAdapter = null;
}

export function installOnlineFixedGamepadAdapter(mode, game = mode.ffaGameState) {
    const { gamepadController } = mode.deps;
    if (!gamepadController?.setFixedTickInputAdapter || !game) return;

    removeOnlineFixedGamepadAdapter(mode);
    const adapter = {
        resolveGameState: (slot) => (
            slot === 0 ? getLocalState(mode, game, true) : null
        ),
        isEnabled: ({ playerIndex }) => isOnlineFixedInputEnabled(mode, game, playerIndex),
        acceptSource: () => acceptOnlineFixedInputDevice(mode, 'gamepad'),
        releaseSource: () => releaseOnlineFixedInputDevice(mode, 'gamepad'),
    };
    mode._fixedTickGamepadAdapter = adapter;
    gamepadController.setFixedTickInputAdapter(adapter);
}
