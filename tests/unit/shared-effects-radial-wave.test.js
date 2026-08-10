/**
 * Regression guard for the radial wave's allocation shape.
 *
 * The wave used to build ONE EMITTER PER PARTICLE — `60 + comboCount * 10`
 * Phaser game objects plus a destroy timer each (~140 at combo 8), rebuilt on
 * every high combo and every perfect clear. It is now a single emitter whose
 * stepped `angle` op reproduces the even angular spacing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

/** Minimal stand-in for the bits of a Phaser scene the wave touches. */
function makeScene() {
    const emitters = [];
    return {
        emitters,
        cols: 10,
        rows: 20,
        blockSize: 40,
        hiddenRows: 4,
        gameState: null,
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: true }),
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn() },
        add: {
            particles: vi.fn((x, y, key, config) => {
                const e = {
                    x, y, key, config, exploded: 0,
                    setDepth: vi.fn(), setScrollFactor: vi.fn(), destroy: vi.fn(),
                    explode(n) { this.exploded = n; return true; },
                };
                emitters.push(e);
                return e;
            }),
        },
    };
}

describe('spawnRadialWave', () => {
    /** @type {ReturnType<typeof makeScene>} */
    let scene;
    /** @type {SharedEffects} */
    let fx;

    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
    });

    it('allocates exactly one emitter regardless of combo size', () => {
        fx.spawnRadialWave(8);
        expect(scene.add.particles).toHaveBeenCalledTimes(1);
        expect(scene.emitters).toHaveLength(1);
    });

    it('still emits the full particle count (60 + 10 per combo)', () => {
        fx.spawnRadialWave(8);
        expect(scene.emitters[0].exploded).toBe(140);

        const scene2 = makeScene();
        new SharedEffects(scene2).spawnRadialWave(5);
        expect(scene2.emitters[0].exploded).toBe(110);
    });

    it('walks the full circle with evenly stepped angles', () => {
        fx.spawnRadialWave(6);
        const { angle } = scene.emitters[0].config;
        expect(angle).toEqual({ start: 0, end: 360, steps: 120 });
    });

    it('uses an exact speed so the ring stays circular', () => {
        fx.spawnRadialWave(6);
        // A {min,max} range would scatter the ring into a disc.
        expect(scene.emitters[0].config.speed).toBe(320);
    });

    it('registers one destroy timer, not one per particle', () => {
        fx.spawnRadialWave(8);
        expect(scene.time.delayedCall).toHaveBeenCalledTimes(1);
        expect(fx.activeParticleSystems.size).toBe(1);
    });

    it('cycles per-particle tints through the combo palette at 5+', () => {
        fx.spawnRadialWave(8);
        const { tint } = scene.emitters[0].config;
        expect(Array.isArray(tint)).toBe(true);
        expect(tint).toHaveLength(7);
        expect(new Set(tint).size).toBeGreaterThan(1);
    });

    it('uses a single tint below the rainbow threshold', () => {
        fx.spawnRadialWave(3);
        expect(typeof scene.emitters[0].config.tint).toBe('number');
    });

    it('honours a scene-level combo palette override', () => {
        scene.getComboTint = vi.fn((combo, i) => 0x100000 + i);
        fx.spawnRadialWave(8);
        expect(scene.emitters[0].config.tint).toEqual([
            0x100000, 0x100001, 0x100002, 0x100003, 0x100004, 0x100005, 0x100006,
        ]);
    });

    it('skips entirely when the quality tier disables particles', () => {
        scene.getQualityConfig = () => ({ particles: false });
        fx.spawnRadialWave(8);
        expect(scene.add.particles).not.toHaveBeenCalled();
    });

    it('cleans up and bails when the emitter cannot emit', () => {
        scene.add.particles = vi.fn(() => ({
            setDepth: vi.fn(),
            setScrollFactor: vi.fn(),
            destroy: vi.fn(),
            // no explode/emit -> emitParticles() reports failure
        }));
        fx.spawnRadialWave(8);
        expect(fx.activeParticleSystems.size).toBe(0);
    });
});
