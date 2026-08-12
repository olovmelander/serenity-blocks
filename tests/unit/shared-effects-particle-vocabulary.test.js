/**
 * Particle vocabulary.
 *
 * Every effect in the game used to draw the same 4px circle, so line clears,
 * combo bursts and shockwaves all read as the same cloud at different speeds.
 * There are now three shapes with distinct jobs:
 *
 *   square streak  → debris   (line-clear shards, tinted per cell)
 *   spark streak   → speed    (clear fountain, radial shockwave)
 *   circle         → motes    (combo explosion, soft ambient burst)
 *
 * A round dot has no direction; a streak only reads as speed if it is ALIGNED to
 * travel, which is what these pin.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';
import { ensureStreakTexture } from '../../src/rendering/phaser/utils/graphics.js';

// The clear fountain builds its emit zone from Phaser.Geom.Rectangle, so the
// global is a real dependency here rather than something to stub away.
globalThis.window = globalThis.window || {};
globalThis.window.Phaser = {
    Geom: { Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } } },
    BlendModes: { ADD: 1, NORMAL: 0 },
};

function makeScene({ canMakeTextures = true } = {}) {
    const emitters = [];
    const registered = new Set(['line-clear-particle']);
    const scene = {
        emitters,
        registered,
        cols: 10,
        rows: 20,
        blockSize: 40,
        hiddenRows: 4,
        gameState: null,
        textures: { exists: (k) => registered.has(k) },
        getQualityConfig: () => ({ particles: true }),
        getComboTint: (combo, i) => 0x100000 + i,
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn() },
        add: {
            particles: vi.fn((x, y, key, config) => {
                const e = {
                    x, y, key, config, exploded: 0,
                    setDepth: vi.fn(), setScrollFactor: vi.fn(), destroy: vi.fn(),
                    explode(n) { this.exploded = n; return true; },
                    emitParticleAt: vi.fn(),
                };
                emitters.push(e);
                return e;
            }),
        },
    };
    if (canMakeTextures) {
        scene.make = {
            graphics: () => ({
                fillStyle: vi.fn().mockReturnThis(),
                fillRect: vi.fn().mockReturnThis(),
                generateTexture: vi.fn((key) => registered.add(key)),
                destroy: vi.fn(),
            }),
        };
    }
    return scene;
}

describe('ensureStreakTexture', () => {
    it('registers a streak of the requested dimensions, once', () => {
        const registered = new Set();
        let made = 0;
        const scene = {
            textures: { exists: (k) => registered.has(k) },
            make: {
                graphics: () => {
                    made += 1;
                    return {
                        fillStyle: vi.fn().mockReturnThis(),
                        fillRect: vi.fn().mockReturnThis(),
                        generateTexture: vi.fn((k, w, h) => {
                            registered.add(k);
                            expect(w).toBe(20);
                            expect(h).toBe(4);
                        }),
                        destroy: vi.fn(),
                    };
                },
            },
        };
        ensureStreakTexture(scene, 'spark', 20, 4);
        ensureStreakTexture(scene, 'spark', 20, 4); // idempotent
        expect(made).toBe(1);
    });
});

describe('particle roles', () => {
    let scene;
    let fx;

    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('gives the shockwave ring streaks aligned to travel direction', () => {
        fx.spawnRadialWave(8);
        const { config } = scene.emitters[0];
        expect(scene.emitters[0].key).toBe('fx-spark');
        // rotate must walk the SAME sequence as angle, or the streaks tumble
        // instead of pointing outward.
        expect(config.rotate).toEqual(config.angle);
    });

    it('points the clear fountain streaks up, matching its emission cone', () => {
        fx.lastImpactIntensity = 2;
        fx.spawnLineClearParticles([20]);
        const { config, key } = scene.emitters[0];
        expect(key).toBe('fx-spark');
        expect(config.rotate).toBe(-90);
        // -90 is the centre of the cone the particles actually travel in.
        expect(config.angle.min).toBeLessThan(-90);
        expect(config.angle.max).toBeGreaterThan(-90);
    });

    it('keeps the combo explosion as round motes, not streaks', () => {
        fx.spawnComboExplosionParticles(4);
        // Bursts are scheduled through delayedCall; run them.
        const calls = scene.time.delayedCall.mock.calls;
        calls.forEach(([, cb]) => cb && cb());
        expect(scene.emitters.length).toBeGreaterThan(0);
        scene.emitters.forEach((e) => {
            expect(e.key).toBe('line-clear-particle');
            expect(e.config.rotate).toBeUndefined(); // no direction to align to
        });
    });

    it('falls back to the round particle when textures cannot be created', () => {
        const bare = makeScene({ canMakeTextures: false });
        const f = new SharedEffects(bare);
        f._reducedMotion = () => false;
        expect(f._sparkTextureKey()).toBe('line-clear-particle');
        f.spawnRadialWave(6);
        expect(bare.emitters[0].key).toBe('line-clear-particle');
    });

    it('keeps the fountain at a supporting density, not a wall', () => {
        // The fountain was tuned when it was the ONLY thing selling a clear
        // (18 x intensity per row). It now shares the moment with per-cell debris
        // and a landing impact, so it is density-scaled to sit under them.
        fx.lastImpactIntensity = 4 * 2.2; // a quad's intensity
        fx.spawnLineClearParticles([20]);
        const emitted = scene.emitters[0].exploded;
        const unscaled = Math.round(18 * 4 * 2.2);
        expect(emitted).toBeLessThan(unscaled);
        expect(emitted).toBeGreaterThan(4); // still a real burst, not a token
    });

    // triggerLineClearFlash also spawns the fountain, so pick the ring out by its
    // stepped-angle config rather than trusting emitter order.
    const waveOf = (s) => s.emitters.find((e) => e.config?.angle?.steps);

    it('radiates the shockwave from the clear, not from mid-board', () => {
        const boardHeight = 20 * 40;
        fx.triggerLineClearFlash([22, 23]); // a clear near the bottom of the well
        fx.spawnRadialWave(6);
        const low = waveOf(scene).y;

        const top = makeScene();
        const tfx = new SharedEffects(top);
        tfx._reducedMotion = () => false;
        tfx.triggerLineClearFlash([8, 9]); // a clear high up
        tfx.spawnRadialWave(6);
        const high = waveOf(top).y;

        expect(low).toBeGreaterThan(high);        // it follows the clear...
        expect(low).not.toBe(boardHeight / 2);    // ...instead of sitting at centre
    });

    it('clamps the anchor inside the playfield', () => {
        const boardHeight = 20 * 40;
        fx.triggerLineClearFlash([23]); // very bottom
        fx.spawnRadialWave(6);
        const y = waveOf(scene).y;
        expect(y).toBeLessThanOrEqual(boardHeight * 0.88);
        expect(y).toBeGreaterThanOrEqual(boardHeight * 0.12);
    });

    it('falls back to board centre with no recent clear', () => {
        fx.spawnRadialWave(6);
        expect(waveOf(scene).y).toBe((20 * 40) / 2);
    });

    it('keeps the perfect clear concentric by passing an explicit anchor', () => {
        fx.triggerLineClearFlash([23]);  // last clear was at the very bottom...
        fx.spawnRadialWave(6, 400);      // ...but perfect clear overrides to centre
        expect(waveOf(scene).y).toBe(400);
    });

    it('registers the spark texture only once across many effects', () => {
        fx.spawnRadialWave(6);
        fx.lastImpactIntensity = 1;
        fx.spawnLineClearParticles([20]);
        fx.spawnRadialWave(6);
        expect(scene.registered.has('fx-spark')).toBe(true);
        expect(scene.emitters.every((e) => e.key === 'fx-spark')).toBe(true);
    });
});
