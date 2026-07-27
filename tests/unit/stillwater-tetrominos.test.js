import {
    describe, expect, it,
} from 'vitest';

import { TetrominoStyleManager } from '../../src/rendering/tetromino-style-manager.js';
import { STILLWATER_TETROMINOS } from '../../src/themes/stillwater/stillwater-tetrominos.js';

const EXPECTED_COLORS = {
    I: '#6CC7C6',
    O: '#F2D68A',
    T: '#9A7FB7',
    S: '#5F9B72',
    Z: '#C36F73',
    J: '#537E9F',
    L: '#D99A5E',
    GARBAGE: '#273631',
    CLEAN_GARBAGE: '#98B5A9',
};

function createManager() {
    const themeManager = {
        activeTheme: {
            name: 'Stillwater',
            getTetrominoConfig: () => STILLWATER_TETROMINOS,
        },
    };
    const settingsManager = {
        get: () => ({ themeBasedTetrominos: true }),
    };
    return new TetrominoStyleManager(themeManager, settingsManager);
}

function rgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [
        (value >> 16) & 255,
        (value >> 8) & 255,
        value & 255,
    ];
}

function colorDistance(a, b) {
    const left = rgb(a);
    const right = rgb(b);
    return Math.hypot(
        left[0] - right[0],
        left[1] - right[1],
        left[2] - right[2],
    );
}

describe('Stillwater tetromino presentation', () => {
    it('pins the complete folklore palette including both garbage variants', () => {
        expect(STILLWATER_TETROMINOS.colors).toEqual(EXPECTED_COLORS);
        expect(STILLWATER_TETROMINOS.colors.GARBAGE)
            .not.toBe(STILLWATER_TETROMINOS.colors.CLEAN_GARBAGE);
    });

    it('uses solid identity plus only supported premium Phaser fields', () => {
        expect(STILLWATER_TETROMINOS.renderMode).toBe('solid');
        expect(Object.keys(STILLWATER_TETROMINOS.effects).sort())
            .toEqual(['phaser', 'premium']);
        expect(Object.keys(STILLWATER_TETROMINOS.effects.phaser).sort()).toEqual([
            'gloss',
            'glossAlpha',
            'gradient',
            'highlight',
            'rim',
            'rimAlpha',
            'rimWidthFactor',
            'shadow',
        ]);
        expect(STILLWATER_TETROMINOS.effects).not.toHaveProperty('glowRadius');
        expect(STILLWATER_TETROMINOS.effects).not.toHaveProperty('pulse');
        expect(STILLWATER_TETROMINOS.effects).not.toHaveProperty('shimmer');
        expect(STILLWATER_TETROMINOS.effects).not.toHaveProperty('trails');
    });

    it('resolves the palette and premium fields through TetrominoStyleManager', () => {
        const manager = createManager();
        for (const [piece, color] of Object.entries(EXPECTED_COLORS)) {
            const style = manager.getStyleForPiece(piece);
            expect(style.color).toBe(color);
            expect(style.renderMode).toBe('solid');
        }
        expect(manager.getPhaserEffects('T')).toEqual({
            gradient: true,
            highlight: 0.2,
            shadow: 0.22,
            rim: true,
            rimAlpha: 0.46,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.16,
        });
    });

    it('keeps every gameplay piece distinguishable without relying on glow', () => {
        const pieceColors = Object.entries(EXPECTED_COLORS)
            .filter(([piece]) => piece !== 'GARBAGE' && piece !== 'CLEAN_GARBAGE');
        let minimumDistance = Infinity;
        for (let left = 0; left < pieceColors.length; left += 1) {
            for (let right = left + 1; right < pieceColors.length; right += 1) {
                minimumDistance = Math.min(
                    minimumDistance,
                    colorDistance(pieceColors[left][1], pieceColors[right][1]),
                );
            }
        }
        expect(minimumDistance).toBeGreaterThan(48);
        expect(colorDistance(EXPECTED_COLORS.GARBAGE, EXPECTED_COLORS.CLEAN_GARBAGE))
            .toBeGreaterThan(120);
    });
});
