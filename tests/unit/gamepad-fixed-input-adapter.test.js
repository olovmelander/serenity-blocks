import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import {
    createPlayerInputState,
    enqueueInputEdge,
    PLAYER_INPUT_EDGE_CAPACITY,
} from '../../src/core/player-input-state.js';

const BUTTON = Object.freeze({
    rotateRight: 0,
    hardDrop: 1,
    moveLeft: 14,
});

function createPad() {
    return {
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0, 0, 0],
    };
}

function createState() {
    return {
        simFrame: 0,
        playerInput: createPlayerInputState(),
    };
}

function createHarness() {
    const controller = new GamepadController();
    const stateRef = { current: createState() };
    const actions = {
        move: vi.fn(),
        rotate: vi.fn(),
        softDrop: vi.fn(),
        hardDrop: vi.fn(),
        togglePause: vi.fn(),
    };
    controller.enabled = true;
    controller.setGameActions(actions);
    controller.setFixedTickInputAdapter({
        resolveGameState: (playerIndex) => (playerIndex === 0 ? stateRef.current : null),
        isEnabled: ({ playerIndex }) => playerIndex === 0,
    });
    return {
        actions, controller, pad: createPad(), stateRef,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('gamepad fixed-tick input adapter', () => {
    it('queues held movement edges without invoking legacy actions or DAS', () => {
        const {
            actions, controller, pad, stateRef,
        } = createHarness();
        pad.buttons[BUTTON.moveLeft].pressed = true;

        controller.processGamepadInput(pad, 0);

        expect(stateRef.current.playerInput.pendingEdges).toEqual([expect.objectContaining({
            tick: 1, action: 'move', value: -1, phase: 'down',
        })]);
        expect(actions.move).not.toHaveBeenCalled();
        expect(controller.dasState[0].left.active).toBe(false);

        pad.buttons[BUTTON.moveLeft].pressed = false;
        controller.processGamepadInput(pad, 0);
        expect(stateRef.current.playerInput.pendingEdges.at(-1)).toMatchObject({
            tick: 1, action: 'move', value: -1, phase: 'up',
        });
    });

    it('queues rotate and hard-drop as down-only canonical edges', () => {
        const {
            actions, controller, pad, stateRef,
        } = createHarness();
        pad.buttons[BUTTON.rotateRight].pressed = true;
        pad.buttons[BUTTON.hardDrop].pressed = true;

        controller.processGamepadInput(pad, 0);

        expect(stateRef.current.playerInput.pendingEdges).toEqual([
            expect.objectContaining({ action: 'rotate', value: 'right', phase: 'down' }),
            expect.objectContaining({ action: 'hardDrop', value: null, phase: 'down' }),
        ]);
        expect(actions.rotate).not.toHaveBeenCalled();
        expect(actions.hardDrop).not.toHaveBeenCalled();
    });

    it('clears and skips stale legacy repeats while the slot is claimed', () => {
        const { controller } = createHarness();
        const legacyRepeat = vi.fn();
        controller.startDas(0, 'left', legacyRepeat);

        controller.processDasTimers(0, 1000);

        expect(legacyRepeat).not.toHaveBeenCalled();
        expect(controller.dasState[0].left.active).toBe(false);
    });

    it('retains legacy behavior for an unclaimed slot', () => {
        const {
            actions, controller, pad,
        } = createHarness();
        controller.setFixedTickInputAdapter({
            resolveGameState: () => null,
            isEnabled: () => false,
        });
        pad.buttons[BUTTON.moveLeft].pressed = true;

        controller.processGamepadInput(pad, 0);

        expect(actions.move).toHaveBeenCalledWith(-1);
        expect(controller.dasState[0].left.active).toBe(true);
    });

    it('fails closed when another device owns the canonical source policy', () => {
        const {
            actions, controller, pad, stateRef,
        } = createHarness();
        controller.fixedTickInputAdapter.acceptSource = () => false;
        pad.buttons[BUTTON.moveLeft].pressed = true;

        controller.processGamepadInput(pad, 0);

        expect(stateRef.current.playerInput.pendingEdges).toEqual([]);
        expect(actions.move).not.toHaveBeenCalled();
        expect(controller.fixedTickHeldActions[0].get('left').cleared).toBe(true);
    });

    it('clears the original owner when a held release crosses a state swap', () => {
        const {
            controller, pad, stateRef,
        } = createHarness();
        const original = stateRef.current;
        pad.buttons[BUTTON.moveLeft].pressed = true;
        controller.processGamepadInput(pad, 0);
        original.playerInput.das.moveLeft.active = true;

        stateRef.current = createState();
        pad.buttons[BUTTON.moveLeft].pressed = false;
        controller.processGamepadInput(pad, 0);

        expect(original.playerInput.pendingEdges).toEqual([]);
        expect(original.playerInput.das.moveLeft.active).toBe(false);
        expect(stateRef.current.playerInput.pendingEdges).toEqual([]);
    });

    it('clears on visibility-style reset and requires neutral before rearming', () => {
        const {
            controller, pad, stateRef,
        } = createHarness();
        pad.buttons[BUTTON.moveLeft].pressed = true;
        controller.processGamepadInput(pad, 0);
        controller.clearAllDasTimers();

        expect(stateRef.current.playerInput.pendingEdges).toEqual([]);
        controller.processGamepadInput(pad, 0);
        expect(stateRef.current.playerInput.pendingEdges).toEqual([]);

        pad.buttons[BUTTON.moveLeft].pressed = false;
        controller.processGamepadInput(pad, 0);
        pad.buttons[BUTTON.moveLeft].pressed = true;
        controller.processGamepadInput(pad, 0);
        expect(stateRef.current.playerInput.pendingEdges).toHaveLength(1);
    });

    it('fails closed when the shared canonical edge queue overflows', () => {
        const {
            actions, controller, pad, stateRef,
        } = createHarness();
        for (let index = 0; index < PLAYER_INPUT_EDGE_CAPACITY; index += 1) {
            enqueueInputEdge(stateRef.current.playerInput, {
                tick: 1,
                action: 'rotate',
                value: 'right',
                phase: 'down',
            });
        }
        pad.buttons[BUTTON.moveLeft].pressed = true;

        controller.processGamepadInput(pad, 0);

        expect(stateRef.current.playerInput.pendingEdges).toEqual([]);
        expect(stateRef.current.playerInput.overflowCount).toBe(1);
        expect(actions.move).not.toHaveBeenCalled();
    });
});
