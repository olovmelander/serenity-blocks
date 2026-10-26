/**
 * Chromadelic Highway planet shader gate — no GPU needed.
 *
 * Every planet impostor the world draws (the hero with all its extras and lightning, the moon with
 * its eclipse, the ringed ice giant, the witness, the hero of the lean tiers) is built through
 * three's own node builders against a stub renderer: the WGSL one of the WebGPU backend and the
 * GLSL one of the WebGL2 fallback. A graph one builder cannot turn into a shader throws or warns
 * here instead of leaving a planet undrawn. Also gated: a NaN/Infinity literal, a JS node
 * stringified into the source, a WGSL var read where it may not have been assigned, and that the
 * event terms (the board's light fronts, the lightning, the ring's spectrum) are compiled only into
 * the bodies that have them.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { createPlanetImpostor } from '../../src/themes/chromadelic-highway/chromadelic-highway-planets.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

vi.setConfig({ testTimeout: 60_000 });

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

const tex = () => new THREE.Texture();
const BODIES = {
    hero: () => createPlanetImpostor({
        map: tex(),
        radius: 500,
        rimPeak: 1.1,
        haloGain: 0.1,
        night: 0.2,
        equalize: true,
        features: {
            fill: true, detail: true, polarHood: true, zonal: true, lightning: true, moonShadow: true,
        },
    }),
    leanHero: () => createPlanetImpostor({
        map: tex(), radius: 500, rimPeak: 0, night: 0.2, equalize: true,
    }),
    moon: () => createPlanetImpostor({
        map: tex(),
        radius: 90,
        grade: {
            low: new THREE.Color(0.1, 0.1, 0.2),
            mid: new THREE.Color(0.5, 0.5, 0.7),
            high: new THREE.Color(0.9, 0.9, 1),
            amount: 1,
        },
        features: { eclipse: true },
    }),
    giant: () => createPlanetImpostor({
        map: tex(),
        radius: 300,
        quad: 2.25,
        veil: 0.15,
        haloGain: 0.08,
        features: { fill: true, ringShadows: true, transmission: true },
        ring: {
            map: tex(), inner: 1.3, outer: 2.2, tilt: 0.3, roll: -0.2,
        },
    }),
    giantLean: () => createPlanetImpostor({
        map: tex(),
        radius: 300,
        quad: 2.25,
        ring: { map: tex(), inner: 1.3, outer: 2.2 },
    }),
    witness: () => createPlanetImpostor({ map: tex(), radius: 40, veil: 0.15 }),
    noFronts: () => createPlanetImpostor({
        map: tex(), radius: 500, rimPeak: 1.1, haloGain: 0.1, features: { fronts: false },
    }),
};

describe('chromadelic highway planet shaders', () => {
    const built = {};
    const get = (name, backend) => {
        const key = `${name}/${backend}`;
        if (!built[key]) {
            const planet = BODIES[name]();
            const Builder = BACKENDS.find(([n]) => n === backend)[1];
            built[key] = build(Builder, planet.mesh);
            planet.dispose();
        }
        return built[key];
    };

    for (const name of Object.keys(BODIES)) {
        for (const [backend] of BACKENDS) {
            it(`${name} builds clean on ${backend}`, () => {
                const out = get(name, backend);
                expect(out.thrown, String(out.thrown?.stack || '')).toBeUndefined();
                expect(out.heard).toEqual([]);
                const source = `${out.vertex}\n${out.fragment}`;
                expect(source).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                if (backend === 'WGSL') expect(unassignedReads(out.fragment)).toEqual([]);
            });
        }
    }

    it('compiles the event terms only into the bodies that have them', () => {
        const frag = (name) => get(name, 'WGSL').fragment;
        // The fronts: a band per slot, read three times on a body with a halo and a ring.
        expect(frag('hero').length).toBeGreaterThan(frag('noFronts').length + 2000);
        // Lightning only on the hero that has it: four cells' cores and glows.
        const cells = (f) => (f.match(/exp\(/g) || []).length;
        expect(cells(frag('hero'))).toBeGreaterThan(cells(frag('leanHero')) + 7);
        // The ring's spectrum and its front only where there is a ring.
        expect(frag('giant')).toMatch(/fract\(/);
    });
});
