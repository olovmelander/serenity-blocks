/**
 * The three "moment" effects that had no board reaction at all: top-out,
 * incoming garbage, and level up.
 *
 * The level-up assertions exist because of a real bug: alpha was tweened on the
 * same easeOut curve as the position, and easeOut front-loads its change — so the
 * band was down to ~0.10 alpha by the halfway point and invisible for most of its
 * travel. It fired correctly and simply could not be seen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

globalThis.window = globalThis.window || {};
globalThis.window.Phaser = {
    Geom: { Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } } },
    BlendModes: { ADD: 1, NORMAL: 0 },
};

const BS = 40;
const H = 20 * BS;
const W = 10 * BS;

function makeScene() {
    const tweens = [];
    const emitters = [];
    const draws = [];
    return {
        tweens_: tweens,
        emitters,
        draws,
        shakes: [],
        cols: 10,
        rows: 20,
        blockSize: BS,
        hiddenRows: 4,
        gameState: null,
        cameras: { main: { zoom: 1 } },
        textures: { exists: () => true },
        make: { graphics: () => ({ fillStyle: vi.fn(), fillRect: vi.fn(), generateTexture: vi.fn(), destroy: vi.fn() }) },
        getQualityConfig: () => ({ particles: true }),
        getComboTint: () => 0x00ffff,
        shakeCamera(mag, dur) { this.shakes.push({ mag, dur }); },
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn((cfg) => { tweens.push(cfg); return cfg; }) },
        add: {
            graphics: vi.fn(() => ({
                setScrollFactor: vi.fn(), setDepth: vi.fn(), setBlendMode: vi.fn(),
                clear: vi.fn(),
                fillStyle: vi.fn(function fs(color, alpha) { this._c = color; this._a = alpha; }),
                fillRect: vi.fn(function fr(x, y, w, h) {
                    draws.push({ color: this._c, alpha: this._a, x, y, w, h });
                }),
                lineStyle: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
                strokePath: vi.fn(), fillPoints: vi.fn(), strokeCircle: vi.fn(), destroy: vi.fn(),
            })),
            rectangle: vi.fn(() => ({
                setScrollFactor: vi.fn(), setDepth: vi.fn(), setBlendMode: vi.fn(), destroy: vi.fn(),
            })),
            // playPerfectClear also raises a banner; give it what that needs.
            container: vi.fn((x, y) => ({
                x,
                y,
                list: [],
                add(o) { this.list.push(o); return this; },
                addAt(o, i) { this.list.splice(i, 0, o); return this; },
                setDepth: vi.fn(), setScrollFactor: vi.fn(), setScale: vi.fn(),
                setAlpha: vi.fn(), destroy: vi.fn(),
            })),
            text: vi.fn((x, y, str, style) => {
                const size = parseInt(String(style?.fontSize || '16px'), 10);
                return {
                    x, y, text: str, style, width: size * String(str).length * 0.6, height: size * 1.22,
                    setOrigin: vi.fn().mockReturnThis(), setAlpha: vi.fn().mockReturnThis(),
                    setDepth: vi.fn().mockReturnThis(), setScrollFactor: vi.fn().mockReturnThis(),
                    setBlendMode: vi.fn().mockReturnThis(), destroy: vi.fn(),
                };
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
        },
    };
}

/** Drive a progress-driven tween to a point and capture what it drew. */
function sampleAt(scene, tween, t) {
    scene.draws.length = 0;
    if (tween.targets && 't' in tween.targets) tween.targets.t = t;
    else if (tween.targets) Object.assign(tween.targets, { h: t * H });
    tween.onUpdate();
    return scene.draws.slice();
}

describe('playLevelUp', () => {
    let scene;
    let fx;
    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('holds full strength through mid-travel instead of fading out immediately', () => {
        fx.playLevelUp(5);
        const sweep = scene.tweens_.find((t) => t.targets && 't' in t.targets);
        const early = sampleAt(scene, sweep, 0.1);
        const middle = sampleAt(scene, sweep, 0.5);
        const peakAlpha = Math.max(...early.map((d) => d.alpha));
        // The bug: at halfway the band had decayed to a fraction of its peak.
        expect(Math.max(...middle.map((d) => d.alpha))).toBeCloseTo(peakAlpha, 5);
    });

    it('fades only on the way out', () => {
        fx.playLevelUp(5);
        const sweep = scene.tweens_.find((t) => t.targets && 't' in t.targets);
        const mid = Math.max(...sampleAt(scene, sweep, 0.5).map((d) => d.alpha));
        const late = Math.max(...sampleAt(scene, sweep, 0.95).map((d) => d.alpha));
        expect(late).toBeLessThan(mid);
    });

    it('sweeps upward across the whole well', () => {
        fx.playLevelUp(5);
        const sweep = scene.tweens_.find((t) => t.targets && 't' in t.targets);
        const start = sampleAt(scene, sweep, 0)[0].y;
        const end = sampleAt(scene, sweep, 1)[0].y;
        expect(start).toBeGreaterThan(H); // begins below the board
        expect(end).toBeLessThan(0); // exits above it
    });

    it('is visible enough to actually register', () => {
        fx.playLevelUp(5);
        const sweep = scene.tweens_.find((t) => t.targets && 't' in t.targets);
        const peak = Math.max(...sampleAt(scene, sweep, 0.3).map((d) => d.alpha));
        expect(peak).toBeGreaterThan(0.4);
    });
});

describe('playGameOver', () => {
    let scene;
    let fx;
    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('wipes a veil downward over the whole well', () => {
        fx.playGameOver();
        const veil = scene.tweens_.find((t) => t.targets && 'h' in t.targets);
        expect(veil).toBeTruthy();
        expect(veil.h).toBe(H);
        const mid = sampleAt(scene, veil, 0.5);
        expect(mid[0].y).toBe(0); // anchored at the top, growing down
        expect(mid[0].w).toBe(W);
    });

    it('holds the veil rather than fading it — the modal arrives over it', () => {
        fx.playGameOver();
        const veil = scene.tweens_.find((t) => t.targets && 'h' in t.targets);
        expect(veil.alpha).toBeUndefined();
        expect(scene.time.delayedCall).toHaveBeenCalled();
    });

    it('lands heavier than any other beat', () => {
        const overScene = makeScene();
        const over = new SharedEffects(overScene);
        over._reducedMotion = () => false;
        over.playGameOver();

        const pcScene = makeScene();
        const pc = new SharedEffects(pcScene);
        pc._reducedMotion = () => false;
        pc.playPerfectClear(4);

        expect(overScene.shakes[0].mag).toBeGreaterThan(pcScene.shakes[0].mag);
    });

    it('softens under reduced motion', () => {
        const s = makeScene();
        const f = new SharedEffects(s);
        f._reducedMotion = () => true;
        f.playGameOver();
        expect(s.shakes[0].mag).toBeLessThan(7);
    });
});

describe('playGarbageArrival', () => {
    let scene;
    let fx;
    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('anchors the warning rail at the floor, where rows arrive from', () => {
        fx.playGarbageArrival(2);
        const rail = scene.tweens_.find((t) => t.targets && 'height' in t.targets);
        rail.onUpdate();
        const body = scene.draws[0];
        expect(body.y + body.h).toBeCloseTo(H, 0);
    });

    it('scales the rail with the number of rows taken', () => {
        fx.playGarbageArrival(1);
        const one = scene.tweens_.find((t) => t.targets && 'height' in t.targets).targets.height;
        const s4 = makeScene();
        const f4 = new SharedEffects(s4);
        f4._reducedMotion = () => false;
        f4.playGarbageArrival(4);
        const four = s4.tweens_.find((t) => t.targets && 'height' in t.targets).targets.height;
        expect(four).toBeGreaterThan(one);
    });

    it('forces dust upward out of the floor', () => {
        fx.playGarbageArrival(3);
        const dust = scene.emitters[0];
        expect(dust.y).toBe(H);
        expect(dust.config.angle.min).toBeLessThan(0); // upward fan
        expect(dust.config.gravityY).toBeGreaterThan(0); // ...then falls back
    });

    it('clamps absurd row counts', () => {
        expect(() => fx.playGarbageArrival(999)).not.toThrow();
        const rail = scene.tweens_.find((t) => t.targets && 'height' in t.targets);
        expect(rail.targets.height).toBeLessThanOrEqual(BS * 6 * 1.6);
    });
});
