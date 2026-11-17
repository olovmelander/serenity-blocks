/* eslint-disable import/first */

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {
        destroy() {}
    },
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { ODYSSEY_THEME_PASSAGE_PALETTES } from '../../src/core/odyssey/theme-passage-palettes.js';
import { getOdysseyPassagePalette } from '../../src/ui/odyssey/odyssey-passage-look.js';

function createMode() {
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    });

    return new OdysseyMode({
        frameRateController: {
            isRunning: false,
            stopHybridLoop: vi.fn(),
        },
        soundManager: {},
    });
}

describe('Odyssey presentation sync', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('builds the Journey entry palette from the picture of the orb\'s world, with its chapter\'s look', () => {
        const mode = createMode();
        const palette = mode._buildJourneyEntryPalette({
            id: 3,
            chapter: 2,
            transitionPaletteThemeId: 'forest',
            theme: { primary: 'forest' },
        });
        const { key, ...colours } = getOdysseyPassagePalette('forest');

        expect(palette).toMatchObject(colours);
        expect(palette.primary).toBe(ODYSSEY_THEME_PASSAGE_PALETTES.forest[1]);
        // Made of the chapter the orb is in, in the colours and at the brightness of its world.
        expect(palette.look).toMatchObject({ kind: 'bubbles', chapter: 2, key });
        expect(Number.isInteger(palette.look.seed)).toBe(true);
        // The way back out is the same visit from the other side: another seed, the same colours.
        const back = mode._buildJourneyEntryPalette({
            id: 3, chapter: 2, theme: { primary: 'forest' },
        }, { returning: true });
        expect(back).toMatchObject(colours);
        expect(back.look.seed).not.toBe(palette.look.seed);
    });
});
