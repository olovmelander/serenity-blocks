/**
 * Plan §1.5 — gamepad hold-to-repeat (DAS) must be reachable from live loop wiring.
 *
 * Regression this pins: updateGame advances pad DAS via window.gamepadController,
 * which was never assigned anywhere in src/ — pad hold-to-repeat never ticked in
 * SinglePlayer/Infinity/Odyssey (initial presses fired from the poll loop;
 * startDas timers never advanced).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { updateGame } from '../../src/core/game.js';

const savedWindow = globalThis.window;
afterEach(() => {
    globalThis.window = savedWindow;
});

function minimalGameState() {
    return {
        isGameOver: false,
        isPaused: false,
        isReplay: false,
        isSeeking: false,
        suppressExternalInput: false,
        lastTime: 0,
        simTimeMs: 0,
        simTickMs: 1000 / 60,
        hitStopRemaining: 0,
        currentPiece: null, // processAutoDrop early-returns without a piece
    };
}

describe('gamepad DAS live-loop wiring (plan §1.5)', () => {
    it('updateGame advances gamepad DAS through the window wiring', () => {
        const advanceGameplayInput = vi.fn();
        const updateDAS = vi.fn();
        globalThis.window = {
            inputController: { updateDAS },
            gamepadController: { advanceGameplayInput },
        };

        updateGame(16.7, minimalGameState(), {});

        expect(updateDAS).toHaveBeenCalledTimes(1);
        expect(advanceGameplayInput).toHaveBeenCalledTimes(1);
        expect(advanceGameplayInput).toHaveBeenCalledWith(16.7);
    });

    it('replay/seek suppress external input polling', () => {
        const advanceGameplayInput = vi.fn();
        globalThis.window = {
            inputController: { updateDAS: vi.fn() },
            gamepadController: { advanceGameplayInput },
        };
        updateGame(16.7, { ...minimalGameState(), isReplay: true }, {});
        expect(advanceGameplayInput).not.toHaveBeenCalled();
    });

    it('main.js assigns window.gamepadController at controller init (source tripwire)', () => {
        const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
        expect(src).toMatch(/window\.gamepadController = this\.gamepadController;/);
    });

    it('LocalMultiplayerMode loop (which bypasses updateGame) advances pad DAS itself', () => {
        const src = readFileSync(
            new URL('../../src/core/game-modes/LocalMultiplayerMode.js', import.meta.url),
            'utf8',
        );
        expect(src).toMatch(/window\.gamepadController\.advanceGameplayInput\(currentTime\)/);
    });
});
