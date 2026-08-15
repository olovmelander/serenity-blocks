import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    COSMIC_BACKDROP_DEFAULTS,
    bakeCosmicBackdropTexture,
} from './odyssey-cosmic-backdrop.js';
import { createCosmicExpanseEnvironment } from './cosmic-expanse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPLIT = fs.readFileSync(
    path.resolve(here, '../../../../scripts/odyssey-gpu-split.mjs'),
    'utf8',
);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ch6 baked cosmic backdrop (Space overhaul Wave 2)', () => {
    it('bakes deterministically for a given seed', () => {
        const a = bakeCosmicBackdropTexture({ width: 128, height: 64 });
        const b = bakeCosmicBackdropTexture({ width: 128, height: 64 });
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    });

    it('a different seed produces a different sky', () => {
        const a = bakeCosmicBackdropTexture({ width: 128, height: 64 });
        const b = bakeCosmicBackdropTexture({ width: 128, height: 64, seed: 9.13 });
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(false);
    });

    it('wraps in longitude: texel 255 meets texel 0 (the bake-tiling trap)', () => {
        // The Act II cloud bake shipped razor edges because its tiling test compared
        // texel 255 to a phantom 256. The seam pair here is the LAST column against
        // the FIRST — adjacent in angle, so their delta must look like any interior
        // neighbour-column delta, not a cliff.
        const { data, width, height } = bakeCosmicBackdropTexture({ width: 256, height: 128 });
        let seamMax = 0;
        let interiorMax = 0;
        for (let y = 0; y < height; y += 1) {
            for (let c = 0; c < 3; c += 1) {
                const first = data[(y * width) * 4 + c];
                const last = data[(y * width + (width - 1)) * 4 + c];
                seamMax = Math.max(seamMax, Math.abs(last - first));
                const mid = data[(y * width + 127) * 4 + c];
                const midNext = data[(y * width + 128) * 4 + c];
                interiorMax = Math.max(interiorMax, Math.abs(midNext - mid));
            }
        }
        // Same continuity class as the interior, with headroom for quantisation.
        expect(seamMax).toBeLessThanOrEqual(Math.max(interiorMax * 2, 12));
    });

    it('the void floor survives 8-bit quantisation — never pure black', () => {
        const { data, width, height } = bakeCosmicBackdropTexture({ width: 128, height: 64 });
        let minBlue = 255;
        for (let i = 0; i < width * height; i += 1) {
            minBlue = Math.min(minBlue, data[i * 4 + 2]);
        }
        // floorBottom blue is 0.012 → ≥ 3/255. A zero here means the lift was lost.
        expect(minBlue).toBeGreaterThanOrEqual(2);
    });

    it('has actual pockets: bright content well above the floor, gaps at it', () => {
        const { data, width, height } = bakeCosmicBackdropTexture({});
        let maxLuma = 0;
        let atFloor = 0;
        const texels = width * height;
        for (let i = 0; i < texels; i += 1) {
            const luma = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
            maxLuma = Math.max(maxLuma, luma);
            if (luma < 10) atFloor += 1;
        }
        // Pocketed, not a wash: bright bodies exist AND most of the sphere is void.
        expect(maxLuma).toBeGreaterThan(60);
        expect(atFloor / texels).toBeGreaterThan(0.4);
    });

    it('bakes inside the startup budget class', () => {
        const { bakeMs } = bakeCosmicBackdropTexture({});
        // Plan budget: ≤150 ms on the dev machine. The test bound is looser (CI/vitest
        // overhead) — it exists to catch an accidental resolution or octave explosion,
        // not to certify the budget (the startup trace does that in-game).
        expect(bakeMs).toBeLessThan(500);
    });

    it('ships the BAKED dome by default and keeps the FBM dome as the escape hatch', () => {
        vi.stubGlobal('window', { location: { search: '' } });
        const baked = createCosmicExpanseEnvironment({ particleCount: 200 });
        expect(baked.userData.voidSky.name).toBe('void-sky-baked');
        expect(baked.userData.voidSky.userData.bakeMs).toBeGreaterThan(0);
        vi.unstubAllGlobals();

        vi.stubGlobal('window', { location: { search: '?odysseyCh6ProceduralDome=1' } });
        const procedural = createCosmicExpanseEnvironment({ particleCount: 200 });
        expect(procedural.userData.voidSky.name).not.toBe('void-sky-baked');
        vi.unstubAllGlobals();

        vi.stubGlobal('window', { location: { search: '?odysseyCh6NoDome=1&odysseyCh6ProceduralDome=1' } });
        const none = createCosmicExpanseEnvironment({ particleCount: 200 });
        // NoDome removes WHICHEVER dome — the bisect lever outranks the hatch.
        expect(none.userData.voidSky).toBeUndefined();
    });

    it('gpu-split can price the retired dome against the shipped bake', () => {
        expect(SPLIT).toMatch(/id:\s*'ch6-procedural-dome',\s*flags:\s*\{\s*odysseyCh6ProceduralDome:\s*'1'/);
    });

    it('exposes the defaults the calibration story depends on', () => {
        expect(COSMIC_BACKDROP_DEFAULTS.width).toBe(1024);
        expect(COSMIC_BACKDROP_DEFAULTS.floorBottom.every((c) => c >= 1 / 255)).toBe(true);
    });
});
