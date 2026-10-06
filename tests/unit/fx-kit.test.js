/**
 * The board effects kit (src/rendering/phaser/fx/fx-kit.js).
 *
 * The light blend is pinned because of a real defect: Phaser's ADD is
 * [ONE, DST_ALPHA], additive only on an opaque canvas. The board canvas is
 * transparent, so every light laid over another light darkened it across its
 * whole quad — dark bands beside a clear's blade, a dark square behind a ring.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    FX, TONE, addLight, ensureFxTextures, lightBlend, mixColor, toColorInt, toneCss,
} from '../../src/rendering/phaser/fx/fx-kit.js';

const GL = { ONE: 1, FUNC_ADD: 0x8006 };

/** A renderer whose addBlendMode behaves like Phaser 4.2's (returns the previous index). */
function makeRenderer() {
    const blendModes = Array.from({ length: 28 }, () => ({ func: [1, 0x0303, 1, 0x0303] }));
    return {
        gl: GL,
        blendModes,
        addBlendMode: vi.fn((func, equation) => {
            const index = blendModes.push({ func: [func[0], func[1], func[0], func[1]], equation: [equation, equation] }) - 1;
            return index - 1;
        }),
    };
}

function makeImage() {
    const img = { width: 64, height: 64 };
    ['setOrigin', 'setDisplaySize', 'setTint', 'setAlpha', 'setDepth', 'setScrollFactor', 'setBlendMode'].forEach((name) => {
        img[name] = vi.fn(() => img);
    });
    return img;
}

describe('lightBlend', () => {
    afterEach(() => { delete globalThis.window; });

    it('registers a true additive blend, [ONE, ONE], and returns its real index', () => {
        const renderer = makeRenderer();
        const mode = lightBlend({ sys: { renderer } });
        expect(mode).toBe(28); // the new mode, not the 27 Phaser 4.2 hands back
        expect(renderer.blendModes[mode].func).toEqual([GL.ONE, GL.ONE, GL.ONE, GL.ONE]);
        expect(renderer.blendModes[mode].equation).toEqual([GL.FUNC_ADD, GL.FUNC_ADD]);
    });

    it('registers once per renderer and is shared by every scene on it', () => {
        const renderer = makeRenderer();
        const a = lightBlend({ sys: { renderer } });
        const b = lightBlend({ game: { renderer } });
        expect(a).toBe(b);
        expect(renderer.addBlendMode).toHaveBeenCalledTimes(1);

        const other = makeRenderer();
        lightBlend({ sys: { renderer: other } });
        expect(other.addBlendMode).toHaveBeenCalledTimes(1);
    });

    it('falls back to Phaser\'s ADD without a WebGL renderer', () => {
        globalThis.window = { Phaser: { BlendModes: { ADD: 1 } } };
        expect(lightBlend({ sys: { renderer: { blendModes: [] } } })).toBe(1);
        expect(lightBlend(null)).toBe(1);
        delete globalThis.window;
        expect(lightBlend({})).toBe('ADD');
    });
});

describe('addLight', () => {
    it('draws a tinted additive light in screen space by default', () => {
        const renderer = makeRenderer();
        const img = makeImage();
        const scene = {
            sys: { renderer },
            textures: { exists: () => true },
            add: { image: vi.fn(() => img) },
        };
        const light = addLight(scene, FX.GLOW, 10, 20, {
            tint: TONE.GOLD, width: 100, height: 50, alpha: 0.5,
        });
        expect(light).toBe(img);
        expect(img.setTint).toHaveBeenCalledWith(TONE.GOLD);
        expect(img.setDisplaySize).toHaveBeenCalledWith(100, 50);
        expect(img.setAlpha).toHaveBeenCalledWith(0.5);
        expect(img.setScrollFactor).toHaveBeenCalledWith(0);
        expect(img.setBlendMode).toHaveBeenCalledWith(lightBlend(scene));
    });

    it('can draw in normal blend (a scrim) and in Infinity\'s world space', () => {
        const img = makeImage();
        const scene = { textures: { exists: () => true }, add: { image: () => img } };
        addLight(scene, FX.GLOW, 0, 0, { normal: true, scroll: 1 });
        expect(img.setBlendMode).toHaveBeenCalledWith(0);
        expect(img.setScrollFactor).toHaveBeenCalledWith(1);
    });

    it('returns null when the scene cannot draw images or lacks the texture', () => {
        expect(addLight({ textures: { exists: () => true }, add: {} }, FX.GLOW, 0, 0)).toBeNull();
        expect(addLight({ textures: { exists: () => false }, add: { image: makeImage } }, FX.GLOW, 0, 0)).toBeNull();
    });
});

describe('ensureFxTextures', () => {
    it('is false when the scene cannot make canvas textures', () => {
        expect(ensureFxTextures({ textures: { exists: () => false } })).toBe(false);
        expect(ensureFxTextures(null)).toBe(false);
    });

    it('paints every texture once', () => {
        const made = new Map();
        const ctx = new Proxy({}, {
            get: (target, prop) => (prop === 'createImageData'
                ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
                : (prop === 'createRadialGradient' || prop === 'createLinearGradient'
                    ? () => ({ addColorStop: () => {} })
                    : () => {})),
            set: () => true,
        });
        const textures = {
            exists: (key) => made.has(key),
            createCanvas: vi.fn((key) => {
                made.set(key, true);
                return { getContext: () => ctx, refresh: () => {} };
            }),
        };
        expect(ensureFxTextures({ textures })).toBe(true);
        expect([...made.keys()].sort()).toEqual(Object.values(FX).sort());
        textures.createCanvas.mockClear();
        expect(ensureFxTextures({ textures })).toBe(true);
        expect(textures.createCanvas).not.toHaveBeenCalled();
    });
});

describe('colour helpers', () => {
    it('mixes, parses and prints tones', () => {
        expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
        expect(mixColor(TONE.CREAM, TONE.GOLD, 0)).toBe(TONE.CREAM);
        expect(mixColor(TONE.CREAM, TONE.GOLD, 2)).toBe(TONE.GOLD);
        expect(toColorInt('#3B82F6')).toBe(0x3b82f6);
        expect(toColorInt(0x123456)).toBe(0x123456);
        expect(toColorInt('nope', TONE.AQUA)).toBe(TONE.AQUA);
        expect(toneCss(TONE.CORAL)).toBe('#ffac88');
        expect(toneCss(0x0000ff)).toBe('#0000ff');
    });
});
