import { describe, expect, it } from 'vitest';
import {
    DUNE,
    DuneField,
    TERRAIN_TIERS,
    bakeTerrainGeometry,
    ridgeProfile,
    ridgeSlope,
} from '../../src/themes/shifting-sands/shifting-sands-terrain.js';
import {
    SENTINEL, SUNS, dirFromAzEl, groundPointAt,
} from '../../src/themes/shifting-sands/shifting-sands-composition.js';
import { buildFormations } from '../../src/themes/shifting-sands/shifting-sands-rocks.js';

describe('shifting sands dune profile', () => {
    it('rises from the trough to a single crest and returns to the trough', () => {
        expect(ridgeProfile(0)).toBeCloseTo(0, 6);
        expect(ridgeProfile(DUNE.crest)).toBeCloseTo(1, 6);
        expect(ridgeProfile(0.999999)).toBeLessThan(1e-3);
        // Continuous at the crest from both sides.
        expect(ridgeProfile(DUNE.crest - 1e-6)).toBeCloseTo(ridgeProfile(DUNE.crest + 1e-6), 4);
    });

    it('has a gentle windward slope and a steep slip face (razor crest)', () => {
        const windward = ridgeSlope(DUNE.crest - 1e-4);
        const lee = ridgeSlope(DUNE.crest + 1e-4);
        expect(windward).toBeGreaterThan(0);
        expect(lee).toBeLessThan(0);
        expect(Math.abs(lee)).toBeGreaterThan(windward * 1.8);
    });

    it('stands its slip faces near the angle of repose at full amplitude', () => {
        const maxLee = Math.abs(ridgeSlope(DUNE.crest + 1e-6)) * (37 / DUNE.lambda);
        const deg = (Math.atan(maxLee) * 180) / Math.PI;
        expect(deg).toBeGreaterThan(28);
        expect(deg).toBeLessThan(40);
    });
});

describe('shifting sands dune field', () => {
    it('is deterministic for a seed and varies with it', () => {
        const a = new DuneField({ seed: 7 });
        const b = new DuneField({ seed: 7 });
        const c = new DuneField({ seed: 8 });
        const pts = [[0, -300], [420, -1200], [-900, -2500]];
        let differs = false;
        for (const [x, z] of pts) {
            expect(a.height(x, z)).toBe(b.height(x, z));
            if (Math.abs(a.height(x, z) - c.height(x, z)) > 1e-6) differs = true;
        }
        expect(differs).toBe(true);
    });

    it('bakes a finite polar grid with a full index and horizon tangents', () => {
        const field = new DuneField();
        const tier = TERRAIN_TIERS.Minimal;
        const sun = dirFromAzEl(SUNS.a.az, SUNS.a.el);
        const { geometry, stats } = bakeTerrainGeometry(field, { tier, shadowDir: sun });
        expect(stats.vertices).toBe(tier.rows * tier.cols);
        expect(geometry.index.count).toBe((tier.rows - 1) * (tier.cols - 1) * 6);
        for (const name of ['position', 'aDune', 'aShade']) {
            const arr = geometry.getAttribute(name).array;
            let bad = 0;
            for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad += 1;
            expect(bad).toBe(0);
        }
        const shade = geometry.getAttribute('aShade').array;
        let lit = 0;
        let shadowed = 0;
        const tanA = Math.tan((SUNS.a.el * Math.PI) / 180);
        for (let i = 2; i < shade.length; i += 4) {
            if (shade[i] < tanA) lit++;
            else shadowed++;
        }
        // A low sun over an erg: both lit and shadowed sand, mostly lit.
        expect(lit).toBeGreaterThan(shadowed);
        expect(shadowed).toBeGreaterThan(0);
        geometry.dispose();
    });

    it('lets solid formations cast shadows into the bake (the Sentinel)', () => {
        const field = new DuneField();
        const rocks = buildFormations(field, { detail: 0.4 });
        const s = groundPointAt(SENTINEL.az, SENTINEL.dist);
        // A point on the anti-sun side of the butte, just beyond its apron.
        const sun = dirFromAzEl(SUNS.a.az, 0);
        const px = s.x - sun.x * (SENTINEL.radius * 2.2);
        const pz = s.z - sun.z * (SENTINEL.radius * 2.2);
        const h0 = field.height(px, pz);
        const tanTo = (sx, sz) => {
            let best = -1;
            for (let t = 4; t < 3000; t *= 1.25) {
                const hx = field.height(px + sx * t, pz + sz * t);
                best = Math.max(best, (hx - h0) / t);
            }
            return best;
        };
        const without = tanTo(sun.x, sun.z);
        field.extraHeight = rocks.heightAt;
        const withRock = tanTo(sun.x, sun.z);
        expect(withRock).toBeGreaterThan(without);
        expect(withRock).toBeGreaterThan(Math.tan((SUNS.a.el * Math.PI) / 180));
        rocks.geometry.dispose();
    });
});
