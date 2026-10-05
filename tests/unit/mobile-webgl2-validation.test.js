import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import {
    MOBILE_WEBGL2_SMOKE_IDS, getMobileWebgl2PixelRatioCeiling, installMobileThemeViewportForwarding, mobileWebgl2ExitCode, mobileWebgl2Failures, parseMobileWebgl2Args,
} from '../../scripts/lib/mobile-webgl2-validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function cleanResult(id = 'wolfhour') {
    const state = {
        ready: true, active: true, raster: { uniform: false }, nonFinite: 0, glError: 0,
        visibleContent: true, quality: 'Low', rendererKind: 'WebGPURenderer', backend: 'WebGL2',
        nodeMaterials: 3, livenessRequired: true, heartbeat: 4, pixelRatio: 0.5,
    };
    return {
        id, quality: 'Low', expectedMaxPixelRatio: 0.5, errors: [], warnings: [], requestFailures: [], httpFailures: [],
        portrait: { ...state, viewport: { width: 390, height: 844 }, canvas: { width: 195, height: 422, connected: true } },
        effects: { ...state, viewport: { width: 390, height: 844 }, canvas: { width: 195, height: 422, connected: true } },
        landscape: { ...state, viewport: { width: 844, height: 390 }, canvas: { width: 422, height: 195, connected: true } },
    };
}

describe('mobile WebGL2 validation matrix', () => {
    it('defaults to representative routes at DPR 3 with the actual selected-tier scale', () => {
        const low = parseMobileWebgl2Args([], root, {});
        expect(low.ids).toEqual(MOBILE_WEBGL2_SMOKE_IDS);
        expect(low.dpr).toBe(3);
        expect(low.renderScale).toBe(0.5);
        expect(low.expectedMaxPixelRatio).toBe(0.5);
        expect(parseMobileWebgl2Args(['--quality', 'Minimal'], root, {}).renderScale).toBe(0.4);
        expect(parseMobileWebgl2Args(['--quality', 'Minimal'], root, {}).expectedMaxPixelRatio).toBe(0.45);
        expect(parseMobileWebgl2Args(['--quality', 'High'], root, {}).renderScale).toBe(1);
    });

    it('covers the registry on --all and rejects unknown ids/ambiguous selection', () => {
        expect(parseMobileWebgl2Args(['--all'], root, {}).ids).toEqual(THEME_REGISTRY.map(({ id }) => id));
        expect(parseMobileWebgl2Args(['--theme', 'winter', '--theme=ocean', '--theme', 'winter'], root, {}).ids).toEqual(['winter', 'ocean']);
        expect(() => parseMobileWebgl2Args(['--theme', 'missing'], root, {})).toThrow('Unknown theme');
        expect(() => parseMobileWebgl2Args(['--all', '--theme', 'winter'], root, {})).toThrow('cannot be combined');
    });

    it('rejects invalid profiles and preserves optional local Chromium tooling', () => {
        for (const args of [['--quality', 'Lowest'], ['--dpr', 'NaN'], ['--render-scale', '0.1'], ['--out'], ['--all=false'], ['--unknown']]) {
            expect(() => parseMobileWebgl2Args(args, root, {})).toThrow();
        }
        expect(parseMobileWebgl2Args(['--dpr=2.75', '--render-scale', '0.75'], root, {
            PLAYWRIGHT_EXECUTABLE_PATH: '/tool/chromium', PLAYWRIGHT_CHROMIUM_ARGS: '["--single-process"]',
        })).toMatchObject({ dpr: 2.75, renderScale: 0.75, executable: '/tool/chromium', chromiumArgs: ['--single-process'] });
        expect(() => parseMobileWebgl2Args([], root, { PLAYWRIGHT_CHROMIUM_ARGS: 'oops' })).toThrow('JSON array');
    });

    it('lists the full registry without installed browser tooling or starting Vite', () => {
        const run = spawnSync(process.execPath, ['scripts/validate-mobile-webgl2.mjs', '--all', '--list'], {
            cwd: root, encoding: 'utf8', timeout: 10_000,
            env: { ...process.env, PLAYWRIGHT_MODULE: '/missing/optional-tooling.mjs' },
        });
        expect(run.error).toBeUndefined();
        expect(run.status).toBe(0);
        expect(run.stdout.trim().split('\n')).toEqual(THEME_REGISTRY.map(({ id }) => id));
    });

    it('forwards the shared viewport event to the current active owner like Main and ThemeManager', () => {
        const bus = eventBus;
        const koi = { resize: vi.fn() };
        const ocean = { resize: vi.fn() };
        let activeTheme = koi;
        let viewport = { width: 844, height: 390 };
        const unsubscribe = installMobileThemeViewportForwarding(bus, EVENTS, () => activeTheme, () => viewport);
        // Like Main.handleResize, read the authoritative current dimensions.
        bus.emit(EVENTS.VIEWPORT_RESIZED, { width: 390, height: 844 });
        expect(koi.resize).toHaveBeenCalledExactlyOnceWith(844, 390);
        activeTheme = ocean;
        viewport = { width: 390, height: 844 };
        bus.emit(EVENTS.VIEWPORT_RESIZED, viewport);
        expect(ocean.resize).toHaveBeenCalledExactlyOnceWith(390, 844);
        expect(koi.resize).toHaveBeenCalledTimes(1);
        unsubscribe();
        bus.emit(EVENTS.VIEWPORT_RESIZED, viewport);
        expect(ocean.resize).toHaveBeenCalledTimes(1);
    });
});

describe('mobile WebGL2 acceptance verdict', () => {
    it('accepts live modern artwork with finite event state and effective DPR preserved after rotation', () => {
        expect(mobileWebgl2Failures(cleanResult())).toEqual([]);
    });

    it.each(['wolfhour', 'crystal-cave'])('rejects a nonblank old %s classic scene even with active meshes and no console errors', (id) => {
        const result = cleanResult(id);
        result.portrait.rendererKind = 'WebGLRenderer';
        result.portrait.nodeMaterials = 0;
        expect(mobileWebgl2Failures(result)).toContain('portrait: modern node WebGL2 scene missing.');
    });

    it('rejects ignored quality, stalled frames, non-finite reactions and resized drawing-buffer drift', () => {
        const result = cleanResult();
        result.portrait.quality = 'High';
        result.portrait.heartbeat = 0;
        result.effects.nonFinite = 1;
        result.landscape.canvas.width = 844;
        expect(mobileWebgl2Failures(result)).toEqual(expect.arrayContaining([
            'portrait: requested Low, rendered High.', 'portrait: renderer did not advance.',
            'effects: non-finite geometry or transforms.', 'landscape: drawing buffer did not follow viewport/effective DPR.',
        ]));
    });

    it('rejects a High DPR ceiling on Low even when the drawing buffer follows that wrong ratio', () => {
        const result = cleanResult();
        result.portrait.pixelRatio = 0.63;
        result.portrait.canvas.width = Math.floor(390 * 0.63);
        result.portrait.canvas.height = Math.floor(844 * 0.63);
        expect(mobileWebgl2Failures(result)).toContain("portrait: effective DPR exceeds the selected tier's 0.5 ceiling.");
        result.portrait.pixelRatio = 0.4;
        result.portrait.canvas.width = Math.floor(390 * 0.4);
        result.portrait.canvas.height = Math.floor(844 * 0.4);
        expect(mobileWebgl2Failures(result)).toEqual([]);
    });

    it('preserves Serenity Warp authored intro caps and asserts its actual profile budget', () => {
        const profile = { quality: 'Low', dpr: 3, renderScale: 0.5 };
        expect(getMobileWebgl2PixelRatioCeiling('ocean', profile)).toBe(0.5);
        expect(getMobileWebgl2PixelRatioCeiling('serenity-warp', profile)).toBe(1);
        expect(getMobileWebgl2PixelRatioCeiling('serenity-warp', { ...profile, quality: 'Minimal' })).toBe(1);
        expect(getMobileWebgl2PixelRatioCeiling('serenity-warp', { ...profile, quality: 'Medium' })).toBe(1.12);
        expect(getMobileWebgl2PixelRatioCeiling('serenity-warp', { ...profile, quality: 'Extreme' })).toBe(1.45);
        expect(getMobileWebgl2PixelRatioCeiling('serenity-warp', { ...profile, dpr: 0.75 })).toBe(0.75);
        const result = cleanResult('serenity-warp');
        result.expectedMaxPixelRatio = 1;
        for (const phase of ['portrait', 'effects', 'landscape']) {
            const state = result[phase];
            state.rendererKind = 'WebGLRenderer';
            state.visualProfile = { performanceLevel: 'LOW', authoredPixelRatioCap: 1 };
            state.pixelRatio = 0.75;
            state.canvas.width = Math.floor(state.viewport.width * state.pixelRatio);
            state.canvas.height = Math.floor(state.viewport.height * state.pixelRatio);
        }
        expect(mobileWebgl2Failures(result)).toEqual([]);
        result.effects.visualProfile.performanceLevel = 'HIGH';
        expect(mobileWebgl2Failures(result)).toContain('effects: intro visual quality budget must be LOW.');
    });

    it('rejects uniform frames, unavailable artwork placeholders and failed assets', () => {
        const result = cleanResult();
        result.effects.raster.uniform = true;
        result.portrait.fallbackText = 'Requires WebGPU';
        result.httpFailures.push({ url: '/assets/grove.glb', status: 404 });
        result.requestFailures.push({ url: '/assets/decoder.wasm', failure: 'net::ERR_FAILED' });
        expect(mobileWebgl2Failures(result)).toEqual(expect.arrayContaining([
            'effects: missing or uniform screenshot.', 'portrait: unsupported-backend placeholder.',
            'Asset/module HTTP failures.', 'Failed asset/module requests.',
        ]));
    });

    it('rejects a correct Minimal label if the real preset still allocates High particles/post', () => {
        const result = cleanResult('fall');
        result.quality = 'Minimal';
        for (const key of ['portrait', 'effects', 'landscape']) {
            result[key].quality = 'Minimal';
            result[key].qualityPreset = { leafCount: 2000, treeCount: 55, enablePost: true };
        }
        expect(mobileWebgl2Failures(result)).toContain('portrait: Minimal budget leafCount must be 500.');
        for (const key of ['portrait', 'effects', 'landscape']) result[key].qualityPreset = { leafCount: 500, treeCount: 20, enablePost: false };
        expect(mobileWebgl2Failures(result)).toEqual([]);
    });

    it('does not require a renderer heartbeat from authored DOM artwork', () => {
        const result = cleanResult('cosmic-chimes');
        for (const key of ['portrait', 'effects', 'landscape']) {
            result[key].rendererKind = null;
            result[key].backend = null;
            result[key].livenessRequired = false;
            result[key].heartbeat = 0;
            result[key].canvas = null;
            result[key].pixelRatio = null;
        }
        expect(mobileWebgl2Failures(result)).toEqual([]);
    });

    it('fails the command when any theme fails or the selected matrix is incomplete', () => {
        expect(mobileWebgl2ExitCode([{ status: 'pass' }, { status: 'fail' }], 2)).toBe(1);
        expect(mobileWebgl2ExitCode([{ status: 'pass' }], 2)).toBe(1);
        expect(mobileWebgl2ExitCode([{ status: 'pass' }, { status: 'pass' }], 2)).toBe(0);
    });
});
