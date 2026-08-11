/**
 * Shared banner: snap → hold → release.
 *
 * The combo popup was rebuilt on this timeline while T-spin, back-to-back, mega
 * cascade and perfect clear were left fading from frame one — which left the
 * game's biggest moment (perfect clear) with a weaker banner than a 2x combo.
 * These pin the shared shape and the layout lanes that keep them off each other.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

globalThis.window = globalThis.window || {};
globalThis.window.Phaser = { BlendModes: { ADD: 1, NORMAL: 0 } };

function makeScene() {
    const tweens = [];
    const texts = [];
    const containers = [];
    const base = () => ({
        x: 0,
        y: 0,
        setOrigin: vi.fn().mockReturnThis(),
        setAlpha: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setScrollFactor: vi.fn().mockReturnThis(),
        setBlendMode: vi.fn().mockReturnThis(),
        setScale: vi.fn().mockReturnThis(),
        setPosition: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
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
        cameras: { main: { zoom: 1 } },
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: false }),
        getComboTint: () => 0x00ffff,
        shakeCamera: vi.fn(),
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn((cfg) => { tweens.push(cfg); return cfg; }) },
        add: {
            container: vi.fn((x, y) => {
                const c = { ...base(), x, y, list: [], type: 'Container', add(o) { this.list.push(o); return this; }, addAt(o, i) { this.list.splice(i, 0, o); return this; } };
                containers.push(c);
                return c;
            }),
            text: vi.fn((x, y, str, style) => {
                const size = parseInt(String(style?.fontSize || '16px'), 10);
                const t = { ...base(), x, y, text: str, style, type: 'Text', width: size * String(str).length * 0.6, height: size * 1.22 };
                texts.push(t);
                return t;
            }),
            graphics: vi.fn(() => ({
                ...base(), scaleX: 1, type: 'Graphics',
                fillStyle: vi.fn(), fillPoints: vi.fn(), lineStyle: vi.fn(),
                beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), strokePath: vi.fn(),
                clear: vi.fn(), fillRect: vi.fn(), strokeCircle: vi.fn(),
            })),
            rectangle: vi.fn(() => base()),
            particles: vi.fn(() => null),
        },
    };
}

/** The tween that releases a banner is the one fading it out. */
const exitOf = (scene) => scene.tweens_.find((t) => t.alpha === 0 && t.scale === 0.9);

describe('_showBanner', () => {
    let scene;
    let fx;

    beforeEach(() => {
        scene = makeScene();
        fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
    });

    it('holds at full alpha before releasing', () => {
        fx._showBanner({ title: 'TEST', y: 100, hold: 300 });
        const exit = exitOf(scene);
        expect(exit.delay).toBe(50 + 60 + 300); // snap + settle + hold
        expect(exit.ease).toBe('Quint.easeIn');
    });

    it('snaps in with overshoot and settles', () => {
        fx._showBanner({ title: 'TEST', y: 100 });
        const snap = scene.tweens_.find((t) => t.ease === 'Back.easeOut');
        expect(snap.scale).toBeGreaterThan(1);
        expect(scene.tweens_.some((t) => t.scale === 1 && t.delay === 50)).toBe(true);
    });

    it('drops the overshoot under reduced motion', () => {
        fx._reducedMotion = () => true;
        fx._showBanner({ title: 'TEST', y: 100 });
        expect(scene.tweens_.find((t) => t.ease === 'Back.easeOut').scale).toBe(1);
    });

    it('renders a lead, title and subtitle as separate sized layers', () => {
        fx._showBanner({
            lead: '14', title: 'CASCADE', subtitle: 'DEEP', y: 100, leadSize: 74, titleSize: 24, subtitleSize: 18,
        });
        const size = (t) => parseInt(String(t.style.fontSize), 10);
        const lead = scene.texts.find((t) => t.text === '14');
        const title = scene.texts.find((t) => t.text === 'CASCADE');
        const sub = scene.texts.find((t) => t.text === 'DEEP');
        expect(size(lead)).toBeGreaterThan(size(title));
        expect(size(title)).toBeGreaterThan(size(sub));
    });

    it('stacks the caption and subtitle below the band without overlapping', () => {
        fx._showBanner({ lead: '9', title: 'CASCADE', subtitle: 'DEEP', y: 100 });
        const title = scene.texts.find((t) => t.text === 'CASCADE');
        const sub = scene.texts.find((t) => t.text === 'DEEP');
        expect(sub.y).toBeGreaterThan(title.y);
    });

    it('falls back to a plain label without container support', () => {
        scene.add.container = undefined;
        expect(() => fx._showBanner({ title: 'TEST', y: 100 })).not.toThrow();
        expect(scene.texts).toHaveLength(1);
    });
});

describe('banner layout lanes', () => {
    const H = 20 * 40;

    /** Vertical anchor each banner asks for. */
    const anchorFor = (fn) => {
        const scene = makeScene();
        const fx = new SharedEffects(scene);
        fx._reducedMotion = () => false;
        fn(fx);
        return scene.containers[0].y;
    };

    it('gives every banner its own lane', () => {
        const lanes = {
            b2b: anchorFor((fx) => fx.playB2BChange(true)),
            tspin: anchorFor((fx) => fx.playTSpinEffect(2)),
            perfect: anchorFor((fx) => fx.playPerfectClear(4)),
            cascade: anchorFor((fx) => fx.showMegaCascadeEffect(14)),
        };
        // A deep cascade can end in a perfect clear; both used to sit at centre
        // and drew exactly on top of each other.
        expect(lanes.perfect).not.toBe(lanes.cascade);
        expect(new Set(Object.values(lanes)).size).toBe(4);
    });

    it('orders them top-down: back-to-back, T-spin, perfect clear, cascade', () => {
        expect(anchorFor((fx) => fx.playB2BChange(true))).toBeCloseTo(H * 0.18, 0);
        expect(anchorFor((fx) => fx.playTSpinEffect(2))).toBeCloseTo(H * 0.375, 0);
        expect(anchorFor((fx) => fx.playPerfectClear(4))).toBeCloseTo(H * 0.5, 0);
        expect(anchorFor((fx) => fx.showMegaCascadeEffect(14))).toBeCloseTo(H * 0.62, 0);
    });

    it('holds the perfect clear longest — it is the flagship moment', () => {
        const holdOf = (fn) => {
            const scene = makeScene();
            const fx = new SharedEffects(scene);
            fx._reducedMotion = () => false;
            fn(fx);
            return exitOf(scene).delay;
        };
        const perfect = holdOf((fx) => fx.playPerfectClear(4));
        expect(perfect).toBeGreaterThan(holdOf((fx) => fx.playB2BChange(true)));
        expect(perfect).toBeGreaterThan(holdOf((fx) => fx.playTSpinEffect(2)));
        expect(perfect).toBeGreaterThan(holdOf((fx) => fx.showMegaCascadeEffect(14)));
    });
});
