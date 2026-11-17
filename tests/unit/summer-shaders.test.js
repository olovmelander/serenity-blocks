/**
 * Summer shader gate — no GPU needed.
 *
 * The sky and the rain of a sun shower are built through three's own node builders against a
 * stub renderer: the WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback,
 * the sky at each of its three levels of detail. A
 * graph one builder cannot turn into a shader throws or warns here instead of leaving the sky
 * undrawn on someone's machine, and a sky that has grown past its budget (a fragment the
 * integrated GPU pays for at every pixel of the upper frame) fails here, not in a frame-time
 * report.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass; the playground captures are the check for that. The parts that
 * read the sun's shadow map (the pollen among them) are not built here: the stub renderer has no
 * shadow pass to give them.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SummerAtmosphere } from '../../src/themes/summer/summer-atmosphere.js';
import { SummerLight } from '../../src/themes/summer/summer-light.js';
import { SUMMER_TIERS } from '../../src/themes/summer/summer-quality.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** One tier for each level of the sky's detail (the `sky` column of summer-quality.js). */
const TIERS = ['High', 'Medium', 'Minimal'];
/**
 * The sky's fragment is 13 KB of WGSL at High today. A feature unrolled in JavaScript instead of
 * shared, or a third row of cumulus, shows up here long before it shows in a frame time.
 */
const SKY_BUDGET = 24 * 1024;

function atmosphere(quality) {
    const tier = SUMMER_TIERS[quality];
    const light = new SummerLight({ tier, rng: seededRandom(624) });
    const air = new SummerAtmosphere({ light, tier, rng: seededRandom(624) });
    air.buildSky();
    air.buildRain();
    return { tier, light, air };
}

describe('Summer shader gate', () => {
    it('draws three levels of sky, one for each value of the tier column', () => {
        expect(TIERS.map((quality) => SUMMER_TIERS[quality].sky)).toEqual([2, 1, 0]);
        for (const tier of Object.values(SUMMER_TIERS)) expect([0, 1, 2]).toContain(tier.sky);
    });

    for (const quality of TIERS) {
        for (const [language, Builder] of BACKENDS) {
            it(`builds the ${quality} sky to ${language} without a word, inside its budget`, () => {
                const { air } = atmosphere(quality);
                const built = build(Builder, air.sky);
                expect(built.thrown, String(built.thrown?.stack || built.thrown)).toBeUndefined();
                expect(built.heard).toEqual([]);
                expect(built.vertex.length).toBeGreaterThan(200);
                expect(built.fragment.length).toBeGreaterThan(2000);
                expect(built.fragment.length).toBeLessThan(SKY_BUDGET);
                expect(built.fragment).not.toMatch(/\bNaN\b|\bundefined\b|\[object /);
                if (language === 'WGSL') expect(unassignedReads(built.fragment)).toEqual([]);
                air.dispose();
            });
        }
    }

    it('spends less shader on the sky the lower the tier', () => {
        const size = (quality) => {
            const { air } = atmosphere(quality);
            const built = build(THREE.WGSLNodeBuilder, air.sky);
            air.dispose();
            return built.fragment.length;
        };
        const [high, medium, minimal] = TIERS.map(size);
        expect(medium).toBeLessThan(high);
        expect(minimal).toBeLessThan(medium);
    });

    for (const [language, Builder] of BACKENDS) {
        it(`builds the rain to ${language} without a word`, () => {
            const { air } = atmosphere('High');
            for (const mesh of [air.rain]) {
                expect(mesh, 'the High tier has rain').toBeTruthy();
                const built = build(Builder, mesh);
                expect(built.thrown, `${mesh.name}: ${built.thrown?.stack || built.thrown}`).toBeUndefined();
                expect(built.heard, mesh.name).toEqual([]);
                expect(built.fragment, mesh.name).not.toMatch(/\bNaN\b|\bundefined\b|\[object /);
                expect(built.vertex, mesh.name).not.toMatch(/\bNaN\b|\bundefined\b|\[object /);
            }
            air.dispose();
        });
    }

    it('keeps the rain out of the scene until it falls, and out of the lake\'s mirror always', () => {
        const { air, light } = atmosphere('High');
        expect(air.rain.userData.unmirrored).toBe(true);
        expect(air.rain.visible).toBe(false);
        // The first frames draw it once (at no strength) so its pipeline exists before a shower.
        air.update();
        expect(air.rain.visible).toBe(true);
        for (let frame = 0; frame < 6; frame += 1) air.update();
        expect(air.rain.visible).toBe(false);
        light.uAir.value.y = 0.5;
        air.update();
        expect(air.rain.visible).toBe(true);
        light.uAir.value.y = 0;
        air.update();
        expect(air.rain.visible).toBe(false);
        // Built hidden behind another theme: drawn meanwhile.
        air.warming = true;
        air.update();
        expect(air.rain.visible).toBe(true);
        air.dispose();
    });
});
