/* eslint-disable import/first */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

const gameCommands = vi.hoisted(() => ({
    hardDrop: vi.fn(),
    move: vi.fn(() => true),
    rotate: vi.fn(),
    softDrop: vi.fn(),
}));

vi.mock('../../src/core/game.js', () => gameCommands);

import {
    installOdysseyLegacyInputWrapper,
} from '../../src/ui/odyssey/legacy-input-wrapper.js';

function createHarness(overrides = {}) {
    const originals = {
        hardDrop: vi.fn(),
        move: vi.fn(),
        rotate: vi.fn(),
        softDrop: vi.fn(),
    };
    vi.stubGlobal('window', { ...originals });

    const gameState = {
        hitStopRemaining: 0,
        isGameOver: false,
        isPaused: false,
        mirrorControls: false,
        ...overrides.gameState,
    };
    const juice = {
        bounce: vi.fn(),
        dip: vi.fn(),
        nudge: vi.fn(),
        tilt: vi.fn(),
    };
    const soundPlayer = {
        playDrop: vi.fn(),
        playMove: vi.fn(),
        playRotate: vi.fn(),
    };
    const physicsCallbacks = { spawnPiece: vi.fn() };
    let active = overrides.active ?? true;
    const owner = installOdysseyLegacyInputWrapper({
        gameState,
        isActive: () => active,
        juice,
        physicsCallbacks,
        soundPlayer,
    });

    return {
        gameState,
        juice,
        originals,
        owner,
        physicsCallbacks,
        setActive: (value) => { active = value; },
        soundPlayer,
    };
}

describe('Odyssey legacy input ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        gameCommands.move.mockReturnValue(true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('routes mirrored commands, effects, sounds, and drop callbacks through one owner', () => {
        const {
            gameState, juice, physicsCallbacks, soundPlayer,
        } = createHarness({ gameState: { mirrorControls: true } });

        window.move(1);
        window.rotate('left');
        window.hardDrop();
        window.softDrop();

        expect(gameCommands.move).toHaveBeenCalledWith(gameState, -1, expect.any(Function));
        expect(gameCommands.rotate).toHaveBeenCalledWith(
            gameState,
            'left',
            expect.any(Function),
        );
        expect(gameCommands.hardDrop).toHaveBeenCalledWith(
            gameState,
            expect.any(Function),
            physicsCallbacks,
        );
        expect(gameCommands.softDrop).toHaveBeenCalledWith(
            gameState,
            expect.any(Function),
            physicsCallbacks,
        );

        gameCommands.move.mock.calls[0][2]();
        gameCommands.rotate.mock.calls[0][2]();
        gameCommands.hardDrop.mock.calls[0][1]();
        gameCommands.softDrop.mock.calls[0][1]();
        expect(soundPlayer.playMove).toHaveBeenCalledTimes(1);
        expect(soundPlayer.playRotate).toHaveBeenCalledTimes(1);
        expect(soundPlayer.playDrop).toHaveBeenCalledTimes(2);

        expect(juice.nudge).toHaveBeenCalledWith(-1.5, 0);
        expect(juice.tilt).toHaveBeenCalledWith(-0.4);
        expect(juice.tilt).toHaveBeenCalledWith(-0.3);
        expect(juice.dip).toHaveBeenCalledWith(3);
        expect(juice.bounce).toHaveBeenCalledTimes(1);
    });

    it('rejects inactive and hit-stop input before any command or effect runs', () => {
        const {
            gameState, juice, setActive,
        } = createHarness({ active: false });

        window.move(-1);
        window.rotate('right');
        window.hardDrop();
        window.softDrop();
        expect(Object.values(gameCommands).every((command) => command.mock.calls.length === 0))
            .toBe(true);
        expect(Object.values(juice).every((effect) => effect.mock.calls.length === 0)).toBe(true);

        setActive(true);
        gameState.hitStopRemaining = 1;
        window.move(1);
        window.rotate('left');
        window.hardDrop();
        window.softDrop();
        expect(Object.values(gameCommands).every((command) => command.mock.calls.length === 0))
            .toBe(true);
        expect(Object.values(juice).every((effect) => effect.mock.calls.length === 0)).toBe(true);
    });

    it('restores only the commands it still owns and disposes idempotently', () => {
        const { originals, owner } = createHarness();
        const replacementMove = vi.fn();
        const replacementHardDrop = vi.fn();
        window.move = replacementMove;
        window.hardDrop = replacementHardDrop;

        owner.dispose();
        owner.dispose();

        expect(window.move).toBe(replacementMove);
        expect(window.hardDrop).toBe(replacementHardDrop);
        expect(window.rotate).toBe(originals.rotate);
        expect(window.softDrop).toBe(originals.softDrop);
    });
});
