/**
 * THE EARTH BELOW (2026-10-24, steps 2-4 of docs/ODYSSEY_INTO_SPACE_2026-10.md): the round
 * planet the 5->6 climb leaves, its aurora, and the planetrise over its edge. What is pinned here:
 * the schedule (`orbitEarthAt`, pure), the draw order that keeps the Earth in front of space and
 * behind the journey, and the shaders building clean on both backends.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

import {
    createOrbitEarth,
    ORBIT_EARTH,
    ORBIT_EARTH_COVERS,
    ORBIT_EARTH_SCHEDULE,
    orbitEarthAirglowElevation,
    orbitEarthAt,
} from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const DEG = 180 / Math.PI;

describe('orbitEarthAt — the Earth, its sun, its aurora and the planetrise by progress', () => {
    const cp = getActiveOdysseyChapterPositions();
    const b = cp[5];
    const span = cp[6] - b;
    const S = ORBIT_EARTH_SCHEDULE;
    const sweep = [];
    for (let p = b - span; p <= b + span; p += 0.0005) sweep.push([p, orbitEarthAt(p, cp)]);

    it('is nothing without a layout, with the giant at its seat', () => {
        const none = orbitEarthAt(0.75, null);
        expect(none.presence).toBe(0);
        expect(none.aurora).toBe(0);
        expect(none.lookDownDeg).toBe(0);
        expect(none.planetRise).toBe(1);
    });

    it('arrives over the climb, stays through the boundary and sinks out, with no step', () => {
        expect(orbitEarthAt(b - span * (S.inFrom + 0.01), cp).presence).toBe(0);
        expect(orbitEarthAt(b - span * S.inTo, cp).presence).toBeCloseTo(1, 6);
        expect(orbitEarthAt(b, cp).presence).toBe(1);
        expect(orbitEarthAt(b + span * (S.outTo + 0.01), cp).presence).toBe(0);
        // No faster than its eased ramps (a smoothstep's steepest is 1.5 over its width).
        const most = (1.5 * 0.0005) / (span * Math.min(S.inFrom - S.inTo, S.outTo - S.outFrom));
        for (let i = 1; i < sweep.length; i += 1) {
            expect(Math.abs(sweep[i][1].presence - sweep[i - 1][1].presence)).toBeLessThan(most * 1.01);
        }
    });

    it('climbs: the limb only ever dips further, and the height follows it', () => {
        let dip = 0;
        sweep.filter(([, s]) => s.presence > 0).forEach(([p, s]) => {
            expect(s.dip, `p ${p.toFixed(4)}`).toBeGreaterThanOrEqual(dip - 1e-12);
            expect(s.altitude).toBeCloseTo((1 / Math.cos(s.dip)) - 1, 12);
            ({ dip } = s);
        });
        expect(orbitEarthAt(b, cp).dip * DEG).toBeGreaterThan(S.dipStart);
    });

    it('sets the sun before the boundary, so the journey flies into the night', () => {
        expect(orbitEarthAt(b - span * S.inFrom, cp).sunElevation).toBeGreaterThan(0);
        expect(orbitEarthAt(b, cp).sunElevation * DEG).toBeCloseTo(S.sunAtBoundary, 6);
        expect(orbitEarthAt(b + span * S.outFrom, cp).sunElevation * DEG).toBeCloseTo(S.sunEnd, 6);
    });

    it('lights the aurora at dusk, is whole after sunset, and puts it out before the Earth sinks', () => {
        // It lies on the night side ahead, so its first light shows while the sun is still
        // setting at the eye; it is at its height only once the sun is down.
        const lit = sweep.filter(([, s]) => s.aurora > 0.001).map(([p]) => p);
        expect(Math.min(...lit)).toBeGreaterThan(b - span * S.auroraIn[0] - 1e-9);
        expect(Math.max(...lit)).toBeLessThan(b + span * S.auroraOut[1] + 1e-9);
        lit.forEach((p) => expect(orbitEarthAt(p, cp).sunElevation * DEG, `p ${p.toFixed(4)}`).toBeLessThan(3));
        sweep.filter(([, s]) => s.aurora > 0.9).forEach(([p, s]) => {
            expect(s.sunElevation, `p ${p.toFixed(4)}`).toBeLessThan(0);
        });
        sweep.forEach(([, s]) => expect(s.aurora).toBeLessThanOrEqual(s.presence));
    });

    it('raises the giant once, while the aurora is up and the Earth is whole', () => {
        const from = b - span * S.rise[0];
        const to = b + span * S.rise[1];
        expect(orbitEarthAt(from - 0.001, cp).planetRise).toBe(0);
        expect(orbitEarthAt(to + 0.001, cp).planetRise).toBe(1);
        let prev = 0;
        sweep.forEach(([p, s]) => {
            expect(s.planetRise, `p ${p.toFixed(4)}`).toBeGreaterThanOrEqual(prev);
            prev = s.planetRise;
        });
        // It comes up through the aurora's height, over a whole Earth.
        expect(orbitEarthAt((from + to) / 2, cp).aurora).toBeGreaterThan(0.9);
        expect(orbitEarthAt(from, cp).presence).toBeGreaterThanOrEqual(ORBIT_EARTH_COVERS);
        expect(orbitEarthAt(to, cp).presence).toBeGreaterThanOrEqual(ORBIT_EARTH_COVERS);
    });

    it('leans the view down over the Earth and back to the rail before it sinks', () => {
        expect(orbitEarthAt(b, cp).lookDownDeg).toBeCloseTo(-S.lean, 6);
        expect(orbitEarthAt(b + span * S.leanOut, cp).lookDownDeg).toBeCloseTo(0, 6);
        expect(S.leanOut).toBeLessThan(S.outFrom);
    });

    it('arrives over the world from the horizon down, wearing the world\'s air until it has', () => {
        // THE SEAM (Olov: "the earth just pops up and feel totally disconnected to the world"):
        // its front starts at its own limb and reaches the nadir as it arrives; it wears the
        // world's air (the veil) until the front has crossed the frame's lower half, then clears
        // before the boundary.
        const start = b - span * S.inFrom;
        const first = orbitEarthAt(start + 0.0005, cp);
        expect(first.frontSin).toBeCloseTo(Math.sin(first.dip), 2);
        expect(first.veil).toBe(1);
        let prev = -1;
        sweep.filter(([p]) => p >= start && p <= b).forEach(([p, s]) => {
            expect(s.frontSin, `p ${p.toFixed(4)}`).toBeGreaterThanOrEqual(prev - 1e-12);
            ({ frontSin: prev } = s);
            if (s.frontSin < Math.sin(35 / DEG)) expect(s.veil, `p ${p.toFixed(4)}`).toBe(1);
            if (s.presence >= ORBIT_EARTH_COVERS) expect(s.frontSin).toBeGreaterThan(0.999);
        });
        expect(orbitEarthAt(b, cp).veil).toBe(0);
        expect(orbitEarthAt(b + span * 0.5, cp).frontSin).toBe(1);
    });

    it('takes the world\'s clouds into it once they are small, and covers the world only then', () => {
        // The clouds stay real clouds in front of the Earth while the climb takes them below the
        // eye (they used to melt in front of it), going into it only after its front has crossed
        // the frame; the world's surfaces are switched off only once they have and it has fully
        // arrived, before the ringed giant can show behind it.
        const [from, to] = S.clouds;
        expect(orbitEarthAt(b - span * from - 0.0005, cp).cloudsAway).toBe(0);
        expect(orbitEarthAt(b - span * from, cp).frontSin).toBeGreaterThan(Math.sin(35 / DEG));
        expect(orbitEarthAt(b - span * to + 0.0005, cp).cloudsAway).toBe(1);
        const firstCover = sweep.find(([, s]) => s.covers);
        expect(firstCover).toBeTruthy();
        expect(firstCover[1].cloudsAway).toBeGreaterThan(0.999);
        expect(firstCover[1].presence).toBeGreaterThanOrEqual(ORBIT_EARTH_COVERS);
        expect(firstCover[0]).toBeLessThan(cp[5] - (cp[5] - cp[4]) * 0.0723);
        sweep.filter(([p]) => p > firstCover[0] && p < b + span * S.outFrom)
            .forEach(([p, s]) => expect(s.covers, `p ${p.toFixed(4)}`).toBe(true));
    });

    it('keeps the airglow line over the limb once the eye is above it', () => {
        const s = orbitEarthAt(b, cp);
        expect(orbitEarthAirglowElevation(s.altitude, 1)).toBeLessThan(0);
        expect(orbitEarthAirglowElevation(s.altitude, 1)).toBeGreaterThan(-s.dip);
        expect(orbitEarthAirglowElevation(s.altitude, 0)).toBeCloseTo(Math.asin(0.075), 9);
    });
});

describe('the Earth draws in front of space and behind the journey', () => {
    const earth = createOrbitEarth();
    const eye = { x: 10, y: 1100, z: -900 };
    const sun = new THREE.Vector3(0.3, -0.2, 0.9);
    const state = (presence, covers = false) => ({
        altitude: 0.02, sun, presence, eye, aurora: 0.5, covers,
    });

    it('draws after the sky domes and before everything at 0 (the orb glass, the rail glow)', () => {
        expect(earth.mesh.renderOrder).toBeGreaterThan(-100);
        expect(earth.mesh.renderOrder).toBeLessThan(0);
        expect(earth.mesh.material.depthWrite).toBe(false);
        expect(earth.mesh.material.depthTest).toBe(true);
        expect(earth.mesh.frustumCulled).toBe(false);
    });

    it('stays behind the world while the world shows it, with no disc in depth yet', () => {
        // THE SEAM: while it arrives the world's own surfaces show the Earth in place, so its
        // backdrop stays behind them (shown only past the world's drawn edge).
        earth.mesh.geometry.computeBoundingSphere();
        expect(earth.mesh.geometry.boundingSphere.radius).toBeCloseTo(ORBIT_EARTH.radius, 3);
        earth.update(state(0.5));
        expect(earth.mesh.visible).toBe(true);
        expect(earth.mesh.scale.x).toBe(1);
        expect(earth.occluder.visible).toBe(false);
        earth.update(state(0));
        expect(earth.mesh.visible).toBe(false);
    });

    it('once it covers the world, comes in front of the far heroes and marks its disc in depth', () => {
        earth.update(state(1, true));
        earth.mesh.updateMatrixWorld(true);
        const drawn = ORBIT_EARTH.radius * earth.mesh.scale.x;
        expect(drawn).toBeCloseTo(ORBIT_EARTH.nearRadius, 6);
        expect(earth.occluder.visible).toBe(true);
        expect(earth.occluder.parent).toBe(earth.mesh);
        // The occluder is opaque (written before anything transparent), writes depth and no
        // colour, and sits just outside the backdrop so the backdrop passes in front of it.
        const occ = earth.occluder.material;
        expect(occ.transparent).toBe(false);
        expect(occ.depthWrite).toBe(true);
        expect(occ.colorWrite).toBe(false);
        const occRadius = ORBIT_EARTH.radius * earth.occluder.getWorldScale(new THREE.Vector3()).x;
        expect(occRadius).toBeGreaterThan(drawn);
        expect(occRadius).toBeLessThan(drawn * 1.02);
        expect(earth.mesh.position.toArray()).toEqual([eye.x, eye.y, eye.z]);
    });
});

describe('the Earth builds on both backends', () => {
    const earth = createOrbitEarth();
    const backends = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
    // ...and wearing an air handed in, as the world hands it its own (THE SEAM).
    const veiled = createOrbitEarth({ haze: (dir) => vec3(0.42, 0.5, 0.6).add(dir.mul(0.01)) });
    [
        ['the planet', earth.mesh, 15000],
        ['its depth twin', earth.occluder, 800],
        ['the planet in the world\'s air', veiled.mesh, 15000],
    ].forEach(([name, mesh, size]) => {
        backends.forEach(([label, Builder]) => {
            it(`${name} (${label})`, () => {
                const out = build(Builder, mesh);
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                ['vertex', 'fragment'].forEach((stage) => {
                    expect(typeof out[stage]).toBe('string');
                    expect(out[stage]).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                });
                expect(out.fragment.length, 'fragment size').toBeGreaterThan(size);
                expect(out.fragment).toMatch(/discard/);
                if (label === 'WGSL') {
                    expect(unassignedReads(out.vertex), 'vertex').toEqual([]);
                    expect(unassignedReads(out.fragment), 'fragment').toEqual([]);
                }
            }, 60_000);
        });
    });
});
