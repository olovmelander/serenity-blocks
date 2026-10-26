/**
 * THE EARTH BELOW (2026-10-24, steps 2-4 of docs/ODYSSEY_INTO_SPACE_2026-10.md): the round
 * planet the 5->6 climb leaves, its aurora, and the planetrise over its edge. What is pinned here:
 * the schedule (`orbitEarthAt`, pure), the draw order that keeps the Earth in front of space and
 * behind the journey, and the shaders building clean on both backends.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { float, vec3 } from 'three/tsl';

import {
    createOrbitEarth,
    ORBIT_EARTH,
    ORBIT_EARTH_COVERS,
    ORBIT_EARTH_SCHEDULE,
    ORBIT_EARTH_SEAM,
    orbitEarthAirglowElevation,
    orbitEarthAt,
    orbitEarthLandHeight,
    orbitEarthLimbSin,
} from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import {
    getLatticeNoiseTexture,
    LATTICE_NOISE_PERIOD,
    latticeNoise3Cpu,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-lattice-noise.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import { worldClimbScale, worldDepartureFade } from '../../src/rendering/odyssey/world/odyssey-world-act-gate.js';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

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

    it('is there before the departure greys anything, stays through the boundary and sinks out, with no step', () => {
        expect(orbitEarthAt(b - span * (S.arriveFrom + 0.01), cp).presence).toBe(0);
        expect(orbitEarthAt(b - span * S.arriveTo, cp).presence).toBeCloseTo(1, 6);
        expect(orbitEarthAt(b, cp).presence).toBe(1);
        expect(orbitEarthAt(b + span * (S.outTo + 0.01), cp).presence).toBe(0);
        // Whole before the world's departure has faded anything toward the void, so the sea and the
        // ground (which take no fade while it is there) never brighten back.
        expect(worldDepartureFade(b - span * S.arriveTo, cp[4], cp[5])).toBeLessThan(0.05);
        // No faster than its eased ramps (a smoothstep's steepest is 1.5 over its width).
        const most = (1.5 * 0.0005) / (span * Math.min(S.arriveFrom - S.arriveTo, S.outTo - S.outFrom));
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

    it('puts its limb at its own dip under the level (THE HORIZON IS THE LIMB)', () => {
        expect(orbitEarthLimbSin(0)).toBe(0);
        sweep.forEach(([p, e]) => {
            expect(orbitEarthLimbSin(e.altitude), `p ${p.toFixed(4)}`).toBeCloseTo(Math.sin(e.dip), 9);
        });
    });

    it('is never revealed: no front, no veil, wherever it is seen', () => {
        // THE SEAM, ONE SURFACE (2026-10-26, Olov: it "transitions in"; "it should feel natural and
        // not like we reveal the earth surface"): no front sweeps from the horizon and no veil
        // lifts; it is there, in the world's own air, which thins as the eye climbs.
        sweep.forEach(([p, s]) => {
            expect(s.frontSin, `p ${p.toFixed(4)}`).toBeGreaterThan(1);
            expect(s.veil).toBe(0);
        });
    });

    it('stands at the eye\'s own height while the world shows it, and joins its schedule without a step', () => {
        // THE ONE ALTITUDE: the world's sea and the Earth's ocean are the same place seen the same
        // way, so the far sea can simply be the Earth. Past the boundary the schedule's height
        // (which runs on past the world) takes over, the two within 15 % at the boundary.
        const rig = createOdysseyCameraRig();
        const at = (p) => {
            const eye = rig.poseAt(p).position;
            const height = (eye.y - ODYSSEY_SEA_LEVEL) / worldClimbScale(p, rig.cp[4], rig.cp[5]);
            return { height, earth: orbitEarthAt(p, rig.cp, height) };
        };
        const own = (height) => (height * ORBIT_EARTH.metresPerUnit) / ORBIT_EARTH.earthRadiusM;
        const r = rig.cp;
        const sp = r[6] - r[5];
        for (let p = r[5] - sp * S.arriveFrom; p < r[5] - sp * S.late[0]; p += 0.001) {
            const { height, earth } = at(p);
            expect(earth.altitude, `p ${p.toFixed(4)}`).toBeCloseTo(own(height), 12);
        }
        const nearB = at(r[5]);
        expect(orbitEarthAt(r[5], r).altitude / own(nearB.height)).toBeGreaterThan(0.85);
        expect(orbitEarthAt(r[5], r).altitude / own(nearB.height)).toBeLessThan(1.15);
        let prev = 0;
        for (let p = r[5] - sp * S.arriveFrom; p < r[5] + sp * S.outTo; p += 0.0005) {
            const { earth } = at(p);
            expect(earth.altitude, `p ${p.toFixed(4)}`).toBeGreaterThanOrEqual(prev * 0.999);
            // No step: never more than a few per cent of the height in 0.0005 of progress.
            if (prev > 0) expect(earth.altitude / prev, `p ${p.toFixed(4)}`).toBeLessThan(1.06);
            prev = earth.altitude;
        }
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

describe('the Earth\'s weather passes under the eye at the world\'s own pace', () => {
    it('slides as fast as the world\'s sea below it where the one becomes the other', () => {
        // 2026-10-25: it slid 0.2 cells per unit the eye travelled, ~2000x the pace of the sea it
        // takes over from, so its weather rushed past while the world's clouds over it stood
        // still (and a touchpad swipe blurred it). Where its haze lifts, the ground below the eye
        // turns through the same angle per unit travelled on the Earth as on the climbed world.
        const rig = createOdysseyCameraRig();
        const { cp } = rig;
        const S = ORBIT_EARTH_SCHEDULE;
        const span = cp[6] - cp[5];
        const p = cp[5] - (span * (S.clouds[0] + S.clouds[1])) / 2;
        const eye = rig.poseAt(p).position;
        const height = (eye.y - ODYSSEY_SEA_LEVEL) / worldClimbScale(p, cp[4], cp[5]);
        const world = 1 / height;
        const earth = ORBIT_EARTH.trackPerUnit / ORBIT_EARTH.cells / orbitEarthAt(p, cp, height).altitude;
        expect(earth / world).toBeGreaterThan(0.5);
        expect(earth / world).toBeLessThan(2);
    });
});

describe('the planet: oceans and continents under its weather (2026-10-25)', () => {
    // Olov: "When we start to see the earth above the cloud, can we make it look like the earth with
    // ocean, landmasses and contintents?" The continents are a height field on the sphere; its CPU
    // twin reads the same lattice bytes, so where the land lies is pinned here.
    it('reads the lattice on the CPU as the shader does', () => {
        const n = LATTICE_NOISE_PERIOD;
        const { data } = getLatticeNoiseTexture().image;
        [[0, 0, 0], [5, 9, 13], [63, 1, 62]].forEach(([x, y, z]) => {
            expect(latticeNoise3Cpu(x, y, z)).toBeCloseTo(data[x + (y * n) + (z * n * n)] / 255, 9);
        });
        expect(latticeNoise3Cpu(n + 5, 9, -n + 13)).toBeCloseTo(latticeNoise3Cpu(5, 9, 13), 9);
        const a = latticeNoise3Cpu(5, 9, 13);
        const b = latticeNoise3Cpu(6, 9, 13);
        expect(latticeNoise3Cpu(5.5, 9, 13)).toBeCloseTo((a + b) / 2, 9);
    });

    it('keeps open sea beneath the eye, where the world\'s own sea becomes it', () => {
        for (const arc of [0, 0.002, 0.004]) {
            for (let k = 0; k < 16; k += 1) {
                const az = (k / 16) * Math.PI * 2;
                const at = { x: Math.sin(arc) * Math.cos(az), y: Math.cos(arc), z: Math.sin(arc) * Math.sin(az) };
                expect(orbitEarthLandHeight(at), `arc ${arc} bearing ${k}`).toBeLessThan(0);
            }
        }
    });

    // Where the view ray `d` (unit, world frame) meets the Earth seen from `alt` radii up: its point
    // on the unit sphere, or null.
    const onEarth = (d, alt) => {
        const k = 1 + alt;
        const disc = (k * k * d.y * d.y) - (alt * (alt + 2));
        if (d.y >= 0 || disc <= 0) return null;
        const t = (-k * d.y) - Math.sqrt(disc);
        return new THREE.Vector3(d.x * t, (d.y * t) + k, d.z * t).normalize();
    };

    it('shows land across the sea as it comes up out of the haze, on the game\'s camera', () => {
        const rig = createOdysseyCameraRig();
        const { cp } = rig;
        const span = cp[6] - cp[5];
        const p = cp[5] - (span * (ORBIT_EARTH_SCHEDULE.clouds[0] + ORBIT_EARTH_SCHEDULE.clouds[1])) / 2;
        const cam = rig.poseAt(p);
        const height = (cam.position.y - ODYSSEY_SEA_LEVEL) / worldClimbScale(p, cp[4], cp[5]);
        const { altitude } = orbitEarthAt(p, cp, height);
        let land = 0;
        let sea = 0;
        for (let j = 0; j < 18; j += 1) {
            for (let i = 0; i < 32; i += 1) {
                const d = new THREE.Vector3(((i + 0.5) / 32) * 2 - 1, ((j + 0.5) / 18) * 2 - 1, 0.5)
                    .unproject(cam).sub(cam.position).normalize();
                const at = onEarth(d, altitude);
                if (!at) continue;
                if (orbitEarthLandHeight(at) > 0) land += 1;
                else sea += 1;
            }
        }
        const share = land / (land + sea);
        expect(share, `land ${land} sea ${sea}`).toBeGreaterThan(0.15);
        expect(share).toBeLessThan(0.65);
    });

    it('is a world of oceans and continents from high above', () => {
        const alt = 0.3;
        const reach = Math.acos(1 / (1 + alt));
        let land = 0;
        let all = 0;
        for (let r = 0; r < 40; r += 1) {
            for (let k = 0; k < 64; k += 1) {
                const arc = reach * Math.sqrt((r + 0.5) / 40);
                const az = (k / 64) * Math.PI * 2;
                const at = { x: Math.sin(arc) * Math.cos(az), y: Math.cos(arc), z: Math.sin(arc) * Math.sin(az) };
                all += 1;
                if (orbitEarthLandHeight(at) > 0) land += 1;
            }
        }
        expect(land / all).toBeGreaterThan(0.2);
        expect(land / all).toBeLessThan(0.55);
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

    it('hands the world its limb\'s depression, eased in with its presence (THE HORIZON IS THE LIMB)', () => {
        // The world's sky and air measure their elevation from it: with no Earth, from the level.
        earth.update(state(0.5));
        expect(ORBIT_EARTH_SEAM.limbSin.value).toBeCloseTo(orbitEarthLimbSin(0.02) * 0.5, 9);
        earth.update(state(1));
        expect(ORBIT_EARTH_SEAM.limbSin.value).toBeCloseTo(orbitEarthLimbSin(0.02), 9);
        earth.update(state(0));
        expect(ORBIT_EARTH_SEAM.limbSin.value).toBe(0);
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
    // ...and hazed by the world's own atmosphere below the eye (THE ONE AIR).
    const hazed = createOrbitEarth({
        haze: (dir) => vec3(0.42, 0.5, 0.6).add(dir.mul(0.01)),
        worldAir: (dir) => ({
            colour: vec3(0.5, 0.6, 0.7).add(dir.mul(0.02)), column: float(0.1), ceil: 0.82, weight: float(0.7),
        }),
    });
    [
        ['the planet', earth.mesh, 15000],
        ['its depth twin', earth.occluder, 800],
        ['the planet in the world\'s air', veiled.mesh, 15000],
        ['the planet under the world\'s atmosphere', hazed.mesh, 15000],
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
