/**
 * Combo popup: arcade snap → hold → release.
 *
 * The popup it replaced was one 800ms Cubic fade that started dying on frame one,
 * centred over the stack, identical at 2x and 12x. These pin the three properties
 * that fixed: a real hold window, tier escalation, and placement off the stack.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

function makeScene() {
    const tweens = [];
    const texts = [];
    const containers = [];
    const mkDisplay = (extra = {}) => ({
        x: 0,
        y: 0,
        setOrigin: vi.fn().mockReturnThis(),
        setAlpha: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setScrollFactor: vi.fn().mockReturnThis(),
        setBlendMode: vi.fn().mockReturnThis(),
        setScale: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
        ...extra,
    });
    return {
        tweens_: tweens,
        texts,
        containers,
        cols: 10,
        rows: 20,
        blockSize: 40,
        hiddenRows: 4,
        gameState: null,
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: false }), // isolate the popup from particles
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn((cfg) => { tweens.push(cfg); return cfg; }) },
        add: {
            container: vi.fn((x, y) => {
                const c = mkDisplay({
                    x, y, list: [], type: 'Container',
                    add(o) { this.list.push(o); return this; },
                    addAt(o, i) { this.list.splice(i, 0, o); return this; },
                });
                containers.push(c);
                return c;
            }),
            text: vi.fn((x, y, str, style) => {
                // Phaser's text box is taller than the glyphs — the popup's band
                // geometry is derived from this, so the fake must report a size.
                const size = parseInt(String(style?.fontSize || '16px'), 10);
                const t = mkDisplay({
                    x, y, text: str, style, type: 'Text', width: size * String(str).length * 0.6, height: size * 1.22,
                });
                texts.push(t);
                return t;
            }),
            graphics: vi.fn(() => mkDisplay({
                type: 'Graphics',
                scaleX: 1,
                fillStyle: vi.fn().mockReturnThis(),
                fillPoints: vi.fn().mockReturnThis(),
                lineStyle: vi.fn().mockReturnThis(),
                beginPath: vi.fn().mockReturnThis(),
                moveTo: vi.fn().mockReturnThis(),
                lineTo: vi.fn().mockReturnThis(),
                strokePath: vi.fn().mockReturnThis(),
            })),
        },
    };
}

/** The tween that fades the popup out is the one targeting alpha 0. */
const exitTween = (scene) => scene.tweens_.find((t) => t.alpha === 0 && t.scale === 0.9);

describe('showComboPopup', () => {
    let scene;
    let fx;

    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
    });

    it('holds at full alpha before releasing, instead of fading from frame one', () => {
        fx.showComboPopup(5);
        const exit = exitTween(scene);
        expect(exit).toBeTruthy();
        // Snap (50) + settle (60) finish at 110; the exit must not start until the
        // hold has elapsed. That gap IS the effect.
        expect(exit.delay).toBeGreaterThanOrEqual(300);
        // ...and the whole thing is still shorter than the old 800ms drift.
        expect(exit.delay + exit.duration).toBeLessThan(800);
    });

    it('snaps in with overshoot, then settles', () => {
        fx.showComboPopup(5);
        const snap = scene.tweens_.find((t) => t.ease === 'Back.easeOut' && t.scale > 1);
        expect(snap).toBeTruthy();
        expect(snap.duration).toBeLessThanOrEqual(60);
        const settle = scene.tweens_.find((t) => t.scale === 1 && t.delay === snap.duration);
        expect(settle).toBeTruthy();
    });

    it('is placed off the board centre so it stops covering the stack', () => {
        fx.showComboPopup(5);
        const c = scene.containers[0];
        const boardHeight = scene.rows * scene.blockSize;
        expect(c.y).toBeLessThan(boardHeight / 2);
        expect(c.x).toBe((scene.cols * scene.blockSize) / 2);
    });

    it('escalates size and colour across tiers', () => {
        const sizeAt = (combo) => {
            const s = makeScene();
            new SharedEffects(s).showComboPopup(combo);
            return parseInt(String(s.texts[0].style.fontSize), 10);
        };
        const [t2, t4, t7, t10] = [2, 4, 7, 10].map(sizeAt);
        expect(t2).toBeLessThan(t4);
        expect(t4).toBeLessThan(t7);
        expect(t7).toBeLessThan(t10);

        const accents = [2, 4, 7, 10].map((n) => fx._comboTier(n).accent);
        expect(new Set(accents).size).toBe(4);
    });

    it('renders the number and a smaller COMBO caption, not one uniform string', () => {
        fx.showComboPopup(7);
        const number = scene.texts.find((t) => t.text === '7');
        const label = scene.texts.find((t) => t.text === 'COMBO');
        expect(number).toBeTruthy();
        expect(label).toBeTruthy();
        const numSize = parseInt(String(number.style.fontSize), 10);
        const labelSize = parseInt(String(label.style.fontSize), 10);
        expect(labelSize).toBeLessThan(numSize / 2);
    });

    it('sizes the band from the measured text box, not the font size', () => {
        // A band centred on the text BOX sits ~20% low because the glyphs ride high
        // in it; the popup must offset using the measured height.
        fx.showComboPopup(10);
        const label = scene.texts.find((t) => t.text === 'COMBO');
        const number = scene.texts.find((t) => t.text === '10');
        // Caption sits fully below the band, which is anchored above box centre.
        expect(label.y).toBeGreaterThan(0);
        expect(label.y).toBeLessThan(number.height);
    });

    it('drops the aberration ghosts and jitter under reduced motion', () => {
        const normal = makeScene();
        const nfx = new SharedEffects(normal);
        nfx._reducedMotion = () => false;
        nfx.showComboPopup(12);

        const reduced = makeScene();
        const rfx = new SharedEffects(reduced);
        rfx._reducedMotion = () => true;
        rfx.showComboPopup(12);

        expect(reduced.texts.length).toBeLessThan(normal.texts.length);
        // No overshoot either — it snaps straight to 1.
        const snap = reduced.tweens_.find((t) => t.ease === 'Back.easeOut');
        expect(snap.scale).toBe(1);
    });

    it('never mutates the particle-tint state', () => {
        // The popup number is CASCADE DEPTH; tint state is the true combo owned
        // by ComboTracker. When the popup synced the two, a deep cascade pinned
        // the tint at its depth forever in local MP (no tracker there to reset it).
        const s = makeScene();
        const f = new SharedEffects(s);
        f.currentComboCount = 1;
        f.showComboPopup(6);
        expect(f.currentComboCount).toBe(1);

        const gated = makeScene();
        const g = new SharedEffects(gated);
        g._effectEnabled = (key) => key !== 'comboPopupEffect';
        g.showComboPopup(6);
        expect(g.currentComboCount).toBe(0);
        expect(gated.containers).toHaveLength(0);
    });

    it('falls back to a plain label when the scene has no container support', () => {
        const s = makeScene();
        s.add.container = undefined;
        const f = new SharedEffects(s);
        expect(() => f.showComboPopup(4)).not.toThrow();
        expect(s.texts.length).toBe(1);
    });
});
