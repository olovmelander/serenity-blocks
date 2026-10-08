/** Standard controller buttons, in preference order. Never reserve gameplay or camera controls. */
const FINISH_BUTTONS = [
    [8, 'View / Back'], [4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'], [10, 'L3'],
    [3, 'Y'], [2, 'X'], [0, 'A'], [1, 'B'], [12, '↑'], [13, '↓'], [14, '←'], [15, '→'],
];

/** The first controller may finish a showcase without repurposing a gameplay binding. */
export function createOdysseyShowcasePadControls(controller, { isActive, onFinish, onHintChange }) {
    let bindingConfig;
    let buttonCount;
    let binding;
    let armed = false;
    const reset = () => { armed = false; };
    const updateBinding = (gamepad) => {
        const config = controller.getGameplayBindingConfig(0);
        const count = gamepad?.buttons?.length ?? 17;
        if (config === bindingConfig && count === buttonCount) return;
        bindingConfig = config;
        buttonCount = count;
        const reserved = new Set(Object.values(config).map((action) => action.index));
        binding = FINISH_BUTTONS.find(([index]) => index < count && !reserved.has(index));
        reset();
        // Unsupported/short pads with no spare button retain the clickable/keyboard Finish action.
        onHintChange?.(binding?.[1] || null);
    };
    updateBinding(controller.gamepads[0]);
    return {
        reset,
        process(gamepad, slot) {
            if (slot !== 0) return false;
            updateBinding(gamepad);
            if (!binding || !isActive() || document.hidden || document.hasFocus?.() === false
                || controller.getMenuSheet() || controller.menuNavigationEnabled
                || controller.gameModeSelectionEnabled || controller.serenityShortcutsLive()
                || document.body?.classList?.contains('serenity-hub-open')
                || gamepad.buttons[9]?.pressed || gamepad.buttons[bindingConfig.pause.index]?.pressed) {
                reset();
                return false;
            }
            if (!gamepad.buttons[binding[0]]?.pressed) {
                armed = true;
                return false;
            }
            if (!armed) return false;
            reset();
            controller.odysseyHeldInputs[0] = controller.getGameplayPressedState(gamepad, 0);
            controller.clearFixedTickInput({ slot: 0 });
            controller.clearDasTimers(0);
            onFinish();
            return true;
        },
    };
}

/** An exact level attempt owns its keyboard and controller showcase shortcuts. */
export function installOdysseyShowcaseInput(mode) {
    const session = mode._activeLevelSession;
    let disposed = false;
    const isActive = () => !disposed && mode._isLevelSessionActive(session)
        && session.gameState.victoryLapActive && !session.gameState.isPaused && !mode.isPaused;
    const onKeyDown = (event) => {
        // Escape keeps its ordinary Pause meaning; Enter deliberately finishes the optional lap.
        if (event.key !== 'Enter' || event.defaultPrevented || !isActive()) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) mode._finishVictoryLap();
    };
    const pad = mode.deps.gamepadController?.setOdysseyShowcaseControls?.({
        isActive,
        onFinish: () => mode._finishVictoryLap(),
        onHintChange: (label) => {
            mode.odysseyHUD?.setFinishGamepadHint(label);
            const hint = mode._goalCompleteOverlay?.querySelector('[data-pad]');
            if (hint) {
                hint.textContent = label || '';
                hint.hidden = !label;
            }
        },
    });
    const reset = () => pad?.reset();
    // Capture before gameplay: Enter may also be a remapped drop or rotation key.
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', reset);
    return () => {
        if (disposed) return;
        disposed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('blur', reset);
        pad?.dispose();
    };
}
