import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import FallTheme from '../../src/themes/fall/fall-theme.js';

// Stellar Velocity, Solar Eclipse and then Nebula Flow left the per-theme preset table with their
// rebuilds: none has a preset table of its own any more (their tiers are <id>-quality.js, pinned in
// the <id>-core/-world tests and, for the tier a setting selects, tests/unit/<id>-theme.test.js).
// Nebula Flow's old fluid budgets (SIM/DYE resolution, pressure iterations, quality multiplier) went
// with the raw WebGL simulator they configured. Mountain's DOM particle and lightning budgets went
// with the theme when High Coast replaced it (2026-10-13). Pyrestorm left it too with its rebuild
// (2026-10-13): its ember, ash and bloom budgets went with the classic GLSL scene they configured.

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
    it('maps Fall Minimal to its existing Low artwork budget', () => {
        window.settings = { effectQuality: 'Minimal' };
        const theme = new FallTheme();
        theme.applyQualityPreset(theme.getCurrentQualityLevel());
        expect(theme.qualityPreset).toMatchObject({ leafCount: 500, treeCount: 20, enablePost: false });
    });
});
