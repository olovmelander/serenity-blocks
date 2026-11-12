import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    TRI_NOISE_DECLARATION, createStripThreeTriNoisePlugin, findTriNoiseFingerprints, stripTriNoise,
} from '../../scripts/vite-plugins/strip-three-tri-noise.mjs';

const THREE_BUILD = join(process.cwd(), 'node_modules', 'three', 'build');
const read = (name) => readFileSync(join(THREE_BUILD, name), 'utf8');

describe('three\'s triNoise3D is left out of the build', () => {
    it('stubs the function in the three builds the game bundles, keeping the export', () => {
        for (const name of ['three.webgpu.nodes.js', 'three.tsl.js']) {
            const source = read(name);
            expect(source.includes(TRI_NOISE_DECLARATION), name).toBe(true);
            const { code, removed } = stripTriNoise(source);
            expect(removed.length, name).toBeGreaterThan(200);
            expect(findTriNoiseFingerprints(code), name).toEqual([]);
            expect(code, name).toContain('const triNoise3D = /*@__PURE__*/ Fn( () => float( 0.0 )');
            expect(code, name).toMatch(/triNoise3D: triNoise3D/);
        }
    });

    it('leaves a file without the function untouched', () => {
        const source = 'const a = 1;\nexport { a };\n';
        expect(stripTriNoise(source)).toEqual({ code: source, removed: '' });
    });

    it('fails the build if the loop is there but its declaration moved', () => {
        const moved = 'const triNoise = Fn( ( [ p ] ) => {\n\tbp.mulAssign( 1.8 );\n\tbp.addAssign( 0.14 );\n} );\n';
        expect(() => stripTriNoise(moved)).toThrow(/declaration moved/);
    });

    it('recognises the loop after minification', () => {
        expect(findTriNoiseFingerprints('a.mulAssign(1.8),i.mulAssign(1.5);a.addAssign(.14)})'))
            .toEqual(['mulAssign(1.8)', 'addAssign(.14)']);
    });

    it('applies to three\'s build files only, and only when building', () => {
        const plugin = createStripThreeTriNoisePlugin();
        expect(plugin.apply).toBe('build');
        expect(plugin.transform('const x = 1;', '/p/node_modules/phaser/dist/phaser.esm.js')).toBeNull();
        const out = plugin.transform(read('three.tsl.js'), '/p/node_modules/three/build/three.tsl.js');
        expect(findTriNoiseFingerprints(out.code)).toEqual([]);
    });
});
