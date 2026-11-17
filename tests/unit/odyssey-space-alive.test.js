/**
 * SPACE ON THE CLOCK (2026-11-17, the Odyssey masterpiece pass): the ringed giant's moons, the far
 * comet and the galaxy's nova. Each is a pure function of the clock, pinned here, and placed on the
 * game's own camera (the rig) with the real chapter-6 environment: the moons never come inside the
 * Earth's backdrop, the comet stays far and off the giant, the nova is a slow pulse.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as THREE_GPU from 'three/webgpu';

import {
    GIANT_MOONS,
    GIANT_MOON_DRAW_ORDER,
    giantMoonsAt,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-giant-moons.js';
import { GIANT_DRAW_ORDER } from '../../src/rendering/odyssey/chapter-environments/odyssey-ringed-giant.tsl.js';
import { GIANT_RINGS } from '../../src/rendering/odyssey/chapter-environments/odyssey-ringed-giant.js';
import { GALAXY_NOVA, galaxyNovaAt } from '../../src/rendering/odyssey/chapter-environments/odyssey-galaxy-nova.js';
import {
    COMET_PATH,
    PLANET_WORLD_SEAT,
    createCosmicExpanseEnvironment,
    resolveCometChord,
    updateCosmicExpanseEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { ORBIT_EARTH, orbitEarthAt } from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import { getChapterPathRange } from '../../src/rendering/odyssey/path-utils.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import { build } from './helpers/tsl-node-build.js';

const rig = createOdysseyCameraRig();
const { cp } = rig;
const env = createCosmicExpanseEnvironment({ particleCount: 200 });
const range = getChapterPathRange(6);
env.position.set(range.center.x, range.center.y, range.center.z);
env.userData.yStart = range.start.y;
env.userData.yEnd = range.end.y;
env.userData.chapterOpacity = 1;

/** The game's camera at progress `p` with the chapter updated at clock `time`. */
function viewAt(p, time = 1) {
    const cam = rig.poseAt(p);
    updateCosmicExpanseEnvironment(env, 0.016, time, cam, p);
    env.updateMatrixWorld(true);
    return cam;
}

describe('the giant\'s moons', () => {
    const inner = GIANT_MOONS.moons[0];

    it('circle just outside the rings, each at its own pace (Kepler)', () => {
        GIANT_MOONS.moons.forEach((m) => {
            expect(m.orbit).toBeGreaterThan(GIANT_RINGS.to);
            expect(m.radius).toBeLessThan(0.12);
        });
        const periodOf = (m) => GIANT_MOONS.innerPeriod * ((m.orbit / inner.orbit) ** 1.5);
        for (let t = 0; t < 400; t += 7.3) {
            giantMoonsAt(t).forEach((row, i) => {
                const m = GIANT_MOONS.moons[i];
                // On its circle (tipped a little out of the ring plane), at its own size.
                expect(Math.hypot(row[0], row[2])).toBeCloseTo(m.orbit, 9);
                expect(Math.abs(row[1])).toBeLessThanOrEqual(m.orbit * Math.sin(m.tilt) + 1e-9);
                expect(row[3]).toBe(m.radius);
            });
        }
        // One whole orbit later each is back where it was; the inner laps the outer.
        GIANT_MOONS.moons.forEach((m, i) => {
            const a = giantMoonsAt(10)[i];
            const b = giantMoonsAt(10 + periodOf(m))[i];
            expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-6);
        });
        expect(periodOf(GIANT_MOONS.moons[2])).toBeGreaterThan(periodOf(inner) * 1.3);
        // Slow enough to be a planet's moons, quick enough to see one cross in a visit.
        expect(GIANT_MOONS.innerPeriod).toBeGreaterThan(60);
        expect(GIANT_MOONS.innerPeriod).toBeLessThan(200);
    });

    it('move without a step', () => {
        let prev = giantMoonsAt(0);
        for (let t = 0.1; t < 300; t += 0.1) {
            const now = giantMoonsAt(t);
            for (let i = 0; i < now.length; i += 1) {
                expect(Math.hypot(now[i][0] - prev[i][0], now[i][2] - prev[i][2])).toBeLessThan(0.03);
            }
            prev = now;
        }
    });

    it('draw with the giant: after its body, before its rings and the Earth', () => {
        expect(GIANT_MOON_DRAW_ORDER).toBeGreaterThan(GIANT_DRAW_ORDER.surface);
        expect(GIANT_MOON_DRAW_ORDER).toBeLessThan(GIANT_DRAW_ORDER.rings);
        expect(GIANT_MOON_DRAW_ORDER).toBeLessThan(-0.5);
        const moons = env.userData.heroPlanet.getObjectByName('hero-planet-moons');
        expect(moons).toBeTruthy();
        expect(moons.renderOrder).toBe(GIANT_MOON_DRAW_ORDER);
        expect(moons.count).toBe(GIANT_MOONS.moons.length);
        expect(moons.material.fog).toBe(false);
    });

    it('never come inside the Earth\'s backdrop while the Earth is up (they would draw over it)', () => {
        // The Earth's backdrop sits ORBIT_EARTH.nearRadius from the eye once it covers the world
        // and writes no depth: anything nearer than that draws in front of the planet.
        const reach = Math.max(...GIANT_MOONS.moons.map((m) => m.orbit + m.radius)) * PLANET_WORLD_SEAT.radius;
        const giant = env.userData.heroPlanet;
        const at = new THREE.Vector3();
        for (let p = 0.722; p <= cp[6]; p += 0.004) {
            if (orbitEarthAt(p, cp).presence > 0.001) {
                const cam = viewAt(p);
                const nearest = giant.getWorldPosition(at).distanceTo(cam.position) - reach;
                expect(nearest, `p ${p.toFixed(3)}`).toBeGreaterThan(ORBIT_EARTH.nearRadius + 20);
            }
        }
    });

    it('ride on the clock in the built chapter, and build on both backends', () => {
        const giant = env.userData.heroPlanet;
        const moons = giant.getObjectByName('hero-planet-moons');
        expect(typeof giant.userData.giant?.update).toBe('function');
        [THREE_GPU.WGSLNodeBuilder, THREE_GPU.GLSLNodeBuilder].forEach((Builder) => {
            [moons, giant.getObjectByName('hero-planet-surface')].forEach((mesh) => {
                const out = build(Builder, mesh);
                expect(out.thrown, `${mesh.name} ${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                expect(out.fragment).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            });
        });
    }, 60_000);
});

describe('the comet, at a distance', () => {
    it('crosses for a share of each period and waits unseen for the rest', () => {
        const P = COMET_PATH.periodSec;
        expect(COMET_PATH.crossing).toBeGreaterThan(0.4);
        expect(COMET_PATH.crossing).toBeLessThan(0.8);
        expect(resolveCometChord(0)).toEqual({ s: 0, crossing: true });
        expect(resolveCometChord(P * COMET_PATH.crossing * 0.5).s).toBeCloseTo(0.5, 9);
        expect(resolveCometChord(P * 0.9)).toEqual({ s: 1, crossing: false });
        expect(resolveCometChord((P * 3) + 1).crossing).toBe(true);
        // Slow: under a degree and a half of sky a second from the rail.
        const chord = COMET_PATH.a.distanceTo(COMET_PATH.b);
        const perSecond = chord / (P * COMET_PATH.crossing);
        expect(THREE.MathUtils.radToDeg(perSecond / 1000)).toBeLessThan(1.5);
    });

    it('is far from the eye at every orb it shows over, and nowhere near the giant\'s face', () => {
        const { comet, heroPlanet } = env.userData;
        const at = new THREE.Vector3();
        const giantAt = new THREE.Vector3();
        for (const id of [38, 39, 40, 41, 42, 43, 44]) {
            for (const s of [0.1, 0.3, 0.5, 0.7, 0.9]) {
                const time = COMET_PATH.periodSec * COMET_PATH.crossing * s;
                const cam = viewAt(rig.parkOf(id), time);
                comet.getWorldPosition(at);
                expect(at.distanceTo(cam.position), `orb ${id} s ${s}`).toBeGreaterThan(850);
                // It flew across the giant's face from orb 39's view: now it keeps well off it.
                heroPlanet.getWorldPosition(giantAt);
                const comet2 = at.clone().project(cam);
                const giant2 = giantAt.clone().project(cam);
                expect(Math.hypot(comet2.x - giant2.x, comet2.y - giant2.y), `orb ${id} s ${s}`).toBeGreaterThan(0.7);
            }
        }
    });

    it('crosses the high sky in frame at the galaxy\'s orb', () => {
        const { comet } = env.userData;
        const at = new THREE.Vector3();
        let inFrame = 0;
        for (const s of [0.3, 0.5, 0.7, 0.9]) {
            const cam = viewAt(rig.parkOf(41), COMET_PATH.periodSec * COMET_PATH.crossing * s);
            const n = comet.getWorldPosition(at).clone().project(cam);
            if (Math.abs(n.x) < 0.95 && Math.abs(n.y) < 0.95) {
                inFrame += 1;
                // The upper half: over the galaxy and the Milky Way, never across the rail's foot.
                expect(n.y).toBeGreaterThan(0.05);
            }
        }
        expect(inFrame).toBeGreaterThanOrEqual(3);
    });
});

describe('the nova in the galaxy', () => {
    const N = GALAXY_NOVA;

    it('swells, holds and sinks, slowly, once a period', () => {
        expect(galaxyNovaAt(0).level).toBe(0);
        expect(galaxyNovaAt(N.rise + (N.hold / 2)).level).toBeCloseTo(1, 6);
        expect(galaxyNovaAt(N.rise + N.hold + N.fall + 0.1).level).toBe(0);
        expect(N.rise + N.hold + N.fall).toBeLessThan(N.period);
        // A pulse, never a flash: seconds up, longer down, no step.
        expect(N.rise).toBeGreaterThanOrEqual(3);
        expect(N.fall).toBeGreaterThan(N.rise * 3);
        let prev = galaxyNovaAt(0).level;
        for (let t = 0.02; t < N.period * 2.5; t += 0.02) {
            const { level } = galaxyNovaAt(t);
            expect(Math.abs(level - prev)).toBeLessThan(0.012);
            expect(level).toBeGreaterThanOrEqual(0);
            expect(level).toBeLessThanOrEqual(1);
            prev = level;
        }
    });

    it('is somewhere else in the disc each time, and holds its place while it shines', () => {
        const places = [];
        for (let k = 0; k < 8; k += 1) {
            const a = galaxyNovaAt((k * N.period) + 1);
            const b = galaxyNovaAt((k * N.period) + N.rise + N.hold + 5);
            expect(b.radius).toBe(a.radius);
            expect(b.angle).toBe(a.angle);
            expect(a.radius).toBeGreaterThanOrEqual(N.radius[0]);
            expect(a.radius).toBeLessThanOrEqual(N.radius[1]);
            places.push([Math.cos(a.angle) * a.radius, Math.sin(a.angle) * a.radius]);
        }
        for (let k = 1; k < places.length; k += 1) {
            const d = Math.hypot(places[k][0] - places[k - 1][0], places[k][1] - places[k - 1][1]);
            expect(d, `nova ${k}`).toBeGreaterThan(0.1);
        }
    });

    it('rides on the galaxy and builds on both backends', () => {
        const nova = env.userData.galaxy.getObjectByName('spiral-galaxy-nova');
        expect(nova).toBeTruthy();
        expect(nova.parent).toBe(env.userData.galaxy);
        expect(nova.material.depthWrite).toBe(false);
        viewAt(rig.parkOf(41), N.rise + 1);
        expect(nova.visible).toBe(true);
        viewAt(rig.parkOf(41), N.period - 2);
        expect(nova.visible).toBe(false);
        [THREE_GPU.WGSLNodeBuilder, THREE_GPU.GLSLNodeBuilder].forEach((Builder) => {
            const out = build(Builder, nova);
            expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard).toEqual([]);
        });
    }, 60_000);
});
