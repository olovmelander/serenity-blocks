/**
 * Line-clear debris.
 *
 * A full-width stripe plus an upward fountain reads as a lighting change — the
 * blocks never participate in their own destruction. These pin the properties
 * that make it read as destruction instead: chunks launched from each cleared
 * cell, tinted with THAT cell's colour, at a bounded allocation cost.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

const COLS = 10;

function makeScene({ rows = [], gridColors = null } = {}) {
    const emitters = [];
    const registered = new Set();
    const grid = Array.from({ length: 24 }, () => Array(COLS).fill(null));
    rows.forEach((r) => {
        for (let c = 0; c < COLS; c++) {
            grid[r][c] = gridColors
                ? gridColors(r, c)
                : { type: 'I', color: '#00ff00', id: `${r}-${c}` };
        }
    });

    return {
        emitters,
        cols: COLS,
        rows: 20,
        blockSize: 40,
        hiddenRows: 4,
        gameState: { boardGrid: grid },
        textures: { exists: (k) => registered.has(k) },
        make: {
            graphics: () => ({
                fillStyle: vi.fn().mockReturnThis(),
                fillRect: vi.fn().mockReturnThis(),
                generateTexture: vi.fn((key) => registered.add(key)),
                destroy: vi.fn(),
            }),
        },
        getThemedColor: (type, color) => color,
        colorToInt: (c) => parseInt(String(c).replace('#', ''), 16),
        getQualityConfig: () => ({ particles: true }),
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn() },
        add: {
            particles: vi.fn((x, y, key, config) => {
                const e = {
                    key,
                    config,
                    emitted: [],
                    setDepth: vi.fn(),
                    setScrollFactor: vi.fn(),
                    destroy: vi.fn(),
                    emitParticleAt(px, py, n) { this.emitted.push({ x: px, y: py, n }); },
                };
                emitters.push(e);
                return e;
            }),
        },
    };
}

describe('spawnLineClearShards', () => {
    let scene;
    let fx;

    beforeEach(() => {
        // Four cleared rows, one colour per column -> 7 distinct colours.
        const palette = ['#00ff00', '#ff9900', '#0000ff', '#00ffff', '#ff0000', '#ffff00', '#cc00cc'];
        scene = makeScene({
            rows: [20, 21, 22, 23],
            gridColors: (r, c) => ({ type: 'I', color: palette[(r + c) % palette.length] }),
        });
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('allocates one emitter per distinct colour, not per cell', () => {
        fx.spawnLineClearShards([20, 21, 22, 23]);
        expect(scene.emitters).toHaveLength(7); // 7 palette colours
        const cells = scene.emitters.reduce((n, e) => n + e.emitted.length, 0);
        expect(cells).toBe(40); // ...still covering every one of the 40 cells
    });

    it('launches shards from each cell position, tinted with that cell colour', () => {
        fx.spawnLineClearShards([23]);
        const green = scene.emitters.find((e) => e.config.tint === 0x00ff00);
        expect(green).toBeTruthy();
        green.emitted.forEach((e) => {
            // centre of a 40px cell on the bottom visible row (23 - 4 hidden = 19)
            expect((e.x - 20) % 40).toBe(0);
            expect(e.y).toBe(19 * 40 + 20);
            expect(e.n).toBe(3);
        });
    });

    it('renders debris opaque, not additive — the cell colour must read true', () => {
        fx.spawnLineClearShards([23]);
        expect(scene.emitters[0].config.blendMode).toBe('NORMAL');
        expect(scene.emitters[0].config.gravityY).toBeGreaterThan(400); // falls like debris
    });

    it('scales the shard with the block size instead of a fixed pixel size', () => {
        fx.spawnLineClearShards([23]);
        const small = scene.emitters[0].config.scale.start;

        const big = makeScene({ rows: [23] });
        big.blockSize = 80;
        const bfx = new SharedEffects(big);
        bfx._reducedMotion = () => false;
        bfx.spawnLineClearShards([23]);
        expect(big.emitters[0].config.scale.start).toBeGreaterThan(small);
    });

    it('samples rows on a mega cascade rather than spawning unbounded debris', () => {
        const many = Array.from({ length: 24 }, (_, i) => i);
        const s = makeScene({ rows: many });
        const f = new SharedEffects(s);
        f._reducedMotion = () => false;
        f.spawnLineClearShards(many);
        const cells = s.emitters.reduce((n, e) => n + e.emitted.length, 0);
        // Budget is 60 cells; sampling keeps it near that, spanning the whole clear.
        expect(cells).toBeLessThanOrEqual(24 * COLS);
        expect(cells).toBeLessThan(120);
        expect(cells).toBeGreaterThan(0);
    });

    it('thins the debris under reduced motion', () => {
        const s = makeScene({ rows: [23] });
        const f = new SharedEffects(s);
        f._reducedMotion = () => true;
        f.spawnLineClearShards([23]);
        s.emitters.forEach((e) => e.emitted.forEach((x) => expect(x.n).toBe(1)));
        expect(s.emitters[0].config.speed.max).toBeLessThan(230);
    });

    it('skips rows that are above the visible playfield', () => {
        fx.spawnLineClearShards([2]); // hiddenRows = 4, so row 2 is off-screen
        expect(scene.emitters).toHaveLength(0);
    });

    it('no-ops without a board grid or with particles disabled', () => {
        const noGrid = makeScene({ rows: [23] });
        noGrid.gameState = {};
        new SharedEffects(noGrid).spawnLineClearShards([23]);
        expect(noGrid.emitters).toHaveLength(0);

        const noParticles = makeScene({ rows: [23] });
        noParticles.getQualityConfig = () => ({ particles: false });
        new SharedEffects(noParticles).spawnLineClearShards([23]);
        expect(noParticles.emitters).toHaveLength(0);
    });

    it('keeps garbage its own grey instead of theming it', () => {
        const s = makeScene({
            rows: [23],
            gridColors: () => ({ type: 'GARBAGE', color: '#5a5a5a' }),
        });
        s.getThemedColor = () => '#ff00ff'; // theme would override; garbage must not
        const f = new SharedEffects(s);
        f._reducedMotion = () => false;
        f.spawnLineClearShards([23]);
        expect(s.emitters[0].config.tint).toBe(0x5a5a5a);
    });
});
