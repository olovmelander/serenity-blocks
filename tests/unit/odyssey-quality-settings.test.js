// The map follows the graphics settings as the themes do (perf audit 2026-10-28, "graphics
// settings never reach the map"). The board read the quality tier once and nothing else: the
// Render Scale slider and the Anti-aliasing switch never reached it, and a board kept alive
// across orbs kept its first tier all session. With the settings at their defaults (render
// scale 1, antialiasing on) everything comes out as it did.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import {
    qualityRebuildReason, readOdysseyQualityProfile, readOdysseySettings,
} from '../../src/rendering/odyssey/odyssey-quality-profile.js';
import { setGlobalAntialias, setGlobalRenderScale } from '../../src/themes/base-theme.js';
import { computeScenePixelRatio } from '../../src/utils/desktop-performance-policy.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (file) => readFileSync(path.resolve(here, '../../src', file), 'utf8');

function stubWindow(settings = {}, extra = {}) {
    const listeners = new Map();
    vi.stubGlobal('window', {
        settings,
        location: { search: '' },
        devicePixelRatio: 2,
        innerWidth: 1600,
        innerHeight: 900,
        addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
        removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)),
        dispatchEvent: vi.fn(),
        ...extra,
    });
    return listeners;
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    setGlobalRenderScale(1);
    setGlobalAntialias(true);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the map reads its graphics settings as the themes read theirs', () => {
    it('defaults: High, render scale 1, antialiasing on, 4x MSAA in the scene pass', () => {
        stubWindow({});
        expect(readOdysseyQualityProfile()).toEqual({
            tier: 'High', renderScale: 1, antialias: true, sceneSamples: 4,
        });
    });

    it('takes the tier from the settings, the scale and antialiasing from the globals main.js keeps', () => {
        stubWindow({ effectQuality: 'Low' });
        setGlobalRenderScale(0.8);
        setGlobalAntialias(false);
        expect(readOdysseyQualityProfile()).toEqual({
            tier: 'Low', renderScale: 0.8, antialias: false, sceneSamples: 0,
        });
        setGlobalAntialias(true);
        expect(readOdysseyQualityProfile().sceneSamples).toBe(0); // no MSAA below High anyway
        stubWindow({ effectQuality: 'Extreme' });
        expect(readOdysseyQualityProfile().sceneSamples).toBe(4);
    });

    it('prefers the settings manager over a window.settings that update() has not re-pointed yet', () => {
        stubWindow({ effectQuality: 'High', targetFrameRate: 60 }, {
            serenityBlocks: { settingsManager: { get: () => ({ effectQuality: 'Medium' }) } },
        });
        expect(readOdysseySettings()).toMatchObject({ effectQuality: 'Medium', targetFrameRate: 60 });
        expect(readOdysseyQualityProfile().tier).toBe('Medium');
    });

    it('knows which changes only a new build shows', () => {
        const at = (effectQuality, more = {}) => readOdysseyQualityProfile({ settings: { effectQuality }, ...more });
        const built = at('High', { renderScale: 1, antialias: true });
        const same = { ...built, renderScale: 0.8 }; // the scale applies live
        expect(qualityRebuildReason(built, same)).toBeNull();
        expect(qualityRebuildReason(built, at('Medium'))).toBe('tier');
        expect(qualityRebuildReason(built, at('High', { antialias: false }))).toBe('antialiasing');
        const low = readOdysseyQualityProfile({ settings: { effectQuality: 'Low' }, antialias: true });
        expect(qualityRebuildReason(low, { ...low, antialias: false })).toBeNull(); // no MSAA at Low either way
    });
});

describe('the board', () => {
    function board() {
        const b = new OdysseyBoardController({ clientWidth: 1600, clientHeight: 900 });
        b.qualityName = 'High';
        return b;
    }

    it('renders at the player\'s render scale times its own DRS, and exactly as before at scale 1', () => {
        stubWindow({});
        const b = board();
        const before = computeScenePixelRatio({
            renderScale: 1, devicePixelRatio: 2, maxPixelRatio: 1.5, sceneType: 'odyssey', qualityTier: 'High',
        });
        expect(b._scenePixelRatio(1)).toBe(before);
        setGlobalRenderScale(0.8);
        expect(b._scenePixelRatio(1)).toBe(Number((before * 0.8).toFixed(2)));
        expect(b._scenePixelRatio(0.75)).toBe(Number((before * 0.6).toFixed(2)));
    });

    it('sharpens only what its DRS drops, never the player\'s own scale', () => {
        stubWindow({});
        setGlobalRenderScale(0.8);
        const b = board();
        let pixelRatio = b._scenePixelRatio(1);
        b.renderer = { getPixelRatio: () => pixelRatio };
        b.postProcessingStack = { setRenderScale: vi.fn() };
        b._syncOutputSharpen();
        expect(b.postProcessingStack.setRenderScale).toHaveBeenLastCalledWith(1);
        pixelRatio = b._scenePixelRatio(0.75);
        b._syncOutputSharpen();
        expect(b.postProcessingStack.setRenderScale.mock.calls.at(-1)[0]).toBeCloseTo(0.75, 1);
    });

    it('raises its DRS floor where the player\'s scale leaves no room under it', () => {
        stubWindow({});
        const b = board();
        expect(b._resolutionFloor()).toBe(0.65);
        setGlobalRenderScale(0.65);
        expect(b._resolutionFloor()).toBeCloseTo(0.5 / 0.65, 6);
        setGlobalRenderScale(0.5);
        expect(b._resolutionFloor()).toBe(1);
        b._syncResolutionFloor();
        expect(b.adaptiveQuality.resolutionFloor).toBe(1);
    });

    it('follows a settings change a microtask later: resizes for a new scale, re-reads the frame budget', async () => {
        const listeners = stubWindow({ targetFrameRate: 60 });
        const b = board();
        b._listenForQualitySettings();
        let pixelRatio = b._scenePixelRatio();
        b.renderer = { getPixelRatio: () => pixelRatio, dispose: vi.fn() };
        b.onResize = vi.fn(() => { pixelRatio = b._scenePixelRatio(); });
        b._readFrameRateTargets = vi.fn();

        listeners.get('settingsChanged').forEach((fn) => fn({ detail: { targetFrameRate: 30 } }));
        await Promise.resolve();
        expect(b._readFrameRateTargets).toHaveBeenCalledTimes(1);
        expect(b.onResize).not.toHaveBeenCalled(); // nothing about the picture changed

        setGlobalRenderScale(0.8); // main.js applies the slider...
        listeners.get('settingsChanged').forEach((fn) => fn({ detail: { renderScale: 0.8 } }));
        listeners.get('desktopPerformancePolicyChanged').forEach((fn) => fn({ detail: {} }));
        await Promise.resolve();
        expect(b.onResize).toHaveBeenCalledTimes(1); // ...once, however many events said so

        b.dispose();
        expect(listeners.get('settingsChanged')).toHaveLength(0);
    });

    it('says when the settings ask for a board other than the one it built', () => {
        stubWindow({ effectQuality: 'High' });
        const b = board();
        b._builtQuality = readOdysseyQualityProfile();
        expect(b.needsQualityRebuild()).toBeNull();
        setGlobalRenderScale(0.8);
        expect(b.needsQualityRebuild()).toBeNull();
        setGlobalAntialias(false);
        expect(b.needsQualityRebuild()).toBe('antialiasing');
        setGlobalAntialias(true);
        window.settings.effectQuality = 'Low';
        expect(b.needsQualityRebuild()).toBe('tier');
    });

    it('builds its scene pass with the samples the settings give (4 at High with antialiasing on)', () => {
        const src = read('rendering/odyssey/OdysseyBoardController.js');
        expect(src).toMatch(/sceneSamples: this\._builtQuality\?\.sceneSamples/);
        expect(src).toMatch(/this\._builtQuality = readOdysseyQualityProfile\(\);/);
        // The early world bake reads the tier the same way, so the two ask for the same bake.
        expect(src).toMatch(/readWorldBuildOptions\(readOdysseyQualityProfile\(\)\.tier\)/);
    });
});

describe('the return to the map rebuilds a board the settings no longer match', () => {
    it('under the shut gate, before the map is shown, framed on the orb just played', () => {
        const src = read('ui/odyssey/odyssey-world-return.js');
        const check = src.indexOf('mode.boardController?.needsQualityRebuild?.()');
        const dispose = src.indexOf('if (rebuild) mode._disposeOdysseyBoard();');
        const shown = src.indexOf('const shown = await mode._showBoardView(');
        const stop = src.indexOf('await mode.onStop(options);');
        expect(stop).toBeGreaterThan(-1);
        expect(check).toBeGreaterThan(stop);
        expect(dispose).toBeGreaterThan(check);
        expect(shown).toBeGreaterThan(dispose);
        expect(src.slice(shown, shown + 400))
            .toContain('...(rebuild && !options.settlePath ? { seatOnFocus: true } : {})');
    });
});
