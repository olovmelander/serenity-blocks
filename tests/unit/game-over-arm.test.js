/**
 * Hard-drop spam as the stack tops out skipped the results: the sheet focuses Play
 * again, so the next Space activated it (audit LIFE-12). Keyboard and controller presses
 * now wait GAME_OVER_ARM_MS after the sheet opens; a mouse click works at once.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GAME_OVER_ARM_MS, isGameOverArmed, markGameOverShown } from '../../src/ui/game-over-arm.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { ModalManager, showGameOverModal } from '../../src/ui/modals.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function gameOverSheet() {
    return { dataset: {}, classList: { contains: (name) => name === 'visible', add: vi.fn() } };
}

describe('results sheet arm delay', () => {
    it('arms once the sheet has been up for the delay', () => {
        const modal = gameOverSheet();
        markGameOverShown(modal, 1000);
        expect(isGameOverArmed(modal, 1000)).toBe(false);
        expect(isGameOverArmed(modal, 1000 + GAME_OVER_ARM_MS - 1)).toBe(false);
        expect(isGameOverArmed(modal, 1000 + GAME_OVER_ARM_MS)).toBe(true);
    });

    it('treats a sheet it never marked as armed, as before', () => {
        expect(isGameOverArmed(gameOverSheet(), 0)).toBe(true);
        expect(isGameOverArmed(null, 0)).toBe(true);
    });

    it('is marked whenever the modal manager shows the results sheet', () => {
        vi.spyOn(performance, 'now').mockReturnValue(2000);
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        const modal = gameOverSheet();
        ModalManager.prototype.show.call({
            modals: { gameOver: modal }, menuCoverage: { refresh: vi.fn() }, gamepadController: null,
        }, 'gameOver');
        expect(modal.dataset.armedAt).toBe(String(2000 + GAME_OVER_ARM_MS));
    });
});

describe('Play again on the results sheet', () => {
    async function presentSheet(modal) {
        let onClick = null;
        const elements = new Map([
            ['final-stats', { innerHTML: '' }],
            ['game-over-buttons', { innerHTML: '' }],
            ['game-over-main-menu', { addEventListener: vi.fn() }],
            ['game-over-play-again', { addEventListener: (type, listener) => { onClick = listener; } }],
            ['game-over-modal', modal],
        ]);
        vi.stubGlobal('document', { getElementById: (id) => elements.get(id) || null });
        const onRestart = vi.fn();
        await showGameOverModal(
            { show: vi.fn(), hide: vi.fn() },
            { score: 10, lines: 1, level: 1, dropInterval: 500, piecesPlaced: 3, startTime: Date.now() },
            { getRank: vi.fn(async () => 1), getStatistics: vi.fn(async () => ({})) },
            { onRestart },
            { includeLegacyResults: false },
        );
        const click = (detail) => onClick({ detail, preventDefault: vi.fn(), stopPropagation: vi.fn() });
        return { click, onRestart };
    }

    it('ignores a key activation as the sheet opens but not a mouse click', async () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(3000);
        const modal = gameOverSheet();
        markGameOverShown(modal, 3000);
        const { click, onRestart } = await presentSheet(modal);
        click(0); // Space or Enter on the focused button
        expect(onRestart).not.toHaveBeenCalled();
        click(1); // a mouse click
        expect(onRestart).toHaveBeenCalledTimes(1);
        now.mockReturnValue(3000 + GAME_OVER_ARM_MS);
        click(0);
        expect(onRestart).toHaveBeenCalledTimes(2);
    });
});

describe('controller on the results sheet', () => {
    function padHarness() {
        const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
        const startGame = vi.fn();
        const mainMenuClick = vi.fn();
        const modal = gameOverSheet();
        vi.stubGlobal('window', { settings: {}, startGame });
        vi.stubGlobal('navigator', { getGamepads: () => [{ axes: [0, 0, 0, 0], buttons, index: 0 }] });
        vi.stubGlobal('document', {
            body: { classList: { contains: () => false } },
            getElementById: (id) => {
                if (id === 'game-over-modal') return modal;
                if (id === 'game-over-main-menu') return { click: mainMenuClick };
                return null;
            },
        });
        const controller = new GamepadController();
        controller.enabled = true;
        controller.connected[0] = true;
        controller.gamepads[0] = { index: 0 };
        const press = (index, pressed) => { buttons[index] = { pressed, value: pressed ? 1 : 0 }; controller.poll(); };
        return {
            controller, modal, press, startGame, mainMenuClick,
        };
    }

    it('ignores presses as the sheet opens, then acts on a fresh press', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(5000);
        const h = padHarness();
        markGameOverShown(h.modal, 5000);
        h.controller.poll(); // the first poll only latches
        h.press(0, true); // A, still mid-spam
        h.press(0, false);
        h.press(1, true); // B, often rotate: would leave for the main menu
        expect(h.startGame).not.toHaveBeenCalled();
        expect(h.mainMenuClick).not.toHaveBeenCalled();

        now.mockReturnValue(5000 + GAME_OVER_ARM_MS);
        h.controller.poll(); // B still held from the delay: not a fresh press
        expect(h.mainMenuClick).not.toHaveBeenCalled();
        h.press(1, false);
        h.press(0, true);
        expect(h.startGame).toHaveBeenCalledTimes(1);
    });
});
