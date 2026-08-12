/**
 * Effect budget by frequency.
 *
 * Local multiplayer runs a different callback set (main.js injects it), and wires
 * NO cascade wave, NO cascade-complete, NO T-spin/B2B, NO perfect clear. Playing
 * the two side by side showed MP reading better — not because it had more, but
 * because it had less: single player stacked five extra layers onto the same
 * clear.
 *
 * The rule these pin: the more often a beat fires, the less it may do. Full-board
 * flourishes (border pulses, screen flashes) are reserved for rare moments.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

globalThis.window = globalThis.window || {};
globalThis.window.Phaser = {
    Geom: { Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } } },
    BlendModes: { ADD: 1, NORMAL: 0 },
};

function makeScene() {
    const base = () => ({
        x: 0, y: 0, scaleX: 1,
        setOrigin: vi.fn().mockReturnThis(), setAlpha: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(), setScrollFactor: vi.fn().mockReturnThis(),
        setBlendMode: vi.fn().mockReturnThis(), setScale: vi.fn().mockReturnThis(),
        setPosition: vi.fn().mockReturnThis(), destroy: vi.fn(),
    });
    const scene = {
        rings: 0,
        edgePulses: 0,
        screenFlashes: 0,
        shakes: [],
        cols: 10,
        rows: 20,
        blockSize: 40,
        hiddenRows: 4,
        gameState: null,
        cameras: { main: { zoom: 1 } },
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: false }),
        getComboTint: () => 0x00ffff,
        shakeCamera(mag, dur) { this.shakes.push({ mag, dur }); },
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn() },
        add: {
            graphics: vi.fn(() => ({
                ...base(),
                clear: vi.fn(), fillStyle: vi.fn(), fillRect: vi.fn(), fillPoints: vi.fn(),
                lineStyle: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
                strokePath: vi.fn(), strokeRect: vi.fn(), strokeCircle: vi.fn(),
            })),
            rectangle: vi.fn(() => base()),
            container: vi.fn((x, y) => ({
                ...base(), x, y, list: [],
                add(o) { this.list.push(o); return this; },
                addAt(o, i) { this.list.splice(i, 0, o); return this; },
            })),
            text: vi.fn((x, y, str, style) => {
                const size = parseInt(String(style?.fontSize || '16px'), 10);
                return { ...base(), x, y, text: str, style, width: size * 3, height: size * 1.22 };
            }),
            particles: vi.fn(() => null),
        },
    };
    return scene;
}

/** Count the full-board flourishes an effect reaches for. */
function instrument(fx, scene) {
    const origEdge = fx._boardEdgePulse.bind(fx);
    fx._boardEdgePulse = (...a) => { scene.edgePulses += 1; return origEdge(...a); };
    const origFlash = fx._screenFlash.bind(fx);
    fx._screenFlash = (...a) => { scene.screenFlashes += 1; return origFlash(...a); };
    const origRing = fx.createShockwaveRing.bind(fx);
    fx.createShockwaveRing = (...a) => { scene.rings += 1; return origRing(...a); };
    return fx;
}

const build = () => {
    const scene = makeScene();
    const fx = new SharedEffects(scene);
    fx._reducedMotion = () => false;
    instrument(fx, scene);
    return { scene, fx };
};

describe('cascade budget', () => {
    it('stays silent on an ordinary 2-chain', () => {
        // The clear itself already brings flash, debris, sparks, shake and popup.
        const { scene, fx } = build();
        fx.showCascadeWave(2);
        expect(scene.rings).toBe(0);
        expect(scene.shakes).toHaveLength(0);
    });

    it('stays silent below 10 — cascade parity with local MP', () => {
        // Local MP wires no cascade flourish at all and the player prefers its
        // read; chains below the mega threshold carry themselves via the clear's
        // own effects and the per-wave combo popup.
        const { scene, fx } = build();
        [3, 5, 9].forEach((n) => fx.showCascadeWave(n));
        expect(scene.rings).toBe(0);
        expect(scene.shakes).toHaveLength(0);
    });

    it('never lights the whole frame for a chain', () => {
        const { scene, fx } = build();
        [3, 5, 9].forEach((n) => fx.showCascadeWave(n));
        expect(scene.edgePulses).toBe(0);
        expect(scene.screenFlashes).toBe(0);
    });

    it('keeps the mega-cascade celebration at 10+', () => {
        const { scene, fx } = build();
        fx.showCascadeWave(12);
        expect(scene.shakes.length).toBeGreaterThan(0);
    });
});

describe('skill beats keep their mark, not the whole frame', () => {
    it('T-spin keeps banner and ring, drops the border pulse and screen flash', () => {
        const { scene, fx } = build();
        fx.playTSpinEffect(2);
        expect(scene.rings).toBe(1);
        expect(scene.edgePulses).toBe(0);
        expect(scene.screenFlashes).toBe(0);
    });

    it('back-to-back is carried by its banner alone', () => {
        const { scene, fx } = build();
        fx.playB2BChange(true);
        expect(scene.edgePulses).toBe(0);
        expect(scene.screenFlashes).toBe(0);
    });
});

describe('rare moments keep their full weight', () => {
    it('perfect clear still gets the supernova', () => {
        const { scene, fx } = build();
        fx.playPerfectClear(4);
        expect(scene.screenFlashes).toBe(1);
        expect(scene.rings).toBeGreaterThan(1);
    });

    it('top-out still lights the frame', () => {
        const { scene, fx } = build();
        fx.playGameOver();
        expect(scene.screenFlashes).toBe(1);
        expect(scene.edgePulses).toBe(1);
    });

    it('a quad still blows out the playfield — shared with local MP, not an extra', () => {
        const { scene, fx } = build();
        fx.triggerLineClearFlash([20, 21, 22, 23]);
        expect(scene.screenFlashes).toBe(1);
    });

    it('a single-line clear does not', () => {
        const { scene, fx } = build();
        fx.triggerLineClearFlash([23]);
        expect(scene.screenFlashes).toBe(0);
    });
});
