/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Regression guard for the Odyssey WebGPU/TSL migration.
 *
 * Constructs every `create*TSL` builder across all converted modules and asserts the
 * TSL node graph builds without throwing. This catches the class of errors that the
 * material-conversion work hit (bad swizzles/chains, `uniform()` wrapping a node,
 * deprecated/WebGL-only nodes, missing exports) at the graph-construction layer.
 *
 * NOTE: graph construction does NOT exercise WGSL compilation (needs a GPU) — that is
 * covered by `npm run validate:odyssey:webgpu` (headless Electron) and the in-browser
 * pilot page. This test is the cheap, always-on first line of defence.
 */

import { describe, it, expect } from 'vitest';
import { uniform } from 'three/tsl';

const MODULES = [
    '../chapter-environments/black-hole-transcendence.tsl.js',
    '../chapter-environments/cosmic-expanse.tsl.js',
    '../chapter-environments/deep-ocean.tsl.js',
    '../chapter-environments/earth-core.tsl.js',
    '../chapter-environments/mountain-peaks.tsl.js',
    '../chapter-environments/sky-drift.tsl.js',
    '../chapter-environments/surface-world.tsl.js',
    '../chapter-environments/urban-dreams.tsl.js',
    '../composition/odyssey-atmosphere-dome.tsl.js',
    '../level-node-manager.tsl.js',
    '../odyssey-path-renderer.tsl.js',
    '../transitions/chapter-threshold-director.tsl.js',
];

describe('Odyssey TSL modules construct valid node graphs', () => {
    MODULES.forEach((rel) => {
        it(`builds every *TSL builder in ${rel}`, async () => {
            const mod = await import(rel);
            const builders = Object.keys(mod).filter((k) => typeof mod[k] === 'function' && /TSL$/.test(k));
            expect(builders.length).toBeGreaterThan(0);
            builders.forEach((name) => {
                expect(() => mod[name](uniform(0))).not.toThrow();
            });
        });
    });
});

describe('Odyssey shared TSL noise lib', () => {
    it('every noise primitive builds a node', async () => {
        const n = await import('../chapter-environments/shared/odyssey-tsl-noise.js');
        const { vec2, vec3 } = await import('three/tsl');
        expect(() => n.fbm3(vec3(0.3, 0.7, 1.1))).not.toThrow();
        expect(() => n.fbm2(vec2(0.3, 0.7))).not.toThrow();
        expect(() => n.ridged3(vec3(0.3, 0.7, 1.1))).not.toThrow();
        expect(() => n.curl3(vec3(0.3, 0.7, 1.1))).not.toThrow();
        expect(() => n.snoise3(vec3(0.3, 0.7, 1.1))).not.toThrow();
    });
});
