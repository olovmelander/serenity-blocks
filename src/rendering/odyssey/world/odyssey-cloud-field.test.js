import { describe, expect, it } from 'vitest';

import {
    CLOUD_FIELD_LOD_DETAIL,
    buildCloudFieldGeometry,
    buildCloudLobes,
    cloudMassSdf,
    sculptCloudMass,
    validateCloudFieldClearance,
} from './odyssey-cloud-field.js';
import { CLOUD_FIELD_CLEARANCE, ODYSSEY_CLOUD_FIELD_SPECS } from './odyssey-cloud-field-specs.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

// The REAL rail, densely sampled — but ONLY across the window in which the world is drawn.
//
// ⚠️ Sampling the WHOLE journey is wrong and the validator proved it: Act III climbs the rail
// into space, straight through the altitude Act II's clouds occupy, and three legal zenith
// masses were reported as violations because of rail points at p > 0.7 where the entire world
// group is switched off. Clearance means "can the camera enter this cloud WHILE IT IS DRAWN";
// outside the act gate there is no cloud to enter. The margin below the gate's own bounds is
// deliberate slack so a future gate widening fails this test rather than silently shipping a
// mass the rail now passes through.
const ACT_START = 0.063;
const ACT_END = 0.678;
const RAIL = Array.from(
    { length: 400 },
    (_, i) => getOdysseyPathPointAt(ACT_START + ((i / 399) * (ACT_END - ACT_START))),
);
const SPEC = ODYSSEY_CLOUD_FIELD_SPECS[0];

describe('cloud field sculptor', () => {
    // THE LOAD-BEARING ONE. Every vertex is produced by ray-marching to the field's zero
    // crossing, so every vertex must SIT on that surface. This is what caught the first
    // draft's real defect: an exhausted sphere-trace fell back to collapsing the vertex to the
    // mass centre, and 65 of 2940 vertices on one mass took that path — spikes through the
    // hull that no visual check at silhouette scale would reliably show.
    it('puts every vertex on the surface it marched to', () => {
        const m = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.near);
        const lobes = buildCloudLobes(SPEC);
        let worst = 0;
        for (let v = 0; v < m.position.length / 3; v += 1) {
            const x = m.position[v * 3];
            const y = m.position[(v * 3) + 1];
            const z = m.position[(v * 3) + 2];
            const d = cloudMassSdf(SPEC, lobes, x, y, z);
            worst = Math.max(worst, Math.abs(d));
        }
        // Under 0.5 % of the mass width. Tight enough that a collapsed vertex (which lands a
        // full radius away) cannot hide inside the tolerance.
        expect(worst).toBeLessThan(SPEC.w * 0.005);
    });

    it('emits no NaN and nothing below the flat base', () => {
        const m = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.near);
        for (let v = 0; v < m.position.length / 3; v += 1) {
            expect(Number.isFinite(m.position[v * 3])).toBe(true);
            expect(Number.isFinite(m.position[(v * 3) + 1])).toBe(true);
            expect(Number.isFinite(m.position[(v * 3) + 2])).toBe(true);
            // The base is a smooth-MAX fillet, so the surface may round slightly under the
            // plane; a full lobe radius below it would mean the cut never happened.
            expect(m.position[(v * 3) + 1]).toBeGreaterThan(SPEC.base - (SPEC.w * 0.05));
        }
    });

    it('bakes unit-length normals from the field gradient', () => {
        const m = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.mid);
        for (let v = 0; v < m.normal.length / 3; v += 1) {
            const len = Math.hypot(m.normal[v * 3], m.normal[(v * 3) + 1], m.normal[(v * 3) + 2]);
            expect(len).toBeGreaterThan(0.999);
            expect(len).toBeLessThan(1.001);
        }
    });

    // AO that is constant is AO that does nothing — the crevice grouping is the whole reason
    // it is baked, so its RANGE is the thing worth asserting, not its presence.
    it('bakes ambient occlusion with real range', () => {
        const m = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.near);
        const ao = [];
        for (let v = 0; v < m.colour.length / 3; v += 1) ao.push(m.colour[v * 3]);
        expect(Math.min(...ao)).toBeLessThan(0.35);
        expect(Math.max(...ao)).toBeGreaterThan(0.85);
    });

    it('is deterministic — the same sky every boot, so captures and pairs compare', () => {
        const a = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.mid);
        const b = sculptCloudMass(SPEC, CLOUD_FIELD_LOD_DETAIL.mid);
        expect(Array.from(a.position)).toEqual(Array.from(b.position));
    });

    it('throws rather than sculpting an inside-out hull', () => {
        // A zero-width mass has no interior at all, so the star-shaped premise every ray in
        // this module rests on is void. This is the spec-table typo the guard exists for.
        // (Raising `base` does NOT reach it — the lobes are placed relative to `base`, so the
        // whole mass simply moves and its centre stays inside. That was this test's first,
        // wrong, premise; the guard was fine.)
        expect(() => sculptCloudMass({ ...SPEC, w: 0 }, 1)).toThrow(/centre is outside/);
    });
});

describe('cloud field composition', () => {
    it('clears the live rail by every role margin', () => {
        const problems = validateCloudFieldClearance(
            ODYSSEY_CLOUD_FIELD_SPECS,
            RAIL,
            CLOUD_FIELD_CLEARANCE,
        );
        expect(problems).toEqual([]);
    });

    // Wave 0 measured ~0.131 ms fixed + ~0.0094 ms per mass at ch5 and gate F1 is 0.50 ms.
    // These bounds are what keeps a later "just one more cloud" from silently spending it.
    it('stays inside the triangle and bake budget the gate was written against', () => {
        const t0 = Date.now();
        // WITH the rail, because that is what ships: `buildCloudFieldGeometry` promotes a
        // mass's LOD when it subtends more than its authored label claims, so measuring
        // without the rail measures a build the game never makes.
        const build = buildCloudFieldGeometry(ODYSSEY_CLOUD_FIELD_SPECS, RAIL);
        const ms = Date.now() - t0;
        expect(build.masses).toBe(ODYSSEY_CLOUD_FIELD_SPECS.length);
        // 16,000 -> 20,000 -> 34,000, each raise RE-MEASURED rather than nudged to turn a red
        // test green. The ledger, all Lane B ch5 p=0.569 with drift inside a tick:
        //   14,920 tris -> 0.262 ms   (38 masses)
        //   17,360 tris -> 0.197 ms   (52 masses, satellites are far-LOD and tiny on screen)
        //   30,980 tris -> 0.328 ms   (LOD floor raised so no hull shows straight edges)
        // against a 0.50 ms gate. The last raise bought the biggest visible fix in the field's
        // life and spent a third of the remaining headroom; the next one has much less room,
        // which is exactly what this bound exists to make someone notice.
        expect(build.triangles).toBeLessThan(34000);
        // Generous against CI jitter; the measured figure on this machine is ~330 ms, up from
        // ~125 ms when the LOD floor doubled the geometry. That is one-time world-build cost
        // traded for clouds that stop reading as polygons; if it ever needs winning back, the
        // sphere-trace loop is the hot path (38 field evaluations per vertex), not the bake
        // structure.
        expect(ms).toBeLessThan(900);
        build.geometry.dispose();
    });

    it('carries every attribute the paint stack reads', () => {
        const build = buildCloudFieldGeometry(ODYSSEY_CLOUD_FIELD_SPECS.slice(0, 3));
        ['position', 'normal', 'aMassCentre', 'color'].forEach((name) => {
            expect(build.geometry.getAttribute(name), name).toBeTruthy();
        });
        build.geometry.dispose();
    });

    it('keeps the six framing placements identical to the owner-approved heroes', () => {
        const framing = ODYSSEY_CLOUD_FIELD_SPECS.filter((s) => s.role === 'framing');
        expect(framing).toHaveLength(6);
        // Guards the deliberate decision to re-author geometry WITHOUT re-authoring
        // composition, so a failure of the new sky is attributable to one of the two.
        expect(framing.map((s) => [s.x, s.base, s.z, s.w, s.h])).toEqual([
            [-320, 860, -2250, 640, 330],
            [-1750, 830, -2050, 700, 300],
            [-750, 900, -3150, 880, 380],
            [620, 845, -2150, 600, 280],
            [1450, 875, -3050, 820, 320],
            [1550, 855, -1000, 620, 290],
        ]);
    });
});
