import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { createPlayerInputState } from '../../src/core/player-input-state.js';

function pad() {
    return {
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0, 0, 0],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('gamepad binding configuration ownership', () => {
    it('reuses each slot configuration across unchanged polls and replaces only changed slots', () => {
        const controller = new GamepadController();
        const bindings = Array.from({ length: 4 }, (_, index) => ({ moveLeft: index + 4 }));
        controller.updateBindings(...bindings);
        controller.setGameActions({});
        const configurations = bindings.map((_, slot) => controller.getGameplayBindingConfig(slot));
        const gamepad = pad();

        for (let frame = 0; frame < 100; frame += 1) {
            for (let slot = 0; slot < 4; slot += 1) {
                controller.processGamepadInput(gamepad, slot);
                expect(controller.getGameplayBindingConfig(slot)).toBe(configurations[slot]);
            }
        }

        bindings[2].moveLeft = 12;
        expect(controller.getGameplayBindingConfig(2)).not.toBe(configurations[2]);
        expect(controller.getGameplayBindingConfig(2).moveLeft.index).toBe(12);
        expect(controller.getGameplayBindingConfig(0)).toBe(configurations[0]);
        expect(controller.bindingConfigCache).toHaveLength(4);
    });

    it('keeps in-place rebinding live while releasing and repressing canonical input', () => {
        const controller = new GamepadController();
        const bindings = { moveLeft: 14 };
        const state = { simFrame: 20, playerInput: createPlayerInputState() };
        const legacyMove = vi.fn();
        controller.setGameActions({ move: legacyMove });
        controller.setFixedTickInputAdapter({
            resolveGameState: () => state,
            isEnabled: () => true,
        });
        controller.updateBindings(bindings, null);
        const gamepad = pad();
        gamepad.buttons[14].pressed = true;
        controller.processGamepadInput(gamepad, 0);

        bindings.moveLeft = 10;
        controller.processGamepadInput(gamepad, 0);
        gamepad.buttons[10].pressed = true;
        controller.processGamepadInput(gamepad, 0);

        expect(state.playerInput.pendingEdges).toEqual([
            expect.objectContaining({
                tick: 21, action: 'move', value: -1, phase: 'down',
            }),
            expect.objectContaining({
                tick: 21, action: 'move', value: -1, phase: 'up',
            }),
            expect.objectContaining({
                tick: 21, action: 'move', value: -1, phase: 'down',
            }),
        ]);
        expect(legacyMove).not.toHaveBeenCalled();
    });

    it('invalidates replacement bindings and preserves default/nullish and zero-valued mappings', () => {
        const controller = new GamepadController();
        controller.updateBindings({ moveLeft: 0 }, null);
        const previous = controller.getGameplayBindingConfig(0);
        expect(previous.moveLeft.index).toBe(0);
        controller.customBindings[0] = { moveLeft: null };
        expect(controller.getGameplayBindingConfig(0).moveLeft.index).toBe(14);
        controller.updateBindings({ moveLeft: 7 }, null);
        expect(controller.getGameplayBindingConfig(0).moveLeft.index).toBe(7);
        controller.updateBindings(null, null);
        expect(controller.getGameplayBindingConfig(0).moveLeft.index).toBe(14);
        expect(controller.bindingConfigCache[0]).toBeNull();
    });

    it('refreshes the Serenity merge after in-place edits, added/deleted keys and settings replacement', () => {
        let settings = { serenityGamepadBindings: { toggleHub: 5 } };
        vi.stubGlobal('window', { settingsManager: { get: () => settings } });
        const controller = new GamepadController();
        const first = controller.getSerenityGamepadBindings();
        for (let frame = 0; frame < 100; frame += 1) {
            expect(controller.getSerenityGamepadBindings()).toBe(first);
        }

        settings.serenityGamepadBindings.toggleHub = 0;
        const changed = controller.getSerenityGamepadBindings();
        expect(changed).not.toBe(first);
        expect(changed.toggleHub).toBe(0);
        settings.serenityGamepadBindings.openSettings = undefined;
        expect(controller.getSerenityGamepadBindings().openSettings).toBeUndefined();
        delete settings.serenityGamepadBindings.openSettings;
        expect(controller.getSerenityGamepadBindings().openSettings).toBe(9);
        settings = { serenityGamepadBindings: { toggleHub: 6 } };
        expect(controller.getSerenityGamepadBindings().toggleHub).toBe(6);
    });

    it('preserves enumerable overrides without inheriting prototype properties', () => {
        const symbol = Symbol('integration binding');
        const bindings = Object.assign(Object.create({ openSettings: 4 }), { toggleHub: 2, [symbol]: 3 });
        vi.stubGlobal('window', { settings: { serenityGamepadBindings: bindings } });
        const controller = new GamepadController();
        const first = controller.getSerenityGamepadBindings();
        expect(first.openSettings).toBe(9);
        expect(first[symbol]).toBe(3);
        bindings[symbol] = 7;
        expect(controller.getSerenityGamepadBindings()[symbol]).toBe(7);
        delete bindings[symbol];
        expect(Object.hasOwn(controller.getSerenityGamepadBindings(), symbol)).toBe(false);
    });

    it('routes changed Serenity bindings through the next poll without changing held-button edge behavior', () => {
        vi.spyOn(performance, 'now').mockReturnValue(10000);
        const bindings = { toggleHub: 3 };
        vi.stubGlobal('window', { settingsManager: { get: () => ({ serenityGamepadBindings: bindings }) } });
        const controller = new GamepadController();
        const toggleHub = vi.fn();
        controller.enableSerenityMode({ toggleHub, isHubOpen: () => false });
        const gamepad = pad();
        gamepad.buttons[3].pressed = true;
        controller.processSerenityModeInput(gamepad, 0);
        controller.processSerenityModeInput(gamepad, 0);
        expect(toggleHub).toHaveBeenCalledTimes(1);

        bindings.toggleHub = 5;
        controller.processSerenityModeInput(gamepad, 0);
        controller._serenityHubToggleCooldown = -Infinity;
        gamepad.buttons[5].pressed = true;
        controller.processSerenityModeInput(gamepad, 0);
        expect(toggleHub).toHaveBeenCalledTimes(2);
    });
});
