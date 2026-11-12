/**
 * The MaterialX noise gate can fail.
 *
 * Forty-one shader tests gate on "no MaterialX noise in the generated shader". Until 2026-11
 * each did it with `/mx_\w+/` on the WGSL and GLSL text, and on three r187 that matched nothing
 * at all: three writes those functions under generated names now, so the gates passed whatever
 * a shader held and nobody could tell. `tests/unit/helpers/materialx-noise.js` replaced the
 * regex with a check calibrated against the installed three. This file holds that check to its
 * word, so it cannot go blind the same way:
 *
 *   - it fires on every MaterialX noise three exports, in WGSL and in GLSL;
 *   - it stays quiet on shaders without MaterialX noise: three's own hashes, MaterialX's colour
 *     helpers, and the repo's simplex and value noise that replaced MaterialX;
 *   - the old regex really is blind (the day three names these functions again, that last
 *     assertion fails, and says so).
 *
 * When a three bump turns this red, the generated code changed again: fix the helper, not the
 * 41 tests that use it.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { build } from './helpers/tsl-node-build.js';
import {
    definedFunctions, hasMaterialXNoise, materialXNoiseCalibration, materialXNoiseFunctions,
} from './helpers/materialx-noise.js';
import { noise2, noise3, simplex3 } from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';

const {
    Fn, float, positionLocal, uv, vec3, vec4,
} = TSL;
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

function shader(Builder, node) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => vec4(vec4(node()).x, 0.0, 0.0, 1.0))();
    const built = build(Builder, new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
    expect(built.thrown, String(built.thrown?.stack ?? '')).toBeUndefined();
    return `${built.vertex}\n${built.fragment}`;
}

/** One call per family, in the forms themes used to write them. */
const MATERIALX_NOISE = {
    'mx_noise_float (3D)': () => TSL.mx_noise_float(positionLocal),
    'mx_noise_float (2D)': () => TSL.mx_noise_float(uv()),
    mx_noise_vec3: () => TSL.mx_noise_vec3(positionLocal),
    'mx_fractal_noise_float (3D)': () => TSL.mx_fractal_noise_float(positionLocal, 4, 2.0, 0.5, 1.0),
    'mx_fractal_noise_float (2D coordinate)': () => TSL.mx_fractal_noise_float(uv()),
    mx_fractal_noise_vec3: () => TSL.mx_fractal_noise_vec3(positionLocal),
    'mx_worley_noise_float (3D)': () => TSL.mx_worley_noise_float(positionLocal),
    'mx_worley_noise_float (2D coordinate)': () => TSL.mx_worley_noise_float(uv().mul(20.0), 1.0),
    mx_worley_noise_vec3: () => TSL.mx_worley_noise_vec3(positionLocal),
    mx_cell_noise_float: () => TSL.mx_cell_noise_float(positionLocal),
};

const CLEAN = {
    'no noise at all': () => positionLocal.x,
    'three hash': () => TSL.hash(positionLocal.x.mul(10.0).floor().add(100.0)),
    'three rand': () => TSL.rand(uv()),
    'three triNoise3D': () => TSL.triNoise3D(positionLocal, float(0.2), float(1.0)),
    'MaterialX colour helpers (not noise)': () => TSL.mx_hsvtorgb(TSL.mx_rgbtohsv(vec3(positionLocal.x, 0.5, 0.5))),
    'the repo\'s value noise (2D)': () => noise2(uv().mul(8.0)),
    'the repo\'s value noise (3D)': () => noise3(positionLocal.mul(4.0)),
    'the repo\'s simplex': () => simplex3(positionLocal.mul(4.0)),
};

describe('MaterialX noise gate', () => {
    it('is calibrated against every MaterialX noise the installed three exports', () => {
        const { names, families, skipped } = materialXNoiseCalibration();
        const exported = Object.keys(TSL).filter((name) => /^mx_(?:noise|fractal_noise|worley_noise|cell_noise|unifiednoise)/.test(name));
        expect(exported.length).toBeGreaterThanOrEqual(10);
        expect(skipped, 'a MaterialX noise export that no argument shape could build').toEqual([]);
        expect([...families.keys()].sort()).toEqual(exported.sort());
        for (const [name, own] of families) expect(own.size, `${name} defines no function of its own`).toBeGreaterThan(0);
        expect(names.size).toBeGreaterThan(5);
    });

    for (const [label, Builder] of BACKENDS) {
        describe(label, () => {
            it.each(Object.keys(MATERIALX_NOISE))('fires on %s', (name) => {
                const text = shader(Builder, MATERIALX_NOISE[name]);
                expect(materialXNoiseFunctions(text).length, `${name} went unseen`).toBeGreaterThan(0);
                expect(hasMaterialXNoise(text)).toBe(true);
            });

            it.each(Object.keys(CLEAN))('stays quiet on %s', (name) => {
                const text = shader(Builder, CLEAN[name]);
                expect(materialXNoiseFunctions(text), name).toEqual([]);
                expect(hasMaterialXNoise(text)).toBe(false);
            });
        });
    }

    it('fires on a shader that hides one MaterialX call among clean ones', () => {
        const text = shader(THREE.WGSLNodeBuilder, () => simplex3(positionLocal.mul(4.0))
            .add(TSL.hash(positionLocal.x.floor().add(64.0)))
            .add(TSL.mx_noise_float(positionLocal.mul(0.3))));
        expect(hasMaterialXNoise(text)).toBe(true);
    });

    it('reads function definitions in both languages', () => {
        expect([...definedFunctions('fn fn61 ( x : u32, k : i32 ) -> u32 {\n}\n@fragment\nfn main( ) -> OutputStruct {\n}')]).toEqual(['fn61']);
        expect([...definedFunctions('uint fn61 ( uint x, int k ) {\n}\nfloat helper( vec3 p ) {\n}\nvoid main() {\n}')]).toEqual(['fn61', 'helper']);
        // A declaration or a call is not a definition.
        expect([...definedFunctions('float fn9 ( float x );\nvoid main() {\n\tfloat y = fn9( 1.0 );\n}')]).toEqual([]);
    });

    it('replaces a check that is blind: the generated text names no mx_ function', () => {
        // If this fails, three writes MaterialX functions under their own names again. The
        // calibrated check above still works; this only records why a name search does not.
        for (const [, Builder] of BACKENDS) {
            const text = shader(Builder, MATERIALX_NOISE['mx_noise_float (3D)']);
            expect(text).not.toMatch(/mx_\w+/);
        }
    });
});
