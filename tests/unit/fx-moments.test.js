/**
 * The match moments on a versus board (src/rendering/phaser/fx/fx-moments.js):
 * a knock-out, a round won, the match won.
 *
 * The knock-out replaced a white DOM flash over the card and a 0.3 alpha drop; the
 * wins replaced a solid gold camera flash and blob "fireworks". These pin the new
 * anatomy: the tide and the drain (a Phaser 4 camera colour filter) that a new
 * round must undo, and fireworks that climb and burst instead of a full-board fill.
 */
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    playKnockoutFx, playRoundWinFx, playVictoryFx, restoreKnockoutFx,
} from '../../src/rendering/phaser/fx/fx-moments.js';
import { FX, TONE } from '../../src/rendering/phaser/fx/fx-kit.js';

const BS = 40;
const H = 20 * BS;

function makeScene({ cells = 0 } = {}) {
    const images = [];
    const tweens = [];
    const timers = [];
    const matrix = { reset: vi.fn(), saturate: vi.fn(), brightness: vi.fn() };
    const filter = { colorMatrix: matrix };
    const grid = Array.from({ length: 24 }, () => Array(10).fill(null));
    for (let i = 0; i < cells; i++) grid[23 - Math.floor(i / 10)][i % 10] = { type: 'GARBAGE', color: '#4a5068' };
    const camera = {
        alpha: 1,
        setAlpha: vi.fn(function setAlpha(a) { this.alpha = a; }),
        filters: { internal: { addColorMatrix: vi.fn(() => filter), remove: vi.fn() } },
    };
    return {
        images,
        tweens_: tweens,
        timers,
        filter,
        matrix,
        cols: 10,
        rows: 20,
        blockSize: BS,
        hiddenRows: 4,
        gameState: { boardGrid: grid },
        sys: { isActive: () => true },
        cameras: { main: camera },
        textures: { exists: () => true },
        shakeCamera: vi.fn(),
        time: { delayedCall: vi.fn((ms, fn) => { timers.push({ ms, fn }); return { remove() {} }; }) },
        tweens: { add: vi.fn((cfg) => { tweens.push(cfg); return cfg; }), killTweensOf: vi.fn() },
        add: {
            image: vi.fn((x, y, key) => {
                const img = {
                    x, y, key, scale: 1, scaleX: 1, scaleY: 1,
                };
                ['setOrigin', 'setDisplaySize', 'setAlpha', 'setDepth', 'setScrollFactor', 'setBlendMode', 'destroy'].forEach((name) => {
                    img[name] = vi.fn(() => img);
                });
                img.setTint = vi.fn((tint) => { img.tint = tint; return img; });
                images.push(img);
                return img;
            }),
            graphics: vi.fn(() => ({
                setScrollFactor: vi.fn(), setDepth: vi.fn(), clear: vi.fn(), fillStyle: vi.fn(), fillRect: vi.fn(), destroy: vi.fn(),
            })),
            particles: vi.fn(() => ({
                setDepth: vi.fn(), setScrollFactor: vi.fn(), explode: vi.fn(), destroy: vi.fn(),
            })),
        },
    };
}

/** Run every scheduled callback once (fireworks, shards), in order of delay. */
function flushTimers(scene) {
    const pending = scene.timers.splice(0).sort((a, b) => a.ms - b.ms);
    pending.forEach(({ fn }) => fn());
}

describe('knock-out', () => {
    let scene;
    beforeEach(() => { scene = makeScene({ cells: 30 }); });

    it('flares the roof coral and sends a dark tide down the well', () => {
        playKnockoutFx(scene);
        const roof = scene.images.find((img) => img.key === FX.GLOW);
        expect(roof.tint).toBe(TONE.CORAL);
        expect(roof.y).toBe(0);
        const tide = scene.tweens_.find((t) => t.targets && 'h' in t.targets);
        expect(tide.h).toBe(H);
        const seam = scene.images.find((img) => img.key === FX.BAND);
        tide.targets.h = H / 2;
        tide.onUpdate();
        expect(seam.y).toBe(H / 2); // the coral seam rides the tide's edge
    });

    it('drains the board\'s colour with a camera filter and returns it', () => {
        const filter = playKnockoutFx(scene);
        expect(filter).toBe(scene.filter);
        const drain = scene.tweens_.find((t) => t.targets && 't' in t.targets);
        drain.targets.t = 1;
        drain.onUpdate();
        expect(scene.matrix.saturate).toHaveBeenLastCalledWith(-0.92);
        expect(scene.matrix.brightness.mock.lastCall[0]).toBeCloseTo(0.62, 5);
        expect(scene.tweens_.some((t) => t.targets === scene.cameras.main && t.alpha === 0.5)).toBe(true);
    });

    it('breaks pieces off the stack that fall out of the well, in slate', () => {
        playKnockoutFx(scene, { colorOf: () => TONE.CORAL });
        flushTimers(scene);
        const shards = scene.images.filter((img) => img.key === FX.SHARD);
        expect(shards).toHaveLength(30);
        expect(shards.every((s) => s.tint !== TONE.CORAL)).toBe(true); // mixed toward slate
        expect(scene.shakeCamera).toHaveBeenCalled();
    });

    it('under reduced motion: no falling pieces and no shake, but the same darkening', () => {
        const filter = playKnockoutFx(scene, { reduced: true });
        flushTimers(scene);
        expect(scene.images.filter((img) => img.key === FX.SHARD)).toHaveLength(0);
        expect(scene.shakeCamera).not.toHaveBeenCalled();
        expect(filter).toBe(scene.filter);
    });

    it('a new round undoes it: the filter comes off and the board is whole again', () => {
        const filter = playKnockoutFx(scene);
        restoreKnockoutFx(scene, filter);
        expect(scene.tweens.killTweensOf).toHaveBeenCalledWith(scene.cameras.main);
        expect(scene.cameras.main.setAlpha).toHaveBeenLastCalledWith(1);
        expect(scene.cameras.main.filters.internal.remove).toHaveBeenCalledWith(filter);
    });
});

describe('wins', () => {
    it('a round won: light rises from the floor and two fireworks climb and burst', () => {
        const scene = makeScene();
        playRoundWinFx(scene, { color: 0x3b82f6 });
        expect(scene.images.some((img) => img.key === FX.RISE)).toBe(true);
        expect(scene.timers).toHaveLength(2);
        // Each shell climbs as one bright mote (no trail)...
        flushTimers(scene);
        expect(scene.images.filter((img) => img.key === FX.EMBER)).toHaveLength(2);
        expect(scene.add.particles).not.toHaveBeenCalled();
        // ...and bursts at the top of its climb: a flash, a ring, embers.
        flushTimers(scene);
        expect(scene.add.particles).toHaveBeenCalledTimes(2);
        expect(scene.images.filter((img) => img.key === FX.RING)).toHaveLength(2);
        // No full-board fill anywhere.
        expect(scene.add.graphics).not.toHaveBeenCalled();
    });

    it('the match won: a longer light, a halo, and five shells', () => {
        const scene = makeScene();
        playVictoryFx(scene, { color: 0xef4444 });
        expect(scene.images.some((img) => img.key === FX.RISE)).toBe(true);
        const halo = scene.tweens_.find((t) => t.yoyo);
        expect(halo.alpha).toBeLessThan(0.3);
        expect(scene.timers).toHaveLength(5);
    });

    it('under reduced motion the light stays and the fireworks do not', () => {
        const scene = makeScene();
        playVictoryFx(scene, { reduced: true });
        playRoundWinFx(scene, { reduced: true });
        expect(scene.images.filter((img) => img.key === FX.RISE)).toHaveLength(2);
        expect(scene.timers).toHaveLength(0);
    });

    it('does nothing where the scene cannot make the light textures', () => {
        const scene = makeScene();
        scene.textures = { exists: () => false };
        playVictoryFx(scene);
        playRoundWinFx(scene);
        expect(scene.add.image).not.toHaveBeenCalled();
    });
});
