/**
 * Gem abilities during an orb: keys 1, 2 and 3, and the first controller's spare buttons.
 * Gameplay bindings are never taken; a key the player bound to a move stays a move.
 */
import { ODYSSEY_GEM_ABILITIES } from '../../core/odyssey/odyssey-gems.js';

const KEY_CODES = Object.freeze({
    Digit1: 'tide',
    Numpad1: 'tide',
    Digit2: 'still-air',
    Numpad2: 'still-air',
    Digit3: 'second-breath',
    Numpad3: 'second-breath',
});

/** Standard controller buttons, in preference order. Gameplay bindings, Start and View are never taken. */
const GEM_BUTTONS = [[4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'], [10, 'L3'], [11, 'R3'], [2, 'X'], [3, 'Y']];

/** The ability a key press asks for, or null when it is not a gem key or the key is a gameplay binding. */
export function resolveOdysseyGemKey(event, reservedKeys = new Set()) {
    const abilityId = KEY_CODES[event?.code] || KEY_CODES[`Digit${event?.key}`] || null;
    if (!abilityId || reservedKeys.has(event.key)) return null;
    return abilityId;
}

/** Spare buttons on the first controller, one per ability, pressed fresh each time. */
export function createOdysseyGemPadControls(controller, { isActive, onUse, onHintChange }) {
    let bindingConfig;
    let buttonCount;
    let bindings = [];
    const armed = new Map();
    const reset = () => armed.clear();
    const updateBinding = (gamepad) => {
        const config = controller.getGameplayBindingConfig(0);
        const count = gamepad?.buttons?.length ?? 17;
        if (config === bindingConfig && count === buttonCount) return;
        bindingConfig = config;
        buttonCount = count;
        const reserved = new Set(Object.values(config).map((action) => action.index));
        const free = GEM_BUTTONS.filter(([index]) => index < count && !reserved.has(index));
        bindings = ODYSSEY_GEM_ABILITIES
            .map((ability, position) => (free[position]
                ? { abilityId: ability.id, index: free[position][0], label: free[position][1] } : null))
            .filter(Boolean);
        reset();
        onHintChange?.(Object.fromEntries(bindings.map((binding) => [binding.abilityId, binding.label])));
    };
    updateBinding(controller.gamepads?.[0]);
    return {
        reset,
        process(gamepad, slot) {
            if (slot !== 0) return false;
            updateBinding(gamepad);
            if (!bindings.length || !isActive() || document.hidden || document.hasFocus?.() === false
                || controller.getMenuSheet?.() || controller.menuNavigationEnabled
                || controller.gameModeSelectionEnabled || controller.serenityShortcutsLive?.()
                || document.body?.classList?.contains('serenity-hub-open')
                || gamepad.buttons[9]?.pressed || gamepad.buttons[bindingConfig?.pause?.index]?.pressed) {
                reset();
                return false;
            }
            for (const binding of bindings) {
                const pressed = Boolean(gamepad.buttons[binding.index]?.pressed);
                if (!pressed) {
                    armed.set(binding.index, true);
                } else if (armed.get(binding.index)) {
                    armed.set(binding.index, false);
                    onUse(binding.abilityId);
                }
            }
            // Gem buttons are spare buttons: the ordinary gameplay poll still runs this frame.
            return false;
        },
    };
}

/** An exact level attempt owns its keyboard and controller gem shortcuts. */
export function installOdysseyGemInput(mode, session = mode._activeLevelSession) {
    let disposed = false;
    const isActive = () => !disposed && mode._isLevelSessionActive(session)
        && !session.gameState.isPaused && !mode.isPaused && !session.gameState.victoryLapActive;
    const settings = typeof window !== 'undefined' ? window.settings : null;
    const reservedKeys = new Set(Object.values(settings?.keyBindings || {}).map(String));
    const onKeyDown = (event) => {
        if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!isActive() || event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        const abilityId = resolveOdysseyGemKey(event, reservedKeys);
        if (!abilityId) return;
        if (mode.useOdysseyGem(abilityId)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const pad = mode.deps?.gamepadController?.setOdysseyGemControls?.({
        isActive,
        onUse: (abilityId) => mode.useOdysseyGem(abilityId),
        onHintChange: (labels) => mode.odysseyHUD?.setGemPadHints?.(labels),
    });
    const reset = () => pad?.reset();
    const doc = typeof document !== 'undefined' ? document : null;
    const view = typeof window !== 'undefined' ? window : null;
    doc?.addEventListener?.('keydown', onKeyDown, true);
    view?.addEventListener?.('blur', reset);
    return () => {
        if (disposed) return;
        disposed = true;
        doc?.removeEventListener?.('keydown', onKeyDown, true);
        view?.removeEventListener?.('blur', reset);
        pad?.dispose?.();
    };
}
