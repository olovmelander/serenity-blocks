/**
 * ONE ENCOUNTER PER STRETCH (2026-10-22). Olov: the big fishes and sea creatures in chapter 2 "do
 * not work good". In the live journey every animal circled the rail itself, the visitors followed
 * the eye and their stretches overlapped, so at orbs 8-9 the whale shark, the manta and both
 * whales crowded one frame 40-75 u from the eye, over each other and the orb.
 *
 * Now each animal has one place in the sea and its own stretch of the climb, keyed to where the
 * journey parks the eye: the whale shark over orbs 6-8, the whales over orb 9, the manta under the
 * surface ahead of orb 10. Played on the real camera (tests/unit/helpers/odyssey-camera-rig.js).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    OCEAN_VISITOR_CAST, resolveOceanVisitorCentre, stepVisitorPassage,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-visitors.js';
import { WHALE_PASS_STAGE } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const DT = 1 / 30;

describe("chapter 2's sea life: one encounter per stretch (real camera)", () => {
    const rig = createOdysseyCameraRig();
    const [c1, c2] = [rig.cp[1], rig.cp[2]];
    const centreOf = (at) => getOdysseyPathPointAt(c1 + ((c2 - c1) * at));
    const shark = OCEAN_VISITOR_CAST.find((c) => c.name === 'whaleShark');
    const manta = OCEAN_VISITOR_CAST.find((c) => c.name === 'manta');
    const encounters = {
        whaleShark: { window: shark.window, orbs: [6, 7, 8] },
        whales: { window: WHALE_PASS_STAGE.window, orbs: [9] },
        manta: { window: manta.window, orbs: [10] },
    };
    const eyeAt = (p) => rig.poseAt(p).position.y;
    const inWater = (p, eyeY) => p > c1 && p < c2 + 0.01 && eyeY < ODYSSEY_SEA_LEVEL - 5;

    /** The journey through the ocean: a one-second glide to each orb, then a park. */
    function* journey(ids, parkS = 20) {
        let p = rig.parkOf(ids[0]);
        for (let i = 1; i < ids.length; i += 1) {
            const to = rig.parkOf(ids[i]);
            for (let t = 0; t < 1; t += DT) yield { p: p + ((to - p) * t) };
            for (let t = 0; t < parkS; t += DT) yield { p: to, parkedAt: ids[i], last: t + DT >= parkS };
            p = to;
        }
    }

    function play(ids, onStep) {
        const states = Object.fromEntries(Object.keys(encounters).map((k) => [k, {}]));
        for (const step of journey(ids)) {
            const camY = eyeAt(step.p);
            const on = inWater(step.p, camY);
            Object.entries(encounters).forEach(([name, e]) => {
                stepVisitorPassage(states[name], {
                    camY, on, dt: DT, window: e.window,
                });
            });
            onStep(step, states);
        }
    }

    it('meets one animal at a time, and the one that belongs to each orb', () => {
        const company = [];
        play([5, 6, 7, 8, 9, 10, 11], (step, states) => {
            const with_ = Object.keys(states).filter((k) => states[k].phase === 'in');
            expect(with_.length, `with ${with_.join(', ')} at p=${step.p.toFixed(4)}`).toBeLessThanOrEqual(1);
            if (step.last) company.push([step.parkedAt, with_[0] ?? null]);
        });
        expect(company).toEqual([
            [6, 'whaleShark'], [7, 'whaleShark'], [8, 'whaleShark'], [9, 'whales'], [10, 'manta'], [11, null],
        ]);
    });

    it('swaps them back when the eye goes back down', () => {
        const company = [];
        play([7, 9, 8, 9, 10, 9], (step, states) => {
            if (step.last) company.push([step.parkedAt, Object.keys(states).find((k) => states[k].phase === 'in') ?? null]);
        });
        expect(company).toEqual([[9, 'whales'], [8, 'whaleShark'], [9, 'whales'], [10, 'manta'], [9, 'whales']]);
    });

    /** One lap of an animal's loop, as world points. */
    function lap(centre, radius, y) {
        return Array.from({ length: 72 }, (_, i) => {
            const a = (i / 72) * Math.PI * 2;
            return new THREE.Vector3(centre.x + (Math.cos(a) * radius), y, centre.z + (Math.sin(a) * radius));
        });
    }
    const places = {
        whaleShark: { size: shark.size, points: lap(resolveOceanVisitorCentre(shark, rig.cp), shark.loop.radius, shark.y) },
        whales: {
            size: 58,
            points: lap(centreOf(WHALE_PASS_STAGE.at), WHALE_PASS_STAGE.mother.radius, ODYSSEY_SEA_LEVEL - WHALE_PASS_STAGE.mother.depth),
        },
        manta: { size: manta.size, points: lap(resolveOceanVisitorCentre(manta, rig.cp), manta.loop.radius, manta.y) },
    };

    Object.entries(encounters).forEach(([name, e]) => {
        it(`${name}: in frame most of a lap from its orbs, never over the orb, at a readable size`, () => {
            const { size, points } = places[name];
            e.orbs.forEach((id) => {
                const camera = rig.poseAt(rig.parkOf(id));
                const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
                // The orb on screen (a chapter's first orbs park the eye a little way past them,
                // where the orb is behind the eye and cannot be covered).
                const orbPoint = getOdysseyPathPointAt(rig.layout.levelPositionsById[id]);
                const orbShown = rig.inFrame(camera, orbPoint, 1);
                const orb = orbPoint.clone().project(camera);
                let seen = 0;
                let overOrb = 0;
                points.forEach((pt) => {
                    if (!rig.inFrame(camera, pt, 0.92)) return;
                    seen += 1;
                    const ndc = pt.clone().project(camera);
                    if (orbShown && Math.hypot((ndc.x - orb.x) * camera.aspect, ndc.y - orb.y) < 0.45) overOrb += 1;
                    // Its length on screen, as a share of the frame's height: never a speck, never
                    // more than the frame.
                    const length = (size / pt.distanceTo(camera.position)) / (2 * tanHalf);
                    expect(length, `${name} from orb ${id}`).toBeGreaterThan(0.25);
                    expect(length, `${name} from orb ${id}`).toBeLessThan(0.95);
                });
                expect(seen / points.length, `${name} in frame from orb ${id}`).toBeGreaterThan(0.8);
                expect(overOrb / points.length, `${name} over orb ${id}`).toBeLessThan(0.1);
            });
        });
    });
});
