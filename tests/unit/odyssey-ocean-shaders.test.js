/**
 * THE OCEAN'S NEW SURFACES BUILD CLEAN (masterpiece pass, 2026-11-17), on both backends and both
 * tiers: the reef's rock and kelp, the sweeping shafts, the breach's drops and its sheet, and the
 * sea itself (whose underside now carries Snell's window with the world in it and the mirror
 * outside it). No throw, nothing said, no NaN or Infinity in the source, and no var read before it
 * is certainly assigned (the window is built inside a uniform branch of the underside's own
 * branch: exactly where that trap is set).
 *
 * And the world keeps the sea's rules for them: submitted only while the eye is in the water,
 * behind the 1->2 steam, with the depth arc's light.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyWorld } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_SEA_LEVEL } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { OCEAN_SHAFTS } from '../../src/rendering/odyssey/world/odyssey-ocean-scenery.js';
import { BREACH_BURST } from '../../src/rendering/odyssey/composition/odyssey-breach-burst.js';
import { DOLPHIN_POD } from '../../src/rendering/odyssey/composition/odyssey-dolphin-pod.js';

const railSamples = Array.from({ length: 48 }, (_, i) => {
    const pt = getOdysseyPathPointAt(i / 47);
    return { x: pt.x, y: pt.y, z: pt.z };
});
const NAMES = [
    'odyssey-ocean-reef', 'odyssey-ocean-kelp-forest', 'odyssey-ocean-shafts',
    'odyssey-breach-drops', 'odyssey-breach-sheet', 'odyssey-world-water',
    'odyssey-dolphins', 'odyssey-dolphin-splashes', 'odyssey-dolphin-bubbles',
];
const SEA = ODYSSEY_SEA_LEVEL;

describe("the ocean's new surfaces build clean", () => {
    ['high', 'low'].forEach((quality) => {
        it(`${quality}: reef, kelp, shafts, the breach and the sea's underside`, () => {
            const world = createOdysseyWorld({
                quality, forest: false, cloudField: false, railSamples,
            });
            NAMES.forEach((name) => {
                const mesh = world.group.getObjectByName(name);
                expect(mesh, name).toBeTruthy();
                expect(mesh.material.fog, name).toBe(false);
                [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
                    const out = build(Builder, mesh);
                    const tag = `${quality} ${name} ${label}`;
                    expect(out.thrown, `${tag} ${out.thrown?.stack ?? ''}`).toBeUndefined();
                    expect(out.heard, tag).toEqual([]);
                    expect(out.fragment, tag).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    expect(out.vertex, tag).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    if (label === 'WGSL') expect(unassignedReads(out.fragment), tag).toEqual([]);
                    if (label === 'WGSL' && name === 'odyssey-world-water') {
                        // Snell's window is in the underside, and the land march only on the High tier.
                        expect(out.fragment, tag).toMatch(/wSnellWorld/);
                    }
                });
            });
            // Tier gating is in JavaScript: fewer shafts and drops are built, not hidden.
            const shafts = world.group.getObjectByName('odyssey-ocean-shafts');
            const drops = world.group.getObjectByName('odyssey-breach-drops');
            expect(shafts.geometry.instanceCount).toBe(quality === 'low' ? OCEAN_SHAFTS.lowCount : OCEAN_SHAFTS.count);
            expect(drops.geometry.instanceCount).toBe(quality === 'low' ? BREACH_BURST.crown.lowCount : BREACH_BURST.crown.count);
            const pod = world.group.getObjectByName('odyssey-dolphins');
            expect(pod.geometry.instanceCount).toBe(quality === 'low' ? DOLPHIN_POD.lowCount : DOLPHIN_POD.dolphins.length);
            world.dispose?.();
        }, 180_000);
    });
});

describe("the world draws them by the sea's rules", () => {
    const world = createOdysseyWorld({
        quality: 'low', forest: false, cloudField: false, railSamples,
    });
    const get = (name) => world.group.getObjectByName(name);
    const rail = { x: -8, y: 150, z: 3 };
    const camera = (y) => {
        const cam = new THREE.PerspectiveCamera(58, 1.6, 0.1, 9000);
        cam.position.set(-8, y, 3);
        cam.updateMatrixWorld(true);
        return cam;
    };

    it('submits the reef only while the eye is in the water, behind the steam like the spires', () => {
        const reef = get('odyssey-ocean-reef');
        const kelp = get('odyssey-ocean-kelp-forest');
        expect(reef.material.depthNode).toBeTruthy();
        expect(kelp.material.depthNode).toBeTruthy();
        world.setQuenchCarry(1);
        world.update(1, rail, 0.05, SEA - 175, camera(SEA - 175));
        expect(reef.visible).toBe(true);
        expect(kelp.visible).toBe(true);
        // In the abyss the thin shafts of the upper water are not there to draw.
        expect(get('odyssey-ocean-shafts').visible).toBe(false);
        world.update(1.02, rail, 0.09, SEA - 40, camera(SEA - 40));
        expect(get('odyssey-ocean-shafts').visible).toBe(true);
        // Out of the water (the sea is opaque from above): nothing of the reef is submitted.
        world.update(1.04, rail, 0.11, SEA + 20, camera(SEA + 20));
        expect(reef.visible).toBe(false);
        expect(kelp.visible).toBe(false);
        expect(get('odyssey-ocean-shafts').visible).toBe(false);
    });

    it('keeps the dolphins drawn from under the water and from over it, and never switches them near', () => {
        const pod = get('odyssey-dolphin-pod');
        world.setQuenchCarry(1);
        world.update(40, rail, 0.1, SEA - 20, camera(SEA - 20));
        expect(pod.visible).toBe(true);
        // The splashes belong to the air: under the surface they are not submitted. What an eye
        // under the water sees instead is the air the dolphins take down, and the churn.
        expect(get('odyssey-dolphin-splashes').visible).toBe(false);
        expect(get('odyssey-dolphin-bubbles').visible).toBe(true);
        world.setQuenchCarry(1);
        world.update(40.02, rail, 0.106, SEA + 6, camera(SEA + 6));
        expect(pod.visible).toBe(true);
        expect(get('odyssey-dolphin-splashes').visible).toBe(true);
        expect(get('odyssey-dolphin-bubbles').visible).toBe(false);
        // Far up the climb the pod has shrunk to nothing before it is no longer drawn.
        const far = new THREE.PerspectiveCamera(58, 1.6, 0.1, 9000);
        far.position.set(-8, SEA + 3200, 3);
        far.updateMatrixWorld(true);
        world.setQuenchCarry(1);
        world.update(60, rail, 0.3, SEA + 3200, far);
        expect(pod.visible).toBe(false);
    });

    it('waits for the 1->2 carry, as the sea\'s life does', () => {
        world.setQuenchCarry(0.45);
        world.update(2, rail, 0.05, SEA - 150, camera(SEA - 150));
        expect(get('odyssey-ocean-reef').visible).toBe(false);
        world.setQuenchCarry(1);
        world.update(2.02, rail, 0.05, SEA - 150, camera(SEA - 150));
        expect(get('odyssey-ocean-reef').visible).toBe(true);
    });

    it('fires the breach when the eye breaks the surface and lets it finish on the clock', () => {
        const burst = get('odyssey-breach-burst');
        world.setQuenchCarry(1);
        world.update(10, rail, 0.1, SEA - 3, camera(SEA - 3));
        expect(burst.visible).toBe(false);
        world.update(10.016, rail, 0.104, SEA + 0.5, camera(SEA + 0.5));
        expect(burst.visible).toBe(true);
        expect(get('odyssey-breach-sheet').visible).toBe(true);
        world.setQuenchCarry(1);
        world.update(11.2, rail, 0.11, SEA + 9, camera(SEA + 9));
        expect(burst.visible).toBe(true);
        world.setQuenchCarry(1);
        world.update(14, rail, 0.12, SEA + 20, camera(SEA + 20));
        expect(burst.visible).toBe(false);
        // Diving back in: bubbles, and no sheet on the lens.
        world.setQuenchCarry(1);
        world.update(20, rail, 0.106, SEA + 1, camera(SEA + 1));
        world.setQuenchCarry(1);
        world.update(20.016, rail, 0.103, SEA - 1, camera(SEA - 1));
        expect(burst.visible).toBe(true);
        expect(get('odyssey-breach-sheet').visible).toBe(false);
        // A teleport across the surface is not a breach.
        world.setQuenchCarry(1);
        world.update(30, rail, 0.05, SEA - 120, camera(SEA - 120));
        world.setQuenchCarry(1);
        world.update(30.016, rail, 0.3, SEA + 300, camera(SEA + 300));
        expect(burst.visible).toBe(false);
    });
});
