/* eslint-disable import/first */

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {
        destroy() {}
    },
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { OrbPortalTransitionDirector } from '../../src/core/odyssey/OrbPortalTransitionDirector.js';
import { getOdysseyThemePresentationPalette } from '../../src/core/odyssey/theme-presentation.js';

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

    it('builds Journey entry palette from the level theme presentation palette', () => {
        const mode = createMode();
        mode.boardController = {
            nodeManager: {
                getChapterColor: vi.fn(() => new THREE.Color('#ff0000')),
            },
        };

        const palette = mode._buildJourneyEntryPalette({
            chapter: 1,
            transitionPaletteThemeId: 'forest',
            theme: { primary: 'forest' },
        });

        expect(palette).toEqual(getOdysseyThemePresentationPalette('forest'));
    });

    it('builds orb portal theme config from the level theme presentation palette', () => {
        const director = new OrbPortalTransitionDirector({ compositor: {} });
        const config = director.buildThemeConfig(
            {
                chapter: 1,
                transitionPaletteThemeId: 'forest',
                theme: { primary: 'forest' },
            },
            {
                nodeManager: {
                    getChapterColor: () => new THREE.Color('#ff0000'),
                },
            },
        );

        const palette = getOdysseyThemePresentationPalette('forest');
        expect(config.chapterColor.getStyle()).toBe(new THREE.Color(palette.primary).getStyle());
        expect(config.accentColor.getStyle()).toBe(new THREE.Color(palette.accent).getStyle());
        expect(config.shadowColor.getStyle()).toBe(new THREE.Color(palette.shadow).getStyle());
    });
});
