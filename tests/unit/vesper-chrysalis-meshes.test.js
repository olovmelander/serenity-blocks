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
    CHRYSALIS, DEG, EYE, WINGS, createVesperUniforms, fovForAspect, planBlooms, planPads, planSpires, spireTip,
    wingBase, wingOutline, wingPoint, wingScallop,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tsl.js';
import {
    STALK, buildChrysalisGeometry, chrysalisPoint, createChrysalis, createThreads, planThreads, threadPoint,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-relic.js';
import {
    buildSpiresGeometry, createReeds, createSpires,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-shore.js';
import { buildWingGeometry, createWings } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-wings.js';
import { BLOOM_SHAPES, createBlooms } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-blooms.js';
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

/** The parts of the chrysalis's cut (aGem.y). */
const STONE = 0;
const BEAD = 1;
const STEM = 2;

/** The chrysalis's triangles with what aGem says of each: its part, its bead, its number, its height. */
function facetsOf(geometry) {
    const gem = geometry.getAttribute('aGem');
    return trianglesOf(geometry).map((t, i) => ({
        ...t,
        index: i,
        id: gem.getX(i * 3),
        part: gem.getY(i * 3),
        bead: gem.getZ(i * 3),
        height: gem.getW(i * 3),
    }));
}

/** The mean of a set of triangles' corners. */
function middleOf(triangles) {
    const sum = new THREE.Vector3();
    triangles.forEach((t) => t.corners.forEach((corner) => sum.add(corner)));
    return sum.divideScalar(triangles.length * 3);
}

describe('vesper chrysalis meshes: the chrysalis', () => {
    it('is a solid whose every facet faces outward', () => {
        const geometry = buildChrysalisGeometry();
        const facets = facetsOf(geometry);
        expect(geometry.getIndex()).toBeNull(); // flat-shaded: no vertex is shared between facets
        expect(geometry.getAttribute('position').count % 3).toBe(0);
        expect(facets.length).toBeGreaterThan(100);
        // Built about the point it hangs from: the stone is centred on the vertical through it.
        const middle = new THREE.Vector3(0, -CHRYSALIS.length / 2, 0);
        const inward = [];
        const mislit = [];
        const collapsed = [];
        const outwardFrom = (t, from) => t.face.dot(new THREE.Vector3().subVectors(t.centre, from).normalize()) > 0;
        const stem = facets.filter((t) => t.part === STEM);
        const stemMiddle = middleOf(stem);
        facets.forEach((t) => {
            if (t.area < 1e-9) {
                collapsed.push(t);
                return;
            }
            const at = `part ${t.part} facet ${t.index} at ${t.centre.toArray().map((v) => v.toFixed(2)).join(', ')}`;
            if (t.part === STONE) {
                // A facet of the stone looks away from the long axis it hangs by, and away from its middle.
                const radial = new THREE.Vector3(t.centre.x, 0, t.centre.z).normalize();
                if (t.face.dot(radial) <= 0 || !outwardFrom(t, middle)) inward.push(at);
            } else if (t.part === BEAD) {
                // A bead of gold is a small solid of its own: its facets look away from its middle.
                const bead = facets.filter((f) => f.part === BEAD && f.bead === t.bead);
                if (!outwardFrom(t, middleOf(bead))) inward.push(at);
            } else if (!outwardFrom(t, stemMiddle)) inward.push(at); // the stalk, likewise
            // The normal the shader mirrors the sky with is the facet's own.
            if (t.stored.dot(t.face) < 0.999) mislit.push(at);
        });
        expect(inward).toEqual([]);
        expect(mislit).toEqual([]);
        expect(collapsed).toEqual([]);
        // Three parts and nothing else: the stone, the gold, the stalk.
        expect(new Set(facets.map((t) => t.part))).toEqual(new Set([STONE, BEAD, STEM]));
        expect(stem.length).toBeGreaterThan(0);
        // The stalk is at the top, the stone's middle well under it.
        expect(stemMiddle.y).toBeGreaterThan(-(1 - CHRYSALIS.neck) * CHRYSALIS.length - 1e-6);
        expect(Math.hypot(stemMiddle.x, stemMiddle.z)).toBeLessThan(1e-6);
    });

    it('hangs from its stalk down to its foot, on its own skin, with a finite unit normal everywhere', () => {
        const geometry = buildChrysalisGeometry();
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const uv = geometry.getAttribute('uv');
        const gem = geometry.getAttribute('aGem');
        const L = CHRYSALIS.length;
        expect(normal.count).toBe(position.count);
        expect(uv.count).toBe(position.count);
        expect(gem.count).toBe(position.count);
        let top = -Infinity;
        let foot = Infinity;
        let widest = 0;
        const skin = [0, 0, 0];
        const off = [];
        for (let i = 0; i < position.count; i++) {
            const p = [position.getX(i), position.getY(i), position.getZ(i)];
            top = Math.max(top, p[1]);
            foot = Math.min(foot, p[1]);
            expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
            // `uv` = (turn round it 0..1, height 0..1): the shader's cracks and diadem are drawn by it.
            expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
            expect(uv.getX(i)).toBeLessThan(1);
            expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
            expect(uv.getY(i)).toBeLessThanOrEqual(1);
            if (gem.getY(i) === BEAD) {
                // A bead sits on the skin (lifted a little out of it) where its uv says.
                chrysalisPoint(uv.getX(i), uv.getY(i), skin, 1.03);
                const fromSkin = Math.hypot(p[0] - skin[0], p[1] - skin[1], p[2] - skin[2]);
                if (fromSkin > CHRYSALIS.radius * 0.1) off.push(`bead vertex ${i}: ${fromSkin.toFixed(3)} m off`);
                continue;
            }
            widest = Math.max(widest, Math.hypot(p[0], p[2]));
            // The stone and the stalk are their skin (chrysalisPoint, the CPU twin, at the vertex's
            // uv), each girdle stood out of it or drawn into it a few percent; the foot and the top
            // of the stalk are points on the axis.
            chrysalisPoint(uv.getX(i), uv.getY(i), skin);
            expect(p[1]).toBeCloseTo(skin[1], 4);
            expect(uv.getY(i)).toBeCloseTo(p[1] / L + 1, 5);
            const r = Math.hypot(p[0], p[2]);
            if (r < 1e-6) continue;
            const lift = r / Math.hypot(skin[0], skin[2]);
            const along = (p[0] * skin[0] + p[2] * skin[2]) / (r * Math.hypot(skin[0], skin[2]));
            if (lift < 0.95 || lift > 1.06 || along < 0.9999) off.push(`vertex ${i}: lift ${lift.toFixed(3)}`);
        }
        expect(off).toEqual([]);
        // It hangs from the origin (the top of its stalk) down to its foot, its length below it.
        expect(top).toBeCloseTo(0, 6);
        expect(foot).toBeCloseTo(-L, 5);
        // As wide as its shoulder ridge, a little more where the girdles and the wing cases stand out.
        expect(widest).toBeGreaterThan(CHRYSALIS.radius);
        expect(widest).toBeLessThan(CHRYSALIS.radius * 1.25);
        // Its bounds are set, and hold all of it: the world never asks three to compute them from a posed mesh.
        const sphere = geometry.boundingSphere;
        expect(sphere).toBeTruthy();
        expect(sphere.radius).toBeGreaterThan(L / 2);
        const vertex = new THREE.Vector3();
        let furthest = 0;
        for (let i = 0; i < position.count; i++) {
            furthest = Math.max(furthest, vertex.fromBufferAttribute(position, i).distanceTo(sphere.center));
        }
        expect(furthest).toBeLessThanOrEqual(sphere.radius);
        // The same chrysalis every time; another seed numbers the facets of the same cut otherwise
        // (what the shader draws from a facet's number: its film, the order its cracks open in).
        const again = buildChrysalisGeometry();
        expect(Array.from(again.getAttribute('position').array)).toEqual(Array.from(position.array));
        expect(Array.from(again.getAttribute('aGem').array)).toEqual(Array.from(gem.array));
        const other = buildChrysalisGeometry(77);
        expect(Array.from(other.getAttribute('position').array)).toEqual(Array.from(position.array));
        expect(Array.from(other.getAttribute('aGem').array)).not.toEqual(Array.from(gem.array));
        // The silk is made fast at the top of its stalk: at rest, the origin is there.
        expect(STALK).toEqual([CHRYSALIS.x, CHRYSALIS.foot + CHRYSALIS.length, CHRYSALIS.z]);
    });

    it('wears a diadem of gold beads on its shoulder and gold spots low on its front', () => {
        const geometry = buildChrysalisGeometry();
        const facets = facetsOf(geometry);
        const L = CHRYSALIS.length;
        const shoulder = (CHRYSALIS.shoulder - 1) * L;
        facets.forEach((t) => {
            // Every facet has its own number 0..1, its part, and its height (of its middle) 0..1.
            expect(t.id).toBeGreaterThanOrEqual(0);
            expect(t.id).toBeLessThan(1);
            expect([STONE, BEAD, STEM]).toContain(t.part);
            expect(t.height).toBeCloseTo(t.centre.y / L + 1, 5);
            if (t.part !== BEAD) expect(t.bead).toBe(0);
        });
        const beads = new Map();
        facets.filter((t) => t.part === BEAD).forEach((t) => {
            if (!beads.has(t.bead)) beads.set(t.bead, []);
            beads.get(t.bead).push(t);
        });
        const indices = [...beads.keys()].sort((a, b) => a - b);
        // Numbered from 0 without a gap: the diadem's first, then the spots.
        expect(indices).toEqual(indices.map((_, i) => i));
        expect(indices.length).toBeGreaterThan(CHRYSALIS.diadem);
        const sizes = new Set([...beads.values()].map((list) => list.length));
        expect(sizes.size).toBe(1); // every bead cut alike
        const middles = indices.map((i) => middleOf(beads.get(i)));
        // The diadem: one bead for every step of the chain, all round the shoulder ridge.
        const diadem = middles.slice(0, CHRYSALIS.diadem);
        diadem.forEach((m, i) => expect(m.y, `bead ${i}`).toBeCloseTo(shoulder, 1));
        const turns = diadem.map((m) => Math.atan2(m.z, m.x));
        expect(Math.max(...turns) - Math.min(...turns)).toBeGreaterThan(Math.PI * 1.5);
        // The spots: lower on the stone, on its front (the side that faces the viewer at rest).
        middles.slice(CHRYSALIS.diadem).forEach((m, i) => {
            expect(m.y, `spot ${i}`).toBeLessThan(shoulder - 1);
            expect(m.y, `spot ${i}`).toBeGreaterThan(-L);
            expect(m.z, `spot ${i}`).toBeGreaterThan(0);
        });
    });

    it('lists the stone\'s facets for what glints on them: one for each, outward, in the stone\'s own frame', () => {
        const geometry = buildChrysalisGeometry();
        const stone = facetsOf(geometry).filter((t) => t.part === STONE);
        const listed = geometry.userData.facets;
        expect(listed).toHaveLength(stone.length);
        listed.forEach((f, i) => {
            const t = stone[i];
            expect(f.at[0]).toBeCloseTo(t.centre.x, 5);
            expect(f.at[1]).toBeCloseTo(t.centre.y, 5);
            expect(f.at[2]).toBeCloseTo(t.centre.z, 5);
            expect(Math.hypot(...f.normal)).toBeCloseTo(1, 9);
            expect(new THREE.Vector3(...f.normal).dot(t.face)).toBeGreaterThan(0.9999);
            // Outward: away from the axis it hangs by.
            expect(f.normal[0] * f.at[0] + f.normal[2] * f.at[2]).toBeGreaterThan(0);
            expect(f.area).toBeGreaterThan(0);
            expect(f.area).toBeCloseTo(t.area, 4);
            expect(f.seed).toBeCloseTo(t.id, 6);
        });
        // The part hands the same list on.
        const part = createChrysalis(uniforms());
        expect(part.facets).toBe(part.geometry.userData.facets);
        part.dispose();
    });

    it('is drawn single-sided with its halo behind it, both in node materials', () => {
        const part = createChrysalis(uniforms());
        const meshes = [];
        part.mesh.traverse((object) => { if (object.isMesh) meshes.push(object); });
        expect(meshes).toHaveLength(2);
        for (const mesh of meshes) expect(mesh.material.isNodeMaterial).toBe(true);
        const { shell, halo } = part;
        expect(meshes).toEqual(expect.arrayContaining([shell, halo]));
        expect(shell.geometry).toBe(part.geometry);
        expect(shell.material).toBe(part.material);
        // Single-sided: which is why its winding matters.
        expect(shell.material.side).toBe(THREE.FrontSide);
        expect(shell.material.transparent).toBe(false);
        // The halo is a sheet of light behind the body, as seen from the viewer.
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

    it('is hung, turned and lit where the world poses it, its own matrix kept', () => {
        const part = createChrysalis(uniforms());
        const { shell, halo } = part;
        const L = CHRYSALIS.length;
        // The world writes the shell's matrix itself every frame: three must not rebuild it.
        expect(shell.matrixAutoUpdate).toBe(false);
        // At rest it hangs from the top of its stalk, its foot where the plan has it.
        const foot = new THREE.Vector3(0, -L, 0).applyMatrix4(shell.matrix);
        expect(new THREE.Vector3(0, 0, 0).applyMatrix4(shell.matrix).toArray()).toEqual([...STALK]);
        expect(foot.y).toBeCloseTo(CHRYSALIS.foot, 9);
        // Posed: hung from another point, swung and turned, its light somewhere else.
        const at = [-21, 17.5, -66];
        const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0.8, -0.07, 'ZXY'));
        const heart = [-20.6, 11.3, -65.4];
        part.setPose(at, turn, heart);
        const top = new THREE.Vector3(0, 0, 0).applyMatrix4(shell.matrix);
        expect(top.distanceTo(new THREE.Vector3(...at))).toBeLessThan(1e-9);
        const hung = new THREE.Vector3(0, -L, 0).applyMatrix4(shell.matrix);
        const expected = new THREE.Vector3(0, -L, 0).applyQuaternion(turn).add(new THREE.Vector3(...at));
        expect(hung.distanceTo(expected)).toBeLessThan(1e-9);
        // Turned, not scaled or mirrored: every facet still faces outward.
        expect(shell.matrix.determinant()).toBeCloseTo(1, 9);
        expect(shell.matrixWorldNeedsUpdate).toBe(true);
        // The halo stands at the heart, a little behind it.
        expect(halo.position.x).toBe(heart[0]);
        expect(halo.position.y).toBe(heart[1]);
        expect(halo.position.z).toBeLessThan(heart[2]);
        expect(halo.position.z).toBeGreaterThan(heart[2] - CHRYSALIS.radius * 2);
        part.dispose();
    });
});

/** A crystal's own axis (the unit lean) and its foot on the water. */
function axisOf(c) {
    const axis = new THREE.Vector3(c.lean[0], 1, c.lean[1]).normalize();
    return { axis, foot: new THREE.Vector3(c.x, 0, c.z) };
}

/** Each crystal of a plan with its own triangles and vertices of the merged geometry. */
function crystalsOf(geometry, spires) {
    const position = geometry.getAttribute('position');
    const triangles = trianglesOf(geometry);
    const perCrystal = position.count / spires.length;
    return spires.map((c, k) => ({
        c,
        first: k * perCrystal,
        count: perCrystal,
        triangles: triangles.slice((k * perCrystal) / 3, ((k + 1) * perCrystal) / 3),
    }));
}

describe('vesper chrysalis meshes: the crystal stands', () => {
    const SIZES = [...new Set(QUALITY_NAMES.map((name) => QUALITY[name].spires))];

    it('cuts every crystal of the plan into one geometry, in the plan\'s order, each its own', () => {
        for (const perSide of SIZES) {
            const spires = planSpires(perSide);
            const geometry = buildSpiresGeometry(spires);
            const position = geometry.getAttribute('position');
            expect(geometry.getIndex()).toBeNull(); // flat-shaded facets
            // Every crystal is cut alike (six sides of two triangles, six facets to the point).
            expect(position.count % (spires.length * 3)).toBe(0);
            expect(position.count / spires.length / 3).toBe(18);
            const spire = geometry.getAttribute('aSpire');
            const axis = geometry.getAttribute('aAxis');
            const face = geometry.getAttribute('aFace');
            const local = geometry.getAttribute('aLocal');
            const edge = geometry.getAttribute('aEdge');
            for (const attribute of [spire, axis, face, local, edge]) expect(attribute.count).toBe(position.count);
            crystalsOf(geometry, spires).forEach(({ c, first, count }) => {
                const { axis: A } = axisOf(c);
                let lowest = Infinity;
                let highest = -Infinity;
                for (let i = first; i < first + count; i++) {
                    const label = `${perSide} a side, vertex ${i}`;
                    // Which crystal it is (its seed), its stand (for the light a lock sends up it), its radius.
                    expect(spire.getX(i), label).toBe(Math.fround(c.seed));
                    expect(spire.getY(i), label).toBe(c.side);
                    expect(spire.getW(i), label).toBe(Math.fround(c.radius));
                    // How far up it, 0 at the foot to 1 at the point; aLocal.y the same in metres.
                    expect(spire.getZ(i), label).toBeGreaterThanOrEqual(0);
                    expect(spire.getZ(i), label).toBeLessThanOrEqual(1);
                    lowest = Math.min(lowest, spire.getZ(i));
                    highest = Math.max(highest, spire.getZ(i));
                    expect(local.getY(i), label).toBeCloseTo(spire.getZ(i) * c.height, 4);
                    expect(local.getX(i), label).toBeGreaterThanOrEqual(0);
                    expect(local.getX(i), label).toBeLessThanOrEqual(1);
                    // The crystal's own axis: the unit lean.
                    expect(axis.getX(i), label).toBeCloseTo(A.x, 6);
                    expect(axis.getY(i), label).toBeCloseTo(A.y, 6);
                    expect(axis.getZ(i), label).toBeCloseTo(A.z, 6);
                    // A side of the prism (0) or a facet of the point (1), and the place across it.
                    expect([0, 1], label).toContain(face.getY(i));
                    expect(face.getX(i), label).toBeGreaterThanOrEqual(0);
                    expect(face.getX(i), label).toBeLessThanOrEqual(1);
                }
                expect(lowest).toBe(0);
                expect(highest).toBe(1);
            });
            // Its bounds are set, and hold both stands.
            const vertex = new THREE.Vector3();
            for (let i = 0; i < position.count; i++) {
                expect(vertex.fromBufferAttribute(position, i).distanceTo(geometry.boundingSphere.center))
                    .toBeLessThanOrEqual(geometry.boundingSphere.radius);
            }
        }
    });

    it('stands every crystal\'s point on its own axis, at the planned tip, the highest of it', () => {
        for (const perSide of SIZES) {
            const spires = planSpires(perSide);
            const geometry = buildSpiresGeometry(spires);
            const position = geometry.getAttribute('position');
            const spire = geometry.getAttribute('aSpire');
            crystalsOf(geometry, spires).forEach(({ c, first, count }, k) => {
                const { axis, foot } = axisOf(c);
                const label = `${perSide} a side, crystal ${k}${c.shard ? ' (small)' : ''}`;
                // The point (its one vertex at full height) is the plan's tip, where a long thread
                // is made fast: no thread ends in the air beside it. Nothing of it stands higher.
                const tip = new THREE.Vector3(...spireTip(c));
                let highest = -Infinity;
                let points = 0;
                for (let i = first; i < first + count; i++) {
                    const p = new THREE.Vector3().fromBufferAttribute(position, i);
                    highest = Math.max(highest, p.y);
                    if (spire.getZ(i) === 1) {
                        points += 1;
                        expect(p.distanceTo(tip), label).toBeLessThan(1e-3);
                    }
                    // Nothing of it reaches further up its axis than its point.
                    expect(p.clone().sub(foot).dot(axis), label).toBeLessThanOrEqual(c.height + 1e-3);
                }
                expect(points, label).toBeGreaterThan(0);
                expect(highest, label).toBeCloseTo(tip.y, 4);
            });
        }
    });

    // Single-sided and flat-shaded (FrontSide, normals from each triangle's own winding): a face wound
    // the wrong way is culled from outside and the crystal is drawn from within, its far walls with
    // their normals turned to the eye, the light on it mirrored left for right.
    it('cuts every crystal with its faces looking outward', () => {
        const wrong = [];
        for (const perSide of SIZES) {
            const spires = planSpires(perSide);
            const geometry = buildSpiresGeometry(spires);
            const faces = { inward: [], down: [], mislit: [] };
            let all = 0;
            crystalsOf(geometry, spires).forEach(({ c, triangles }, k) => {
                const { axis, foot } = axisOf(c);
                triangles.forEach((t, i) => {
                    all += 1;
                    expect(t.area).toBeGreaterThan(1e-4);
                    const at = `crystal ${k}${c.shard ? ' (small)' : ''} face ${i}`;
                    // Away from its own axis (the triangle's middle, less its height up the axis).
                    const rel = new THREE.Vector3().subVectors(t.centre, foot);
                    const radial = rel.clone().sub(axis.clone().multiplyScalar(rel.dot(axis))).normalize();
                    if (t.face.dot(radial) <= 0.05) faces.inward.push(`${at} (${t.face.dot(radial).toFixed(2)})`);
                    if (t.stored.dot(t.face) < 0.999) faces.mislit.push(at);
                    // The sides stand square to the axis or lean back from it, the facets of the
                    // point look up it: no face looks back down the crystal's own axis.
                    if (t.face.dot(axis) < -1e-3) faces.down.push(`${at} (${t.face.dot(axis).toFixed(2)})`);
                });
            });
            // One line a fault, with its count and the first few faces it was found on.
            Object.entries({
                'look inward': faces.inward,
                'look down their own axis': faces.down,
                'are lit by another face\'s normal': faces.mislit,
            }).forEach(([what, list]) => {
                const some = list.slice(0, 3).join('; ');
                if (list.length) wrong.push(`${perSide} a side: ${list.length} of ${all} faces ${what}, e.g. ${some}`);
            });
        }
        expect(wrong).toEqual([]);
    });

    // The cut says "it runs a little below the water so the mirror meets it cleanly": every corner of
    // a crystal's foot is under the water. The foot ring is cut square to the crystal's axis, so on a
    // crystal that leans far the ring's high side comes up out of the lake.
    it('runs every crystal\'s foot a little below the water, all the way round', () => {
        const above = [];
        for (const perSide of SIZES) {
            const spires = planSpires(perSide);
            const geometry = buildSpiresGeometry(spires);
            const position = geometry.getAttribute('position');
            const spire = geometry.getAttribute('aSpire');
            crystalsOf(geometry, spires).forEach(({ c, first, count }, k) => {
                let highestFoot = -Infinity;
                let lowestFoot = Infinity;
                for (let i = first; i < first + count; i++) {
                    if (spire.getZ(i) !== 0) continue;
                    highestFoot = Math.max(highestFoot, position.getY(i));
                    lowestFoot = Math.min(lowestFoot, position.getY(i));
                }
                const label = `${perSide} a side, crystal ${k}${c.shard ? ' (small, leaning '
                    + `${Math.hypot(...c.lean).toFixed(2)})` : ''}`;
                if (!(highestFoot < 0)) above.push(`${label}: its foot ${highestFoot.toFixed(3)} m out of the water`);
                // A little below: never sunk by more than a tenth of its height and its width.
                expect(lowestFoot, label).toBeGreaterThan(-(c.height * 0.1 + c.radius * 1.2 + 0.4));
            });
        }
        expect(above).toEqual([]);
    });

    it('stands its glints on the crystals, and draws the stands as one plain mesh', () => {
        for (const perSide of SIZES) {
            const spires = planSpires(perSide);
            const part = createSpires(uniforms(), spires);
            // One draw for every crystal of the plan (no instances to mirror a crystal inside out).
            expect(part.mesh.isMesh).toBe(true);
            expect(part.mesh.isInstancedMesh).toBeFalsy();
            expect(part.count).toBe(spires.length);
            expect(part.mesh.geometry).toBe(part.geometry);
            expect(part.material.side).toBe(THREE.FrontSide); // single-sided: why their winding matters
            expect(part.glints).toBe(part.geometry.userData.glints);
            const { glints } = part;
            // At least a star on every point; more on the tall crystals than on the small ones.
            expect(glints.length).toBeGreaterThanOrEqual(spires.length);
            const starred = (c) => {
                const tip = new THREE.Vector3(...spireTip(c));
                return glints.some((g) => tip.distanceTo(new THREE.Vector3(...g.at)) < 1e-9);
            };
            expect(spires.every(starred)).toBe(true);
            for (const g of glints) {
                expect(Math.hypot(...g.normal)).toBeCloseTo(1, 9);
                expect(g.seed).toBeGreaterThanOrEqual(0);
                expect(g.seed).toBeLessThan(1);
                expect([-1, 1]).toContain(g.side);
                // On (or just off the face of) a crystal of its own stand: inside its height, within its width.
                const on = spires.filter((c) => c.side === g.side).some((c) => {
                    const { axis, foot } = axisOf(c);
                    const rel = new THREE.Vector3(...g.at).sub(foot);
                    const up = rel.dot(axis);
                    const out = rel.clone().sub(axis.clone().multiplyScalar(up)).length();
                    return up >= -1e-6 && up <= c.height + 1e-6 && out <= c.radius * 1.06;
                });
                expect(on, `a glint at ${g.at.map((v) => v.toFixed(1)).join(', ')}`).toBe(true);
            }
            part.material.dispose();
            part.geometry.dispose();
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
                // Its seed, and above it whether it is a long one: the vertex stage moves the whole
                // fan with the chrysalis where it hangs, a long thread only at the chrysalis's end
                // (its other end is made fast to the crystal).
                expect(info.getW(v) >= 1.5).toBe(thread.long);
                expect(info.getW(v) % 1).toBeCloseTo(thread.seed, 5);
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

    it('floats a pad face up under every lily, and the loose pads round them', () => {
        const plan = planBlooms(6);
        const loose = planPads(plan, 2);
        expect(loose.length).toBeGreaterThan(0);
        for (const whorls of [2, 3]) {
            const part = createBlooms(uniforms(), plan, { whorls, pads: loose });
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
            // Pads: one a lily, then the loose ones; each a quad lying on the water, wound to be seen from above.
            expect(pads.count).toBe(plan.length + loose.length);
            const at = pads.geometry.getAttribute('aLily');
            const pad = pads.geometry.getAttribute('aPad');
            for (let i = 0; i < pads.count; i++) {
                const own = i < plan.length;
                const p = own ? plan[i] : loose[i - plan.length];
                expect(at.getX(i)).toBeCloseTo(p.x, 4);
                expect(at.getY(i)).toBeCloseTo(p.z, 4);
                expect(at.getZ(i)).toBeCloseTo(p.size, 5);
                // A lily's own pad knows its lily (its light pools round it); a loose one is nobody's (−1).
                expect(at.getW(i)).toBe(own ? i : -1);
                expect(pad.getX(i)).toBeCloseTo(p.seed, 6);
                expect(pad.getY(i)).toBe(own ? p.kind : 0);
            }
            for (const t of trianglesOf(pads.geometry)) expect(t.face.y).toBeCloseTo(1, 6);
            // An aura for every lily.
            expect(auras.count).toBe(plan.length);
            part.dispose();
        }
        // Without loose pads, a pad a lily.
        const bare = createBlooms(uniforms(), plan);
        const bareMeshes = [];
        bare.mesh.traverse((object) => { if (object.isMesh) bareMeshes.push(object); });
        expect(bareMeshes[1].count).toBe(plan.length);
        bare.dispose();
    });

    it('gives every lily the petals of its kind, and every petal its place on its lily', () => {
        const plan = planBlooms(6);
        // All three kinds are among them.
        expect(new Set(plan.map((b) => b.kind)).size).toBe(BLOOM_SHAPES.length);
        expect(BLOOM_SHAPES).toHaveLength(3);
        /**
         * Petals a lily of `kind` has: three whorls and its stamens; a lean tier (fewer than three
         * whorls) drops the innermost whorl and half the stamens.
         */
        const petalsOf = (kind, whorls) => BLOOM_SHAPES[kind].reduce((sum, row, role) => {
            if (role === 2 && whorls < 3) return sum;
            return sum + (role === 3 && whorls < 3 ? Math.ceil(row.n / 2) : row.n);
        }, 0);
        for (const whorls of [1, 2, 3]) {
            const part = createBlooms(uniforms(), plan, { whorls });
            const [petals] = (() => {
                const found = [];
                part.mesh.traverse((object) => { if (object.isMesh) found.push(object); });
                return found;
            })();
            const lily = petals.geometry.getAttribute('aLily');
            const petal = petals.geometry.getAttribute('aPetal');
            const shape = petals.geometry.getAttribute('aShape');
            const curl = petals.geometry.getAttribute('aCurl');
            expect(petals.count).toBe(plan.reduce((sum, b) => sum + petalsOf(b.kind, whorls), 0));
            // In lily order, each lily's petals together, each told which lily is its own.
            let first = 0;
            plan.forEach((b, index) => {
                const n = petalsOf(b.kind, whorls);
                const roles = new Map();
                for (let i = first; i < first + n; i++) {
                    const label = `whorls ${whorls}, lily ${index}, petal ${i}`;
                    expect(lily.getW(i), label).toBe(index);
                    expect(lily.getX(i), label).toBeCloseTo(b.x, 4);
                    expect(lily.getY(i), label).toBeCloseTo(b.z, 4);
                    expect(lily.getZ(i), label).toBeCloseTo(b.size, 5);
                    // Its lily's kind, and its role: a whorl (0 outer .. 2 inner) or a stamen (3).
                    expect(petal.getZ(i), label).toBe(b.kind);
                    const role = petal.getW(i);
                    roles.set(role, (roles.get(role) || 0) + 1);
                    const row = BLOOM_SHAPES[b.kind][role];
                    expect(row, label).toBeTruthy();
                    // The row's shape: shut and open leans, its length (give or take a little) and width.
                    expect(shape.getX(i), label).toBeCloseTo(row.shut, 6);
                    expect(shape.getY(i), label).toBeCloseTo(row.open, 6);
                    expect(shape.getZ(i) / row.length, label).toBeGreaterThan(0.93);
                    expect(shape.getZ(i) / row.length, label).toBeLessThan(1.07);
                    expect(shape.getW(i), label).toBeCloseTo(row.width, 6);
                    expect(curl.getX(i), label).toBeCloseTo(row.bow, 6);
                    expect(curl.getY(i), label).toBeCloseTo(row.bowAt, 6);
                    expect(curl.getZ(i), label).toBeCloseTo(row.tip, 6);
                    expect(curl.getW(i), label).toBeCloseTo(b.seed, 6);
                    expect(petal.getY(i), label).toBeGreaterThanOrEqual(0);
                    expect(petal.getY(i), label).toBeLessThan(1);
                }
                // Every whorl of its kind, all its petals; the lean tier without the innermost.
                const expected = new Map();
                BLOOM_SHAPES[b.kind].forEach((row, role) => {
                    if (role === 2 && whorls < 3) return;
                    expected.set(role, role === 3 && whorls < 3 ? Math.ceil(row.n / 2) : row.n);
                });
                expect(roles).toEqual(expected);
                first += n;
            });
            part.dispose();
        }
        // Kinds differ: not every kind has the same number of petals.
        expect(new Set([0, 1, 2].map((kind) => petalsOf(kind, 3))).size).toBeGreaterThan(1);
        // A plan longer than the pool is cut to it; an empty one draws nothing and breaks nothing.
        const none = createBlooms(uniforms(), []);
        expect(none.count).toBe(0);
        expect(none.totalHeld(5)).toBe(0);
        expect(() => none.tick(3)).not.toThrow();
        none.dispose();
    });
});
