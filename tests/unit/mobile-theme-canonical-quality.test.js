import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import FallTheme from '../../src/themes/fall/fall-theme.js';
import MountainTheme from '../../src/themes/mountain/mountain-theme.js';
import NebulaFlowTheme from '../../src/themes/nebula-flow/nebula-flow-theme.js';
import PyrestormTheme from '../../src/themes/pyrestorm/pyrestorm-theme.js';

// Stellar Velocity and then Solar Eclipse left the per-theme preset table with their rebuilds:
// neither has a preset table of its own any more (their tiers are <id>-quality.js, pinned in
// tests/unit/<id>-core.test.js and, for the tier a setting selects, tests/unit/<id>-theme.test.js).

beforeEach(() => {
    vi.stubGlobal('window', {
        settings: {},
        location: { search: '?forceWebGL=1' },
        devicePixelRatio: 3,
        innerWidth: 390,
        innerHeight: 844,
    });
    vi.stubGlobal('navigator', {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('canonical tiers with existing narrower preset tables', () => {
    it.each(['Minimal', 'Minimum', ' minimal ', ' minimum '])('uses Pyrestorm\'s cheapest preset for %s', (quality) => {
        window.settings = { effectQuality: quality };
        const theme = new PyrestormTheme();
        theme.applyQualityPreset(theme.getCurrentQualityLevel());

        expect(theme.qualityPreset).toMatchObject({ emberCount: 1000, ashCount: 200, enableBloom: false });
    });

    it('maps Fall Minimal to its existing Low artwork budget', () => {
        window.settings = { effectQuality: 'Minimal' };
        const theme = new FallTheme();
        theme.applyQualityPreset(theme.getCurrentQualityLevel());
        expect(theme.qualityPreset).toMatchObject({ leafCount: 500, treeCount: 20, enablePost: false });
    });

    it.each([
        ['Minimal', 128, 512, 10, 0.4],
        ['Low', 128, 512, 10, 0.4],
        ['Medium', 192, 768, 15, 0.65],
        ['High', 256, 1024, 20, 0.85],
        ['Ultra', 256, 1024, 20, 0.85],
        ['Extreme', 320, 1280, 25, 1],
    ])('maps Nebula Flow %s without falling back to an unrelated budget', (quality, simResolution, dyeResolution, pressureIterations, multiplier) => {
        window.settings = { effectQuality: ` ${quality} ` };
        const theme = new NebulaFlowTheme();
        const config = theme.getConfig(theme.getQualitySetting());

        expect(config).toMatchObject({
            SIM_RESOLUTION: simResolution, DYE_RESOLUTION: dyeResolution, PRESSURE_ITERATIONS: pressureIterations,
        });
        expect(theme.currentQualityMultiplier).toBe(multiplier);
    });

    it.each([
        ['Minimal', 5, false], ['Low', 5, false], ['Medium', 15, false],
        ['High', 30, true], ['Ultra', 50, true], ['Extreme', 50, true],
    ])('maps Mountain %s from the canonical UI setting', (quality, maxParticles, enableLightning) => {
        window.settings = { effectQuality: ` ${quality} `, visualQuality: 'High' };
        const theme = new MountainTheme();
        theme.updateQualityPreset();

        expect(theme.qualityPreset).toMatchObject({ maxParticles, enableLightning });
    });

    it('retains Mountain\'s historical visualQuality setting', () => {
        window.settings = { visualQuality: 'Low' };
        const theme = new MountainTheme();
        theme.updateQualityPreset();
        expect(theme.qualityPreset.maxParticles).toBe(5);
    });
});
