import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BaseTheme, setGlobalRenderScale } from '../../src/themes/base-theme.js';
import { setActiveDesktopPerformancePolicy } from '../../src/utils/desktop-performance-policy.js';

describe('theme pixel ratio with phone settings', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { devicePixelRatio: 3, settings: { effectQuality: 'Low' } });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        setActiveDesktopPerformancePolicy(null);
        setGlobalRenderScale(0.5);
    });

    afterEach(() => {
        setGlobalRenderScale(1);
        setActiveDesktopPerformancePolicy(null);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each([
        ['Minimal', 0.45], ['Low', 0.5], ['Medium', 0.57],
        ['High', 0.63], ['Ultra', 0.68], ['Extreme', 0.75],
    ])('uses the selected %s scene cap on a DPR 3 phone', (quality, expected) => {
        window.settings.effectQuality = quality;
        expect(BaseTheme.getEffectivePixelRatio()).toBe(expected);
    });

    it('uses canonical settings ahead of a stale legacy High setting', () => {
        window.settings = { effectQuality: ' minimal ', graphicsQuality: 'High' };
        expect(BaseTheme.getEffectivePixelRatio()).toBe(0.45);
    });

    it('retains legacy settings and the default when canonical settings are absent', () => {
        window.settings = { graphicsQuality: 'Low' };
        expect(BaseTheme.getEffectivePixelRatio()).toBe(0.5);
        delete window.settings;
        expect(BaseTheme.getEffectivePixelRatio()).toBe(0.63);
    });

    it('keeps packaged desktop policy caps authoritative', () => {
        setActiveDesktopPerformancePolicy({ pixelRatioCaps: { theme: 1.4, odyssey: 1.3 } });
        expect(BaseTheme.getEffectivePixelRatio()).toBe(0.7);
        expect(BaseTheme.getEffectivePixelRatio(2, 'odyssey')).toBe(0.65);
    });

    it('retains hardware/max caps and recomputes the render scale on resize', () => {
        window.devicePixelRatio = 1;
        expect(BaseTheme.getEffectivePixelRatio(0.8)).toBe(0.4);
        setGlobalRenderScale(0.75);
        expect(BaseTheme.getEffectivePixelRatio(0.8)).toBe(0.6);
        window.devicePixelRatio = 3;
        window.settings.effectQuality = 'Minimal';
        expect(BaseTheme.getEffectivePixelRatio()).toBe(0.68);
    });
});
