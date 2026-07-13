import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    installLegacyBoardJuiceInputWrapper,
} from '../../src/ui/infinity/legacy-board-juice-input-wrapper.js';

describe('legacy Infinity BoardJuice input ownership', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('decorates the active legacy owner and restores it idempotently', () => {
        const originalMove = vi.fn(() => true);
        const originalRotate = vi.fn(() => 'rotated');
        vi.stubGlobal('window', { move: originalMove, rotate: originalRotate });
        const juice = { disabled: false, nudge: vi.fn(), tilt: vi.fn() };
        const gameState = { hitStopRemaining: 0 };
        let active = true;

        const owner = installLegacyBoardJuiceInputWrapper({
            gameState,
            isActive: () => active,
            juice,
        });

        expect(window.move(-1)).toBe(true);
        expect(window.rotate('left')).toBe('rotated');
        expect(originalMove).toHaveBeenCalledWith(-1);
        expect(originalRotate).toHaveBeenCalledWith('left');
        expect(juice.nudge).toHaveBeenCalledWith(-1.5, 0);
        expect(juice.tilt).toHaveBeenCalledWith(-0.4);
        expect(juice.tilt).toHaveBeenCalledWith(-0.3);

        gameState.hitStopRemaining = 30;
        expect(window.move(1)).toBe(false);
        active = false;
        expect(window.rotate('right')).toBeUndefined();

        owner.dispose();
        owner.dispose();
        expect(window.move).toBe(originalMove);
        expect(window.rotate).toBe(originalRotate);
    });

    it('does not overwrite a replacement input owner during disposal', () => {
        const originalMove = vi.fn();
        const originalRotate = vi.fn();
        vi.stubGlobal('window', { move: originalMove, rotate: originalRotate });
        const owner = installLegacyBoardJuiceInputWrapper({
            gameState: { hitStopRemaining: 0 },
            isActive: () => true,
            juice: { nudge: vi.fn(), tilt: vi.fn() },
        });
        const replacementMove = vi.fn();
        const replacementRotate = vi.fn();
        window.move = replacementMove;
        window.rotate = replacementRotate;

        owner.dispose();

        expect(window.move).toBe(replacementMove);
        expect(window.rotate).toBe(replacementRotate);
    });
});
