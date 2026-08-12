/**
 * Zoom punch — the screen-space partner to the camera shake.
 *
 * Shake says "something rattled"; a zoom kick says "the screen took the hit".
 *
 * Note what is NOT here: micro-stops on the smaller beats. triggerHitStop() only
 * freezes scene timers and tweens, and only reads as an impact because the modes
 * pause the simulation at the same moment from getClearTier().hitStop. Freezing
 * the effect layer alone would stutter the animation while the board kept moving,
 * so extending stops is a gameplay-timing change, not a visual one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

globalThis.window = globalThis.window || {};
globalThis.window.Phaser = {
    Geom: { Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } } },
    BlendModes: { ADD: 1, NORMAL: 0 },
};

function makeScene() {
    const tweens = [];
    return {
        tweens_: tweens,
        cols: 10,
        rows: 20,
        blockSize: 40,
        hiddenRows: 4,
        gameState: null,
        cameras: { main: { zoom: 1 } },
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: false }),
        getComboTint: () => 0x00ffff,
        shakeCamera: vi.fn(),
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn((cfg) => { tweens.push(cfg); return cfg; }) },
        add: {
            graphics: vi.fn(() => ({
                setScrollFactor: vi.fn(), setDepth: vi.fn(), setBlendMode: vi.fn(),
                clear: vi.fn(), fillStyle: vi.fn(), fillRect: vi.fn(),
                lineStyle: vi.fn(), strokeCircle: vi.fn(), beginPath: vi.fn(),
                moveTo: vi.fn(), lineTo: vi.fn(), strokePath: vi.fn(), destroy: vi.fn(),
            })),
            rectangle: vi.fn(() => ({
                setScrollFactor: vi.fn(), setDepth: vi.fn(), setBlendMode: vi.fn(), destroy: vi.fn(),
            })),
            text: vi.fn(() => ({
                setOrigin: vi.fn().mockReturnThis(), setScrollFactor: vi.fn(), setDepth: vi.fn(),
                setAlpha: vi.fn(), setBlendMode: vi.fn(), destroy: vi.fn(), width: 40, height: 50,
            })),
            particles: vi.fn(() => null),
        },
    };
}

/** The tween returning the camera to rest. */
const zoomTween = (scene) => scene.tweens_.find((t) => t.targets === scene.cameras.main);

describe('_zoomPunch', () => {
    let scene;
    let fx;

    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('kicks the camera in and schedules a snap back to rest', () => {
        fx._zoomPunch(0.02, 130);
        expect(scene.cameras.main.zoom).toBeCloseTo(1.02, 5);
        const t = zoomTween(scene);
        expect(t.zoom).toBe(1);
        expect(t.duration).toBe(130);
    });

    it('does not compound overlapping punches', () => {
        fx._zoomPunch(0.02, 130);
        fx._zoomPunch(0.02, 130);
        // The second must be ignored, or the camera walks away from rest.
        expect(scene.cameras.main.zoom).toBeCloseTo(1.02, 5);
        expect(scene.tweens_.filter((t) => t.targets === scene.cameras.main)).toHaveLength(1);
    });

    it('captures resting zoom rather than assuming 1', () => {
        scene.cameras.main.zoom = 2;
        fx._zoomPunch(0.05, 100);
        expect(scene.cameras.main.zoom).toBeCloseTo(2.1, 5);
        expect(zoomTween(scene).zoom).toBe(2);
    });

    it('is skipped entirely under reduced motion', () => {
        fx._reducedMotion = () => true;
        fx._zoomPunch(0.02, 130);
        expect(scene.cameras.main.zoom).toBe(1);
        expect(zoomTween(scene)).toBeUndefined();
    });

    it('tolerates a scene with no camera', () => {
        const bare = makeScene();
        bare.cameras = {};
        const f = new SharedEffects(bare);
        f._reducedMotion = () => false;
        expect(() => f._zoomPunch(0.02, 130)).not.toThrow();
    });

    it('restores the camera if the scene tears down mid-punch', () => {
        fx._zoomPunch(0.03, 300);
        expect(scene.cameras.main.zoom).toBeGreaterThan(1);
        fx.cleanup();
        expect(scene.cameras.main.zoom).toBe(1);
    });

    it('scales the kick with the clear tier', () => {
        fx.playLineClearImpact(1);
        const single = scene.cameras.main.zoom;
        zoomTween(scene).onComplete();

        const quadScene = makeScene();
        const qfx = new SharedEffects(quadScene);
        qfx._reducedMotion = () => false;
        qfx.playLineClearImpact(4);
        expect(quadScene.cameras.main.zoom).toBeGreaterThan(single);
    });

    it('gives the perfect clear the biggest kick of all', () => {
        fx.playLineClearImpact(4);
        const quad = scene.cameras.main.zoom;
        zoomTween(scene).onComplete();

        const pcScene = makeScene();
        const pfx = new SharedEffects(pcScene);
        pfx._reducedMotion = () => false;
        pfx.playPerfectClear(4);
        expect(pcScene.cameras.main.zoom).toBeGreaterThan(quad);
    });
});
