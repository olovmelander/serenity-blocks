/**
 * Charms during an orb: keys 1 to 4 (the digits and the numpad), a chip click in the HUD, and
 * the first controller's spare buttons. Gameplay bindings are never taken: a key the player
 * bound to a move stays a move (checked against the live settings on every press), and a pad
 * button the player rebound is skipped. Blocked while the tall well's look-around owns the pad
 * (R3 and the right stick drive it; LB and RB send the view home), and never installed on the
 * fixed-tick clock, where charms are refused.
 */
import { ODYSSEY_CHARMS } from '../../core/odyssey/odyssey-charm-bag.js';
import { odysseyCharmsAllowed } from '../../core/odyssey/odyssey-charm-use.js';

const KEY_CODES = Object.freeze(Object.fromEntries(
    ODYSSEY_CHARMS.flatMap((charm) => [[`Digit${charm.key}`, charm.id], [`Numpad${charm.key}`, charm.id]]),
));

/**
 * Spare standard buttons, in preference order. Gameplay bindings, Start, Select (the showcase
 * lap's Finish) and R3 (the tower look) are never taken.
 */
const CHARM_BUTTONS = [[4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'], [10, 'L3'], [2, 'X'], [3, 'Y']];

/** The charm a key press asks for, or null when it is not a charm key or the key is a gameplay binding. */
export function resolveOdysseyCharmKey(event, reservedKeys = new Set()) {
    const charmId = KEY_CODES[event?.code] || KEY_CODES[`Digit${event?.key}`] || null;
    if (!charmId || reservedKeys.has(event.key)) return null;
    return charmId;
}

/** The keys the player's live gameplay bindings own; a charm never takes one. */
export function odysseyReservedCharmKeys(mode) {
    const bindings = mode?.deps?.settingsManager?.get?.()?.keyBindings
        || globalThis.window?.settings?.keyBindings || {};
    return new Set(Object.values(bindings).map(String));
}

/** Spare buttons on the first controller, one per charm, pressed fresh each time. */
export function createOdysseyCharmPadControls(controller, { isActive, onUse, onHintChange }) {
    let bindingConfig;
    let buttonCount;
    let hinted = null;
    let bindings = [];
    const armed = new Map();
    const reset = () => armed.clear();
    const updateBinding = (gamepad) => {
        const config = controller.getGameplayBindingConfig(0);
        const count = gamepad?.buttons?.length ?? 17;
        const connected = Boolean(gamepad);
        if (config === bindingConfig && count === buttonCount && connected === hinted) return;
        bindingConfig = config;
        buttonCount = count;
        hinted = connected;
        const reserved = new Set(Object.values(config).map((action) => action.index));
        const free = CHARM_BUTTONS.filter(([index]) => index < count && !reserved.has(index));
        bindings = ODYSSEY_CHARMS
            .map((charm, position) => (free[position]
                ? { charmId: charm.id, index: free[position][0], label: free[position][1] } : null))
            .filter(Boolean);
        reset();
        // The tiles wear the button labels only while a controller is there to press them.
        onHintChange?.(connected
            ? Object.fromEntries(bindings.map((binding) => [binding.charmId, binding.label])) : {});
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
                    onUse(binding.charmId);
                }
            }
            // Charm buttons are spare buttons: the ordinary gameplay poll still runs this frame.
            return false;
        },
    };
}

/**
 * An exact level attempt owns its keyboard and controller charm shortcuts. A refused press
 * costs nothing and shows its reason on the chip. Returns the disposer.
 */
export function installOdysseyCharmInput(mode, session = mode._activeLevelSession) {
    if (!odysseyCharmsAllowed(session)) return () => {};
    let disposed = false;
    const isActive = () => !disposed && mode._isLevelSessionActive(session)
        && !session.gameState.isPaused && !mode.isPaused && !session.gameState.victoryLapActive
        && !mode.isInExplorationMode;
    const use = (charmId) => {
        const result = mode.useOdysseyCharm(charmId);
        if (!result?.ok && result?.reason) mode.odysseyHUD?.flashCharmReason?.(charmId, result.reason);
        return Boolean(result?.ok);
    };
    const onKeyDown = (event) => {
        if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!isActive() || event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        const charmId = resolveOdysseyCharmKey(event, odysseyReservedCharmKeys(mode));
        if (!charmId) return;
        if (use(charmId)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const pad = mode.deps?.gamepadController?.setOdysseyCharmControls?.({
        isActive,
        onUse: use,
        onHintChange: (labels) => mode.odysseyHUD?.setCharmPadHints?.(labels),
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
