import { describe, expect, it } from 'vitest';

import {
    getKoiPondRendererSampleCount,
    resolveKoiPondRefractionDepthMode,
} from '../../src/themes/koi-pond/rendering/koi-pond-water.js';

describe('Koi Pond refraction depth policy', () => {
    it('uses viewport depth only for single-sample WebGPU rendering', () => {
        expect(resolveKoiPondRefractionDepthMode({
            refraction: true,
            isWebGPU: true,
            samples: 0,
        })).toBe('viewport');
        expect(resolveKoiPondRefractionDepthMode({
            refraction: true,
            isWebGPU: true,
            samples: 1,
        })).toBe('viewport');
    });

    it('avoids Three r181 viewport-depth copies when WebGPU MSAA is active', () => {
        const samples = getKoiPondRendererSampleCount({
            samples: 4,
            // r181 reports zero here while preparing its color-space output RT.
            currentSamples: 0,
        });

        expect(samples).toBe(4);
        expect(resolveKoiPondRefractionDepthMode({
            refraction: true,
            isWebGPU: true,
            samples,
        })).toBe('analytic-msaa');
    });

    it('keeps WebGL2 and disabled refraction on their allocation-free paths', () => {
        expect(resolveKoiPondRefractionDepthMode({
            refraction: true,
            isWebGPU: false,
            samples: 4,
        })).toBe('analytic');
        expect(resolveKoiPondRefractionDepthMode({
            refraction: false,
            isWebGPU: true,
            samples: 4,
        })).toBe('none');
    });
});
