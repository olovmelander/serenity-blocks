/**
 * THE EARTH FROM ORBIT (2026-11-17, the Odyssey masterpiece pass): the weather's grain, the plane
 * it is read on, the evening the Earth arrives under, and the aurora's march once a step is long
 * beside its sheet. The shaders themselves build in tests/unit/odyssey-orbit-earth.test.js.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

import {
    EARTH_WEATHER_NOISE,
    bakeEarthWeatherNoise,
    earthWeatherNoiseAt,
    getEarthWeatherNoise,
} from '../../src/rendering/odyssey/composition/odyssey-earth-weather-bake.js';
import {
    EARTH_MOON,
    EARTH_WEATHER,
    earthPlaneOfCpu,
    getEarthWeatherTexture,
} from '../../src/rendering/odyssey/composition/odyssey-earth-weather.tsl.js';
import {
    ORBIT_EARTH,
    ORBIT_EARTH_AURORA,
    ORBIT_EARTH_CYCLONES,
    ORBIT_EARTH_SCHEDULE,
    createOrbitEarth,
    orbitAuroraOvalReach,
    orbitAuroraSheetPath,
    orbitEarthAt,
} from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import { build } from './helpers/tsl-node-build.js';

const DEG = 180 / Math.PI;

describe('the weather\'s grain (odyssey-earth-weather-bake.js)', () => {
    const n = EARTH_WEATHER_NOISE.size;
    const field = getEarthWeatherNoise();

    it('is seeded: the same field every bake, a different one for another seed', () => {
        const again = bakeEarthWeatherNoise();
        expect(again.length).toBe(n * n * 4);
        let same = true;
        for (let i = 0; i < again.length; i += 97) same = same && again[i] === field[i];
        expect(same).toBe(true);
        const other = bakeEarthWeatherNoise({ ...EARTH_WEATHER_NOISE, seed: 7 });
        let differs = 0;
        for (let i = 0; i < other.length; i += 97) if (Math.abs(other[i] - field[i]) > 1e-3) differs += 1;
        expect(differs).toBeGreaterThan(1000);
    });

    it('fills each channel\'s whole range and holds no stray value', () => {
        for (let c = 0; c < 4; c += 1) {
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = c; i < field.length; i += 4) {
                expect(Number.isFinite(field[i])).toBe(true);
                lo = Math.min(lo, field[i]);
                hi = Math.max(hi, field[i]);
            }
            expect(lo, `channel ${c}`).toBeCloseTo(0, 6);
            expect(hi, `channel ${c}`).toBeCloseTo(1, 6);
        }
    });

    it('tiles: a read one whole tile on is the same read', () => {
        for (const [u, v] of [[0.013, 0.4], [0.5, 0.999], [0.731, 0.002]]) {
            for (let c = 0; c < 4; c += 1) {
                expect(earthWeatherNoiseAt(u + 1, v, c)).toBeCloseTo(earthWeatherNoiseAt(u, v, c), 9);
                expect(earthWeatherNoiseAt(u, v - 2, c)).toBeCloseTo(earthWeatherNoiseAt(u, v, c), 9);
            }
        }
        // ...and across the seam the field runs on: the step from the last texel to the first is
        // no bigger, on average, than the step between two neighbours inside the tile.
        for (let c = 0; c < 4; c += 1) {
            let seam = 0;
            let inner = 0;
            for (let y = 0; y < n; y += 1) {
                const at = (x) => field[(((y * n) + x) * 4) + c];
                seam += Math.abs(at(n - 1) - at(0));
                inner += Math.abs(at(n / 2) - at((n / 2) + 1));
            }
            expect(seam / inner, `channel ${c}`).toBeLessThan(1.5);
        }
    });

    it('has cells with lanes between them: where the lanes channel is low, the cell point is far', () => {
        // B is the gap between the nearest and the second nearest point: on a cell's edge the two
        // are equally near, so the nearest (G) cannot be small there.
        let onLane = 0;
        let nearPointOnLane = 0;
        for (let i = 0; i < n * n; i += 1) {
            if (field[(i * 4) + 2] < 0.02) {
                onLane += 1;
                if (field[(i * 4) + 1] < 0.15) nearPointOnLane += 1;
            }
        }
        expect(onLane).toBeGreaterThan(500);
        expect(nearPointOnLane / onLane).toBeLessThan(0.02);
    });

    it('is uploaded as half floats with mips and anisotropy (the relief is a difference of two reads)', () => {
        const tex = getEarthWeatherTexture();
        expect(tex.type).toBe(THREE.HalfFloatType);
        expect(tex.generateMipmaps).toBe(true);
        expect(tex.anisotropy).toBeGreaterThanOrEqual(8);
        expect(tex.wrapS).toBe(THREE.RepeatWrapping);
        expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(getEarthWeatherTexture()).toBe(tex);
    });
});

describe('the plane the weather is read on', () => {
    const { cells } = ORBIT_EARTH;

    it('puts the point beneath the eye at its origin and keeps distances near it', () => {
        expect(earthPlaneOfCpu({ x: 0, y: 1, z: 0 }, cells)).toEqual([0, 0]);
        const arc = 0.01;
        const [x, z] = earthPlaneOfCpu({ x: Math.sin(arc), y: Math.cos(arc), z: 0 }, cells);
        expect(z).toBe(0);
        expect(x / (arc * cells)).toBeGreaterThan(0.999);
        expect(x / (arc * cells)).toBeLessThan(1.001);
    });

    it('keeps shapes to the limb of the highest view (stereographic: the same scale along and across)', () => {
        // A small step along the bearing and one across it map to steps of the same length.
        for (const arc of [0.1, 0.4, 0.78]) {
            const at = (a, b) => earthPlaneOfCpu({
                x: Math.sin(a) * Math.cos(b), y: Math.cos(a), z: Math.sin(a) * Math.sin(b),
            }, cells);
            const h = 1e-4;
            const p = at(arc, 0.3);
            const along = at(arc + h, 0.3);
            const across = at(arc, 0.3 + (h / Math.sin(arc)));
            const dAlong = Math.hypot(along[0] - p[0], along[1] - p[1]);
            const dAcross = Math.hypot(across[0] - p[0], across[1] - p[1]);
            expect(dAlong / dAcross, `arc ${arc}`).toBeGreaterThan(0.995);
            expect(dAlong / dAcross, `arc ${arc}`).toBeLessThan(1.005);
        }
    });

    it('lays the two cyclones out where they stood on the sphere, the near one in the first view', () => {
        expect(ORBIT_EARTH_CYCLONES).toHaveLength(2);
        const [near, wide] = ORBIT_EARTH_CYCLONES;
        // ~0.075 and ~0.34 rad of arc from beneath the eye.
        expect(Math.hypot(...near.at) / cells).toBeGreaterThan(0.07);
        expect(Math.hypot(...near.at) / cells).toBeLessThan(0.08);
        expect(Math.hypot(...wide.at) / cells).toBeGreaterThan(0.33);
        expect(wide.radius).toBeGreaterThan(near.radius * 3);
        ORBIT_EARTH_CYCLONES.forEach((cy) => {
            expect(cy.arms).toBeGreaterThanOrEqual(1);
            // It creeps: under a twentieth of a turn of its arms' phase a second.
            expect(cy.spin).toBeLessThan(0.05);
        });
    });

    it('keeps the moon out of the frame and its light under a tenth of the day\'s', () => {
        expect(EARTH_MOON.elevation * DEG).toBeGreaterThan(50);
        expect(Math.max(...EARTH_MOON.colour)).toBeLessThan(0.1);
        // Lightning is a point of a storm, not a field: a flash is a fraction of its cell.
        expect(EARTH_WEATHER.boltRadius).toBeLessThan(0.25);
        expect(EARTH_WEATHER.boltRate).toBeLessThan(1);
    });
});

describe('an evening Earth (the sky pass\'s day ending, 2026-11-17)', () => {
    const cp = getActiveOdysseyChapterPositions();
    const b = cp[5];
    const span = cp[6] - b;
    const S = ORBIT_EARTH_SCHEDULE;

    it('arrives under the evening\'s low sun and keeps it until the departure', () => {
        const arrive = b - span * S.arriveFrom;
        for (let p = arrive; p <= b - span * S.sunFrom; p += 0.004) {
            expect(orbitEarthAt(p, cp).sunElevation * DEG, `p ${p.toFixed(4)}`).toBeCloseTo(S.sunEvening, 6);
        }
        expect(S.sunEvening).toBeGreaterThan(2);
        expect(S.sunEvening).toBeLessThan(8);
    });

    it('sets at the eye after the world is switched off and before the aurora is whole', () => {
        let setAt = null;
        let prev = orbitEarthAt(b - span * S.sunFrom, cp).sunElevation;
        for (let p = b - span * S.sunFrom; p <= b; p += 0.0002) {
            const e = orbitEarthAt(p, cp).sunElevation;
            // Only ever down, and never faster than the eased ramp.
            expect(e).toBeLessThanOrEqual(prev + 1e-12);
            expect((prev - e) * DEG).toBeLessThan(0.12);
            if (setAt === null && e <= 0) setAt = p;
            prev = e;
        }
        expect(setAt).toBeGreaterThan(0.722);
        expect(setAt).toBeLessThan(b - span * S.auroraIn[1]);
        expect(orbitEarthAt(b, cp).sunElevation * DEG).toBeCloseTo(S.sunAtBoundary, 6);
    });
});

describe('the aurora\'s march when a step is long beside the sheet (THE STAIRS)', () => {
    const w = ORBIT_EARTH_AURORA.width;

    it('gives a crossing the sheet\'s own path whatever the step\'s length', () => {
        // Seen from above a step runs dozens of widths. The path through the sheet is
        // sqrt(pi) w / rate; clamped to +-6 widths it grew with the step (10x here).
        const rate = 0.05;
        const analytic = (Math.sqrt(Math.PI) * w) / rate;
        [12, 40, 120, 400].forEach((widths) => {
            const dt = (widths * w) / rate;
            const path = orbitAuroraSheetPath((-widths / 2) * w, (widths / 2) * w, dt);
            expect(path / analytic, `${widths} widths`).toBeGreaterThan(0.97);
            expect(path / analytic, `${widths} widths`).toBeLessThan(1.03);
        });
    });

    it('still lights nothing for a step that stays far on one side', () => {
        expect(orbitAuroraSheetPath(8 * w, 90 * w, 0.01)).toBe(0);
        expect(orbitAuroraSheetPath(-90 * w, -8 * w, 0.01)).toBe(0);
    });

    it('bounds the oval tightly: the eye passes through the curtains\' shell outside it', () => {
        const reach = orbitAuroraOvalReach();
        // The poleward sheets reach farther toward the pole than anything reaches away from it.
        expect(reach.toward).toBeGreaterThan(reach.away);
        expect(reach.away).toBeGreaterThan(ORBIT_EARTH_AURORA.fold);
        // The eye stands `poleArc - radius` outside the oval: beyond the reach, so a ray that
        // only looks up through the shell from there never walks the march.
        expect(ORBIT_EARTH_AURORA.poleArc - ORBIT_EARTH_AURORA.radius).toBeGreaterThan(reach.away + 0.01);
    });

    it('stands taller than it did, with fewer steps on the lower tiers', () => {
        expect(ORBIT_EARTH_AURORA.top).toBeGreaterThan(0.015);
        const { steps } = ORBIT_EARTH_AURORA;
        expect(steps.high).toBeGreaterThan(steps.medium);
        expect(steps.medium).toBeGreaterThan(steps.low);
        expect(steps.low).toBeGreaterThanOrEqual(16);
    });

    it('builds the backdrop on a lower tier too (WGSL and GLSL)', () => {
        const earth = createOrbitEarth({ qualityTier: 'Low', haze: (dir) => vec3(0.4, 0.5, 0.6).add(dir.mul(0.01)) });
        [THREE.WGSLNodeBuilder, THREE.GLSLNodeBuilder].forEach((Builder) => {
            const out = build(Builder, earth.mesh);
            expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard).toEqual([]);
            // The weather is read with explicit gradients (anisotropy to the limb, legal in any branch).
            expect(out.fragment).toMatch(/textureSampleGrad|textureGrad/);
        });
        earth.dispose();
    }, 60_000);
});
