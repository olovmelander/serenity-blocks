import { readFileSync } from 'node:fs';

import {
    describe, expect, it,
} from 'vitest';

import { TetrominoStyleManager } from '../../src/rendering/tetromino-style-manager.js';
import { PARHELION_TETROMINOS } from '../../src/themes/parhelion/parhelion-tetrominos.js';

const paletteSource = readFileSync(
    new URL('../../src/themes/parhelion/parhelion-tetrominos.js', import.meta.url),
    'utf8',
);

const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const EXPECTED_COLORS = {
    I: '#FFD068',
    O: '#D0A6FF',
    T: '#7EF0C2',
    S: '#E46CB0',
    Z: '#5C8AFF',
    J: '#FF7E40',
    L: '#A6E2FF',
    GARBAGE: '#2C3352',
    CLEAN_GARBAGE: '#909CC6',
};

const EXPECTED_PHASER = {
    gradient: true,
    highlight: 0.18,
    shadow: 0.2,
    rim: true,
    rimAlpha: 0.44,
    rimWidthFactor: 0.05,
    gloss: true,
    glossAlpha: 0.18,
};

// Mirrors GUIDELINE_BANDS in scripts/palette-guideline-check.mjs (HSV hue
// degrees). The script is a CLI with process.exit, so it cannot be imported.
const GUIDELINE_BANDS = {
    I: [[160, 210]],
    O: [[32, 75]],
    T: [[245, 315]],
    S: [[90, 170]],
    Z: [
        [320, 360],
        [0, 20],
    ],
    J: [[200, 250]],
    L: [[20, 50]],
};

// Stone shadow face behind the board, and the in-card backdrop luminance the
// garbage contrast gate is measured against.
const STONE_FACE = '#161C2E';
const BACKDROP_P99_LUMINANCE = 0.015;

function createManager() {
    const themeManager = {
        activeTheme: {
            name: 'Parhelion',
            getTetrominoConfig: () => PARHELION_TETROMINOS,
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

/** HSV hue in degrees, or null when achromatic (same math as the gate). */
function hue(hex) {
    const [r, g, b] = rgb(hex).map((channel) => channel / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const delta = max - min;
    let h;
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    return (h * 60 + 360) % 360;
}

function inGuidelineBand(shape, hex) {
    const h = hue(hex);
    if (h === null) return false;
    return GUIDELINE_BANDS[shape].some(([lo, hi]) => h >= lo && h <= hi);
}

/** WCAG relative luminance of an sRGB hex colour. */
function relativeLuminance(hex) {
    const [r, g, b] = rgb(hex).map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(luminanceA, luminanceB) {
    const hi = Math.max(luminanceA, luminanceB);
    const lo = Math.min(luminanceA, luminanceB);
    return (hi + 0.05) / (lo + 0.05);
}

const pieceColors = SHAPES.map((shape) => [shape, EXPECTED_COLORS[shape]]);

describe('Parhelion tetromino presentation', () => {
    it('pins the complete halo palette including both garbage variants', () => {
        expect(PARHELION_TETROMINOS.version).toBe(1);
        expect(PARHELION_TETROMINOS.colors).toEqual(EXPECTED_COLORS);
        expect(PARHELION_TETROMINOS.colors.GARBAGE)
            .not.toBe(PARHELION_TETROMINOS.colors.CLEAN_GARBAGE);
        expect(PARHELION_TETROMINOS.rendererOverrides).toEqual({});
    });

    it('keeps the colors block as the first per-shape literal the palette gate reads', () => {
        // Same extraction as scripts/palette-guideline-check.mjs: a stray
        // "I: '#...'" in the header comment would silently hijack the gate.
        for (const shape of SHAPES) {
            const pattern = new RegExp(
                `\\b${shape}\\s*:\\s*(?:\\{[^}]*?color\\s*:\\s*)?['"](#[0-9a-fA-F]{6})['"]`,
            );
            expect(paletteSource.match(pattern)?.[1]).toBe(EXPECTED_COLORS[shape]);
        }
        const header = paletteSource.slice(0, paletteSource.indexOf('export const'));
        expect(header).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    });

    it('uses solid identity plus only supported premium Phaser fields', () => {
        expect(PARHELION_TETROMINOS.renderMode).toBe('solid');
        expect(Object.keys(PARHELION_TETROMINOS.effects).sort())
            .toEqual(['phaser', 'premium']);
        expect(PARHELION_TETROMINOS.effects.premium).toBe(true);
        expect(PARHELION_TETROMINOS.effects.phaser).toEqual(EXPECTED_PHASER);
        expect(PARHELION_TETROMINOS.effects).not.toHaveProperty('glowRadius');
        expect(PARHELION_TETROMINOS.effects).not.toHaveProperty('pulse');
        expect(PARHELION_TETROMINOS.effects).not.toHaveProperty('shimmer');
        expect(PARHELION_TETROMINOS.effects).not.toHaveProperty('trails');
    });

    it('resolves the palette and premium fields through TetrominoStyleManager', () => {
        const manager = createManager();
        for (const [piece, color] of Object.entries(EXPECTED_COLORS)) {
            const style = manager.getStyleForPiece(piece);
            expect(style.color).toBe(color);
            expect(style.renderMode).toBe('solid');
        }
        expect(manager.getPhaserEffects('T')).toEqual(EXPECTED_PHASER);
    });

    it('stays well clear of the familiar shape-to-hue roles', () => {
        const matched = pieceColors
            .filter(([shape, hex]) => inGuidelineBand(shape, hex))
            .map(([shape]) => shape);
        expect(matched.length).toBeLessThanOrEqual(3);
        expect(matched).toEqual([]);
    });

    it('keeps every gameplay piece distinguishable without relying on glow', () => {
        let minimumDistance = Infinity;
        for (let left = 0; left < pieceColors.length; left += 1) {
            for (let right = left + 1; right < pieceColors.length; right += 1) {
                minimumDistance = Math.min(
                    minimumDistance,
                    colorDistance(pieceColors[left][1], pieceColors[right][1]),
                );
            }
        }
        expect(minimumDistance).toBeGreaterThanOrEqual(60);
        expect(colorDistance(EXPECTED_COLORS.GARBAGE, EXPECTED_COLORS.CLEAN_GARBAGE))
            .toBeGreaterThan(120);
    });

    it('keeps piece values inside the readable band and garbage off the stone', () => {
        const stoneLuminance = relativeLuminance(STONE_FACE);
        for (const [, hex] of pieceColors) {
            const luminance = relativeLuminance(hex);
            expect(luminance).toBeGreaterThanOrEqual(0.2);
            expect(luminance).toBeLessThanOrEqual(0.85);
            expect(contrastRatio(luminance, stoneLuminance)).toBeGreaterThanOrEqual(4.5);
        }
        const garbageLuminance = relativeLuminance(EXPECTED_COLORS.GARBAGE);
        expect(contrastRatio(garbageLuminance, BACKDROP_P99_LUMINANCE))
            .toBeGreaterThanOrEqual(1.3);
        expect(contrastRatio(garbageLuminance, stoneLuminance))
            .toBeGreaterThanOrEqual(1.3);
    });
});
