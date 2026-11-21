import { readFileSync } from 'node:fs';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEG, EYE, GALE_REST } from '../../src/themes/himalayan-peak/himalayan-peak-core.js';
import {
    EAGLE_BONES, EAGLE_SPAN, createEaglePose, createEagleRoute, eagleBout,
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
    it('reconstructs a seek from its seed while each session and successive pass vary', () => {
        const route = createEagleRoute(43);
        const replay = createEagleRoute(43);
        const other = createEagleRoute(420);
        for (const t of [0, 31.3, 225, 15000]) {
            const at = eaglePath(t, undefined, route);
            expect(eaglePath(t, undefined, replay)).toEqual(at);
            const next = eaglePath(t + 84, undefined, route);
            const elsewhere = eaglePath(t, undefined, other);
            expect(Math.hypot(at.x - next.x, at.z - next.z)).toBeGreaterThan(4);
            expect(Math.hypot(at.x - elsewhere.x, at.z - elsewhere.z)).toBeGreaterThan(4);
        }
    });

    it('sweeps close then climbs back offshore, always in the sky beside the board', () => {
        for (const seed of [3187, 99, 6, 43]) {
            const route = createEagleRoute(seed);
            const distances = [];
            for (let time = 0; time < 360; time += 0.5) {
                const at = seen(eaglePath(time, undefined, route));
                distances.push(at.distance);
                expect(at.bearing).toBeGreaterThan(14);
                expect(at.bearing).toBeLessThan(47);
                expect(at.elevation).toBeGreaterThan(10);
                expect(at.elevation).toBeLessThan(21);
                const calm = seen(eaglePath(time, undefined, route, true));
                expect(calm.distance).toBeGreaterThan(169);
            }
            expect(Math.min(...distances)).toBeGreaterThan(50);
            expect(Math.min(...distances)).toBeLessThan(90);
            expect(Math.max(...distances)).toBeGreaterThan(340);
        }
    });

    it('heads the way it flies, leans into every turn and never more than a soaring bird does', () => {
        for (let time = 0; time < 120; time += 0.37) {
            const at = eaglePath(time);
            expect(Math.hypot(at.hx, at.hy, at.hz)).toBeCloseTo(1, 9);
            const next = eaglePath(time + 0.01);
            const vx = next.x - at.x;
            const vz = next.z - at.z;
            const along = (vx * at.hx + vz * at.hz) / (Math.hypot(vx, vz) * Math.hypot(at.hx, at.hz));
            expect(along).toBeGreaterThan(0.9999);
            // It climbs and sinks on its turns, never steeply.
            expect(Math.abs(at.hy)).toBeLessThan(0.47);
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
        for (let time = 0; time < 120; time += 0.05) {
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
        for (let time = 0; time < 120; time += 0.5) {
            eagleFlight(time, { reduced: true }, pose);
            if (Math.abs(pose.path.lean) < 0.1) continue;
            // Its left wing is down (left vector below level) exactly when it turns left.
            expect(Math.sign(-pose.left[1]), `t=${time}`).toBe(Math.sign(pose.path.lean));
            checked += 1;
        }
        expect(checked).toBeGreaterThan(50);
    });

    it('glides most of the time and varies bouts without a phase jump even after a long seek', () => {
        const step = 1 / 60;
        for (const start of [0, 39241]) {
            let flapping = 0;
            let bouts = 0;
            let last = eagleBout(start);
            const rates = new Set();
            for (let i = 1; i <= 160 * 60; i++) {
                const current = eagleBout(start + i * step);
                if (current.amount > 0) {
                    flapping += step;
                    if (last.amount === 0) bouts++;
                    else {
                        const frequency = ((current.phase - last.phase + 1) % 1) / step;
                        expect(frequency).toBeGreaterThan(1.09);
                        expect(frequency).toBeLessThan(1.47);
                        rates.add(frequency.toFixed(2));
                    }
                }
                last = current;
            }
            expect(bouts).toBeGreaterThan(2);
            expect(rates.size).toBeGreaterThan(2);
            expect(flapping / 160).toBeLessThan(0.15);
        }
    });

    it('moves every joint smoothly at 60 Hz, in calm air and in a storm that rises and falls', () => {
        const pose = createEaglePose();
        const last = {};
        let gale = GALE_REST;
        const most = { any: 0, glide: 0 };
        const step = 1 / 60;
        for (let i = 0; i < 120 * 60; i++) {
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
        for (const t of [29.75, 31.25, 50, 6000]) {
            eagleFlight(t, { reduced: true, gale: GALE_REST + 1.5 }, pose);
            expect(pose.bout.amount).toBe(0);
            expect(Math.abs(pose.heave)).toBe(0);
        }
    });

    it('holds a shallow V when it soars', () => {
        const pose = createEaglePose();
        eagleFlight(20, {}, pose);
        expect(pose.bout.amount).toBe(0);
        const dihedral = pose.joints.armL[2] / DEG;
        expect(dihedral).toBeGreaterThan(3);
        expect(dihedral).toBeLessThan(12);
        // Mirrored: the right wing's angles about y and z are the left's, negated.
        expect(pose.joints.armR[2]).toBeCloseTo(-pose.joints.armL[2], 0);
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
        expect(triangles).toBeLessThan(16000);
        expect(gltf.animations.map((clip) => clip.name)).toEqual(['Ridge Wingbeat']);
        expect(gltf.animations[0].duration).toBeCloseTo(1);
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
        expect(thin / colour.count).toBeGreaterThan(0.25);
        expect(thin / colour.count).toBeLessThan(0.95);
        // Feather-local UVs distinguish inscribed vanes, rows of short contour feathers,
        // and bare skin. All three survive the Blender export without an image texture.
        const uv = skinned.geometry.getAttribute('uv');
        const u = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
        expect(u.some((x) => x < 0)).toBe(true);
        expect(u.some((x) => x > 0.3 && x < 0.7)).toBe(true);
        expect(u.some((x) => x > 2)).toBe(true);
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
        // Sample the shipped GLB through the same blend used in the game. A strong
        // downstroke leads the wrist, with splayed and individually flexing primaries.
        const euler = new THREE.Euler(0, 0, 0, 'ZYX');
        const hand = model.getObjectByName('handL');
        let top = -Infinity;
        let bottom = Infinity;
        let atBottom = 0;
        let wristBottom = Infinity;
        let wristAtBottom = 0;
        const last = new THREE.Quaternion();
        for (let i = 0; i <= 360; i++) {
            const t = 29.75 + i / 120;
            eagle.update(t);
            if (i > 0) expect(wing.quaternion.angleTo(last)).toBeLessThan(0.072);
            last.copy(wing.quaternion);
            // The first complete cycle, clear of the blend at either end of the bout.
            if (t < 30.30 || t > 31.06) continue;
            const armZ = euler.setFromQuaternion(wing.quaternion, 'ZYX').z / DEG;
            const handZ = euler.setFromQuaternion(hand.quaternion, 'ZYX').z / DEG;
            top = Math.max(top, armZ);
            if (armZ < bottom) { bottom = armZ; atBottom = t; }
            if (handZ < wristBottom) { wristBottom = handZ; wristAtBottom = t; }
        }
        expect(top).toBeGreaterThan(34);
        expect(bottom).toBeLessThan(-26);
        expect(wristAtBottom - atBottom).toBeGreaterThan(0.035);
        expect(wristAtBottom - atBottom).toBeLessThan(0.13);
        eagle.dispose();
        world.dispose();
    });
});
