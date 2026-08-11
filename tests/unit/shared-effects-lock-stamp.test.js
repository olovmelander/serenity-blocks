/**
 * Lock stamp — a brief flash of the locked piece's own silhouette.
 *
 * A circle from the centroid makes an I-bar and an O-block read identically; the
 * stamp says "this shape landed here".
 *
 * It is an OUTLINE, not a fill. The first attempt filled the silhouette
 * additively, and since a lock always lands on the stack that just lifted the
 * blocks underneath toward white — a grey wash rather than a stamp. A stroked
 * perimeter stays crisp over anything.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

globalThis.window = globalThis.window || {};
globalThis.window.Phaser = { BlendModes: { ADD: 1, NORMAL: 0 } };

function makeScene() {
    const graphics = [];
    return {
        graphics,
        cols: 10,
        rows: 20,
        blockSize: 40,
        hiddenRows: 4,
        gameState: null,
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: false }),
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn() },
        add: {
            graphics: vi.fn(() => {
                const g = {
                    edges: [], fills: [], alpha: 1, pos: null, strokes: 0,
                    setScrollFactor: vi.fn(), setDepth: vi.fn(), setBlendMode: vi.fn(),
                    setPosition: vi.fn(function setPos(x, y) { this.pos = { x, y }; }),
                    setAlpha: vi.fn(function setA(a) { this.alpha = a; }),
                    lineStyle: vi.fn(), beginPath: vi.fn(),
                    strokePath: vi.fn(function stroke() { this.strokes += 1; }),
                    moveTo: vi.fn(function move(x, y) { this.edges.push({ from: { x, y } }); }),
                    lineTo: vi.fn(function line(x, y) {
                        const last = this.edges[this.edges.length - 1];
                        if (last) last.to = { x, y };
                    }),
                    fillStyle: vi.fn(),
                    fillRect: vi.fn(function fill(...a) { this.fills.push(a); }),
                    clear: vi.fn(), strokeCircle: vi.fn(), destroy: vi.fn(),
                };
                graphics.push(g);
                return g;
            }),
        },
    };
}

/** The stamp is the first graphics object; the ripple is created after it. */
const stampOf = (scene) => scene.graphics[0];

describe('_playLockStamp', () => {
    let scene;
    let fx;

    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('strokes an outline and never fills the silhouette', () => {
        fx._playLockStamp({ shape: [[1]], x: 3, y: 20 }, 0x00ffff, false);
        const g = stampOf(scene);
        expect(g.strokes).toBeGreaterThan(0);
        expect(g.fills).toHaveLength(0); // a fill would wash out the stack beneath
    });

    it('traces the fused perimeter, omitting internal edges', () => {
        // A 2x2 O block: 16 cell-edges in total, 8 of them internal.
        fx._playLockStamp({ shape: [[1, 1], [1, 1]], x: 2, y: 20 }, 0x00ffff, false);
        expect(stampOf(scene).edges).toHaveLength(8);
    });

    it('handles a concave silhouette', () => {
        // S piece: cells (1,0) (2,0) (0,1) (1,1) -> 10 exposed edges.
        fx._playLockStamp({ shape: [[0, 1, 1], [1, 1, 0]], x: 0, y: 20 }, 0x00ffff, false);
        expect(stampOf(scene).edges).toHaveLength(10);
    });

    it('draws a lone cell as a complete box', () => {
        fx._playLockStamp({ shape: [[1]], x: 0, y: 20 }, 0x00ffff, false);
        expect(stampOf(scene).edges).toHaveLength(4);
    });

    it('every edge is exactly one cell long', () => {
        fx._playLockStamp({ shape: [[1, 1], [1, 1]], x: 2, y: 20 }, 0x00ffff, false);
        stampOf(scene).edges.forEach(({ from, to }) => {
            const len = Math.hypot(to.x - from.x, to.y - from.y);
            expect(len).toBeCloseTo(40, 5);
        });
    });

    it('anchors at the piece centroid in screen space', () => {
        // Single cell at column 3, world row 20 -> screen row 16 with 4 hidden.
        fx._playLockStamp({ shape: [[1]], x: 3, y: 20 }, 0x00ffff, false);
        expect(stampOf(scene).pos).toEqual({ x: 3 * 40 + 20, y: 16 * 40 + 20 });
    });

    it('uses world rows in infinity mode, where the camera scrolls', () => {
        fx._playLockStamp({ shape: [[1]], x: 3, y: 20 }, 0x00ffff, true);
        expect(stampOf(scene).pos).toEqual({ x: 3 * 40 + 20, y: 20 * 40 + 20 });
    });

    it('is skipped under reduced motion', () => {
        fx._reducedMotion = () => true;
        fx._playLockStamp({ shape: [[1]], x: 3, y: 20 }, 0x00ffff, false);
        expect(scene.graphics).toHaveLength(0);
    });

    it('does nothing for an empty shape', () => {
        fx._playLockStamp({ shape: [[0, 0], [0, 0]], x: 3, y: 20 }, 0x00ffff, false);
        expect(scene.graphics).toHaveLength(0);
    });
});
