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

    it('tints the ring in the chain\'s tone, lit with cream', () => {
        fx.spawnRadialWave(8);
        const { tint } = scene.emitters[0].config;
        expect(tint).toContain(0xffac88); // coral at 7 and up
        expect(tint).toContain(0xfff6e9);
    });

    it('warms with the chain: aqua, gold, coral, then a hot pink — never a rainbow', () => {
        const toneAt = (combo) => {
            const s = makeScene();
            new SharedEffects(s).spawnRadialWave(combo);
            return s.emitters[0].config.tint;
        };
        expect([3, 5, 8, 12].map((combo) => toneAt(combo)[0])).toEqual([0x9ee8ed, 0xf3d28d, 0xffac88, 0xff9cab]);
        expect(new Set(toneAt(12)).size).toBeLessThanOrEqual(3);
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
