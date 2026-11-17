/**
 * Sunset — the lotus lantern: the model as Blender wrote it (its size, its waterline, its budget,
 * what its four numbers a vertex say, which way its faces look), what a seed makes of a lantern,
 * and the instanced part the world draws them with.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    LANTERN_LOOK, buildLanternGeometry, createLanterns, lanternModel, lanternVariety,
} from '../../src/themes/sunset/sunset-lanterns.js';
import { SUNSET_LANTERN } from '../../src/themes/sunset/sunset-lantern-model.js';
import { SunsetWorld } from '../../src/themes/sunset/sunset-world.js';
import { fallbackLayout } from '../../src/themes/sunset/sunset-composition.js';

const PAPER = 0;
const PETAL = 128;
const WOOD = 255;

/** Every vertex of the model: its place, its normal and its four numbers (0..255). */
function vertices() {
    const m = lanternModel();
    return Array.from({ length: m.vertexCount }, (_, i) => ({
        i,
        p: new THREE.Vector3(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]),
        n: new THREE.Vector3(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]),
        up: m.colours[i * 4],
        open: m.colours[i * 4 + 1],
        line: m.colours[i * 4 + 2],
        part: m.colours[i * 4 + 3],
    }));
}

/** Every triangle: its corners, its middle and the way its winding faces. */
function triangles() {
    const m = lanternModel();
    const v = vertices();
    const out = [];
    for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [v[m.index[t]], v[m.index[t + 1]], v[m.index[t + 2]]];
        const face = new THREE.Vector3().crossVectors(b.p.clone().sub(a.p), c.p.clone().sub(a.p));
        const centre = a.p.clone().add(b.p).add(c.p).divideScalar(3);
        out.push({
            corners: [a, b, c], face, centre, part: a.part,
        });
    }
    return out;
}

const radial = (p) => new THREE.Vector3(p.x, 0, p.z).normalize();

describe('sunset lantern: the model', () => {
    it('is the lotus lantern Blender wrote: real size, afloat on its waterline, within its budget', () => {
        const m = lanternModel();
        expect(m.vertexCount).toBe(SUNSET_LANTERN.vertexCount);
        expect(m.positions).toHaveLength(m.vertexCount * 3);
        expect(m.normals).toHaveLength(m.vertexCount * 3);
        expect(m.colours).toHaveLength(m.vertexCount * 4);
        expect(m.index).toHaveLength(SUNSET_LANTERN.triangleCount * 3);
        expect(Math.max(...m.index)).toBeLessThan(m.vertexCount);
        // 48 to 64 are drawn at once.
        expect(m.triangleCount).toBeLessThanOrEqual(700);
        expect(m.triangleCount).toBeGreaterThan(400);
        const v = vertices();
        const ys = v.map((q) => q.p.y);
        const reach = v.map((q) => Math.hypot(q.p.x, q.p.z));
        // About 0.66 m tall; the float sits a few centimetres into the water and nothing else does.
        expect(Math.max(...ys)).toBeGreaterThan(0.62);
        expect(Math.max(...ys)).toBeLessThan(0.7);
        expect(Math.min(...ys)).toBeLessThan(-0.01);
        expect(Math.min(...ys)).toBeGreaterThan(-0.05);
        v.filter((q) => q.p.y < 0).forEach((q) => expect(q.part).toBe(WOOD));
        // About half a metre and a little more across the open petals, round its own axis.
        expect(Math.max(...reach) * 2).toBeGreaterThan(0.5);
        expect(Math.max(...reach) * 2).toBeLessThan(0.7);
        const centre = v.reduce((sum, q) => sum.add(q.p), new THREE.Vector3()).divideScalar(v.length);
        expect(Math.hypot(centre.x, centre.z)).toBeLessThan(0.01);
        // What the header says of it.
        expect(SUNSET_LANTERN.height).toBeCloseTo(Math.max(...ys), 3);
        expect(SUNSET_LANTERN.depth).toBeCloseTo(-Math.min(...ys), 3);
        expect(SUNSET_LANTERN.width).toBeCloseTo(Math.max(...reach) * 2, 1);
    });

    it('burns its flame low inside the paper, where the pool stands its halo', () => {
        const [x, y, z] = SUNSET_LANTERN.flame;
        const { mouth, crown, radius } = SUNSET_LANTERN.paper;
        expect(x).toBe(0);
        expect(z).toBe(0);
        // (sunset-world.js puts the halo 0.26 m × scale above the foot.)
        expect(Math.abs(y - 0.26)).toBeLessThan(0.03);
        expect((y - mouth) / (crown - mouth)).toBeGreaterThan(0.2);
        expect((y - mouth) / (crown - mouth)).toBeLessThan(0.45);
        // The paper stands well clear of it all round.
        const near = vertices().filter((q) => q.part === PAPER && Math.abs(q.p.y - y) < 0.06);
        expect(near.length).toBeGreaterThan(8);
        near.forEach((q) => expect(Math.hypot(q.p.x, q.p.z)).toBeGreaterThan(0.1));
        expect(radius).toBeGreaterThan(0.15);
        expect(radius).toBeLessThan(0.22);
    });

    it('names each vertex one of three parts, a whole triangle at a time', () => {
        const parts = new Set(vertices().map((q) => q.part));
        expect([...parts].sort((a, b) => a - b)).toEqual([PAPER, PETAL, WOOD]);
        const count = { [PAPER]: 0, [PETAL]: 0, [WOOD]: 0 };
        triangles().forEach((t) => {
            // (The shader reads the part from an interpolated number: it must not change across a face.)
            t.corners.forEach((q) => expect(q.part).toBe(t.part));
            count[t.part] += 1;
        });
        // The bud, two rings of petals, and the float with its hoops.
        expect(count[PAPER]).toBeGreaterThan(150);
        expect(count[PETAL]).toBeGreaterThan(150);
        expect(count[WOOD]).toBeGreaterThan(40);
        expect(count[WOOD]).toBeLessThan(count[PAPER]);
        const petals = SUNSET_LANTERN.petals.reduce((sum, n) => sum + n, 0);
        expect(SUNSET_LANTERN.petals.every((n) => n >= 8 && n <= 10)).toBe(true);
        expect(count[PETAL] % petals).toBe(0);
    });

    it('says how far up the paper each vertex is, and how far along its petal', () => {
        const { mouth, crown } = SUNSET_LANTERN.paper;
        const v = vertices();
        const paper = v.filter((q) => q.part === PAPER);
        expect(Math.min(...paper.map((q) => q.up))).toBe(0);
        expect(Math.max(...paper.map((q) => q.up))).toBe(255);
        paper.forEach((q) => {
            expect(Math.abs(q.up / 255 - (q.p.y - mouth) / (crown - mouth))).toBeLessThan(0.01);
        });
        // A petal runs out from the lantern's foot: its tip (255) further from the axis and higher
        // than its base (0).
        const petal = v.filter((q) => q.part === PETAL);
        const reachOf = (list) => list.reduce((sum, q) => sum + Math.hypot(q.p.x, q.p.z), 0) / list.length;
        const heightOf = (list) => list.reduce((sum, q) => sum + q.p.y, 0) / list.length;
        const base = petal.filter((q) => q.up === 0);
        const tip = petal.filter((q) => q.up === 255);
        expect(base.length).toBeGreaterThan(0);
        expect(tip.length).toBeGreaterThan(0);
        expect(reachOf(tip)).toBeGreaterThan(reachOf(base) + 0.1);
        expect(heightOf(tip)).toBeGreaterThan(heightOf(base) + 0.03);
        // The wood says 0 (the float, the lower hoop) or 1 (the upper hoop).
        v.filter((q) => q.part === WOOD).forEach((q) => expect([0, 255]).toContain(q.up));
    });

    it('draws a dark line down each of its eight ribs and down each petal\'s fold', () => {
        const v = vertices();
        const paper = v.filter((q) => q.part === PAPER);
        const ribs = paper.filter((q) => q.line === 255);
        const middles = paper.filter((q) => q.line === 0);
        expect(ribs.length + middles.length).toBe(paper.length);
        // Eight ribs, evenly round the bud.
        const step = (Math.PI * 2) / SUNSET_LANTERN.gores;
        expect(SUNSET_LANTERN.gores).toBe(8);
        ribs.forEach((q) => {
            const turn = Math.atan2(q.p.z, q.p.x) / step;
            expect(Math.abs(turn - Math.round(turn))).toBeLessThan(0.02);
        });
        // A gore swells out between its ribs at the belly.
        const belly = (list) => list.filter((q) => q.up > 100 && q.up < 170);
        const reachOf = (list) => list.reduce((sum, q) => sum + Math.hypot(q.p.x, q.p.z), 0) / list.length;
        expect(reachOf(belly(middles))).toBeGreaterThan(reachOf(belly(ribs)) + 0.005);
        // A petal's fold is its middle line; its edges are 0.
        const petal = v.filter((q) => q.part === PETAL);
        expect(petal.some((q) => q.line === 255)).toBe(true);
        expect(petal.some((q) => q.line === 0)).toBe(true);
        petal.forEach((q) => expect([0, 255]).toContain(q.line));
        v.filter((q) => q.part === WOOD).forEach((q) => expect(q.line).toBe(0));
    });

    it('bakes the occlusion of its own folds: open at the crown and the petal tips, shut in at the foot', () => {
        const v = vertices();
        const mean = (list) => list.reduce((sum, q) => sum + q.open, 0) / list.length;
        const paper = v.filter((q) => q.part === PAPER);
        const petal = v.filter((q) => q.part === PETAL);
        // The bud's shoulder and crown see the whole sky (the hoop that binds the crown casts no
        // shade on it); its foot stands in the cup of the petals.
        expect(mean(paper.filter((q) => q.up > 150))).toBeGreaterThan(245);
        expect(mean(paper.filter((q) => q.up === 255))).toBeGreaterThan(245);
        expect(mean(paper.filter((q) => q.up < 40))).toBeLessThan(120);
        // A petal is shut in at its base, under the bud, and opens toward its tip; the outer
        // ring's tips, clear of the bud, are open to most of the sky.
        const tips = petal.filter((q) => q.up === 255);
        expect(mean(tips)).toBeGreaterThan(mean(petal.filter((q) => q.up === 0)) + 20);
        expect(mean(tips.filter((q) => Math.hypot(q.p.x, q.p.z) > 0.26))).toBeGreaterThan(170);
        // Nothing is black all over, and something is wide open.
        expect(Math.max(...v.map((q) => q.open))).toBeGreaterThan(250);
        expect(mean(petal)).toBeGreaterThan(80);
        expect(mean(v)).toBeGreaterThan(120);
    });

    it('faces its shell outward and its petals to the flame, by its winding and by its normals', () => {
        const flame = new THREE.Vector3(...SUNSET_LANTERN.flame);
        const d = SUNSET_LANTERN.float;
        vertices().forEach((q) => expect(Math.abs(q.n.length() - 1)).toBeLessThan(0.03));
        let hoops = 0;
        triangles().forEach((t) => {
            const out = radial(t.centre);
            if (t.part === PAPER) {
                // The paper and its normals look away from the axis: the light falls on the side
                // the eye sees, and a back face is the inner wall.
                expect(t.face.dot(out)).toBeGreaterThan(0);
                t.corners.forEach((q) => expect(q.n.dot(radial(q.p))).toBeGreaterThan(0.5));
            } else if (t.part === PETAL) {
                // A petal's front is its upper side, the one turned to the flame.
                const toFlame = flame.clone().sub(t.centre);
                expect(t.face.dot(toFlame)).toBeGreaterThan(0);
                t.corners.forEach((q) => expect(q.n.dot(flame.clone().sub(q.p))).toBeGreaterThan(0));
            } else if (Math.abs(t.face.clone().normalize().y) > 0.9) {
                // The float's top looks up and its underside down.
                const top = t.centre.y > (d.top + d.bottom) / 2;
                expect(Math.sign(t.face.y)).toBe(top ? 1 : -1);
            } else {
                // The float's rim and the two hoops look outward.
                expect(t.face.dot(out)).toBeGreaterThan(0);
                if (t.centre.y > d.top) hoops += 1;
            }
        });
        expect(hoops).toBeGreaterThan(30);
    });

    it('builds the mesh the shader reads: positions, Blender\'s normals and the four numbers', () => {
        const geometry = buildLanternGeometry();
        const m = lanternModel();
        expect(geometry.getAttribute('position').count).toBe(m.vertexCount);
        expect(geometry.getAttribute('normal').count).toBe(m.vertexCount);
        const tone = geometry.getAttribute('color');
        expect(tone.itemSize).toBe(4);
        expect(tone.normalized).toBe(true);
        expect(tone.array).toBeInstanceOf(Uint8Array);
        expect(geometry.index.count).toBe(m.triangleCount * 3);
        expect(geometry.boundingSphere.radius).toBeGreaterThan(0.3);
        expect(geometry.boundingSphere.radius).toBeLessThan(0.6);
        geometry.dispose();
    });
});

describe('sunset lantern: no two alike', () => {
    it('gives a seed its own size, build, lean and paper, always the same and never far off', () => {
        const L = LANTERN_LOOK;
        const seen = new Set();
        for (let i = 0; i < 200; i += 1) {
            const seed = (i * 0.618034) % 1;
            const a = lanternVariety(seed);
            expect(lanternVariety(seed)).toEqual(a);
            expect(Math.abs(a.size - 1)).toBeLessThanOrEqual(L.size + 1e-9);
            expect(Math.abs(a.tall - 1)).toBeLessThanOrEqual(L.squash + 1e-9);
            expect(Math.abs(a.leanX)).toBeLessThanOrEqual(L.lean + 1e-9);
            expect(Math.abs(a.leanZ)).toBeLessThanOrEqual(L.lean + 1e-9);
            expect(a.pale).toBeGreaterThanOrEqual(0);
            expect(a.pale).toBeLessThan(1);
            seen.add(a.size.toFixed(3));
        }
        // A sea of thirty is not stamped out of one.
        expect(seen.size).toBeGreaterThan(60);
        // Small enough that the flame stays where the halo is, and the lantern stays a lantern.
        expect(L.size).toBeLessThanOrEqual(0.12);
        expect(L.squash).toBeLessThanOrEqual(0.1);
        expect(L.lean).toBeLessThanOrEqual(0.06);
    });
});

/** The part out of a world (its uniforms are the world's). */
function makePart(capacity = 12) {
    const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' });
    return createLanterns({ capacity, U: world.U });
}

describe('sunset lantern: the part', () => {
    it('is one instanced draw of `capacity` lanterns with the attributes the shader reads', () => {
        const part = makePart(12);
        const { mesh } = part;
        expect(mesh.isInstancedMesh).toBe(true);
        expect(mesh.instanceMatrix.count).toBe(12);
        expect(mesh.count).toBe(0);
        expect(mesh.material.isMeshBasicNodeMaterial).toBe(true);
        expect(mesh.material.side).toBe(THREE.DoubleSide);
        const { attributes } = mesh.geometry;
        // Per vertex: place, normal, the four numbers. Per lantern: (r, g, b, glow) and (where
        // its flame burns in the world, how pale its paper is).
        expect(Object.keys(attributes).sort()).toEqual(['aFlame', 'aLamp', 'color', 'normal', 'position']);
        ['aLamp', 'aFlame'].forEach((name) => {
            expect(attributes[name].isInstancedBufferAttribute, name).toBe(true);
            expect(attributes[name].itemSize, name).toBe(4);
            expect(attributes[name].count, name).toBe(12);
        });
        // WebGPU binds eight vertex buffers a pipeline: these and the instance matrix.
        expect(Object.keys(attributes).length + 1).toBeLessThanOrEqual(8);
        part.dispose();
    });

    it('writes each lantern its place, its colour and glow, and where its flame burns', () => {
        const part = makePart(8);
        const { mesh } = part;
        const lamp = mesh.geometry.getAttribute('aLamp');
        const flame = mesh.geometry.getAttribute('aFlame');
        const rgb = [1, 0.25, 0.5];
        part.begin();
        part.push(3, 0.2, -9, 0, 0, 1, rgb, 0.9, 0.37);
        part.push(-4, -0.1, -20, 0.12, -0.05, 0.5, [0.2, 0.4, 1], 1.3, 0.81);
        part.end();
        expect(mesh.count).toBe(2);
        expect([lamp.getX(0), lamp.getY(0), lamp.getZ(0)]).toEqual([1, 0.25, 0.5]);
        expect(lamp.getW(0)).toBeCloseTo(0.9, 6);
        expect(lamp.getW(1)).toBeCloseTo(1.3, 6);
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        [[3, 0.2, -9, 1, 0.37], [-4, -0.1, -20, 0.5, 0.81]].forEach(([x, y, z, scale, seed], i) => {
            mesh.getMatrixAt(i, m);
            m.decompose(p, q, s);
            const kind = lanternVariety(seed);
            // Its foot where it was put; its size its own, taller for slimmer.
            expect(p.x).toBeCloseTo(x, 5);
            expect(p.y).toBeCloseTo(y, 5);
            expect(p.z).toBeCloseTo(z, 5);
            expect(s.y).toBeCloseTo(scale * kind.size * kind.tall, 5);
            expect(s.x).toBeCloseTo(s.z, 6);
            expect(s.x * s.x * s.y).toBeCloseTo((scale * kind.size) ** 3, 4);
            // Its flame up its own axis from its foot, where the model burns it.
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
            const at = new THREE.Vector3(flame.getX(i), flame.getY(i), flame.getZ(i));
            const along = at.clone().sub(p);
            expect(along.length()).toBeCloseTo(SUNSET_LANTERN.flame[1] * s.y, 4);
            expect(along.normalize().dot(up)).toBeGreaterThan(0.9999);
            // (The world's halo stands 0.26 m × scale above the foot: the hot core is inside it.)
            expect(Math.abs(at.y - (y + 0.26 * scale))).toBeLessThan(0.06 * scale + 0.01);
            expect(flame.getW(i)).toBeCloseTo(kind.pale, 6);
        });
        // The second leans with the slope it rides (and a little its own way).
        mesh.getMatrixAt(1, m);
        m.decompose(p, q, s);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        expect(up.dot(new THREE.Vector3(-0.12, 1, 0.05).normalize())).toBeGreaterThan(0.997);
        expect(up.y).toBeLessThan(0.9999);
        part.dispose();
    });

    it('draws no more than its capacity, and starts each frame empty', () => {
        const part = makePart(4);
        part.begin();
        for (let i = 0; i < 9; i += 1) part.push(i, 0, -8, 0, 0, 1, [1, 1, 1], 1, i / 9);
        part.end();
        expect(part.mesh.count).toBe(4);
        part.begin();
        expect(part.mesh.count).toBe(0);
        part.end();
        part.dispose();
        expect(part.mesh.parent).toBe(null);
    });

    it('draws every lantern the world has on the water and in the air', () => {
        const W = 1600;
        const H = 852;
        const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' }).build();
        const camera = new THREE.PerspectiveCamera(50, W / H, 0.25, 40000);
        world.bindCamera(camera);
        world.setLayout(fallbackLayout(W, H), W / H);
        world.setViewport(W, H, W / H);
        world.seek(10);
        let t = world.clock;
        const step = (seconds) => {
            for (let i = 0; i < Math.round(seconds * 30); i += 1) {
                t += 1 / 30;
                const sim = {
                    time: t, delta: 1 / 30, pointerX: 0, pointerY: 0,
                };
                world.updateCamera(camera, sim);
                world.update(sim, camera);
            }
        };
        step(0.2);
        for (let i = 0; i < 5; i += 1) world.onLock({ rows: [19 - i], u: (i * 0.37) % 1, color: '#ff4d8f' });
        step(2);
        world.onClear({ lines: 2, rows: [19, 18] });
        step(1.5);
        const state = world.getState();
        const { mesh } = world.parts.lanterns;
        expect(state.floating + state.flying).toBe(5);
        expect(mesh.count).toBe(5);
        expect(mesh.instanceMatrix.count).toBe(world.tier.lanterns);
        // Every flame stands over its own lantern's foot, a hand above the water or the air under it.
        const flame = mesh.geometry.getAttribute('aFlame');
        const m = new THREE.Matrix4();
        const foot = new THREE.Vector3();
        for (let i = 0; i < mesh.count; i += 1) {
            mesh.getMatrixAt(i, m);
            foot.setFromMatrixPosition(m);
            const rise = flame.getY(i) - foot.y;
            expect(rise).toBeGreaterThan(0.18);
            expect(rise).toBeLessThan(0.34);
            expect(Math.hypot(flame.getX(i) - foot.x, flame.getZ(i) - foot.z)).toBeLessThan(0.12);
        }
        world.dispose();
    });
});
