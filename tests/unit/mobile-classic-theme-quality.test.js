import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import AuroraTheme from '../../src/themes/aurora/aurora-theme.js';
import CinderDriftTheme from '../../src/themes/cinder-drift/cinder-drift-theme.js';
import { setGlobalRenderScale } from '../../src/themes/base-theme.js';

vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGLRenderer: class {
            constructor() {
                this.domElement = {};
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
            }
        },
    };
});

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

        expect(preset).toMatchObject({ starCount: 500, curtainLayers: 2, auroraSparks: 800 });
        expect(preset.starCount).toBeLessThan(theme.qualityPresets.High.starCount);
    });

    it('applies the Cinder Drift render budget on creation and orientation change', async () => {
        const container = { innerHTML: '', appendChild: vi.fn() };
        vi.stubGlobal('document', { getElementById: () => container });
        const theme = new CinderDriftTheme();
        for (const method of ['createMagmaBackground', 'createVolumetricSmoke', 'createEmbers',
            'createBurstSystem', 'setupEventListeners', 'animate']) {
            vi.spyOn(theme, method).mockImplementation(() => {});
        }

        await theme.createScene();
        const initialRatio = theme.getEffectivePixelRatio();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(initialRatio);
        expect(initialRatio).toBeLessThan(2);

        setGlobalRenderScale(0.75);
        theme.resize(844, 390);
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(theme.getEffectivePixelRatio());
        expect(theme.renderer.setSize).toHaveBeenLastCalledWith(844, 390);

        setGlobalRenderScale(0.25);
        theme.onWindowResize();
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(theme.getEffectivePixelRatio());
    });
});
