/**
 * DEEP SPACE, ONE THING AT A TIME (2026-10-24, step 5 of docs/ODYSSEY_INTO_SPACE_2026-10.md).
 * Past the 5->6 boundary the Earth's aurora and the planetrise come first; the Milky Way, the gas
 * and the black hole's light used to arrive in the same 0.005 of progress under them. Each now
 * comes up in clear sky after the one before (DEEP_SPACE_BEATS), played here by progress and on
 * the real chapter 6 driven by the game's own camera.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

import {
    createCosmicExpanseEnvironment,
    DEEP_SPACE_BEATS,
    resolveDeepSpaceBeats,
    updateCosmicExpanseEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { createBakedVoidSkyTSL } from '../../src/rendering/odyssey/chapter-environments/odyssey-cosmic-backdrop.js';
import { getChapterPathRange } from '../../src/rendering/odyssey/path-utils.js';
import { ORBIT_EARTH_SCHEDULE, orbitEarthAt } from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const rig = createOdysseyCameraRig();
const { cp } = rig;
const b = cp[5];
const span = cp[6] - b;
const at = (f) => b + span * f;

describe('DEEP_SPACE_BEATS — by progress', () => {
    it('is whole without a layout, nothing before its beat and whole after it', () => {
        expect(resolveDeepSpaceBeats(0.8, null)).toEqual({ milkyWay: 1, nebula: 1, hole: 1 });
        Object.entries(DEEP_SPACE_BEATS).forEach(([name, [from, to]]) => {
            expect(resolveDeepSpaceBeats(at(from) - 1e-4, cp)[name], name).toBe(0);
            expect(resolveDeepSpaceBeats(at(to) + 1e-4, cp)[name], name).toBe(1);
        });
        const sweep = [];
        for (let p = b; p <= cp[6]; p += 0.001) sweep.push([p, resolveDeepSpaceBeats(p, cp)]);
        sweep.slice(1).forEach(([p, s], i) => {
            const before = sweep[i][1];
            ['milkyWay', 'nebula', 'hole'].forEach((k) => {
                expect(s[k], `${k} @${p.toFixed(3)}`).toBeGreaterThanOrEqual(before[k]);
            });
        });
    });

    it('waits for the aurora to go out and the giant to rise, then comes up one thing at a time', () => {
        const [mwFrom] = DEEP_SPACE_BEATS.milkyWay;
        const first = orbitEarthAt(at(mwFrom), cp);
        expect(first.aurora).toBeLessThan(0.05);
        expect(first.planetRise).toBeGreaterThan(0.99);
        expect(mwFrom).toBeGreaterThanOrEqual(ORBIT_EARTH_SCHEDULE.rise[1]);
        // Each starts once the one before is well under way, and is whole after it.
        const order = ['milkyWay', 'nebula', 'hole'];
        for (let i = 1; i < order.length; i += 1) {
            const [from, to] = DEEP_SPACE_BEATS[order[i]];
            const [, beforeTo] = DEEP_SPACE_BEATS[order[i - 1]];
            expect(resolveDeepSpaceBeats(at(from), cp)[order[i - 1]], order[i]).toBeGreaterThan(0.25);
            expect(to, order[i]).toBeGreaterThan(beforeTo);
        }
    });
});

describe('chapter 6 stages its sky on the beats', () => {
    const env = createCosmicExpanseEnvironment({ particleCount: 200 });
    const range = getChapterPathRange(6);
    env.position.set(range.center.x, range.center.y, range.center.z);
    env.userData.yStart = range.start.y;
    env.userData.yEnd = range.end.y;
    env.userData.chapterOpacity = 1;
    const u = env.userData;
    const opacity = (o) => (o?.visible ? o.material.opacity : 0);
    const play = (p) => {
        updateCosmicExpanseEnvironment(env, 0.016, 10, rig.poseAt(p), p);
        return u;
    };

    it('keeps space dark and clear between the aurora and the Milky Way', () => {
        // Just before the Milky Way: the dome owns the background, near-black; the hole is there
        // (its shadow), unlit; no far stars, no gas, no debris.
        play(at(DEEP_SPACE_BEATS.milkyWay[0]) - 0.001);
        expect(u.uniforms.uVoidSkyOpacity.value).toBeGreaterThan(0.99);
        expect(u.uniforms.uVoidSkyGlow.value).toBe(0);
        expect(opacity(u.starsFar)).toBe(0);
        expect(u.nebulaField.userData.uReveal.value).toBe(0);
        expect(u.blackHole.userData.uReveal.value).toBe(0);
        expect(u.blackHole.visible).toBe(true);
        expect(u.debris.visible).toBe(false);
        expect(u.diskLight.intensity).toBe(0);
    });

    it('brings up the Milky Way before the gas, and the gas before the hole\'s light', () => {
        play(at(DEEP_SPACE_BEATS.nebula[0]));
        expect(u.uniforms.uVoidSkyGlow.value).toBeGreaterThan(0.4);
        expect(u.nebulaField.userData.uReveal.value).toBe(0);
        play(at(DEEP_SPACE_BEATS.hole[0]));
        expect(u.nebulaField.userData.uReveal.value).toBeGreaterThan(0.2);
        expect(u.blackHole.userData.uReveal.value).toBe(0);
    });

    it('has the whole sky up once the beats are done', () => {
        play(at(DEEP_SPACE_BEATS.hole[1]) + 0.002);
        expect(u.uniforms.uVoidSkyGlow.value).toBe(1);
        expect(opacity(u.starsFar)).toBeGreaterThan(0.95);
        expect(u.nebulaField.userData.uReveal.value).toBeGreaterThan(0.95);
        expect(u.blackHole.userData.uReveal.value).toBeGreaterThan(0.95);
        expect(u.debris.visible).toBe(true);
    });
});

describe('the void dome\'s glow', () => {
    it('defaults whole (chapter 7 seats the same sky) and builds on both backends', () => {
        const { mesh } = createBakedVoidSkyTSL(uniform(0), uniform(0.3), uniform(1), {}, uniform(0.5));
        [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
            const out = build(Builder, mesh);
            expect(out.thrown, `${label} ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard, label).toEqual([]);
            expect(out.fragment, label).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            if (label === 'WGSL') expect(unassignedReads(out.fragment)).toEqual([]);
        });
        expect(createBakedVoidSkyTSL.length).toBeLessThanOrEqual(5);
    });
});
