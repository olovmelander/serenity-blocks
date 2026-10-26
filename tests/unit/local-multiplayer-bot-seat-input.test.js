/**
 * A bot's seat takes no one's input (2026-10-26): Player 2's soft drop (S, or a second
 * controller's down) pushed the bot's piece down in "you vs a bot". Move, rotate, hard
 * drop and hold were already guarded; the wrappers are restored as they were.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LocalMultiplayerMode } from '../../src/core/game-modes/LocalMultiplayerMode.js';

vi.mock('phaser', () => ({ default: { Game: vi.fn() } }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));

const NAMES = ['move', 'rotate', 'softDrop', 'hardDrop', 'hold'];

describe('local versus input wrappers', () => {
    let originals;

    beforeEach(() => {
        originals = {};
        const win = {};
        for (const name of NAMES) {
            for (const suffix of ['', 'P2', 'P3', 'P4']) {
                originals[`${name}${suffix}`] = vi.fn(() => true);
                win[`${name}${suffix}`] = originals[`${name}${suffix}`];
            }
        }
        vi.stubGlobal('window', win);
    });

    afterEach(() => vi.unstubAllGlobals());

    function modeWithBotOn(seat) {
        const mode = Object.create(LocalMultiplayerMode.prototype);
        mode._isBotPlayer = (index) => index === seat;
        mode.multiplayerState = { players: [{}, {}, {}, {}] };
        return mode;
    }

    it('keeps every input, soft drop included, off a bot seat', () => {
        const mode = modeWithBotOn(1);
        mode._setupInputWrappers();

        window.softDropP2();
        window.moveP2(-1);
        window.hardDropP2();
        expect(originals.softDropP2).not.toHaveBeenCalled();
        expect(originals.moveP2).not.toHaveBeenCalled();
        expect(originals.hardDropP2).not.toHaveBeenCalled();

        window.softDrop();
        window.move(1);
        expect(originals.softDrop).toHaveBeenCalledOnce();
        expect(originals.move).toHaveBeenCalledWith(1);
    });

    it('puts every original back when the match ends', () => {
        const mode = modeWithBotOn(3);
        mode._setupInputWrappers();
        expect(window.softDropP4).not.toBe(originals.softDropP4);
        mode._removeInputWrappers();
        for (const [name, original] of Object.entries(originals)) expect(window[name]).toBe(original);
    });
});
