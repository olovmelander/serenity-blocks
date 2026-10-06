/**
 * A cascade builds wave after wave.
 *
 * Physics passes each wave's depth with the impact (onLineClearImpact(lineCount,
 * cascadeCount)), right before the wave's flash. Before this, only the popup knew
 * the depth: wave 5 of a chain lit, shook and sparked exactly like wave 1.
 */
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';
import { FX, TONE, mixColor } from '../../src/rendering/phaser/fx/fx-kit.js';

globalThis.window = globalThis.window || {};
globalThis.window.Phaser = {
    Geom: { Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } } },
    BlendModes: { ADD: 1, NORMAL: 0 },
};

const BS = 40;
const W = 10 * BS;

function makeScene() {
    const images = [];
    const emitters = [];
    const scene = {
        images,
        emitters,
        shakes: [],
        cols: 10,
        rows: 20,
        blockSize: BS,
        hiddenRows: 4,
        gameState: { boardGrid: Array.from({ length: 24 }, () => Array(10).fill(null)) },
        cameras: { main: { zoom: 1, scrollY: 0 } },
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: true }),
        shakeCamera(mag, dur) { this.shakes.push({ mag, dur }); },
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn((cfg) => cfg) },
        add: {
            image: vi.fn((x, y, key) => {
                const img = {
                    x, y, key, width: 64, height: 64, scale: 1, scaleX: 1, scaleY: 1,
                };
                ['setOrigin', 'setDisplaySize', 'setAlpha', 'setDepth', 'setScrollFactor', 'setBlendMode', 'destroy'].forEach((name) => {
                    img[name] = vi.fn(() => img);
                });
                img.setTint = vi.fn((tint) => { img.tint = tint; return img; });
                images.push(img);
                return img;
            }),
            particles: vi.fn((x, y, key, config) => {
                const e = {
                    x, y, key, config, exploded: 0,
                    setDepth: vi.fn(), setScrollFactor: vi.fn(), destroy: vi.fn(),
                    explode(n) { this.exploded = n; return true; },
                };
                emitters.push(e);
                return e;
            }),
            graphics: vi.fn(() => ({
                setScrollFactor: vi.fn(), setDepth: vi.fn(), setBlendMode: vi.fn(), clear: vi.fn(), destroy: vi.fn(),
            })),
        },
    };
    return scene;
}

const slabTint = (scene) => scene.images.find((img) => img.key === FX.SLAB)?.tint;
const wallGlows = (scene) => scene.images.filter((img) => img.key === FX.GLOW && img.setDisplaySize.mock.calls.some(([w]) => w === BS * 2.8));
const bloom = (scene) => scene.images.find((img) => img.key === FX.GLOW && img.setDisplaySize.mock.calls.some(([w]) => w === W * 2));

/** One wave as physics drives it: the impact, then the flash. */
function wave(fx, rows, depth) {
    fx.playLineClearImpact(rows.length, depth);
    fx.triggerLineClearFlash(rows);
}

describe('cascade depth', () => {
    let scene;
    let fx;
    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('a lock\'s own clear is plain cream light, with no wall glow and no bloom', () => {
        wave(fx, [23], 1);
        expect(slabTint(scene)).toBe(TONE.CREAM);
        expect(wallGlows(scene)).toHaveLength(0);
        expect(bloom(scene)).toBeUndefined();
    });

    it('each wave takes more of the chain\'s tone: aqua early, gold from the fourth', () => {
        wave(fx, [23], 2);
        expect(slabTint(scene)).toBe(mixColor(TONE.CREAM, TONE.AQUA, 0.4));

        const deep = makeScene();
        const deepFx = new SharedEffects(deep);
        wave(deepFx, [23], 4);
        expect(slabTint(deep)).toBe(mixColor(TONE.CREAM, TONE.GOLD, 0.5));
    });

    it('from the third wave the well\'s walls glow in the chain\'s tone, and it blooms', () => {
        wave(fx, [23], 3);
        const glows = wallGlows(scene);
        expect(glows.length).toBeGreaterThanOrEqual(2);
        glows.forEach((glow) => expect(glow.tint).toBe(TONE.AQUA));
        expect(bloom(scene)?.tint).toBe(TONE.AQUA);
    });

    it('the wall glow brightens with depth', () => {
        const alphaAt = (depth) => {
            const s = makeScene();
            new SharedEffects(s).playLineClearImpact(1, depth);
            return wallGlows(s)[0].setAlpha.mock.calls[0][0];
        };
        expect(alphaAt(6)).toBeGreaterThan(alphaAt(3));
    });

    it('lands harder and throws more embers as the chain deepens', () => {
        fx.playLineClearImpact(1, 1);
        const first = { shake: scene.shakes[0].mag, embers: fx.lastImpactIntensity };
        fx.playLineClearImpact(1, 5);
        expect(scene.shakes[1].mag).toBeGreaterThan(first.shake);
        expect(fx.lastImpactIntensity).toBeGreaterThan(first.embers);
    });

    it('the depth is per wave: a new lock\'s clear is plain again', () => {
        wave(fx, [23], 5);
        scene.images.length = 0;
        wave(fx, [23], 1);
        expect(slabTint(scene)).toBe(TONE.CREAM);
        expect(fx._chainCount()).toBe(0);
    });

    it('outside a cascade the consecutive-clear combo still tints the light', () => {
        fx.setComboCount(4);
        wave(fx, [23], 1);
        expect(slabTint(scene)).toBe(mixColor(TONE.CREAM, TONE.GOLD, 0.45));
    });

    it('a missing depth (older callers) reads as the first wave', () => {
        fx.playLineClearImpact(2);
        expect(fx._waveDepth).toBe(1);
        fx.playLineClearImpact(2, 'x');
        expect(fx._waveDepth).toBe(1);
    });
});

describe('radial wave in light', () => {
    it('is one soft ring in the chain\'s tone, not a burst of streaks', () => {
        const scene = makeScene();
        const fx = new SharedEffects(scene);
        fx.spawnRadialWave(8);
        expect(scene.add.particles).not.toHaveBeenCalled();
        const rings = scene.images.filter((img) => img.key === FX.RING);
        expect(rings).toHaveLength(1);
        expect(rings[0].tint).toBe(TONE.CORAL);
    });
});
