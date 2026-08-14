import { describe, expect, it } from 'vitest';

import { PROBE_FIELD_COUNT, buildProbeFieldSpecs } from './odyssey-cloud-field-probe.js';
import { buildHeroCloudGeometry, validateHeroCloudPlacements } from './odyssey-hero-clouds.js';
import { HERO_CLOUD_RULES } from './odyssey-hero-cloud-specs.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

// The REAL rail, re-derived here exactly as the world does it — a probe validated against a
// made-up path would prove nothing about the frame it is supposed to price.
const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));

describe('cloud field probe placements', () => {
    it('places the authored count', () => {
        expect(buildProbeFieldSpecs(RAIL)).toHaveLength(PROBE_FIELD_COUNT);
    });

    it('is deterministic — the same sky every boot, so captures and pairs are comparable', () => {
        expect(buildProbeFieldSpecs(RAIL)).toEqual(buildProbeFieldSpecs(RAIL));
    });

    // THE LOAD-BEARING ONE. The probe is opaque and has no near-fade, so a mass the camera
    // ends up inside fills the frame with one white triangle and prices nothing. This asserts
    // the probe obeys the same clearance annulus the heroes did, against the live rail.
    it('every probe mass clears the rail by the hero rules', () => {
        expect(validateHeroCloudPlacements(buildProbeFieldSpecs(RAIL), RAIL)).toEqual([]);
    });

    it('spans the legal annulus rather than clustering at one radius', () => {
        const specs = buildProbeFieldSpecs(RAIL);
        const dists = specs.map((s) => Math.min(
            ...RAIL.map((pt) => Math.hypot(s.x - pt.x, s.z - pt.z)),
        ));
        expect(Math.min(...dists)).toBeGreaterThanOrEqual(HERO_CLOUD_RULES.MIN_RAIL_DIST);
        expect(Math.max(...dists)).toBeLessThanOrEqual(HERO_CLOUD_RULES.MAX_RAIL_DIST);
        // Near AND far both represented: the probe prices the silhouette-bound and the
        // vertex-bound end in one pass, which is the whole point of sweeping the annulus.
        expect(Math.max(...dists) - Math.min(...dists)).toBeGreaterThan(1200);
    });

    it('builds a geometry in the triangle band the Wave 0 gate was written against', () => {
        const build = buildHeroCloudGeometry(buildProbeFieldSpecs(RAIL), { tertiaries: true });
        // The measured anchor is 6 masses / ~9k tris. The gate (<= 0.50 ms at ch5) was set
        // against ~30-45k. If a future edit pushes the probe outside that band the gate stops
        // meaning what the plan says it means, so the band is asserted rather than commented.
        expect(build.triangles).toBeGreaterThan(25000);
        expect(build.triangles).toBeLessThan(60000);
        build.geometry.dispose();
    });
});
