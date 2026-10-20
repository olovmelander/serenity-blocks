/**
 * Settings > Visual > Reduce flashing effects (ADR-0021, src/core/photosensitivity.js):
 *
 *   - its own switch, read live from the settings, apart from Reduce motion;
 *   - the board's screen flash becomes a slow, soft glow (shared-effects.js);
 *   - every theme post module scales the frame-wide flash it is handed, and the world and sky
 *     flash sites outside the post stack do too (a fitness check: a new theme cannot forget);
 *   - the setting is persisted, synced to the Steam cloud, and mirrored on <html> for the CSS.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    REDUCED_FLASH_SCALE,
    REDUCE_FLASHING_CLASS,
    applyReduceFlashingClass,
    flashScale,
    prefersReducedFlashing,
} from '../../src/core/photosensitivity.js';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';
import { SettingsManager } from '../../src/ui/settings.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('prefersReducedFlashing / flashScale', () => {
    it('reads the setting it is handed', () => {
        expect(prefersReducedFlashing({ reduceFlashing: true })).toBe(true);
        expect(prefersReducedFlashing({ reduceFlashing: false })).toBe(false);
        expect(prefersReducedFlashing({ reducedMotion: true })).toBe(false);
        expect(prefersReducedFlashing(null)).toBe(false);
        expect(flashScale({ reduceFlashing: true })).toBe(REDUCED_FLASH_SCALE);
        expect(flashScale({ reduceFlashing: false })).toBe(1);
    });

    it('reads the live settings main.js keeps on the window, every frame', () => {
        vi.stubGlobal('window', { settings: { reduceFlashing: true } });
        expect(prefersReducedFlashing()).toBe(true);
        expect(flashScale()).toBe(REDUCED_FLASH_SCALE);
        window.settings.reduceFlashing = false;
        expect(flashScale()).toBe(1);
    });

    it('falls back to the settings manager before window.settings exists, and to off headless', () => {
        vi.stubGlobal('window', { settingsManager: { get: () => ({ reduceFlashing: true }) } });
        expect(prefersReducedFlashing()).toBe(true);
        vi.unstubAllGlobals();
        expect(prefersReducedFlashing()).toBe(false);
        expect(flashScale()).toBe(1);
    });

    it('keeps a frame-wide flash under the luminance step WCAG 2.3.1 counts as a flash', () => {
        expect(REDUCED_FLASH_SCALE).toBeGreaterThan(0);
        expect(REDUCED_FLASH_SCALE).toBeLessThan(0.1);
    });

    it('mirrors the setting on the document root for the stylesheet', () => {
        const classes = new Set();
        const root = {
            classList: {
                toggle(name, force) {
                    if (force) classes.add(name);
                    else classes.delete(name);
                    return force;
                },
            },
        };
        expect(applyReduceFlashingClass(true, root)).toBe(true);
        expect(classes.has(REDUCE_FLASHING_CLASS)).toBe(true);
        expect(applyReduceFlashingClass(false, root)).toBe(false);
        expect(classes.has(REDUCE_FLASHING_CLASS)).toBe(false);
        expect(() => applyReduceFlashingClass(true, null)).not.toThrow();
    });
});

describe('the setting', () => {
    it('is off by default, persisted with the rest, and synced to the Steam cloud', () => {
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
        vi.stubGlobal('window', { localStorage: globalThis.localStorage, addEventListener() {}, matchMedia: () => ({ matches: false }) });
        const settings = new SettingsManager().get();
        expect(settings.reduceFlashing).toBe(false);
        expect(settings.reducedMotion).toBe(false);
        expect(read('src/core/steam/steam-cloud-sync.js')).toMatch(/'reducedMotion',\s*'reduceFlashing',/);
    });
});

describe('the board\'s screen flash', () => {
    function makeScene(settings) {
        const rectangles = [];
        const tweens = [];
        return {
            rectangles,
            tweens_: tweens,
            cols: 10,
            rows: 20,
            blockSize: 40,
            hiddenRows: 4,
            gameState: { settings },
            cameras: { main: { zoom: 1 } },
            textures: { exists: () => true },
            getQualityConfig: () => ({ particles: true }),
            time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
            tweens: { add: vi.fn((cfg) => { tweens.push(cfg); return cfg; }) },
            add: {
                rectangle: vi.fn((x, y, w, h, color, alpha) => {
                    const r = {
                        color, alpha, setScrollFactor: vi.fn(), setDepth: vi.fn(), setBlendMode: vi.fn(), destroy: vi.fn(),
                    };
                    rectangles.push(r);
                    return r;
                }),
            },
        };
    }

    it('is a flat sheet with a hold and a sharp fall when nothing asks otherwise', () => {
        globalThis.window = globalThis.window || {};
        const scene = makeScene({ reduceFlashing: false });
        const fx = new SharedEffects(scene);
        fx._screenFlash(0xffffff, 0.5, 40, 240, 50);
        expect(scene.rectangles[0].alpha).toBe(0.5);
        expect(scene.tweens_[0]).toMatchObject({ delay: 40, duration: 240 });
    });

    it('becomes a slow, soft glow under Reduce flashing: a tenth at most, no hold, a long fall', () => {
        globalThis.window = globalThis.window || {};
        const scene = makeScene({ reduceFlashing: true });
        const fx = new SharedEffects(scene);
        fx._screenFlash(0xffffff, 0.6, 80, 240, 50);
        expect(scene.rectangles[0].alpha).toBeLessThanOrEqual(0.1);
        expect(scene.tweens_[0]).toMatchObject({ delay: 0, duration: 700 });
        fx._screenFlash(0xffffff, 0.2, 80, 900, 50);
        expect(scene.rectangles[1].alpha).toBeCloseTo(0.05, 5);
        expect(scene.tweens_[1]).toMatchObject({ delay: 0, duration: 900 });
    });

    it('is its own switch: Reduce motion alone leaves the flash as it was', () => {
        globalThis.window = globalThis.window || {};
        const scene = makeScene({ reducedMotion: true, reduceFlashing: false });
        const fx = new SharedEffects(scene);
        fx._screenFlash(0xffffff, 0.5, 40, 240, 50);
        expect(scene.rectangles[0].alpha).toBe(0.5);
    });
});

describe('every world that writes a frame-wide flash scales it', () => {
    const themesDir = path.join(ROOT, 'src', 'themes');
    const postModules = readdirSync(themesDir)
        .filter((name) => statSync(path.join(themesDir, name)).isDirectory())
        .flatMap((theme) => readdirSync(path.join(themesDir, theme))
            .filter((file) => file.endsWith('-post.js'))
            .map((file) => `src/themes/${theme}/${file}`));

    it('finds the post stacks', () => {
        expect(postModules.length).toBeGreaterThan(40);
    });

    it.each(postModules)('%s', (file) => {
        const source = read(file);
        if (!/this\.uFlash\.value = /.test(source) && !/const flash = bounded\(frame\.flash\)/.test(source)) return;
        expect(source).toMatch(/flashScale\(\)/);
        expect(source).toContain("core/photosensitivity.js'");
    });

    it.each([
        ['src/themes/crystal-cave/crystal-cave-world.js', /u\.flash\.value = .*flashScale\(\)/],
        ['src/themes/solar-eclipse/solar-eclipse-world.js', /u\.flash\.value = this\.flash \* flashScale\(\)/],
        ['src/themes/starlight/starlight-world.js', /power \* flashScale\(\)/],
        ['src/themes/summer/summer-homestead.js', /this\.uFlash\.value = flashScale\(\) \*/],
        ['src/themes/murmuration/composition/swarm-show.js', /u\.uFlash\.value = this\.skyFlash \* flashScale\(\)/],
        ['src/themes/fluid-dreams/fluid-dreams-world.js', /u\.skyFlash\.value = choreo\.skyFlash \* flashScale\(\)/],
        ['src/themes/chromadelic-highway/chromadelic-highway-world.js', /prefersReducedFlashing\(\) \? 0 :/],
        ['src/themes/voltage-storm/voltage-storm-world.js', /this\.reducedMotion \|\| prefersReducedFlashing\(\)/],
        ['src/themes/rainbow-terraces/rainbow-terraces-world.js', /setReducedMotion\(this\.reduced \|\| prefersReducedFlashing\(\)\)/],
    ])('%s', (file, pattern) => {
        expect(read(file)).toMatch(pattern);
    });
});
