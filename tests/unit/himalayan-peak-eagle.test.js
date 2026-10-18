import { readFileSync } from 'node:fs';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEG, EYE, GALE_REST } from '../../src/themes/himalayan-peak/himalayan-peak-core.js';
import {
    EAGLE_BEAT, EAGLE_BONES, EAGLE_BOUTS, EAGLE_ROUND, EAGLE_SPAN, beatHeight, createEaglePose, eagleBout,
    eagleFlight, eaglePath,
} from '../../src/themes/himalayan-peak/himalayan-peak-eagle-flight.js';
import { createEagle } from '../../src/themes/himalayan-peak/himalayan-peak-eagle.js';
import { HimalayanPeakWorld } from '../../src/themes/himalayan-peak/himalayan-peak-world.js';
import { planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';

/** Bearing right of the view axis, elevation over the eye (degrees), and distance (m). */
function seen(at) {
    const dx = at.x - EYE.x;
    const dz = at.z - EYE.z;
    const flat = Math.hypot(dx, dz);
    return {
        bearing: Math.atan2(dx, -dz) / DEG,
        elevation: Math.atan2(at.y - EYE.y, flat) / DEG,
        distance: flat,
    };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('himalayan peak eagle: its round', () => {
    it('comes round to the same place every round', () => {
        for (const time of [0, 3.7, 20, 51.3, 73.9]) {
            const now = eaglePath(time);
            const later = eaglePath(time + EAGLE_ROUND);
            const much = eaglePath(time + EAGLE_ROUND * 40);
            for (const key of ['x', 'y', 'z', 'hx', 'hy', 'hz', 'lean']) {
                expect(later[key], key).toBeCloseTo(now[key], 7);
                expect(much[key], key).toBeCloseTo(now[key], 5);
            }
        }
        // And it does move in between.
        const a = eaglePath(0);
        const b = eaglePath(EAGLE_ROUND / 6);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(60);
    });

    it('stays in the open sky right of the board, over the ridge and toward the sun', () => {
        const bearings = [];
        for (let time = 0; time < EAGLE_ROUND; time += 0.25) {
            const at = eaglePath(time);
            const { bearing, elevation, distance } = seen(at);
            bearings.push(bearing);
            // Right of the HUD (≈ 22°) for most of the round, and off the frame's right edge
            // (38° in 16:9) only briefly; never in the board's column.
            expect(bearing).toBeGreaterThan(15);
            expect(bearing).toBeLessThan(45);
            // Over the skyline behind it (the ridges stand under 8° there), under the frame's top.
            expect(elevation).toBeGreaterThan(10);
            expect(elevation).toBeLessThan(21);
            expect(distance).toBeGreaterThan(190);
            expect(distance).toBeLessThan(420);
        }
        // About two thirds of the round in the clear sky between the HUD and the edge of a 16:9
        // frame; the rest it slips behind the HUD or out of the frame for a while, as a bird does.
        const inFrame = bearings.filter((b) => b > 22 && b < 38).length / bearings.length;
        expect(inFrame).toBeGreaterThan(0.6);
    });

    it('heads the way it flies, leans into every turn and never more than a soaring bird does', () => {
        for (let time = 0; time < EAGLE_ROUND; time += 0.37) {
            const at = eaglePath(time);
            expect(Math.hypot(at.hx, at.hy, at.hz)).toBeCloseTo(1, 9);
            const next = eaglePath(time + 0.01);
            const vx = next.x - at.x;
            const vz = next.z - at.z;
            const along = (vx * at.hx + vz * at.hz) / (Math.hypot(vx, vz) * Math.hypot(at.hx, at.hz));
            expect(along).toBeGreaterThan(0.9999);
            // It climbs and sinks on its turns, never steeply.
            expect(Math.abs(at.hy)).toBeLessThan(0.2);
            // The turn: + to its left. It leans the same way, as steeply as a thermalling eagle
            // (25° to 45°), never further.
            const turn = at.hz * (next.hx - at.hx) - at.hx * (next.hz - at.hz);
            if (Math.abs(turn) > 1e-5) expect(Math.sign(at.lean)).toBe(Math.sign(turn));
            expect(Math.abs(at.lean)).toBeLessThan(46 * DEG);
        }
    });

    it('writes into the object it is handed', () => {
        const out = {
            x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, lean: 0,
        };
        expect(eaglePath(12, out)).toBe(out);
        expect(out).toEqual(eaglePath(12));
        expect(eaglePath(12)).not.toBe(eaglePath(12));
    });
});

describe('himalayan peak eagle: how it holds itself', () => {
    it('never rolls onto its back, and its frame is a true one', () => {
        // The old bird took its frame from setFromUnitVectors(+z, heading), which turns the
        // model over each time the heading swings through −z: once a round, belly up.
        const pose = createEaglePose();
        for (let time = 0; time < EAGLE_ROUND; time += 0.05) {
            eagleFlight(time, { gale: GALE_REST + 1.4 }, pose);
            // Steep in its turns (with the air's rolls on top), never past ~53°.
            expect(pose.up[1], `t=${time}`).toBeGreaterThan(0.6);
            expect(Math.abs(dot(pose.left, pose.up))).toBeLessThan(1e-9);
            expect(Math.abs(dot(pose.left, pose.forward))).toBeLessThan(1e-9);
            expect(Math.abs(dot(pose.up, pose.forward))).toBeLessThan(1e-9);
            expect(Math.hypot(...pose.left)).toBeCloseTo(1, 9);
            expect(Math.hypot(...pose.up)).toBeCloseTo(1, 9);
            // Right-handed: left × up = forward.
            const [a, b] = [pose.left, pose.up];
            const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            expect(dot(cross, pose.forward)).toBeCloseTo(1, 9);
        }
    });

    it('puts the wing on the inside of a turn down', () => {
        const pose = createEaglePose();
        let checked = 0;
        for (let time = 0; time < EAGLE_ROUND; time += 0.5) {
            eagleFlight(time, { reduced: true }, pose);
            if (Math.abs(pose.path.lean) < 0.1) continue;
            // Its left wing is down (left vector below level) exactly when it turns left.
            expect(Math.sign(-pose.left[1]), `t=${time}`).toBe(Math.sign(pose.path.lean));
            checked += 1;
        }
        expect(checked).toBeGreaterThan(50);
    });

    it('glides most of the round and flaps in short bouts of whole beats', () => {
        let flapping = 0;
        const step = 1 / 60;
        for (let time = 0; time < EAGLE_ROUND; time += step) {
            if (eagleBout(time).amount > 0) flapping += step;
        }
        const scheduled = EAGLE_BOUTS.reduce((sum, [, beats]) => sum + beats / EAGLE_BEAT, 0);
        expect(flapping).toBeCloseTo(scheduled, 0);
        expect(flapping / EAGLE_ROUND).toBeLessThan(0.12);
        // A bout ends where it began: wings at the top of the beat, eased out.
        EAGLE_BOUTS.forEach(([start, beats]) => {
            const end = eagleBout(start + beats / EAGLE_BEAT - 1e-6);
            expect(end.amount).toBeLessThan(1e-3);
            // The downstroke is the quicker, stronger part: the bottom comes at 55 % of the beat.
            expect(beatHeight(eagleBout(start + 0.55 / EAGLE_BEAT).phase)).toBeCloseTo(-1, 6);
        });
    });

    it('beats at one pace however long the game has run (no clock × changing rate)', () => {
        const [start, beats] = EAGLE_BOUTS[2];
        for (const round of [0, 1, 7, 40]) {
            const base = round * EAGLE_ROUND + start + 1 / EAGLE_BEAT;
            const a = eagleBout(base);
            const b = eagleBout(base + 1 / 60);
            const advance = (b.phase - a.phase + 1) % 1;
            expect(advance, `round ${round}`).toBeCloseTo(EAGLE_BEAT / 60, 6);
            expect(beats).toBeGreaterThan(1);
        }
    });

    it('moves every joint smoothly at 60 Hz, in calm air and in a storm that rises and falls', () => {
        const pose = createEaglePose();
        const last = {};
        let gale = GALE_REST;
        const most = { any: 0, glide: 0 };
        const step = 1 / 60;
        for (let i = 0; i < EAGLE_ROUND * 60; i++) {
            const time = 600 + i * step;
            // The world eases its gale toward what is asked (GALE_EASE); ask hard, then let go.
            const asked = Math.sin(time * 0.3) > 0.6 ? GALE_REST + 1.5 : GALE_REST;
            gale += (asked - gale) * (1 - Math.exp(-5 * step));
            eagleFlight(time, { gale }, pose);
            const flapping = pose.bout.amount > 0;
            for (const name of EAGLE_BONES) {
                const j = pose.joints[name];
                const was = last[name];
                if (was) {
                    const turn = Math.max(...j.map((v, k) => Math.abs(v - was[k]))) / DEG;
                    most.any = Math.max(most.any, turn);
                    if (!flapping) most.glide = Math.max(most.glide, turn);
                }
                last[name] = [...j];
            }
        }
        const worst = most.any;
        const worstGlide = most.glide;
        // A wingbeat is quick (about 6° a frame at the shoulder); a glide only drifts.
        expect(worst).toBeLessThan(8);
        expect(worstGlide).toBeLessThan(1.5);
    });

    it('only glides under reduced motion, and the air hardly moves it', () => {
        const pose = createEaglePose();
        EAGLE_BOUTS.forEach(([start, beats]) => {
            eagleFlight(start + beats / EAGLE_BEAT / 2, { reduced: true, gale: GALE_REST + 1.5 }, pose);
            expect(pose.bout.amount).toBe(0);
            expect(Math.abs(pose.heave)).toBe(0);
        });
    });

    it('holds a shallow V when it soars, and sweeps through a deep beat when it flaps', () => {
        const pose = createEaglePose();
        eagleFlight(20, {}, pose);
        expect(pose.bout.amount).toBe(0);
        const dihedral = pose.joints.armL[2] / DEG;
        expect(dihedral).toBeGreaterThan(3);
        expect(dihedral).toBeLessThan(12);
        // Mirrored: the right wing's angles about y and z are the left's, negated.
        expect(pose.joints.armR[2]).toBeCloseTo(-pose.joints.armL[2], 0);
        const [start, beats] = EAGLE_BOUTS[0];
        let top = -Infinity;
        let bottom = Infinity;
        for (let t = start; t < start + beats / EAGLE_BEAT; t += 1 / 120) {
            eagleFlight(t, {}, pose);
            top = Math.max(top, pose.joints.armL[2] / DEG);
            bottom = Math.min(bottom, pose.joints.armL[2] / DEG);
        }
        expect(top).toBeGreaterThan(35);
        expect(bottom).toBeLessThan(-25);
    });
});

describe('himalayan peak eagle: the model', () => {
    let gltf;
    beforeAll(async () => {
        const file = readFileSync(new URL('../../src/themes/himalayan-peak/assets/eagle.glb', import.meta.url));
        const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        gltf = await new GLTFLoader().parseAsync(bytes, '');
    });

    it('is a small skinned bird with every joint the flight poses, each at rest unturned', () => {
        let skinned = null;
        let triangles = 0;
        gltf.scene.traverse((child) => {
            if (child.isSkinnedMesh) skinned = child;
            if (child.isMesh) triangles += child.geometry.index.count / 3;
        });
        expect(skinned).toBeTruthy();
        expect(triangles).toBeLessThan(4000);
        expect(gltf.animations).toHaveLength(0);
        const names = skinned.skeleton.bones.map((b) => b.name);
        expect([...names].sort()).toEqual([...EAGLE_BONES].sort());
        skinned.skeleton.bones.forEach((bone) => {
            expect(bone.quaternion.angleTo(new THREE.Quaternion()), bone.name).toBeLessThan(1e-4);
        });
        // Plumage in RGB, and in alpha which of it is thin feather.
        const colour = skinned.geometry.getAttribute('color');
        expect(colour.itemSize).toBe(4);
        let thin = 0;
        for (let i = 0; i < colour.count; i++) thin += colour.getW(i) > 0.5 ? 1 : 0;
        expect(thin / colour.count).toBeGreaterThan(0.3);
        expect(thin / colour.count).toBeLessThan(0.95);
    });

    it('is built at an eagle\'s size, wings out along x, and drawn at the theme\'s span', () => {
        const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
        expect(size.x).toBeGreaterThan(1.9);
        expect(size.x).toBeLessThan(2.3);
        expect(size.z).toBeGreaterThan(0.7);
        expect(size.z).toBeLessThan(1.0);
        const world = new HimalayanPeakWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, massif: planMassif(64), eagle: false,
        }).build();
        const eagle = createEagle(world.u, gltf);
        const model = eagle.mesh.children[0];
        expect(model.scale.x * size.x).toBeCloseTo(EAGLE_SPAN, 6);
        // Posed where its flight says, framed by its own axes, on an upright screen too.
        eagle.update(10, { squeeze: 0.6 });
        const at = eaglePath(10);
        expect(eagle.mesh.position.x).toBeCloseTo(at.x * 0.6, 6);
        expect(eagle.mesh.position.y).toBeCloseTo(at.y, 6);
        expect(eagle.mesh.scale.x).toBe(1);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(eagle.mesh.quaternion);
        expect(forward.x).toBeCloseTo(at.hx, 6);
        expect(forward.z).toBeCloseTo(at.hz, 6);
        const wing = model.getObjectByName('armL');
        expect(wing.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.02);
        eagle.dispose();
        world.dispose();
    });
});
