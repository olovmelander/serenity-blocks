import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import ChiralGoldTheme from '../../src/themes/chiral-gold/chiral-gold-theme.js';
import FallTheme from '../../src/themes/fall/fall-theme.js';
import MountainTheme from '../../src/themes/mountain/mountain-theme.js';
import NebulaFlowTheme from '../../src/themes/nebula-flow/nebula-flow-theme.js';
import PyrestormTheme from '../../src/themes/pyrestorm/pyrestorm-theme.js';
import SolarEclipseTheme from '../../src/themes/solar-eclipse/solar-eclipse-theme.js';
import StellarDriftTheme from '../../src/themes/stellar-drift/stellar-drift-theme.js';
import StellarVelocityTheme from '../../src/themes/stellar-velocity/stellar-velocity-theme.js';
import WavesTheme from '../../src/themes/waves/waves-theme.js';
import WinterTheme from '../../src/themes/winter/winter-theme.js';

const themes = [
    ['Chiral Gold', ChiralGoldTheme, 'goldDustCount', 1800, 900],
    ['Solar Eclipse', SolarEclipseTheme, 'starCount', 1500, 800],
    ['Stellar Drift', StellarDriftTheme, 'meteorCount', 100, 50],
    ['Stellar Velocity', StellarVelocityTheme, 'starCount', 1000, 500],
    ['Waves', WavesTheme, 'sprayCount', 300, 150],
];

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
        ['WebGL2', false, 3000], ['native WebGPU', true, 1800],
    ])('maps Winter Minimal to its existing Low budget on %s', (_backend, isWebGPU, snowCount) => {
        window.settings = { effectQuality: 'Minimal' };
        const theme = new WinterTheme();
        theme.isWebGPU = isWebGPU;
        theme.applyQualityPreset(theme.getCurrentQualityLevel());
        expect(theme.currentQuality).toBe('Minimal');
        expect(theme.qualityPreset).toMatchObject({ snowCount, auroraLayers: 1, enablePostProcessing: false });
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

describe.each(themes)('%s canonical phone quality', (_name, Theme, budgetKey, lowBudget, minimalBudget) => {
    it.each(['Low', 'Minimal'])('selects the existing %s budget from the setting written by the UI', (quality) => {
        window.settings = { effectQuality: quality };
        const theme = new Theme();
        theme.applyQualityPreset(theme.getCurrentQualityLevel());

        expect(theme.getCurrentQualityLevel()).toBe(quality);
        expect(theme.qualityPreset[budgetKey]).toBe(quality === 'Low' ? lowBudget : minimalBudget);
        expect(theme.qualityPreset.enablePostProcessing).toBe(false);
        expect(window.settings).toEqual({ effectQuality: quality });
    });

    it('uses the canonical tier when an obsolete alias disagrees', () => {
        window.settings = { effectQuality: ' low ', graphicsQuality: 'Extreme' };
        const theme = new Theme();
        theme.applyQualityPreset(theme.getCurrentQualityLevel());

        expect(theme.getCurrentQualityLevel()).toBe('Low');
        expect(theme.qualityPreset[budgetKey]).toBe(lowBudget);
    });

    it('retains old settings that only supply the legacy alias', () => {
        window.settings = { graphicsQuality: ' minimal ' };
        const theme = new Theme();
        theme.applyQualityPreset(theme.getCurrentQualityLevel());

        expect(theme.getCurrentQualityLevel()).toBe('Minimal');
        expect(theme.qualityPreset[budgetKey]).toBe(minimalBudget);
    });

    it('defaults to High when no quality is stored', () => {
        expect(new Theme().getCurrentQualityLevel()).toBe('High');
    });
});

describe.each([
    ['preset stress', 'runPresetSwitchStress', {
        sequence: ['Low', 'Minimal'], loops: 1, runStressSequence: false, fullRebuild: true,
    }, ['Low', 'Minimal', 'Medium']],
    ['soak', 'runSoakValidation', {
        cycles: 19, presetSequence: ['Low'], fullRebuild: true,
    }, ['Low', 'Medium']],
])('Stellar Velocity %s quality ownership', (_label, method, options, expectedTiers) => {
    it.each([
        ['canonical setting', { effectQuality: 'Medium', graphicsQuality: 'Extreme' }],
        ['legacy setting', { graphicsQuality: 'Medium' }],
        ['explicit undefined setting', { effectQuality: undefined, graphicsQuality: 'Medium' }],
    ])('rebuilds each intended tier and restores the exact %s', async (_settingLabel, settings) => {
        window.settings = { ...settings };
        const theme = new StellarVelocityTheme();
        theme.isActive = true;
        theme.applyQualityPreset(theme.getCurrentQualityLevel());
        const selectedTiers = [];
        vi.spyOn(theme, 'waitForBaseline').mockResolvedValue();
        vi.spyOn(theme, 'createScene').mockImplementation(async () => {
            const quality = theme.getCurrentQualityLevel();
            selectedTiers.push(quality);
            theme.applyQualityPreset(quality);
        });

        await theme[method](options);

        expect(selectedTiers).toEqual(expectedTiers);
        expect(window.settings).toEqual(settings);
        expect(Object.hasOwn(window.settings, 'effectQuality')).toBe(Object.hasOwn(settings, 'effectQuality'));
        expect(theme.getCurrentQualityLevel()).toBe('Medium');
    });

    it('restores the user setting and tier when a rebuild fails', async () => {
        window.settings = { effectQuality: 'Medium', graphicsQuality: 'Extreme' };
        const theme = new StellarVelocityTheme();
        theme.isActive = true;
        theme.applyQualityPreset('Medium');
        vi.spyOn(theme, 'waitForBaseline').mockResolvedValue();
        vi.spyOn(theme, 'createScene')
            .mockRejectedValueOnce(new Error('candidate failed'))
            .mockImplementation(async () => {
                theme.applyQualityPreset(theme.getCurrentQualityLevel());
            });

        await expect(theme[method](options)).rejects.toThrow('candidate failed');

        expect(window.settings).toEqual({ effectQuality: 'Medium', graphicsQuality: 'Extreme' });
        expect(theme.activeQualityLevel).toBe('Medium');
    });
});
