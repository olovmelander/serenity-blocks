/**
 * Vesper Chrysalis — the meshes built in code face the right way and stand where the plan says.
 *
 * The chrysalis and the crystals are single-sided and flat-shaded from their own triangles: a
 * triangle wound the wrong way is culled, or mirrors the sky from the wrong side. Nothing fails
 * loudly when that happens (the Koi Pond's backs were dark for most of its development), so the
 * facing of each mesh is pinned here, with what else the rest of the theme takes for granted
 * about them: the wings' geometry is the CPU's wingPoint, the long threads end on the crystals.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    CHRYSALIS, DEG, EYE, WINGS, chrysalisProfile, createVesperUniforms, fovForAspect, planBlooms, planSpires, spireTip,
    wingBase, wingOutline, wingPoint, wingScallop,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tsl.js';
import {
    STALK, buildChrysalisGeometry, createChrysalis, createThreads, planThreads, threadPoint,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-relic.js';
import { createReeds, createSpires } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-shore.js';
import { buildWingGeometry, createWings } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-wings.js';
import { createBlooms } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-blooms.js';
import { createLake } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-lake.js';
import { createSky } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-sky.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';

/** The shared uniforms, with a stand-in for the baked noise (nothing here is drawn). */
function uniforms() {
    const noise = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    return createVesperUniforms({ noise });
}

/** Every triangle of a geometry: its corners, its centre, its area and the normal its winding gives it. */
function trianglesOf(geometry) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const at = (i) => (index ? index.getX(i) : i);
    const out = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(position, at(i));
        b.fromBufferAttribute(position, at(i + 1));
        c.fromBufferAttribute(position, at(i + 2));
        const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        const area = face.length() / 2;
        const stored = normal ? new THREE.Vector3()
            .add(new THREE.Vector3().fromBufferAttribute(normal, at(i)))
            .add(new THREE.Vector3().fromBufferAttribute(normal, at(i + 1)))
            .add(new THREE.Vector3().fromBufferAttribute(normal, at(i + 2))) : null;
        out.push({
            corners: [a.clone(), b.clone(), c.clone()],
            centre: new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3),
            area,
            face: area > 0 ? face.normalize() : face,
            stored: stored && stored.lengthSq() > 0 ? stored.normalize() : stored,
        });
    }
    return out;
}

/** Where a world point shows in the rest frame at an aspect (screen fractions, y down). */
function restScreen(point, aspect = 16 / 9) {
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, EYE.near, EYE.far);
    camera.position.set(EYE.x, EYE.y, EYE.z);
    camera.lookAt(EYE.x, EYE.y + Math.tan(EYE.pitch) * 100, EYE.z - 100);
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(...point).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
}

describe('vesper chrysalis meshes: the chrysalis', () => {
    it('is a solid whose every facet faces outward', () => {
        const geometry = buildChrysalisGeometry();
        const triangles = trianglesOf(geometry);
        expect(geometry.getIndex()).toBeNull(); // flat-shaded: no vertex is shared between facets
        expect(geometry.getAttribute('position').count % 3).toBe(0);
        expect(triangles.length).toBeGreaterThan(100);
        const centre = new THREE.Vector3(CHRYSALIS.x, CHRYSALIS.foot + CHRYSALIS.length * 0.5, CHRYSALIS.z);
        const inward = [];
        const mislit = [];
        const collapsed = [];
        triangles.forEach((t, i) => {
            if (t.area < 1e-9) {
                collapsed.push(t);
                return;
            }
            // Away from the long axis it hangs by, and away from its middle.
            const radial = new THREE.Vector3(t.centre.x - CHRYSALIS.x, 0, t.centre.z - CHRYSALIS.z).normalize();
            const away = new THREE.Vector3().subVectors(t.centre, centre).normalize();
            if (t.face.dot(radial) <= 0 || t.face.dot(away) <= 0) {
                inward.push(`facet ${i} at height ${((t.centre.y - CHRYSALIS.foot) / CHRYSALIS.length).toFixed(2)}`);
            }
            // The normal the shader mirrors the sky with is the facet's own.
            if (t.stored.dot(t.face) < 0.999) mislit.push(`facet ${i}`);
        });
        expect(inward).toEqual([]);
        expect(mislit).toEqual([]);
        // The only facets with no area are the slivers that close the foot's point.
        expect(collapsed.length).toBeLessThan(triangles.length / 10);
        for (const t of collapsed) {
            for (const corner of t.corners) expect(corner.y).toBeLessThan(CHRYSALIS.foot + CHRYSALIS.length * 0.15);
        }
    });

    it('hangs where the plan puts it, inside its own profile, with a finite normal everywhere', () => {
        const geometry = buildChrysalisGeometry();
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const uv = geometry.getAttribute('uv');
        expect(normal.count).toBe(position.count);
        expect(uv.count).toBe(position.count);
        let widest = 0;
        for (let i = 0; i < position.count; i++) {
            const y = position.getY(i);
            const t = (y - CHRYSALIS.foot) / CHRYSALIS.length;
            expect(t).toBeGreaterThanOrEqual(-1e-6);
            expect(t).toBeLessThanOrEqual(1 + 1e-6);
            // `uv` = (angle round it 0..1, height 0..1): the shader's cracks and diadem are drawn by it.
            expect(uv.getY(i)).toBeCloseTo(t, 5);
            expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
            expect(uv.getX(i)).toBeLessThan(1);
            const r = Math.hypot(position.getX(i) - CHRYSALIS.x, position.getZ(i) - CHRYSALIS.z);
            // The lathe's profile, swollen by the wing cases and nudged facet by facet: never by half.
            expect(r).toBeLessThanOrEqual(chrysalisProfile(t) * 1.5 + 1e-6);
            widest = Math.max(widest, r);
            expect(Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i))).toBe(true);
        }
        expect(widest).toBeGreaterThan(CHRYSALIS.radius * 0.8);
        expect(widest).toBeLessThan(CHRYSALIS.radius * 1.6);
        // Its bounds are set: the world never asks three to compute them from a posed mesh.
        const sphere = geometry.boundingSphere;
        expect(sphere).toBeTruthy();
        expect(sphere.radius).toBeGreaterThan(CHRYSALIS.length / 2 - 1e-6);
        expect(sphere.radius).toBeLessThan(CHRYSALIS.length);
        // The same chrysalis every time; another seed cuts other facets on the same lathe.
        const again = buildChrysalisGeometry();
        expect(Array.from(again.getAttribute('position').array)).toEqual(Array.from(position.array));
        const other = buildChrysalisGeometry(77);
        expect(other.getAttribute('position').count).toBe(position.count);
        expect(Array.from(other.getAttribute('position').array)).not.toEqual(Array.from(position.array));
        // The silk is made fast at the top of its stalk.
        expect(STALK).toEqual([CHRYSALIS.x, CHRYSALIS.foot + CHRYSALIS.length, CHRYSALIS.z]);
    });

    it('is drawn single-sided with its halo behind it, both in node materials', () => {
        const part = createChrysalis(uniforms());
        const meshes = [];
        part.mesh.traverse((object) => { if (object.isMesh) meshes.push(object); });
        expect(meshes.length).toBeGreaterThanOrEqual(2);
        for (const mesh of meshes) expect(mesh.material.isNodeMaterial).toBe(true);
        const shell = meshes.find((mesh) => mesh.geometry === part.geometry);
        expect(shell.material).toBe(part.material);
        // Single-sided: which is why its winding matters.
        expect(shell.material.side).toBe(THREE.FrontSide);
        expect(shell.material.transparent).toBe(false);
        // The halo is a sheet of light behind the body, as seen from the viewer.
        const halo = meshes.find((mesh) => mesh !== shell);
        expect(halo.material.transparent).toBe(true);
        expect(halo.material.depthWrite).toBe(false);
        expect(halo.position.z).toBeLessThan(CHRYSALIS.z);
        expect(halo.renderOrder).toBeGreaterThan(shell.renderOrder);
        // The order is on the two draws, not on the group that holds them: three sorts by a
        // Group's renderOrder before any mesh's own, which would draw both after everything else.
        expect(part.mesh.isGroup).toBe(true);
        expect(part.mesh.renderOrder).toBe(0);
        expect(shell.renderOrder).toBeGreaterThan(0);
        part.dispose();
    });
});

describe('vesper chrysalis meshes: the crystal stands', () => {
    it('cuts a crystal whose faces all look outward and whose point is its top', () => {
        const part = createSpires(uniforms(), planSpires(5));
        const triangles = trianglesOf(part.geometry);
        expect(triangles).toHaveLength(18); // six sides of two triangles, six facets to the point
        const wrong = [];
        triangles.forEach((t, i) => {
            expect(t.area).toBeGreaterThan(1e-4);
            const radial = new THREE.Vector3(t.centre.x, 0, t.centre.z).normalize();
            if (t.face.dot(radial) <= 0.05) wrong.push(`face ${i} looks inward`);
            if (t.stored.dot(t.face) < 0.999) wrong.push(`face ${i} is lit by another face's normal`);
            // The facets of the point also look up; no face looks down at the lake.
            if (t.face.y < -0.2) wrong.push(`face ${i} looks down`);
        });
        expect(wrong).toEqual([]);
        expect(part.material.side).toBe(THREE.FrontSide);
        const position = part.geometry.getAttribute('position');
        let top = -Infinity;
        let foot = Infinity;
        for (let i = 0; i < position.count; i++) {
            top = Math.max(top, position.getY(i));
            foot = Math.min(foot, position.getY(i));
            expect(Math.hypot(position.getX(i), position.getZ(i))).toBeLessThan(1.2);
        }
        // Unit height, standing a hair below the water so the mirror meets it cleanly.
        expect(top).toBe(1);
        expect(foot).toBeLessThan(0);
        expect(foot).toBeGreaterThan(-0.1);
        // Its point is on its own axis: where the plan's tip is, whichever way the crystal is turned.
        for (let i = 0; i < position.count; i++) {
            if (position.getY(i) === 1) expect([position.getX(i), position.getZ(i)]).toEqual([0, 0]);
        }
    });

    it('stands every crystal of the plan upright on the lake, unmirrored, its point at the planned tip', () => {
        for (const perSide of [...new Set(QUALITY_NAMES.map((name) => QUALITY[name].spires))]) {
            const spires = planSpires(perSide);
            const part = createSpires(uniforms(), spires);
            expect(part.count).toBe(spires.length);
            expect(part.mesh.count).toBe(spires.length);
            const position = part.geometry.getAttribute('position');
            // The crystal's own point: its one vertex at full height.
            let apex = null;
            for (let i = 0; i < position.count; i++) {
                if (position.getY(i) === 1) apex = new THREE.Vector3().fromBufferAttribute(position, i);
            }
            const matrix = new THREE.Matrix4();
            const where = new THREE.Vector3();
            const turn = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            const seeds = part.geometry.getAttribute('aSpire');
            spires.forEach((c, i) => {
                const label = `${perSide} a side, crystal ${i}`;
                part.mesh.getMatrixAt(i, matrix);
                // A mirrored instance would turn every face inside out.
                expect(matrix.determinant(), label).toBeGreaterThan(0);
                matrix.decompose(where, turn, scale);
                expect(where.x, label).toBeCloseTo(c.x, 4);
                expect(where.y, label).toBeCloseTo(0, 6);
                expect(where.z, label).toBeCloseTo(c.z, 4);
                expect(scale.y, label).toBeCloseTo(c.height, 3);
                expect(scale.x, label).toBeCloseTo(c.radius, 4);
                expect(scale.z, label).toBeCloseTo(c.radius, 4);
                // It leans the way the plan leans it.
                const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
                const planned = new THREE.Vector3(c.lean[0], 1, c.lean[1]).normalize();
                expect(axis.distanceTo(planned), label).toBeLessThan(1e-5);
                // The plan's tip (where a long thread is made fast) IS the drawn point, to the
                // precision of the instance's 32-bit matrix: no thread ends in the air beside it.
                const drawn = apex.clone().applyMatrix4(matrix);
                const tip = new THREE.Vector3(...spireTip(c));
                expect(drawn.distanceTo(tip), label).toBeLessThan(1e-3);
                // The stand it belongs to, for the light a lock sends up it.
                expect(seeds.getY(i), label).toBe(c.side);
            });
        }
    });

    it('plants the reeds as upright blades in the bottom corners, none when a tier has none', () => {
        const part = createReeds(uniforms(), 60);
        expect(part.count).toBe(60);
        expect(part.mesh.count).toBe(60);
        expect(part.material.side).toBe(THREE.DoubleSide); // a blade is seen from both sides
        const base = part.geometry.getAttribute('aReed');
        for (let i = 0; i < base.count; i++) {
            const x = base.getX(i);
            const z = base.getY(i);
            expect(z).toBeLessThan(0);
            expect(base.getZ(i)).toBeGreaterThan(0); // its height
            // To either side of the board, near the bottom of the 16:9 frame.
            const foot = restScreen([x, 0, z]);
            expect(Math.abs(foot.x - 0.5)).toBeGreaterThan(0.12);
            expect(foot.y).toBeGreaterThan(0.75);
        }
        const none = createReeds(uniforms(), 0);
        expect(none.count).toBe(0);
        expect(none.mesh.count).toBe(0);
    });
});

describe('vesper chrysalis meshes: the wings', () => {
    const fans = [];
    [-1, 1].forEach((side) => {
        [0, 1].forEach((kind) => fans.push({ side, kind, fan: kind === 0 ? WINGS.fore : WINGS.hind }));
    });

    it('builds all four wings in one geometry, a grid of each fan', () => {
        const geometry = buildWingGeometry();
        const vertices = fans.reduce((sum, { fan }) => sum + (fan.segA + 1) * (fan.segV + 1), 0);
        const indices = fans.reduce((sum, { fan }) => sum + fan.segA * fan.segV * 6, 0);
        expect(geometry.getAttribute('position').itemSize).toBe(3);
        expect(geometry.getAttribute('position').count).toBe(vertices);
        expect(geometry.getAttribute('aWing').itemSize).toBe(4);
        expect(geometry.getAttribute('aWing').count).toBe(vertices);
        // What the vertex shader needs of the margin: (the smooth outline, the scallop on it).
        expect(geometry.getAttribute('aOut').itemSize).toBe(2);
        expect(geometry.getAttribute('aOut').count).toBe(vertices);
        const index = geometry.getIndex();
        expect(index.count).toBe(indices);
        let highest = 0;
        for (let i = 0; i < index.count; i++) highest = Math.max(highest, index.getX(i));
        expect(highest).toBe(vertices - 1);
        // Every vertex of a fan is in the fan's own triangles, and no triangle joins two wings.
        const wing = geometry.getAttribute('aWing');
        const fanOf = (i) => `${wing.getW(i)}:${wing.getZ(i)}`;
        const counts = new Map();
        for (let i = 0; i < vertices; i++) counts.set(fanOf(i), (counts.get(fanOf(i)) || 0) + 1);
        expect([...counts.keys()].sort()).toEqual(fans.map(({ side, kind }) => `${side}:${kind}`).sort());
        for (const { side, kind, fan } of fans) {
            expect(counts.get(`${side}:${kind}`)).toBe((fan.segA + 1) * (fan.segV + 1));
        }
        const stitched = [];
        for (let i = 0; i < index.count; i += 3) {
            const own = fanOf(index.getX(i));
            if (fanOf(index.getX(i + 1)) !== own || fanOf(index.getX(i + 2)) !== own) stitched.push(i / 3);
        }
        expect(stitched).toEqual([]);
    });

    it('puts every vertex where the CPU says the open wing is, with the margin its vein ends at', () => {
        const geometry = buildWingGeometry();
        const position = geometry.getAttribute('position');
        const wing = geometry.getAttribute('aWing');
        const margin = geometry.getAttribute('aOut');
        let worst = 0;
        let worstMargin = 0;
        const odd = [];
        const p = [0, 0, 0];
        for (let i = 0; i < position.count; i++) {
            const an = wing.getX(i);
            const v = wing.getY(i);
            const kind = wing.getZ(i);
            const side = wing.getW(i);
            if (!(an >= 0 && an <= 1 && v >= 0 && v <= 1) || ![0, 1].includes(kind) || ![-1, 1].includes(side)) {
                odd.push(i);
            }
            // Fully open, at rest: the vertex shader moves it from there (the wing unfurling, its stroke).
            wingPoint(kind, side, an, v, 1, 0, p);
            worst = Math.max(
                worst,
                Math.abs(position.getX(i) - p[0]),
                Math.abs(position.getY(i) - p[1]),
                Math.abs(position.getZ(i) - p[2]),
            );
            // The shader rebuilds the wing from the same two numbers the CPU does: the outline
            // without its scallops, and the scallop (which it lets in only near the margin).
            worstMargin = Math.max(
                worstMargin,
                Math.abs(margin.getX(i) - wingBase(kind, an)),
                Math.abs(margin.getY(i) - wingScallop(kind, an)),
            );
        }
        expect(odd).toEqual([]);
        // To the precision of a 32-bit float at these distances.
        expect(worst).toBeLessThan(1e-4);
        expect(worstMargin).toBeLessThan(1e-6);
        // The margin itself is where the outline says: the last vertex of every vein is that far from the root.
        const tip = [0, 0, 0];
        for (const kind of [0, 1]) {
            for (const an of [0, 0.25, 0.5, 0.75, 1]) {
                wingPoint(kind, 1, an, 1, 1, 0, tip);
                const reach = Math.hypot(tip[0] - WINGS.root[0], tip[1] - WINGS.root[1]);
                expect(reach).toBeCloseTo(WINGS.span * wingOutline(kind, an), 9);
            }
        }
        // The bounds cover the open wings.
        const sphere = geometry.boundingSphere;
        const vertex = new THREE.Vector3();
        let furthest = 0;
        for (let i = 0; i < position.count; i++) {
            furthest = Math.max(furthest, vertex.fromBufferAttribute(position, i).distanceTo(sphere.center));
        }
        expect(furthest).toBeLessThanOrEqual(sphere.radius + 1e-3);
    });

    it('leaves no sliver in a wing but at its root, where every vein starts from one point', () => {
        const geometry = buildWingGeometry();
        const position = geometry.getAttribute('position');
        const wing = geometry.getAttribute('aWing');
        const index = geometry.getIndex();
        const triangles = trianglesOf(geometry);
        const slivers = [];
        triangles.forEach((t, i) => {
            const atRoot = [0, 1, 2].some((k) => wing.getY(index.getX(i * 3 + k)) === 0);
            if (!atRoot && t.area < 1e-4) slivers.push(i);
        });
        expect(slivers).toEqual([]);
        expect(position.count).toBeGreaterThan(0);
        const part = createWings(uniforms(), { detail: 2 });
        expect(part.material.isNodeMaterial).toBe(true);
        expect(part.material.side).toBe(THREE.DoubleSide);
        expect(part.material.depthWrite).toBe(false);
        expect(part.mesh.geometry.getIndex().count).toBe(index.count);
        // One winding per wing: a wing's triangles all face the same way (no fold in the sheet).
        const facing = new Map();
        triangles.forEach((t, i) => {
            if (t.area < 1e-4) return;
            const key = `${wing.getW(index.getX(i * 3))}:${wing.getZ(index.getX(i * 3))}`;
            const sign = Math.sign(t.face.z);
            if (!facing.has(key)) facing.set(key, sign);
            expect(sign, `wing ${key}, triangle ${i}`).toBe(facing.get(key));
        });
        expect(facing.size).toBe(4);
    });
});

describe('vesper chrysalis meshes: the silk', () => {
    /** The four anchors the world gives: the two tallest crystals of each stand. */
    function anchorsOf(spires) {
        const anchors = [];
        [-1, 1].forEach((side) => {
            const stand = spires.filter((c) => c.side === side).sort((a, b) => b.height - a.height);
            stand.slice(0, 2).forEach((c) => anchors.push([...spireTip(c), side]));
        });
        return anchors;
    }

    it('plans the long threads first, each from the stalk to the anchor it was given', () => {
        const anchors = anchorsOf(planSpires(9));
        expect(anchors).toHaveLength(4);
        for (const count of [4, 7, 13, 17]) {
            const threads = planThreads(count, anchors);
            expect(threads).toHaveLength(count);
            threads.forEach((thread, i) => {
                const label = `${count} threads, thread ${i}`;
                expect(thread.a, label).toEqual([...STALK]);
                expect(thread.long, label).toBe(i < anchors.length);
                expect(thread.sag, label).toBeGreaterThan(0);
                expect(thread.seed, label).toBeGreaterThanOrEqual(0);
                expect(thread.seed, label).toBeLessThan(1);
                expect([...thread.a, ...thread.b, thread.sag].every(Number.isFinite), label).toBe(true);
                if (thread.long) {
                    // Made fast where it was told to be, on the side it was told.
                    expect(thread.b, label).toEqual(anchors[i].slice(0, 3));
                    expect(thread.side, label).toBe(anchors[i][3]);
                } else {
                    // The fan rises from the stalk, out of the top of the frame.
                    expect(thread.b[1], label).toBeGreaterThan(STALK[1]);
                    expect(restScreen(thread.b).y, label).toBeLessThan(0);
                    expect([-1, 1], label).toContain(thread.side);
                }
            });
            // The same threads every time, and the long ones the same whatever the tier adds.
            expect(planThreads(count, anchors)).toEqual(threads);
            expect(threads.slice(0, 4)).toEqual(planThreads(4, anchors));
            // The fan opens to both sides.
            const fan = threads.filter((thread) => !thread.long);
            if (fan.length > 1) {
                expect(fan[0].b[0]).toBeLessThan(STALK[0]);
                expect(fan[fan.length - 1].b[0]).toBeGreaterThan(STALK[0]);
            }
        }
        // Never fewer than the long ones, and none at all without anchors or a count.
        expect(planThreads(2, anchors)).toHaveLength(4);
        expect(planThreads(0, [])).toEqual([]);
        expect(planThreads(3, []).every((thread) => !thread.long)).toBe(true);
    });

    it('hangs a thread between its ends, sagging below the straight line, never into the lake', () => {
        const anchors = anchorsOf(planSpires(9));
        const threads = planThreads(13, anchors);
        for (const thread of threads) {
            expect(threadPoint(thread, 0)).toEqual(thread.a);
            const end = threadPoint(thread, 1);
            for (let k = 0; k < 3; k++) expect(end[k]).toBeCloseTo(thread.b[k], 9);
            let deepest = 0;
            for (let i = 1; i < 40; i++) {
                const s = i / 40;
                const p = threadPoint(thread, s);
                const chord = thread.a.map((a, k) => a + (thread.b[k] - a) * s);
                // Straight in plan, hanging below the chord in between.
                expect(p[0]).toBeCloseTo(chord[0], 9);
                expect(p[2]).toBeCloseTo(chord[2], 9);
                expect(p[1]).toBeLessThan(chord[1]);
                expect(p[1]).toBeGreaterThan(0);
                deepest = Math.max(deepest, chord[1] - p[1]);
            }
            // It hangs lowest in the middle of its span, by its sag.
            const middle = threadPoint(thread, 0.5);
            expect((thread.a[1] + thread.b[1]) / 2 - middle[1]).toBeCloseTo(thread.sag, 9);
            expect(deepest).toBeCloseTo(thread.sag, 9);
        }
        const out = [0, 0, 0];
        expect(threadPoint(threads[0], 0.3, out)).toBe(out);
    });

    it('draws every thread as a ribbon along its own curve, the long ones marked for the side they serve', () => {
        const anchors = anchorsOf(planSpires(9));
        const threads = planThreads(13, anchors);
        const part = createThreads(uniforms(), threads);
        expect(part.count).toBe(threads.length);
        const position = part.geometry.getAttribute('position');
        const tangent = part.geometry.getAttribute('aTangent');
        const info = part.geometry.getAttribute('aInfo');
        const perThread = position.count / threads.length;
        expect(Number.isInteger(perThread)).toBe(true);
        expect(perThread % 2).toBe(0);
        const segments = perThread / 2 - 1;
        expect(part.geometry.getIndex().count).toBe(threads.length * segments * 6);
        const p = [0, 0, 0];
        let worst = 0;
        threads.forEach((thread, k) => {
            for (let i = 0; i < perThread; i++) {
                const v = k * perThread + i;
                const s = info.getX(v);
                expect(s).toBeGreaterThanOrEqual(0);
                expect(s).toBeLessThanOrEqual(1);
                // Two vertices at each station, one to either side of the hairline.
                expect(info.getY(v)).toBe(i % 2 === 0 ? -1 : 1);
                // A long thread carries a lock's light on its own side; the fan carries every lock's.
                expect(info.getZ(v)).toBe(thread.long ? thread.side : 0);
                threadPoint(thread, s, p);
                worst = Math.max(
                    worst,
                    Math.abs(position.getX(v) - p[0]),
                    Math.abs(position.getY(v) - p[1]),
                    Math.abs(position.getZ(v) - p[2]),
                );
                // A direction to widen the ribbon across: never nothing.
                const along = Math.hypot(tangent.getX(v), tangent.getY(v), tangent.getZ(v));
                expect(Number.isFinite(along)).toBe(true);
                expect(along).toBeGreaterThan(1e-3);
            }
            // It runs from the chrysalis (s = 0) to where it is made fast (s = 1).
            expect(info.getX(k * perThread)).toBe(0);
            expect(info.getX((k + 1) * perThread - 1)).toBe(1);
        });
        expect(worst).toBeLessThan(1e-4);
        expect(part.material.isNodeMaterial).toBe(true);
    });
});

describe('vesper chrysalis meshes: the lake, the sky and the lilies', () => {
    it('lays the lake face up under the whole view, and turns the sky inward round it', () => {
        const lake = createLake(uniforms(), { mirrorScale: 0 });
        const normal = lake.geometry.getAttribute('normal');
        for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeCloseTo(1, 6);
        const position = lake.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) expect(Math.abs(position.getY(i))).toBeLessThan(1e-6);
        // Single-sided: it is its triangles' winding, not only its normals, that must look up.
        expect(lake.material.side).toBe(THREE.FrontSide);
        for (const t of trianglesOf(lake.geometry)) expect(t.face.y).toBeCloseTo(1, 6);
        expect(lake.reflection).toBeNull();
        expect(lake.reflectorTarget).toBeNull();
        const sky = createSky(uniforms());
        expect(sky.material.side).toBe(THREE.BackSide); // seen from inside
        sky.geometry.computeBoundingSphere();
        const dome = sky.geometry.boundingSphere.radius;
        // The dome is inside the far plane, and the water reaches it in every direction the viewer can look.
        expect(dome).toBeLessThan(EYE.far);
        lake.geometry.computeBoundingBox();
        const { min, max } = lake.geometry.boundingBox;
        expect(min.z).toBeLessThan(-dome);
        expect(min.x).toBeLessThan(-dome * Math.tan((EYE.hFov * DEG) / 2));
        expect(max.x).toBeGreaterThan(dome * Math.tan((EYE.hFov * DEG) / 2));
        expect(max.z).toBeGreaterThan(0); // under the viewer's feet too
        // With a mirror pass, the reflector's own plane lies on the water, looking up.
        const mirrored = createLake(uniforms(), { mirrorScale: 0.5 });
        expect(mirrored.reflection).toBeTruthy();
        expect(mirrored.reflectorTarget).toBe(mirrored.reflection.target);
        const up = new THREE.Vector3(0, 0, 1).applyQuaternion(mirrored.reflectorTarget.quaternion);
        expect(up.y).toBeCloseTo(1, 6);
        mirrored.reflection.dispose?.();
    });

    it('floats a pad face up under every lily and gives every petal a place on its lily', () => {
        const plan = planBlooms(6);
        for (const whorls of [1, 2, 3]) {
            const part = createBlooms(uniforms(), plan, { whorls });
            expect(part.count).toBe(plan.length);
            expect(part.plan).toEqual(plan);
            const meshes = [];
            part.mesh.traverse((object) => { if (object.isMesh) meshes.push(object); });
            expect(meshes).toHaveLength(3); // petals, pads with their pools of light, auras
            for (const mesh of meshes) expect(mesh.material.isNodeMaterial).toBe(true);
            const [petals, pads, auras] = meshes;
            // Each draw keeps its own place in the order (the group that holds them has none):
            // the petals with the solid things, the pads on the water, the auras over the wings.
            expect(part.mesh.isGroup).toBe(true);
            expect(part.mesh.renderOrder).toBe(0);
            expect(petals.renderOrder).toBeGreaterThan(0);
            expect(pads.renderOrder).toBeGreaterThan(petals.renderOrder);
            expect(auras.renderOrder).toBeGreaterThan(pads.renderOrder);
            // Petals: the same number in every whorl of every lily, each told which lily is its own.
            expect(petals.count % (plan.length * whorls)).toBe(0);
            const lily = petals.geometry.getAttribute('aLily');
            const perLily = petals.count / plan.length;
            for (let i = 0; i < petals.count; i++) {
                const index = lily.getW(i);
                expect(index).toBe(Math.floor(i / perLily));
                expect(lily.getX(i)).toBeCloseTo(plan[index].x, 4);
                expect(lily.getY(i)).toBeCloseTo(plan[index].z, 4);
                expect(lily.getZ(i)).toBeCloseTo(plan[index].size, 5);
            }
            // Pads: one a lily, a quad lying on the water, wound to be seen from above.
            expect(pads.count).toBe(plan.length);
            for (const t of trianglesOf(pads.geometry)) expect(t.face.y).toBeCloseTo(1, 6);
            part.dispose();
        }
        // A plan longer than the pool is cut to it; an empty one draws nothing and breaks nothing.
        const none = createBlooms(uniforms(), []);
        expect(none.count).toBe(0);
        expect(none.totalHeld(5)).toBe(0);
        expect(() => none.tick(3)).not.toThrow();
        none.dispose();
    });
});
