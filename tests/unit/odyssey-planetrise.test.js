/**
 * THE PLANETRISE (2026-10-24, step 4 of docs/ODYSSEY_INTO_SPACE_2026-10.md). Olov asked how to
 * "improve the reveal of the planet"; the agreed plan: no fade, the ringed giant rises over the
 * Earth's edge. Played here on the game's own camera (the real controller over the real spline,
 * leaning down over the Earth) with the real chapter-6 environment: the giant hangs behind the
 * Earth's limb until its rise, comes over the edge while the aurora is up, and is clear of the
 * limb when the rise ends. The Earth is drawn in front of it (and behind any orb over its disc).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { getChapterPathRange, getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import {
    ORBIT_EARTH,
    ORBIT_EARTH_COVERS,
    ORBIT_EARTH_SCHEDULE,
    orbitEarthAt,
} from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const DEG = 180 / Math.PI;

describe('the ringed giant rises over the Earth\'s edge', () => {
    const rig = createOdysseyCameraRig();
    const { cp } = rig;
    const span = cp[6] - cp[5];
    const riseFrom = cp[5] - span * ORBIT_EARTH_SCHEDULE.rise[0];
    const riseTo = cp[5] + span * ORBIT_EARTH_SCHEDULE.rise[1];
    const env = createCosmicExpanseEnvironment({ particleCount: 200 });
    const range = getChapterPathRange(6);
    env.position.set(range.center.x, range.center.y, range.center.z);
    env.userData.yStart = range.start.y;
    env.userData.yEnd = range.end.y;
    env.userData.chapterOpacity = 1;
    const giant = env.userData.heroPlanet;
    const air = giant.getObjectByName('hero-planet-atmosphere');
    const rings = giant.getObjectByName('hero-planet-rings');
    const body = giant.getObjectByName('hero-planet-surface');
    const v = new THREE.Vector3();

    /** The giant's highest and lowest elevation (deg) from the eye: its air, its rings, its body. */
    const at = (p) => {
        const cam = rig.poseAt(p);
        updateCosmicExpanseEnvironment(env, 0.016, 1, cam, p);
        env.updateMatrixWorld(true);
        const elevations = (mesh) => {
            const pos = mesh.geometry.attributes.position;
            let top = -90;
            let bottom = 90;
            let near = Infinity;
            for (let i = 0; i < pos.count; i += 1) {
                v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(cam.position);
                const d = v.length();
                const el = Math.asin(v.y / d) * DEG;
                top = Math.max(top, el);
                bottom = Math.min(bottom, el);
                near = Math.min(near, d);
            }
            return { top, bottom, near };
        };
        const earth = orbitEarthAt(p, cp);
        return {
            earth,
            limb: -earth.dip * DEG,
            air: elevations(air),
            rings: elevations(rings),
            body: elevations(body),
            opacity: giant.userData.planet.material.opacity,
        };
    };

    it('hangs wholly behind the limb from its reveal until it rises', () => {
        let shown = 0;
        for (let p = riseFrom - 0.04; p <= riseFrom; p += 0.002) {
            const s = at(p);
            if (s.opacity < 0.01) continue;
            shown += 1;
            const top = Math.max(s.air.top, s.rings.top);
            expect(s.earth.presence, `p ${p.toFixed(4)}`).toBeGreaterThanOrEqual(ORBIT_EARTH_COVERS);
            expect(top, `p ${p.toFixed(4)}: top ${top.toFixed(1)} vs limb ${s.limb.toFixed(1)}`)
                .toBeLessThan(s.limb - 1);
        }
        expect(shown).toBeGreaterThan(5);
    });

    it('comes over the edge while the aurora is up, and its body is clear when the rise ends', () => {
        let first = null;
        let clear = null;
        for (let p = riseFrom; p <= riseTo; p += 0.0005) {
            const s = at(p);
            if (first === null && Math.max(s.air.top, s.rings.top) > s.limb) first = p;
            if (clear === null && s.body.bottom > s.limb) clear = p;
        }
        expect(first).not.toBeNull();
        expect(clear).not.toBeNull();
        expect(clear).toBeGreaterThan(first + 0.005);
        expect(orbitEarthAt(first, cp).aurora, `first light ${first.toFixed(4)}`).toBeGreaterThan(0.9);
        expect(orbitEarthAt(clear, cp).aurora, `clear ${clear.toFixed(4)}`).toBeGreaterThan(0.9);
        const end = at(riseTo);
        expect(end.body.bottom).toBeGreaterThan(end.limb + 5);
        expect(end.opacity).toBeGreaterThan(0.95);
    });

    it('is drawn behind the Earth, and every orb over the disc in front of it', () => {
        // The Earth's backdrop comes in to `frontRadius` once it covers the world: nearer than any
        // part of the giant while it does, farther than any orb seen over its disc.
        const orbs = Object.values(rig.layout.levelPositionsById)
            .filter((q) => q > cp[5] - span && q < cp[6])
            .map((q) => getOdysseyPathCurve().getPointAt(q));
        const poses = [];
        for (let p = cp[5] - span; p <= cp[6]; p += 0.0025) poses.push(p);
        const at6 = (id) => rig.layout.levelPositionsById[id];
        Object.keys(rig.layout.levelPositionsById).map(Number)
            .filter((id) => at6(id) > cp[5] - span && at6(id) < cp[6])
            .forEach((id) => poses.push(rig.parkOf(id)));
        let covered = 0;
        poses.forEach((p) => {
            const s = at(p);
            if (s.earth.presence < ORBIT_EARTH_COVERS) return;
            covered += 1;
            const nearest = Math.min(s.body.near, s.rings.near, s.air.near);
            expect(nearest, `giant @${p.toFixed(4)}`).toBeGreaterThan(ORBIT_EARTH.frontRadius * 1.1);
            const cam = rig.camera;
            orbs.forEach((pt) => {
                if (!rig.inFrame(cam, pt, 1.05)) return;
                v.copy(pt).sub(cam.position);
                const el = Math.asin(v.y / v.length()) * DEG;
                if (el < s.limb) {
                    const where = `orb over the disc @${p.toFixed(4)}`;
                    expect(v.length(), where).toBeLessThan(ORBIT_EARTH.frontRadius * 0.9);
                }
            });
        });
        expect(covered).toBeGreaterThan(20);
    });
});
