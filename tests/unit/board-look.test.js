import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CLEAN_GARBAGE_MIN_LUMINANCE, FALLBACK_GARBAGE_MATERIAL, GARBAGE_MAX_LUMINANCE, GARBAGE_MIN_LUMINANCE,
    drawLandingGlow, garbageMaterialColor, garbageRowShade, landingRuns, relativeLuminance,
} from '../../src/rendering/board-look.js';
import { TetrominoStyleManager } from '../../src/rendering/tetromino-style-manager.js';

const T_UP = [[0, 1, 0], [1, 1, 1]];
const T_DOWN = [[1, 1, 1], [0, 1, 0]];
const I_FLAT = [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]];
const S = [[0, 1, 1], [1, 1, 0]];

/** A Graphics stand-in that records every call. */
function recorder() {
    const calls = [];
    return new Proxy({ calls }, {
        get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, ...args])),
    });
}

const hue = (int) => {
    const r = (int >> 16) & 255; const g = (int >> 8) & 255; const b = int & 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    if (max === min) return null;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
};

/** Every world's own garbage colour, read from its palette file. */
function worldGarbage() {
    const root = join(process.cwd(), 'src', 'themes');
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
        const file = join(root, entry.name, `${entry.name}-tetrominos.js`);
        if (!existsSync(file)) return [];
        const match = readFileSync(file, 'utf8').match(/GARBAGE\s*:\s*'#([0-9a-fA-F]{6})'/);
        return match ? [[entry.name, Number.parseInt(match[1], 16)]] : [];
    });
}

describe('the landing glow', () => {
    it('finds the surface under each column the piece lands with', () => {
        expect(landingRuns(T_UP)).toEqual([{ x0: 0, x1: 2, bottom: 1 }]);
        expect(landingRuns(T_DOWN)).toEqual([
            { x0: 0, x1: 0, bottom: 0 }, { x0: 1, x1: 1, bottom: 1 }, { x0: 2, x1: 2, bottom: 0 },
        ]);
        expect(landingRuns(I_FLAT)).toEqual([{ x0: 0, x1: 3, bottom: 1 }]);
        expect(landingRuns(S)).toEqual([{ x0: 0, x1: 1, bottom: 1 }, { x0: 2, x1: 2, bottom: 0 }]);
    });

    it('lights the landing surface with plain rects, never tracing the piece', () => {
        const graphics = recorder();
        drawLandingGlow(graphics, {
            shape: T_DOWN, originX: 3, landingY: 10, blockSize: 20, colorInt: 0xff8844, pulse: 0.5,
        });
        const names = new Set(graphics.calls.map(([name]) => name));
        expect([...names].sort()).toEqual(['fillGradientStyle', 'fillRect', 'fillStyle']);
        // Each column's bright surface line sits on the row it lands on: 220 px under the arms, 240 under the stem.
        const lines = graphics.calls.filter(([name, , , , h]) => name === 'fillRect' && h === 1.6);
        expect(lines.map(([, x, y, w]) => [x, y + 1.6, w])).toEqual([[60, 220, 20], [80, 240, 20], [100, 220, 20]]);
    });

    it('breathes with the pulse and stays out of the hidden rows', () => {
        const alphaAt = (pulse) => {
            const graphics = recorder();
            drawLandingGlow(graphics, {
                shape: T_UP, originX: 0, landingY: 5, blockSize: 20, colorInt: 0x44aaff, pulse,
            });
            return graphics.calls.find(([name]) => name === 'fillStyle')[2];
        };
        expect(alphaAt(1)).toBeGreaterThan(alphaAt(0));
        const hidden = recorder();
        drawLandingGlow(hidden, {
            shape: T_UP, originX: 0, landingY: 1, blockSize: 20, colorInt: 0x44aaff, pulse: 0.5, firstVisibleRow: 4,
        });
        expect(hidden.calls).toEqual([]);
    });
});

describe('garbage in the world\'s own material', () => {
    const worlds = worldGarbage();

    it('reads every world\'s palette', () => {
        expect(worlds.length).toBeGreaterThanOrEqual(60);
    });

    it('keeps every world\'s garbage readable on the dark field, in its own hue', () => {
        for (const [name, material] of worlds) {
            const color = garbageMaterialColor(material);
            const luminance = relativeLuminance(color);
            expect(luminance, name).toBeGreaterThanOrEqual(GARBAGE_MIN_LUMINANCE - 0.002);
            expect(luminance, name).toBeLessThanOrEqual(GARBAGE_MAX_LUMINANCE + 0.002);
            const before = hue(material);
            const after = hue(color);
            if (before !== null && after !== null) {
                const turn = Math.min(Math.abs(before - after), 360 - Math.abs(before - after));
                expect(turn, name).toBeLessThan(8);
            }
        }
    });

    it('is never the old neutral grey', () => {
        for (const [name, material] of worlds) {
            const color = garbageMaterialColor(material);
            expect(color, name).not.toBe(0x808080);
            expect(color, name).not.toBe(0xa0a0a0);
        }
    });

    it('carries a little of its sender\'s colour, and clean garbage sits lighter', () => {
        const world = 0x1c3a38;
        const plain = garbageMaterialColor(world);
        const fromRed = garbageMaterialColor(world, { attackerInt: 0xff1744 });
        expect((fromRed >> 16) & 255).toBeGreaterThan((plain >> 16) & 255);
        const clean = garbageMaterialColor(world, { clean: true });
        expect(relativeLuminance(clean)).toBeGreaterThanOrEqual(CLEAN_GARBAGE_MIN_LUMINANCE - 0.002);
        expect(relativeLuminance(clean)).toBeGreaterThan(relativeLuminance(plain));
        expect(garbageMaterialColor(null)).toBe(garbageMaterialColor(FALLBACK_GARBAGE_MATERIAL));
    });

    it('lies in layers: every other row a shade darker', () => {
        const color = 0x506070;
        expect(garbageRowShade(color, 4)).toBe(color);
        expect(garbageRowShade(color, -2)).toBe(color);
        expect(relativeLuminance(garbageRowShade(color, 5))).toBeLessThan(relativeLuminance(color));
    });

    it('comes from the world even when the pieces wear the default colours', () => {
        const theme = {
            name: 'Test world',
            getTetrominoConfig: () => ({ colors: { I: '#112233', GARBAGE: '#1c3a38' } }),
        };
        const manager = new TetrominoStyleManager(
            { activeTheme: theme },
            { get: () => ({ themeBasedTetrominos: false }) },
        );
        expect(manager.getStyleForPiece('GARBAGE').color).toBe('#808080');
        expect(manager.getWorldGarbage()).toBe('#1c3a38');
        const empty = new TetrominoStyleManager({ activeTheme: null }, { get: () => ({}) });
        expect(empty.getWorldGarbage()).toBeNull();
    });
});
