import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import AuroraTheme from '../../src/themes/aurora/aurora-theme.js';
import { setGlobalRenderScale } from '../../src/themes/base-theme.js';

describe('mobile quality for classic renderer themes', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            settings: { effectQuality: 'Minimal' },
            devicePixelRatio: 3,
            innerWidth: 390,
            innerHeight: 844,
            addEventListener: vi.fn(),
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        setGlobalRenderScale(0.5);
    });
    afterEach(() => {
        setGlobalRenderScale(1);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each(['Minimal', 'Minimum', ' minimal '])('uses the cheapest Aurora preset for %s', (quality) => {
        window.settings.effectQuality = quality;
        const theme = new AuroraTheme();
        const preset = theme.qualityPresets[theme.getGraphicsQuality()];

        // Aurora renders through the node pipeline now; the legacy label must still
        // land on its cheapest tier: no mirror pass, no post chain, the smallest march.
        expect(preset).toBe(theme.qualityPresets.Minimal);
        expect(preset).toMatchObject({ arcCount: 2, mirrorScale: 0, enablePost: false });
        expect(preset.starCount).toBeLessThan(theme.qualityPresets.High.starCount);
    });
});
